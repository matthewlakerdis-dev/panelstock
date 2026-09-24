import unittest
from panel_cad import finish_extracted_spec

class FoldSources(unittest.TestCase):
    def test_repeated_calculation_preserves_site_heights(self):
        spec=dict(folds=[100],edges=[dict(direction=d,code='B',site=s) for d,s in zip(['right','up','left','down'],[1500,850,1500,850])])
        for _ in range(5):
            spec=finish_extracted_spec(spec)
            self.assertEqual(spec['siteFolds'],[100])
            self.assertEqual(spec['folds'],[98])
            self.assertEqual([e['finished'] for e in spec['edges']],[1498,846,1498,846])
        spec['siteFolds']=[]
        spec=finish_extracted_spec(spec)
        self.assertEqual(spec['folds'],[])
        self.assertEqual(spec['edges'][1]['finished'],848)

