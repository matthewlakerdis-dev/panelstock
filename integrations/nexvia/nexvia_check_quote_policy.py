#!/usr/bin/env python3
"""Perform one controlled Nexvia quote-policy metadata GET, without an upload.

The native metadata GET may allocate an unused upload-metadata record. This is
not an upload retry or a read-only HTTP check. No native SEND callback, file
selection, storage POST, purchase-order submission, or email is performed.
"""
import argparse
import base64
from contextlib import contextmanager, ExitStack
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import ModuleType, SimpleNamespace
from urllib.parse import unquote, urlencode, urljoin, urlsplit
import uuid
import zlib


BUNDLE_BASE64 = ""
BUNDLE_SHA256 = ""
Q_SHA256 = "7ae35580eaae6bdbea79cb71ce86d33ceebbab7313494d21fcab8ccb9eeed7a5"
DIAGNOSTICS_SHA256 = "9a146254aa66f3b33c3ad4780f95e8fa2c61f006772fc403128d02e4f0a2328e"
DEPLOYED_SHA256 = {"nexvia_create.py": "98bd170cb83c43fe94094899ee8557605fcd18e533b4b394ca21c017c267d58c",
                  "nexvia_allocations.py": "071cb5f796b0cd91bfe1ce67d7c1799ea0066ae8119a78d2d19c715e6a3fefe9"}
REPORT_DIRECTORY = "nexvia-policy-checks-v2"
PRIOR_REPORT_DIRECTORY = "nexvia-policy-checks"
REPORT_VERSION = 2
MAX_REPORT = 256 * 1024
MARKERS = ("nexvia-quote-upload-attempt.json", "nexvia-quote-upload.json", "nexvia-prepared.json",
           "nexvia-create-attempt.json", "nexvia-result.json")
PAYLOAD_FIELDS = {"requestId", "reference", "projectPageId", "requestor", "date", "supplierId", "supplierReference",
                  "serviceId", "breakdownType", "quote", "lines", "subtotalCents", "taxCents", "totalCents",
                  "testOnly", "nexviaSubmissionEnabled"}
SAFE_FIELDS = {"key", "policy", "bucket", "acl", "Content-Type", "Content-Disposition", "Content-Encoding",
               "Cache-Control", "x-goog-algorithm", "x-goog-credential", "x-goog-date", "x-goog-signature",
               "success_action_status", "success_action_redirect", "file", "filename", "name"}
SAFE_CONTAINERS = {"data", "fields", "file", "response", "result", "_resp", "upload", "signed", "security"}
CANONICAL_FIELDS = {name.casefold(): name for name in SAFE_FIELDS | {"Expires"}}


class PolicyCheckError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise PolicyCheckError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


@contextmanager
def runtime_bundle(bundle=None, *, lock_root=None, verify=False):
    """Load reviewed code in RAM, without replacing deployed module files."""
    compressed = base64.b64decode(BUNDLE_BASE64, validate=True) if bundle is None else bundle
    if bundle is None:
        require(hashlib.sha256(compressed).hexdigest() == BUNDLE_SHA256, "bundle_checksum")
    require(0 < len(compressed) <= 1024 * 1024, "bundle_size")
    unpacker = zlib.decompressobj()
    raw = unpacker.decompress(compressed, 1024 * 1024 + 1)
    require(len(raw) <= 1024 * 1024 and unpacker.eof and not unpacker.unconsumed_tail, "bundle_size")
    manifest = json.loads(raw)
    expected = {"nexvia_quote_attachment.py", "nexvia_preparation_diagnostics.py", "nexvia_inspect_failed_quote_upload.py"}
    require(isinstance(manifest, dict) and set(manifest) == expected, "bundle_manifest")
    code = {}
    for name, entry in manifest.items():
        data = base64.b64decode(entry["source"], validate=True)
        require(0 < len(data) <= 256 * 1024 and hashlib.sha256(data).hexdigest() == entry["sha256"], "bundle_checksum")
        code[name] = data
    require(hashlib.sha256(code["nexvia_quote_attachment.py"]).hexdigest() == Q_SHA256
            and hashlib.sha256(code["nexvia_preparation_diagnostics.py"]).hexdigest() == DIAGNOSTICS_SHA256, "bundle_runtime_pin")
    previous = sys.modules.get("nexvia_preparation_diagnostics")
    helper = ModuleType("nexvia_preparation_diagnostics")
    quote = ModuleType("nexvia_quote_policy_check_runtime")
    inspector = ModuleType("nexvia_quote_policy_check_inspector")
    try:
        exec(compile(code["nexvia_inspect_failed_quote_upload.py"], "<reviewed-policy-parser>", "exec"), inspector.__dict__)
        with ExitStack() as stack:
            if lock_root is not None:
                stack.enter_context(inspector.existing_bridge_lock(lock_root))
                if verify: verify_deployed(lock_root)
            exec(compile(code["nexvia_preparation_diagnostics.py"], "<reviewed-policy-diagnostics>", "exec"), helper.__dict__)
            sys.modules[helper.__name__] = helper
            exec(compile(code["nexvia_quote_attachment.py"], "<reviewed-policy-validator>", "exec"), quote.__dict__)
            yield quote, inspector, {**{name: hashlib.sha256(data).hexdigest() for name, data in code.items()},
                                     "bundleSha256": hashlib.sha256(compressed).hexdigest()}
    finally:
        if previous is None:
            sys.modules.pop("nexvia_preparation_diagnostics", None)
        else:
            sys.modules["nexvia_preparation_diagnostics"] = previous


