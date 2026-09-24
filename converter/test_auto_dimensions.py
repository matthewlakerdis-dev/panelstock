import copy
import unittest
import json, base64
from unittest.mock import patch
from cad_ai import analyse
from panel_cad import finish_extracted_spec, CadError, generate

def fixture():
    return {'panelId':'Z3-130','unsupported':False,'questions':[], 'folds':[],
        'edges':[dict(direction=d,code=c,site=s,finished=None) for d,c,s in zip(
        ['right','up','left','up','left','down','left','down'],
        ['NT','B','S','RE','RE','RE','S','B'],
        [700,300,150,200,400,200,150,300])]}

class AutomaticDimensions(unittest.TestCase):
    def test_reader_returns_calculated_lengths(self):
        response={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(fixture())}]}]}
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return json.dumps(response).encode()
        with patch.dict('os.environ',{'OPENAI_API_KEY':'synthetic','CAD_AI_MODEL':'test'}),patch('urllib.request.urlopen',return_value=Reply()):
            result=analyse({'mime':'application/pdf','data':base64.b64encode(b'%PDF-test').decode()})
        self.assertEqual(result['spec']['edges'][0]['finished'],698)
        self.assertFalse(result['spec']['unsupported'])

    def test_z3_deductions_and_dxf(self):
        source=fixture(); result=finish_extracted_spec(source)
        self.assertEqual([e['finished'] for e in result['edges']], [698,298,150,200,398,200,150,298])
        self.assertTrue(all(e['finished'] is None for e in source['edges']))
        self.assertFalse(result['reviewed'])
        result['reviewed']=True
        self.assertEqual(generate(result)['validation']['holes'],8)

    def test_bad_directions_are_not_silently_repaired(self):
        source=fixture()
        for i in [2,4,6]: source['edges'][i]['direction']='right'
        with self.assertRaisesRegex(CadError,'do not close'):finish_extracted_spec(source)

    def test_factory_edge_conflict_requires_review(self):
        source=fixture()
        for e,c in zip(source['edges'],['CR','B','S','FE','FE','FE','S','B']):e['code']=c
        with self.assertRaisesRegex(CadError,'factory-edge length'):
            finish_extracted_spec(source)

    def test_internal_folds(self):
        source={'panelId':'FOLD','folds':[30,90],'edges':[dict(direction=d,code='B',site=s) for d,s in zip(['right','up','left','down'],[850,690,850,690])]}
        result=finish_extracted_spec(source)
        self.assertEqual(result['folds'],[28,86])
        self.assertEqual([e['finished'] for e in result['edges']],[848,684,848,684])

    def test_missing_site_is_not_guessed(self):
        source=fixture();source['edges'][0]['site']=None
        with self.assertRaises(CadError):finish_extracted_spec(source)

    def test_tiny_panel_rejected(self):
        source={'folds':[],'edges':[dict(direction=d,code='B',site=1) for d in ['right','up','left','down']]}
        with self.assertRaises(CadError):finish_extracted_spec(source)

if __name__=='__main__':unittest.main()

