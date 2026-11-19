"""Value-free rejected-guard inspection and source-only bypass boundaries."""
import base64
from contextlib import contextmanager, redirect_stdout
import copy
import hashlib
import io
import json
from pathlib import Path
import stat
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import URLError

import nexvia_inspect_registration_inventory as diagnostic
import nexvia_quote_registration as registration
import test_nexvia_quote_registration as fixture


def isolated_registration():
    module=ModuleType('isolated_inventory_fixture')
    exec(compile(Path(registration.__file__).read_bytes(),'isolated_inventory_fixture.py','exec'),module.__dict__)
    module.SEND_SOURCE_SHA256=hashlib.sha256(fixture.SEND_SOURCE.encode()).hexdigest()
    module.PREFIX_SHA256=hashlib.sha256(fixture.PREFIX.encode()).hexdigest()
    return module


def expected_report():
    return {'format':'nexvia-native-policy-compatibility','version':1,'requestId':'fixture-request',
            'requestFileSha256':'a'*64,'sourceSha256':{'fixture':'b'*64},
            'readOnly':True,'fileSelected':False,'policyRequested':False,'fileUploaded':False,
            'poCreated':False,'poChanged':False,'emailSent':False}


class InventoryInspectionTests(unittest.TestCase):
    def test_original_inventory_failure_survives_pure_downstream_recheck(self):
        module=isolated_registration()
        module._controller=lambda *a: self.fail('controller called')
        module._renderer_contract=lambda *a: self.fail('renderer called')
        state={}
        diagnostic.install_inventory_probe(module,state)
        done=fixture.DONE_SOURCE.replace('"opaque-26"','"open"',1).replace('"opaque-27"','"PRIVATE_PASSWORD https://private.invalid/token"',1)
        with self.assertRaisesRegex(module.RegistrationError,'registration_network_inventory'):
            module.read_contract(object(),done,fixture.SEND_SOURCE)
        self.assertTrue(state['originalInventoryFailure'])
        self.assertEqual(state['sourceAfterInventory'],{'status':'pure_source_pass','reason':None})
        self.assertEqual(state['inventory']['firstClause'],'forbidden_token')
        self.assertEqual(state['inventory']['forbidden'][0]['name'],'open')
        self.assertTrue(state['inventory']['forbidden'][0]['colon'])
        # The live candidate's guard is still rejecting after the clone ran.
        with self.assertRaisesRegex(module.RegistrationError,'registration_network_inventory'):
            module._source_contract(done,fixture.SEND_SOURCE)
        self.assertNotIn('PRIVATE',json.dumps(state))
        self.assertNotIn('private.invalid',json.dumps(state))

    def test_original_source_success_still_stops_before_browser_contract_work(self):
        module=isolated_registration();state={}
        module._controller=lambda *a:self.fail('controller called')
        diagnostic.install_inventory_probe(module,state)
        with self.assertRaisesRegex(RuntimeError,'stopped before browser contract work'):
            module.read_contract(object(),fixture.DONE_SOURCE,fixture.SEND_SOURCE)
        self.assertEqual(state['sourceAfterInventory'],{'status':'original_source_pass','reason':None})
        self.assertFalse(state.get('originalInventoryFailure',False))

    def test_downstream_raw_role_failure_is_finite_and_original_error_is_reraised(self):
        module=isolated_registration();state={}
        diagnostic.install_inventory_probe(module,state)
        done=fixture.DONE_SOURCE.replace('"opaque-26"','"open"',1).replace("'location'","'PRIVATE_LOCATION'",1)
        with self.assertRaisesRegex(module.RegistrationError,'registration_network_inventory'):
            module.read_contract(object(),done,fixture.SEND_SOURCE)
        self.assertEqual(state['sourceAfterInventory'],{'status':'pure_source_blocked','reason':'registration_query_source'})
        self.assertNotIn('PRIVATE',json.dumps(state))

    def test_inventory_projection_reports_each_guard_clause_without_neighbor_values(self):
        source=fixture.DONE_SOURCE.replace('"opaque-26"','"open"',1)
        tokens=registration._tokens(source);spans=registration._functions(tokens)
        meta=diagnostic.inventory_summary(tokens,spans,registration)
        self.assertEqual(meta['forbiddenCount'],1)
        self.assertTrue(meta['ajaxShapesValid'])
        self.assertTrue(meta['memberShapesValid'])
        self.assertTrue(meta['countsValid'])
        self.assertEqual(meta['ajaxCount'],1);self.assertEqual(meta['memberCount'],1)
        row=meta['forbidden'][0]
        self.assertEqual(set(row),{'name','kind','tokenIndex','depth','call','dot','colon','computed'})
        self.assertEqual(row['kind'],'string');self.assertFalse(row['call'])
        self.assertNotIn('opaque',json.dumps(meta))

    def test_event_lists_are_bounded_and_unknown_identifiers_never_escape(self):
        tokens=[('id','PRIVATE_PASSWORD'),('string','https://private.invalid/query'),('punct',';')]+[('string','open')]*30
        fake=SimpleNamespace(_depth=lambda *a:100000)
        meta=diagnostic.inventory_summary(tokens,[],fake)
        self.assertEqual(meta['forbiddenCount'],30)
        self.assertEqual(len(meta['forbidden']),8)
        self.assertTrue(all(row['depth']==64 for row in meta['forbidden']))
        self.assertNotIn('PRIVATE',json.dumps(meta));self.assertNotIn('private.invalid',json.dumps(meta))

    def test_first_clause_tracks_original_guard_order_not_summary_group_order(self):
        tokens=registration._tokens('x.post();x.ajax({});')
        meta=diagnostic.inventory_summary(tokens,[],SimpleNamespace(_depth=lambda *a:0))
        self.assertEqual(meta['firstClause'],'member_shape')
        self.assertFalse(meta['ajaxShapesValid']);self.assertFalse(meta['memberShapesValid'])
        tokens.append(('string','open'))
        meta=diagnostic.inventory_summary(tokens,[],SimpleNamespace(_depth=lambda *a:0))
        self.assertEqual(meta['firstClause'],'forbidden_token')

    def test_parent_projection_refuses_unexpected_strings_flags_and_approval(self):
        expected=expected_report()
        meta=diagnostic.inventory_summary(registration._tokens(fixture.DONE_SOURCE),registration._functions(registration._tokens(fixture.DONE_SOURCE)),registration)
        value={**expected,'passed':False,'stage':'registration_source','reason':'registration_network_inventory',
               'inventoryDiagnostic':{'inventory':meta,'originalInventoryFailure':True,
                                      'sourceAfterInventory':{'status':'pure_source_pass','reason':None}}}
        result=diagnostic.project_result(value,expected,registration.PUBLIC_FAILURE_CODES)
        self.assertFalse(result['compatibilityApproved'])
        variants=[]
        for name in ('fileSelected','policyRequested','fileUploaded','poCreated','poChanged','emailSent','passed'):
            changed=copy.deepcopy(value);changed[name]=True;variants.append(changed)
        changed=copy.deepcopy(value);changed['inventoryDiagnostic']['inventory']['members'][0]['name']='PRIVATE_PASSWORD';variants.append(changed)
        changed=copy.deepcopy(value);changed['inventoryDiagnostic']['inventory']['members'][0]['tokenIndex']='PRIVATE';variants.append(changed)
        changed=copy.deepcopy(value);changed['inventoryDiagnostic']['sourceAfterInventory']['reason']='PRIVATE';variants.append(changed)
        for changed in variants:
            with self.subTest(field=list(changed)),self.assertRaises(diagnostic.InspectionError):
                diagnostic.project_result(changed,expected,registration.PUBLIC_FAILURE_CODES)

    def test_frozen_preflight_patch_preserves_all_network_and_file_tripwires(self):
        namespace={'__name__':'immutable_v5_fixture'}
        archive=Path(__file__).parent/'releases/install_nexvia_quote_registration_update_v5.py'
        exec(compile(archive.read_bytes(),str(archive),'exec'),namespace)
        patched=diagnostic.diagnostic_preflight(namespace['NATIVE_PREFLIGHT'])
        self.assertIn("patch.object(Page, 'route', guarded_route(Page.route, checkpoint, quote))",patched)
        self.assertIn("(Page, 'set_input_files'), (Locator, 'set_input_files'), (FileChooser, 'set_files')",patched)
        self.assertIn("(creator, ('prepare', 'submit', 'save')",patched)
        self.assertIn('return original_inventory(tokens,spans)',patched)
        self.assertIn('registration.read_contract=pure_stop',patched)
        with self.assertRaisesRegex(diagnostic.InspectionError,'markers changed'):
            diagnostic.diagnostic_preflight(namespace['NATIVE_PREFLIGHT'].replace('def blocked(*args, **kwargs):','def other(*args, **kwargs):'))

    def test_release_network_and_cli_errors_never_echo_raw_input(self):
        with patch.object(diagnostic,'urlopen',side_effect=URLError('https://PRIVATE_PASSWORD@private.invalid/token')):
            with self.assertRaises(diagnostic.InspectionError) as caught:diagnostic.release_namespace()
        self.assertNotIn('PRIVATE',str(caught.exception));self.assertNotIn('private.invalid',str(caught.exception))
        with self.assertRaises(diagnostic.InspectionError) as caught:
            diagnostic.main(['--PRIVATE_PASSWORD'])
        self.assertNotIn('PRIVATE',str(caught.exception))

    def test_frozen_release_digest_is_checked_before_any_execution(self):
        with patch.object(diagnostic,'urlopen',return_value=SimpleNamespace(read=lambda maximum:b'PRIVATE UNVERIFIED CODE')),patch('builtins.exec',side_effect=AssertionError('unverified code executed')):
            with self.assertRaisesRegex(diagnostic.InspectionError,'verification failed'):diagnostic.release_namespace()

    def test_real_work_lock_is_exclusive_and_does_not_rewrite_it(self):
        import fcntl,os
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);folder=root/'panelstock-request-journal';folder.mkdir(mode=0o700)
            path=folder/'.bridge.lock';path.touch(mode=0o600)
            before=path.stat()
            with diagnostic.work_lock(root):
                descriptor=os.open(path,os.O_RDONLY)
                try:
                    with self.assertRaises(BlockingIOError):fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
                finally:os.close(descriptor)
            after=path.stat()
            self.assertEqual((before.st_ino,before.st_mode,before.st_mtime_ns,before.st_ctime_ns),(after.st_ino,after.st_mode,after.st_mtime_ns,after.st_ctime_ns))

    def test_runner_holds_lock_projects_only_metadata_and_checks_evidence_on_return(self):
        import fcntl,os
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);journal=root/'panelstock-request-journal';journal.mkdir(mode=0o700)
            lock=journal/'.bridge.lock';lock.touch(mode=0o600)
            identifier='56d29505-f653-45fe-9dbd-f3bc9f5d4654'
            folder=root/'nexvia-requests'/identifier;folder.mkdir(parents=True,mode=0o700)
            request=folder/'request.json';request.write_bytes(b'PRIVATE_ORIGINAL_REQUEST');request.chmod(0o600)
            config=root/'panelstock-requests.json';config.write_bytes(b'PRIVATE_ORIGINAL_CONFIG')
            business=root/'nexvia_requests.py';business.write_bytes(b'ORIGINAL_BUSINESS')
            files={name:(Path(registration.__file__).parent/name).read_bytes() for name in
                   ('nexvia_quote_attachment.py','nexvia_quote_registration.py','nexvia_generated_callback.py')}
            archive=Path(registration.__file__).parent/'releases/install_nexvia_quote_registration_update_v5.py'
            namespace={'__name__':'frozen_preflight_fixture'};exec(compile(archive.read_bytes(),str(archive),'exec'),namespace)
            def snapshot(path):return {'nexvia_requests.py':(business.read_bytes(),0o644),'new-helper.py':None}
            def protected(path):
                return {str(p.relative_to(root)):(p.stat().st_ino,p.stat().st_mode,p.stat().st_size,p.stat().st_mtime_ns,p.stat().st_ctime_ns)
                        for p in root.rglob('*')}
            release=SimpleNamespace(decoded_payload=lambda:files,snapshot=snapshot,
                PRIOR_SHA256={'nexvia_requests.py':hashlib.sha256(b'ORIGINAL_BUSINESS').hexdigest()},NEW_FILES={'new-helper.py'},
                check_parser=lambda root:None,read_config=lambda path:(config.read_bytes(),None),
                observed_registration_evidence=lambda root,rid:hashlib.sha256(request.read_bytes()).hexdigest(),
                protected_state=protected,private_read=lambda path,*args:path.read_bytes(),
                NATIVE_PREFLIGHT=namespace['NATIVE_PREFLIGHT'],registration_failure_codes=lambda raw:registration.PUBLIC_FAILURE_CODES)
            before=protected(root)
            def child(args,**options):
                self.assertIn('-I',args);self.assertIn('-B',args)
                self.assertNotIn('DEBUG',options['env']);self.assertNotIn('DEBUG_FILE',options['env'])
                descriptor=os.open(lock,os.O_RDONLY)
                try:
                    with self.assertRaises(BlockingIOError):fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
                finally:os.close(descriptor)
                payload=json.loads(options['input'])
                self.assertEqual(set(payload['sources']),{name[:-3] for name in files})
                report={'format':'nexvia-native-policy-compatibility','version':1,'requestId':identifier,
                        'requestFileSha256':payload['requestFileSha256'],
                        'sourceSha256':{name[:-3]:hashlib.sha256(raw).hexdigest() for name,raw in files.items()},
                        'readOnly':True,'fileSelected':False,'policyRequested':False,'fileUploaded':False,
                        'poCreated':False,'poChanged':False,'emailSent':False,'passed':False,'stage':'registration_source',
                        'reason':'registration_network_inventory','inventoryDiagnostic':{}}
                return SimpleNamespace(returncode=0,stdout=json.dumps(report).encode())
            with patch.object(diagnostic.subprocess,'run',side_effect=child),patch.dict(os.environ,{'DEBUG':'PRIVATE','DEBUG_FILE':'PRIVATE'}):
                result=diagnostic.inspect(root,identifier,release)
            self.assertFalse(result['compatibilityApproved'])
            self.assertEqual(protected(root),before)
            self.assertNotIn('PRIVATE',json.dumps(result))
            def changed(*args,**options):
                output=child(*args,**options)
                request.write_bytes(b'PRIVATE_CHANGED_REQUEST')
                return output
            with patch.object(diagnostic.subprocess,'run',side_effect=changed),self.assertRaisesRegex(diagnostic.InspectionError,'evidence changed'):
                diagnostic.inspect(root,identifier,release)


if __name__=='__main__':unittest.main()
