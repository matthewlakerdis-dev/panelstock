import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

import build_quote_registration_probe as builder
import nexvia_inspect_quote_registration as probe
import nexvia_inspect_failed_quote_upload as parser
import test_nexvia_check_quote_policy as fixtures

SEND = fixtures.SOURCE
DONE = """function(e,data){let file=data.files[0];let route;file.url=file.response.url;
if(controller==='staff'||controller==='admin'){route='/upload/details/';}else{route='/'+controller+'/upload/details/';}
$.ajax({url:route+file.response.id,type:'GET',data:{file_url:file.response.url},async:true});
let preview=function(data){$.ajax({url:'/staff/upload/preview/'+data.id,type:'GET',data:{image:data.url}});};
}"""


class ContractTests(unittest.TestCase):
    def test_primary_get_is_separate_from_nested_preview_and_preserves_url_metadata_provenance(self):
        report, _, _, _ = probe.source_contract(DONE, SEND, parser)
        self.assertEqual(report['doneSourceSha256'], hashlib.sha256(DONE.encode()).hexdigest())
        self.assertEqual(report['primary']['functionDepth'], 0)
        self.assertEqual(len(report['otherGETs']), 1)
        self.assertEqual(report['otherGETs'][0]['functionDepth'], 1)
        data = report['primary']['data'][0]
        self.assertTrue(data['metadataSourceMatchesFileURL'])
        self.assertTrue(data['metadataSourceMatchesURL'])
        self.assertFalse(data['metadataSourceMatchesSignedKey'])
        self.assertEqual(data['key']['sha256'], hashlib.sha256(b'file_url').hexdigest())
        templates = report['primary']['urlTemplates']
        self.assertEqual(templates[0][0]['literal']['path'], '/upload/details/')
        self.assertTrue(templates[0][0]['literal']['trailingSlash'])

    def test_signed_key_vs_url_and_unknown_property_names_are_distinguished_without_leaking(self):
        changed = DONE.replace('file_url:file.response.url', 'privateMetadata:file.response.key')
        report, _, _, _ = probe.source_contract(changed, SEND, parser)
        data = report['primary']['data'][0]
        self.assertTrue(data['metadataSourceMatchesSignedKey'])
        self.assertFalse(data['metadataSourceMatchesFileURL'])
        self.assertNotIn('privateMetadata', json.dumps(report))
        unknown = changed.replace('file.response.key', 'file.response.privateAccountValue')
        report, _, _, _ = probe.source_contract(unknown, SEND, parser)
        self.assertNotIn('privateAccountValue', json.dumps(report))

    def test_ambiguous_outer_get_or_missing_native_file_alias_is_rejected(self):
        for value in (DONE[:-1]+"$.ajax({url:'/staff/other',type:'GET',data:{}});}", DONE.replace('data.files[0]', 'data.files[1]')):
            with self.assertRaises(probe.RegistrationInspectionError): probe.source_contract(value, SEND, parser)

    def test_probe_build_is_frozen_deterministic_and_has_no_new_runtime_module_install(self):
        first = builder.build()
        self.assertEqual(first, builder.build())
        namespace = {'__name__':'passive_probe_test'}
        exec(compile(first, '<passive-probe>', 'exec'), namespace)
        runtime = namespace['frozen_runtime']()
        self.assertEqual(runtime.Q_SHA256, '7ae35580eaae6bdbea79cb71ce86d33ceebbab7313494d21fcab8ccb9eeed7a5')
        self.assertTrue(callable(runtime.guarded_native_context))


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): fixtures.PolicyCheckerTests.setUpClass()

    def setUp(self):
        self.flow = fixtures.PolicyCheckerTests('runTest')
        self.flow.setUp()
        self.addCleanup(self.flow.tearDown)
        self.frozen = (Path(__file__).parent/'releases/check_nexvia_quote_policy_v2.py').read_bytes()

    def test_passive_inspection_preserves_originals_and_never_opens_pdf_or_calls_prepare(self):
        before = self.flow.originals()
        called = []
        def inspect(*args):
            called.append(True)
            return {'doneSourceSha256':'a'*64, 'primary':{'functionDepth':0}}
        result = probe.inspect_request(self.flow.identifier, self.flow.root, frozen=self.frozen,
                                       browser=SimpleNamespace(), inspector=inspect)
        self.assertEqual(result['status'], 'inspected')
        self.assertTrue(result['originalsUnchanged'])
        self.assertEqual(self.flow.originals(), before)
        self.assertEqual(called, [True])
        self.assertEqual({key:result[key] for key in ('policyRequests','storageUploads','registrations','poSubmissions','emails')},
                         dict.fromkeys(('policyRequests','storageUploads','registrations','poSubmissions','emails'),0))
        self.assertTrue((self.flow.root/probe.REPORT_DIRECTORY/(self.flow.identifier+'.json')).exists())


if __name__ == '__main__': unittest.main()
