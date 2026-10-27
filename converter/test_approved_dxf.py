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

    def test_cap_routes_allow_only_nearby_unambiguous_edges(self):
        def payload(layer='CAP ROUTE', offset=.4, second=False, crossing=False):
            doc=ezdxf.new('R2010');doc.units=4;m=doc.modelspace()
            m.add_lwpolyline([(0,0),(100,0),(100,100),(0,100)],close=True,dxfattribs={'layer':'CUT'})
            m.add_text('P-1',dxfattribs={'layer':'LABELS','insert':(50,50)})
            m.add_line((100+offset,-10 if crossing else 10),(100+offset,90),dxfattribs={'layer':layer})
            if second:
                m.add_lwpolyline([(101.6,0),(200,0),(200,100),(101.6,100)],close=True,dxfattribs={'layer':'CUT'})
                m.add_text('P-2',dxfattribs={'layer':'LABELS','insert':(150,50)})
            out=io.StringIO();doc.write(out)
            return {'approved':True,'nonDirectional':True,'data':base64.b64encode(out.getvalue().encode()).decode()}
        for offset in (.2,.4,.8,-.4):
            result=import_approved(payload(offset=offset))
            model=ezdxf.read(io.StringIO(result['panels'][0]['result']['dxf'])).modelspace()
            route=model.query('LINE[layer=="CAP ROUTE"]')[0]
            self.assertAlmostEqual(route.dxf.start.x,100+offset)
            self.assertAlmostEqual(route.dxf.end.y,90)
        for args in ({'offset':.81},{'second':True,'offset':.8},{'crossing':True},{'layer':'ROUTE'},{'layer':'HOLES'}):
            with self.subTest(args=args),self.assertRaises(CadError):
                import_approved(payload(**args))

    def test_directional_import_requires_per_panel_direction_review(self):
        payload=drawing();payload.update(nonDirectional=False,reviewDirections=True)
        result=import_approved(payload)
        for panel in result['panels']:
            self.assertIsNone(panel['spec']['panelDirection'])
            self.assertFalse(panel['spec']['directionReviewed'])
        payload['reviewDirections']=False
        with self.assertRaises(CadError):import_approved(payload)
        for panel in import_approved(drawing())['panels']:
            self.assertTrue(panel['spec']['directionReviewed'])

    def test_source_arrow_graphics_are_preserved_for_review(self):
        payload=drawing();doc=ezdxf.read(io.StringIO(base64.b64decode(payload['data']).decode()))
        doc.modelspace().add_line((250,400),(350,400),dxfattribs={'layer':'LABELS'})
        doc.modelspace().add_line((335,410),(350,400),dxfattribs={'layer':'LABELS'})
        out=io.StringIO();doc.write(out);payload['data']=base64.b64encode(out.getvalue().encode()).decode()
        payload.update(nonDirectional=False,reviewDirections=True)
        panels=import_approved(payload)['panels']
        first=ezdxf.read(io.StringIO(panels[0]['result']['dxf'])).modelspace()
        second=ezdxf.read(io.StringIO(panels[1]['result']['dxf'])).modelspace()
        self.assertEqual(len(first.query('LINE[layer=="LABELS"]')),2)
        self.assertEqual(len(second.query('LINE[layer=="LABELS"]')),0)
        self.assertEqual(tuple(first.query('LINE[layer=="LABELS"]')[0].dxf.start),(150,350,0))

    def test_invalid_or_unapproved_geometry_is_blocked(self):
        for args in [{'outside':True},{'duplicate':True},{'units':1},{'unknown':True}]:
            with self.subTest(args=args),self.assertRaises(CadError):import_approved(drawing(**args))
        for flag in ['approved','nonDirectional']:
            payload=drawing();payload[flag]=False
            with self.assertRaises(CadError):import_approved(payload)

if __name__=='__main__':unittest.main()
