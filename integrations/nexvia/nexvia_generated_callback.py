"""Supported generated DONE syntax profile, frozen from the passive NAS audit.

This fingerprint masks presentation identifiers/literals exactly as the frozen
read-only inspector. It is compatibility evidence, not semantic equivalence or
network authority. The registration parser separately checks raw critical
roles and the upload guard permits only the exact policy/file/registration.
Importing this module performs no IO.
"""
import hashlib
import json
import re

CALLBACK_PROFILE_VERSION = 1
SUPPORTED_DONE_PROFILE_SHA256 = "6f44c66a5ad9719ae1707edabf79724d3cc04fd6ebbdb36ae6a8b5cab317e9b7"
MAX_SOURCE_CHARACTERS = 65536
METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"})
SYMBOL_WORDS = frozenset(('$', 'Array', 'Content-Type', 'FormData', 'GoogleAccessId', 'JSON', 'Math', 'Number', 'Object', 'String', '_html', '_resp', '_success', 'acl', 'add', 'ajax', 'always', 'append', 'appendTo', 'async', 'attr', 'beforeSend', 'break', 'catch', 'change', 'complete', 'const', 'contentType', 'continue', 'create', 'currentTarget', 'data', 'data-field-name', 'data-param-name', 'data-read-url', 'data-remove-url', 'data-save-url', 'data-upload-url', 'data-url', 'dataType', 'decodeURIComponent', 'delegated-change', 'destroy', 'document', 'document_id', 'done', 'each', 'else', 'encodeURIComponent', 'entity_id', 'entity_type', 'error', 'extension', 'fail', 'false', 'fields', 'file', 'fileId', 'fileName', 'fileSize', 'fileType', 'file[]', 'file_id', 'file_name', 'file_url', 'filedata', 'filename', 'files', 'files[]', 'fileupload', 'filter', 'finally', 'find', 'folder_id', 'for', 'forEach', 'form', 'formData', 'form[Files]', 'form[Files][]', 'function', 'general_file_id', 'get', 'headers', 'id', 'if', 'indexOf', 'inline-upload-init', 'inputs', 'jQuery', 'job_id', 'job_purchase_order_id', 'join', 'key', 'length', 'let', 'loaded', 'map', 'message', 'model_id', 'model_type', 'name', 'new', 'null', 'object_id', 'object_type', 'onchange', 'params', 'parent_id', 'parse', 'policy', 'post', 'processData', 'project_id', 'promise', 'prop', 'purchase_order_id', 'push', 'qqfile', 'qqfiles[]', 'rawResponse', 'read', 'readUrl', 'referenced-function', 'registered-change', 'remove', 'removeUrl', 'replace', 'response', 'result', 'return', 'saveUrl', 'select', 'serializeArray', 'signature', 'size', 'split', 'status', 'stringify', 'submit', 'success', 'success_action_redirect', 'success_action_status', 'target', 'test', 'then', 'this', 'throw', 'total', 'trim', 'true', 'try', 'type', 'typeof', 'uid', 'undefined', 'update', 'upload', 'uploadUrl', 'upload_url', 'uploader', 'uploads', 'url', 'val', 'validationErrors', 'value', 'var', 'while', 'window', 'x-goog-algorithm', 'x-goog-credential', 'x-goog-date', 'x-goog-signature'))


class CallbackProfileError(ValueError):
    """Only fixed public failure codes escape."""


class _Vocabulary:
    SYMBOL_WORDS = SYMBOL_WORDS


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


def _skip_template(*args, **kwargs):
    raise _SymbolicError("unsupported_template")


def canonical_program(source):
    """Return the established anonymous syntax, rejecting unobserved syntax."""
    if not isinstance(source, str) or not 0 < len(source) <= MAX_SOURCE_CHARACTERS:
        raise CallbackProfileError("registration_source_limit")
    try:
        result = _complete_symbolic_tokens(source, _Vocabulary, [])
    except (ValueError, IndexError, TypeError):
        raise CallbackProfileError("registration_done_profile_changed") from None
    # Neither syntax appears in the observed callback. Regex bodies and
    # interpolation must never silently disappear from an accepted profile.
    if any(token in {"REGEXP", "TEMPLATE_VALUE"} for token in result.split()):
        raise CallbackProfileError("registration_done_profile_changed")
    return result


def profile(source):
    program = canonical_program(source)
    signature = hashlib.sha256(program.encode()).hexdigest()
    if signature != SUPPORTED_DONE_PROFILE_SHA256:
        raise CallbackProfileError("registration_done_profile_changed")
    return {"version": CALLBACK_PROFILE_VERSION,
            "doneProfileSha256": signature,
            "doneSourceSha256": hashlib.sha256(source.encode()).hexdigest()}
