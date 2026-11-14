#!/usr/bin/env python3
"""Install the packaged original-PO-document bridge update without recreating POs.

Release packaging fills BUNDLE_BASE64 with checksummed scripts and a pure Python
pypdf wheel. The source template intentionally cannot install without a bundle.
"""

import argparse
import base64
import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import time
import unicodedata
import zipfile


BUNDLE_BASE64 = ""
OLD_BRIDGE_SHA256 = "48ca9d10b73490685bc58b16b58df33a405c3000083e9c260d04ddd97fea319d"
PYPDF_SHA256 = "47cca6b24bdcf4c4d65b5f7b8b972535c61710a061261e737688777cfd9a7bfb"
PRIOR_CAPTURE_SHA256 = {"57ecb34e1cf5b21569094bfac3932485ae5236303cf393d969496ed26ed02ceb"}
PRIOR_DOCUMENT_BRIDGE_SHA256 = "2641b12384515006ff6d04cdd835645342dfe0e5965e2f6f18139a603e7ef2a9"
FILES = {"nexvia_requests.py", "nexvia_po_document.py", "nexvia-po-vendor/pypdf.whl"}
MAX_BUNDLE_BYTES = 8 * 1024 * 1024
MAX_CONFIG_BYTES = 64 * 1024
# Static release-reviewed codes only. Never print arbitrary report/error text.
CHECK_STATUS_CODES = {
    "invalid-po-identity", "invalid-document-folder", "document-folder-unavailable",
    "parser-unavailable", "capture-unavailable", "identity-context-unavailable", "supplier-context-unavailable",
    "invalid-document-artifact", "document-artifact-unavailable", "document-artifact-identity-mismatch",
    "document-artifact-hash-mismatch", "verified-request-mismatch", "browser-guard-unavailable",
    "nexvia-sign-in-required", "po-page-unavailable", "native-po-number-mismatch",
    "native-lines-unavailable", "native-total-unavailable", "native-total-mismatch",
    "native-request-mismatch", "native-supplier-mismatch", "no-readable-inline-pdf",
    "ambiguous-official-pdf", "official-pdf-not-verified", "inline-pdf-unavailable",
    "unsupported-data-pdf", "invalid-inline-pdf", "not-a-complete-pdf", "pdf-text-unavailable",
    "not-an-official-purchase-order", "pdf-po-number-mismatch", "pdf-project-mismatch",
    "pdf-supplier-mismatch", "pdf-total-mismatch", "report-too-large", "report-write-unavailable",
    "gcs-url-invalid", "gcs-download-unavailable", "gcs-redirect-blocked", "gcs-content-type-mismatch",
    "gcs-size-limit", "gcs-download-timeout", "gcs-length-mismatch",
}
CHECK_STAGE_CODES = {"identity", "document-folder", "dependency", "capture", "freeze", "complete"}


class DocumentUpdateError(Exception):
    """Fixed messages only; never include private config or browser output."""


class RollbackError(DocumentUpdateError):
    pass


def check(condition, message):
    if not condition:
        raise DocumentUpdateError(message)


def regular(path, message):
    try:
        mode = path.lstat().st_mode
    except OSError:
        raise DocumentUpdateError(message) from None
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
        raise DocumentUpdateError(message) from None


