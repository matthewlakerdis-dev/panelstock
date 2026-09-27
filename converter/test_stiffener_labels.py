import unittest
from panel_cad import stiffener_label


class StiffenerLabelTests(unittest.TestCase):
    def test_nearest_whole_millimetre(self):
        for placement, length, expected in [
            (639.2, 1193.8, '639 · 1194'),
            (638.5, 1192.5, '639 · 1193'),
            (639, 1193, '639 · 1193'),
        ]:
            plan = {'placement': placement, 'length': length}
            self.assertEqual(stiffener_label(plan), expected + r'\PSTIFFENER')
            self.assertEqual(plan, {'placement': placement, 'length': length})