def originals(root, identifier, inspector):
    proof, records = {}, {}
    with inspector.private_directory(root / "nexvia-requests"), inspector.private_directory(root / "nexvia-requests" / identifier) as folder:
        for name in ("request.json", *MARKERS, "nexvia-preparation-diagnostic.json"):
            raw, identity = inspector.private_file(folder, name, 8 * 1024 * 1024, optional=name != "request.json")
            proof[name] = identity
            if raw is not None:
                records[name] = inspector.json_object(raw)
    with inspector.private_directory(root / "panelstock-request-journal") as directory:
        raw, proof["mainJournal"] = inspector.private_file(directory, "request-" + identifier + ".json", 8 * 1024 * 1024)
        records["mainJournal"] = inspector.json_object(raw)
    return proof, records


def validate_originals(records, identifier, q):
    require(set(MARKERS) & set(records) == {MARKERS[0]}, "original_attempt_only_required")
    request, attempt, journal = records["request.json"], records[MARKERS[0]], records["mainJournal"]
    require(request.get("requestId") == identifier and request.get("quote") is not None, "original_identity")
    metadata = q.descriptor(request)
    expected = q.binding(request, attempt.get("createPath"))
    require(set(attempt) == set(expected) | {"attemptedAt"}
            and all(attempt.get(key) == value for key, value in expected.items()), "original_attempt_binding")
    outbound = journal.get("outbound", {})
    require(journal.get("phase") == "TERMINAL" and journal.get("reported") is True
            and journal.get("kind") == "request" and journal.get("id") == identifier
            and outbound.get("state") == "needs_review" and "preparedHash" not in journal
            and all(outbound.get(key) == journal.get(key) for key in ("workerId", "id", "kind", "claimToken")), "original_terminal_state")
    work = {"id": identifier, "kind": "request", "projectPageId": request["projectPageId"],
            "payload": {key: request.get(key) for key in PAYLOAD_FIELDS}}
    if journal.get("documentExpected") is True: work["documentExpected"] = True
    if journal.get("quoteAttachmentVersion") == 1: work["quoteAttachmentVersion"] = 1
    require(journal.get("workHash") == digest(work), "original_work_binding")
    return request, metadata, attempt


def source_route_contract(source, q, parser):
    require(isinstance(source, str) and hashlib.sha256(source.encode()).hexdigest() == q.POLICY_SEND_SHA256, "send_source_pin")
    tokens = parser._protocol_tokens(source)
    start = next((index for index, token in enumerate(tokens) if token == ("id", "if")), None)
    require(start is not None and tokens[start + 1] == ("punct", "("), "policy_branch_structure")
    end = parser._balanced(tokens, start + 1)
    require(end is not None, "policy_branch_structure")
    controller, accepted = None, []
    for comparison in parser._split_tokens(tokens[start + 2:end], "||"):
        require(len(comparison) == 3 and comparison[0][0] == "id" and comparison[1] == ("punct", "===")
                and comparison[2][0] == "string", "policy_branch_structure")
        if controller is None: controller = comparison[0][1]
        require(comparison[0][1] == controller and len(comparison[2][1]) <= 100, "policy_branch_structure")
        accepted.append(comparison[2][1])
    require(controller is not None and 0 < len(accepted) <= 20, "policy_branch_structure")
    cursor = end + 1
    require(tokens[cursor] == ("punct", "{"), "policy_branch_structure")
    body_end = parser._balanced(tokens, cursor)
    true_body = tokens[cursor + 1:body_end]
    require(len(true_body) in {3, 4} and true_body[0][0] == "id" and true_body[1] == ("punct", "=")
            and true_body[2][0] == "string" and (len(true_body) == 3 or true_body[3] == ("punct", ";")), "policy_branch_structure")
    url_name, root_path = true_body[0][1], true_body[2][1]
    cursor = body_end + 1
    require(tokens[cursor:cursor + 2] == [("id", "else"), ("punct", "{")], "policy_branch_structure")
    body_end = parser._balanced(tokens, cursor + 1)
    false_body = tokens[cursor + 2:body_end]
    if false_body and false_body[-1] == ("punct", ";"): false_body = false_body[:-1]
    require(len(false_body) == 7 and false_body[:2] == [("id", url_name), ("punct", "=")]
            and false_body[2][0] == "string" and false_body[3:6] == [("punct", "+"), ("id", controller), ("punct", "+")]
            and false_body[6][0] == "string", "policy_branch_structure")
    ajax = []
    for index in range(len(tokens) - 3):
        if tokens[index:index + 4] == [("punct", "."), ("id", "ajax"), ("punct", "("), ("punct", "{")]:
            close = parser._balanced(tokens, index + 3)
            fields = dict(parser._object_fields(tokens[index + 3:close + 1]))
            if fields.get("type") == [("string", "GET")] and fields.get("async") == [("id", "false")]:
                ajax.append(fields)
    require(len(ajax) == 1 and ajax[0].get("url") == [("id", url_name)], "policy_callsite_structure")
    data = parser._object_fields(ajax[0].get("data", []))
    require([name for name, _ in data] == ["file_name", "file_size", "file_type"], "policy_metadata_structure")
    members = [parser._member(value) for _, value in data]
    require(all(isinstance(path, list) and len(path) == 2 for path in members)
            and len({path[0] for path in members}) == 1 and members[1][1] == "size" and members[2][1] == "type", "policy_metadata_structure")
    return {"controller": controller, "accepted": accepted, "root": root_path,
            "prefix": false_body[2][1], "suffix": false_body[6][1]}


