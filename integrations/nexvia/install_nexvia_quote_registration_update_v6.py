#!/usr/bin/env python3
"""Update generated quote callbacks on the installed policy-v2 bridge.

This three-module patch accepts only the exact deployed policy-v2 modules or its
completed update. The registration and generated-profile helpers are new; creator, watcher, reviews
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
FILES = {"nexvia_quote_attachment.py", "nexvia_quote_registration.py", "nexvia_generated_callback.py"}
# Exact deployed policy-v2 bridge. Local edits and mixed releases are never
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
    "nexvia_preparation_diagnostics.py": "9a146254aa66f3b33c3ad4780f95e8fa2c61f006772fc403128d02e4f0a2328e",
    "nexvia_quote_attachment.py": "5469caa70740cdd9dfcc68e854859335ce95e10234ea5e726c176d7273371d64",
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
REGISTRATION_DONE_SHA256 = "6bca1e312639e1f418f8da27b980417500364820031430f277eed15fe59498bf"
REGISTRATION_PREFIX_SHA256 = "99865d2b4faa2b895f45e7aa108017ffbf1f4d8025119878530ce1eb8d3c1486"
POLICY_MARKERS = ("nexvia-quote-upload-attempt.json", "nexvia-quote-upload.json", "nexvia-prepared.json",
                  "nexvia-create-attempt.json", "nexvia-result.json")
MAX_POLICY_REPORT_BYTES = 256 * 1024
DONE_PROFILE_SHA256 = "6f44c66a5ad9719ae1707edabf79724d3cc04fd6ebbdb36ae6a8b5cab317e9b7"
REGISTRATION_PROTOCOL_VERSION = 2


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


def observed_registration_evidence(root, identifier):
    """Require source-bound evidence; never register or replay the earlier file."""
    try:
        root = Path(root)
        proof, records = policy_originals(root, identifier)
        check(set(POLICY_MARKERS) & set(records) == {POLICY_MARKERS[0]},
              "Saved registration evidence is no longer attempt-only. Nothing installed.")
        request, attempt, journal = records["request.json"], records[POLICY_MARKERS[0]], records["mainJournal"]
        check(request.get("requestId") == identifier and isinstance(request.get("quote"), dict),
              "Saved registration evidence has a different request. Nothing installed.")
        expected_attempt = {"version": 1, "requestId": identifier, "requestHash": digest(request),
            "projectPageId": request.get("projectPageId"), "createPath": attempt.get("createPath"), "quote": request["quote"]}
        check(set(attempt) == set(expected_attempt) | {"attemptedAt"}
              and all(attempt.get(key) == value for key, value in expected_attempt.items()),
              "Saved upload attempt binding changed. Nothing installed.")
        outbound = journal.get("outbound") or {}
        check(journal.get("phase") == "TERMINAL" and journal.get("reported") is True
              and journal.get("kind") == "request" and journal.get("id") == identifier
              and "preparedHash" not in journal and outbound.get("state") == "needs_review"
              and all(outbound.get(key) == journal.get(key) for key in ("workerId", "id", "kind", "claimToken")),
              "Saved request is not a reported preparation failure. Nothing installed.")
        diagnostic = records.get("nexvia-preparation-diagnostic.json") or {}
        counters = diagnostic.get("counters") or {}
        events = diagnostic.get("events") or []
        check(type(diagnostic.get("version")) is int and diagnostic["version"] == 1
              and diagnostic.get("requestId") == identifier and diagnostic.get("requestHash") == digest(request)
              and diagnostic.get("status") == "failed"
              and diagnostic.get("phase") == "quote_upload" and diagnostic.get("code") == "quote_upload_incomplete"
              and counters == {"policyRequests": 1, "storageUploads": 1, "registrations": 0}
              and all(type(counters.get(key)) is int for key in ("policyRequests", "storageUploads", "registrations"))
              and isinstance(events, list)
              and any(row.get("class") == "native_policy" and row.get("method") == "GET" and row.get("status") == 200
                      and row.get("denied") is False for row in events if isinstance(row, dict))
              and any(row.get("class") == "storage_upload" and row.get("method") == "POST" and row.get("status") == 204
                      and row.get("denied") is False for row in events if isinstance(row, dict)),
              "Saved transport observations differ. Nothing installed.")
        with policy_directory(root / "nexvia-registration-source-checks") as directory:
            report, identity = policy_record(directory, identifier + ".json", maximum=MAX_POLICY_REPORT_BYTES)
        check(report.get("format") == "nexvia-registration-source-check" and type(report.get("version")) is int
              and report["version"] == 1 and report.get("requestId") == identifier
              and report.get("requestHash") == digest(request)
              and report.get("evidenceBeforeHash") == report.get("evidenceAfterHash") == digest(proof)
              and report.get("readOnly") is True and report.get("originalsUnchanged") is True
              and report.get("status") == "inspected" and report.get("code") == "done_source_observed"
              and all(type(report.get(key)) is int and report[key] == 0
                      for key in ("policyRequests", "storageUploads", "registrations", "poSubmissions", "emails")),
              "Saved source inspection does not match this request. Nothing installed.")
        contract = report.get("contract") or {}
        primary = contract.get("primary") or {}
        controller = contract.get("controller") or {}
        check(contract.get("doneSourceSha256") == REGISTRATION_DONE_SHA256
              and primary.get("functionDepth") == 0 and primary.get("method") == "GET"
              and controller.get("status") == "observed" and controller.get("namespace") == "staff"
              and contract.get("fileURLAssignments") == 1,
              "Saved registration callback profile differs. Nothing installed.")
        templates = primary.get("urlTemplates")
        check(isinstance(templates, list) and len(templates) == 2,
              "Saved registration route profile differs. Nothing installed.")
        for template in templates:
            check(isinstance(template, list) and len(template) in {2, 4},
                  "Saved registration route profile differs. Nothing installed.")
            prefixes = [piece.get("literal") for piece in template if isinstance(piece, dict)
                        and isinstance(piece.get("literal"), dict)
                        and piece["literal"].get("sha256") == REGISTRATION_PREFIX_SHA256]
            check(len(prefixes) == 1 and prefixes[0].get("length") == 15
                  and prefixes[0].get("trailingSlash") is True and prefixes[0].get("hasQuery") is False,
                  "Saved registration endpoint differs. Nothing installed.")
            response = template[-1].get("response") or {}
            check(response.get("length") == 2 and (response.get("leaf") or {}).get("canonicalKnownName") == "id",
                  "Saved registration ID source differs. Nothing installed.")
        data = primary.get("data")
        check(isinstance(data, list) and len(data) == 1, "Saved registration metadata differs. Nothing installed.")
        item = data[0]
        key, path = item.get("key") or {}, item.get("responsePath") or {}
        check(key.get("sha256") == hashlib.sha256(b"location").hexdigest() and key.get("length") == 8
              and key.get("safeIdentifier") is True and item.get("encoding") == "direct_member"
              and path.get("length") == 2 and (path.get("leaf") or {}).get("canonicalKnownName") == "path"
              and (path.get("leaf") or {}).get("sha256") == hashlib.sha256(b"path").hexdigest()
              and item.get("metadataSourceMatchesFileURL") is True
              and item.get("metadataSourceMatchesSignedKey") is False
              and item.get("metadataSourceMatchesURL") is False and item.get("metadataSourceMatchesID") is False,
              "Saved registration metadata source differs. Nothing installed.")
        return {"originals": digest(proof), "report": digest(report), "identity": digest(identity)}
    except QuotePolicyUpdateError:
        raise
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise QuotePolicyUpdateError("Saved registration evidence is unavailable or invalid. Nothing installed.") from None

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
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-quote-registration-v6-", dir=path.parent)
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
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-quote-registration-v6-new-", dir=path.parent)
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
          "A newly installed module changed during the quote registration update.")


def backup_items(originals, config_raw):
    items = {"panelstock-requests.json": config_raw}
    for name in sorted(FILES):
        original = originals[name]
        if original is None:
            items[name + ".absent"] = ("Absent before quote registration update: " + name + "\n").encode("ascii")
        else:
            items[name] = original[0]
    return items


def backup_once(path, data):
    if path.exists() or path.is_symlink():
        check(private_read(path, MAX_BUNDLE_BYTES, "Unexpected existing update backup.") == data,
              "A different quote-registration-v6-update backup exists. Nothing installed.")
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
    """Make only a directory created by this call private; never repair unknown paths."""
    created = False
    try:
        path.mkdir(mode=0o700)
        created = True
        identity = path.lstat()
    except FileExistsError:
        identity = path.lstat()
    except OSError:
        raise QuotePolicyUpdateError("The private quote-registration-v6-update directory could not be created.") from None
    check(stat.S_ISDIR(identity.st_mode) and identity.st_uid == os.geteuid(),
          "The quote-registration-v6-update directory ownership or type is unsafe. Nothing installed.")
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        check((info.st_dev, info.st_ino) == (identity.st_dev, identity.st_ino),
              "The quote-registration-v6-update directory changed. Nothing installed.")
        if created:
            # Synology may inherit 0755 despite mkdir's requested mode.
            os.fchmod(descriptor, 0o700)
            os.fsync(descriptor)
        check(stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o700,
              "The quote-registration-v6-update directory must already be private. Nothing installed.")
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
            elif name == "nexvia_quote_registration.py":
                check_registration_source(data)
            elif name == "nexvia_generated_callback.py":
                check_generated_source(data)
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


def check_registration_source(data):
    expected = {"REGISTRATION_PROTOCOL_VERSION": REGISTRATION_PROTOCOL_VERSION,
        "SEND_SOURCE_SHA256": "96bfef70560ed8611fb07bbc0321d5d7dbbdf8b938dd08c4f92438398d3b4b16",
        "PREFIX_SHA256": REGISTRATION_PREFIX_SHA256,
        "QUERY_SHA256": "e6eaea18e885e1078829b56df34896be5ab51439e8f0ba00cb1624b2c572c10e"}
    values = {name: [] for name in expected}
    for node in ast.parse(data).body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in values:
                    values[target.id].append(node.value.value)
    check(all(values[name] == [value] and type(values[name][0]) is type(value)
              for name, value in expected.items()),
          "Native registration callback pins are unavailable or invalid. Nothing installed.")


def check_generated_source(data):
    expected = {"CALLBACK_PROFILE_VERSION": 1,
                "SUPPORTED_DONE_PROFILE_SHA256": DONE_PROFILE_SHA256,
                "MAX_SOURCE_CHARACTERS": 65536}
    values = {name: [] for name in expected}
    for node in ast.parse(data).body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in values:
                    values[target.id].append(node.value.value)
    check(all(values[name] == [value] and type(values[name][0]) is type(value)
              for name, value in expected.items()),
          "Generated callback profile pins are unavailable or invalid. Nothing installed.")


def registration_failure_codes(data):
    """Read a finite diagnostic vocabulary without executing replacement code."""
    values = []
    for node in ast.parse(data).body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                and target.id == "PUBLIC_FAILURE_CODES" for target in node.targets):
            if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) \
                    and node.value.func.id == "frozenset" and len(node.value.args) == 1:
                values.append(ast.literal_eval(node.value.args[0]))
    if not values:
        return frozenset()
    check(len(values) == 1 and isinstance(values[0], (set, tuple, list)) and len(values[0]) <= 100
          and all(isinstance(value, str) and re.fullmatch(r"registration_[a-z_]{1,64}", value)
                  for value in values[0]), "Native registration failure codes are invalid. Nothing installed.")
    return frozenset(values[0])


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
    'nexvia_preparation_diagnostics', 'nexvia_quote_registration', 'nexvia_generated_callback')}
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
assert quote.POLICY_UPLOAD_GUARD_VERSION == 2
assert quote.UPLOAD_CONTEXT_FILE == 'nexvia-quote-upload-context.json'
for name, args, kwargs in (
    ('begin_upload_context', (root, {}, '', {}), {}),
    ('validate_upload_context', (root, {}, '', {}), {'required_stage': None}),
    ('accept_storage_upload', (root, {}, '', {}, 204), {}),
    ('record_denied_upload_request', (root, {}, '', {}, 'GET', ''), {}),
):
    function = getattr(quote, name)
    assert callable(function)
    inspect.signature(function).bind(*args, **kwargs)
registration = modules['nexvia_quote_registration']
assert registration.REGISTRATION_PROTOCOL_VERSION == 2
generated = modules['nexvia_generated_callback']
assert generated.CALLBACK_PROFILE_VERSION == 1
assert generated.SUPPORTED_DONE_PROFILE_SHA256 == '6f44c66a5ad9719ae1707edabf79724d3cc04fd6ebbdb36ae6a8b5cab317e9b7'
assert registration.generated_callback is generated
assert callable(generated.profile)
assert callable(quote.validate_callback_sources)
inspect.signature(quote.validate_callback_sources).bind({}, {})
assert callable(registration.read_contract)
assert callable(registration.binding_from_policy)
assert callable(registration.matches_request)
assert callable(registration.matches_renderer_request)
assert callable(registration.public_binding)
inspect.signature(registration.read_contract).bind(None, '', '')
inspect.signature(registration.binding_from_policy).bind({}, {}, [], {})
inspect.signature(registration.matches_request).bind('', 'GET', {})
inspect.signature(registration.matches_renderer_request).bind('', 'GET', {})
inspect.signature(registration.public_binding).bind({})
assert isinstance(registration.PUBLIC_FAILURE_CODES, frozenset)
assert registration.PUBLIC_FAILURE_CODES and all(isinstance(value, str) and
    re.fullmatch(r'registration_[a-z_]{1,64}', value) for value in registration.PUBLIC_FAILURE_CODES)
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
print(json.dumps({'format': 'nexvia-quote-registration-v6-contract-check', 'version': 6,
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
from urllib.parse import urlsplit, urlencode
from datetime import datetime, timedelta, timezone

def blocked(*args, **kwargs):
    raise RuntimeError('Read-only native compatibility check')

def completion_path(path):
    # Registration is a mutation even though its native method is GET. Its
    # pinned operation need not contain the legacy /upload/details spelling.
    # Recognize root or one-namespace forms only to deny them during preflight.
    cleaned = path.rstrip('/')
    stems = [cleaned + '/']
    if '/' in cleaned:
        stems.append(cleaned.rsplit('/', 1)[0] + '/')
    for stem in stems:
        pieces = stem.split('/')
        candidates = [stem]
        if len(pieces) > 3 and re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,59}', pieces[1]):
            candidates.append('/' + '/'.join(pieces[2:]))
        if any(hashlib.sha256(value.encode()).hexdigest() ==
                '99865d2b4faa2b895f45e7aa108017ffbf1f4d8025119878530ce1eb8d3c1486'
                for value in candidates):
            return True
    return False

def route_decision(request, quote):
    try:
        target = urlsplit(request.url)
        if target.scheme not in {'http', 'https'} or not target.hostname:
            return False, False
        policy = quote.policy_path(request.url)
        registration = target.hostname == 'lennox.nexvia.com.au' and bool(
            re.match(r'^/staff/upload/details(?:/|$)', target.path) or completion_path(target.path))
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
            (quote, ('upload_quote', 'begin_upload', 'complete_upload', 'source_upload_payload',
                     'begin_upload_context', 'validate_upload_context', 'accept_storage_upload')),
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
            checkpoint['stage'] = 'registration_source'
            registration = importlib.import_module('nexvia_quote_registration')
            done = state['widgets'][0]['doneSource']
            contract = registration.read_contract(editor['page'], done, source)
            quote.validate_callback_sources(state['widgets'][0], contract)
            assert contract['version'] == 2
            assert contract['doneProfileSha256'] == '6f44c66a5ad9719ae1707edabf79724d3cc04fd6ebbdb36ae6a8b5cab317e9b7'
            assert contract['doneSourceSha256'] == hashlib.sha256(done.encode()).hexdigest()
            # Exercise the new exact registration matcher against the live
            # source profile, without selecting a file or making any request.
            checkpoint['stage'] = 'registration_binding'
            now = datetime.now(timezone.utc)
            stamp = now.strftime('%Y%m%dT%H%M%SZ')
            credential = 'preflight@example.invalid/' + stamp[:8] + '/auto/storage/goog4_request'
            conditions = [{'bucket': 'policy-preflight'}, {'key': 'diagnostic/no-upload.pdf'},
                {'x-goog-algorithm': 'GOOG4-RSA-SHA256'}, {'x-goog-credential': credential}, {'x-goog-date': stamp},
                ['starts-with', '$acl', ''], ['starts-with', '$content-disposition', ''], ['starts-with', '$content-type', '']]
            policy = base64.b64encode(json.dumps({'expiration': (now + timedelta(minutes=10)).isoformat(),
                'conditions': conditions}).encode()).decode()
            response = {'id': 419, 'path': 'diagnostic/no-upload.pdf', 'key': 'diagnostic/no-upload.pdf',
                'policy': policy, 'x-goog-algorithm': 'GOOG4-RSA-SHA256', 'x-goog-credential': credential,
                'x-goog-date': stamp, 'x-goog-signature': 'a' * 512}
            metadata = {'filename': 'no-upload.pdf', 'bytes': 100, 'sha256': 'b' * 64}
            candidates = quote.validate_policy_response(json.dumps(response).encode(),
                'https://policy-preflight.storage.googleapis.com/', metadata, quote.policy_acl(source), quote.policy_append_fields(source))
            binding = registration.binding_from_policy(response, contract, candidates, metadata)
            matched = binding['registrationURL'] + '?' + urlencode({'location': response['path']})
            assert registration.matches_request(matched, 'GET', binding)
            assert not registration.matches_request(matched, 'POST', binding)
            changed = matched.replace('419', '420')
            assert changed != matched and not registration.matches_request(changed, 'GET', binding)
            rendered = binding['rendererURL']
            assert registration.matches_renderer_request(rendered, 'GET', binding)
            assert not registration.matches_renderer_request(rendered, 'POST', binding)
            assert not registration.matches_request(rendered, 'GET', binding)
            altered = rendered.replace('419', '420')
            assert altered != rendered and not registration.matches_renderer_request(altered, 'GET', binding)
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
        for name in ('nexvia_generated_callback', 'nexvia_quote_registration', 'nexvia_quote_attachment'):
            source = base64.b64decode(payload['sources'][name], validate=True)
            module = types.ModuleType(name)
            module.__file__ = str(root / (name + '.py'))
            sys.modules[name] = module
            exec(compile(source, module.__file__, 'exec'), module.__dict__)
            report['sourceSha256'][name] = hashlib.sha256(source).hexdigest()
        quote = sys.modules['nexvia_quote_attachment']
        assert quote.BLANK_DRAFT_GUARD_VERSION == 5 and quote.POLICY_UPLOAD_GUARD_VERSION == 2
        for name in ('POLICY_SEND_SHA256', 'POLICY_OPERATION_SHA256'):
            assert type(getattr(quote, name)) is str and re.fullmatch(r'[a-f0-9]{64}', getattr(quote, name))
        assert importlib.import_module('nexvia_preparation_diagnostics').DIAGNOSTICS_VERSION == 1
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
    except Exception as error:
        checkpoint['passed'] = False
        registration = sys.modules.get('nexvia_quote_registration')
        reason = error.args[0] if len(error.args) == 1 and isinstance(error.args[0], str) else None
        if registration is not None and isinstance(error, registration.RegistrationError) \
                and reason in getattr(registration, 'PUBLIC_FAILURE_CODES', frozenset()):
            checkpoint['reason'] = reason
    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])
    if 'reason' in checkpoint:
        report['reason'] = checkpoint['reason']
    print(json.dumps(report, separators=(',', ':')))

if __name__ == '__main__':
    main()
"""


