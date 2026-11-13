#!/usr/bin/env python3
"""Refresh complete native Nexvia supplier, COS and tax choices on the NAS.

Only native read transports are permitted. No purchase order is submitted.
"""
import argparse
from datetime import datetime, timezone
import fcntl
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urljoin, urlsplit

BASE = "https://lennox.nexvia.com.au"
CONFIG = Path("/config")
MAX_ROWS = 10000


class LookupError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise LookupError(message)


def plain(value, limit, label):
    require(isinstance(value, str) and value.strip() and len(value) <= limit
            and not re.search(r"[\x00-\x1f\x7f]", value), "Invalid " + label)
    return value.strip()


def identifier(value):
    require(not isinstance(value, bool) and isinstance(value, (str, int))
            and re.fullmatch(r"[0-9]+", str(value)) and int(value) > 0,
            "Invalid native lookup identity")
    return int(value)


def disabled(value):
    require(type(value) in {bool, int, str, type(None)}
            and value in (True, False, 0, 1, "0", "1", "true", "false", None),
            "Invalid native lookup eligibility")
    return value in (True, 1, "1", "true")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def collect_pages(read_page, label):
    """Keep no partial result when native paging changes or omits a record."""
    first = read_page(1)
    total, size, server = first.get("total"), first.get("pageSize"), first.get("serverPaging")
    require(type(total) is int and 0 < total <= MAX_ROWS, label + " total is invalid")
    require(type(server) is bool, label + " paging mode is invalid")
    require(not server or type(size) is int and 0 < size <= MAX_ROWS,
            label + " page size is invalid")
    count = math.ceil(total / size) if server else 1
    require(count <= 500, label + " has too many pages")
    rows, seen = [], set()
    for page_number in range(1, count + 1):
        page = first if page_number == 1 else read_page(page_number)
        require(page.get("total") == total and page.get("serverPaging") is server
                and page.get("pageSize") == size
                and canonical(page.get("filter")) == canonical(first.get("filter")),
                label + " directory changed during refresh")
        require(not server or page.get("page") == page_number, label + " returned the wrong page")
        batch = page.get("rows")
        expected = min(size, total - (page_number - 1) * size) if server else total
        require(isinstance(batch, list) and len(batch) == expected,
                label + " directory is incomplete")
        for row in batch:
            require(isinstance(row, dict), label + " row is invalid")
            key = identifier(row.get("id"))
            require(key not in seen, label + " identities repeat across pages")
            seen.add(key)
            rows.append(row)
    require(len(rows) == total, label + " directory is incomplete")
    return rows, first.get("filter")


SOURCE_JS = r"""({kind,activate}) => {
 const $=window.jQuery||window.$;if(typeof $!=='function')throw Error('Native lookup library unavailable');
 let source;
 if(kind==='suppliers'){
  const grids=[...document.querySelectorAll('.k-grid')].map(el=>$(el).data('kendoGrid')).filter(Boolean);
  if(grids.length!==1)throw Error('Native supplier grid is ambiguous');
  source=grids[0].dataSource;
 }else{
  const field=kind==='accounts'?'chart_of_account_id':'tax_rate_id';
  const widget=()=>{const el=document.querySelector('[name="'+field+'"]');return el&&($(el).data(kind==='accounts'?'kendoComboBox':'kendoDropDownList'));};
  let control=widget();
  if(!control&&activate){
   const matches=[];
   for(const el of document.querySelectorAll('.k-grid')){
    const grid=$(el).data('kendoGrid');if(!grid)continue;
    const flatten=columns=>columns.flatMap(c=>c.columns?flatten(c.columns):[c]);
    const columns=flatten(grid.columns||[]);
    const indices=columns.map((c,i)=>({c,i})).filter(({c})=>c.field===field||
      (kind==='accounts'?/^(?:acct\s*#|account)$/i:/^tax$/i).test(String(c.title||'').replace(/<[^>]*>/g,'').trim()));
    for(const {i} of indices){const row=grid.tbody.find('tr[data-uid]').first();if(row.length)matches.push({grid,cell:row.children('td').not('.k-group-cell,.k-hierarchy-cell').eq(i)});}
   }
   if(matches.length!==1)throw Error('Native lookup editor is ambiguous');
   matches[0].grid.editCell(matches[0].cell);control=widget();
  }
  if(!control||!control.dataSource)throw Error('Native lookup editor unavailable');source=control.dataSource;
 }
 window.__panelstockLookupSource=source;
 const read=source.transport?.options?.read??source.options?.transport?.read;
 const url=typeof read==='string'?read:typeof read?.url==='string'?read.url:null;
 return {url,method:typeof read==='object'?(read.type||read.method||'GET'):'GET',
  readFunction:typeof read==='function',
  serverPaging:source.options?.serverPaging===true,serverFiltering:source.options?.serverFiltering===true};
}"""

