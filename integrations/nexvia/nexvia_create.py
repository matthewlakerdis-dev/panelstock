"""Prepare and submit one no-PDF request using fresh native Nexvia allocations.

Preparation opens an unsaved form only. Submission requires its exact hash and
an exclusive durable attempt record; an uncertain attempt is never retried.
"""

import argparse
import copy
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
import uuid

from nexvia_allocations import native_line_editor, allocation_from_native, build_lines, validate_allocation_lines
from nexvia_lookups import account_tax_for_editor


BASE = "https://lennox.nexvia.com.au"
CONFIG_ROOT = Path("/config")
ROOT = CONFIG_ROOT / "nexvia-requests"
READ_METHODS = {"GET", "HEAD", "OPTIONS"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def save(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


def read_json(path):
    with Path(path).open() as stream:
        return json.load(stream)


def one(fields, name):
    values = [value for key, value in fields if key == name]
    require(len(values) == 1, "Missing or duplicate prepared form field: " + name)
    return values[0]


def replace(fields, name, value):
    return [[key, item] for key, item in fields if key != name] + [[name, str(value)]]


def refresh_and_validate(request, context, config_root=CONFIG_ROOT):
    """Refresh live choices, then validate without importing the local server."""
    require(request.get("quote") is None, "PDF submission is not enabled; no PO submitted.")
    refreshed = subprocess.run(
        [sys.executable, str(config_root / "nexvia_form_data.py"), "--project",
         str(int(request["projectPageId"]))],
        stdin=subprocess.DEVNULL, capture_output=True, timeout=90, check=False)
    require(refreshed.returncode == 0, "Could not refresh Nexvia choices; check sign-in.")
    lookup = read_json(config_root / "nexvia-form-data.json")
    from nexvia_form_data import validate_request
    validate_request(request, lookup, context)
    return lookup


def prepare(context, request, folder, config_root=CONFIG_ROOT):
    lookup = refresh_and_validate(request, context, config_root)
    with native_line_editor(context, request) as editor:
        # Capture the blank native allocation and form before activating the
        # finance editors. Their own live data sources belong to this exact
        # supplier, service, project and EOW context.
        allocation = allocation_from_native(request, editor)
        fields = copy.deepcopy(editor["fields"])
        create_path = editor["createPath"]
        finance = account_tax_for_editor(editor["page"])
        current_lookup = {**lookup, "accounts": [row for row in finance["accounts"]
                          if row.get("type") == "Cost of Goods Sold"], "taxes": finance["taxes"]}
        lines = build_lines(request, allocation, current_lookup)
    # Only the immutable request's lines and order date are added to the fresh
    # native form. All email, approval, stock and relocation actions stay off.
    fields = [[key, value] for key, value in fields
              if key not in {"form[Files][]", "form[TaxInclusive]"}]
    for name, value in (
        ("Lines", json.dumps(lines, allow_nan=False)), ("Print", "false"),
        ("Email", "false"), ("Outlook", "false"), ("MarkSent", "false"),
        ("Stock", "false"), ("EditStock", "false"), ("Approve", ""),
        ("SubmitForApproval", ""), ("ContinueEdit", "true"), ("NewJobId", ""),
        ("NewJobMoveLines", ""), ("Comment", "Request reference: " + request["reference"]),
    ):
        fields = replace(fields, "form[" + name + "]", value)
    ordered = date.fromisoformat(request["date"])
    for part in ("day", "month", "year"):
        fields = replace(fields, "form[OrderedDate][" + part + "]", getattr(ordered, part))
    prepared = {
        "requestHash": digest(request), "reference": request["reference"],
        "projectPageId": request["projectPageId"], "jobId": allocation["jobId"],
        "createPath": create_path, "fields": fields, "allocation": allocation,
        "totalCents": request["totalCents"], "preparedAt": datetime.now(timezone.utc).isoformat(),
    }
    prepared["preparedHash"] = digest(prepared)
    validate_prepared(prepared, request, prepared["preparedHash"])
    save(Path(folder) / "nexvia-prepared.json", prepared)
    return prepared


def validate_prepared(prepared, request, submitted_hash, now=None):
    require(isinstance(prepared, dict) and isinstance(request, dict), "Invalid prepared request.")
    expected = prepared.get("preparedHash")
    unsigned = {key: value for key, value in prepared.items() if key != "preparedHash"}
    require(isinstance(expected, str) and re.fullmatch(r"[a-f0-9]{64}", expected)
            and digest(unsigned) == expected == submitted_hash,
            "Preparation hash mismatch.")
    require(request.get("quote") is None and prepared.get("requestHash") == digest(request)
            and prepared.get("reference") == request.get("reference")
            and prepared.get("projectPageId") == request.get("projectPageId")
            and prepared.get("totalCents") == request.get("totalCents"),
            "Request changed after preparation.")
    try:
        timestamp = datetime.fromisoformat(str(prepared.get("preparedAt", "")).replace("Z", "+00:00"))
        age = ((now or datetime.now(timezone.utc)) - timestamp).total_seconds()
    except (ValueError, TypeError) as error:
        raise ValueError("Preparation timestamp is invalid.") from error
    require(0 <= age <= 900, "Preparation expired; prepare again.")
    destination = urlsplit(str(prepared.get("createPath", "")))
    require(not destination.scheme and not destination.netloc and not destination.fragment
            and destination.path == "/staff/project-purchase-order-add/" + str(request["projectPageId"])
            and parse_qs(destination.query, keep_blank_values=True) == {
                "type": ["Assembly"], "service": [str(request["serviceId"])],
                "client": [str(request["supplierId"])],
                "breakdown_type": [request["breakdownType"]]},
            "Prepared destination does not match the request.")
    fields = prepared.get("fields")
    require(isinstance(fields, list) and all(isinstance(pair, list) and len(pair) == 2
            and all(isinstance(item, str) for item in pair) for pair in fields),
            "Prepared form fields are invalid.")
    get = lambda name: one(fields, "form[" + name + "]")
    require(get("ServiceId") == str(request["serviceId"]) and get("CurrencyId") == "8"
            and get("Comment") == "Request reference: " + request["reference"],
            "Prepared form identity changed.")
    for name in ("Print", "Email", "Outlook", "MarkSent", "Stock", "EditStock"):
        require(get(name) == "false", "Unexpected prepared form action.")
    for name in ("Approve", "SubmitForApproval", "NewJobId", "NewJobMoveLines"):
        require(get(name) == "", "Unexpected prepared approval or relocation action.")
    require(get("ContinueEdit") == "true" and not any(
        key in {"form[Files][]", "form[TaxInclusive]"} for key, _value in fields),
        "Unexpected prepared attachment or tax action.")
    ordered = date.fromisoformat(request["date"])
    for part in ("day", "month", "year"):
        require(get("OrderedDate][" + part) == str(getattr(ordered, part)),
                "Prepared order date changed.")
    try:
        lines = json.loads(get("Lines"))
    except (TypeError, ValueError) as error:
        raise ValueError("Prepared lines are invalid.") from error
    allocation = prepared.get("allocation")
    validate_allocation_lines(lines, request, allocation)
    for evidence in allocation["eowProof"]:
        if evidence["source"] == "form":
            require(one(fields, evidence["field"]) == request["breakdownType"],
                    "Prepared native EOW form identity changed.")
    require(prepared.get("jobId") == allocation["jobId"], "Prepared job allocation changed.")
    for actual, source in zip(lines, request["lines"]):
        require(actual.get("id") is None and actual.get("is_new") is True,
                "Prepared lines are not unsaved native lines.")
        validate_line_content(actual, source)
    return lines


def decimal_equal(actual, expected):
    try:
        return not isinstance(actual, bool) and Decimal(str(actual)).is_finite() and \
            Decimal(str(actual)) == Decimal(str(expected))
    except (TypeError, ValueError, ArithmeticError):
        return False


def validate_line_content(actual, source):
    require(isinstance(actual, dict)
            and actual.get("item_description") == source["description"]
            and str(actual.get("chart_of_account_id")) == str(source["chartOfAccountId"])
            and str(actual.get("tax_rate_id")) == str(source["taxRateId"])
            and decimal_equal(actual.get("qty"), source["quantity"])
            and decimal_equal(actual.get("unit_price"), source["unitPriceExGst"]),
            "Saved line content does not match the request.")


def verify(context, location, request, prepared, folder):
    path = urlsplit(urljoin(BASE, location))
    require(path.scheme == "https" and path.netloc == "lennox.nexvia.com.au"
            and not path.fragment and not path.query and re.fullmatch(
                r"/staff/project-purchase-order-modify/" + str(prepared["projectPageId"]) + r"/\d+", path.path),
            "Unexpected creation redirect; inspect the private response before any retry.")
    order_id = int(path.path.rsplit("/", 1)[1])
    page = context.new_page()
    page.route("**/*", lambda route: route.continue_() if route.request.method in READ_METHODS else route.abort())
    try:
        page.goto(BASE + path.path, wait_until="domcontentloaded", timeout=45000)
        require(urlsplit(page.url).path == path.path and urlsplit(page.url).netloc == "lennox.nexvia.com.au",
                "Saved order redirected; do not retry.")
        page.locator('[name="form[Lines]"]').wait_for(state="attached", timeout=20000)
        result = page.evaluate(r'''() => {
          const get = name => document.getElementsByName(name)[0]?.value;
          return {text: document.body.innerText,
            lines: JSON.parse(get('form[Lines]') || '[]'),
            service: get('form[ServiceId]'), comment: get('form[Comment]')};
        }''')
        numbers = set(re.findall(r"Purchase Order\s*#\s*(PO\d+)", result["text"], re.I))
        require(len(numbers) == 1, "Could not identify the saved PO number; do not retry.")
        require(result["service"] == str(request["serviceId"]), "Saved service mismatch.")
        require(result.get("comment") == "Request reference: " + request["reference"],
                "Saved request reference mismatch.")
        validate_allocation_lines(result["lines"], request, prepared["allocation"], saved=True)
        expected_lines = json.loads(one(prepared["fields"], "form[Lines]"))
        for actual, source, expected in zip(result["lines"], request["lines"], expected_lines):
            require(actual.get("id") is not None and str(actual["id"]).isdigit()
                    and int(actual["id"]) > 0, "Saved line identity missing.")
            if "job_purchase_order_id" in actual:
                owner = actual["job_purchase_order_id"]
                require(not isinstance(owner, bool) and isinstance(owner, (int, str))
                        and str(owner).isdigit() and int(owner) == order_id,
                        "Saved line purchase-order owner mismatch.")
            validate_line_content(actual, source)
            for field in ("tax_rate", "amount", "curr_amount", "unit_price"):
                require(decimal_equal(actual.get(field), expected.get(field)),
                        "Saved line amount or tax rate mismatch.")
        saved = {
            "state": "CREATED_VERIFIED", "requestReference": request["reference"],
            "projectPageId": prepared["projectPageId"], "jobId": prepared["jobId"],
            "purchaseOrderId": order_id,
            "purchaseOrderNumber": next(iter(numbers)).upper(), "url": BASE + path.path,
            "totalCents": request["totalCents"], "requestorEmailSent": False,
            "verifiedAt": datetime.now(timezone.utc).isoformat(),
        }
        save(Path(folder) / "nexvia-result.json", saved)
        return saved
    finally:
        page.close()


def begin_attempt(folder, request):
    journal = Path(folder) / "nexvia-create-attempt.json"
    try:
        descriptor = os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise ValueError("Attempt already exists. Reconcile in Nexvia; do not retry.") from error
    with os.fdopen(descriptor, "w") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump({"state": "SUBMISSION_STARTED", "reference": request["reference"]}, stream)
        stream.flush()
        os.fsync(stream.fileno())
    descriptor = os.open(journal.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return journal


def submit(context, request, prepared, folder, submitted_hash):
    validate_prepared(prepared, request, submitted_hash)
    encoded_form = urlencode([(key, value) for key, value in prepared["fields"]]).encode()
    journal = begin_attempt(folder, request)
    # Any timeout or crash after the durable attempt requires reconciliation.
    response = context.request.post(
        BASE + prepared["createPath"], data=encoded_form,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Origin": BASE,
                 "Referer": BASE + prepared["createPath"]}, max_redirects=0, timeout=60000)
    response_file = Path(folder) / "nexvia-create-response.html"
    descriptor = os.open(response_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(response.body())
        stream.flush()
        os.fsync(stream.fileno())
    location = response.headers.get("location", "")
    save(journal, {"state": "RESPONSE_RECEIVED", "status": response.status,
                   "location": location, "reference": request["reference"]})
    require(response.status in (302, 303) and location,
            "Creation response needs review. Do not retry.")
    return verify(context, location, request, prepared, folder)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, help="Saved request UUID")
    parser.add_argument("--submit", metavar="PREPARED_HASH", help="Authorise this exact preparation")
    args = parser.parse_args(argv)
    folder = ROOT / str(uuid.UUID(args.request))
    request = read_json(folder / "request.json")
    existing = folder / "nexvia-result.json"
    if existing.exists():
        result = read_json(existing)
        require(result.get("state") == "CREATED_VERIFIED"
                and result.get("requestReference") == request["reference"]
                and result.get("projectPageId") == request["projectPageId"]
                and result.get("totalCents") == request["totalCents"], "Result needs review.")
        print(json.dumps(result))
        return
    require(not (folder / "nexvia-create-attempt.json").exists(),
            "Attempt already exists. Reconcile in Nexvia; do not retry.")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
        context = next((context for context in browser.contexts if any(
            page.url.startswith(BASE + "/staff/") and "/login" not in page.url
            for page in context.pages)), None)
        require(context is not None, "Sign into Nexvia first.")
        if not args.submit:
            prepared = prepare(context, request, folder)
            print(json.dumps({"state": "PREPARED", "reference": request["reference"],
                              "totalCents": request["totalCents"], "jobId": prepared["jobId"],
                              "preparedHash": prepared["preparedHash"]}))
        else:
            print(json.dumps(submit(context, request, read_json(folder / "nexvia-prepared.json"),
                                   folder, args.submit)))


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(json.dumps({"error": "Nexvia operation failed; inspect the private request folder before retrying."}),
              file=sys.stderr)
        sys.exit(1)
