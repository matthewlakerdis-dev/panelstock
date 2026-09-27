import unittest,copy,io
import ezdxf
from panel_cad import generate,finish_extracted_spec
class FactoryTags(unittest.TestCase):
 def test_fe_holes_preserve_cut_and_dimensions(self):
  for measured in [False,True]:
   if measured:
    draft={'panelId':'FE','reviewed':True,'measuredEdges':[dict(dx=x,dy=y,code='FE') for x,y in [(600,0),(0,400),(-600,0),(0,-400)]],'measuredFolds':[]}
    key='measuredEdges'
   else:
    draft=finish_extracted_spec({'panelId':'FE','edges':[dict(direction=d,site=v,code='FE') for d,v in zip(['right','up','left','down'],[600,400,600,400])],'siteFolds':[]});draft['reviewed']=True;key='edges'
   plain=generate(draft);draft[key][0]['withTag']=True;tagged=generate(draft)
   self.assertEqual(plain['validation']['holes'],0)
   self.assertGreaterEqual(tagged['validation']['holes'],2)
   self.assertEqual(tagged['validation']['fabricationTags'][0]['type'],'FE')
   def cuts(result):
    doc=ezdxf.read(io.StringIO(result['dxf']));return [list(e.get_points()) for e in doc.modelspace().query('LWPOLYLINE') if e.dxf.layer=='CUT']
   self.assertEqual(cuts(plain),cuts(tagged))
