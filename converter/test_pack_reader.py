import copy
import io
import math
import unittest
from unittest.mock import patch
import ezdxf
from panel_cad import CadError, generate
from pack_reader import compile_group, validate_inventory, process


# Manually checked against all seven ORDER 11 source pages. Not an OCR result.
ORDER_11 = [
    (2510, ['C3F-'+str(i) for i in [6,7,9,10,14,16,17,18,19,20,48,47,45,44,41,40,38,37,36,35,34,33]]),
    (2095,['C3F-8']), (2516,['C3F-13']), (2094,['C3F-46']), (1556,['C3F-39']),
    (2297,['C3F-11','C3F-12']), (2299,['C3F-42','C3F-43'])]
POLICY = {'thickness':3,'foldAllowance':'current-1mm','missingDirection':'non-directional'}


def group(width=2510, ids=None):
    return {'panels':[{'id':name,'quantity':1} for name in (ids or ['C3F-6'])],
            'material':'solid aluminium','thickness':None,'finish':'Duratec Zeus Matt white','view':'back',
            'holes':[], 'holeRows':[
                {'left':50,'right':50,'maximumSpacing':600,'y':30,'diameter':6,'yReference':'top','foldIndex':None},
                {'left':50,'right':50,'maximumSpacing':600,'y':100,'diameter':6,'yReference':'fold-above','foldIndex':1}],
            'requirements':['Fold returns square before powder coating.'],
            'spec':{'panelId':(ids or ['C3F-6'])[0], 'panelDirection':'none',
                    'edges':[{'name':name,'code':'FE','start':{'x':x,'y':y},'site':n,'finished':None}
                             for name,x,y,n in [('Bottom',100,800,width),('Right',900,800,595),('Top',900,200,width),('Left',100,200,595)]],
                    'folds':[],'foldSectionsTop':[550,25,20],'questions':[],'unsupported':False,
                    'edgeRightAngles':[],'rightAngleCornerNames':[]}}