SEND_METADATA_EXPRESSION = r"""(() => {
 const own=(object,name)=>{const d=Object.getOwnPropertyDescriptor(object,name);if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))return undefined;return d.value;};
 const forms=[...document.forms].filter(form=>{const u=new URL(form.action,location.href);return u.origin===location.origin&&u.pathname===location.pathname&&form.querySelector('[name="form[Lines]"]');});
 const inputs=[...document.querySelectorAll('input[type="file"]')];if(forms.length!==1||inputs.length!==1||!forms[0].contains(inputs[0])||inputs[0].form!==forms[0])throw Error('metadata');
 const jq=window.jQuery||window.$;if(typeof jq!=='function')throw Error('metadata');const cache=jq(inputs[0]).data();if(!cache||typeof cache!=='object')throw Error('metadata');
 const found=[];for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(cache))){if(!Object.prototype.hasOwnProperty.call(descriptor,'value'))continue;const widget=descriptor.value;if(!widget||typeof widget!=='object')continue;const options=own(widget,'options');if(!options||typeof options!=='object')continue;const send=own(options,'send');if(typeof send==='function'&&!found.includes(send))found.push(send);}
 if(found.length!==1)throw Error('metadata');return {send:found[0],source:Function.prototype.toString.call(found[0])};
})()"""


def _properties(session, object_id):
    value = session.send("Runtime.getProperties", {"objectId": object_id, "ownProperties": True,
        "accessorPropertiesOnly": False, "generatePreview": False})
    require("exceptionDetails" not in value and isinstance(value.get("result"), list), "scope_metadata")
    return value


def _data(descriptor):
    return isinstance(descriptor, dict) and "get" not in descriptor and "set" not in descriptor and isinstance(descriptor.get("value"), dict)


def controller_value(page, expected_source_hash, name):
    require(re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]{0,79}", name) is not None, "controller_identifier")
    session, group = page.context.new_cdp_session(page), "policy-check-" + uuid.uuid4().hex
    try:
        result = session.send("Runtime.evaluate", {"expression": SEND_METADATA_EXPRESSION, "returnByValue": False,
            "generatePreview": False, "objectGroup": group, "silent": True})
        require("exceptionDetails" not in result and isinstance(result.get("result", {}).get("objectId"), str), "send_metadata")
        values = _properties(session, result["result"]["objectId"])["result"]
        send = [value for value in values if value.get("name") == "send"]
        source = [value for value in values if value.get("name") == "source"]
        require(len(send) == len(source) == 1 and _data(send[0]) and _data(source[0]), "send_metadata")
        fn, text = send[0]["value"], source[0]["value"]
        require(fn.get("type") == "function" and isinstance(fn.get("objectId"), str)
                and text.get("type") == "string" and isinstance(text.get("value"), str)
                and hashlib.sha256(text["value"].encode()).hexdigest() == expected_source_hash, "send_source_pin")
        scopes = [value.get("value") for value in _properties(session, fn["objectId"]).get("internalProperties", []) if value.get("name") == "[[Scopes]]"]
        require(len(scopes) == 1 and isinstance(scopes[0].get("objectId"), str), "scope_metadata")
        indexed = [value for value in _properties(session, scopes[0]["objectId"])["result"] if isinstance(value.get("name"), str) and value["name"].isdigit()]
        require(0 < len(indexed) <= 32, "scope_metadata")
        for descriptor in sorted(indexed, key=lambda value: int(value["name"])):
            scope = descriptor.get("value") or {}
            if scope.get("description") == "Global": continue
            require(isinstance(scope.get("objectId"), str), "scope_metadata")
            binding = [value for value in _properties(session, scope["objectId"])["result"] if value.get("name") == name]
            if not binding: continue
            require(len(binding) == 1 and _data(binding[0]), "controller_not_data")
            scalar = binding[0]["value"]
            require(scalar.get("type") == "string" and isinstance(scalar.get("value"), str)
                    and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,59}", scalar["value"]), "controller_not_namespace")
            return scalar["value"]
        raise PolicyCheckError("controller_not_found")
    finally:
        try: session.send("Runtime.releaseObjectGroup", {"objectGroup": group})
        except Exception: pass
        try: session.detach()
        except Exception: pass


def condition_field_shape(field, source_fields=()):
    """Expose syntax and source membership without disclosing unknown names."""
    string = isinstance(field, str)
    prefix = string and field.startswith("$")
    name = field[1:] if prefix else field if string else None
    safe = isinstance(name, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,79}", name) is not None
    known = CANONICAL_FIELDS.get(name.casefold()) if safe else None
    appended = {value for value in source_fields if isinstance(value, str)}
    result = {"fieldType": "string" if string else "null" if field is None else "boolean" if type(field) is bool
              else "number" if type(field) in (int, float) else "array" if isinstance(field, list)
              else "object" if isinstance(field, dict) else "other",
              "dollarPrefix": prefix, "safeASCIIFieldName": safe,
              "sourceAppendedExact": string and name in appended,
              "sourceAppendedCaseFold": string and any(name.casefold() == value.casefold() for value in appended),
              "canonicalKnownField": known}
    if isinstance(name, str):
        result["nameLength"] = len(name)
        result["nameSha256"] = hashlib.sha256(name.encode("utf-8", errors="surrogatepass")).hexdigest()
    return result


