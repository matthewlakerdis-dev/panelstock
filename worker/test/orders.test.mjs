import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOrderPdf} from '../src/order-pdf.js';
import {brandLogo} from '../src/brand-logo.js';
import {orderPdfLogo} from '../src/order-pdf-logo.js';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';

test('order PDF contains the cover-sheet layout and spans pages safely',()=>{
  const order={orderNumber:'42',project:'Harbour Tower',dateOrdered:'2026-09-02T01:00:00Z',requestedDeliveryDate:'2026-09-10',requestedDeliveryTime:'06:30',siteContact:'Michael',phone:'0434 578 760',orderType:'Panels',locationNotes:'Level 4 loading dock',status:'submitted',requestedBy:'michael',items:Array.from({length:31},(_,i)=>({quantity:i+1,description:'Panel '+(i+1)}))};
  const bytes=buildOrderPdf(order),text=new TextDecoder().decode(bytes);
  assert.equal(text.startsWith('%PDF-1.4'),true);
  assert.match(text,/\/MediaBox \[0 0 595\.276 841\.89\]/);
  assert.match(text,/\/CropBox \[0 0 595\.276 841\.89\]/);
  assert.match(text,/0 G 0\.75 w/);
  assert.doesNotMatch(text,/1 \/ 2/);
  assert.match(text,/SITE ORDER COVER SHEET/);
  assert.match(text,/Harbour Tower/);
  assert.match(text,/\/Count 2/);
  assert.doesNotMatch(text,/BT \/F1 6\.5 Tf 18 /);
  assert.match(text,/\(Panel 31\) Tj/);
  assert.match(text,/\(31\) Tj/); // Item quantities remain visible.
});

test('each PDF page displays the existing brand logo without the ordered-by footer',()=>{
  const order={orderNumber:'42',project:'Harbour Tower',requestedBy:'footer-test-user',items:Array.from({length:31},(_,i)=>({quantity:1,description:'Panel '+(i+1)}))};
  const bytes=buildOrderPdf(order),pdf=new TextDecoder().decode(bytes);
  assert.equal((pdf.match(/\/Logo Do/g)||[]).length,2,'both pages draw the logo');
  assert.equal((pdf.match(/\/XObject << \/Logo \d+ 0 R >>/g)||[]).length,2,'both pages reference the image');
  assert.equal((pdf.match(/\/Subtype \/Image/g)||[]).length,1,'the embedded logo is shared across pages');
  assert.doesNotMatch(pdf,/ORDERED BY:|footer-test-user/);
  for(const label of ['LOADED BY:','DELIVERED BY:','RECEIVED BY:'])assert.ok(pdf.includes(label),label+' remains available');
  assert.match(pdf,/\(Panel 31\) Tj/);
  const image=pdf.match(/\/Subtype \/Image[^]*?\/Length (\d+) >>\nstream\n([^]*?)endstream/);
  assert.ok(image,'the PDF contains an embedded image stream');
  assert.equal(Number(image[1]),image[2].length,'the image stream length is valid');
  const pixels=inflateSync(Buffer.from(image[2].trim().slice(0,-1),'hex'));
  assert.equal(pixels.length,orderPdfLogo.width*orderPdfLogo.height*3);
  let blue=0,black=0;
  for(let i=0;i<pixels.length;i+=3){
    if(pixels[i]<50&&pixels[i+1]>100&&pixels[i+2]>150)blue++;
    if(pixels[i]<50&&pixels[i+1]<50&&pixels[i+2]<50)black++;
  }
  assert.ok(blue>1000&&black>1000,'the logo retains the blue and black brand artwork');
  assert.equal(orderPdfLogo.sourceSha256,createHash('sha256').update(Buffer.from(brandLogo.split(',')[1],'base64')).digest('hex'),'the PDF artwork matches the current brand source');
});
