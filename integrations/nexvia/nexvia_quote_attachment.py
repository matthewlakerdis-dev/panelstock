"""Private source and durable evidence for managed Nexvia quote attachments.

The existing native input performs its own signed GCS upload and Nexvia file
registration. Only that observed transport is permitted. The input bytes and
the draft and saved-PO downloads must all match before a receipt is reported.
Importing this module invokes no browser or network action.
"""

import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
from email import policy as email_policy
from email.parser import BytesParser
from decimal import Decimal, InvalidOperation
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

from nexvia_allocations import (context_values, quote_attachment_descriptor,
                                allocation_from_native, NATIVE_STATE as ALLOCATION_STATE_JS)
from nexvia_preparation_diagnostics import (stage as diagnostic_stage, failure as diagnostic_failure,
                                           transport as diagnostic_transport, route_event as diagnostic_route_event,
                                           bind_callback as diagnostic_callback)
import nexvia_quote_registration as registration_protocol


SOURCE_FILE = "nexvia-supplier-quote.pdf"
ATTEMPT_FILE = "nexvia-quote-upload-attempt.json"
RECEIPT_FILE = "nexvia-quote-upload.json"
TRANSFER_FILE = "nexvia-quote-transfer.json"
UPLOAD_CONTEXT_FILE = "nexvia-quote-upload-context.json"
SOURCE_TTL_SECONDS = 24 * 3600
BLANK_DRAFT_GUARD_VERSION = 5
POLICY_UPLOAD_GUARD_VERSION = 2
# Filled from the live, read-only native source probe before this release ships.
POLICY_SEND_SHA256 = "96bfef70560ed8611fb07bbc0321d5d7dbbdf8b938dd08c4f92438398d3b4b16"
POLICY_OPERATION_SHA256 = "5d2d3ceb7abe552344276d47d36a8175b7aeb250a9bf0bf00e850cd23ecf2e43"
REGISTRATION_DONE_SHA256 = "6bca1e312639e1f418f8da27b980417500364820031430f277eed15fe59498bf"
MAX_POLICY_BYTES = 64 * 1024
SIGNED_POLICY_FIELDS = {"key", "policy", "x-goog-algorithm", "x-goog-credential", "x-goog-date", "x-goog-signature"}
POLICY_ERROR_CODES = {
    "Native quote policy contains duplicate fields.": "quote_policy_json",
    "Native quote policy response exceeds its limit.": "quote_policy_response_size",
    "Native quote policy response is invalid.": "quote_policy_json",
    "Native quote policy response has no bounded signed policy.": "quote_policy_fields",
    "Native quote signed policy fields are invalid.": "quote_policy_fields",
    "Native quote signed policy metadata is invalid.": "quote_policy_signature",
    "Native quote signed object key is invalid.": "quote_policy_fields",
    "Native quote signed policy document is invalid.": "quote_policy_document",
    "Native quote policy conditions changed.": "quote_policy_conditions",
    "Native quote policy byte limits changed.": "quote_policy_conditions",
    "Native quote policy MIME condition changed.": "quote_policy_conditions",
    "Native quote policy fields changed.": "quote_policy_conditions",
    "Native quote policy storage bucket changed.": "quote_policy_conditions",
    "Native quote policy ACL changed.": "quote_policy_conditions",
    "Native quote policy MIME value is invalid.": "quote_policy_conditions",
    "Native quote policy does not cover the original PDF.": "quote_policy_pdf_compat",
}
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


_UPLOAD_STATE_JS = r"""({filename}) => {
 const forms=[...document.forms].filter(form=>{try{const u=new URL(form.action,location.href);return u.origin===location.origin&&u.pathname===location.pathname&&form.querySelector('[name="form[Lines]"]');}catch{return false;}});
 const form=forms.length===1?forms[0]:null;
 const named=name=>form?[...form.querySelectorAll('[name]')].filter(el=>el.name===name):[];
 const get=name=>{const values=named(name);return values.length===1?String(values[0].value||''):'';};
 const formFieldsValid=!!form&&['form[Lines]','form[ServiceId]','form[CurrencyId]'].every(name=>named(name).length===1)&&named('form[Comment]').length<=1;
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
     for(const key of ['formData','add','done','success','upload','complete','change','submit','send'])fnSource(o[key]);
     const ownSource=name=>{try{const d=Object.getOwnPropertyDescriptor(o,name);if(d&&Object.prototype.hasOwnProperty.call(d,'value')&&typeof d.value==='function'){const text=Function.prototype.toString.call(d.value);if(text.length<=131072)return text;}}catch{}return null;};
     const sendSource=ownSource('send'),doneSource=ownSource('done');
     const fd=o.formData||async.formData;
     if(fd&&typeof fd==='object')for(const [key,value]of Object.entries(fd)){
       if(Array.isArray(fd)&&value&&typeof value.name==='string')policyNames.add(value.name);else policyNames.add(key);
     }
     widgets.push({index,url:typeof url==='string'?new URL(url,location.href).href:null,
       method:String(o.type||o.method||'POST').toUpperCase(),autoUpload:(o.autoUpload??async.autoUpload)===true,
       chunkSize:o.maxChunkSize||o.chunkSize||0,disabled:el.disabled===true,sendSource,doneSource});
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
   inputCount:inputs.length,formFieldsValid,widgets,policyNames:[...policyNames],registrationPrefixes:[...registration],binding,
   ids,malformedIds:malformed,cards,linesEmpty:Array.isArray(lines)&&lines.length===0,
   lines:Array.isArray(lines)&&lines.length<=1?lines:null,numbers,
   service:get('form[ServiceId]'),currency:get('form[CurrencyId]'),comment:get('form[Comment]'),
   pending:[...document.querySelectorAll('.k-file-progress,.k-file-error,.fileupload-progress,.fileupload-error,[data-upload-status="pending"],[data-upload-status="uploading"],[data-upload-status="error"]')].filter(visible).length};
}"""

# Resolve the same exact form/grid as the allocation reader. Its runtime model
# UID is intentionally separate from toJSON(), where Kendo omits that property.
_NATIVE_MODEL_IDENTITY_JS = r"""() => {
 const forms=[...document.forms].filter(form=>{try{const u=new URL(form.action,location.href);return u.origin===location.origin&&u.pathname===location.pathname&&form.querySelector('[name="form[Lines]"]');}catch{return false;}});
 if(forms.length!==1)throw Error('Expected one native draft form');
 const flatten=columns=>columns.flatMap(c=>[c,...flatten(c.columns||[])]);
 const grids=[...new Set([...forms[0].querySelectorAll('[data-role="grid"],.k-grid')]
   .map(el=>window.jQuery&&window.jQuery(el).data('kendoGrid')).filter(Boolean))];
 const exact=grids.filter(grid=>flatten(grid.columns||[]).some(c=>c.field==='item_description'));
 const matches=exact.length?exact:grids.filter(grid=>flatten(grid.columns||[]).some(c=>/^description$/i.test(String(c.title||'').replace(/<[^>]*>/g,'').trim())));
 if(matches.length!==1||!matches[0].dataSource||typeof matches[0].dataSource.data!=='function')throw Error('Expected one native draft grid');
 const models=Array.from(matches[0].dataSource.data());
 if(models.length!==1)throw Error('Expected one native draft model');
 const model=models[0];return {uid:typeof model.uid==='string'?model.uid:null,
   row:JSON.parse(JSON.stringify(typeof model.toJSON==='function'?model.toJSON():model))};
}"""

