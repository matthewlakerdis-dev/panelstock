#!/usr/bin/env python3
"""Inspect native DONE registration source without executing an uploader callback."""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import importlib
import json
import re
from pathlib import Path
import sys
from types import SimpleNamespace
import zlib

FROZEN_BASE64 = ""
FROZEN_SHA256 = "bfa5c5f5afebd7033a09fd61f66b00e8222f1e0689118ad6281ce7b4686d35a4"
REPORT_DIRECTORY = "nexvia-registration-source-checks"
SAFE_MEMBERS = {"response", "id", "url", "key", "name", "filename", "file", "data", "fields", "file_name", "original", "path", "original_url", "upload",
                "file_url", "file_path", "download_url", "full_path", "object_key", "object_name", "uri", "url_name", "location"}


class RegistrationInspectionError(ValueError):
    pass


def require(value, code):
    if not value:
        raise RegistrationInspectionError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def frozen_runtime(data=None):
    if data is None:
        packed = base64.b64decode(FROZEN_BASE64, validate=True)
        require(0 < len(packed) <= 1024 * 1024, "frozen_size")
        stream = zlib.decompressobj()
        data = stream.decompress(packed, 1024 * 1024 + 1)
        require(stream.eof and not stream.unconsumed_tail, "frozen_size")
    require(isinstance(data, bytes) and 0 < len(data) <= 1024 * 1024
            and hashlib.sha256(data).hexdigest() == FROZEN_SHA256, "frozen_checksum")
    namespace = {"__name__": "passive_registration_frozen_runtime", "__file__": "<frozen-policy-checker-v2>"}
    exec(compile(data, namespace["__file__"], "exec"), namespace)
    return SimpleNamespace(**namespace)


def name_shape(value):
    return {"sha256": hashlib.sha256(value.encode("utf-8", errors="surrogatepass")).hexdigest(),
            "length": len(value), "safeIdentifier": re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,99}", value) is not None,
            "canonicalKnownName": value if value in SAFE_MEMBERS else None}


def member_shape(path):
    return {"alias": [part if part in SAFE_MEMBERS else "[member]" for part in path],
            "sha256": digest(path), "length": len(path), "leaf": name_shape(path[-1]) if path else None}


def path_shape(value):
    known = re.fullmatch(r"/(?:(?:staff|admin|client|supplier)/)?upload/details/?", value)
    return {"path": value if known else "[literal]", "sha256": hashlib.sha256(value.encode()).hexdigest(),
            "length": len(value), "trailingSlash": value.endswith("/"), "hasQuery": "?" in value}


def function_spans(tokens, parser):
    spans = []
    for index, token in enumerate(tokens):
        if token == ("punct", "=>") and (index + 1 >= len(tokens) or tokens[index + 1] != ("punct", "{")):
            raise RegistrationInspectionError("done_expression_arrow_unsupported")
        if token == ("id", "function"):
            start = index + 1
            if start < len(tokens) and tokens[start][0] == "id": start += 1
            if start >= len(tokens) or tokens[start] != ("punct", "("): continue
            end = parser._balanced(tokens, start)
            if end is not None and end + 1 < len(tokens) and tokens[end + 1] == ("punct", "{"):
                close = parser._balanced(tokens, end + 1)
                if close is not None: spans.append((end + 1, close))
        elif token == ("punct", "=>") and index + 1 < len(tokens) and tokens[index + 1] == ("punct", "{"):
            close = parser._balanced(tokens, index + 1)
            if close is not None: spans.append((index + 1, close))
    require(spans and spans[0][1] == len(tokens) - 1, "done_function_structure")
    return spans


def expression_end(tokens, start):
    depth = 0
    for index in range(start, min(len(tokens), start + 160)):
        kind, value = tokens[index]
        if kind == "punct":
            if depth == 0 and value in {";", "}"}: return index
            if value in {"(", "[", "{"}: depth += 1
            elif value in {")", "]", "}"}: depth -= 1
    return None


