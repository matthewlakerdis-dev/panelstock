"""Multiple usable PDF leftovers must never overlap panels or one another."""
import types
import unittest
from unittest.mock import patch

from cnc_pdf import _offcuts, analyse_cnc_pdf


def page_with_rectangles(rectangles, sheet_width=4000, sheet_height=2000):
    sheet = dict(x0=100, x1=100 + sheet_width / 10, y0=50, y1=50 + sheet_height / 10,
                 width=sheet_width / 10, height=sheet_height / 10, stroke=True)
    shapes = [dict(x0=100 + x0 / 10, x1=100 + x1 / 10, y0=50 + y0 / 10, y1=50 + y1 / 10,
                   stroking_color=(1.0, 0.0, 0.0)) for x0, y0, x1, y1 in rectangles]
    return types.SimpleNamespace(width=600, height=600, rects=[sheet], curves=shapes, lines=[])


def overlaps(a, b):
    return (min(a["x"] + a["width"], b["x"] + b["width"]) > max(a["x"], b["x"]) + .00001
            and min(a["y"] + a["height"], b["y"] + b["height"]) > max(a["y"], b["y"]) + .00001)


class MultipleOffcutTest(unittest.TestCase):
    def assert_safe(self, proposals, occupied, sheet_width=4000, sheet_height=2000):
        for index, proposal in enumerate(proposals):
            rectangle = proposal["rectangle"]
            self.assertGreater(rectangle["width"], 0)
            self.assertGreater(rectangle["height"], 0)
            self.assertGreaterEqual(rectangle["x"], 0)
            self.assertGreaterEqual(rectangle["y"], 0)
            self.assertLessEqual(rectangle["x"] + rectangle["width"], sheet_width + .00001)
            self.assertLessEqual(rectangle["y"] + rectangle["height"], sheet_height + .00001)
            self.assertEqual(proposal["length"], max(rectangle["width"], rectangle["height"]))
            self.assertEqual(proposal["width"], min(rectangle["width"], rectangle["height"]))
            self.assertIsInstance(proposal["length"], int)
            self.assertIsInstance(proposal["width"], int)
            for previous in proposals[:index]:
                self.assertFalse(overlaps(rectangle, previous["rectangle"]))
            for x0, y0, x1, y1 in occupied:
                self.assertFalse(overlaps(rectangle, dict(x=x0, y=y0, width=x1-x0, height=y1-y0)))

    def test_four_exterior_leftovers_are_disjoint_and_trim_every_cut_edge(self):
        occupied = [(1000, 500, 3000, 1500)]
        proposals = _offcuts(page_with_rectangles(occupied), 4000, 2000)
        self.assertEqual(len(proposals), 4)
        self.assert_safe(proposals, occupied)
        self.assertEqual([(p["length"], p["width"]) for p in proposals],
                         [(2000, 990), (2000, 990), (1980, 490), (1980, 490)])
        self.assertEqual([len(p["cutEdges"]) for p in proposals], [1, 1, 3, 3])
        self.assertEqual(sum(p["length"] * p["width"] for p in proposals), 5900400)

    def test_fractional_usable_dimensions_round_down_to_whole_millimetres(self):
        for used_length in [2510.029, 2511]:
            occupied = [(0, 0, used_length, 1200)]
            proposals = _offcuts(page_with_rectangles(occupied, 3000, 1200), 3000, 1200)
            self.assertEqual(len(proposals), 1)
            self.assertEqual((proposals[0]['length'], proposals[0]['width']), (1200, 479))
            self.assertEqual(proposals[0]['rectangle']['width'], 479)
            self.assertEqual(proposals[0]['rectangle']['height'], 1200)
            self.assert_safe(proposals, occupied, 3000, 1200)

    def test_minimum_usable_size_applies_after_rounding_down(self):
        page = page_with_rectangles([(0, 0, 2510.029, 1200)], 3000, 1200)
        self.assertEqual(_offcuts(page, 3000, 1200, minimum_offcut_size=479.5), [])
        self.assertEqual(len(_offcuts(page, 3000, 1200, minimum_offcut_size=479)), 1)

    def test_gap_between_separate_panel_groups_is_detected(self):
        occupied = [(0, 0, 1000, 2000), (3000, 0, 4000, 2000)]
        proposals = _offcuts(page_with_rectangles(occupied), 4000, 2000)
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["rectangle"], {"x": 1010, "y": 0, "width": 1980, "height": 2000})
        self.assertEqual(proposals[0]["cutEdges"], ["left", "right"])
        self.assert_safe(proposals, occupied)

    def test_line_outline_and_internal_holes_are_occupied_not_leftovers(self):
        occupied = [(1000, 500, 3000, 1500)]
        page = page_with_rectangles([])
        # Four separate coloured lines join into the complete panel envelope.
        page.lines = page_with_rectangles([(1000, 500, 3000, 500), (3000, 500, 3000, 1500),
                                           (1000, 1500, 3000, 1500), (1000, 500, 1000, 1500)]).curves
        page.curves = page_with_rectangles([(1950, 950, 2050, 1050)]).curves
        proposals = _offcuts(page, 4000, 2000)
        self.assertEqual(len(proposals), 4)
        self.assert_safe(proposals, occupied)

    def test_annotations_outside_sheet_do_not_reduce_usable_offcuts(self):
        page = page_with_rectangles([(0, 0, 3000, 2000)])
        expected = _offcuts(page, 4000, 2000)
        page.lines = [dict(x0=0, x1=90, y0=0, y1=600, stroking_color=(1., 0., 0.))]
        self.assertEqual(_offcuts(page, 4000, 2000), expected)

    def test_pdf_rounding_gaps_at_outline_corners_do_not_expose_panel_interiors(self):
        occupied = [(1000, 500, 3000, 1500)]
        page = page_with_rectangles([])
        page.lines = page_with_rectangles([(1000.1, 500, 2999.9, 500), (3000, 500.1, 3000, 1499.9),
                                           (1000.1, 1500, 2999.9, 1500), (1000, 500.1, 1000, 1499.9)]).curves
        page.curves = page_with_rectangles([(1950, 950, 2050, 1050)]).curves
        proposals = _offcuts(page, 4000, 2000)
        self.assertEqual(len(proposals), 4)
        self.assert_safe(proposals, occupied)

    def test_portrait_geometry_is_normalized_to_parent_landscape_axes(self):
        page = page_with_rectangles([(0, 0, 1270, 2500)], 1270, 4000)
        proposals = _offcuts(page, 1270, 4000)
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["rectangle"], {"x": 2510, "y": 0, "width": 1490, "height": 1270})
        self.assertEqual(proposals[0]["layout"], {"anchor": "bottom-left", "usedLength": 2500, "usedWidth": 1270})
        self.assert_safe(proposals, [(0, 0, 2500, 1270)], 4000, 1270)

    def test_layout_extents_round_up_for_safe_stock_replacement(self):
        occupied = [(0, 0, 1050.25, 1500.125)]
        proposals = _offcuts(page_with_rectangles(occupied), 4000, 2000)
        self.assertTrue(proposals)
        for offcut in proposals:
            self.assertEqual(offcut['layout']['usedLength'], 1051)
            self.assertEqual(offcut['layout']['usedWidth'], 1501)
            self.assertGreaterEqual(offcut['layout']['usedLength'], occupied[0][2])
            self.assertGreaterEqual(offcut['layout']['usedWidth'], occupied[0][3])

    def test_allowance_and_minimum_apply_to_each_piece(self):
        page = page_with_rectangles([(1000, 500, 3000, 1500)])
        proposals = _offcuts(page, 4000, 2000, cut_edge_allowance=25, minimum_offcut_size=500)
        self.assertEqual(len(proposals), 2)
        self.assertTrue(all(p["width"] == 975 for p in proposals))
        self.assert_safe(proposals, [(1000, 500, 3000, 1500)])

    def test_proposals_are_bounded_and_sorted_without_overlaps(self):
        occupied = [(index * 100, 0, index * 100 + 50, 2000) for index in range(26)]
        proposals = _offcuts(page_with_rectangles(occupied), 4000, 2000)
        self.assertEqual(len(proposals), 20)
        areas = [p["length"] * p["width"] for p in proposals]
        self.assertEqual(areas, sorted(areas, reverse=True))
        self.assert_safe(proposals, occupied)

    def test_missing_or_zero_area_machining_does_not_create_stock(self):
        page = page_with_rectangles([])
        self.assertEqual(_offcuts(page, 4000, 2000), [])
        page.lines = page_with_rectangles([(1000, 0, 1000, 2000)]).curves
        self.assertEqual(_offcuts(page, 4000, 2000), [])

    def test_dense_layout_uses_bounded_conservative_exterior_fallback(self):
        occupied = [(10 + index * 19, 10 + index * 9, 15 + index * 19, 15 + index * 9) for index in range(200)]
        proposals = _offcuts(page_with_rectangles(occupied), 4000, 2000)
        self.assertGreater(len(proposals), 0)
        self.assertLessEqual(len(proposals), 4)
        self.assert_safe(proposals, occupied)

    def test_pdf_response_exposes_all_proposals_and_first_legacy_alias(self):
        page = page_with_rectangles([(1000, 500, 3000, 1500)])
        page.extract_text = lambda **_: "PANEL m2 2 SHEET m2 8 WASTE 75%"
        page.extract_words = lambda **_: []
        class Document:
            pages = [page]
            def __enter__(self): return self
            def __exit__(self, *_): return False
        values = {"PROJECT:": "Example", "MATERIAL:": "Aluminium", "FINISH:": "Milled",
                  "SIZE:": "4000x2000", "QTY:": "1"}
        with patch("cnc_pdf.pdfplumber.open", return_value=Document()), \
             patch("cnc_pdf._row_value", side_effect=lambda words, label, *args: values.get(label, "")), \
             patch("cnc_pdf._order_value", return_value="7"), \
             patch("cnc_pdf._ocr_panel_ids", return_value=(["A1"], "")):
            result = analyse_cnc_pdf(b"synthetic-test")
        self.assertEqual(len(result["pages"][0]["proposedOffcuts"]), 4)
        self.assertEqual(result["pages"][0]["proposedOffcut"], result["pages"][0]["proposedOffcuts"][0])


if __name__ == "__main__":
    unittest.main()
