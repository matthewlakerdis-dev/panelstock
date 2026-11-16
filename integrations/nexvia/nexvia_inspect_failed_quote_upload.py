#!/usr/bin/env python3
"""Inspect an attempt-only quote failure without selecting a file or retrying.

Only an independently guarded, fresh unsaved form is opened. Native callback
source is tokenized without executing it; private values never enter the report.
The existing bridge lock and immutable request evidence are preserved.
"""

import argparse
from contextlib import contextmanager, ExitStack
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import uuid
from urllib.parse import parse_qsl, urljoin, urlsplit


REQUEST_MARKERS = ("nexvia-quote-upload-attempt.json", "nexvia-quote-upload.json",
                   "nexvia-prepared.json", "nexvia-create-attempt.json", "nexvia-result.json")
REPORT_NAME = "nexvia-failed-quote-upload-inspection.json"
MAX_JSON = 8 * 1024 * 1024
MAX_SOURCE = 10 * 1024 * 1024
MAX_REPORT = 4 * 1024 * 1024
MAX_CONSOLE = 2500
CONSOLE_FOOTER_RESERVE = 320
MAX_SUMMARY = MAX_CONSOLE - CONSOLE_FOOTER_RESERVE
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}


class InspectionError(ValueError):
    """A fixed message without raw browser errors or private request details."""


def require(condition, message="Read-only quote inspection stopped safely."):
    if not condition:
        raise InspectionError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def request_uuid(value):
    try:
        require(isinstance(value, str) and str(uuid.UUID(value)) == value)
    except (ValueError, TypeError, AttributeError):
        raise InspectionError("A canonical request UUID is required.") from None
    return value


@contextmanager
def private_directory(path):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(descriptor)
        require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700,
                "Original request directories must already be private.")
        yield descriptor
    except OSError:
        raise InspectionError("Original request directory is unavailable or unsafe.") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def private_file(directory, name, maximum, *, optional=False):
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    except FileNotFoundError:
        if optional:
            return None, None
        raise InspectionError("Original request evidence is missing.") from None
    except OSError:
        raise InspectionError("Original request evidence is unavailable or unsafe.") from None
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1,
                "Original request evidence must already be private and regular.")
        raw = stream.read(maximum + 1)
        require(len(raw) <= maximum, "Original request evidence exceeds its bounded limit.")
        after = os.fstat(stream.fileno())
    identity = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_nlink, item.st_size,
                             item.st_mtime_ns, item.st_ctime_ns)
    require(identity(info) == identity(after), "Original request evidence changed while reading.")
    return raw, (*identity(after), hashlib.sha256(raw).hexdigest())


def json_object(raw):
    try:
        value = json.loads(raw)
        require(isinstance(value, dict))
        canonical(value)
        return value
    except (ValueError, TypeError, UnicodeError):
        raise InspectionError("Original request JSON is invalid.") from None


def evidence(root, identifier):
    request_root = root / "nexvia-requests"
    folder = request_root / identifier
    journal_root = root / "panelstock-request-journal"
    proof, values = {}, {}
    # Opening both directory levels rejects a substituted request-root symlink.
    with private_directory(request_root), private_directory(folder) as directory:
        for name in ("request.json", *REQUEST_MARKERS, "nexvia-quote-transfer.json", "nexvia-supplier-quote.pdf"):
            raw, proof[name] = private_file(directory, name, MAX_SOURCE if name.endswith(".pdf") else MAX_JSON,
                                             optional=name in REQUEST_MARKERS)
            if raw is not None and name.endswith(".json"):
                values[name] = json_object(raw)
    with private_directory(journal_root) as directory:
        raw, proof["mainJournal"] = private_file(directory, "request-" + identifier + ".json", MAX_JSON)
        values["mainJournal"] = json_object(raw)
    return proof, values


@contextmanager
def existing_bridge_lock(root, wait_seconds=30, *, clock=time.monotonic, sleep=time.sleep):
    descriptor = None
    path = root / "panelstock-request-journal" / ".bridge.lock"
    try:
        with private_directory(path.parent) as directory:
            descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_nlink == 1 and info.st_size == 0, "The existing bridge lock is unsafe.")
        deadline = clock() + min(max(wait_seconds, 0), 30)
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                require(clock() < deadline, "The bridge is busy; no inspection was performed.")
                sleep(0.1)
        current = path.lstat()
        require((current.st_dev, current.st_ino, current.st_mode, current.st_nlink, current.st_size)
                == (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size),
                "The bridge lock changed before inspection.")
        yield
    except OSError:
        raise InspectionError("The existing bridge lock is unavailable; no inspection was performed.") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


class _SymbolicError(ValueError):
    pass


def _skip_string(source, start):
    quote, index = source[start], start + 1
    while index < len(source):
        if source[index] == "\\":
            index += 2
        elif source[index] == quote:
            return index + 1
        elif source[index] in "\r\n":
            raise _SymbolicError("unsupported_string_newline")
        else:
            index += 1
    raise _SymbolicError("unterminated_string")


def _skip_regex(source, start):
    index, in_class = start + 1, False
    while index < len(source):
        character = source[index]
        if character == "\\":
            index += 2
            continue
        if character == "[":
            in_class = True
        elif character == "]":
            in_class = False
        elif character == "/" and not in_class:
            index += 1
            while index < len(source) and source[index].isalpha():
                index += 1
            return index
        index += 1
    raise _SymbolicError("unterminated_regex")


def _skip_interpolation(source, start, templates, depth):
    if depth > 50:
        raise _SymbolicError("template_nesting_limit")
    index, braces, operand = start, 1, True
    while index < len(source):
        rest, character = source[index:], source[index]
        if rest.startswith("//"):
            end = source.find("\n", index + 2)
            index = len(source) if end < 0 else end
        elif rest.startswith("/*"):
            end = source.find("*/", index + 2)
            if end < 0:
                raise _SymbolicError("unterminated_comment")
            index = end + 2
        elif character in "\"'":
            index, operand = _skip_string(source, index), False
        elif character == "`":
            index = _skip_template(source, index, templates, depth + 1)
            operand = False
        elif character == "/" and operand:
            index, operand = _skip_regex(source, index), False
        elif character == "{":
            braces, index, operand = braces + 1, index + 1, True
        elif character == "}":
            braces -= 1
            if braces == 0:
                return index + 1
            index, operand = index + 1, False
        elif re.match(r"[A-Za-z_$]", character):
            word = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", rest).group()
            index += len(word)
            operand = word in {"return", "throw", "case", "delete", "void", "typeof", "new", "in", "instanceof", "yield", "await"}
        elif character.isspace():
            index += 1
        elif character in ")]" or character.isdigit():
            index, operand = index + 1, False
        else:
            index += 1
            if character in "([,:;?=+-*/%!&|^~<>":
                operand = True
    raise _SymbolicError("unterminated_template_interpolation")


