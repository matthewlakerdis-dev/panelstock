import io,unittest
import ezdxf
from shapely.geometry import Polygon,LineString
from panel_cad import generate,finish_extracted_spec

class CapRouteOffset(unittest.TestCase):
 def test_cap_routes_stay_point_two_outside_cut(self):
  for measured in (False,True):
   with self.subTest(measured=measured):
    if measured:
     draft={'panelId':'cap-offset','measuredEdges':[dict(dx=x,dy=y,code='CR') for x,y in [(500,0),(0,300),(-500,80),(0,-380)]],'measuredFolds':[]}
    else:
     draft=finish_extracted_spec({'panelId':'cap-offset','edges':[dict(direction=d,site=v,code='CR') for d,v in zip(['right','up','left','down'],[500,300,500,300])],'siteFolds':[]})
    draft['reviewed']=True
    doc=ezdxf.read(io.StringIO(generate(draft)['dxf']))
    cut=Polygon(list(doc.modelspace().query('LWPOLYLINE[layer=="CUT"]'))[0].get_points('xy'))
    routes=list(doc.modelspace().query('LWPOLYLINE[layer=="CAP ROUTE"]'))
    self.assertEqual(len(routes),4)
    for route in routes:
     line=LineString(route.get_points('xy'))
     self.assertAlmostEqual(cut.boundary.distance(line.interpolate(.5,normalized=True)),.2,places=7)
     self.assertFalse(cut.intersects(line))
    self.assertFalse(doc.audit().errors)

if __name__=='__main__':unittest.main()