def response_shape(raw, q, *, endpoint=None, acl=None, metadata=None, source_fields=()):
    try: root = q._unique_policy_json(raw)
    except Exception: return {"json": "invalid", "candidates": []}
    if not isinstance(root, dict): return {"json": "nonobject", "candidates": []}
    candidates, stack, nodes, aliases = [], [(root, [])], 0, {}
    while stack and nodes < 100:
        value, path = stack.pop(0); nodes += 1
        if len(q.SIGNED_POLICY_FIELDS & set(value)) >= 2 or "policy" in value: candidates.append((value, path))
        if len(path) < 4:
            for name, child in value.items():
                if isinstance(child, dict):
                    if name not in SAFE_CONTAINERS:
                        aliases.setdefault(name, "[child-" + str(len(aliases)) + "]")
                    stack.append((child, path + [name if name in SAFE_CONTAINERS else aliases[name]]))
    result = {"json": "object", "candidateCount": min(len(candidates), 3),
              "completeCandidates": min(sum(q.SIGNED_POLICY_FIELDS <= set(value) for value, _ in candidates), 3),
              "truncated": bool(stack) or len(candidates) > 2, "candidates": []}
    candidates.sort(key=lambda item: not (q.SIGNED_POLICY_FIELDS <= set(item[0])))
    bucket = urlsplit(q.gcs_upload_url(endpoint)).hostname[:-len(".storage.googleapis.com")] if endpoint else None
    kind = lambda value: "null" if value is None else "boolean" if type(value) is bool else "number" if type(value) in (int, float) else "string" if isinstance(value, str) else "array" if isinstance(value, list) else "object" if isinstance(value, dict) else "other"
    for candidate, path in candidates[:2]:
        item = {"path": path or ["root"], "fields": {field: kind(candidate[field]) for field in sorted(SAFE_FIELDS & set(candidate))},
                "complete": q.SIGNED_POLICY_FIELDS <= set(candidate),
                "mandatoryMissing": sorted(q.SIGNED_POLICY_FIELDS - set(candidate)),
                "mandatoryNonString": sorted(field for field in q.SIGNED_POLICY_FIELDS if not isinstance(candidate.get(field), str)), "conditions": []}
        algorithm, date, credential, signature, key = (candidate.get(field) for field in
            ("x-goog-algorithm", "x-goog-date", "x-goog-credential", "x-goog-signature", "key"))
        item["checks"] = {
            "algorithmSupported": isinstance(algorithm, str) and algorithm in {"GOOG4-RSA-SHA256", "GOOG4-HMAC-SHA256"},
            "dateFormat": isinstance(date, str) and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z", date) is not None,
            "credentialFormat": isinstance(credential, str) and re.fullmatch(r"[A-Za-z0-9._%+@-]{1,254}/[0-9]{8}/[A-Za-z0-9_-]{1,40}/storage/goog4_request", credential) is not None,
            "dateMatches": isinstance(date, str) and isinstance(credential, str) and len(credential.split("/")) > 1 and credential.split("/")[1] == date[:8],
            "signatureHex": isinstance(signature, str) and re.fullmatch(r"[a-fA-F0-9]+", signature) is not None,
            "signatureLengthAllowed": isinstance(signature, str) and len(signature) in ({64} if algorithm == "GOOG4-HMAC-SHA256" else {256, 512, 768, 1024}),
            "keySafe": isinstance(key, str) and 0 < len(key) <= 2048 and not key.startswith("/") and not re.search(r"[\\?#]", key)
                       and "://" not in key and all(unquote(part) not in {".", ".."} for part in key.split("/")),
            "bucketMatches": candidate["bucket"] == bucket if "bucket" in candidate and bucket is not None else None,
            "aclMatches": candidate["acl"] == acl if "acl" in candidate and acl is not None else None,
            "expiryValid": False, "expiryFuture": False,
        }
        def protected_match(name, expected, operation="eq"):
            actual = bucket if name == "bucket" else acl if name == "acl" else "application/pdf" if name == "Content-Type" else candidate.get(name) if name in q.SIGNED_POLICY_FIELDS else None
            if actual is None: return None
            return isinstance(actual, str) and isinstance(expected, str) and (actual == expected if operation == "eq" else actual.startswith(expected))
        try:
            encoded = candidate.get("policy")
            require(isinstance(encoded, str) and len(encoded) <= 32768, "shape_policy")
            document = q._unique_policy_json(base64.b64decode(encoded, validate=True))
            conditions = document.get("conditions")
            require(isinstance(conditions, list) and len(conditions) <= 100, "shape_policy")
            item["expirationType"] = kind(document.get("expiration"))
            try:
                expiry = datetime.fromisoformat(document["expiration"].replace("Z", "+00:00"))
                item["checks"]["expiryValid"] = expiry.tzinfo is not None and expiry.utcoffset().total_seconds() == 0
                item["checks"]["expiryFuture"] = item["checks"]["expiryValid"] and expiry.timestamp() > q.time.time()
            except Exception:
                item["checks"]["expiryValid"], item["checks"]["expiryFuture"] = False, False
            for condition in conditions:
                if isinstance(condition, dict):
                    item["conditions"].append({"op": "object-eq", "fields": {field if field in SAFE_FIELDS else "[other]": kind(value) for field, value in condition.items()},
                        "protectedMatches": {field: protected_match(field, value) for field, value in condition.items() if field in SAFE_FIELDS and protected_match(field, value) is not None}})
                elif isinstance(condition, list) and len(condition) == 3:
                    op, field, value = condition
                    if op == "content-length-range":
                        row = {"op": op, "minimumType": kind(field), "maximumType": kind(value)}
                        if metadata is not None: row["coversSourceSize"] = type(field) is int and type(value) is int and 0 <= field <= metadata["bytes"] <= value
                        item["conditions"].append(row)
                    else:
                        name = field[1:] if isinstance(field, str) and field.startswith("$") else "[other]"
                        row = {"op": op if isinstance(op, str) and op in {"eq", "starts-with"} else "[other]", "field": name if name in SAFE_FIELDS else "[other]", "valueType": kind(value)}
                        row.update(condition_field_shape(field, source_fields))
                        if op == "starts-with" and isinstance(value, str): row["emptyPrefix"] = value == ""
                        if isinstance(op, str) and op in {"eq", "starts-with"} and protected_match(name, value, op) is not None:
                            row["protectedMatches"] = protected_match(name, value, op)
                        item["conditions"].append(row)
                else: item["conditions"].append({"op": "invalid", "valueType": kind(condition)})
        except Exception: item["policyDocument"] = "invalid"
        result["candidates"].append(item)
    return result


