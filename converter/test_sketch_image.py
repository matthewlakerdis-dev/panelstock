import unittest,io,base64
import pypdfium2 as pdfium
from PIL import Image,ImageDraw
from cad_ai import sketch_image
from panel_cad import CadError,generate

class SketchImageTests(unittest.TestCase):
    def test_pdf_rendered_to_high_detail_image(self):
        with pdfium.PdfDocument.new() as doc:
            page=doc.new_page(600,800);page.close()
            output=io.BytesIO();doc.save(output)
        item=sketch_image(output.getvalue(),'application/pdf')
        self.assertEqual(item['type'],'input_image')
        self.assertEqual(item['detail'],'high')
        with Image.open(io.BytesIO(base64.b64decode(item['image_url'].split(',')[1]))) as image:
            self.assertLessEqual(max(image.size),2400)

    def test_multiple_pages_not_silently_dropped(self):
        with pdfium.PdfDocument.new() as doc:
            for i in range(2):doc.new_page(600,800).close()
            output=io.BytesIO();doc.save(output)
        with self.assertRaisesRegex(CadError,'one PDF page'):
            sketch_image(output.getvalue(),'application/pdf')

    def test_invalid_pdf_reports_upload_error(self):
        with self.assertRaisesRegex(CadError,'Could not read'):
            sketch_image(b'%PDF-broken','application/pdf')

    def test_cropping_preserves_outer_annotation(self):
        image=Image.new('RGB',(1000,1000),'white')
        draw=ImageDraw.Draw(image);draw.rectangle((200,200,700,700),outline='black',width=3)
        draw.rectangle((100,100,110,110),fill='black')
        output=io.BytesIO();image.save(output,format='PNG')
        item=sketch_image(output.getvalue(),'image/png')
        cropped=Image.open(io.BytesIO(base64.b64decode(item['image_url'].split(',')[1])))
        self.assertEqual(cropped.getpixel((32,32)),(0,0,0))
        self.assertLess(cropped.width,1000)

    def test_bad_outline_error_precedes_empty_finished(self):
        with self.assertRaisesRegex(CadError,'outline does not close'):
            generate({'unsupported':True,'questions':['outline does not close'],'edges':[]})

if __name__=='__main__':unittest.main()

