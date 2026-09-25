import copy,unittest
from unittest.mock import Mock
from test_trace_retry import reading
from cad_ai import read_in_stages,normalise_fold_sections
from panel_cad import CadError,finish_extracted_spec
class StagedReading(unittest.TestCase):
 def test_c501c_dimensions_stay_on_traced_edges(self):
  measured=reading();measured['foldSectionsTop']=[150,868];measured['folds']=[]
  outline=copy.deepcopy(measured)
  for e in outline['edges']:e['site']=None
  outline['foldSectionsTop']=[]
  read=Mock(side_effect=[outline,measured]);p=read_in_stages(read)
  self.assertEqual(read.call_count,2)
  p=normalise_fold_sections(p);p['siteFolds']=p['folds'];p=finish_extracted_spec(p)
  self.assertEqual(len(p['edges']),12);self.assertEqual(p['folds'],[866]);self.assertEqual(p['edges'][6]['finished'],55)
 def test_manual_outline_skips_topology_call(self):
  p=reading();read=Mock(return_value=p);result=read_in_stages(read,p)
  self.assertEqual(read.call_count,1);self.assertEqual(result['edges'][6]['site'],55)
 def test_manual_outline_cannot_be_replaced(self):
  p=reading();bad=copy.deepcopy(p);bad['edges'][4]['start']['x']+=10
  with self.assertRaises(CadError):read_in_stages(Mock(return_value=bad),p)
 def test_extra_annotation_edge_rejected(self):
  p=reading();bad=copy.deepcopy(p);bad['edges'].append(copy.deepcopy(bad['edges'][0]))
  with self.assertRaises(CadError):read_in_stages(Mock(side_effect=[p,bad]))
 def test_changed_opening_rejected(self):
  p=reading();bad=copy.deepcopy(p);bad['edges'][4]['start']['y']+=1
  with self.assertRaises(CadError):read_in_stages(Mock(side_effect=[p,bad]))
 def test_invalid_trace_never_reads_dimensions(self):
  p=reading();p['edges'][0]['start']=None;read=Mock(return_value=p)
  with self.assertRaises(CadError):read_in_stages(read)
  self.assertEqual(read.call_count,1)
 def test_ambiguous_outline_stays_blocked(self):
  p=reading();p['unsupported']=True;read=Mock(return_value=p)
  self.assertTrue(read_in_stages(read)['unsupported']);self.assertEqual(read.call_count,1)
if __name__=='__main__':unittest.main()