# FormData construction can invoke Nexvia's serializer. Read it before taking
# the final same-form hidden-field snapshot, then bind Kendo's row UID directly
# to the exact model that produced the captured allocation row.
NATIVE_STATE_JS = r"""args => {
 let state=(""" + _UPLOAD_STATE_JS + r""")(args);
 if(state.numbers.length===0&&location.pathname.startsWith('/staff/project-purchase-order-add/')){
   let attachment=null;
   if(state.ids.length===1&&Number.isSafeInteger(args.bytes)&&args.bytes>=5)
     attachment={filename:args.filename,bytes:args.bytes,nativeFileIds:[Number(state.ids[0])]};
   try{
     const native=(""" + ALLOCATION_STATE_JS + r""")(attachment);
     const identity=(""" + _NATIVE_MODEL_IDENTITY_JS + r""")();
     state=(""" + _UPLOAD_STATE_JS + r""")(args);
     if(!Array.isArray(native.rows)||native.rows.length!==1||JSON.stringify(native.rows[0])!==JSON.stringify(identity.row))throw Error('Native model changed');
     const serialized=native.fields.filter(pair=>pair[0]==='form[Lines]');
     if(serialized.length!==1||typeof serialized[0][1]!=='string'||JSON.stringify(JSON.parse(serialized[0][1]))!==JSON.stringify(state.lines))throw Error('Native serialized field changed');
     state.nativeSnapshot=native;state.nativeRowUid=identity.uid;
   }catch{state=(""" + _UPLOAD_STATE_JS + r""")(args);state.nativeSnapshot=null;}
 }
 return state;
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


def _zero_draft_value(value):
    if value is None or value == "":
        return True
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return False
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return False
    return number.is_finite() and number == 0


def _draft_quantity(value):
    if value is None or value == "":
        return True
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return False
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return False
    return number.is_finite() and number >= 0


def _same_native_json(left, right):
    try:
        return canonical(left) == canonical(right)
    except (ValueError, TypeError):
        return False


def _editable_metadata(value):
    return (isinstance(value, dict) and len(value) <= 500
            and all(isinstance(key, str) and 0 < len(key) <= 300
                    and not re.search(r"[\x00-\x1f\x7f]", key) and type(flag) is bool
                    for key, flag in value.items()))


def _normalized_blank_rows(grid, serialized, baseline, state, native_snapshot):
    """Normalize only the three observed Kendo serialization differences.

    The serialized row clears its temporary id, exposes the exact model UID,
    and omits the grid's boolean editability map. No business field, numeric
    allocation identity or populated value is coerced or ignored.
    """
    require(isinstance(grid, dict) and isinstance(serialized, dict),
            "Native quote blank draft rows are invalid.")
    left, right = dict(grid), dict(serialized)
    for row in (baseline, grid):
        if "_editable" in row:
            require(_editable_metadata(row["_editable"]), "Native quote editability metadata changed.")
    if "_editable" in right:
        require(_editable_metadata(right["_editable"]),
                "Native quote editability metadata changed.")
    left.pop("_editable", None)
    right.pop("_editable", None)

    cleared_id = type(grid.get("id")) is str and serialized.get("id") is None
    added_uid = "uid" not in grid and "uid" in serialized
    if cleared_id or added_uid:
        proof = native_snapshot.get("nativeNewRowProof")
        identity = grid.get("id")
        require(cleared_id and added_uid and isinstance(proof, dict) and proof.get("startedEmpty") is True
                and proof.get("addedByNativeControl") is True
                and type(identity) is str and identity == baseline.get("id")
                and type(baseline.get("id")) is str
                and identity == state.get("nativeRowUid") == serialized.get("uid")
                and 0 < len(identity) <= 160 and not re.search(r"[\x00-\x1f\x7f]", identity),
                "Native quote serialized draft identity is not proven.")
        if cleared_id:
            require("id" in serialized and serialized["id"] is None,
                    "Native quote serialized draft identity changed.")
            right["id"] = identity
        if added_uid:
            right.pop("uid")
    require(_same_native_json(left, right), "Native quote grid and serialized blank line disagree.")
    return left, right


def _blank_native_row(row, original):
    require(isinstance(row, dict) and row.get("is_new") is True
            and type(row.get("id")) is type(original.get("id"))
            and row.get("id") == original.get("id")
            and row.get("uid") == original.get("uid"),
            "Native quote blank draft identity changed.")
    # Nexvia exposes this boolean supplier flag beside the numeric quantities.
    # It is not an entered quantity; only the observed, unchanged false default
    # is permitted. Numeric thresholds and newly introduced flags stay closed.
    if "supplier_min_qty" in row or "supplier_min_qty" in original:
        require("supplier_min_qty" in row and "supplier_min_qty" in original
                and row["supplier_min_qty"] is False and original["supplier_min_qty"] is False,
                "Native supplier minimum-quantity flag changed.")
    content = {"item_description", "description", "comment", "comments", "contractor_comments",
               "note", "notes", "supplier_reference", "supplier_ref", "quote_reference", "reference"}
    monetary = {"unit_price", "curr_unit_price", "unit_cost", "cost", "price", "amount",
                "curr_amount", "subtotal", "sub_total", "total", "line_total", "total_price",
                "tax_amount", "curr_tax_amount", "amount_inc", "curr_amount_inc", "curr_cost",
                "curr_base_cost", "curr_converted_cost"}
    owners = {"job_purchase_order_id", "purchase_order_id", "purchase_order_line_id", "order_id"}
    for key, value in row.items():
        require(isinstance(key, str), "Native quote blank draft field is invalid.")
        if key == "supplier_min_qty":
            continue
        if key in content:
            require(value is None or isinstance(value, str) and not value.strip(),
                    "Native quote draft contains populated line content.")
        if key in monetary or key != "qty_received_modified" and re.search(r"(?:received|invoiced|delivered|shipped|fulfilled).*?(?:qty|quantity)|(?:qty|quantity).*?(?:received|invoiced|delivered|shipped|fulfilled)", key, re.I):
            require(_zero_draft_value(value), "Native quote draft contains populated line amounts.")
        if key in owners:
            require(value is None or value == "", "Native quote draft belongs to an existing order.")
        if key in {"received", "qty_received_modified"}:
            require(value is False or _zero_draft_value(value),
                    "Native quote draft contains received work.")
        if key != "qty_received_modified" and re.search(r"(?:^|_)(?:qty|quantity)(?:$|_)", key, re.I):
            require(_draft_quantity(value) and key in original and value == original[key],
                    "Native quote draft quantity changed.")


def _eow_evidence(value):
    require(isinstance(value, list) and 0 < len(value) <= 10000,
            "Native quote EOW evidence is invalid.")
    evidence = set()
    for item in value:
        require(isinstance(item, dict) and set(item) == {"source", "field"}
                and isinstance(item["source"], str) and item["source"] in {"line", "form"}
                and isinstance(item["field"], str) and 0 < len(item["field"]) <= 300
                and not re.search(r"[\x00-\x1f\x7f]", item["field"]),
                "Native quote EOW evidence is invalid.")
        evidence.add((item["source"], item["field"]))
    return evidence


def _selected_eow_control(snapshot, request):
    # This is the observed native selected-allocation control. A late-added
    # matching control may strengthen proof. Nexvia can also leave it exactly
    # empty while its single native row already proves the selected EOW.
    # Conflicting/duplicate controls must never be hidden by the proof filter.
    values = [value for name, value in snapshot["fields"] if name == "breakdown_type"]
    rows = snapshot.get("rows")
    row_proves_eow = (isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict)
                      and isinstance(rows[0].get("breakdown_type"), str)
                      and rows[0]["breakdown_type"] == request["breakdownType"])
    require(not values or len(values) == 1 and isinstance(values[0], str)
            and (values[0] == request["breakdownType"] or values[0] == "" and row_proves_eow),
            "Native quote selected EOW control changed.")


def validate_blank_native_lines(state, request, native_snapshot):
    """Accept only the same proven blank row in the live grid and hidden Lines.

    A nonempty hidden field is not sufficient evidence. The caller must retain
    the original read-only native editor snapshot, including its born-empty
    proof for opaque temporary IDs. Allocation validation is repeated against
    both live representations and must preserve the original allocation.
    """
    require(isinstance(native_snapshot, dict) and state.get("currency") == "8",
            "Native quote blank-line proof is unavailable.")
    current = state.get("nativeSnapshot")
    lines = state.get("lines")
    require(isinstance(current, dict) and isinstance(current.get("rows"), list)
            and len(current["rows"]) == 1 and isinstance(lines, list) and len(lines) == 1,
            "Native quote grid and serialized blank line disagree.")
    try:
        fields = current.get("fields")
        require(isinstance(fields, list) and all(isinstance(pair, list) and len(pair) == 2
                                               for pair in fields), "Native quote blank draft fields are invalid.")
        serialized_fields = [value for name, value in fields if name == "form[Lines]"]
        require(len(serialized_fields) == 1 and isinstance(serialized_fields[0], str)
                and _same_native_json(json.loads(serialized_fields[0]), lines),
                "Native quote grid and serialized blank line disagree.")
        quote = descriptor(request)
        original = allocation_from_native(request, native_snapshot, quote_attachment=quote)
        _selected_eow_control(native_snapshot, request)
        _selected_eow_control(current, request)
        require(isinstance(native_snapshot.get("rows"), list) and len(native_snapshot["rows"]) == 1,
                "Native quote original blank row is unavailable.")
        baseline = native_snapshot["rows"][0]
        grid, wire = _normalized_blank_rows(current["rows"][0], lines[0], baseline, state, native_snapshot)
        _blank_native_row(baseline, baseline)
        _blank_native_row(grid, baseline)
        _blank_native_row(wire, baseline)
        proof = native_snapshot.get("nativeNewRowProof")
        fresh = dict(current, nativeNewRowProof=proof)
        actual = allocation_from_native(request, fresh, quote_attachment=quote)
        serialized = allocation_from_native(request, dict(fresh, rows=lines), quote_attachment=quote)
    except (ValueError, TypeError, KeyError) as error:
        if isinstance(error, QuoteAttachmentError):
            raise
        raise QuoteAttachmentError("Native quote blank draft allocation is invalid.") from error
    anchors = ("projectPageId", "supplierId", "serviceId", "breakdownType", "jobId", "allocationFields")
    expected = {key: original.get(key) for key in anchors}
    require(_same_native_json(expected, {key: actual.get(key) for key in anchors})
            and _same_native_json(expected, {key: serialized.get(key) for key in anchors}),
            "Native quote blank draft allocation changed.")
    original_proof = _eow_evidence(original.get("eowProof"))
    current_proof = _eow_evidence(actual.get("eowProof"))
    serialized_proof = _eow_evidence(serialized.get("eowProof"))
    require(original_proof <= current_proof and current_proof == serialized_proof,
            "Native quote EOW evidence changed.")


def validate_native_draft(state, request, create_path, *, before_upload=True, native_snapshot=None):
    expected = binding(request, create_path)
    require(isinstance(state, dict) and state.get("url") == ORIGIN + expected["createPath"]
            and state.get("formCount") == 1 and state.get("formMethod") == "POST"
            and state.get("inputCount") == 1
            and state.get("numbers") == [] and state.get("service") == str(request["serviceId"])
            and state.get("malformedIds") is False and state.get("formFieldsValid", True) is True,
            "Native quote draft context changed.")
    if state.get("linesEmpty") is not True:
        validate_blank_native_lines(state, request, native_snapshot)
    widgets = state.get("widgets")
    require(isinstance(widgets, list) and len(widgets) == 1, "One native quote uploader is required.")
    widget = widgets[0]
    require(widget.get("index") == 0 and widget.get("method") == "POST"
            and widget.get("autoUpload") is True and widget.get("disabled") is False
            and widget.get("chunkSize") == 0 and POLICY_FIELDS <= set(state.get("policyNames", []))
            and state.get("binding") is True
            and isinstance(widget.get("doneSource"), str)
            and 0 < len(widget["doneSource"]) <= registration_protocol.generated_callback.MAX_SOURCE_CHARACTERS
            and bool(widget["doneSource"].strip()),
            "Native quote uploader contract changed.")
    gcs_upload_url(widget.get("url"))
    if before_upload:
        require(state.get("ids") == [] and state.get("cards") == [] and state.get("pending") == 0,
                "Native quote draft already contains files or pending uploads.")
    return widget["url"]


def validate_callback_sources(widget, contract):
    """Keep this page's verified callbacks fixed throughout its one upload."""
    require(isinstance(contract, dict) and type(contract.get("version")) is int
            and contract["version"] == registration_protocol.REGISTRATION_PROTOCOL_VERSION
            and contract.get("doneProfileSha256") == registration_protocol.generated_callback.SUPPORTED_DONE_PROFILE_SHA256
            and contract.get("sendSourceSha256") == POLICY_SEND_SHA256
            and all(isinstance(widget.get(name), str)
                    and 0 < len(widget[name]) <= registration_protocol.generated_callback.MAX_SOURCE_CHARACTERS
                    and hashlib.sha256(widget[name].encode()).hexdigest() == contract.get(digest_name)
                    for name, digest_name in (("doneSource", "doneSourceSha256"), ("sendSource", "sendSourceSha256"))),
            "Native quote callback source changed during upload.")


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


