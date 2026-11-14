#!/usr/bin/env python3
"""Poll PanelStock for Lennox purchase requests using the existing NAS worker.

Disabled unless enabled in a private configuration file. Creation also needs an
independent creationEnabled setting. Only the existing nexvia_create.py submits
to Nexvia; this adapter never imports the form server or opens its POST route.
"""

import argparse
import base64
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

from nexvia_allocations import validate_allocation_lines


ORIGIN = "https://panelstock-reports.matthewlakerdis.workers.dev"
WORK_PATH = "/integrations/nexvia/request-work"
RESULT_PATH = "/integrations/nexvia/request-results"
DOCUMENT_PATH = "/integrations/nexvia/request-document"
LOCAL_LOOKUP = "http://127.0.0.1:8765/lookup"
CONFIG = Path("/config/panelstock-requests.json")
REQUESTS = Path("/config/nexvia-requests")
PROJECTS = Path("/config/nexvia-projects.json")
JOURNAL = Path("/config/panelstock-request-journal")
PYTHON = Path("/config/nexvia-tools/bin/python")
CREATOR = Path("/config/nexvia_create.py")
PROJECT_REFRESHER = Path("/config/nexvia_projects.py")
LOOKUP_REFRESHER = Path("/config/nexvia_lookups.py")
SNAPSHOT_REFRESH_SECONDS = 300
SNAPSHOT_MAX_DEFERRAL_SECONDS = 60
SNAPSHOT_REFRESH_STATE = "snapshot-refresh.state"
WATCH_IDLE_SECONDS = 2
WATCH_DISABLED_SECONDS = 30
WATCH_ERROR_SECONDS = 5
WATCH_ERROR_MAX_SECONDS = 30
WATCH_STATUS_SECONDS = 30
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
DOCUMENT_RETRY_SECONDS = 60
DOCUMENT_MAX_DEFERRAL_SECONDS = 60
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


def read_json(path, private=False, dir_fd=None):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=dir_fd)
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


@contextlib.contextmanager
def directory_fd(path, new=False):
    """Open the actual directory, never a substituted symlink."""
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as error:
        raise BridgeError("Tool directory is unavailable or unsafe") from error
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISDIR(info.st_mode) and (not new or info.st_uid == os.geteuid()),
                "New tool directory ownership is invalid")
        yield descriptor
    finally:
        os.close(descriptor)


def tighten_directory(descriptor, authorized=False):
    info = os.fstat(descriptor)
    if stat.S_IMODE(info.st_mode) == 0o700:
        return
    require(authorized and (info.st_uid == os.geteuid() or os.geteuid() == 0),
            "Tool directory privacy needs review")
    try:
        os.fchmod(descriptor, 0o700)
    except OSError as error:
        raise BridgeError("Tool directory could not be made private") from error
    require(stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o700,
            "Tool directory is not private after permission repair")


def request_directory(path, payload, repair=False):
    with directory_fd(path) as descriptor:
        existing = read_json("request.json", dir_fd=descriptor)
        require(payload_projection(existing) == payload_projection(payload),
                "Existing local request differs; manual review required")
        if repair:
            tighten_directory(descriptor, authorized=True)
        current, opened = os.stat(path, follow_symlinks=False), os.fstat(descriptor)
        require(stat.S_ISDIR(current.st_mode) and (current.st_dev, current.st_ino) == (opened.st_dev, opened.st_ino),
                "Request directory changed during validation")
    return Path(path)


def make_tool_root(path, designated, proof=False):
    path = Path(path)
    try:
        path.mkdir(mode=0o700, parents=True)
        created = True
    except FileExistsError:
        created = False
    except OSError as error:
        raise BridgeError("Tool directory could not be created") from error
    with directory_fd(path) as descriptor:
        tighten_directory(descriptor, authorized=created or path.absolute() == Path(designated).absolute() or proof)
    return path


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
    require("documentEnabled" not in config or type(config["documentEnabled"]) is bool,
            "Invalid document capability setting")
    return {"token": token, "workerId": worker_id,
            "creationEnabled": config.get("creationEnabled") is True,
            "documentEnabled": config.get("documentEnabled") is True}


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
    require(path in {WORK_PATH, RESULT_PATH, DOCUMENT_PATH}, "Unexpected request-bridge route")
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


