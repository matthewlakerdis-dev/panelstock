"""Private source and durable evidence for managed Nexvia quote attachments.

This module currently defines only local validation and evidence helpers. Native
upload and saved-PO readback are deliberately unavailable until the current
Nexvia uploader contract has been verified. Importing it invokes no browser or
network action.
"""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time
from urllib.parse import parse_qs, urlsplit
import uuid

from nexvia_allocations import context_values, quote_attachment_descriptor


SOURCE_FILE = "nexvia-supplier-quote.pdf"
ATTEMPT_FILE = "nexvia-quote-upload-attempt.json"
RECEIPT_FILE = "nexvia-quote-upload.json"
TRANSFER_FILE = "nexvia-quote-transfer.json"
SOURCE_TTL_SECONDS = 24 * 3600
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_RECEIPT_BYTES = 32 * 1024
ORIGIN = "https://lennox.nexvia.com.au"


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
