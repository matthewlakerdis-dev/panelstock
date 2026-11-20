"""Frozen V6 renderer diagnostics retain rejection, privacy and read-only guards."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import URLError

import nexvia_inspect_renderer_query as diagnostic


ROOT=Path(__file__).parent
RELEASE=ROOT/'releases/install_nexvia_quote_registration_update_v6.py'
RELEASE_RAW=RELEASE.read_bytes()
assert len(RELEASE_RAW)==diagnostic.RELEASE_BYTES
assert hashlib.sha256(RELEASE_RAW).hexdigest()==diagnostic.RELEASE_SHA256
RELEASE_NAMESPACE={'__name__':'frozen_v6_renderer_fixture'}
exec(compile(RELEASE_RAW,str(RELEASE),'exec'),RELEASE_NAMESPACE)
FILES=RELEASE_NAMESPACE['decoded_payload']()
assert hashlib.sha256(FILES['nexvia_quote_registration.py']).hexdigest()=='7725f7b44cb2e394e138e702191c6eff5a624e6d5974d4e500d8c99db75c5dd1'


def isolated_registration():
    generated=ModuleType('frozen_v6_generated_fixture')
    exec(compile(FILES['nexvia_generated_callback.py'],'frozen_v6_generated_fixture.py','exec'),generated.__dict__)
    module=ModuleType('frozen_v6_renderer_fixture')
    with patch.dict(sys.modules,{'nexvia_generated_callback':generated}):
        exec(compile(FILES['nexvia_quote_registration.py'],'frozen_v6_renderer_fixture.py','exec'),module.__dict__)
    return module


def expected_report():
    return {'format':'nexvia-native-policy-compatibility','version':1,'requestId':'fixture-request',
            'requestFileSha256':'a'*64,'sourceSha256':{'fixture':'b'*64},
            'readOnly':True,'fileSelected':False,'policyRequested':False,'fileUploaded':False,
            'poCreated':False,'poChanged':False,'emailSent':False}


def child_report(suffix='?field=form[Files]&multiple=1'):
    summary=diagnostic.renderer_query_summary(suffix)
    summary['original']='rejected'
    return {**expected_report(),'passed':False,'stage':'registration_source','reason':'registration_renderer_query',
            'rendererDiagnostic':{'query':summary,'calls':1}}


class RendererProjectionTests(unittest.TestCase):
    def test_valid_query_and_all_original_rejection_clauses_are_distinguished(self):
        module=isolated_registration()
        cases={
            '?field=form[Files]':'none',
            '?name=form%5BFiles%5D%5B%5D&_=123':'none',
            '':'shape',
            '?field=form[Files]%ZZ':'shape',
            '?field=form[Files]\n':'shape',
            '?field=form[Files]&é=other':'shape',
            '?field=form[Files]#fragment':'url',
            '?field=form[Files]&bare':'parse',
            '?field=form[Files]&a=form[Files]&b=form[Files]&c=form[Files]&d=form[Files]':'parse',
            '?field=other':'bindings',
            '?field=form[Files]&field=form[Files]':'bindings',
            '?field=form[Files]&multiple=1':'entry',
            '?delete=form[Files]':'entry',
        }
        for suffix,clause in cases.items():
            with self.subTest(suffix=suffix):
                summary=diagnostic.renderer_query_summary(suffix)
                self.assertEqual(summary['firstFailure'],clause)
                if clause=='none':module._renderer_suffix(suffix)
                else:
                    with self.assertRaisesRegex(module.RegistrationError,'registration_renderer_query'):
                        module._renderer_suffix(suffix)

    def test_all_checks_and_parameters_survive_an_early_failure(self):
        summary=diagnostic.renderer_query_summary('?field=form[Files]&multiple=1&remove=false&x=%ZZ')
        self.assertEqual(summary['firstFailure'],'shape')
        self.assertFalse(summary['checks']['noMalformedPercent'])
        self.assertTrue(summary['checks']['hasFilesBinding'])
        self.assertFalse(summary['checks']['entriesValid'])
        self.assertEqual(summary['pairCount'],4)
        self.assertEqual([row['valueKind'] for row in summary['parameters']],['formFiles','one','false','other'])
        self.assertTrue(summary['parameters'][2]['keyActionWord'])

    def test_extra_fields_and_html_entities_are_reported_without_normalizing_them(self):
        summary=diagnostic.renderer_query_summary('?field=form[Files]&amp;multiple=1')
        self.assertTrue(summary['checks']['htmlEntitySeparator'])
        self.assertEqual(summary['parameters'][1]['key'],'[other]')
        self.assertFalse(summary['parameters'][1]['keySafeASCII'])
        summary=diagnostic.renderer_query_summary('?field=form[Files]'+'&x=form[Files]'*5)
        self.assertFalse(summary['checks']['runtimeParsed'])
        self.assertTrue(summary['checks']['diagnosticParsed'])
        self.assertEqual(summary['pairCount'],6)
        summary=diagnostic.renderer_query_summary('?field=form[Files]'+'&x=form[Files]'*16)
        self.assertFalse(summary['checks']['diagnosticParsed'])
        self.assertTrue(summary['checks']['pairsTruncated'])
        self.assertEqual(summary['parameters'],[])

    def test_only_fixed_names_value_enums_lengths_hashes_and_shape_flags_escape(self):
        private='PRIVATE_PASSWORD_OR_URL_TOKEN'
        suffix='?field=form[Files]&'+private+'='+private+'&form_id='+private+'&allowDownload=true'
        summary=diagnostic.renderer_query_summary(suffix)
        output=json.dumps(summary)
        self.assertNotIn(private,output)
        self.assertNotIn(suffix,output)
        self.assertEqual(summary['parameters'][1]['key'],'[other]')
        self.assertEqual(summary['parameters'][1]['valueKind'],'other')
        self.assertTrue(summary['parameters'][1]['keySensitive'])
        self.assertEqual(summary['parameters'][2]['key'],'form_id')
        self.assertEqual(summary['parameters'][3]['key'],'allowDownload')
        self.assertEqual(summary['parameters'][3]['valueKind'],'true')
        self.assertEqual(summary['suffixSha256'],hashlib.sha256(suffix.encode()).hexdigest())
        self.assertEqual(diagnostic.renderer_query_summary('?FIELD=form[Files]')['parameters'][0]['key'],'field')

    def test_original_guard_return_and_exception_objects_are_preserved(self):
        sentinel=object();error=RuntimeError('PRIVATE_ORIGINAL_ERROR');calls=[]
        def original(value):
            calls.append(value)
            if value is sentinel:return sentinel
            raise error
        module=SimpleNamespace(_renderer_suffix=original);checkpoint={}
        diagnostic.install_renderer_probe(module,checkpoint)
        self.assertIs(module._renderer_suffix(sentinel),sentinel)
        self.assertEqual(calls,[sentinel])
        with self.assertRaises(RuntimeError) as caught:module._renderer_suffix('?field=other')
        self.assertIs(caught.exception,error)
        self.assertEqual(calls,[sentinel,'?field=other'])
        self.assertEqual(checkpoint['rendererCalls'],2)
        self.assertEqual(checkpoint['rendererQuery']['original'],'accepted')

    def test_projection_failure_never_prevents_original_guard_execution(self):
        error=RuntimeError('PRIVATE_ORIGINAL_ERROR');calls=[]
        def original(value):calls.append(value);raise error
        module=SimpleNamespace(_renderer_suffix=original);checkpoint={}
        diagnostic.install_renderer_probe(module,checkpoint)
        suffix='?field=\ud800'
        with self.assertRaises(RuntimeError) as caught:module._renderer_suffix(suffix)
        self.assertIs(caught.exception,error)
        self.assertEqual(calls,[suffix])
        self.assertIsNone(checkpoint['rendererQuery'])

    def test_probe_keeps_the_frozen_rejecting_guard_intact(self):
        module=isolated_registration();checkpoint={}
        diagnostic.install_renderer_probe(module,checkpoint)
        with self.assertRaisesRegex(module.RegistrationError,'registration_renderer_query'):
            module._renderer_suffix('?field=form[Files]&multiple=1')
        self.assertEqual(checkpoint['rendererQuery']['firstFailure'],'entry')
        self.assertEqual(checkpoint['rendererQuery']['original'],'rejected')

    def test_parent_projection_accepts_readonly_success_but_never_approves_compatibility(self):
        expected=expected_report();report=child_report()
        module=isolated_registration()
        result=diagnostic.project_result(report,expected,module.PUBLIC_FAILURE_CODES)
        self.assertFalse(result['compatibilityApproved'])
        self.assertEqual(result['query']['firstFailure'],'entry')
        report['passed']=True;report['stage']='verified';report.pop('reason')
        report['rendererDiagnostic']['query']=diagnostic.renderer_query_summary('?field=form[Files]')
        report['rendererDiagnostic']['query']['original']='accepted'
        result=diagnostic.project_result(report,expected,module.PUBLIC_FAILURE_CODES)
        self.assertTrue(result['passed']);self.assertFalse(result['compatibilityApproved'])

    def test_parent_projection_rejects_unknown_raw_fields_values_or_unbounded_shapes(self):
        expected=expected_report();module=isolated_registration()
        mutations=[
            lambda d:d.update(rawSource='PRIVATE'),
            lambda d:d.update(reason='PRIVATE'),
            lambda d:d.update(fileUploaded=True),
            lambda d:d['rendererDiagnostic'].update(rawSuffix='PRIVATE'),
            lambda d:d['rendererDiagnostic']['query'].update(rawSuffix='PRIVATE'),
            lambda d:d['rendererDiagnostic']['query']['parameters'][0].update(key='PRIVATE'),
            lambda d:d['rendererDiagnostic']['query']['parameters'][0].update(value='PRIVATE'),
            lambda d:d['rendererDiagnostic']['query']['parameters'][0].update(valueKind='PRIVATE'),
            lambda d:d['rendererDiagnostic']['query']['parameters'][0].update(valueKind=[]),
            lambda d:d['rendererDiagnostic']['query']['parameters'][0].update(index=True),
            lambda d:d['rendererDiagnostic']['query'].update(firstFailure=[]),
            lambda d:d['rendererDiagnostic']['query']['checks'].update(ascii='PRIVATE'),
            lambda d:d['rendererDiagnostic']['query']['parameters'][0].update(valueLength=262145),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                report=child_report();mutate(report)
                with self.assertRaises(diagnostic.InspectionError):diagnostic.project_result(report,expected,module.PUBLIC_FAILURE_CODES)

    def test_frozen_preflight_changes_only_wrapper_install_and_safe_report_projection(self):
        original=RELEASE_NAMESPACE['NATIVE_PREFLIGHT']
        patched=diagnostic.diagnostic_preflight(original)
        self.assertIn("patch.object(Page, 'route', guarded_route(Page.route, checkpoint, quote))",patched)
        self.assertIn("(Page, 'set_input_files'), (Locator, 'set_input_files'), (FileChooser, 'set_files')",patched)
        self.assertIn("(creator, ('prepare', 'submit', 'save')",patched)
        self.assertIn("'begin_upload_context', 'validate_upload_context', 'accept_storage_upload'",patched)
        self.assertIn("if policy or registration:\n            return False, True",patched)
        self.assertIn("contract = registration.read_contract(editor['page'], done, source)",patched)
        self.assertNotIn('install_inventory_probe',patched)
        with self.assertRaisesRegex(diagnostic.InspectionError,'markers changed'):
            diagnostic.diagnostic_preflight(original.replace("        quote = sys.modules['nexvia_quote_attachment']",''))

    def test_release_digest_precedes_compilation_and_loader_is_main_disabled(self):
        with patch.object(diagnostic,'urlopen',return_value=SimpleNamespace(read=lambda maximum:RELEASE_RAW)):
            loaded=diagnostic.release_namespace()
        self.assertEqual(loaded.decoded_payload(),FILES)
        self.assertNotEqual(loaded.__name__,'__main__')
        with patch.object(diagnostic,'urlopen',return_value=SimpleNamespace(read=lambda maximum:b'PRIVATE UNVERIFIED CODE')), \
                patch('builtins.exec',side_effect=AssertionError('unverified code executed')):
            with self.assertRaisesRegex(diagnostic.InspectionError,'verification failed'):diagnostic.release_namespace()
        with patch.object(diagnostic,'urlopen',side_effect=URLError('PRIVATE URL')):
            with self.assertRaisesRegex(diagnostic.InspectionError,'could not be read'):diagnostic.release_namespace()


class RendererRunnerTests(unittest.TestCase):
    def fixture(self,root):
        journal=root/'panelstock-request-journal';journal.mkdir(mode=0o700)
        lock=journal/'.bridge.lock';lock.touch(mode=0o600)
        identifier='56d29505-f653-45fe-9dbd-f3bc9f5d4654'
        folder=root/'nexvia-requests'/identifier;folder.mkdir(parents=True,mode=0o700)
        request=folder/'request.json';request.write_bytes(b'PRIVATE_ORIGINAL_REQUEST');request.chmod(0o600)
        config=root/'panelstock-requests.json';config.write_bytes(b'PRIVATE_ORIGINAL_CONFIG')
        business=root/'nexvia_requests.py';business.write_bytes(b'ORIGINAL_BUSINESS')
        def snapshot(path):return {'nexvia_requests.py':(business.read_bytes(),0o644),'new-helper.py':None}
        def protected(path):
            return {str(p.relative_to(root)):(p.stat().st_ino,p.stat().st_mode,p.stat().st_size,p.stat().st_mtime_ns,p.stat().st_ctime_ns)
                    for p in root.rglob('*')}
        release=SimpleNamespace(decoded_payload=lambda:dict(FILES),snapshot=snapshot,
            PRIOR_SHA256={'nexvia_requests.py':hashlib.sha256(b'ORIGINAL_BUSINESS').hexdigest()},NEW_FILES={'new-helper.py'},
            check_parser=lambda root:None,read_config=lambda path:(config.read_bytes(),None),
            observed_registration_evidence=lambda root,rid:hashlib.sha256(request.read_bytes()).hexdigest(),
            protected_state=protected,private_read=lambda path,*args:path.read_bytes(),
            NATIVE_PREFLIGHT=RELEASE_NAMESPACE['NATIVE_PREFLIGHT'],registration_failure_codes=lambda raw:isolated_registration().PUBLIC_FAILURE_CODES)
        def child(args,**options):
            import fcntl
            self.assertIn('-I',args);self.assertIn('-B',args)
            self.assertTrue(all(name not in options['env'] for name in ('DEBUG','PWDEBUG','DEBUG_FILE')))
            descriptor=os.open(lock,os.O_RDONLY)
            try:
                with self.assertRaises(BlockingIOError):fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:os.close(descriptor)
            payload=json.loads(options['input'])
            self.assertEqual(set(payload['sources']),{name[:-3] for name in FILES})
            report=child_report()
            report.update(requestId=identifier,requestFileSha256=payload['requestFileSha256'],
                          sourceSha256={name[:-3]:hashlib.sha256(raw).hexdigest() for name,raw in FILES.items()})
            return SimpleNamespace(returncode=0,stdout=json.dumps(report).encode())
        return identifier,release,child,protected,request,config,business

    def test_runner_keeps_lock_and_all_original_evidence_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);identifier,release,child,protected,*_=self.fixture(root)
            before=protected(root)
            with patch.object(diagnostic.subprocess,'run',side_effect=child), \
                    patch.dict(os.environ,{'DEBUG':'PRIVATE','PWDEBUG':'PRIVATE','DEBUG_FILE':'PRIVATE'}):
                result=diagnostic.inspect(root,identifier,release)
            self.assertEqual(protected(root),before)
            self.assertFalse(result['compatibilityApproved'])
            self.assertNotIn('PRIVATE',json.dumps(result))

    def test_runner_rejects_drift_in_request_config_or_module_after_child(self):
        for changed_index in (0,1,2):
            with self.subTest(changed=changed_index),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);identifier,release,child,protected,*paths=self.fixture(root)
                def changed(*args,**options):
                    result=child(*args,**options);paths[changed_index].write_bytes(b'PRIVATE_CHANGED');return result
                with patch.object(diagnostic.subprocess,'run',side_effect=changed):
                    with self.assertRaisesRegex(diagnostic.InspectionError,'evidence changed'):
                        diagnostic.inspect(root,identifier,release)

    def test_unexpected_baseline_or_child_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);identifier,release,child,*_=self.fixture(root)
            original=release.snapshot
            release.snapshot=lambda root:{'nexvia_requests.py':(b'UNKNOWN',0o644),'new-helper.py':None}
            with patch.object(diagnostic.subprocess,'run',side_effect=AssertionError('child invoked')):
                with self.assertRaisesRegex(diagnostic.InspectionError,'modules differ'):diagnostic.inspect(root,identifier,release)
            release.snapshot=original
            for output in (SimpleNamespace(returncode=1,stdout=b''),SimpleNamespace(returncode=0,stdout=b'x'*16385),
                           SimpleNamespace(returncode=0,stdout=b'PRIVATE INVALID JSON')):
                with self.subTest(output=output.returncode),patch.object(diagnostic.subprocess,'run',return_value=output):
                    with self.assertRaises(diagnostic.InspectionError):diagnostic.inspect(root,identifier,release)

    def test_real_lock_is_exclusive_readonly_and_unsafe_lock_is_rejected(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=root/'panelstock-request-journal';folder.mkdir(mode=0o700)
            path=folder/'.bridge.lock';path.touch(mode=0o600);before=path.stat()
            with diagnostic.work_lock(root):
                descriptor=os.open(path,os.O_RDONLY)
                try:
                    with self.assertRaises(BlockingIOError):fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
                finally:os.close(descriptor)
            after=path.stat()
            self.assertEqual((before.st_ino,before.st_mode,before.st_mtime_ns,before.st_ctime_ns),
                             (after.st_ino,after.st_mode,after.st_mtime_ns,after.st_ctime_ns))
            path.chmod(0o644)
            with self.assertRaisesRegex(diagnostic.InspectionError,'lock is unsafe'):
                with diagnostic.work_lock(root):self.fail('unsafe lock admitted')


if __name__=='__main__':unittest.main()