class NormalizerError(ValueError):
    pass


def _normalizer_fail(reason):
    raise NormalizerError(reason)


def _normalizer_literal(source, start):
    quote, value, index = source[start], [], start + 1
    escapes = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
    while index < len(source):
        character = source[index]
        if character == quote:
            return "".join(value), index + 1
        if character in "\r\n": _normalizer_fail("normalizer_string_invalid")
        if character != "\\":
            value.append(character); index += 1; continue
        index += 1
        if index >= len(source): _normalizer_fail("normalizer_string_invalid")
        character = source[index]
        if character in {"u", "x"}:
            count = 4 if character == "u" else 2
            digits = source[index + 1:index + 1 + count]
            if len(digits) != count or not re.fullmatch(r"[a-fA-F0-9]+", digits): _normalizer_fail("normalizer_string_invalid")
            value.append(chr(int(digits, 16))); index += count + 1
        elif character in "\r\n" or character.isdigit() and character != "0":
            _normalizer_fail("normalizer_string_invalid")
        elif character == "0" and index + 1 < len(source) and source[index + 1].isdigit():
            _normalizer_fail("normalizer_string_invalid")
        else:
            value.append(escapes.get(character, character)); index += 1
    _normalizer_fail("normalizer_string_invalid")


def _normalizer_regex(source, start):
    index, in_class = start + 1, False
    while index < len(source):
        character = source[index]
        if character in "\r\n\u2028\u2029": _normalizer_fail("normalizer_regex_invalid")
        if character == "\\":
            if index + 1 >= len(source) or source[index + 1] in "\r\n\u2028\u2029": _normalizer_fail("normalizer_regex_invalid")
            index += 2; continue
        if character == "[": in_class = True
        elif character == "]": in_class = False
        elif character == "/" and not in_class:
            index += 1
            flags_start = index
            while index < len(source) and source[index].isascii() and source[index].isalpha(): index += 1
            flags = source[flags_start:index]
            if not _normalizer_flags(flags): _normalizer_fail("normalizer_regex_invalid")
            return source[start:index], index
        index += 1
    _normalizer_fail("normalizer_regex_invalid")


def _normalizer_flags(value):
    return isinstance(value, str) and len(value) == len(set(value)) and set(value) <= set("dgimsuy")


def _normalizer_tokens(source):
    tokens, index, previous = [], 0, ""
    while index < len(source):
        if index > 8192 or len(tokens) > 1500: _normalizer_fail("normalizer_prefix_limit")
        rest, character = source[index:], source[index]
        if character.isspace(): index += 1; continue
        if rest.startswith("//"):
            end = source.find("\n", index + 2); index = len(source) if end < 0 else end; continue
        if rest.startswith("/*"):
            end = source.find("*/", index + 2)
            if end < 0: _normalizer_fail("normalizer_comment_invalid")
            index = end + 2; continue
        if character in "\"'":
            value, index = _normalizer_literal(source, index); token = ("string", value)
        elif character == "/" and previous in {"(", ",", "=", ":"}:
            value, index = _normalizer_regex(source, index); token = ("regex", value)
        elif re.match(r"[A-Za-z_$]", character):
            value = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", rest).group(); index += len(value)
            token = ("id", value)
            if value == "if" and previous != ".":
                tokens.append(token); return tokens
        elif character == "0": token, index = ("number", "0"), index + 1
        elif character in "(){}[].=,;": token, index = ("punct", character), index + 1
        else: _normalizer_fail("normalizer_prefix_not_pure")
        tokens.append(token); previous = token[1]
    _normalizer_fail("normalizer_if_missing")


