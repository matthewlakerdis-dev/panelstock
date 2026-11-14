#!/usr/bin/env python3
"""Install a read-only saved-PO verification patch without recreating an order.

The source template has no release payload. This installer never reconciles a
server result, uploads a file, creates a PO or sends an email.
"""
import argparse
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
FILES = {"nexvia_allocations.py", "nexvia_reconcile_existing_po.py"}
PRIOR_SHA256 = {'nexvia_allocations.py': 'f4fe674e8a913da466abe0c12a5124ff9ade89d2ab7e655fe58f6ad9196fb5f1', 'nexvia_create.py': 'dbeab8760d5cd3d29dade83e225b262327e5be1b559b6ebdcbd0233542988369', 'nexvia_form_data.py': '38c9bcaefd23772fe7e147d2fc61f39a25f57956638171cd8c5e3d5d011dbc6b', 'nexvia_inspect_quote_upload.py': 'f3437c0e06b4091ec6da5c3fbce76426eb669b1669d5efd0b81d29ccd96ab4af', 'nexvia_lookups.py': '500cf09a05975ef23d6a1b9a01c7398cd5db890bdf94c9ae6eb65d1430024ac3', 'nexvia_po_document.py': '42fd532a2df6bb10ff585d7f9435b7bafc0d137afbbaf764a65c516083856d53', 'nexvia_projects.py': '957191461312897be754223b187e54495808fa590e4fd04c3ff89a798485cf92', 'nexvia_quote_attachment.py': 'a35f4964d1ae52c1167147c6e4370aa5b64234a37bb2acf4986362f079811d5e', 'nexvia_requests.py': '0e5df9a1caf818862fa383005e20b422b3306abff12cdbc1d2573b73688a3a9c'}
PYPDF_SHA256 = "47cca6b24bdcf4c4d65b5f7b8b972535c61710a061261e737688777cfd9a7bfb"
MAX_BUNDLE_BYTES = 2 * 1024 * 1024
MAX_SCRIPT_BYTES = 1024 * 1024
MAX_CONFIG_BYTES = 64 * 1024
REPORT_NAME = "nexvia-verification-update-check.json"
DEFAULT_REQUEST = "bbdadaff-35de-4bab-9680-403a989e454c"

class VerificationUpdateError(Exception):
    """Fixed messages only; private native output is never printed."""

class RollbackError(VerificationUpdateError):
    pass

def check(condition, message):
    if not condition:
        raise VerificationUpdateError(message)


def regular(path, message):
    try:
        mode = path.lstat().st_mode
    except OSError:
        raise VerificationUpdateError(message) from None
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
        raise VerificationUpdateError(message) from None


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
                    raise VerificationUpdateError(message) from None
                time.sleep(0.1)
        yield descriptor
    finally:
        os.close(descriptor)


def atomic_write(path, data, mode):
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-verification-", dir=path.parent)
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
              "A different verification-update backup exists. Nothing installed.")
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
        raise VerificationUpdateError('Process state could not be checked. Nothing installed.') from None
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
    raise VerificationUpdateError('The idle watcher did not stop. Nothing installed.')


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
        raise VerificationUpdateError('The script is installed but the watcher could not start. Run its scheduled task.') from None
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if bridge_processes(root, proc):
            return
        time.sleep(0.1)
    raise VerificationUpdateError('The script is installed; check or run the existing bridge scheduled task.')


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
        raise VerificationUpdateError(message) from None


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
        raise VerificationUpdateError("The private bridge configuration is invalid.") from None


def private_directory(path):
    check(not path.is_symlink(), "Unexpected verification-update backup directory.")
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    except OSError:
        raise VerificationUpdateError("The private verification-update backup could not be created.") from None
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        check(stat.S_ISDIR(info.st_mode) and (info.st_uid == os.geteuid() or os.geteuid() == 0),
              "Unexpected verification-update backup ownership.")
        os.fchmod(descriptor, 0o700)
        check(stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o700,
              "The verification-update backup could not be made private.")
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
            files[name] = data
        return files
    except VerificationUpdateError:
        raise
    except (ValueError, TypeError, KeyError, SyntaxError):
        raise VerificationUpdateError("Installer content is invalid. Nothing installed.") from None