READ_JS = r"""async ({kind,number}) => {
 const ds=window.__panelstockLookupSource;if(!ds)throw Error('Native lookup source unavailable');
 await new Promise((resolve,reject)=>{
  let timer;const done=()=>{clearTimeout(timer);ds.unbind('change',changed);ds.unbind('error',failed);};
  const changed=()=>{done();resolve();},failed=()=>{done();reject(Error('Native lookup read failed'));};
  ds.bind('change',changed);ds.bind('error',failed);timer=setTimeout(()=>{done();reject(Error('Native lookup timed out'));},25000);
  try{if((ds.page()||1)===number)ds.read();else ds.page(number);}catch(e){done();reject(Error('Native lookup read failed'));}
 });
 const read=(row,key)=>typeof row.get==='function'?row.get(key):row[key];
 const keys=kind==='suppliers'?['id','name','business_type','type_id','disabled']:
  kind==='accounts'?['id','accountNo','accountFullName','accountType','disabled']:['id','name','rate','disabled'];
 const data=Array.from(ds.data()||[]).map(row=>Object.fromEntries(keys.map(key=>[key,read(row,key)]).filter(([,value])=>value!==undefined)));
 return {rows:data,total:ds.total(),page:ds.page()||1,pageSize:ds.pageSize()||data.length,
  serverPaging:ds.options?.serverPaging===true,filter:ds.filter()||null};
}"""


def native_reader(page, kind):
    metadata = page.evaluate(SOURCE_JS, {"kind": kind, "activate": True})
    require(isinstance(metadata, dict), "Native lookup metadata is unavailable")
    allowed = None
    if metadata.get("url"):
        destination = urljoin(page.url, metadata["url"])
        parsed = urlsplit(destination)
        require(parsed.scheme == "https" and parsed.netloc == "lennox.nexvia.com.au"
                and parsed.path.startswith("/staff/") and not parsed.fragment,
                "Native lookup transport left Nexvia")
        method = str(metadata.get("method", "GET")).upper()
        require(method in {"GET", "POST"}, "Unexpected native lookup transport method")
        allowed = (destination, method)
    require(allowed is not None or metadata.get("readFunction") is True
            or metadata.get("serverPaging") is False
            and metadata.get("serverFiltering") is not True,
            "Native remote lookup transport is unavailable")

    def guard(route):
        request = route.request
        if request.method in {"GET", "HEAD", "OPTIONS"} or allowed == (request.url, request.method):
            route.continue_()
        else:
            route.abort()

    # Some native grid reads are functions whose URL exists only at invocation.
    # They may execute with this GET-only guard; an opaque function never grants
    # POST permission. An explicit URL extends it only for that native read.
    page.route("**/*", guard)
    return lambda number: page.evaluate(READ_JS, {"kind": kind, "number": number})


def supplier_records(context):
    page = context.new_page()
    page.route("**/*", lambda route: route.continue_() if route.request.method in
               {"GET", "HEAD", "OPTIONS"} else route.abort())
    try:
        page.goto(BASE + "/staff/third-party", wait_until="domcontentloaded", timeout=45000)
        require(urlsplit(page.url).path.rstrip("/") == "/staff/third-party",
                "Supplier directory redirected; check Nexvia sign-in")
        page.wait_for_function("() => !!(window.jQuery&&[...document.querySelectorAll('.k-grid')].some(el=>window.jQuery(el).data('kendoGrid')))", timeout=20000)
        raw, native_filter = collect_pages(native_reader(page, "suppliers"), "Supplier")
        records = []
        for row in raw:
            business_type, type_id = row.get("business_type"), row.get("type_id")
            require(all(value is None or type(value) in {str, int} for value in (business_type, type_id)),
                    "Invalid supplier classification")
            records.append({"id": identifier(row.get("id")),
                            "name": plain(row.get("name"), 500, "supplier name"),
                            "business_type": business_type, "type_id": type_id,
                            "disabled": disabled(row.get("disabled"))})
        return {"expectedTotal": len(records), "filter": native_filter, "records": records}
    finally:
        page.close()


