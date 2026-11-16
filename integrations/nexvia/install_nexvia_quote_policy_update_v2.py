#!/usr/bin/env python3
"""Update policy responses and callback diagnostics on the installed policy-v1 bridge.

This two-module patch accepts only the exact deployed policy-v1 modules or its
completed update. Both replaced modules already exist; creator, watcher, reviews
and dependencies remain pinned. Installation never retries an existing request,
selects a file, requests an upload policy, uploads, creates a PO or sends email.
"""
import argparse
import ast
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import time
import uuid

BUNDLE_BASE64 = ""
FILES = {"nexvia_quote_attachment.py", "nexvia_preparation_diagnostics.py"}
# Exact deployed policy-v1 bridge. Local edits and mixed releases are never
# accepted, including changes to the retained creator, watcher and reviews.
PRIOR_SHA256 = {
    "nexvia_requests.py": "4af6b0426bec06640e0530354ab8bd384c9ce944e91fba349e2b430c01a83be7",
    "nexvia_reviews.py": "982f4f81085b9d1d985870058b1c8b102f6969524d50041fd78be81d6d664d2b",
    "nexvia_create.py": "98bd170cb83c43fe94094899ee8557605fcd18e533b4b394ca21c017c267d58c",
    "nexvia_allocations.py": "071cb5f796b0cd91bfe1ce67d7c1799ea0066ae8119a78d2d19c715e6a3fefe9",
    "nexvia_projects.py": "10c95c70087170736f6b62e1ace64833837fe337a8252687430e8dc5c85944ee",
    "nexvia_lookups.py": "500cf09a05975ef23d6a1b9a01c7398cd5db890bdf94c9ae6eb65d1430024ac3",
    "nexvia_form_data.py": "97977e1938327ff64d9cb95565fb061b50e1e59023078accc5783fc1ba8b98b2",
    "nexvia_po_document.py": "42fd532a2df6bb10ff585d7f9435b7bafc0d137afbbaf764a65c516083856d53",
    "nexvia_preparation_diagnostics.py": "4f1054d0f0890ee1997fef02e24619da5b95f2a705c175499daed4a52311b37e",
    "nexvia_quote_attachment.py": "5481b8be065ed545b00357b657354d61808e674a73ecb281b29f7e50d1c81868",
    "nexvia_inspect_quote_upload.py": "f3437c0e06b4091ec6da5c3fbce76426eb669b1669d5efd0b81d29ccd96ab4af",
    "nexvia_reconcile_existing_po.py": "acd7291dc9fa996fe8c5ec1d1b5180762caf080e30973785182236acd335c228",
}
PYPDF_SHA256 = "47cca6b24bdcf4c4d65b5f7b8b972535c61710a061261e737688777cfd9a7bfb"
MAX_BUNDLE_BYTES = 2 * 1024 * 1024
MAX_SCRIPT_BYTES = 1024 * 1024
MAX_CONFIG_BYTES = 64 * 1024
BRIDGE_WAIT_SECONDS = 30
NEW_FILES = FILES - set(PRIOR_SHA256)
CACHE_FILES = ("nexvia-projects.json", "nexvia-supplier-directory.json",
               "nexvia-account-tax-lookups.json", "nexvia-form-data.json")
POLICY_CHECK_SOURCE_SHA256 = {
    "nexvia_quote_attachment.py": "7ae35580eaae6bdbea79cb71ce86d33ceebbab7313494d21fcab8ccb9eeed7a5",
    "nexvia_preparation_diagnostics.py": "9a146254aa66f3b33c3ad4780f95e8fa2c61f006772fc403128d02e4f0a2328e",
    "nexvia_inspect_failed_quote_upload.py": "b8fecd4f6171ed203d775d02b1a217ddc1370f05bfcde26f94b51c23b5df6389",
    "bundleSha256": "08213c75b820f22ec75a05fc5fb5a3688dff1109b13c310e8ab4c4aa304c1037",
}
POLICY_MARKERS = ("nexvia-quote-upload-attempt.json", "nexvia-quote-upload.json", "nexvia-prepared.json",
                  "nexvia-create-attempt.json", "nexvia-result.json")
MAX_POLICY_REPORT_BYTES = 256 * 1024


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


@contextlib.contextmanager
def policy_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        check(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700,
              "Saved policy evidence must already be private. Nothing installed.")
        yield descriptor
    finally:
        os.close(descriptor)


def policy_record(directory, name, *, optional=False, maximum=8 * 1024 * 1024):
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    except FileNotFoundError:
        if optional:
            return None, None
        raise QuotePolicyUpdateError("Saved policy evidence is missing. Nothing installed.") from None
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        check(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1,
              "Saved policy evidence must already be private and regular. Nothing installed.")
        raw = stream.read(maximum + 1)
        check(len(raw) <= maximum, "Saved policy evidence exceeds its bound. Nothing installed.")
        after = os.fstat(stream.fileno())
    identity = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_nlink, value.st_size,
                              value.st_mtime_ns, value.st_ctime_ns)
    check(identity(info) == identity(after), "Saved policy evidence changed while reading. Nothing installed.")
    value = json.loads(raw)
    check(isinstance(value, dict), "Saved policy evidence is invalid. Nothing installed.")
    canonical(value)
    return value, (*identity(after), hashlib.sha256(raw).hexdigest())


def policy_originals(root, identifier):
    """Reproduce the diagnostic's JSON evidence fingerprint without opening PDFs."""
    proof, records = {}, {}
    with policy_directory(root / "nexvia-requests"), policy_directory(root / "nexvia-requests" / identifier) as directory:
        for name in ("request.json", *POLICY_MARKERS, "nexvia-preparation-diagnostic.json"):
            value, proof[name] = policy_record(directory, name, optional=name != "request.json")
            if value is not None:
                records[name] = value
    with policy_directory(root / "panelstock-request-journal") as directory:
        records["mainJournal"], proof["mainJournal"] = policy_record(directory, "request-" + identifier + ".json")
    return proof, records


