import math
import json
from pathlib import Path
import unittest
from source_constraints import solve_vertices
from outline_geometry import GeometryError


def z425_constraints():
    # Perimeter A,B,Q,D,F,H,G,E,C,P. Values are site dimensions;
    # the 20 mm lateral interpretation is recorded separately in the trial.
    rows=[('dx',[3,4],0),('dy',[3,4],816),('dx',[7,8],0),('dy',[7,8],-800),
          ('dy',[8,3],0),('dx',[4,5],-1),('dy',[4,5],95),
          ('dx',[6,7],-1),('dy',[6,7],-95),('length',[5,6],1375),
          ('dx',[8,9],20),('length',[8,9],788),('length',[3,2],694),
          ('length',[9,2],1378),('length',[9,0],200),('length',[2,1],200),
          ('perpendicular',[9,2,9,0],None),('parallel',[9,0,2,1],None),
          ('above',[0,9],None),('above',[1,2],None),('above',[9,8],None),
          ('above',[2,3],None),('rightOf',[9,2],None),('rightOf',[8,3],None)]
    return [dict(kind=k,corners=c,value=v) for k,c,v in rows]


class SourceConstraintTests(unittest.TestCase):
    def test_written_constraints_compile_to_three_fold_drawing(self):
        from pack_reader import compile_group
        from panel_cad import generate
        draft=json.loads((Path(__file__).parent/'fixtures'/'z4-25-measured-trial.json').read_text())
        # Positions supply trace topology only; no calculated millimetre spans
        # are provided to the compiler. All numeric source constraints above
        # are dimensions or confirmed relationships, including the trial20.
        positions=[(0,950),(900,920),(900,820),(890,500),(890,120),(880,70),(30,80),(20,130),(20,500),(10,850)]
        written=[1378,200,694,816,95,1375,95,800,788,200]
        edges=[{'start':{'x':p[0],'y':p[1]},'kind':'vertical' if i in (3,7) else 'sloping',
                'code':draft['measuredEdges'][i]['code'],'site':written[i],
                'horizontalSpan':None,'verticalSpan':None,'lengthRole':'vertical-projection' if i in (4,6) else 'true-length'} for i,p in enumerate(positions)]
        spec={'dimensionBasis':'site','panelId':'Z4-25-source-trial','panelDirection':'down','unsupported':False,'questions':[],
              'edges':edges,'folds':[],'foldSectionsTop':[], 'sourceConstraints':z425_constraints(),
              'internalFoldEdges':[{'startCorner':9,'endCorner':2},{'startCorner':8,'endCorner':3},{'startCorner':7,'endCorner':4}]}
        group={'panels':[{'id':spec['panelId'],'quantity':1}],'spec':spec,'material':'aluminium','thickness':3,
               'finish':'Ship grey','view':'back','holes':[],'holeRows':[],'requirements':[]}
        compiled=compile_group(group,{'thickness':3,'foldAllowance':'current-1mm','missingDirection':'non-directional'})
        self.assertFalse(compiled['reviewed'])
        for actual,expected in zip(compiled['measuredEdges'],draft['measuredEdges']):
            self.assertAlmostEqual(actual['dx'],expected['dx'],places=3)
            self.assertAlmostEqual(actual['dy'],expected['dy'],places=3)
        result=generate({**compiled,'reviewed':True})
        self.assertEqual(len(result['geometry']['finishedFoldLines']),3)
        self.assertEqual(result['validation']['holes'],26)
        self.assertFalse(any(row['status']=='mismatch' for row in result['validation']['measurements']))

    def test_connected_three_fold_dimensions(self):
        p=solve_vertices(10,z425_constraints())
        # Independent closed-form checks, not solver residuals.
        width=2+math.sqrt(1375**2-16**2)
        self.assertAlmostEqual(p[3][0]-p[8][0],width,places=4)
        self.assertAlmostEqual(p[8][1]-p[9][1],math.sqrt(788**2-20**2),places=4)
        self.assertAlmostEqual(math.dist(p[2],p[3]),694,places=4)
        self.assertAlmostEqual(math.dist(p[9],p[2]),1378,places=4)
        self.assertAlmostEqual(math.dist(p[0],p[1]),1378,places=4)

    def test_missing_dimensions_do_not_get_guessed(self):
        with self.assertRaisesRegex(GeometryError,'More written'):
            solve_vertices(10,z425_constraints()[:10])

    def test_malformed_constraint_records_fail_as_geometry_errors(self):
        for raw in (None,False,12,'length',[]):
            with self.subTest(raw=raw),self.assertRaises(GeometryError):
                solve_vertices(3,[raw])

    def test_redundant_diagonal_checks_reject_inconsistent_measurements(self):
        rows=[{'kind':k,'corners':c,'value':v} for k,c,v in [
            ('dx',[0,1],300),('dy',[0,1],0),
            ('dx',[0,2],300),('dy',[0,2],400),
            ('dx',[0,3],0),('dy',[0,3],400),('length',[0,2],500)]]
        points=solve_vertices(4,rows)
        self.assertAlmostEqual(math.dist(points[0],points[2]),500,places=5)
        rows[-1]['value']=499
        with self.assertRaises(GeometryError):solve_vertices(4,rows)

    def test_two_valid_shapes_with_same_written_lengths_stay_blocked(self):
        rows=[{'kind':k,'corners':c,'value':v} for k,c,v in [
            ('dx',[0,1],300),('dy',[0,1],0),('dx',[0,3],0),('dy',[0,3],400),
            ('length',[1,2],math.hypot(200,100)),
            ('length',[3,2],math.hypot(100,300))]]
        with self.assertRaisesRegex(GeometryError,'more than one panel shape'):
            solve_vertices(4,rows)

    def test_written_coordinates_recover_across_scale_and_endpoint_reversal(self):
        for scale in (.1,1,10):
            expected=[(0,0),(300*scale,0),(280*scale,400*scale),(0,380*scale)]
            rows=[{'kind':axis,'corners':[i,0],'value':-point[j]}
                  for i,point in enumerate(expected[1:],1) for j,axis in enumerate(('dx','dy'))]
            rows.reverse()
            actual=solve_vertices(4,rows)
            for a,b in zip(actual,expected):
                self.assertLess(math.dist(a,b),.001)

    def test_invalid_reference_is_rejected(self):
        rows=z425_constraints();rows[0]['corners']=[0,12]
        with self.assertRaisesRegex(GeometryError,'invalid corner'):solve_vertices(10,rows)

    def test_conflicting_written_dimensions_are_rejected(self):
        rows=[{'kind':k,'corners':c,'value':v} for k,c,v in [
            ('dx',[0,1],100),('dy',[0,1],0),('dx',[0,2],0),('dy',[0,2],100),
            ('length',[0,1],110)]]
        with self.assertRaisesRegex(GeometryError,'could not be solved consistently'):
            solve_vertices(3,rows)

    def test_repeated_measurements_do_not_hide_missing_control(self):
        rows=[{'kind':k,'corners':c,'value':v} for k,c,v in [
            ('dx',[0,1],100),('dy',[0,1],0),('length',[0,2],100),
            ('length',[0,1],100)]]
        with self.assertRaisesRegex(GeometryError,'underdetermined'):
            solve_vertices(3,rows)


if __name__=='__main__':unittest.main()
