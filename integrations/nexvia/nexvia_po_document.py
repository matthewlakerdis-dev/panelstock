#!/usr/bin/env python3
"""Capture an existing, verified Nexvia PO PDF without printing or emailing it.

Only an already embedded data PDF or same-origin blob is read. HTTP document
links, Print controls, creation code and Nexvia write requests are never used.
"""

import argparse
import base64
import fcntl
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from urllib.parse import parse_qsl, urlsplit


ORIGIN = "https://lennox.nexvia.com.au"
MAX_PDF_BYTES = 5 * 1024 * 1024
MAX_ENCODED = ((MAX_PDF_BYTES + 2) // 3) * 4 + 256
PDF_NAME = "nexvia-purchase-order.pdf"
MANIFEST_NAME = "nexvia-po-document.json"
VENDOR_WHEEL = Path(__file__).parent / "nexvia-po-vendor" / "pypdf.whl"
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
STATIC_PREFIXES = ("/staff/js/", "/staff/css/", "/staff/assets/", "/staff/images/", "/staff/fonts/",
                   "/js/", "/css/", "/assets/", "/images/", "/fonts/", "/scripts/", "/content/")
STATIC_EXT = re.compile(r"\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$", re.I)
CACHE_KEYS = {"v", "ver", "version", "_", "hash", "cache", "build", "rev", "t"}
ACTION_PATH = re.compile(r"purchase-order-(?:print|add|modify|delete|send)|/(?:sent|send|delete|remove|logout|save|email)(?:/|$)", re.I)


class DocumentError(Exception):
    """Fixed diagnostic codes only; no document content or private URLs."""


def require(condition, code):
    if not condition:
        raise DocumentError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def check_dependencies():
    if VENDOR_WHEEL.exists():
        require(not VENDOR_WHEEL.is_symlink() and VENDOR_WHEEL.is_file(), "parser-unavailable")
        if str(VENDOR_WHEEL) not in sys.path:
            sys.path.insert(0, str(VENDOR_WHEEL))
    require(importlib.util.find_spec("pypdf") is not None, "parser-unavailable")
    return True


def allow_request(url, method, target, resource_type):
    try:
        parsed = urlsplit(url)
        require(method.upper() in READ_METHODS and parsed.scheme == "https"
                and parsed.netloc == "lennox.nexvia.com.au" and not parsed.fragment, "blocked")
        if parsed.path == target:
            return not parsed.query
        return (resource_type in {"script", "stylesheet", "image", "font"}
                and parsed.path.lower().startswith(STATIC_PREFIXES)
                and not ACTION_PATH.search(parsed.path) and "%" not in parsed.path
                and "\\" not in parsed.path and not any(part in {".", ".."} for part in parsed.path.split("/"))
                and bool(STATIC_EXT.search(parsed.path))
                and all(key.lower() in CACHE_KEYS for key, _ in parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=20)))
    except (DocumentError, ValueError, TypeError):
        return False


def valid_identity(project, order_id, number):
    require(type(project) is int and 0 < project < 10**15 and type(order_id) is int
            and 0 < order_id < 10**15 and isinstance(number, str)
            and re.fullmatch(r"PO[0-9]{1,20}", number), "invalid-po-identity")


def private_folder(folder):
    folder = Path(folder)
    require(not folder.is_symlink(), "invalid-document-folder")
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = folder.stat()
    require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077, "invalid-document-folder")
    return folder


def private_read(path, maximum):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, "invalid-document-artifact")
            raw = stream.read(maximum + 1)
        require(len(raw) <= maximum, "invalid-document-artifact")
        return raw
    except OSError as error:
        raise DocumentError("document-artifact-unavailable") from error


def atomic_private(path, raw):
    require(not path.is_symlink(), "invalid-document-artifact")
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-document-", dir=path.parent)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
        descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary:
            os.unlink(temporary)


PDF_TEXT_PROGRAM = r'''
import json,resource,sys
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
resource.setrlimit(resource.RLIMIT_CPU,(8,8))
if sys.argv[2]:sys.path.insert(0,sys.argv[2])
try:
 from pypdf import PdfReader
 reader=PdfReader(sys.argv[1],strict=False)
 if reader.is_encrypted and not reader.decrypt(""):raise ValueError()
 if not 0<len(reader.pages)<=100:raise ValueError()
 indices=sorted(set([0,min(1,len(reader.pages)-1),len(reader.pages)-1]))
 texts=[(reader.pages[i].extract_text() or '')[:65536] for i in indices]
 print(json.dumps({'texts':texts},ensure_ascii=True))
except Exception:
 sys.exit(1)
'''


