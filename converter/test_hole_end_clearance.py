import unittest
from shapely.geometry import Polygon,LineString,Point
from panel_cad import hole_end_spans
class EndClearance(unittest.TestCase):
 def test_diagonal_and_square_ends(self):
  for cut,routes in [(Polygon([(0,0),(20,20),(20,200),(0,200)]),[]),(Polygon([(0,0),(20,0),(20,200),(0,200)]),[[(0,15),(20,35)]])]:
   spans=hole_end_spans(LineString([(12,0),(12,200)]),cut,routes,(0,1))
   self.assertTrue(spans)
   ends=[LineString([a,b]) for a,b in zip(cut.exterior.coords,list(cut.exterior.coords)[1:]) if abs(a[0]-b[0])>1e-8]+[LineString(r) for r in routes]
   for span in spans:
    for j in range(21):
     p=span.interpolate(span.length*j/20)
     self.assertAlmostEqual(p.x,12)
     self.assertTrue(all(p.distance(e)-1.5>=20-1e-7 for e in ends))
 def test_short_tag_has_no_safe_holes(self):
  self.assertEqual(hole_end_spans(LineString([(12,0),(12,30)]),Polygon([(0,0),(20,0),(20,30),(0,30)]),[],(0,1)),[])
if __name__=='__main__':unittest.main()