def identity(request_id, project, order_id, number):
    try:
        check(isinstance(request_id, str) and str(uuid.UUID(request_id)) == request_id,
              "Choose the existing request's complete UUID.")
    except (ValueError, TypeError, AttributeError):
        raise VerificationUpdateError("Choose the existing request's complete UUID.") from None
    check(type(project) is int and project > 0 and type(order_id) is int and order_id > 0
          and isinstance(number, str) and re.fullmatch(r"PO[0-9]{1,20}", number),
          "Choose the existing PO's numeric project, PO ID and displayed number.")


def preflight(root, python, request_id, project, order_id, number, *, bridge_lock_fd):
    """Check only the existing PO while sharing the installer's work lock."""
    report = root / REPORT_NAME
    check(not report.is_symlink(), "Unexpected verification-check report destination.")
    try:
        if report.exists():
            regular(report, "Unexpected verification-check report destination.")
            report.unlink()
        result = subprocess.run(
            [str(python), str(root / "nexvia_reconcile_existing_po.py"), "--check",
             "--request", request_id, "--project", str(project), "--po", str(order_id), "--number", number,
             "--bridge-lock-fd", str(bridge_lock_fd), "--output", str(report)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            pass_fds=(bridge_lock_fd,), timeout=90, check=False)
        value = json.loads(private_read(report, 128 * 1024, "Existing PO check produced no private report."))
        return (result.returncode == 0 and isinstance(value, dict)
                and value.get("format") == "nexvia-existing-po-check"
                and type(value.get("version")) is int and value["version"] == 1
                and value.get("nativeVerified") is True and value.get("readOnly") is True
                and value.get("poCreated") is False and value.get("poChanged") is False
                and value.get("resultWritten") is False and value.get("requestId") == request_id
                and type(value.get("projectPageId")) is int and value["projectPageId"] == project
                and type(value.get("purchaseOrderId")) is int and value["purchaseOrderId"] == order_id
                and value.get("purchaseOrderNumber") == number)
    except (OSError, ValueError, TypeError, subprocess.SubprocessError, VerificationUpdateError):
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
    check(snapshot(root) == expected, "Installed modules changed during the verification update.")
    check_parser(root)


def protected_request(root, request_id):
    """Fingerprint existing immutable creation files without storing their data."""
    folder = root / "nexvia-requests" / request_id
    check(folder.is_dir() and not folder.is_symlink(), "The existing local request folder is unavailable.")
    names = {"request.json", "nexvia-prepared.json", "nexvia-create-attempt.json",
             "nexvia-create-response.html", "nexvia-result.json"}
    paths = [folder / name for name in sorted(names)]
    journal = root / "panelstock-request-journal"
    paths.extend(sorted(journal.glob("*" + request_id + "*.json")))
    result = {}
    for path in paths:
        if not path.exists() and not path.is_symlink():
            result[str(path.relative_to(root))] = None
            continue
        raw = private_read(path, 16 * 1024 * 1024, "An immutable request file is unavailable or unsafe.")
        info = path.lstat()
        result[str(path.relative_to(root))] = (hashlib.sha256(raw).hexdigest(), info.st_mode,
                                             info.st_dev, info.st_ino, info.st_mtime_ns)
    return result


def install(root=Path("/config"), proc=Path("/proc"), *, request_id=DEFAULT_REQUEST,
            project=36, order_id=1422, number="PO7414", launch=None, checker=None):
    root, proc = Path(root), Path(proc)
    identity(request_id, project, order_id, number)
    check(root.is_dir() and not root.is_symlink(), "The configuration directory is unavailable or unsafe.")
    files = decoded_payload()
    originals = snapshot(root)
    prior_release = all(originals[name] is not None
                        and hashlib.sha256(originals[name][0]).hexdigest() == checksum
                        for name, checksum in PRIOR_SHA256.items()) and originals["nexvia_reconcile_existing_po.py"] is None
    patched_release = all(originals[name] is not None and
                          (originals[name][0] == files[name] if name in files
                           else hashlib.sha256(originals[name][0]).hexdigest() == checksum)
                          for name, checksum in PRIOR_SHA256.items())
    patched_release = patched_release and originals["nexvia_reconcile_existing_po.py"] is not None and originals["nexvia_reconcile_existing_po.py"][0] == files["nexvia_reconcile_existing_po.py"]
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
    backup = root / "nexvia-backup-before-verification-update"
    check(not backup.is_symlink(), "Unexpected verification-update backup directory.")
    if prior_release and backup.exists():
        check(backup.is_dir(), "Unexpected verification-update backup directory.")
        for name, original in originals.items():
            path = backup / name
            if original is not None and (path.exists() or path.is_symlink()):
                check(private_read(path, MAX_SCRIPT_BYTES, "Unexpected verification backup.") == original[0],
                      "A different verification backup exists. Nothing installed.")
        path = backup / "panelstock-requests.json"
        if path.exists() or path.is_symlink():
            check(private_read(path, MAX_CONFIG_BYTES, "Unexpected private config backup.") == config_raw,
                  "A different private config backup exists. Nothing installed.")
    launch = launch_watcher if launch is None else launch
    checker = preflight if checker is None else checker
    expected = expected_release(files, originals)
    stopped, was_running, changed, failure, verified = False, False, [], None, False
    try:
        with lock_file(journal / ".bridge.lock",
                       "The bridge is handling work. Let it finish, then run this installer again.") as bridge_lock_fd:
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
                evidence = protected_request(root, request_id)
                try:
                    if prior_release:
                        private_directory(backup)
                        for name, original in originals.items():
                            if original is not None:
                                backup_once(backup / name, original[0])
                        backup_once(backup / "panelstock-requests.json", config_raw)
                        descriptor = os.open(backup, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                        try:
                            os.fsync(descriptor)
                        finally:
                            os.close(descriptor)
                    for name, data in files.items():
                        if originals[name] is not None and originals[name][0] == data:
                            continue
                        changed.append(name)
                        atomic_write(root / name, data, expected[name][1])
                    verified = checker(root, python, request_id, project, order_id, number,
                                       bridge_lock_fd=bridge_lock_fd) is True
                    check(verified, "The existing PO could not be verified. Original modules were restored; run this installer again after checking sign-in.")
                    check(read_config(config_path)[0] == config_raw,
                          "Bridge configuration changed during the existing PO check.")
                    check_snapshot(root, expected)
                    check(protected_request(root, request_id) == evidence,
                          "Existing request evidence changed during the read-only check.")
                except Exception:
                    try:
                        for name in reversed(changed):
                            path = root / name
                            if originals[name] is None:
                                if path.exists() or path.is_symlink():
                                    check(source_read(path, "Module restoration needs review.")[0] == files[name],
                                          "An installed module changed during restoration.")
                                    path.unlink()
                            else:
                                check(source_read(path, "Module restoration needs review.")[0] in (originals[name][0], files[name]),
                                      "An installed module changed during restoration.")
                                atomic_write(path, originals[name][0], originals[name][1])
                        check(protected_request(root, request_id) == evidence,
                              "Existing request evidence changed during the read-only check.")
                    except Exception:
                        raise RollbackError("Verification update restoration needs review. Keep the bridge scheduled task disabled and report this message before restarting it.") from None
                    raise
    except Exception as error:
        failure = error
    if failure:
        if stopped and was_running and not isinstance(failure, RollbackError):
            try:
                check_snapshot(root, originals)
                check(read_config(config_path)[0] == config_raw,
                      "Bridge configuration changed during installation.")
            except VerificationUpdateError:
                raise RollbackError("Modules, configuration or dependencies changed during installation. Keep the bridge scheduled task disabled and report this message before restarting it.") from None
            try:
                launch(root, proc, python, flock)
            except Exception:
                raise VerificationUpdateError("The original bridge is retained. Restart its existing scheduled task.") from None
        if isinstance(failure, VerificationUpdateError):
            raise failure
        raise VerificationUpdateError("Installation stopped; original modules were restored. Existing request evidence was preserved.") from None
    launch(root, proc, python, flock)
    return {"updated": bool(changed), "nativeVerified": verified,
            "requestId": request_id, "projectPageId": project,
            "purchaseOrderId": order_id, "purchaseOrderNumber": number}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", default=DEFAULT_REQUEST)
    parser.add_argument("--project", type=int, default=36)
    parser.add_argument("--po", type=int, default=1422)
    parser.add_argument("--number", default="PO7414")
    args = parser.parse_args(argv)
    try:
        result = install(request_id=args.request, project=args.project, order_id=args.po, number=args.number)
    except VerificationUpdateError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Verification update stopped safely. No PO was created, changed, uploaded or emailed.") from None
    print("Saved-PO verification patch installed. Existing bridge watcher is running.")
    print("Existing PO verification:", "passed" if result["nativeVerified"] else "not verified")
    print("No PO was created or changed. No file was uploaded or emailed.")
    print("Configuration, original request, preparation, attempt and main journal were preserved.")


if __name__ == "__main__":
    main()