def _skip_template(source, start, templates, depth=0):
    if depth > 50:
        raise _SymbolicError("template_nesting_limit")
    index, fragments, literal = start + 1, [], []
    while index < len(source):
        character = source[index]
        if character == "\\":
            # Escaped contents remain opaque, including escaped interpolation
            # starts and backticks; never interpret them as executable code.
            literal.append(source[index:index + 2])
            index += 2
        elif character == "`":
            fragments.append("".join(literal))
            templates.append("".join(fragments))
            return index + 1
        elif source.startswith("${", index):
            fragments.extend(("".join(literal), "DYNAMIC"))
            literal = []
            index = _skip_interpolation(source, index + 2, templates, depth + 1)
        else:
            literal.append(character)
            index += 1
    raise _SymbolicError("unterminated_template")


def _complete_symbolic_tokens(source, inspector, templates):
    """Use the established vocabulary; mask complete templates and expressions."""
    known = inspector.SYMBOL_WORDS
    tokens, aliases, index, previous = [], {}, 0, ""
    while index < len(source):
        rest, character = source[index:], source[index]
        if rest.startswith("//"):
            end = source.find("\n", index + 2)
            index = len(source) if end < 0 else end
            continue
        if rest.startswith("/*"):
            end = source.find("*/", index + 2)
            if end < 0:
                raise _SymbolicError("unterminated_comment")
            index = end + 2
            continue
        if character == "`":
            index = _skip_template(source, index, templates)
            token = "TEMPLATE_VALUE"
        elif character in "\"'":
            end = _skip_string(source, index) - 1
            literal = source[index + 1:end].replace("\\/", "/")
            token = json.dumps(literal) if literal in known | METHODS else "VALUE"
            if "form[Files]" in literal and re.search(r"<\s*(?:input|div|span|section|tr|td)\b", literal, re.I):
                token = "FILES_HIDDEN_MARKUP"
            elif literal.startswith("/staff/"):
                token = "NATIVE_ROUTE"
            elif literal.startswith(("https://", "http://")):
                token = "REMOTE_ROUTE"
            index = end + 1
        elif character == "/" and previous in {"", "(", "=", ":", ",", "return", "!", "[", "?"}:
            index = _skip_regex(source, index)
            token = "REGEXP"
        elif character.isspace():
            index += 1
            continue
        elif re.match(r"[A-Za-z_$]", character):
            word = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", rest).group()
            if word not in known:
                aliases.setdefault(word, "v" + str(len(aliases) + 1))
            token = word if word in known else aliases[word]
            index += len(word)
        elif character.isascii() and character.isdigit():
            word = re.match(r"[0-9][A-Za-z0-9_.]*", rest).group()
            token = word if word in {"0", "1"} else "NUMBER"
            index += len(word)
        elif character in "(){}[];.,:+-*/=<>!&|?%^~":
            token, index = character, index + 1
        else:
            raise _SymbolicError("unsupported_token")
        tokens.append(token)
        previous = token
    return " ".join(tokens)


def symbolic_details(source, inspector):
    result = {"symbolicComplete": None, "symbolicStatus": "unsupported", "symbolicReason": None,
              "usesTemplate": isinstance(source, str) and "`" in source,
              "unsupportedToken": False,
              "sourceCharacters": min(len(source), 65537) if isinstance(source, str) else 0,
              "templateCount": 0, "templateRoutes": []}
    if not isinstance(source, str) or len(source) > 65536:
        result["symbolicReason"] = "source_type" if not isinstance(source, str) else "source_limit"
        return result
    templates = []
    try:
        result["symbolicComplete"] = _complete_symbolic_tokens(source, inspector, templates)
        result["symbolicStatus"] = "complete"
    except _SymbolicError as error:
        result["symbolicReason"] = str(error)
        result["unsupportedToken"] = str(error) == "unsupported_token"
    except Exception:
        result["symbolicReason"] = "tokenizer_unavailable"
    result["templateCount"] = len(templates)
    for skeleton in templates[:40]:
        dynamic_prefix = skeleton.startswith("DYNAMIC")
        candidate = skeleton
        if dynamic_prefix:
            native_start = skeleton.find("/staff/")
            if native_start < 0:
                continue
            candidate = skeleton[native_start:]
        if candidate.startswith(("/staff/", "https://", "http://")):
            destination = inspector.route_info(candidate)
            if destination is not None:
                route = {"dynamicPrefix": dynamic_prefix, "destination": destination}
                if route not in result["templateRoutes"]:
                    result["templateRoutes"].append(route)
    return result


def complete_symbolic_source(source, inspector):
    return symbolic_details(source, inspector)["symbolicComplete"]


def _js_literal(value):
    """Decode static string syntax only; never evaluate JavaScript."""
    escapes = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
    output, index = [], 1
    while index < len(value) - 1:
        if value[index] != "\\":
            output.append(value[index]); index += 1; continue
        index += 1
        character = value[index]
        if character in {"u", "x"}:
            count = 4 if character == "u" else 2
            digits = value[index + 1:index + 1 + count]
            if len(digits) != count or not re.fullmatch(r"[a-fA-F0-9]+", digits):
                raise _SymbolicError("unsupported_literal_escape")
            output.append(chr(int(digits, 16))); index += count + 1
        else:
            output.append(escapes.get(character, character)); index += 1
    return "".join(output)


def _protocol_tokens(source):
    tokens, index, previous = [], 0, ""
    while index < len(source):
        rest, character = source[index:], source[index]
        if character.isspace():
            index += 1; continue
        if rest.startswith("//"):
            end = source.find("\n", index + 2); index = len(source) if end < 0 else end; continue
        if rest.startswith("/*"):
            end = source.find("*/", index + 2)
            if end < 0: raise _SymbolicError("unterminated_comment")
            index = end + 2; continue
        if character in "\"'":
            end = _skip_string(source, index)
            tokens.append(("string", _js_literal(source[index:end]))); index = end
        elif character == "`":
            templates = []; index = _skip_template(source, index, templates)
            tokens.append(("template", ""))
        elif character == "/" and previous in {"", "(", "=", ":", ",", "return", "!", "[", "?"}:
            end = _skip_regex(source, index)
            tokens.append(("regex", source[index:end])); index = end
        elif re.match(r"[A-Za-z_$]", character):
            word = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", rest).group()
            tokens.append(("id", word)); index += len(word)
        elif character.isascii() and character.isdigit():
            word = re.match(r"[0-9][A-Za-z0-9_.]*", rest).group()
            tokens.append(("number", word)); index += len(word)
        else:
            operator = next((word for word in ("===", "!==", "==", "!=", "&&", "||", "=>", "+=", "-=") if rest.startswith(word)), character)
            tokens.append(("punct", operator)); index += len(operator)
        previous = tokens[-1][1]
    return tokens


