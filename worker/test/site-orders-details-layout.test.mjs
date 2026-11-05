import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteOrderRows,buildSiteOrderFeed,siteOrdersSheet,SITE_ORDER_COLUMNS,siteOrderDate} from '../src/site-orders-excel.js';
const source={id:'12345678-1234-4234-8234-123456789012',project:'Example',orderNumber:'057',orderType:'Panels',status:'approved',location:'North elevation',notes:'Keep wrapped',requestedDeliveryDate:'2026-11-09',scheduledDeliveryDate:'2026-11-10',phone:'PRIVATE PHONE',attachments:['PRIVATE FILE']};
const cells=html=>[...html.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);
test('Site Orders puts optional Order notes beside Location and production Notes after dispatch readiness',()=>{
 const row=buildSiteOrderRows([source])[0];
 assert.deepEqual(Object.keys(row),SITE_ORDER_COLUMNS);
 assert.deepEqual(SITE_ORDER_COLUMNS.slice(6,12),['Location','Order notes','Requested date','Scheduled date','Status','Drawn']);
 assert.equal(row.Location,'North elevation');assert.equal(row['Order notes'],'Keep wrapped');assert.equal(row.Notes,'');
 assert.equal(SITE_ORDER_COLUMNS.indexOf('Action'),19);assert.equal(SITE_ORDER_COLUMNS.indexOf('Schedule delivery'),20);
 const feed=buildSiteOrderFeed([row]),values=cells(feed);assert.equal(values.length,21);
 assert.equal(values[6],'North elevation');assert.equal(values[7],'Keep wrapped');assert.equal(values[8],'09/11/2026');assert.equal(values[9],'10/11/2026');assert.equal(values[10],'Approved');
 assert.doesNotMatch(feed,/PRIVATE PHONE|PRIVATE FILE/);
 const sheet=siteOrdersSheet([row],()=> '');
 assert.match(sheet,/<c r="G1"[^>]*><is><t xml:space="preserve">Location<\/t>/);assert.match(sheet,/<c r="H1"[^>]*><is><t xml:space="preserve">Order notes<\/t>/);
 assert.match(sheet,/<c r="G2"[^>]*><is><t xml:space="preserve">North elevation<\/t>/);assert.match(sheet,/<c r="H2"[^>]*><is><t xml:space="preserve">Keep wrapped<\/t>/);
 for(const [ref,value] of [['I',row['Requested date']],['J',row['Scheduled date']]])assert.ok(sheet.includes(`<c r="${ref}2" s="6" t="n"><v>${value}</v>`));
 assert.match(sheet,/sqref="L2:R5000"/);assert.match(sheet,/OR\(L2="✓",L2="n\/a"\)/);assert.doesNotMatch(sheet,/Location \/ notes/);
});
test('Gate Villa and historical details remain readable alongside order and dispatch notes',()=>{
 const gate=buildSiteOrderRows([{...source,orderType:'Gate',villa:'V135',manualProduction:{areaM2:12.5,stages:{drawn:'complete'}}}])[0];
 assert.equal(gate.Location,'V135');assert.equal(gate['Order notes'],'Keep wrapped');assert.doesNotMatch(gate.Notes,/Keep wrapped/);assert.match(gate.Notes,/Gate area: 12\.5 m²/);
 const legacy=buildSiteOrderRows([{...source,location:'',notes:'',locationNotes:'Original unsplit text'}])[0];assert.equal(legacy.Location,'Original unsplit text');assert.equal(legacy.Notes,'');
 const loads=[{project:source.project,orderNumber:source.orderNumber,status:'dispatched_to_site',legs:[{notes:'Use loading bay'}]}];
 const combined=buildSiteOrderRows([{...source,locationNotes:'Historical delivery instructions'}],[],[],loads)[0];assert.equal(combined.Location,source.location);assert.equal(combined['Order notes'],'Keep wrapped\n\nHistorical delivery instructions');assert.equal(combined.Notes,'Use loading bay');
 const deduplicated=buildSiteOrderRows([{...source,notes:'Use loading bay'}],[],[],loads)[0];assert.equal(deduplicated['Order notes'],'Use loading bay');assert.equal(deduplicated.Notes,'Use loading bay');
});
test('all previous feed versions keep their old column order while new feeds use separate details',()=>{
 const row=buildSiteOrderRows([source])[0];
 for(const [args,count,location,requested,scheduled,status,notes] of [
  [[false],17,5,6,7,8,16],[[true,false],18,6,7,8,9,17],[[true,true,false],19,6,7,8,9,17],[[true,true,true,false],20,6,7,8,9,17],[[true,true,true,true,false],20,6,8,9,10,7]
 ]){
  const feed=buildSiteOrderFeed([row],...args),values=cells(feed);assert.equal(values.length,count);
  assert.equal(values[location],'North elevation');assert.equal(values[requested],'09/11/2026');assert.equal(values[scheduled],'10/11/2026');assert.equal(values[status],'Approved');assert.equal(values[notes],'Keep wrapped');
 }
 assert.equal(row['Requested date'],siteOrderDate('2026-11-09'));
 const unsafe=buildSiteOrderRows([{...source,location:'=1+1 <script>',notes:'=HYPERLINK("https://example.test") & instructions'}])[0];
 const feed=buildSiteOrderFeed([unsafe]);assert.match(feed,/=1\+1 &lt;script&gt;/);assert.match(feed,/&amp; instructions/);assert.doesNotMatch(feed,/<script>/);
 const sheet=siteOrdersSheet([unsafe],()=> '');assert.match(sheet,/<c r="H2"[^>]*t="inlineStr"/);assert.doesNotMatch(sheet,/<c r="H2"[^>]*><f>/);
});