class _NormalizerParser:
    def __init__(self, tokens):
        self.tokens, self.index, self.file, self.field, self.initialized = tokens, 0, None, None, False
        self.operations = 0

    def operation(self):
        self.operations += 1
        if self.operations > 64: _normalizer_fail("normalizer_expression_limit")

    def take(self, kind=None, value=None):
        if self.index >= len(self.tokens): _normalizer_fail("normalizer_prefix_not_pure")
        token = self.tokens[self.index]
        if kind is not None and token[0] != kind or value is not None and token[1] != value:
            _normalizer_fail("normalizer_prefix_not_pure")
        self.index += 1
        return token[1]

    def has(self, kind, value):
        return self.index < len(self.tokens) and self.tokens[self.index] == (kind, value)

    def expression(self, depth=0):
        if depth > 16: _normalizer_fail("normalizer_expression_limit")
        if self.has("id", "decodeURIComponent"):
            self.operation()
            self.take(); self.take("punct", "(")
            node = ("decode", self.expression(depth + 1)); self.take("punct", ")")
        else:
            self.take("id", self.file); self.take("punct", ".")
            field = self.take("id")
            if field != "name" and not (self.initialized and field == self.field): _normalizer_fail("normalizer_member_forbidden")
            node = ("field", field)
        while self.has("punct", "."):
            self.operation()
            self.take(); self.take("id", "replace"); self.take("punct", "(")
            pattern = self.pattern(); self.take("punct", ",")
            replacement = self.take("string"); self.take("punct", ")")
            node = ("replace", node, pattern, replacement)
        return node

    def pattern(self):
        if self.index >= len(self.tokens): _normalizer_fail("normalizer_prefix_not_pure")
        kind = self.tokens[self.index][0]
        if kind in {"string", "regex"}: return (kind, self.take(kind))
        self.take("id", "new"); self.take("id", "RegExp"); self.take("punct", "(")
        pattern = self.take("string"); flags = ""
        if self.has("punct", ","):
            self.take(); flags = self.take("string")
        self.take("punct", ")")
        if not _normalizer_flags(flags): _normalizer_fail("normalizer_regex_invalid")
        return ("constructor", pattern, flags)

    def parse(self):
        self.take("id", "function")
        if not self.has("punct", "("): self.take("id")
        self.take("punct", "("); event = self.take("id"); self.take("punct", ","); data = self.take("id")
        self.take("punct", ")"); self.take("punct", "{")
        if event == data or {event, data} & {"decodeURIComponent", "RegExp", "Object"}: _normalizer_fail("normalizer_binding_invalid")
        self.take("id", "let"); self.file = self.take("id"); self.take("punct", "=")
        self.take("id", data); self.take("punct", "."); self.take("id", "files")
        self.take("punct", "["); self.take("number", "0"); self.take("punct", "]"); self.take("punct", ";")
        self.take("id", "let"); url = self.take("id"); self.take("punct", ";")
        if len({event, data, self.file, url}) != 4 or {self.file, url} & {"decodeURIComponent", "RegExp", "Object"}:
            _normalizer_fail("normalizer_binding_invalid")
        assignments = []
        while not self.has("id", "if"):
            self.take("id", self.file); self.take("punct", "."); field = self.take("id")
            if field in {"name", "__proto__", "constructor", "prototype", "callee", "arguments"}:
                _normalizer_fail("normalizer_target_forbidden")
            if self.field is None: self.field = field
            if field != self.field: _normalizer_fail("normalizer_target_changed")
            self.take("punct", "="); assignments.append(self.expression()); self.take("punct", ";")
            self.initialized = True
            if len(assignments) > 12: _normalizer_fail("normalizer_assignment_limit")
        self.take("id", "if")
        if self.index != len(self.tokens) or not assignments: _normalizer_fail("normalizer_prefix_not_pure")
        return self.field, assignments


def _render_normalizer(node):
    kind = node[0]
    if kind == "field": return "__nexvia_file[" + json.dumps(node[1], ensure_ascii=True) + "]"
    if kind == "decode": return "decodeURIComponent(" + _render_normalizer(node[1]) + ")"
    if kind == "replace": return _render_normalizer(node[1]) + ".replace(" + _render_normalizer(node[2]) + "," + json.dumps(node[3], ensure_ascii=True) + ")"
    if kind == "string": return json.dumps(node[1], ensure_ascii=True)
    if kind == "regex": return node[1]
    if kind == "constructor": return "new RegExp(" + json.dumps(node[1], ensure_ascii=True) + "," + json.dumps(node[2]) + ")"
    _normalizer_fail("normalizer_ast_invalid")


def normalizer_wrapper(source, expected_sha256):
    """Return JS filename-string wrapper or raise a fixed NormalizerError code."""
    if not isinstance(source, str) or len(source) > 65536 or not isinstance(expected_sha256, str) \
            or not re.fullmatch(r"[a-f0-9]{64}", expected_sha256): _normalizer_fail("normalizer_source_invalid")
    try: actual = hashlib.sha256(source.encode("utf-8")).hexdigest()
    except UnicodeError: _normalizer_fail("normalizer_source_invalid")
    if actual != expected_sha256: _normalizer_fail("normalizer_source_mismatch")
    field, assignments = _NormalizerParser(_normalizer_tokens(source)).parse()
    target = "__nexvia_file[" + json.dumps(field, ensure_ascii=True) + "]"
    statements = ";".join(target + "=" + _render_normalizer(node) for node in assignments)
    return "__nexvia_filename=>{if(typeof __nexvia_filename!=='string')throw Error('normalizer_input_invalid');" \
        "const __nexvia_file=Object.create(null);__nexvia_file.name=__nexvia_filename;" + statements + ";return " + target + ";}"


def fresh_policy_filename(page, state, quote):
    """Bind the metadata to the audited SEND source before selecting a file."""
    require(isinstance(POLICY_SEND_SHA256, str) and re.fullmatch(r"[a-f0-9]{64}", POLICY_SEND_SHA256)
            and isinstance(POLICY_OPERATION_SHA256, str) and re.fullmatch(r"[a-f0-9]{64}", POLICY_OPERATION_SHA256),
            "Native quote policy source has not been verified.")
    widgets = state.get("widgets")
    source = widgets[0].get("sendSource") if isinstance(widgets, list) and len(widgets) == 1 else None
    require(isinstance(source, str) and 0 < len(source) <= 131072
            and hashlib.sha256(source.encode("utf-8")).hexdigest() == POLICY_SEND_SHA256,
            "Native quote SEND source changed; no file was selected.")
    try:
        wrapper = normalizer_wrapper(source, POLICY_SEND_SHA256)
        filename = page.evaluate(wrapper, quote["filename"])
    except Exception:
        raise QuoteAttachmentError("Native quote filename normalization could not be verified.") from None
    require(isinstance(filename, str) and 0 < len(filename) <= 512
            and not re.search(r"[\x00-\x1f\x7f\\/]", filename),
            "Native quote filename normalization could not be verified.")
    return filename