def _split_tokens(tokens, delimiter):
    groups, current, depth = [], [], 0
    for token in tokens:
        value = token[1]
        if token[0] == "punct" and value in {"(", "[", "{"}: depth += 1
        if token[0] == "punct" and value in {")", "]", "}"}: depth -= 1
        if token == ("punct", delimiter) and depth == 0:
            groups.append(current); current = []
        else: current.append(token)
    return groups + [current]


def _balanced(tokens, start):
    opener = tokens[start][1]
    closer = {"(": ")", "[": "]", "{": "}"}.get(opener)
    if closer is None: return None
    stack = [closer]
    for index in range(start + 1, len(tokens)):
        kind, value = tokens[index]
        if kind != "punct": continue
        if value in {"(", "[", "{"}: stack.append({"(": ")", "[": "]", "{": "}"}[value])
        elif value in {")", "]", "}"}:
            if not stack or stack.pop() != value: return None
            if not stack: return index
    return None


def _member(tokens):
    if not tokens or tokens[0][0] != "id": return None
    path, index = [tokens[0][1]], 1
    while index < len(tokens):
        if index + 1 < len(tokens) and tokens[index] == ("punct", ".") and tokens[index + 1][0] == "id":
            path.append(tokens[index + 1][1]); index += 2
        elif index + 2 < len(tokens) and tokens[index] == ("punct", "[") and tokens[index + 1][0] in {"string", "number"} and tokens[index + 2] == ("punct", "]"):
            path.append(tokens[index + 1][1]); index += 3
        else: return None
    return path


def _object_fields(tokens):
    if not tokens or tokens[0] != ("punct", "{") or _balanced(tokens, 0) != len(tokens) - 1: return []
    result = []
    for row in _split_tokens(tokens[1:-1], ","):
        if len(row) >= 3 and row[0][0] in {"id", "string"} and row[1] == ("punct", ":"):
            result.append((row[0][1], row[2:]))
    return result


def _assignments(tokens):
    result = []
    for index, token in enumerate(tokens):
        if token != ("punct", "="): continue
        left = next((_member(tokens[start:index]) for start in range(max(0, index - 20), index)
                     if _member(tokens[start:index]) is not None), None)
        if left is None: continue
        end, depth = index + 1, 0
        while end < len(tokens):
            kind, value = tokens[end]
            if kind == "punct" and value in {";", "}"} and depth == 0: break
            if kind == "punct" and value in {"(", "[", "{"}: depth += 1
            elif kind == "punct" and value in {")", "]", "}"}: depth -= 1
            end += 1
        result.append((left, tokens[index + 1:end]))
    return result


SAFE_PROTOCOL_FIELDS = {
    "file_name", "file_size", "file_type", "filename", "fileName", "fileSize", "fileType", "name", "size", "type",
    "mime_type", "mimeType", "content_type", "contentType", "Content-Type", "file", "files", "data", "response",
    "result", "_resp", "_success", "fields", "params", "formData", "id", "url", "key", "policy", "acl",
    "signature", "GoogleAccessId", "success_action_status", "success_action_redirect", "x-goog-algorithm",
    "x-goog-credential", "x-goog-date", "x-goog-signature", "upload_url", "uploadUrl", "upload", "error", "message",
}
SAFE_ROUTE_WORDS = {
    "staff", "upload", "uploads", "file", "files", "policy", "policies", "url", "urls", "get", "create", "new",
    "signed", "sign", "signature", "post", "form", "data", "general", "generalfile", "details", "storage", "google",
    "gcs", "request", "generate", "temporary", "temp", "direct", "put", "add", "document", "documents", "attachment",
    "attachments", "purchase", "order", "project", "projects", "job", "jobs", "client", "supplier", "admin", "account",
    "invoice", "asset", "task", "type", "pre", "presigned", "credentials", "credential", "company", "contractor",
    "geturl", "uploadurl", "getuploadurl", "signedurl", "getsignedurl", "getpolicy", "uploadpolicy", "formdata",
    "ajax", "api", "xhr", "json", "public", "metadata", "meta", "information", "info", "prepare", "init", "initialize",
    "object", "objects", "content", "status", "record", "records", "signing", "gcloud", "fileupload", "uploadfile",
    "filemetadata", "uploadmetadata", "getfileuploadurl", "getfileurl", "getmetadata", "filedata",
}


def _safe_route_segment(value):
    if value == "DYNAMIC": return True
    words = re.findall(r"[A-Z]+(?=[A-Z][a-z]|[-_]|$)|[A-Z]?[a-z]+|[0-9]+", value)
    return value.lower() in SAFE_ROUTE_WORDS or bool(words) and "".join(words).lower() == value.replace("-", "").replace("_", "").lower() \
        and all(word.lower() in SAFE_ROUTE_WORDS for word in words)


def _native_policy_path(value, base):
    try:
        target, origin = urlsplit(urljoin(base, value)), urlsplit(base)
        pieces = [piece for piece in target.path.split("/") if piece]
        if not (target.scheme == "https" and target.netloc == origin.netloc and not target.query
                and not target.fragment and target.username is None and target.password is None
                and len(target.path) <= 300 and pieces and re.search(r"upload|file|policy|sign", target.path, re.I)
                and all(re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,59}", piece)
                        and _safe_route_segment(piece) for piece in pieces)):
            return None
        return target.path
    except (ValueError, TypeError): return None


def _policy_path_details(value, base):
    accepted = _native_policy_path(value, base)
    if accepted is not None:
        return {"path": accepted, "approved": True, "reason": None, "queryKeys": []}
    try:
        target, origin = urlsplit(urljoin(base, value)), urlsplit(base)
        if target.scheme != "https" or target.netloc != origin.netloc or target.username is not None or target.password is not None:
            return {"path": "[other-origin]", "approved": False, "reason": "other_origin"}
        aliases, shape = {}, []
        for piece in target.path.split("/")[:20]:
            if not piece: shape.append("")
            elif len(piece) <= 60 and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", piece) and _safe_route_segment(piece):
                shape.append("[dynamic]" if piece == "DYNAMIC" else piece)
            else:
                aliases.setdefault(piece, "[segment-" + str(len(aliases)) + "]")
                shape.append(aliases[piece])
        reason = "query" if target.query else "fragment" if target.fragment else "unsafe_segment"
        if len(target.path) > 300: reason = "path_limit"
        keys = []
        for key, _ in parse_qsl(target.query, keep_blank_values=True, max_num_fields=20):
            safe = key if key in SAFE_PROTOCOL_FIELDS else "[key-" + str(len(keys)) + "]"
            if safe not in keys: keys.append(safe)
        return {"path": "/".join(shape)[:300], "approved": False, "reason": reason, "queryKeys": keys}
    except (ValueError, TypeError):
        return {"path": "[invalid-route]", "approved": False, "reason": "invalid_route"}