test('saved panel and gate details reach the public refresh feed in every workbook version',async()=>{
 const {Miniflare,convertV4MiniflareOptions}=await import('miniflare'),fs=await import('node:fs'),{createHash}=await import('node:crypto');
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'tracker-details-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'tracker-details-test',CNC_PUBLIC_TOKEN:'synthetic-details-feed',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;
 const request=async(path,body)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));
  token=(await request('/login',{username:'admin',pin:'123456'})).body.token;assert.ok(token);assert.equal((await request('/order-types',{name:'Gate'})).status,200);
  for(const orderType of ['Panels','Gate']){
   const input={project:'Tracker details '+orderType,siteContact:'Synthetic contact',phone:'PRIVATE PHONE',orderType,location:'North elevation',villa:'V135',notes:'Keep wrapped',requestedDeliveryDate:'2026-11-09',items:[{quantity:1,description:'Synthetic item'}]};
   const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:input});assert.equal(created.status,201,JSON.stringify(created.body));const order=created.body.order;
   const scheduled=await request('/orders/'+order.id+'/delivery',{expectedUpdatedAt:order.updatedAt,scheduledDeliveryDate:'2026-11-10',scheduledDeliveryTime:''});assert.equal(scheduled.status,200);
   if(orderType==='Gate'){const cancelled=await request('/orders/'+order.id+'/status',{expectedUpdatedAt:scheduled.body.order.updatedAt,status:'cancelled'});assert.equal(cancelled.status,200);}
   for(const [version,count,location,notes,requested,scheduled] of [['1',17,5,16,6,7],['2',18,6,17,7,8],['3',19,6,17,7,8],['4',20,6,17,7,8],['5',20,6,7,8,9],['6',21,6,7,8,9]]){
    const response=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-details-feed&report=site-orders&siteOrdersVersion='+version);assert.equal(response.status,200);
    const html=await response.text(),row=html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g).find(row=>row.includes(order.id));assert.ok(row);const values=cells(row);assert.equal(values.length,count);
    assert.equal(values[location],orderType==='Gate'?'V135':'North elevation');assert.equal(values[notes],version==='6'?'Keep wrapped':(orderType==='Gate'?'Keep wrapped; Order cancelled':'Keep wrapped'));if(version==='6')assert.equal(values[18],orderType==='Gate'?'Order cancelled':'');assert.equal(values[requested],'09/11/2026');assert.equal(values[scheduled],'10/11/2026');assert.doesNotMatch(html,/PRIVATE PHONE/);
   }
  }
 }finally{await mf.dispose();}
});

test('dispatch and production messages stay in Notes and cannot fill an empty optional Order notes cell',()=>{
 const loads=[{project:source.project,orderNumber:source.orderNumber,status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}]}];
 for(const [order,load,message] of [[{...source,status:'dispatched'},[],'Dispatched to site'],[source,loads,'At powder coaters']]){
  for(const optional of ['',source.notes]){
   const row=buildSiteOrderRows([{...order,notes:optional}],[],[],load)[0],values=cells(buildSiteOrderFeed([row]));
   assert.equal(row['Order notes'],optional);assert.equal(values[7],optional);assert.match(row.Notes,new RegExp(message));assert.match(values[18],new RegExp(message));
   const sheet=siteOrdersSheet([row],()=> '');assert.ok(sheet.includes('<c r="S2"'));assert.match(sheet,/<c r="S1"[^>]*><is><t xml:space="preserve">Notes<\/t>/);
  }
 }
});