class PackTests(unittest.TestCase):
    def test_all_30_ids_nest_once_on_synthetic_available_stock(self):
        panels=[]
        expected=set()
        for width, ids in ORDER_11:
            spec=compile_group(group(width,ids),POLICY)
            for name in ids:
                expected.add(name)
                drawing=generate({**spec,'panelId':name,'reviewed':True})
                panels.append({'name':name,'quantity':1,'direction':'right','dxf':drawing['dxf']})
        result=generate({'sheetPlan':True,'panels':panels,'stock':[{'id':'test-stock','type':'variant','sku':'TEST-ONLY','material':'Aluminium','color':'Milled','thickness':3,'width':3000,'height':1200,'quantity':15}]})
        self.assertEqual(result['unplaced'],[])
        placed=[p['name'] for sheet in result['sheets'] for p in sheet['panels']]
        self.assertEqual(len(placed),30)
        self.assertEqual(set(placed),expected)
        self.assertEqual(len(result['sheets']),15)

    def test_all_seven_order11_shapes_generate_with_correct_folds_holes_and_ids(self):
        total=0
        for width, ids in ORDER_11:
            source=group(width,ids)
            validate_inventory({'groups':[source],'issues':[],'declaredPanelCount':len(ids)})
            spec=compile_group(source,POLICY)
            self.assertEqual(spec['siteFolds'],[20,45])
            self.assertEqual(spec['folds'],[19,42])
            self.assertEqual([e['finished'] for e in spec['edges']],[width,591,width,591])
            self.assertEqual(spec['packManufacturing']['thickness'],3)
            self.assertEqual(spec['packManufacturing']['excludedComponents'],['CFC backing'])
            count=math.ceil((width-100)/600)+1
            self.assertEqual(len(spec['manualHoles']),count*2)
            self.assertEqual({h['y'] for h in spec['manualHoles']},{561,142})
            self.assertEqual({h['diameter'] for h in spec['manualHoles']},{6})
            for y in [561,142]:
                xs=[h['x'] for h in spec['manualHoles'] if h['y']==y]
                self.assertEqual(xs[0],50);self.assertEqual(xs[-1],width-50)
                self.assertLessEqual(max(b-a for a,b in zip(xs,xs[1:])),600.000001)
            drawing=generate({**spec,'reviewed':True})
            self.assertEqual(drawing['validation']['manualHoles'],count*2)
            doc=ezdxf.read(io.StringIO(drawing['dxf']))
            self.assertEqual(sum(1 for c in doc.modelspace().query('CIRCLE') if abs(c.dxf.radius-3)<.001),count*2)
            total+=len(ids)
        self.assertEqual(total,30)

    def test_missing_arrow_is_not_inferred_from_backing_leader(self):
        with self.assertRaisesRegex(CadError,'direction arrow'):
            compile_group(group(),{**POLICY,'missingDirection':'required'})

    def test_thickness_and_fold_policy_conflicts_are_blocked(self):
        g=group();g['thickness']=6
        with self.assertRaisesRegex(CadError,'thickness differs'):compile_group(g,POLICY)
        with self.assertRaisesRegex(CadError,'fold allowance'):compile_group(group(),{**POLICY,'foldAllowance':'unknown'})

    def test_counts_and_duplicate_ids_are_blocked(self):
        with self.assertRaisesRegex(CadError,'page total'):
            validate_inventory({'groups':[group()],'issues':[],'declaredPanelCount':22})
        with self.assertRaisesRegex(CadError,'Repeated panel ID'):
            validate_inventory({'groups':[group(ids=['C3F-6','c3f-6'])],'issues':[],'declaredPanelCount':2})

    def test_ambiguous_offsets_and_missing_dimensions_fail(self):
        g=group();g['holeRows'][1]['foldIndex']=5
        with self.assertRaisesRegex(CadError,'fold reference'):compile_group(g,POLICY)
        g=group();g['spec']['edges'][0]['site']=None
        with self.assertRaisesRegex(CadError,'dimensions are missing'):compile_group(g,POLICY)

    def test_unresolved_page_audit_never_emits_manufacturing_specs(self):
        inventory={'groups':[group()],'issues':[],'declaredPanelCount':1}
        with patch('cad_ai.request_sketch',return_value={**inventory,'issues':['Missing fixing row.']}):
            result=process({'mode':'pack-verify','inventory':inventory,'policy':POLICY},{},'key','model',100)
        self.assertFalse(result['verified']);self.assertEqual(result['groups'],[])

    def test_clear_audit_compiles_full_id_list(self):
        inventory={'groups':[group(ids=ORDER_11[0][1])],'issues':[],'declaredPanelCount':22}
        with patch('cad_ai.request_sketch',return_value=copy.deepcopy(inventory)):
            result=process({'mode':'pack-verify','inventory':inventory,'policy':POLICY},{},'key','model',100)
        self.assertTrue(result['verified']);self.assertEqual(len(result['groups'][0]['panels']),22)

    def test_notes_do_not_block_and_policy_reaches_both_readings(self):
        inventory={'groups':[group()],'issues':[],'notes':['Backing excluded; no source thickness.'],'declaredPanelCount':1}
        with patch('cad_ai.request_sketch',return_value=copy.deepcopy(inventory)) as read:
            result=process({'mode':'pack-verify','inventory':inventory,'policy':POLICY},{},'key','model',100)
        self.assertTrue(result['verified'])
        instruction=read.call_args.args[4]
        self.assertIn('"thickness": 3',instruction)
        self.assertNotIn('C3F-6',instruction) # No candidate anchoring.

    def test_independent_fold_and_hole_disagreements_block(self):
        inventory={'groups':[group()],'issues':[],'declaredPanelCount':1}
        for field in ['holeRows','spec']:
            other=copy.deepcopy(inventory)
            if field=='holeRows':other['groups'][0]['holeRows'][1].update(yReference='bottom',foldIndex=None)
            else:other['groups'][0]['spec']['foldSectionsTop']=[550,20,25]
            with patch('cad_ai.request_sketch',return_value=other):
                result=process({'mode':'pack-verify','inventory':inventory,'policy':POLICY},{},'key','model',100)
            self.assertFalse(result['verified']);self.assertEqual(result['groups'],[])
            self.assertIn('disagree',result['issues'][0])


if __name__=='__main__':unittest.main()
