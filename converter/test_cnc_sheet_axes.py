"""Keep offcut axes stable when title-block size and drawing rotate separately."""
import unittest
from unittest.mock import patch

from cnc_pdf import _offcuts, analyse_cnc_pdf
from test_cnc_multiple_offcuts import page_with_rectangles


class SheetAxesTest(unittest.TestCase):
    def test_short_end_remnant_keeps_its_parent_length_and_width(self):
        page = page_with_rectangles([(0, 0, 2510, 1200)], 3000, 1200)
        proposal, = _offcuts(page, 3000, 1200)
        self.assertEqual((proposal["length"], proposal["width"]), (480, 1200))
        self.assertEqual(proposal["rectangle"], {"x": 2520, "y": 0, "width": 480, "height": 1200})

    def test_rotated_drawing_or_header_preserves_parent_axes(self):
        expected = _offcuts(page_with_rectangles([(0, 0, 2500, 1200)], 3000, 1200), 3000, 1200)
        self.assertEqual(len(expected), 1)
        self.assertEqual((expected[0]["length"], expected[0]["width"]), (490, 1200))
        self.assertEqual(expected[0]["rectangle"], {"x": 2510, "y": 0, "width": 490, "height": 1200})
        self.assertEqual(expected[0]["layout"], {"anchor": "bottom-left", "usedLength": 2500, "usedWidth": 1200})
        for drawn, occupied, header in [
            ((1200, 3000), (0, 0, 1200, 2500), (1200, 3000)),
            ((1200, 3000), (0, 0, 1200, 2500), (3000, 1200)),
            ((3000, 1200), (0, 0, 2500, 1200), (1200, 3000)),
        ]:
            with self.subTest(drawn=drawn, header=header):
                page = page_with_rectangles([occupied], *drawn)
                self.assertEqual(_offcuts(page, *header), expected)

    def test_incompatible_outline_does_not_generate_distorted_stock(self):
        page = page_with_rectangles([(0, 0, 2000, 1200)], 2500, 1200)
        self.assertEqual(_offcuts(page, 3000, 1200), [])

    def test_minor_pdf_outline_rounding_is_accepted(self):
        page = page_with_rectangles([(0, 0, 2500, 1200)], 3000, 1200)
        page.rects[0]["width"] += .001
        page.rects[0]["x1"] += .001
        proposals = _offcuts(page, 3000, 1200)
        self.assertEqual(len(proposals), 1)
        self.assertEqual((proposals[0]["length"], proposals[0]["width"]), (490, 1200))

    def test_analyser_warns_when_outline_and_printed_size_disagree(self):
        page = page_with_rectangles([(0, 0, 2000, 1200)], 2500, 1200)
        page.extract_text = lambda **_: "PANEL m2 3 SHEET m2 3.6 WASTE 16.67%"
        page.extract_words = lambda **_: []

        class Document:
            pages = [page]
            def __enter__(self): return self
            def __exit__(self, *_): return False

        values = {"PROJECT:": "Example", "MATERIAL:": "Aluminium", "FINISH:": "Milled",
                  "SIZE:": "3000x1200", "QTY:": "1"}
        with patch("cnc_pdf.pdfplumber.open", return_value=Document()), \
             patch("cnc_pdf._row_value", side_effect=lambda words, label, *args: values.get(label, "")), \
             patch("cnc_pdf._order_value", return_value="7"), \
             patch("cnc_pdf._ocr_panel_ids", return_value=(["A1"], "")):
            row = analyse_cnc_pdf(b"pdf")["pages"][0]
        self.assertEqual((row["sheetWidth"], row["sheetHeight"]), (3000, 1200))
        self.assertEqual(row["proposedOffcuts"], [])
        self.assertIsNone(row["proposedOffcut"])
        self.assertIn("Drawn sheet proportions do not match the printed sheet size; off-cut detection skipped", row["warnings"])


if __name__ == "__main__":
    unittest.main()
