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
        self.assertEqual([(p['proposedOffcut']['length'], p['proposedOffcut']['width']) for p in self.pages], [(960, 115), (1410, 115)])
        self.assertEqual([p['proposedOffcut']['layout']['usedWidth'] for p in self.pages], [1450, 1450])

    def test_missing_ocr_is_explicit(self):
        with patch('cnc_pdf.shutil.which', return_value=None):
            pages = analyse_cnc_pdf(self.payload)['pages']
        self.assertTrue(all(not p['panelIds'] for p in pages))
        self.assertTrue(all(any('unavailable' in w for w in p['warnings']) for p in pages))