def refresh_directory_snapshots(projects_path):
    """Run the read-only NAS exporters without leaking subprocess output."""
    succeeded = True
    for script in (PROJECT_REFRESHER, LOOKUP_REFRESHER):
        try:
            completed = subprocess.run(
                [str(PYTHON), str(script), "--refresh"],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=180, check=False,
            )
            succeeded = completed.returncode == 0 and succeeded
        except (OSError, subprocess.SubprocessError):
            succeeded = False
    require(succeeded, "Nexvia directory refresh failed")
    load_projects(projects_path)


def snapshot_refresh_warning(message):
    print("Request bridge warning: " + message, flush=True)


def snapshot_timestamp(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError, OverflowError):
        return None


def refresh_snapshots(projects_path, journal_root,
                      refresher=refresh_directory_snapshots, now=None,
                      warning=snapshot_refresh_warning, defer=False):
    """Refresh periodically while preserving the last successful snapshot state.

    The caller holds bridge_lock. Failed attempts also wait five minutes before
    retrying, and the .state file stays outside the work journal's *.json scan.
    Each exporter owns atomic replacement of its own cache; a failed refresh
    may keep the bridge online with saved choices but is never marked fresh.
    Watch mode can give queued work up to one minute ahead of due maintenance.
    The private deferral timestamp survives restarts, preventing starvation.
    """
    instant = time.time() if now is None else now
    timestamp = datetime.fromtimestamp(instant, timezone.utc).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")
    path = Path(journal_root) / SNAPSHOT_REFRESH_STATE
    state = {}
    if path.exists() or path.is_symlink():
        try:
            state = read_json(path, private=True)
        except BridgeError:
            warning("Directory refresh status is unavailable; checking saved choices.")
    previous_attempt = snapshot_timestamp(state.get("lastAttemptAt"))
    if previous_attempt is not None and 0 <= instant - previous_attempt < SNAPSHOT_REFRESH_SECONDS:
        return state
    if defer:
        deferred_at = snapshot_timestamp(state.get("deferredAt"))
        if deferred_at is None or deferred_at > instant:
            state["deferredAt"] = timestamp
            atomic_json(path, state)
            return state
        if instant - deferred_at < SNAPSHOT_MAX_DEFERRAL_SECONDS:
            return state
    state = {
        "lastAttemptAt": timestamp,
        "lastSuccessfulAt": state.get("lastSuccessfulAt"),
        "status": "refreshing",
    }
    atomic_json(path, state)
    try:
        refresher(Path(projects_path))
        # Even an injectable exporter cannot advertise an invalid cache as fresh.
        load_projects(projects_path)
    except (BridgeError, OSError, subprocess.SubprocessError):
        state["status"] = "stale"
        atomic_json(path, state)
        warning("Nexvia directory refresh failed; using the last saved choices.")
        return state
    state.update(status="fresh", lastSuccessfulAt=timestamp)
    atomic_json(path, state)
    return state


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
    destination = root / canonical_uuid(payload["requestId"])
    existing = destination.exists() or destination.is_symlink()
    if existing:
        request_directory(destination, payload)  # Prove identity before any permission change.
    root = make_tool_root(root, REQUESTS, proof=existing)
    if existing:
        return request_directory(destination, payload, repair=True)
    # Match the older local form's input hash: reference is added after saving,
    # and an empty quoteBase64 was supplied then removed by its validation.
    original = dict(payload)
    original.pop("reference")
    original["quoteBase64"] = ""
    record = dict(payload, status="LOCAL_TEST", submissionHash=fingerprint(original),
                  savedAt=datetime.now(timezone.utc).isoformat())
    temporary = Path(tempfile.mkdtemp(prefix=".pending-panelstock-", dir=root))
    temporary_identity = None
    try:
        with directory_fd(temporary, new=True) as descriptor:
            tighten_directory(descriptor, authorized=True)
            info = os.fstat(descriptor)
            temporary_identity = (info.st_dev, info.st_ino)
        atomic_json(temporary / "request.json", record)
        try:
            temporary.rename(destination)
        except FileExistsError:
            request_directory(destination, payload)
        request_directory(destination, payload, repair=True)
        directory = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return destination
    finally:
        if temporary_identity is not None:
            try:
                info = os.stat(temporary, follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode) and (info.st_dev, info.st_ino) == temporary_identity:
                    shutil.rmtree(temporary)
            except FileNotFoundError:
                pass


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
    allocation = prepared.get("allocation")
    require(isinstance(allocation, dict) and allocation.get("version") == 2
            and allocation.get("jobId") == prepared["jobId"],
            "Fresh native allocation proof is required before submission")
    proof = allocation.get("eowProof")
    require(isinstance(proof, list) and proof and all(isinstance(evidence, dict)
            and evidence.get("source") in ("line", "form")
            and isinstance(evidence.get("field"), str) and evidence["field"] for evidence in proof),
            "Prepared EOW allocation proof is invalid")
    for evidence in proof:
        if evidence["source"] == "form":
            values = [value for key, value in fields if key == evidence["field"]]
            require(values == [payload["breakdownType"]],
                    "Prepared form EOW does not match the native allocation")
    try:
        validate_allocation_lines(lines, payload, allocation)
    except (ValueError, TypeError, KeyError) as error:
        raise BridgeError("Prepared native allocation does not match the request") from error
    for actual, source in zip(lines, payload["lines"]):
        require(isinstance(actual, dict) and actual.get("id") is None
                and actual.get("is_new") is True
                and actual.get("item_description") == source["description"]
                and str(actual.get("chart_of_account_id")) == str(source["chartOfAccountId"])
                and str(actual.get("tax_rate_id")) == str(source["taxRateId"])
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
        terminal["result"] = dict(result, documentExpected=True) if journal.get("documentExpected") is True else result
    if catalog is not None:
        terminal["catalog"] = catalog
    journal.update(phase="TERMINAL", outbound=terminal, reported=False)
    atomic_json(path, journal)
    return journal


def handle_work(work, config, journal_root, request_root, lookup=local_lookup,
                creator=invoke_creator, preparer=invoke_preparer, project_names=None):
    require(isinstance(work, dict), "Work response is incomplete")
    identifier = canonical_uuid(work.get("id"))
    kind = work.get("kind")
    require(kind in {"lookup", "request"} and positive_id(work.get("projectPageId")),
            "Work identity is invalid")
    claim = text(work.get("claimToken"), 512, "claim token")
    require(len(claim) >= 16 and not re.search(r"\s", claim), "Work claim is invalid")
    payload = work.get("payload")
    require("documentExpected" not in work or type(work["documentExpected"]) is bool,
            "Invalid claimed document capability")
    document_expected = work.get("documentExpected") is True
    require(not document_expected or kind == "request", "Lookup cannot require a PO document")
    if kind == "request":
        validate_payload(payload, identifier, work["projectPageId"])
    work_hash = fingerprint({"id": identifier, "kind": kind,
                             "projectPageId": work["projectPageId"], "payload": payload,
                             **({"documentExpected": True} if document_expected else {})})
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
                   "kind": kind, "claimToken": claim, "workHash": work_hash, "phase": "CLAIMED",
                   **({"documentExpected": True} if document_expected else {})}
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
        if document_expected and not journal.get("documentContext"):
            project = (project_names or {}).get(work["projectPageId"])
            suppliers = [row for row in catalog["suppliers"] if str(row["id"]) == str(payload["supplierId"])]
            require(isinstance(project, str) and project.strip() and len(suppliers) == 1,
                    "PO document identity context is unavailable; no submission authorized")
            journal["documentContext"] = {"project": project, "supplier": suppliers[0]["text"]}
            atomic_json(path, journal)
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