def source_contract(done, send, parser):
    require(isinstance(done, str) and 0 < len(done) <= 65536, "done_source_size")
    tokens = parser._protocol_tokens(done)
    spans = function_spans(tokens, parser)
    depth = lambda index: sum(left < index < right for left, right in spans) - 1
    assignments, aliases = {}, []
    for index, token in enumerate(tokens):
        if token != ("punct", "=") or depth(index) != 0 or index == 0: continue
        end = expression_end(tokens, index + 1)
        if end is None: continue
        expression = tokens[index + 1:end]
        if tokens[index - 1][0] == "id" and (index < 2 or tokens[index - 2] != ("punct", ".")):
            name = tokens[index - 1][1]
            assignments.setdefault(name, []).append((index, expression))
            path = parser._member(expression)
            if path and len(path) == 3 and path[1:] == ["files", "0"]: aliases.append(name)
    require(len(set(aliases)) == 1, "done_file_alias")
    file_name = aliases[0]
    normalized = lambda expression: parser._member(expression)[1:] if parser._member(expression) and parser._member(expression)[0] == file_name else None
    file_urls = []
    for index in range(len(tokens) - 4):
        if depth(index) == 0 and tokens[index:index + 4] == [("id", file_name), ("punct", "."), ("id", "url"), ("punct", "=")]:
            end = expression_end(tokens, index + 4)
            if end is not None:
                path = normalized(tokens[index + 4:end])
                if path is not None: file_urls.append(path)
    send_tokens = parser._protocol_tokens(send)
    key_paths = []
    for index in range(len(send_tokens) - 3):
        if send_tokens[index:index + 3] == [("punct", "."), ("id", "append"), ("punct", "(")]:
            end = parser._balanced(send_tokens, index + 2)
            if end is None: continue
            arguments = parser._split_tokens(send_tokens[index + 3:end], ",")
            if len(arguments) == 2 and arguments[0] == [("string", "key")]:
                path = parser._member(arguments[1])
                if path and len(path) > 1: key_paths.append(path[1:])

    def expand(expression, before, seen=()):
        rows = [[]]
        for part in parser._split_tokens(expression, "+"):
            member = parser._member(part)
            if len(part) == 1 and part[0][0] == "string": options = [[{"literal": part[0][1]}]]
            elif member and len(member) == 1 and member[0] in assignments and member[0] not in seen:
                options = []
                for position, value in assignments[member[0]]:
                    if position < before: options.extend(expand(value, position, (*seen, member[0])))
            elif member: options = [[{"member": member}]]
            else: options = [[{"unsupported": True}]]
            rows = [left + right for left in rows for right in options][:8]
        return rows

    callbacks = []
    for index in range(len(tokens) - 4):
        if tokens[index:index + 4] != [("punct", "."), ("id", "ajax"), ("punct", "("), ("punct", "{")]: continue
        close = parser._balanced(tokens, index + 3)
        if close is None: continue
        fields = dict(parser._object_fields(tokens[index + 3:close + 1]))
        method = fields.get("type", fields.get("method", []))
        if method != [("string", "GET")]: continue
        urls, data = [], []
        for pieces in expand(fields.get("url", []), index):
            urls.append([{"literal": path_shape(piece["literal"])} if "literal" in piece else
                         {"response": member_shape(piece["member"][1:])} if "member" in piece and piece["member"][0] == file_name else
                         {"selector": name_shape(".".join(piece["member"]))} if "member" in piece else {"unsupported": True} for piece in pieces])
        for name, expression in parser._object_fields(fields.get("data", [])):
            path = normalized(expression)
            data.append({"key": name_shape(name), "responsePath": member_shape(path) if path is not None else None,
                "metadataSourceMatchesSignedKey": path in key_paths if path is not None else False,
                "metadataSourceMatchesFileURL": path in file_urls if path is not None else False,
                "metadataSourceMatchesURL": bool(path and path[-1] == "url"),
                "metadataSourceMatchesID": bool(path and path[-1] == "id"),
                "encoding": "direct_member" if path is not None else "unsupported"})
        callbacks.append({"functionDepth": depth(index), "method": "GET", "urlTemplates": urls,
            "data": data, "async": False if fields.get("async") == [("id", "false")] else True if fields.get("async") == [("id", "true")] else "default"})
    primary = [row for row in callbacks if row["functionDepth"] == 0]
    require(len(primary) == 1, "done_primary_get_count")
    return {"doneSourceSha256": hashlib.sha256(done.encode()).hexdigest(), "primary": primary[0],
            "otherGETs": [row for row in callbacks if row["functionDepth"] > 0][:4],
            "fileURLAssignments": len(file_urls)}, assignments, tokens, spans


def controller_observation(page, runtime, done, assignments, tokens, spans, *, primary=None, parser=None):
    names = []
    selectors = {piece["selector"]["sha256"] for row in (primary or {}).get("urlTemplates", []) for piece in row if "selector" in piece}
    # Controller identifiers are the unresolved single-member URL selectors.
    for rows in assignments.values():
        for _, expression in rows:
            for index in range(len(expression) - 2):
                if expression[index] == ("punct", "+") and expression[index + 1][0] == "id" and expression[index + 2] == ("punct", "+"):
                    name = expression[index + 1][1]
                    if name not in names and (not selectors or name_shape(name)["sha256"] in selectors): names.append(name)
    if len(names) != 1: return {"status": "unsupported", "selectorCount": len(names)}
    globals_ = runtime.controller_value.__globals__
    original = globals_["SEND_METADATA_EXPRESSION"]
    try:
        require(original.count("own(options,'send')") == 1, "done_reader_contract")
        globals_["SEND_METADATA_EXPRESSION"] = original.replace("own(options,'send')", "own(options,'done')")
        selected = runtime.controller_value(page, hashlib.sha256(done.encode()).hexdigest(), names[0])
        result = {"status": "observed", "namespace": selected if selected in {"staff", "admin", "client", "supplier"} else "[namespace]",
                  "selector": name_shape(names[0]), "branch": "unsupported"}
        if parser is not None:
            branches = []
            for index, token in enumerate(tokens):
                if token != ("id", "if") or index + 1 >= len(tokens) or tokens[index + 1] != ("punct", "("): continue
                if sum(left < index < right for left, right in spans) != 1: continue
                end = parser._balanced(tokens, index + 1)
                if end is None: continue
                comparisons = parser._split_tokens(tokens[index + 2:end], "||")
                if comparisons and all(len(row) == 3 and row[0] == ("id", names[0]) and row[1] == ("punct", "===") and row[2][0] == "string" for row in comparisons):
                    if end + 1 < len(tokens) and tokens[end + 1] == ("punct", "{"):
                        close = parser._balanced(tokens, end + 1)
                        if close is not None and any(kind == "string" and "/upload/details" in value for kind, value in tokens[end + 2:close]):
                            branches.append(selected in [row[2][1] for row in comparisons])
            if len(branches) == 1: result["branch"] = "true_literal_branch" if branches[0] else "false_namespace_branch"
        return result
    finally: globals_["SEND_METADATA_EXPRESSION"] = original


