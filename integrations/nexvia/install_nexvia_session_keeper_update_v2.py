#!/usr/bin/env python3
"""Update Nexvia session discovery after a read-only native compatibility check."""
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
import types

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
                and type(manifest["version"]) is int and manifest["version"] == 2
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


V1_SHA256 = {
    "nexvia_session_keeper.py": "0cba4e0514648658ff704f17e78b31dce871da781f19ffad1f24cca4e66dfd81",
    "nexvia_session_browser.py": "48e11c454244d7fdcd9a9537186a16a1b107d698effc0add801447a88eb41be6",
}
NATIVE_REASONS = frozenset({"native_password_form", "verification_required", "native_login_changed",
                          "native_login_unavailable", "login_discovery_unavailable", "native_check_unavailable"})
NATIVE_CATEGORIES = frozenset({"none", "evaluation_context_changed", "page_closed", "timeout", "reader_error", "form_dom_clobbered", "javascript_type_error", "javascript_reference_error"})
NATIVE_CHECK = r"""
import base64, contextlib, hashlib, json, os, stat, sys, types
from pathlib import Path
root=Path(sys.argv[1]); descriptor=int(sys.argv[2])
report={'format':'nexvia-session-native-check','version':2,'stage':'candidate_import','supported':False,
        'reason':'native_check_unavailable','category':'none','form':None,'readOnly':True,'credentialsRead':False,'loginSubmitted':False}
def category(error):
 text=str(error)[:20000].lower()
 return 'evaluation_context_changed' if 'execution context was destroyed' in text or 'cannot find context' in text else 'page_closed' if 'target closed' in text or 'has been closed' in text else 'timeout' if type(error).__name__=='TimeoutError' else 'form_dom_clobbered' if 'queryselectorall is not a function' in text else 'javascript_type_error' if 'typeerror' in text else 'javascript_reference_error' if 'referenceerror' in text else 'reader_error'
try:
 info=os.fstat(descriptor); current=(root/'panelstock-request-journal/.bridge.lock').stat()
 assert stat.S_ISREG(info.st_mode) and (info.st_dev,info.st_ino)==(current.st_dev,current.st_ino)
 payload=json.loads(sys.stdin.buffer.read(786433)); sys.dont_write_bytecode=True
 for name in ('nexvia_session_keeper','nexvia_session_browser'):
  module=types.ModuleType(name); module.__file__=str(root/(name+'.py')); sys.modules[name]=module
  exec(compile(base64.b64decode(payload[name],validate=True),module.__file__,'exec'),module.__dict__)
 keeper=sys.modules['nexvia_session_keeper']; browser=sys.modules['nexvia_session_browser']
 def blocked(*args,**kwargs):raise RuntimeError('read_only_native_check')
 for name in ('load_credentials','prompt_credentials','configure','run_once','run_watch','main'):
  if hasattr(keeper,name):setattr(keeper,name,blocked)
 for name in ('check','login','profile_status','_publish_anchor'):
  setattr(browser.SessionBrowser,name,blocked)
 original=browser.SessionBrowser._response
 def readonly(self,route):
  request=route.request
  assert request.method.upper() in {'GET','HEAD','OPTIONS'}
  assert browser._safe_read(request.url,request.resource_type)
  assert self._post_budget==0 and not self._sensitive
  return original(self,route)
 browser.SessionBrowser._response=readonly
 report['stage']='anonymous_form'
 with browser.browser_session() as adapter:
  original_state=adapter._state
  def observed(page):
   try:state=original_state(page)
   except Exception as error:
    report['category']=category(error)
    raise
   report['category']='none'
   forms=state.get('forms') if isinstance(state,dict) else None
   summaries=[]
   for form in forms[:12] if isinstance(forms,list) else []:
    inputs=form.get('inputs') if isinstance(form.get('inputs'),list) else []
    enabled=[item for item in inputs if isinstance(item,dict) and item.get('visible') is True and item.get('disabled') is False and item.get('owner') is True]
    action=form.get('action')
    action_path=browser._same_origin(action)
    summaries.append({'post':form.get('method')=='POST','actionAllowed':bool(browser._auth_url(action)),
      'actionPath':action_path.path if action_path is not None and browser._auth_url(action) else '[sha256]'+hashlib.sha256(str(action).split('?',1)[0].encode()).hexdigest(),
      'passwords':sum(item.get('type')=='password' for item in enabled),
      'users':sum(item.get('type') in {'text','email'} for item in enabled),
      'submits':sum(isinstance(item,dict) and item.get('type')=='submit' and item.get('visible') is True and item.get('disabled') is False and item.get('owner') is True and item.get('overrides') is False for item in form.get('buttons',[])[:20])})
   report['form']={'challenge':state.get('challenge') is True,'forms':summaries}
   return state
  adapter._state=observed
  value=adapter.inspect_login()
  report['supported']=isinstance(value,dict) and value.get('supported') is True and isinstance(value.get('schema'),dict) and bool(value['schema'])
  reason=value.get('reason') if isinstance(value,dict) else None
  if reason in {'native_password_form','verification_required','native_login_changed','native_login_unavailable','login_discovery_unavailable'}:report['reason']=reason
 report['stage']='complete'
except Exception as error:
 report['category']=category(error)
print(json.dumps(report,separators=(',',':')))
"""


