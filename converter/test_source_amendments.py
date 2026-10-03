import copy
import math
import unittest
from unittest.mock import patch
from pack_reader import compile_group, manufacturing_values, process
from panel_cad import CadError, generate
from outline_geometry import finish_regions, measurement_audit
from test_pack_reader import group, POLICY
from source_amendments import amend_vertices


def face(basis='developed'):
    points=[(0,0),(1000,0),(1000,100),(1000,500),(0,500),(0,100)]
    lengths=[1000,100,400,1000,400,100]
    return {'panels':[{'id':'Amendment test','quantity':1}], 'material':'aluminium','thickness':3,
            'finish':'White','view':'back','holes':[],'holeRows':[],'requirements':[],
            'spec':{'panelId':'Amendment test','panelDirection':'right','unsupported':False,'questions':[],
                    'dimensionBasis':basis,'developedBoundary':'face-before-edge-returns' if basis=='developed' else None,
                    'amendments':[], 'folds':[],'foldSectionsTop':[],
                    'internalFoldEdges':[{'startCorner':5,'endCorner':2}],
                    'edges':[{'start':{'x':x,'y':500-y},'code':'B','kind':'horizontal' if i in (0,3) else 'vertical',
                              'site':lengths[i],'horizontalSpan':None,'verticalSpan':None,'lengthRole':'true-length'}
                             for i,(x,y) in enumerate(points)]}}


def move(corner,dx,dy=0):
    return {'corner':corner,'dx':dx,'dy':dy,'endpointStatus':'resolved','evidence':'Synthetic explicit endpoint arrow fixture'}


