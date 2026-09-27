import copy,json,unittest
from pathlib import Path
from outline_geometry import finish_regions,measurement_audit

class MeasurementAudit(unittest.TestCase):
 def geometry(self):return finish_regions(json.loads((Path(__file__).parent/'fixtures/z2-21-current.json').read_text()))
 def test_exact_lengths_and_constraint_are_verified(self):
  rows=measurement_audit(self.geometry())
  slope=next(r for r in rows if r['label'].startswith('Section 1 slope'))
  self.assertEqual((slope['site'],slope['deduction'],slope['actual'],slope['status']),(1452,2,1450,'pass'))
  constraint=next(r for r in rows if r['label']=='Constraint 1')
  self.assertEqual((constraint['actual'],constraint['deduction'],constraint['status']),(1355,0,'pass'))
  self.assertTrue(any(r['status']=='calculated' for r in rows))
 def test_fractional_geometry_error_is_not_hidden_by_rounding(self):
  g=self.geometry();s=next(s for s in g['finishedOuterSegments'] if s['edge']==0)
  s['end']=(s['end'][0]+.15,s['end'][1])
  row=next(r for r in measurement_audit(g) if r['label'].startswith('Section 1 slope'))
  self.assertEqual(row['status'],'mismatch')
 def test_constraint_mismatch_is_identified(self):
  g=self.geometry();s=next(s for s in g['finishedOuterSegments'] if s['edge']==4)
  s['start']=(s['start'][0]-2,s['start'][1])
  row=next(r for r in measurement_audit(g) if r['label']=='Constraint 1')
  self.assertEqual(row['actual'],1353);self.assertEqual(row['status'],'mismatch')

