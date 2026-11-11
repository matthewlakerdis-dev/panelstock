import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {buildSiteOrderRows,splitSiteOrderRows} from '../src/site-orders-excel.js';
import {buildXlsxBytes} from '../src/reports.js';
import {CNC_COLUMNS} from '../src/cnc-excel.js';
function partsOf(bytes){const b=Buffer.from(bytes),parts={};let p=0;while(b.readUInt32LE(p)===0x04034b50){const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),extra=b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;parts[name]=inflateRawSync(b.subarray(start,start+size)).toString();p=start+size;}return parts;}
const id='12345678-1234-4234-8234-123456789012',source={id,project:'Ready order',orderType:'Fixings',status:'completed',dateOrdered:'2026-11-09T00:00:00Z'};
test('only saved Dispatched status moves orders; readiness and descriptive dispatch notes keep their existing sheet',()=>{
 const rows=buildSiteOrderRows([source,{...source,id:'22222222-2222-4222-8222-222222222222',status:'dispatched',project:'Sent order'},{...source,id:'33333333-3333-4333-8333-333333333333',status:'cancelled',project:'Cancelled order'}]);rows[0].Notes='Dispatched to site';const before=structuredClone(rows),split=splitSiteOrderRows(rows);
 assert.deepEqual(split.active.map(row=>row.Project),['Ready order','Cancelled order']);assert.deepEqual(split.completed.map(row=>row.Project),['Sent order']);assert.deepEqual(rows,before);assert.equal(split.active[0].Action.includes('orderAction=dispatch'),true);assert.equal(split.completed[0].Action,'');assert.equal(split.completed[0]['Schedule delivery'],'');
});
test('Completed Orders has its own matching columns, styles, brand, query, range and relationship in six-sheet downloads',async()=>{
 const rows=buildSiteOrderRows([source,{...source,id:'22222222-2222-4222-8222-222222222222',status:'dispatched',project:'Sent order'}]);
 for(const input of [rows,rows.slice(0,1),rows.slice(1),[]]){
  const {active,completed}=splitSiteOrderRows(input),parts=partsOf(await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/feed?token=synthetic',undefined,input)),current=parts['xl/worksheets/sheet5.xml'],archived=parts['xl/worksheets/sheet6.xml'];
  assert.equal((parts['xl/workbook.xml'].match(/<sheet /g)||[]).length,6);assert.match(parts['xl/workbook.xml'],/<sheet name="Completed Orders" sheetId="6" r:id="rId9"/);assert.ok(parts['xl/workbook.xml'].includes(`name="Completed_Orders" localSheetId="5">'Completed Orders'!$A$2:$U$${Math.max(2,completed.length+1)}`));assert.ok(parts['xl/workbook.xml'].includes(`name="Site_Orders" localSheetId="0">'Site Orders'!$A$2:$U$${Math.max(2,active.length+1)}`));
  assert.match(parts['xl/_rels/workbook.xml.rels'],/Id="rId9"[^>]+Target="worksheets\/sheet6.xml"/);assert.match(parts['[Content_Types].xml'],/PartName="\/xl\/worksheets\/sheet6.xml"/);assert.match(parts['[Content_Types].xml'],/PartName="\/xl\/queryTables\/queryTable6.xml"/);
  assert.equal(current.match(/<row r="1"[\s\S]*?<\/row>/)[0],archived.match(/<row r="1"[\s\S]*?<\/row>/)[0]);
  for(const [xml,list] of [[current,active],[archived,completed]]){assert.equal((xml.match(/<row r=/g)||[]).length,list.length+1);assert.match(xml,/sqref="M2:T5000"/);assert.match(xml,/row r="1" ht="142"/);assert.match(xml,/drawing r:id="rIdBrand"/);assert.match(xml,/pane ySplit="1"/);}
  assert.equal(current.includes('Sent order'),false);assert.equal(archived.includes('Ready order'),false);
  assert.match(parts['xl/drawings/completedOrdersBrand.xml'],/>Completed Orders</);assert.match(parts['xl/worksheets/_rels/sheet6.xml.rels'],/queryTable6.xml/);assert.match(parts['xl/worksheets/_rels/sheet6.xml.rels'],/completedOrdersBrand.xml/);assert.match(parts['xl/drawings/_rels/completedOrdersBrand.xml.rels'],/lennox-logo.png/);
  const connection=[...parts['xl/connections.xml'].matchAll(/<connection\b[^>]*>[\s\S]*?<\/connection>/g)].map(m=>m[0]).find(s=>s.includes('id="6"'));assert.match(connection,/report=completed-orders&amp;siteOrdersVersion=13/);assert.match(connection,/refreshOnLoad="1" interval="15"/);assert.match(parts['xl/queryTables/queryTable6.xml'],/name="Completed_Orders"[^>]+connectionId="6"[^>]+preserveFormatting="1" adjustColumnWidth="0" growShrinkType="insertDelete"/);
 }
});
test('real dispatch moves an order between refresh feeds, preserves signed PDFs, and keeps old downloads complete',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'completed-tracker-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'completed-tracker-test',CNC_PUBLIC_TOKEN:'synthetic-completed-feed',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;const api=async(path,body)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
 const feed=async(report,version=13)=>{const r=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-completed-feed&report='+report+'&siteOrdersVersion='+version);assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);return r.text();};
 const blank=html=>{assert.equal((html.match(/<td /g)||[]).length,21);assert.doesNotMatch(html,/<a |x:num=|Synthetic dispatch order/);};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));token=(await api('/login',{username:'admin',pin:'123456'})).token;
  let order=(await api('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Synthetic dispatch order',orderType:'Fixings',siteContact:'Contact',phone:'PRIVATE PHONE',notes:'Optional note',requestedDeliveryDate:'2026-11-15',items:[{quantity:1,description:'Fixing pack'}]}})).order;
  assert.match(await feed('site-orders'),/Synthetic dispatch order/);blank(await feed('completed-orders'));
  order=(await api('/orders/'+order.id+'/status',{status:'completed',expectedUpdatedAt:order.updatedAt})).order;let current=await feed('site-orders');assert.match(current,/orderAction=dispatch/);blank(await feed('completed-orders'));
  const cells=html=>[...html.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);assert.equal(cells(current)[20],'Ready for dispatch');assert.equal(cells(current)[19],'✓');const oldReady=cells(await feed('site-orders',12));assert.equal(oldReady[12],'Ready for dispatch');assert.equal(oldReady[20],'✓');
  const pdf=current.match(new RegExp('href="([^"]*/orders/'+order.id+'/pdf\\?tracker=[a-f0-9]{64})"'))[1];
  order=(await api('/dispatch/orders',{id:order.id,expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),destination:'Site',transport:'Truck',driver:'Driver'})).order;assert.equal(order.status,'dispatched');
  blank(await feed('site-orders'));const archived=await feed('completed-orders');assert.match(archived,/Synthetic dispatch order/);assert.match(archived,/Optional note/);assert.match(archived,/Dispatched to site/);assert.ok(archived.includes(pdf));assert.doesNotMatch(archived,/orderAction=|PRIVATE PHONE/);assert.equal(cells(archived)[20],'Dispatched to site');assert.equal(cells(await feed('completed-orders',12))[12],'Dispatched to site');
  for(let v=1;v<=11;v++)assert.match(await feed('site-orders',v),/Synthetic dispatch order/);
  const downloaded=await mf.dispatchFetch('http://localhost/cnc-tracker?token=synthetic-completed-feed');const parts=partsOf(await downloaded.arrayBuffer());assert.doesNotMatch(parts['xl/worksheets/sheet5.xml'],/Synthetic dispatch order/);assert.match(parts['xl/worksheets/sheet6.xml'],/Synthetic dispatch order/);assert.ok(parts['xl/worksheets/sheet6.xml'].includes(pdf));
  const publicPdf=await mf.dispatchFetch(pdf);assert.equal(publicPdf.status,200);assert.equal(publicPdf.headers.get('Content-Type'),'application/pdf');await publicPdf.arrayBuffer();
  for(const query of ['token=wrong&report=completed-orders&siteOrdersVersion=12','token=synthetic-completed-feed&report=completed-orders&siteOrdersVersion=11'])assert.equal((await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?'+query)).status,404);
 }finally{await mf.dispose();}
});