class DimensionAmendmentTests(unittest.TestCase):
    def test_developed_face_keeps_spans_and_fold_but_adds_standard_holes(self):
        compiled=compile_group(face(),POLICY)
        result=generate({**compiled,'reviewed':True})
        geometry=result['geometry']
        self.assertEqual(geometry['finishedFoldLines'],[[(0,100),(1000,100)]])
        self.assertEqual(max(y for x,y in geometry['finishedFace']),500)
        self.assertGreater(result['validation']['holes'],0)
        self.assertTrue(all(r['status']=='pass' and r['deduction']==0 for r in result['validation']['measurements']))
        site=finish_regions(compile_group(face('site'),POLICY))
        self.assertNotEqual(site['finishedFoldLines'],geometry['finishedFoldLines'])

    def test_two_right_arrows_translate_endpoints_without_lengthening_top(self):
        g=face();g['spec']['amendments']=[move(3,2),move(4,2)]
        compiled=compile_group(g,POLICY)
        self.assertEqual(compiled['measuredEdges'][3]['dx'],-1000)
        self.assertEqual(compiled['measuredEdges'][2]['dx'],2)
        self.assertEqual(compiled['measuredEdges'][4]['dx'],-2)
        self.assertEqual(compiled['edges'][3]['site'],1000)
        self.assertEqual(len(compiled['amendmentAudit']),2)
        result=generate({**compiled,'reviewed':True})
        self.assertTrue(result['validation']['closedCut'])
        self.assertTrue(all(r['status']=='pass' for r in result['validation']['measurements']))

    def test_fold_endpoints_follow_moved_corners_and_origin_shift_is_safe(self):
        g=face();g['spec']['amendments']=[move(0,2),move(2,3),move(5,3)]
        compiled=compile_group(g,POLICY)
        self.assertEqual(compiled['measuredFolds'][0],{'start':{'x':1.,'y':100.},'end':{'x':1001.,'y':100.}})
        geometry=finish_regions(compiled)
        self.assertEqual(geometry['finishedFoldLines'],[[(1.,100.),(1001.,100.)]])

    def test_source_and_amendment_order_are_immutable(self):
        g=face();g['spec']['amendments']=[move(3,2),move(4,2)]
        original=copy.deepcopy(g);a=compile_group(g,POLICY)
        self.assertEqual(g,original)
        g['spec']['amendments'].reverse();b=compile_group(g,POLICY)
        self.assertEqual(manufacturing_values([{'panels':g['panels'],'spec':a}]),manufacturing_values([{'panels':g['panels'],'spec':b}]))

    def test_missing_mixed_unresolved_basis_and_complete_cut_are_blocked(self):
        for basis in (None,'mixed','unresolved','unknown'):
            g=face();g['spec']['dimensionBasis']=basis
            with self.subTest(basis=basis),self.assertRaisesRegex(CadError,'basis'):compile_group(g,POLICY)
        for boundary in (None,'complete-cut','unresolved'):
            g=face();g['spec']['developedBoundary']=boundary
            with self.subTest(boundary=boundary),self.assertRaisesRegex(CadError,'boundary'):compile_group(g,POLICY)

    def test_unresolved_duplicate_invalid_and_nonfinite_amendments_are_blocked(self):
        cases=[[{**move(3,2),'endpointStatus':'unresolved'}],[move(3,2),move(3,3)],
               [move(-1,2)],[move(True,2)],[move(3,float('nan'))],
               [{**move(3,2),'evidence':''}],[move(3,0)],[move(3,20000)]]
        for amendments in cases:
            g=face();g['spec']['amendments']=amendments
            with self.subTest(amendments=amendments),self.assertRaises(CadError):compile_group(g,POLICY)

    def test_invalid_amended_topology_is_blocked(self):
        g=face();g['spec']['amendments']=[move(3,-2000)]
        with self.assertRaises(CadError):compile_group(g,POLICY)

    def test_independent_readers_disagreeing_on_basis_cannot_approve(self):
        a=face();b=face('site')
        inventory={'groups':[a],'issues':[],'declaredPanelCount':1}
        with patch('cad_ai.request_sketch',return_value={**inventory,'groups':[b]}):
            result=process({'mode':'pack-verify','inventory':inventory,'policy':POLICY},{},'key','model',100)
        self.assertFalse(result['verified']);self.assertEqual(result['groups'],[])
        self.assertIn('dimensionBasis',' '.join(result['issues']))

    def test_independent_readers_disagreeing_on_movements_cannot_approve(self):
        a=face();a['spec']['amendments']=[move(3,2)]
        b=copy.deepcopy(a);b['spec']['amendments']=[move(4,2)]
        inventory={'groups':[a],'issues':[],'declaredPanelCount':1}
        with patch('cad_ai.request_sketch',return_value={**inventory,'groups':[b]}):
            result=process({'mode':'pack-verify','inventory':inventory,'policy':POLICY},{},'key','model',100)
        self.assertFalse(result['verified']);self.assertEqual(result['groups'],[])

    def test_direct_generation_cannot_bypass_unresolved_basis(self):
        compiled=compile_group(face(),POLICY);compiled['dimensionBasis']='mixed'
        with self.assertRaises(CadError):generate({**compiled,'reviewed':True})

    def test_amendment_report_preserves_source_and_calculated_target(self):
        g=face();g['spec']['amendments']=[move(3,2),move(4,2)]
        compiled=compile_group(g,POLICY)
        result=generate({**compiled,'reviewed':True})
        row=next(r for r in result['validation']['measurements'] if r['edge']==2)
        self.assertEqual(row['sourceMeasurements']['site'],400)
        self.assertAlmostEqual(row['amendedTarget']['length'],math.hypot(400,2))
        self.assertEqual(row['verificationScope'],'geometry-after-amendments')
        self.assertEqual(compiled['amendmentAudit'][0]['evidence'],move(3,2)['evidence'])
        self.assertEqual(compiled['amendmentAudit'][0]['coordinateFrame'],'unamended-source-origin')

    def test_independent_evidence_wording_does_not_change_geometry_agreement(self):
        a=face();a['spec']['amendments']=[move(3,2)]
        b=copy.deepcopy(a)
        b['spec']['amendments'][0]['evidence']='Same corner and rightward arrow, independently described.'
        def values(g):
            return manufacturing_values([{'panels':g['panels'],'spec':compile_group(g,POLICY)}])
        self.assertEqual(values(a),values(b))

    def test_non_text_endpoint_evidence_is_not_source_approval(self):
        for evidence in (True,12,{},['arrow']):
            g=face();g['spec']['amendments']=[{**move(3,2),'evidence':evidence}]
            with self.subTest(evidence=evidence),self.assertRaises(CadError):
                compile_group(g,POLICY)

    def test_reversed_and_collapsed_amendments_are_blocked(self):
        for amendments in ([move(3,0,-400)],
                           [move(2,-2000),move(3,-2000)]):
            g=face();g['spec']['amendments']=amendments
            with self.subTest(amendments=amendments),self.assertRaises(CadError):
                compile_group(g,POLICY)

    def test_developed_measurement_audit_detects_corrupted_geometry(self):
        geometry=finish_regions(compile_group(face(),POLICY))
        segment=geometry['finishedOuterSegments'][0]
        segment['end']=(segment['end'][0]+1,segment['end'][1])
        self.assertEqual(measurement_audit(geometry)[0]['status'],'mismatch')


if __name__=='__main__':unittest.main()
