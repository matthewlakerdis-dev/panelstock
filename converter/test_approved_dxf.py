import base64
import io
import unittest
import ezdxf
from shapely.geometry import Polygon
from approved_dxf import import_approved
from panel_cad import CadError


def drawing(outside=False, duplicate=False, units=4, unknown=False):
    doc=ezdxf.new('R2010');doc.units=units;m=doc.modelspace()
    for x,name in [(100,'Template 1'),(1000,'Template 1' if duplicate else 'Template 2')]:
        m.add_lwpolyline([(x,50),(x+500,50),(x+450,650),(x,600)],close=True,dxfattribs={'layer':'CUT'})
        m.add_line((x-10 if outside else x,300),(x+470,300),dxfattribs={'layer':'ROUTE'})
        m.add_mtext(name,dxfattribs={'insert':(x+150,400),'layer':'LABLES'})
    if unknown:m.add_circle((300,400),3,dxfattribs={'layer':'DRILL'})
    out=io.StringIO();doc.write(out)
    return {'approved':True,'nonDirectional':True,'data':base64.b64encode(out.getvalue().encode()).decode()}


class ApprovedDxfTests(unittest.TestCase):
    def test_preserves_developed_shape_and_does_not_add_holes_or_allowances(self):
        result=import_approved(drawing())
        self.assertEqual([p['name'] for p in result['panels']],['Template 1','Template 2'])
        expected=Polygon([(0,0),(500,0),(450,600),(0,550)])
        for panel in result['panels']:
            model=ezdxf.read(io.StringIO(panel['result']['dxf'])).modelspace()
            actual=Polygon(list(model.query('LWPOLYLINE[layer=="CUT"]')[0].get_points('xy')))
            self.assertLess(actual.symmetric_difference(expected).area,1e-7)
            self.assertEqual(len(model.query('CIRCLE')),0)
            line=model.query('LINE[layer=="ROUTE"]')[0]
            self.assertEqual(tuple(line.dxf.start),(0,250,0))
            self.assertEqual(tuple(line.dxf.end),(470,250,0))
            self.assertFalse(panel['result']['validation']['allowanceApplied'])

    def test_invalid_or_unapproved_geometry_is_blocked(self):
        for args in [{'outside':True},{'duplicate':True},{'units':1},{'unknown':True}]:
            with self.subTest(args=args),self.assertRaises(CadError):import_approved(drawing(**args))
        for flag in ['approved','nonDirectional']:
            payload=drawing();payload[flag]=False
            with self.assertRaises(CadError):import_approved(payload)

if __name__=='__main__':unittest.main()
