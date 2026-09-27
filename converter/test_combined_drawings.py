import unittest,io
import ezdxf
from ezdxf import bbox
from panel_cad import generate,combine_drawings,CadError,finish_extracted_spec
class CombinedDrawings(unittest.TestCase):
 def test_combined_preserves_dimensions_layers_and_separates_panels(self):
  sources=[]
  for w,h in [(700,1100),(1400,1200),(600,950)]:
   p=finish_extracted_spec({'panelId':str(w),'edges':[dict(direction=d,site=v,code='B') for d,v in zip(['right','up','left','down'],[w,h,w,h])],'siteFolds':[]});p['reviewed']=True;sources.append(generate(p)['dxf'])
  merged=generate({'drawings':sources});doc=ezdxf.read(io.StringIO(merged['dxf']));m=doc.modelspace()
  self.assertEqual(merged['panelCount'],3);self.assertEqual(doc.units,4)
  originals=[ezdxf.read(io.StringIO(s)).modelspace() for s in sources]
  for layer in ['CUT','ROUTE','HOLES','LABELS','DIMENSIONS']:
   self.assertEqual(len([e for e in m if e.dxf.layer==layer]),sum(len([e for e in source if e.dxf.layer==layer]) for source in originals))
  expected=sorted(round(float(d.get_measurement()),5) for source in originals for d in source.query('DIMENSION') if d.dimtype in (0,1))
  actual=sorted(round(float(d.get_measurement()),5) for d in m.query('DIMENSION') if d.dimtype in (0,1));self.assertEqual(actual,expected)
  cuts=list(m.query('LWPOLYLINE[layer=="CUT"]'))
  from shapely.geometry import Polygon
  shapes=[Polygon(e.get_points('xy')) for e in cuts]
  self.assertTrue(all(a.distance(b)>=250 for i,a in enumerate(shapes) for b in shapes[i+1:]))
  self.assertFalse(doc.audit().errors)
 def test_invalid_and_empty_inputs_fail(self):
  for value in [[],['invalid'],['x']*31]:
   with self.assertRaises(CadError):combine_drawings(value)
 def test_gap_and_preview(self):
  doc=ezdxf.new('R2010');doc.units=4;doc.modelspace().add_lwpolyline([(0,0),(100,0),(100,100),(0,100)],close=True,dxfattribs={'layer':'CUT'})
  stream=io.StringIO();doc.write(stream)
  result=generate({'drawings':[stream.getvalue()]*2,'gap':75,'preview':True})
  self.assertIn('<svg',result['svg'])
  merged=ezdxf.read(io.StringIO(result['dxf']));cuts=list(merged.modelspace().query('LWPOLYLINE'))
  self.assertAlmostEqual(bbox.extents([cuts[1]]).extmin.x-bbox.extents([cuts[0]]).extmax.x,75)
  for gap in [0,19,2001,float('nan'),True]:
   with self.assertRaises(CadError):combine_drawings([stream.getvalue()],gap)

