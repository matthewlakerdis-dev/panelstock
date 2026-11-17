import test from 'node:test';
import assert from 'node:assert/strict';
import {activeOrdersReport,ACTIVE_ORDER_STATUSES} from '../src/active-orders-report.js';
import {createActiveOrdersReportPdf,activeOrdersReportFilename,reportDate} from '../src/active-orders-report-pdf.js';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';

const stamp='2026-11-17T15:00:00.000Z',admin={isAdmin:true,username:'admin'};
const base=(id,patch={})=>({id,orderNumber:id,project:'Tower',orderType:'Fixings',status:'submitted',requestedBy:'alice',dateOrdered:stamp,siteContact:'Alice Smith',phone:'0400 123 456',requestedDeliveryDate:'2026-11-20',items:[{description:'ALUMINIUM ANGLE',quantity:3}],...patch});
function fixture(orders){
  const data={orders,projects:[{id:'p1',name:'Tower',address:'1 Site Road'},{id:'p2',name:'Ambiguous',address:'Wrong 1'},{id:'p3',name:'ambiguous',address:'Wrong 2'}],users:{alice:{displayName:'Alice Smith',pinHash:'SECRET PIN',email:'private@example.test'}},'order-admin-notes:2':[{text:'Visible to Alice and admins',author:'manager',createdAt:stamp}],'order-admin-notes:other':[{text:'PRIVATE OTHER REQUESTER NOTE',author:'manager',createdAt:stamp}]};
  const store={read:(key,fallback)=>data[key]??fallback,requireTask(actor,task){if(!actor.isAdmin&&!actor.tasks?.[task])throw Object.assign(Error('Denied'),{status:403});}};
  return {data,store,report:(actor=admin)=>activeOrdersReport(store,actor,new Date(stamp))};
}
async function rendered(bytes){
  const pdf=await PDFDocument.load(bytes),glyphs=new Map();
  for(const [,object]of pdf.context.enumerateIndirectObjects())if(object instanceof PDFRawStream&&!object.dict.get(PDFName.of('Subtype'))){
    const source=new TextDecoder().decode(decodePDFRawStream(object).decode());
    for(const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,glyph,unicode]of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))glyphs.set(glyph.toUpperCase(),(unicode.match(/.{4}/g)||[]).map(hex=>String.fromCharCode(parseInt(hex,16))).join(''));
  }
  const pages=pdf.getPages().map(page=>{
    const contents=page.node.Contents(),streams=contents instanceof PDFRawStream?[contents]:(contents?.asArray()||[]).map(ref=>pdf.context.lookup(ref));
    const fonts=page.node.Resources().lookup(PDFName.of('Font'));
    return streams.flatMap(stream=>[...new TextDecoder().decode(decodePDFRawStream(stream).decode()).matchAll(/\/([^\s]+) [\d.]+ Tf[\s\S]*?<([0-9A-F]+)>\s*Tj/gi)].map(([,name,hex])=>{
      const ascii=fonts.lookup(PDFName.of(name)).get(PDFName.of('BaseFont'))?.toString().includes('Helvetica');
      return ascii?(hex.match(/.{2}/g)||[]).map(code=>String.fromCharCode(parseInt(code,16))).join(''):(hex.match(/.{4}/g)||[]).map(code=>glyphs.get(code.toUpperCase())||'').join('');
    })).join('\n');
  });
  return {pdf,pages,text:pages.join('\n')};
}