def observed_policy_evidence(root, identifier):
    """Require the exact saved two-header diagnosis; this never requests a policy."""
    try:
        root = Path(root)
        proof, records = policy_originals(root, identifier)
        check(set(POLICY_MARKERS) & set(records) == {POLICY_MARKERS[0]}, "Saved policy evidence is no longer attempt-only. Nothing installed.")
        request, attempt, journal = records["request.json"], records[POLICY_MARKERS[0]], records["mainJournal"]
        check(request.get("requestId") == identifier and request.get("quote") is not None,
              "Saved policy evidence has a different request. Nothing installed.")
        reports, identities = [], []
        for folder, version in (("nexvia-policy-checks", 1), ("nexvia-policy-checks-v2", 2)):
            with policy_directory(root / folder) as directory:
                value, identity = policy_record(directory, identifier + ".json", maximum=MAX_POLICY_REPORT_BYTES)
            check(value.get("recordHash") == digest({key: item for key, item in value.items() if key != "recordHash"})
                  and value.get("format") == "nexvia-quote-policy-check"
                  and type(value.get("version")) is int and value["version"] == version
                  and value.get("requestId") == identifier and value.get("requestHash") == digest(request)
                  and value.get("attemptHash") == digest(attempt) and value.get("mainJournalHash") == digest(journal)
                  and value.get("sourceHashes") == POLICY_CHECK_SOURCE_SHA256
                  and value.get("originalsUnchanged") is True
                  and value.get("evidenceBeforeHash") == value.get("evidenceAfterHash") == digest(proof)
                  and value.get("stage") == "policy_validation" and value.get("status") == "blocked"
                  and value.get("code") == "quote_policy_conditions" and value.get("httpStatus") == 200
                  and value.get("policyRequestInvoked") is True
                  and all(type(value.get(key)) is int and value[key] == 0 for key in ("fileUploads", "poSubmissions", "emails")),
                  "Saved policy diagnosis does not match this request. Nothing installed.")
            reports.append(value)
            identities.append(identity)
        first, second = reports
        check(second.get("priorPolicyCheckHash") == digest(first)
              and second.get("priorPolicyCheckIdentity") == digest(identities[0]),
              "Saved policy diagnoses are not linked. Nothing installed.")
        shape = second.get("shape") or {}
        candidates = shape.get("candidates")
        check(shape.get("json") == "object" and shape.get("candidateCount") == shape.get("completeCandidates") == 1
              and shape.get("truncated") is False and isinstance(candidates, list) and len(candidates) == 1,
              "Saved policy diagnosis has a different policy shape. Nothing installed.")
        candidate = candidates[0]
        checks = candidate.get("checks") or {}
        check(candidate.get("path") == ["root"] and candidate.get("complete") is True
              and candidate.get("mandatoryMissing") == [] and candidate.get("mandatoryNonString") == []
              and all(checks.get(key) is True for key in ("algorithmSupported", "dateFormat", "credentialFormat", "dateMatches",
                  "signatureHex", "signatureLengthAllowed", "keySafe", "expiryValid", "expiryFuture"))
              and all(value is None or value is True for value in checks.values()),
              "Saved policy metadata checks differ. Nothing installed.")
        conditions = candidate.get("conditions")
        check(isinstance(conditions, list) and 0 < len(conditions) <= 100,
              "Saved policy conditions are unavailable. Nothing installed.")
        aliases = []
        for condition in conditions:
            check(isinstance(condition, dict), "Saved policy conditions are invalid. Nothing installed.")
            matches = condition.get("protectedMatches")
            check(matches is None or matches is True or isinstance(matches, dict) and all(item is True for item in matches.values()),
                  "Saved protected policy checks differ. Nothing installed.")
            if condition.get("field") == "[other]":
                aliases.append(condition)
        expected = {"Content-Disposition": "content-disposition", "Content-Type": "content-type"}
        check(len(aliases) == 2 and {row.get("canonicalKnownField") for row in aliases} == set(expected),
              "Saved policy header diagnosis differs. Nothing installed.")
        for row in aliases:
            lower = expected[row["canonicalKnownField"]]
            check(row.get("op") == "starts-with" and row.get("valueType") == row.get("fieldType") == "string"
                  and row.get("emptyPrefix") is True and row.get("dollarPrefix") is True
                  and row.get("safeASCIIFieldName") is True and row.get("sourceAppendedExact") is False
                  and row.get("sourceAppendedCaseFold") is True and row.get("nameLength") == len(lower)
                  and row.get("nameSha256") == hashlib.sha256(lower.encode()).hexdigest(),
                  "Saved policy header predicates differ. Nothing installed.")
        return {"originals": digest(proof), "reports": [digest(value) for value in reports],
                "identities": [digest(value) for value in identities]}
    except QuotePolicyUpdateError:
        raise
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise QuotePolicyUpdateError("Saved policy evidence is unavailable or invalid. Nothing installed.") from None

class QuotePolicyUpdateError(Exception):
    """Fixed messages only; private native output is never printed."""

class RollbackError(QuotePolicyUpdateError):
    pass

def check(condition, message):
    if not condition:
        raise QuotePolicyUpdateError(message)


def regular(path, message):
    try:
        mode = path.lstat().st_mode
    except OSError:
        raise QuotePolicyUpdateError(message) from None
    check(stat.S_ISREG(mode), message)


def private_read(path, maximum, message):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            check(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, message)
            data = stream.read(maximum + 1)
        check(len(data) <= maximum, message)
        return data
    except OSError:
        raise QuotePolicyUpdateError(message) from None


@contextlib.contextmanager
def lock_file(path, message, wait_seconds=0):
    check(not path.is_symlink(), "Unexpected lock file type. Nothing installed.")
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        check(stat.S_ISREG(os.fstat(descriptor).st_mode), "Unexpected lock file type.")
        os.fchmod(descriptor, 0o600)
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise QuotePolicyUpdateError(message) from None
                time.sleep(0.1)
        yield descriptor
    finally:
        os.close(descriptor)


