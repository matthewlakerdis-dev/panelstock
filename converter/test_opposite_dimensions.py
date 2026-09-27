import unittest
from panel_cad import unique_opposite_dimensions
class OppositeDimensions(unittest.TestCase):
 def test_same_span_opposite_sides_keeps_one_even_with_different_codes(self):
  a=((0,0),(0,263),(-65,130),90,'B');b=((800,263),(800,0),(865,130),90,'RE')
  self.assertEqual(unique_opposite_dimensions([a,b]),[a])
 def test_different_lengths_or_different_spans_remain(self):
  a=((0,0),(0,263),(-65,130),90,'B')
  for b in [((800,0),(800,263.01),(865,130),90,'RE'),((800,263),(800,526),(865,390),90,'B')]:
   self.assertEqual(len(unique_opposite_dimensions([a,b])),2)
 def test_same_side_and_different_explicit_values_remain(self):
  a=((0,0),(0,263),(-65,130),90,'B',263)
  b=((800,0),(800,263),(865,130),90,'RE',264)
  self.assertEqual(len(unique_opposite_dimensions([a,b])),2)