NATIVE_CHECK_STAGES = frozenset({"open_draft", "native_guard", "source_normalizer", "upload_fields",
                               "registration_source", "registration_binding", "verified"})


def save_native_check_report(root, request_id, value, expected, failure_codes):
    """Persist only a bounded projection; native/private values never escape."""
    value = value if isinstance(value, dict) else {}
    stage_value, reason_value = value.get("stage"), value.get("reason")
    stage = stage_value if isinstance(stage_value, str) and stage_value in NATIVE_CHECK_STAGES else "unknown"
    reason = reason_value if isinstance(reason_value, str) and reason_value in failure_codes else None
    safe = {"format": "nexvia-registration-v6-preflight", "version": 1,
            "requestId": request_id, "requestFileSha256": expected["requestFileSha256"],
            "sourceSha256": expected["sourceSha256"], "passed": value == expected,
            "stage": stage, "reason": reason, "readOnly": True,
            "policyRequested": False, "fileUploaded": False, "registered": False,
            "poCreated": False, "poChanged": False, "emailSent": False}
    raw = canonical(safe) + b"\n"
    check(len(raw) <= 4096, "Native compatibility report exceeded its bound. Nothing installed.")
    directory = Path(root) / "nexvia-registration-v6-checks"
    private_directory(directory)
    path = directory / (request_id + ".json")
    if path.exists() or path.is_symlink():
        info = path.lstat()
        check(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
              "Native compatibility report is unsafe. Nothing installed.")
    atomic_write(path, raw, 0o600)
    return safe


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
               for name in ("nexvia_generated_callback", "nexvia_quote_registration", "nexvia_quote_attachment")}
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
    failure_codes = registration_failure_codes(files["nexvia_quote_registration.py"])
    safe = save_native_check_report(root, request_id, value, expected, failure_codes)
    if value != expected:
        stage = safe["stage"]
        if stage in NATIVE_CHECK_STAGES:
            reason = " (" + safe["reason"] + ")" if safe["reason"] is not None else ""
            raise QuotePolicyUpdateError("Native uploader compatibility check failed at " + stage
                                         + reason + ". Nothing installed.")
        raise QuotePolicyUpdateError("Native uploader compatibility check stopped. Nothing installed.")
    return True