def decoded_payload():
    try:
        check(bool(BUNDLE_BASE64) and len(BUNDLE_BASE64) <= MAX_BUNDLE_BYTES * 2,
              "This source template has no release bundle. Nothing installed.")
        raw = base64.b64decode(BUNDLE_BASE64, validate=True)
        check(len(raw) <= MAX_BUNDLE_BYTES, "Installer bundle exceeds its size limit.")
        bundle = json.loads(raw)
        check(isinstance(bundle, dict) and set(bundle) == FILES,
              "Installer bundle has unexpected files. Nothing installed.")
        files = {}
        for name, entry in bundle.items():
            check(isinstance(entry, dict) and set(entry) == {"sha256", "contentBase64"},
                  "Installer manifest is invalid. Nothing installed.")
            data = base64.b64decode(entry["contentBase64"], validate=True)
            check(len(data) <= MAX_BUNDLE_BYTES and
                  hashlib.sha256(data).hexdigest() == entry["sha256"],
                  "Installer checksum mismatch. Nothing installed.")
            if name.endswith(".py"):
                compile(data, name, "exec")
            else:
                check(entry["sha256"] == PYPDF_SHA256,
                      "Unexpected PDF parser version. Nothing installed.")
                with zipfile.ZipFile(io.BytesIO(data)) as wheel:
                    entries = wheel.infolist()
                    check(len(entries) <= 1000 and "pypdf/__init__.py" in wheel.namelist()
                          and sum(item.file_size for item in entries) <= 20 * 1024 * 1024
                          and all(not item.flag_bits & 1 and not item.filename.startswith("/")
                                  and ".." not in Path(item.filename).parts for item in entries),
                          "Invalid PDF parser archive. Nothing installed.")
            files[name] = data
        return files
    except DocumentUpdateError:
        raise
    except (ValueError, TypeError, KeyError, SyntaxError, zipfile.BadZipFile):
        raise DocumentUpdateError("Installer content is invalid. Nothing installed.") from None


@contextlib.contextmanager
def lock_file(path, message, wait_seconds=0):
    check(not path.is_symlink(), "Unexpected lock file type. Nothing installed.")
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        check(stat.S_ISREG(os.fstat(descriptor).st_mode), "Unexpected lock file type.")
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise DocumentUpdateError(message) from None
                time.sleep(0.1)
        yield
    finally:
        os.close(descriptor)


def atomic_write(path, data, mode):
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-document-", dir=path.parent)
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


def backup_once(path, data):
    if path.exists() or path.is_symlink():
        check(private_read(path, MAX_BUNDLE_BYTES, "Unexpected existing update backup.") == data,
              "A different document-update backup exists. Nothing installed.")
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
        raise DocumentUpdateError('Process state could not be checked. Nothing installed.') from None
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
    raise DocumentUpdateError('The idle watcher did not stop. Nothing installed.')

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
        raise DocumentUpdateError('The script is installed but the watcher could not start. Run its scheduled task.') from None
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if bridge_processes(root, proc):
            return
        time.sleep(0.1)
    raise DocumentUpdateError('The script is installed; check or run the existing bridge scheduled task.')

def read_config(path):
    raw = private_read(path, MAX_CONFIG_BYTES, "The private bridge configuration is unavailable or invalid.")
    try:
        value = json.loads(raw)
        check(isinstance(value, dict) and
              all(type(value.get(key)) is bool for key in ("enabled", "creationEnabled")) and
              ("documentEnabled" not in value or type(value["documentEnabled"]) is bool),
              "The private bridge configuration is invalid.")
        return raw, value
    except (ValueError, TypeError):
        raise DocumentUpdateError("The private bridge configuration is invalid.") from None


def supplier_for_check(value):
    if value is None:
        return None
    check(isinstance(value, str) and 0 < len(value) <= 500 and bool(value.strip())
          and all(not unicodedata.category(character).startswith("C") for character in value),
          "Choose a nonempty supplier name of at most 500 characters without control characters.")
    return value


def capture_check(root, python, project, order_id, number, *, supplier_name=None):
    """The capture module writes a safe report; raw stdout is never displayed."""
    supplier_for_check(supplier_name)
    report = root / "nexvia-po-document-check.json"
    check(not report.is_symlink(), "Unexpected document-check report destination.")
    try:
        # A previous successful report cannot stand in for this exact check.
        if report.exists():
            regular(report, "Unexpected document-check report destination.")
            report.unlink()
        arguments = [str(python), str(root / "nexvia_po_document.py"), "--check",
                     "--project", str(project), "--po", str(order_id), "--number", number,
                     "--output", str(report)]
        if supplier_name is not None:
            arguments.append("--supplier-name=" + supplier_name)
        result = subprocess.run(
            arguments, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90,
            check=False)
        raw = private_read(report, 128 * 1024, "Document check did not produce its private report.")
        value = json.loads(raw)
        return (result.returncode == 0 and isinstance(value, dict)
                and value.get("documentVerified") is True
                and value.get("projectPageId") == project
                and value.get("purchaseOrderId") == order_id
                and value.get("purchaseOrderNumber") == number)
    except (OSError, ValueError, subprocess.SubprocessError, DocumentUpdateError):
        return False


