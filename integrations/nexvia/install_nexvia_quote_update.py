#!/usr/bin/env python3
"""Install the packaged quote-attachment bridge update without creating a PO.

The source template has no payload and cannot install. A packaged release must
pass a fresh read-only native preflight before enabling quote-capable claims.
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
import unicodedata

BUNDLE_BASE64 = ""
FILES = {"nexvia_requests.py", "nexvia_create.py", "nexvia_allocations.py",
         "nexvia_projects.py", "nexvia_lookups.py", "nexvia_form_data.py",
         "nexvia_po_document.py", "nexvia_quote_attachment.py", "nexvia_inspect_quote_upload.py"}
PRIOR_SHA256 = {
    "nexvia_requests.py": "da4d81797485da846cca76d9570c0ec63c65fc498db2a1f02221256389b9c3c8",
    "nexvia_create.py": "4f0ba10d13a09f48d3698e050aa16421825304c35389a36f5c16aaced85a9bdc",
    "nexvia_allocations.py": "cfa6edcb10fd628dee2462865fbe2fe28e559bbb67e76e0e49a383e799d741da",
    "nexvia_projects.py": "957191461312897be754223b187e54495808fa590e4fd04c3ff89a798485cf92",
    "nexvia_lookups.py": "500cf09a05975ef23d6a1b9a01c7398cd5db890bdf94c9ae6eb65d1430024ac3",
    "nexvia_form_data.py": "a6eee8e6c8a5d70e38b20c3c7143530fce8044a38b99f7482d175df1dd61e7bf",
    "nexvia_po_document.py": "42fd532a2df6bb10ff585d7f9435b7bafc0d137afbbaf764a65c516083856d53",
}
OPTIONAL_PRIOR_SHA256 = {"nexvia_inspect_quote_upload.py": {
    "dfa944df3a0710f1505358fb288cf20d06f88d92e155736a615b47b711c84d74",
    "838019b26d85e3e395f402926c17557aa64e546c8e22e267b1069f585f76cbb2",
}}
PYPDF_SHA256 = "47cca6b24bdcf4c4d65b5f7b8b972535c61710a061261e737688777cfd9a7bfb"
MAX_BUNDLE_BYTES = 4 * 1024 * 1024
MAX_SCRIPT_BYTES = 1024 * 1024
MAX_CONFIG_BYTES = 64 * 1024
REPORT_NAME = "nexvia-quote-update-check.json"

class QuoteUpdateError(Exception):
    """Only fixed messages are exposed; private subprocess output is hidden."""

class RollbackError(QuoteUpdateError):
    pass

def check(condition, message):
    if not condition:
        raise QuoteUpdateError(message)


def regular(path, message):
    try:
        mode = path.lstat().st_mode
    except OSError:
        raise QuoteUpdateError(message) from None
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
        raise QuoteUpdateError(message) from None


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
                    raise QuoteUpdateError(message) from None
                time.sleep(0.1)
        yield
    finally:
        os.close(descriptor)


def atomic_write(path, data, mode):
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-quote-", dir=path.parent)
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
              "A different quote-update backup exists. Nothing installed.")
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
        raise QuoteUpdateError('Process state could not be checked. Nothing installed.') from None
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
    raise QuoteUpdateError('The idle watcher did not stop. Nothing installed.')


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
        raise QuoteUpdateError('The script is installed but the watcher could not start. Run its scheduled task.') from None
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if bridge_processes(root, proc):
            return
        time.sleep(0.1)
    raise QuoteUpdateError('The script is installed; check or run the existing bridge scheduled task.')


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
    except QuoteUpdateError:
        raise
    except (ValueError, TypeError, KeyError, SyntaxError):
        raise QuoteUpdateError("Installer content is invalid. Nothing installed.") from None


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
        raise QuoteUpdateError(message) from None


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
        raise QuoteUpdateError("The private bridge configuration is invalid.") from None


def private_directory(path):
    check(not path.is_symlink(), "Unexpected quote-update backup directory.")
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    except OSError:
        raise QuoteUpdateError("The private quote-update backup could not be created.") from None
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        check(stat.S_ISDIR(info.st_mode) and (info.st_uid == os.geteuid() or os.geteuid() == 0),
              "Unexpected quote-update backup ownership.")
        os.fchmod(descriptor, 0o700)
        check(stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o700,
              "The quote-update backup could not be made private.")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def supplier_for_check(value):
    check(isinstance(value, str) and 0 < len(value.strip()) <= 500
          and all(not unicodedata.category(character).startswith("C") for character in value),
          "Choose the existing PO's supplier without control characters.")
    return value


def native_preflight(root, python, project, order_id, number, *, supplier_name):
    """Run only the quote module's read-only check; never print native output."""
    report = root / REPORT_NAME
    check(not report.is_symlink(), "Unexpected quote-check report destination.")
    try:
        if report.exists():
            regular(report, "Unexpected quote-check report destination.")
            report.unlink()
        result = subprocess.run(
            [str(python), str(root / "nexvia_quote_attachment.py"), "--check",
             "--project", str(project), "--po", str(order_id), "--number", number,
             "--supplier-name=" + supplier_name, "--output", str(report)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=90, check=False)
        value = json.loads(private_read(report, 128 * 1024, "Quote check produced no private report."))
        return (result.returncode == 0 and isinstance(value, dict)
                and value.get("format") == "nexvia-quote-upload-check"
                and type(value.get("version")) is int and value["version"] == 1
                and type(value.get("capabilityVersion")) is int and value["capabilityVersion"] == 1
                and value.get("nativeUploadReady") is True and value.get("readOnly") is True
                and value.get("uploadOrSaveInvoked") is False and value.get("fileSelectionInvoked") is False
                and type(value.get("projectPageId")) is int and value["projectPageId"] == project
                and type(value.get("purchaseOrderId")) is int and value["purchaseOrderId"] == order_id
                and value.get("purchaseOrderNumber") == number)
    except (OSError, ValueError, TypeError, subprocess.SubprocessError, QuoteUpdateError):
        return False


def validate_installed(root, files, originals):
    for name, payload in files.items():
        expected_mode = originals[name][1] if originals[name] is not None else 0o644
        check(source_read(root / name, "An installed module changed during the native quote check.")
              == (payload, expected_mode),
              "An installed module changed during the native quote check.")
    try:
        parser = private_read(root / "nexvia-po-vendor/pypdf.whl", MAX_SCRIPT_BYTES,
                              "The installed PDF parser changed during the native quote check.")
        check(hashlib.sha256(parser).hexdigest() == PYPDF_SHA256,
              "The installed PDF parser changed during the native quote check.")
    except QuoteUpdateError:
        raise RollbackError("The PDF parser changed during installation. Keep the bridge scheduled task disabled and report this message before restarting it.") from None


def validate_restored(root, originals):
    """A failed install may restart only the same known modules/dependency."""
    try:
        for name, original in originals.items():
            path = root / name
            check((original is None and not path.exists() and not path.is_symlink())
                  or (original is not None and source_read(path, "Original modules need review.") == original),
                  "Original modules changed while the installer held the bridge.")
        parser = private_read(root / "nexvia-po-vendor/pypdf.whl", MAX_SCRIPT_BYTES,
                              "Original PDF parser needs review.")
        check(hashlib.sha256(parser).hexdigest() == PYPDF_SHA256, "Original PDF parser changed.")
        read_config(root / "panelstock-requests.json")
    except QuoteUpdateError:
        raise RollbackError("The bridge's modules or dependency changed during installation. Keep its scheduled task disabled and report this message before restarting it.") from None


def install(root=Path("/config"), proc=Path("/proc"), *, project=60,
            order_id=1421, number="PO7413", check_supplier="Bunnings", launch=None, checker=None):
    root, proc = Path(root), Path(proc)
    check(root.is_dir() and not root.is_symlink(),
          "The existing configuration directory is unavailable or unsafe. Nothing installed.")
    supplier_for_check(check_supplier)
    check(type(project) is int and project > 0 and type(order_id) is int and order_id > 0
          and isinstance(number, str) and re.fullmatch(r"PO[0-9]{1,20}", number),
          "Choose the existing PO's numeric project, PO ID and displayed number.")
    files = decoded_payload()
    originals = {}
    for name in sorted(FILES):
        path = root / name
        if path.exists() or path.is_symlink():
            originals[name] = source_read(path, "An update destination is unavailable or unsafe. Nothing installed.")
        else:
            originals[name] = None
    prior_release = (all(originals[name] is not None
                         and hashlib.sha256(originals[name][0]).hexdigest() == checksum
                         for name, checksum in PRIOR_SHA256.items())
                     and originals["nexvia_quote_attachment.py"] is None
                     and all(originals[name] is None or originals[name][0] == files[name]
                             or hashlib.sha256(originals[name][0]).hexdigest() in checksums
                             for name, checksums in OPTIONAL_PRIOR_SHA256.items()))
    current_release = all(originals[name] is not None and originals[name][0] == payload
                          for name, payload in files.items())
    check(prior_release or current_release,
          "The installed modules have local changes or a different version. Nothing installed.")
    parser = root / "nexvia-po-vendor/pypdf.whl"
    check(hashlib.sha256(private_read(parser, MAX_SCRIPT_BYTES,
                                     "The installed PDF parser is unavailable or unsafe.")).hexdigest() == PYPDF_SHA256,
          "The installed PDF parser is a different version. Nothing installed.")
    config_path = root / "panelstock-requests.json"
    config_raw, config = read_config(config_path)
    check(config.get("quoteEnabled") is not True or current_release,
          "An unverified quote setting is already enabled. Nothing installed.")
    python, flock = root / "nexvia-tools/bin/python", Path("/usr/bin/flock")
    check(os.access(python, os.X_OK) and os.access(flock, os.X_OK),
          "The existing Python or flock command is unavailable. Nothing installed.")
    journal = root / "panelstock-request-journal"
    check(journal.is_dir() and not journal.is_symlink(),
          "The bridge journal is missing or has an unexpected type. Nothing installed.")
    backup = root / "nexvia-backup-before-quote-update"
    check(not backup.is_symlink(), "Unexpected quote-update backup directory.")
    if prior_release and backup.exists():
        check(backup.is_dir(), "Unexpected quote-update backup directory.")
        for name, original in originals.items():
            destination = backup / name
            if original is not None and (destination.exists() or destination.is_symlink()):
                check(private_read(destination, MAX_SCRIPT_BYTES, "Unexpected quote-update backup.") == original[0],
                      "A different quote-update backup exists. Nothing installed.")
        destination = backup / "panelstock-requests.json"
        if destination.exists() or destination.is_symlink():
            check(private_read(destination, MAX_CONFIG_BYTES, "Unexpected quote-update config backup.") == config_raw,
                  "A different quote-update config backup exists. Nothing installed.")
    launch = launch_watcher if launch is None else launch
    checker = native_preflight if checker is None else checker
    stopped, was_running, changed, failure, verified = False, False, [], None, False
    next_config_raw = None
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
                      "Bridge configuration changed during installation. Nothing installed.")
                for name, original in originals.items():
                    path = root / name
                    check((original is None and not path.exists() and not path.is_symlink())
                          or (original is not None and source_read(path, "An update destination changed during installation.") == original),
                          "An update destination changed during installation.")
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
                    for name, payload in files.items():
                        if originals[name] is not None and originals[name][0] == payload:
                            continue
                        changed.append(name)
                        atomic_write(root / name, payload, originals[name][1] if originals[name] else 0o644)
                    verified = (config.get("documentEnabled") is True
                                and checker(root, python, project, order_id, number,
                                            supplier_name=check_supplier) is True)
                    check(read_config(config_path)[0] == config_raw,
                          "Bridge configuration changed during the native quote check.")
                    validate_installed(root, files, originals)
                    if verified and config.get("quoteEnabled") is not True:
                        updated = {**config, "quoteEnabled": True}
                        next_config_raw = (json.dumps(updated, indent=2) + "\n").encode()
                        changed.append("panelstock-requests.json")
                        atomic_write(config_path, next_config_raw, 0o600)
                        config = updated
                    validate_installed(root, files, originals)
                except Exception:
                    try:
                        for name in reversed(changed):
                            destination = root / name
                            if name == "panelstock-requests.json":
                                check(private_read(destination, MAX_CONFIG_BYTES, "Config restoration needs review.")
                                      in (config_raw, next_config_raw), "Config changed during restoration.")
                                atomic_write(destination, config_raw, 0o600)
                            elif originals[name] is None:
                                if destination.exists() or destination.is_symlink():
                                    check(source_read(destination, "Module restoration needs review.")[0] == files[name],
                                          "Module changed during restoration.")
                                    destination.unlink()
                            else:
                                check(source_read(destination, "Module restoration needs review.")[0]
                                      in (originals[name][0], files[name]), "Module changed during restoration.")
                                atomic_write(destination, originals[name][0], originals[name][1])
                    except Exception:
                        raise RollbackError("Update restoration failed. Disable the bridge scheduled task and report this message before restarting it.") from None
                    raise
    except Exception as error:
        failure = error
    if failure:
        if stopped and was_running and not isinstance(failure, RollbackError):
            validate_restored(root, originals)
            try:
                launch(root, proc, python, flock)
            except Exception:
                raise QuoteUpdateError("The original bridge is retained. Restart its existing scheduled task.") from None
        if isinstance(failure, QuoteUpdateError):
            raise failure
        raise QuoteUpdateError("Installation stopped; original modules were restored. Existing PO records were preserved.") from None
    launch(root, proc, python, flock)
    return {"updated": bool(changed), "nativeUploadReady": verified,
            "quoteEnabled": config.get("quoteEnabled") is True,
            "documentEnabled": config.get("documentEnabled") is True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-project", type=int, default=60)
    parser.add_argument("--check-po", type=int, default=1421)
    parser.add_argument("--check-number", default="PO7413")
    parser.add_argument("--check-supplier", default="Bunnings")
    args = parser.parse_args(argv)
    try:
        result = install(project=args.check_project, order_id=args.check_po,
                         number=args.check_number, check_supplier=args.check_supplier)
    except QuoteUpdateError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Installation stopped safely. No PO was created, uploaded or emailed.") from None
    print("Quote attachment update installed. Existing bridge watcher is running.")
    if result["nativeUploadReady"]:
        print("Native quote controls verified. New quote requests can attach their PDF in Nexvia.")
    elif result["quoteEnabled"]:
        print("The existing quote setting was retained; this check could not verify the current native controls.")
    else:
        print("The read-only native check did not pass. New quote attachments remain disabled.")
        print("Check report: /config/" + REPORT_NAME)
    print("No file was uploaded and no PO was created or changed by this installer.")
    print("Existing settings, request records and confirmation email records were preserved.")


if __name__ == "__main__":
    main()


