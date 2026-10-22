import unittest
import hashlib
from safety_pdf import scan_signoff_pdf

def pdf_fixture(table_page=1,top=140,rows=3,row_heights=None,paragraph_fills=False,card_text=True,licence_rows=False,thick_header=False,
                shaded_cells=False,collapsed_rules=False,missing_cell=None,missing_last_rule=False,duplicate_fills=False,shift_signature_row=None,overlapping_fill=False,licence_heights=None,interior_merged_rule=None,interior_vertical_rule=None):
    contents=[]
    for index in range(table_page):
        if index<table_page-1: contents.append('BT /F1 12 Tf 50 550 Td (Workshop instructions) Tj ET');continue
        xs=[50,140,250,340,400,465,520,620];parts=[]
        def text(x,y,value):parts.append(f'BT /F1 8 Tf {x} {612-y-8} Td ({value}) Tj ET')
        for x,label in zip(xs,['NAME','ROLE','TYPE','CLASS','NUMBER','DATE','SIGNATURE']):text(x+3,top-20,label)
        if thick_header: parts.append(f'{xs[0]} {612-top+2.16} m {xs[-1]} {612-top+2.16} l S')
        y=top
        heights=row_heights or [36]*rows
        for row,height in enumerate(heights):
            subdivisions=(licence_heights or {}).get(row,[height/3]*3)
            cell_edges=[y,y+subdivisions[0],y+subdivisions[0]+subdivisions[1],y+height]
            if card_text: text(xs[2]+3,y+2,'Construction Card')
            if paragraph_fills:parts.append(f'0.85 g {xs[2]+5} {612-y-12} 80 12 re f 0 g')
            if shaded_cells and row%2==0:
                fills=[]
                for column,(left,right) in enumerate(zip(xs,xs[1:])):
                    if column==6 and row==shift_signature_row:left+=3
                    slices=3 if column in (2,3,4) else 1
                    for section in range(slices):
                        if (row,column,section)==missing_cell:continue
                        cell_top=cell_edges[section] if slices==3 else y
                        cell_height=(cell_edges[section+1]-cell_top if slices==3 else height)-.05
                        fills.append(f'0.85 g {left} {612-cell_top-cell_height} {right-left-.05} {cell_height} re f 0 g')
                parts.extend(fills*(2 if duplicate_fills else 1))
                if overlapping_fill and row==0:parts.append(f'0.85 g {xs[-2]+1} {612-y-height} {xs[-1]-xs[-2]-2} {height} re f 0 g')
            for x in xs:
                if collapsed_rules:x=0
                parts.append(f'{x} {612-y} m {x} {612-y-height} l S')
            for boundary in [y,y+height]:
                if missing_last_rule and row==len(heights)-1 and boundary==y+height:continue
                left,right=(0,0) if collapsed_rules else (xs[0],xs[-1])
                parts.append(f'{left} {612-boundary} m {right} {612-boundary} l S')
            if licence_rows:
                left,right=(0,0) if collapsed_rules else (xs[2],xs[5])
                for boundary in cell_edges[1:3]:parts.append(f'{left} {612-boundary} m {right} {612-boundary} l S')
            if interior_merged_rule and row==1:
                if interior_merged_rule=='line':parts.append(f'{xs[0]} {612-cell_edges[2]} m {xs[-1]} {612-cell_edges[2]} l S')
                else:parts.append(f'{xs[0]} {612-cell_edges[2]} {xs[-1]-xs[0]} 0.3 re f')
            if interior_vertical_rule and row==1:
                middle=(xs[-2]+xs[-1])/2
                if interior_vertical_rule=='line':parts.append(f'{middle} {612-y} m {middle} {612-y-height} l S')
                else:parts.append(f'{middle} {612-y-height} 0.3 {height} re f')
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
    def test_blank_licence_table_detects_ten_rows_after_thick_header_on_page_eight(self):
        result=scan_signoff_pdf(pdf_fixture(table_page=8,top=141.26,rows=10,row_heights=[32.2]*10,card_text=False,licence_rows=True,thick_header=True))
        self.assertEqual(result['status'],'detected');self.assertEqual([p['page'] for p in result['pages']],[8]);rows=result['pages'][0]['rows']
        self.assertEqual(len(rows),10);self.assertAlmostEqual(rows[0]['top'],141.26);self.assertTrue(all(len(r['licenceRows'])==3 and r['needsConstructionCardLabel'] for r in rows))
    def test_blank_licence_rows_do_not_require_a_fixed_page_or_row_count(self):
        result=scan_signoff_pdf(pdf_fixture(table_page=3,top=210,rows=4,card_text=False,licence_rows=True,paragraph_fills=True))
        self.assertEqual(result['pages'][0]['page'],3);self.assertEqual(len(result['pages'][0]['rows']),4)
    def test_blank_table_without_licence_subdivisions_requires_manual_review(self):
        result=scan_signoff_pdf(pdf_fixture(card_text=False))
        self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])
    def test_separate_signature_and_incomplete_headings_are_not_a_worker_table(self):
        for label in [b'NAME',b'ROLE',b'CLASS',b'NUMBER']:
            result=scan_signoff_pdf(pdf_fixture(card_text=False,licence_rows=True).replace(label,b'X'*len(label)))
            self.assertEqual(result['status'],'manual')
    def test_corrupt_pdf_fails_without_guessing(self):
        with self.assertRaises(Exception):scan_signoff_pdf(b'not a pdf')

    def test_shaded_cells_recover_collapsed_borders_without_changing_pdf(self):
        data=pdf_fixture(table_page=8,top=141.26,rows=10,licence_rows=True,shaded_cells=True,collapsed_rules=True,duplicate_fills=True)
        original=hashlib.sha256(data).digest();result=scan_signoff_pdf(data)
        self.assertEqual(hashlib.sha256(data).digest(),original)
        self.assertEqual(result['status'],'detected');self.assertEqual([p['page'] for p in result['pages']],[8])
        page=result['pages'][0];self.assertEqual(len(page['rows']),10)
        self.assertEqual(page['columns']['signature'],[520,99.95])
        self.assertAlmostEqual(page['rows'][0]['top'],141.26)
        self.assertAlmostEqual(page['rows'][-1]['top']+page['rows'][-1]['height'],501.26)
        self.assertTrue(all(len(row['licenceRows'])==3 and not row.get('needsConstructionCardLabel') for row in page['rows']))

    def test_shaded_tables_follow_page_position_and_row_count(self):
        for table_page,top,rows in [(1,150,3),(3,210,4),(2,130,7)]:
            with self.subTest(table_page=table_page,rows=rows):
                result=scan_signoff_pdf(pdf_fixture(table_page=table_page,top=top,rows=rows,licence_rows=True,shaded_cells=True,collapsed_rules=True))
                self.assertEqual(result['status'],'detected')
                self.assertEqual(result['pages'][0]['page'],table_page)
                self.assertEqual(len(result['pages'][0]['rows']),rows)
                self.assertEqual(result['pages'][0]['rows'][0]['top'],top)

    def test_incomplete_or_conflicting_shaded_cells_need_manual_setup(self):
        for options in [dict(missing_cell=(0,6,0)),dict(missing_cell=(2,3,1)),dict(shift_signature_row=2),dict(overlapping_fill=True)]:
            with self.subTest(options=options):
                result=scan_signoff_pdf(pdf_fixture(rows=4,licence_rows=True,shaded_cells=True,collapsed_rules=True,**options))
                self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])

    def test_unshaded_last_row_requires_measured_bottom_rule(self):
        result=scan_signoff_pdf(pdf_fixture(rows=4,licence_rows=True,shaded_cells=True,collapsed_rules=True,missing_last_rule=True))
        self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])

    def test_unshaded_licence_slots_too_small_to_sign_are_not_detected(self):
        # The unshaded 4pt slot is within the matching tolerance of the measured
        # 5.8pt shaded slots, but still cannot satisfy the signing renderer.
        result=scan_signoff_pdf(pdf_fixture(rows=3,row_heights=[32]*3,licence_rows=True,shaded_cells=True,collapsed_rules=True,
                               licence_heights={0:[10,5.8,16.2],1:[10,4,18],2:[10,5.8,16.2]}))
        self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])

    def test_surviving_border_inside_merged_worker_fields_prevents_recovery(self):
        for kind in ('line','rectangle'):
            with self.subTest(kind=kind):
                result=scan_signoff_pdf(pdf_fixture(rows=4,licence_rows=True,shaded_cells=True,collapsed_rules=True,interior_merged_rule=kind))
                self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])

    def test_surviving_vertical_divider_cannot_split_recovered_signature_cell(self):
        for kind in ('line','rectangle'):
            with self.subTest(kind=kind):
                result=scan_signoff_pdf(pdf_fixture(rows=4,licence_rows=True,shaded_cells=True,collapsed_rules=True,interior_vertical_rule=kind))
                self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])

    def test_paragraph_fills_and_headings_do_not_establish_signature_cells(self):
        for paragraph_fills in (False,True):
            result=scan_signoff_pdf(pdf_fixture(rows=4,licence_rows=True,collapsed_rules=True,paragraph_fills=paragraph_fills))
            self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])

    def test_shaded_recovery_requires_printed_card_and_complete_headings(self):
        data=pdf_fixture(rows=4,licence_rows=True,shaded_cells=True,collapsed_rules=True)
        for old,new in [(b'Construction Card',b'Construction XXXX'),(b'SIGNATURE',b'OTHERWORD'),(b'CLASS',b'OTHER')]:
            with self.subTest(label=old):
                result=scan_signoff_pdf(data.replace(old,new))
                self.assertEqual(result['status'],'manual');self.assertEqual(result['pages'],[])
if __name__=='__main__':unittest.main()
