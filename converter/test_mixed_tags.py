import io,unittest
import ezdxf
from panel_cad import generate,finish_extracted_spec
class MixedTags(unittest.TestCase):
 def test_mixed_side_labels_and_holes(self):
  p={'panelId':'mixed','siteFolds':[300,570],'edges':[dict(direction=d,code=c,site=s) for d,c,s in zip(['right','up','left','down'],['B','RE','B','S'],[800,835,800,835])]}
  p['edges'][1]['sections']=[{'code':'RE','site':300},{'code':'B','site':270},{'code':'NT','site':265}]
  p=finish_extracted_spec(p);p['reviewed']=True
  m=ezdxf.read(io.StringIO(generate(p)['dxf'])).modelspace()
  labels=[e for e in m.query('MTEXT') if e.text in ['RE','NT']]
  self.assertEqual(sorted(e.text for e in labels),['NT','RE'])
  right=[e.dxf.center.y for e in m.query('CIRCLE') if e.dxf.center.x>798]
  self.assertTrue(right)
  self.assertTrue(all(298<y<566 for y in right))
