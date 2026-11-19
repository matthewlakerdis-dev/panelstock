"""Offcut proposals must respect the yellow strokes actually cut by the router."""
import unittest
from pathlib import Path

import pdfplumber

from cnc_pdf import _offcuts
import test_cnc_multiple_offcuts as fixtures


def with_cuts(occupied, cuts, width=3000, height=1200, colour=(1., 1., 0.)):
    page = fixtures.page_with_rectangles(occupied, width, height)
    page.lines = [dict(x0=100 + min(x0, x1) / 10, x1=100 + max(x0, x1) / 10,
                       y0=50 + min(y0, y1) / 10, y1=50 + max(y0, y1) / 10,
                       stroke=True, object_type="line", stroking_color=colour)
                  for x0, y0, x1, y1 in cuts]
    return page


class SeparatorCutTest(unittest.TestCase):
    def assert_safe(self, proposals, occupied, cuts, width=3000, height=1200):
        fixtures.MultipleOffcutTest.assert_safe(self, proposals, occupied, width, height)
        for item in proposals:
            r = item["rectangle"]
            left, bottom, right, top = r["x"], r["y"], r["x"] + r["width"], r["y"] + r["height"]
            for x0, y0, x1, y1 in cuts:
                if y0 == y1:
                    self.assertFalse(bottom < y0 < top and max(left, min(x0, x1)) < min(right, max(x0, x1)))
                elif x0 == x1:
                    self.assertFalse(left < x0 < right and max(bottom, min(y0, y1)) < min(top, max(y0, y1)))

    def test_order42_top_strip_and_short_right_remnant(self):
        occupied, cuts = [(0, 0, 2523, 591.5)], [(2523, 591.5, 3000, 591.5)]
        proposals = _offcuts(with_cuts(occupied, cuts), 3000, 1200)
        self.assertEqual([(p["length"], p["width"]) for p in proposals], [(3000, 598), (467, 581)])
        self.assertEqual(proposals[0]["layout"]["cutLines"], [list(cuts[0])])
        self.assert_safe(proposals, occupied, cuts)

    def test_horizontal_cut_overrides_greedy_full_height_right_strip(self):
        occupied, cuts = [(0, 0, 1000, 900)], [(1000, 900, 3000, 900)]
        proposals = _offcuts(with_cuts(occupied, cuts), 3000, 1200)
        self.assertEqual([(p["length"], p["width"]) for p in proposals], [(1990, 890), (3000, 290)])
        self.assert_safe(proposals, occupied, cuts)

    def test_vertical_cut_overrides_greedy_full_width_top_strip(self):
        occupied, cuts = [(0, 0, 2500, 500)], [(2500, 500, 2500, 1200)]
        proposals = _offcuts(with_cuts(occupied, cuts), 3000, 1200)
        self.assertEqual([(p["length"], p["width"]) for p in proposals], [(2490, 690), (490, 1200)])
        self.assert_safe(proposals, occupied, cuts)

    def test_partial_interior_cut_cannot_be_spanned_even_if_space_connects_around_ends(self):
        occupied, cuts = [(0, 0, 1000, 500)], [(2000, 300, 2000, 900)]
        proposals = _offcuts(with_cuts(occupied, cuts), 3000, 1200, cut_edge_allowance=0)
        self.assert_safe(proposals, occupied, cuts)
        self.assertGreater(sum(p["length"] * p["width"] for p in proposals), 0)

    def test_duplicate_reversed_and_reordered_segments_produce_identical_results(self):
        occupied = [(0, 0, 1000, 500)]
        cuts = [(1000, 500, 2000, 500), (2000, 500, 3000, 500), (2000, 500, 2000, 1200)]
        expected = _offcuts(with_cuts(occupied, cuts), 3000, 1200)
        reverse = [tuple((c, d, a, b)) for a, b, c, d in reversed(cuts)]
        self.assertEqual(_offcuts(with_cuts(occupied, reverse + cuts), 3000, 1200), expected)
        self.assert_safe(expected, occupied, cuts)

    def test_yellow_cut_at_factory_boundary_does_not_remove_extra_material(self):
        occupied = [(0, 0, 1000, 1200)]
        expected = _offcuts(with_cuts(occupied, []), 3000, 1200)
        result = _offcuts(with_cuts(occupied, [(3000, 0, 3000, 1200)]), 3000, 1200)
        self.assertEqual([(p["length"], p["width"], p["rectangle"]) for p in result],
                         [(p["length"], p["width"], p["rectangle"]) for p in expected])

    def test_cut_leading_out_past_stock_is_clipped_and_still_divides_the_remnant(self):
        occupied = [(0, 0, 1000, 900)]
        proposals = _offcuts(with_cuts(occupied, [(1000, 900, 3200, 900)]), 3000, 1200)
        expected = _offcuts(with_cuts(occupied, [(1000, 900, 3000, 900)]), 3000, 1200)
        self.assertEqual(proposals, expected)
        self.assertEqual(_offcuts(with_cuts(occupied, [(1000, 1400, 3200, 1400)]), 3000, 1200),
                         _offcuts(with_cuts(occupied, []), 3000, 1200))

    def test_portrait_cuts_follow_parent_stock_axes(self):
        # Transpose the landscape regression, including its separator.
        proposals = _offcuts(with_cuts([(0, 0, 900, 1000)], [(900, 1000, 900, 3000)], 1200, 3000), 3000, 1200)
        self.assertEqual([(p["length"], p["width"]) for p in proposals], [(1990, 890), (3000, 290)])
        self.assert_safe(proposals, [(0, 0, 1000, 900)], [(1000, 900, 3000, 900)])

    def test_cmyk_yellow_and_rgb_yellow_mean_the_same_cut(self):
        args = ([(0, 0, 1000, 900)], [(1000, 900, 3000, 900)])
        self.assertEqual(_offcuts(with_cuts(*args), 3000, 1200),
                         _offcuts(with_cuts(*args, colour=(0., 0., 1., 0.)), 3000, 1200))

    def test_unstroked_yellow_fill_is_not_a_cut(self):
        page = with_cuts([(0, 0, 1000, 900)], [(1000, 900, 3000, 900)])
        page.lines[0]["stroke"] = False
        self.assertEqual(_offcuts(page, 3000, 1200), _offcuts(with_cuts([(0, 0, 1000, 900)], []), 3000, 1200))

    def test_real_pdf_yellow_polyline_is_parsed_as_segments_not_a_filled_envelope(self):
        fixture = Path(__file__).parent / "fixtures" / "cnc-yellow-separator.pdf"
        with pdfplumber.open(fixture) as pdf:
            proposals = _offcuts(pdf.pages[0], 3000, 1200)
        self.assertEqual(len(proposals), 3)
        self.assertEqual(sorted((p["length"], p["width"]) for p in proposals),
                         [(980, 490), (990, 1200), (1990, 690)])
        self.assert_safe(proposals, [(0, 0, 1000, 500)], [(1000, 500, 2000, 500), (2000, 500, 2000, 1200)])


if __name__ == "__main__":
    unittest.main()
