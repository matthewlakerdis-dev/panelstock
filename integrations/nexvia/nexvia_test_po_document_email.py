#!/usr/bin/env python3
"""Check or explicitly send one fixed PO7413 email test with its verified PDF.

Default mode checks local files only. --status only reads the fixed server job.
Only --send may upload the frozen PDF. Nexvia is never opened or modified.
"""

import argparse
import base64
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import uuid


ORIGIN = "https://panelstock-reports.matthewlakerdis.workers.dev"
ENDPOINT = ORIGIN + "/integrations/nexvia/test-document-confirmation"
CONFIG = Path("/config/panelstock-requests.json")
CHECK_FOLDER = Path("/config/nexvia-po-document-check/PO7413")
MANIFEST = "nexvia-po-document.json"
PDF_NAME = "nexvia-purchase-order.pdf"
RECEIPT = "panelstock-po-document-test-email.json"
LOCK = ".po-document-test-email.lock"
JOB_ID = "test-document:1421"
MAX_PDF = 5 * 1024 * 1024
MAX_JSON = 8 * 1024 * 1024
MAX_REPLY = 64 * 1024
REMOTE_STATES = {"awaiting_document", "queued", "sending", "retrying", "sent", "failed", "needs_review"}
LOCAL_STATES = REMOTE_STATES | {"prepared", "pending_ack"}
TERMINAL = {"sent", "failed", "needs_review"}


class TestEmailError(Exception):
    """Fixed codes only, never provider text or private document/config data."""


class NeedsReview(TestEmailError):
    pass


def require(condition, code):
    if not condition:
        raise TestEmailError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def hash_value(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def private_read(path, maximum):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_mode & 0o777 == 0o600, "private-file-required")
            raw = stream.read(maximum + 1)
        require(len(raw) <= maximum, "local-file-too-large")
        return raw
    except OSError:
        raise TestEmailError("local-file-unavailable") from None


def read_json(path, maximum):
    raw = private_read(path, maximum)
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        raise TestEmailError("local-json-invalid") from None
    require(isinstance(value, dict), "local-json-invalid")
    return value, raw


def private_folder(folder):
    folder = Path(folder)
    try:
        require(not any(part.is_symlink() for part in [folder, *folder.parents]), "private-folder-required")
        descriptor = os.open(folder, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        try:
            info = os.fstat(descriptor)
            require(stat.S_ISDIR(info.st_mode) and info.st_mode & 0o777 == 0o700, "private-folder-required")
        finally:
            os.close(descriptor)
    except OSError:
        raise TestEmailError("verified-check-folder-unavailable") from None
    return folder


def atomic_json(path, value):
    raw = canonical(value)
    require(len(raw) <= MAX_JSON and not path.is_symlink(), "local-receipt-invalid")
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".po-email-test-", dir=path.parent)
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
    except OSError:
        raise TestEmailError("local-receipt-unavailable") from None
    finally:
        if temporary:
            os.unlink(temporary)


@contextlib.contextmanager
def test_lock(folder):
    folder = private_folder(folder)
    flags, created = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), False
    try:
        try:
            descriptor = os.open(folder / LOCK, flags | os.O_CREAT | os.O_EXCL, 0o600)
            created = True
        except FileExistsError:
            descriptor = os.open(folder / LOCK, flags)
        try:
            require(stat.S_ISREG(os.fstat(descriptor).st_mode), "local-lock-invalid")
            if created:
                os.fchmod(descriptor, 0o600)
            require(os.fstat(descriptor).st_mode & 0o777 == 0o600, "local-lock-invalid")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise TestEmailError("test-already-running") from None
            yield folder
        finally:
            os.close(descriptor)
    except OSError:
        raise TestEmailError("local-lock-unavailable") from None


def load_config(path):
    config, _ = read_json(path, 64 * 1024)
    token, worker = config.get("token"), config.get("workerId")
    require(isinstance(token, str) and 32 <= len(token) <= 512
            and all(33 <= ord(char) <= 126 for char in token), "request-credential-invalid")
    try:
        require(isinstance(worker, str) and str(uuid.UUID(worker)) == worker, "worker-identity-invalid")
    except (ValueError, TypeError, AttributeError):
        raise TestEmailError("worker-identity-invalid") from None
    return {"token": token, "workerId": worker}


