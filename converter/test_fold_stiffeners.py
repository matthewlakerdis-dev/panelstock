import unittest
from panel_cad import finish_extracted_spec,generate

class FoldStiffeners(unittest.TestCase):
 def test_threshold_applies_to_each_flat_section(self):
  for width,height,folds,expected in [(1280,835,[300,570],False),(1500,850,[],False),(1500,1000,[],True),(700,500,[],False),(700,1500,[300],False)]:
   p={'panelId':'TEST-FOLD','edges':[{'direction':d,'code':'B','site':height if i%2 else width} for i,d in enumerate(['right','up','left','down'])],'siteFolds':folds,'unsupported':False}
   p=finish_extracted_spec(p);p['reviewed']=True;r=generate(p)['validation']
   assert bool(r['stiffener'])==expected,(width,height,r)
   if folds:assert r['fixingHoles']==0
