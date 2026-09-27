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
