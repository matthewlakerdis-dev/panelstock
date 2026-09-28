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
  self.assertEqual((constraint['actual'],constraint['deduction'],constraint['status']),(1354,1,'calculated'))
  self.assertTrue(any(r['status']=='calculated' for r in rows))
 def test_fractional_geometry_error_is_not_hidden_by_rounding(self):
  g=self.geometry();s=next(s for s in g['finishedOuterSegments'] if s['edge']==0)
  s['end']=(s['end'][0]+.15,s['end'][1])
  row=next(r for r in measurement_audit(g) if r['label'].startswith('Section 1 slope'))
  self.assertEqual(row['status'],'mismatch')
 def test_finished_constraint_reports_actual_geometry(self):
  g=self.geometry();s=next(s for s in g['finishedOuterSegments'] if s['edge']==4)
  s['start']=(s['start'][0]-2,s['start'][1])
  row=next(r for r in measurement_audit(g) if r['label']=='Constraint 1')
  self.assertEqual(row['actual'],1352);self.assertEqual(row['status'],'calculated')

 def test_automatic_taper_checks_projections_not_retained_site_length(self):
  from math import hypot
  g={'measuredEdges':[{'dx':-1409,'dy':30,'code':'B'}],
     'outlineSections':[{'kind':'sloping','site':1409,'readMeasurements':{'site':1409},'inferredMeasurements':{'height':30}}],
     'finishedOuterSegments':[{'edge':0,'start':(1407,0),'end':(0,30),'code':'B'}]}
  rows=measurement_audit(g)
  self.assertEqual(len(rows),2)
  self.assertEqual(rows[0]['actual'],1407)
  self.assertEqual(rows[1]['actual'],30)
  self.assertTrue(all(row['status']=='calculated' for row in rows))
  self.assertAlmostEqual(hypot(1407,30),1407.319793,places=4)