def _metadata_operation_path(value, base):
    """Recognize only a static operation under the observed upload namespace."""
    try:
        target, origin = urlsplit(urljoin(base, value)), urlsplit(base)
        pieces = [piece for piece in target.path.split("/") if piece]
        if not (target.scheme == "https" and target.netloc == origin.netloc and target.username is None
                and target.password is None and not target.query and not target.fragment
                and (len(pieces) == 2 and pieces[0] == "upload"
                     or len(pieces) == 3 and pieces[:2] == ["DYNAMIC", "upload"])):
            return None
        operation = pieces[-1]
        result = {"operationSha256": hashlib.sha256(operation.encode("utf-8")).hexdigest()}
        opaque = bool(re.fullmatch(r"[a-fA-F0-9]{16,}", operation)) or len(operation) > 24 and (
            any(character.isdigit() for character in operation) or not re.search(r"[A-Z-]", operation))
        sensitive = re.search(r"password|passwd|secret|token|auth|apikey|credential|session|cookie|private", operation, re.I)
        if re.fullmatch(r"[a-z][A-Za-z0-9-]{0,59}", operation) and not re.search(r"[A-Z]{2}", operation) \
                and not opaque and not sensitive:
            result.update(path=target.path, approved=True, reason=None)
        return result
    except (ValueError, TypeError, UnicodeError):
        return None


GLOBAL_SELECTOR_JS = r"""args => args.map(item=>{
 let value=window,available=true;
 for(const part of item.path){if(!value||!['object','function'].includes(typeof value)){available=false;break;}const d=Object.getOwnPropertyDescriptor(value,part);if(!d||!Object.prototype.hasOwnProperty.call(d,'value')){available=false;break;}value=d.value;}
 return {available,kind:available?(value===null?'null':typeof value):'unavailable',matches:item.literals.map(literal=>available&&value===literal)};
})"""


def lexical_selector_script(identifier):
    reserved = set("arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split())
    if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]{0,79}", identifier) or identifier in reserved:
        return None
    prefix = "__nexvia_lexical_probe_"
    while identifier in {prefix + suffix for suffix in ("args", "cursor", "depth", "kind", "literal")}:
        prefix += "x_"
    args, cursor, depth, kind, literal = (prefix + suffix for suffix in ("args", "cursor", "depth", "kind", "literal"))
    # The identifier is grammar-validated, never an arbitrary expression. Any
    # object property/accessor on the Window chain forbids this lexical read.
    return f"""{args} => {{
 let {cursor}=window,{depth}=0;
 while({cursor}!==null){{if(++{depth}>32)return {{available:false,reason:'prototype_limit'}};
 if(Object.getOwnPropertyDescriptor({cursor},{json.dumps(identifier)}))return {{available:false,reason:'object_property'}};
 {cursor}=Object.getPrototypeOf({cursor});}}
 try{{const {kind}=typeof {identifier};if({kind}==='undefined')return {{available:false,kind:'undefined',reason:'unbound'}};
 return {{available:true,binding:'global_lexical',kind:{identifier}===null?'null':{kind},matches:{args}.map({literal}=>{identifier}==={literal})}};
 }}catch{{return {{available:false,reason:'unbound_or_tdz'}};}}
}}"""


