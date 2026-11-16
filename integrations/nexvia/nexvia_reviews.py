"""Assess a stopped request using private NAS evidence, without native actions.

The watcher calls this module only while it owns the existing bridge lock.
Original request files and journals are read-only. Assessment delivery has its
own durable journal so a lost HTTP response cannot trigger a second inspection.
"""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid


REVIEW_VERSION = 1
REVIEW_RESULT_PATH = "/integrations/nexvia/request-review-result"
MAX_JSON_BYTES = 8 * 1024 * 1024
MARKERS = ("nexvia-quote-upload-attempt.json", "nexvia-quote-upload.json",
           "nexvia-prepared.json", "nexvia-create-attempt.json", "nexvia-result.json")
READY = "No attachment, preparation or PO submission was started. A replacement request can be prepared."
BLOCKED = {
    "missing": "Original NAS evidence is missing; inspect the original request before preparing a replacement.",
    "unsafe": "Original NAS evidence is unreadable or unsafe; inspect it before preparing a replacement.",
    "mismatch": "Original NAS evidence does not match this review; a replacement is blocked.",
    "started": "Attachment, preparation or PO attempt evidence exists; inspect Nexvia before preparing a replacement.",
}


class ReviewError(ValueError):
    """A fixed diagnostic, never credentials, paths or source request content."""


class _EvidenceError(ReviewError):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(BLOCKED[reason])


def _require(condition, message="Stored review evidence is invalid"):
    if not condition:
        raise ReviewError(message)


