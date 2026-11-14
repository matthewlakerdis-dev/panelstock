#!/usr/bin/env python3
"""Install daily Nexvia reference caching without changing purchase orders.

The source template has no release payload. The packaged installer checks module
contracts locally. It performs no Nexvia request, upload, PO creation or email.
The restarted watcher refreshes reference data while the connection is enabled.
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

BUNDLE_BASE64 = ""
FILES = {"nexvia_requests.py", "nexvia_form_data.py", "nexvia_projects.py"}
# Exact deployed quote bridge plus its saved-PO verification patch. No local
# edit, mixed release or unreviewed creation module may be silently overwritten.
PRIOR_SHA256 = {
    "nexvia_requests.py": "0e5df9a1caf818862fa383005e20b422b3306abff12cdbc1d2573b73688a3a9c",
    "nexvia_create.py": "dbeab8760d5cd3d29dade83e225b262327e5be1b559b6ebdcbd0233542988369",
    "nexvia_allocations.py": "071cb5f796b0cd91bfe1ce67d7c1799ea0066ae8119a78d2d19c715e6a3fefe9",
    "nexvia_projects.py": "957191461312897be754223b187e54495808fa590e4fd04c3ff89a798485cf92",
    "nexvia_lookups.py": "500cf09a05975ef23d6a1b9a01c7398cd5db890bdf94c9ae6eb65d1430024ac3",
    "nexvia_form_data.py": "38c9bcaefd23772fe7e147d2fc61f39a25f57956638171cd8c5e3d5d011dbc6b",
    "nexvia_po_document.py": "42fd532a2df6bb10ff585d7f9435b7bafc0d137afbbaf764a65c516083856d53",
    "nexvia_quote_attachment.py": "a35f4964d1ae52c1167147c6e4370aa5b64234a37bb2acf4986362f079811d5e",
    "nexvia_inspect_quote_upload.py": "f3437c0e06b4091ec6da5c3fbce76426eb669b1669d5efd0b81d29ccd96ab4af",
    "nexvia_reconcile_existing_po.py": "acd7291dc9fa996fe8c5ec1d1b5180762caf080e30973785182236acd335c228",
}
PYPDF_SHA256 = "47cca6b24bdcf4c4d65b5f7b8b972535c61710a061261e737688777cfd9a7bfb"
MAX_BUNDLE_BYTES = 2 * 1024 * 1024
MAX_SCRIPT_BYTES = 1024 * 1024
MAX_CONFIG_BYTES = 64 * 1024

class CacheUpdateError(Exception):
    """Fixed messages only; private native output is never printed."""

class RollbackError(CacheUpdateError):
    pass

def check(condition, message):
    if not condition:
        raise CacheUpdateError(message)


def regular(path, message):
    try:
        mode = path.lstat().st_mode
    except OSError:
        raise CacheUpdateError(message) from None
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
        raise CacheUpdateError(message) from None


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
                    raise CacheUpdateError(message) from None
                time.sleep(0.1)
        yield descriptor
    finally:
        os.close(descriptor)


def atomic_write(path, data, mode):
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-cache-", dir=path.parent)
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
              "A different cache-update backup exists. Nothing installed.")
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
        raise CacheUpdateError('Process state could not be checked. Nothing installed.') from None
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
    raise CacheUpdateError('The idle watcher did not stop. Nothing installed.')


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
        raise CacheUpdateError('The script is installed but the watcher could not start. Run its scheduled task.') from None
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if bridge_processes(root, proc):
            return
        time.sleep(0.1)
    raise CacheUpdateError('The script is installed; check or run the existing bridge scheduled task.')


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
        raise CacheUpdateError(message) from None


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
        raise CacheUpdateError("The private bridge configuration is invalid.") from None


def private_directory(path):
    check(not path.is_symlink(), "Unexpected cache-update backup directory.")
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    except OSError:
        raise CacheUpdateError("The private cache-update backup could not be created.") from None
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        check(stat.S_ISDIR(info.st_mode) and (info.st_uid == os.geteuid() or os.geteuid() == 0),
              "Unexpected cache-update backup ownership.")
        os.fchmod(descriptor, 0o700)
        check(stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o700,
              "The cache-update backup could not be made private.")
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
    except CacheUpdateError:
        raise
    except (ValueError, TypeError, KeyError, SyntaxError):
        raise CacheUpdateError("Installer content is invalid. Nothing installed.") from None


PREFLIGHT = r"""
import importlib
import json
import os
from pathlib import Path
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
    'nexvia_quote_attachment', 'nexvia_reconcile_existing_po')}
assert modules['nexvia_requests'].SNAPSHOT_REFRESH_SECONDS == 24 * 60 * 60
assert modules['nexvia_requests'].REFERENCE_CACHE_VERSION == 1
assert modules['nexvia_requests'].WATCH_IDLE_SECONDS == 2
assert modules['nexvia_form_data'].MAX_SNAPSHOT_AGE == 30 * 24 * 60 * 60
assert modules['nexvia_projects'].REFRESH_SECONDS == 24 * 60 * 60
assert modules['nexvia_projects'].RETRY_SECONDS == 15 * 60
print(json.dumps({'format': 'nexvia-cache-contract-check', 'version': 1,
                  'contractsVerified': True, 'readOnly': True,
                  'poCreated': False, 'poChanged': False, 'fileUploaded': False,
                  'emailSent': False}))
