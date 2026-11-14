#!/usr/bin/env python3
"""Verify and reconcile an existing PO without repeating its creation.

The original request, preparation, attempt and terminal journal are immutable.
Check mode reads Nexvia and may write only an explicitly requested small report.
Reconciliation freezes a separate acknowledgement and document-recovery source.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
from urllib.parse import urljoin, urlsplit
import urllib.request

import nexvia_create as creator
import nexvia_requests as bridge
from nexvia_quote_attachment import normalized_result


RECONCILE_PATH = "/integrations/nexvia/request-reconcile"
FORMAT = "nexvia-existing-po-check"
SOURCE_FILES = ("request.json", "nexvia-prepared.json", "nexvia-create-attempt.json")
MAX_JSON = 8 * 1024 * 1024
REPORT_ROOT = Path("/config")
REPORT_NAMES = {"nexvia-verification-update-check.json", "nexvia-existing-po-check.json"}
BASE_KEYS = {"version", "workerId", "id", "claimToken", "kind", "workHash",
             "documentExpected", "documentContext", "sourceHashes", "rawResult",
             "outbound", "reconcileOutbound"}


def post_api(path, payload, token):
    """Use one fixed reconciliation endpoint and the original document route."""
    if path == bridge.DOCUMENT_PATH:
        return bridge.post_api(path, payload, token)
    require(path == RECONCILE_PATH, "Unexpected existing-PO recovery endpoint.")
    request = urllib.request.Request(
        bridge.ORIGIN + RECONCILE_PATH, data=bridge.canonical(payload), method="POST",
        headers={"Authorization": "Bearer " + token,
                 "User-Agent": "PanelStock-Nexvia-Bridge/1.0",
                 "Content-Type": "application/json", "Accept": "application/json"})
    return bridge.request_json(request, 30)


class ReconciliationError(ValueError):
    """Fixed messages do not contain credentials, response bodies or PDF bytes."""


def require(condition, message):
    if not condition:
        raise ReconciliationError(message)


def private_json(path):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            descriptor = None
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                    and info.st_nlink == 1, "Recovery evidence must be a private regular file.")
            raw = stream.read(MAX_JSON + 1)
        require(len(raw) <= MAX_JSON, "Recovery evidence exceeds its size limit.")
        value = json.loads(raw)
        require(isinstance(value, dict), "Recovery evidence is invalid.")
        return value, hashlib.sha256(raw).hexdigest()
    except ReconciliationError:
        raise
    except (OSError, ValueError, TypeError):
        raise ReconciliationError("Recovery evidence is unavailable or invalid.") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


@contextmanager
def recovery_lock(journal_root, inherited_fd=None, *, check_only=False):
    """Use the existing bridge lock, without creating or changing its file."""
    path = Path(journal_root) / ".bridge.lock"
    descriptor, owned = None, inherited_fd is None
    try:
        descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW) if owned else inherited_fd
        require(type(descriptor) is int and descriptor >= 0 and (owned or check_only),
                "An inherited bridge lock is allowed only for a read-only check.")
        info, actual = os.fstat(descriptor), os.stat(path, follow_symlinks=False)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_nlink == 1 and stat.S_ISREG(actual.st_mode)
                and (info.st_dev, info.st_ino) == (actual.st_dev, actual.st_ino),
                "The bridge lock is unavailable or unsafe.")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReconciliationError("The bridge is handling work; let it finish and run this check again.") from None
    except ReconciliationError:
        if owned and descriptor is not None:
            os.close(descriptor)
        raise
    except OSError:
        if owned and descriptor is not None:
            os.close(descriptor)
        raise ReconciliationError("The bridge lock is unavailable or unsafe.") from None
    try:
        yield
    finally:
        if owned and descriptor is not None:
            os.close(descriptor)


def sources(request_id, project, order_id, number, config, journal_root, request_root):
    identifier = bridge.canonical_uuid(request_id)
    require(type(project) is int and project > 0 and type(order_id) is int and order_id > 0
            and isinstance(number, str) and re.fullmatch(r"PO[0-9]{1,20}", number),
            "The existing PO identity is invalid.")
    folder = Path(request_root) / identifier
    info = os.stat(folder, follow_symlinks=False)
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700,
            "The request folder must be private.")
    values, hashes = {}, {}
    for name in SOURCE_FILES:
        values[name], hashes[name] = private_json(folder / name)
    source_path = Path(journal_root) / ("request-" + identifier + ".json")
    journal, hashes["terminalJournal"] = private_json(source_path)
    request, prepared, attempt = (values[name] for name in SOURCE_FILES)
    payload = {field: request.get(field) for field in bridge.PAYLOAD_FIELDS}
    bridge.validate_payload(payload, identifier, project)
    require(request.get("quote") is None and journal.get("quoteAttachmentVersion") is None,
            "This recovery version supports requests without supplier quote attachments only.")
    require(journal.get("workerId") == config["workerId"] and journal.get("id") == identifier
            and journal.get("kind") == "request" and journal.get("reported") is True
            and journal.get("documentExpected") is True and journal.get("phase") == "TERMINAL",
            "The acknowledged failed request does not match this worker.")
    claim = journal.get("claimToken")
    require(isinstance(claim, str) and 16 <= len(claim) <= 512 and not re.search(r"\s", claim),
            "The original work claim is invalid.")
    outbound = journal.get("outbound")
    require(isinstance(outbound, dict)
            and set(outbound) == {"workerId", "id", "claimToken", "kind", "state", "message"}
            and all(outbound.get(key) == journal.get(key) for key in ("workerId", "id", "claimToken", "kind"))
            and outbound.get("state") == "needs_review"
            and isinstance(outbound.get("message"), str) and 0 < len(outbound["message"]) <= 500,
            "The frozen original outcome cannot be reconciled.")
    expected_work = {"id": identifier, "kind": "request", "projectPageId": project,
                     "payload": payload, "documentExpected": True}
    require(journal.get("workHash") == bridge.claimed_work_hash(expected_work),
            "The original work identity changed.")
    # Creation freshness does not apply to a read-only inspection of the PO
    # which the exact preparation already created. All other checks still run.
    try:
        prepared_at = datetime.fromisoformat(str(prepared.get("preparedAt", "")).replace("Z", "+00:00"))
        creator.validate_prepared(prepared, request, journal.get("preparedHash"), now=prepared_at)
    except (ValueError, TypeError):
        raise ReconciliationError("The frozen original preparation does not validate.") from None
    expected_url = creator.BASE + "/staff/project-purchase-order-modify/" + str(project) + "/" + str(order_id)
    location = urljoin(creator.BASE, str(attempt.get("location", "")))
    require(attempt.get("state") == "RESPONSE_RECEIVED" and attempt.get("status") in (302, 303)
            and attempt.get("reference") == request["reference"] and location == expected_url,
            "The original creation response does not identify this existing PO.")
    context = journal.get("documentContext")
    require(isinstance(context, dict) and set(context) == {"project", "supplier"}
            and all(isinstance(value, str) and value.strip() for value in context.values()),
            "The original PO document context is unavailable.")
    return {"folder": folder, "sourcePath": source_path, "request": request,
            "prepared": prepared, "attempt": attempt, "journal": journal,
            "sourceHashes": hashes, "url": expected_url, "number": number}


def native_verify(source):
    """Invoke only the existing readback verifier; intercept its result save."""
    from playwright.sync_api import sync_playwright
    captured, original_save = [], creator.save

    def capture(path, value):
        require(Path(path) == source["folder"] / "nexvia-result.json" and not captured,
                "The read-only verifier attempted an unexpected file write.")
        captured.append(value)

    creator.save = capture
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
            signed_in = next((context for context in browser.contexts if any(
                page.url.startswith(creator.BASE + "/staff/") and "/login" not in page.url
                for page in context.pages)), None)
            require(signed_in is not None, "Nexvia sign-in is required for existing-PO verification.")
            with creator.quote_browser_context(browser, signed_in) as owned:
                result = creator.verify(owned, source["attempt"]["location"], source["request"],
                                        source["prepared"], source["folder"])
        require(captured == [result], "The read-only verifier returned inconsistent evidence.")
        return result
    finally:
        creator.save = original_save


def verified(source, verifier):
    raw = verifier(source)
    require(isinstance(raw, dict) and raw.get("requestorEmailSent") is False
            and raw.get("jobId") == source["prepared"]["jobId"],
            "The existing PO allocation or native email state does not match.")
    result = normalized_result(raw, source["request"])
    require(result["url"] == source["url"] and result["purchaseOrderNumber"] == source["number"],
            "The existing PO does not match the explicitly selected number.")
    return raw, dict(result, documentExpected=True)


def report_for(source):
    return {"format": FORMAT, "version": 1, "nativeVerified": True,
            "requestId": source["request"]["requestId"],
            "projectPageId": source["request"]["projectPageId"],
            "purchaseOrderId": int(urlsplit(source["url"]).path.rsplit("/", 1)[1]),
            "purchaseOrderNumber": source["number"], "readOnly": True,
            "poCreated": False, "poChanged": False, "resultWritten": False}


def report_path(value):
    path = Path(value).absolute()
    require(path.parent == REPORT_ROOT.absolute() and path.name in REPORT_NAMES and not path.is_symlink(),
            "Use the fixed existing-PO check report in the configuration folder.")
    if path.exists():
        info = path.stat(follow_symlinks=False)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                "The check report destination is unsafe.")
    return path


def checked_config(config_path):
    config = bridge.load_config(config_path)
    require(config is not None and config["documentEnabled"] is True,
            "The existing bridge and original PO document support must be enabled.")
    return config


def check_existing(request_id, project, order_id, number, *, config_path=bridge.CONFIG,
                   journal_root=bridge.JOURNAL, request_root=bridge.REQUESTS,
                   verifier=native_verify, inherited_lock_fd=None):
    with recovery_lock(journal_root, inherited_lock_fd, check_only=True):
        config = checked_config(config_path)
        source = sources(request_id, project, order_id, number, config, journal_root, request_root)
        verified(source, verifier)
        require(sources(request_id, project, order_id, number, config, journal_root,
                        request_root)["sourceHashes"] == source["sourceHashes"],
                "Original recovery evidence changed during verification.")
        return report_for(source)


def exclusive_json(path, value):
    raw = bridge.canonical(value)
    require(len(raw) <= MAX_JSON, "Recovery evidence exceeds its size limit.")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            descriptor = None
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        directory = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except FileExistsError:
        require(private_json(path)[0] == value, "Existing recovery evidence differs; nothing was replaced.")
    except ReconciliationError:
        raise
    except OSError:
        raise ReconciliationError("Recovery evidence could not be saved safely.") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def recovery_base(source, raw, result):
    journal = source["journal"]
    identity = {key: journal[key] for key in ("workerId", "id", "claimToken", "kind")}
    reconcile_outbound = {key: identity[key] for key in ("workerId", "id", "claimToken")}
    reconcile_outbound.update(version=1, previous={"state": "needs_review", "message": journal["outbound"]["message"]}, result=result)
    return {"version": 1, **identity, "workHash": journal["workHash"], "documentExpected": True,
            "documentContext": journal["documentContext"], "sourceHashes": source["sourceHashes"],
            "rawResult": raw, "outbound": {**identity, "state": "created_verified", "result": result},
            "reconcileOutbound": reconcile_outbound}


def validate_recovery(saved, source):
    require(isinstance(saved, dict) and set(saved) <= BASE_KEYS | {"evidenceHash", "reported", "receipt"}
            and BASE_KEYS <= set(saved) and type(saved.get("reported")) is bool,
            "Recovery journal is invalid.")
    raw = saved.get("rawResult")
    require(isinstance(raw, dict), "Recovery result is invalid.")
    result = dict(normalized_result(raw, source["request"]), documentExpected=True)
    require(result["url"] == source["url"] and result["purchaseOrderNumber"] == source["number"]
            and raw.get("jobId") == source["prepared"]["jobId"] and raw.get("requestorEmailSent") is False,
            "Recovery result belongs to another PO.")
    expected = recovery_base(source, raw, result)
    require(all(saved.get(key) == value for key, value in expected.items())
            and saved.get("evidenceHash") == bridge.fingerprint(expected),
            "Frozen recovery evidence changed.")
    return saved


def reconciliation_hash(body):
    """Match the server's sorted JSON/TextEncoder hashes, including Unicode."""
    def hashed(value):
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()
    previous = body["previous"]
    original = hashed({"state": previous["state"], "message": previous["message"]})
    return hashed({"version": 1, "originalOutcomeHash": original, "result": body["result"]})


