"""Exercise callback capture through the real v3 child and report writer."""
import ast
import base64
from contextlib import contextmanager, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('done_diagnostic', ROOT / 'releases/check_nexvia_done_source_v2.py')
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)
DONE = """function(e,data){let file=data.files[0];if(data.response){let target;file.url=file.cache.path;
if(controller==='admin'||controller==='client'){target='/PRIVATE_ROUTE/';}else{target='/'+controller+'/PRIVATE_ROUTE/';}
$.ajax({url:target+file.cache.id,type:'GET',data:{location:file.cache.path},async:true});
const privateName='PRIVATE_SOURCE_LITERAL';}}"""
SEND = "function(e,data){let file=data.files[0];form.append('key',file.cache.key);}"
QUOTE = '''import os
from contextlib import contextmanager
BLANK_DRAFT_GUARD_VERSION=5
POLICY_UPLOAD_GUARD_VERSION=2
POLICY_SEND_SHA256='a'*64
POLICY_OPERATION_SHA256='b'*64
class QuoteAttachmentError(ValueError):pass
@contextmanager
def private_folder(folder):
    fd=os.open(folder,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:yield fd
    finally:os.close(fd)
def validate_native_draft(*a,**k):raise QuoteAttachmentError('Native quote uploader contract changed.')
def upload_quote(*a,**k):raise RuntimeError('mutation')
begin_upload=complete_upload=source_upload_payload=begin_upload_context=validate_upload_context=accept_storage_upload=upload_quote
'''
REGISTRATION = "PUBLIC_FAILURE_CODES=frozenset({'registration_source_changed'})\nclass RegistrationError(ValueError):pass\n"


def artifact(path):
    ns={'__name__':'frozen_artifact_test'}
    exec(compile((ROOT/'releases'/path).read_bytes(),path,'exec'),ns)
    return ns


class DoneSourceDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.installer=artifact('install_nexvia_quote_registration_update_v3.py')
        self.probe=artifact('inspect_nexvia_quote_registration_v1.py')
        self.words=diagnostic.vocabulary((ROOT/'nexvia_inspect_quote_upload.py').read_bytes())
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.folder=self.root/'nexvia-requests'/diagnostic.REQUEST_ID
        self.folder.mkdir(parents=True,mode=0o700)
        self.request={'requestId':diagnostic.REQUEST_ID,'quote':{'filename':'PRIVATE.pdf','bytes':32}}
        (self.folder/'request.json').write_text(json.dumps(self.request));(self.folder/'request.json').chmod(0o600)
        journal=self.root/'panelstock-request-journal';journal.mkdir(mode=0o700)
        self.fd=os.open(journal/'.bridge.lock',os.O_RDWR|os.O_CREAT,0o600);self.addCleanup(os.close,self.fd)
        self.state={'widgets':[{'doneSource':DONE,'sendSource':SEND}]}
        self.files={'nexvia_quote_registration.py':REGISTRATION.encode(),
                    'nexvia_quote_attachment.py':(QUOTE+'\nNATIVE_STATE_JS='+repr(json.dumps(self.state))).encode()}
        self.browser_failure=None;self.signed_in=True;self.child_calls=0

    def run_real_child_main(self,command,**options):
        self.child_calls+=1
        namespace={'__name__':'child_pipeline_test'}
        exec(compile(command[4],'<instrumented-v3-child>','exec'),namespace)
        @contextmanager
        def editor(*args,**kwargs):
            yield {'page':SimpleNamespace(evaluate=lambda script,*args:json.loads(script)), 'createPath':'/draft'}
        @contextmanager
        def owned(*args):yield object()
        creator=ModuleType('nexvia_create');creator.BASE='https://lennox.nexvia.com.au'
        creator.quote_attachment_descriptor=lambda request,quote:quote
        creator.native_line_editor=editor;creator.quote_browser_context=owned
        creator.prepare=creator.submit=creator.save=lambda *a,**k:self.fail('mutation entrypoint called')
        class Page:
            def route(*args,**kwargs):raise AssertionError('no navigation needed in synthetic child')
            def set_input_files(*args,**kwargs):raise AssertionError('file selection')
        class Locator:
            def set_input_files(*args,**kwargs):raise AssertionError('file selection')
        class FileChooser:
            def set_files(*args,**kwargs):raise AssertionError('file selection')
        def connect(*args,**kwargs):
            if self.browser_failure:raise self.browser_failure
            return SimpleNamespace(contexts=[SimpleNamespace(pages=[SimpleNamespace(url=creator.BASE+'/staff/')])] if self.signed_in else [])
        @contextmanager
        def playwright():yield SimpleNamespace(chromium=SimpleNamespace(connect_over_cdp=connect))
        api=ModuleType('playwright.sync_api');api.sync_playwright=playwright
        api.Page=Page;api.Locator=Locator;api.FileChooser=FileChooser
        modules={'nexvia_create':creator,'nexvia_preparation_diagnostics':SimpleNamespace(DIAGNOSTICS_VERSION=1),
                 'playwright':ModuleType('playwright'),'playwright.sync_api':api,
                 'nexvia_quote_registration':None,'nexvia_quote_attachment':None}
        stream=SimpleNamespace(buffer=io.BytesIO(options['input']))
        with patch.dict(sys.modules,modules),patch.object(sys,'stdin',stream),patch.object(sys,'argv',['child',str(self.root),str(self.fd)]),redirect_stdout(io.StringIO()) as output:
            namespace['main']()
        return subprocess.CompletedProcess(command,0,output.getvalue().encode())

    def invoke(self,analyze=None):
        analyze=analyze or (lambda sources:diagnostic.inspect_sources(sources,self.probe,self.words))
        messages=frozenset({'Native quote uploader contract changed.'})
        with patch.object(self.installer['subprocess'],'run',self.run_real_child_main):
            original,observed=diagnostic.prepare(self.installer,analyze,messages)
            try:
                with self.assertRaisesRegex(self.installer['QuotePolicyUpdateError'],'failed at'):
                    self.installer['_native_policy_preflight'](self.root,Path('/synthetic/python'),self.files,diagnostic.REQUEST_ID,bridge_lock_fd=self.fd)
            finally:self.installer['subprocess'].run=original
        return observed

    def test_complete_child_pipeline_captures_source_before_validation_and_saves_no_raw_source(self):
        observed=self.invoke()
        self.assertEqual(self.child_calls,1)
        self.assertEqual(observed['captureStatus'],'captured')
        self.assertEqual(observed['phase'],'source_captured')
        self.assertEqual(observed['errorType'],'QuoteAttachmentError')
        self.assertEqual(observed['callback']['doneSourceSha256'],hashlib.sha256(DONE.encode()).hexdigest())
        self.assertIn('symbolicComplete',observed['callback']['sourceAudit'])
        saved=(self.root/'nexvia-registration-v3-checks'/(diagnostic.REQUEST_ID+'.json')).read_text()
        for private in ('PRIVATE_SOURCE_LITERAL','PRIVATE_ROUTE','callbackSources','sourceAudit'):
            self.assertNotIn(private,saved)
            if private.startswith('PRIVATE_'):self.assertNotIn(private,json.dumps(observed))

    def test_child_session_failure_has_exact_phase_and_safe_reason_without_private_browser_text(self):
        self.signed_in=False
        result=self.invoke()
        self.assertEqual(result['phase'],'signed_in_context')
        self.assertEqual(result['reason'],'no_signed_in_context')
        self.assertEqual(result['errorType'],'AssertionError')
        self.assertEqual(result['captureStatus'],'not_reached')
        self.assertNotIn('callback',result)

    def test_child_connection_failure_has_exact_phase_and_error_class(self):
        self.browser_failure=TimeoutError('PRIVATE_BROWSER_TOKEN')
        result=self.invoke()
        self.assertEqual(result['phase'],'connect_browser')
        self.assertEqual(result['errorType'],'TimeoutError')
        self.assertNotIn('PRIVATE_BROWSER_TOKEN',json.dumps(result))

    def test_auditor_failure_still_strips_source_before_saved_report(self):
        def failure(value):raise ValueError('PRIVATE_ANALYSIS_TOKEN')
        result=self.invoke(failure)
        self.assertEqual(result['callback']['code'],'source_analysis_failed')
        self.assertEqual(result['callback']['errorType'],'ValueError')
        saved=(self.root/'nexvia-registration-v3-checks'/(diagnostic.REQUEST_ID+'.json')).read_text()
        for text in ('PRIVATE_', 'callbackSources'):self.assertNotIn(text,saved)
        self.assertNotIn('PRIVATE_ANALYSIS_TOKEN',json.dumps(result))

    def test_structural_parser_failure_retains_complete_anonymous_callback_and_hash(self):
        result=diagnostic.inspect_sources({'done':"function(e,data){const file=data.files[0];const value='PRIVATE_SOURCE_LITERAL';}",'send':SEND},self.probe,self.words)
        self.assertEqual(result['status'],'blocked')
        self.assertEqual(result['code'],'done_primary_get_count')
        self.assertEqual(result['sourceAudit']['symbolicStatus'],'complete')
        self.assertIsNotNone(result['sourceAudit']['symbolicComplete'])
        self.assertNotIn('PRIVATE_SOURCE_LITERAL',json.dumps(result))

    def test_summary_failure_keeps_anonymous_body_and_still_parses_structural_contract(self):
        runtime=self.probe['frozen_runtime']()
        @contextmanager
        def bundle():
            with runtime.runtime_bundle() as values:
                with patch.object(values[1],'callback_report',side_effect=AttributeError('PRIVATE_SUMMARY_TOKEN')):
                    yield values
        probe=dict(self.probe,frozen_runtime=lambda:SimpleNamespace(runtime_bundle=bundle))
        result=diagnostic.inspect_sources({'done':DONE,'send':SEND},probe,self.words)
        self.assertEqual(result['status'],'inspected')
        self.assertEqual(result['code'],'done_source_observed')
        self.assertEqual(result['sourceAudit']['symbolicStatus'],'complete')
        self.assertTrue(result['sourceAudit']['symbolicComplete'])
        self.assertEqual(result['sourceAudit']['summaryStatus'],'failed')
        self.assertEqual(result['sourceAudit']['summaryErrorType'],'AttributeError')
        self.assertIn('primary',result['contract'])
        self.assertNotIn('PRIVATE_SUMMARY_TOKEN',json.dumps(result))

    def test_original_route_and_mutation_tripwires_are_identical(self):
        old=ast.parse(self.installer['NATIVE_PREFLIGHT'])
        with patch.object(self.installer['subprocess'],'run'):
            diagnostic.prepare(self.installer,lambda value:{},frozenset())
        new=ast.parse(self.installer['NATIVE_PREFLIGHT'])
        for name in ('blocked','completion_path','route_decision','guarded_route'):
            get=lambda tree:ast.dump(next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name==name))
            self.assertEqual(get(old),get(new))

    def test_sources_are_removed_before_original_successful_report_validation(self):
        report={'passed':True,'stage':'verified','callbackSources':{'done':DONE,'send':SEND},
                'captureStatus':'captured','auditPhase':'source_captured','auditReason':None,'errorType':None}
        def run(*args,**kwargs):return subprocess.CompletedProcess(args[0],0,json.dumps(report).encode())
        with patch.object(self.installer['subprocess'],'run',run):
            _original,observed=diagnostic.prepare(self.installer,lambda value:{'status':'inspected'},frozenset())
            result=self.installer['subprocess'].run(['python','-I','-B','-c',self.installer['NATIVE_PREFLIGHT'],'/config','5'])
        self.assertEqual(json.loads(result.stdout),{'passed':True,'stage':'verified'})
        self.assertEqual(observed['callback'],{'status':'inspected'})

    def test_diagnose_holds_lock_preserves_evidence_and_never_calls_installer_entrypoints(self):
        held=False;calls=[]
        @contextmanager
        def lock(*args):
            nonlocal held
            held=True;calls.append('lock')
            try:yield 27
            finally:held=False;calls.append('unlock')
        def preflight(*args,**kwargs):
            self.assertTrue(held);self.assertEqual(kwargs['bridge_lock_fd'],27);calls.append('preflight');return True
        def evidence(*args):calls.append('evidence');return {'same':True}
        def forbidden(*args,**kwargs):self.fail('installer or old browser entrypoint called')
        self.installer.update(decoded_payload=lambda:self.files,lock_file=lock,_native_policy_preflight=preflight,
                              observed_registration_evidence=evidence,main=forbidden,install=forbidden)
        self.probe.update(main=forbidden,inspect_request=forbidden,inspect_native=forbidden)
        with patch.object(self.installer['subprocess'],'run'),redirect_stdout(io.StringIO()):
            diagnostic.diagnose(self.installer,self.probe,self.words,b'def require(x,m):pass',self.root)
        self.assertEqual(calls,['lock','evidence','preflight','evidence','unlock'])

    def test_downloads_are_fixed_bounded_verified_and_unverified_code_never_executes(self):
        source=(ROOT/'releases/install_nexvia_quote_registration_update_v3.py').read_bytes();seen=[]
        def read(maximum):seen.append(maximum);return source
        with patch.object(diagnostic,'urlopen',return_value=SimpleNamespace(read=read)) as fetch:
            namespace=diagnostic.fetch_namespace(diagnostic.INSTALLER_URL,diagnostic.INSTALLER_SHA)
        self.assertEqual(seen,[diagnostic.MAX_RELEASE+1])
        self.assertEqual(fetch.call_args.args[0].full_url,diagnostic.INSTALLER_URL)
        self.assertEqual(namespace['NATIVE_PREFLIGHT'],self.installer['NATIVE_PREFLIGHT'])
        for data in (b'raise Exception("PRIVATE_UNVERIFIED_CODE")',b'x'*(diagnostic.MAX_RELEASE+1)):
            with patch.object(diagnostic,'urlopen',return_value=SimpleNamespace(read=lambda maximum:data)),self.assertRaisesRegex(ValueError,'download_verification'):
                diagnostic.fetch_namespace(diagnostic.PROBE_URL,diagnostic.PROBE_SHA)

    def test_fixed_allocation_and_lookup_errors_are_allowed_but_private_values_are_not(self):
        source=b"require(ok, 'Native allocation selection changed.'); value='PRIVATE_LITERAL'; raise ValueError('Live lookup changed.')"
        self.assertEqual(diagnostic.literal_errors(source),frozenset({'Native allocation selection changed.','Live lookup changed.'}))

    def test_local_vocabulary_source_is_pinned_regular_bounded_and_not_a_symlink(self):
        raw=(ROOT/'nexvia_inspect_quote_upload.py').read_bytes()
        path=self.root/'vocabulary.py';path.write_bytes(raw);path.chmod(0o600)
        self.assertEqual(diagnostic.local_source(self.root,path.name,diagnostic.VOCABULARY_SHA),raw)
        with self.assertRaisesRegex(ValueError,'local_source_verification'):
            diagnostic.local_source(self.root,path.name,'0'*64)
        link=self.root/'link.py';link.symlink_to(path)
        with self.assertRaises(OSError):diagnostic.local_source(self.root,link.name,diagnostic.VOCABULARY_SHA)
        path.chmod(0o622)
        with self.assertRaisesRegex(ValueError,'local_source_file'):
            diagnostic.local_source(self.root,path.name,diagnostic.VOCABULARY_SHA)

    def test_chunk_export_is_bounded_roundtrips_and_contains_no_raw_program(self):
        observed=self.invoke();rows=diagnostic.report_chunks(observed)
        encoded=''.join(row.split(' ',2)[2] for row in rows)
        self.assertEqual(json.loads(zlib.decompress(base64.b64decode(encoded))),observed)
        self.assertTrue(all(len(row.split(' ',2)[2])<=800 for row in rows))
        self.assertNotIn('PRIVATE_SOURCE_LITERAL',json.dumps(observed))
        with self.assertRaisesRegex(ValueError,'sanitized_report_size'):diagnostic.report_chunks({'text':'x'*262145})


if __name__=='__main__':unittest.main()
