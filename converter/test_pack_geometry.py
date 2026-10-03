import copy
import math
import unittest
from panel_cad import CadError, generate
from pack_geometry import measured_pack_spec
from pack_reader import compile_group, manufacturing_values


def slope_spec():
    return {'dimensionBasis':'site','panelId':'Slope','panelDirection':'right','unsupported':False,'questions':[], 'folds':[], 'foldSectionsTop':[],
            'edges':[{'start':{'x':x,'y':y},'code':'FE','kind':kind,'site':site,'horizontalSpan':None,'verticalSpan':height,'lengthRole':'true-length'}
              for x,y,kind,site,height in [(100,900,'horizontal',1000,None),(900,900,'vertical',400,None),(900,200,'sloping',math.hypot(1000,100),100),(100,100,'vertical',500,None)]]}


class PackGeometryTests(unittest.TestCase):
    def test_unresolved_offset_blocks_even_with_solvable_geometry(self):
        spec=slope_spec()
        spec['questions']=['20 mm note: projection endpoints are unresolved.']
        group={'spec':spec,'material':'aluminium','thickness':3}
        policy={'thickness':3,'foldAllowance':'current-1mm','missingDirection':'non-directional'}
        with self.assertRaisesRegex(CadError,'20 mm note'):
            compile_group(group,policy)

    def test_cardinal_outline_with_angled_internal_folds_reaches_generator(self):
        # Reader-form data: dimensions are supplied independently of its sketch
        # coordinates, and folds refer to explicit collinear perimeter corners.
        points=[(0,0),(1000,0),(1000,220),(1000,650),(1000,1000),(0,1000),(0,600),(0,200)]
        lengths=[1000,220,430,350,1000,400,400,200]
        spec={'dimensionBasis':'site','panelId':'Pack folds','panelDirection':'down','unsupported':False,'questions':[],
              'folds':[],'foldSectionsTop':[],
              'internalFoldEdges':[{'startCorner':7,'endCorner':2},{'startCorner':6,'endCorner':3}],
              'edges':[{'start':{'x':x,'y':1000-y},'code':'B','kind':'horizontal' if i in (0,4) else 'vertical',
                        'site':lengths[i],'horizontalSpan':None,'verticalSpan':None,'lengthRole':'true-length'} for i,(x,y) in enumerate(points)]}
        group={'panels':[{'id':'Pack folds','quantity':1}],'spec':spec,'material':'aluminium','thickness':3,
               'finish':'White','view':'back','holes':[],'holeRows':[],'requirements':[]}
        policy={'thickness':3,'foldAllowance':'current-1mm','missingDirection':'non-directional'}
        compiled=compile_group(group,policy)
        self.assertFalse(compiled['reviewed'])
        self.assertEqual(len(compiled['measuredFolds']),2)
        result=generate({**compiled,'reviewed':True})
        self.assertTrue(result['validation']['closedCut'])
        self.assertGreater(result['validation']['holes'],0)
        distorted=copy.deepcopy(group)
        distorted['spec']['edges'][2]['start']['y']=820
        distorted['spec']['edges'][3]['start']['y']=450
        self.assertEqual(compile_group(distorted,policy)['measuredFolds'],compiled['measuredFolds'])

    def test_true_slope_plus_written_offset_generates_without_pixel_measurement(self):
        group={'panels':[{'id':'Slope','quantity':1}],'spec':slope_spec(),'material':'aluminium','thickness':3,'finish':'White','view':'back','holes':[],'holeRows':[],'requirements':[]}
        policy={'thickness':3,'foldAllowance':'current-1mm','missingDirection':'non-directional'}
        spec=compile_group(group,policy)
        self.assertAlmostEqual(spec['measuredEdges'][2]['dx'],-1000.0)
        self.assertEqual(spec['measuredEdges'][2]['dy'],100.0)
        # Change the sketch's slope angle without changing its quadrant.
        distorted=copy.deepcopy(group);distorted['spec']['edges'][3]['start']['y']=190
        self.assertEqual(compile_group(distorted,policy)['measuredEdges'],spec['measuredEdges'])
        result=generate({**spec,'reviewed':True})
        self.assertTrue(result['validation']['closedCut'])
        # Independently reconstructed offset line intersections verify the
        # generated lengths; the source reading still needs separate approval.
        self.assertTrue(result['validation']['measurements'])
        self.assertTrue(all(row['status']=='pass' for row in result['validation']['measurements']))
        self.assertIn('slope',manufacturing_values([{'panels':group['panels'],'spec':spec}]))

    def test_projection_is_not_treated_as_true_slope_length(self):
        spec=slope_spec();spec['edges'][2].update(site=1000,lengthRole='horizontal-projection')
        self.assertEqual(measured_pack_spec(spec)['measuredEdges'][2]['dx'],-1000)

    def test_unknown_or_wrong_axis_measurement_roles_are_blocked(self):
        for edge,role in ((2,'unresolved'),(0,'vertical-projection'),(1,'horizontal-projection')):
            spec=slope_spec();spec['edges'][edge]['lengthRole']=role
            with self.subTest(edge=edge,role=role),self.assertRaises(CadError):
                measured_pack_spec(spec)

    def test_incomplete_and_conflicting_slopes_stay_blocked(self):
        spec=slope_spec();spec['edges'][2]['verticalSpan']=None
        with self.assertRaisesRegex(CadError,'angle'):measured_pack_spec(spec)
        spec=slope_spec();spec['edges'][2]['horizontalSpan']=900
        with self.assertRaisesRegex(CadError,'conflicts'):measured_pack_spec(spec)
        spec=slope_spec();spec['foldSectionsTop']=[400,100]
        with self.assertRaisesRegex(CadError,'fold endpoints'):measured_pack_spec(spec)

if __name__=='__main__':unittest.main()