def browser_guard(route, target):
    request = route.request
    try:
        url = urlsplit(request.url)
        read = request.method.upper() in {"GET", "HEAD", "OPTIONS"}
        asset = getattr(request, "resource_type", "other") in {"script", "stylesheet", "image", "font", "media"} \
            and re.search(r"\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp[34]|webm)$", url.path, re.I)
        registration = url.hostname == "lennox.nexvia.com.au" and re.match(r"^/staff/upload/details(?:/|$)", url.path)
        mutation = re.search(r"purchase-order-(?:modify|print|send|delete|approve|save)|/(?:send|delete|remove|save|print|email|approve|stock|outlook|logout)(?:/|$)", url.path, re.I)
        safe_origin = url.netloc == "lennox.nexvia.com.au" and not re.search(r"/upload(?:/|$)", url.path, re.I)
        allowed = read and url.scheme in {"http", "https"} and bool(url.hostname) and not registration and not mutation \
            and (asset or safe_origin and ("purchase-order-add" not in url.path or request.url == target))
    except Exception: allowed = False
    route.fallback() if allowed else route.abort()


def prohibited(*args, **kwargs):
    raise PolicyCheckError("prohibited_action")


@contextmanager
def guarded_native_context(browser, creator, target):
    source = next((context for context in browser.contexts if any(page.url.startswith("https://lennox.nexvia.com.au/staff/") and "/login" not in page.url for page in context.pages)), None)
    require(source is not None, "browser_sign_in")
    with creator.quote_browser_context(browser, source) as context:
        original_new_page = context.new_page
        def new_page(*args, **kwargs):
            page = original_new_page(*args, **kwargs)
            native_route = page.route
            def register(pattern, handler, **options):
                native_route(pattern, handler, **options)
                native_route("**/*", lambda route: browser_guard(route, target))
            page.route = register
            native_route("**/*", lambda route: browser_guard(route, target))
            if hasattr(page, "set_input_files"): page.set_input_files = prohibited
            original_locator = page.locator
            def locator(*args, **kwargs):
                control = original_locator(*args, **kwargs)
                if hasattr(control, "set_input_files"): control.set_input_files = prohibited
                return control
            page.locator = locator
            return page
        context.new_page = new_page
        try: yield context
        finally: context.new_page = original_new_page


AJAX_DEFAULTS_JS = r"""() => {
 const own=(o,k)=>{if(!o||!['object','function'].includes(typeof o))return {missing:true};const d=Object.getOwnPropertyDescriptor(o,k);return !d?{missing:true}:Object.prototype.hasOwnProperty.call(d,'value')?{value:d.value}:{accessor:true};};
 const kind=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
 const lib=own(window,'jQuery'),alt=own(window,'$'),jq=typeof lib.value==='function'?lib.value:typeof alt.value==='function'?alt.value:null;
 const setting=own(jq,'ajaxSettings');if(!setting.value||kind(setting.value)!=='object')return {blocked:true,reason:'settings',data:{kind:'unavailable',extraCount:0,fields:[]},headers:[],headerShape:[],cache:'unset'};
 const settings=setting.value,data=own(settings,'data'),before=own(settings,'beforeSend'),cache=own(settings,'cache'),headers=own(settings,'headers');
 let blocked=!!data.accessor||!!before.accessor||!!headers.accessor||!!cache.accessor,fields=[],extra=0,values=[],headerShape=[];
 if(!data.missing&&data.value!==undefined&&data.value!==null){if(kind(data.value)==='object'){for(const [name,d]of Object.entries(Object.getOwnPropertyDescriptors(data.value)).slice(0,40)){const type=Object.prototype.hasOwnProperty.call(d,'value')?kind(d.value):'accessor';const unknown=!['file_name','file_size','file_type','_'].includes(name);if(unknown)extra++;if(unknown||!['string','number','boolean','undefined','null'].includes(type))blocked=true;fields.push({alias:'d'+fields.length,type,extra:unknown});}}else if(typeof data.value!=='string'||data.value!=='')blocked=true;}
 if(typeof before.value==='function')blocked=true;
 if(!cache.missing&&cache.value!==undefined&&typeof cache.value!=='boolean')blocked=true;
 if(headers.value!==undefined&&headers.value!==null){if(kind(headers.value)!=='object')blocked=true;else for(const [name,d]of Object.entries(Object.getOwnPropertyDescriptors(headers.value)).slice(0,40)){const type=Object.prototype.hasOwnProperty.call(d,'value')?kind(d.value):'accessor';headerShape.push({alias:'h'+headerShape.length,type});if(type!=='string')blocked=true;else values.push({name,value:d.value});}}
 return {blocked,data:{kind:data.missing?'undefined':kind(data.value),extraCount:extra,fields},headers:values,headerShape,beforeSend:typeof before.value==='function',cache:typeof cache.value==='boolean'?cache.value:'unset'};
}"""


