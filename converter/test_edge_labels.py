import io
import unittest
import ezdxf
from ezdxf import bbox
from shapely.geometry import box, LineString, Polygon
from panel_cad import generate, draw_edge_label
from pack_reader import compile_group
from test_pack_reader import group, POLICY


class EdgeLabelTests(unittest.TestCase):
    def test_order11_labels_clear_folds_and_stay_in_adjacent_strip(self):
        result=generate({**compile_group(group(),POLICY),'reviewed':True})
        doc=ezdxf.read(io.StringIO(result['dxf']))
        labels=[e for e in doc.modelspace().query('MTEXT') if e.text=='FE']
        self.assertEqual(len(labels),4)
        routes=[LineString(e.get_points('xy')) for e in doc.modelspace().query('LWPOLYLINE') if e.dxf.layer=='ROUTE']
        for label in labels:
            b=bbox.extents([label]);area=box(b.extmin.x,b.extmin.y,b.extmax.x,b.extmax.y)
            self.assertTrue(all(area.distance(route)>=1.99 for route in routes))
        bottom=min(labels,key=lambda e:e.dxf.insert.y)
        bounds=bbox.extents([bottom])
        self.assertGreater(bounds.extmin.y,0)
        self.assertLess(bounds.extmax.y,19)
        self.assertLess(bottom.dxf.char_height,18)

    def test_angled_label_checks_full_text_box(self):
        doc=ezdxf.new();doc.styles.new('Arial',dxfattribs={'font':'arial.ttf'})
        face=Polygon([(0,0),(300,150),(300,350),(0,200)])
        inward=(-1/5**.5,2/5**.5)
        routes=[LineString([(inward[0]*30,inward[1]*30),(300+inward[0]*30,150+inward[1]*30)])]
        label=draw_edge_label(doc.modelspace(),'RE',(0,0),(300,150),inward,face,routes,[])
        self.assertIsNotNone(label)
        bounds=bbox.extents([label]);area=box(bounds.extmin.x,bounds.extmin.y,bounds.extmax.x,bounds.extmax.y)
        self.assertTrue(face.covers(area))
        self.assertLess(LineString([(0,0),(300,150)]).distance(area),30)
        self.assertGreaterEqual(area.distance(routes[0]),1.99)

    def test_impossibly_narrow_strip_does_not_move_label_over_fold(self):
        doc=ezdxf.new();doc.styles.new('Arial',dxfattribs={'font':'arial.ttf'})
        label=draw_edge_label(doc.modelspace(),'B',(0,0),(300,0),(0,1),box(0,0,300,200),[LineString([(0,4),(300,4)])],[])
        self.assertIsNone(label)
        self.assertEqual(len(list(doc.modelspace().query('MTEXT'))),0)


if __name__=='__main__':unittest.main()