def _canonical(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"),
                          ensure_ascii=True, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ReviewError("Review JSON is invalid") from error


def _hash(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _uuid(value):
    try:
        _require(isinstance(value, str) and str(uuid.UUID(value)) == value)
    except (ValueError, AttributeError, TypeError) as error:
        raise ReviewError("Review identity is invalid") from error
    return value


def _sha(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def _claim(value):
    _require(isinstance(value, str) and 16 <= len(value) <= 512
             and all(33 <= ord(character) <= 126 for character in value), "Review claim is invalid")
    return value


def _source_hash(work):
    projection = {key: work[key] for key in ("id", "kind", "projectPageId", "payload")}
    if work.get("documentExpected") is True:
        projection["documentExpected"] = True
    if work.get("quoteAttachmentVersion") == 1:
        projection["quoteAttachmentVersion"] = 1
    return _hash(projection)


def validate_review_claim(review, worker_id):
    _uuid(worker_id)
    _require(isinstance(review, dict) and set(review) == {
        "version", "id", "claimToken", "requestId", "sourceWork", "previous"}
        and type(review["version"]) is int and review["version"] == REVIEW_VERSION,
        "Review claim is incomplete")
    _uuid(review["id"])
    _uuid(review["requestId"])
    _uuid(review["claimToken"])
    work = review["sourceWork"]
    required = {"id", "kind", "claimToken", "projectPageId", "payload"}
    _require(isinstance(work, dict) and required <= set(work)
             and set(work) <= required | {"documentExpected", "quoteAttachmentVersion"}
             and work["id"] == review["requestId"] and work["kind"] == "request"
             and type(work["projectPageId"]) is int and 0 < work["projectPageId"] <= 9007199254740991,
             "Review source work is invalid")
    _claim(work["claimToken"])
    _require("documentExpected" not in work or type(work["documentExpected"]) is bool,
             "Review source work is invalid")
    payload = work["payload"]
    _require(isinstance(payload, dict) and payload.get("requestId") == review["requestId"]
             and payload.get("projectPageId") == work["projectPageId"], "Review source request is invalid")
    if payload.get("quote") is not None:
        _require(type(work.get("quoteAttachmentVersion")) is int and work["quoteAttachmentVersion"] == 1
                 and work.get("documentExpected") is True, "Review source quote capability changed")
    else:
        _require("quoteAttachmentVersion" not in work, "Review source quote capability changed")
    previous = review["previous"]
    _require(isinstance(previous, dict) and set(previous) == {"state", "message", "outcomeHash"}
             and previous["state"] == "needs_review" and isinstance(previous["message"], str)
             and 0 < len(previous["message"]) <= 500 and previous["message"] == previous["message"].strip()
             and not re.search(r"[\x00-\x1f\x7f]", previous["message"])
             and _sha(previous["outcomeHash"]), "Review source outcome is invalid")
    _canonical(review)  # Reject non-finite or unserializable input before any local write.
    return review


@contextmanager
def _private_directory(path, *, parent=None, create=False):
    try:
        created = False
        if create:
            try:
                os.mkdir(path, mode=0o700, dir_fd=parent)
                created = True
            except FileExistsError:
                pass
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            info = os.fstat(descriptor)
            if created and stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid():
                os.fchmod(descriptor, 0o700)
                info = os.fstat(descriptor)
            if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700:
                raise _EvidenceError("unsafe")
            yield descriptor
        finally:
            os.close(descriptor)
    except FileNotFoundError as error:
        raise _EvidenceError("missing") from error
    except OSError as error:
        raise _EvidenceError("unsafe") from error


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def _read_json(name, directory):
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
                raise _EvidenceError("unsafe")
            raw = stream.read(MAX_JSON_BYTES + 1)
        if len(raw) > MAX_JSON_BYTES:
            raise _EvidenceError("unsafe")
        value = json.loads(raw, object_pairs_hook=_pairs)
        if not isinstance(value, dict):
            raise _EvidenceError("unsafe")
        _canonical(value)
        return value
    except FileNotFoundError as error:
        raise _EvidenceError("missing") from error
    except (OSError, ValueError, TypeError) as error:
        if isinstance(error, _EvidenceError):
            raise
        raise _EvidenceError("unsafe") from error


def _marker_absent(directory, name):
    try:
        os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return
    except OSError as error:
        raise _EvidenceError("unsafe") from error
    raise _EvidenceError("started")


def _inspect(review, worker_id, journal_root, request_root):
    source, previous = review["sourceWork"], review["previous"]
    with _private_directory(journal_root) as journals:
        journal = _read_json("request-" + review["requestId"] + ".json", journals)
    expected_outbound = {"workerId": worker_id, "id": review["requestId"], "kind": "request",
                         "claimToken": source["claimToken"], "state": "needs_review",
                         "message": previous["message"]}
    if not (type(journal.get("version")) is int and journal["version"] == 1
            and journal.get("phase") == "TERMINAL" and journal.get("reported") is True
            and all(journal.get(key) == expected_outbound[key] for key in ("workerId", "id", "kind", "claimToken"))
            and journal.get("workHash") == _source_hash(source)
            and (journal.get("documentExpected") is True) == (source.get("documentExpected") is True)
            and journal.get("quoteAttachmentVersion") == source.get("quoteAttachmentVersion")
            and _canonical(journal.get("outbound")) == _canonical(expected_outbound)):
        raise _EvidenceError("mismatch")
    if "preparedHash" in journal:
        raise _EvidenceError("started")
    with _private_directory(request_root) as requests:
        with _private_directory(review["requestId"], parent=requests) as folder:
            local = _read_json("request.json", folder)
            projection = {key: local.get(key) for key in source["payload"]}
            if not set(source["payload"]) <= set(local) or _canonical(projection) != _canonical(source["payload"]):
                raise _EvidenceError("mismatch")
            for name in MARKERS:
                _marker_absent(folder, name)
    return {"sourceWorkHash": _source_hash(source), "sourceRequestHash": _hash(source["payload"]),
            "sourceJournalHash": _hash(journal), "markersAbsent": True}


def _freeze(path, value):
    # Keep every write anchored to the opened private review directory. A
    # substituted parent symlink must not redirect a frozen assessment.
    with _private_directory(path.parent) as directory:
        temporary = ".review-" + str(uuid.uuid4())
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(_canonical(value))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
            os.fsync(directory)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass


def _review_root(journal_root):
    with _private_directory(journal_root) as parent:
        with _private_directory("reviews", parent=parent, create=True):
            pass
    return Path(journal_root) / "reviews"


def _validate_frozen(journal, worker_id):
    _require(isinstance(journal, dict) and set(journal) == {
        "version", "workerId", "claim", "claimHash", "outbound", "outboundHash", "reported"}
        and type(journal["version"]) is int and journal["version"] == REVIEW_VERSION
        and journal["workerId"] == worker_id and type(journal["reported"]) is bool)
    claim = validate_review_claim(journal["claim"], worker_id)
    outbound = journal["outbound"]
    _require(journal["claimHash"] == _hash(claim) and isinstance(outbound, dict)
             and journal["outboundHash"] == _hash(outbound)
             and set(outbound) == {"version", "workerId", "id", "claimToken", "requestId",
                                  "sourceOutcomeHash", "status", "message", "checkedAt", "evidence"}
             and type(outbound["version"]) is int and outbound["version"] == REVIEW_VERSION
             and outbound["workerId"] == worker_id
             and all(outbound[key] == claim[key] for key in ("id", "claimToken", "requestId"))
             and outbound["sourceOutcomeHash"] == claim["previous"]["outcomeHash"]
             and isinstance(outbound["status"], str) and outbound["status"] in {"retry_ready", "blocked"})
    try:
        checked = datetime.fromisoformat(outbound["checkedAt"].replace("Z", "+00:00"))
        _require(checked.tzinfo is not None and checked.utcoffset().total_seconds() == 0)
    except (AttributeError, ValueError, TypeError) as error:
        raise ReviewError("Stored review timestamp is invalid") from error
    evidence = outbound["evidence"]
    if outbound["status"] == "retry_ready":
        _require(outbound["message"] == READY and isinstance(evidence, dict)
                 and set(evidence) == {"sourceWorkHash", "sourceRequestHash", "sourceJournalHash", "markersAbsent"}
                 and evidence["sourceWorkHash"] == _source_hash(claim["sourceWork"])
                 and evidence["sourceRequestHash"] == _hash(claim["sourceWork"]["payload"])
                 and _sha(evidence["sourceJournalHash"]) and evidence["markersAbsent"] is True)
    else:
        _require(outbound["message"] in BLOCKED.values() and evidence is None)
    return journal


def _deliver(path, journal, config, post):
    _validate_frozen(journal, config["workerId"])
    outbound = journal["outbound"]
    reply = post(REVIEW_RESULT_PATH, outbound, config["token"])
    record = reply.get("review") if isinstance(reply, dict) else None
    _require(isinstance(reply, dict) and reply.get("ok") is True and isinstance(record, dict)
             and all(record.get(key) == outbound[key] for key in ("id", "requestId", "status")),
             "PanelStock has not acknowledged the matching review assessment")
    journal["reported"] = True
    _freeze(path, journal)
    return "review_" + outbound["status"]


def service_pending_reviews(config, journal_root, post):
    """Deliver one frozen assessment before claiming any new work; never inspect."""
    root = _review_root(journal_root)
    with _private_directory(root) as directory:
        for name in sorted(os.listdir(directory)):
            if not name.endswith(".json"):
                continue
            _require(name == _uuid(name[:-5]) + ".json", "Review journal filename is invalid")
            journal = _validate_frozen(_read_json(name, directory), config["workerId"])
            _require(journal["claim"]["id"] == name[:-5], "Review journal identity changed")
            if journal["reported"] is not True:
                return _deliver(root / name, journal, config, post)
    return None


def assess_review(review, config, journal_root, request_root, post, now=None):
    """Freeze a filesystem-only assessment once, then deliver that exact body."""
    validate_review_claim(review, config["workerId"])
    root = _review_root(journal_root)
    path = root / (review["id"] + ".json")
    if path.exists() or path.is_symlink():
        with _private_directory(root) as directory:
            journal = _validate_frozen(_read_json(path.name, directory), config["workerId"])
        _require(journal["claimHash"] == _hash(review), "Claimed review changed; inspect its frozen assessment")
        return _deliver(path, journal, config, post)
    try:
        evidence = _inspect(review, config["workerId"], journal_root, request_root)
        status, message = "retry_ready", READY
    except _EvidenceError as error:
        evidence, status, message = None, "blocked", BLOCKED[error.reason]
    instant = datetime.now(timezone.utc) if now is None else datetime.fromtimestamp(now, timezone.utc)
    outbound = {"version": REVIEW_VERSION, "workerId": config["workerId"], "id": review["id"],
                "claimToken": review["claimToken"], "requestId": review["requestId"],
                "sourceOutcomeHash": review["previous"]["outcomeHash"], "status": status, "message": message,
                "checkedAt": instant.isoformat(timespec="milliseconds").replace("+00:00", "Z"), "evidence": evidence}
    journal = {"version": REVIEW_VERSION, "workerId": config["workerId"], "claim": review,
               "claimHash": _hash(review), "outbound": outbound, "outboundHash": _hash(outbound), "reported": False}
    _validate_frozen(journal, config["workerId"])
    _freeze(path, journal)
    return _deliver(path, journal, config, post)