def reconciliation_ack(reply, saved):
    record = reply.get("request") if isinstance(reply, dict) else None
    receipt = reply.get("reconciliation") if isinstance(reply, dict) else None
    require(isinstance(reply, dict) and reply.get("ok") is True and type(reply.get("duplicate")) is bool
            and reply.get("acceptedState") == "created_verified" and isinstance(record, dict)
            and record.get("id") == saved["id"] and record.get("state") == "created_verified"
            and record.get("result") == saved["reconcileOutbound"]["result"]
            and isinstance(receipt, dict) and set(receipt) == {"version", "hash"}
            and type(receipt.get("version")) is int and receipt["version"] == 1
            and receipt.get("hash") == reconciliation_hash(saved["reconcileOutbound"]),
            "PanelStock has not acknowledged this exact reconciled PO.")
    if saved.get("receipt") is not None:
        require(saved["receipt"] == receipt, "The reconciliation acknowledgement changed.")
    return dict(receipt)


def reconcile(request_id, project, order_id, number, *, config_path=bridge.CONFIG,
              journal_root=bridge.JOURNAL, request_root=bridge.REQUESTS,
              verifier=native_verify, post=post_api, capturer=None,
              status_attempts=3, pause=time.sleep):
    require(type(status_attempts) is int and 1 <= status_attempts <= 3,
            "Recovery confirmation checks exceed their bound.")
    with recovery_lock(journal_root):
        config = checked_config(config_path)
        source = sources(request_id, project, order_id, number, config, journal_root, request_root)
        root = Path(journal_root) / "reconciliations"
        bridge.make_tool_root(root, root, proof=True)
        path = root / ("request-" + source["request"]["requestId"] + ".json")
        if path.exists() or path.is_symlink():
            saved = validate_recovery(private_json(path)[0], source)
        else:
            require(not (source["folder"] / "nexvia-result.json").exists()
                    and not (source["folder"] / "nexvia-result.json").is_symlink(),
                    "An existing result needs review before reconciliation.")
            raw, result = verified(source, verifier)
            require(sources(request_id, project, order_id, number, config, journal_root,
                            request_root)["sourceHashes"] == source["sourceHashes"],
                    "Original recovery evidence changed during verification.")
            base = recovery_base(source, raw, result)
            saved = {**base, "evidenceHash": bridge.fingerprint(base), "reported": False}
            exclusive_json(path, saved)  # Freeze timestamp and exact outbound before any POST.
        exclusive_json(source["folder"] / "nexvia-result.json", saved["rawResult"])
        if saved["reported"] is not True:
            reply = post(RECONCILE_PATH, saved["reconcileOutbound"], config["token"])
            saved.update(receipt=reconciliation_ack(reply, saved), reported=True)
            bridge.atomic_json(path, saved)
        else:
            reconciliation_ack({"ok": True, "duplicate": True, "acceptedState": "created_verified",
                                "request": {"id": saved["id"], "state": "created_verified",
                                            "result": saved["reconcileOutbound"]["result"]},
                                "reconciliation": saved.get("receipt")}, saved)
        document_path = bridge.ensure_document_journal(path, saved)
        require(document_path is not None, "The reconciled PO document journal is unavailable.")
        if capturer is None:
            capturer = bridge.load_document_capturer()
        document_status = bridge.process_document(document_path, config, request_root, post, capturer,
                                                  warning=lambda _message: None)
        document = bridge.read_json(document_path, private=True)
        confirmation_status = document.get("receipt", {}).get("status")
        if document.get("status") == "uploaded":
            # Replaying the same frozen reconciliation reads the current status
            # and repairs queue publication with the original idempotency key.
            for attempt in range(status_attempts):
                reply = post(RECONCILE_PATH, saved["reconcileOutbound"], config["token"])
                reconciliation_ack(reply, saved)
                confirmation = reply["request"].get("confirmation")
                require(isinstance(confirmation, dict) and confirmation.get("status") in {
                    "awaiting_document", "queued", "retrying", "sending", "sent", "failed", "needs_review"},
                    "The reconciled confirmation status is unavailable.")
                confirmation_status = confirmation["status"]
                if confirmation_status in {"sent", "failed", "needs_review"} or attempt == status_attempts - 1:
                    break
                pause(1)
        require(sources(request_id, project, order_id, number, config, journal_root,
                        request_root)["sourceHashes"] == source["sourceHashes"],
                "Original recovery evidence changed during reconciliation.")
        return {"purchaseOrderNumber": number, "reconciled": True,
                "documentStatus": document.get("status"), "documentAction": document_status,
                "confirmationStatus": confirmation_status}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--project", type=int, required=True)
    parser.add_argument("--po", type=int, required=True)
    parser.add_argument("--number", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--reconcile", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--bridge-lock-fd", type=int)
    args = parser.parse_args(argv)
    destination = None
    try:
        if args.reconcile:
            require(args.output is None and args.bridge_lock_fd is None,
                    "Reconciliation cannot inherit an installer lock or use a check-report path.")
            result = reconcile(args.request, args.project, args.po, args.number)
            print("Existing PO reconciled:", result["purchaseOrderNumber"])
            print("Original PO PDF:", result["documentStatus"])
            print("Confirmation:", result["confirmationStatus"] or "pending")
            print("No PO was created or changed. Original request and attempt records were preserved.")
            return 0 if result["documentStatus"] == "uploaded" else 2
        if args.output is not None:
            destination = report_path(args.output)
        report = check_existing(args.request, args.project, args.po, args.number,
                                inherited_lock_fd=args.bridge_lock_fd)
        if destination is not None:
            from nexvia_inspect_quote_upload import save_report
            save_report(destination, report)
        print("Existing PO verified:", report["purchaseOrderNumber"])
        print("No PO was created or changed; no result or request journal was written.")
        return 0
    except Exception as error:
        if destination is not None and not args.reconcile:
            try:
                from nexvia_inspect_quote_upload import save_report
                report = {"format": FORMAT, "version": 1, "nativeVerified": False,
                          "requestId": args.request, "projectPageId": args.project,
                          "purchaseOrderId": args.po, "purchaseOrderNumber": args.number,
                          "readOnly": True, "poCreated": False, "poChanged": False,
                          "resultWritten": False}
                save_report(destination, report)
            except Exception:
                pass
        message = str(error) if isinstance(error, ReconciliationError) else type(error).__name__
        print("Existing PO recovery stopped:", message)
        print("Do not submit another PO; original records were preserved.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
