import unittest
from safety_pdf import scan_signoff_pdf

def pdf_fixture(table_page=1,top=140,rows=3,row_heights=None,paragraph_fills=False):
    contents=[]
    for index in range(table_page):
        if index<table_page-1: contents.append('BT /F1 12 Tf 50 550 Td (Workshop instructions) Tj ET');continue
        xs=[50,140,250,340,400,465,520,620];parts=[]
        def text(x,y,value):parts.append(f'BT /F1 8 Tf {x} {612-y-8} Td ({value}) Tj ET')
        for x,label in zip(xs,['NAME','ROLE','TYPE','CLASS','NUMBER','DATE','SIGNATURE']):text(x+3,top-20,label)
        y=top
        for height in (row_heights or [36]*rows):
            text(xs[2]+3,y+2,'Construction Card')
            if paragraph_fills:parts.append(f'0.85 g {xs[2]+5} {612-y-12} 80 12 re f 0 g')
            for x in xs:parts.append(f'{x} {612-y} m {x} {612-y-height} l S')
            for boundary in [y,y+height]:parts.append(f'{xs[0]} {612-boundary} m {xs[-1]} {612-boundary} l S')
            y+=height
        contents.append('\n'.join(parts))
    objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];kids=[]
    for content in contents:
        page=len(objects)+1;stream=page+1;kids.append(f'{page} 0 R');objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 3 0 R >> >> /Contents {stream} 0 R >>',f'<< /Length {len(content)} >>\nstream\n{content}\nendstream'])
    objects[1]=f'<< /Type /Pages /Count {len(kids)} /Kids [{" ".join(kids)}] >>'
    data=b'%PDF-1.4\n';offsets=[0]
    for n,obj in enumerate(objects,1):offsets.append(len(data));data+=f'{n} 0 obj\n{obj}\nendobj\n'.encode()
    xref=len(data);data+=f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()+b''.join(f'{o:010} 00000 n \n'.encode() for o in offsets[1:]);return data+f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()

class SignoffScanTests(unittest.TestCase):
    def test_detects_fields_and_rows_at_changed_page_and_position(self):
        a=scan_signoff_pdf(pdf_fixture());b=scan_signoff_pdf(pdf_fixture(table_page=3,top=210,rows=5))
        self.assertEqual(a['status'],'detected');self.assertEqual(a['pages'][0]['page'],1);self.assertEqual(len(a['pages'][0]['rows']),3)
        self.assertEqual(b['pages'][0]['page'],3);self.assertEqual(len(b['pages'][0]['rows']),5);self.assertAlmostEqual(b['pages'][0]['rows'][0]['top'],210)
        self.assertEqual(set(b['pages'][0]['columns']),{'name','role','type','class','number','date','signature'})
    def test_variable_rows_and_paragraph_fills_do_not_hide_table_fields(self):
        result=scan_signoff_pdf(pdf_fixture(table_page=3,row_heights=[32,36,24],paragraph_fills=True))
        self.assertEqual(result['status'],'detected');page=result['pages'][0]
        self.assertEqual([r['height'] for r in page['rows']],[32,36,24])
        self.assertEqual(page['columns']['type'],[250,90]);self.assertEqual(page['columns']['class'],[340,60])
    def test_missing_supported_fields_requires_manual_setup(self):
        data=pdf_fixture().replace(b'SIGNATURE',b'OTHERWORD');result=scan_signoff_pdf(data)
        self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])
    def test_corrupt_pdf_fails_without_guessing(self):
        with self.assertRaises(Exception):scan_signoff_pdf(b'not a pdf')
if __name__=='__main__':unittest.main()
