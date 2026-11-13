#!/usr/bin/env python3
"""Poll PanelStock for Lennox purchase requests using the existing NAS worker.

Disabled unless enabled in a private configuration file. Creation also needs an
independent creationEnabled setting. Only the existing nexvia_create.py submits
to Nexvia; this adapter never imports the form server or opens its POST route.
"""

import argparse
import contextlib
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


ORIGIN = "https://panelstock-reports.matthewlakerdis.workers.dev"
WORK_PATH = "/integrations/nexvia/request-work"
RESULT_PATH = "/integrations/nexvia/request-results"
LOCAL_LOOKUP = "http://127.0.0.1:8765/lookup"
CONFIG = Path("/config/panelstock-requests.json")
REQUESTS = Path("/config/nexvia-requests")
PROJECTS = Path("/config/nexvia-projects.json")
JOURNAL = Path("/config/panelstock-request-journal")
PYTHON = Path("/config/nexvia-tools/bin/python")
CREATOR = Path("/config/nexvia_create.py")
MAX_JSON_BYTES = 8 * 1024 * 1024
PAYLOAD_FIELDS = {
    "requestId", "reference", "projectPageId", "requestor", "date",
    "supplierId", "supplierReference", "serviceId", "breakdownType", "quote",
    "lines", "subtotalCents", "taxCents", "totalCents", "testOnly",
    "nexviaSubmissionEnabled",
}


class BridgeError(Exception):
    """Deliberately omits credentials, response bodies and requestor details."""


def require(condition, message):
    if not condition:
        raise BridgeError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def fingerprint(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def read_json(path, private=False):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode), "Expected a regular JSON file")
            if private:
                require(not info.st_mode & 0o077, "Configuration must have mode 0600")
            raw = stream.read(MAX_JSON_BYTES + 1)
        require(len(raw) <= MAX_JSON_BYTES, "JSON file exceeds the size limit")
        value = json.loads(raw)
        require(isinstance(value, dict), "Expected a JSON object")
        return value
    except (OSError, ValueError, TypeError) as error:
        raise BridgeError("Local JSON file is unavailable or invalid") from error


def atomic_json(path, value):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".panelstock-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(canonical(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def text(value, maximum, label, empty=False):
    require(isinstance(value, str), "Invalid " + label)
    require((empty or bool(value.strip()))
            and len(value.encode("utf-16-le")) // 2 <= maximum
            and not re.search(r"[\x00-\x1f\x7f]", value), "Invalid " + label)
    return value


def positive_id(value):
    return type(value) is int and 0 < value <= 9007199254740991


def canonical_uuid(value):
    try:
        normalized = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise BridgeError("Invalid request or worker identity") from error
    require(value == normalized, "Invalid request or worker identity")
    return normalized


def load_config(path=CONFIG):
    if not Path(path).exists():
        return None
    config = read_json(path, private=True)
    if config.get("enabled") is not True:
        return None
    token = config.get("token")
    require(isinstance(token, str) and 32 <= len(token) <= 512
            and all(33 <= ord(char) <= 126 for char in token),
            "Enabled configuration needs a valid request-bridge token")
    worker_id = canonical_uuid(config.get("workerId"))
    return {"token": token, "workerId": worker_id,
            "creationEnabled": config.get("creationEnabled") is True}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise BridgeError("Endpoint redirected; check the deployment")


def request_json(request, timeout):
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            raw = response.read(MAX_JSON_BYTES + 1)
        require(len(raw) <= MAX_JSON_BYTES, "Endpoint response exceeds the size limit")
        value = json.loads(raw)
        require(isinstance(value, dict), "Endpoint response is incomplete")
        return value
    except urllib.error.HTTPError as error:
        raise BridgeError("Endpoint request failed: HTTP " + str(error.code)) from error
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise BridgeError("Endpoint response is unavailable") from error


def post_api(path, payload, token):
    require(path in {WORK_PATH, RESULT_PATH}, "Unexpected request-bridge route")
    # The destination cannot be changed by a job or redirected to another host.
    request = urllib.request.Request(
        ORIGIN + path, data=canonical(payload), method="POST",
        headers={"Authorization": "Bearer " + token,
                 "User-Agent": "PanelStock-Nexvia-Bridge/1.0",
                 "Content-Type": "application/json", "Accept": "application/json"},
    )
    return request_json(request, 30)


