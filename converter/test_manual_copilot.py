import base64
import copy
import io
import json
import os
import unittest
from unittest.mock import patch
from PIL import Image
from cad_ai import analyse
from manual_copilot import check_schema, read_response
from pack_reader import schema
from panel_cad import CadError
from test_pack_reader import group, POLICY


def complete(value, rule):
    if value is None:
        kinds=rule['type'] if isinstance(rule['type'],list) else [rule['type']]
        if 'null' in kinds:return None
        if 'enum' in rule:return rule['enum'][0]
        value={'object':{},'array':[],'string':'','boolean':False,'integer':0,'number':0}[kinds[0]]
    if isinstance(value,dict):
        return {k:complete(value.get(k),v) for k,v in rule['properties'].items()}
    if isinstance(value,list):return [complete(v,rule['items']) for v in value]
    return value


class ManualCopilotTests(unittest.TestCase):
    def setUp(self):
        stream=io.BytesIO();Image.new('RGB',(80,80),'white').save(stream,'PNG')
        self.body={'mime':'image/png','filename':'source.png','data':base64.b64encode(stream.getvalue()).decode(),'policy':POLICY}
        g=group()
        for i,edge in enumerate(g['spec']['edges']):
            edge.update(kind='horizontal' if i%2==0 else 'vertical',lengthRole='true-length')
        self.inventory=complete({'pageKind':'drawing','groups':[g],'declaredPanelCount':1,'issues':[]},schema())
        self.inventory['groups'][0]['spec']['developedBoundary']=None
        self.prepared=analyse({**self.body,'mode':'copilot-prepare','reading':1})

    def response(self,reading=1,inventory=None):
        return json.dumps({'sourceId':self.prepared['sourceId'],'reading':reading,'inventory':inventory or self.inventory})

    def test_no_credentials_or_provider_calls_and_preserved_geometry(self):
        with patch.dict(os.environ,{},clear=True),patch('urllib.request.urlopen',side_effect=AssertionError('Network forbidden')):
            first=analyse({**self.body,'mode':'copilot-read','response':self.response()})
            self.assertEqual(first['readerModel'],'Microsoft 365 Copilot (manual transfer)')
            result=analyse({**self.body,'mode':'copilot-verify','firstResponse':self.response(),'response':self.response(2),'independentConfirmed':True})
        self.assertTrue(result['verified'],result['issues']);self.assertEqual(len(result['groups']),1)
        self.assertEqual(result['groups'][0]['spec']['foldSectionsTop'],[550,25,20])

    def test_binding_to_page_settings_reading_and_revision(self):
        for changes in ({'policy':{**POLICY,'thickness':4}}, {'data':self.body['data'][:-4]+'AAAA'}):
            with self.assertRaises(CadError):analyse({**self.body,**changes,'mode':'copilot-read','response':self.response()})
        with self.assertRaises(CadError):read_response(self.response(2),self.prepared['sourceId'],1)
        with self.assertRaises(CadError):read_response(self.response(),'outdated-source',1)

    def test_strict_json_rejects_malformed_missing_extra_duplicate_and_nonfinite(self):
        for value in ('not JSON',self.response()[:-1],self.response().replace('"reading": 1','"reading": 1, "reading": 1'),self.response().replace('2510','NaN')):
            with self.subTest(value=value[:25]),self.assertRaises(CadError):read_response(value,self.prepared['sourceId'],1)
        for change in ('missing','extra','bool'):
            value=copy.deepcopy(self.inventory)
            if change=='missing':del value['groups'][0]['spec']['dimensionBasis']
            if change=='extra':value['verified']=True
            if change=='bool':value['groups'][0]['panels'][0]['quantity']=True
            with self.assertRaises(CadError):check_schema(value,schema())
        self.assertEqual(read_response('```json\n'+self.response()+'\n```',self.prepared['sourceId'],1),self.inventory)

    def test_disagreement_and_unresolved_source_block(self):
        for change in ('dimensions','basis','amendment'):
            second=copy.deepcopy(self.inventory)
            spec=second['groups'][0]['spec']
            if change=='dimensions':
                spec['edges'][0]['site']=2400;spec['edges'][2]['site']=2400
            if change=='basis':spec['dimensionBasis']='unresolved'
            if change=='amendment':spec['amendments']=[{'corner':0,'dx':2,'dy':0,'endpointStatus':'unresolved','evidence':'unclear arrow'}]
            result=analyse({**self.body,'mode':'copilot-verify','firstResponse':self.response(),'response':self.response(2,second),'independentConfirmed':True})
            self.assertFalse(result['verified']);self.assertFalse(result['groups']);self.assertTrue(result['issues'])
        with self.assertRaises(CadError):analyse({**self.body,'mode':'copilot-verify','firstResponse':self.response(),'response':self.response(2)})

    def test_prompt_has_current_rules_and_no_prior_response(self):
        second=analyse({**self.body,'mode':'copilot-prepare','reading':2,'inventory':{'secret':'prior-reading'}})
        self.assertEqual(second['sourceId'],self.prepared['sourceId'])
        for word in ('dimensionBasis','endpointStatus','sourceConstraints','reading=2'):self.assertIn(word,second['prompt'])
        self.assertNotIn('prior-reading',second['prompt'])
        self.assertTrue(second['sourceImage'].startswith('data:image/png;base64,'))
