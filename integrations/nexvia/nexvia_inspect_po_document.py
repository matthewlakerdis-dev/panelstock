#!/usr/bin/env python3
"""Inspect one existing PO's document controls without printing or changing it.

The saved report contains structural metadata, never page HTML, form values,
cookies, request headers or query values. No document action is clicked.
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import parse_qsl, urljoin, urlsplit


ORIGIN = "https://lennox.nexvia.com.au"
DEFAULT_OUTPUT = Path("/config/nexvia-po-document-discovery.json")
MAX_REPORT_BYTES = 128 * 1024
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
STATIC_TYPES = {"script", "stylesheet", "image", "font"}
STATIC_EXTENSIONS = re.compile(r"\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$", re.I)
STATIC_PREFIXES = ("/staff/js/", "/staff/css/", "/staff/assets/", "/staff/images/", "/staff/fonts/",
                   "/js/", "/css/", "/assets/", "/images/", "/fonts/", "/scripts/", "/content/")
CACHE_KEYS = {"v", "ver", "version", "_", "hash", "cache", "build", "rev", "t"}
QUERY_KEYS = CACHE_KEYS | {"format", "returnurl", "sent", "id", "po", "project", "type", "download", "print",
                           "file", "document", "action", "inline", "disposition", "page", "q", "search"}
SENSITIVE = re.compile(r"password|passwd|secret|token|csrf|cookie|authorization|session|api_?key|credential", re.I)
ACTION_PATH = re.compile(r"(?:purchase-order-(?:print|add|modify|delete|send)|/(?:sent|send|delete|remove|logout|save|email)(?:/|$))", re.I)
NATIVE_ROUTE = re.compile(r"(?:/staff/project-purchase-order-print/(?:[0-9]+(?:/sent/[01])?)?|/staff/project-purchase-order-modify/[0-9]+/[0-9]+|/sent/[01]?)\Z")
ACTION_WORDS = re.compile(r"\b(?:print|view|download|pdf|purchase|order|po|document|file|preview|original|open)\b", re.I)
PATH_WORDS = {"staff", "project", "projects", "project-purchase-order-print", "project-purchase-order-modify",
              "project-purchase-order-download", "project-purchase-order-view", "project-purchase-order-pdf",
              "project-purchase-order-preview", "purchase-order", "purchase-orders", "sent", "file", "files",
              "getFiles", "download", "print", "view", "pdf", "document", "documents", "preview", "upload",
              "details", "js", "css", "assets", "images", "fonts", "scripts", "content", "flaticon", "svg"}
JS_WORDS = set("function var let const if else return new true false null undefined this try catch finally throw for while do break continue switch case default typeof instanceof void delete in of await async yield window document location navigator console fetch XMLHttpRequest open print setTimeout setInterval alert confirm prompt URL encodeURIComponent decodeURIComponent jQuery $ ajax get post submit request redirect attr prop val each data event preventDefault stopPropagation addEventListener closest querySelector querySelectorAll getElementById getElementsByName forms method type url body headers href target checked disabled value click on off bind unbind apply call".split())
JS_WORDS.add("is")
ACTION_FUNCTION = re.compile(r"(?:native)?(?:print|download|view|preview|send|email|show|open)(?:PO|PurchaseOrder|Document|PDF|File|Order)?\Z", re.I)
ACTION_FLAGS = {"Print", "Email", "Outlook", "MarkSent"}
BENIGN_LITERALS = {"0", "1", ":checked"} | {"form[" + name + "]" for name in ACTION_FLAGS}
for _name in ACTION_FLAGS:
    for _selector in {"#form_" + _name, '[name="form[' + _name + ']"]', "[name='form[" + _name + "]']"}:
        BENIGN_LITERALS.update({_selector, _selector + ":checked"})


def require(condition, message):
    if not condition:
        raise ValueError(message)


def positive_id(value):
    require(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,14}", value),
            "Choose a positive numeric project and PO ID.")
    return int(value)


def po_number(value):
    require(isinstance(value, str) and re.fullmatch(r"PO[0-9]{1,20}", value),
            "Choose the displayed PO number, beginning with PO.")
    return value


def same_origin(parsed):
    return parsed.scheme == "https" and parsed.netloc == "lennox.nexvia.com.au"


def allow_request(url, method, target_path, resource_type):
    """GET can mutate Nexvia: an HTTP-method-only guard is insufficient."""
    try:
        parsed = urlsplit(url)
    except (TypeError, ValueError):
        return False
    if method.upper() not in READ_METHODS or not same_origin(parsed) or parsed.fragment:
        return False
    if parsed.path == target_path:
        return not parsed.query
    # A static-looking navigation or XHR is not a static asset. Encoded paths
    # and action route names also fail closed, even when ending in .js/.png.
    try:
        cache_only = all(key.lower() in CACHE_KEYS for key, _ in parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=20))
    except ValueError:
        return False
    return (resource_type in STATIC_TYPES and parsed.path.lower().startswith(STATIC_PREFIXES)
            and cache_only and not ACTION_PATH.search(parsed.path)
            and "%" not in parsed.path and "\\" not in parsed.path
            and not any(part in {".", ".."} for part in parsed.path.split("/"))
            and bool(STATIC_EXTENSIONS.search(parsed.path)))


def url_metadata(value):
    if not isinstance(value, str) or not value or len(value) > 2048:
        return None
    try:
        parsed = urlsplit(urljoin(ORIGIN, value))
        if not same_origin(parsed):
            return {"externalOrNonHttp": True}
        segments = []
        for part in parsed.path.split("/"):
            if not part:
                segments.append("")
            elif (len(part) > 80 or SENSITIVE.search(part)
                  or not re.fullmatch(r"[A-Za-z0-9_.-]+", part)):
                segments.append("[redacted]")
            elif part in PATH_WORDS or re.fullmatch(r"[0-9]{1,20}", part):
                segments.append(part)
            elif re.search(r"\.[A-Za-z0-9]{1,5}$", part):
                extension = part.rsplit(".", 1)[1].lower()
                segments.append("[file]." + extension if extension in {"pdf", "js", "mjs", "css", "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "woff", "woff2", "ttf", "eot"} else "[redacted]")
            else:
                segments.append("[redacted]")
        keys = []
        for key, _ in parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=60):
            safe = key if key.lower() in QUERY_KEYS and not SENSITIVE.search(key) else "[redacted]"
            if safe not in keys:
                keys.append(safe)
        return {"path": "/".join(segments)[:400], "queryKeys": keys[:30]}
    except (TypeError, ValueError):
        return None


def action_label(value):
    """Keep action words, rather than arbitrary adjacent customer text."""
    if not isinstance(value, str):
        return ""
    return " ".join(ACTION_WORDS.findall(value[:300]))[:100]


def sanitized_snippet(source):
    """Small fail-closed JS lexer; never export an unrecognized lexical form.

    Only native routes, HTTP methods and exact benign action-flag selectors
    survive. Templates and regular expressions are deliberately metadata-only
    rather than risk their nested literal/comment syntax exposing a value.
    """
    if not isinstance(source, str) or len(source) > 65536 or "`" in source:
        return None
    out, index = [], 0
    while index < len(source):
        rest = source[index:]
        char = source[index]
        if rest.startswith("//"):
            end = source.find("\n", index + 2)
            index = len(source) if end < 0 else end
            out.append("/* redacted comment */")
        elif rest.startswith("/*"):
            end = source.find("*/", index + 2)
            if end < 0:
                return None
            index = end + 2
            out.append("/* redacted comment */")
        elif char in "\"'":
            end = index + 1
            while end < len(source):
                if source[end] == "\\":
                    end += 2
                elif source[end] == char:
                    break
                elif source[end] in "\r\n":
                    return None
                else:
                    end += 1
            if end >= len(source):
                return None
            literal = source[index + 1:end]
            kept = literal if (NATIVE_ROUTE.fullmatch(literal) or literal in BENIGN_LITERALS | {"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"}) else "[redacted]"
            out.append(json.dumps(kept))
            index = end + 1
        elif char == "/":
            return None
        elif char.isspace():
            out.append(" ")
            index += 1
        elif re.match(r"[A-Za-z_$]", char):
            token = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", rest).group(0)
            out.append("REDACTED" if SENSITIVE.search(token) else token if token in JS_WORDS or ACTION_FUNCTION.fullmatch(token) else "IDENT")
            index += len(token)
        elif char.isascii() and char.isdigit():
            token = re.match(r"[0-9][A-Za-z0-9_.]*", rest).group(0)
            out.append(token if token in {"0", "1"} else "NUMBER")
            index += len(token)
        elif char in "(){}[];.,:+-*=!<>&|?%^~":
            out.append(char)
            index += 1
        else:
            return None
    clean = re.sub(r"\s+", " ", "".join(out)).strip()
    native = clean.find("/staff/project-purchase-order-print/")
    start = max(0, native - 350) if native >= 0 else 0
    return clean[start:start + 1800]


METADATA_JS = r"""() => {
 const get=el=>el?.getAttribute?.bind(el);
 const relevant=/\b(?:print|view|download|pdf|preview)\b/i;
 const nativeName=/\b((?:native)?(?:print|download|view|preview)(?:PO|PurchaseOrder|Document|PDF|File|Order)?)\s*\(/gi;
 const jq=window.jQuery||window.$;let handlerRecords=0,handlerBytes=0;
 const handlers=(el,inline)=>{
  const sources=[],seen=new Set();
  const add=(kind,fn)=>{
   if(typeof fn!=='function'||seen.has(fn)||sources.length>=3||handlerRecords>=40)return;
   seen.add(fn);handlerRecords++;
   try {
    const source=Function.prototype.toString.call(fn);
    const fits=source.length<=65536&&handlerBytes+source.length<=524288;
    sources.push({kind,source:fits?source:null});if(fits)handlerBytes+=source.length;
   }catch {sources.push({kind,source:null});}
  };
  // Read native properties and registered callbacks; never invoke a callback.
  add('onclick-property',el.onclick);
  // Own data descriptors avoid invoking a named global's getter. Prefer the
  // referenced print function to incidental jQuery callbacks when slots fill.
  nativeName.lastIndex=0;let match;
  while((match=nativeName.exec(inline.slice(0,1800)))&&sources.length<3&&handlerRecords<40) {
   try {add('named-global',Object.getOwnPropertyDescriptor(window,match[1])?.value);}catch {}
  }
  if(typeof jq==='function'&&typeof jq._data==='function') {
   try {
    const events=jq._data(el,'events');
    if(Array.isArray(events?.click))for(const entry of events.click.slice(0,3))add('jquery-click',Object.getOwnPropertyDescriptor(entry,'handler')?.value);
   }catch {}
  }
  return sources;
 };
 const controls=[];
 for(const el of document.querySelectorAll('a,button,input[type="button"],input[type="submit"],[role="button"]')) {
  const a=get(el),label=(el.tagName==='INPUT'?el.value:el.textContent)||a('aria-label')||a('title')||'';
  const href=a('href')||'',onclick=a('onclick')||'';
  if(!relevant.test(label+' '+href+' '+onclick))continue;
  const form=el.form||el.closest?.('form');
  controls.push({tag:el.tagName,label:label.slice(0,300),href:href.slice(0,2048),type:a('type'),target:a('target'),
   visible:el.getClientRects().length>0,formMethod:form?.getAttribute('method')||null,
   formAction:form?.getAttribute('action')||null,onclick:onclick.length<=1800?onclick:null,
   handlerSources:handlers(el,onclick)});
  if(controls.length>=40)break;
 }
 const embedded=[];
 for(const el of document.querySelectorAll('iframe[src],embed[src],object[data]')) {
  const src=el.getAttribute('src')||el.getAttribute('data')||'';
  embedded.push({tag:el.tagName,type:el.getAttribute('type'),src:src.slice(0,2048)});
  if(embedded.length>=20)break;
 }
 const snippets=[];
 for(const script of document.scripts) {
  if(script.src)continue;
  const source=script.textContent||'';
  // Supply complete lexical input, never a slice that could begin inside a
  // string/comment. Python exports only a sanitized bounded target context.
  if(source.includes('/staff/project-purchase-order-print/'))snippets.push(source.length<=65536?source:null);
  if(snippets.length>=12)break;
 }
 const actionFlags=[];
 for(const name of ['form[Print]','form[Email]','form[Outlook]','form[MarkSent]']) {
  const el=document.getElementsByName(name)[0];if(!el)continue;
  actionFlags.push({name,type:el.type,checked:el.checked===true,enabled:el.disabled!==true});
 }
 const numbers=[...new Set(((document.body?.innerText||'').match(/Purchase Order\s*#\s*(PO\d+)/gi)||[]).map(text=>text.match(/PO\d+/i)[0].toUpperCase()))];
 return {hasLines:!!document.querySelector('[name="form[Lines]"]'),numbers,controls,embedded,snippets,actionFlags};
}"""


def clean_metadata(raw):
    # Handler introspection should not make a busy page's report unbounded.
    source_budget = 32 * 1024

    def clean_source(source):
        nonlocal source_budget
        clean = sanitized_snippet(source)
        size = len(clean.encode()) if clean is not None else 0
        if size > source_budget:
            return None
        source_budget -= size
        return clean

    controls = []
    for item in raw.get("controls", [])[:40]:
        method = item.get("formMethod")
        sources = []
        for source in item.get("handlerSources", [])[:3]:
            if source.get("kind") not in {"onclick-property", "jquery-click", "named-global"}:
                continue
            clean = clean_source(source.get("source"))
            sources.append({"kind": source["kind"], "sanitized": clean, "metadataOnly": clean is None})
        controls.append({"tag": item.get("tag") if item.get("tag") in {"A", "BUTTON", "INPUT", "DIV", "SPAN"} else "OTHER",
                         "label": action_label(item.get("label")), "href": url_metadata(item.get("href")),
                         "type": item.get("type") if item.get("type") in {"button", "submit", "reset"} else None,
                         "target": item.get("target") if item.get("target") in {"_blank", "_self", "_top", "_parent"} else None,
                         "visible": item.get("visible") is True,
                         "formMethod": method.upper() if isinstance(method, str) and method.upper() in {"GET", "POST"} else None,
                         "formAction": url_metadata(item.get("formAction")),
                         "onclick": clean_source(item.get("onclick")), "handlerSources": sources})
    embedded = [{"tag": item.get("tag") if item.get("tag") in {"IFRAME", "EMBED", "OBJECT"} else "OTHER",
                 "pdfType": item.get("type") == "application/pdf", "source": url_metadata(item.get("src"))}
                for item in raw.get("embedded", [])[:20]]
    snippets = []
    for source in raw.get("snippets", [])[:12]:
        clean = clean_source(source)
        snippets.append({"containsNativePrintRoute": True, "sanitized": clean,
                         "metadataOnly": clean is None})
    flags = [{"name": item["name"], "type": item.get("type") if item.get("type") in {"checkbox", "radio", "hidden", "button", "submit"} else "other",
              "checked": item.get("checked") is True, "enabled": item.get("enabled") is True}
             for item in raw.get("actionFlags", [])[:4]
             if item.get("name") in {"form[Print]", "form[Email]", "form[Outlook]", "form[MarkSent]"}]
    return {"controls": controls, "embedded": embedded, "nativePrintHandlers": snippets, "actionFlags": flags}


def atomic_report(path, report):
    encoded = (json.dumps(report, indent=2, ensure_ascii=True) + "\n").encode()
    require(len(encoded) <= MAX_REPORT_BYTES, "Inspection report exceeds its safe size limit.")
    path = Path(path)
    require(not path.is_symlink(), "Choose a regular report destination.")
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-po-document-", dir=path.parent)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded)
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


def inspect_browser(browser, project, order_id, number):
    target = f"/staff/project-purchase-order-modify/{project}/{order_id}"
    signed_in = next((context for context in browser.contexts if any(
        page.url.startswith(ORIGIN + "/staff/") and "/login" not in page.url
        for page in context.pages)), None)
    require(signed_in is not None, "Sign into Nexvia in the existing NAS browser first.")
    # Copy Nexvia authentication into memory only. The user's existing context,
    # tabs, routes and service workers are never changed or closed.
    state = signed_in.storage_state()
    state = {"cookies": [cookie for cookie in state.get("cookies", [])
                         if cookie.get("domain", "").lstrip(".") in {"lennox.nexvia.com.au", "nexvia.com.au"}],
             "origins": [origin for origin in state.get("origins", []) if origin.get("origin") == ORIGIN]}
    context = browser.new_context(storage_state=state, service_workers="block", accept_downloads=False)
    blocked, blocked_total = [], 0

    def guard(route):
        nonlocal blocked_total
        request = route.request
        if allow_request(request.url, request.method, target, request.resource_type):
            route.continue_()
            return
        blocked_total += 1
        method = request.method.upper() if request.method.upper() in READ_METHODS | {"POST", "PUT", "PATCH", "DELETE"} else "OTHER"
        entry = {"method": method, "destination": url_metadata(request.url)}
        prior = next((row for row in blocked if row["method"] == entry["method"] and row["destination"] == entry["destination"]), None)
        if prior:
            prior["count"] += 1
        elif len(blocked) < 40:
            blocked.append({**entry, "count": 1})
        route.abort()

    try:
        # Context routing also guards a popup's first request, which page-level
        # routing cannot intercept. Service workers cannot bypass this context.
        context.route("**/*", guard)
        require(callable(getattr(context, "route_web_socket", None)),
                "This inspection requires the installed browser websocket guard.")
        context.route_web_socket("**/*", lambda socket: socket.close())
        context.add_init_script("window.open = () => null; window.print = () => undefined;")
        page = context.new_page()
        response = page.goto(ORIGIN + target, wait_until="domcontentloaded", timeout=45000)
        require(response is not None and response.status == 200 and page.url == ORIGIN + target,
                "The existing PO page could not be inspected safely.")
        page.locator('[name="form[Lines]"]').wait_for(state="attached", timeout=15000)
        raw = page.evaluate(METADATA_JS)
        require(raw.get("hasLines") is True and raw.get("numbers") == [number],
                "The existing PO number could not be verified; no report was saved.")
        return {"format": "nexvia-po-document-discovery", "version": 1,
                "capturedAt": datetime.now(timezone.utc).isoformat(), "readOnly": True,
                "projectPageId": project, "purchaseOrderId": order_id,
                "purchaseOrderNumber": number, "verifiedPage": target,
                "documentActionInvoked": False, **clean_metadata(raw),
                "blockedRequests": blocked, "blockedRequestCount": blocked_total}
    finally:
        context.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--po", required=True)
    parser.add_argument("--number", required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    project, order_id, number = positive_id(args.project), positive_id(args.po), po_number(args.number)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
        report = inspect_browser(browser, project, order_id, number)
    atomic_report(args.output, report)
    print("Read-only PO document discovery saved:", args.output)
    print("Document controls:", len(report["controls"]))
    print("Native print handler records:", len(report["nativePrintHandlers"]))
    print("No PO was created or changed. No print, download or email action was invoked.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Browser/network exception strings may contain private URLs or data.
        print("PO document inspection stopped safely. Check browser sign-in, PO identity and the supported Playwright installation.")
        raise SystemExit(1)
