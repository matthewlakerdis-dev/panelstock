import copy,io,unittest
import ezdxf
from sheet_planner import plan_sheets

def panel(w=100,h=50,direction='right',quantity=1):
 doc=ezdxf.new('R2010');doc.units=4;doc.layers.new('CUT');doc.layers.new('ROUTE');doc.layers.new('LABELS')
 doc.modelspace().add_lwpolyline([(0,0),(w,0),(w,h),(0,h)],close=True,dxfattribs={'layer':'CUT'})
 stream=io.StringIO();doc.write(stream)
 return {'name':'Test','dxf':stream.getvalue(),'direction':direction,'quantity':quantity}
def stock(w=210,h=50,qty=1,kind='variant',id='s1'):
 return {'id':id,'type':kind,'width':w,'height':h,'quantity':qty,'material':'ACP','color':'White','thickness':4}
class SheetPlanner(unittest.TestCase):
 def test_gap_quantities_and_edge_fit_without_mutating_input(self):
  request={'panels':[panel(quantity=2)],'stock':[stock()]};before=copy.deepcopy(request)
  r=plan_sheets(request);self.assertEqual(request,before);self.assertFalse(r['stockChanged']);self.assertEqual(len(r['sheets']),1);self.assertFalse(r['unplaced'])
  p=r['sheets'][0]['panels'];self.assertEqual([x['x'] for x in p],[0,110]);self.assertEqual(p[-1]['x']+p[-1]['width'],210)
 def test_stock_quantity_is_not_exceeded(self):
  r=plan_sheets({'panels':[panel(quantity=3)],'stock':[stock(100,50)]});self.assertEqual(len(r['sheets']),1);self.assertEqual(len(r['unplaced']),2)
 def test_offcuts_precede_full_sheets(self):
  r=plan_sheets({'panels':[panel()],'stock':[stock(),stock(100,50,kind='offcut',id='o1')]});self.assertEqual(r['sheets'][0]['stock']['type'],'offcut')
 def test_arrow_rotation_locks_orientation(self):
  for direction in ['up','down']:
   r=plan_sheets({'panels':[panel(direction=direction)],'stock':[stock(50,100)]});self.assertFalse(r['unplaced']);p=r['sheets'][0]['panels'][0];self.assertAlmostEqual(p['width'],50);self.assertAlmostEqual(p['height'],100);self.assertEqual(p['direction'],'right')
  r=plan_sheets({'panels':[panel()],'stock':[stock(50,100)]});self.assertEqual(len(r['unplaced']),1)
 def test_missing_arrow_and_mixed_material_rejected(self):
  with self.assertRaises(ValueError):plan_sheets({'panels':[panel(direction=None)],'stock':[stock()]})
  second=stock(id='s2');second['color']='Black'
  with self.assertRaises(ValueError):plan_sheets({'panels':[panel()],'stock':[stock(),second]})
 def test_export_cut_positions_and_no_overlap(self):
  r=plan_sheets({'panels':[panel(quantity=4)],'stock':[stock(210,110)]});self.assertEqual(len(r['sheets']),1)
  doc=ezdxf.read(io.StringIO(r['sheets'][0]['dxf']));self.assertEqual(len(doc.modelspace().query('LWPOLYLINE[layer=="CUT"]')),4);self.assertFalse(doc.audit().errors)

 def test_real_generated_drawing_through_public_dispatch(self):
  from panel_cad import generate,finish_extracted_spec
  for direction in ['right','up','left','down']:
   spec=finish_extracted_spec({'panelId':'REAL','panelDirection':direction,'edges':[dict(direction=d,site=v,code='B') for d,v in zip(['right','up','left','down'],[700,900,700,900])],'siteFolds':[]})
   spec['reviewed']=True;drawing=generate(spec)
   r=generate({'sheetPlan':True,'panels':[{'name':'REAL','quantity':1,'direction':direction,'dxf':drawing['dxf']}],'stock':[stock(1600,1600)]})
   self.assertFalse(r['unplaced']);self.assertEqual(len(r['sheets']),1)
   sheetdoc=ezdxf.read(io.StringIO(r['sheets'][0]['dxf']))
   original=ezdxf.read(io.StringIO(drawing['dxf']))
   for layer in ['CUT','ROUTE','HOLES','CAP ROUTE']:
    self.assertEqual(len([e for e in sheetdoc.modelspace() if e.dxf.layer==layer]),len([e for e in original.modelspace() if e.dxf.layer==layer]))

 def test_external_identity_moves_inside_without_changing_cut(self):
  from panel_cad import draw_panel_annotation
  from ezdxf import bbox
  request_panel=panel(250,200)
  doc=ezdxf.read(io.StringIO(request_panel['dxf']))
  doc.styles.new('Arial')
  draw_panel_annotation(doc.modelspace(),'SMALL','right',(125,-100))
  stream=io.StringIO();doc.write(stream);request_panel['dxf']=stream.getvalue()
  result=plan_sheets({'panels':[request_panel],'stock':[stock(250,200)]})
  output=ezdxf.read(io.StringIO(result['sheets'][0]['dxf']))
  labels=list(output.modelspace().query('*[layer=="LABELS"]'))
  self.assertEqual(len(labels),4)
  bounds=bbox.extents(labels)
  self.assertGreaterEqual(bounds.extmin.x,0)
  self.assertGreaterEqual(bounds.extmin.y,0)
  self.assertLessEqual(bounds.extmax.x,250)
  self.assertLessEqual(bounds.extmax.y,200)
  cut=list(output.modelspace().query('LWPOLYLINE[layer=="CUT"]'))[0]
  self.assertEqual(list(cut.get_points('xy')),[(0,0),(250,0),(250,200),(0,200)])

 def test_different_panels_share_one_sheet_with_locked_arrows(self):
  from shapely.geometry import Polygon,box
  entries=[panel(120,60),panel(50,80,direction='up'),panel(40,60,direction='left')]
  for name,entry in zip(['A','B','C'],entries):entry['name']=name
  result=plan_sheets({'panels':entries,'stock':[stock(220,130,qty=3)]})
  self.assertFalse(result['unplaced'])
  self.assertEqual(len(result['sheets']),1)
  sheet=result['sheets'][0]
  self.assertEqual({p['name'] for p in sheet['panels']},{'A','B','C'})
  self.assertTrue(all(p['direction']=='right' for p in sheet['panels']))
  doc=ezdxf.read(io.StringIO(sheet['dxf']))
  shapes=[Polygon(e.get_points('xy')) for e in doc.modelspace().query('LWPOLYLINE[layer=="CUT"]')]
  self.assertEqual(len(shapes),3)
  for i,shape in enumerate(shapes):
   self.assertTrue(box(0,0,220,130).buffer(1e-7).covers(shape))
   for other in shapes[i+1:]:self.assertGreaterEqual(shape.distance(other),10-1e-6)

 def test_wide_sheet_preview_has_no_fixed_portrait_padding(self):
  import xml.etree.ElementTree as ET
  result=plan_sheets({'panels':[panel()],'stock':[stock(4000,1575)]})
  root=ET.fromstring(result['sheets'][0]['svg'])
  width=float(root.attrib['width'].replace('mm',''))
  height=float(root.attrib['height'].replace('mm',''))
  self.assertGreater(width/height,2.4)
  self.assertLess(width/height,2.6)

 def test_all_sheets_dxf_preserves_panels_and_sheet_boundaries(self):
  result=plan_sheets({'panels':[panel(100,50,quantity=3)],'stock':[stock(100,50,qty=3)]})
  doc=ezdxf.read(io.StringIO(result['allSheetsDxf']))
  self.assertEqual(doc.units,4)
  self.assertFalse(doc.audit().errors)
  self.assertEqual(len(doc.modelspace().query('LWPOLYLINE[layer=="CUT"]')),3)
  borders=list(doc.modelspace().query('LWPOLYLINE[layer=="SHEET REFERENCE"]'))
  self.assertEqual(len(borders),3)
  from shapely.geometry import Polygon
  shapes=[Polygon(e.get_points('xy')) for e in borders]
  for i,shape in enumerate(shapes):
   for other in shapes[i+1:]:self.assertGreaterEqual(shape.distance(other),250-1e-6)
