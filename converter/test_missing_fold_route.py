import io,json,unittest
from pathlib import Path
import ezdxf
from shapely.geometry import LineString
from shapely.ops import unary_union
from panel_cad import generate

class MissingFoldRoute(unittest.TestCase):
 def test_notch_fold_from_supplied_draft_survives_relief_adjustments(self):
  spec=json.loads((Path(__file__).parent/'fixtures/z2-21-missing-route.json').read_text())
  spec['reviewed']=True
  # Run the exact supplied draft; its notch fold used to collapse to one point.
  result=generate(spec)
  folds=result['geometry']['finishedFoldLines']
  self.assertEqual(len(folds),4)
  routes=unary_union([LineString(e.get_points('xy')) for e in ezdxf.read(io.StringIO(result['dxf'])).modelspace().query('LWPOLYLINE') if e.dxf.layer=='ROUTE'])
  for fold in folds:
   line=LineString(fold)
   self.assertGreater(line.length,1300)
   self.assertTrue(routes.buffer(.001).covers(line))
  self.assertTrue(routes.buffer(.001).covers(LineString([(1,2346),(1354,2346)])))

