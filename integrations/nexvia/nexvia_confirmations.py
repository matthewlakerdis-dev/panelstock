#!/usr/bin/env python3
"""Forward existing verified Nexvia results to PanelStockHQ for confirmation email.

This process never opens Nexvia and contains no PO submission operation. Its only
network destination is the confirmation endpoint below. Keep its config private.
"""

import argparse
import contextlib
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import uuid


ENDPOINT = (
    "https://panelstock-reports.matthewlakerdis.workers.dev"
    "/integrations/nexvia/confirmations"
)
CONFIG = Path("/config/panelstock-confirmations.json")
REQUESTS = Path("/config/nexvia-requests")
PROJECTS = Path("/config/nexvia-projects.json")
JOB_FILE = "panelstock-confirmation-job.json"
RECEIPT_FILE = "panelstock-confirmation-receipt.json"
MAX_JSON_BYTES = 1024 * 1024
MAX_RESPONSE_BYTES = 65536
TERMINAL = {"failed", "needs_review"}
PENDING = {"queued", "sending", "retrying"}


class BridgeError(Exception):
    """Errors deliberately contain no response bodies, tokens or addresses."""


class NeedsReview(BridgeError):
    """A response that requires an operator before more network attempts."""


def require(condition, message):
    if not condition:
        raise BridgeError(message)


def read_json(path, private=False):
    path = Path(path)
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(path, flags), "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode), "Expected a regular JSON file")
            if private:
                require(not info.st_mode & 0o077, "Config must have mode 0600")
            data = stream.read(MAX_JSON_BYTES + 1)
        require(len(data) <= MAX_JSON_BYTES, "JSON file exceeds size limit")
        result = json.loads(data)
        require(isinstance(result, dict), "Expected a JSON object")
        return result, data
    except (OSError, ValueError) as error:
        raise BridgeError("Local JSON file is unavailable or invalid") from error


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def atomic_json(path, value):
    """Replace a bridge record atomically with private file permissions."""
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".confirmation-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(canonical(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_config(path=CONFIG):
    if not Path(path).exists():
        return None
    config, _ = read_json(path, private=True)
    if config.get("enabled") is not True:
        return None
    token = config.get("token")
    require(isinstance(token, str) and 32 <= len(token) <= 512
            and all(33 <= ord(char) <= 126 for char in token),
            "Enabled config needs a valid confirmation token")
    return {"token": token}


def positive_id(value):
    return type(value) is int and 0 < value <= 9007199254740991


def money_cents(value):
    return type(value) is int and 0 <= value <= 1000000000000


def canonical_uuid(value):
    try:
        normalized = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise BridgeError("Request folder must use a canonical UUID") from error
    require(value == normalized, "Request folder must use a canonical UUID")
    return normalized