class Services(HTMLParser):
    def __init__(self):
        super().__init__(); self.active = False; self.option = None; self.rows = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "select": self.active = attributes.get("id") == "form_Service"
        elif tag == "option" and self.active:
            self.option = {"id": attributes.get("value"), "name": "", "disabled": "disabled" in attributes}

    def handle_data(self, data):
        if self.option is not None: self.option["name"] += data

    def handle_endtag(self, tag):
        if tag == "option" and self.option is not None:
            self.option["name"] = self.option["name"].strip()
            if self.option["id"] and self.option["name"]: self.rows.append(self.option)
            self.option = None
        elif tag == "select": self.active = False


def modal_choices(source):
    require(isinstance(source, str), "Native new-PO choices unavailable")
    parser = Services(); parser.feed(source)
    target = re.search(r'<select\b[^>]*\bid=["\']form_BreakdownType["\'][^>]*>.*?</select>\s*</div>\s*<script\b[^>]*>(.*?)</script>', source, re.S | re.I)
    choices = None
    if target:
        for match in re.finditer(r"var\s+options\s*=\s*", target.group(1)):
            try:
                widget, _ = json.JSONDecoder().raw_decode(target.group(1)[match.end():])
                rows = widget.get("choices")
                if isinstance(rows, list) and rows and all(isinstance(row, dict) and "id" in row and "name" in row for row in rows):
                    choices = rows; break
            except (ValueError, AttributeError):
                continue
    require(parser.rows and choices, "Native service/EOW choices are incomplete")
    return parser.rows, choices


def native_json(context, path, form=None):
    url = BASE + path
    headers = {"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"}
    response = context.request.get(url, headers=headers, max_redirects=0, timeout=25000) if form is None else context.request.post(url, form=form, headers=headers, max_redirects=0, timeout=25000)
    require(response.status == 200, "Native lookup failed; check Nexvia sign-in")
    try: value = response.json()
    except ValueError as error: raise LookupError("Native lookup did not return JSON") from error
    require(isinstance(value, dict) and value.get("_success") is True, "Native lookup was rejected")
    return value


def account_tax_records(context, project_id):
    from nexvia_allocations import native_line_editor
    modal = native_json(context, f"/staff/project-purchase-order-new-modal/{project_id}/Assembly?force=false&hide_service=false&hide_client=false&callback=Modals.newPurchaseOrderCallback")
    services, breakdowns = modal_choices(modal.get("_html"))
    contractors = native_json(context, f"/staff/project/contractors/{project_id}", {"q": ""}).get("_resp")
    require(isinstance(contractors, list), "Native supplier eligibility is unavailable")
    supplier = next((row for row in contractors if isinstance(row, dict)
                     and row.get("can_create_po") is True and not disabled(row.get("disabled"))), None)
    service = next((row for row in services if not disabled(row.get("disabled"))), None)
    enabled_breakdowns = [row for row in breakdowns if not disabled(row.get("disabled"))]
    breakdown = next((row for row in enabled_breakdowns if str(row.get("id")) == "b_70"), None)
    if breakdown is None:
        breakdown = next(iter(enabled_breakdowns), None)
    require(supplier and service and breakdown, "No accessible native PO context for live choices")
    request = {"projectPageId": project_id, "supplierId": str(identifier(supplier.get("id"))),
               "serviceId": str(service["id"]), "breakdownType": str(breakdown["id"]), "quote": None}
    with native_line_editor(context, request) as editor:
        return account_tax_for_editor(editor["page"])


def account_tax_for_editor(page):
    """Read current native COS/tax widgets on the caller's exact unsaved form.

    Accounts retain their native type; callers that offer only COS must select
    type == "Cost of Goods Sold". This function never submits the editor.
    """
    account_rows, _ = collect_pages(native_reader(page, "accounts"), "Account")
    tax_rows, _ = collect_pages(native_reader(page, "taxes"), "Tax")
    return normalize_account_taxes(account_rows, tax_rows)


