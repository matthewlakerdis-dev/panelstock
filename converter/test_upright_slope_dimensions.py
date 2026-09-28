import math,unittest
import ezdxf
from panel_cad import draw_clear_dimensions

class UprightSlopeDimensions(unittest.TestCase):
 def test_both_slope_directions_and_traversal_orders(self):
  for slope in (-30,30,-400,400):
   for reverse in (False,True):
    with self.subTest(slope=slope,reverse=reverse):
     doc=ezdxf.new('R2010');doc.styles.new('Arial',dxfattribs={'font':'arial.ttf'});m=doc.modelspace()
     a,b=(0,0),(1409,slope)
     if reverse:a,b=b,a
     angle=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))%180
     draw_clear_dimensions(m,[(a,b,(704.5,100),angle,'B')])
     dim=list(m.query('DIMENSION'))[0]
     texts=[e for e in dim.virtual_entities() if e.dxftype()=='MTEXT']
     self.assertEqual(len(texts),1)
     rotation=(texts[0].get_rotation()+180)%360-180
     self.assertTrue(-90<=rotation<=90,rotation)
     expected=math.degrees(math.atan2(slope,1409))
     self.assertAlmostEqual(rotation,expected,places=6)
     self.assertAlmostEqual(dim.dxf.angle,angle,places=6)

if __name__=='__main__':unittest.main()
