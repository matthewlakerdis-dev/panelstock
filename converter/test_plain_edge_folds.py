import io, unittest
import ezdxf
from panel_cad import finish_extracted_spec, generate

class PlainEdgeFolds(unittest.TestCase):
 def test_plain_rectangle_horizontal_and_vertical_folds(self):
  for vertical in [False, True]:
   spec={'panelId':'PLAIN-FOLDS','panelDirection':'right','edges':[dict(direction=d,code='FE',site=n) for d,n in zip(['right','up','left','down'],[2500,595,2500,595])], 'siteFolds':[20,45]}
   if vertical:
    spec['siteFolds']=[]
    spec['foldLines']=[{'start':{'x':x,'y':0},'end':{'x':x,'y':595}} for x in [20,45]]
   finished=finish_extracted_spec(spec);finished['reviewed']=True
   self.assertEqual([e['finished'] for e in finished['edges']], [2496,595,2496,595] if vertical else [2500,591,2500,591])
   self.assertEqual(finished['verticalFolds'] if vertical else finished['folds'],[19,42])
   result=generate(finished);doc=ezdxf.read(io.StringIO(result['dxf']))
   self.assertFalse(doc.audit().errors)
   routes=[list(e.get_points('xy')) for e in doc.modelspace().query('LWPOLYLINE[layer=="ROUTE"]')]
   for level in [19,42]:
    self.assertTrue(any(all(abs(p[0 if vertical else 1]-level)<.001 for p in line) for line in routes))
   self.assertEqual(result['validation']['holes'],0)