def capture_diagnostic(root, project, order_id, number):
    unavailable = {"checkStatus": "check-unavailable", "checkStage": "check-unavailable"}
    try:
        raw = private_read(Path(root) / "nexvia-po-document-check.json", 128 * 1024,
                           "Document-check diagnostics are unavailable.")
        value = json.loads(raw)
        if not (isinstance(value, dict) and value.get("format") == "nexvia-po-document-check"
                and type(value.get("version")) is int and value["version"] == 1
                and value.get("documentVerified") is False
                and type(value.get("projectPageId")) is int and value["projectPageId"] == project
                and type(value.get("purchaseOrderId")) is int and value["purchaseOrderId"] == order_id
                and value.get("purchaseOrderNumber") == number):
            return unavailable
        status, stage = value.get("status"), value.get("stage")
        diagnostic = {"checkStatus": status if isinstance(status, str) and status in CHECK_STATUS_CODES else "check-unavailable",
                      "checkStage": stage if isinstance(stage, str) and stage in CHECK_STAGE_CODES else "check-unavailable"}
        failures = value.get("candidateFailures")
        if status == "official-pdf-not-verified" and isinstance(failures, list):
            reason = next((code for code in failures[:12]
                           if isinstance(code, str) and code in CHECK_STATUS_CODES), None)
            if reason is not None:
                diagnostic["checkReason"] = reason
        return diagnostic
    except (OSError, ValueError, TypeError, DocumentUpdateError):
        return unavailable