def report_terminal(path, journal, token, post=post_api, warning=snapshot_refresh_warning):
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
    try:
        ensure_document_journal(path, journal)
    except Exception:
        warning("PO document journal needs review; the verified PO is unchanged.")
    return outbound["state"]


def load_document_capturer():
    try:
        from nexvia_po_document import capture_document, check_dependencies
        check_dependencies()  # Includes the installer's private vendored parser.
        require(callable(capture_document), "PO document capture is unavailable")
        return capture_document
    except Exception as error:
        raise BridgeError("PO document capture is unavailable; disable documentEnabled or finish installation") from error


def ensure_document_journal(path, journal):
    outbound = journal.get("outbound", {})
    if journal.get("documentExpected") is not True or journal.get("reported") is not True or outbound.get("state") != "created_verified":
        return None
    result = outbound.get("result")
    require(isinstance(result, dict) and result.get("documentExpected") is True,
            "Managed PO document result is incomplete")
    base = {"version": 1, "id": canonical_uuid(journal["id"]), "workerId": journal["workerId"],
            "claimToken": journal["claimToken"], "result": result,
            "sourceHash": fingerprint(outbound), "context": journal.get("documentContext")}
    directory = Path(path).parent / "documents"
    make_tool_root(directory, JOURNAL / "documents", proof=True)
    destination = directory / (base["id"] + ".json")
    if destination.exists() or destination.is_symlink():
        saved = read_json(destination, private=True)
        require(all(saved.get(key) == value for key, value in base.items()),
                "PO document journal identity changed; manual review required")
    else:
        atomic_json(destination, dict(base, status="pending", attempts=0, nextAttemptAt=0))
    return destination


