import copy,json,math,unittest
from pathlib import Path
from outline_geometry import finish_regions,GeometryError

class FinishedConstraints(unittest.TestCase):
 def draft(self):return json.loads((Path(__file__).parent/'fixtures/z2-21-missing-route.json').read_text())
 def test_constraint_is_exact_and_written_edges_remain_fixed(self):
  draft=self.draft();before=copy.deepcopy(draft)
  unconstrained=copy.deepcopy(draft);unconstrained['measurementConstraints']=[]
  baseline=finish_regions(unconstrained);result=finish_regions(draft)
  segments={s['edge']:s for s in result['finishedOuterSegments']}
  self.assertAlmostEqual(segments[4]['start'][0]-segments[10]['start'][0],1355)
  for segment in baseline['finishedOuterSegments']:
   if draft['outlineSections'][segment['edge']].get('manualMeasurements',{}).get('site'):
    actual=segments[segment['edge']]
    self.assertAlmostEqual(math.dist(segment['start'],segment['end']),math.dist(actual['start'],actual['end']))
  self.assertEqual(draft,before)
 def test_fixed_shoulder_conflict_is_reported(self):
  draft=self.draft();draft['outlineSections'][4]['manualMeasurements']={'site':True}
  with self.assertRaisesRegex(GeometryError,'conflicts with fixed finished measurements'):finish_regions(draft)
 def test_conflicting_constraints_are_not_silently_changed(self):
  draft=self.draft();draft['measurementConstraints'].append({**draft['measurementConstraints'][0],'value':1356})
  with self.assertRaisesRegex(GeometryError,'conflicts'):finish_regions(draft)
 def test_corner_to_outline_constraint_remains_exact(self):
  draft=self.draft();draft['measurementConstraints']=[{'from':4,'edge':10,'axis':'x','value':1355,'direction':-1}]
  result=finish_regions(draft);segments={s['edge']:s for s in result['finishedOuterSegments']}
  self.assertAlmostEqual(segments[4]['start'][0]-segments[10]['start'][0],1355)