def local_lookup(project_id):
    require(positive_id(project_id), "Invalid lookup project")
    request = urllib.request.Request(
        LOCAL_LOOKUP + "?" + urllib.parse.urlencode({"project": project_id, "q": ""}),
        method="GET", headers={"Accept": "application/json"},
    )
    return request_json(request, 75)


def load_projects(path=PROJECTS):
    value = read_json(path)
    projects = value.get("projects")
    require(isinstance(projects, list) and len(projects) <= 5000,
            "Project directory is invalid")
    result, seen = [], set()
    for project in projects:
        require(isinstance(project, dict) and positive_id(project.get("projectPageId")),
                "Project directory is invalid")
        project_id = project["projectPageId"]
        require(project_id not in seen, "Project directory has duplicate identities")
        seen.add(project_id)
        result.append({"projectPageId": project_id,
                       "name": text(project.get("name"), 160, "project name")})
    return result


def validate_catalog(value, project_id):
    require(isinstance(value, dict) and value.get("projectPageId") == project_id
            and value.get("supplierSearch") == "", "Lookup returned the wrong project or search")
    result = {"projectPageId": project_id, "supplierSearch": ""}
    for field in ("suppliers", "services", "breakdowns", "accounts", "taxes"):
        rows = value.get(field)
        require(isinstance(rows, list) and len(rows) <= 10000
                and (field == "suppliers" or bool(rows)), "Lookup choices are incomplete")
        clean, seen = [], set()
        for row in rows:
            require(isinstance(row, dict), "Lookup choice is invalid")
            identifier = row.get("id")
            require((type(identifier) is int or isinstance(identifier, str))
                    and bool(str(identifier)) and len(str(identifier)) <= 160,
                    "Lookup choice identity is invalid")
            require(str(identifier) not in seen, "Lookup choice identity is duplicated")
            seen.add(str(identifier))
            label = "text" if field == "suppliers" else "name"
            choice = {"id": identifier, label: text(row.get(label), 500, "choice name")}
            require(type(row.get("disabled", False)) is bool, "Invalid choice eligibility")
            choice["disabled"] = row.get("disabled", False)
            if field == "taxes":
                rate = decimal_value(row.get("rate"), positive=False)
                require(rate <= 100, "Invalid tax rate")
                choice["rate"] = str(rate)
            clean.append(choice)
        result[field] = clean
    return result


def decimal_value(value, positive):
    require(not isinstance(value, bool) and isinstance(value, (int, float, str)),
            "Invalid request decimal value")
    try:
        number = Decimal(str(value))
    except InvalidOperation as error:
        raise BridgeError("Invalid request decimal value") from error
    require(number.is_finite() and (number > 0 if positive else number >= 0)
            and number <= Decimal("1000000000"), "Invalid request decimal value")
    return number


def validate_payload(value, request_id, project_id):
    require(isinstance(value, dict) and set(value) == PAYLOAD_FIELDS,
            "Request payload is incomplete")
    require(value.get("requestId") == request_id
            and value.get("reference") == "REQ-" + request_id
            and value.get("projectPageId") == project_id,
            "Request payload identity mismatch")
    require(value.get("testOnly") is True and value.get("nexviaSubmissionEnabled") is False
            and value.get("quote") is None, "Unsupported request payload")
    person = value.get("requestor")
    require(isinstance(person, dict), "Requestor is missing")
    text(person.get("name"), 160, "requestor name")
    email = text(person.get("email"), 254, "requestor email")
    require(re.fullmatch(r"[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+", email),
            "Requestor email is invalid")
    try:
        require(isinstance(value.get("date"), str)
                and date.fromisoformat(value["date"]).isoformat() == value["date"],
                "Order date is invalid")
    except ValueError as error:
        raise BridgeError("Order date is invalid") from error
    for field in ("supplierId", "serviceId", "breakdownType"):
        require(isinstance(value.get(field), (str, int)) and not isinstance(value[field], bool),
                "Request selection is invalid")
        text(str(value[field]), 160, "request selection")
    text(value.get("supplierReference"), 300, "supplier reference", empty=True)
    rows = value.get("lines")
    require(isinstance(rows, list) and 1 <= len(rows) <= 200, "Request needs 1 to 200 lines")
    for row in rows:
        require(isinstance(row, dict), "Request line is invalid")
        text(row.get("description"), 2000, "line description")
        decimal_value(row.get("quantity"), positive=True)
        decimal_value(row.get("unitPriceExGst"), positive=False)
        for field in ("chartOfAccountId", "taxRateId"):
            require(isinstance(row.get(field), (str, int)) and not isinstance(row[field], bool),
                    "Request line selection is invalid")
            text(str(row[field]), 160, "line selection")
        require(row.get("breakdownType") == value["breakdownType"], "Line breakdown mismatch")
    for field in ("subtotalCents", "taxCents", "totalCents"):
        require(type(value.get(field)) is int and 0 <= value[field] <= 10**12,
                "Invalid request currency total")
    require(value["subtotalCents"] + value["taxCents"] == value["totalCents"],
            "Request totals do not reconcile")
    return value


