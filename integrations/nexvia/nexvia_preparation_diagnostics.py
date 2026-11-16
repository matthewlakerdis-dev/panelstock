"""Bounded private preparation observations, never submission/retry authority.

Only fixed stage/code names and typed transport statistics are accepted. Raw
exceptions, native URLs, headers, policies and document content have no input
field. Logging is best effort and cannot change the operation's result.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
import hashlib
import json
import math
import os
import stat
import time
import uuid


DIAGNOSTICS_VERSION = 1
DIAGNOSTIC_FILE = "nexvia-preparation-diagnostic.json"
MAX_BYTES = 4096
MAX_EVENTS = 16
MAX_COUNT = 9
MAX_AGE_SECONDS = 600
STAGES = frozenset({"start", "source", "choices", "allocation", "finance", "quote_draft",
                    "quote_policy", "quote_upload", "quote_registration", "quote_verify",
                    "prepared_validation", "prepared_save", "prepared"})
COUNTERS = frozenset({"policyRequests", "storageUploads", "registrations"})
ROUTE_CLASSES = frozenset({"native_policy", "storage_upload", "native_registration",
                           "native_read", "native_other", "storage_other", "external", "other"})
METHODS = frozenset({"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "OTHER"})
PUBLIC_MESSAGES = {
    "preparation_failed": "Preparation did not finish. No PO submission was authorised; review this request.",
    "preparation_interrupted": "Preparation was interrupted. No PO submission was authorised; review this request.",
    "source_validation_failed": "The quote source could not be verified. No PO submission was authorised.",
    "choices_validation_failed": "Current Nexvia supplier or project choices could not be verified. No PO submission was authorised.",
    "allocation_validation_failed": "The native project and extent-of-work allocation could not be verified. No PO submission was authorised.",
    "finance_validation_failed": "Current Nexvia accounts, tax or totals could not be verified. No PO submission was authorised.",
    "quote_draft_invalid": "The native quote draft could not be verified. No PO submission was authorised.",
    "quote_policy_blocked": "The native quote upload policy step did not complete. An upload may have started; review its saved attempt before trying again.",
    "quote_upload_incomplete": "The quote upload did not finish. An upload may have started; review its saved attempt before trying again.",
    "quote_registration_incomplete": "The quote upload did not return a verified file registration. No PO submission was authorised; review the saved upload attempt.",
    "quote_file_unverified": "The uploaded quote file could not be verified. No PO submission was authorised; review the saved upload attempt.",
    "prepared_validation_failed": "The prepared purchase order could not be verified. No PO submission was authorised.",
    "prepared_save_failed": "The verified preparation could not be saved. No PO submission was authorised.",
}
_POLICY_FAILURE_MESSAGES = {
    "metadata": "The native quote policy metadata did not match the selected PDF.",
    "fetch": "The native quote policy request did not return a response.",
    "http": "The native quote policy request returned an unexpected HTTP status.",
    "response_size": "The native quote policy response exceeded its expected size.",
    "json": "The native quote policy response was not valid bounded JSON.",
    "fields": "The native quote policy response fields could not be verified.",
    "signature": "The native quote policy signing fields could not be verified.",
    "document": "The native quote policy document could not be verified.",
    "conditions": "The native quote policy conditions could not be verified.",
    "pdf_compat": "The native quote policy did not cover the selected PDF.",
    "response": "The native quote policy response could not be verified.",
    "forward": "The verified native quote policy could not be returned to the uploader.",
}
PUBLIC_MESSAGES.update({"quote_policy_" + code: message +
    " No PO submission was authorised; review the saved upload attempt before trying again."
    for code, message in _POLICY_FAILURE_MESSAGES.items()})
STAGE_CODES = {
    "start": "preparation_failed", "source": "source_validation_failed",
    "choices": "choices_validation_failed", "allocation": "allocation_validation_failed",
    "finance": "finance_validation_failed", "quote_draft": "quote_draft_invalid",
    "quote_policy": "quote_policy_blocked", "quote_upload": "quote_upload_incomplete",
    "quote_registration": "quote_registration_incomplete", "quote_verify": "quote_file_unverified",
    "prepared_validation": "prepared_validation_failed", "prepared_save": "prepared_save_failed",
    "prepared": "preparation_failed",
}
_CURRENT = ContextVar("nexvia_preparation_diagnostic", default=None)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def _identity(request):
    identifier = request["requestId"]
    if type(identifier) is not str or str(uuid.UUID(identifier)) != identifier:
        raise ValueError("Invalid diagnostic identity")
    return identifier, hashlib.sha256(_canonical(request)).hexdigest()


def _timestamp():
    return datetime.fromtimestamp(time.time(), timezone.utc).isoformat()


def _opened_folder(folder):
    descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        current = os.stat(folder, follow_symlinks=False)
        if (not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700
                or not stat.S_ISDIR(current.st_mode)
                or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino)):
            raise ValueError("Unsafe diagnostic folder")
        return descriptor
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise


def _safe_existing(directory):
    try:
        info = os.stat(DIAGNOSTIC_FILE, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return
    if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_nlink != 1 or info.st_size > MAX_BYTES):
        raise ValueError("Unsafe diagnostic file")


class _Recorder:
    def __init__(self, folder, request):
        self.active = True
        self.folder = folder
        identifier, request_hash = _identity(request)
        stamp = _timestamp()
        self.value = {"version": 1, "requestId": identifier, "requestHash": request_hash,
                      "startedAt": stamp, "updatedAt": stamp, "phase": "start", "status": "running",
                      "code": "", "counters": {key: 0 for key in sorted(COUNTERS)},
                      "events": [], "truncated": False}

    def persist(self):
        directory, temporary = None, None
        try:
            self.value["updatedAt"] = _timestamp()
            raw = _canonical(self.value)
            if len(raw) > MAX_BYTES:
                return
            directory = _opened_folder(self.folder)
            _safe_existing(directory)
            temporary = ".nexvia-preparation-diagnostic-" + uuid.uuid4().hex + ".tmp"
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=directory)
            with os.fdopen(descriptor, "wb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                info = os.fstat(stream.fileno())
                if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
                        or info.st_nlink != 1):
                    raise ValueError("Unsafe diagnostic temporary file")
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.rename(temporary, DIAGNOSTIC_FILE, src_dir_fd=directory, dst_dir_fd=directory)
            temporary = None
            os.fsync(directory)
        except Exception:
            pass  # Observations cannot mask, authorise or retry an operation.
        finally:
            if directory is not None:
                if temporary is not None:
                    try:
                        os.unlink(temporary, dir_fd=directory)
                    except OSError:
                        pass
                try:
                    os.close(directory)
                except OSError:
                    pass


def _persist(recorder):
    try:
        recorder.persist()
    except Exception:
        pass


@contextmanager
def preparation_diagnostics(folder, request):
    try:
        recorder = _Recorder(folder, request)
    except Exception:
        recorder = None
    token = _CURRENT.set(recorder)
    try:
        if recorder is not None:
            _persist(recorder)
        try:
            yield
        except BaseException as error:
            if recorder is not None:
                recorder.value["status"] = "failed"
                if not recorder.value["code"]:
                    recorder.value["code"] = ("preparation_interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit))
                                               else STAGE_CODES[recorder.value["phase"]])
                _persist(recorder)
            raise
        else:
            if recorder is not None:
                recorder.value.update(phase="prepared", status="prepared", code="")
                _persist(recorder)
    finally:
        if recorder is not None:
            recorder.active = False
        try:
            _CURRENT.reset(token)
        except Exception:
            try:
                _CURRENT.set(None)
            except Exception:
                pass


def bind_callback(callback):
    """Carry only this operation's recorder into browser callback greenlets.

    Playwright's synchronous callbacks run in a separate Context. Every call
    owns its token, including nested response callbacks. An inactive captured
    recorder binds None so late callbacks cannot write another request's log.
    """
    try:
        recorder = _CURRENT.get()
    except Exception:
        recorder = None

    # Keep the original signature for Playwright's arity adapter, without
    # copying any cached adapter from a previously registered callback.
    @wraps(callback, updated=())
    def bound(*args, **kwargs):
        token = None
        try:
            token = _CURRENT.set(recorder if recorder is not None and recorder.active else None)
        except Exception:
            pass
        try:
            return callback(*args, **kwargs)
        finally:
            if token is not None:
                try:
                    _CURRENT.reset(token)
                except Exception:
                    try:
                        _CURRENT.set(None)
                    except Exception:
                        pass

    return bound


def stage(name):
    recorder = _CURRENT.get()
    if recorder is not None and type(name) is str and name in STAGES:
        recorder.value["phase"] = name
        _persist(recorder)


def failure(code):
    recorder = _CURRENT.get()
    if recorder is not None and type(code) is str and code in PUBLIC_MESSAGES:
        recorder.value["code"] = code


def transport(**counts):
    recorder = _CURRENT.get()
    if recorder is None:
        return
    for key, value in counts.items():
        if key in COUNTERS and type(value) is int and value >= 0:
            recorder.value["counters"][key] = min(value, MAX_COUNT)
            if value > MAX_COUNT:
                recorder.value["truncated"] = True


def route_event(route_class, method, *, status=None, denied=False):
    recorder = _CURRENT.get()
    if (recorder is None or type(route_class) is not str or route_class not in ROUTE_CLASSES
            or type(method) is not str or method not in METHODS or type(denied) is not bool
            or status is not None and (type(status) is not int or not 100 <= status <= 599)):
        return
    event = {"class": route_class, "method": method, "status": status, "denied": denied}
    for previous in recorder.value["events"]:
        if all(previous[key] == value for key, value in event.items()):
            if previous["count"] < MAX_COUNT:
                previous["count"] += 1
            else:
                recorder.value["truncated"] = True
            return
    if len(recorder.value["events"]) == MAX_EVENTS:
        recorder.value["truncated"] = True
    else:
        recorder.value["events"].append(dict(event, count=1))


def failure_message(folder, request, not_before, now=None):
    """Read fresh observations for a failed invocation; return no authority."""
    directory = None
    try:
        identifier, request_hash = _identity(request)
        current = time.time() if now is None else now
        if (type(not_before) not in (int, float) or type(current) not in (int, float)
                or not math.isfinite(not_before) or not math.isfinite(current)):
            return None
        directory = _opened_folder(folder)
        descriptor = os.open(DIAGNOSTIC_FILE, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_nlink != 1 or info.st_size > MAX_BYTES):
                return None
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            return None
        value = json.loads(raw)
        if (not isinstance(value, dict) or set(value) != {"version", "requestId", "requestHash", "startedAt",
                "updatedAt", "phase", "status", "code", "counters", "events", "truncated"}
                or type(value["version"]) is not int or value["version"] != 1
                or value["requestId"] != identifier or value["requestHash"] != request_hash
                or type(value["phase"]) is not str or value["phase"] not in STAGES
                or value["status"] not in {"running", "failed", "prepared"}
                or type(value["code"]) is not str or value["code"] not in {"", *PUBLIC_MESSAGES}
                or type(value["truncated"]) is not bool):
            return None
        stamps = [datetime.fromisoformat(value[key]) for key in ("startedAt", "updatedAt")]
        if any(stamp.tzinfo is None or stamp.utcoffset().total_seconds() != 0 for stamp in stamps):
            return None
        started, updated = (stamp.timestamp() for stamp in stamps)
        if not (not_before <= started <= updated <= current + 1 and 0 <= current - started <= MAX_AGE_SECONDS):
            return None
        counts = value["counters"]
        if (not isinstance(counts, dict) or set(counts) != COUNTERS
                or any(type(count) is not int or not 0 <= count <= MAX_COUNT for count in counts.values())):
            return None
        if not isinstance(value["events"], list) or len(value["events"]) > MAX_EVENTS:
            return None
        for event in value["events"]:
            if (not isinstance(event, dict) or set(event) != {"class", "method", "status", "denied", "count"}
                    or type(event["class"]) is not str or event["class"] not in ROUTE_CLASSES
                    or type(event["method"]) is not str or event["method"] not in METHODS
                    or type(event["denied"]) is not bool or type(event["count"]) is not int
                    or not 1 <= event["count"] <= MAX_COUNT
                    or event["status"] is not None and (type(event["status"]) is not int
                                                       or not 100 <= event["status"] <= 599)):
                return None
        if value["status"] == "prepared":
            return None
        return PUBLIC_MESSAGES[value["code"] or STAGE_CODES[value["phase"]]]
    except Exception:
        return None
    finally:
        if directory is not None:
            try:
                os.close(directory)
            except OSError:
                pass
