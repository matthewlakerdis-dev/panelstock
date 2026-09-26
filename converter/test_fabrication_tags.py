import unittest
from shapely.geometry import box
from panel_cad import fabrication_tags
class FabricationTags(unittest.TestCase):
 def test_both_types_use_hole_rims_plus_five_each_end(self):
  for code in ['B','S']:
   tags=fabrication_tags([{'start':(0,0),'end':(200,0),'edge':0,'code':code}],[(30,-12),(100,-12),(170,-12)],box(-20,-20,220,100),[])
   self.assertEqual(len(tags),1);self.assertEqual(tags[0]['length'],153);self.assertEqual(tags[0]['type'],code)
 def test_no_tags_without_two_holes_or_for_other_types(self):
  for code,holes in [('B',[]),('S',[(30,-12)]),('RE',[(30,-12),(170,-12)])]:
   self.assertEqual(fabrication_tags([{'start':(0,0),'end':(200,0),'edge':0,'code':code}],holes,box(-20,-20,220,100),[]),[])
 def test_fold_separates_pieces(self):
  tags=fabrication_tags([{'start':(0,0),'end':(400,0),'edge':0,'code':'B'}],[(30,-12),(170,-12),(230,-12),(370,-12)],box(-20,-20,420,100),[[(200,-20),(200,100)]])
  self.assertEqual(len(tags),2);self.assertEqual([t['length'] for t in tags],[153,153])

