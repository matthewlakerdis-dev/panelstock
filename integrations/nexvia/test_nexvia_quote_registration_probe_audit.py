"""Independent source-scope and redaction checks for the passive DONE probe."""
import json
from pathlib import Path
import unittest

import nexvia_inspect_quote_registration as probe
import test_nexvia_quote_attachment as fixtures


PRIMARY = """function (event, data) {
 if (event.isDefaultPrevented()) { return false; }
 let file = data.files[0];
 if (data.response) {
  let endpoint;
  file.url = file._resp.url;
  if (controller === 'admin' || controller === 'client') {
   endpoint = '/staff/upload/details/';
  } else {
   endpoint = '/' + controller + '/upload/details/';
  }
  $.ajax({url: endpoint + file._resp.id, type: 'GET', dataType: 'json',
          data: {url: file._resp.url}, async: true});
  function preview(data) {
   let file = data.files[0];
   $.ajax({url: '/staff/upload/details/' + file.preview.id, type: 'GET',
           data: {url: file.preview.url}, async: true});
  }
 }
}"""


class RegistrationProbeSourceAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        artifact = Path(__file__).parent / 'releases/check_nexvia_quote_policy_v2.py'
        cls.runtime = probe.frozen_runtime(artifact.read_bytes())

    def parse(self, source=PRIMARY, send=fixtures.SEND_SOURCE):
        with self.runtime.runtime_bundle() as (_, parser, _hashes):
            return probe.source_contract(source, send, parser)[0]

    def test_outer_primary_and_shadowed_preview_callbacks_remain_separate(self):
        result = self.parse()
        self.assertEqual(result['primary']['functionDepth'], 0)
        self.assertEqual(len(result['otherGETs']), 1)
        self.assertEqual(result['otherGETs'][0]['functionDepth'], 1)
        row = result['primary']['data'][0]
        self.assertTrue(row['metadataSourceMatchesFileURL'])
        self.assertTrue(row['metadataSourceMatchesURL'])
        self.assertFalse(row['metadataSourceMatchesSignedKey'])
        self.assertFalse(row['metadataSourceMatchesID'])
        self.assertEqual(row['encoding'], 'direct_member')
        self.assertEqual(result['fileURLAssignments'], 1)

    def test_nested_preview_request_cannot_stand_in_for_an_absent_primary(self):
        source = PRIMARY.replace("$.ajax({url: endpoint + file._resp.id, type: 'GET', dataType: 'json',\n          data: {url: file._resp.url}, async: true});", '')
        with self.assertRaisesRegex(probe.RegistrationInspectionError, 'done_primary_get_count'):
            self.parse(source)

    def test_two_outer_gets_are_ambiguous_even_if_one_is_called_preview(self):
        source = PRIMARY.replace('function preview(data) {', "$.ajax({url: endpoint + file._resp.id, type:'GET', data:{url:file._resp.url}}); function preview(data) {")
        with self.assertRaisesRegex(probe.RegistrationInspectionError, 'done_primary_get_count'):
            self.parse(source)

    def test_expression_arrow_preview_is_explicitly_unsupported_instead_of_outer_primary(self):
        source = """function(event, data) {
            let file = data.files[0];
            const preview = data => $.ajax({url:'/staff/upload/details/' + file.id,
                type:'GET', data:{url:file.url}});
        }"""
        with self.assertRaisesRegex(probe.RegistrationInspectionError, 'done_expression_arrow_unsupported'):
            self.parse(source)

    def test_metadata_source_relationships_are_derived_without_executing_handlers(self):
        source = PRIMARY.replace('data: {url: file._resp.url}', 'data: {url: file._resp.key}')
        send = fixtures.SEND_SOURCE.replace('file.response.key', 'file._resp.key')
        row = self.parse(source, send)['primary']['data'][0]
        self.assertTrue(row['metadataSourceMatchesSignedKey'])
        self.assertFalse(row['metadataSourceMatchesFileURL'])
        self.assertFalse(row['metadataSourceMatchesURL'])
        self.assertFalse(row['metadataSourceMatchesID'])
        unsupported = PRIMARY.replace('data: {url: file._resp.url}', 'data: {url: buildPrivateValue(file)}')
        row = self.parse(unsupported)['primary']['data'][0]
        self.assertEqual(row['encoding'], 'unsupported')
        self.assertIsNone(row['responsePath'])

    def test_unknown_query_keys_members_and_literals_do_not_enter_the_report(self):
        source = PRIMARY.replace('data: {url: file._resp.url}',
            "data: {'PRIVATE_QUERY_NAME': file.PRIVATE_RESPONSE_MEMBER}")
        source = source.replace("'/staff/upload/details/'", "'/PRIVATE_NAMESPACE/upload/details/'")
        result = self.parse(source)
        raw = json.dumps(result)
        for secret in ('PRIVATE_QUERY_NAME', 'PRIVATE_RESPONSE_MEMBER', 'PRIVATE_NAMESPACE'):
            self.assertNotIn(secret, raw)
        self.assertEqual(result['primary']['data'][0]['encoding'], 'direct_member')


if __name__ == '__main__':
    unittest.main()
