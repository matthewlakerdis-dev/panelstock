import unittest
from shapely.geometry import box,LineString
from panel_cad import final_drawing_checks,CadError

class FinalChecks(unittest.TestCase):
 def test_missing_fold_route_is_blocked(self):
  with self.assertRaisesRegex(CadError,'missing route'):
   final_drawing_checks(box(0,0,200,200),[[(0,100),(80,100)]],[],[],[LineString([(0,100),(200,100)])])
 def test_hole_crossing_cut_is_blocked(self):
  with self.assertRaisesRegex(CadError,'hole 1'):
   final_drawing_checks(box(0,0,200,200),[],[(0,20)],[])
 def test_stiffener_clearance_is_blocked(self):
  with self.assertRaisesRegex(CadError,'50 mm'):
   final_drawing_checks(box(0,0,200,200),[],[],[{'start':(40,50),'end':(150,50)}],[],[LineString([(0,0),(0,200)])])
 def test_complete_valid_geometry_passes(self):
  fold=LineString([(0,100),(200,100)])
  self.assertEqual(len(final_drawing_checks(box(0,0,200,200),[fold],[(20,20)],[{'start':(50,50),'end':(150,50)}],[fold])),4)