def policy_contract(raw, page):
    """Extract static protocol structure; no callback, request or expression runs."""
    handlers = [row for row in raw.get("handlers", []) if row.get("kind") == "send"]
    result = {"status": "unavailable", "reason": None, "sendHandlers": len(handlers), "ajax": [],
              "formData": [], "globals": [], "filenameNormalizer": {"derivedFromName": False, "operations": []}}
    if len(handlers) != 1 or not isinstance(handlers[0].get("source"), str):
        result["reason"] = "send_source_unavailable"; return result
    result["sendSourceSha256"] = hashlib.sha256(handlers[0]["source"].encode("utf-8")).hexdigest()
    try:
        tokens = _protocol_tokens(handlers[0]["source"])
        base = page.evaluate("() => document.baseURI")
        if base in (None, ""):
            base = page.url
        if not isinstance(base, str):
            result["reason"] = "unsafe_base_uri"; return result
        base_parts, page_parts = urlsplit(base), urlsplit(page.url)
        if not (base_parts.scheme == "https" and base_parts.netloc == page_parts.netloc
                and base_parts.username is None and base_parts.password is None):
            result["reason"] = "unsafe_base_uri"; return result
        assignments = _assignments(tokens)
        file_name = next((left[0] for left, right in assignments
                          if len(left) == 1 and (_member(right) or [])[1:] == ["files", "0"]), None)
        require(file_name is not None)
        normalized = {left[1] for left, right in assignments if len(left) == 2 and left[0] == file_name
                      and any(right[index:index + 3] == [("id", file_name), ("punct", "."), ("id", "name")]
                              for index in range(len(right) - 2))}
        normalizer_tokens = [token for left, right in assignments if len(left) == 2 and left[0] == file_name and left[1] in normalized for token in right]
        result["filenameNormalizer"] = {"derivedFromName": bool(normalized),
            "operations": sorted({token[1] for token in normalizer_tokens if token[0] == "id" and token[1] in {"decodeURIComponent", "replace", "replaceAll", "RegExp", "trim", "normalize"}}),
            "regexCount": sum(token[0] == "regex" for token in normalizer_tokens),
            "literalFlags": list(dict.fromkeys(token[1] if token[1] in {"", " ", "_", "-", "+", "%20", "%", ".", "g", "i", "gi", "\\r\\n", "\r\n"} else "[opaque]"
                                               for token in normalizer_tokens if token[0] == "string"))}
        globals_needed, literal_choices, candidates, field_aliases = [], {}, [], {}
        def field_name(value):
            if value in SAFE_PROTOCOL_FIELDS: return value
            field_aliases.setdefault(value, "[field-" + str(len(field_aliases)) + "]")
            return field_aliases[value]
        for index, token in enumerate(tokens):
            if token == ("punct", "===") or token == ("punct", "=="):
                if index + 1 < len(tokens) and tokens[index + 1][0] == "string":
                    left = next((_member(tokens[start:index]) for start in range(max(0, index - 12), index) if _member(tokens[start:index])), None)
                    if left: literal_choices.setdefault(tuple(left), []).append(tokens[index + 1][1])
        globals_needed.extend(literal_choices)
        for index in range(len(tokens) - 3):
            if tokens[index:index + 3] == [("punct", "."), ("id", "ajax"), ("punct", "(")] and tokens[index + 3] == ("punct", "{"):
                end = _balanced(tokens, index + 3)
                if end is None: continue
                properties = dict(_object_fields(tokens[index + 3:end + 1]))
                method = properties.get("type", properties.get("method", []))
                method = method[0][1].upper() if len(method) == 1 and method[0][0] == "string" else "unknown"
                url = properties.get("url", [])
                variable = _member(url)
                expressions = [right for left, right in assignments if left == variable] if variable else [url]
                urls = []
                for expression in expressions[:12]:
                    parts, refs, valid = [], [], True
                    for part in _split_tokens(expression, "+"):
                        if len(part) == 1 and part[0][0] == "string": parts.append(part[0][1])
                        elif _member(part):
                            reference = tuple(_member(part)); refs.append(reference); parts.append("DYNAMIC")
                            if reference not in globals_needed: globals_needed.append(reference)
                        else: valid = False
                    if valid:
                        details = _policy_path_details("".join(parts), base)
                        details["path"] = details["path"].replace("DYNAMIC", "[dynamic]")
                        urls.append({**details, "dynamic": bool(refs),
                                     "selectorIndexes": [globals_needed.index(reference) for reference in refs],
                                     "literalPieces": sum(len(part) == 1 and part[0][0] == "string" for part in _split_tokens(expression, "+")),
                                     "referenceCount": len(refs)})
                        candidates.append((len(result["ajax"]), len(urls) - 1, parts, refs))
                    else:
                        urls.append({"path": "[expression]", "approved": False,
                                     "reason": "unsupported_url_expression", "dynamic": True, "selectorIndexes": []})
                if not urls:
                    urls.append({"path": "[variable]", "approved": False,
                                 "reason": "unresolved_url_variable", "dynamic": True, "selectorIndexes": []})
                data = []
                for name, value in _object_fields(properties.get("data", [])):
                    member = _member(value)
                    source = "unknown"
                    if member and member[0] == file_name and len(member) == 2:
                        source = "normalized_filename" if member[1] in normalized else {"name": "file.name", "size": "file.size", "type": "file.type"}.get(member[1], "unknown")
                    data.append({"name": field_name(name), "source": source})
                metadata_get = method == "GET" and properties.get("async") == [("id", "false")] and data == [
                    {"name": "file_name", "source": "normalized_filename"},
                    {"name": "file_size", "source": "file.size"},
                    {"name": "file_type", "source": "file.type"}]
                if metadata_get:
                    for ajax_index, url_index, parts, refs in candidates:
                        if ajax_index == len(result["ajax"]):
                            operation = _metadata_operation_path("".join(parts), base)
                            if operation is not None:
                                urls[url_index].update(operation)
                                urls[url_index]["path"] = urls[url_index]["path"].replace("DYNAMIC", "[dynamic]")
                result["ajax"].append({"method": method if method in METHODS else "unknown",
                    "synchronous": properties.get("async") == [("id", "false")], "urlCandidates": urls,
                    "urlAssignmentCount": len(expressions), "data": data})
            if tokens[index:index + 3] == [("punct", "."), ("id", "append"), ("punct", "(")]:
                end = _balanced(tokens, index + 2)
                if end is None: continue
                arguments = _split_tokens(tokens[index + 3:end], ",")
                if len(arguments) != 2 or len(arguments[0]) != 1 or arguments[0][0][0] != "string": continue
                field = arguments[0][0][1]
                member = _member(arguments[1]); provenance = "unknown"; response_path = None
                if member and member[0] == file_name:
                    if len(member) == 1: provenance = "file_bytes"
                    elif member[1:] == ["type"]: provenance = "file.type"
                    elif len(member) > 1:
                        provenance, response_path = "file_response", [field_name(part) for part in member[1:]]
                elif len(arguments[1]) == 1 and arguments[1][0][0] == "string": provenance = "static_literal"
                result["formData"].append({"field": field_name(field), "source": provenance, "responsePath": response_path})
        resolutions = page.evaluate(GLOBAL_SELECTOR_JS, [{"path": list(path), "literals": literal_choices.get(path, [])} for path in globals_needed]) if globals_needed else []
        for index, path in enumerate(globals_needed):
            resolution = resolutions[index] if isinstance(resolutions, list) and index < len(resolutions) and isinstance(resolutions[index], dict) else {}
            if resolution.get("available") is not True and len(path) == 1:
                script = lexical_selector_script(path[0])
                if script is not None:
                    try:
                        lexical = page.evaluate(script, literal_choices.get(path, []))
                        if isinstance(lexical, dict): resolution = lexical
                    except Exception:
                        resolution = {"available": False, "reason": "lexical_unavailable"}
            matches = [position for position, matched in enumerate(resolution.get("matches", [])) if matched is True]
            result["globals"].append({"index": index, "available": resolution.get("available") is True,
                "kind": resolution.get("kind") if resolution.get("kind") in {"string", "number", "boolean", "object", "function", "undefined", "null"} else "unavailable",
                "binding": "global_lexical" if resolution.get("binding") == "global_lexical" else "object_property" if resolution.get("available") is True else "unavailable",
                "scope": "global_observation_only",
                "reason": resolution.get("reason") if resolution.get("reason") in {"prototype_limit", "object_property", "unbound", "unbound_or_tdz", "lexical_unavailable"} else None,
                "literalCount": len(literal_choices.get(path, [])), "matchingLiteralIndexes": matches})
            # A selected static branch enum can complete an endpoint without
            # publishing arbitrary global values. Ambiguity remains explicit.
            if len(matches) == 1 and matches[0] < len(literal_choices.get(path, [])):
                selected = literal_choices[path][matches[0]]
                for ajax_index, url_index, parts, refs in candidates:
                    if refs == [path]:
                        resolved = _native_policy_path("".join(selected if part == "DYNAMIC" else part for part in parts), base)
                        if resolved is not None: result["ajax"][ajax_index]["urlCandidates"][url_index]["matchedLiteralPath"] = resolved
        result["status"] = "complete" if result["ajax"] and result["formData"] else "partial"
    except Exception:
        result["status"], result["reason"] = "partial", "unsupported_protocol_structure"
    return result


