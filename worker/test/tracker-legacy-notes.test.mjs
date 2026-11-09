import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {buildSiteOrderRows,buildSiteOrderFeed,siteOrdersSheet,SITE_ORDER_COLUMNS,SITE_ORDER_ROW_COLUMNS} from '../src/site-orders-excel.js';
const base={id:'12345678-1234-4234-8234-123456789012',orderNumber:'25',project:'Example',status:'approved',createdAt:'2026-11-04T00:00:00Z',items:[{quantity:1,description:'ITEM'}]};
const row=patch=>buildSiteOrderRows([{...base,...patch}])[0];
const cells=html=>[...html.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);
test('older non-panel Notes appear in Order notes and leave Location blank',()=>{
 for(const orderType of ['Consumables','Fixings','Other','Plant / Equipment','Gate','Fibre Cement','Fabrication','']){
  const order={...base,orderType,locationNotes:'Consumables'},before=structuredClone(order),result=buildSiteOrderRows([order])[0];
  assert.equal(result.Location,'',orderType);assert.equal(result['Order notes'],'Consumables',orderType);assert.equal(result.Notes,'',orderType);assert.deepEqual(order,before);
  assert.deepEqual(Object.keys(result),SITE_ORDER_ROW_COLUMNS);assert.equal(SITE_ORDER_COLUMNS.indexOf('Schedule delivery')+1,SITE_ORDER_COLUMNS.indexOf('Drawn'));
 }
});
test('older Panel locations stay in Location while explicit locations and Gate villas retain precedence',()=>{
 for(const orderType of ['Panels',' PANELS ']){const result=row({orderType,locationNotes:'C1 fascia Panels'});assert.equal(result.Location,'C1 fascia Panels');assert.equal(result['Order notes'],'');}
 const panel=row({orderType:'Panels',location:'North elevation',notes:'Keep wrapped',locationNotes:'Historical instructions'});
 assert.equal(panel.Location,'North elevation');assert.equal(panel['Order notes'],'Keep wrapped\n\nHistorical instructions');assert.equal(panel.Notes,'');
 const gate=row({orderType:'Gate',villa:'V135',locationNotes:'Keep wrapped',manualProduction:{areaM2:12.5,stages:{drawn:'complete'}}});
 assert.equal(gate.Location,'V135');assert.equal(gate['Order notes'],'Keep wrapped');assert.equal(gate.Notes,'Gate area: 12.5 m²');
 const corrected=row({orderType:'Fixings',location:'Loading bay',locationNotes:'Consumables'});assert.equal(corrected.Location,'Loading bay');assert.equal(corrected['Order notes'],'Consumables');
});
test('current and historical notes are retained once and stay separate from dispatch and production messages',()=>{
 const order={...base,orderType:'Consumables',notes:'Current note',locationNotes:'Older note',status:'dispatched'};
 const loads=[{project:base.project,orderNumber:base.orderNumber,status:'dispatched_to_site',legs:[{notes:'Delivered by truck'}]}];
 const result=buildSiteOrderRows([order],[],[],loads)[0];assert.equal(result['Order notes'],'Current note\n\nOlder note');assert.equal(result.Notes,'Delivered by truck');
 assert.equal(row({...order,notes:'Older note'})['Order notes'],'Older note');
});
test('refresh feeds and workbook cells put the legacy note in the correct column without shifting layouts',()=>{
 const result=row({orderType:'Consumables',locationNotes:'Consumables'});
 for(const [args,count,location,notes] of [[[false],17,5,16],[[true,false],18,6,17],[[true,true,false],19,6,17],[[true,true,true,false],20,6,17],[[true,true,true,true,false],20,6,7],[[],20,6,7]]){
  const values=cells(buildSiteOrderFeed([result],...args));assert.equal(values.length,count);assert.equal(values[location],'');assert.equal(values[notes],'Consumables');
 }
 const sheet=siteOrdersSheet([result],()=>''),cell=ref=>sheet.match(new RegExp('<c r="'+ref+'"[^>]*(?:/>|>[\\s\\S]*?</c>)'))?.[0]||'';
 assert.doesNotMatch(cell('G2'),/Consumables/);assert.match(cell('H2'),/Consumables/);assert.doesNotMatch(cell('S2'),/Consumables/);
 const unsafe=row({orderType:'Consumables',locationNotes:'=1+1 & <note>'}),feed=buildSiteOrderFeed([unsafe]),safeSheet=siteOrdersSheet([unsafe],()=> '');
 assert.match(feed,/&amp; &lt;note&gt;/);assert.match(safeSheet,/<c r="H2"[^>]*t="inlineStr"/);assert.doesNotMatch(safeSheet,/<c r="H2"[^>]*><f>/);
});
test('an old-style order round trips to the public tracker feed without rewriting the saved order',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'legacy-notes-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'legacy-notes-test',CNC_PUBLIC_TOKEN:'synthetic-legacy-notes',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;const request=async(path,body)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));token=(await request('/login',{username:'admin',pin:'123456'})).body.token;assert.ok(token);
  assert.equal((await request('/order-types',{name:'Consumables'})).status,200);
  const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Legacy notes example',siteContact:'PRIVATE CONTACT',phone:'PRIVATE PHONE',orderType:'Consumables',locationNotes:'Consumables',requestedDeliveryDate:'2026-11-10',items:base.items}});assert.equal(created.status,201);const order=created.body.order;assert.equal(order.notes,'');const before=(await request('/orders/'+order.id)).body.order;
  const response=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-legacy-notes&report=site-orders&siteOrdersVersion=6');assert.equal(response.status,200);const html=await response.text(),values=cells(html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g).find(value=>value.includes(order.id)));
  assert.equal(values[6],'');assert.equal(values[7],'Consumables');assert.equal(values[18],'');assert.doesNotMatch(html,/PRIVATE CONTACT|PRIVATE PHONE/);
  assert.deepEqual((await request('/orders/'+order.id)).body.order,before);
 }finally{await mf.dispose();}
});