def atomic_write(path, data, mode):
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-quote-policy-v2-", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_add(path, data, mode, owned):
    """Publish a complete new module without replacing an existing path."""
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-quote-policy-v2-new-", dir=path.parent)
    retained = None
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            info = os.fstat(stream.fileno())
            # Retain the published inode until installation and any restoration
            # finish. An unlinked inode must not be reused as ownership proof.
            retained = os.dup(stream.fileno())
            os.link(temporary, path, follow_symlinks=False)
            owned[path.name] = (info.st_dev, info.st_ino, retained)
            retained = None
        os.unlink(temporary)
        sync_directory(path.parent)
    finally:
        if retained is not None:
            os.close(retained)
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def added_module_ownership():
    owned = {}
    try:
        yield owned
    finally:
        for _, _, descriptor in owned.values():
            os.close(descriptor)


def check_added_module(path, data, ownership):
    device, inode, descriptor = ownership
    retained = os.fstat(descriptor)
    current = path.lstat()
    check((retained.st_dev, retained.st_ino) == (device, inode)
          and (current.st_dev, current.st_ino) == (device, inode)
          and source_read(path, "Module restoration needs review.")[0] == data,
          "A newly installed module changed during the quote policy update.")


def backup_items(originals, config_raw):
    items = {"panelstock-requests.json": config_raw}
    for name in sorted(FILES):
        original = originals[name]
        if original is None:
            items[name + ".absent"] = ("Absent before quote policy update: " + name + "\n").encode("ascii")
        else:
            items[name] = original[0]
    return items


def backup_once(path, data):
    if path.exists() or path.is_symlink():
        check(private_read(path, MAX_BUNDLE_BYTES, "Unexpected existing update backup.") == data,
              "A different quote-policy-v2-update backup exists. Nothing installed.")
        return
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                         | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            # Synology may not retain the mode requested at creation time.
            os.fchmod(stream.fileno(), 0o600)
            check(stat.S_IMODE(os.fstat(stream.fileno()).st_mode) == 0o600,
                  "The new update backup could not be made private.")
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise


def process_identity(proc, pid):
    directory = proc / str(pid)
    try:
        args = tuple(part.decode('utf-8', errors='replace')
                     for part in (directory / 'cmdline').read_bytes().split(b'\0') if part)
        # The command name can itself contain spaces or parentheses.
        start = (directory / 'stat').read_text().rsplit(')', 1)[1].split()[19]
    except (FileNotFoundError, ProcessLookupError):
        return None
    except (OSError, IndexError):
        raise QuotePolicyUpdateError('Process state could not be checked. Nothing installed.') from None
    return (int(pid), start, args)


def bridge_processes(root, proc):
    python = root / 'nexvia-tools/bin/python'
    allowed_python = {str(python), str(python.resolve())}
    target = str(root / 'nexvia_requests.py')
    watchers = []
    for directory in proc.iterdir():
        if not directory.name.isdigit():
            continue
        identity = process_identity(proc, directory.name)
        if not identity:
            continue
        args = identity[2]
        if not args or not (args[0] in allowed_python or re.fullmatch(r'python(?:[0-9]+(?:\.[0-9]+)*)?', Path(args[0]).name)):
            continue
        check(not any(Path(arg).name == 'nexvia_create.py' for arg in args[1:]),
              'A PO creation process is active. Let it finish, then run this installer again.')
        if target not in args[1:]:
            continue
        supported = args[1:] in ((target, '--watch'), ('-u', target, '--watch'))
        check(supported, 'A bridge uses nonstandard options. Stop it safely before installing.')
        watchers.append(identity)
    check(len(watchers) <= 1, 'More than one bridge watcher is running. Nothing installed.')
    return watchers