def inspect_native(browser, request, metadata, attempt, q, parser, runtime):
    target = q.ORIGIN + attempt["createPath"]
    with runtime.guarded_native_context(browser, importlib.import_module("nexvia_create"), target) as context:
        creator = importlib.import_module("nexvia_create")
        with creator.native_line_editor(context, request, quote_attachment=metadata) as editor:
            page = editor["page"]
            state = page.evaluate(q.NATIVE_STATE_JS, {"filename": metadata["filename"], "bytes": metadata["bytes"]})
            q.validate_native_draft(state, request, attempt["createPath"], native_snapshot=editor)
            send = state["widgets"][0]["sendSource"]
            runtime.source_route_contract(send, q, parser)
            expression = runtime.SEND_METADATA_EXPRESSION.replace("own(options,'send')", "own(options,'done')")
            done = page.evaluate("() => (" + expression + ").source")
            report, assignments, tokens, spans = source_contract(done, send, parser)
            report["controller"] = controller_observation(page, runtime, done, assignments, tokens, spans,
                                                          primary=report["primary"], parser=parser)
            return report


def inspect_request(identifier, root=Path("/config"), *, frozen=None, browser=None, inspector=None):
    require(isinstance(identifier, str) and re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", identifier), "request_identity")
    root = Path(root)
    sys.dont_write_bytecode = True
    if str(root) not in sys.path: sys.path.insert(0, str(root))
    runtime = frozen_runtime(frozen)
    with runtime.runtime_bundle(lock_root=root, verify=browser is None) as (q, parser, hashes):
        before, records = runtime.originals(root, identifier, parser)
        request, metadata, attempt = runtime.validate_originals(records, identifier, q)
        creator = importlib.import_module("nexvia_create")
        report = {"format": "nexvia-registration-source-check", "version": 1, "requestId": identifier,
                  "requestHash": q.digest(request), "evidenceBeforeHash": digest(before), "evidenceAfterHash": None,
                  "originalsUnchanged": False, "readOnly": True, "policyRequests": 0, "storageUploads": 0,
                  "registrations": 0, "poSubmissions": 0, "emails": 0, "status": "blocked", "code": "inspection_failed"}
        try:
            with runtime.financial_tripwires(creator, q, parser):
                if browser is None:
                    from playwright.sync_api import sync_playwright
                    with sync_playwright() as pw:
                        connected = pw.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
                        report["contract"] = inspect_native(connected, request, metadata, attempt, q, parser, runtime)
                else:
                    report["contract"] = inspector(browser, request, metadata, attempt, q, parser, runtime)
            report.update(status="inspected", code="done_source_observed")
        except RegistrationInspectionError as error: report["code"] = str(error)
        except Exception: report["code"] = "inspection_failed"
        after, _ = runtime.originals(root, identifier, parser)
        require(after == before, "original_evidence_changed")
        report.update(evidenceAfterHash=digest(after), originalsUnchanged=True)
        namespace = runtime.report_root.__globals__
        previous = namespace["REPORT_DIRECTORY"]
        try:
            namespace["REPORT_DIRECTORY"] = REPORT_DIRECTORY
            destination = runtime.report_root(root, parser) / (identifier + ".json")
        finally: namespace["REPORT_DIRECTORY"] = previous
        parser.save_report(destination, report)
        return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--root", type=Path, default=Path("/config"))
    args = parser.parse_args(argv)
    result = inspect_request(args.request, args.root)
    print("Registration source:", json.dumps({key: result[key] for key in ("status", "code", "originalsUnchanged")}, separators=(",", ":")))
    contract = result.get("contract")
    if isinstance(contract, dict):
        contract = {key: value for key, value in contract.items() if key != "otherGETs"}
        contract["nestedGETCount"] = len(result.get("contract", {}).get("otherGETs", []))
    print("DONE contract:", json.dumps(contract, separators=(",", ":")))
    print("No callback was invoked; no policy lookup, file upload, registration, PO or email was performed. Original uploaded-file identity was not recovered.")
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except Exception:
        raise SystemExit("Passive registration source inspection stopped safely.") from None