def payload_projection(value):
    """Compare immutable legacy fields while accepting equivalent decimal types."""
    require(isinstance(value, dict) and isinstance(value.get("lines"), list)
            and all(isinstance(row, dict) for row in value["lines"]),
            "Existing local request is incomplete")
    result = {field: value.get(field) for field in PAYLOAD_FIELDS}
    result["lines"] = [dict(row) for row in value.get("lines", [])]
    for row in result["lines"]:
        row["quantity"] = str(decimal_value(row.get("quantity"), positive=True).normalize())
        row["unitPriceExGst"] = str(decimal_value(row.get("unitPriceExGst"), positive=False).normalize())
    return result


def preflight_request(payload, catalog):
    """Refresh legacy global choices and check selections before any submission."""
    def selected(field, identifier):
        row = next((row for row in catalog[field]
                    if str(row["id"]) == str(identifier)), None)
        require(row is not None and row.get("disabled") is not True,
                "Nexvia selections changed; review this request before creating a PO")
        return row

    selected("suppliers", payload["supplierId"])
    selected("services", payload["serviceId"])
    selected("breakdowns", payload["breakdownType"])
    subtotal, tax = 0, 0
    for row in payload["lines"]:
        selected("accounts", row["chartOfAccountId"])
        tax_row = selected("taxes", row["taxRateId"])
        quantity = decimal_value(row["quantity"], positive=True)
        price = decimal_value(row["unitPriceExGst"], positive=False)
        rate = decimal_value(tax_row["rate"], positive=False)
        amount = int((quantity * price).quantize(Decimal(".01"), rounding=ROUND_HALF_UP) * 100)
        subtotal += amount
        tax += int((Decimal(amount) * rate / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    require((subtotal, tax, subtotal + tax) == (
        payload["subtotalCents"], payload["taxCents"], payload["totalCents"]),
        "Current Nexvia tax or totals differ; review this request before creating a PO")


def stage_request(root, payload):
    root = Path(root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(root.is_dir() and not root.is_symlink(), "Request root is invalid")
    destination = root / payload["requestId"]
    if destination.exists() or destination.is_symlink():
        require(destination.is_dir() and not destination.is_symlink(), "Existing request folder is invalid")
        existing = read_json(destination / "request.json")
        require(payload_projection(existing) == payload_projection(payload),
                "Existing local request differs; manual review required")
        return destination
    # Match the older local form's input hash: reference is added after saving,
    # and an empty quoteBase64 was supplied then removed by its validation.
    original = dict(payload)
    original.pop("reference")
    original["quoteBase64"] = ""
    record = dict(payload, status="LOCAL_TEST", submissionHash=fingerprint(original),
                  savedAt=datetime.now(timezone.utc).isoformat())
    temporary = Path(tempfile.mkdtemp(prefix=".pending-panelstock-", dir=root))
    try:
        atomic_json(temporary / "request.json", record)
        try:
            temporary.rename(destination)
        except FileExistsError:
            require(payload_projection(read_json(destination / "request.json"))
                    == payload_projection(payload), "Concurrent local request differs")
        directory = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return destination
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def verified_result(folder, payload):
    path = folder / "nexvia-result.json"
    if not path.exists() and not path.is_symlink():
        return None
    result = read_json(path)
    require(result.get("state") == "CREATED_VERIFIED"
            and result.get("requestReference") == payload["reference"]
            and result.get("projectPageId") == payload["projectPageId"]
            and type(result.get("totalCents")) is int
            and result["totalCents"] == payload["totalCents"],
            "Existing result is unverified or does not match this request")
    order_id, number = result.get("purchaseOrderId"), result.get("purchaseOrderNumber")
    require(positive_id(order_id) and isinstance(number, str)
            and re.fullmatch(r"PO[0-9]+", number), "Verified PO identity is invalid")
    expected = "https://lennox.nexvia.com.au/staff/project-purchase-order-modify/" \
        + str(payload["projectPageId"]) + "/" + str(order_id)
    require(result.get("url") == expected, "Verified PO URL does not match")
    try:
        timestamp = datetime.fromisoformat(str(result.get("verifiedAt", "")).replace("Z", "+00:00"))
    except ValueError as error:
        raise BridgeError("Verified PO timestamp is invalid") from error
    require(timestamp.tzinfo is not None and timestamp.utcoffset().total_seconds() == 0,
            "Verified PO timestamp must use UTC")
    return {"state": "CREATED_VERIFIED", "requestReference": payload["reference"],
            "projectPageId": payload["projectPageId"], "purchaseOrderId": order_id,
            "purchaseOrderNumber": number, "url": expected, "totalCents": payload["totalCents"],
            "verifiedAt": timestamp.astimezone(timezone.utc).isoformat(
                timespec="milliseconds").replace("+00:00", "Z")}


def invoke_preparer(request_id):
    return subprocess.run(
        [str(PYTHON), str(CREATOR), "--request", request_id],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=180, check=False,
    ).returncode


def invoke_creator(request_id, prepared_hash):
    require(isinstance(prepared_hash, str) and re.fullmatch(r"[a-f0-9]{64}", prepared_hash),
            "Invalid prepared submission hash")
    return subprocess.run(
        [str(PYTHON), str(CREATOR), "--request", request_id, "--submit", prepared_hash],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=180, check=False,
    ).returncode


def prepared_submission(folder, payload):
    """Authorize only the existing worker's exact, fresh prepared artifact."""
    prepared = read_json(folder / "nexvia-prepared.json")
    prepared_hash = prepared.get("preparedHash")
    unsigned = {key: value for key, value in prepared.items() if key != "preparedHash"}
    request = read_json(folder / "request.json")
    require(isinstance(prepared_hash, str) and re.fullmatch(r"[a-f0-9]{64}", prepared_hash)
            and fingerprint(unsigned) == prepared_hash
            and prepared.get("requestHash") == fingerprint(request),
            "Preparation or saved request changed; no submission authorized")
    require(payload_projection(request) == payload_projection(payload)
            and prepared.get("reference") == payload["reference"]
            and prepared.get("projectPageId") == payload["projectPageId"]
            and prepared.get("totalCents") == payload["totalCents"]
            and positive_id(prepared.get("jobId")),
            "Prepared request identity or total does not match")
    try:
        timestamp = datetime.fromisoformat(str(prepared.get("preparedAt", "")).replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - timestamp).total_seconds()
    except (ValueError, TypeError) as error:
        raise BridgeError("Preparation timestamp is invalid") from error
    require(0 <= age <= 900, "Preparation expired; no submission authorized")
    destination = urllib.parse.urlsplit(str(prepared.get("createPath", "")))
    query = urllib.parse.parse_qs(destination.query, keep_blank_values=True)
    require(not destination.scheme and not destination.netloc and not destination.fragment
            and destination.path == "/staff/project-purchase-order-add/" + str(payload["projectPageId"])
            and query == {"type": ["Assembly"], "service": [str(payload["serviceId"])],
                          "client": [str(payload["supplierId"])],
                          "breakdown_type": [str(payload["breakdownType"])]},
            "Prepared destination does not match the request")
    fields = prepared.get("fields")
    require(isinstance(fields, list) and all(isinstance(pair, list) and len(pair) == 2
            and all(isinstance(item, str) for item in pair) for pair in fields),
            "Prepared form fields are invalid")

    def one(name):
        values = [value for key, value in fields if key == "form[" + name + "]"]
        require(len(values) == 1, "Prepared form action is missing or duplicated")
        return values[0]

    require(one("ServiceId") == str(payload["serviceId"]) and one("CurrencyId") == "8"
            and one("Comment") == "Request reference: " + payload["reference"],
            "Prepared service, currency or reference does not match")
    for name in ("Print", "Email", "Outlook", "MarkSent", "Stock", "EditStock"):
        require(one(name) == "false", "Unexpected prepared form action")
    for name in ("Approve", "SubmitForApproval", "NewJobId", "NewJobMoveLines"):
        require(one(name) == "", "Unexpected prepared approval or relocation action")
    require(one("ContinueEdit") == "true"
            and not any(key in {"form[Files][]", "form[TaxInclusive]"} for key, value in fields),
            "Unexpected prepared attachment or tax action")
    ordered = date.fromisoformat(payload["date"])
    for part in ("day", "month", "year"):
        require(one("OrderedDate][" + part) == str(getattr(ordered, part)),
                "Prepared order date does not match")
    try:
        lines = json.loads(one("Lines"))
    except (ValueError, TypeError) as error:
        raise BridgeError("Prepared lines are invalid") from error
    require(isinstance(lines, list) and len(lines) == len(payload["lines"]),
            "Prepared line count does not match")
    for actual, source in zip(lines, payload["lines"]):
        require(isinstance(actual, dict) and actual.get("id") is None
                and actual.get("is_new") is True
                and actual.get("item_description") == source["description"]
                and str(actual.get("chart_of_account_id")) == str(source["chartOfAccountId"])
                and str(actual.get("tax_rate_id")) == str(source["taxRateId"])
                and actual.get("breakdown_type") == source["breakdownType"]
                and actual.get("job_id") == prepared["jobId"]
                and decimal_value(actual.get("qty"), True) == decimal_value(source["quantity"], True)
                and decimal_value(actual.get("unit_price"), False) == decimal_value(source["unitPriceExGst"], False),
                "Prepared line values do not match the request")
    return prepared_hash


def save_terminal(path, journal, state, message=None, result=None, catalog=None):
    terminal = {"workerId": journal["workerId"], "id": journal["id"],
                "claimToken": journal["claimToken"], "kind": journal["kind"], "state": state}
    if message:
        terminal["message"] = message
    if result is not None:
        terminal["result"] = result
    if catalog is not None:
        terminal["catalog"] = catalog
    journal.update(phase="TERMINAL", outbound=terminal, reported=False)
    atomic_json(path, journal)
    return journal


def handle_work(work, config, journal_root, request_root, lookup=local_lookup,
                creator=invoke_creator, preparer=invoke_preparer):
    require(isinstance(work, dict), "Work response is incomplete")
    identifier = canonical_uuid(work.get("id"))
    kind = work.get("kind")
    require(kind in {"lookup", "request"} and positive_id(work.get("projectPageId")),
            "Work identity is invalid")
    claim = text(work.get("claimToken"), 512, "claim token")
    require(len(claim) >= 16 and not re.search(r"\s", claim), "Work claim is invalid")
    payload = work.get("payload")
    if kind == "request":
        validate_payload(payload, identifier, work["projectPageId"])
    work_hash = fingerprint({"id": identifier, "kind": kind,
                             "projectPageId": work["projectPageId"], "payload": payload})
    path = Path(journal_root) / (kind + "-" + identifier + ".json")
    if path.exists():
        journal = read_json(path, private=True)
        require(journal.get("workHash") == work_hash
                and journal.get("workerId") == config["workerId"]
                and journal.get("claimToken") == claim, "Claimed work changed; manual review required")
        if journal.get("outbound"):
            return path, journal
    else:
        journal = {"version": 1, "workerId": config["workerId"], "id": identifier,
                   "kind": kind, "claimToken": claim, "workHash": work_hash, "phase": "CLAIMED"}
        atomic_json(path, journal)
    if kind == "lookup":
        try:
            journal["phase"] = "LOOKUP_STARTED"
            atomic_json(path, journal)
            catalog = validate_catalog(lookup(work["projectPageId"]), work["projectPageId"])
            return path, save_terminal(path, journal, "ready", catalog=catalog)
        except BridgeError:
            return path, save_terminal(path, journal, "needs_review",
                                       message="Nexvia choices are unavailable. Check browser sign-in and project access.")
    try:
        folder = stage_request(request_root, payload)
        result = verified_result(folder, payload)
        if result:
            return path, save_terminal(path, journal, "created_verified", result=result)
        require(journal.get("phase") != "SUBMISSION_STARTED",
                "A previous submission may have started; inspect Nexvia before retrying")
        attempt = folder / "nexvia-create-attempt.json"
        require(not attempt.exists() and not attempt.is_symlink(),
                "A previous submission attempt exists; inspect Nexvia before retrying")
        require(config.get("creationEnabled") is True,
                "NAS purchase-order creation is disabled; request saved for review")
        # The existing validator reads nexvia-form-data.json. This GET refreshes
        # that file for this project and does not submit the local form.
        catalog = validate_catalog(lookup(work["projectPageId"]), work["projectPageId"])
        preflight_request(payload, catalog)
        journal["phase"] = "PREPARING"
        atomic_json(path, journal)
        try:
            prepared_code = preparer(identifier)
        except (OSError, subprocess.SubprocessError):
            prepared_code = None
        result = verified_result(folder, payload)
        if result:
            return path, save_terminal(path, journal, "created_verified", result=result)
        require(prepared_code == 0, "Fresh preparation failed; no submission authorized")
        prepared_hash = prepared_submission(folder, payload)
        require(not attempt.exists() and not attempt.is_symlink(),
                "Another submission attempt exists; inspect Nexvia before retrying")
        journal.update(phase="PREPARED", preparedHash=prepared_hash)
        atomic_json(path, journal)
        # Persist uncertainty before invoking any code that may submit a real PO.
        journal["phase"] = "SUBMISSION_STARTED"
        atomic_json(path, journal)
        try:
            return_code = creator(identifier, prepared_hash)
        except (OSError, subprocess.SubprocessError):
            return_code = None
        result = verified_result(folder, payload)
        if result:
            return path, save_terminal(path, journal, "created_verified", result=result)
        require(return_code == 0, "Creation did not return a verified result; inspect Nexvia before retrying")
        raise BridgeError("Creation returned without a verified result; inspect Nexvia before retrying")
    except BridgeError as error:
        return path, save_terminal(path, journal, "needs_review", message=str(error))


def report_terminal(path, journal, token, post=post_api):
    outbound = journal.get("outbound")
    require(isinstance(outbound, dict), "Stored result is incomplete")
    reply = post(RESULT_PATH, outbound, token)
    require(isinstance(reply, dict) and reply.get("ok") is True,
            "PanelStock has not acknowledged the stored result")
    record = reply.get("lookup" if journal["kind"] == "lookup" else "request")
    require(isinstance(record, dict) and record.get("id") == journal["id"]
            and record.get("state") == outbound["state"],
            "PanelStock has not acknowledged the matching work identity and outcome")
    journal["reported"] = True
    atomic_json(path, journal)
    return outbound["state"]


@contextlib.contextmanager
def bridge_lock(root):
    root = Path(root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(root.is_dir() and not root.is_symlink(), "Journal directory is invalid")
    descriptor = os.open(root / ".bridge.lock", os.O_CREAT | os.O_RDWR
                         | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise BridgeError("Another request bridge is running") from error
        yield
    finally:
        os.close(descriptor)


def run_once(config_path=CONFIG, request_root=REQUESTS, projects_path=PROJECTS,
             journal_root=JOURNAL, post=post_api, lookup=local_lookup,
             creator=invoke_creator, preparer=invoke_preparer):
    config = load_config(config_path)
    if config is None:
        return "disabled"
    with bridge_lock(journal_root):
        # Result delivery always takes priority over new claims. A lost HTTP
        # response can never cause the irreversible creator to run again.
        for path in sorted(Path(journal_root).glob("*.json")):
            journal = read_json(path, private=True)
            require(journal.get("workerId") == config["workerId"],
                    "Journal worker identity changed; manual review required")
            if journal.get("outbound") and journal.get("reported") is not True:
                return report_terminal(path, journal, config["token"], post)
        reply = post(WORK_PATH, {"workerId": config["workerId"],
                                "projects": load_projects(projects_path)}, config["token"])
        require(isinstance(reply, dict) and reply.get("ok") is True
                and "work" in reply, "PanelStock work response is incomplete")
        if reply["work"] is None:
            return "idle"
        path, journal = handle_work(reply["work"], config, journal_root, request_root, lookup, creator, preparer)
        return report_terminal(path, journal, config["token"], post)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Handle one job (default)")
    mode.add_argument("--watch", action="store_true", help="Poll every 30 seconds")
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--root", type=Path, default=REQUESTS)
    parser.add_argument("--projects", type=Path, default=PROJECTS)
    parser.add_argument("--journal", type=Path, default=JOURNAL)
    args = parser.parse_args()
    while True:
        try:
            status = run_once(args.config, args.root, args.projects, args.journal)
            print("Request bridge: " + status, flush=True)
            failed = status == "needs_review"
        except BridgeError as error:
            print("Request bridge: " + str(error), flush=True)
            failed = True
        if not args.watch:
            return int(failed)
        time.sleep(30)


if __name__ == "__main__":
    raise SystemExit(main())
