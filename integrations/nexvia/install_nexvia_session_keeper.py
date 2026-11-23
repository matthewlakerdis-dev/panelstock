#!/usr/bin/env python3
"""Install a standalone Nexvia sign-in keeper without changing the PO bridge."""
import argparse
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

BUNDLE_BASE64 = ""
FILES = frozenset({"nexvia_session_keeper.py", "nexvia_session_browser.py"})
MAX_MODULE_BYTES = 262144
MAX_BUNDLE_BYTES = 786432
BRIDGE_WAIT_SECONDS = 30


class SessionInstallError(ValueError):
    """Fixed local messages never contain credentials or browser output."""


def require(condition, message):
    if not condition:
        raise SessionInstallError(message)


def trusted_file(path, maximum=MAX_MODULE_BYTES):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                    and not before.st_mode & 0o022
                    and (before.st_uid == os.geteuid() or os.geteuid() == 0),
                    "A session keeper module is unavailable or unsafe.")
            raw = stream.read(maximum + 1)
            after = os.fstat(stream.fileno())
        identity = lambda value: (value.st_dev, value.st_ino, value.st_mode,
                                  value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        require(len(raw) <= maximum and identity(before) == identity(after),
                "A session keeper module changed while reading.")
        return raw, before
    except OSError:
        raise SessionInstallError("A session keeper module is unavailable or unsafe.") from None


def decoded_payload():
    try:
        require(isinstance(BUNDLE_BASE64, str) and 0 < len(BUNDLE_BASE64) <= 1048576,
                "This installer has no valid release bundle.")
        raw = base64.b64decode(BUNDLE_BASE64, validate=True)
        require(len(raw) <= MAX_BUNDLE_BYTES, "The session keeper bundle exceeds its bound.")
        manifest = json.loads(raw)
        require(isinstance(manifest, dict) and set(manifest) == {"format", "version", "files"}
                and manifest["format"] == "nexvia-session-keeper-release"
                and type(manifest["version"]) is int and manifest["version"] == 1
                and isinstance(manifest["files"], dict) and set(manifest["files"]) == FILES,
                "The session keeper bundle has unexpected contents.")
        result = {}
        for name, entry in manifest["files"].items():
            require(isinstance(entry, dict) and set(entry) == {"sha256", "contentBase64"}
                    and isinstance(entry["sha256"], str)
                    and re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])
                    and isinstance(entry["contentBase64"], str)
                    and len(entry["contentBase64"]) <= MAX_MODULE_BYTES * 2,
                    "The session keeper bundle has an invalid module.")
            data = base64.b64decode(entry["contentBase64"], validate=True)
            require(0 < len(data) <= MAX_MODULE_BYTES
                    and hashlib.sha256(data).hexdigest() == entry["sha256"],
                    "The session keeper module checksum differs.")
            compile(data, name, "exec")
            result[name] = data
        return result
    except SessionInstallError:
        raise
    except (ValueError, TypeError, KeyError, SyntaxError, UnicodeError):
        raise SessionInstallError("The session keeper bundle is invalid.") from None


@contextlib.contextmanager
def bridge_lock(root, wait_seconds=BRIDGE_WAIT_SECONDS):
    journal = Path(root) / "panelstock-request-journal"
    require(journal.is_dir() and not journal.is_symlink(),
            "The existing request bridge journal is unavailable or unsafe.")
    path = journal / ".bridge.lock"
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        raise SessionInstallError("The existing request bridge lock is unavailable.") from None
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600,
                "The existing request bridge lock is unsafe.")
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                require(time.monotonic() < deadline,
                        "The request bridge is busy. Let it finish and run this installer again.")
                time.sleep(0.1)
        yield descriptor
    finally:
        os.close(descriptor)


def sync_directory(root):
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_add(path, data, owned):
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-session-install-", dir=path.parent)
    retained = None
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            info = os.fstat(stream.fileno())
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


