import unittest
from panel_cad import generate,finish_extracted_spec
class StiffenerThreshold(unittest.TestCase):
 def panel(self,w,h):
  p={'panelId':'threshold','siteFolds':[],'edges':[dict(direction=d,code='B',site=s) for d,s in zip(['right','up','left','down'],[w,h,w,h])]}
  p=finish_extracted_spec(p);p['reviewed']=True
  return generate(p)['validation']
 def test_narrow_and_boundary_panels_are_exempt(self):
  for w,h in [(449,2825),(2825,449),(900,1200),(1200,900),(900,900)]:
   with self.subTest(w=w,h=h):self.assertIsNone(self.panel(w,h)['stiffener'])
 def test_both_dimensions_above_threshold(self):
  self.assertIsNotNone(self.panel(901,1200)['stiffener'])
 def test_reported_stepped_panel_generates_without_stiffener(self):
  p={'panelId':'Z2-6a','siteFolds':[],'edges':[dict(direction=d,code=c,site=s) for d,c,s in zip(['right','up','left','up','left','down'],['B','RE','RE','B','B','S'],[449,1090,69,1735,380,2825])]}
  p=finish_extracted_spec(p);p['reviewed']=True
  self.assertIsNone(generate(p)['validation']['stiffener'])
