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

 def test_c501c_tagged_convex_routes_reach_cut_edges(self):
  import json
  from pathlib import Path
  spec=json.loads((Path(__file__).parent/'fixtures/c501c-tag-corners.json').read_text());spec['reviewed']=True
  result=generate_measured(spec);doc=ezdxf.read(io.StringIO(result['dxf']))
  routes=unary_union([LineString(list(e.get_points('xy'))) for e in doc.modelspace().query('LWPOLYLINE[layer=="ROUTE"]')])
  segments=result['geometry']['finishedOuterSegments']
  tags={'B','S','NT','RE'};checked=0
  face=Polygon(result['geometry']['finishedFace'])
  from shapely.geometry import Point
  import math
  for first in segments:
   if first['code'] not in tags:continue
   a,b=first['start'],first['end'];length=math.dist(a,b);u=((b[0]-a[0])/length,(b[1]-a[1])/length)
   for corner,sign in [(a,-1),(b,1)]:
    tip=(corner[0]+sign*u[0]*20,corner[1]+sign*u[1]*20)
    probe=Point(corner[0]+sign*u[0]*.01,corner[1]+sign*u[1]*.01)
    others=[other for other in segments if other is not first and min(math.dist(corner,other['start']),math.dist(corner,other['end']))<.001]
    if face.contains(probe):continue
    if any(other['code'] in tags and abs(u[0]*(other['end'][1]-other['start'][1])-u[1]*(other['end'][0]-other['start'][0]))>.001 for other in others):
     self.assertTrue(routes.buffer(1e-6).covers(LineString([corner,tip])));checked+=1
    elif any(other['code']=='FE' for other in others):
     self.assertFalse(routes.buffer(1e-6).covers(LineString([corner,tip])))
  self.assertGreaterEqual(checked,8)
