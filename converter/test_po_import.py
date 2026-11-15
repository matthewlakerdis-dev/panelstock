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

    def test_nexvia_request_distinguishes_vendor_and_preserves_source_rows_for_review(self):
        rows = '''<row><c r="A1" t="inlineStr"><is><t>Nexvia purchase order PO7399</t></is></c></row>
<row><c r="A2" t="inlineStr"><is><t>Buyer: Example Facades</t></is></c></row>
<row><c r="A3" t="inlineStr"><is><t>Supplier: Example Metals</t></is></c></row>
<row><c r="A4" t="inlineStr"><is><t>Deliver to: Example College project</t></is></c></row>
<row><c r="A5" t="inlineStr"><is><t>Code</t></is></c><c r="B5" t="inlineStr"><is><t>Description</t></is></c><c r="C5" t="inlineStr"><is><t>Ordered quantity</t></is></c><c r="D5" t="inlineStr"><is><t>Unit price</t></is></c><c r="E5" t="inlineStr"><is><t>Ordered unit</t></is></c></row>
<row><c r="A6" t="inlineStr"><is><t>00100129-MF</t></is></c><c r="B6" t="inlineStr"><is><t>3.00 1200 2400 MF 5005 H34 MILL FINISH</t></is></c><c r="C6"><v>4</v></c><c r="D6"><v>125.50</v></c></row>
<row><c r="A7" t="inlineStr"><is><t>00100129-MF</t></is></c><c r="B7" t="inlineStr"><is><t>3.00 1500 3000 MF 5005 H34 MILL FINISH</t></is></c><c r="C7"><v>1</v></c><c r="D7"><v>400</v></c><c r="E7" t="inlineStr"><is><t>pack</t></is></c></row>'''
        extracted = {'reference':'PO7399','supplier':'Example Metals','notes':'','warnings':['Line 1 ordered unit is not shown; review it.'],
            'lines':[
                {'sku':'00100129-MF','description':'3.00 1200 2400 MF 5005 H34 MILL FINISH','colour':'','dimensions':'3.00 1200 2400','lengthMm':None,'quantity':4,'unit':''},
                {'sku':'00100129-MF','description':'3.00 1500 3000 MF 5005 H34 MILL FINISH','colour':'','dimensions':'3.00 1500 3000','lengthMm':None,'quantity':1,'unit':'pack'}]}
        captured = []
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):
                return json.dumps({'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(extracted)}]}]}).encode()
        def call(request,timeout):
            captured.append(json.loads(request.data))
            return Response()
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test-only','PO_IMPORT_MODEL':'test-model'}),patch('urllib.request.urlopen',call):
            result=analyse({'name':'Nexvia-PO7399.xlsx','data':base64.b64encode(workbook(rows)).decode(),'items':[{'sku':'PRIVATE-INTERNAL-CODE'}]})
        self.assertEqual(result['reference'],'PO7399')
        self.assertEqual(result['supplier'],'Example Metals')
        self.assertEqual(result['lines'],extracted['lines'])
        self.assertEqual(result['warnings'],extracted['warnings'])
        request=captured[0]
        text=request['input'][0]['content'][1]['text']
        self.assertIn('Supplier: Example Metals',text)
        self.assertIn('C6: 4 | D6: 125.50',text)
        self.assertIn('C7: 1 | D7: 400 | E7: pack',text)
        self.assertNotIn('PRIVATE-INTERNAL-CODE',json.dumps(request))
        self.assertIn('Nexvia is the software platform, not the supplier',request['instructions'])
        self.assertIn('leading zeros and punctuation',request['instructions'])
        self.assertIn('leave unit empty',request['instructions'])
        self.assertFalse(request['store'])

    def test_nexvia_uncertain_result_keeps_missing_vendor_code_and_unit_missing(self):
        result=validate_result({'reference':'PO7399','supplier':'','warnings':['Supplier and ordered unit need review.'],
            'lines':[{'sku':'','description':'3.00 1200 2400 MF 5005 H34 MILL FINISH','dimensions':'3.00 1200 2400','quantity':None,'unit':'','lengthMm':None}]})
        self.assertEqual(result['supplier'],'')
        self.assertEqual(result['lines'][0]['sku'],'')
        self.assertEqual(result['lines'][0]['unit'],'')
        self.assertIsNone(result['lines'][0]['quantity'])
        self.assertIsNone(result['lines'][0]['lengthMm'])
        self.assertEqual(result['warnings'],['Supplier and ordered unit need review.'])

    def test_missing_configuration_is_actionable(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(ImportUnavailable):analyse({'name':'PO.xlsx','data':base64.b64encode(workbook()).decode()})


class ProviderRecoveryTests(unittest.TestCase):
    def setUp(self):
        from provider_retry import ProviderRetry
        self.now = 0
        self.waits = []
        def sleep(seconds):
            self.waits.append(seconds)
            self.now += seconds
        self.retry = ProviderRetry(lambda: self.now, sleep, retry_statuses=(429,500,502,503,504))
        self.body = {'name':'PO.xlsx','data':base64.b64encode(workbook()).decode()}
        self.patches = [patch.dict(os.environ,{'OPENAI_API_KEY':'synthetic-private-key','PO_IMPORT_MODEL':'test-model'}),
                        patch('po_import.PO_PROVIDER_RETRY',self.retry),patch('po_import.time.monotonic',lambda:self.now)]
        for p in self.patches:p.start();self.addCleanup(p.stop)

    def error(self,status,code='synthetic-unknown',after='2'):
        import urllib.error
        return urllib.error.HTTPError('https://api.openai.com/v1/responses',status,'private document contents',{'Retry-After':after},io.BytesIO(json.dumps({'error':{'code':code,'message':'synthetic-private-key and private document contents'}}).encode()))

    def response(self,data=None):
        value=data if data is not None else {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({'reference':'PO-104','supplier':'Supplier','lines':[]})}]}]}
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return json.dumps(value).encode()
        return Response()

    def test_temporary_provider_failure_recovers_without_losing_document(self):
        for status in (429,500,502,503,504):
            with self.subTest(status=status),patch('urllib.request.urlopen',side_effect=[self.error(status),self.response()]) as call:
                self.assertEqual(analyse(self.body)['reference'],'PO-104')
                self.assertEqual(call.call_count,2)
                self.assertEqual(call.call_args_list[0].args[0].data,call.call_args_list[1].args[0].data)
                self.assertLessEqual(call.call_args_list[1].kwargs['timeout'],68)

    def test_permanent_failures_are_actionable_without_retrying_or_leaking(self):
        for status,code,expected in [(401,'invalid_api_key','API key'),(403,'access_denied','model'),(404,'model_not_found','model'),(400,'invalid_json_schema','configuration'),(429,'insufficient_quota','billing'),(429,'billing_hard_limit_reached','billing')]:
            with self.subTest(status=status,code=code),patch('urllib.request.urlopen',side_effect=self.error(status,code)) as call,patch('sys.stdout',new_callable=io.StringIO) as logs:
                with self.assertRaisesRegex(ImportUnavailable,expected) as caught:analyse(self.body)
                self.assertEqual(call.call_count,1)
                report=str(caught.exception)+logs.getvalue()
                self.assertNotIn('synthetic-private-key',report);self.assertNotIn('private document contents',report)
                self.assertIn('upstream_http_status='+str(status),logs.getvalue())

    def test_long_retry_after_returns_promptly_instead_of_exceeding_worker_deadline(self):
        with patch('urllib.request.urlopen',side_effect=self.error(429,'rate_limit_exceeded','120')) as call:
            with self.assertRaisesRegex(ImportUnavailable,'busy'):analyse(self.body)
            self.assertEqual(call.call_count,1);self.assertEqual(self.waits,[])

    def test_repeated_server_failure_is_bounded(self):
        with patch('urllib.request.urlopen',side_effect=[self.error(503) for _ in range(3)]) as call:
            with self.assertRaisesRegex(ImportUnavailable,'temporarily unavailable'):analyse(self.body)
            self.assertEqual(call.call_count,3);self.assertEqual(self.waits,[2,2])

    def test_transport_and_malformed_results_are_not_reported_as_bad_files(self):
        import urllib.error
        for error,expected in [(TimeoutError(),'timed out'),(urllib.error.URLError('private upstream detail'),'could not connect')]:
            with patch('urllib.request.urlopen',side_effect=error):
                with self.assertRaisesRegex(ImportUnavailable,expected):analyse(self.body)
        for data in [[],{'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'not-json'}]}]}]:
            with patch('urllib.request.urlopen',return_value=self.response(data)):
                with self.assertRaises((ImportUnavailable,ValueError)):analyse(self.body)

if __name__=='__main__': unittest.main()