def capture_module():
    spec = importlib.util.spec_from_file_location("nexvia_po_test_capture", Path(__file__).with_name("nexvia_po_document.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_pdf(raw, folder):
    try:
        module = capture_module()
        module.check_dependencies()
        module.official_pdf(raw, {"purchaseOrderNumber": "PO7413", "projectName": "Jardin building",
                                 "supplierName": "Bunnings", "totalCents": 110000}, folder)
    except Exception:
        raise TestEmailError("fixed-po-pdf-verification-failed") from None


def verified_artifact(folder, validator=None):
    folder = private_folder(folder)
    manifest, manifest_raw = read_json(folder / MANIFEST, 16384)
    require(type(manifest.get("version")) is int and manifest["version"] == 1
            and type(manifest.get("projectPageId")) is int and manifest["projectPageId"] == 60
            and type(manifest.get("purchaseOrderId")) is int and manifest["purchaseOrderId"] == 1421
            and manifest.get("purchaseOrderNumber") == "PO7413"
            and manifest.get("filename") == PDF_NAME and manifest.get("sourceKind") in {"data", "blob", "gcs"}
            and hash_value(manifest.get("identityHash")) and hash_value(manifest.get("sha256"))
            and type(manifest.get("size")) is int and 50 <= manifest["size"] <= MAX_PDF, "fixed-po-manifest-mismatch")
    raw = private_read(folder / PDF_NAME, MAX_PDF)
    require(len(raw) == manifest["size"] and digest(raw) == manifest["sha256"], "verified-pdf-changed")
    (validator or verify_pdf)(raw, folder)
    body = {"sha256": manifest["sha256"], "contentBase64": base64.b64encode(raw).decode("ascii")}
    require(len(canonical(body)) <= MAX_JSON, "local-file-too-large")
    return {"body": body, "bodyHash": digest(canonical(body)), "sourceHash": digest(manifest_raw + b"\0" + raw)}


def provider_id(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,200}", value) is not None


def load_receipt(folder, worker=None):
    path = folder / RECEIPT
    if not path.exists() and not path.is_symlink():
        return None
    receipt, _ = read_json(path, MAX_JSON)
    body = receipt.get("body")
    require(receipt.get("version") == 1 and receipt.get("jobId") == JOB_ID
            and isinstance(receipt.get("status"), str) and receipt["status"] in LOCAL_STATES and type(receipt.get("acknowledged")) is bool
            and isinstance(body, dict) and set(body) == {"sha256", "contentBase64"}
            and hash_value(body.get("sha256")) and isinstance(body.get("contentBase64"), str)
            and hash_value(receipt.get("sourceHash")) and digest(canonical(body)) == receipt.get("bodyHash")
            and (worker is None or receipt.get("workerId") == worker), "local-receipt-invalid")
    try:
        raw = base64.b64decode(body["contentBase64"], validate=True)
    except (ValueError, TypeError):
        raise TestEmailError("local-receipt-invalid") from None
    require(50 <= len(raw) <= MAX_PDF and digest(raw) == body["sha256"], "local-receipt-invalid")
    if receipt["status"] == "sent":
        require(receipt["acknowledged"] and provider_id(receipt.get("providerId")), "local-receipt-invalid")
    return receipt


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, stream, code, message, headers, new_url):
        raise NeedsReview("test-endpoint-redirected")


def request_test(method, token, body=None, opener=None):
    require(method in {"GET", "POST"} and (body is None) == (method == "GET"), "test-request-invalid")
    target = urlsplit(ENDPOINT)
    require(target.scheme == "https" and target.netloc == "panelstock-reports.matthewlakerdis.workers.dev"
            and target.path == "/integrations/nexvia/test-document-confirmation" and not target.query and not target.fragment,
            "test-endpoint-invalid")
    data = canonical(body) if body is not None else None
    require(data is None or len(data) <= MAX_JSON, "local-file-too-large")
    request = urllib.request.Request(ENDPOINT, method=method, data=data, headers={
        "Authorization": "Bearer " + token, "User-Agent": "PanelStock-Nexvia-Bridge/1.0",
        "Accept": "application/json", "Content-Type": "application/json"})
    try:
        client = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with client.open(request, timeout=30) as response:
            if response.status in {301, 302, 303, 307, 308}:
                raise NeedsReview("test-endpoint-redirected")
            require(response.status == 200, "test-connection-unavailable")
            raw = response.read(MAX_REPLY + 1)
        require(len(raw) <= MAX_REPLY, "test-reply-invalid")
        value = json.loads(raw)
        require(isinstance(value, dict), "test-reply-invalid")
        return value
    except urllib.error.HTTPError as error:
        if error.code == 409:
            raise NeedsReview("test-document-conflict") from None
        raise TestEmailError("test-connection-unavailable") from None
    except TestEmailError:
        raise
    except Exception:
        raise TestEmailError("test-connection-unavailable") from None


def remote_job(reply, sha256=None, allow_empty=False):
    require(isinstance(reply, dict) and reply.get("ok") is True, "test-reply-invalid")
    job = reply.get("confirmation")
    if job is None:
        require(allow_empty and reply.get("documentAttached") is False and reply.get("documentSha256") is None,
                "test-reply-mismatch")
        return None
    require(isinstance(job, dict) and job.get("id") == JOB_ID and job.get("test") is True
            and type(job.get("purchaseOrderId")) is int and job["purchaseOrderId"] == 1421
            and job.get("purchaseOrderNumber") == "PO7413" and isinstance(job.get("status"), str) and job["status"] in REMOTE_STATES
            and type(reply.get("documentAttached")) is bool and hash_value(reply.get("documentSha256"))
            and (sha256 is None or reply["documentSha256"] == sha256), "test-reply-mismatch")
    accepted = job["status"] == "sent"
    require(not accepted or (reply["documentAttached"] is True and provider_id(job.get("providerId"))), "test-reply-mismatch")
    return {"status": job["status"], "providerId": job.get("providerId") if provider_id(job.get("providerId")) else None,
            "acknowledged": reply["documentAttached"]}


def public_result(receipt):
    return {"status": receipt["status"], "providerAccepted": receipt["status"] == "sent"
            and receipt.get("acknowledged") is True and provider_id(receipt.get("providerId"))}


def send_test(*, folder=CHECK_FOLDER, config_path=CONFIG, transport=request_test, validator=None):
    config = load_config(config_path)
    with test_lock(folder) as folder:
        artifact = verified_artifact(folder, validator)
        receipt = load_receipt(folder, config["workerId"])
        if receipt:
            require(receipt["sourceHash"] == artifact["sourceHash"] and receipt["bodyHash"] == artifact["bodyHash"], "frozen-test-source-changed")
        else:
            receipt = {"version": 1, "jobId": JOB_ID, "workerId": config["workerId"],
                       **artifact, "status": "prepared", "acknowledged": False, "providerId": None,
                       "createdAt": datetime.now(timezone.utc).isoformat()}
            atomic_json(folder / RECEIPT, receipt)
        if receipt["status"] in TERMINAL:
            return public_result(receipt)
        # Re-read the source after verification and before any network operation.
        current_manifest = private_read(folder / MANIFEST, 16384)
        current_pdf = private_read(folder / PDF_NAME, MAX_PDF)
        require(digest(current_manifest + b"\0" + current_pdf) == receipt["sourceHash"], "frozen-test-source-changed")
        receipt.update(status="pending_ack")
        atomic_json(folder / RECEIPT, receipt)
        try:
            reply = transport("POST", config["token"], receipt["body"])
            require(isinstance(reply, dict), "test-reply-invalid")
            require(type(reply.get("duplicate")) is bool, "test-reply-invalid")
            remote = remote_job(reply, receipt["body"]["sha256"])
            require(remote["acknowledged"], "test-reply-mismatch")
            receipt.update(remote)
        except NeedsReview:
            receipt.update(status="needs_review")
        except TestEmailError as error:
            # A lost/invalid acknowledgement never changes the frozen body.
            # GET --status or the same explicit --send can reconcile it.
            if str(error) == "test-reply-mismatch":
                receipt.update(status="needs_review")
        atomic_json(folder / RECEIPT, receipt)
        return public_result(receipt)


def test_status(*, folder=CHECK_FOLDER, config_path=CONFIG, transport=request_test):
    config = load_config(config_path)
    with test_lock(folder) as folder:
        receipt = load_receipt(folder, config["workerId"])
        if receipt and receipt["status"] in TERMINAL:
            return public_result(receipt)
        reply = transport("GET", config["token"])
        try:
            remote = remote_job(reply, receipt["body"]["sha256"] if receipt else None, allow_empty=True)
        except TestEmailError as error:
            if receipt and str(error) == "test-reply-mismatch":
                receipt.update(status="needs_review")
                atomic_json(folder / RECEIPT, receipt)
                return public_result(receipt)
            raise
        if remote is None:
            return {"status": "not_sent", "providerAccepted": False}
        if receipt:
            receipt.update(remote)
            atomic_json(folder / RECEIPT, receipt)
        return public_result(remote)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--send", action="store_true", help="Send only the fixed, explicitly requested PO7413 PDF test")
    mode.add_argument("--status", action="store_true", help="Read the fixed test job without queuing email")
    mode.add_argument("--check", action="store_true", help="Verify local PDF only (the default)")
    args = parser.parse_args(argv)
    if args.send:
        result = send_test()
    elif args.status:
        result = test_status()
    else:
        verified_artifact(CHECK_FOLDER)
        print("Existing PO7413 PDF verified locally. No email requested.")
        return 0
    print("PO7413 PDF test status:", result["status"])
    print("Provider accepted:", result["providerAccepted"])
    print("No Nexvia PO was created, changed or resent.")
    return 0 if result["providerAccepted"] else 1 if result["status"] in {"failed", "needs_review"} else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except TestEmailError as error:
        print("PO7413 PDF test stopped:", str(error))
        raise SystemExit(1)
    except Exception:
        print("PO7413 PDF test stopped: test-unavailable")
        raise SystemExit(1)