def native_check(root, python, lock_fd, files):
    payload = {name[:-3]: base64.b64encode(raw).decode() for name, raw in files.items()}
    try:
        result = subprocess.run([str(python), "-I", "-B", "-c", NATIVE_CHECK, str(root), str(lock_fd)],
            input=json.dumps(payload, separators=(",", ":")).encode(), stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, pass_fds=(lock_fd,), timeout=120, check=False,
            env=session_environment())
        require(result.returncode == 0 and len(result.stdout) <= 4096,
                "Read-only native sign-in check is unavailable. Nothing installed.")
        report = json.loads(result.stdout)
        require(isinstance(report, dict) and set(report) == {"format", "version", "stage", "supported", "reason", "category", "form", "readOnly", "credentialsRead", "loginSubmitted"}
                and report["format"] == "nexvia-session-native-check" and type(report["version"]) is int and report["version"] == 2
                and type(report["supported"]) is bool and report["stage"] in {"candidate_import", "anonymous_form", "complete"}
                and report["reason"] in NATIVE_REASONS and report["category"] in NATIVE_CATEGORIES
                and report["readOnly"] is True and report["credentialsRead"] is False and report["loginSubmitted"] is False,
                "Read-only native sign-in check returned an invalid result. Nothing installed.")
        if not report["supported"] and report.get("form") is not None:
            require(len(json.dumps(report["form"])) <= 3500, "Native form metadata exceeded its bound. Nothing installed.")
            print("Native form checks:", json.dumps(report["form"], separators=(",", ":")))
        return report
    except SessionInstallError:
        raise
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        raise SessionInstallError("Read-only native sign-in check is unavailable. Nothing installed.") from None


def snapshot(root):
    result = {}
    for name in sorted(FILES):
        path = root / name
        result[name] = trusted_file(path) if path.exists() or path.is_symlink() else None
    return result


def same_snapshot(root, expected):
    actual = snapshot(root)
    identity = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    require(all(actual[name] is None if expected[name] is None else actual[name] is not None
                and actual[name][0] == expected[name][0] and identity(actual[name][1]) == identity(expected[name][1])
                for name in FILES), "Session keeper modules changed during the update. Nothing installed.")


def atomic_replace(path, data, before, owned):
    raw, info = trusted_file(path)
    require(raw == before[0] and (info.st_dev, info.st_ino, info.st_ctime_ns) == (before[1].st_dev, before[1].st_ino, before[1].st_ctime_ns),
            "A session module changed before replacement.")
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-session-v2-", dir=path.parent)
    retained = None
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), stat.S_IMODE(before[1].st_mode))
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
            current = os.fstat(stream.fileno()); retained = os.dup(stream.fileno())
            latest = trusted_file(path)
            require(latest[0] == before[0] and (latest[1].st_dev, latest[1].st_ino, latest[1].st_ctime_ns) == (info.st_dev, info.st_ino, info.st_ctime_ns),
                    "A session module changed before replacement.")
            os.replace(temporary, path)
            owned[path.name] = (current.st_dev, current.st_ino, retained); retained = None
        sync_directory(path.parent)
    finally:
        if retained is not None:os.close(retained)
        if os.path.exists(temporary):os.unlink(temporary)