def stop_idle_watcher(root, proc, identity):
    current = process_identity(proc, identity[0])
    if current is None:
        return
    check(current == identity, 'The bridge process changed. Nothing installed; run this installer again.')
    # The caller holds the bridge's own work lock, so no creation/report pass can be active.
    try:
        os.kill(identity[0], signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        current = process_identity(proc, identity[0])
        if current is None or current != identity:
            return
        time.sleep(0.1)
    raise QuotePolicyUpdateError('The idle watcher did not stop. Nothing installed.')


def launch_watcher(root, proc, python, flock):
    if bridge_processes(root, proc):
        return
    log_path = root / 'panelstock-requests.log'
    check(not log_path.is_symlink(), 'Unexpected bridge log type. The updated script is installed; restart its scheduled task.')
    descriptor = os.open(log_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT
                         | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'ab') as stream:
            subprocess.Popen([str(flock), '-n', str(root / 'panelstock-requests-watch.lock'),
                              str(python), '-u', str(root / 'nexvia_requests.py'), '--watch'],
                             stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT,
                             close_fds=True, start_new_session=True, umask=0o077)
    except OSError:
        raise QuotePolicyUpdateError('The script is installed but the watcher could not start. Run its scheduled task.') from None
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if bridge_processes(root, proc):
            return
        time.sleep(0.1)
    raise QuotePolicyUpdateError('The script is installed; check or run the existing bridge scheduled task.')


def source_read(path, message):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            check(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, message)
            data = stream.read(MAX_SCRIPT_BYTES + 1)
        check(len(data) <= MAX_SCRIPT_BYTES, message)
        return data, stat.S_IMODE(info.st_mode)
    except OSError:
        raise QuotePolicyUpdateError(message) from None


def read_config(path):
    raw = private_read(path, MAX_CONFIG_BYTES, "The private bridge configuration is unavailable or invalid.")
    try:
        config = json.loads(raw)
        check(isinstance(config, dict)
              and all(type(config.get(key)) is bool for key in ("enabled", "creationEnabled"))
              and all(key not in config or type(config[key]) is bool
                      for key in ("documentEnabled", "quoteEnabled")),
              "The private bridge configuration is invalid.")
        return raw, config
    except (ValueError, TypeError):
        raise QuotePolicyUpdateError("The private bridge configuration is invalid.") from None


def private_directory(path):
    check(not path.is_symlink(), "Unexpected quote-policy-v2-update backup directory.")
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    except OSError:
        raise QuotePolicyUpdateError("The private quote-policy-v2-update backup could not be created.") from None
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        check(stat.S_ISDIR(info.st_mode) and (info.st_uid == os.geteuid() or os.geteuid() == 0),
              "Unexpected quote-policy-v2-update backup ownership.")
        os.fchmod(descriptor, 0o700)
        check(stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o700,
              "The quote-policy-v2-update backup could not be made private.")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def decoded_payload():
    try:
        check(isinstance(BUNDLE_BASE64, str) and bool(BUNDLE_BASE64)
              and len(BUNDLE_BASE64) <= MAX_BUNDLE_BYTES * 2,
              "This source template has no release bundle. Nothing installed.")
        raw = base64.b64decode(BUNDLE_BASE64, validate=True)
        check(len(raw) <= MAX_BUNDLE_BYTES, "Installer bundle exceeds its size limit.")
        bundle = json.loads(raw)
        check(isinstance(bundle, dict) and set(bundle) == FILES,
              "Installer bundle has unexpected files. Nothing installed.")
        files = {}
        for name, entry in bundle.items():
            check(isinstance(entry, dict) and set(entry) == {"sha256", "contentBase64"}
                  and isinstance(entry["sha256"], str)
                  and re.fullmatch(r"[a-f0-9]{64}", entry["sha256"]),
                  "Installer manifest is invalid. Nothing installed.")
            data = base64.b64decode(entry["contentBase64"], validate=True)
            check(0 < len(data) <= MAX_SCRIPT_BYTES
                  and hashlib.sha256(data).hexdigest() == entry["sha256"],
                  "Installer checksum mismatch. Nothing installed.")
            compile(data, name, "exec")
            if name == "nexvia_quote_attachment.py":
                check_policy_source(data)
            files[name] = data
        return files
    except QuotePolicyUpdateError:
        raise
    except (ValueError, TypeError, KeyError, SyntaxError):
        raise QuotePolicyUpdateError("Installer content is invalid. Nothing installed.") from None


def check_policy_source(data):
    """Refuse placeholder callback pins before packaging or touching the NAS."""
    required = {"POLICY_SEND_SHA256", "POLICY_OPERATION_SHA256"}
    assignments = {name: [] for name in required}
    for node in ast.parse(data).body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in required:
                    value = node.value.value if isinstance(node.value, ast.Constant) else None
                    assignments[target.id].append(value)
    check(all(len(values) == 1 and type(values[0]) is str
              and re.fullmatch(r"[a-f0-9]{64}", values[0])
              for values in assignments.values()),
          "Native quote policy callback pins are unavailable or invalid. Nothing installed.")


PREFLIGHT = r"""
import base64
from datetime import datetime, timedelta, timezone
import importlib
import inspect
import json
import os
from pathlib import Path
import re
import stat
import sys
sys.dont_write_bytecode = True
root = Path(sys.argv[1])
fd = int(sys.argv[2])
info = os.fstat(fd)
assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
lock = (root / 'panelstock-request-journal/.bridge.lock').stat()
assert (info.st_dev, info.st_ino) == (lock.st_dev, lock.st_ino)
sys.path.insert(0, str(root))
modules = {name: importlib.import_module(name) for name in (
    'nexvia_requests', 'nexvia_form_data', 'nexvia_projects', 'nexvia_create',
    'nexvia_allocations', 'nexvia_lookups', 'nexvia_po_document',
    'nexvia_quote_attachment', 'nexvia_reconcile_existing_po', 'nexvia_reviews',
    'nexvia_preparation_diagnostics')}
assert modules['nexvia_requests'].SNAPSHOT_REFRESH_SECONDS == 24 * 60 * 60
assert modules['nexvia_requests'].REFERENCE_CACHE_VERSION == 1
assert modules['nexvia_requests'].WATCH_IDLE_SECONDS == 2
assert modules['nexvia_requests'].REVIEW_VERSION == 1
assert modules['nexvia_requests'].REVIEW_RESULT_PATH == '/integrations/nexvia/request-review-result'
assert modules['nexvia_reviews'].REVIEW_VERSION == 1
assert callable(modules['nexvia_reviews'].assess_review)
assert callable(modules['nexvia_reviews'].service_pending_reviews)
inspect.signature(modules['nexvia_reviews'].assess_review).bind({}, {}, root, root, None, now=None)
inspect.signature(modules['nexvia_reviews'].service_pending_reviews).bind({}, root, None)
assert modules['nexvia_form_data'].MAX_SNAPSHOT_AGE == 30 * 24 * 60 * 60
assert modules['nexvia_projects'].REFRESH_SECONDS == 24 * 60 * 60
assert modules['nexvia_projects'].RETRY_SECONDS == 15 * 60
quote = modules['nexvia_quote_attachment']
assert quote.BLANK_DRAFT_GUARD_VERSION == 5
assert quote.POLICY_UPLOAD_GUARD_VERSION == 1
for name in ('POLICY_SEND_SHA256', 'POLICY_OPERATION_SHA256'):
    value = getattr(quote, name)
    assert type(value) is str and re.fullmatch(r'[a-f0-9]{64}', value)
for name in ('upload_quote', 'validate_native_draft'):
    signature = inspect.signature(getattr(quote, name))
    parameter = signature.parameters['native_snapshot']
    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY and parameter.default is None
assert callable(modules['nexvia_create'].prepare)
assert callable(modules['nexvia_create'].submit)
inspect.signature(modules['nexvia_create'].prepare).bind(None, {}, root, config_root=root)
inspect.signature(modules['nexvia_create'].submit).bind(None, {}, {}, root, '')
inspect.signature(modules['nexvia_requests'].invoke_preparer).bind('')
diagnostics = modules['nexvia_preparation_diagnostics']
assert diagnostics.DIAGNOSTICS_VERSION == 1
assert callable(diagnostics.bind_callback)
inspect.signature(diagnostics.bind_callback).bind(lambda: None)
for name, args, kwargs in (
    ('preparation_diagnostics', (root, {}), {}),
    ('stage', ('start',), {}),
    ('failure', ('preparation_failed',), {}),
    ('transport', (), {'policyRequests': 0}),
    ('route_event', ('native_policy', 'GET'), {'status': None, 'denied': False}),
    ('failure_message', (root, {}, 0), {'now': None}),
):
    function = getattr(diagnostics, name)
    assert callable(function)
    inspect.signature(function).bind(*args, **kwargs)
# This synthetic response exercises the observed header spelling with the
# installed replacement module. It never opens a browser or contacts storage.
now = datetime.now(timezone.utc)
stamp = now.strftime('%Y%m%dT%H%M%SZ')
credential = 'preflight@example.invalid/' + stamp[:8] + '/auto/storage/goog4_request'
conditions = [
    {'bucket': 'policy-preflight'}, {'key': 'diagnostic/no-upload.pdf'},
    {'x-goog-algorithm': 'GOOG4-RSA-SHA256'}, {'x-goog-credential': credential}, {'x-goog-date': stamp},
    ['starts-with', '$acl', ''], ['starts-with', '$content-disposition', ''],
    ['starts-with', '$content-type', ''],
]
policy = base64.b64encode(json.dumps({'expiration': (now + timedelta(minutes=10)).isoformat(),
                                     'conditions': conditions}).encode()).decode()
response = {'key': 'diagnostic/no-upload.pdf', 'policy': policy,
            'x-goog-algorithm': 'GOOG4-RSA-SHA256', 'x-goog-credential': credential,
            'x-goog-date': stamp, 'x-goog-signature': 'a' * 512}
allowed = set(response) | {'Content-Type', 'Content-Disposition', 'acl', 'file'}
verified = quote.validate_policy_response(json.dumps(response).encode(),
    'https://policy-preflight.storage.googleapis.com/',
    {'filename': 'no-upload.pdf', 'bytes': 100, 'sha256': 'b' * 64}, 'private', allowed)
assert len(verified) == 1 and verified[0]['pdf'] is True
assert verified[0]['fields']['policy'] == policy and verified[0]['conditions'] == conditions
print(json.dumps({'format': 'nexvia-quote-policy-v2-contract-check', 'version': 2,
                  'contractsVerified': True, 'syntheticPolicyVerified': True, 'readOnly': True,
                  'poCreated': False, 'poChanged': False, 'fileUploaded': False,
                  'emailSent': False}))
"""


NATIVE_PREFLIGHT = r"""
import base64
from contextlib import ExitStack
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import types
from unittest.mock import patch
from urllib.parse import urlsplit

def blocked(*args, **kwargs):
    raise RuntimeError('Read-only native compatibility check')

def route_decision(request, quote):
    try:
        target = urlsplit(request.url)
        if target.scheme not in {'http', 'https'} or not target.hostname:
            return False, False
        policy = quote.policy_path(request.url)
        registration = target.hostname == 'lennox.nexvia.com.au' and bool(
            re.match(r'^/staff/upload/details(?:/|$)', target.path))
        storage = target.hostname == 'storage.googleapis.com' or target.hostname.endswith('.storage.googleapis.com')
        upload = bool(re.search(r'/upload(?:/|$)', target.path, re.I))
        resource = getattr(request, 'resource_type', 'other')
        static = resource in {'script', 'stylesheet', 'image', 'font', 'media'} and bool(
            re.search(r'\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp[34]|webm)$', target.path, re.I))
        if policy or registration:
            return False, True
        if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            return False, (storage or upload) and resource in {'xhr', 'fetch'}
        if static:
            return True, False
        if storage or upload:
            return False, True
        return True, False
    except (ValueError, TypeError, AttributeError):
        return False, False

def guarded_route(original, checkpoint, quote):
    def register(page, target, handler, **kwargs):
        def guarded(route):
            allowed, relevant = route_decision(route.request, quote)
            if not allowed:
                checkpoint['denied'] = checkpoint['denied'] or relevant
                return route.abort()
            return handler(route)
        return original(page, target, guarded, **kwargs)
    return register

def inspect_native(context, request, creator, quote, checkpoint):
    # Independent tripwires stay active before the new form is opened.
    with ExitStack() as guards:
        for module, names in (
            (creator, ('prepare', 'submit', 'save') + (('upload_quote',) if hasattr(creator, 'upload_quote') else ())),
            (quote, ('upload_quote', 'begin_upload', 'complete_upload', 'source_upload_payload')),
        ):
            for name in names:
                guards.enter_context(patch.object(module, name, blocked))
        checkpoint['stage'] = 'open_draft'
        attachment = creator.quote_attachment_descriptor(request, request['quote'])
        with creator.native_line_editor(context, request, quote_attachment=attachment) as editor:
            checkpoint['stage'] = 'native_guard'
            state = editor['page'].evaluate(quote.NATIVE_STATE_JS,
                {'filename': attachment['filename'], 'bytes': attachment['bytes']})
            quote.validate_native_draft(state, request, editor['createPath'], native_snapshot=editor)
            checkpoint['stage'] = 'source_normalizer'
            quote.fresh_policy_filename(editor['page'], state, attachment)
            checkpoint['stage'] = 'upload_fields'
            source = state['widgets'][0]['sendSource']
            quote.policy_acl(source)
            quote.policy_append_fields(source)
        if checkpoint['denied']:
            raise RuntimeError('Native compatibility traffic was blocked')
    checkpoint.update(stage='verified', passed=True)

def main():
    checkpoint = {'stage': 'open_draft', 'passed': False, 'denied': False}
    report = {'format': 'nexvia-native-policy-compatibility', 'version': 1,
              'requestId': '', 'requestFileSha256': '', 'sourceSha256': {},
              'readOnly': True, 'fileSelected': False, 'policyRequested': False,
              'fileUploaded': False, 'poCreated': False, 'poChanged': False, 'emailSent': False}
    try:
        payload = json.loads(sys.stdin.buffer.read(2097153))
        root = Path(sys.argv[1])
        lock_fd = int(sys.argv[2])
        info = os.fstat(lock_fd)
        lock = (root / 'panelstock-request-journal/.bridge.lock').stat()
        assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
        assert (info.st_dev, info.st_ino) == (lock.st_dev, lock.st_ino)
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(root))
        for name in ('nexvia_preparation_diagnostics', 'nexvia_quote_attachment'):
            source = base64.b64decode(payload['sources'][name], validate=True)
            module = types.ModuleType(name)
            module.__file__ = str(root / (name + '.py'))
            sys.modules[name] = module
            exec(compile(source, module.__file__, 'exec'), module.__dict__)
            report['sourceSha256'][name] = hashlib.sha256(source).hexdigest()
        quote = sys.modules['nexvia_quote_attachment']
        assert quote.BLANK_DRAFT_GUARD_VERSION == 5 and quote.POLICY_UPLOAD_GUARD_VERSION == 1
        for name in ('POLICY_SEND_SHA256', 'POLICY_OPERATION_SHA256'):
            assert type(getattr(quote, name)) is str and re.fullmatch(r'[a-f0-9]{64}', getattr(quote, name))
        assert sys.modules['nexvia_preparation_diagnostics'].DIAGNOSTICS_VERSION == 1
        identifier = payload['requestId']
        folder = root / 'nexvia-requests' / identifier
        with quote.private_folder(folder) as directory:
            descriptor = os.open('request.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
            with os.fdopen(descriptor, 'rb') as stream:
                info = os.fstat(stream.fileno())
                assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                assert info.st_nlink == 1 and info.st_size <= 8388608
                raw = stream.read(8388609)
            assert len(raw) <= 8388608
        report.update(requestId=identifier, requestFileSha256=hashlib.sha256(raw).hexdigest())
        assert report['requestFileSha256'] == payload['requestFileSha256']
        request = json.loads(raw)
        assert request['requestId'] == identifier and request.get('quote') is not None
        creator = importlib.import_module('nexvia_create')
        from playwright.sync_api import sync_playwright, Page, Locator, FileChooser
        with ExitStack() as guards:
            guards.enter_context(patch.object(Page, 'route', guarded_route(Page.route, checkpoint, quote)))
            for owner, name in ((Page, 'set_input_files'), (Locator, 'set_input_files'), (FileChooser, 'set_files')):
                guards.enter_context(patch.object(owner, name, blocked))
            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:9222', timeout=15000)
                signed_in = next((context for context in browser.contexts if any(
                    page.url.startswith(creator.BASE + '/staff/') and '/login' not in page.url
                    for page in context.pages)), None)
                assert signed_in is not None
                with creator.quote_browser_context(browser, signed_in) as owned:
                    inspect_native(owned, request, creator, quote, checkpoint)
    except Exception:
        checkpoint['passed'] = False
    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])
    print(json.dumps(report, separators=(',', ':')))

if __name__ == '__main__':
    main()
"""


def _native_policy_preflight(root, python, files, request_id, *, bridge_lock_fd):
    """Check source/filename compatibility only; never replay an upload."""
    folder = root / "nexvia-requests" / request_id
    check(folder.is_dir() and not folder.is_symlink()
          and stat.S_IMODE(folder.stat().st_mode) == 0o700,
          "The saved request folder is unavailable or unsafe. Nothing installed.")
    raw = private_read(folder / "request.json", 8 * 1024 * 1024,
                       "The private saved request is unavailable or unsafe. Nothing installed.")
    request = json.loads(raw)
    check(isinstance(request, dict) and request.get("requestId") == request_id
          and request.get("quote") is not None,
          "The saved quoted request identity does not match. Nothing installed.")
    sources = {name: files[name + ".py"]
               for name in ("nexvia_preparation_diagnostics", "nexvia_quote_attachment")}
    request_hash = hashlib.sha256(raw).hexdigest()
    payload = {"requestId": request_id, "requestFileSha256": request_hash,
               "sources": {name: base64.b64encode(source).decode("ascii")
                           for name, source in sources.items()}}
    try:
        result = subprocess.run(
            [str(python), "-I", "-B", "-c", NATIVE_PREFLIGHT, str(root), str(bridge_lock_fd)],
            input=json.dumps(payload, separators=(",", ":")).encode("ascii"),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            pass_fds=(bridge_lock_fd,), timeout=120, check=False)
        check(result.returncode == 0 and len(result.stdout) <= 4096,
              "Native uploader compatibility check stopped. Nothing installed.")
        value = json.loads(result.stdout)
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        raise QuotePolicyUpdateError("Native uploader compatibility check stopped. Nothing installed.") from None
    expected = {"format": "nexvia-native-policy-compatibility", "version": 1,
                "requestId": request_id, "requestFileSha256": request_hash,
                "sourceSha256": {name: hashlib.sha256(source).hexdigest() for name, source in sources.items()},
                "passed": True, "stage": "verified", "readOnly": True, "fileSelected": False,
                "policyRequested": False, "fileUploaded": False, "poCreated": False,
                "poChanged": False, "emailSent": False}
    if value != expected:
        stage = value.get("stage") if isinstance(value, dict) else None
        if stage in {"open_draft", "native_guard", "source_normalizer", "upload_fields"}:
            raise QuotePolicyUpdateError("Native uploader compatibility check failed at " + stage
                                         + ". Nothing installed.")
        raise QuotePolicyUpdateError("Native uploader compatibility check stopped. Nothing installed.")
    return True


def native_policy_preflight(root, python, files, request_id, *, bridge_lock_fd):
    """Bind the saved diagnosis around the source-only native compatibility check."""
    evidence = observed_policy_evidence(root, request_id)
    try:
        return _native_policy_preflight(root, python, files, request_id, bridge_lock_fd=bridge_lock_fd)
    finally:
        check(observed_policy_evidence(root, request_id) == evidence,
              "Saved policy evidence changed during the read-only native check. Nothing installed.")


def preflight(root, python, *, bridge_lock_fd):
    """Import reviewed modules only; do not open Nexvia or run a bridge pass."""
    try:
        result = subprocess.run(
            [str(python), "-I", "-B", "-c", PREFLIGHT, str(root), str(bridge_lock_fd)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            pass_fds=(bridge_lock_fd,), timeout=30, check=False)
        if result.returncode != 0 or len(result.stdout) > 4096:
            return False
        value = json.loads(result.stdout)
        return value == {"format": "nexvia-quote-policy-v2-contract-check", "version": 2,
                         "contractsVerified": True, "syntheticPolicyVerified": True, "readOnly": True,
                         "poCreated": False, "poChanged": False, "fileUploaded": False,
                         "emailSent": False}
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return False


def check_parser(root):
    raw = private_read(root / "nexvia-po-vendor/pypdf.whl", MAX_SCRIPT_BYTES,
                       "The installed PDF parser is unavailable or unsafe.")
    check(hashlib.sha256(raw).hexdigest() == PYPDF_SHA256,
          "The installed PDF parser is a different version. Nothing installed.")


def snapshot(root):
    current = {}
    for name in sorted(set(PRIOR_SHA256) | FILES):
        path = root / name
        current[name] = (source_read(path, "An installed module is unavailable or unsafe.")
                         if path.exists() or path.is_symlink() else None)
    return current


def expected_release(files, originals):
    expected = dict(originals)
    for name, data in files.items():
        expected[name] = (data, originals[name][1] if originals[name] is not None else 0o644)
    return expected


def check_snapshot(root, expected):
    check(snapshot(root) == expected, "Installed modules changed during the quote policy update.")
    check_parser(root)


def protected_state(root):
    """Fingerprint every local request/journal entry without reading PDF bytes.

    The work lock prevents bridge mutations. Device/inode, mode, size and both
    nanosecond timestamps detect concurrent rewrites, additions and removals.
    Import preflight is read-only and may not change these trees at all.
    """
    result = {}
    for name in CACHE_FILES:
        path = root / name
        if not path.exists() and not path.is_symlink():
            result[name] = None
            continue
        info = path.lstat()
        check(stat.S_ISREG(info.st_mode), "A saved reference cache is unavailable or unsafe.")
        result[name] = (info.st_dev, info.st_ino, info.st_mode, info.st_size,
                        info.st_mtime_ns, info.st_ctime_ns)
    for name in ("nexvia-requests", "panelstock-request-journal", "nexvia-policy-checks", "nexvia-policy-checks-v2"):
        base = root / name
        if not base.exists() and not base.is_symlink():
            result[name] = None
            continue
        pending = [base]
        while pending:
            path = pending.pop()
            info = path.lstat()
            check(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode),
                  "A request or journal entry is unavailable or unsafe.")
            result[str(path.relative_to(root))] = (info.st_dev, info.st_ino, info.st_mode,
                                                   info.st_size, info.st_mtime_ns,
                                                   info.st_ctime_ns)
            check(len(result) <= 100000, "The local request history exceeds the update inspection limit.")
            if stat.S_ISDIR(info.st_mode):
                pending.extend(path.iterdir())
    return result


def install(root=Path("/config"), proc=Path("/proc"), *, launch=None, checker=None,
            check_request=None, native_checker=None):
    with added_module_ownership() as added:
        return _install(root, proc, launch=launch, checker=checker, added=added,
                        check_request=check_request, native_checker=native_checker)


def _install(root, proc, *, launch, checker, added, check_request, native_checker):
    root, proc = Path(root), Path(proc)
    check(root.is_dir() and not root.is_symlink(), "The configuration directory is unavailable or unsafe.")
    if check_request is not None:
        try:
            valid_request = type(check_request) is str and str(uuid.UUID(check_request)) == check_request
        except (ValueError, TypeError, AttributeError):
            valid_request = False
        check(valid_request, "Use the exact saved request UUID. Nothing installed.")
    files = decoded_payload()
    originals = snapshot(root)
    prior_release = all(originals[name] is not None
                        and hashlib.sha256(originals[name][0]).hexdigest() == checksum
                        for name, checksum in PRIOR_SHA256.items()) and all(originals[name] is None for name in NEW_FILES)
    patched_release = (all(originals[name] is not None and originals[name][0] == data
                           for name, data in files.items())
                       and all(originals[name] is not None
                               and hashlib.sha256(originals[name][0]).hexdigest() == checksum
                               for name, checksum in PRIOR_SHA256.items() if name not in FILES))
    check(prior_release or patched_release,
          "The installed modules have local changes or a different version. Nothing installed.")
    check_parser(root)
    config_path = root / "panelstock-requests.json"
    config_raw, _ = read_config(config_path)
    python, flock = root / "nexvia-tools/bin/python", Path("/usr/bin/flock")
    check(os.access(python, os.X_OK) and os.access(flock, os.X_OK),
          "The existing Python or flock command is unavailable. Nothing installed.")
    journal = root / "panelstock-request-journal"
    check(journal.is_dir() and not journal.is_symlink(), "The bridge journal is unavailable or unsafe.")
    backup = root / "nexvia-backup-before-quote-policy-v2-update"
    backups = backup_items(originals, config_raw)
    check(not backup.is_symlink(), "Unexpected quote-policy-v2-update backup directory.")
    if prior_release and backup.exists():
        check(backup.is_dir(), "Unexpected quote-policy-v2-update backup directory.")
        for name, expected_backup in backups.items():
            path = backup / name
            if path.exists() or path.is_symlink():
                check(private_read(path, MAX_SCRIPT_BYTES, "Unexpected quote policy backup.") == expected_backup,
                      "A different quote-policy-v2-update backup exists. Nothing installed.")
    launch = launch_watcher if launch is None else launch
    checker = preflight if checker is None else checker
    native_checker = native_policy_preflight if native_checker is None else native_checker
    expected = expected_release(files, originals)
    stopped, was_running, changed, failure, verified = False, False, [], None, False
    try:
        with lock_file(journal / ".bridge.lock",
                       "The bridge is handling work. Let it finish, then run this installer again.",
                       wait_seconds=BRIDGE_WAIT_SECONDS) as bridge_lock_fd:
            if check_request is not None:
                check_snapshot(root, originals)
                check(read_config(config_path)[0] == config_raw, "Bridge configuration changed during installation.")
                policy_evidence = observed_policy_evidence(root, check_request)
                evidence = protected_state(root)
                try:
                    check(native_checker(root, python, files, check_request, bridge_lock_fd=bridge_lock_fd) is True,
                          "Native uploader compatibility check stopped. Nothing installed.")
                finally:
                    check(observed_policy_evidence(root, check_request) == policy_evidence,
                          "Saved policy evidence changed during the read-only native compatibility check. Nothing installed.")
                    check_snapshot(root, originals)
                    check(read_config(config_path)[0] == config_raw,
                          "Bridge configuration changed during the read-only native compatibility check. Nothing installed.")
                    check(protected_state(root) == evidence,
                          "Existing request evidence changed during the read-only native compatibility check. Nothing installed.")
            watchers = bridge_processes(root, proc)
            was_running = bool(watchers)
            if watchers:
                stop_idle_watcher(root, proc, watchers[0])
                stopped = True
            with lock_file(root / "panelstock-requests-watch.lock",
                           "A watcher restarted during the update. Nothing installed; run this installer again.", 3):
                check(not bridge_processes(root, proc), "A watcher restarted during the update. Nothing installed.")
                check_snapshot(root, originals)
                check(read_config(config_path)[0] == config_raw, "Bridge configuration changed during installation.")
                evidence = protected_state(root)
                try:
                    if prior_release:
                        private_directory(backup)
                        for name, raw in backups.items():
                            backup_once(backup / name, raw)
                        descriptor = os.open(backup, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                        try:
                            os.fsync(descriptor)
                        finally:
                            os.close(descriptor)
                    for name, data in files.items():
                        if originals[name] is not None and originals[name][0] == data:
                            continue
                        changed.append(name)
                        if originals[name] is None:
                            atomic_add(root / name, data, expected[name][1], added)
                        else:
                            atomic_write(root / name, data, expected[name][1])
                    verified = checker(root, python, bridge_lock_fd=bridge_lock_fd) is True
                    check(verified, "Quote policy module contracts could not be verified. Original modules were restored.")
                    check(read_config(config_path)[0] == config_raw,
                          "Bridge configuration changed during the quote policy check.")
                    for name, ownership in added.items():
                        check_added_module(root / name, files[name], ownership)
                    check_snapshot(root, expected)
                    check(protected_state(root) == evidence,
                          "Existing request evidence changed during the read-only quote policy check.")
                except Exception:
                    try:
                        for name in reversed(changed):
                            path = root / name
                            if originals[name] is None:
                                if name in added:
                                    check_added_module(path, files[name], added[name])
                                    path.unlink()
                                    sync_directory(path.parent)
                                else:
                                    check(not path.exists() and not path.is_symlink(),
                                          "An unowned module appeared during restoration.")
                            else:
                                check(source_read(path, "Module restoration needs review.")[0] in (originals[name][0], files[name]),
                                      "An installed module changed during restoration.")
                                atomic_write(path, originals[name][0], originals[name][1])
                        check(protected_state(root) == evidence,
                              "Existing request evidence changed during the read-only quote policy check.")
                    except Exception:
                        raise RollbackError("Quote policy update restoration needs review. Keep the bridge scheduled task disabled and report this message before restarting it.") from None
                    raise
    except Exception as error:
        failure = error
    if failure:
        if stopped and was_running and not isinstance(failure, RollbackError):
            try:
                check_snapshot(root, originals)
                check(read_config(config_path)[0] == config_raw,
                      "Bridge configuration changed during installation.")
            except QuotePolicyUpdateError:
                raise RollbackError("Modules, configuration or dependencies changed during installation. Keep the bridge scheduled task disabled and report this message before restarting it.") from None
            try:
                launch(root, proc, python, flock)
            except Exception:
                raise QuotePolicyUpdateError("The original bridge is retained. Restart its existing scheduled task.") from None
        if isinstance(failure, QuotePolicyUpdateError):
            raise failure
        raise QuotePolicyUpdateError("Installation stopped; original modules were restored. Existing request evidence was preserved.") from None
    launch(root, proc, python, flock)
    return {"updated": bool(changed), "contractsVerified": verified,
            "nativeUploaderVerified": check_request is not None}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-request", metavar="UUID",
                        help="Verify a saved request's fresh native uploader without selecting a file, before installing")
    args = parser.parse_args(argv)
    try:
        result = install(check_request=args.check_request)
    except QuotePolicyUpdateError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Quote policy update stopped safely. No PO was created, changed, uploaded or emailed.") from None
    print("Quote-policy v2 update installed. Existing bridge watcher is running.")
    if result["nativeUploaderVerified"]:
        print("Native uploader compatibility: verified (read-only).")
    print("Module contracts:", "verified" if result["contractsVerified"] else "not verified")
    print("Existing failed requests were not retried. Inspect their saved state before recovery.")
    print("No PO was created or changed. No file was uploaded or emailed by this installer.")
    print("Configuration and existing request, quote and confirmation records were preserved.")


if __name__ == "__main__":
    main()
