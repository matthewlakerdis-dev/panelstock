import io,unittest
import ezdxf
from panel_cad import finish_extracted_spec,generate
class TagLabels(unittest.TestCase):
 def test_each_fold_section_has_its_own_code(self):
  spec={'panelId':'C501a','siteFolds':[300,570],'edges':[dict(direction=d,code=c,site=s) for d,c,s in zip(['right','up','left','down'],['NT','RE','B','S'],[1280,835,1280,835])]}
  spec=finish_extracted_spec(spec);spec['reviewed']=True
  m=ezdxf.read(io.StringIO(generate(spec)['dxf'])).modelspace()
  for code in ['S','RE']:
   labels=[e for e in m.query('MTEXT') if e.text==code]
   self.assertEqual(len(labels),3)
   self.assertEqual(len(set(round(e.dxf.insert.y,3) for e in labels)),3)
  for code in ['B','NT']:
   self.assertEqual(len([e for e in m.query('MTEXT') if e.text==code]),1)