def build_payload(folder, request, result, projects):
    request_id = canonical_uuid(folder.name)
    require(request.get("requestId") == request_id, "Request identity mismatch")
    reference = request.get("reference")
    require(reference == "REQ-" + request_id
            and result.get("requestReference") == reference,
            "Verified result does not match the saved request")
    require(result.get("state") == "CREATED_VERIFIED", "PO is not verified")
    project_id = request.get("projectPageId")
    require(positive_id(project_id) and result.get("projectPageId") == project_id,
            "Verified project identity mismatch")
    order_id = result.get("purchaseOrderId")
    order_number = result.get("purchaseOrderNumber")
    require(positive_id(order_id) and isinstance(order_number, str)
            and re.fullmatch(r"PO[0-9]{1,20}", order_number),
            "Verified PO identity is invalid")
    expected_url = (
        "https://lennox.nexvia.com.au/staff/project-purchase-order-modify/"
        + str(project_id) + "/" + str(order_id)
    )
    require(result.get("url") == expected_url, "Verified PO URL identity mismatch")
    total = request.get("totalCents")
    require(money_cents(total) and type(result.get("totalCents")) is int
            and result["totalCents"] == total, "Verified total does not match request")
    verified_at = result.get("verifiedAt")
    try:
        require(isinstance(verified_at, str) and len(verified_at) <= 40,
                "Verification timestamp is invalid")
        timestamp = datetime.fromisoformat(verified_at.replace("Z", "+00:00"))
        require(timestamp.tzinfo is not None and timestamp.utcoffset() == timedelta(0),
                "Verification timestamp must use UTC")
    except ValueError as error:
        raise BridgeError("Verification timestamp is invalid") from error
    # Python's source result uses +00:00 and may include microseconds. The
    # server contract uses UTC milliseconds; persist this value once per job.
    verified_at = timestamp.astimezone(timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    person = request.get("requestor")
    require(isinstance(person, dict), "Saved requestor is missing")
    recipient = person.get("email")
    require(isinstance(recipient, str) and len(recipient) <= 254
            and re.fullmatch(r"[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+", recipient),
            "Saved requestor email is invalid")
    rows = projects.get("projects")
    require(isinstance(rows, list), "Project directory is invalid")
    matches = [row for row in rows if isinstance(row, dict)
               and row.get("projectPageId") == project_id]
    require(len(matches) == 1 and isinstance(matches[0].get("name"), str),
            "Project name is missing or ambiguous")
    name = matches[0]["name"].strip()
    require(0 < len(name.encode("utf-16-le")) // 2 <= 160
            and not any(ord(c) < 32 or ord(c) == 127 for c in name),
            "Project name is invalid")
    return {
        "requestId": request_id, "requestReference": reference,
        "recipient": recipient, "project": name,
        "purchaseOrderId": order_id, "purchaseOrderNumber": order_number,
        "projectPageId": project_id, "totalCents": total, "currency": "AUD",
        "state": "CREATED_VERIFIED", "verifiedAt": verified_at, "test": False,
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise NeedsReview("Confirmation endpoint redirected; check deployment")


def post_confirmation(payload, token):
    # The URL is intentionally not a configuration option. Never forward the
    # machine credential to a redirect or a caller-selected destination.
    require(urlsplit(ENDPOINT).scheme == "https"
            and urlsplit(ENDPOINT).hostname
            == "panelstock-reports.matthewlakerdis.workers.dev",
            "Unexpected confirmation destination")
    request = urllib.request.Request(
        ENDPOINT, data=canonical(payload), method="POST",
        headers={"Authorization": "Bearer " + token,
                 "User-Agent": "PanelStock-Nexvia-Bridge/1.0",
                 "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=25) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        require(len(raw) <= MAX_RESPONSE_BYTES, "Confirmation response exceeds limit")
        result = json.loads(raw)
        require(isinstance(result, dict), "Invalid confirmation response")
        return result
    except urllib.error.HTTPError as error:
        # HTTP failures have no proven acceptance; retain the original payload.
        # Authentication and conflicts need operator attention, not rapid retries.
        if error.code in {400, 401, 403, 404, 409, 422}:
            raise NeedsReview("Confirmation requires attention: HTTP " + str(error.code)) from error
        raise BridgeError("Confirmation remains pending: HTTP " + str(error.code)) from error
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise BridgeError("Confirmation response unavailable; payload retained") from error


def process_folder(folder, projects, token, post=post_confirmation):
    folder = Path(folder)
    require(not folder.is_symlink() and folder.is_dir(), "Request folder is invalid")
    canonical_uuid(folder.name)
    result_path = folder / "nexvia-result.json"
    if not result_path.exists():
        return "unverified"
    result, result_bytes = read_json(result_path)
    if result.get("state") != "CREATED_VERIFIED":
        return "unverified"
    if result.get("requestorEmailSent") is True:
        return "sent"
    request_path = folder / "request.json"
    request, request_bytes = read_json(request_path)
    proposed = build_payload(folder, request, result, projects)
    source_hash = hashlib.sha256(request_bytes + b"\0" + result_bytes).hexdigest()
    job_path = folder / JOB_FILE
    if job_path.exists():
        job, _ = read_json(job_path)
        require(job.get("version") == 1 and job.get("payload") == proposed
                and job.get("sourceHash") == source_hash,
                "Saved confirmation changed; manual review required")
    else:
        job = {"version": 1, "payload": proposed,
               "sourceHash": source_hash}
        atomic_json(job_path, job)
    receipt_path = folder / RECEIPT_FILE
    expected_id = "live:" + str(job["payload"]["purchaseOrderId"])
    receipt = None
    if receipt_path.exists():
        receipt, _ = read_json(receipt_path)
        require(receipt.get("payloadHash") == hashlib.sha256(canonical(job["payload"])).hexdigest(),
                "Confirmation receipt mismatch; manual review required")
        if receipt.get("status") in TERMINAL:
            return receipt["status"]
        require(receipt.get("id") == expected_id
                and receipt.get("status") in PENDING | {"sent"},
                "Confirmation receipt identity mismatch; manual review required")
        if receipt["status"] == "sent":
            require(isinstance(receipt.get("providerId"), str) and bool(receipt["providerId"]),
                    "Accepted confirmation needs provider receipt")
    if not receipt or receipt.get("status") != "sent":
        try:
            reply = post(job["payload"], token)
        except NeedsReview:
            atomic_json(receipt_path, {
                "id": None, "status": "needs_review", "providerId": None,
                "payloadHash": hashlib.sha256(canonical(job["payload"])).hexdigest(),
            })
            return "needs_review"
        require(isinstance(reply, dict), "Confirmation response is incomplete; payload retained")
        remote = reply.get("confirmation") if isinstance(reply, dict) else None
        require(reply.get("ok") is True and isinstance(remote, dict)
                and isinstance(remote.get("id"), str) and bool(remote["id"])
                and remote.get("status") in PENDING | TERMINAL | {"sent"},
                "Confirmation response is incomplete; payload retained")
        require(remote["id"] == expected_id
                and type(remote.get("purchaseOrderId")) is int
                and remote["purchaseOrderId"] == job["payload"]["purchaseOrderId"]
                and remote.get("purchaseOrderNumber") == job["payload"]["purchaseOrderNumber"]
                and remote.get("test") is False,
                "Confirmation response identity mismatch; payload retained")
        if receipt:
            require(remote["id"] == receipt.get("id"), "Remote confirmation identity changed")
        if remote["status"] == "sent":
            require(isinstance(remote.get("providerId"), str) and bool(remote["providerId"]),
                    "Accepted confirmation needs provider receipt")
        receipt = {"id": remote["id"], "status": remote["status"],
                   "providerId": remote.get("providerId"),
                   "payloadHash": hashlib.sha256(canonical(job["payload"])).hexdigest()}
        atomic_json(receipt_path, receipt)
    if receipt["status"] == "sent":
        # The independent receipt is authoritative. A terminal verified result
        # is normally immutable. Never replace a result/request changed while
        # awaiting the response. The creation worker must not concurrently edit
        # terminal results; it does not participate in this process's flock.
        _, current_request = read_json(request_path)
        current, current_result = read_json(result_path)
        require(current_request == request_bytes and current_result == result_bytes,
                "Email accepted; source changed, result flag was not updated")
        current["requestorEmailSent"] = True
        current["requestorEmailProviderId"] = receipt["providerId"]
        atomic_json(result_path, current)
    return receipt["status"]


@contextlib.contextmanager
def bridge_lock(root):
    descriptor = os.open(root / ".panelstock-confirmations.lock",
                         os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise BridgeError("Another confirmation bridge is running") from error
        yield
    finally:
        os.close(descriptor)


def run_once(config_path=CONFIG, root=REQUESTS, projects_path=PROJECTS,
             request_id=None, post=post_confirmation):
    config = load_config(config_path)
    if config is None:
        return {"bridge": "disabled"}
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), "Request root is unavailable")
    projects, _ = read_json(projects_path)
    if request_id is not None:
        canonical_uuid(request_id)
        folders = [root / request_id]
    else:
        folders = sorted(folder for folder in root.iterdir()
                         if re.fullmatch(r"[0-9a-f-]{36}", folder.name))
    outcomes = {}
    with bridge_lock(root):
        for folder in folders:
            try:
                outcomes[folder.name] = process_folder(folder, projects, config["token"], post)
            except BridgeError as error:
                outcomes[folder.name] = str(error)
    return outcomes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Process existing results once (default)")
    mode.add_argument("--watch", action="store_true", help="Poll existing results every 30 seconds")
    parser.add_argument("--request", help="Only process this saved request UUID")
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--root", type=Path, default=REQUESTS)
    parser.add_argument("--projects", type=Path, default=PROJECTS)
    args = parser.parse_args()
    while True:
        try:
            outcome = run_once(args.config, args.root, args.projects, args.request)
            for request_id, status in outcome.items():
                print(request_id + ": " + status, flush=True)
        except BridgeError as error:
            print(str(error), flush=True)
            if not args.watch:
                return 1
        if not args.watch:
            return int(any(status not in PENDING | {"disabled", "unverified", "sent"}
                           for status in outcome.values()))
        time.sleep(30)


if __name__ == "__main__":
    raise SystemExit(main())
