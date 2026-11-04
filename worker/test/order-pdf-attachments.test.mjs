import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,degrees,PDFName} from 'pdf-lib';
import {appendOrderPdfFiles} from '../src/order-pdf-attachments.js';
import {buildOrderPdf} from '../src/order-pdf.js';
import {toolboxPdfAssets} from '../src/toolbox-pdf-assets.js';
const order={id:'synthetic-order',orderNumber:'TEST-001',project:'Synthetic attachment example',siteContact:'Test recipient',phone:'0400000000',requestedDeliveryDate:'2026-11-06',orderType:'Gate',items:[{quantity:2,description:'GATE FRAMES'}]};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=','base64');
async function source(pages=1){const pdf=await PDFDocument.create();for(let i=0;i<pages;i++){const page=pdf.addPage([400+i,300+i]);page.drawText('ATTACHED PAGE '+(i+1));if(i===1){page.setRotation(degrees(90));page.setCropBox(10,20,300,200);}}return pdf.save();}
async function fixture(entries){
 const objects=new Map(),files=[];
 for(const [name,data]of entries){const bytes=new Uint8Array(data),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join(''),file={id:crypto.randomUUID(),name,size:bytes.length,sha256};files.push(file);objects.set('order-attachments/'+order.id+'/'+file.id+'/'+file.sha256,bytes);}
 const bucket={get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer}:null;}};
 return {files,objects,bucket,run:cover=>appendOrderPdfFiles(cover||buildOrderPdf(order),order.id,files,bucket)};
}
test('no printable attachments preserves the exact existing order PDF',async()=>{
 const cover=buildOrderPdf(order),f=await fixture([['details.xlsx',Buffer.from('EXCEL')]]),result=await f.run(cover);assert.equal(result.bytes,cover);assert.deepEqual(result.appendedIds,[]);
});
test('all source PDF pages follow the order sheet with their sizes, rotations and crop boxes intact',async()=>{
 const f=await fixture([['first.PDF',await source(2)],['other.docx',Buffer.from('WORD')],['last.pdf',await source()]]),result=await f.run(),pdf=await PDFDocument.load(result.bytes);
 assert.equal(pdf.getPageCount(),4);assert.equal(pdf.getPage(0).getWidth(),595.276);assert.equal(pdf.getPage(1).getWidth(),400);assert.equal(pdf.getPage(2).getRotation().angle,90);assert.deepEqual(pdf.getPage(2).getCropBox(),{x:10,y:20,width:300,height:200});assert.equal(pdf.getPage(3).getWidth(),400);
 assert.deepEqual(result.appendedIds,[f.files[0].id,f.files[2].id]);
});
test('JPG and transparent PNG photos become fitted image pages after the cover',async()=>{
 const f=await fixture([['Photo.png',png],['Logo.jpg',toolboxPdfAssets().logo]]),result=await f.run(),pdf=await PDFDocument.load(result.bytes);
 assert.equal(pdf.getPageCount(),3);for(const page of pdf.getPages().slice(1))assert.equal(page.node.Resources().lookup(PDFName.of('XObject')).keys().length,1);
 assert.deepEqual(result.appendedIds,f.files.map(file=>file.id));
});
test('JPEG EXIF rotation determines page orientation without rotating the order cover',async()=>{
 const original=toolboxPdfAssets().logo,exif=Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000','hex'),photo=Buffer.concat([original.slice(0,2),exif,original.slice(2)]);
 const f=await fixture([['iPad photo.jpg',photo]]),pdf=await PDFDocument.load((await f.run()).bytes);
 assert.equal(pdf.getPage(0).getRotation().angle,0);assert.ok(pdf.getPage(1).getHeight()>pdf.getPage(1).getWidth());
});
test('missing, changed or unreadable attachments fail visibly without generating a cover-only PDF',async()=>{
 const missing=await fixture([['drawing.pdf',await source()]]);missing.objects.clear();await assert.rejects(()=>missing.run(),/unavailable/);
 const corrupt=await fixture([['drawing.pdf',await source()]]);for(const bytes of corrupt.objects.values())bytes[15]^=1;await assert.rejects(()=>corrupt.run(),/contents changed/);
 for(const name of ['drawing.pdf','photo.jpg','photo.png']){const f=await fixture([[name,Buffer.from('not a valid attachment')]]);await assert.rejects(()=>f.run(),/Could not append/);}
});
test('oversized image dimensions and PDFs over the page limit stop before embedding',async()=>{
 const image=Buffer.from(png);image.writeUInt32BE(10000,16);image.writeUInt32BE(10000,20);const f=await fixture([['huge.png',image]]);await assert.rejects(()=>f.run(),/12 megapixels/);
 const pages=await fixture([['many.pdf',await source(200)]]);await assert.rejects(()=>pages.run(),/200 pages/);
});