def native_ajax_defaults(page):
    value = page.evaluate(AJAX_DEFAULTS_JS)
    require(isinstance(value, dict), "native_ajax_defaults")
    shape = {key: value.get(key) for key in ("data", "headerShape", "beforeSend", "cache")}
    headers, total = {}, 0
    forbidden = {"cookie", "host", "content-length", "origin", "referer", "user-agent", "accept", "accept-encoding", "x-requested-with", "connection", "transfer-encoding"}
    raw_headers = value.get("headers", [])
    require(isinstance(raw_headers, list) and len(raw_headers) <= 20, "native_ajax_defaults")
    for row in raw_headers:
        require(isinstance(row, dict) and isinstance(row.get("name"), str) and re.fullmatch(r"[!#$%&'*+.^_`|~A-Za-z0-9-]{1,80}", row["name"])
                and isinstance(row.get("value"), str) and len(row["value"]) <= 4096 and not re.search(r"[\x00-\x1f\x7f]", row["value"]), "native_ajax_defaults")
        total += len(row["value"])
        if row["name"].lower() not in forbidden: headers[row["name"]] = row["value"]
    require(total <= 16384, "native_ajax_defaults")
    return shape, headers, value.get("blocked") is True


def inspect_policy(browser, request, metadata, attempt, q, parser, report, checkpoint, creator):
    target = q.ORIGIN + attempt["createPath"]
    with guarded_native_context(browser, creator, target) as context, creator.native_line_editor(
            context, request, quote_attachment=metadata) as editor:
        page = editor["page"]
        require(page.url == target and editor["createPath"] == attempt["createPath"], "native_form_redirect")
        state = page.evaluate(q.NATIVE_STATE_JS, {"filename": metadata["filename"], "bytes": metadata["bytes"]})
        q.validate_native_draft(state, request, attempt["createPath"], native_snapshot=editor)
        source = state["widgets"][0]["sendSource"]
        contract = source_route_contract(source, q, parser)
        report["stage"] = "source"
        filename = q.fresh_policy_filename(page, state, metadata)
        acl, allowed = q.policy_acl(source), q.policy_append_fields(source)
        controller = controller_value(page, q.POLICY_SEND_SHA256, contract["controller"])
        base = page.evaluate("() => document.baseURI")
        require(isinstance(base, str) and urlsplit(base).scheme == "https" and urlsplit(base).netloc == urlsplit(q.ORIGIN).netloc, "native_base_uri")
        relative = contract["root"] if controller in contract["accepted"] else contract["prefix"] + controller + contract["suffix"]
        endpoint = urljoin(base, relative)
        require(q.policy_path(endpoint) and not urlsplit(endpoint).query and not urlsplit(endpoint).fragment, "policy_endpoint_pin")
        query = urlencode({"file_name": filename, "file_size": metadata["bytes"], "file_type": "application/pdf"})
        uri = endpoint + "?" + query
        q.validate_policy_request(SimpleNamespace(method="GET", url=uri, resource_type="xhr", post_data=None), metadata, filename)
        agent = page.evaluate("() => navigator.userAgent")
        require(isinstance(agent, str) and 0 < len(agent) <= 512 and not re.search(r"[\x00-\x1f\x7f]", agent), "native_user_agent")
        defaults, headers, blocked = native_ajax_defaults(page)
        report["ajaxDefaults"] = defaults
        require(not blocked, "native_ajax_defaults")
        headers.update({"X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01",
                   "Referer": page.url, "User-Agent": agent, "Accept-Encoding": "identity"}
        )
        report.update(stage="policy_request_started", policyRequestInvoked=True)
        checkpoint()
        response = None
        try:
            try: response = context.request.get(uri, headers=headers, max_redirects=0, max_retries=0, timeout=15000)
            except Exception: raise PolicyCheckError("quote_policy_fetch") from None
            report["httpStatus"] = response.status if type(response.status) is int and 100 <= response.status <= 599 else None
            require(response.status == 200, "quote_policy_http")
            length = response.headers.get("content-length")
            require(length is None or length.isdigit() and 0 < int(length) <= q.MAX_POLICY_BYTES, "quote_policy_response_size")
            raw = response.body()
            require(isinstance(raw, bytes) and 0 < len(raw) <= q.MAX_POLICY_BYTES, "quote_policy_response_size")
            report.update(stage="policy_validation", shape=response_shape(raw, q, endpoint=state["widgets"][0]["url"], acl=acl, metadata=metadata, source_fields=allowed))
            try: q.validate_policy_response(raw, state["widgets"][0]["url"], metadata, acl, allowed)
            except q.QuoteAttachmentError as error:
                code = q.POLICY_ERROR_CODES.get(error.args[0] if len(error.args) == 1 and isinstance(error.args[0], str) else "", "quote_policy_response")
                raise PolicyCheckError(code) from None
            report.update(stage="policy_validation", status="passed", code="policy_verified")
        finally:
            if response is not None:
                try: response.dispose()
                except Exception: pass