OWNERSHIP_JS = r"""() => {
 const visible=el=>{if(!el||!el.getClientRects().length)return false;for(let n=el;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||['hidden','collapse'].includes(s.visibility)||s.opacity!==''&&Number(s.opacity)===0)return false;}return true;};
 const forms=[...document.forms].filter(form=>{try{const u=new URL(form.action,location.href);return u.origin===location.origin&&u.pathname===location.pathname&&form.querySelector('[name="form[Lines]"]');}catch{return false;}});
 const form=forms.length===1?forms[0]:null;
 const ancestors=el=>{const rows=[];for(let n=el?.parentElement,d=0;n&&d<12;n=n.parentElement,d++){if(n.matches('.tab-pane,.panel,[data-file-panel],[role="tabpanel"]'))rows.push({depth:d,tag:n.tagName,tab:n.matches('.tab-pane,[role="tabpanel"]'),panel:n.matches('.panel,[data-file-panel]'),visible:visible(n),hidden:n.hidden===true});}return rows;};
 const label=el=>String(el.textContent||el.value||'').replace(/\s+/g,' ').trim();
 const inputs=[...document.querySelectorAll('input[type="file"]')].slice(0,12).map(el=>({formIsPO:!!form&&el.form===form,containedByPO:!!form&&form.contains(el),visible:visible(el),selected:el.files?.length||0,ancestors:ancestors(el)}));
 const fields=[...document.querySelectorAll('[name="form[Files][]"],[name="form[Files]"]')].slice(0,40).map(el=>({formIsPO:!!form&&el.form===form,containedByPO:!!form&&form.contains(el),empty:el.value==='',numeric:/^[1-9][0-9]*$/.test(String(el.value||'')),visible:visible(el),ancestors:ancestors(el)}));
 const links=[...document.querySelectorAll('a[href]')].filter(el=>/^(download|download file)$/i.test(label(el))).slice(0,12).map(el=>({formIsPO:!!form&&el.closest('form')===form,containedByPO:!!form&&form.contains(el),visible:visible(el),ancestors:ancestors(el)}));
 return {poForms:forms.length,inputs,fields,downloadLinks:links,selectorCounts:{progress:document.querySelectorAll('.k-file-progress,.fileupload-progress').length,errors:document.querySelectorAll('.k-file-error,.fileupload-error').length,success:document.querySelectorAll('.k-file-success,[data-upload-status="complete"],[data-upload-status="uploaded"]').length}};
}"""


def clean_ownership(raw):
    def rows(values):
        result = []
        for value in values[:40] if isinstance(values, list) else []:
            if not isinstance(value, dict):
                continue
            item = {key: value[key] is True for key in ("formIsPO", "containedByPO", "visible", "empty", "numeric") if key in value}
            if type(value.get("selected")) is int:
                item["selected"] = max(0, min(value["selected"], 10000))
            item["ancestors"] = [{"depth": min(max(ancestor.get("depth", 0), 0), 12),
                                  "tag": ancestor.get("tag") if ancestor.get("tag") in {"DIV", "SECTION", "ARTICLE", "FIELDSET", "TD", "SPAN"} else "OTHER",
                                  **{key: ancestor.get(key) is True for key in ("tab", "panel", "visible", "hidden")}}
                                 for ancestor in value.get("ancestors", [])[:12] if isinstance(ancestor, dict) and type(ancestor.get("depth")) is int]
            result.append(item)
        return result
    return {"poForms": min(max(raw.get("poForms", 0), 0), 20) if type(raw.get("poForms")) is int else 0,
            **{key: rows(raw.get(key)) for key in ("inputs", "fields", "downloadLinks")},
            "selectorCounts": {key: min(max(raw.get("selectorCounts", {}).get(key, 0), 0), 10000)
                               for key in ("progress", "errors", "success")
                               if type(raw.get("selectorCounts", {}).get(key, 0)) is int}}


def callback_report(raw, inspector):
    result = []
    source_bytes = 0
    for handler in raw.get("handlers", [])[:40]:
        if not isinstance(handler, dict):
            handler = {}
        source = handler.get("source")
        bounded = isinstance(source, str) and len(source) <= 65536
        within_budget = bounded and source_bytes + len(source) <= 524288
        details = symbolic_details(source, inspector) if not bounded or within_budget else {
            "symbolicComplete": None, "symbolicStatus": "unsupported", "symbolicReason": "source_budget",
            "usesTemplate": "`" in source, "unsupportedToken": False,
            "sourceCharacters": len(source), "templateCount": 0, "templateRoutes": []}
        if within_budget:
            source_bytes += len(source)
        info = inspector.handler_info(source) if within_budget else {"available": False, "routes": [], "httpMethods": []}
        info.pop("symbolic", None)
        kind = handler.get("kind")
        result.append({"kind": kind if isinstance(kind, str) and kind in {"send", "fail", "always"} else inspector.field_name(kind), **info,
                       "calls": {name: len(re.findall(r"\." + name + r"\s*\(", source)) if within_budget else 0
                                 for name in ("ajax", "get", "post", "submit", "process")},
                       **details})
    return result


def deny(*args, **kwargs):
    raise InspectionError("A prohibited upload, preparation, save or submission was intercepted.")


@contextmanager
def tripwires(creator, quote):
    with ExitStack() as stack:
        for module, names in ((creator, ("prepare", "submit", "save", "upload_quote")),
                              (quote, ("upload_quote", "begin_upload", "complete_upload", "source_upload_payload"))):
            for name in names:
                existed, original = hasattr(module, name), getattr(module, name, None)
                setattr(module, name, deny)
                def restore(module=module, name=name, existed=existed, original=original):
                    if existed:
                        setattr(module, name, original)
                    else:
                        delattr(module, name)
                stack.callback(restore)
        try:
            api = importlib.import_module("playwright.sync_api")
        except ImportError:
            api = None  # Synthetic browser tests do not require Playwright.
        if api is not None:
            for class_name in ("Page", "Locator"):
                owner = getattr(api, class_name, None)
                if owner is not None and hasattr(owner, "set_input_files"):
                    original = owner.set_input_files
                    owner.set_input_files = deny
                    stack.callback(setattr, owner, "set_input_files", original)
        yield


def validate_attempt(values, identifier, bridge, quote):
    request = values["request.json"]
    attempt = values[REQUEST_MARKERS[0]]
    journal = values["mainJournal"]
    require(request.get("requestId") == identifier and request.get("quote") is not None,
            "The saved quote request identity is invalid.")
    expected = quote.binding(request, attempt.get("createPath"))
    require(set(attempt) == set(expected) | {"attemptedAt"}
            and all(attempt.get(key) == value for key, value in expected.items()),
            "The original quote attempt does not match its request.")
    try:
        require(datetime.fromisoformat(attempt["attemptedAt"].replace("Z", "+00:00")).tzinfo is not None)
    except (ValueError, TypeError, AttributeError):
        raise InspectionError("The original quote attempt timestamp is invalid.") from None
    outbound = journal.get("outbound", {})
    require(journal.get("phase") == "TERMINAL" and journal.get("reported") is True
            and journal.get("kind") == "request" and journal.get("id") == identifier
            and outbound.get("state") == "needs_review"
            and all(outbound.get(key) == journal.get(key) for key in ("workerId", "id", "kind", "claimToken"))
            and "preparedHash" not in journal,
            "The original request is not a reported preparation failure.")
    source_work = {"id": identifier, "kind": "request", "projectPageId": request["projectPageId"],
                   "payload": {key: request.get(key) for key in bridge.PAYLOAD_FIELDS}}
    if journal.get("documentExpected") is True:
        source_work["documentExpected"] = True
    if journal.get("quoteAttachmentVersion") == 1:
        source_work["quoteAttachmentVersion"] = 1
    require(journal.get("workHash") == bridge.claimed_work_hash(source_work),
            "The original request work identity changed.")
    return request


