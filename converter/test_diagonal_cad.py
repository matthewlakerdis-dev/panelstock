import copy,io,sys,pathlib,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'partial-folds'))
import ezdxf
from shapely.geometry import Polygon,LineString,Point
from test_outline_geometry import panel
from diagonal_cad import generate_measured
from outline_geometry import GeometryError

class MeasuredExport(unittest.TestCase):
 def test_public_generator_dispatches_measured_draft(self):
  from panel_cad import generate
  draft=panel();draft['reviewed']=True
  self.assertTrue(generate(draft)['validation']['closedCut'])
 def test_fold_order_and_endpoint_order_preserve_geometry(self):
  draft=panel();draft['reviewed']=True;expected=generate_measured(draft)
  draft['measuredFolds'].reverse()
  for key in ['rightAngles','reliefEnds']:
   for c in draft[key]:c['fold']=3-c['fold'];c['end']=1-c['end']
  for f in draft['measuredFolds']:f['start'],f['end']=f['end'],f['start']
  actual=generate_measured(draft)
  self.assertEqual(expected['geometry']['finishedFace'],actual['geometry']['finishedFace'])
  self.assertEqual(expected['validation']['holes'],actual['validation']['holes'])
 def test_shoulder_relief_closed_cut_and_contained_machining(self):
  draft=panel();draft['reviewed']=True;draft['panelDirection']='up';before=copy.deepcopy(draft)
  r=generate_measured(draft);self.assertEqual(draft,before)
  doc=ezdxf.read(io.StringIO(r['dxf']));self.assertFalse(doc.audit().errors)
  cuts=list(doc.modelspace().query('LWPOLYLINE[layer=="CUT"]'))
  self.assertEqual(len(cuts),1);self.assertTrue(cuts[0].closed)
  cut=Polygon(list(cuts[0].get_points('xy')));self.assertTrue(cut.is_valid);self.assertFalse(cut.interiors)
  face=Polygon(r['geometry']['finishedFace']);self.assertTrue(cut.buffer(1e-7).covers(face))
  for e in doc.modelspace().query('LWPOLYLINE[layer=="ROUTE"]'):
   self.assertTrue(cut.buffer(1e-7).covers(LineString(list(e.get_points('xy')))))
  for e in doc.modelspace().query('CIRCLE[layer=="HOLES"]'):
   self.assertTrue(cut.contains(Point(e.dxf.center.x,e.dxf.center.y).buffer(e.dxf.radius)))
  self.assertEqual(len(r['validation']['stiffeners']),1)
 def test_unselected_concave_relief_is_not_silently_cut_into_face(self):
  draft=panel();draft['reviewed']=True;draft['reliefEnds']=[]
  r=generate_measured(draft);doc=ezdxf.read(io.StringIO(r['dxf']));cut=Polygon(list(list(doc.modelspace().query('LWPOLYLINE[layer=='+chr(34)+'CUT'+chr(34)+']'))[0].get_points('xy')));self.assertTrue(cut.buffer(1e-7).covers(Polygon(r['geometry']['finishedFace'])))
 def test_review_is_required(self):
  with self.assertRaisesRegex(GeometryError,'Review'):generate_measured(panel())
 def test_vertical_folds_preserve_cut_routes_and_face_after_rotation(self):
  draft=panel();draft['reviewed']=True
  for e in draft['measuredEdges']:e['dx'],e['dy']=e['dy'],-e['dx']
  for f in draft['measuredFolds']:
   for end in ['start','end']:
    p=f[end];p['x'],p['y']=p['y'],-p['x']
  before=copy.deepcopy(draft);r=generate_measured(draft);self.assertEqual(draft,before)
  doc=ezdxf.read(io.StringIO(r['dxf']));self.assertFalse(doc.audit().errors)
  cut=Polygon(list(list(doc.modelspace().query('LWPOLYLINE[layer=="CUT"]'))[0].get_points('xy')))
  self.assertTrue(cut.is_valid);self.assertTrue(cut.buffer(1e-7).covers(Polygon(r['geometry']['finishedFace'])))
  for e in doc.modelspace().query('LWPOLYLINE[layer=="ROUTE"]'):
   self.assertTrue(cut.buffer(1e-7).covers(LineString(list(e.get_points('xy')))))
  for e in doc.modelspace().query('CIRCLE[layer=="HOLES"]'):
   self.assertTrue(cut.contains(Point(e.dxf.center.x,e.dxf.center.y).buffer(e.dxf.radius)))
 def test_shoulder_relief_has_no_square_ledge_between_diagonals(self):
  import math
  draft=panel();draft['reviewed']=True
  result=generate_measured(draft)
  model=ezdxf.read(io.StringIO(result['dxf'])).modelspace()
  coords=list(list(model.query('LWPOLYLINE[layer=="CUT"]'))[0].get_points('xy'))
  diagonal=lambda a,b:abs(a[0]-b[0])>1e-6 and abs(a[1]-b[1])>1e-6
  for i,b in enumerate(coords):
   a=coords[i-1];c=coords[(i+1)%len(coords)];d=coords[(i+2)%len(coords)]
   ledge=1<math.dist(b,c)<20 and abs(b[1]-c[1])<1e-6
   self.assertFalse(ledge and diagonal(a,b) and diagonal(c,d),'Square ledge remains at relief junction')
 def test_short_remaining_tag_span_does_not_get_crowded_end_holes(self):
  import math
  draft=panel();draft['reviewed']=True
  model=ezdxf.read(io.StringIO(generate_measured(draft)['dxf'])).modelspace()
  holes=[(e.dxf.center.x,e.dxf.center.y) for e in model.query('CIRCLE[layer=="HOLES"]')]
  self.assertTrue(holes)
  for i,a in enumerate(holes):
   for b in holes[i+1:]:
    if abs(a[1]-b[1])<1e-7:self.assertGreaterEqual(math.dist(a,b),40-1e-7)
 def test_concave_shoulder_keeps_material_and_routes_to_outer_corner(self):
  draft=panel();draft['reviewed']=True
  result=generate_measured(draft);model=ezdxf.read(io.StringIO(result['dxf'])).modelspace()
  cut=Polygon(list(list(model.query('LWPOLYLINE[layer=="CUT"]'))[0].get_points('xy')))
  routes=[LineString(list(e.get_points('xy'))) for e in model.query('LWPOLYLINE[layer=="ROUTE"]')]
  face=Polygon(result['geometry']['finishedFace'])
  diagonal=[]
  for route in routes:
   a,b=route.coords[0],route.coords[-1]
   if abs(a[0]-b[0])>1 and abs(a[1]-b[1])>1 and route.length<60 and route.intersection(face).length<1e-6:
    if any(Point(end).distance(cut.boundary)<1e-6 for end in [a,b]):diagonal.append(route)
  self.assertTrue(diagonal,'Expected diagonal route from shoulder to joined outer cut')
  self.assertTrue(cut.buffer(1e-7).covers(face))
 def test_joined_shoulder_route_does_not_extend_behind_corner(self):
  draft=panel();draft['reviewed']=True
  result=generate_measured(draft)
  model=ezdxf.read(io.StringIO(result['dxf'])).modelspace()
  shoulder=max(result['geometry']['finishedFoldLines'][2],key=lambda p:p[0])
  # The perimeter route starts at the shoulder; the internal fold remains
  # on its own finished fold line and must not create a 20 mm overrun here.
  segments=result['geometry']['finishedOuterSegments']
  horizontal=[s for s in segments if abs(s['start'][1]-s['end'][1])<1e-7 and 40<LineString([s['start'],s['end']]).length<100]
  self.assertTrue(horizontal)
  s=min(horizontal,key=lambda s:LineString([s['start'],s['end']]).length)
  corner=min([s['start'],s['end']],key=lambda p:p[0])
  other=s['end'] if corner==s['start'] else s['start'];direction=1 if other[0]>corner[0] else -1
  probe=LineString([(corner[0]-direction*.01,corner[1]),(corner[0]-direction*19,corner[1])])
  # A restored internal fold legitimately occupies part of this probe.
  # Check only the gap beyond its shoulder endpoint for a perimeter overrun.
  from shapely.ops import unary_union
  fold_paths=unary_union([LineString(f) for f in result['geometry']['finishedFoldLines']])
  probe=probe.difference(fold_paths.buffer(1e-6))
  for e in model.query('LWPOLYLINE[layer=="ROUTE"]'):
   self.assertLess(LineString(list(e.get_points('xy'))).intersection(probe).length,1e-6)