test('the current saved snapshot includes exactly the active statuses, groups by project and naturally sorts order numbers',()=>{
  const {data,report}=fixture([...ACTIVE_ORDER_STATUSES.map((status,i)=>base(String(i+1),{status})),base('done',{status:'dispatched'}),base('cancel',{status:'cancelled'}),base('draft',{status:'draft'}),base('10'),base('2',{project:'Another tower'}),base('other',{requestedBy:'bob'})]);
  const before=JSON.stringify(data),r=report();assert.equal(r.orders.length,8);assert.equal(r.orders[0].project,'Another tower');assert.deepEqual(r.orders.filter(o=>o.project==='Tower').map(o=>o.orderNumber),['1','2','3','4','5','10','other']);
  assert.equal(r.orders.find(o=>o.status==='completed').statusLabel,'Ready for dispatch');assert.equal(r.generatedAt,stamp);assert.equal(r.generatedBy,'admin');assert.equal(JSON.stringify(data),before);
  assert.ok(!JSON.stringify(r).includes('SECRET PIN'));assert.ok(!JSON.stringify(r).includes('private@example.test'));
});
test('locations, Villas, colours, separate notes, exact project addresses and partial ordered quantities remain distinct',()=>{
  const {report}=fixture([base('panel',{orderType:'Panels',locationNotes:'C1 fascia Panels'}),base('2',{projectId:'p1',orderType:'Bin Gate',villa:'V132',colour:'Spruce',manualProduction:{areaM2:4.5},notes:'Deliver first',locationNotes:'Historical note',dispatches:[{lines:[{index:0,quantity:2}]}]}),base('duplicate',{project:'Ambiguous'}),base('unknown-id',{projectId:'missing'})]);
  const r=report(),byId=new Map(r.orders.map(o=>[o.id,o])),panel=byId.get('panel'),gate=byId.get('2');
  assert.equal(panel.location,'C1 fascia Panels');assert.equal(panel.notes,'');assert.equal(panel.siteAddress,'1 Site Road');
  assert.equal(gate.locationLabel,'Villa');assert.equal(gate.location,'V132');assert.equal(gate.colour,'Spruce');assert.equal(gate.areaM2,4.5);assert.equal(gate.notes,'Deliver first\n\nHistorical note');assert.equal(gate.items[0].quantity,3);assert.equal(gate.siteAddress,'1 Site Road');assert.equal(gate.requestedByName,'Alice Smith (alice)');
  assert.equal(byId.get('duplicate').siteAddress,'');assert.equal(byId.get('unknown-id').siteAddress,'');
});
test('view permission is mandatory and admin notes keep their per-order visibility',()=>{
  const {report}=fixture([base('2'),base('other',{requestedBy:'bob'})]);
  for(const actor of [{username:'alice',tasks:{}},{username:'dispatcher',tasks:{'factory.dispatch':true}}])assert.throws(()=>report(actor),error=>error.status===403);
  const mine=report({username:'alice',tasks:{'site.orders.view':true}});assert.equal(mine.orders.find(o=>o.id==='2').adminNotes.length,1);assert.equal(mine.orders.find(o=>o.id==='other').adminNotes.length,0);assert.ok(!JSON.stringify(mine).includes('PRIVATE OTHER'));
  assert.equal(report().orders.find(o=>o.id==='other').adminNotes.length,1);
});
test('report dates and filenames use Brisbane, including midnight and a blank schedule',()=>{
  assert.equal(activeOrdersReportFilename({generatedAt:stamp}),'Active_Site_Orders_2026-11-18.pdf');
  assert.match(reportDate(stamp),/18 Nov 2026/);assert.match(reportDate('2026-11-20'),/20 Nov 2026/);assert.equal(reportDate('invalid'),'Not set');assert.equal(reportDate(''),'Not set');assert.match(reportDate(stamp,{time:true}),/01:00 AEST/);
});
test('PDF preserves all order details, Unicode, dated notes, ordered quantities and branded page metadata',async()=>{
  const {report}=fixture([base('2',{project:'Lennox façades — Δοκιμή',orderType:'Bin Gate',villa:'V132',colour:'Spruce',notes:'Handle with care',scheduledDeliveryDate:'2026-11-21',scheduledDeliveryTime:'09:30',requestedDeliveryTime:'07:00',items:[{quantity:1.5,description:'V132 FRONT BIN GATE SET - SPRUCE'}]})]);
  const r=report(),before=JSON.stringify(r),{pdf,pages,text}=await rendered(await createActiveOrdersReportPdf(r));
  assert.equal(JSON.stringify(r),before);assert.equal(pdf.getTitle(),'Lennox Facades — Active Site Orders');assert.equal(pdf.getCreationDate().toISOString(),stamp);
  assert.equal(pdf.getSubject(),'Layout A — Compact register');
  for(const value of ['COMPACT REGISTER','ACTIVE SITE ORDERS','ORDERED','REQUESTED','SCHEDULED','STATUS','18 Nov 2026','20 Nov 2026','21 Nov 2026','07:00','09:30','Submitted','Villa: V132','Colour: Spruce','Alice Smith (alice)','0400 123 456','Handle with care','Visible to Alice and admins','V132 FRONT BIN GATE SET - SPRUCE','1.5','Lennox façades — Δοκιμή','ITEMS / ORDERED QTY'])assert.ok(text.replace(/\s+/g,' ').includes(value),value);
  assert.equal(pages.length,1);assert.match(pages[0],/Page 1 of 1/);assert.equal(pdf.getPages()[0].getWidth(),842);assert.equal(pdf.getPages()[0].getHeight(),595);
  assert.ok(pdf.context.enumerateIndirectObjects().some(([,o])=>o instanceof PDFRawStream&&o.dict.get(PDFName.of('Subtype'))?.toString()==='/Image'));
});
test('empty reports are readable, and long notes and hundreds of items continue without clipping or dropping details',async()=>{
  const empty=await rendered(await createActiveOrdersReportPdf(fixture([]).report()));assert.equal(empty.pages.length,1);assert.match(empty.text,/0 active orders/);assert.match(empty.text,/No active Site Orders/);
  const notes=Array.from({length:90},(_,i)=>`Distinct note ${i}: ${'VERY_LONG_NOTE_'.repeat(16)}`).join('\n')+' FINAL_NOTE';
  const items=Array.from({length:300},(_,i)=>({quantity:i+1,description:`ITEM_${String(i).padStart(3,'0')} ${'LONG_DESCRIPTION_'.repeat(9)}`}));
  const {pdf,pages,text}=await rendered(await createActiveOrdersReportPdf(fixture([base('large',{notes,items})]).report()));
  assert.ok(pages.length>5);assert.match(text,/FINAL_NOTE/);for(let i=0;i<300;i++)assert.ok(text.includes(`ITEM_${String(i).padStart(3,'0')}`),'Item '+i);
  for(let i=0;i<pages.length;i++){assert.match(pages[i],/ACTIVE SITE ORDERS/);assert.ok(pages[i].includes(`Page ${i+1} of ${pages.length}`));if(i>0)assert.match(pages[i],/#large/);if(/ITEM_/.test(pages[i]))assert.match(pages[i],/ITEMS \/ ORDERED QTY/);}
  // Every text baseline stays inside the page and clear of the footer.
  for(const page of pdf.getPages())for(const ref of page.node.Contents().asArray()){
    const source=new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref)).decode());
    for(const match of source.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)){assert.ok(Number(match[1])>=34);assert.ok(Number(match[2])>=19&&Number(match[2])<595);}
  }
});

test('compact register keeps several ordinary orders on one page with ordered/requested/scheduled/status columns',async()=>{
  const orders=[base('first',{items:Array.from({length:7},(_,i)=>({description:'FIRST ORDER ITEM '+i,quantity:1}))}),base('second',{orderType:'Bin Gate',villa:'V132',colour:'Spruce',manualProduction:{areaM2:4},notes:'Keep the full order together'})];
  const {pages,text}=await rendered(await createActiveOrdersReportPdf(fixture(orders).report()));
  assert.equal(pages.length,1);assert.ok(pages[0].includes('FIRST ORDER ITEM 6'));assert.ok(pages[0].includes('#second'));assert.ok(pages[0].includes('ALUMINIUM ANGLE'));assert.ok(!text.includes('(continued)'));
  assert.ok(text.indexOf('ORDERED')<text.indexOf('REQUESTED'));assert.ok(text.indexOf('REQUESTED')<text.indexOf('SCHEDULED'));assert.ok(text.indexOf('SCHEDULED')<text.indexOf('STATUS'));
});
