import io, unittest, json, base64
from unittest.mock import patch
import ezdxf
from panel_cad import generate,CadError
from cad_ai import analyse

def panel(site,finished,codes,directions=None,folds=None):
    directions=directions or ['right','up','left','down']
    return {'panelId':'TEST-1','reviewed':True,'unsupported':False,'edges':[{'name':str(i),'direction':d,'code':c,'site':s,'finished':f} for i,(s,f,c,d) in enumerate(zip(site,finished,codes,directions))],'folds':folds or []}

class GeometryTests(unittest.TestCase):
    def test_all_approved_examples(self):
        cases=[
            (panel([850,690,850,690],[848,684,848,684],['S','S','B','B'],folds=[28,86]),14),
            (panel([800,400,150,300,650,700],[798,399,149,299,649,698],['B','S','S','S','S','B'],['right','up','left','up','left','down']),19),
            (panel([1500,850,1500,850],[1498,848,1498,848],['S','B','S','B']),24),
            (panel([2200,1500,2200,1500],[2198,1498,2198,1498],['S','B','S','B']),32),
            (panel([1500,850,1500,850],[1498,846,1498,846],['S','B','S','B'],folds=[98]),26),
            (panel([700,300,150,200,400,200,150,300],[698,299,149,200,400,200,149,299],['CR','B','S','FE','FE','FE','S','B'],['right','up','left','up','left','down','left','down']),8),
            (panel([700,300,150,200,400,200,150,300],[698,298,150,200,398,200,150,298],['NT','B','S','RE','RE','RE','S','B'],['right','up','left','up','left','down','left','down']),8)]
        for spec,count in cases:
            with self.subTest(spec=spec):
                r=generate(spec);self.assertEqual(r['validation']['holes'],count)
                doc=ezdxf.read(io.StringIO(r['dxf']));m=doc.modelspace()
                self.assertEqual(len(m.query('LWPOLYLINE[layer=="CUT"]')),1)
                self.assertTrue(m.query('LWPOLYLINE[layer=="CUT"]')[0].closed)
                self.assertFalse(m.query('TEXT'));self.assertTrue(m.query('MTEXT[layer=="LABELS"]'))
                self.assertTrue(all(e.dxf.layer in ['CUT','ROUTE','CAP ROUTE','LABELS','DIMENSIONS','HOLES'] for e in m))
                self.assertIn('<svg',r['svg'])
                for cap in m.query('LWPOLYLINE[layer=="CAP ROUTE"]'):self.assertAlmostEqual(cap.get_points()[0][1],-.4)
    def test_review_closure_and_unknowns_block(self):
        spec=panel([700,300,700,300],[698,298,698,298],['NT']*4)
        for alteration in [{'reviewed':False},{'unsupported':True},{'panelId':''}]:
            with self.assertRaises(CadError):generate({**spec,**alteration})
        spec['edges'][0]['finished']=697
        with self.assertRaisesRegex(CadError,'do not close'):generate(spec)
        spec['edges'][0]['finished']=None
        with self.assertRaises(CadError):generate(spec)
    def test_no_holes_on_nt_re_even_for_stiffener(self):
        result=generate(panel([1500,850,1500,850],[1498,848,1498,848],['NT','RE','RE','NT']))
        self.assertEqual(result['validation']['holes'],0)
        self.assertIsNotNone(result['validation']['stiffener'])
    def test_missing_ai_configuration(self):
        with patch.dict('os.environ',{},clear=True):
            with self.assertRaisesRegex(RuntimeError,'not configured'):analyse({})
    def test_ai_upload_contract_is_bounded_and_requires_review(self):
        spec={'panelId':'TEST-1','edges':[{}]*4,'questions':['Check the unclear dimension'],'unsupported':False,'folds':[]}
        response={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(spec)}]}]}
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return json.dumps(response).encode()
        def send(request,timeout):
            body=json.loads(request.data)
            self.assertFalse(body['store']);self.assertTrue(body['text']['format']['strict']);self.assertNotIn('tools',body)
            self.assertEqual(body['input'][0]['content'][1]['type'],'input_image');return Reply()
        with patch.dict('os.environ',{'OPENAI_API_KEY':'synthetic','CAD_AI_MODEL':'configured-model'}),patch('urllib.request.urlopen',side_effect=send),patch('cad_ai.sketch_image',return_value={'type':'input_image','image_url':'data:image/png;base64,test','detail':'high'}):
            result=analyse({'mime':'application/pdf','data':base64.b64encode(b'%PDF-test').decode()})
            self.assertFalse(result['spec']['reviewed'])
            with self.assertRaises(CadError):analyse({'mime':'application/pdf','data':base64.b64encode(b'not a PDF').decode()})
            response['status']='incomplete'
            with self.assertRaises(CadError):analyse({'mime':'application/pdf','data':base64.b64encode(b'%PDF-test').decode()})

if __name__=='__main__':unittest.main()

