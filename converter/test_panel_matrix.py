"""Synthetic panel families plus existing source-derived regression fixtures.

These verify generated geometry, not independent approval of drawing readings.
"""
import copy
import io
import json
from pathlib import Path
import unittest
import ezdxf
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
from panel_cad import generate
from pack_reader import compile_group
from test_pack_reader import group, POLICY, ORDER_11
from measured_test_fixtures import shoulder_panel
from test_angled_folds import fixture as angled_panel


def measured(points, code, name):
    return {'panelId':name,'reviewed':True,'panelDirection':'right',
            'measuredEdges':[{'dx':points[(i+1)%len(points)][0]-p[0],
                              'dy':points[(i+1)%len(points)][1]-p[1],'code':code}
                             for i,p in enumerate(points)],'measuredFolds':[]}


class PanelMatrixTests(unittest.TestCase):
    def check_export(self, draft):
        before=copy.deepcopy(draft)
        result=generate(draft)
        self.assertEqual(before,draft,'Generation must not alter source values')
        doc=ezdxf.read(io.StringIO(result['dxf']))
        self.assertFalse(doc.audit().has_errors)
        model=doc.modelspace();cuts=list(model.query('LWPOLYLINE[layer=="CUT"]'))
        self.assertEqual(len(cuts),1);self.assertTrue(cuts[0].closed)
        cut=Polygon(cuts[0].get_points('xy'))
        self.assertTrue(cut.is_valid);self.assertFalse(cut.interiors)
        routes=[LineString(e.get_points('xy')) for e in model.query('LWPOLYLINE[layer=="ROUTE"]')]
        for route in routes:self.assertTrue(cut.buffer(1e-6).covers(route))
        holes=list(model.query('CIRCLE[layer=="HOLES"]'))
        self.assertEqual(len(holes),result['validation']['holes'])
        for hole in holes:
            p=Point(hole.dxf.center.x,hole.dxf.center.y)
            self.assertTrue(cut.contains(p.buffer(hole.dxf.radius)))
            self.assertTrue(all(p.distance(line)>=hole.dxf.radius-1e-6 for line in routes))
        geometry=result.get('geometry')
        if geometry:
            self.assertTrue(cut.buffer(1e-6).covers(Polygon(geometry['finishedFace'])))
            network=unary_union(routes)
            for fold in geometry.get('finishedFoldLines',[]):
                self.assertTrue(network.buffer(.001).covers(LineString(fold)))
        self.assertFalse(any(row['status']=='mismatch' for row in result['validation'].get('measurements',[])))
        return result

    def test_five_outline_families_three_sizes_two_hardware_codes(self):
        shapes={
            'rectangle':[(0,0),(1100,0),(1100,700),(0,700)],
            'taper':[(0,0),(1100,0),(1100,650),(0,750)],
            'L':[(0,0),(1000,0),(1000,400),(450,400),(450,900),(0,900)],
            'recess':[(0,0),(1200,0),(1200,800),(850,800),(850,450),(350,450),(350,800),(0,800)],
            'narrow':[(0,0),(70,0),(70,1300),(0,1300)]}
        for name,points in shapes.items():
            for scale in (.5,1,1.5):
                machining=[]
                for code in ('S','ES'):
                    with self.subTest(shape=name,scale=scale,code=code):
                        result=self.check_export(measured([(x*scale,y*scale) for x,y in points],code,'SYN-'+name))
                        doc=ezdxf.read(io.StringIO(result['dxf']))
                        machining.append([(e.dxftype(),e.dxf.layer,
                                           list(e.get_points('xy')) if e.dxftype()=='LWPOLYLINE' else tuple(e.dxf.center))
                                          for e in doc.modelspace() if e.dxf.layer in ('CUT','ROUTE','HOLES')])
                if len(machining)==2:self.assertEqual(machining[0],machining[1])

    def test_plain_and_hole_free_edge_types(self):
        points=[(0,0),(1800,0),(1800,1100),(0,1100)]
        for code in ('FE','CR','NT','RE'):
            with self.subTest(code=code):
                result=self.check_export(measured(points,code,'SYN-'+code))
                self.assertEqual(result['validation']['holes'],0)
                if code=='CR':
                    m=ezdxf.read(io.StringIO(result['dxf'])).modelspace()
                    cut=Polygon(list(m.query('LWPOLYLINE[layer=="CUT"]'))[0].get_points('xy'))
                    for e in m.query('LWPOLYLINE[layer=="CAP ROUTE"]'):
                        route=LineString(e.get_points('xy'))
                        self.assertAlmostEqual(route.distance(cut),.2,places=6)

    def test_folded_families_and_rotated_shoulder(self):
        for name,draft in [('shoulder',shoulder_panel()),('angled',angled_panel())]:
            draft['reviewed']=True
            with self.subTest(name=name):self.check_export(draft)
        draft=shoulder_panel();draft['reviewed']=True
        for edge in draft['measuredEdges']:edge['dx'],edge['dy']=edge['dy'],-edge['dx']
        for fold in draft['measuredFolds']:
            for p in fold.values():p['x'],p['y']=p['y'],-p['x']
        self.check_export(draft)

    def test_split_edge_audit_detects_real_length_error(self):
        from outline_geometry import finish_regions, measurement_audit
        draft=shoulder_panel();geometry=finish_regions(draft)
        rows=measurement_audit(geometry)
        left=next(row for row in rows if row['edge']==5)
        self.assertEqual(left['status'],'pass')
        self.assertAlmostEqual(left['site'],2350)
        self.assertAlmostEqual(left['expected'],2340) # two outer + eight fold-side allowances
        segment=next(s for s in geometry['finishedOuterSegments'] if s['edge']==5)
        segment['end']=(segment['end'][0],segment['end'][1]+1)
        left=next(row for row in measurement_audit(geometry) if row['edge']==5)
        self.assertEqual(left['status'],'mismatch')

    def test_existing_source_derived_fixtures(self):
        for name in ('c501c-tag-corners.json','z3-30a-tag-corners.json','z4-25-measured-trial.json'):
            with self.subTest(fixture=name):
                draft=json.loads((Path(__file__).parent/'fixtures'/name).read_text())
                draft['reviewed']=True;self.check_export(draft)

    def test_all_seven_order11_sizes_and_thirty_ordered_ids(self):
        total=0
        for width,ids in ORDER_11:
            with self.subTest(width=width):
                draft=compile_group(group(width,ids),POLICY);draft['reviewed']=True
                result=self.check_export(draft);total+=len(ids)
                self.assertEqual(draft['folds'],[19,42])
                self.assertEqual(draft['edges'][1]['finished'],591)
                self.assertEqual(result['validation']['manualHoles'],len(draft['manualHoles']))
        self.assertEqual(total,30)
