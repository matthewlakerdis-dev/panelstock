"""Regression coverage for the Notre Dame portrait offcut drawings."""
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch
from cnc_pdf import analyse_cnc_pdf


class PrototypePdfTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = (Path(__file__).parent / 'fixtures/cnc-prototypes.pdf').read_bytes()
        cls.pages = analyse_cnc_pdf(cls.payload)['pages']

    def test_wrapped_text_order_and_stock(self):
        for row in self.pages:
            self.assertEqual(row['orderNumber'], 'PROTOTYPES')
            self.assertEqual(row['stockType'], 'offcut')
            self.assertEqual(row['quantity'], 1)

    @unittest.skipUnless(shutil.which('tesseract'), 'Tesseract is required for vector label OCR')
    def test_vector_panel_labels(self):
        self.assertEqual([p['panelIds'] for p in self.pages], [['C3-1'], ['C3-2']])
        self.assertTrue(all(any('OCR' in w for w in p['warnings']) for p in self.pages))

    def test_invalid_areas_are_preserved_but_not_used(self):
        self.assertEqual([p['sheetArea'] for p in self.pages], [1.512, 2.22075])
        self.assertEqual([p['printedPanelArea'] for p in self.pages], [3.27, 0])
        self.assertTrue(all(p['panelArea'] is None for p in self.pages))
        self.assertTrue(all(any('Printed waste' in w for w in p['warnings']) for p in self.pages))

    def test_portrait_geometry_uses_drawn_axes(self):
        self.assertEqual([(p['proposedOffcut']['length'], p['proposedOffcut']['width']) for p in self.pages], [(960, 114.833), (1410, 114.833)])
        # The PDF's long vertical dimension becomes the canonical sheet x axis.
        # Occupied extents round up; usable offcut dimensions round inward.
        self.assertEqual([p['proposedOffcut']['layout']['usedLength'] for p in self.pages], [1451, 1451])
        for page in self.pages:
            first = page['proposedOffcut']
            self.assertEqual(first, page['proposedOffcuts'][0])
            self.assertEqual(first['cutEdges'], ['left'])
            self.assertEqual(first['rectangle'], {'x': 1460.167, 'y': 0, 'width': 114.833, 'height': page['sheetHeight']})
            for index, offcut in enumerate(page['proposedOffcuts']):
                rect = offcut['rectangle']
                self.assertGreaterEqual(rect['x'], 0)
                self.assertGreaterEqual(rect['y'], 0)
                self.assertLessEqual(rect['x'] + rect['width'], page['sheetWidth'])
                self.assertLessEqual(rect['y'] + rect['height'], page['sheetHeight'])
                for previous in page['proposedOffcuts'][:index]:
                    other = previous['rectangle']
                    overlap_x = min(rect['x'] + rect['width'], other['x'] + other['width']) - max(rect['x'], other['x'])
                    overlap_y = min(rect['y'] + rect['height'], other['y'] + other['height']) - max(rect['y'], other['y'])
                    self.assertTrue(overlap_x <= 0 or overlap_y <= 0)

    def test_missing_ocr_is_explicit(self):
        with patch('cnc_pdf.shutil.which', return_value=None):
            pages = analyse_cnc_pdf(self.payload)['pages']
        self.assertTrue(all(not p['panelIds'] for p in pages))
        self.assertTrue(all(any('unavailable' in w for w in p['warnings']) for p in pages))

