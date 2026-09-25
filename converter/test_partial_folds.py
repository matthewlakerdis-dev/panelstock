import io,unittest
import ezdxf
from panel_cad import finish_extracted_spec,generate,CadError,vertices
from cad_ai import normalise_fold_sections,directions_from_corners

def c501c():
 directions=['right','up','left','down','left','down','left','up','left','up','left','down']
 codes=['S','RE','B','B','B','FE','FE','FE','B','B','B','S']
 lengths=[1280,1018,345,763,230,100,55,100,161,763,489,1018]
 return {'panelId':'C501c','panelDirection':'right','edges':[dict(direction=d,code=c,site=s) for d,c,s in zip(directions,codes,lengths)],'siteFolds':[868],'unsupported':False}

class PartialFolds(unittest.TestCase):
 def test_chain_and_outline_reading(self):
  p=c501c();points,_=vertices(p['edges'],'site')
  for edge,(x,y) in zip(p['edges'],points):edge['start']={'x':x/1280*1000,'y':(1018-y)/1018*1000};del edge['direction']
  p['folds']=[];p['foldSectionsTop']=[150,868]
  p=normalise_fold_sections(directions_from_corners(p));self.assertEqual(p['folds'],[868])
 def test_clipped_fold_routes(self):
  p=finish_extracted_spec(c501c());p['reviewed']=True;r=generate(p)
  m=ezdxf.read(io.StringIO(r['dxf'])).modelspace()
  folds=[list(e.get_points('xy')) for e in m.query('LWPOLYLINE[layer=="ROUTE"]') if all(abs(q[1]-866)<.001 for q in e.get_points('xy'))]
  self.assertEqual(len(folds),2)
  self.assertTrue(all(abs(a[0]-b[0])<500 for a,b in folds))
  self.assertEqual(len(m.query('LWPOLYLINE[layer=="CUT"]')),1)
  self.assertIsNone(r['validation']['stiffener']);self.assertEqual(r['validation']['fixingHoles'],0)
  self.assertEqual(p['edges'][6]['finished'],55)
 def test_corner_and_factory_endpoints_block(self):
  for height in [255,155,200]:
   p=c501c();p['siteFolds']=[height]
   with self.assertRaises(CadError):finish_extracted_spec(p)

if __name__=='__main__':unittest.main()
