import unittest
from cad_ai import mirror_rectangle_dimensions
from panel_cad import finish_extracted_spec, CadError

def rectangle():
    return dict(panelId='Z2-121',unsupported=False,questions=[],folds=[100],edges=[
        dict(direction=d,code=c,site=s,finished=None) for d,c,s in zip(
            ['right','up','left','down'],['S','B','S','B'],[None,850,1500,None])])

class MirrorDimensions(unittest.TestCase):
    def test_rectangle_and_fold(self):
        original=rectangle()
        result=finish_extracted_spec(mirror_rectangle_dimensions(original))
        self.assertEqual([e['site'] for e in result['edges']],[1500,850,1500,850])
        self.assertEqual([e['finished'] for e in result['edges']],[1498,846,1498,846])
        self.assertEqual(result['folds'],[98])
        self.assertEqual(len(result['questions']),2)
        self.assertIsNone(original['edges'][0]['site'])

    def test_written_conflict_not_overwritten(self):
        spec=rectangle();spec['edges'][0]['site']=1400
        with self.assertRaises(CadError):finish_extracted_spec(mirror_rectangle_dimensions(spec))

    def test_missing_both_remains_missing(self):
        spec=rectangle();spec['edges'][2]['site']=None
        self.assertIsNone(mirror_rectangle_dimensions(spec)['edges'][0]['site'])

    def test_uncertain_and_irregular_not_assumed(self):
        spec=rectangle();spec['unsupported']=True
        self.assertIsNone(mirror_rectangle_dimensions(spec)['edges'][0]['site'])
        spec=rectangle();spec['edges'].extend(spec['edges'][0:2])
        self.assertIsNone(mirror_rectangle_dimensions(spec)['edges'][0]['site'])

if __name__=='__main__':unittest.main()