def policy_path(value):
    """Only the pinned operation in the two observed native path layouts."""
    try:
        parsed = urlsplit(value)
        if (not isinstance(value, str) or not value.isascii() or len(value) > 4096
                or re.search(r"[\x00-\x20\x7f\\]", value) or parsed.scheme != "https"
                or parsed.netloc != urlsplit(ORIGIN).netloc or parsed.fragment):
            return False
        segments = parsed.path.split("/")
        if len(segments) == 3 and segments[:2] == ["", "upload"]:
            operation = segments[2]
        elif len(segments) == 4 and segments[0] == "" and segments[2] == "upload" and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,59}", segments[1]):
            operation = segments[3]
        else:
            return False
        return bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,79}", operation)
                    and hashlib.sha256(operation.encode("ascii")).hexdigest() == POLICY_OPERATION_SHA256)
    except (ValueError, TypeError, AttributeError):
        return False


def validate_policy_request(request, quote, filename):
    require(request.method.upper() == "GET" and policy_path(request.url)
            and request.resource_type == "xhr" and request.post_data in (None, ""),
            "Native quote policy request changed.")
    try:
        query = urlsplit(request.url).query
        require(not re.search(r"%(?![a-fA-F0-9]{2})", query), "Native quote policy metadata is invalid.")
        pairs = parse_qsl(query, keep_blank_values=True, errors="strict",
                          strict_parsing=True, max_num_fields=4)
    except (ValueError, TypeError):
        raise QuoteAttachmentError("Native quote policy metadata is invalid.") from None
    values = dict(pairs)
    require(len(values) == len(pairs) and set(values) in ({"file_name", "file_size", "file_type"},
            {"file_name", "file_size", "file_type", "_"})
            and values["file_name"] == filename and values["file_size"] == str(quote["bytes"])
            and values["file_type"] == "application/pdf"
            and ("_" not in values or bool(re.fullmatch(r"[0-9]{1,20}", values["_"]))),
            "Native quote policy metadata does not match the selected PDF.")


def _unique_policy_json(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, "Native quote policy contains duplicate fields.")
            value[key] = item
        return value
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_POLICY_BYTES,
            "Native quote policy response exceeds its limit.")
    try:
        return json.loads(raw, object_pairs_hook=unique,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError, UnicodeError):
        raise QuoteAttachmentError("Native quote policy response is invalid.") from None


def policy_append_fields(source):
    names = set(re.findall(r"\.append\s*\(\s*[\"']([A-Za-z][A-Za-z0-9_-]{0,79})[\"']\s*,", source))
    require(POLICY_FIELDS | {"file"} <= names and len(names) <= 30,
            "Native quote SEND form fields changed.")
    return names


def policy_acl(source):
    heads = list(re.finditer(r"\.append\s*\(\s*([\"'])acl\1\s*,", source))
    values = []
    for head in heads:
        suffix = source[head.end():]
        match = re.match(r"\s*([\"'](?:\\.|[^\\\"'])*[\"'])\s*\)", suffix)
        require(match is not None, "Native quote SEND ACL is not a static value.")
        try:
            value, end = _normalizer_literal(match[1], 0)
        except Exception:
            raise QuoteAttachmentError("Native quote SEND ACL is not a static value.") from None
        require(end == len(match[1]) and isinstance(value, str) and 0 < len(value) <= 100
                and value.isascii() and not re.search(r"[\x00-\x20\x7f]", value),
                "Native quote SEND ACL is invalid.")
        values.append(value)
    require(values and len(set(values)) == 1, "Native quote SEND ACL is ambiguous.")
    return values[0]


def _policy_condition_name(operation, name, expected, allowed_fields):
    """Bind only Nexvia's observed unrestricted lower-case metadata aliases.

    The signed document and the native FormData remain unchanged. These two
    empty-prefix conditions impose no value restriction; their field lookup
    follows the exact TitleCase fields proven in the pinned SEND source.
    """
    if operation == "starts-with" and expected == "":
        native = {"content-type": "Content-Type", "content-disposition": "Content-Disposition"}.get(name)
        if native is not None and native in allowed_fields:
            return native
    return name


def _policy_conditions_match(conditions, fields, bucket, size, allowed_fields):
    for condition in conditions:
        if isinstance(condition, dict):
            if not condition:
                return False
            for name, expected in condition.items():
                actual = bucket if name == "bucket" else fields.get(name)
                if not isinstance(expected, str) or not isinstance(actual, str) or actual != expected:
                    return False
        elif isinstance(condition, list) and len(condition) == 3:
            operation, field, expected = condition
            if operation == "content-length-range":
                if not (type(field) is int and type(expected) is int and 0 <= field <= size <= expected):
                    return False
            else:
                if operation not in {"eq", "starts-with"} or not isinstance(field, str) or not field.startswith("$") or not isinstance(expected, str):
                    return False
                name = _policy_condition_name(operation, field[1:], expected, allowed_fields)
                actual = bucket if name == "bucket" else fields.get(name)
                if actual is None and operation == "starts-with" and expected == "" and name in allowed_fields:
                    continue
                if not isinstance(actual, str) or not (actual == expected if operation == "eq" else actual.startswith(expected)):
                    return False
        else:
            return False
    return True


