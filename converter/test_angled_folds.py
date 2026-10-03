import math
import io
import copy
import json
from pathlib import Path
import unittest
import ezdxf
from shapely.geometry import Polygon, LineString
from outline_geometry import finish_regions, GeometryError


def fixture():
    points=[(0,0),(1000,0),(1000,220),(1000,650),(1000,1000),(0,1000),(0,600),(0,200)]
    edges=[{'dx':points[(i+1)%len(points)][0]-p[0],'dy':points[(i+1)%len(points)][1]-p[1],'code':'B'} for i,p in enumerate(points)]
    return {'panelId':'Angled trial','reviewed':True,'measuredEdges':edges,
            'measuredFolds':[{'start':{'x':0,'y':a},'end':{'x':1000,'y':b}} for a,b in [(200,220),(600,650)]]}


class AngledFoldTests(unittest.TestCase):
    def test_z425_three_fold_regression(self):
        from panel_cad import generate
        draft=json.loads((Path(__file__).parent/'fixtures'/'z4-25-measured-trial.json').read_text())
        result=generate(draft)
        self.assertEqual(len(result['geometry']['finishedFoldLines']),3)
        self.assertEqual(result['validation']['holes'],26)
        self.assertEqual(sum(r['status']=='pass' for r in result['validation']['measurements']),8)
        self.assertEqual(sum(r['status']=='calculated' for r in result['validation']['measurements']),2)
        self.assertTrue(any('5, 7' in warning for warning in result['validation']['warnings']))
        for segment in result['geometry']['finishedOuterSegments']:
            if segment['edge'] in (4,6):
                self.assertAlmostEqual(abs(segment['start'][1]-segment['end'][1]),93,delta=.001)
        cut=list(ezdxf.read(io.StringIO(result['dxf'])).modelspace().query('LWPOLYLINE[layer=="CUT"]'))[0]
        points=list(cut.get_points('xy'));tips=[]
        for i,p in enumerate(points):
            a,b=points[i-1],points[(i+1)%len(points)]
            u=(a[0]-p[0],a[1]-p[1]);v=(b[0]-p[0],b[1]-p[1])
            if min(math.hypot(*u),math.hypot(*v))<.001:continue
            angle=math.degrees(math.acos(max(-1,min(1,(u[0]*v[0]+u[1]*v[1])/math.hypot(*u)/math.hypot(*v)))))
            if abs(angle-94)<.001:tips.append(p)
        self.assertEqual(len(tips),6)
        for fold in result['geometry']['finishedFoldLines']:
            for endpoint in (fold[0],fold[-1]):
                self.assertLess(min(math.dist(endpoint,tip) for tip in tips),2)

    def test_full_drawing_with_different_fold_angles(self):
        from panel_cad import generate
        draft=fixture()
        draft['outlineSections']=[{'site':math.hypot(e['dx'],e['dy']),'manualMeasurements':{'site':math.hypot(e['dx'],e['dy'])},'code':e['code']} for e in draft['measuredEdges']]
        result=generate(draft)
        self.assertTrue(result['validation']['closedCut'])
        self.assertGreater(result['validation']['holes'],0)
        self.assertTrue(all(row['status']=='pass' for row in result['validation']['measurements']))
        cut=list(ezdxf.read(io.StringIO(result['dxf'])).modelspace().query('LWPOLYLINE[layer=="CUT"]'))[0]
        points=list(cut.get_points('xy'));angles=[]
        for i,p in enumerate(points):
            a=points[i-1];b=points[(i+1)%len(points)]
            u=(a[0]-p[0],a[1]-p[1]);v=(b[0]-p[0],b[1]-p[1])
            if math.hypot(*u)<.001 or math.hypot(*v)<.001:continue
            angles.append(math.degrees(math.acos(max(-1,min(1,(u[0]*v[0]+u[1]*v[1])/math.hypot(*u)/math.hypot(*v))))))
        self.assertGreaterEqual(sum(abs(angle-94)<.001 for angle in angles),4)
        reversed_draft=copy.deepcopy(draft)
        reversed_draft['measuredFolds'].reverse()
        for fold in reversed_draft['measuredFolds']:fold['start'],fold['end']=fold['end'],fold['start']
        other=generate(reversed_draft)
        other_cut=list(ezdxf.read(io.StringIO(other['dxf'])).modelspace().query('LWPOLYLINE[layer=="CUT"]'))[0]
        self.assertLess(Polygon(points).hausdorff_distance(Polygon(other_cut.get_points('xy'))),1e-6)

    def test_two_different_angles_keep_fold_directions_and_shared_faces(self):
        draft=fixture();result=finish_regions(draft)
        self.assertEqual(len(result['finishedRegions']),3)
        self.assertEqual(len(result['finishedFoldLines']),2)
        face=Polygon(result['finishedFace'])
        self.assertTrue(face.is_valid)
        for source,route in zip(draft['measuredFolds'],result['finishedFoldLines']):
            dx=source['end']['x']-source['start']['x'];dy=source['end']['y']-source['start']['y']
            a,b=route[0],route[-1]
            self.assertAlmostEqual((b[0]-a[0])*dy-(b[1]-a[1])*dx,0,places=5)
            self.assertTrue(face.buffer(1e-7).covers(LineString(route)))
            self.assertEqual(sum(Polygon(region).boundary.buffer(1e-7).covers(LineString(route)) for region in result['finishedRegions']),2)
        # Perpendicular 1 mm on each side of both bends reduces the top by
        # the sum of two normal vectors, not an arbitrary 4 mm in world Y.
        expected=999-2/math.sqrt(1+.02**2)-2/math.sqrt(1+.05**2)
        self.assertAlmostEqual(face.bounds[3],expected,places=6)

    def test_crossing_folds_are_rejected(self):
        draft=fixture()
        draft['measuredFolds'][1]={'start':{'x':0,'y':600},'end':{'x':1000,'y':0}}
        with self.assertRaisesRegex(GeometryError,'Intersecting'):finish_regions(draft)


if __name__=='__main__':unittest.main()