def owned_module(path, expected, ownership):
    device, inode, retained = ownership
    info = path.lstat()
    held = os.fstat(retained)
    require((info.st_dev, info.st_ino) == (device, inode)
            and (held.st_dev, held.st_ino) == (device, inode)
            and trusted_file(path)[0] == expected,
            "A newly installed session module changed; review it before starting the keeper.")


PREFLIGHT = r"""
import inspect, json, os
from pathlib import Path
import stat, sys
root = Path(sys.argv[1])
descriptor = int(sys.argv[2])
info = os.fstat(descriptor)
current = (root/'panelstock-request-journal/.bridge.lock').stat()
assert stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) == (current.st_dev, current.st_ino)
sys.dont_write_bytecode = True
sys.path.insert(0, str(root))
import nexvia_session_keeper as keeper
import nexvia_session_browser as browser
assert keeper.VERSION == 1
assert callable(keeper.main) and callable(keeper.watch_running)
inspect.signature(keeper.main).bind([])
inspect.signature(keeper.watch_running).bind(root)
assert browser.MODULE_VERSION == 1
assert callable(browser.browser_session)
for method, args in (('check', ()), ('inspect_login', ()), ('login', ('user', 'password')), ('profile_status', ())):
    inspect.signature(getattr(browser.SessionBrowser, method)).bind(None, *args)
inspect.signature(browser.SessionBrowser.login).bind(None, 'user', 'password', expected_schema=None)
import playwright.sync_api
print(json.dumps({'format':'nexvia-session-install-check','version':1,'contractsVerified':True,
                  'browserConnected':False,'loginSubmitted':False,'poChanged':False},separators=(',',':')))
"""


def contract_check(root, python, lock_fd):
    try:
        result = subprocess.run([str(python), "-I", "-B", "-c", PREFLIGHT, str(root), str(lock_fd)],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, pass_fds=(lock_fd,), timeout=30, check=False)
        if result.returncode != 0 or len(result.stdout) > 4096:
            return False
        return json.loads(result.stdout) == {"format": "nexvia-session-install-check", "version": 1,
            "contractsVerified": True, "browserConnected": False, "loginSubmitted": False, "poChanged": False}
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return False


def install(root=Path("/config"), *, checker=contract_check):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), "The configuration directory is unavailable or unsafe.")
    python = root / "nexvia-tools/bin/python"
    require(python.is_file() and os.access(python, os.X_OK), "The existing Nexvia Python is unavailable.")
    files = decoded_payload()
    existing = {}
    for name, data in files.items():
        path = root / name
        if path.exists() or path.is_symlink():
            require(trusted_file(path)[0] == data,
                    "A session keeper module already exists with different contents. Nothing installed.")
            existing[name] = data
    owned = {}
    try:
        with bridge_lock(root) as lock_fd:
            try:
                # Recheck after acquiring the work lock; never replace another file.
                for name, data in files.items():
                    path = root / name
                    if name in existing:
                        require(trusted_file(path)[0] == data,
                                "A session keeper module changed before installation.")
                    else:
                        atomic_add(path, data, owned)
                for name, data in files.items():
                    require(trusted_file(root / name)[0] == data,
                            "A session keeper module changed before its contract check.")
                    if name in owned:
                        owned_module(root / name, data, owned[name])
                require(checker(root, python, lock_fd) is True,
                        "Session keeper module contracts failed. Newly installed modules were removed.")
                for name, data in files.items():
                    require(trusted_file(root / name)[0] == data,
                            "A session keeper module changed during installation.")
                    if name in owned:
                        owned_module(root / name, data, owned[name])
            except Exception as error:
                restoration_failed = False
                for name, ownership in reversed(list(owned.items())):
                    try:
                        owned_module(root / name, files[name], ownership)
                        (root / name).unlink()
                        sync_directory(root)
                    except (OSError, SessionInstallError):
                        restoration_failed = True
                if restoration_failed:
                    raise SessionInstallError("Session keeper installation needs review. No keeper was started.") from None
                if isinstance(error, SessionInstallError):
                    raise
                raise SessionInstallError("Session keeper installation stopped; newly installed modules were removed.") from None
        return {"updated": bool(owned), "contractsVerified": True}
    finally:
        for _device, _inode, descriptor in owned.values():
            os.close(descriptor)


