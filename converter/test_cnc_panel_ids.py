"""CNC scheduling must retain fabrication identifiers and CAD label orientation."""
import unittest
from cnc_pdf import analyse_cnc_pdf, _panel_id


def drawing():
    commands = []
    def text(x, y, angle, label):
        matrix = {0: (1, 0, 0, 1), 90: (0, 1, -1, 0), -90: (0, -1, 1, 0)}[angle]
        commands.append('BT /F1 10 Tf %s %s %s %s %s %s Tm (%s) Tj ET' % (*matrix, x, y, label))
    for x, y, label in [(60, 550, 'PROJECT:      Notre Dame'), (60, 525, 'MATERIAL:      Solid Aluminium 3 mm'),
                       (60, 500, 'FINISH:      Milled'), (60, 475, 'SHEET SIZE:      3000X1200'),
                       (610, 550, 'SHEET # 1'), (610, 525, 'QTY: 1'), (610, 500, 'ORDER #      21')]:
        # Header is upright.
        commands.append("BT /F1 10 Tf 1 0 0 1 %s %s Tm (%s) Tj ET" % (x, y, label))
    commands.append('50 100 740 340 re S')
    for x, y, angle, label in [(100, 350, 0, 'C3F-5'), (220, 300, 0, 'C3F-49'),
                              (350, 200, 90, 'BS-2'), (450, 300, -90, 'BS-3'),
                              (100, 200, 0, 'A73-219'), (200, 150, 0, 'Z3-30a'),
                              (500, 200, 0, '1.2'), (580, 200, 0, 'B1'),
                              (100, 400, 0, 'FE'), (150, 400, 0, 'CR'),
                              (200, 400, 0, '3mm'), (250, 400, 0, 'MAX')]:
        text(x, y, angle, label)
    text(20, 460, 0, 'OUTSIDE-99')
    text(600, 150, 0, 'C3F-5')  # duplicate annotation, not another scheduled identity
    stream = '\n'.join(commands).encode('ascii')
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
               b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream']
    pdf = bytearray(b'%PDF-1.4\n'); offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(pdf)); pdf.extend(b'%d 0 obj\n' % i + obj + b'\nendobj\n')
    xref = len(pdf); pdf.extend(b'xref\n0 6\n0000000000 65535 f \n')
    for offset in offsets[1:]: pdf.extend(b'%010d 00000 n \n' % offset)
    pdf.extend(b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % xref)
    return bytes(pdf)


class CncPanelIdTest(unittest.TestCase):
    def test_mixed_ids_and_both_rotations_survive_real_pdf_extraction(self):
        page = analyse_cnc_pdf(drawing())['pages'][0]
        self.assertEqual(set(page['panelIds']), {'C3F-5', 'C3F-49', 'BS-2', 'BS-3', 'A73-219', 'Z3-30a', '1.2', 'B1'})
        self.assertEqual(len(page['panelIds']), 8)
        self.assertNotIn('Panel IDs were not detected', page['warnings'])
        self.assertEqual(page['project'], 'Notre Dame')
        self.assertEqual(page['orderNumber'], '21')
        self.assertEqual((page['sheetWidth'], page['sheetHeight']), (3000, 1200))

    def test_plain_edge_labels_and_units_are_not_identifiers(self):
        for text in ('FE', 'CR', 'NT', 'RE', 'MAX', '3mm', '600mm', '3.12m2'):
            self.assertEqual(_panel_id({'text': text}), '')

    def test_rotation_normalization_uses_orientation_not_a_guess_from_id_format(self):
        self.assertEqual(_panel_id({'text': '3-SB', 'upright': False, 'chars': [{'matrix': (0, 1, -1, 0, 0, 0)}]}), 'BS-3')
        self.assertEqual(_panel_id({'text': 'BS-3', 'upright': False, 'chars': [{'matrix': (0, -1, 1, 0, 0, 0)}]}), 'BS-3')
        self.assertEqual(_panel_id({'text': 'ABC-1A'}), 'ABC-1A')


if __name__ == '__main__':
    unittest.main()
