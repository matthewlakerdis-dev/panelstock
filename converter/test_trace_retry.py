import copy,time,unittest
from unittest.mock import Mock
from cad_ai import trace_with_retry, directions_from_corners, SketchServiceError
from test_partial_folds import c501c
from panel_cad import vertices

def reading():
 p=c501c();points,_=vertices(p['edges'],'site')
 for e,(x,y) in zip(p['edges'],points):
  e['start']={'x':x/1280*1000,'y':(1018-y)/1018*1000};del e['direction']
 return p
class RetryTests(unittest.TestCase):
 def test_valid_does_not_retry(self):
  p=reading();read=Mock();self.assertIs(trace_with_retry(p,read,time.monotonic()+85),p);read.assert_not_called()
 def test_bad_order_retraced_once(self):
  good=reading();bad=copy.deepcopy(good);bad['edges'][2],bad['edges'][8]=bad['edges'][8],bad['edges'][2]
  read=Mock(return_value=good);result=trace_with_retry(bad,read,time.monotonic()+85)
  self.assertEqual([e['direction'] for e in directions_from_corners(result)['edges']],[e['direction'] for e in c501c()['edges']]);read.assert_called_once()
 def test_second_invalid_keeps_original(self):
  p=reading();p['edges'][2]['start']=p['edges'][0]['start'];read=Mock(return_value=p)
  self.assertIs(trace_with_retry(p,read,time.monotonic()+85),p);read.assert_called_once()
 def test_service_failure_keeps_original(self):
  p=reading();p['edges'][0]['start']=None
  self.assertIs(trace_with_retry(p,Mock(side_effect=SketchServiceError('unavailable')),time.monotonic()+85),p)
 def test_deadline_does_not_retry(self):
  p=reading();p['edges'][0]['start']=None;read=Mock()
  self.assertIs(trace_with_retry(p,read,time.monotonic()+5),p);read.assert_not_called()
if __name__=='__main__':unittest.main()
