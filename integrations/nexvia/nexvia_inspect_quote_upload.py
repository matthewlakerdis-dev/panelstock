#!/usr/bin/env python3
"""Inspect native quote-file controls without selecting, uploading or saving.

Only structural control, transport and callback metadata is exported. Browser
authentication stays in memory; no form values, file names or query values are
saved. The original signed-in browser context is left unchanged.
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import unicodedata
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit


ORIGIN = "https://lennox.nexvia.com.au"
OUTPUT = Path("/config/nexvia-quote-upload-discovery.json")
MAX_REPORT = 128 * 1024
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
CACHE_KEYS = {"v", "ver", "version", "_", "hash", "cache", "build", "rev", "t"}
STATIC_EXT = re.compile(r"\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$", re.I)
STATIC_PREFIXES = ("/staff/js/", "/staff/css/", "/staff/assets/", "/staff/images/", "/staff/fonts/", "/staff/plugins/",
                   "/js/", "/css/", "/assets/", "/images/", "/fonts/", "/scripts/", "/content/", "/plugins/")
SENSITIVE = re.compile(r"password|passwd|secret|token|csrf|cookie|authorization|session|signature|credential", re.I)
ACTION = re.compile(r"purchase-order-(?:print|add|modify|delete|send)|/staff/(?:upload|file|files)/|/(?:sent|send|delete|remove|logout|save|email)(?:/|$)", re.I)
STRUCTURE = {"staff", "upload", "file", "files", "details", "getFiles", "get", "add", "save", "remove", "delete",
             "download", "read", "list", "purchase-order", "purchase-orders", "project", "projects", "attachment",
             "attachments", "document", "documents", "general-file", "general-files", "project-purchase-order-add",
             "project-purchase-order-modify"}
KNOWN_FIELDS = {"id", "file_id", "general_file_id", "document_id", "files", "file", "name", "file_name", "filename",
                "size", "type", "url", "uid", "extension", "status", "_resp", "_success", "_html", "response",
                "result", "data", "rawResponse", "validationErrors", "error", "message", "total", "loaded", "inputs", "fields",
                "value", "fileId", "fileName", "fileSize", "fileType", "uploadUrl", "upload_url", "file_url"}
SAFE_NAMES = KNOWN_FIELDS | {"form[Files][]", "form[Files]", "file[]", "files[]", "upload", "uploads", "uploader", "fileupload",
                            "filedata", "qqfile", "qqfiles[]", "folder_id", "parent_id", "object_id", "object_type", "model_id",
                            "model_type", "job_id", "project_id", "purchase_order_id", "job_purchase_order_id", "entity_id", "entity_type",
                            "url", "saveUrl", "removeUrl", "readUrl", "read", "create", "update", "destroy", "formData", "params",
                            "upload", "success", "complete", "select", "add", "done", "change", "submit", "onchange",
                            "registered-change", "delegated-change", "referenced-function", "data-url", "data-upload-url",
                            "data-save-url", "data-remove-url", "data-read-url", "data-param-name", "data-field-name", "inline-upload-init"}
SAFE_NAMES_NORMALIZED = {re.sub(r"[^a-z0-9]", "", value.lower()) for value in SAFE_NAMES}
POLICY_FIELDS = {"key", "acl", "policy", "signature", "GoogleAccessId", "Content-Type", "success_action_status",
                 "success_action_redirect", "x-goog-algorithm", "x-goog-credential", "x-goog-date", "x-goog-signature"}
SYMBOL_WORDS = KNOWN_FIELDS | SAFE_NAMES | POLICY_FIELDS | set("function return var let const if else new this true false null undefined typeof throw try catch finally for while break continue window document FormData JSON parse stringify Object Array String Number Math encodeURIComponent decodeURIComponent $ jQuery ajax get post then done fail always promise submit append appendTo val attr prop find filter each map forEach serializeArray length value key form target currentTarget contentType processData dataType beforeSend headers async remove push replace test split join indexOf trim".split())
EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".dwg", ".dxf", ".zip"}
ACCEPT_TYPES = {"*", "*/*", "application/pdf", "application/octet-stream", "image/*"} | EXTENSIONS


def require(condition):
    if not condition:
        raise ValueError("Quote upload inspection stopped safely.")


def route_info(value):
    if not isinstance(value, str) or not value or len(value) > 4096:
        return None
    try:
        parsed = urlsplit(urljoin(ORIGIN, value))
        if parsed.scheme != "https" or parsed.netloc != "lennox.nexvia.com.au":
            host = parsed.hostname or ""
            provider = "gcs" if host in {"storage.googleapis.com", "storage.cloud.google.com", "upload.storage.googleapis.com"} or host.endswith(".storage.googleapis.com") else "other"
            pieces = [part for part in parsed.path.split("/") if part]
            return {"externalOrNonHttp": True, "scheme": parsed.scheme if parsed.scheme in {"https", "http"} else "other",
                    "host": host if host in {"storage.googleapis.com", "storage.cloud.google.com", "upload.storage.googleapis.com"} else "[other]",
                    "provider": provider, "pathClass": "root" if not pieces else "bucket" if len(pieces) == 1 else "bucket/object"}
        parts = []
        for index, part in enumerate(parsed.path.split("/")):
            if not part or part in STRUCTURE:
                parts.append(part)
            elif part.isdigit():
                parts.append("[id]")
            else:
                parts.append("[redacted]")
        names = []
        for key, _ in parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=40):
            safe = key if key in CACHE_KEYS | {"id", "type", "file", "files", "project", "job", "format", "callback"} else "[redacted]"
            if safe not in names:
                names.append(safe)
        return {"path": "/".join(parts)[:400], "queryKeys": names[:20]}
    except (ValueError, TypeError):
        return None


def static_url(value):
    try:
        url = urljoin(ORIGIN, value)
        parsed = urlsplit(url)
        require(parsed.scheme == "https" and parsed.netloc == "lennox.nexvia.com.au" and not parsed.fragment
                and parsed.path.lower().startswith(STATIC_PREFIXES)
                and not ACTION.search(parsed.path) and "%" not in parsed.path and "\\" not in parsed.path
                and not any(part in {".", ".."} for part in parsed.path.split("/")) and STATIC_EXT.search(parsed.path)
                and all(key.lower() in CACHE_KEYS for key, _ in parse_qsl(parsed.query, max_num_fields=20)))
        return url
    except (ValueError, TypeError):
        return None


def allow_request(url, method, targets, assets, resource_type):
    if method.upper() not in READ_METHODS:
        return False
    if url in targets:
        return True
    return resource_type in {"script", "stylesheet", "image", "font"} and url in assets and static_url(url) == url


def field_name(value):
    if isinstance(value, str) and value in POLICY_FIELDS:
        return value
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_\[\].-]{0,99}", value) and re.sub(r"[^a-z0-9]", "", value.lower()) in SAFE_NAMES_NORMALIZED and not SENSITIVE.search(value) else "[redacted]"


def symbolic_source(source):
    """Tokenize complete callbacks; all unknown identifiers/values are aliases."""
    if not isinstance(source, str) or len(source) > 65536 or "`" in source:
        return None
    tokens, aliases, index, previous = [], {}, 0, ""
    while index < len(source):
        rest, char = source[index:], source[index]
        if rest.startswith("//"):
            end = source.find("\n", index + 2)
            index = len(source) if end < 0 else end
            continue
        if rest.startswith("/*"):
            end = source.find("*/", index + 2)
            if end < 0:
                return None
            index = end + 2
            continue
        if char in "\"'":
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
            literal = source[index + 1:end].replace("\\/", "/")
            token = json.dumps(literal) if literal in SYMBOL_WORDS | {"GET", "POST", "PUT", "DELETE", "HEAD", "form[Files][]", "form[Files]"} else "VALUE"
            if "form[Files]" in literal and re.search(r"<\s*(?:input|div|span|section|tr|td)\b", literal, re.I):
                token = "FILES_HIDDEN_MARKUP"
            elif literal.startswith("/staff/"):
                token = "NATIVE_ROUTE"
            elif literal.startswith(("https://", "http://")):
                token = "REMOTE_ROUTE"
            index = end + 1
        elif char == "/" and previous in {"", "(", "=", ":", ",", "return", "!", "[", "?"}:
            end, in_class = index + 1, False
            while end < len(source):
                if source[end] == "\\":
                    end += 2
                    continue
                if source[end] == "[":
                    in_class = True
                elif source[end] == "]":
                    in_class = False
                elif source[end] == "/" and not in_class:
                    break
                end += 1
            if end >= len(source):
                return None
            index = end + 1
            while index < len(source) and source[index].isalpha():
                index += 1
            token = "REGEXP"
        elif char.isspace():
            index += 1
            continue
        elif re.match(r"[A-Za-z_$]", char):
            value = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", rest).group()
            if value not in SYMBOL_WORDS:
                aliases.setdefault(value, "v" + str(len(aliases) + 1))
            token = value if value in SYMBOL_WORDS else aliases[value]
            index += len(value)
        elif char.isascii() and char.isdigit():
            value = re.match(r"[0-9][A-Za-z0-9_.]*", rest).group()
            token = value if value in {"0", "1"} else "NUMBER"
            index += len(value)
        elif char in "(){}[];.,:+-*/=<>!&|?%^~":
            token, index = char, index + 1
        else:
            return None
        tokens.append(token)
        previous = token
    symbolic = " ".join(tokens)
    if len(symbolic) <= 700:
        return symbolic
    # Keep native Files binding even when it occurs at the tail of a large
    # initializer. Every fragment is selected AFTER all values are redacted.
    windows = []
    for marker in ('FILES_HIDDEN_MARKUP', '"form[Files][]"', '"form[Files]"', 'general_file_id', 'file_id', '_resp', 'NATIVE_ROUTE'):
        cursor = 0
        for _ in range(2):
            found = symbolic.find(marker, cursor)
            if found < 0:
                break
            start, end = max(0, found - 250), min(len(symbolic), found + 950)
            if not any(start < right and end > left for left, right in windows):
                windows.append((start, end))
            cursor = found + len(marker)
        if len(windows) >= 2:
            break
    fragments = [symbolic[left:right] for left, right in windows[:2]]
    fragments.extend([symbolic[:500], symbolic[-650:]])
    return " ... ".join(dict.fromkeys(fragments))[:3600]


def handler_info(source):
    if not isinstance(source, str) or len(source) > 65536:
        return {"available": False}
    routes = []
    for value in re.findall(r"https?://[^\s\"'<>]+|/staff/[A-Za-z0-9_./-]+", source):
        if value.startswith("/staff/") and not re.search(r"upload|file|attachment|document", value, re.I):
            continue
        safe = route_info(value)
        if safe and safe not in routes:
            routes.append(safe)
    fields = sorted({value for value in re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\b", source) if value in KNOWN_FIELDS})
    return {"available": True, "routes": routes[:12], "httpMethods": sorted(set(re.findall(r"[\"'](GET|POST|PUT|PATCH|DELETE|HEAD)[\"']", source))),
            "mentionsFilesField": "form[Files][]" in source or "form[Files]" in source,
            "usesFormData": bool(re.search(r"\bFormData\b", source)), "appendsData": bool(re.search(r"\.append\s*\(", source)),
            "formDataFields": list(dict.fromkeys(field_name(value) for value in re.findall(r"\.append\s*\(\s*[\"']([^\"'\r\n]{1,100})[\"']", source)))[:20],
            "symbolic": symbolic_source(source),
            "responseFields": fields, "sensitiveFieldsPresent": bool(SENSITIVE.search(source))}


INSPECT_JS = r"""() => {
 const jq=window.jQuery||window.$,inputs=[],handlers=[],seenHandlers=new Set();let sourceBytes=0;
 const own=(object,name)=>{try{return object&&Object.getOwnPropertyDescriptor(object,name)?.value;}catch{return undefined;}};
 const addSource=(kind,fn)=>{if(typeof fn!=='function'||seenHandlers.has(fn)||handlers.length>=40)return;seenHandlers.add(fn);try{const source=Function.prototype.toString.call(fn);if(source.length<=65536&&sourceBytes+source.length<=524288){handlers.push({kind,source});sourceBytes+=source.length;}}catch{}};
 const shape=value=>({kind:Array.isArray(value)?'array':value===null?'null':typeof value,
   ...(Array.isArray(value)?{count:Math.min(value.length,10000),itemFields:value[0]&&typeof value[0]==='object'?Object.entries(value[0]).slice(0,30).map(([name,value])=>({name,kind:Array.isArray(value)?'array':value===null?'null':typeof value})):[]}:{}),
   ...(typeof value==='string'?{empty:value.length===0}:{})});
 const references=source=>{for(const match of [...String(source||'').slice(0,1800).matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*){0,2})\s*\(/g)].slice(0,12)){
  let value=window;for(const part of match[1].split('.')){value=own(value,part);if(value===undefined)break;}addSource('referenced-function',value);
 }};
 for(const el of document.querySelectorAll('input[type="file"]')) {
  const form=el.form||el.closest('form'),widgets=[],attributes=[];
  for(const attr of el.attributes||[])if(/^data-(?:url|upload|save|remove|read|param|field)/i.test(attr.name))attributes.push({name:attr.name,value:attr.value});
  let data={};if(typeof jq==='function')try{data=jq(el).data()||{};}catch{}
  const candidates=[...Object.values(data),el.dropzone].filter(value=>value&&typeof value==='object'&&value.options);
  for(const widget of [...new Set(candidates)].slice(0,6)){
   const options=widget.options||{},async=options.async||{},transport=options.transport||{};
   const routes=[];for(const [owner,names] of [[options,['url','saveUrl','removeUrl','readUrl']],[async,['saveUrl','removeUrl']],[transport,['read','create','update','destroy']]])for(const name of names){const value=owner[name];if(typeof value==='string')routes.push({purpose:name,url:value,valueKind:'string'});else if(value&&typeof value==='object')routes.push({purpose:name,url:value.url,method:value.type||value.method,valueKind:'object'});else if(typeof value==='function'){routes.push({purpose:name,valueKind:'function'});addSource(name,value);}}
   const params={};for(const name of ['paramName','saveField','removeField','method','type','autoUpload','multiple','uploadMultiple','batch','chunkSize','maxFileSize']){const value=options[name]??async[name]??options.validation?.[name];if(value!==undefined)params[name]=value;}
   const fields={};for(const name of ['formData','data','params']){const value=options[name]??async[name];fields[name]=shape(value);if(Array.isArray(value))fields[name].fields=value.slice(0,30).map(row=>({name:row?.name,shape:shape(row?.value)}));else if(value&&typeof value==='object')fields[name].fields=Object.entries(value).slice(0,30).map(([name,value])=>({name,shape:shape(value)}));addSource(name,value);}
   for(const name of ['upload','success','complete','select','error','add','done','change','submit']){addSource(name,options[name]);for(const fn of (widget._events?.[name]||[]).slice(0,3))addSource(name,fn);}
   widgets.push({kind:widget.options?.name||'',routes,params,fields,filesShape:shape(options.files),allowedExtensions:options.validation?.allowedExtensions||[]});
  }
  const inline=el.getAttribute('onchange')||'';addSource('onchange',el.onchange);references(inline);
  if(typeof jq==='function'&&typeof jq._data==='function'){
   const nodes=[el];for(let node=el.parentElement,depth=0;node&&depth<6;node=node.parentElement,depth++)nodes.push(node);nodes.push(document);
   for(const node of nodes)try{for(const entry of (jq._data(node,'events')?.change||[]).slice(0,6)){
    const selector=own(entry,'selector');if(selector&&!el.matches(selector))continue;
    const fn=own(entry,'handler');addSource(node===el?'registered-change':'delegated-change',fn);
    if(typeof fn==='function')references(Function.prototype.toString.call(fn));
   }}catch{}
  }
  inputs.push({name:el.name||'',id:el.id||'',multiple:el.multiple===true,disabled:el.disabled===true,
   accept:el.accept||'',selectedCount:el.files?.length||0,visible:el.getClientRects().length>0,
   form:form?{method:form.getAttribute('method')||'GET',action:form.getAttribute('action')||location.href,enctype:form.enctype}:null,
   attributes,widgets});if(inputs.length>=12)break;
 }
 const fields=[];for(const el of document.querySelectorAll('[name="form[Files][]"],[name="form[Files]"]')){
  const value=String(el.value||'');let kind=value===''?'empty':/^[0-9]+$/.test(value)?'numeric':'opaque';
  fields.push({name:el.name,tag:el.tagName,type:el.type||'',kind});if(fields.length>=40)break;
 }
 const numbers=[...new Set([...String(document.body?.innerText||'').matchAll(/Purchase Order\s*#\s*(PO\d+)/gi)].map(match=>match[1].toUpperCase()))];
 const lines=document.querySelector('[name="form[Lines]"]');let linesKind='missing',lineCount=null,lineRows=[];
 if(lines){const text=String(lines.value||'');if(!text.trim()){linesKind='empty_string';lineCount=0;}else try{const value=JSON.parse(text);linesKind=Array.isArray(value)?'array':value===null?'null':'other';if(Array.isArray(value)){lineCount=value.length;lineRows=value;}else if(value===null)lineCount=0;}catch{linesKind='invalid';}}
 const nativeForm=lines?.form?{method:lines.form.getAttribute('method')||'GET',action:lines.form.getAttribute('action')||location.href,linesKind,lineCount}:null;
 const formValue=name=>String(document.getElementsByName(name)[0]?.value||'');
 const nativeContext={service:formValue('form[ServiceId]'),eows:[...new Set([formValue('form[BreakdownType]'),...lineRows.slice(0,1000).map(row=>row?.breakdown_type)].filter(value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value)))]};
 const downloads=[];for(const el of document.querySelectorAll('a[href]')){const href=el.getAttribute('href')||'';if(/download/i.test(el.textContent||'')||el.hasAttribute('download')||/storage\.googleapis\.com/.test(href))downloads.push(href);if(downloads.length>=12)break;}
 const savedFileCards=[];for(const input of [...document.querySelectorAll('[name="form[Files][]"],[name="form[Files]"]')].slice(0,12)){
  const identity=String(input.value||'');if(!/^[0-9]+$/.test(identity))continue;
  let matched=null;const ancestry=[];
  for(let node=input.parentElement,depth=0;node&&depth<8&&!['FORM','BODY','HTML'].includes(node.tagName);node=node.parentElement,depth++){
   const hidden=[...node.querySelectorAll('[name="form[Files][]"],[name="form[Files]"]')].slice(0,41),links=[...node.querySelectorAll('a[href]')].slice(0,30).filter(el=>/download/i.test(el.textContent||'')||el.hasAttribute('download'));
   const text=String(node.innerText||'').slice(0,12000),labels={name:/\bName\s*:/i.test(text),size:/\bSize\s*:/i.test(text),download:/\bDownload(?: File)?\b/i.test(text),remove:/\bRemove(?: File)?\b/i.test(text)};
   ancestry.push({depth,tag:node.tagName,hiddenFields:hidden.length,downloadCount:links.length});
   if(hidden.length===1&&hidden[0]===input&&links.length===1&&Object.values(labels).every(Boolean)){
    const link=links[0],href=link.getAttribute('href')||'';let pathContainsId=false;try{pathContainsId=new URL(href,location.href).pathname.split('/').includes(identity);}catch{}
    const idAttributes=['id','data-id','data-file-id'].filter(name=>node.getAttribute(name)===identity||link.getAttribute(name)===identity);
    matched={depth,tag:node.tagName,hiddenFields:1,downloadCount:1,labels,download:href,downloadPathContainsFileId:pathContainsId,idAttributeMatches:idAttributes};break;
   }
  }
  savedFileCards.push({numericNativeId:true,ancestry,association:matched});
 }
 const text=String(document.body?.innerText||'');
 // Structural fallback if native widget initialization depends on an asset
 // the strict reader blocked. Never evaluate or export the script itself.
 for(const script of document.scripts||[]){if(script.src||handlers.length>=40)continue;const source=script.textContent||'';
  if(source.length<=65536&&sourceBytes+source.length<=524288&&/form\[Files\]|\/staff\/(?:upload|file)\//i.test(source)){
   handlers.push({kind:'inline-upload-init',source});sourceBytes+=source.length;
  }
 }
 return {hasLines:!!lines,numbers,nativeForm,nativeContext,downloads,savedFileCards,inputs,fields,handlers,
   completion:{kendoSuccessCount:document.querySelectorAll('.k-file-success,[data-upload-status="success"],[data-status="uploaded"]').length,
    progressCount:document.querySelectorAll('.k-file-progress,.k-file-error,[data-upload-status="pending"],[data-upload-status="uploading"]').length,
    fileCardLabels:{name:/\bName\s*:/i.test(text),size:/\bSize\s*:/i.test(text),download:/\bDownload(?: File)?\b/i.test(text),remove:/\bRemove(?: File)?\b/i.test(text)}}};
}"""


def clean_report(raw):
    inputs = []
    for item in raw.get("inputs", [])[:12]:
        widgets = []
        for widget in item.get("widgets", [])[:6]:
            params = {}
            for key, value in widget.get("params", {}).items():
                if key in {"autoUpload", "multiple", "uploadMultiple", "batch"} and type(value) is bool:
                    params[key] = value
                elif key in {"chunkSize", "maxFileSize"} and type(value) is int and 0 <= value <= 1024**3:
                    params[key] = value
                elif key in {"method", "type"} and isinstance(value, str) and value.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                    params[key] = value.upper()
                elif key in {"paramName", "saveField", "removeField"}:
                    params[key] = field_name(value)
            fields = {}
            for key, value in widget.get("fields", {}).items():
                if key in {"formData", "data", "params"} and isinstance(value, dict):
                    fields[key] = {"kind": value.get("kind") if value.get("kind") in {"undefined", "null", "string", "number", "boolean", "object", "array", "function"} else "other",
                                   "fields": [{"name": field_name(row.get("name")), "kind": row.get("shape", {}).get("kind") if row.get("shape", {}).get("kind") in {"string", "number", "boolean", "object", "array", "null"} else "other"} for row in value.get("fields", [])[:30]]}
            widgets.append({"kind": widget.get("kind") if widget.get("kind") in {"Upload", "kendoUpload", "fileupload", "Dropzone"} else "native-file-widget",
                            "routes": [{"purpose": field_name(row.get("purpose")), "destination": route_info(row.get("url")), "valueKind": row.get("valueKind") if row.get("valueKind") in {"string", "object", "function"} else "other",
                                        "method": row.get("method").upper() if isinstance(row.get("method"), str) and row["method"].upper() in READ_METHODS | {"POST", "PUT", "PATCH", "DELETE"} else None} for row in widget.get("routes", [])[:12]],
                            "params": params, "fields": fields,
                            "filesShape": {"kind": widget.get("filesShape", {}).get("kind") if widget.get("filesShape", {}).get("kind") in {"undefined", "null", "array", "object"} else "other",
                                           "count": min(widget["filesShape"]["count"], 10000) if type(widget.get("filesShape", {}).get("count")) is int and widget["filesShape"]["count"] >= 0 else None,
                                           "itemFields": [{"name": field_name(row.get("name")), "kind": row.get("kind") if row.get("kind") in {"string", "number", "boolean", "array", "object", "null"} else "other"} for row in widget.get("filesShape", {}).get("itemFields", [])[:30]]},
                            "allowedExtensions": [value for value in widget.get("allowedExtensions", [])[:20] if isinstance(value, str) and value.lower() in EXTENSIONS]})
        form = item.get("form")
        inputs.append({"name": field_name(item.get("name")), "id": field_name(item.get("id")),
                       "multiple": item.get("multiple") is True, "disabled": item.get("disabled") is True,
                       "visible": item.get("visible") is True, "selectedCount": min(item.get("selectedCount", 0), 10000),
                       "accept": [value.strip() for value in str(item.get("accept", "")).split(",")[:20] if value.strip().lower() in ACCEPT_TYPES],
                       "form": {"method": str(form.get("method", "")).upper() if str(form.get("method", "")).upper() in {"GET", "POST"} else "other",
                                "action": route_info(form.get("action")), "multipart": form.get("enctype") == "multipart/form-data"} if isinstance(form, dict) else None,
                       "attributes": [{"name": field_name(row.get("name")), "destination": route_info(row.get("value"))} for row in item.get("attributes", [])[:20]], "widgets": widgets})
    native = raw.get("nativeForm")
    summaries, symbolic_budget = [], 12000
    for row in raw.get("handlers", [])[:40]:
        info = handler_info(row.get("source"))
        symbolic = info.get("symbolic")
        if symbolic and len(symbolic) <= symbolic_budget:
            symbolic_budget -= len(symbolic)
        elif symbolic:
            info["symbolic"] = None
        summaries.append({"kind": field_name(row.get("kind")), **info})
    safe_tag = lambda value: value if value in {"DIV", "SPAN", "SECTION", "ARTICLE", "TR", "TD", "LI", "UL", "OL", "P", "FIELDSET"} else "OTHER"
    cards = []
    for row in raw.get("savedFileCards", [])[:12]:
        association = row.get("association")
        cards.append({"numericNativeId": row.get("numericNativeId") is True,
                      "ancestry": [{"depth": min(int(item.get("depth", 0)), 8), "tag": safe_tag(item.get("tag")),
                                    "hiddenFields": min(int(item.get("hiddenFields", 0)), 41), "downloadCount": min(int(item.get("downloadCount", 0)), 30)}
                                   for item in row.get("ancestry", [])[:8]],
                      "association": {"depth": min(int(association.get("depth", 0)), 8), "tag": safe_tag(association.get("tag")),
                                      "hiddenFields": 1, "downloadCount": 1, "download": route_info(association.get("download")),
                                      "downloadPathContainsFileId": association.get("downloadPathContainsFileId") is True,
                                      "idAttributeMatches": [value for value in association.get("idAttributeMatches", []) if value in {"id", "data-id", "data-file-id"}]} if isinstance(association, dict) else None})
    return {"fileInputs": inputs, "downloadLinks": [route_info(value) for value in raw.get("downloads", [])[:12]], "savedFileCards": cards,
            "nativeForm": {"method": native.get("method").upper() if isinstance(native.get("method"), str) and native["method"].upper() in {"GET", "POST"} else "other",
                           "action": route_info(native.get("action")), "linesKind": native.get("linesKind") if native.get("linesKind") in {"empty_string", "array", "null", "missing", "invalid", "other"} else "other",
                           "lineCount": min(native["lineCount"], 10000) if type(native.get("lineCount")) is int and native["lineCount"] >= 0 else None} if isinstance(native, dict) else None,
            "filesFields": [{"name": row.get("name") if row.get("name") in {"form[Files][]", "form[Files]"} else "[redacted]",
                             "kind": row.get("kind") if row.get("kind") in {"empty", "numeric", "opaque"} else "other"} for row in raw.get("fields", [])[:40]],
            "handlers": summaries,
            "completion": {key: min(value, 10000) if type(value) is int and value >= 0 else {name: value.get(name) is True for name in ["name", "size", "download", "remove"]}
                           for key, value in raw.get("completion", {}).items() if key in {"kendoSuccessCount", "progressCount", "fileCardLabels"}}}


class ContextUnavailable(ValueError):
    pass


def cached_json(path):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022:
                raise ContextUnavailable("cache_invalid")
            raw = stream.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ContextUnavailable("cache_invalid")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ContextUnavailable("cache_invalid")
        return value
    except ContextUnavailable:
        raise
    except Exception:
        raise ContextUnavailable("cache_unavailable") from None


def resolve_add_context(raw, project, supplier, config_root):
    if not isinstance(supplier, str) or not 3 <= len(supplier.strip()) <= 100:
        raise ContextUnavailable("supplier_hint_required")
    native = raw.get("nativeContext", {})
    service, eows = native.get("service"), native.get("eows", [])
    if not isinstance(service, str) or not re.fullmatch(r"[1-9][0-9]{0,14}", service):
        raise ContextUnavailable("saved_service_missing")
    if not isinstance(eows, list) or not eows:
        raise ContextUnavailable("saved_eow_missing")
    if not all(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value) for value in eows) or len(set(eows)) != 1:
        raise ContextUnavailable("saved_eow_ambiguous")
    # This is an exact read-only Add GET, not creation. Its context is supplied
    # by the verified saved PO, not the single last-project form-data cache.
    directory = cached_json(Path(config_root) / "nexvia-supplier-directory.json")
    rows = directory.get("records")
    if not isinstance(rows, list) or type(directory.get("expectedTotal")) is not int or not 0 < len(rows) == directory["expectedTotal"] <= 10000:
        raise ContextUnavailable("supplier_cache_incomplete")
    words = lambda value: " ".join(re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", value).casefold()))
    wanted = " " + words(supplier) + " "
    matches = []
    for row in rows:
        label = row.get("name", row.get("text")) if isinstance(row, dict) else None
        if not isinstance(label, str) or not 0 < len(label) <= 500:
            raise ContextUnavailable("supplier_cache_invalid")
        if wanted in " " + words(label) + " " and row.get("disabled") is not True:
            identity = str(row.get("id"))
            if not re.fullmatch(r"[1-9][0-9]{0,14}", identity):
                raise ContextUnavailable("supplier_cache_invalid")
            matches.append(identity)
    if not matches:
        raise ContextUnavailable("supplier_not_found")
    if len(matches) != 1:
        raise ContextUnavailable("supplier_ambiguous")
    return f"{ORIGIN}/staff/project-purchase-order-add/{project}?" + urlencode({
        "type": "Assembly", "service": service, "client": matches[0], "breakdown_type": eows[0]})


def inspect_browser(browser, project, po, number, supplier=None, config_root=Path("/config")):
    target = f"{ORIGIN}/staff/project-purchase-order-modify/{project}/{po}"
    targets = {target}
    source = next((context for context in browser.contexts if any(page.url.startswith(ORIGIN + "/staff/") and "/login" not in page.url for page in context.pages)), None)
    require(source is not None)
    assets = set()
    for page in source.pages[:6]:
        if not page.url.startswith(ORIGIN + "/staff/"):
            continue
        values = page.evaluate("() => [...document.querySelectorAll('script[src],link[rel=stylesheet][href],img[src]')].map(el=>el.src||el.href).slice(0,300)")
        assets.update(value for value in map(static_url, values) if value)
    state = source.storage_state()
    state = {"cookies": [row for row in state.get("cookies", []) if row.get("domain", "").lstrip(".") in {"lennox.nexvia.com.au", "nexvia.com.au"}],
             "origins": [row for row in state.get("origins", []) if row.get("origin") == ORIGIN]}
    context = browser.new_context(storage_state=state, service_workers="block", accept_downloads=False)
    blocked = {"read": 0, "write": 0, "undeclaredStatic": 0}

    def guard(route):
        request = route.request
        if allow_request(request.url, request.method, targets, assets, request.resource_type):
            route.continue_()
        else:
            blocked["read" if request.method.upper() in READ_METHODS else "write"] += 1
            if request.resource_type in {"script", "stylesheet"} and static_url(request.url):
                blocked["undeclaredStatic"] += 1
            route.abort()

    try:
        context.route("**/*", guard)
        require(callable(getattr(context, "route_web_socket", None)))
        context.route_web_socket("**/*", lambda socket: socket.close())
        context.add_init_script("window.open=()=>null;window.print=()=>undefined;")
        page = context.new_page()
        response = page.goto(target, wait_until="domcontentloaded", timeout=45000)
        require(response is not None and response.status == 200 and page.url == target)
        page.locator('[name="form[Lines]"]').wait_for(state="attached", timeout=15000)
        page.wait_for_timeout(500)  # Allow native DOM-ready uploader binding; no callbacks are invoked.
        raw = page.evaluate(INSPECT_JS)
        require(raw.get("hasLines") is True and raw.get("numbers") == [number])
        report = {"format": "nexvia-quote-upload-discovery", "version": 3, "readOnly": True,
                "projectPageId": project, "purchaseOrderId": po, "purchaseOrderNumber": number,
                "capturedAt": datetime.now(timezone.utc).isoformat(), "fileSelectionInvoked": False,
                "uploadOrSaveInvoked": False, **clean_report(raw), "blockedRequests": blocked}
        # Reuse the saved native choices and the explicit supplier hint only.
        # No first/current-default choices or EOW suffixes are inferred.
        reason, snapshot = "context_unavailable", None
        try:
            add_target = resolve_add_context(raw, project, supplier, config_root)
            targets.add(add_target)
            add = context.new_page()
            reason = "add_navigation_unavailable"
            response = add.goto(add_target, wait_until="domcontentloaded", timeout=30000)
            require(response is not None and response.status == 200 and add.url == add_target)
            reason = "add_lines_missing"
            add.locator('[name="form[Lines]"]').wait_for(state="attached", timeout=5000)
            add.wait_for_timeout(500)
            snapshot = add.evaluate(INSPECT_JS)
            form = snapshot.get("nativeForm")
            action = urlsplit(urljoin(add_target, str(form.get("action", "")))) if isinstance(form, dict) else None
            require(snapshot.get("hasLines") is True)
            reason = "add_has_po_number"
            require(snapshot.get("numbers") == [])
            reason = "add_form_missing"
            require(isinstance(form, dict))
            reason = "add_form_not_post"
            require(str(form.get("method", "")).upper() == "POST")
            reason = "add_lines_not_empty"
            require(form.get("linesKind") in {"array", "empty_string", "null"} and form.get("lineCount") == 0)
            reason = "add_form_action_mismatch"
            require(action.scheme == "https" and action.netloc == "lennox.nexvia.com.au" and action.path == urlsplit(add_target).path)
            report["addPage"] = {"available": True, "emptyUnsavedPostForm": True, **clean_report(snapshot)}
        except ContextUnavailable as error:
            report["addPage"] = {"available": False, "status": str(error)}
        except Exception:
            report["addPage"] = {"available": False, "status": reason, **(clean_report(snapshot) if snapshot else {})}
        return report
    finally:
        context.close()


def save_report(path, report):
    raw = (json.dumps(report, indent=2) + "\n").encode()
    require(len(raw) <= MAX_REPORT and not path.is_symlink())
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".quote-upload-discovery-", dir=path.parent)
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


def console_summary(report):
    summary = {}
    for label, page in [("existing", report), ("unsavedAdd", report.get("addPage", {}))]:
        routes, params, form_fields, file_shapes = [], [], [], []
        for item in page.get("fileInputs", [])[:2]:
            for widget in item.get("widgets", [])[:2]:
                routes.extend(widget.get("routes", [])[:3])
                params.append(widget.get("params", {}))
                file_shapes.append(widget.get("filesShape", {}))
                for fields in widget.get("fields", {}).values():
                    form_fields.extend(fields.get("fields", [])[:8])
        selected_handlers = sorted(page.get("handlers", []), key=lambda row: (not row.get("mentionsFilesField"), not row.get("usesFormData")))
        summary[label] = {"available": page.get("available", True), "status": page.get("status", "available"),
                          "fileInputs": len(page.get("fileInputs", [])),
                          "filesFields": page.get("filesFields", [])[:4], "uploadRoutes": routes[:4], "params": params[:2],
                          "formDataFields": form_fields[:8],
                          "handlerFormDataFields": sorted({field for handler in page.get("handlers", []) for field in handler.get("formDataFields", [])})[:12],
                          "filesShapes": file_shapes[:2],
                          "httpMethods": sorted({method for handler in page.get("handlers", []) for method in handler.get("httpMethods", [])}),
                          "handlerReferences": [route for handler in page.get("handlers", []) for route in handler.get("routes", [])][:4],
                          "mentionsFilesField": any(handler.get("mentionsFilesField") for handler in page.get("handlers", [])),
                          "responseFields": sorted({field for handler in page.get("handlers", []) for field in handler.get("responseFields", [])})[:20],
                          "callbackTrace": [fragment[:650] for row in selected_handlers if row.get("symbolic")
                                            for fragment in row["symbolic"].split(" ... ")[:2]][:2],
                          "savedFileCards": [{**row, "ancestry": row.get("ancestry", [])[:3]} for row in page.get("savedFileCards", [])[:2]],
                          "downloadLinks": page.get("downloadLinks", [])[:2],
                          "blockedUndeclaredStatic": report.get("blockedRequests", {}).get("undeclaredStatic", 0)}
    if len(json.dumps(summary, separators=(",", ":")).encode()) > 7600:
        for page in summary.values():
            page["uploadRoutes"], page["params"] = page["uploadRoutes"][:1], page["params"][:1]
            page["formDataFields"], page["responseFields"] = page["formDataFields"][:4], page["responseFields"][:12]
            page["handlerReferences"] = page["handlerReferences"][:1]
            page["filesShapes"] = page["filesShapes"][:1]
            page["callbackTrace"] = [trace[:500] for trace in page["callbackTrace"][:1]]
    if len(json.dumps(summary, separators=(",", ":")).encode()) > 7600:
        summary = {label: {"available": page["available"], "status": page["status"], "fileInputs": page["fileInputs"], "filesFields": page["filesFields"][:2],
                           "httpMethods": page["httpMethods"], "handlerFormDataFields": page["handlerFormDataFields"][:6],
                           "responseFields": page["responseFields"][:12], "mentionsFilesField": page["mentionsFilesField"],
                           "uploadRoutes": page["uploadRoutes"][:1], "handlerReferences": page["handlerReferences"][:1],
                           "callbackTrace": page["callbackTrace"][:1], "downloadLinks": page["downloadLinks"][:1],
                           "savedFileCards": page["savedFileCards"][:1],
                           "blockedUndeclaredStatic": page["blockedUndeclaredStatic"]}
                   for label, page in summary.items()}
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=int)
    parser.add_argument("--po", required=True, type=int)
    parser.add_argument("--number", required=True)
    parser.add_argument("--supplier", help="Explicit existing supplier name/brand; must identify one cached ID")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args(argv)
    require(0 < args.project < 10**15 and 0 < args.po < 10**15 and re.fullmatch(r"PO[0-9]{1,20}", args.number))
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
        report = inspect_browser(browser, args.project, args.po, args.number, supplier=args.supplier)
    save_report(args.output, report)
    print("Read-only quote upload discovery saved:", args.output)
    print("Native file inputs:", len(report["fileInputs"]))
    print("Native handler records:", len(report["handlers"]))
    for label, summary in console_summary(report).items():
        print(label + " uploader:", json.dumps(summary, separators=(",", ":")))
    print("No file was selected, uploaded or saved. No PO was created or changed.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Quote upload inspection stopped safely. Check browser sign-in and the existing PO identity.")
        raise SystemExit(1)