@contextlib.contextmanager
def publication_locks(root, files):
    # The lifetime lock excludes a scheduled old watcher start while modules change.
    # All dedicated locks are nonblocking; no credential or state record is read.
    keeper = types.ModuleType("_session_v2_lock_contract")
    exec(compile(files["nexvia_session_keeper.py"], "nexvia_session_keeper.py", "exec"), keeper.__dict__)
    try:
        with keeper.private_directory(root, create=True) as directory, keeper.private_lock(directory, ".control.lock"):
            with bridge_lock(root) as lock_fd:
                with keeper.private_lock(directory, ".watch.lock"):
                    yield lock_fd
    except SessionInstallError:
        raise
    except Exception:
        raise SessionInstallError("Session maintenance is active or its private locks are unsafe. Nothing installed.") from None


def install(root=Path("/config"), *, checker=contract_check, native_checker=native_check):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), "The configuration directory is unavailable or unsafe.")
    python = root / "nexvia-tools/bin/python"
    require(python.is_file() and os.access(python, os.X_OK), "The existing Nexvia Python is unavailable.")
    files = decoded_payload(); existing = snapshot(root)
    fresh = all(value is None for value in existing.values())
    prior = all(existing[name] is not None and hashlib.sha256(existing[name][0]).hexdigest() == V1_SHA256[name] for name in FILES)
    patched = all(existing[name] is not None and existing[name][0] == files[name] for name in FILES)
    require(fresh or prior or patched, "Session modules are mixed, changed or unsupported. Nothing installed.")
    owned = {}; changed = []
    try:
        with publication_locks(root, files) as lock_fd:
            same_snapshot(root, existing)
            report = native_checker(root, python, lock_fd, files)
            same_snapshot(root, existing)
            require(isinstance(report, dict) and report.get("supported") is True and report.get("stage") == "complete"
                    and report.get("reason") == "native_password_form" and report.get("category") == "none",
                    "Native sign-in check did not pass (" + (report.get("stage") if isinstance(report, dict) and report.get("stage") in {"candidate_import", "anonymous_form", "complete"} else "unknown")
                    + "/" + (report.get("reason") if isinstance(report, dict) and report.get("reason") in NATIVE_REASONS else "unknown")
                    + "/" + (report.get("category") if isinstance(report, dict) and report.get("category") in NATIVE_CATEGORIES else "unknown") + "). Nothing installed.")
            try:
                for name in sorted(FILES):
                    if existing[name] is not None and existing[name][0] == files[name]:continue
                    if existing[name] is None:atomic_add(root / name, files[name], owned)
                    else:atomic_replace(root / name, files[name], existing[name], owned)
                    changed.append(name)
                for name, data in files.items():
                    require(trusted_file(root / name)[0] == data, "A session module changed before its contract check.")
                    if name in owned:owned_module(root / name, data, owned[name])
                require(checker(root, python, lock_fd) is True, "Session module contracts failed; original modules were restored.")
                for name, data in files.items():
                    require(trusted_file(root / name)[0] == data, "A session module changed during its contract check.")
                    if name in owned:owned_module(root / name, data, owned[name])
            except Exception as error:
                failed = False
                for name in reversed(list(owned)):
                    try:
                        owned_module(root / name, files[name], owned[name])
                        if existing[name] is None:
                            (root / name).unlink(); sync_directory(root)
                        else:
                            current = trusted_file(root / name)
                            restored = {}
                            try:atomic_replace(root / name, existing[name][0], current, restored)
                            finally:
                                for _, _, descriptor in restored.values():os.close(descriptor)
                    except (OSError, SessionInstallError):failed = True
                if failed:raise SessionInstallError("Session keeper update needs review. No keeper was started.") from None
                if isinstance(error, SessionInstallError):raise
                raise SessionInstallError("Session update stopped; original modules were restored.") from None
        return {"updated": bool(changed), "contractsVerified": True, "nativeVerified": True}
    finally:
        for _, _, descriptor in owned.values():os.close(descriptor)


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
        print("Nexvia session keeper v2 installed. Native sign-in and module contracts verified.")
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
