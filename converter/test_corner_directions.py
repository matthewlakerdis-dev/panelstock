import unittest,copy
from cad_ai import directions_from_corners,SCHEMA
from panel_cad import CadError,finish_extracted_spec
from test_auto_dimensions import fixture

def reading():
    spec=fixture()
    # Visual proportions are deliberately different from site dimensions.
    for edge,(x,y) in zip(spec['edges'],[(100,900),(900,900),(900,550),(630,550),(630,100),(370,100),(370,550),(100,550)]):
        edge['start']={'x':x,'y':y}
    spec['edges'][4]['direction']='right'
    return spec

class CornerDirectionTests(unittest.TestCase):
    def test_wrong_top_label_is_replaced_from_corners(self):
        source=reading();result=finish_extracted_spec(directions_from_corners(source))
        self.assertEqual([e['direction'] for e in result['edges']],['right','up','left','up','left','down','left','down'])
        self.assertEqual([e['finished'] for e in result['edges']],[698,298,150,200,398,200,150,298])
        self.assertEqual([e['site'] for e in result['edges']],[e['site'] for e in source['edges']])
        self.assertEqual(source['edges'][4]['direction'],'right')

    def test_schema_requests_corners_not_directions(self):
        properties=SCHEMA['properties']['edges']['items']['properties']
        self.assertIn('start',properties);self.assertNotIn('direction',properties)

    def test_bad_corner_data_rejected(self):
        for invalid in [None,{'x':True,'y':0},{'x':-1,'y':0},{'x':float('nan'),'y':0}]:
            spec=reading();spec['edges'][0]['start']=invalid
            with self.subTest(invalid=invalid),self.assertRaises(CadError):directions_from_corners(spec)

    def test_crossing_outline_rejected(self):
        spec=reading();spec['edges'][2]['start'],spec['edges'][6]['start']=spec['edges'][6]['start'],spec['edges'][2]['start']
        with self.assertRaises(CadError):directions_from_corners(spec)

    def test_diagonal_is_not_forced_orthogonal(self):
        spec=reading();spec['edges'][1]['start']['y']=650
        with self.assertRaises(CadError):directions_from_corners(spec)

    def test_incorrect_written_length_still_blocked(self):
        spec=reading();spec['edges'][4]['site']=450
        with self.assertRaisesRegex(CadError,'do not close'):finish_extracted_spec(directions_from_corners(spec))

if __name__=='__main__':unittest.main()