def validate_policy_response(raw, endpoint, quote, acl, allowed_fields):
    """Validate root/one-child policies; keep private candidates for POST binding."""
    root = _unique_policy_json(raw)
    require(isinstance(root, dict), "Native quote policy response is invalid.")
    bucket = urlsplit(gcs_upload_url(endpoint)).hostname[:-len(".storage.googleapis.com")]
    candidates = [value for value in [root, *root.values()]
                  if isinstance(value, dict) and SIGNED_POLICY_FIELDS <= set(value)]
    require(1 <= len(candidates) <= 2, "Native quote policy response has no bounded signed policy.")
    checked = []
    for value in candidates:
        require(all(isinstance(value[field], str) and 0 < len(value[field]) <= 32768
                    and value[field].isascii() and not re.search(r"[\x00-\x1f\x7f]", value[field])
                    for field in SIGNED_POLICY_FIELDS), "Native quote signed policy fields are invalid.")
        require(value["x-goog-algorithm"] in {"GOOG4-RSA-SHA256", "GOOG4-HMAC-SHA256"}
                and bool(re.fullmatch(r"[0-9]{8}T[0-9]{6}Z", value["x-goog-date"]))
                and bool(re.fullmatch(r"[A-Za-z0-9._%+@-]{1,254}/[0-9]{8}/[A-Za-z0-9_-]{1,40}/storage/goog4_request",
                                     value["x-goog-credential"]))
                and value["x-goog-credential"].split("/")[1] == value["x-goog-date"][:8]
                and bool(re.fullmatch(r"[a-fA-F0-9]+", value["x-goog-signature"]))
                and len(value["x-goog-signature"]) in ({64} if value["x-goog-algorithm"] == "GOOG4-HMAC-SHA256"
                                                       else {256, 512, 768, 1024}),
                "Native quote signed policy metadata is invalid.")
        key = value["key"]
        require(len(key) <= 2048 and not key.startswith("/") and not re.search(r"[\\?#]", key)
                and "://" not in key and all(unquote(part) not in {".", ".."} for part in key.split("/")),
                "Native quote signed object key is invalid.")
        encoded = value["policy"]
        require(len(encoded) <= 32768 and bool(re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", encoded)),
                "Native quote signed policy document is invalid.")
        try:
            document = _unique_policy_json(base64.b64decode(encoded, validate=True))
            expiry = datetime.fromisoformat(document["expiration"].replace("Z", "+00:00"))
        except Exception:
            raise QuoteAttachmentError("Native quote signed policy document is invalid.") from None
        require(isinstance(document, dict) and set(document) == {"expiration", "conditions"}
                and expiry.tzinfo is not None and expiry.utcoffset().total_seconds() == 0
                and expiry.timestamp() > time.time() and isinstance(document["conditions"], list)
                and 0 < len(document["conditions"]) <= 100,
                "Native quote signed policy document is invalid.")
        conditions = document["conditions"]
        # Content-Type and range may describe an unused preview policy. Validate
        # its structure without pretending it authorizes the original PDF.
        for condition in conditions:
            if isinstance(condition, dict):
                require(bool(condition) and all(isinstance(name, str) and isinstance(item, str)
                        and (name == "bucket" and item == bucket
                             or name in SIGNED_POLICY_FIELDS and item == value[name]
                             or name == "acl" and item == acl
                             or name == "Content-Type" and bool(re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", item)))
                        for name, item in condition.items()), "Native quote policy conditions changed.")
            elif isinstance(condition, list) and len(condition) == 3:
                operation, field, expected = condition
                if operation == "content-length-range":
                    require(type(field) is int and type(expected) is int and 0 <= field <= expected <= 5 * 1024 ** 4,
                            "Native quote policy byte limits changed.")
                else:
                    require(operation in {"eq", "starts-with"} and isinstance(field, str)
                            and field.startswith("$") and isinstance(expected, str) and len(expected) <= 32768,
                            "Native quote policy conditions changed.")
                    name = _policy_condition_name(operation, field[1:], expected, allowed_fields)
                    if name == "Content-Type":
                        require(not re.search(r"[\x00-\x20\x7f]", expected), "Native quote policy MIME condition changed.")
                    elif name == "bucket" or name in SIGNED_POLICY_FIELDS or name == "acl":
                        actual = bucket if name == "bucket" else acl if name == "acl" else value[name]
                        require(actual == expected if operation == "eq" else actual.startswith(expected),
                                "Native quote policy conditions changed.")
                    else:
                        require(operation == "starts-with" and expected == "" and name in allowed_fields,
                                "Native quote policy fields changed.")
            else:
                raise QuoteAttachmentError("Native quote policy conditions changed.")
        if "bucket" in value:
            require(value["bucket"] == bucket, "Native quote policy storage bucket changed.")
        if "acl" in value:
            require(value["acl"] == acl, "Native quote policy ACL changed.")
        fields = {field: value[field] for field in SIGNED_POLICY_FIELDS}
        fields.update({"Content-Type": "application/pdf", "acl": acl})
        compatible = _policy_conditions_match(conditions, fields, bucket, quote["bytes"], allowed_fields)
        if "Content-Type" in value:
            require(isinstance(value["Content-Type"], str) and bool(re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", value["Content-Type"])),
                    "Native quote policy MIME value is invalid.")
            compatible = compatible and value["Content-Type"] == "application/pdf"
        checked.append({"fields": fields, "conditions": conditions, "pdf": compatible})
    require(any(candidate["pdf"] for candidate in checked), "Native quote policy does not cover the original PDF.")
    return checked


def validate_storage_post(request, candidates, endpoint, quote, acl, allowed_fields):
    """When CDP supplies multipart data, bind its text fields to one PDF policy.

    Chromium can omit disk-backed File bytes. Their proof remains the verified
    source input and the final native download, rather than this observation.
    """
    raw = request.post_data_buffer
    if raw is None:
        return
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_SOURCE_BYTES + 3 * MAX_POLICY_BYTES,
            "Native quote storage request exceeds its limit.")
    content_type = next((value for key, value in request.headers.items() if key.lower() == "content-type"), "")
    require(isinstance(content_type, str) and len(content_type) <= 300
            and not re.search(r"[\r\n\x00]", content_type)
            and content_type.lower().startswith("multipart/form-data;"), "Native quote storage body changed.")
    try:
        message = BytesParser(policy=email_policy.default).parsebytes(
            ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode("ascii") + raw)
        require(message.is_multipart() and not message.defects, "Native quote storage body changed.")
        fields, files = {}, 0
        for part in message.iter_parts():
            require(not part.is_multipart() and not part.defects and part.get_content_disposition() == "form-data",
                    "Native quote storage part changed.")
            require(len(part.get_all("content-disposition", [])) == 1
                    and len(part.get_all("content-type", [])) <= 1,
                    "Native quote storage part has duplicate headers.")
            name = part.get_param("name", header="content-disposition")
            require(isinstance(name, str) and name in allowed_fields, "Native quote storage field changed.")
            if name == "file":
                files += 1
                require(files == 1 and part.get_filename() is not None and part.get_content_type() == "application/pdf",
                        "Native quote storage file changed.")
            else:
                require(name not in fields and part.get_filename() is None,
                        "Native quote storage has duplicate fields.")
                body = part.get_payload(decode=True)
                require(isinstance(body, bytes) and len(body) <= 32768, "Native quote storage field exceeds its limit.")
                fields[name] = body.decode("utf-8", errors="strict")
        require(files == 1 and SIGNED_POLICY_FIELDS | {"Content-Type", "acl"} <= set(fields)
                and fields["Content-Type"] == "application/pdf" and fields["acl"] == acl,
                "Native quote storage fields changed.")
        bucket = urlsplit(endpoint).hostname[:-len(".storage.googleapis.com")]
        matches = [candidate for candidate in candidates if candidate["pdf"]
                   and all(fields[field] == candidate["fields"][field] for field in SIGNED_POLICY_FIELDS)
                   and _policy_conditions_match(candidate["conditions"], fields, bucket, quote["bytes"], allowed_fields)]
        require(len(matches) == 1, "Native quote storage request does not match its PDF policy.")
    except QuoteAttachmentError:
        raise
    except Exception:
        raise QuoteAttachmentError("Native quote storage body could not be verified.") from None


def _private_registration_binding(value):
    """Keep recovery coordinates, never the signed policy or credentials."""
    require(isinstance(value, dict), "Native quote registration binding is invalid.")
    names = {"version", "nativeFileId", "exactLocation", "signedKey", "registrationURL", "rendererURL", "signedFieldsDigest", "contractHash",
             "sendSourceSha256", "doneSourceSha256", "doneProfileSha256"}
    require(names <= set(value), "Native quote registration binding is incomplete.")
    result = {name: value[name] for name in names}
    native_file_ids([result["nativeFileId"]])
    require(type(result["version"]) is int and result["version"] == registration_protocol.REGISTRATION_PROTOCOL_VERSION
            and result["sendSourceSha256"] == POLICY_SEND_SHA256
            and result["doneProfileSha256"] == registration_protocol.generated_callback.SUPPORTED_DONE_PROFILE_SHA256
            and all(isinstance(result[name], str) and 0 < len(result[name]) <= limit
                and not re.search(r"[\x00-\x1f\x7f]", result[name])
                for name, limit in (("exactLocation", 16384), ("signedKey", 2048), ("registrationURL", 24000), ("rendererURL", 24000)))
            and all(isinstance(result[name], str) and re.fullmatch(r"[a-f0-9]{64}", result[name])
                    for name in ("signedFieldsDigest", "contractHash", "doneSourceSha256")),
            "Native quote registration recovery coordinates are invalid.")
    return result


def _upload_context(directory, request, create_path, registration, *, required_stage=None):
    expected = binding(request, create_path)
    attempt = read_private_json(directory, ATTEMPT_FILE)
    require(set(attempt) == set(expected) | {"attemptedAt"}
            and all(attempt.get(key) == value for key, value in expected.items()),
            "Quote upload attempt changed before recording its context.")
    value = read_private_json(directory, UPLOAD_CONTEXT_FILE)
    private_registration = _private_registration_binding(registration)
    extra = {"attemptHash", "registration", "sendSourceSha256", "doneSourceSha256", "doneProfileSha256", "stage",
             "storageStatus", "firstDeniedRequest", "createdAt", "updatedAt", "contextHash"}
    require(set(value) == set(expected) | extra
            and all(value.get(key) == item for key, item in expected.items())
            and value.get("attemptHash") == digest(attempt)
            and value.get("registration") == private_registration
            and value.get("sendSourceSha256") == POLICY_SEND_SHA256
            and value.get("doneSourceSha256") == private_registration["doneSourceSha256"]
            and value.get("doneProfileSha256") == private_registration["doneProfileSha256"]
            and value.get("contextHash") == digest({key: item for key, item in value.items() if key != "contextHash"})
            and value.get("stage") in {"policy_ready", "storage_accepted"}
            and (value["stage"] == "policy_ready" and value.get("storageStatus") is None
                 or value["stage"] == "storage_accepted" and type(value.get("storageStatus")) is int
                 and value["storageStatus"] in {200, 201, 204})
            and (required_stage is None or value["stage"] == required_stage),
            "Quote upload context changed; inspect its existing attempt.")
    try:
        require(all(datetime.fromisoformat(value[key]).tzinfo is not None for key in ("createdAt", "updatedAt")),
                "Quote upload context time is invalid.")
    except (ValueError, TypeError):
        raise QuoteAttachmentError("Quote upload context time is invalid.") from None
    return value


def begin_upload_context(folder, request, create_path, registration):
    expected = binding(request, create_path)
    private_registration = _private_registration_binding(registration)
    stamp = datetime.now(timezone.utc).isoformat()
    with private_folder(folder) as directory:
        attempt = read_private_json(directory, ATTEMPT_FILE)
        require(set(attempt) == set(expected) | {"attemptedAt"}
                and all(attempt.get(key) == value for key, value in expected.items()),
                "Quote upload attempt changed before recording its context.")
        value = {**expected, "attemptHash": digest(attempt), "registration": private_registration,
                 **{key: private_registration[key] for key in ("sendSourceSha256", "doneSourceSha256", "doneProfileSha256")},
                 "stage": "policy_ready", "storageStatus": None, "firstDeniedRequest": None,
                 "createdAt": stamp, "updatedAt": stamp}
        value["contextHash"] = digest(value)
        require(len(canonical(value)) <= MAX_RECEIPT_BYTES, "Quote upload context exceeds its limit.")
        exclusive_json(directory, UPLOAD_CONTEXT_FILE, value)
        return _upload_context(directory, request, create_path, registration, required_stage="policy_ready")


def validate_upload_context(folder, request, create_path, registration, *, required_stage=None):
    with private_folder(folder) as directory:
        return _upload_context(directory, request, create_path, registration, required_stage=required_stage)


def _update_upload_context(folder, request, create_path, registration, update):
    with private_folder(folder) as directory:
        before = os.stat(UPLOAD_CONTEXT_FILE, dir_fd=directory, follow_symlinks=False)
        value = _upload_context(directory, request, create_path, registration)
        if update(value) is False:
            return value
        value["updatedAt"] = datetime.now(timezone.utc).isoformat()
        value["contextHash"] = digest({key: item for key, item in value.items() if key != "contextHash"})
        raw = canonical(value)
        require(len(raw) <= MAX_RECEIPT_BYTES, "Quote upload context exceeds its limit.")
        temporary = ".nexvia-quote-upload-context-" + uuid.uuid4().hex
        try:
            descriptor_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                    0o600, dir_fd=directory)
            with os.fdopen(descriptor_fd, "wb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            current = os.stat(UPLOAD_CONTEXT_FILE, dir_fd=directory, follow_symlinks=False)
            identity = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
                                     info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            require(identity(current) == identity(before), "Quote upload context changed before storage acceptance.")
            os.replace(temporary, UPLOAD_CONTEXT_FILE, src_dir_fd=directory, dst_dir_fd=directory)
            os.fsync(directory)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass
        return _upload_context(directory, request, create_path, registration)


def accept_storage_upload(folder, request, create_path, registration, status):
    """Durably record storage acceptance before permitting registration."""
    require(type(status) is int and status in {200, 201, 204}, "Native quote storage did not accept the file.")
    def update(value):
        if value["stage"] == "storage_accepted":
            require(value["storageStatus"] == status, "Native quote storage status changed.")
            return False
        value.update(stage="storage_accepted", storageStatus=status)
        return True
    return _update_upload_context(folder, request, create_path, registration, update)


def record_denied_upload_request(folder, request, create_path, registration, method, url):
    """Retain a safe first-denial shape; the URL and query values stay absent."""
    target = urlsplit(url)
    words = {"staff", "upload", "uploads", "details", "file", "files", "download", "read", "list", "preview"}
    parts = target.path.split("/")
    shape = [part if part in words else "[id]" if part.isdigit() else "[segment]" for part in parts if part][:16]
    try:
        query = parse_qsl(target.query, keep_blank_values=True, max_num_fields=40)
        keys = [key if key in {"location", "id", "file_id", "field", "form", "_"} else "[other]" for key, _value in query]
    except ValueError:
        query, keys = [], ["[unbounded]"]
    safe = {"method": method if method in {"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"} else "OTHER",
            "sameOrigin": target.scheme == "https" and target.netloc == urlsplit(ORIGIN).netloc,
            "pathShape": shape, "pathSha256": hashlib.sha256(target.path.encode()).hexdigest(),
            "urlSha256": hashlib.sha256(url.encode()).hexdigest(), "queryKeys": keys,
            "nativeIdInPath": str(registration["nativeFileId"]) in parts}
    def update(value):
        if value["firstDeniedRequest"] is not None:
            return False
        value["firstDeniedRequest"] = {**safe, "stage": value["stage"]}
        return True
    return _update_upload_context(folder, request, create_path, registration, update)


def upload_quote(page, folder, request, create_path, *, native_snapshot=None, downloader=download_quote):
    """Use the native policy handshake once, then verify the draft file bytes."""
    quote = descriptor(request)
    arguments = {"filename": quote["filename"], "bytes": quote["bytes"]}
    diagnostic_stage("quote_draft")
    state = page.evaluate(NATIVE_STATE_JS, arguments)
    receipt_path = Path(folder) / RECEIPT_FILE
    if receipt_path.exists() or receipt_path.is_symlink():
        receipt = load_receipt(folder, request, create_path)
        validate_native_draft(state, request, create_path, before_upload=False, native_snapshot=native_snapshot)
        verify_file_cards(page.context, state, quote, receipt["nativeFileIds"], downloader=downloader)
        return receipt
    context_path = Path(folder) / UPLOAD_CONTEXT_FILE
    require(not context_path.exists() and not context_path.is_symlink(),
            "Quote upload context already exists. Inspect its existing attempt; do not upload again.")
    endpoint = validate_native_draft(state, request, create_path, native_snapshot=native_snapshot)
    filename = fresh_policy_filename(page, state, quote)
    acl = policy_acl(state["widgets"][0]["sendSource"])
    allowed_fields = policy_append_fields(state["widgets"][0]["sendSource"])
    try:
        registration_contract = registration_protocol.read_contract(
            page, state["widgets"][0]["doneSource"], state["widgets"][0]["sendSource"])
        validate_callback_sources(state["widgets"][0], registration_contract)
    except Exception:
        raise QuoteAttachmentError("Native quote registration source could not be verified.") from None
    payload = source_upload_payload(folder, request)
    traffic = {"policies": 0, "policy_ok": False, "options": 0, "uploads": 0,
               "registration": None, "failure": None, "candidates": [], "registration_binding": None,
               "storage_status": None, "registration_status": None, "renderer_reads": 0}

    def observation(method, route_class, *, status=None, denied=False):
        diagnostic_route_event(route_class, method if method in {"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"} else "OTHER",
                               status=status, denied=denied)

    def reject(route, route_class, code=None):
        observation(route.request.method.upper(), route_class, denied=True)
        if traffic["registration_binding"] is not None:
            try:
                record_denied_upload_request(folder, request, create_path, traffic["registration_binding"],
                                             route.request.method.upper(), route.request.url)
            except Exception:
                # The checkpoint already froze the upload identity before POST.
                # Denial observations cannot change an accepted transport.
                pass
        # A blocked background/repeated request after the one registration
        # cannot undo that transport. Final card/byte proof is still required.
        if code and traffic["registration"] is None:
            traffic["failure"] = traffic["failure"] or code
            diagnostic_failure(traffic["failure"])
        route.abort()

    def guard(route):
        current = route.request
        method, url = current.method.upper(), current.url
        if policy_path(url):
            if traffic["policies"] or traffic["uploads"] or method != "GET":
                return reject(route, "native_policy", "quote_policy_blocked")
            traffic["policies"] += 1
            diagnostic_stage("quote_policy")
            diagnostic_transport(policyRequests=traffic["policies"])
            fetched = None
            failure_code = "quote_policy_metadata"
            try:
                validate_policy_request(current, quote, filename)
                failure_code = "quote_policy_fetch"
                fetched = route.fetch(max_redirects=0, timeout=15000)
                observation("GET", "native_policy", status=fetched.status)
                failure_code = "quote_policy_http"
                require(fetched.status == 200, "Native quote policy request was not accepted.")
                failure_code = "quote_policy_response_size"
                size = fetched.headers.get("content-length")
                require(size is None or size.isdigit() and 0 < int(size) <= MAX_POLICY_BYTES,
                        "Native quote policy response exceeds its limit.")
                failure_code = "quote_policy_response"
                policy_raw = fetched.body()
                try:
                    traffic["candidates"] = validate_policy_response(policy_raw, endpoint, quote, acl, allowed_fields)
                except QuoteAttachmentError as error:
                    message = error.args[0] if len(error.args) == 1 and type(error.args[0]) is str else None
                    failure_code = POLICY_ERROR_CODES.get(message, failure_code)
                    raise
                failure_code = "quote_registration_incomplete"
                registration = registration_protocol.binding_from_policy(
                    _unique_policy_json(policy_raw), registration_contract, traffic["candidates"], quote)
                begin_upload_context(folder, request, create_path, registration)
                traffic["registration_binding"] = registration
                traffic["policy_ok"] = True
                diagnostic_stage("quote_upload")
                failure_code = "quote_policy_forward"
                route.fulfill(response=fetched)
            except Exception:
                return reject(route, "native_policy", failure_code)
            finally:
                if fetched is not None:
                    try:
                        fetched.dispose()
                    except Exception:
                        pass
        elif (url == endpoint and method == "OPTIONS" and traffic["policy_ok"]
                and not traffic["options"] and not traffic["uploads"]
                and current.headers.get("access-control-request-method", "").upper() == "POST"):
            traffic["options"] += 1
            route.continue_()
        elif (url == endpoint and method == "POST" and traffic["policy_ok"] and not traffic["uploads"]
              and traffic["failure"] is None):
            try:
                validate_storage_post(current, traffic["candidates"], endpoint, quote, acl, allowed_fields)
                validate_upload_context(folder, request, create_path, traffic["registration_binding"], required_stage="policy_ready")
            except Exception:
                return reject(route, "storage_upload", "quote_upload_incomplete")
            traffic["uploads"] += 1
            diagnostic_transport(storageUploads=traffic["uploads"])
            route.continue_()
        elif (traffic["registration_binding"] is not None
              and registration_protocol.matches_renderer_request(url, method, traffic["registration_binding"])):
            try:
                require(traffic["policy_ok"] and traffic["failure"] is None and traffic["renderer_reads"] < 4,
                        "Native quote renderer arrived outside its bounded upload.")
                validate_upload_context(folder, request, create_path, traffic["registration_binding"])
                traffic["renderer_reads"] += 1
                route.continue_()
            except Exception:
                return reject(route, "native_read")
        elif (traffic["registration_binding"] is not None
              and registration_protocol.matches_request(url, method, traffic["registration_binding"])):
            try:
                require(traffic["policy_ok"] and traffic["uploads"] == 1 and traffic["registration"] is None
                        and traffic["storage_status"] in {200, 201, 204} and traffic["failure"] is None,
                        "Native quote registration arrived outside its one accepted upload.")
                validate_upload_context(folder, request, create_path, traffic["registration_binding"], required_stage="storage_accepted")
                traffic["registration"] = url
                diagnostic_stage("quote_registration")
                diagnostic_transport(registrations=1)
                route.continue_()
            except Exception:
                return reject(route, "native_registration", "quote_registration_incomplete")
        elif url == endpoint:
            return reject(route, "storage_upload", "quote_upload_incomplete")
        elif (urlsplit(url).netloc == urlsplit(ORIGIN).netloc
              and urlsplit(url).path.startswith(registration_contract["selectedPathPrefix"])):
            return reject(route, "native_registration", "quote_registration_incomplete")
        else:
            return reject(route, "native_other" if urlsplit(url).netloc == urlsplit(ORIGIN).netloc else "external")

    def response_observation(response):
        try:
            current = response.request
            method, url = current.method.upper(), current.url
            if url == endpoint and method == "POST":
                observation(method, "storage_upload", status=response.status)
                try:
                    accept_storage_upload(folder, request, create_path, traffic["registration_binding"], response.status)
                    traffic["storage_status"] = response.status
                except Exception:
                    traffic["failure"] = traffic["failure"] or "quote_upload_incomplete"
                    diagnostic_failure(traffic["failure"])
            elif url == traffic["registration"] and method == "GET":
                observation(method, "native_registration", status=response.status)
                if response.status == 200:
                    traffic["registration_status"] = 200
                else:
                    traffic["failure"] = traffic["failure"] or "quote_registration_incomplete"
                    diagnostic_failure(traffic["failure"])
            elif (traffic["registration_binding"] is not None
                  and registration_protocol.matches_renderer_request(url, method, traffic["registration_binding"])):
                observation(method, "native_read", status=response.status)
        except Exception:
            pass

    # Browser callbacks run in their own greenlets without the preparation
    # ContextVar. Bind this operation and retain the registered cleanup refs.
    route_callback = diagnostic_callback(guard)
    response_callback = diagnostic_callback(response_observation)
    listening = False
    try:
        page.on("response", response_callback)
        listening = True
    except Exception:
        raise QuoteAttachmentError("Native quote transport observer is unavailable; no upload was started.") from None
    page.route("**/*", route_callback)
    try:
        begin_upload(folder, request, create_path)
        page.locator('input[type="file"]').set_input_files(payload)
        transport_deadline = time.monotonic() + NATIVE_TIMEOUT_MS / 1000
        page.wait_for_function("args => {const state=(" + NATIVE_STATE_JS + ")(args); return state.ids.length===1&&state.cards.length>0&&state.pending===0;}",
                               arg=arguments, timeout=NATIVE_TIMEOUT_MS)
        # The attachment renderer can finish before DONE's asynchronous GET.
        # Keep pumping browser events until that exact transport is observed;
        # reading a completed card alone does not establish registration.
        while traffic["failure"] is None and not (
                traffic["storage_status"] in {200, 201, 204} and traffic["registration_status"] == 200):
            remaining = transport_deadline - time.monotonic()
            require(remaining > 0, "Native quote registration did not finish within its upload timeout.")
            page.wait_for_timeout(min(50, max(1, int(remaining * 1000))))
        state = page.evaluate(NATIVE_STATE_JS, arguments)
        validate_native_draft(state, request, create_path, before_upload=False, native_snapshot=native_snapshot)
        validate_callback_sources(state["widgets"][0], registration_contract)
        ids = native_file_ids([int(value) for value in state.get("ids", [])])
        require(traffic["failure"] is None and traffic["policies"] == 1 and traffic["policy_ok"]
                and traffic["uploads"] == 1 and traffic["storage_status"] in {200, 201, 204}
                and traffic["registration"] is not None and traffic["registration_status"] == 200
                and ids == [traffic["registration_binding"]["nativeFileId"]],
                "Native quote upload did not complete its policy and registration.")
        validate_upload_context(folder, request, create_path, traffic["registration_binding"], required_stage="storage_accepted")
        diagnostic_stage("quote_verify")
        verify_file_cards(page.context, state, quote, ids, downloader=downloader)
        return complete_upload(folder, request, create_path, ids)
    except QuoteAttachmentError:
        diagnostic_failure(traffic["failure"] or ("quote_file_unverified" if traffic["registration"] else "quote_upload_incomplete"))
        raise
    except Exception:
        diagnostic_failure(traffic["failure"] or "quote_upload_incomplete")
        raise QuoteAttachmentError("Native quote upload did not finish; do not upload it again.") from None
    finally:
        page.unroute("**/*", route_callback)
        if listening:
            try:
                page.remove_listener("response", response_callback)
            except Exception:
                pass



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
