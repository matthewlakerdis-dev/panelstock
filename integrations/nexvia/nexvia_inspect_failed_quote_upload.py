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


REQUEST_MARKERS = ("nexvia-quote-upload-attempt.json", "nexvia-quote-upload.json",
                   "nexvia-prepared.json", "nexvia-create-attempt.json", "nexvia-result.json")
REPORT_NAME = "nexvia-failed-quote-upload-inspection.json"
MAX_JSON = 8 * 1024 * 1024
MAX_SOURCE = 10 * 1024 * 1024
MAX_REPORT = 4 * 1024 * 1024
MAX_CONSOLE = 2500
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


def complete_symbolic_source(source, inspector):
    """Use the established redactor's vocabulary without its window truncation."""
    if not isinstance(source, str) or len(source) > 65536 or "`" in source:
        return None
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
                return None
            index = end + 2
            continue
        if character in "\"'":
            end = index + 1
            while end < len(source):
                if source[end] == "\\":
                    end += 2
                elif source[end] == character:
                    break
                elif source[end] in "\r\n":
                    return None
                else:
                    end += 1
            if end >= len(source):
                return None
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
            return None
        tokens.append(token)
        previous = token
    return " ".join(tokens)


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
        source = handler.get("source")
        if not isinstance(source, str) or len(source) > 65536 or source_bytes + len(source) > 524288:
            continue
        source_bytes += len(source)
        info = inspector.handler_info(source)
        info.pop("symbolic", None)
        kind = handler.get("kind")
        result.append({"kind": kind if kind in {"send", "fail", "always"} else inspector.field_name(kind), **info,
                       "calls": {name: len(re.findall(r"\." + name + r"\s*\(", source))
                                 for name in ("ajax", "get", "post", "submit", "process")},
                       "symbolicComplete": complete_symbolic_source(source, inspector)})
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
                    "ownership": clean_ownership(page.evaluate(OWNERSHIP_JS))}


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


def console_summary(report):
    lines = ["Read-only draft: " + json.dumps({"guard": report["draftGuard"], "error": report.get("draftError"),
                                             **report["draftCounts"]}, separators=(",", ":"))]
    ownership = report.get("ownership", {})
    inputs = [{"insidePO": item.get("containedByPO"), "formOwnerPO": item.get("formIsPO"),
               "visible": item.get("visible"), "panels": [{"tab": ancestor.get("tab"), "visible": ancestor.get("visible")}
                                                           for ancestor in item.get("ancestors", [])[:3]]}
              for item in ownership.get("inputs", [])[:2]]
    lines.append("Ownership: " + json.dumps({"poForms": ownership.get("poForms"), "inputs": inputs,
        "hiddenFileFields": len(ownership.get("fields", [])),
        "fieldsInsidePO": sum(item.get("containedByPO") is True for item in ownership.get("fields", []))}, separators=(",", ":")))
    for index, handler in enumerate(report.get("handlers", [])):
        item = {"i": index, "kind": handler.get("kind"), "methods": handler.get("httpMethods", []),
                "calls": handler.get("calls", {}), "routes": handler.get("routes", [])[:3]}
        line = "Handler: " + json.dumps(item, separators=(",", ":"))
        if len("\n".join(lines + [line])) > MAX_CONSOLE - 350:
            lines.append("Additional handler details are in the private sanitized report.")
            break
        lines.append(line)
    return "\n".join(lines)[:MAX_CONSOLE]


def main(argv=None):
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--root", type=Path, default=Path("/config"))
    args = parser.parse_args(argv)
    report = inspect_failed_request(args.request, args.root)
    output = console_summary(report) + "\nSanitized report: " + str(args.root / REPORT_NAME) + "\n" + \
        "Original evidence is unchanged. No file was selected, uploaded or saved; no PO was created or changed."
    print(output[:MAX_CONSOLE])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print("Read-only inspection stopped safely. Original request evidence was not retried.")
        raise SystemExit(1)
