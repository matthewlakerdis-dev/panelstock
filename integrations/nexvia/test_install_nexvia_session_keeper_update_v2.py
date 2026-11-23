"""Atomic v1 upgrade and anonymous-only candidate checks before any publication."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import install_nexvia_session_keeper_update_v2 as installer
import build_session_keeper_installer as old_builder
import build_session_keeper_v2_installer as builder

ARCHIVE=Path(__file__).parent/'releases/install_nexvia_session_keeper_v1.py'
archive_ns={'__name__':'immutable_v1_fixture'}
exec(compile(ARCHIVE.read_bytes(),str(ARCHIVE),'exec'),archive_ns)
LEGACY=archive_ns['decoded_payload']()
CORE=LEGACY['nexvia_session_keeper.py']
BROWSER=b'''from contextlib import contextmanager
MODULE_VERSION=1
def _safe_read(url,resource):return url=='https://lennox.nexvia.com.au/staff/login'
class SessionBrowser:
 _post_budget=0
 _sensitive=()
 def _response(self,route):return route.fetch(max_redirects=0)
 def _state(self,page):return {'forms':[],'challenge':False}
 def check(self):raise AssertionError('health must not be called')
 def login(self,username,password,expected_schema=None):raise AssertionError('login must not be called')
 def profile_status(self):raise AssertionError('profile must not be called')
 def inspect_login(self):
  self._state(None)
  return {'supported':True,'reason':'native_password_form','schema':{'native':True}}
@contextmanager
def browser_session():yield SessionBrowser()
'''

def bundle(files):
    return base64.b64encode(json.dumps({'format':'nexvia-session-keeper-release','version':2,'files':{
        name:{'sha256':hashlib.sha256(raw).hexdigest(),'contentBase64':base64.b64encode(raw).decode()}
        for name,raw in files.items()}},sort_keys=True,separators=(',',':')).encode()).decode()


def passed(*args):
    return {'stage':'complete','supported':True,'reason':'native_password_form','category':'none'}


class SessionV2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        python=self.root/'nexvia-tools/bin/python';python.parent.mkdir(parents=True);python.symlink_to(sys.executable)
        journal=self.root/'panelstock-request-journal';journal.mkdir(mode=0o700)
        (journal/'.bridge.lock').touch(mode=0o600)
        (journal/'request-original.json').write_bytes(b'ORIGINAL_REQUEST')
        (self.root/'nexvia_create.py').write_bytes(b'ORIGINAL_CREATOR')
        (self.root/'panelstock-requests.json').write_bytes(b'ORIGINAL_CONFIG')
        private=self.root/'nexvia-session';private.mkdir(mode=0o700)
        for name in ('credentials.json','state.json'):
            (private/name).write_bytes(b'PRIVATE_KEEP');(private/name).chmod(0o600)
        playwright=self.root/'playwright';playwright.mkdir()
        (playwright/'__init__.py').write_text('');(playwright/'sync_api.py').write_text('')
        self.files={'nexvia_session_keeper.py':CORE,'nexvia_session_browser.py':BROWSER}
        change=patch.object(installer,'BUNDLE_BASE64',bundle(self.files));change.start();self.addCleanup(change.stop)

    def preserve(self):
        return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file() and not p.is_symlink()
                and p.name not in installer.FILES and p.name not in {'.control.lock','.watch.lock'}}

    def legacy(self):
        for name,raw in LEGACY.items():(self.root/name).write_bytes(raw)

    def assert_locks(self):
        for path in ('panelstock-request-journal/.bridge.lock','nexvia-session/.control.lock','nexvia-session/.watch.lock'):
            fd=os.open(self.root/path,os.O_RDONLY)
            try:
                with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:os.close(fd)

    def test_fresh_and_v1_upgrade_and_exact_rerun_preserve_all_records(self):
        for legacy in (False,True):
            if legacy:self.legacy()
            before=self.preserve()
            def native(*args):
                self.assert_locks()
                if legacy:self.assertEqual((self.root/'nexvia_session_browser.py').read_bytes(),LEGACY['nexvia_session_browser.py'])
                return passed()
            result=installer.install(self.root,native_checker=native,checker=lambda *a:True)
            self.assertTrue(result['nativeVerified'])
            self.assertEqual(self.preserve(),before)
            for name,raw in self.files.items():self.assertEqual((self.root/name).read_bytes(),raw)
            self.assertFalse(installer.install(self.root,native_checker=passed,checker=lambda *a:True)['updated'])

    def test_failed_native_check_never_publishes_or_runs_contracts(self):
        self.legacy();before=self.preserve()
        with patch.object(installer,'atomic_replace',side_effect=AssertionError('published')):
            with self.assertRaisesRegex(installer.SessionInstallError,'Nothing installed'):
                installer.install(self.root,native_checker=lambda *a:{'stage':'complete','supported':False,'reason':'native_login_changed','category':'none'},checker=lambda *a:self.fail('contracts ran'))
        self.assertEqual(self.preserve(),before)
        for name,raw in LEGACY.items():self.assertEqual((self.root/name).read_bytes(),raw)

    def test_mixed_missing_and_unknown_modules_are_refused(self):
        (self.root/'nexvia_session_keeper.py').write_bytes(CORE)
        with self.assertRaisesRegex(installer.SessionInstallError,'mixed'):
            installer.install(self.root,native_checker=lambda *a:self.fail('native check'))
        (self.root/'nexvia_session_browser.py').write_bytes(b'OPERATOR_CODE')
        with self.assertRaisesRegex(installer.SessionInstallError,'mixed'):
            installer.install(self.root,native_checker=lambda *a:self.fail('native check'))

    def test_contract_failure_restores_v1_while_all_locks_are_held(self):
        self.legacy();before=self.preserve()
        def check(*args):self.assert_locks();return False
        with self.assertRaisesRegex(installer.SessionInstallError,'contracts failed'):
            installer.install(self.root,native_checker=passed,checker=check)
        for name,raw in LEGACY.items():self.assertEqual((self.root/name).read_bytes(),raw)
        self.assertEqual(self.preserve(),before)

    def test_after_publication_fsync_failure_is_in_owned_rollback(self):
        self.legacy();real=installer.sync_directory;count=0
        def sync(root):
            nonlocal count
            count+=1
            if count==1:raise OSError('fixture fsync failure')
            return real(root)
        with patch.object(installer,'sync_directory',sync):
            with self.assertRaises(installer.SessionInstallError):installer.install(self.root,native_checker=passed,checker=lambda *a:True)
        for name,raw in LEGACY.items():self.assertEqual((self.root/name).read_bytes(),raw)

    def test_active_watcher_lock_refuses_before_preflight_without_reading_credentials(self):
        self.legacy();lock=self.root/'nexvia-session/.watch.lock';lock.touch(mode=0o600)
        fd=os.open(lock,os.O_RDONLY)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX)
            with self.assertRaisesRegex(installer.SessionInstallError,'maintenance'):
                installer.install(self.root,native_checker=lambda *a:self.fail('native check'))
        finally:os.close(fd)
        for name,raw in LEGACY.items():self.assertEqual((self.root/name).read_bytes(),raw)

    def test_real_isolated_candidate_preflight_loads_only_candidate_sources_before_install(self):
        self.legacy();before=self.preserve()
        result=installer.install(self.root)
        self.assertTrue(result['nativeVerified'])
        self.assertEqual(self.preserve(),before)
        self.assertFalse(list(self.root.rglob('__pycache__')))

    def test_candidate_preflight_blocks_login_and_no_credentials_are_read(self):
        changed=BROWSER.replace(b'self._state(None)',b"self.login('PRIVATE_USER','PRIVATE_PASSWORD')")
        files={**self.files,'nexvia_session_browser.py':changed}
        with installer.publication_locks(self.root,files) as fd:
            report=installer.native_check(self.root,self.root/'nexvia-tools/bin/python',fd,files)
        self.assertFalse(report['supported'])
        self.assertEqual(report['category'],'reader_error')
        self.assertNotIn('PRIVATE',json.dumps(report))

    def test_candidate_preflight_allows_recovered_context_change(self):
        changed=BROWSER.replace(b"def _state(self,page):return {'forms':[],'challenge':False}",b"def _state(self,page):\n  if not getattr(self,'retried',False):\n   self.retried=True;raise RuntimeError('Execution context was destroyed')\n  return {'forms':[],'challenge':False}")
        changed=changed.replace(b'self._state(None)',b"try:self._state(None)\n  except RuntimeError:pass\n  self._state(None)")
        files={**self.files,'nexvia_session_browser.py':changed}
        with installer.publication_locks(self.root,files) as fd:
            report=installer.native_check(self.root,self.root/'nexvia-tools/bin/python',fd,files)
        self.assertTrue(report['supported']);self.assertEqual(report['category'],'none')

    def test_candidate_module_change_during_native_check_is_not_overwritten(self):
        self.legacy()
        def native(*args):
            (self.root/'nexvia_session_browser.py').write_bytes(b'OTHER_OPERATOR_CHANGE')
            return passed()
        with self.assertRaisesRegex(installer.SessionInstallError,'changed'):
            installer.install(self.root,native_checker=native,checker=lambda *a:self.fail('contract check'))
        self.assertEqual((self.root/'nexvia_session_browser.py').read_bytes(),b'OTHER_OPERATOR_CHANGE')
        self.assertEqual((self.root/'nexvia_session_keeper.py').read_bytes(),CORE)

    def test_operator_change_after_publication_is_preserved_for_review(self):
        self.legacy()
        def check(*args):
            (self.root/'nexvia_session_browser.py').write_bytes(b'OTHER_OPERATOR_CHANGE')
            return False
        with self.assertRaisesRegex(installer.SessionInstallError,'needs review'):
            installer.install(self.root,native_checker=passed,checker=check)
        self.assertEqual((self.root/'nexvia_session_browser.py').read_bytes(),b'OTHER_OPERATOR_CHANGE')

    def test_failed_fresh_post_publication_sync_removes_its_owned_module(self):
        real=installer.sync_directory;count=0
        def sync(root):
            nonlocal count
            count+=1
            if count==1:raise OSError('fixture fsync failure')
            return real(root)
        with patch.object(installer,'sync_directory',sync):
            with self.assertRaises(installer.SessionInstallError):installer.install(self.root,native_checker=passed,checker=lambda *a:True)
        self.assertTrue(all(not (self.root/name).exists() for name in installer.FILES))

    def test_default_v1_builder_replays_archive_and_refuses_archive_output(self):
        before=ARCHIVE.read_bytes();output=self.root/'old.py'
        self.assertEqual(old_builder.build(output),('bb75bd30aff0af1d04122dcc213c94b93a05dc94b56e2faf274dee648ee29990',119885))
        self.assertEqual(output.read_bytes(),before)
        with self.assertRaisesRegex(ValueError,'immutable'):old_builder.build(ARCHIVE)
        with tempfile.TemporaryDirectory(dir=ARCHIVE.parent) as same_device:
            alias=Path(same_device)/'alias.py';alias.hardlink_to(ARCHIVE)
            with self.assertRaisesRegex(ValueError,'immutable'):old_builder.build(alias)
            alias.unlink()
        self.assertEqual(ARCHIVE.read_bytes(),before)

    def test_v2_builder_exact_payload_and_deterministic_bytes(self):
        source=self.root/'source';source.mkdir()
        (source/'install_nexvia_session_keeper_update_v2.py').write_bytes(Path(installer.__file__).read_bytes())
        for name,raw in self.files.items():(source/name).write_bytes(raw)
        first=self.root/'one.py';second=self.root/'two.py'
        expected=builder.build(first,source)
        self.assertEqual(builder.build(second,source),expected)
        self.assertEqual(first.read_bytes(),second.read_bytes())
        ns={'__name__':'v2_fixture'};exec(compile(first.read_bytes(),str(first),'exec'),ns)
        self.assertEqual(ns['decoded_payload'](),self.files)

    def test_failed_native_check_prevents_configure_and_start(self):
        with patch.object(installer,'install',side_effect=installer.SessionInstallError('Native check failed')), \
             patch.object(installer,'configure',side_effect=AssertionError('credentials prompt')), \
             patch.object(installer,'launch',side_effect=AssertionError('watcher launch')):
            self.assertEqual(installer.main(['--root',str(self.root),'--configure']),1)

if __name__=='__main__':unittest.main()
