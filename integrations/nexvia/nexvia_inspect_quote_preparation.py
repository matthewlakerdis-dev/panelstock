#!/usr/bin/env python3
"""Inspect an unattempted quote preparation without selecting a file or saving a PO."""

import argparse
from contextlib import ExitStack, contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
from unittest.mock import patch
import uuid


MARKERS = ("nexvia-quote-upload-attempt.json", "nexvia-quote-upload.json",
           "nexvia-prepared.json", "nexvia-create-attempt.json", "nexvia-result.json")


class InspectionError(ValueError):
    pass


def require(value, message):
    if not value:
        raise InspectionError(message)


def proof(paths):
    result = {}
    for path in paths:
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            result[str(path)] = None
            continue
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_size <= 10 * 1024 * 1024,
                    "Request evidence is not a bounded regular file.")
            result[str(path)] = (stat.S_IMODE(info.st_mode), hashlib.sha256(stream.read()).hexdigest())
    return result


@contextmanager
def work_lock(root, timeout=30):
    path = root / "panelstock-request-journal" / ".bridge.lock"
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(stat.S_ISREG(os.fstat(descriptor).st_mode), "The bridge lock is not a regular file.")
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                require(time.monotonic() < deadline, "The bridge is busy. Let it finish, then run this check again.")
                time.sleep(0.25)
        yield
    finally:
        os.close(descriptor)


def inspect(context, request, folder, creator, form_data, quote, lookups):
    """Call only read/validation functions, with independent mutation tripwires."""
    stage = "Quote source"
    report = {"passed": False, "stage": stage, "draft": None}

    def blocked(*args, **kwargs):
        raise InspectionError("A write or file-selection operation was blocked by the read-only check.")

    try:
        with ExitStack() as guards:
            for module, names in ((creator, ("prepare", "submit", "save")),
                                  (quote, ("upload_quote", "begin_upload", "complete_upload", "source_upload_payload")),
                                  (form_data, ("save_choices",))):
                for name in names:
                    guards.enter_context(patch.object(module, name, blocked))
            quote.verify_source(folder, request)
            attachment = creator.quote_attachment_descriptor(request, request["quote"])
            stage = "Live choices and supplier eligibility"
            choices = form_data.collect_choices(context, request["projectPageId"])
            form_data.validate_request(request, choices, context, quote_attachment=attachment)
            stage = "Native form and allocation"
            with creator.native_line_editor(context, request, quote_attachment=attachment) as editor:
                allocation = creator.allocation_from_native(request, editor, quote_attachment=attachment)
                stage = "Live COS, tax and totals"
                finance = creator.account_tax_for_editor(editor["page"])
                current = dict(choices, accounts=[row for row in finance["accounts"]
                                                 if row.get("type") == "Cost of Goods Sold"],
                               taxes=finance["taxes"])
                creator.build_lines(request, allocation, current, quote_attachment=attachment)
                stage = "Native quote uploader"
                state = editor["page"].evaluate(quote.NATIVE_STATE_JS,
                            {"filename": attachment["filename"], "bytes": attachment["bytes"]})
                widgets = state.get("widgets") or []
                report["draft"] = {key: state.get(key) for key in
                                   ("formCount", "formMethod", "inputCount", "linesEmpty", "malformedIds", "pending")}
                report["draft"].update(uploaderCount=len(widgets),
                    missingPolicyFields=sorted(quote.POLICY_FIELDS - set(state.get("policyNames") or [])))
                quote.validate_native_draft(state, request, editor["createPath"], native_snapshot=editor)
            report.update(passed=True, stage="Pre-upload checks", message="PASS")
    except Exception as error:
        safe = isinstance(error, (ValueError, quote.QuoteAttachmentError, lookups.LookupError))
        report.update(stage=stage, message=str(error)[:240] if safe else type(error).__name__)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--root", type=Path, default=Path("/config"))
    args = parser.parse_args(argv)
    try:
        identifier = str(uuid.UUID(args.request))
        require(identifier == args.request, "Use the exact saved request UUID.")
        root = args.root
        folder = root / "nexvia-requests" / identifier
        require(folder.is_dir() and not folder.is_symlink(), "The saved request folder is unavailable.")
        with work_lock(root):
            require(not any((folder / name).exists() or (folder / name).is_symlink() for name in MARKERS),
                    "Saved attempt or preparation markers changed. Inspection stopped; no retry is permitted.")
            paths = [folder / name for name in (*MARKERS, "request.json", "nexvia-quote-transfer.json",
                                               "nexvia-supplier-quote.pdf")]
            paths.append(root / "panelstock-request-journal" / ("request-" + identifier + ".json"))
            before = proof(paths)
            request = json.loads((folder / "request.json").read_text())
            require(request.get("requestId") == identifier and request.get("quote") is not None,
                    "The saved quoted request identity does not match.")
            sys.path.insert(0, str(root))
            import nexvia_create as creator
            import nexvia_form_data as form_data
            import nexvia_quote_attachment as quote
            import nexvia_lookups as lookups
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
                context = next((context for context in browser.contexts if any(
                    page.url.startswith(creator.BASE + "/staff/") and "/login" not in page.url
                    for page in context.pages)), None)
                require(context is not None, "Sign into Nexvia in the NAS browser first.")
                try:
                    with creator.quote_browser_context(browser, context) as owned:
                        report = inspect(owned, request, folder, creator, form_data, quote, lookups)
                finally:
                    require(proof(paths) == before, "Request evidence changed; stop and review it before taking further action.")
            print("Blank-draft guard:", getattr(quote, "BLANK_DRAFT_GUARD_VERSION", "not installed"))
            if report["draft"] is not None:
                print("Draft checks:", json.dumps(report["draft"], separators=(",", ":")))
            print("Stage:", report["stage"])
            print("Result:", report["message"])
            print("Original request evidence: unchanged. No file was selected or PO submitted.")
            return 0 if report["passed"] else 1
    except Exception as error:
        message = str(error) if isinstance(error, InspectionError) else type(error).__name__
        print("Read-only inspection stopped:", message)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