def pdf_text(raw, folder):
    require(50 <= len(raw) <= MAX_PDF_BYTES and raw.startswith(b"%PDF-")
            and b"%%EOF" in raw[-1024:], "not-a-complete-pdf")
    check_dependencies()
    descriptor, path = tempfile.mkstemp(prefix=".inspect-po-", suffix=".pdf", dir=folder)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
        try:
            completed = subprocess.run([sys.executable, "-c", PDF_TEXT_PROGRAM, path,
                                        str(VENDOR_WHEEL) if VENDOR_WHEEL.is_file() else ""],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, timeout=12, check=False)
            require(completed.returncode == 0 and len(completed.stdout) <= 512 * 1024, "pdf-text-unavailable")
            value = json.loads(completed.stdout)
            texts = value.get("texts")
            require(isinstance(texts, list) and 1 <= len(texts) <= 3
                    and all(isinstance(text, str) and len(text) <= 65536 for text in texts), "pdf-text-unavailable")
            return texts
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            raise DocumentError("pdf-text-unavailable") from error
    finally:
        os.unlink(path)


def compact(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def name_matches(text, name, project=False):
    if not isinstance(name, str) or not 3 <= len(name.strip()) <= 500:
        return False
    aliases = [name]
    if project:
        aliases.append(re.sub(r"^\s*(?:(?:[0-9]+|[A-Za-z]{1,8}[0-9][A-Za-z0-9]*)\s*-\s*){1,4}", "", name))
    return any(len(compact(alias)) >= 3 and compact(alias) in compact(text) for alias in aliases)


def official_pdf(raw, identity, folder, extractor=pdf_text):
    texts = extractor(raw, folder)
    first, all_text = texts[0], "\n".join(texts)
    header = first[:1500]
    heading = re.search(r"^[ \t]*purchase[ \t]+order(?:[ \t]*(?:(?:no\.?|number)[ \t]*)?[:#-]?[ \t]*(?:PO[ \t]*)?[0-9]+)?[ \t]*$", header, re.I | re.M)
    require(heading is not None, "not-an-official-purchase-order")
    # A reference to a customer's PO is not the document's title. PDF extraction
    # order does not establish the visual position of the title and letterhead.
    require(re.search(r"\blennox\b", header, re.I) and re.search(r"\bfacades\b", header, re.I)
            and not re.search(r"^[ \t]*(?:tax[ \t]+invoice|quotation|quote|invoice)(?:[ \t]*[:#-]?[ \t]*[A-Za-z0-9-]+)?[ \t]*$", header, re.I | re.M),
            "not-an-official-purchase-order")
    numbers = set(re.findall(r"\bPO[0-9]+\b", first[:2000], re.I))
    require({number.upper() for number in numbers} == {identity["purchaseOrderNumber"]}, "pdf-po-number-mismatch")
    require(name_matches(all_text, identity.get("projectName"), project=True), "pdf-project-mismatch")
    require(name_matches(all_text, identity.get("supplierName")), "pdf-supplier-mismatch")
    total = identity.get("totalCents")
    require(type(total) is int and 0 <= total <= 10**13, "native-total-unavailable")
    normalized = re.sub(r"[()]", " ", all_text)
    totals = []
    pattern = r"^[ \t]*(?P<grand>grand[ \t]+)?total(?P<inclusive>[ \t]+inc(?:l(?:uding|usive)?)?\.?[ \t]*(?:of[ \t]*)?GST)?[ \t]*[:$]*\s*(?:AUD|A\$)?[ \t]*\$?[ \t]*(?P<amount>[0-9][0-9,]*\.[0-9]{2})[ \t]*$"
    for match in re.finditer(pattern, normalized, re.I | re.M):
        preceding = normalized[:match.start()].rstrip().splitlines()
        if not (match.group("grand") or match.group("inclusive")) and preceding and re.fullmatch(r"(?:sub|tax|balance|previous)", preceding[-1].strip(), re.I):
            continue
        totals.append((bool(match.group("grand") or match.group("inclusive")),
                       int(Decimal(match.group("amount").replace(",", "")) * 100)))
    # An explicit grand/inclusive total outranks a generic pre-tax "Total".
    # Every explicit final total must agree; a subtotal can never rescue it.
    final_amounts = [amount for explicit, amount in totals if explicit] or [amount for _, amount in totals]
    require(bool(final_amounts) and set(final_amounts) == {total}, "pdf-total-mismatch")
    return {"officialHeading": True, "issuerMatched": True, "poMatched": True,
            "projectMatched": True, "supplierMatched": True, "totalMatched": True}


def decimal(value):
    try:
        require(type(value) in {str, int, float}, "native-lines-unavailable")
        number = Decimal(str(value))
        require(number.is_finite() and abs(number) < 10**12, "native-lines-unavailable")
        return number
    except (InvalidOperation, ValueError, TypeError) as error:
        raise DocumentError("native-lines-unavailable") from error


def native_total(lines):
    require(isinstance(lines, list) and 0 < len(lines) <= 1000 and all(isinstance(line, dict) for line in lines), "native-lines-unavailable")
    total = 0
    for line in lines:
        quantity, price, tax = decimal(line.get("qty")), decimal(line.get("unit_price")), decimal(line.get("tax_rate"))
        require(quantity > 0 and price >= 0 and 0 <= tax <= 100, "native-lines-unavailable")
        base = (quantity * price * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        total += int(base + (base * tax / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return total


def decode_candidate(candidate):
    kind = candidate.get("kind")
    value = candidate.get("content")
    require(kind in {"data", "blob"} and isinstance(value, str) and len(value) <= MAX_ENCODED, "inline-pdf-unavailable")
    if kind == "data":
        value = value.split("#", 1)[0]
        match = re.fullmatch(r"data:application/(?:pdf|octet-stream);base64,([A-Za-z0-9+/=\r\n]*)", value, re.I)
        require(match is not None, "unsupported-data-pdf")
        value = re.sub(r"\s", "", match.group(1))
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as error:
        raise DocumentError("invalid-inline-pdf") from error
    require(50 <= len(raw) <= MAX_PDF_BYTES and raw.startswith(b"%PDF-"), "invalid-inline-pdf")
    return raw


READ_PAGE_JS = r"""async ({maxBytes,maxEncoded,expectedNumber}) => {
 const get=name=>document.getElementsByName(name)[0]?.value||'';
 const body=(document.body?.innerText||'').slice(0,200000);
 const numbers=[...new Set([...body.matchAll(/Purchase Order\s*#\s*(PO\d+)/gi)].map(match=>match[1].toUpperCase()))];
 if(numbers.length!==1||numbers[0]!==expectedNumber||!document.querySelector('[name="form[Lines]"]'))return {hasLines:false,numbers,sources:[],handlers:[]};
 let lines=[];try{const text=get('form[Lines]');if(text.length<=1048576)lines=JSON.parse(text);}catch{}
 const supplierIds=[...new Set(['form[ClientId]','form[SupplierId]','form[Client]'].map(get).filter(value=>/^[1-9][0-9]*$/.test(value)))];
 const supplierLabels=[];
 for(const name of ['form[ClientId]','form[SupplierId]','form[Client]']) {
  const el=document.getElementsByName(name)[0];if(!el)continue;
  if(el.tagName==='SELECT'&&el.selectedOptions?.length===1)supplierLabels.push(el.selectedOptions[0].textContent.trim().slice(0,500));
 }
 const sources=[],seen=new Set();let bytesRead=0;
 for(const el of document.querySelectorAll('embed[src],iframe[src],object[data],a[href]')) {
  const src=el.getAttribute('src')||el.getAttribute('data')||el.getAttribute('href')||'';
  const type=(el.getAttribute('type')||'').toLowerCase();
  if(el.tagName==='A'&&!/^(?:data:application\/(?:pdf|octet-stream)|blob:)/i.test(src))continue;
  if(seen.has(src)||sources.length>=12)continue;seen.add(src);
  let scheme='other';try{scheme=new URL(src,location.href).protocol.replace(':','').toLowerCase();}catch{}
  if(!['data','blob','http','https','about','chrome-extension',''].includes(scheme))scheme='other';
  const record={tag:el.tagName,scheme,length:src.length,pdfType:type==='application/pdf',kind:null,content:null,status:'not-inline-pdf'};
  if(/^data:application\/(?:pdf|octet-stream);base64,/i.test(src)) {
   if(src.length<=maxEncoded&&bytesRead+src.length<=maxEncoded*2){record.kind='data';record.content=src;record.status='captured';bytesRead+=src.length;}
   else record.status='inline-pdf-too-large';
  } else if(scheme==='blob') {
   let allowed=false;try {const inner=new URL(src.slice(5));allowed=inner.origin===location.origin&&/^\/[A-Za-z0-9-]{1,80}$/.test(inner.pathname)&&!inner.search;}catch{}
   if(!allowed)record.status='foreign-blob-blocked';
   else if(bytesRead>=maxEncoded*2)record.status='inline-pdf-too-large';
   else {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try {
     const response=await fetch(src,{method:'GET',signal:controller.signal});
     if(!response.ok||!response.body)throw Error();
     const reader=response.body.getReader(),chunks=[];let size=0;
     while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){controller.abort();throw Error();}chunks.push(value);}
     let binary='';for(const chunk of chunks)for(let offset=0;offset<chunk.length;offset+=16384)binary+=String.fromCharCode(...chunk.subarray(offset,offset+16384));
     record.kind='blob';record.content=btoa(binary);record.status='captured';bytesRead+=record.content.length;
    }catch {record.status='blob-unavailable';}finally{clearTimeout(timer);}
   }
  }
  sources.push(record);
 }
 const handlers=[];let handlerBytes=0;
 for(const el of document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')) {
  const label=(el.tagName==='INPUT'?el.value:el.textContent)||el.getAttribute('aria-label')||'';
  if(!/\bprint\b/i.test(label)||handlers.length>=12)continue;
  const inline=el.getAttribute('onclick')||'',functions=[],seenFunctions=new Set();
  const add=(kind,fn)=>{if(typeof fn!=='function'||seenFunctions.has(fn)||functions.length>=4)return;seenFunctions.add(fn);try{const source=Function.prototype.toString.call(fn);if(source.length<=65536&&handlerBytes+source.length<=262144){functions.push({kind,source});handlerBytes+=source.length;}}catch{}};
  add('onclick-property',el.onclick);
  for(const match of [...inline.slice(0,1800).matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].slice(0,6)) {
   try{add('named-global',Object.getOwnPropertyDescriptor(window,match[1])?.value);}catch{}
  }
  const jq=window.jQuery||window.$;
  if(typeof jq==='function'&&typeof jq._data==='function')try{for(const entry of (jq._data(el,'events')?.click||[]).slice(0,3))add('jquery-click',Object.getOwnPropertyDescriptor(entry,'handler')?.value);}catch{}
  handlers.push({inline:inline.length<=1800?inline:'',functions});
 }
 return {hasLines:!!document.querySelector('[name="form[Lines]"]'),numbers,body,lines,supplierIds,supplierLabels,
         service:get('form[ServiceId]'),comment:get('form[Comment]'),sources,handlers};
}"""


def handler_metadata(handlers, order_id):
    output = []
    for handler in handlers[:12]:
        for item in [{"kind": "inline", "source": handler.get("inline", "")}] + handler.get("functions", [])[:4]:
            source = item.get("source")
            if not isinstance(source, str) or len(source) > 65536:
                continue
            routes = sorted(set(re.findall(r"/staff/project-purchase-order-print/" + str(order_id) + r"(?:/sent/[01])?(?![0-9])", source)))[:8]
            flags = [name for name in ("Print", "Email", "Outlook", "MarkSent") if "form[" + name + "]" in source or "form_" + name in source]
            arguments = [[part.strip() in {"true", "1"} for part in match.split(",")]
                         for match in re.findall(r"\(\s*((?:true|false|0|1)(?:\s*,\s*(?:true|false|0|1)){0,3})\s*\)", source)[:4]]
            output.append({"kind": item.get("kind") if item.get("kind") in {"inline", "onclick-property", "named-global", "jquery-click"} else "other",
                           "nativePrintRoutes": routes, "actionFlagsMentioned": flags,
                           "booleanArguments": arguments, "hasSentZeroFragment": "/sent/0" in source,
                           "hasSentOneFragment": "/sent/1" in source,
                           "hasDynamicSentFragment": bool(re.search(r"[\"']/sent/[\"']\s*\+", source))})
    return output


def read_page(browser, project, order_id, number):
    target = f"/staff/project-purchase-order-modify/{project}/{order_id}"
    signed_in = next((context for context in browser.contexts if any(
        page.url.startswith(ORIGIN + "/staff/") and "/login" not in page.url for page in context.pages)), None)
    require(signed_in is not None, "nexvia-sign-in-required")
    state = signed_in.storage_state()
    state = {"cookies": [row for row in state.get("cookies", []) if row.get("domain", "").lstrip(".") in {"lennox.nexvia.com.au", "nexvia.com.au"}],
             "origins": [row for row in state.get("origins", []) if row.get("origin") == ORIGIN]}
    context = browser.new_context(storage_state=state, service_workers="block", accept_downloads=False)
    blocked = 0

    def guard(route):
        nonlocal blocked
        request = route.request
        if allow_request(request.url, request.method, target, request.resource_type):
            route.continue_()
        else:
            blocked += 1
            route.abort()

    try:
        context.route("**/*", guard)
        require(callable(getattr(context, "route_web_socket", None)), "browser-guard-unavailable")
        context.route_web_socket("**/*", lambda socket: socket.close())
        context.add_init_script("window.open=()=>null;window.print=()=>undefined;")
        page = context.new_page()
        response = page.goto(ORIGIN + target, wait_until="domcontentloaded", timeout=45000)
        require(response is not None and response.status == 200 and page.url == ORIGIN + target, "po-page-unavailable")
        page.locator('[name="form[Lines]"]').wait_for(state="attached", timeout=15000)
        raw = page.evaluate(READ_PAGE_JS, {"maxBytes": MAX_PDF_BYTES, "maxEncoded": MAX_ENCODED, "expectedNumber": number})
        require(raw.get("hasLines") is True and raw.get("numbers") == [number], "native-po-number-mismatch")
        raw["blockedRequestCount"] = blocked
        return raw
    finally:
        context.close()


def directory_name(path, key, identifier, id_field):
    try:
        require(not path.is_symlink() and path.stat().st_size <= 8 * 1024 * 1024, "identity-context-unavailable")
        rows = json.loads(path.read_text()).get(key)
        require(isinstance(rows, list) and len(rows) <= 10000, "identity-context-unavailable")
        matches = [row.get("name") for row in rows if isinstance(row, dict) and str(row.get(id_field)) == str(identifier)]
        require(len(matches) == 1 and isinstance(matches[0], str) and 3 <= len(matches[0]) <= 500, "identity-context-unavailable")
        return matches[0]
    except (OSError, ValueError, TypeError, DocumentError):
        return None


def source_summary(raw, order_id):
    return {"sources": [{"tag": row.get("tag") if row.get("tag") in {"EMBED", "IFRAME", "OBJECT", "A"} else "OTHER",
                         "scheme": row.get("scheme") if row.get("scheme") in {"data", "blob", "http", "https", "about", "chrome-extension", ""} else "other",
                         "length": row.get("length") if type(row.get("length")) is int and row["length"] >= 0 else None,
                         "pdfType": row.get("pdfType") is True,
                         "readStatus": row.get("status") if row.get("status") in {"captured", "not-inline-pdf", "inline-pdf-too-large", "foreign-blob-blocked", "blob-unavailable"} else "unavailable"}
                        for row in raw.get("sources", [])[:12]],
            "printHandlers": handler_metadata(raw.get("handlers", []), order_id),
            "blockedRequestCount": raw.get("blockedRequestCount", 0)}


def validate_snapshot(raw, folder, project, order_id, number, *, expected_project=None,
                      expected_supplier=None, total_cents=None, config_root=Path("/config"), request=None):
    summary = source_summary(raw, order_id)
    project_name = expected_project or directory_name(Path(config_root) / "nexvia-projects.json", "projects", project, "projectPageId")
    supplier_name = expected_supplier
    if supplier_name is None and len(raw.get("supplierIds", [])) == 1:
        supplier_name = directory_name(Path(config_root) / "nexvia-supplier-directory.json", "records", raw["supplierIds"][0], "id")
    if supplier_name is None and len(set(raw.get("supplierLabels", []))) == 1:
        supplier_name = raw["supplierLabels"][0]
    candidates = [row for row in raw.get("sources", [])[:12] if row.get("status") == "captured"]
    if not candidates:
        return None, None, {**summary, "status": "no-readable-inline-pdf", "documentVerified": False}
    require(name_matches(raw.get("body", ""), project_name, project=True)
            and name_matches(raw.get("body", ""), supplier_name), "identity-context-unavailable")
    native_cents = native_total(raw.get("lines"))
    if total_cents is not None:
        require(type(total_cents) is int and native_cents == total_cents, "native-total-mismatch")
    if request is not None:
        require(raw.get("comment") == "Request reference: " + request["reference"]
                and raw.get("service") == str(request["serviceId"]), "native-request-mismatch")
        if raw.get("supplierIds"):
            require(raw["supplierIds"] == [str(request["supplierId"])], "native-supplier-mismatch")
        require(len(raw["lines"]) == len(request["lines"]), "native-request-mismatch")
        for actual, expected in zip(raw["lines"], request["lines"]):
            require(actual.get("item_description") == expected.get("description")
                    and decimal(actual.get("qty")) == decimal(expected.get("quantity"))
                    and decimal(actual.get("unit_price")) == decimal(expected.get("unitPriceExGst"))
                    and str(actual.get("chart_of_account_id")) == str(expected.get("chartOfAccountId"))
                    and str(actual.get("tax_rate_id")) == str(expected.get("taxRateId")), "native-request-mismatch")
            require("job_purchase_order_id" not in actual or str(actual["job_purchase_order_id"]) == str(order_id), "native-request-mismatch")
    identity = {"projectPageId": project, "purchaseOrderId": order_id, "purchaseOrderNumber": number,
                "projectName": project_name, "supplierName": supplier_name, "totalCents": native_cents}
    matches, failures = {}, []
    for candidate in candidates:
        try:
            document = decode_candidate(candidate)
            verification = official_pdf(document, identity, folder)
            matches[hashlib.sha256(document).hexdigest()] = (document, candidate["kind"], verification)
        except DocumentError as error:
            failures.append(str(error))
    if len(matches) != 1:
        return None, None, {**summary, "status": "ambiguous-official-pdf" if len(matches) > 1 else "official-pdf-not-verified",
                            "documentVerified": False, "candidateFailures": failures[:12]}
    document, kind, verification = next(iter(matches.values()))
    return document, identity, {**summary, "status": "verified", "documentVerified": True,
                               "sourceKind": kind, "verification": verification}


def inspect_and_capture(browser, folder, project, order_id, number, **kwargs):
    raw = read_page(browser, project, order_id, number)
    try:
        return validate_snapshot(raw, folder, project, order_id, number, **kwargs)
    except DocumentError as error:
        return None, None, {**source_summary(raw, order_id), "status": str(error), "documentVerified": False}


def with_browser(callback, browser):
    if browser is not None:
        return callback(browser)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        connected = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
        return callback(connected)


def saved_document(folder, identity_hash, project, order_id, number):
    path = folder / MANIFEST_NAME
    if not path.exists() and not path.is_symlink():
        return None
    try:
        manifest = json.loads(private_read(path, 16384))
    except (ValueError, TypeError) as error:
        raise DocumentError("invalid-document-artifact") from error
    require(manifest.get("version") == 1 and manifest.get("identityHash") == identity_hash
            and manifest.get("projectPageId") == project and manifest.get("purchaseOrderId") == order_id
            and manifest.get("purchaseOrderNumber") == number and manifest.get("filename") == PDF_NAME
            and manifest.get("sourceKind") in {"data", "blob"}, "document-artifact-identity-mismatch")
    raw = private_read(folder / PDF_NAME, MAX_PDF_BYTES)
    require(manifest.get("size") == len(raw) and manifest.get("sha256") == hashlib.sha256(raw).hexdigest(), "document-artifact-hash-mismatch")
    return manifest


def freeze_document(folder, raw, identity, identity_hash, source_kind, reference=None):
    manifest = {"version": 1, "identityHash": identity_hash, "projectPageId": identity["projectPageId"],
                "purchaseOrderId": identity["purchaseOrderId"], "purchaseOrderNumber": identity["purchaseOrderNumber"],
                "requestReference": reference, "filename": PDF_NAME, "size": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(), "sourceKind": source_kind,
                "capturedAt": datetime.now(timezone.utc).isoformat()}
    descriptor = os.open(folder / ".document.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        require(stat.S_ISREG(os.fstat(descriptor).st_mode) and not os.fstat(descriptor).st_mode & 0o077, "invalid-document-artifact")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        existing = saved_document(folder, identity_hash, identity["projectPageId"], identity["purchaseOrderId"], identity["purchaseOrderNumber"])
        if existing:
            return existing
        atomic_private(folder / PDF_NAME, raw)
        atomic_private(folder / MANIFEST_NAME, canonical(manifest))
        return manifest
    finally:
        os.close(descriptor)


def capture_document(folder, request, result, *, expected_project=None, expected_supplier=None, browser=None):
    project, order_id, number = result.get("projectPageId"), result.get("purchaseOrderId"), result.get("purchaseOrderNumber")
    valid_identity(project, order_id, number)
    require(result.get("state") == "CREATED_VERIFIED" and result.get("requestReference") == request.get("reference")
            and request.get("projectPageId") == project and type(request.get("totalCents")) is int
            and result.get("totalCents") == request["totalCents"]
            and result.get("url") == f"{ORIGIN}/staff/project-purchase-order-modify/{project}/{order_id}", "verified-request-mismatch")
    require(isinstance(expected_project, str) and isinstance(expected_supplier, str), "identity-context-unavailable")
    folder = private_folder(folder)
    identity_hash = hashlib.sha256(canonical({"request": request, "result": result,
                                            "projectName": expected_project, "supplierName": expected_supplier})).hexdigest()
    existing = saved_document(folder, identity_hash, project, order_id, number)
    if existing:
        return existing
    check_dependencies()
    try:
        raw, identity, report = with_browser(lambda connected: inspect_and_capture(
            connected, folder, project, order_id, number, expected_project=expected_project,
            expected_supplier=expected_supplier, total_cents=request["totalCents"], request=request), browser)
    except DocumentError:
        raise
    except Exception as error:
        raise DocumentError("capture-unavailable") from error
    require(report.get("documentVerified") is True, report["status"])
    return freeze_document(folder, raw, identity, identity_hash, report["sourceKind"], request["reference"])


def capture_check(project, order_id, number, *, folder=None, expected_project=None,
                  expected_supplier=None, total_cents=None, browser=None, config_root=Path("/config")):
    valid_identity(project, order_id, number)
    folder = private_folder(folder or Path(config_root) / "nexvia-po-document-check" / number)
    report = {"format": "nexvia-po-document-check", "version": 1, "projectPageId": project,
              "purchaseOrderId": order_id, "purchaseOrderNumber": number,
              "documentVerified": False, "documentActionInvoked": False,
              "emailOrUploadInvoked": False, "capturedAt": datetime.now(timezone.utc).isoformat()}
    try:
        check_dependencies()
        raw, identity, details = with_browser(lambda connected: inspect_and_capture(
            connected, folder, project, order_id, number, expected_project=expected_project,
            expected_supplier=expected_supplier, total_cents=total_cents, config_root=config_root), browser)
        report.update(details)
        if report["documentVerified"]:
            identity_hash = hashlib.sha256(canonical(identity)).hexdigest()
            existing = saved_document(folder, identity_hash, project, order_id, number)
            manifest = existing or freeze_document(folder, raw, identity, identity_hash, report["sourceKind"])
            report.update(filename=manifest["filename"], size=manifest["size"], sha256=manifest["sha256"])
    except DocumentError as error:
        report.update(status=str(error), documentVerified=False)
    except Exception:
        report.update(status="capture-unavailable", documentVerified=False)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", required=True)
    parser.add_argument("--project", required=True, type=int)
    parser.add_argument("--po", required=True, type=int)
    parser.add_argument("--number", required=True)
    parser.add_argument("--project-name")
    parser.add_argument("--supplier-name")
    parser.add_argument("--total-cents", type=int)
    parser.add_argument("--folder", type=Path)
    parser.add_argument("--output", type=Path, default=Path("/config/nexvia-po-document-check.json"))
    args = parser.parse_args(argv)
    report = capture_check(args.project, args.po, args.number, folder=args.folder,
                           expected_project=args.project_name, expected_supplier=args.supplier_name,
                           total_cents=args.total_cents)
    encoded = (json.dumps(report, indent=2) + "\n").encode()
    require(len(encoded) <= 128 * 1024, "report-too-large")
    atomic_private(args.output, encoded)
    print("Read-only PO document check saved:", args.output)
    print("Document verified:", report["documentVerified"])
    print("Status:", report.get("status", "capture-unavailable"))
    print("No PO, print, upload or email action was invoked.")
    return 0 if report["documentVerified"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print("PO document check stopped safely; no action was invoked.")
        raise SystemExit(1)
