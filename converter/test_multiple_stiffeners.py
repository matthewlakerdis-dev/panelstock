import unittest
from shapely.geometry import box,LineString
from panel_cad import section_stiffeners,generate,finish_extracted_spec

class MultipleStiffeners(unittest.TestCase):
 def test_even_spacing_in_both_orientations_and_at_boundary(self):
  for width,height,count in [(1800,1200,1),(1801,1200,2),(2800,1200,3),(1200,2800,3)]:
   region=box(0,0,width,height);plans=section_stiffeners([region],[region],[])
   self.assertEqual(len(plans),count)
   positions=[0]+[p['placement'] for p in plans]+[max(width,height)]
   gaps=[b-a for a,b in zip(positions,positions[1:])]
   self.assertLessEqual(max(gaps),900)
   self.assertAlmostEqual(min(gaps),max(gaps))
 def test_every_stiffener_keeps_end_clearance(self):
  region=box(0,0,2800,1200)
  edges=[LineString([(0,0),(2800,0)]),LineString([(0,1200),(2800,1200)])]
  for plan in section_stiffeners([region],[region],[],edges):
   span=LineString([plan['start'],plan['end']])
   self.assertAlmostEqual(span.length,1100)
   self.assertTrue(all(span.distance(edge)>=50 for edge in edges))
 def test_full_generation_includes_all_stiffeners_and_labels(self):
  spec=finish_extracted_spec({'panelId':'MULTI','siteFolds':[],'edges':[dict(direction=d,code='B',site=v) for d,v in zip(['right','up','left','down'],[2800,1200,2800,1200])]})
  spec['reviewed']=True;result=generate(spec)
  self.assertEqual(len(result['validation']['stiffeners']),3)
  self.assertEqual(result['validation']['fixingHoles'],12)