def report_root(root, parser):
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    created = False
    try:
        try: os.mkdir(REPORT_DIRECTORY, 0o700, dir_fd=descriptor); created = True
        except FileExistsError: pass
        directory = os.open(REPORT_DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
        try:
            if created and os.fstat(directory).st_uid == os.geteuid(): os.fchmod(directory, 0o700)
            info = os.fstat(directory)
            require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700, "report_directory")
        finally: os.close(directory)
    finally: os.close(descriptor)
    return root / REPORT_DIRECTORY


def verify_deployed(root):
    for name, expected in DEPLOYED_SHA256.items():
        descriptor = os.open(root / name, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o022, "deployed_module")
            raw = stream.read(256 * 1024 + 1)
        require(len(raw) <= 256 * 1024 and hashlib.sha256(raw).hexdigest() == expected, "deployed_module_pin")


def prior_report(root, identifier, request, attempt, records, before, hashes, q, parser):
    """A second lookup is allowed only after the exact failed v1 diagnostic."""
    with parser.private_directory(root / PRIOR_REPORT_DIRECTORY) as directory:
        raw, identity = parser.private_file(directory, identifier + ".json", MAX_REPORT)
    value = parser.json_object(raw)
    unsigned = {key: item for key, item in value.items() if key != "recordHash"}
    require(value.get("recordHash") == digest(unsigned)
            and value.get("format") == "nexvia-quote-policy-check"
            and type(value.get("version")) is int and value.get("version") == 1
            and value.get("requestId") == identifier and value.get("requestHash") == q.digest(request)
            and value.get("attemptHash") == digest(attempt)
            and value.get("mainJournalHash") == digest(records["mainJournal"])
            and value.get("sourceHashes") == hashes
            and value.get("originalsUnchanged") is True
            and value.get("evidenceBeforeHash") == value.get("evidenceAfterHash") == digest(before)
            and value.get("stage") == "policy_validation" and value.get("status") == "blocked"
            and value.get("code") == "quote_policy_conditions" and value.get("httpStatus") == 200
            and value.get("policyRequestInvoked") is True
            and all(type(value.get(key)) is int and value[key] == 0 for key in ("fileUploads", "poSubmissions", "emails")),
            "prior_policy_check_identity")
    return digest(value), digest(identity)


@contextmanager
def financial_tripwires(creator, q, parser):
    with parser.tripwires(creator, q):
        saved = []
        for module, names in ((creator, ("_prepare",)), (q, ("verify_source", "_source", "verify_saved_quote", "download_quote"))):
            for name in names:
                if hasattr(module, name):
                    saved.append((module, name, getattr(module, name))); setattr(module, name, prohibited)
        try:
            try:
                api = importlib.import_module("playwright.sync_api")
                for owner_name, names in (("FileChooser", ("set_files",)), ("APIRequestContext", ("post", "put", "patch", "delete", "fetch"))):
                    owner = getattr(api, owner_name, None)
                    if owner is not None:
                        for name in names:
                            if hasattr(owner, name):
                                saved.append((owner, name, getattr(owner, name))); setattr(owner, name, prohibited)
            except ImportError: pass
            yield
        finally:
            for owner, name, value in reversed(saved): setattr(owner, name, value)