def inspect_draft(browser, request, creator, quote, inspector):
    signed_in = next((context for context in browser.contexts if any(
        page.url.startswith(creator.BASE + "/staff/") and "/login" not in page.url for page in context.pages)), None)
    require(signed_in is not None, "Sign into Nexvia before this read-only inspection.")
    with creator.quote_browser_context(browser, signed_in) as owned:
        with creator.native_line_editor(owned, request, quote_attachment=request["quote"]) as editor:
            page = editor["page"]
            # Independent tripwire covers Playwright selection even if an
            # installed helper unexpectedly attempts to activate the uploader.
            original_locator = page.locator
            def locator(selector, *args, **kwargs):
                result = original_locator(selector, *args, **kwargs)
                if hasattr(result, "set_input_files"):
                    result.set_input_files = deny
                return result
            page.locator = locator
            if hasattr(page, "set_input_files"):
                page.set_input_files = deny
            finance = "passed"
            try:
                creator.account_tax_for_editor(page)
            except InspectionError:
                raise
            except Exception:
                finance = "blocked"
            arguments = {"filename": request["quote"]["filename"], "bytes": request["quote"]["bytes"]}
            guard, guard_error, state = "passed", None, {}
            try:
                state = page.evaluate(quote.NATIVE_STATE_JS, arguments)
                quote.validate_native_draft(state, request, editor["createPath"], native_snapshot=editor)
            except InspectionError:
                raise
            except Exception as error:
                guard = "blocked"
                guard_error = {"type": "QuoteAttachmentError" if isinstance(error, quote.QuoteAttachmentError) else "UnexpectedError"}
                if isinstance(error, quote.QuoteAttachmentError) and 0 < len(str(error)) <= 240 \
                        and not re.search(r"[\x00-\x1f\x7f]", str(error)):
                    guard_error["message"] = str(error)
            if not isinstance(state, dict):
                state = {}
            callbacks = "['upload','success','complete','select','error','add','done','change','submit']"
            require(inspector.INSPECT_JS.count(callbacks) == 1, "The installed source inspector contract changed.")
            all_callbacks_js = inspector.INSPECT_JS.replace(callbacks,
                "['upload','success','complete','select','error','add','done','change','submit','send','fail','always']")
            raw = page.evaluate(all_callbacks_js)
            page_summary = inspector.clean_report(raw)
            page_summary.pop("handlers", None)
            counts = {key: min(max(state[key], 0), 10000) for key in ("formCount", "inputCount", "pending")
                      if type(state.get(key)) is int}
            counts.update({key: state[key] for key in ("linesEmpty", "malformedIds", "formFieldsValid")
                           if type(state.get(key)) is bool})
            return {"draftGuard": guard, "draftError": guard_error, "financeRead": finance, "draftCounts": counts,
                    "discovery": page_summary, "handlers": callback_report(raw, inspector),
                    "ownership": clean_ownership(page.evaluate(OWNERSHIP_JS)),
                    "policyContract": policy_contract(raw, page)}


