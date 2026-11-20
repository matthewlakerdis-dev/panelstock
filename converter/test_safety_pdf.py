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


def supervisor_fixture(page=1,top=110,left=50,right=455,name='Eugene Molenaar',label='Signature:',
                       person_label='Responsible person (for monitoring SWMS and work)',rotation=0,
                       omit_boundary=False,extra_name=False,extra_signature=False,wrapped=False,
                       wrapped_tail=False,occupied=None,phone=True,segmented_rules=None,broken_border=None):
    """Small text-based form: one measured cell and an unrelated right column."""
    contents=[]
    for index in range(page):
        if index<page-1: contents.append('BT /F1 10 Tf 50 550 Td (Workshop instructions) Tj ET');continue
        parts=[]
        def text(x,y,value):
            value=value.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
            parts.append(f'BT /F1 9 Tf {x} {612-y-9} Td ({value}) Tj ET')
        if not omit_boundary:
            if not segmented_rules: parts.append(f'{left} {612-top-78} {right-left} 78 re S')
            else:
                # Word writes one continuous visual cell as short side pieces
                # at paragraph boundaries, and top/bottom pieces at columns.
                # The real fixtures have sub-point gaps from export rounding.
                def rule(x0,y0,x1,y1):
                    if segmented_rules=='rectangles':
                        parts.append(f'{x0} {612-y1} {max(x1-x0,.24)} {max(y1-y0,.24)} re f')
                    else:parts.append(f'{x0} {612-y0} m {x1} {612-y1} l S')
                for side,y in [('top',top),('bottom',top+78)]:
                    for i,(a,b) in enumerate(zip([left,left+130],[left+130,right])):
                        rule(a+(3 if broken_border==side else .2)*i,y,b,y)
                for side,x in [('left',left),('right',right)]:
                    for i,(a,b) in enumerate(zip([top,top+26,top+52],[top+26,top+52,top+78])):
                        rule(x,a+(3 if broken_border==side else .2)*(i>0),x,b)
        text(left+6,top+5,person_label+': '+('Eugene' if wrapped else name))
        if wrapped or wrapped_tail:text(left+6,top+20,'Molenaar' if wrapped else 'Jones')
        if extra_name:text(left+6,top+18,'Supervisor: Another Person')
        text(left+6,top+30,label)
        if extra_signature:text(left+6,top+45,'Approval signature:')
        if phone:text(left+6,top+58,'Contact Phone #: 0418 000 000')
        text(right+6,top+5,'Factory Address: The workshop')
        text(right+6,top+30,'Factory Contact: 0400 000 000')
        text(50,575,'AUTHORISED BY: KERRY MUNRO')
        x=left+170;y=top+33
        if occupied=='text':text(x,y,'Already signed')
        elif occupied=='line':parts.append(f'{x} {612-y} m {x+60} {612-y-8} l S')
        elif occupied=='curve':parts.append(f'{x} {612-y} m {x+20} {612-y-12} {x+40} {612-y+4} {x+60} {612-y-8} c S')
        elif occupied=='flat_curve':parts.append(f'{x} {612-y} m {x+20} {612-y} {x+40} {612-y} {x+60} {612-y} c S')
        elif occupied=='rectangle':parts.append(f'{x} {612-y-15} 75 15 re f')
        elif occupied=='image':parts.append(f'q 75 0 0 15 {x} {612-y-15} cm BI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI Q'.replace('\\x00','\x00'))
        contents.append('\n'.join(parts))
    objects=['<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];kids=[]
    if occupied=='annotation':objects.append(f'<< /Type /Annot /Subtype /Stamp /Rect [{left+170} {612-top-48} {left+245} {612-top-33}] /Contents (Existing signature) >>')
    for index,content in enumerate(contents):
        number=len(objects)+1;stream=number+1;kids.append(f'{number} 0 R')
        annotations=' /Annots [4 0 R]' if occupied=='annotation' and index==page-1 else ''
        objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Rotate {rotation if index==page-1 else 0} /Resources << /Font << /F1 3 0 R >> >> /Contents {stream} 0 R{annotations} >>',f'<< /Length {len(content)} >>\nstream\n{content}\nendstream'])
    objects[1]=f'<< /Type /Pages /Count {len(kids)} /Kids [{" ".join(kids)}] >>'
    data=b'%PDF-1.4\n';offsets=[0]
    for number,obj in enumerate(objects,1):offsets.append(len(data));data+=f'{number} 0 obj\n{obj}\nendobj\n'.encode()
    xref=len(data);data+=f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()+b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets[1:])
    return data+f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()

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

