"""Exercise the real off-cut calculation with synthetic PDF geometry only."""
import types
import unittest

from cnc_pdf import _offcut


def page_with_strip(edge, gap_mm=500):
    # The drawing is 400 x 200 points for a 4000 x 2000 mm sheet.
    sheet = dict(x0=100, x1=500, y0=50, y1=250, width=400, height=200, stroke=True)
    used = dict(x0=100, x1=500, y0=50, y1=250, stroking_color=(1.0, 0.0, 0.0))
    coordinate, direction = {
        "left": ("x0", 1), "right": ("x1", -1),
        "bottom": ("y0", 1), "top": ("y1", -1),
    }[edge]
    used[coordinate] += direction * gap_mm / 10
    return types.SimpleNamespace(width=600, height=300, rects=[sheet], curves=[], lines=[used])


class OffcutAllowanceTest(unittest.TestCase):
    def assert_strip(self, edge):
        result = _offcut(page_with_strip(edge), 4000, 2000)
        # Only the newly cut edge loses 10 mm; the factory dimension is unchanged.
        self.assertEqual(result, {
            "length": 2000 if edge in ("left", "right") else 4000,
            "width": 490,
            "edge": edge,
            "cutEdgeAllowance": 10,
            "minimumOffcutSize": 1,
            "layout": {
                "anchor": "bottom-left",
                "usedLength": 4000 if edge in ("left", "bottom", "top") else 3500,
                "usedWidth": 2000 if edge in ("left", "right", "bottom") else 1500,
            },
            "confidence": "high",
        })

    def test_left_cut_edge_uses_ten_mm(self):
        self.assert_strip("left")

    def test_right_cut_edge_uses_ten_mm(self):
        self.assert_strip("right")

    def test_bottom_cut_edge_uses_ten_mm(self):
        self.assert_strip("bottom")

    def test_top_cut_edge_uses_ten_mm(self):
        self.assert_strip("top")

    def test_strips_no_larger_than_allowance_are_not_suggested(self):
        for edge in ("left", "right", "bottom", "top"):
            for gap in (0, 5, 9, 10):
                with self.subTest(edge=edge, gap=gap):
                    self.assertIsNone(_offcut(page_with_strip(edge, gap), 4000, 2000))

    def test_small_positive_remainder_is_not_subtracted_twice(self):
        for edge in ("left", "right", "bottom", "top"):
            with self.subTest(edge=edge):
                result = _offcut(page_with_strip(edge, 11), 4000, 2000)
                self.assertEqual(result["width"], 1)
                self.assertEqual(result["cutEdgeAllowance"], 10)

    def test_configured_allowance_and_minimum_size_are_applied(self):
        result = _offcut(page_with_strip("left", 500), 4000, 2000, cut_edge_allowance=25, minimum_offcut_size=400)
        self.assertEqual(result["width"], 475)
        self.assertEqual(result["cutEdgeAllowance"], 25)
        self.assertIsNone(_offcut(page_with_strip("left", 500), 4000, 2000, cut_edge_allowance=25, minimum_offcut_size=500))

    def test_missing_cut_geometry_still_has_no_suggestion(self):
        page = page_with_strip("left")
        page.lines = []
        self.assertIsNone(_offcut(page, 4000, 2000))


if __name__ == "__main__":
    unittest.main()
