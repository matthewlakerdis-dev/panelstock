import base64
import io
import json
import os
import unittest
import zipfile
from unittest.mock import patch
from po_import import analyse, document_input, workbook_text, validate_result, ImportUnavailable

def workbook(rows='<row><c r="A1" t="inlineStr"><is><t>PO-104</t></is></c><c r="B1"><v>12</v></c></row>'):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('xl/workbook.xml','<workbook/>')
        z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows+'</sheetData></worksheet>')
    return out.getvalue()

class ImportTests(unittest.TestCase):
    def test_excel_preserves_cells_and_quantities(self):
        self.assertIn('A1: PO-104 | B1: 12',workbook_text(workbook()))
        self.assertEqual(document_input({'name':'PO.xlsx','data':base64.b64encode(workbook()).decode()})['type'],'input_text')

    def test_invalid_files_and_xml_are_rejected(self):
        for body in [{'name':'evil.html','data':base64.b64encode(b'<html>').decode()},{'name':'x.pdf','data':'invalid'},{'name':'x.xlsx','data':base64.b64encode(b'PKbad').decode()}]:
            with self.assertRaises(ValueError): document_input(body)
        with self.assertRaises(ValueError): workbook_text(workbook('<!DOCTYPE bad>'))

    def test_photo_input_is_validated_and_pdf_keeps_the_whole_document(self):
        from PIL import Image
        import pypdfium2 as pdfium
        image=io.BytesIO();Image.new('RGB',(12,12),'white').save(image,format='PNG')
        self.assertEqual(document_input({'name':'PO.png','data':base64.b64encode(image.getvalue()).decode()})['type'],'input_image')
        doc=pdfium.PdfDocument.new();doc.new_page(100,100);doc.new_page(100,100);out=io.BytesIO();doc.save(out);doc.close()
        value=document_input({'name':'PO.pdf','data':base64.b64encode(out.getvalue()).decode()})
        self.assertEqual(value['type'],'input_file');self.assertTrue(value['file_data'].startswith('data:application/pdf;base64,'))

    def test_formula_without_cache_is_not_invented(self):
        self.assertIn('formula without cached value',workbook_text(workbook('<row><c r="A1"><f>SUM(B1:B9)</f></c></row>')))

    def test_result_bounds_and_uncertain_quantities(self):
        result=validate_result({'reference':'PO-2','supplier':'Supplier','lines':[{'sku':'A','description':'Angle','quantity':True,'lengthMm':float('nan')}]})
        self.assertIsNone(result['lines'][0]['quantity']);self.assertIsNone(result['lines'][0]['lengthMm'])
        with self.assertRaises(ValueError):validate_result({'lines':[{}]*201})

    def test_ai_request_is_private_structured_and_does_not_send_stock(self):
        captured=[]
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return json.dumps({'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({'reference':'PO-104','supplier':'Supplier','notes':'','warnings':[],'lines':[{'sku':'ANG','description':'Angle','colour':'Black','dimensions':'','lengthMm':6000,'quantity':12,'unit':'lengths'}]})}]}]}).encode()
        def call(request,timeout):captured.append(json.loads(request.data));return Response()
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test-only','CAD_AI_MODEL':'test-model'}),patch('urllib.request.urlopen',call):
            result=analyse({'name':'PO.xlsx','data':base64.b64encode(workbook()).decode()})
        self.assertEqual(result['lines'][0]['quantity'],12);self.assertFalse(captured[0]['store']);self.assertTrue(captured[0]['text']['format']['strict'])

    def test_incomplete_provider_response_is_not_silently_imported(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return b'{"status":"incomplete","output":[]}'
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test-only','CAD_AI_MODEL':'test-model'}),patch('urllib.request.urlopen',return_value=Response()):
            with self.assertRaisesRegex(ValueError,'did not finish'):analyse({'name':'PO.xlsx','data':base64.b64encode(workbook()).decode()})

    def test_missing_configuration_is_actionable(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(ImportUnavailable):analyse({'name':'PO.xlsx','data':base64.b64encode(workbook()).decode()})

if __name__=='__main__': unittest.main()