def install(root=Path("/config"), proc=Path("/proc"), *, project=60,
            order_id=1421, number="PO7413", check_supplier=None, launch=None, checker=None):
    root, proc = Path(root), Path(proc)
    supplier_for_check(check_supplier)
    check(type(project) is int and project > 0 and type(order_id) is int and order_id > 0
          and isinstance(number, str) and re.fullmatch(r"PO[0-9]{1,20}", number),
          "Choose the existing PO's numeric project, PO ID and displayed PO number.")
    files = decoded_payload()
    target = root / "nexvia_requests.py"
    regular(target, "The existing bridge script is missing or is a symlink. Nothing installed.")
    old = target.read_bytes()
    old_sha = hashlib.sha256(old).hexdigest()
    new_sha = hashlib.sha256(files["nexvia_requests.py"]).hexdigest()
    check(old_sha in {OLD_BRIDGE_SHA256, PRIOR_DOCUMENT_BRIDGE_SHA256, new_sha},
          "The installed bridge has local changes or a different version. Nothing installed.")
    config_path = root / "panelstock-requests.json"
    config_raw, config = read_config(config_path)
    python, flock = root / "nexvia-tools/bin/python", Path("/usr/bin/flock")
    check(os.access(python, os.X_OK) and os.access(flock, os.X_OK),
          "The existing Python or flock command is unavailable. Nothing installed.")
    journal = root / "panelstock-request-journal"
    check(journal.is_dir() and not journal.is_symlink(),
          "The bridge journal is missing or has an unexpected type. Nothing installed.")
    vendor = root / "nexvia-po-vendor"
    check(not vendor.is_symlink() and (not vendor.exists() or vendor.is_dir()),
          "The PDF parser directory has an unexpected type. Nothing installed.")
    # Every existing destination must match this release, the supported previous
    # bridge, or the single pinned prior capture release. Local edits are refused.
    originals = {}
    for name, payload in files.items():
        path = root / name
        if path.exists() or path.is_symlink():
            regular(path, "An update destination has an unexpected type. Nothing installed.")
            prior = path.read_bytes()
            check(prior == payload or (name == "nexvia_requests.py" and prior == old)
                  or (name == "nexvia_po_document.py" and
                      hashlib.sha256(prior).hexdigest() in PRIOR_CAPTURE_SHA256),
                  "An update destination contains local changes. Nothing installed.")
            originals[name] = (prior, stat.S_IMODE(path.stat().st_mode))
        else:
            originals[name] = None
    exact_current_release = old_sha == new_sha and all(
        originals[name] is not None and originals[name][0] == payload for name, payload in files.items())
    prior_capture = originals["nexvia_po_document.py"]
    prior_parser = originals["nexvia-po-vendor/pypdf.whl"]
    exact_prior_release = (old_sha == PRIOR_DOCUMENT_BRIDGE_SHA256
                           and prior_capture is not None
                           and hashlib.sha256(prior_capture[0]).hexdigest() in PRIOR_CAPTURE_SHA256
                           and prior_parser is not None
                           and hashlib.sha256(prior_parser[0]).hexdigest() == PYPDF_SHA256)
    # Only a complete exact release can retain an existing capability. A flag
    # added to the old pre-document bridge or a mixed installation is not proof.
    check(config.get("documentEnabled") is not True or exact_current_release or exact_prior_release,
          "An unverified document setting is already enabled. Nothing installed; report this message.")
    backup = root / ("nexvia_requests.before-permissions-update.py"
                     if old_sha == PRIOR_DOCUMENT_BRIDGE_SHA256 and old_sha != new_sha
                     else "nexvia_requests.before-document-update.py")
    if old_sha != new_sha and (backup.exists() or backup.is_symlink()):
        check(private_read(backup, MAX_BUNDLE_BYTES, "Unexpected existing update backup.") == old,
              "A different document-update backup exists. Nothing installed.")
    capture_upgrade = prior_capture is not None and prior_capture[0] != files["nexvia_po_document.py"]
    capture_backup = root / "nexvia_po_document.before-permissions-update.py"
    if capture_upgrade and (capture_backup.exists() or capture_backup.is_symlink()):
        check(private_read(capture_backup, MAX_BUNDLE_BYTES, "Unexpected existing capture-update backup.")
              == prior_capture[0], "A different capture-update backup exists. Nothing installed.")
    launch = launch_watcher if launch is None else launch
    checker = capture_check if checker is None else checker
    stopped = False
    was_running = False
    changed = []
    failure = None
    document_verified = False
    diagnostic = {"checkStatus": "check-unavailable", "checkStage": "check-unavailable"}
    vendor_created = False
    try:
        with lock_file(journal / ".bridge.lock",
                       "The bridge is handling work. Let it finish, then run this installer again."):
            watchers = bridge_processes(root, proc)
            was_running = bool(watchers)
            if watchers:
                stop_idle_watcher(root, proc, watchers[0])
                stopped = True
            with lock_file(root / "panelstock-requests-watch.lock",
                           "A watcher restarted during the update. Nothing installed; run this installer again.", 3):
                check(not bridge_processes(root, proc), "A watcher restarted during the update. Nothing installed.")
                check(read_config(config_path)[0] == config_raw,
                      "Bridge files changed during installation. Nothing installed.")
                check(not vendor.is_symlink() and (not vendor.exists() or vendor.is_dir()),
                      "The PDF parser directory changed during installation.")
                for name, original in originals.items():
                    destination = root / name
                    if original is None:
                        check(not destination.exists() and not destination.is_symlink(),
                              "An update destination appeared during installation.")
                    else:
                        regular(destination, "An update destination changed during installation.")
                        check(destination.read_bytes() == original[0],
                              "An update destination changed during installation.")
                try:
                    if old_sha != new_sha:
                        backup_once(backup, old)
                    if capture_upgrade:
                        backup_once(capture_backup, prior_capture[0])
                    if not vendor.exists():
                        vendor.mkdir(mode=0o700)
                        vendor_created = True
                        descriptor = os.open(vendor, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                                             | getattr(os, "O_NOFOLLOW", 0))
                        try:
                            check(stat.S_ISDIR(os.fstat(descriptor).st_mode),
                                  "The new PDF parser directory has an unexpected type.")
                            os.fchmod(descriptor, 0o700)
                            check(stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o700,
                                  "The new PDF parser directory could not be made private.")
                        finally:
                            os.close(descriptor)
                    for name, payload in files.items():
                        if originals[name] and originals[name][0] == payload:
                            continue
                        changed.append(name)
                        atomic_write(root / name, payload, originals[name][1] if originals[name] else (0o600 if name.endswith(".whl") else 0o644))
                    # A failed or unavailable source PDF must never opt new claims
                    # into waiting-for-document emails. Existing enabled capability
                    # is retained on a harmless rerun, as managed POs may be pending.
                    check_options = {"supplier_name": check_supplier} if check_supplier is not None else {}
                    document_verified = checker(root, python, project, order_id, number, **check_options) is True
                    # Every check outcome must still refer to the same worker,
                    # credential and capability snapshot before restarting it.
                    check(read_config(config_path)[0] == config_raw,
                          "Bridge configuration changed during the document check.")
                    if not document_verified:
                        diagnostic = capture_diagnostic(root, project, order_id, number)
                    if document_verified and config.get("documentEnabled") is not True:
                        backup_once(root / "panelstock-requests.before-document-update.json", config_raw)
                        config["documentEnabled"] = True
                        changed.append("panelstock-requests.json")
                        atomic_write(config_path, (json.dumps(config, indent=2) + "\n").encode(), 0o600)
                except Exception:
                    try:
                        for name in reversed(changed):
                            if name == "panelstock-requests.json":
                                atomic_write(config_path, config_raw, 0o600)
                            elif originals[name] is None:
                                (root / name).unlink(missing_ok=True)
                            else:
                                atomic_write(root / name, originals[name][0], originals[name][1])
                        if vendor_created:
                            vendor.rmdir()
                    except Exception:
                        raise RollbackError("Update restoration failed. Disable the bridge scheduled task and report this message before restarting it.") from None
                    raise
    except Exception as error:
        failure = error
    if failure:
        if stopped and was_running and not isinstance(failure, RollbackError):
            try:
                launch(root, proc, python, flock)
            except Exception:
                raise DocumentUpdateError("The original bridge is retained. Restart its existing scheduled task.") from None
        if isinstance(failure, DocumentUpdateError):
            raise failure
        raise DocumentUpdateError("Installation stopped; original files were restored. Existing PO records were preserved.") from None
    launch(root, proc, python, flock)
    return {"updated": bool(changed), "documentVerified": document_verified,
            "documentEnabled": config.get("documentEnabled") is True, **diagnostic}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-project", type=int, default=60)
    parser.add_argument("--check-po", type=int, default=1421)
    parser.add_argument("--check-number", default="PO7413")
    parser.add_argument("--check-supplier", help="Supplier shown on the existing PO used for the document check")
    args = parser.parse_args(argv)
    try:
        result = install(project=args.check_project, order_id=args.check_po, number=args.check_number,
                         check_supplier=args.check_supplier)
    except DocumentUpdateError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Installation stopped safely. Report this message; no PO was recreated or emailed.") from None
    print("PO document update installed. Existing bridge watcher is running.")
    if result["documentVerified"]:
        print("The existing PO document was verified. Future new PO confirmations will include the original PDF.")
    elif result["documentEnabled"]:
        print("The existing document setting was retained; this check could not verify the current document.")
    else:
        print("The existing PO document could not be verified. Automatic attachments remain disabled.")
        print("Check report: /config/nexvia-po-document-check.json")
    if not result["documentVerified"]:
        print("Check status:", result["checkStatus"])
        print("Check stage:", result["checkStage"])
        reason = result.get("checkReason")
        if isinstance(reason, str) and reason in CHECK_STATUS_CODES:
            print("Check reason:", reason)
    print("No PO was created, uploaded or emailed by this check. Existing settings and request records were preserved.")


if __name__ == "__main__":
    main()
