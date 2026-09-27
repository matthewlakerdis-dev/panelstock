import copy,json,unittest
from pathlib import Path
from outline_geometry import finish_regions,GeometryError,measurement_audit
class FinishedConstraints(unittest.TestCase):
 def draft(self):return json.loads((Path(__file__).parent/'fixtures/c501c-site-constraints.json').read_text())
 def test_site_constraint_does_not_override_finished_deductions(self):
  draft=self.draft();before=copy.deepcopy(draft);result=finish_regions(draft)
  segments={s['edge']:s for s in result['finishedOuterSegments']}
  self.assertAlmostEqual(segments[4]['start'][0]-segments[13]['start'][0],448)
  self.assertEqual(draft,before)
  baseline=copy.deepcopy(draft);baseline['measurementConstraints']=[]
  self.assertEqual(result['finishedFace'],finish_regions(baseline)['finishedFace'])
  row=next(r for r in measurement_audit(result) if r['label']=='Constraint 4')
  self.assertEqual(row['site'],446);self.assertEqual(row['actual'],448);self.assertEqual(row['status'],'calculated')
 def test_conflicting_site_constraint_is_rejected(self):
  draft=self.draft();draft['measurementConstraints'][3]['value']=447
  with self.assertRaisesRegex(GeometryError,'before deductions'):finish_regions(draft)
 def test_corner_and_edge_and_fold_targets_validate_site_geometry(self):
  draft=self.draft();draft['measurementConstraints']=[{'from':13,'to':4,'axis':'x','value':446,'direction':1},{'from':0,'fold':0,'axis':'y','value':868,'direction':1}]
  finish_regions(draft)
