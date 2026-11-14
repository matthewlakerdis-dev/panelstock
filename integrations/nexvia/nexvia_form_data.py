#!/usr/bin/env python3
"""Read current Nexvia purchase-request choices without submitting a PO."""

import argparse
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile

BASE = "https://lennox.nexvia.com.au"
CONFIG = Path("/config")
MAX_SNAPSHOT_AGE = 600


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Services(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.option = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "select":
            self.active = attributes.get("id") == "form_Service"
        elif tag == "option" and self.active:
            self.option = {"id": attributes.get("value"), "name": "",
                           "disabled": "disabled" in attributes}

    def handle_data(self, text):
        if self.option is not None:
            self.option["name"] += text

    def handle_endtag(self, tag):
        if tag == "option" and self.option is not None:
            self.option["name"] = self.option["name"].strip()
            if self.option["id"] and self.option["name"]:
                self.rows.append(self.option)
            self.option = None
        elif tag == "select":
            self.active = False


def modal_choices(source):
    require(isinstance(source, str), "Nexvia returned an invalid choice form.")
    parser = Services()
    parser.feed(source)
    target = re.search(
        r'<select\b[^>]*\bid=["\']form_BreakdownType["\'][^>]*>'
        r'.*?</select>\s*</div>\s*<script\b[^>]*>(.*?)</script>',
        source, re.DOTALL | re.IGNORECASE,
    )
    breakdowns = []
    if target:
        decoder = json.JSONDecoder()
        for match in re.finditer(r"var\s+options\s*=\s*", target.group(1)):
            try:
                widget, _ = decoder.raw_decode(target.group(1)[match.end():])
                choices = widget.get("choices")
                if isinstance(choices, list) and choices:
                    breakdowns = choices
                    break
            except (ValueError, AttributeError):
                continue
    services = normalize_choices(parser.rows)
    breakdowns = normalize_choices(breakdowns)
    require(services and breakdowns, "Service/EOW choices are incomplete; check Nexvia access.")
    return services, breakdowns


def normalize_choices(rows, label="name"):
    require(isinstance(rows, list) and len(rows) <= 10000, "Invalid Nexvia choice list.")
    output, seen = [], set()
    for row in rows:
        require(isinstance(row, dict), "Invalid Nexvia choice.")
        identity = row.get("id")
        require(not isinstance(identity, bool) and isinstance(identity, (str, int))
                and 0 < len(str(identity)) <= 160 and str(identity) not in seen,
                "Invalid or duplicated Nexvia choice identity.")
        name = row.get(label)
        require(isinstance(name, str) and name.strip() and len(name) <= 500,
                "Invalid Nexvia choice name.")
        disabled = row.get("disabled", False)
        require(type(disabled) in (bool, int, str, type(None))
                and disabled in (True, False, 0, 1, "0", "1", "true", "false", None),
                "Invalid Nexvia choice eligibility.")
        seen.add(str(identity))
        output.append({"id": identity, label: name.strip(),
                       "disabled": disabled in (True, 1, "1", "true")})
    return output


def read_native(context, project, supplier_search=None):
    require(type(project) is int and project > 0, "Invalid Nexvia project.")
    headers = {"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"}
    if supplier_search is None:
        path = (f"/staff/project-purchase-order-new-modal/{project}/Assembly"
                "?force=false&hide_service=false&hide_client=false"
                "&callback=Modals.newPurchaseOrderCallback")
        response = context.request.get(BASE + path, headers=headers,
                                       max_redirects=0, timeout=20000)
    else:
        require(isinstance(supplier_search, str) and len(supplier_search) <= 500,
                "Invalid supplier search.")
        # Existing demonstrated lookup endpoint. This POST only searches
        # contractors; it cannot create or modify a purchase order.
        response = context.request.post(BASE + f"/staff/project/contractors/{project}",
                                        form={"q": supplier_search}, headers=headers,
                                        max_redirects=0, timeout=20000)
    require(response.status == 200, "Nexvia lookup failed; check sign-in and project access.")
    value = response.json()
    require(isinstance(value, dict) and value.get("_success") is True,
            "Nexvia reported a failed lookup.")
    return value


def completed_snapshots(config_root=CONFIG, now=None):
    """Accept only a complete, recent pair from the background refresher."""
    root = Path(config_root)
    suppliers = json.loads((root / "nexvia-supplier-directory.json").read_text())
    finance = json.loads((root / "nexvia-account-tax-lookups.json").read_text())
    require(isinstance(suppliers, dict) and isinstance(finance, dict),
            "Nexvia directory snapshots are invalid.")
    stamp = suppliers.get("refreshedAt")
    require(isinstance(stamp, str) and stamp == finance.get("refreshedAt"),
            "Nexvia directories need a completed refresh.")
    try:
        captured = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        age = ((now or datetime.now(timezone.utc)) - captured).total_seconds()
    except (TypeError, ValueError) as error:
        raise ValueError("Nexvia directory refresh time is invalid.") from error
    require(0 <= age <= MAX_SNAPSHOT_AGE,
            "Nexvia directories are stale; check the background refresher and sign-in.")
    records = suppliers.get("records")
    require(isinstance(records, list) and all(isinstance(row, dict) for row in records)
            and type(suppliers.get("expectedTotal")) is int
            and 0 < suppliers["expectedTotal"] <= 10000
            and len(records) == suppliers["expectedTotal"],
            "Nexvia supplier directory is incomplete.")
    return suppliers, finance


def collect_choices(context, project, supplier_search="", config_root=CONFIG, now=None):
    require(isinstance(supplier_search, str) and len(supplier_search) <= 100,
            "Invalid supplier search.")
    services, breakdowns = modal_choices(read_native(context, project).get("_html"))
    directory, finance = completed_snapshots(config_root, now)
    suppliers = normalize_choices([
        {"id": row.get("id"), "text": row.get("name"), "disabled": row.get("disabled", False)}
        for row in directory["records"]
    ], "text")
    # Preserve the existing COS restriction; IDs and labels come from the
    # native editor each refresh. Tax IDs and percentages remain opaque.
    account_rows = finance.get("accounts")
    require(isinstance(account_rows, list) and all(isinstance(row, dict) for row in account_rows),
            "Nexvia account directory is invalid.")
    accounts = normalize_choices([row for row in account_rows
                                  if row.get("type") == "Cost of Goods Sold"])
    taxes = normalize_choices(finance.get("taxes"))
    for target, source in zip(taxes, finance["taxes"]):
        rate = decimal_value(source.get("rate"))
        require(rate <= 100, "Invalid Nexvia tax percentage.")
        target["rate"] = str(rate)
    require(accounts and taxes, "Nexvia COS/tax choices are incomplete.")
    return {"projectPageId": project, "supplierSearch": supplier_search,
            "services": services, "breakdowns": breakdowns,
            "suppliers": sorted(suppliers, key=lambda row: row["text"].casefold()),
            "accounts": accounts, "taxes": taxes,
            "refreshedAt": datetime.now(timezone.utc).isoformat(),
            "directoryRefreshedAt": directory["refreshedAt"],
            "nexviaSubmissionEnabled": False}


def decimal_value(value, positive=False):
    require(not isinstance(value, bool) and isinstance(value, (str, int, float, Decimal)),
            "Invalid request amount.")
    try:
        result = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError("Invalid request amount.") from error
    require(result.is_finite() and (result > 0 if positive else result >= 0)
            and result <= Decimal("1000000000"), "Invalid request amount.")
    return result


def validate_request(payload, lookup, context, *, quote_attachment=None):
    """Recheck all IDs, totals and current supplier permission before preparing."""
    require(isinstance(payload, dict) and payload.get("testOnly") is True
            and payload.get("nexviaSubmissionEnabled") is False
            and (payload.get("quote") is None or quote_attachment is not None),
            "Unsupported purchase request preparation.")
    from nexvia_allocations import quote_attachment_descriptor
    quote_attachment_descriptor(payload, quote_attachment)
    project = payload.get("projectPageId")
    require(type(project) is int and project > 0 and lookup.get("projectPageId") == project,
            "Nexvia choices belong to another project.")

    def selected(field, identity):
        matches = [row for row in lookup[field] if str(row["id"]) == str(identity)]
        require(len(matches) == 1 and matches[0].get("disabled") is not True,
                "Nexvia selections changed; review the request.")
        return matches[0]

    supplier = selected("suppliers", payload.get("supplierId"))
    selected("services", payload.get("serviceId"))
    selected("breakdowns", payload.get("breakdownType"))
    current = read_native(context, project, supplier["text"]).get("_resp")
    require(isinstance(current, list) and any(isinstance(row, dict)
            and str(row.get("id")) == str(supplier["id"])
            and row.get("can_create_po") is True and not row.get("disabled") for row in current),
            "Supplier is no longer available for purchase orders on this project.")
    require(isinstance(payload.get("date"), str)
            and date.fromisoformat(payload["date"]).isoformat() == payload["date"],
            "Invalid order date.")
    person = payload.get("requestor")
    require(isinstance(person, dict) and isinstance(person.get("name"), str)
            and 0 < len(person["name"].strip()) <= 160
            and isinstance(person.get("email"), str) and len(person["email"]) <= 254
            and re.fullmatch(r"[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+", person["email"]),
            "Invalid requestor details.")
    lines = payload.get("lines")
    require(isinstance(lines, list) and 1 <= len(lines) <= 200, "Enter 1 to 200 request lines.")
    subtotal = tax = 0
    for row in lines:
        require(isinstance(row, dict) and isinstance(row.get("description"), str)
                and 0 < len(row["description"].strip()) <= 2000
                and row.get("breakdownType") == payload.get("breakdownType"),
                "Invalid request line or EOW.")
        selected("accounts", row.get("chartOfAccountId"))
        rate = decimal_value(selected("taxes", row.get("taxRateId"))["rate"])
        require(rate <= 100, "Invalid current tax percentage.")
        amount = int((decimal_value(row.get("quantity"), True)
                      * decimal_value(row.get("unitPriceExGst"))).quantize(
                          Decimal(".01"), rounding=ROUND_HALF_UP) * 100)
        subtotal += amount
        tax += int((Decimal(amount) * rate / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    require(all(type(payload.get(key)) is int and 0 <= payload[key] <= 1000000000000
                for key in ("subtotalCents", "taxCents", "totalCents"))
            and (subtotal, tax, subtotal + tax) ==
            (payload["subtotalCents"], payload["taxCents"], payload["totalCents"]),
            "Current Nexvia tax or totals differ; review the request.")


def save_choices(path, value):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-choices-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=int)
    parser.add_argument("--supplier", default="")
    args = parser.parse_args()
    require(args.project > 0 and len(args.supplier) <= 100, "Invalid project or supplier search.")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
        context = next((ctx for ctx in browser.contexts for page in ctx.pages
                        if page.url.startswith(BASE + "/staff/") and "/login" not in page.url), None)
        require(context is not None, "Sign into Nexvia in the NAS browser.")
        value = collect_choices(context, args.project, args.supplier)
    save_choices(CONFIG / "nexvia-form-data.json", value)
    for key in ("services", "breakdowns", "suppliers", "accounts", "taxes"):
        print(key + ":", len(value[key]))
    print("Current Nexvia choices saved. No PO was submitted.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Nexvia choices unavailable. Check sign-in and the directory refresher; no choices were replaced.")
