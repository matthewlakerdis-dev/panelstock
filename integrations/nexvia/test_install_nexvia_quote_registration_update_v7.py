"""Publication, rollback and exact-v2 baseline for the registration-v7 updater."""
import hashlib
import json
import os
import fcntl
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import build_quote_registration_v7_installer as builder
import install_nexvia_quote_registration_update_v7 as installer
import test_install_nexvia_quote_policy_update as shared


DEPLOYED = dict(installer.PRIOR_SHA256)
NEW_HELPER = 'nexvia_quote_registration.py'
NEW_PROFILE = 'nexvia_generated_callback.py'


class RegistrationV7InstallerTests(unittest.TestCase):
    def setUp(self):
        for name, value in (('installer', installer), ('builder', builder)):
            bound = patch.object(shared, name, value)
            self.addCleanup(bound.stop)
            bound.start()
        self.f = shared.Fixture()
        self.addCleanup(self.f.temporary.cleanup)
        self.f.new[NEW_HELPER] += (
            "REGISTRATION_PROTOCOL_VERSION=2\n"
            "SEND_SOURCE_SHA256='96bfef70560ed8611fb07bbc0321d5d7dbbdf8b938dd08c4f92438398d3b4b16'\n"
            "PREFIX_SHA256='" + installer.REGISTRATION_PREFIX_SHA256 + "'\n"
            "QUERY_SHA256='e6eaea18e885e1078829b56df34896be5ab51439e8f0ba00cb1624b2c572c10e'\n").encode()
        self.f.new[NEW_PROFILE] += (
            "CALLBACK_PROFILE_VERSION=1\n"
            "SUPPORTED_DONE_PROFILE_SHA256='" + installer.DONE_PROFILE_SHA256 + "'\n"
            "MAX_SOURCE_CHARACTERS=65536\n").encode()
        previous = self.f.run
        self.f.run = lambda **options: previous(**{
            'check_request': shared.REQUEST,
            'native_checker': lambda *args, **kwargs: True, **options})
        for name, value in (('BUNDLE_BASE64', shared.bundled(self.f.new)),
                            ('PRIOR_SHA256', {key: hashlib.sha256(raw).hexdigest() for key, raw in self.f.old.items()}),
                            ('PYPDF_SHA256', hashlib.sha256(self.f.parser.read_bytes()).hexdigest()),
                            ('observed_registration_evidence', lambda *args: {'syntheticFixture': True})):
            bound = patch.object(installer, name, value)
            self.addCleanup(bound.stop)
            bound.start()

    def test_baseline_matches_the_immutable_installed_v2_release(self):
        path = Path(__file__).parent / 'releases/install_nexvia_quote_policy_update_v2.py'
        raw = path.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'b004a575f290c8438d90716729594f57d466242640d4d4568be22e0c918f7bf7')
        namespace = {'__name__': 'v2_baseline_read_only'}
        exec(compile(raw, str(path), 'exec'), namespace)
        for name, source in namespace['decoded_payload']().items():
            self.assertEqual(DEPLOYED[name], hashlib.sha256(source).hexdigest())
        self.assertEqual(installer.FILES, {'nexvia_quote_attachment.py', NEW_HELPER, NEW_PROFILE})
        self.assertEqual(installer.NEW_FILES, {NEW_HELPER, NEW_PROFILE})
        self.assertEqual(DEPLOYED['nexvia_preparation_diagnostics.py'], '9a146254aa66f3b33c3ad4780f95e8fa2c61f006772fc403128d02e4f0a2328e')

    def test_new_helper_backup_absence_marker_and_exact_rerun_preserve_all_existing_records(self):
        config, evidence = self.f.config.read_bytes(), self.f.evidence()
        kept = {name: (self.f.root/name).read_bytes() for name in self.f.old if name not in installer.FILES}
        self.assertTrue(self.f.run()['updated'])
        self.assertEqual({name:(self.f.root/name).read_bytes() for name in kept}, kept)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(self.f.evidence(), evidence)
        backup = self.f.root / 'nexvia-backup-before-quote-registration-v7-update'
        self.assertEqual(set(path.name for path in backup.iterdir()), {'panelstock-requests.json','nexvia_quote_attachment.py',NEW_HELPER+'.absent',NEW_PROFILE+'.absent'})
        before = {path.name:path.read_bytes() for path in backup.iterdir()}
        self.assertEqual(before[NEW_HELPER+'.absent'], ('Absent before quote registration update: '+NEW_HELPER+'\n').encode())
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in backup.iterdir()))
        self.assertFalse(self.f.run()['updated'])
        self.assertEqual({path.name:path.read_bytes() for path in backup.iterdir()}, before)

    def test_failure_after_new_file_publication_removes_only_owned_helper_and_restores_q(self):
        self.f.watcher()
        original, config = self.f.evidence(), self.f.config.read_bytes()
        real_sync, failed = installer.sync_directory, False
        def interrupted(path):
            nonlocal failed
            if not failed:
                failed = True
                raise OSError('synthetic interruption after publication')
            return real_sync(path)
        with patch.object(installer, 'sync_directory', side_effect=interrupted), patch.object(installer,'stop_idle_watcher',side_effect=self.f.stop):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, 'original modules were restored'):
                self.f.run()
        self.f.assert_old(self)
        self.assertEqual(self.f.evidence(), original)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(len(self.f.launched), 1)

    def test_concurrent_unowned_helper_is_not_deleted_or_automatically_started(self):
        self.f.watcher()
        real_add = installer.atomic_add
        def external(path, raw, mode, owned):
            path.write_bytes(b'# concurrent helper belongs to another operator\n')
            return real_add(path, raw, mode, owned)
        with patch.object(installer,'atomic_add',side_effect=external), patch.object(installer,'stop_idle_watcher',side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError): self.f.run()
        self.assertTrue(any((self.f.root/name).is_file() and (self.f.root/name).read_bytes()==b'# concurrent helper belongs to another operator\n' for name in installer.NEW_FILES))
        self.assertEqual(self.f.launched, [])

    def test_replaced_added_helper_is_preserved_and_blocks_restart(self):
        self.f.watcher()
        def drift(*args, **kwargs):
            path = self.f.root / NEW_HELPER
            replacement = self.f.root / 'external-helper.py'
            replacement.write_bytes(path.read_bytes())
            replacement.chmod(0o644)
            os.replace(replacement, path)
            return True
        with patch.object(installer,'stop_idle_watcher',side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError): self.f.run(checker=drift)
        self.assertEqual((self.f.root/NEW_HELPER).read_bytes(), self.f.new[NEW_HELPER])
        self.assertEqual(self.f.launched, [])

    def test_new_file_ownership_descriptor_stays_open_until_restart_then_closes(self):
        descriptors=[]
        original=installer.atomic_add
        def capture(path, raw, mode, owned):
            original(path,raw,mode,owned)
            descriptors.append(owned[path.name][2])
        def checking(*args,**kwargs):
            self.assertEqual(len(descriptors),2)
            os.fstat(descriptors[0])
            return True
        def launch(*args):
            os.fstat(descriptors[0])
            self.f.launch(*args)
        with patch.object(installer,'atomic_add',side_effect=capture):
            self.f.run(checker=checking,launch=launch)
        with self.assertRaises(OSError): os.fstat(descriptors[0])

    def test_source_only_check_precedes_stopping_and_all_publication(self):
        self.f.watcher()
        events=[]
        before=self.f.evidence()
        def native(root,python,files,identifier,*,bridge_lock_fd):
            events.append('native')
            self.f.assert_old(self)
            self.assertEqual(files,self.f.new)
            self.assertTrue((self.f.proc/'9001').exists())
            self.assertFalse((root/'nexvia-backup-before-quote-registration-v7-update').exists())
            self.assertEqual(self.f.evidence(),before)
            fresh = os.open(self.f.journal/'.bridge.lock', os.O_RDWR)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(fresh, fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:
                os.close(fresh)
            return True
        def stop(*args):
            events.append('stop');self.f.stop(*args)
        with patch.object(installer,'stop_idle_watcher',side_effect=stop):
            result=self.f.run(check_request=shared.REQUEST,native_checker=native)
        self.assertEqual(events,['native','stop'])
        self.assertTrue(result['nativeUploaderVerified'])
        self.assertEqual(self.f.evidence(),before)

    def test_native_check_failure_never_stops_watcher_or_changes_original_state(self):
        self.f.watcher()
        config, evidence = self.f.config.read_bytes(), self.f.evidence()
        for outcome in (False, installer.QuotePolicyUpdateError(
                'Native uploader compatibility check failed at registration_source. Nothing installed.')):
            with self.subTest(outcome=outcome):
                def native(*args, **kwargs):
                    if isinstance(outcome, Exception):
                        raise outcome
                    return outcome
                with patch.object(installer, 'stop_idle_watcher') as stop:
                    with self.assertRaisesRegex(installer.QuotePolicyUpdateError, 'Native uploader compatibility'):
                        self.f.run(native_checker=native)
                    stop.assert_not_called()
                self.f.assert_old(self)
                self.assertTrue((self.f.proc/'9001').exists())
                self.assertFalse((self.f.root/'nexvia-backup-before-quote-registration-v7-update').exists())
                self.assertEqual(self.f.evidence(), evidence)
                self.assertEqual(self.f.config.read_bytes(), config)
                self.assertEqual(self.f.checked, [])
                self.assertEqual(self.f.launched, [])

    def test_native_check_detects_original_evidence_change_before_any_installation(self):
        self.f.watcher()
        def native(*args, **kwargs):
            (self.f.request/'nexvia-create-attempt.json').write_bytes(b'external evidence change')
            return True
        with patch.object(installer, 'stop_idle_watcher') as stop:
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, 'Existing request evidence changed'):
                self.f.run(native_checker=native)
            stop.assert_not_called()
        self.f.assert_old(self)
        self.assertEqual((self.f.request/'nexvia-create-attempt.json').read_bytes(), b'external evidence change')
        self.assertFalse((self.f.root/'nexvia-backup-before-quote-registration-v7-update').exists())
        self.assertEqual(self.f.launched, [])

    def test_builder_uses_only_three_sources_and_refuses_missing_helper_source_pins(self):
        root=self.f.root/'source';root.mkdir()
        (root/'install_nexvia_quote_registration_update_v7.py').write_text(Path(installer.__file__).read_text())
        for name,raw in self.f.new.items():(root/name).write_bytes(raw)
        target=self.f.root/'release.py'
        checksum,size=builder.build(target,root)
        namespace={'__name__':'release_validation'}
        exec(compile(target.read_bytes(),str(target),'exec'),namespace)
        self.assertEqual(namespace['decoded_payload'](),self.f.new)
        self.assertEqual(builder.build(self.f.root/'second.py',root),(checksum,size))
        before=target.read_bytes()
        (root/NEW_HELPER).write_text('# missing source pins\n')
        with self.assertRaisesRegex(ValueError,'pins'):builder.build(target,root)
        self.assertEqual(target.read_bytes(),before)

    def test_source_pinned_opaque_completion_routes_are_denied_during_native_preflight(self):
        namespace = {'__name__': 'source_only_guard_test'}
        exec(compile(installer.NATIVE_PREFLIGHT, '<source-only-native-check>', 'exec'), namespace)
        actual_sha256 = hashlib.sha256
        prefix = '/syntheticCompletion/'
        def controlled_hash(raw):
            if raw == prefix.encode():
                return SimpleNamespace(hexdigest=lambda: installer.REGISTRATION_PREFIX_SHA256)
            return actual_sha256(raw)
        namespace['hashlib'] = SimpleNamespace(sha256=controlled_hash)
        quote = SimpleNamespace(policy_path=lambda value: False)
        for path in (prefix + '419', '/staff' + prefix + '419', prefix, '/staff' + prefix):
            request = SimpleNamespace(url='https://lennox.nexvia.com.au' + path,
                                      method='GET', resource_type='xhr')
            with self.subTest(path=path):
                self.assertEqual(namespace['route_decision'](request, quote), (False, True))
        request = SimpleNamespace(url='https://lennox.nexvia.com.au/staff/project-read/60',
                                  method='GET', resource_type='xhr')
        self.assertEqual(namespace['route_decision'](request, quote), (True, False))

    def test_native_failure_report_keeps_only_finite_stage_reason_and_known_hashes(self):
        expected = {'requestFileSha256': 'a' * 64, 'sourceSha256': {'helper': 'b' * 64},
                    'passed': True, 'stage': 'verified'}
        observed = {'passed': False, 'stage': 'registration_source',
                    'reason': 'registration_renderer_query', 'privateException': 'PRIVATE_NATIVE_URL_TOKEN'}
        safe = installer.save_native_check_report(self.f.root, shared.REQUEST, observed, expected,
                                                 frozenset({'registration_renderer_query'}))
        path = self.f.root / 'nexvia-registration-v7-checks' / (shared.REQUEST + '.json')
        self.assertEqual(safe['reason'], 'registration_renderer_query')
        self.assertFalse(safe['passed'])
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        self.assertNotIn('PRIVATE_NATIVE_URL_TOKEN', path.read_text())
        observed.update(stage={'private': 'value'}, reason='PRIVATE_NATIVE_URL_TOKEN')
        safe = installer.save_native_check_report(self.f.root, shared.REQUEST, observed, expected,
                                                 frozenset({'registration_renderer_query'}))
        self.assertEqual(safe['stage'], 'unknown')
        self.assertIsNone(safe['reason'])
        self.assertNotIn('PRIVATE_NATIVE_URL_TOKEN', path.read_text())

    def test_native_preflight_reports_fixed_helper_failure_before_module_mutation(self):
        (self.f.request / 'request.json').write_text(json.dumps({'requestId': shared.REQUEST,
            'quote': {'filename': 'quote.pdf', 'bytes': 100, 'sha256': 'a' * 64}}))
        files = dict(self.f.new)
        files[NEW_HELPER] += b"PUBLIC_FAILURE_CODES=frozenset({'registration_renderer_source'})\n"
        request_hash = hashlib.sha256((self.f.request / 'request.json').read_bytes()).hexdigest()
        observed = {'format': 'nexvia-native-policy-compatibility', 'version': 1,
            'requestId': shared.REQUEST, 'requestFileSha256': request_hash,
            'sourceSha256': {name: hashlib.sha256(files[name + '.py']).hexdigest()
                for name in ('nexvia_generated_callback', 'nexvia_quote_registration', 'nexvia_quote_attachment')},
            'passed': False, 'stage': 'registration_source', 'reason': 'registration_renderer_source',
            'privateException': 'PRIVATE_NATIVE_URL_TOKEN'}
        result = SimpleNamespace(returncode=0, stdout=json.dumps(observed).encode())
        with patch.object(installer.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError,
                    r'failed at registration_source \(registration_renderer_source\)') as caught:
                installer._native_policy_preflight(self.f.root, self.f.root / 'nexvia-tools/bin/python', files, shared.REQUEST,
                                                  bridge_lock_fd=17)
        self.assertNotIn('PRIVATE_NATIVE_URL_TOKEN', str(caught.exception))
        self.f.assert_old(self)
        report = self.f.root / 'nexvia-registration-v7-checks' / (shared.REQUEST + '.json')
        self.assertEqual(json.loads(report.read_text())['reason'], 'registration_renderer_source')

    def test_missing_check_request_refuses_before_any_payload_or_network(self):
        with patch.object(installer, 'decoded_payload') as decode:
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, 'saved quoted request is required'):
                installer.install(self.f.root, self.f.proc)
            decode.assert_not_called()

    def test_all_three_payload_sources_are_bound_to_exact_native_report(self):
        path = self.f.request/'request.json'
        path.write_text(json.dumps({'requestId':shared.REQUEST,'quote':{'filename':'quote.pdf','bytes':100,'sha256':'a'*64}}))
        request_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        report = {'format':'nexvia-native-policy-compatibility','version':1,
            'requestId':shared.REQUEST,'requestFileSha256':request_hash,
            'sourceSha256':{name[:-3]:hashlib.sha256(raw).hexdigest() for name,raw in self.f.new.items()},
            'passed':True,'stage':'verified','readOnly':True,'fileSelected':False,
            'policyRequested':False,'fileUploaded':False,'poCreated':False,'poChanged':False,'emailSent':False}
        def response(args, **options):
            self.assertIn('-I',args); self.assertIn('-B',args)
            payload = json.loads(options['input'])
            self.assertEqual(set(payload['sources']), {name[:-3] for name in installer.FILES})
            return SimpleNamespace(returncode=0, stdout=json.dumps(report).encode())
        with patch.object(installer.subprocess,'run',side_effect=response):
            self.assertTrue(installer._native_policy_preflight(self.f.root,self.f.root/'nexvia-tools/bin/python',self.f.new,shared.REQUEST,bridge_lock_fd=17))
            for field in ('policyRequested','fileUploaded','poCreated','poChanged','emailSent','fileSelected'):
                report[field] = True
                with self.subTest(field=field), self.assertRaises(installer.QuotePolicyUpdateError):
                    installer._native_policy_preflight(self.f.root,self.f.root/'nexvia-tools/bin/python',self.f.new,shared.REQUEST,bridge_lock_fd=17)
                report[field] = False
            report['sourceSha256'].pop('nexvia_generated_callback')
            with self.assertRaises(installer.QuotePolicyUpdateError):
                installer._native_policy_preflight(self.f.root,self.f.root/'nexvia-tools/bin/python',self.f.new,shared.REQUEST,bridge_lock_fd=17)

    def test_private_directory_repairs_only_new_inherited_permissions(self):
        directory = self.f.root/'new-private-directory'
        original = Path.mkdir
        def inherited(path, *args, **kwargs):
            original(path,*args,**kwargs)
            path.chmod(0o755)
        with patch.object(Path,'mkdir',inherited):
            installer.private_directory(directory)
        self.assertEqual(directory.stat().st_mode & 0o777,0o700)
        directory.chmod(0o755)
        with self.assertRaisesRegex(installer.QuotePolicyUpdateError,'must already be private'):
            installer.private_directory(directory)
        self.assertEqual(directory.stat().st_mode & 0o777,0o755)

    def test_report_directory_refuses_preexisting_public_folder_without_chmod(self):
        path = self.f.root/'nexvia-registration-v7-checks'
        path.mkdir(mode=0o755)
        path.chmod(0o755)
        with self.assertRaisesRegex(installer.QuotePolicyUpdateError,'must already be private'):
            installer.save_native_check_report(self.f.root,shared.REQUEST,{},
                {'requestFileSha256':'a'*64,'sourceSha256':{}},frozenset())
        self.assertEqual(path.stat().st_mode & 0o777,0o755)
        self.assertEqual(list(path.iterdir()),[])

    def test_real_isolated_native_check_injects_all_three_modules_without_mutations(self):
        request_file = self.f.request/'request.json'
        request_file.write_text(json.dumps({'requestId':shared.REQUEST,'quote':{'filename':'quote.pdf','bytes':100,'sha256':'a'*64}}))
        package = self.f.root/'playwright'
        package.mkdir()
        (package/'__init__.py').write_text('')
        (package/'sync_api.py').write_text('''
from contextlib import contextmanager
from types import SimpleNamespace
class Page:
    def route(self, target, handler, **kwargs):
        handler(SimpleNamespace(request=SimpleNamespace(method='GET',url='https://lennox.nexvia.com.au/staff/project-purchase-order-add/60',resource_type='document'),continue_=lambda:None,abort=lambda:None))
    def evaluate(self,*args): return {'widgets':[{'sendSource':'synthetic send','doneSource':'synthetic done'}]}
    def set_input_files(self,*args,**kwargs): raise AssertionError('file selected')
class Locator:
    def set_input_files(self,*args,**kwargs): raise AssertionError('file selected')
class FileChooser:
    def set_files(self,*args,**kwargs): raise AssertionError('file selected')
@contextmanager
def sync_playwright():
    browser=SimpleNamespace(contexts=[SimpleNamespace(pages=[SimpleNamespace(url='https://lennox.nexvia.com.au/staff/projects')])])
    yield SimpleNamespace(chromium=SimpleNamespace(connect_over_cdp=lambda *args,**kwargs:browser))
''')
        (self.f.root/'nexvia_create.py').write_text('''
from contextlib import contextmanager
from playwright.sync_api import Page,Locator,FileChooser
import nexvia_quote_attachment as q
BASE='https://lennox.nexvia.com.au'
def prepare(*args,**kwargs): raise AssertionError('prepare')
def submit(*args,**kwargs): raise AssertionError('submit')
def save(*args,**kwargs): raise AssertionError('save')
def upload_quote(*args,**kwargs): raise AssertionError('upload')
def quote_attachment_descriptor(request,quote): return quote
@contextmanager
def quote_browser_context(browser,signed_in): yield object()
@contextmanager
def native_line_editor(context,request,**kwargs):
    for fn in (prepare,submit,save,upload_quote,q.upload_quote,q.begin_upload,q.complete_upload,q.source_upload_payload,q.begin_upload_context,q.validate_upload_context,q.accept_storage_upload,Page().set_input_files,Locator().set_input_files,FileChooser().set_files):
        try: fn()
        except RuntimeError: pass
        else: raise AssertionError('mutation trap missing')
    page=Page();page.route('**/*',lambda route:route.continue_())
    yield {'page':page,'createPath':'/staff/project-purchase-order-add/60'}
''')
        (self.f.root/'nexvia_preparation_diagnostics.py').write_text('DIAGNOSTICS_VERSION=1\n')
        files = {NEW_PROFILE:Path(installer.__file__).with_name(NEW_PROFILE).read_bytes()}
        files[NEW_HELPER] = ('''import hashlib
import nexvia_generated_callback as generated_callback
REGISTRATION_PROTOCOL_VERSION=2
PUBLIC_FAILURE_CODES=frozenset({'registration_done_profile_changed'})
class RegistrationError(ValueError): pass
def read_contract(page,done,send):
    assert generated_callback.CALLBACK_PROFILE_VERSION==1
    return {'version':2,'doneSourceSha256':hashlib.sha256(done.encode()).hexdigest(),'doneProfileSha256':generated_callback.SUPPORTED_DONE_PROFILE_SHA256}
def binding_from_policy(root,contract,candidates,metadata):
    return {'registrationURL':'https://lennox.nexvia.com.au/synthetic/419','rendererURL':'https://lennox.nexvia.com.au/renderer/419'}
def matches_request(url,method,binding):
    return method=='GET' and url==binding['registrationURL']+'?location=diagnostic%2Fno-upload.pdf'
def matches_renderer_request(url,method,binding): return method=='GET' and url==binding['rendererURL']
''').encode()
        files['nexvia_quote_attachment.py'] = ('''import os
from contextlib import contextmanager
import nexvia_quote_registration as registration
BLANK_DRAFT_GUARD_VERSION=5
POLICY_UPLOAD_GUARD_VERSION=2
POLICY_SEND_SHA256='''+repr('a'*64)+'''
POLICY_OPERATION_SHA256='''+repr('b'*64)+'''
NATIVE_STATE_JS='read only'
@contextmanager
def private_folder(folder):
    fd=os.open(folder,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: yield fd
    finally: os.close(fd)
def upload_quote(*args,**kwargs): raise AssertionError('upload')
def begin_upload(*args,**kwargs): raise AssertionError('begin')
def complete_upload(*args,**kwargs): raise AssertionError('complete')
def source_upload_payload(*args,**kwargs): raise AssertionError('read pdf')
def begin_upload_context(*args,**kwargs): raise AssertionError('write context')
def validate_upload_context(*args,**kwargs): raise AssertionError('read context')
def accept_storage_upload(*args,**kwargs): raise AssertionError('storage')
def validate_native_draft(*args,**kwargs): pass
def fresh_policy_filename(*args): return 'quote.pdf'
def policy_acl(*args): return 'private'
def policy_append_fields(*args): return set()
def policy_path(url): return '/upload/security' in url
def validate_policy_response(*args): return []
def validate_callback_sources(widget,contract):
    assert contract['doneSourceSha256']==registration.hashlib.sha256(widget['doneSource'].encode()).hexdigest()
''').encode()
        descriptor = os.open(self.f.journal/'.bridge.lock',os.O_CREAT|os.O_RDWR,0o600)
        self.addCleanup(os.close,descriptor)
        fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        evidence=self.f.evidence()
        before={name:(self.f.root/name).read_bytes() for name in self.f.old}
        self.assertTrue(installer._native_policy_preflight(self.f.root,self.f.root/'nexvia-tools/bin/python',files,shared.REQUEST,bridge_lock_fd=descriptor))
        self.assertFalse((self.f.root/NEW_PROFILE).exists())
        self.assertFalse((self.f.root/NEW_HELPER).exists())
        self.assertFalse(list(self.f.root.rglob('__pycache__')))
        self.assertEqual(self.f.evidence(),evidence)
        self.assertEqual({name:(self.f.root/name).read_bytes() for name in self.f.old},before)

    def test_release_is_deterministic_exact_three_runtime_sources_and_v3_unchanged(self):
        source_root=Path(installer.__file__).parent
        release=source_root/'releases/install_nexvia_quote_registration_update_v7.py'
        original=(source_root/'releases/install_nexvia_quote_registration_update_v3.py').read_bytes()
        self.assertEqual(hashlib.sha256(original).hexdigest(),'e210cba07777ffb9b812ea63d54fffe98595e5aa9014e831731ec57373f8cb4c')
        generated=self.f.root/'reproducible-v7.py'
        checksum,size=builder.build(generated)
        self.assertEqual(generated.read_bytes(),release.read_bytes())
        self.assertEqual((checksum,size),(hashlib.sha256(release.read_bytes()).hexdigest(),len(release.read_bytes())))
        namespace={'__name__':'v7_frozen_release_audit'}
        exec(compile(generated.read_bytes(),str(generated),'exec'),namespace)
        payload=namespace['decoded_payload']()
        self.assertEqual(set(payload),installer.FILES)
        self.assertEqual({name: hashlib.sha256(raw).hexdigest() for name, raw in payload.items()}, {
            'nexvia_quote_attachment.py': '151efe0705c3257b95c256b93400037fc7c1d4815cd8e282b5e45cc2418a98ac',
            'nexvia_quote_registration.py': '202882c5a10cda7f57b2cb3e11f0d3af774e2cd57b654eaf9f9797b820a94596',
            'nexvia_generated_callback.py': '3c1458b84858b6b6f6e25f69dbbdc487208684f1379d80778f89d21b292a0be4',
        })
        with self.assertRaisesRegex(ValueError,'immutable registration-v3 archive'):
            builder.build(source_root/'releases/install_nexvia_quote_registration_update_v3.py')
        self.assertEqual((source_root/'releases/install_nexvia_quote_registration_update_v3.py').read_bytes(),original)

    def test_v7_builder_never_overwrites_older_archives_or_their_hardlinks(self):
        source_root = Path(installer.__file__).parent
        checksums = {
            3: 'e210cba07777ffb9b812ea63d54fffe98595e5aa9014e831731ec57373f8cb4c',
            4: 'c496ebc746ff3366bbab3f752869f0ef2e83f60dd8e6f9575551fb53e650e4a7',
            5: '50083a30e502a36d547bf1771d9094cda38e1f79b375d130cb5a168933ace9c6',
            6: '6bbdf43b317a42518da908af2d54b10784b8cf202c3d4a7299792ac1ecd3aeb7',
        }
        for version, checksum in checksums.items():
            archive = source_root / ('releases/install_nexvia_quote_registration_update_v' + str(version) + '.py')
            before = archive.read_bytes()
            self.assertEqual(hashlib.sha256(before).hexdigest(), checksum)
            with tempfile.TemporaryDirectory(prefix='.v7-archive-guard-', dir=archive.parent) as directory:
                alias = Path(directory) / 'immutable-alias.py'
                alias.hardlink_to(archive)
                for output in (archive, alias):
                    with self.subTest(version=version, output=output.name), self.assertRaisesRegex(
                            ValueError, 'immutable registration-v' + str(version) + ' archive'):
                        builder.build(output)
            self.assertEqual(archive.read_bytes(), before)

    def test_profile_protocol_pins_are_required_before_packaging(self):
        installer.check_registration_source(self.f.new[NEW_HELPER])
        installer.check_generated_source(self.f.new[NEW_PROFILE])
        for replacement in (b'REGISTRATION_PROTOCOL_VERSION=True\n', b'REGISTRATION_PROTOCOL_VERSION=1\n', b'REGISTRATION_PROTOCOL_VERSION=2.0\n'):
            with self.assertRaises(installer.QuotePolicyUpdateError):
                installer.check_registration_source(self.f.new[NEW_HELPER].replace(b'REGISTRATION_PROTOCOL_VERSION=2\n',replacement))
        with self.assertRaises(installer.QuotePolicyUpdateError):
            installer.check_generated_source(self.f.new[NEW_PROFILE].replace(installer.DONE_PROFILE_SHA256.encode(),b'0'*64))


for _name in (
    'test_failed_contract_check_rolls_back_and_restarts_only_known_prior_watcher',
    'test_unknown_payload_and_incompatible_dependency_versions_refuse_before_stopping_or_checking',
    'test_work_lock_prevents_stopping_active_bridge',
    'test_default_bridge_lock_wait_retries_before_stopping_only_an_idle_watcher',
    'test_contract_check_receives_real_exclusive_work_lock',
    'test_active_creator_refuses_installation',
    'test_reference_cache_mutation_during_preflight_blocks_restart',
    'test_code_drift_during_check_is_not_overwritten_or_started',
    'test_preflight_request_mutation_or_new_result_blocks_restart',
    'test_late_external_config_edit_is_preserved_and_blocks_restart',
    'test_parser_drift_blocks_automatic_restart',
    'test_invalid_bundle_and_source_or_history_symlinks_refuse_without_mutation',
    'test_native_route_guard_blocks_writes_policy_registration_and_gcs_before_native_handler',
    'test_native_check_requires_canonical_uuid_before_inspecting_or_stopping',
):
    setattr(RegistrationV7InstallerTests,_name,getattr(shared.QuotePolicyInstallerTests,_name))

if __name__=='__main__':unittest.main()