def save_report(path, report):
    raw = canonical(report) + b"\n"
    require(len(raw) <= MAX_REPORT, "The sanitized report exceeds its bounded limit.")
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = ".failed-quote-inspection-" + str(uuid.uuid4())
    try:
        try:
            previous = os.stat(path.name, dir_fd=descriptor, follow_symlinks=False)
            require(stat.S_ISREG(previous.st_mode) and previous.st_nlink == 1
                    and stat.S_IMODE(previous.st_mode) == 0o600, "The previous diagnostic report is unsafe.")
        except FileNotFoundError:
            pass
        stream_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o600, dir_fd=descriptor)
        with os.fdopen(stream_fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path.name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
        os.fsync(descriptor)
    finally:
        try:
            os.unlink(temporary, dir_fd=descriptor)
        except FileNotFoundError:
            pass
        os.close(descriptor)


def inspect_failed_request(identifier, root=Path("/config"), *, browser=None):
    identifier, root = request_uuid(identifier), Path(root)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    modules = {name: importlib.import_module(name) for name in (
        "nexvia_create", "nexvia_quote_attachment", "nexvia_requests", "nexvia_inspect_quote_upload")}
    creator, quote, bridge, inspector = (modules[name] for name in (
        "nexvia_create", "nexvia_quote_attachment", "nexvia_requests", "nexvia_inspect_quote_upload"))
    with existing_bridge_lock(root):
        before, values = evidence(root, identifier)
        require(before[REQUEST_MARKERS[0]] is not None
                and all(before[name] is None for name in REQUEST_MARKERS[1:]),
                "This inspection requires an upload attempt without later receipt, preparation or PO evidence.")
        request = validate_attempt(values, identifier, bridge, quote)
        quote.verify_source(root / "nexvia-requests" / identifier, request)
        with tripwires(creator, quote):
            try:
                if browser is None:
                    from playwright.sync_api import sync_playwright
                    with sync_playwright() as playwright:
                        connected = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
                        report = inspect_draft(connected, request, creator, quote, inspector)
                else:
                    report = inspect_draft(browser, request, creator, quote, inspector)
            finally:
                after, _ = evidence(root, identifier)
                require(after == before, "Original request evidence changed during the read-only inspection.")
        report.update(format="nexvia-failed-quote-upload-inspection", version=1,
                      readOnly=True, originalsUnchanged=True, fileSelectionInvoked=False,
                      uploadOrSaveInvoked=False, requestId=identifier)
        save_report(root / REPORT_NAME, report)
        return report


def _console_routes(routes):
    result = []
    for route in routes[:1]:
        if not isinstance(route, dict):
            continue
        if isinstance(route.get("path"), str):
            result.append({"path": route["path"][:160],
                           "queryKeys": [str(key)[:20] for key in route.get("queryKeys", [])[:6]]})
        else:
            result.append({key: str(route[key])[:20] for key in ("scheme", "provider", "pathClass") if key in route})
    return result


def _console_policy(contract):
    containers, grouped = [], {}
    for item in contract.get("formData", []):
        field, source = item.get("field", ""), item.get("source")
        identity = (field, source)
        path = list(item.get("responsePath") or [])
        reference = source
        if path:
            prefix, leaf = path[:-1], path[-1]
            if prefix not in containers: containers.append(prefix)
            reference = "r" + str(containers.index(prefix)) + "." + ("$" if leaf == field else leaf)
        grouped.setdefault(identity, [])
        if reference not in grouped[identity]: grouped[identity].append(reference)
    policies = [[field, "|".join(str(value) for value in references)] for (field, source), references in grouped.items()]
    return {"status": contract.get("status"), "reason": contract.get("reason"), "sendSourceSha256": contract.get("sendSourceSha256"),
            "ajax": [{"method": item.get("method"), "sync": item.get("synchronous"),
                      "urls": [{"path": url.get("path", "")[:100], "dynamic": url.get("dynamic"),
                                "approved": url.get("approved"), "reason": url.get("reason"),
                                **({"operationSha256": url["operationSha256"]} if "operationSha256" in url else {}),
                                "keys": url.get("queryKeys", []),
                                **({"matched": url["matchedLiteralPath"][:100]} if "matchedLiteralPath" in url else {})}
                               for url in item.get("urlCandidates", [])], "assignments": item.get("urlAssignmentCount"),
                      "data": [[field.get("name", "")[:30], field.get("source")] for field in item.get("data", [])[:4]]}
                     for item in contract.get("ajax", [])[:1]],
            "globals": contract.get("globals", [])[:2],
            "policyRoot": {"r" + str(index): ".".join(path) for index, path in enumerate(containers)},
            "policy": policies, "mappingCount": len(contract.get("formData", [])), "$": "same field name",
            "normalizer": {key: contract.get("filenameNormalizer", {}).get(key) for key in ("derivedFromName", "operations", "regexCount")}}


def console_summary(report):
    lines = ["Read-only draft: " + json.dumps({"guard": report["draftGuard"], "error": report.get("draftError"),
                                             **report["draftCounts"]}, separators=(",", ":"))]
    contract = report.get("policyContract", {})
    if contract.get("ajax") and contract.get("formData"):
        compact = _console_policy(contract)
        routes = {"status": compact["status"], "reason": compact["reason"], "sendSourceSha256": compact["sendSourceSha256"],
                  "ajax": compact["ajax"], "globals": compact["globals"]}
        fields = {"root": compact["policyRoot"], "mapping": compact["policy"], "mappingCount": compact["mappingCount"], "$": compact["$"],
                  "normalizer": contract.get("filenameNormalizer", {})}
        candidate = "\n".join(lines + ["Policy route: " + json.dumps(routes, separators=(",", ":")),
                                        "Policy fields: " + json.dumps(fields, separators=(",", ":"))])
        if len(candidate) <= MAX_SUMMARY:
            return candidate
        # Keep mappings complete and explicit if unusually large source code
        # exceeds the display budget; never cut a field name or JSON value.
        fields["normalizer"] = compact["normalizer"]
        candidate = "\n".join(["Policy route: " + json.dumps(routes, separators=(",", ":")),
                                "Policy fields: " + json.dumps(fields, separators=(",", ":"))])
        if len(candidate) <= MAX_SUMMARY:
            return candidate
        return "Policy contract is available but exceeds the console budget; the complete contract is in the private report."
    ownership = report.get("ownership", {})
    inputs = [{"insidePO": item.get("containedByPO"), "formOwnerPO": item.get("formIsPO"),
               "visible": item.get("visible"), "panels": [{"tab": ancestor.get("tab"), "visible": ancestor.get("visible")}
                                                           for ancestor in item.get("ancestors", [])[:3]]}
              for item in ownership.get("inputs", [])[:1]]
    lines.append("Ownership: " + json.dumps({"poForms": ownership.get("poForms"), "inputs": inputs,
        "hiddenFileFields": len(ownership.get("fields", [])),
        "fieldsInsidePO": sum(item.get("containedByPO") is True for item in ownership.get("fields", []))}, separators=(",", ":")))
    protocol = "Policy contract: " + json.dumps(_console_policy(contract), separators=(",", ":"))
    # Full mappings remain private; the compact line has a fixed display cap.
    lines.append(protocol[:900] + (" [full mapping in report]" if len(protocol) > 900 else ""))
    send = next(((index, handler) for index, handler in enumerate(report.get("handlers", []))
                 if handler.get("kind") == "send"), None)
    if send is not None:
        index, handler = send
        template_routes = [{"dynamicPrefix": item.get("dynamicPrefix") is True,
                            "destination": _console_routes([item.get("destination")])[0]}
                           for item in handler.get("templateRoutes", [])[:1]
                           if isinstance(item, dict) and _console_routes([item.get("destination")])]
        flags = {"i": index, "status": handler.get("symbolicStatus"), "reason": handler.get("symbolicReason"),
                 "usesTemplate": handler.get("usesTemplate"), "sourceCharacters": handler.get("sourceCharacters"),
                 "unsupportedToken": handler.get("unsupportedToken"),
                 "templates": handler.get("templateCount"), "templateRoutes": template_routes,
                 "methods": handler.get("httpMethods", []), "routes": _console_routes(handler.get("routes", [])),
                 "calls": handler.get("calls", {})}
        lines.append("SEND: " + json.dumps(flags, separators=(",", ":")))
        symbolic = handler.get("symbolicComplete")
        if isinstance(symbolic, str):
            remaining = max(0, min(1200, MAX_SUMMARY - len("\n".join(lines)) - 90))
            lines.append("SEND body: " + symbolic[:remaining] + (" [truncated]" if len(symbolic) > remaining else ""))
    for index, handler in enumerate(report.get("handlers", [])):
        if send is not None and index == send[0]:
            continue
        item = {"i": index, "kind": handler.get("kind"), "methods": handler.get("httpMethods", []),
                "calls": handler.get("calls", {}), "routes": _console_routes(handler.get("routes", [])),
                "symbolicStatus": handler.get("symbolicStatus"), "symbolicReason": handler.get("symbolicReason")}
        line = "Handler: " + json.dumps(item, separators=(",", ":"))
        if len("\n".join(lines + [line])) > MAX_SUMMARY:
            notice = "Additional handler details are in the private sanitized report."
            if len("\n".join(lines + [notice])) <= MAX_SUMMARY:
                lines.append(notice)
            break
        lines.append(line)
    return "\n".join(lines)[:MAX_SUMMARY]


def main(argv=None):
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--root", type=Path, default=Path("/config"))
    args = parser.parse_args(argv)
    report = inspect_failed_request(args.request, args.root)
    displayed_path = str(args.root / REPORT_NAME)
    if len(displayed_path) > 140:
        displayed_path = "..." + displayed_path[-137:]
    output = console_summary(report) + "\nSanitized report: " + displayed_path + "\n" + \
        "Original evidence is unchanged. No file was selected, uploaded or saved; no PO was created or changed."
    require(len(output) < MAX_CONSOLE, "The diagnostic console summary exceeded its fixed budget.")
    print(output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print("Read-only inspection stopped safely. Original request evidence was not retried.")
        raise SystemExit(1)
