import unittest
from panel_cad import stiffener_label


class StiffenerLabelTests(unittest.TestCase):
    def test_nearest_whole_millimetre(self):
        for placement, length, expected in [
            (639.2, 1193.8, '639 mm · 1194 mm'),
            (638.5, 1192.5, '639 mm · 1193 mm'),
            (639, 1193, '639 mm · 1193 mm'),
        ]:
            plan = {'placement': placement, 'length': length}
            self.assertEqual(stiffener_label(plan), expected + r'\PSTIFFENER')
            self.assertEqual(plan, {'placement': placement, 'length': length})