def normalize_account_taxes(account_rows, tax_rows):
    accounts, taxes = [], []
    for row in account_rows:
        account_type = plain(row.get("accountType"), 100, "account type")
        number = row.get("accountNo")
        require(type(number) in {str, int}, "Invalid account number")
        number = plain(str(number), 50, "account number")
        name = plain(row.get("accountFullName"), 500, "account name")
        accounts.append({"id": identifier(row.get("id")), "name": name if name.startswith(number) else number + " - " + name,
                         "type": account_type, "accountNo": number, "accountFullName": name,
                         "accountType": account_type, "disabled": disabled(row.get("disabled"))})
    for row in tax_rows:
        rate = row.get("rate")
        require(not isinstance(rate, bool) and isinstance(rate, (int, float, str))
                and re.fullmatch(r"\d+(?:\.\d{1,4})?", str(rate)) and 0 <= float(rate) <= 100,
                "Invalid native tax rate")
        taxes.append({"id": identifier(row.get("id")), "name": plain(row.get("name"), 500, "tax name"),
                      "rate": rate, "disabled": disabled(row.get("disabled"))})
    require(any(row["type"] == "Cost of Goods Sold" and not row["disabled"] for row in accounts)
            and any(not row["disabled"] for row in taxes),
            "Live COS/tax choices are incomplete")
    return {"accounts": accounts, "taxes": taxes}


def atomic_json(path, value):
    descriptor, name = tempfile.mkstemp(prefix=".nexvia-lookup-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, indent=2, allow_nan=False)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def commit_snapshots(config_root, suppliers, account_tax, refreshed_at):
    paths = [config_root / "nexvia-supplier-directory.json", config_root / "nexvia-account-tax-lookups.json"]
    previous = [(path, path.read_bytes() if path.exists() else None) for path in paths]
    values = [{**suppliers, "refreshedAt": refreshed_at}, {**account_tax, "refreshedAt": refreshed_at}]
    changed = []
    try:
        for path, value in zip(paths, values):
            atomic_json(path, value); changed.append(path)
    except Exception as error:
        for path, raw in previous:
            if path not in changed: continue
            if raw is None: path.unlink(missing_ok=True)
            else: atomic_json(path, json.loads(raw))
        raise LookupError("Lookup snapshot commit failed; previous data retained") from error


def preferred_context_project(known, pages, catalog=None, project_id=None):
    """Prefer the last completed catalog context over unrelated browser tabs.

    This is only a context hint. Native permissions and defaults are read again
    before any snapshot is published. An explicit project never falls back.
    """
    if project_id is not None:
        selected = identifier(project_id)
        require(selected in known, "Unknown refresh project")
        return selected
    previous = catalog.get("projectPageId") if isinstance(catalog, dict) else None
    if type(previous) is int and previous in known:
        return previous
    for page in pages:
        parsed = urlsplit(page.url)
        if parsed.scheme != "https" or parsed.netloc != "lennox.nexvia.com.au":
            continue
        match = re.fullmatch(r"/staff/project/(\d+)/modify/?", parsed.path) or re.fullmatch(
            r"/staff/project-purchase-order-(?:add|modify)/(\d+)(?:/\d+)?/?", parsed.path)
        if match and int(match.group(1)) in known:
            return int(match.group(1))
    require(known, "Project directory is unavailable")
    return known[0]


def refresh_global_lookups(project_id=None, config_root=CONFIG):
    config_root = Path(config_root)
    descriptor = None
    try:
        projects = json.loads((config_root / "nexvia-projects.json").read_text()).get("projects")
        require(isinstance(projects, list) and projects and all(isinstance(row, dict) for row in projects),
                "Project directory is unavailable")
        known = [identifier(row.get("projectPageId")) for row in projects]
        if project_id is not None:
            project_id = identifier(project_id); require(project_id in known, "Unknown refresh project")
        descriptor = os.open(config_root / ".nexvia-lookups.lock", os.O_RDWR | os.O_CREAT, 0o600)
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
            context = next((ctx for ctx in browser.contexts if any(page.url.startswith(BASE + "/staff/") and "/login" not in page.url for page in ctx.pages)), None)
            require(context is not None, "Sign into Nexvia in the NAS browser")
            suppliers = supplier_records(context)
            try:
                catalog = json.loads((config_root / "nexvia-form-data.json").read_text())
            except (OSError, ValueError):
                catalog = None
            selected = preferred_context_project(known, context.pages, catalog, project_id)
            account_tax = account_tax_records(context, selected)
            account_tax["projectPageId"] = selected
        commit_snapshots(config_root, suppliers, account_tax, datetime.now(timezone.utc).isoformat())
    except LookupError:
        raise
    except Exception as error:
        raise LookupError("Live Nexvia choices could not be refreshed; previous data retained") from error
    finally:
        if descriptor is not None: os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", required=True)
    parser.add_argument("--project", type=int)
    args = parser.parse_args()
    try:
        refresh_global_lookups(args.project)
        print("Live supplier, COS and tax choices refreshed. No PO submitted.")
    except LookupError as error:
        print(str(error)); return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