def check_policy(identifier, root=Path("/config"), *, browser=None, bundle=None, creator=None):
    require(isinstance(identifier, str) and str(uuid.UUID(identifier)) == identifier, "request_identity")
    root = Path(root)
    sys.dont_write_bytecode = True
    if str(root) not in sys.path: sys.path.insert(0, str(root))
    with runtime_bundle(bundle, lock_root=root, verify=creator is None) as (q, parser, hashes):
        creator = importlib.import_module("nexvia_create") if creator is None else creator
        before, records = originals(root, identifier, parser)
        request, metadata, attempt = validate_originals(records, identifier, q)
        prior_hash, prior_identity = prior_report(root, identifier, request, attempt, records, before, hashes, q, parser)
        path = report_root(root, parser) / (identifier + ".json")
        if path.exists() or path.is_symlink():
            with parser.private_directory(path.parent) as directory:
                raw, _ = parser.private_file(directory, path.name, MAX_REPORT)
            previous = parser.json_object(raw)
            unsigned = {key: value for key, value in previous.items() if key != "recordHash"}
            require(previous.get("recordHash") == digest(unsigned) and previous.get("requestId") == identifier
                    and previous.get("version") == REPORT_VERSION
                    and previous.get("priorPolicyCheckHash") == prior_hash
                    and previous.get("priorPolicyCheckIdentity") == prior_identity
                    and previous.get("requestHash") == q.digest(request) and previous.get("attemptHash") == digest(attempt)
                    and previous.get("mainJournalHash") == digest(records["mainJournal"])
                    and previous.get("sourceHashes") == hashes and previous.get("evidenceBeforeHash") == digest(before),
                    "policy_check_replay_identity")
            if previous.get("policyRequestInvoked") is True:
                return previous
        report = {"format": "nexvia-quote-policy-check", "version": REPORT_VERSION, "requestId": identifier,
                  "priorPolicyCheckHash": prior_hash, "priorPolicyCheckIdentity": prior_identity,
                  "requestHash": q.digest(request), "sourceHashes": hashes, "attemptHash": digest(attempt),
                  "mainJournalHash": digest(records["mainJournal"]),
                  "evidenceBeforeHash": digest(before), "evidenceAfterHash": None, "originalsUnchanged": False,
                  "stage": "evidence", "status": "blocked", "code": "policy_check_failed", "policyRequestInvoked": False,
                  "fileUploads": 0, "poSubmissions": 0, "emails": 0, "httpStatus": None, "shape": None}
        def checkpoint():
            after, _ = originals(root, identifier, parser)
            require(after == before, "original_evidence_changed")
            require(prior_report(root, identifier, request, attempt, records, before, hashes, q, parser)
                    == (prior_hash, prior_identity), "prior_policy_check_changed")
            report["evidenceAfterHash"], report["originalsUnchanged"] = digest(after), True
            report["recordHash"] = digest({key: value for key, value in report.items() if key != "recordHash"})
            require(len(canonical(report)) <= MAX_REPORT, "report_size")
            parser.save_report(path, report)
        try:
            with financial_tripwires(creator, q, parser):
                if browser is None:
                    from playwright.sync_api import sync_playwright
                    with sync_playwright() as playwright:
                        connected = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
                        inspect_policy(connected, request, metadata, attempt, q, parser, report, checkpoint, creator)
                else: inspect_policy(browser, request, metadata, attempt, q, parser, report, checkpoint, creator)
        except PolicyCheckError as error: report["code"] = str(error)
        except Exception: report["code"] = "policy_check_failed"
        finally: checkpoint()
        return report


def console_shape(shape):
    if not isinstance(shape, dict): return None
    result = {key: shape[key] for key in ("json", "candidateCount", "completeCandidates", "truncated") if key in shape}
    result["candidates"] = []
    for candidate in shape.get("candidates", [])[:2]:
        conditions, details = [], []
        for index, condition in enumerate(candidate.get("conditions", [])):
            if condition.get("op") == "object-eq":
                for field, kind in condition.get("fields", {}).items():
                    row = ["eq", field, kind]
                    if row not in conditions: conditions.append(row)
            else:
                row = [condition.get("op"), condition.get("field", "bytes"), condition.get("valueType", condition.get("minimumType"))]
                if "emptyPrefix" in condition: row.append("empty" if condition["emptyPrefix"] else "nonempty")
                if row not in conditions: conditions.append(row)
                if "fieldType" in condition and (condition.get("field") == "[other]"
                        or condition.get("dollarPrefix") is False or condition.get("sourceAppendedExact") is False):
                    details.append({"index": index, "op": condition.get("op"),
                        **{key: condition[key] for key in ("fieldType", "dollarPrefix", "safeASCIIFieldName",
                            "sourceAppendedExact", "sourceAppendedCaseFold", "canonicalKnownField", "nameLength", "nameSha256", "emptyPrefix") if key in condition}})
        conditions.sort(key=lambda row: (not (row[1] == "Content-Disposition" or "nonempty" in row or row[1] == "[other]"), str(row)))
        details.sort(key=lambda row: (candidate["conditions"][row["index"]].get("field") != "[other]",
                                     row.get("dollarPrefix") is not False, row["index"]))
        result["candidates"].append({"path": candidate.get("path"), "missing": candidate.get("mandatoryMissing"),
            "nonString": candidate.get("mandatoryNonString"), "checks": candidate.get("checks"),
            "conditions": conditions[:14], "conditionClasses": len(conditions),
            "fieldDetails": details[:4], "fieldDetailCount": len(details)})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--root", type=Path, default=Path("/config"))
    args = parser.parse_args(argv)
    report = check_policy(args.request, args.root)
    print("Policy-only check:", json.dumps({key: report[key] for key in ("stage", "status", "code", "httpStatus", "policyRequestInvoked")}, separators=(",", ":")))
    compact = console_shape(report["shape"])
    text = json.dumps(compact, separators=(",", ":"))
    if len(text) > 1800:
        for candidate in compact.get("candidates", []):
            candidate["failedChecks"] = [name for name, passed in (candidate.pop("checks", {}) or {}).items() if passed is False]
            candidate["conditions"] = candidate["conditions"][:10]
        text = json.dumps(compact, separators=(",", ":"))
    if len(text) > 2400:
        for candidate in compact.get("candidates", []):
            candidate["conditions"] = candidate["conditions"][:4]
            candidate["fieldDetails"] = candidate.get("fieldDetails", [])[:2]
        text = json.dumps(compact, separators=(",", ":"))
    print("Policy shape:", text)
    if report.get("ajaxDefaults") is not None: print("Native AJAX defaults:", json.dumps(report["ajaxDefaults"], separators=(",", ":")))
    print("One metadata GET may allocate an unused upload record. No file upload, PO submission or email was performed.")
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except Exception:
        print("Policy-only check stopped safely; no upload or PO retry was performed.")
        raise SystemExit(1)