def native_policy_preflight(root, python, files, request_id, *, bridge_lock_fd):
    """Bind the saved diagnosis around the source-only native compatibility check."""
    evidence = observed_registration_evidence(root, request_id)
    try:
        return _native_policy_preflight(root, python, files, request_id, bridge_lock_fd=bridge_lock_fd)
    finally:
        check(observed_registration_evidence(root, request_id) == evidence,
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
        return value == {"format": "nexvia-quote-registration-v6-contract-check", "version": 6,
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
    check(snapshot(root) == expected, "Installed modules changed during the quote registration update.")
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
    for name in ("nexvia-requests", "panelstock-request-journal", "nexvia-policy-checks", "nexvia-policy-checks-v2", "nexvia-registration-source-checks"):
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
    check(check_request is not None, "A saved quoted request is required for the read-only native check. Nothing installed.")
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
    backup = root / "nexvia-backup-before-quote-registration-v6-update"
    backups = backup_items(originals, config_raw)
    check(not backup.is_symlink(), "Unexpected quote-registration-v6-update backup directory.")
    if prior_release and backup.exists():
        check(backup.is_dir(), "Unexpected quote-registration-v6-update backup directory.")
        for name, expected_backup in backups.items():
            path = backup / name
            if path.exists() or path.is_symlink():
                check(private_read(path, MAX_SCRIPT_BYTES, "Unexpected quote policy backup.") == expected_backup,
                      "A different quote-registration-v6-update backup exists. Nothing installed.")
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
                policy_evidence = observed_registration_evidence(root, check_request)
                evidence = protected_state(root)
                try:
                    check(native_checker(root, python, files, check_request, bridge_lock_fd=bridge_lock_fd) is True,
                          "Native uploader compatibility check stopped. Nothing installed.")
                finally:
                    check(observed_registration_evidence(root, check_request) == policy_evidence,
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
                        raise RollbackError("Quote registration update restoration needs review. Keep the bridge scheduled task disabled and report this message before restarting it.") from None
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
    parser.add_argument("--check-request", metavar="UUID", required=True,
                        help="Verify a saved request's fresh native uploader without selecting a file, before installing")
    args = parser.parse_args(argv)
    try:
        result = install(check_request=args.check_request)
    except QuotePolicyUpdateError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Quote registration update stopped safely. No PO was created, changed, uploaded or emailed.") from None
    print("Quote-registration v6 update installed. Existing bridge watcher is running.")
    if result["nativeUploaderVerified"]:
        print("Native uploader compatibility: verified (read-only).")
    print("Module contracts:", "verified" if result["contractsVerified"] else "not verified")
    print("Existing failed requests were not retried. Inspect their saved state before recovery.")
    print("No PO was created or changed. No file was uploaded or emailed by this installer.")
    print("Configuration and existing request, quote and confirmation records were preserved.")


if __name__ == "__main__":
    main()