def configure(root, python):
    try:
        result = subprocess.run([str(python), "-B", str(root / "nexvia_session_keeper.py"),
                                 "--root", str(root), "--configure"],
                                stdin=subprocess.DEVNULL, env=session_environment(), check=False)
        return result.returncode == 0
    except OSError:
        return False


def session_environment():
    """Exclude Playwright tracing controls from credential-bearing processes."""
    environment = os.environ.copy()
    for name in ("DEBUG", "PWDEBUG", "DEBUG_FILE"):
        environment.pop(name, None)
    return environment


def private_log(root):
    directory = root / "nexvia-session"
    created = False
    try:
        directory.mkdir(mode=0o700)
        created = True
    except FileExistsError:
        pass
    directory_descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        info = os.fstat(directory_descriptor)
        require(info.st_uid == os.geteuid(), "The private session directory has unexpected ownership.")
        if created:
            os.fchmod(directory_descriptor, 0o700)
        require(stat.S_IMODE(os.fstat(directory_descriptor).st_mode) == 0o700,
                "The session directory must already be private.")
        descriptor = os.open("keeper.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK,
                             0o600, dir_fd=directory_descriptor)
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid(),
                "The session keeper log is unsafe.")
        os.fchmod(descriptor, 0o600)
        return descriptor
    except Exception:
        if descriptor is not None:
            os.close(descriptor)
        raise
    finally:
        os.close(directory_descriptor)


RUNNING_CHECK = r"""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,sys.argv[1])
import nexvia_session_keeper as keeper
print('running' if keeper.watch_running(Path(sys.argv[1])) else 'stopped')
"""


def running(root, python):
    result = subprocess.run([str(python), "-I", "-B", "-c", RUNNING_CHECK, str(root)],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=15, check=False)
    require(result.returncode == 0 and result.stdout.strip() in {b"running", b"stopped"},
            "The installed session keeper could not be checked.")
    return result.stdout.strip() == b"running"


def launch(root, python, *, check_running=running):
    if check_running(root, python):
        return False
    descriptor = private_log(root)
    with os.fdopen(descriptor, "ab") as log:
        subprocess.Popen([str(python), "-B", str(root / "nexvia_session_keeper.py"),
                          "--root", str(root), "--watch"],
                         stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                         close_fds=True, start_new_session=True, umask=0o077,
                         env=session_environment())
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if check_running(root, python):
            return True
        time.sleep(0.1)
    raise SessionInstallError("Session keeper installed; its watcher did not start. Check its private status.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/config"))
    parser.add_argument("--configure", action="store_true", help="Collect credentials locally through the NAS terminal")
    parser.add_argument("--start", action="store_true", help="Start an already configured keeper")
    parser.add_argument("--no-start", action="store_true", help="Install/configure without starting its watcher")
    args = parser.parse_args(argv)
    try:
        result = install(args.root)
        print("Standalone Nexvia session keeper installed. Module contracts verified.")
        if args.configure and not configure(args.root, args.root / "nexvia-tools/bin/python"):
            print("Sign-in setup did not complete. No new session keeper watcher was started.")
            return 1
        if (args.configure or args.start) and not args.no_start:
            launch(args.root, args.root / "nexvia-tools/bin/python")
            print("Session keeper watcher is running.")
        elif not args.configure:
            print("Run the installed keeper with --configure to enable automatic sign-in.")
        print("Existing PO bridge modules, configuration, requests and upload records were preserved.")
        return 0
    except SessionInstallError as error:
        print(str(error))
        return 1
    except Exception:
        print("Session keeper setup stopped safely. Existing requests and credentials were preserved.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