"""


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
        return value == {"format": "nexvia-cache-contract-check", "version": 1,
                         "contractsVerified": True, "readOnly": True,
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
    check(snapshot(root) == expected, "Installed modules changed during the cache update.")
    check_parser(root)


def protected_state(root):
    """Fingerprint every local request/journal entry without reading PDF bytes.

    The work lock prevents bridge mutations. Device/inode, mode, size and both
    nanosecond timestamps detect concurrent rewrites, additions and removals.
    Cache import preflight is read-only and may not change these trees at all.
    """
    result = {}
    for name in ("nexvia-requests", "panelstock-request-journal"):
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


def install(root=Path("/config"), proc=Path("/proc"), *, launch=None, checker=None):
    root, proc = Path(root), Path(proc)
    check(root.is_dir() and not root.is_symlink(), "The configuration directory is unavailable or unsafe.")
    files = decoded_payload()
    originals = snapshot(root)
    prior_release = all(originals[name] is not None
                        and hashlib.sha256(originals[name][0]).hexdigest() == checksum
                        for name, checksum in PRIOR_SHA256.items())
    patched_release = all(originals[name] is not None and
                          (originals[name][0] == files[name] if name in files
                           else hashlib.sha256(originals[name][0]).hexdigest() == checksum)
                          for name, checksum in PRIOR_SHA256.items())
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
    backup = root / "nexvia-backup-before-cache-update"
    check(not backup.is_symlink(), "Unexpected cache-update backup directory.")
    if prior_release and backup.exists():
        check(backup.is_dir(), "Unexpected cache-update backup directory.")
        for name in sorted(FILES | {"panelstock-requests.json"}):
            path = backup / name
            if path.exists() or path.is_symlink():
                expected = config_raw if name == "panelstock-requests.json" else originals[name][0]
                check(private_read(path, MAX_SCRIPT_BYTES, "Unexpected cache backup.") == expected,
                      "A different cache-update backup exists. Nothing installed.")
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
                evidence = protected_state(root)
                try:
                    if prior_release:
                        private_directory(backup)
                        for name in sorted(FILES):
                            backup_once(backup / name, originals[name][0])
                        backup_once(backup / "panelstock-requests.json", config_raw)
                        descriptor = os.open(backup, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                        try:
                            os.fsync(descriptor)
                        finally:
                            os.close(descriptor)
                    for name, data in files.items():
                        if originals[name][0] == data:
                            continue
                        changed.append(name)
                        atomic_write(root / name, data, expected[name][1])
                    verified = checker(root, python, bridge_lock_fd=bridge_lock_fd) is True
                    check(verified, "Cache module contracts could not be verified. Original modules were restored.")
                    check(read_config(config_path)[0] == config_raw,
                          "Bridge configuration changed during the cache check.")
                    check_snapshot(root, expected)
                    check(protected_state(root) == evidence,
                          "Existing request evidence changed during the read-only cache check.")
                except Exception:
                    try:
                        for name in reversed(changed):
                            path = root / name
                            check(source_read(path, "Module restoration needs review.")[0] in (originals[name][0], files[name]),
                                  "An installed module changed during restoration.")
                            atomic_write(path, originals[name][0], originals[name][1])
                        check(protected_state(root) == evidence,
                              "Existing request evidence changed during the read-only cache check.")
                    except Exception:
                        raise RollbackError("Cache update restoration needs review. Keep the bridge scheduled task disabled and report this message before restarting it.") from None
                    raise
    except Exception as error:
        failure = error
    if failure:
        if stopped and was_running and not isinstance(failure, RollbackError):
            try:
                check_snapshot(root, originals)
                check(read_config(config_path)[0] == config_raw,
                      "Bridge configuration changed during installation.")
            except CacheUpdateError:
                raise RollbackError("Modules, configuration or dependencies changed during installation. Keep the bridge scheduled task disabled and report this message before restarting it.") from None
            try:
                launch(root, proc, python, flock)
            except Exception:
                raise CacheUpdateError("The original bridge is retained. Restart its existing scheduled task.") from None
        if isinstance(failure, CacheUpdateError):
            raise failure
        raise CacheUpdateError("Installation stopped; original modules were restored. Existing request evidence was preserved.") from None
    launch(root, proc, python, flock)
    return {"updated": bool(changed), "contractsVerified": verified}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)
    try:
        result = install()
    except CacheUpdateError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Cache update stopped safely. No PO was created, changed, uploaded or emailed.") from None
    print("Daily reference-cache update installed. Existing bridge watcher is running.")
    print("Module contracts:", "verified" if result["contractsVerified"] else "not verified")
    print("Reference data refreshes daily while the existing connection is enabled.")
    print("No PO was created or changed. No file was uploaded or emailed by this installer.")
    print("Configuration and existing request, quote and confirmation records were preserved.")


if __name__ == "__main__":
    main()
