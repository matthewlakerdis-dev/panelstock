import copy
import math
import unittest
from outline_geometry import finish_regions, measurement_audit


class OffsetAuditTests(unittest.TestCase):
    def test_sloping_tagged_edge_uses_offset_geometry_and_detects_corruption(self):
        vectors=[(1000,0),(0,400),(-1000,100),(0,-500)]
        spec={'measuredEdges':[dict(dx=x,dy=y,code='ES') for x,y in vectors],
              'outlineSections':[{'site':math.hypot(x,y),'manualMeasurements':{'site':math.hypot(x,y)}} for x,y in vectors]}
        geometry=finish_regions(spec)
        rows=measurement_audit(geometry)
        self.assertTrue(all(r['status']=='pass' for r in rows))
        slope=next(r for r in rows if 'slope' in r['label'])
        self.assertGreater(abs(slope['deduction']-2),.001)
        corrupted=copy.deepcopy(geometry)
        segment=next(s for s in corrupted['finishedOuterSegments'] if s['edge']==2)
        segment['end']=(segment['end'][0]+1,segment['end'][1])
        self.assertEqual(next(r for r in measurement_audit(corrupted) if 'slope' in r['label'])['status'],'mismatch')


if __name__=='__main__':unittest.main()
