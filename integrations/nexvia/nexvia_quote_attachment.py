"""Private source and durable evidence for managed Nexvia quote attachments.

The existing native input performs its own signed GCS upload and Nexvia file
registration. Only that observed transport is permitted. The input bytes and
the draft and saved-PO downloads must all match before a receipt is reported.
Importing this module invokes no browser or network action.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, parse_qsl, unquote, urljoin, urlsplit
import uuid

from nexvia_allocations import context_values, quote_attachment_descriptor


SOURCE_FILE = "nexvia-supplier-quote.pdf"
ATTEMPT_FILE = "nexvia-quote-upload-attempt.json"
RECEIPT_FILE = "nexvia-quote-upload.json"
TRANSFER_FILE = "nexvia-quote-transfer.json"
SOURCE_TTL_SECONDS = 24 * 3600
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_RECEIPT_BYTES = 32 * 1024
ORIGIN = "https://lennox.nexvia.com.au"
POLICY_FIELDS = {"Content-Type", "acl", "key", "policy", "x-goog-algorithm", "x-goog-credential", "x-goog-date", "x-goog-signature"}
NATIVE_TIMEOUT_MS = 60000
MAX_SOURCE_BYTES = 10 * 1024 * 1024
REGISTRATION_PREFIX = "/staff/upload/details/"
FORBIDDEN_DOWNLOAD = re.compile(r"(?:purchase-order-(?:print|add|modify|delete|send))|/(?:sent|send|delete|remove|logout|save|email|approve|stock|outlook|upload)(?:/|$)", re.I)


class QuoteAttachmentError(ValueError):
    """Fixed errors omit credentials, native responses and file contents."""


def require(condition, message):
    if not condition:
        raise QuoteAttachmentError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def descriptor(request, value=None):
    try:
        result = quote_attachment_descriptor(request, request.get("quote") if value is None else value)
    except (ValueError, TypeError, AttributeError) as error:
        raise QuoteAttachmentError("Quote attachment metadata is invalid.") from error
    require(result is not None, "A managed quote attachment is required.")
    return result


def create_path_for_request(request, value):
    require(isinstance(value, str) and len(value) <= 1000,
            "Quote upload draft context is invalid.")
    try:
        path = urlsplit(value)
        values = parse_qs(path.query, keep_blank_values=True, strict_parsing=True)
    except (ValueError, TypeError) as error:
        raise QuoteAttachmentError("Quote upload draft context is invalid.") from error
    require(not path.scheme and not path.netloc and not path.fragment
            and type(request.get("projectPageId")) is int and request["projectPageId"] > 0
            and path.path == "/staff/project-purchase-order-add/" + str(request["projectPageId"])
            and values == {"type": ["Assembly"], "service": [str(request.get("serviceId"))],
                           "client": [str(request.get("supplierId"))],
                           "breakdown_type": [request.get("breakdownType")]},
            "Quote upload draft does not match the request.")
    return value


def binding(request, create_path, quote=None):
    require(isinstance(request, dict), "Quote upload request is invalid.")
    identifier = request.get("requestId")
    try:
        valid = isinstance(identifier, str) and str(uuid.UUID(identifier)) == identifier
    except (ValueError, TypeError, AttributeError):
        valid = False
    require(valid, "Quote upload request identity is invalid.")
    metadata = descriptor(request, quote)
    try:
        context_values(request, quote_attachment=metadata)
    except (ValueError, TypeError) as error:
        raise QuoteAttachmentError("Quote upload request context is invalid.") from error
    path = create_path_for_request(request, create_path)
    return {"version": 1, "requestId": identifier, "requestHash": digest(request),
            "projectPageId": request["projectPageId"],
            "createPath": path,
            "quote": metadata}


@contextmanager
def private_folder(folder):
    """Keep an opened private directory while touching only fixed child names."""
    descriptor_fd = None
    try:
        descriptor_fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(descriptor_fd)
        require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700,
                "Quote work folder must be private.")
        current = os.stat(folder, follow_symlinks=False)
        require(stat.S_ISDIR(current.st_mode) and (current.st_dev, current.st_ino) == (info.st_dev, info.st_ino),
                "Quote work folder changed.")
        yield descriptor_fd
    except OSError as error:
        raise QuoteAttachmentError("Quote work folder is unavailable or unsafe.") from error
    finally:
        if descriptor_fd is not None:
            os.close(descriptor_fd)


def read_private_json(directory, filename, maximum=MAX_RECEIPT_BYTES):
    try:
        descriptor_fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        with os.fdopen(descriptor_fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1,
                    "Quote evidence file must be private and regular.")
            raw = stream.read(maximum + 1)
        require(len(raw) <= maximum, "Quote evidence file exceeds its limit.")
        value = json.loads(raw)
        require(isinstance(value, dict), "Quote evidence is invalid.")
        return value
    except (OSError, ValueError, TypeError) as error:
        if isinstance(error, QuoteAttachmentError):
            raise
        raise QuoteAttachmentError("Quote evidence is unavailable or invalid.") from error


def validate_source_transfer(value, request, now=None):
    instant = time.time() if now is None else now
    require(type(instant) in (int, float) and math.isfinite(instant),
            "Quote source time is invalid.")
    require(isinstance(value, dict) and set(value) == {
                "version", "id", "workerId", "claimToken", "quote", "createdAt", "expiresAt"}
            and value.get("version") == 1 and value.get("id") == request.get("requestId")
            and value.get("quote") == descriptor(request)
            and type(value.get("createdAt")) in (int, float) and math.isfinite(value["createdAt"])
            and 0 < value["createdAt"] < 253402214399
            and type(value.get("expiresAt")) in (int, float) and math.isfinite(value["expiresAt"])
            and value["expiresAt"] == value["createdAt"] + SOURCE_TTL_SECONDS,
            "Quote source transfer does not match the request.")
    try:
        worker = value.get("workerId")
        valid_worker = isinstance(worker, str) and str(uuid.UUID(worker)) == worker
    except (ValueError, TypeError, AttributeError):
        valid_worker = False
    require(valid_worker and isinstance(value.get("claimToken"), str)
            and 16 <= len(value["claimToken"]) <= 512 and not re.search(r"\s", value["claimToken"]),
            "Quote source transfer identity is invalid.")
    require(instant < value["expiresAt"], "Quote source has expired; no upload is permitted.")
    return value


def _source(folder, request, path=None, include_bytes=False):
    quote = descriptor(request)
    expected = Path(folder) / SOURCE_FILE
    require(path is None or Path(path).absolute() == expected.absolute(),
            "Quote source path does not match its fixed spool.")
    with private_folder(folder) as directory:
        saved = read_private_json(directory, "request.json", MAX_JSON_BYTES)
        require(saved == request, "Quote source belongs to a different request.")
        validate_source_transfer(read_private_json(directory, TRANSFER_FILE), request)
        try:
            descriptor_fd = os.open(SOURCE_FILE, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
            with os.fdopen(descriptor_fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                        and info.st_nlink == 1 and info.st_size == quote["bytes"],
                        "Quote source is not a private matching PDF.")
                checksum, length, prefix, chunks = hashlib.sha256(), 0, b"", []
                while True:
                    raw = stream.read(65536)
                    if not raw:
                        break
                    length += len(raw)
                    require(length <= quote["bytes"], "Quote source exceeds its declared size.")
                    prefix = (prefix + raw)[:5] if len(prefix) < 5 else prefix
                    checksum.update(raw)
                    if include_bytes:
                        chunks.append(raw)
                require(length == quote["bytes"] and prefix == b"%PDF-"
                        and checksum.hexdigest() == quote["sha256"],
                        "Quote source changed or is incomplete.")
        except OSError as error:
            raise QuoteAttachmentError("Quote source is unavailable or unsafe.") from error
    return expected, b"".join(chunks) if include_bytes else None


def verify_source(folder, request, path=None):
    """Verify only the fixed spool for this exact immutable saved request."""
    return _source(folder, request, path)[0]


def source_upload_payload(folder, request, path=None):
    """Return exactly the bytes checked in one opened file, never reread a path."""
    _path, raw = _source(folder, request, path, include_bytes=True)
    return {"name": descriptor(request)["filename"], "mimeType": "application/pdf", "buffer": raw}


def exclusive_json(directory, filename, value):
    """Create durable evidence once; even a partial write blocks unsafe replay."""
    raw = canonical(value)
    require(len(raw) <= MAX_RECEIPT_BYTES, "Quote upload evidence exceeds its limit.")
    try:
        descriptor_fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                0o600, dir_fd=directory)
        with os.fdopen(descriptor_fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(directory)
    except FileExistsError as error:
        raise QuoteAttachmentError("Quote upload evidence already exists; do not upload again.") from error
    except OSError as error:
        raise QuoteAttachmentError("Quote upload evidence could not be saved; do not upload.") from error


def begin_upload(folder, request, create_path, quote=None):
    """Persist an exclusive attempt before any native file selection or upload."""
    expected = binding(request, create_path, quote)
    verify_source(folder, request)
    attempt = {**expected, "attemptedAt": datetime.now(timezone.utc).isoformat()}
    with private_folder(folder) as directory:
        exclusive_json(directory, ATTEMPT_FILE, attempt)
    return attempt


def native_file_ids(values):
    require(isinstance(values, list) and len(values) == 1
            and all(type(value) is int and 0 < value <= 9007199254740991 for value in values),
            "Exactly one native uploaded quote identity is required.")
    return list(values)


def file_ids_from_fields(fields):
    require(isinstance(fields, list) and all(isinstance(row, list) and len(row) == 2
            and all(isinstance(value, str) for value in row) for row in fields),
            "Native quote form fields are invalid.")
    values = [value for name, value in fields if name == "form[Files][]" and value != ""]
    require(len(values) == 1 and re.fullmatch(r"[1-9][0-9]{0,15}", values[0]),
            "Exactly one native uploaded quote form identity is required.")
    return native_file_ids([int(values[0])])


def receipt_fields(receipt):
    return [["form[Files][]", str(value)] for value in native_file_ids(receipt.get("nativeFileIds"))]


def validate_receipt(value, request, create_path, quote=None):
    expected = binding(request, create_path, quote)
    require(isinstance(value, dict) and set(value) == set(expected) | {"nativeFileIds", "uploadedAt", "receiptHash"},
            "Quote upload receipt is invalid.")
    require(all(value.get(key) == item for key, item in expected.items()),
            "Quote upload receipt belongs to a different request.")
    native_file_ids(value.get("nativeFileIds"))
    try:
        timestamp = datetime.fromisoformat(value.get("uploadedAt", "").replace("Z", "+00:00"))
        require(timestamp.tzinfo is not None, "Quote upload receipt time is invalid.")
    except (ValueError, TypeError, AttributeError) as error:
        raise QuoteAttachmentError("Quote upload receipt time is invalid.") from error
    unsigned = {key: item for key, item in value.items() if key != "receiptHash"}
    require(value.get("receiptHash") == digest(unsigned), "Quote upload receipt changed.")
    return dict(value)


def complete_upload(folder, request, create_path, file_ids, quote=None):
    """Freeze only verified native IDs; this helper itself performs no upload."""
    expected = binding(request, create_path, quote)
    with private_folder(folder) as directory:
        attempt = read_private_json(directory, ATTEMPT_FILE)
        require(set(attempt) == set(expected) | {"attemptedAt"}
                and all(attempt.get(key) == item for key, item in expected.items()),
                "Quote upload attempt does not match its completion.")
        receipt = {**expected, "nativeFileIds": native_file_ids(file_ids),
                   "uploadedAt": datetime.now(timezone.utc).isoformat()}
        receipt["receiptHash"] = digest(receipt)
        validate_receipt(receipt, request, create_path, quote)
        exclusive_json(directory, RECEIPT_FILE, receipt)
    return receipt


def load_receipt(folder, request, create_path, quote=None):
    with private_folder(folder) as directory:
        receipt = read_private_json(directory, RECEIPT_FILE)
    return validate_receipt(receipt, request, create_path, quote)


NATIVE_STATE_JS = r"""({filename}) => {
 const get=name=>String(document.getElementsByName(name)[0]?.value||'');
 const forms=[...document.forms].filter(form=>{try{const u=new URL(form.action,location.href);return u.origin===location.origin&&u.pathname===location.pathname&&form.querySelector('[name="form[Lines]"]');}catch{return false;}});
 const form=forms.length===1?forms[0]:null;
 const inputs=[...document.querySelectorAll('input[type="file"]')],widgets=[];
 const policyNames=new Set(),registration=new Set();let binding=false;
 const readSource=source=>{if(typeof source!=='string'||source.length>131072)return;
   for(const name of ['Content-Type','acl','key','policy','x-goog-algorithm','x-goog-credential','x-goog-date','x-goog-signature'])if(source.includes("'"+name+"'")||source.includes('"'+name+'"'))policyNames.add(name);
   if(source.includes('/staff/upload/details/'))registration.add('/staff/upload/details/');
   if(source.includes('form[Files]'))binding=true;
 };
 const fnSource=fn=>{if(typeof fn==='function')try{readSource(Function.prototype.toString.call(fn));}catch{}};
 for(const script of document.scripts||[])if(!script.src)readSource(script.textContent||'');
 const jq=window.jQuery||window.$;
 for(let index=0;index<inputs.length;index++){
   const el=inputs[index];let data={};if(typeof jq==='function')try{data=jq(el).data()||{};}catch{}
   for(const widget of [...new Set(Object.values(data).filter(value=>value&&typeof value==='object'&&value.options))].slice(0,6)){
     const o=widget.options||{},async=o.async||{};const url=o.url||async.saveUrl;
     for(const key of ['formData','add','done','success','upload','complete','change','submit'])fnSource(o[key]);
     const fd=o.formData||async.formData;
     if(fd&&typeof fd==='object')for(const [key,value]of Object.entries(fd)){
       if(Array.isArray(fd)&&value&&typeof value.name==='string')policyNames.add(value.name);else policyNames.add(key);
     }
     widgets.push({index,url:typeof url==='string'?new URL(url,location.href).href:null,
       method:String(o.type||o.method||'POST').toUpperCase(),autoUpload:(o.autoUpload??async.autoUpload)===true,
       chunkSize:o.maxChunkSize||o.chunkSize||0,disabled:el.disabled===true});
   }
 }
 const fields=[...document.querySelectorAll('[name="form[Files][]"],[name="form[Files]"]')].map(el=>String(el.value||''));
 const ids=[...new Set(fields.filter(value=>/^[1-9][0-9]*$/.test(value)))];
 const malformed=fields.some(value=>value!==''&&value!=='0'&&!/^[1-9][0-9]*$/.test(value));
 const visible=el=>{if(!el.getClientRects().length)return false;for(let node=el;node&&node.nodeType===1;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.opacity!==''&&Number(style.opacity)===0)return false;}return true;};
 const label=el=>String(el.textContent||el.value||'').replace(/\s+/g,' ').trim();
 const download=el=>el.tagName==='A'&&el.hasAttribute('href')&&/^(download|download file)$/i.test(label(el));
 const cards=[],seen=new Set();
 for(const link of [...document.querySelectorAll('a[href]')].filter(download)){
   for(let card=link.parentElement,depth=0;card&&depth<8&&!['BODY','HTML'].includes(card.tagName);card=card.parentElement,depth++){
     const actions=[...card.querySelectorAll('a,button,input[type=button],[role=button]')];
     const links=actions.filter(download),removes=actions.filter(el=>/^(remove|remove file)$/i.test(label(el)));
     const text=String(card.innerText||card.textContent||'').replace(/\s+/g,' '),names=[...card.querySelectorAll('a,.k-file-name,[data-file-name]')];
     const matchesName=names.some(el=>(el.getAttribute('data-file-name')||label(el)).trim()===filename);
     const owned=!!form&&form.contains(card)||inputs.some(input=>{const panel=input.closest('.tab-pane,.panel,[data-file-panel]');return panel&&panel.contains(card);});
     if(owned&&links.length===1&&removes.length===1&&/\bName\s*:/i.test(text)&&/\bSize\s*:/i.test(text)&&matchesName){
       const href=links[0].getAttribute('href')||'';
       if(visible(card)&&visible(links[0])&&!seen.has(href)){
         seen.add(href);cards.push({url:new URL(href,location.href).href,
           pathIds:new URL(href,location.href).pathname.split('/').filter(value=>/^[1-9][0-9]*$/.test(value))});
       }break;
     }
   }
   if(cards.length>=8)break;
 }
 let lines=null;try{lines=JSON.parse(get('form[Lines]')||'[]');}catch{}
 const numbers=[...new Set([...String(document.body?.innerText||'').matchAll(/Purchase Order\s*#\s*(PO\d+)/gi)].map(match=>match[1].toUpperCase()))];
 return {url:location.href,formCount:forms.length,formMethod:form?String(form.method).toUpperCase():null,
   inputCount:inputs.length,widgets,policyNames:[...policyNames],registrationPrefixes:[...registration],binding,
   ids,malformedIds:malformed,cards,linesEmpty:Array.isArray(lines)&&lines.length===0,numbers,
   service:get('form[ServiceId]'),comment:get('form[Comment]'),
   pending:[...document.querySelectorAll('.k-file-progress,.k-file-error,.fileupload-progress,.fileupload-error,[data-upload-status="pending"],[data-upload-status="uploading"],[data-upload-status="error"]')].filter(visible).length};
}"""


def gcs_upload_url(value):
    try:
        require(isinstance(value, str) and 0 < len(value) <= 2000 and value.isascii()
                and not re.search(r"[\x00-\x20\x7f\\]", value), "Native upload destination is invalid.")
        parsed = urlsplit(value)
        require(parsed.scheme == "https" and parsed.username is None and parsed.password is None
                and parsed.port is None and not parsed.query and not parsed.fragment
                and parsed.path in {"", "/"} and re.fullmatch(
                    r"[a-z0-9][a-z0-9._-]{1,220}\.storage\.googleapis\.com", parsed.hostname or ""),
                "Native upload destination is not the observed GCS policy endpoint.")
        return value
    except (ValueError, TypeError) as error:
        if isinstance(error, QuoteAttachmentError):
            raise
        raise QuoteAttachmentError("Native upload destination is invalid.") from None


def native_object_url(value, endpoint=None):
    try:
        require(isinstance(value, str) and 0 < len(value) <= 16384 and value.isascii()
                and not re.search(r"[\x00-\x20\x7f\\]", value), "Native object URL is invalid.")
        parsed = urlsplit(value)
        require(parsed.scheme == "https" and parsed.port in {None, 443}
                and parsed.username is None and parsed.password is None and not parsed.fragment,
                "Native object URL is invalid.")
        host = parsed.hostname or ""
        parts = [part for part in parsed.path.split("/") if part]
        if host == "storage.googleapis.com":
            require(len(parts) >= 2, "Native object URL is invalid.")
            bucket, objects = parts[0], parts[1:]
        else:
            require(re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}\.storage\.googleapis\.com", host)
                    and bool(parts), "Native object URL is invalid.")
            bucket, objects = host[:-len(".storage.googleapis.com")], parts
        require(re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}", bucket)
                and all(unquote(part) not in {".", ".."} and not re.search(r"[\x00-\x1f\x7f\\]", unquote(part)) for part in objects),
                "Native object URL is invalid.")
        if endpoint is not None:
            expected_bucket = urlsplit(gcs_upload_url(endpoint)).hostname[:-len(".storage.googleapis.com")]
            require(bucket == expected_bucket, "Native registration object changed storage bucket.")
        if parsed.query:
            validated_download_url(value)
        return True
    except (ValueError, TypeError):
        return False


def registration_url(value, endpoint=None):
    try:
        if not isinstance(value, str) or len(value) > 24000:
            return False
        parsed = urlsplit(value)
        tail = parsed.path[len(REGISTRATION_PREFIX):] if parsed.path.startswith(REGISTRATION_PREFIX) else ""
        pairs = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=2, strict_parsing=True)
        metadata = [(key, item) for key, item in pairs if key != "_"]
        return bool(parsed.scheme == "https" and parsed.netloc == "lennox.nexvia.com.au"
                and not parsed.fragment and re.fullmatch(r"[A-Za-z0-9_-]{1,120}", tail)
                and tail.lower() not in {"delete", "remove", "send", "email", "approve", "save", "print"}
                and len(pairs) == len({key for key, _item in pairs}) and len(metadata) == 1
                and all(key != "_" or item.isdigit() for key, item in pairs)
                and all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,99}", key)
                        and native_object_url(item, endpoint) for key, item in metadata))
    except (ValueError, TypeError):
        return False


def validate_native_draft(state, request, create_path, *, before_upload=True):
    expected = binding(request, create_path)
    require(isinstance(state, dict) and state.get("url") == ORIGIN + expected["createPath"]
            and state.get("formCount") == 1 and state.get("formMethod") == "POST"
            and state.get("inputCount") == 1 and state.get("linesEmpty") is True
            and state.get("numbers") == [] and state.get("service") == str(request["serviceId"])
            and state.get("malformedIds") is False,
            "Native quote draft context changed.")
    widgets = state.get("widgets")
    require(isinstance(widgets, list) and len(widgets) == 1, "One native quote uploader is required.")
    widget = widgets[0]
    require(widget.get("index") == 0 and widget.get("method") == "POST"
            and widget.get("autoUpload") is True and widget.get("disabled") is False
            and widget.get("chunkSize") == 0 and POLICY_FIELDS <= set(state.get("policyNames", []))
            and state.get("registrationPrefixes") == [REGISTRATION_PREFIX] and state.get("binding") is True,
            "Native quote uploader contract changed.")
    gcs_upload_url(widget.get("url"))
    if before_upload:
        require(state.get("ids") == [] and state.get("cards") == [] and state.get("pending") == 0,
                "Native quote draft already contains files or pending uploads.")
    return widget["url"]


def validated_download_url(value):
    require(isinstance(value, str) and 0 < len(value) <= 16384 and value.isascii()
            and not re.search(r"[\x00-\x20\x7f\\]", value), "Native quote download link is invalid.")
    try:
        parsed = urlsplit(value)
        require(parsed.scheme == "https" and parsed.username is None and parsed.password is None
                and parsed.port in {None, 443} and not parsed.fragment,
                "Native quote download link is invalid.")
        decoded = unquote(parsed.path)
        require("\\" not in decoded and not any(part in {".", ".."} for part in decoded.split("/"))
                and not re.search(r"[\x00-\x1f\x7f]", decoded), "Native quote download link is invalid.")
        if parsed.netloc in {"lennox.nexvia.com.au", "lennox.nexvia.com.au:443"}:
            require(parsed.path.startswith("/staff/") and not parsed.query and not FORBIDDEN_DOWNLOAD.search(decoded),
                    "Native quote action is not a download.")
            return value
        host = parsed.hostname or ""
        require(host == "storage.googleapis.com" or re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}\.storage\.googleapis\.com", host),
                "Native quote download host is unsupported.")
        pairs = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=16, strict_parsing=True)
        keys = [key for key, _ in pairs]
        allowed = {"GoogleAccessId", "Expires", "Signature", "response-content-disposition", "response-content-type", "generation",
                   "X-Goog-Algorithm", "X-Goog-Credential", "X-Goog-Date", "X-Goog-Expires", "X-Goog-SignedHeaders", "X-Goog-Signature"}
        require(len(keys) == len(set(keys)) and set(keys) <= allowed
                and ({"Expires", "Signature"} <= set(keys) or {
                    "X-Goog-Algorithm", "X-Goog-Credential", "X-Goog-Date", "X-Goog-Expires", "X-Goog-SignedHeaders", "X-Goog-Signature"} <= set(keys))
                and len([part for part in parsed.path.split("/") if part]) >= (2 if host == "storage.googleapis.com" else 1),
                "Native quote download signature is missing.")
        return value
    except (ValueError, TypeError) as error:
        if isinstance(error, QuoteAttachmentError):
            raise
        raise QuoteAttachmentError("Native quote download link is invalid.") from None


class NoDownloadRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, stream, code, message, headers, new_url):
        return None


def download_quote(context, value, quote, *, opener=None):
    """Read a native file-card link, with at most one GCS-only redirect."""
    value = validated_download_url(value)
    client = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoDownloadRedirect())
    started, redirects = time.monotonic(), 0
    try:
        while True:
            headers = {"Accept": "application/pdf", "Accept-Encoding": "identity", "User-Agent": "PanelStock-Nexvia-Quote/1.0"}
            if urlsplit(value).hostname == "lennox.nexvia.com.au":
                cookies = context.cookies([value])
                headers["Cookie"] = "; ".join(row["name"] + "=" + row["value"] for row in cookies)
            try:
                response = client.open(urllib.request.Request(value, headers=headers, method="GET"), timeout=20)
            except urllib.error.HTTPError as error:
                if error.code in {301, 302, 303, 307, 308}:
                    require(redirects == 0 and urlsplit(value).hostname == "lennox.nexvia.com.au",
                            "Native quote download redirected unexpectedly.")
                    target = validated_download_url(urljoin(value, error.headers.get("Location", "")))
                    require(urlsplit(target).hostname != "lennox.nexvia.com.au", "Native quote download redirect is not GCS.")
                    value, redirects = target, redirects + 1
                    continue
                raise
            with response:
                require(response.status == 200 and response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                        in {"application/pdf", "application/octet-stream", "binary/octet-stream"}
                        and response.headers.get("Content-Encoding", "identity").lower() in {"", "identity"},
                        "Native quote download content is invalid.")
                length = response.headers.get("Content-Length")
                require(length is None or length == str(quote["bytes"]), "Native quote download size changed.")
                chunks, size = [], 0
                while True:
                    require(time.monotonic() - started <= 40, "Native quote download timed out.")
                    raw = response.read(min(65536, quote["bytes"] + 1 - size))
                    if not raw:
                        break
                    size += len(raw)
                    require(size <= quote["bytes"], "Native quote download exceeds its declared size.")
                    chunks.append(raw)
                raw = b"".join(chunks)
                require(size == quote["bytes"] and raw.startswith(b"%PDF-")
                        and hashlib.sha256(raw).hexdigest() == quote["sha256"],
                        "Native quote download does not match the uploaded PDF.")
                return raw
    except QuoteAttachmentError:
        raise
    except Exception:
        raise QuoteAttachmentError("Native quote download is unavailable.") from None


def verify_file_cards(context, state, quote, expected_ids, *, saved=False, downloader=download_quote):
    ids = state.get("ids")
    require(isinstance(ids, list) and state.get("malformedIds") is False
            and all(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,15}", value)
                    and int(value) <= 9007199254740991 for value in ids)
            and set(expected_ids) <= {int(value) for value in ids}
            and (saved or len(ids) == 1), "Native quote file identity is missing or changed.")
    cards = state.get("cards")
    require(isinstance(cards, list) and 0 < len(cards) <= 8 and state.get("pending") == 0,
            "Native quote file card is incomplete.")
    preferred = [card for card in cards if set(map(str, expected_ids)) <= set(card.get("pathIds", []))]
    require(bool(preferred) or len(cards) == 1 and {int(value) for value in ids} == set(expected_ids),
            "Native quote download cannot be associated unambiguously with its uploaded file.")
    candidates = preferred or cards
    matches = 0
    for card in candidates:
        try:
            raw = downloader(context, validated_download_url(card.get("url")), quote)
            require(len(raw) == quote["bytes"] and raw.startswith(b"%PDF-")
                    and hashlib.sha256(raw).hexdigest() == quote["sha256"],
                    "Native quote file card points to different bytes.")
            matches += 1
        except QuoteAttachmentError:
            continue
    require(matches == 1, "Exactly one matching native quote download is required.")
    return list(expected_ids)


def upload_quote(page, folder, request, create_path, *, downloader=download_quote):
    """Use the existing native input once, then verify the completed draft file."""
    quote = descriptor(request)
    state = page.evaluate(NATIVE_STATE_JS, {"filename": quote["filename"]})
    receipt_path = Path(folder) / RECEIPT_FILE
    if receipt_path.exists() or receipt_path.is_symlink():
        receipt = load_receipt(folder, request, create_path)
        validate_native_draft(state, request, create_path, before_upload=False)
        verify_file_cards(page.context, state, quote, receipt["nativeFileIds"], downloader=downloader)
        return receipt
    endpoint = validate_native_draft(state, request, create_path)
    payload = source_upload_payload(folder, request)
    traffic = {"uploads": 0, "registration": None}

    def guard(route):
        current = route.request
        method, url = current.method.upper(), current.url
        if (url == endpoint and method == "OPTIONS"
                and current.headers.get("access-control-request-method", "").upper() == "POST"):
            route.continue_()
        elif url == endpoint and method == "POST" and traffic["uploads"] == 0:
            traffic["uploads"] += 1
            route.continue_()
        elif (method == "GET" and registration_url(url, endpoint) and traffic["uploads"] == 1
                and traffic["registration"] is None):
            traffic["registration"] = url
            route.continue_()
        else:
            route.abort()

    page.route("**/*", guard)
    try:
        begin_upload(folder, request, create_path)
        page.locator('input[type="file"]').set_input_files(payload)
        page.wait_for_function("args => {const state=(" + NATIVE_STATE_JS + ")(args); return state.ids.length===1&&state.cards.length>0&&state.pending===0;}",
                               arg={"filename": quote["filename"]}, timeout=NATIVE_TIMEOUT_MS)
        state = page.evaluate(NATIVE_STATE_JS, {"filename": quote["filename"]})
        validate_native_draft(state, request, create_path, before_upload=False)
        ids = native_file_ids([int(value) for value in state.get("ids", [])])
        require(traffic["uploads"] == 1 and traffic["registration"] is not None,
                "Native quote upload did not complete its registration.")
        verify_file_cards(page.context, state, quote, ids, downloader=downloader)
        return complete_upload(folder, request, create_path, ids)
    except QuoteAttachmentError:
        raise
    except Exception:
        raise QuoteAttachmentError("Native quote upload did not finish; do not upload it again.") from None
    finally:
        page.unroute("**/*", guard)


def with_browser(callback, browser=None):
    if browser is not None:
        return callback(browser)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        connected = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
        return callback(connected)


def normalized_result(result, request):
    require(isinstance(result, dict) and result.get("state") == "CREATED_VERIFIED"
            and result.get("requestReference") == request.get("reference")
            and result.get("projectPageId") == request.get("projectPageId")
            and type(result.get("totalCents")) is int and result["totalCents"] == request.get("totalCents")
            and type(result.get("purchaseOrderId")) is int and 0 < result["purchaseOrderId"] <= 9007199254740991
            and isinstance(result.get("purchaseOrderNumber"), str)
            and re.fullmatch(r"PO[0-9]{1,20}", result["purchaseOrderNumber"]),
            "Saved quote PO identity is invalid.")
    target = ORIGIN + "/staff/project-purchase-order-modify/" + str(request["projectPageId"]) + "/" + str(result["purchaseOrderId"])
    require(result.get("url") == target, "Saved quote PO location changed.")
    try:
        timestamp = datetime.fromisoformat(str(result.get("verifiedAt", "")).replace("Z", "+00:00"))
        require(timestamp.tzinfo is not None and timestamp.utcoffset().total_seconds() == 0,
                "Saved quote PO verification timestamp is invalid.")
    except (ValueError, TypeError, AttributeError) as error:
        raise QuoteAttachmentError("Saved quote PO verification timestamp is invalid.") from error
    return {"state": "CREATED_VERIFIED", "requestReference": request["reference"],
            "projectPageId": request["projectPageId"], "purchaseOrderId": result["purchaseOrderId"],
            "purchaseOrderNumber": result["purchaseOrderNumber"], "url": target,
            "totalCents": request["totalCents"],
            "verifiedAt": timestamp.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}


def verify_saved_quote(folder, request, result, native_receipt, *, browser=None, downloader=download_quote):
    """Read the already-created PO and exact native quote bytes; never upload."""
    receipt = validate_receipt(native_receipt, request, native_receipt.get("createPath"))
    require(load_receipt(folder, request, receipt["createPath"]) == receipt,
            "Saved quote receipt differs from its immutable local evidence.")
    with private_folder(folder) as directory:
        require(read_private_json(directory, "request.json", MAX_JSON_BYTES) == request
                and normalized_result(read_private_json(directory, "nexvia-result.json"), request) == normalized_result(result, request),
                "Saved quote verification result does not match its local PO.")
    result = normalized_result(result, request)
    target = result["url"]

    def verify(connected):
        from nexvia_inspect_quote_upload import static_url
        signed_in = next((context for context in connected.contexts if any(
            page.url.startswith(ORIGIN + "/staff/") and "/login" not in page.url for page in context.pages)), None)
        require(signed_in is not None, "Nexvia sign-in is required for quote verification.")
        state = signed_in.storage_state()
        state = {"cookies": [row for row in state.get("cookies", []) if row.get("domain", "").lstrip(".") in {"lennox.nexvia.com.au", "nexvia.com.au"}],
                 "origins": [row for row in state.get("origins", []) if row.get("origin") == ORIGIN]}
        context = connected.new_context(storage_state=state, service_workers="block", accept_downloads=False)

        def guard(route):
            current = route.request
            if current.method.upper() in {"GET", "HEAD", "OPTIONS"} and (
                current.url == target or current.resource_type in {"script", "stylesheet", "image", "font"} and static_url(current.url)):
                route.continue_()
            else:
                route.abort()

        try:
            context.route("**/*", guard)
            context.route_web_socket("**/*", lambda socket: socket.close())
            context.add_init_script("window.open=()=>null;window.print=()=>undefined;")
            page = context.new_page()
            response = page.goto(target, wait_until="domcontentloaded", timeout=45000)
            require(response is not None and response.status == 200 and page.url == target,
                    "Saved quote PO page is unavailable.")
            page.locator('[name="form[Lines]"]').wait_for(state="attached", timeout=15000)
            page.wait_for_timeout(500)
            snapshot = page.evaluate(NATIVE_STATE_JS, {"filename": receipt["quote"]["filename"]})
            require(snapshot.get("url") == target and snapshot.get("formCount") == 1
                    and snapshot.get("numbers") == [result["purchaseOrderNumber"]]
                    and snapshot.get("service") == str(request["serviceId"])
                    and snapshot.get("comment") == "Request reference: " + request["reference"],
                    "Saved quote PO context changed.")
            verify_file_cards(context, snapshot, receipt["quote"], receipt["nativeFileIds"], saved=True, downloader=downloader)
        finally:
            context.close()

    try:
        with_browser(verify, browser)
    except QuoteAttachmentError:
        raise
    except Exception:
        raise QuoteAttachmentError("Saved PO quote verification is unavailable.") from None
    return {"version": 1, "requestId": request["requestId"], "requestHash": digest(request),
            "projectPageId": request["projectPageId"], "purchaseOrderId": result["purchaseOrderId"],
            "purchaseOrderNumber": result["purchaseOrderNumber"], "sha256": receipt["quote"]["sha256"],
            "bytes": receipt["quote"]["bytes"], "nativeFileIds": receipt["nativeFileIds"],
            "createPath": receipt["createPath"], "uploadReceiptHash": receipt["receiptHash"]}


def check_dependencies():
    from playwright.sync_api import sync_playwright
    from nexvia_inspect_quote_upload import inspect_browser
    require(callable(sync_playwright) and callable(inspect_browser), "Native quote dependencies are unavailable.")
    return True


def preflight(project, order_id, number, supplier, *, browser=None, config_root=Path("/config")):
    check_dependencies()
    from nexvia_inspect_quote_upload import inspect_browser
    report = with_browser(lambda connected: inspect_browser(connected, project, order_id, number, supplier, config_root), browser)
    add = report.get("addPage", {})
    require(report.get("readOnly") is True and report.get("fileSelectionInvoked") is False
            and report.get("uploadOrSaveInvoked") is False and add.get("available") is True
            and add.get("emptyUnsavedPostForm") is True and len(add.get("fileInputs", [])) == 1,
            "Native quote upload preflight is not ready.")
    widgets = add["fileInputs"][0].get("widgets", [])
    require(len(widgets) == 1 and widgets[0].get("params", {}).get("type") == "POST"
            and widgets[0].get("params", {}).get("autoUpload") is True
            and any(row.get("destination", {}).get("provider") == "gcs"
                    and row["destination"].get("scheme") == "https" and row["destination"].get("pathClass") == "root"
                    for row in widgets[0].get("routes", [])),
            "Native quote upload preflight policy changed.")
    handlers = add.get("handlers", [])
    fields = {field for handler in handlers for field in handler.get("formDataFields", [])}
    require(POLICY_FIELDS <= fields and any(handler.get("mentionsFilesField") for handler in handlers)
            and any(any(route.get("path", "").startswith(REGISTRATION_PREFIX) for route in handler.get("routes", [])) for handler in handlers),
            "Native quote upload preflight completion contract changed.")
    return {"format": "nexvia-quote-upload-check", "version": 1, "capabilityVersion": 1,
            "nativeUploadReady": True, "projectPageId": project, "purchaseOrderId": order_id,
            "purchaseOrderNumber": number, "readOnly": True, "fileSelectionInvoked": False,
            "uploadOrSaveInvoked": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", required=True)
    parser.add_argument("--project", required=True, type=int)
    parser.add_argument("--po", required=True, type=int)
    parser.add_argument("--number", required=True)
    parser.add_argument("--supplier-name", required=True)
    parser.add_argument("--output", type=Path, default=Path("/config/nexvia-quote-update-check.json"))
    args = parser.parse_args(argv)
    require(0 < args.project <= 9007199254740991 and 0 < args.po <= 9007199254740991
            and re.fullmatch(r"PO[0-9]{1,20}", args.number), "Native quote preflight identity is invalid.")
    from nexvia_inspect_quote_upload import save_report
    try:
        report = preflight(args.project, args.po, args.number, args.supplier_name)
    except Exception:
        report = {"format": "nexvia-quote-upload-check", "version": 1, "capabilityVersion": 1,
                  "nativeUploadReady": False, "projectPageId": args.project, "purchaseOrderId": args.po,
                  "purchaseOrderNumber": args.number, "readOnly": True, "fileSelectionInvoked": False,
                  "uploadOrSaveInvoked": False}
    save_report(args.output, report)
    print("Native quote upload readiness:", "ready" if report["nativeUploadReady"] else "not ready")
    print("No file was selected, uploaded or downloaded. No PO was created or changed.")
    return 0 if report["nativeUploadReady"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except QuoteAttachmentError:
        print("Native quote check stopped safely; no upload or PO action was invoked.")
        raise SystemExit(1)
