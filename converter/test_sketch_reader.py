import sys,types,unittest,base64,copy
from unittest.mock import patch
sys.modules.setdefault('pypdfium2',types.ModuleType('pypdfium2'))
import cad_ai

class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.edges=[{'start':{'x':x,'y':y},'kind':k} for x,y,k in [(0,900,'horizontal'),(800,900,'vertical'),(800,500,'sloping'),(600,200,'horizontal'),(0,200,'vertical')]]
        self.body={'mime':'image/png','data':base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode(),'outline':{'components':True,'edges':self.edges}}
        self.result={'edges':[dict(e,code='B',site=None,width=None,height=None) for e in self.edges],'questions':[],'unsupported':False}
    def run_read(self,result):
        with patch.dict('os.environ',{'OPENAI_API_KEY':'test-only','CAD_AI_MODEL':'test-only'}),patch.object(cad_ai,'sketch_image',return_value={}),patch.object(cad_ai,'request_sketch',return_value=result) as request:
            out=cad_ai.analyse(self.body)
            return out,request.call_args
    def test_diagonal_read_preserves_missing_dimensions_and_anchors(self):
        out,args=self.run_read(copy.deepcopy(self.result))
        self.assertEqual(out['spec']['edges'][2]['width'],None)
        self.assertFalse(out['spec']['reviewed'])
        self.assertIn('width',args.kwargs['schema']['properties']['edges']['items']['required'])
        self.assertIn('Never use pixel distances',args.args[4])
    def test_changed_anchor_rejected(self):
        changed=copy.deepcopy(self.result);changed['edges'][2]['start']['x']=799
        with self.assertRaisesRegex(cad_ai.CadError,'changed the traced corners'):self.run_read(changed)
    def test_old_cardinal_mode_still_rejects_diagonal(self):
        with self.assertRaises(cad_ai.CadError):cad_ai.directions_from_corners({'edges':self.edges})



    def test_reader_requests_marked_corners_and_actual_section_shapes(self):
        result=copy.deepcopy(self.result)
        result['edgeRightAngles']=[0,1]
        out,args=self.run_read(result)
        schema=args.kwargs['schema']
        self.assertIn('edgeRightAngles',schema['required'])
        self.assertIn('kind',schema['properties']['edges']['items']['required'])
        self.assertEqual(out['spec']['edgeRightAngles'],[0,1])
        self.assertIn('left height 70 and right height 40',args.args[4])

class MarkedTaperTests(unittest.TestCase):
    def fixture(self,left=70,right=40,marks=None):
        return {'edges':[dict(direction=d,site=v,start={'x':x,'y':y},code='B') for d,v,x,y in zip(['right','up','left','down'],[1409,right,1409,left],[0,900,900,0],[900,900,100,100])],'edgeRightAngles':marks if marks is not None else [0,1],'folds':[]}
    def test_square_base_selects_top_slope_in_both_directions(self):
        for left,right in [(70,40),(40,70)]:
            result=cad_ai.marked_taper(self.fixture(left,right))
            self.assertEqual(result['measuredEdges'][2]['dy'],left-right)
            self.assertEqual(result['outlineSections'][2]['height'],30)
            self.assertEqual(sum(e['dy'] for e in result['measuredEdges']),0)
            self.assertEqual(result['edgeRightAngles'],[0,1])
    def test_square_top_selects_bottom_slope(self):
        result=cad_ai.marked_taper(self.fixture(marks=[2,3]))
        self.assertEqual(result['measuredEdges'][0]['dy'],30)
        self.assertEqual(result['measuredEdges'][2]['dy'],0)
    def test_ambiguous_or_conflicting_marks_do_not_guess_a_slope(self):
        for marks in [[],[0],[0,1,2,3]]:
            self.assertIsNone(cad_ai.marked_taper(self.fixture(marks=marks)))

if __name__=='__main__':unittest.main()