def document_upload(folder, journal):
    document, result = journal.get("document"), journal["result"]
    require(isinstance(document, dict) and document.get("filename") == "nexvia-purchase-order.pdf"
            and document.get("projectPageId") == result["projectPageId"]
            and document.get("purchaseOrderId") == result["purchaseOrderId"]
            and document.get("purchaseOrderNumber") == result["purchaseOrderNumber"]
            and document.get("requestReference") == result["requestReference"]
            and type(document.get("size")) is int and 5 <= document["size"] <= MAX_DOCUMENT_BYTES
            and isinstance(document.get("sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", document["sha256"]),
            "The frozen PO document identity is invalid")
    try:
        descriptor = os.open(Path(folder) / "nexvia-purchase-order.pdf", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, "The frozen PO document is not private")
            raw = stream.read(MAX_DOCUMENT_BYTES + 1)
    except OSError as error:
        raise BridgeError("The frozen PO document is unavailable") from error
    require(len(raw) == document["size"] and raw.startswith(b"%PDF-")
            and hashlib.sha256(raw).hexdigest() == document["sha256"], "The frozen PO document changed; manual review required")
    return {"workerId": journal["workerId"], "id": journal["id"], "claimToken": journal["claimToken"],
            "projectPageId": result["projectPageId"], "purchaseOrderId": result["purchaseOrderId"],
            "purchaseOrderNumber": result["purchaseOrderNumber"], "sha256": document["sha256"],
            "contentBase64": base64.b64encode(raw).decode("ascii")}


def process_document(path, config, request_root, post, capturer, now=None, warning=snapshot_refresh_warning):
    instant = time.time() if now is None else now
    journal = read_json(path, private=True)
    if journal.get("status") in {"uploaded", "needs_review"} or journal.get("nextAttemptAt", 0) > instant:
        return None
    journal.pop("deferredAt", None)
    journal["attempts"] = journal.get("attempts", 0) + 1
    folder = Path(request_root) / canonical_uuid(journal["id"])
    frozen = bool(journal.get("document"))
    stage = "identity"
    try:
        require(folder.is_dir() and not folder.is_symlink(), "PO request folder is unavailable")
        request = read_json(folder / "request.json", private=True)
        local = verified_result(folder, request)
        require(local == {key: value for key, value in journal["result"].items() if key != "documentExpected"},
                "The verified PO result changed; manual review required")
        source = read_json(Path(path).parent.parent / ("request-" + journal["id"] + ".json"), private=True)
        payload = {field: request.get(field) for field in PAYLOAD_FIELDS}
        validate_payload(payload, journal["id"], local["projectPageId"])
        expected_work = {"id": journal["id"], "kind": "request", "projectPageId": local["projectPageId"],
                         "payload": payload, "documentExpected": True}
        require(source.get("documentExpected") is True and source.get("reported") is True
                and source.get("workHash") == fingerprint(expected_work)
                and fingerprint(source.get("outbound")) == journal["sourceHash"],
                "The saved document request identity changed; manual review required")
        context = journal.get("context")
        require(isinstance(context, dict) and all(isinstance(context.get(key), str) and context[key].strip()
                for key in ("project", "supplier")), "PO document identity context is unavailable")
        make_tool_root(request_root, REQUESTS, proof=True)
        request_directory(folder, payload, repair=True)
        if not frozen:
            stage = "capture"
            document = capturer(folder, request, local, expected_project=context["project"], expected_supplier=context["supplier"])
            require(isinstance(document, dict), "PO document capture did not return a descriptor")
            journal["document"] = document
        stage = "frozen"
        body = document_upload(folder, journal)
        body_hash = fingerprint(body)
        require(journal.get("uploadHash", body_hash) == body_hash, "Frozen PO document upload changed")
        journal.update(status="uploading", uploadHash=body_hash)
        atomic_json(path, journal)
        stage = "upload"
        reply = post(DOCUMENT_PATH, body, config["token"])
        confirmation = reply.get("confirmation") if isinstance(reply, dict) else None
        result = journal["result"]
        require(isinstance(reply, dict) and reply.get("ok") is True and isinstance(confirmation, dict)
                and confirmation.get("id") == "live:" + str(result["purchaseOrderId"])
                and confirmation.get("purchaseOrderId") == result["purchaseOrderId"]
                and confirmation.get("purchaseOrderNumber") == result["purchaseOrderNumber"]
                and confirmation.get("test") is False
                and confirmation.get("status") in {"queued", "retrying", "sending", "sent", "failed", "needs_review"},
                "PO document upload acknowledgement is incomplete")
        journal.update(status="uploaded", receipt=confirmation, nextAttemptAt=0)
        atomic_json(path, journal)
        return "document_uploaded"
    except Exception as error:
        permanent = stage in {"identity", "frozen"} or stage == "upload" and re.search(r"HTTP (?:400|401|403|404|409|413)\b", str(error))
        journal.update(status="needs_review" if permanent else "pending",
                       nextAttemptAt=0 if permanent else instant + min(300, DOCUMENT_RETRY_SECONDS * 2 ** min(journal["attempts"] - 1, 3)),
                       error="PO document needs review." if permanent else "PO document is unavailable; a separate retry is scheduled.")
        atomic_json(path, journal)
        warning(journal["error"])
        return "document_needs_review" if permanent else "document_pending"


def service_documents(paths, config, request_root, post, capturer, now=None,
                      warning=snapshot_refresh_warning, busy=False):
    """Give at most one due document a turn, after terminal acknowledgements.

    Interactive work normally goes first. Persist a one-minute deferral so a
    continuously busy queue or watcher restart cannot postpone PDFs forever.
    """
    instant = time.time() if now is None else now
    for path in paths:
        try:
            journal = read_json(path, private=True)
            if journal.get("status") in {"uploaded", "needs_review"} or journal.get("nextAttemptAt", 0) > instant:
                continue
            if busy:
                deferred = journal.get("deferredAt")
                if type(deferred) not in (int, float) or not 0 <= instant - deferred:
                    journal["deferredAt"] = instant
                    atomic_json(path, journal)
                    continue
                if instant - deferred < DOCUMENT_MAX_DEFERRAL_SECONDS:
                    continue
            status = process_document(path, config, request_root, post, capturer, now, warning)
            if status is not None:
                return status
        except Exception:
            warning("PO document journal needs review; interactive work remains available.")
    return None


@contextlib.contextmanager
def bridge_lock(root):
    root = Path(root)
    proof = False
    if root.exists() and not root.is_symlink():
        try:
            info = os.stat(root / ".bridge.lock", follow_symlinks=False)
            proof = stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size == 0
        except OSError:
            pass
    root = make_tool_root(root, JOURNAL, proof=proof)
    try:
        descriptor = os.open(root / ".bridge.lock", os.O_CREAT | os.O_RDWR
                             | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except OSError as error:
        raise BridgeError("Bridge lock is unavailable or unsafe") from error
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "Bridge lock is invalid")
        if stat.S_IMODE(info.st_mode) != 0o600:
            require(info.st_uid == os.geteuid() or os.geteuid() == 0, "Bridge lock ownership is invalid")
            os.fchmod(descriptor, 0o600)
        require(stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o600, "Bridge lock is not private")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise BridgeError("Another request bridge is running") from error
        yield
    finally:
        os.close(descriptor)


def run_once(config_path=CONFIG, request_root=REQUESTS, projects_path=PROJECTS,
             journal_root=JOURNAL, post=post_api, lookup=local_lookup,
             creator=invoke_creator, preparer=invoke_preparer,
             refresher=refresh_directory_snapshots, now=None,
             warning=snapshot_refresh_warning, prefer_work=False, capturer=None):
    config = load_config(config_path)
    if config is None:
        return "disabled"
    with bridge_lock(journal_root):
        document_paths = []
        # Result delivery always takes priority over new claims. A lost HTTP
        # response can never cause the irreversible creator to run again.
        for path in sorted(Path(journal_root).glob("*.json")):
            journal = read_json(path, private=True)
            require(journal.get("workerId") == config["workerId"],
                    "Journal worker identity changed; manual review required")
            if journal.get("outbound") and journal.get("reported") is not True:
                return report_terminal(path, journal, config["token"], post, warning)
            if journal.get("documentExpected") is True and journal.get("reported") is True:
                try:
                    document_path = ensure_document_journal(path, journal)
                    if document_path is not None:
                        document_paths.append(document_path)
                except Exception:
                    warning("PO document journal needs review; the verified PO is unchanged.")
        if config["documentEnabled"]:
            capturer = load_document_capturer() if capturer is None else capturer
            require(callable(capturer), "PO document capture is unavailable")
        if prefer_work:
            try:
                load_projects(projects_path)
            except BridgeError:
                # Bootstrap still needs a valid directory before cloud work.
                refresh_snapshots(projects_path, journal_root, refresher, now, warning)
            else:
                # Serve interactive work first, but do not starve due refreshes
                # under a continuous queue or across watcher restarts.
                refresh_snapshots(projects_path, journal_root, refresher, now, warning, defer=True)
        else:
            refresh_snapshots(projects_path, journal_root, refresher, now, warning)
        projects = load_projects(projects_path)
        poll = {"workerId": config["workerId"], "projects": projects}
        if config["documentEnabled"]:
            poll["documentExpected"] = True
        reply = post(WORK_PATH, poll, config["token"])
        require(isinstance(reply, dict) and reply.get("ok") is True
                and "work" in reply, "PanelStock work response is incomplete")
        if reply["work"] is None:
            if prefer_work:
                refresh_snapshots(projects_path, journal_root, refresher, now, warning)
            if config["documentEnabled"]:
                status = service_documents(document_paths, config, request_root, post, capturer, now, warning)
                if status is not None:
                    return status
            return "idle"
        path, journal = handle_work(reply["work"], config, journal_root, request_root, lookup, creator, preparer,
                                    {row["projectPageId"]: row["name"] for row in projects})
        status = report_terminal(path, journal, config["token"], post, warning)
        if config["documentEnabled"]:
            try:
                current_document = ensure_document_journal(path, journal)
                if current_document is not None and current_document not in document_paths:
                    document_paths.append(current_document)
            except Exception:
                warning("PO document journal needs review; the verified PO is unchanged.")
            service_documents(document_paths, config, request_root, post, capturer, now, warning, busy=True)
        return status


def bridge_status(message):
    print("Request bridge: " + message, flush=True)


def run_watch(config_path=CONFIG, request_root=REQUESTS, projects_path=PROJECTS,
              journal_root=JOURNAL, runner=None, sleep=None, clock=None,
              emit=bridge_status):
    """Drain acknowledged jobs promptly; back off when the connection fails."""
    runner = run_once if runner is None else runner
    sleep = time.sleep if sleep is None else sleep
    clock = time.monotonic if clock is None else clock
    failures = 0
    previous_status = None
    last_logged = None
    while True:
        try:
            status = runner(config_path, request_root, projects_path, journal_root,
                            prefer_work=True)
        except BridgeError as error:
            failures += 1
            emit(str(error))
            previous_status = None
            sleep(min(WATCH_ERROR_MAX_SECONDS,
                      WATCH_ERROR_SECONDS * 2 ** min(failures - 1, 3)))
            continue
        failures = 0
        instant = clock()
        terminal = status in {"ready", "created_verified", "needs_review"}
        if terminal or status != previous_status or last_logged is None or instant - last_logged >= WATCH_STATUS_SECONDS:
            emit(status)
            previous_status, last_logged = status, instant
        if terminal:
            # Only acknowledged outcomes reach here. A failed report raises and
            # retries its saved terminal body before any new claim or creator.
            continue
        sleep(WATCH_DISABLED_SECONDS if status == "disabled" else WATCH_IDLE_SECONDS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Handle one job (default)")
    mode.add_argument("--watch", action="store_true", help="Poll every 2 seconds while idle; drain completed jobs immediately")
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--root", type=Path, default=REQUESTS)
    parser.add_argument("--projects", type=Path, default=PROJECTS)
    parser.add_argument("--journal", type=Path, default=JOURNAL)
    args = parser.parse_args()
    if args.watch:
        run_watch(args.config, args.root, args.projects, args.journal)
        return 0
    try:
        status = run_once(args.config, args.root, args.projects, args.journal)
        bridge_status(status)
        return int(status == "needs_review")
    except BridgeError as error:
        bridge_status(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
