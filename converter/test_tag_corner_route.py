import io,unittest
import ezdxf
from shapely.geometry import LineString,Polygon
from shapely.ops import unary_union
from diagonal_cad import generate_measured
class TagCornerRoute(unittest.TestCase):
 def test_overlapping_returns_have_corner_to_corner_route(self):
  points=[(0,0),(400,0),(400,200),(200,200),(200,400),(0,400)]
  spec={'panelId':'L-CORNER','reviewed':True,'measuredEdges':[{'dx':points[(i+1)%6][0]-p[0],'dy':points[(i+1)%6][1]-p[1],'code':'B'} for i,p in enumerate(points)],'measuredFolds':[],'rightAngles':[],'reliefEnds':[]}
  result=generate_measured(spec);doc=ezdxf.read(io.StringIO(result['dxf']))
  face=Polygon(result['geometry']['finishedFace']);ring=list(face.exterior.coords)[:-1]
  # Find the re-entrant corner independently of polygon winding.
  corners=[]
  for i,p in enumerate(ring):
   a=ring[i-1];b=ring[(i+1)%len(ring)];cross=(p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0])
   if cross*(1 if face.exterior.is_ccw else -1)<0:corners.append(p)
  self.assertEqual(len(corners),1);corner=corners[0]
  expected=LineString([corner,(corner[0]+20,corner[1]+20)])
  routes=unary_union([LineString(list(e.get_points('xy'))) for e in doc.modelspace().query('LWPOLYLINE[layer=="ROUTE"]')])
  self.assertTrue(routes.buffer(1e-6).covers(expected))
  self.assertLess(expected.intersection(face).length,1e-7)
