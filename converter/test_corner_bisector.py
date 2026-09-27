import math,unittest
from shapely.geometry import Polygon,Point
from diagonal_cad import bisected_corner_route
class CornerBisector(unittest.TestCase):
 def test_right_angle_moves_endpoint_to_cut_edge(self):
  cut=Polygon([(0,0),(40,0),(40,30)])
  face=Polygon([(40,0),(60,0),(60,-20),(40,-20)])
  route=bisected_corner_route((40,0),(0,-1),(-1,0),cut,face)
  a,b=list(route.coords)
  self.assertAlmostEqual(abs(a[0]-b[0]),abs(a[1]-b[1]))
  self.assertLess(Point(b).distance(cut.boundary),1e-7)
  self.assertGreater(math.dist(b,(22,16.5)),1)
 def test_non_right_angles_and_rotations(self):
  for turn in [-60,-90,-120]:
   for rotation in [0,35,180]:
    a=math.radians(rotation);b=a+math.radians(turn)
    u=(math.cos(a),math.sin(a));v=(math.cos(b),math.sin(b))
    cut=Polygon([(-50,-50),(50,-50),(50,50),(-50,50)])
    face=Polygon([(100,100),(110,100),(110,110),(100,110)])
    route=bisected_corner_route((0,0),u,v,cut,face)
    end=list(route.coords)[-1];length=math.hypot(*end);direction=tuple(x/length for x in end)
    # The route makes equal angles with both bounding rays.
    self.assertAlmostEqual(sum(direction[i]*u[i] for i in range(2)),sum(direction[i]*-v[i] for i in range(2)))
    self.assertLess(Point(end).distance(cut.boundary),1e-7)
