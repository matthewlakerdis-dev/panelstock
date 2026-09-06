import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildOrderXlsx} from '../src/order-xlsx.js';
import {orderTemplateFixture} from './order-template-fixture.mjs';
import {buildZip} from '../src/reports.js';

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

for(const count of [30,31,60,300])test(`site order export retains all ${count} items on printable continuation sheets`,async()=>{
  const items=Array.from({length:count},(_,index)=>({quantity:index+1,description:`Item-${index+1}-end & <safe>`}));
  const original=entries(await orderTemplateFixture()),files=entries(await buildOrderXlsx({orderNumber:'005',items},await orderTemplateFixture()));
  const read=name=>new TextDecoder().decode(files.get(name)),pages=Math.ceil(count/30);
  assert.equal([...files.keys()].filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length,pages);
  assert.equal([...read('xl/workbook.xml').matchAll(/name="_xlnm.Print_Area"/g)].length,pages);
  assert.deepEqual(files.get('xl/styles.xml'),original.get('xl/styles.xml'));
  let descriptions='';
  for(let page=0;page<pages;page++){
    const sheet=read(`xl/worksheets/sheet${page+1}.xml`);descriptions+=sheet;
    assert.match(sheet,/paperSize="9" orientation="portrait"/);
    assert.match(read('xl/workbook.xml'),new RegExp(`localSheetId="${page}"`));
    assert.ok(read('xl/_rels/workbook.xml.rels').includes(`Target="worksheets/sheet${page+1}.xml"`));
    assert.ok(read('[Content_Types].xml').includes(`/xl/worksheets/sheet${page+1}.xml`));
    assert.match(sheet,new RegExp(`<c r="B18" s="2"><v>${page*30+1}</v>`));
  }
  for(let index=1;index<=count;index++)assert.equal(descriptions.split(`Item-${index}-end &amp; &lt;safe&gt;`).length-1,1);
  if(count===31)assert.match(read('xl/worksheets/sheet2.xml'),/<c r="A19"[^>]*t="inlineStr"><is><t[^>]*><\/t>/);
});

for(const namespaced of [false,true])test(`three-digit line numbers have room on every page (namespaced=${namespaced})`,async()=>{
  for(const count of [99,100,300]){
    const files=entries(await buildOrderXlsx({items:Array.from({length:count},()=>({quantity:1,description:'QA'}))},await orderTemplateFixture(namespaced)));
    for(const [name,bytes] of files){
      if(!/^xl\/worksheets\/sheet\d+\.xml$/.test(name))continue;
      const sheet=new TextDecoder().decode(bytes);
      assert.match(sheet,new RegExp(`col min="1" max="1" width="${count>=100?'4\\.5':'2\\.25'}"`));
      assert.match(sheet,/col min="2" max="14" width="9"/);
    }
  }
});

test('a wider existing line-number column is not narrowed',async()=>{
  const files=entries(await buildOrderXlsx({items:Array.from({length:100},()=>({quantity:1,description:'QA'}))},await orderTemplateFixture(false,8)));
  assert.match(new TextDecoder().decode(files.get('xl/worksheets/sheet4.xml')),/col min="1" max="1" width="8"/);
});

for(const namespaced of [false,true])for(const variant of ['missing','empty-properties','existing','expanded'])test(`Excel fits every sheet onto A4 (${variant}, namespaced=${namespaced})`,async()=>{
  const p=namespaced?'x:':'',enc=new TextEncoder(),dec=new TextDecoder();
  const template=entries(await orderTemplateFixture(namespaced));
  let source=dec.decode(template.get('xl/worksheets/sheet1.xml'));
  const setupPattern=new RegExp(`<${p}pageSetup\\b[^>]*\\/>`);
  if(variant==='missing'||variant==='empty-properties'){
    source=source.replace(setupPattern,'');
    if(variant==='empty-properties')source=source.replace(new RegExp(`<${p}worksheet\\b[^>]*>`),`$&<${p}sheetPr codeName="KeepMe"/>`);
  }else{
    const end=variant==='expanded'?`></${p}pageSetUpPr>`:'/>';
    source=source.replace(new RegExp(`<${p}worksheet\\b[^>]*>`),`$&<${p}sheetPr codeName="KeepMe"><${p}tabColor rgb="FFFF0000"/><${p}outlinePr summaryBelow="0"/><${p}pageSetUpPr autoPageBreaks="0" fitToPage='0'${end}</${p}sheetPr>`);
    const close=variant==='expanded'?`></${p}pageSetup>`:'/>';
    source=source.replace(setupPattern,`<${p}pageSetup paperSize='1' orientation="landscape" scale="80" fitToWidth="0" fitToHeight='0' paperWidth="200mm" paperHeight="300mm" usePrinterDefaults="1" blackAndWhite="1"${close}`);
  }
  source=source.replace(`</${p}worksheet>`,`<${p}headerFooter><${p}oddFooter>Keep footer</${p}oddFooter></${p}headerFooter><${p}drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="drawing1"/></${p}worksheet>`);
  template.set('xl/worksheets/sheet1.xml',enc.encode(source));
  const files=entries(await buildOrderXlsx({items:Array.from({length:300},()=>({quantity:1,description:'QA'}))},await buildZip([...template].map(([name,data])=>({name,data})))));
  for(let page=1;page<=10;page++){
    const sheet=dec.decode(files.get(`xl/worksheets/sheet${page}.xml`));
    assert.equal([...sheet.matchAll(new RegExp(`<${p}sheetPr\\b`,'g'))].length,1);
    assert.equal([...sheet.matchAll(new RegExp(`<${p}pageSetUpPr\\b`,'g'))].length,1);
    assert.equal([...sheet.matchAll(new RegExp(`<${p}pageSetup\\b`,'g'))].length,1);
    assert.match(sheet,new RegExp(`<${p}pageSetUpPr[^>]*fitToPage="1"`));
    const setup=sheet.match(new RegExp(`<${p}pageSetup\\b[^>]*>`))[0];
    for(const attribute of ['paperSize="9"','orientation="portrait"','fitToWidth="1"','fitToHeight="1"','usePrinterDefaults="0"'])assert.ok(setup.includes(attribute),attribute);
    assert.doesNotMatch(setup,/\b(?:scale|paperWidth|paperHeight)=/);
    assert.ok(sheet.indexOf(`<${p}sheetPr`)<sheet.indexOf(`<${p}cols`));
    assert.ok(sheet.indexOf(`<${p}pageMargins`)<sheet.indexOf(`<${p}pageSetup`));
    assert.ok(sheet.indexOf(`<${p}pageSetup`)<sheet.indexOf(`<${p}headerFooter`));
    assert.match(sheet,/Keep footer/);assert.match(sheet,/r:id="drawing1"/);
    if(variant!=='missing')assert.match(sheet,/codeName="KeepMe"/);
    if(variant==='existing'||variant==='expanded'){
      assert.match(sheet,/tabColor rgb="FFFF0000"/);assert.match(sheet,/outlinePr summaryBelow="0"/);
      assert.match(sheet,/autoPageBreaks="0"/);assert.match(setup,/blackAndWhite="1"/);
    }
  }
  assert.deepEqual(files.get('xl/styles.xml'),template.get('xl/styles.xml'));
});
