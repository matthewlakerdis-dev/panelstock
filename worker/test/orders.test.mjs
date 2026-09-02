import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOrderPdf} from '../src/order-pdf.js';

test('order PDF contains the cover-sheet layout and spans pages safely',()=>{
  const order={orderNumber:'42',project:'Harbour Tower',dateOrdered:'2026-09-02T01:00:00Z',requestedDeliveryDate:'2026-09-10',requestedDeliveryTime:'06:30',siteContact:'Michael',phone:'0434 578 760',orderType:'Panels',locationNotes:'Level 4 loading dock',status:'submitted',requestedBy:'michael',items:Array.from({length:31},(_,i)=>({quantity:i+1,description:'Panel '+(i+1)}))};
  const bytes=buildOrderPdf(order),text=new TextDecoder().decode(bytes);
  assert.equal(text.startsWith('%PDF-1.4'),true);
  assert.match(text,/\/MediaBox \[0 0 842 595\]/);
  assert.match(text,/SITE ORDER COVER SHEET/);
  assert.match(text,/Harbour Tower/);
  assert.match(text,/\/Count 2/);
  assert.match(text,/2 \/ 2/);
});
