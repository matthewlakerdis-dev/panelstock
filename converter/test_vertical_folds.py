import io,unittest
import ezdxf
from panel_cad import generate,finish_extracted_spec,CadError
class VerticalFolds(unittest.TestCase):
 def panel(self):
  return {'panelId':'V1','panelDirection':'right','siteFolds':[],'foldLines':[{'start':{'x':300,'y':0},'end':{'x':300,'y':800}}],'edges':[dict(direction=d,code='B',site=s) for d,s in zip(['right','up','left','down'],[1200,800,1200,800])]}
 def test_vertical_deduction_and_dxf(self):
  p=finish_extracted_spec(self.panel());self.assertEqual([e['finished'] for e in p['edges']],[1196,798,1196,798]);self.assertEqual(p['verticalFolds'],[298])
  p['reviewed']=True;r=generate(p);self.assertIsNone(r['validation']['stiffener'])
  doc=ezdxf.read(io.StringIO(r['dxf']));self.assertFalse(doc.audit().errors)
  routes=[list(e.get_points('xy')) for e in doc.modelspace().query('LWPOLYLINE[layer=="ROUTE"]')]
  self.assertTrue(any(all(abs(q[0]-298)<.001 for q in route) for route in routes))
 def test_partial_endpoints_rejected(self):
  p=self.panel();p['foldLines'][0]['end']['y']=600
  with self.assertRaises(CadError):finish_extracted_spec(p)
