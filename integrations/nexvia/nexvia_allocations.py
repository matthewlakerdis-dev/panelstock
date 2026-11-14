"""Capture and preserve Nexvia's native allocation for a purchase request.

Nothing here submits a purchase order. The browser page is an isolated, unsaved
new-order form and all non-read HTTP methods are blocked while defaults are read.
EOW IDs are opaque: no category, assembly or budget ID is inferred from a suffix.
"""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from contextlib import contextmanager
import copy
import json
import re
from urllib.parse import urlencode, urlsplit
import uuid


BASE = "https://lennox.nexvia.com.au"
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
MAX_QUOTE_BYTES = 10 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def positive_id(value):
    return not isinstance(value, bool) and str(value).isdigit() and int(value) > 0


def quote_attachment_descriptor(request, quote_attachment=None):
    """Authorize quote metadata for read-only validation, never an upload.

    Callers handling the managed quote protocol must verify its private source
    separately. Existing local-form callers have no opt-in and still reject PDFs.
    """
    require(isinstance(request, dict), "Invalid quote request context.")
    quote = request.get("quote")
    if quote is None:
        require(quote_attachment is None, "Unexpected quote attachment context.")
        return None
    require(isinstance(quote_attachment, dict) and quote_attachment == quote
            and set(quote_attachment) == {"filename", "bytes", "sha256"},
            "Quote attachment context is missing or does not match the request.")
    filename = quote_attachment.get("filename")
    require(isinstance(filename, str) and 0 < len(filename) <= 180
            and filename == filename.strip() and filename.lower().endswith(".pdf")
            and not re.search(r"[\\/\x00-\x1f\x7f]", filename),
            "Quote attachment filename is invalid.")
    require(type(quote_attachment.get("bytes")) is int
            and 5 <= quote_attachment["bytes"] <= MAX_QUOTE_BYTES
            and isinstance(quote_attachment.get("sha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", quote_attachment["sha256"]),
            "Quote attachment size or checksum is invalid.")
    return dict(quote_attachment)


def context_values(request, *, quote_attachment=None):
    require(isinstance(request, dict) and (request.get("quote") is None or quote_attachment is not None),
            "Only a purchase request without a PDF can use native allocation capture.")
    quote_attachment_descriptor(request, quote_attachment)
    project = request.get("projectPageId")
    require(type(project) is int and project > 0, "Invalid project identity.")
    supplier, service = str(request.get("supplierId", "")), str(request.get("serviceId", ""))
    require(positive_id(supplier) and positive_id(service), "Invalid supplier or service identity.")
    breakdown = request.get("breakdownType")
    require(isinstance(breakdown, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", breakdown),
            "Invalid element-of-work identity.")
    return project, supplier, service, breakdown


NATIVE_STATE = r"""(attachment = null) => {
  const forms = [...document.forms].filter(form => {
    const target = new URL(form.action, location.href);
    return target.origin === location.origin && target.pathname === location.pathname &&
      form.querySelector('[name="form[Lines]"]');
  });
  if (forms.length !== 1) throw Error('Expected one unsaved purchase-order form');
  const form = forms[0], fields = [], data = [...new FormData(form).entries()];
  let fileControl = null, selectedFile = null, rawFiles = 0;
  if (attachment !== null) {
    const ids = data.filter(([name, value]) => name === 'form[Files][]' && typeof value === 'string')
      .map(([,value]) => value);
    if (!attachment || !Array.isArray(attachment.nativeFileIds) || attachment.nativeFileIds.length !== 1 ||
        !Number.isSafeInteger(attachment.nativeFileIds[0]) || attachment.nativeFileIds[0] <= 0 ||
        ids.length !== 1 || ids[0] !== String(attachment.nativeFileIds[0]))
      throw Error('Verified native quote identity changed');
    const inputs = [...form.querySelectorAll('input[type="file"]')];
    if (inputs.length !== 1 || inputs[0].files.length > 1) throw Error('Unexpected native attachment input');
    fileControl = inputs[0];
    selectedFile = fileControl.files[0] || null;
    if (selectedFile && (selectedFile.name !== attachment.filename || selectedFile.size !== attachment.bytes))
      throw Error('Verified native quote input changed');
  }
  for (const [name, value] of data) {
    if (typeof value !== 'string') {
      if (value.size && (!fileControl || !selectedFile || name !== fileControl.name ||
          value.name !== attachment.filename || value.size !== attachment.bytes || ++rawFiles !== 1))
        throw Error('Unexpected native attachment');
      continue;
    }
    fields.push([name, value]);
  }
  const flatten = columns => columns.flatMap(column => [column, ...flatten(column.columns || [])]);
  const grids = [...new Set([...form.querySelectorAll('[data-role="grid"],.k-grid')]
    .map(element => window.jQuery && window.jQuery(element).data('kendoGrid')).filter(Boolean))];
  const exact = grids.filter(grid => flatten(grid.columns || []).some(column =>
    column.field === 'item_description'));
  const candidates = exact.length ? exact : grids.filter(grid => flatten(grid.columns || []).some(column =>
    /^description$/i.test(String(column.title || '').replace(/<[^>]*>/g, '').trim())));
  if (candidates.length !== 1) throw Error('Expected one native purchase-order lines grid');
  const grid = candidates[0];
  if (!grid.dataSource || typeof grid.dataSource.data !== 'function') throw Error('Native lines unavailable');
  const rows = Array.from(grid.dataSource.data()).map(row =>
    JSON.parse(JSON.stringify(typeof row.toJSON === 'function' ? row.toJSON() : row)));
  const bindings = flatten(grid.columns || []).filter(column => column.field &&
    /breakdown|element\s*of\s*work|\beow\b/i.test(String(column.title || '').replace(/<[^>]*>/g, '')))
    .map(column => ({field: column.field, title: String(column.title || '')}));
  return {fields, rows, bindings};
}"""


def uploaded_native_state(page, request, create_path, receipt):
    """Resnapshot only a quote already proven by the native upload module.

    Raw selected files never enter the URL-encoded create POST. A populated
    input is omitted only after its exact durable receipt and hidden ID agree.
    """
    from nexvia_quote_attachment import validate_receipt, file_ids_from_fields, receipt_fields
    verified = validate_receipt(receipt, request, create_path)
    destination = urlsplit(page.url)
    expected = urlsplit(create_path)
    require(destination.scheme == "https" and destination.netloc == "lennox.nexvia.com.au"
            and not destination.fragment and destination.path == expected.path
            and destination.query == expected.query, "Uploaded native form context changed.")
    metadata = verified["quote"]
    snapshot = page.evaluate(NATIVE_STATE, {"filename": metadata["filename"], "bytes": metadata["bytes"],
                                           "nativeFileIds": verified["nativeFileIds"]})
    require(isinstance(snapshot, dict) and file_ids_from_fields(snapshot.get("fields")) == verified["nativeFileIds"]
            and [row for row in snapshot["fields"] if row[0] == "form[Files][]"] == receipt_fields(verified),
            "Uploaded native form identity changed.")
    return snapshot


NATIVE_ADD = r"""() => {
  const buttons = [...document.querySelectorAll('a,button,td,div,span')]
    .filter(element => element.offsetParent && element.textContent.trim().endsWith('Click To Add New Row'))
    .sort((left, right) => left.textContent.length - right.textContent.length);
  if (!buttons.length) throw Error('Nexvia native add-row control unavailable');
  const target = buttons[0].closest('td') || buttons[0];
  target.click();
}"""


def one(fields, name):
    values = [value for key, value in fields if key == name]
    require(len(values) == 1, "Missing or ambiguous native form field: " + name)
    return values[0]


def _field_value(row, path):
    current = row
    for key in path.split("."):
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def _has_field(row, path):
    current = row
    for key in path.split("."):
        if not isinstance(current, dict) or key not in current:
            return False
        current = current[key]
    return True


def _scalar_identity(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (str, int)):
        return str(value)
    if isinstance(value, dict):
        found = {_scalar_identity(value[key]) for key in ("id", "value", "key") if key in value}
        found.discard(None)
        return next(iter(found)) if len(found) == 1 else None
    return None


def _allocation_field(name):
    # This is the saved line's parent purchase-order FK, not its EOW/job link.
    if name == "job_purchase_order_id":
        return False
    if not re.search(r"project|job|budget|category|assembly|breakdown|element|eow|tender", name, re.I):
        return False
    if re.search(r"(?:_id|Id)$", name):
        return True
    return not re.search(r"name|label|text|description|amount|cost|quantity|qty|total|rate|percent", name, re.I)


def _temporary_draft_id(value):
    if not isinstance(value, str) or len(value) > 160 or re.search(r"[\x00-\x1f\x7f]", value):
        return False
    try:
        Decimal(value.strip())
    except InvalidOperation:
        return not re.fullmatch(r"[+-]?0(?:x[0-9a-f]+|o[0-7]+|b[01]+)", value.strip(), re.I)
    # Numeric strings, including signed/decimal/exponent and nonfinite forms,
    # are never accepted as a new native temporary identifier.
    return False


def allocation_from_native(request, snapshot, *, quote_attachment=None):
    project, supplier, service, breakdown = context_values(request, quote_attachment=quote_attachment)
    require(isinstance(snapshot, dict) and isinstance(snapshot.get("fields"), list)
            and isinstance(snapshot.get("rows"), list) and len(snapshot["rows"]) == 1,
            "Exactly one native draft line is required.")
    fields, template = snapshot["fields"], copy.deepcopy(snapshot["rows"][0])
    require(all(isinstance(pair, list) and len(pair) == 2 and all(isinstance(item, str) for item in pair)
                for pair in fields), "Invalid native form fields.")
    require(isinstance(template, dict) and template.get("is_new") is True
            and not str(template.get("item_description") or "").strip()
            and template.get("job_purchase_order_id") in (None, ""),
            "Native allocation must come from a blank unsaved line.")
    draft_metadata = {}
    identifier = template.get("id")
    if identifier is not None:
        proof = snapshot.get("nativeNewRowProof")
        require(_temporary_draft_id(identifier) and isinstance(proof, dict)
                and proof.get("startedEmpty") is True and proof.get("addedByNativeControl") is True,
                "Native draft identity requires a proven new row from the native control.")
        draft_metadata = {"nativeDraftId": {"kind": "string", "length": len(identifier)},
                          "nativeNewRowProof": {"startedEmpty": True, "addedByNativeControl": True}}
        template["id"] = None
    require(one(fields, "form[ServiceId]") == service and one(fields, "form[CurrencyId]") == "8",
            "Native service or AUD currency does not match the request.")
    require(str(template.get("currency_id")) == "8" and template.get("curr_alpha3") == "AUD"
            and _decimal(template.get("curr_rate"), "native exchange rate") == Decimal(1),
            "Native line must use AUD at its base exchange rate.")
    require(template.get("breakdown_type") in (None, "", breakdown),
            "Native line EOW conflicts with the selected EOW identity.")

    proof = []
    if _scalar_identity(template.get("breakdown_type")) == breakdown:
        proof.append({"source": "line", "field": "breakdown_type"})
    for binding in snapshot.get("bindings", []):
        if isinstance(binding, dict) and isinstance(binding.get("field"), str):
            field = binding["field"]
            if _scalar_identity(_field_value(template, field)) == breakdown:
                proof.append({"source": "line", "field": field})
    for name, value in fields:
        if re.search(r"breakdown|elementofwork|eow", name, re.I) and value == breakdown:
            proof.append({"source": "form", "field": name})
    require(proof, "Nexvia did not expose the selected EOW identity; allocation needs review.")

    native_jobs = {key: template.get(key) for key in ("job_id", "default_job_id")}
    jobs = {int(value) for value in native_jobs.values() if positive_id(value)}
    require(len(jobs) == 1 and all(not isinstance(value, bool) and
                                 (value in (None, "", 0, "0") or positive_id(value))
                                 for value in native_jobs.values()),
            "Native EOW job allocation is missing or ambiguous.")
    job = next(iter(jobs))
    template["job_id"] = job
    template["default_job_id"] = job
    allocation_fields = {key: copy.deepcopy(value) for key, value in template.items() if _allocation_field(key)}
    for evidence in proof:
        if evidence["source"] == "line":
            field = evidence["field"]
            allocation_fields[field] = copy.deepcopy(_field_value(template, field))
    require(any(key not in ("job_id", "default_job_id") and value not in (None, "", 0, "0")
                for key, value in allocation_fields.items()), "Native EOW allocation links are missing.")
    return {
        "version": 2, "projectPageId": project, "supplierId": supplier, "serviceId": service,
        "breakdownType": breakdown, "jobId": job, "nativeJobFields": native_jobs,
        "template": template, "allocationFields": allocation_fields,
        "eowProof": proof, "capturedAt": datetime.now(timezone.utc).isoformat(),
        **draft_metadata,
    }


def prepare_native_row(page, request, *, quote_attachment=None):
    """Initialize only a native draft row; caller owns and closes the page.

    Live dropdown readers reuse this step before allocation proof is validated.
    """
    project, supplier, service, breakdown = context_values(request, quote_attachment=quote_attachment)
    create_path = f"/staff/project-purchase-order-add/{project}?" + urlencode({
        "type": "Assembly", "service": service, "client": supplier, "breakdown_type": breakdown,
    })
    def read_guard(route):
        allowed = route.request.method in READ_METHODS
        if allowed and quote_attachment is not None:
            destination = urlsplit(route.request.url)
            # Upload registration is a mutation despite using GET. It is
            # available only while the uploader's stricter one-use guard owns
            # the page; restoring this guard must close that capability.
            if destination.hostname == "lennox.nexvia.com.au" and (
                    destination.path == "/staff/upload/details"
                    or destination.path.startswith("/staff/upload/details/")):
                allowed = False
        route.continue_() if allowed else route.abort()

    page.route("**/*", read_guard)
    page.goto(BASE + create_path, wait_until="domcontentloaded", timeout=45000)
    destination = urlsplit(page.url)
    require(destination.scheme == "https" and destination.netloc == "lennox.nexvia.com.au"
            and destination.path == create_path.split("?", 1)[0]
            and destination.query == create_path.split("?", 1)[1],
            "Native new-order form redirected or changed request context.")
    page.wait_for_function("() => {try { return (" + NATIVE_STATE + ")().rows.length <= 1; } catch { return false; }}", timeout=20000)
    before = page.evaluate(NATIVE_STATE)
    require(json.loads(one(before["fields"], "form[Lines]")) == [],
            "The new-order form already contains serialized lines.")
    native_added = False
    if not before["rows"]:
        page.evaluate(NATIVE_ADD)
        page.wait_for_function("() => {try { return (" + NATIVE_STATE + ")().rows.length === 1; } catch { return false; }}", timeout=15000)
        native_added = True
    result = {**page.evaluate(NATIVE_STATE), "createPath": create_path}
    if native_added:
        require(len(result["rows"]) == 1, "Exactly one native draft line is required.")
        result["nativeNewRowProof"] = {"startedEmpty": True, "addedByNativeControl": True}
    return result


@contextmanager
def native_line_editor(context, request, *, quote_attachment=None):
    """Yield a read-only native blank-line editor for allocation and lookups."""
    page = context.new_page()
    try:
        snapshot = prepare_native_row(page, request, quote_attachment=quote_attachment)
        require(len(snapshot["rows"]) == 1, "Exactly one native draft line is required.")
        yield {**snapshot, "page": page, "nativeTemplate": snapshot["rows"][0]}
    finally:
        page.close()


def capture_native_form(context, request, *, quote_attachment=None):
    with native_line_editor(context, request, quote_attachment=quote_attachment) as editor:
        allocation = allocation_from_native(request, editor, quote_attachment=quote_attachment)
        return {"fields": editor["fields"], "nativeTemplate": allocation["template"],
                "allocation": allocation, "createPath": editor["createPath"]}


def _decimal(value, label, positive=False):
    require(not isinstance(value, bool) and isinstance(value, (str, int, float, Decimal)), "Invalid " + label)
    try:
        result = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError("Invalid " + label) from error
    require(result.is_finite() and (result > 0 if positive else result >= 0)
            and result <= Decimal("1000000000"), "Invalid " + label)
    return result


def _id_value(value):
    return int(value) if str(value).isdigit() else str(value)


def _lookup_choice(rows, identifier, label):
    require(isinstance(rows, list), "Missing current " + label + " choices.")
    matches = [row for row in rows if isinstance(row, dict) and str(row.get("id")) == str(identifier)]
    require(len(matches) == 1 and matches[0].get("disabled") is not True, "Invalid current " + label + " choice.")
    return matches[0]


def _validate_context(request, allocation, *, quote_attachment=None):
    project, supplier, service, breakdown = context_values(request, quote_attachment=quote_attachment)
    require(isinstance(allocation, dict) and allocation.get("version") == 2
            and allocation.get("projectPageId") == project and allocation.get("supplierId") == supplier
            and allocation.get("serviceId") == service and allocation.get("breakdownType") == breakdown
            and positive_id(allocation.get("jobId")) and isinstance(allocation.get("template"), dict)
            and isinstance(allocation.get("allocationFields"), dict) and allocation.get("eowProof"),
            "Native allocation does not match the immutable purchase request.")
    proof = allocation["eowProof"]
    require(isinstance(proof, list) and all(isinstance(item, dict)
            and item.get("source") in {"line", "form"}
            and isinstance(item.get("field"), str) and 0 < len(item["field"]) <= 300
            for item in proof), "Native EOW allocation proof is invalid.")
    expected_fields = {field: value for field, value in allocation["template"].items()
                       if _allocation_field(field)}
    for evidence in proof:
        if evidence["source"] == "line":
            field = evidence["field"]
            require(field in allocation["allocationFields"]
                    and _scalar_identity(allocation["allocationFields"][field]) == breakdown
                    and _has_field(allocation["template"], field)
                    and _same_identity(_field_value(allocation["template"], field),
                                       allocation["allocationFields"][field]),
                    "Native EOW line identity proof is invalid.")
            expected_fields[field] = _field_value(allocation["template"], field)
    require(set(allocation["allocationFields"]) == set(expected_fields)
            and all(_same_identity(allocation["allocationFields"][field], value)
                    for field, value in expected_fields.items()),
            "Native allocation proof omits or changes an allocation field.")


def build_lines(request, allocation, lookup, *, quote_attachment=None):
    _validate_context(request, allocation, quote_attachment=quote_attachment)
    require(isinstance(lookup, dict) and lookup.get("projectPageId") == request["projectPageId"],
            "Current choices belong to another project.")
    sources = request.get("lines")
    require(isinstance(sources, list) and 1 <= len(sources) <= 200, "Enter between 1 and 200 lines.")
    output, subtotal, tax = [], 0, 0
    for source in sources:
        require(isinstance(source, dict) and source.get("breakdownType") == request["breakdownType"]
                and isinstance(source.get("description"), str) and source["description"].strip(),
                "Request line EOW or description is invalid.")
        quantity = _decimal(source.get("quantity"), "quantity", positive=True)
        price = _decimal(source.get("unitPriceExGst"), "unit price")
        _lookup_choice(lookup.get("accounts"), source.get("chartOfAccountId"), "COS account")
        tax_choice = _lookup_choice(lookup.get("taxes"), source.get("taxRateId"), "tax")
        rate = _decimal(tax_choice.get("rate"), "tax rate")
        require(rate <= 100, "Invalid current tax rate.")
        amount = int((quantity * price).quantize(Decimal(".01"), rounding=ROUND_HALF_UP) * 100)
        subtotal += amount
        tax += int((Decimal(amount) * rate / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        row = copy.deepcopy(allocation["template"])
        row.update(id=None, is_new=True, uid=str(uuid.uuid4()), item_description=source["description"],
                   supplier_reference=request.get("supplierReference") or None, qty=float(quantity),
                   unit_price=float(price), amount=amount / 100, amount_inc=amount / 100,
                   chart_of_account_id=_id_value(source["chartOfAccountId"]), chart_of_account_name="",
                   chart_of_account_id_input="", tax_rate_id=_id_value(source["taxRateId"]), tax_rate=float(rate),
                   qty_received=0, qty_received_modified=False, received=None, comments=None, contractor_comments=None,
                   curr_converted_cost=float(price), curr_cost=float(price), curr_base_cost=float(price),
                   curr_amount=amount / 100, curr_amount_inc=amount / 100)
        output.append(row)
    require((subtotal, tax, subtotal + tax) == (request.get("subtotalCents"), request.get("taxCents"), request.get("totalCents")),
            "Saved request totals differ from current native choices.")
    validate_allocation_lines(output, request, allocation, quote_attachment=quote_attachment)
    return output


def _same_identity(actual, expected):
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is type(expected) and actual == expected
    if actual is None or expected is None:
        return actual is expected
    if isinstance(actual, (str, int)) and isinstance(expected, (str, int)):
        return str(actual) == str(expected)
    return actual == expected


def validate_allocation_lines(lines, request, allocation, *, saved=False, quote_attachment=None):
    _validate_context(request, allocation, quote_attachment=quote_attachment)
    require(isinstance(lines, list) and len(lines) == len(request.get("lines", [])),
            "Native allocation line count changed.")
    for line in lines:
        require(isinstance(line, dict), "Native allocation line is invalid.")
        native_keys = {key for key in allocation["template"] if _allocation_field(key)}
        actual_keys = {key for key in line if _allocation_field(key)}
        if saved:
            require(native_keys <= actual_keys and all(
                line[field] is None or isinstance(line[field], str) and line[field] == ""
                for field in actual_keys - native_keys),
                "Native allocation field set changed.")
        else:
            require(actual_keys == native_keys, "Native allocation field set changed.")
            require(line.get("job_purchase_order_id") in (None, ""),
                    "Unsaved line already has a purchase-order owner.")
        require(line.get("breakdown_type") in (None, "", allocation["breakdownType"]),
                "Native allocation changed: breakdown_type")
        for field, expected in allocation["allocationFields"].items():
            require(_has_field(line, field) and _same_identity(_field_value(line, field), expected),
                    "Native allocation changed: " + field)
        require(str(line.get("currency_id")) == "8" and line.get("curr_alpha3") == "AUD"
                and _decimal(line.get("curr_rate"), "saved exchange rate") == Decimal(1),
                "Native allocation currency changed.")
