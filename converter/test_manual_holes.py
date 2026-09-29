import unittest,io,copy
import ezdxf
from shapely.geometry import box,LineString
from manual_holes import manual_holes
from panel_cad import generate,finish_extracted_spec,CadError
class ManualHoles(unittest.TestCase):
 def test_clearance_and_validation(self):
  face=cut=box(0,0,100,100)
  for hole in [{'x':1,'y':50,'diameter':4},{'x':50,'y':50,'diameter':0},{'x':float('nan'),'y':50,'diameter':3},{'x':True,'y':50,'diameter':3},{'x':50,'y':50,'diameter':6}]:
   with self.assertRaises(CadError):manual_holes({'manualHoles':[hole]},face,cut,[LineString([(50,0),(50,100)])],[])
  with self.assertRaises(CadError):manual_holes({'manualHoles':[{'x':30,'y':30,'diameter':10},{'x':35,'y':30,'diameter':3}]},face,cut,[],[])
  with self.assertRaises(CadError):manual_holes({'manualHoles':[{'x':30,'y':30,'diameter':10}]},face,cut,[],[(30,30)])
 def test_generated_measured_and_cardinal_holes(self):
  measured={'panelId':'HOLES','reviewed':True,'measuredEdges':[{'dx':300,'dy':0,'code':'FE'},{'dx':0,'dy':200,'code':'FE'},{'dx':-300,'dy':0,'code':'FE'},{'dx':0,'dy':-200,'code':'FE'}],'measuredFolds':[],'rightAngles':[],'reliefEnds':[]}
  cardinal=finish_extracted_spec({'panelId':'HOLES','edges':[{'direction':d,'site':n,'code':'FE'} for d,n in [('right',300),('up',200),('left',300),('down',200)]],'folds':[],'reviewed':True})
  cardinal['reviewed']=True
  for spec in [measured,cardinal]:
   before=generate(spec);spec['manualHoles']=[{'x':50,'y':60,'diameter':8}];snapshot=copy.deepcopy(spec)
   result=generate(spec);self.assertEqual(spec,snapshot)
   doc=ezdxf.read(io.StringIO(result['dxf']));hole=list(doc.modelspace().query('CIRCLE[layer=="HOLES"]'))[0]
   ox,oy=result['manualHoleLayout']['origin'];self.assertAlmostEqual(hole.dxf.center.x,ox+50);self.assertAlmostEqual(hole.dxf.center.y,oy+60);self.assertEqual(hole.dxf.radius,4)
   self.assertEqual(result['manualHoleLayout']['cut'],before['manualHoleLayout']['cut']);self.assertEqual(result['validation']['manualHoles'],1)
 def test_vertical_fold_offsets(self):
  spec=finish_extracted_spec({'panelId':'VERTICAL','edges':[{'direction':d,'site':n,'code':'B'} for d,n in [('right',400),('up',300),('left',400),('down',300)]],'foldLines':[{'start':{'x':200,'y':0},'end':{'x':200,'y':300}}],'reviewed':True})
  spec['reviewed']=True;spec['manualHoles']=[{'x':60,'y':70,'diameter':8}]
  r=generate(spec);doc=ezdxf.read(io.StringIO(r['dxf']));h=next(e for e in doc.modelspace().query('CIRCLE[layer=="HOLES"]') if e.dxf.radius==4);ox,oy=r['manualHoleLayout']['origin']
  self.assertAlmostEqual(h.dxf.center.x,ox+60);self.assertAlmostEqual(h.dxf.center.y,oy+70)