class SupervisorScanTests(unittest.TestCase):
    def test_contiguous_word_border_segments_define_the_same_supervisor_cell(self):
        for kind in ['lines','rectangles']:
            with self.subTest(kind=kind):
                data=supervisor_fixture(page=2,top=210,segmented_rules=kind)
                digest=hashlib.sha256(data).digest();result=scan_signoff_pdf(data)
                self.assertEqual(hashlib.sha256(data).digest(),digest)
                self.assertEqual(len(result['supervisors']),1)
                field=result['supervisors'][0]
                self.assertEqual((field['page'],field['name']),(2,'Eugene Molenaar'))
                self.assertGreater(field['rect'][0],100);self.assertLess(sum(field['rect'][::2]),455)
                self.assertGreater(field['rect'][1],225);self.assertLess(sum(field['rect'][1::2]),268)

    def test_incomplete_segmented_cell_sides_are_not_inferred(self):
        for kind in ['lines','rectangles']:
            for side in ['top','bottom','left','right']:
                with self.subTest(kind=kind,side=side):
                    result=scan_signoff_pdf(supervisor_fixture(segmented_rules=kind,broken_border=side))
                    self.assertEqual(result['supervisors'],[]);self.assertEqual(result['status'],'manual')

    def test_named_supervisor_is_detected_without_a_worker_table(self):
        data=supervisor_fixture();digest=hashlib.sha256(data).digest();result=scan_signoff_pdf(data)
        self.assertEqual(hashlib.sha256(data).digest(),digest)
        self.assertEqual(result['status'],'detected');self.assertEqual(result['pages'],[])
        self.assertEqual(result['candidatePages'],[1]);self.assertEqual(len(result['supervisors']),1)
        field=result['supervisors'][0]
        self.assertEqual(field['name'],'Eugene Molenaar');self.assertEqual(field['label'],'Signature:')
        self.assertEqual(field['page'],1);self.assertEqual((field['width'],field['height']),(792,612))
        x,top,width,height=field['rect']
        self.assertGreater(x,100);self.assertLess(x+width,455)
        self.assertGreater(top,125);self.assertLess(top+height,168)
        self.assertGreaterEqual(height,14);self.assertGreaterEqual(width,70)

    def test_name_label_page_and_position_are_not_hard_coded(self):
        cases=[(3,250,'Ana Carter-Jones','Approval signature:','Responsible person'),
               (2,370,"John O'Neil",'Signature:','Supervisor'),
               (1,70,'A. Kumar','Signature:','Supervisor name')]
        for page,top,name,label,person_label in cases:
            with self.subTest(name=name):
                result=scan_signoff_pdf(supervisor_fixture(page=page,top=top,left=80,right=550,name=name,label=label,person_label=person_label))
                self.assertEqual(len(result['supervisors']),1)
                field=result['supervisors'][0];self.assertEqual((field['page'],field['name'],field['label']),(page,name.replace("'",'’'),label))
                self.assertGreater(field['rect'][1],top);self.assertLess(sum(field['rect'][1::2]),top+58)

    def test_neighbouring_column_and_authorisation_footer_do_not_become_the_name(self):
        field=scan_signoff_pdf(supervisor_fixture())['supervisors'][0]
        self.assertEqual(field['name'],'Eugene Molenaar');self.assertLess(field['rect'][0]+field['rect'][2],455)
        for person_label in ['Authorised by','Factory contact','Worker name']:
            with self.subTest(label=person_label):
                self.assertEqual(scan_signoff_pdf(supervisor_fixture(person_label=person_label))['supervisors'],[])

    def test_ambiguous_wrapped_and_placeholder_names_are_not_guessed(self):
        cases=[{'extra_name':True},{'extra_signature':True},{'wrapped':True},{'wrapped_tail':True},
               {'name':'Eugene'},{'name':'All workers'},{'name':'Your name'},{'name':'Eugene / Someone Else'},
               {'name':'Eugene Molenaar 0418000000'},{'name':'TBA'},{'label':'Worker signature:'}]
        for options in cases:
            with self.subTest(options=options):
                result=scan_signoff_pdf(supervisor_fixture(**options));self.assertEqual(result['supervisors'],[]);self.assertEqual(result['status'],'manual')

    def test_occupied_text_images_vectors_and_annotations_are_preserved(self):
        for occupied in ['text','line','curve','flat_curve','rectangle','image','annotation']:
            with self.subTest(occupied=occupied):
                result=scan_signoff_pdf(supervisor_fixture(occupied=occupied))
                self.assertEqual(result['supervisors'],[]);self.assertEqual(result['status'],'manual')

    def test_unbounded_rotated_and_out_of_page_fields_require_manual_review(self):
        for options in [{'omit_boundary':True},{'rotation':90},{'rotation':180},{'right':850},{'left':-4},{'top':565},{'right':150}]:
            with self.subTest(options=options):
                self.assertEqual(scan_signoff_pdf(supervisor_fixture(**options))['supervisors'],[])

    def test_measured_cell_bottom_bounds_a_form_without_contact_line(self):
        field=scan_signoff_pdf(supervisor_fixture(phone=False))['supervisors'][0]
        self.assertLessEqual(field['rect'][3],42);self.assertLess(field['rect'][1]+field['rect'][3],188)

    def test_worker_tables_remain_separate_and_do_not_create_supervisor_fields(self):
        result=scan_signoff_pdf(pdf_fixture(table_page=3,top=210,rows=4,card_text=False,licence_rows=True))
        self.assertEqual(result['status'],'detected');self.assertEqual(result['supervisors'],[])
        self.assertEqual(result['pages'][0]['page'],3);self.assertEqual(len(result['pages'][0]['rows']),4)

if __name__=='__main__':unittest.main()
