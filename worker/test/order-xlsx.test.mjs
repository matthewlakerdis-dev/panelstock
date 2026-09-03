import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildOrderXlsx} from '../src/order-xlsx.js';
import {orderTemplateFixture} from './order-template-fixture.mjs';

function entries(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=bytes.length-22;
  while(eocd>=0&&view.getUint32(eocd,true)!==0x06054b50)eocd--;
  const count=view.getUint16(eocd+10,true),result=new Map();let offset=view.getUint32(eocd+16,true);
  for(let i=0;i<count;i++){
    const method=view.getUint16(offset+10,true),size=view.getUint32(offset+20,true),nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
    const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameLength)),localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),start=local+30+localName+localExtra,packed=bytes.subarray(start,start+size);
    result.set(name,method===8?inflateRawSync(packed):packed);offset+=46+nameLength+extraLength+commentLength;
  }
  return result;
}

test('site order Excel export fills the original A4 template without changing its styles',async()=>{
  const bytes=await buildOrderXlsx({orderNumber:'42',project:'Harbour Tower',dateOrdered:'2026-09-02',siteContact:'Michael',phone:'0434 578 760',orderType:'Panels',requestedDeliveryDate:'2026-09-10',requestedDeliveryTime:'06:30',locationNotes:'Level 4',items:[{quantity:2,description:'L4 fascia panel'}]},await orderTemplateFixture());
  assert.equal(new TextDecoder().decode(bytes.subarray(0,2)),'PK');
  const files=entries(bytes),sheet=new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml')),shared=new TextDecoder().decode(files.get('xl/sharedStrings.xml'));
  assert.match(sheet,/paperSize="9" orientation="portrait"/);
  assert.match(sheet,/pageMargins left="0\.19685039370078741"/);
  assert.match(sheet,/<c r="B18"[^>]*><v>2<\/v><\/c>/);
  assert.match(sheet,/L4 fascia panel/);assert.match(shared,/Harbour Tower/);assert.doesNotMatch(shared,/\{\{PROJECT\}\}/);
});

test('site order Excel export fills namespace-prefixed worksheet cells',async()=>{
  const bytes=await buildOrderXlsx({orderNumber:'43',project:'Namespace test',dateOrdered:'2026-09-03',siteContact:'Taylor',phone:'0400 000 000',orderType:'Panels',requestedDeliveryDate:'2026-09-12',items:[{quantity:3,description:'White ACP panel'}]},await orderTemplateFixture(true));
  const sheet=new TextDecoder().decode(entries(bytes).get('xl/worksheets/sheet1.xml'));
  assert.match(sheet,/<x:c r="B18"[^>]*><x:v>3<\/x:v><\/x:c>/);
  assert.match(sheet,/<x:c r="C18"[^>]*t="inlineStr"><x:is><x:t[^>]*>White ACP panel<\/x:t><\/x:is><\/x:c>/);
  assert.doesNotMatch(sheet,/FALSE|t="b"/);
});
