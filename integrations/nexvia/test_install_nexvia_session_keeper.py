"""The standalone installer must not disturb existing bridge state or sign in."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import build_session_keeper_installer as builder
import install_nexvia_session_keeper as installer


CORE = b'''VERSION=1
def main(argv=None):raise AssertionError('credential setup must not run in preflight')
def watch_running(root=None):raise AssertionError('watcher checks must not run in preflight')
'''
BROWSER = b'''MODULE_VERSION=1
def browser_session():raise AssertionError('browser connection must not run in preflight')
class SessionBrowser:
 def check(self):raise AssertionError('health request')
 def inspect_login(self):raise AssertionError('form discovery')
 def login(self,username,password,expected_schema=None):raise AssertionError('login')
 def profile_status(self):raise AssertionError('profile request')
'''


def bundled(files):
    value = {"format": "nexvia-session-keeper-release", "version": 1, "files": {
        name: {"sha256": hashlib.sha256(raw).hexdigest(),
               "contentBase64": base64.b64encode(raw).decode()}
        for name, raw in files.items()}}
    return base64.b64encode(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).decode()


class SessionKeeperInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        python = self.root / "nexvia-tools/bin/python"
        python.parent.mkdir(parents=True)
        python.symlink_to(sys.executable)
        journal = self.root / "panelstock-request-journal"
        journal.mkdir(mode=0o700)
        (journal / ".bridge.lock").touch(mode=0o600)
        (journal / "original-request.json").write_bytes(b'ORIGINAL_REQUEST_JOURNAL')
        request = self.root / "nexvia-requests/original"
        request.mkdir(parents=True, mode=0o700)
        (request / "nexvia-create-attempt.json").write_bytes(b'ORIGINAL_PO_ATTEMPT')
        (request / "nexvia-quote-upload-attempt.json").write_bytes(b'ORIGINAL_QUOTE_ATTEMPT')
        (self.root / "panelstock-requests.json").write_bytes(b'ORIGINAL_CONNECTION')
        (self.root / "nexvia_requests.py").write_bytes(b'ORIGINAL_BRIDGE_MODULE')
        (self.root / "nexvia_create.py").write_bytes(b'ORIGINAL_CREATOR_MODULE')
        private = self.root / "nexvia-session"
        private.mkdir(mode=0o700)
        (private / "credentials.json").write_bytes(b'PRIVATE_CREDENTIAL_SENTINEL')
        (private / "credentials.json").chmod(0o600)
        (private / "state.json").write_bytes(b'ORIGINAL_SESSION_STATE')
        self.files = {"nexvia_session_keeper.py": CORE, "nexvia_session_browser.py": BROWSER}
        change = patch.object(installer, "BUNDLE_BASE64", bundled(self.files))
        change.start()
        self.addCleanup(change.stop)

    def preserved(self):
        return {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob('*')
                if path.is_file() and not path.is_symlink() and path.name not in installer.FILES}

    def assert_work_lock_held(self):
        descriptor = os.open(self.root / 'panelstock-request-journal/.bridge.lock', os.O_RDONLY)
        try:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(descriptor)

    def test_new_install_and_exact_rerun_preserve_every_existing_record(self):
        before = self.preserved()
        def check(root, python, lock_fd):
            self.assert_work_lock_held()
            return True
        self.assertEqual(installer.install(self.root, checker=check), {"updated": True, "contractsVerified": True})
        for name, data in self.files.items():
            self.assertEqual((self.root / name).read_bytes(), data)
            self.assertEqual((self.root / name).stat().st_mode & 0o777, 0o600)
        self.assertEqual(installer.install(self.root, checker=check), {"updated": False, "contractsVerified": True})
        self.assertEqual(self.preserved(), before)

    def test_unknown_or_symlinked_module_refuses_before_any_publication(self):
        path = self.root / 'nexvia_session_keeper.py'
        path.write_bytes(b'OPERATOR_CODE')
        with self.assertRaisesRegex(installer.SessionInstallError, 'different contents'):
            installer.install(self.root, checker=lambda *args: self.fail('preflight called'))
        self.assertEqual(path.read_bytes(), b'OPERATOR_CODE')
        self.assertFalse((self.root / 'nexvia_session_browser.py').exists())
        path.unlink()
        path.symlink_to(self.root / 'nexvia_requests.py')
        with self.assertRaises(installer.SessionInstallError):
            installer.install(self.root, checker=lambda *args: self.fail('preflight called'))
        self.assertTrue(path.is_symlink())

    def test_contract_failure_rolls_back_only_new_modules_while_bridge_lock_is_held(self):
        before = self.preserved()
        (self.root / 'nexvia_session_keeper.py').write_bytes(CORE)
        real = installer.owned_module
        def owned(*args):
            self.assert_work_lock_held()
            return real(*args)
        with patch.object(installer, 'owned_module', owned):
            with self.assertRaisesRegex(installer.SessionInstallError, 'contracts failed'):
                installer.install(self.root, checker=lambda *args: False)
        self.assertEqual((self.root / 'nexvia_session_keeper.py').read_bytes(), CORE)
        self.assertFalse((self.root / 'nexvia_session_browser.py').exists())
        self.assertEqual(self.preserved(), before)

    def test_late_unowned_module_is_never_removed(self):
        real = installer.atomic_add
        def raced(path, data, owned):
            if path.name == 'nexvia_session_keeper.py':
                path.write_bytes(b'OTHER_OPERATOR_MODULE')
            return real(path, data, owned)
        with patch.object(installer, 'atomic_add', raced):
            with self.assertRaises(installer.SessionInstallError):
                installer.install(self.root, checker=lambda *args: True)
        self.assertEqual((self.root / 'nexvia_session_keeper.py').read_bytes(), b'OTHER_OPERATOR_MODULE')
        self.assertFalse((self.root / 'nexvia_session_browser.py').exists())

    def test_changed_owned_module_is_preserved_and_no_launch_is_attempted(self):
        def check(*args):
            (self.root / 'nexvia_session_browser.py').write_bytes(b'CHANGED_BY_OPERATOR')
            return False
        with self.assertRaisesRegex(installer.SessionInstallError, 'needs review'):
            installer.install(self.root, checker=check)
        self.assertEqual((self.root / 'nexvia_session_browser.py').read_bytes(), b'CHANGED_BY_OPERATOR')
        self.assertFalse((self.root / 'nexvia_session_keeper.py').exists())

    def test_changed_module_is_refused_before_contract_imports(self):
        real = installer.atomic_add
        def changed(path, data, owned):
            real(path, data, owned)
            path.write_bytes(b'UNREVIEWED_CONCURRENT_SOURCE')
        with patch.object(installer, 'atomic_add', changed):
            with self.assertRaisesRegex(installer.SessionInstallError, 'needs review'):
                installer.install(self.root, checker=lambda *args: self.fail('unreviewed source imported'))
        self.assertTrue(any((self.root / name).read_bytes() == b'UNREVIEWED_CONCURRENT_SOURCE'
                            for name in installer.FILES if (self.root / name).exists()))

    def test_real_isolated_contract_import_never_connects_or_calls_login(self):
        playwright = self.root / 'playwright'
        playwright.mkdir()
        (playwright / '__init__.py').write_text('')
        (playwright / 'sync_api.py').write_text('def sync_playwright():raise AssertionError("browser call")\n')
        before = self.preserved()
        self.assertTrue(installer.install(self.root)['contractsVerified'])
        self.assertEqual(self.preserved(), before)
        self.assertFalse(list(self.root.rglob('__pycache__')))

    def test_bad_bundle_version_extra_path_and_checksums_refuse_without_writes(self):
        original = installer.BUNDLE_BASE64
        for mutation in ('version', 'extra_path', 'checksum'):
            value = json.loads(base64.b64decode(original))
            if mutation == 'version':
                value['version'] = True
            elif mutation == 'extra_path':
                value['files']['../outside.py'] = value['files']['nexvia_session_keeper.py']
            else:
                value['files']['nexvia_session_keeper.py']['sha256'] = '0' * 64
            with self.subTest(mutation=mutation), patch.object(installer, 'BUNDLE_BASE64', base64.b64encode(json.dumps(value).encode()).decode()):
                with self.assertRaises(installer.SessionInstallError):
                    installer.install(self.root, checker=lambda *args: self.fail('preflight called'))
                self.assertTrue(all(not (self.root / name).exists() for name in installer.FILES))

    def test_work_lock_busy_and_symlinked_journal_refuse_without_publication(self):
        descriptor = os.open(self.root / 'panelstock-request-journal/.bridge.lock', os.O_RDONLY)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            with self.assertRaisesRegex(installer.SessionInstallError, 'busy'):
                with installer.bridge_lock(self.root, wait_seconds=0):
                    self.fail('lock acquired')
        finally:
            os.close(descriptor)
        journal = self.root / 'panelstock-request-journal'
        journal.rename(self.root / 'kept-journal')
        journal.symlink_to(self.root / 'kept-journal', target_is_directory=True)
        with self.assertRaisesRegex(installer.SessionInstallError, 'journal'):
            installer.install(self.root, checker=lambda *args: True)
        self.assertTrue(all(not (self.root / name).exists() for name in installer.FILES))

    def test_configuration_runs_only_installed_helper_without_credentials_in_arguments(self):
        python = self.root / 'nexvia-tools/bin/python'
        with patch.dict(os.environ, {'DEBUG': 'pw:api', 'PWDEBUG': '1', 'DEBUG_FILE': '/tmp/debug-private',
                                     'KEEP_SESSION_ENV': 'retained'}), \
                patch.object(installer.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            self.assertTrue(installer.configure(self.root, python))
            self.assertEqual(os.environ['DEBUG'], 'pw:api')
        args, kwargs = run.call_args
        self.assertEqual(args[0], [str(python), '-B', str(self.root / 'nexvia_session_keeper.py'), '--root', str(self.root), '--configure'])
        self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
        self.assertNotIn('input', kwargs)
        self.assertTrue(all(name not in kwargs['env'] for name in ('DEBUG', 'PWDEBUG', 'DEBUG_FILE')))
        self.assertEqual(kwargs['env']['KEEP_SESSION_ENV'], 'retained')

    def test_private_log_rejects_symlink_fifo_and_existing_public_directory(self):
        directory = self.root / 'nexvia-session'
        target = self.root / 'do-not-change'
        target.write_bytes(b'KEPT')
        log = directory / 'keeper.log'
        log.symlink_to(target)
        with self.assertRaises(OSError):
            installer.private_log(self.root)
        self.assertEqual(target.read_bytes(), b'KEPT')
        log.unlink()
        os.mkfifo(log)
        with self.assertRaises(OSError):
            installer.private_log(self.root)
        log.unlink()
        directory.chmod(0o755)
        with self.assertRaisesRegex(installer.SessionInstallError, 'already be private'):
            installer.private_log(self.root)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o755)

    def test_new_inherited_public_log_directory_is_restricted_before_log_creation(self):
        directory = self.root / 'nexvia-session'
        for path in directory.iterdir():
            path.unlink()
        directory.rmdir()
        real_mkdir = Path.mkdir
        def inherited(path, *args, **kwargs):
            result = real_mkdir(path, *args, **kwargs)
            if path == directory:
                path.chmod(0o755)
            return result
        with patch.object(Path, 'mkdir', inherited):
            descriptor = installer.private_log(self.root)
            os.close(descriptor)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual((directory / 'keeper.log').stat().st_mode & 0o777, 0o600)

    def test_log_open_stays_in_the_validated_directory_if_its_path_is_replaced(self):
        directory = self.root / 'nexvia-session'
        retained = self.root / 'original-session-directory'
        real_open = os.open
        def replaced(path, flags, *args, **kwargs):
            if path == 'keeper.log' and kwargs.get('dir_fd') is not None:
                directory.rename(retained)
                directory.mkdir(mode=0o700)
                (directory / 'keeper.log').write_bytes(b'OTHER_OPERATOR_LOG')
            return real_open(path, flags, *args, **kwargs)
        with patch.object(installer.os, 'open', replaced):
            descriptor = installer.private_log(self.root)
            os.write(descriptor, b'OWNED_LOG_ENTRY')
            os.close(descriptor)
        self.assertEqual((directory / 'keeper.log').read_bytes(), b'OTHER_OPERATOR_LOG')
        self.assertEqual((retained / 'keeper.log').read_bytes(), b'OWNED_LOG_ENTRY')

    def test_hardlinked_exact_module_is_not_treated_as_a_supported_installation(self):
        source = self.root / 'keeper-original.py'
        source.write_bytes(CORE)
        os.link(source, self.root / 'nexvia_session_keeper.py')
        with self.assertRaises(installer.SessionInstallError):
            installer.install(self.root, checker=lambda *args: self.fail('hardlinked code imported'))
        self.assertEqual(source.read_bytes(), CORE)
        self.assertFalse((self.root / 'nexvia_session_browser.py').exists())

    def test_launch_reuses_existing_watcher_or_starts_only_the_new_keeper(self):
        python = self.root / 'nexvia-tools/bin/python'
        with patch.dict(os.environ, {'DEBUG': 'pw:api', 'PWDEBUG': '1', 'DEBUG_FILE': '/tmp/debug-private'}), \
                patch.object(installer.subprocess, 'Popen') as start:
            self.assertFalse(installer.launch(self.root, python, check_running=lambda *args: True))
            start.assert_not_called()
            checks = iter((False, True))
            self.assertTrue(installer.launch(self.root, python, check_running=lambda *args: next(checks)))
            self.assertEqual(os.environ['DEBUG'], 'pw:api')
        args, kwargs = start.call_args
        self.assertEqual(args[0], [str(python), '-B', str(self.root / 'nexvia_session_keeper.py'), '--root', str(self.root), '--watch'])
        self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
        self.assertTrue(kwargs['start_new_session'])
        self.assertEqual(kwargs['umask'], 0o077)
        self.assertTrue(all(name not in kwargs['env'] for name in ('DEBUG', 'PWDEBUG', 'DEBUG_FILE')))
        self.assertEqual((self.root / 'nexvia_requests.py').read_bytes(), b'ORIGINAL_BRIDGE_MODULE')

    def test_real_unconfigured_keeper_starts_once_without_browser_or_credential_setup(self):
        core = (Path(__file__).parent / 'nexvia_session_keeper.py').read_bytes()
        files = {'nexvia_session_keeper.py': core, 'nexvia_session_browser.py': BROWSER}
        playwright = self.root / 'playwright'
        playwright.mkdir()
        (playwright / '__init__.py').write_text('')
        (playwright / 'sync_api.py').write_text('def sync_playwright():raise AssertionError("browser call")\n')
        with patch.object(installer, 'BUNDLE_BASE64', bundled(files)):
            installer.install(self.root)
        (self.root / 'nexvia-session/credentials.json').unlink()
        processes = []
        real_start = subprocess.Popen
        def start(*args, **kwargs):
            process = real_start(*args, **kwargs)
            if '--watch' in args[0]:
                processes.append(process)
            return process
        python = self.root / 'nexvia-tools/bin/python'
        try:
            with patch.object(installer.subprocess, 'Popen', start):
                self.assertTrue(installer.launch(self.root, python))
                self.assertFalse(installer.launch(self.root, python))
            self.assertEqual(len(processes), 1)
            self.assertFalse((self.root / 'nexvia-session/credentials.json').exists())
            self.assertIn('not configured', (self.root / 'nexvia-session/keeper.log').read_text())
            self.assertEqual((self.root / 'nexvia_requests.py').read_bytes(), b'ORIGINAL_BRIDGE_MODULE')
        finally:
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=5)

    def test_builder_is_exact_deterministic_and_rejects_symlink_output(self):
        source = self.root / 'source'
        source.mkdir()
        (source / 'install_nexvia_session_keeper.py').write_bytes(Path(installer.__file__).read_bytes())
        for name, data in self.files.items():
            (source / name).write_bytes(data)
        first, second = self.root / 'release.py', self.root / 'second.py'
        checksum, size = builder.build(first, source)
        self.assertEqual(builder.build(second, source), (checksum, size))
        self.assertEqual(first.read_bytes(), second.read_bytes())
        namespace = {'__name__': 'release_roundtrip'}
        exec(compile(first.read_bytes(), str(first), 'exec'), namespace)
        self.assertEqual(namespace['decoded_payload'](), self.files)
        first.unlink()
        first.symlink_to(second)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            builder.build(first, source)


if __name__ == '__main__':
    unittest.main()
