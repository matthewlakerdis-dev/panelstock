import {receiptAck} from './receipt-ack-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {gateComponentSlots,gateComponentSpec,handleGateComponents,gateComponentOrders} from '../src/gate-components.js';
import {gateProgressStages} from '../src/gate-progress-stages.js';
import {gateProgressSample} from '../src/gate-progress-sample.js';
import {gateProgressRows,buildGateProgressDraft,GATE_PROGRESS_HEADERS} from '../src/gate-progress-excel.js';
function partsOf(bytes){const b=Buffer.from(bytes),parts={};let p=0;while(b.readUInt32LE(p)===0x04034b50){const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),extra=b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;parts[name]=inflateRawSync(b.subarray(start,start+size)).toString();p=start+size;}return parts;}
test('gate templates establish physical components by set without multiplying the order area',async()=>{
 assert.throws(()=>handleGateComponents({env:{}},'/gate-components','GET',{},{}),error=>error.status===404);
 for(const type of ['Bin Gate','Side Access Gate'])for(const highlights of [[1],[2],[1,1],[2,1],[2,2]]){const slots=gateComponentSlots(type,{highlights});assert.equal(slots.length,highlights.reduce((sum,n)=>sum+n+2,0));assert.equal(new Set(slots.map(s=>s.key)).size,slots.length);}
 for(const gateCount of [1,2])assert.equal(gateComponentSlots('Buggy Gate',{gateCount}).length,gateCount);
 for(const [type,spec] of [['Buggy Gate',{gateCount:3}],['Bin Gate',{highlights:[]}],['Bin Gate',{highlights:[0]}],['Side Access Gate',{highlights:[1,1,1]}],['Fixings',{highlights:[1]}]])assert.throws(()=>gateComponentSlots(type,spec));
 const sample=gateProgressSample(),rows=gateProgressRows(sample.orders);assert.equal(rows.filter(r=>r.kind==='villa').length,2);assert.ok(rows.filter(r=>r.kind==='villa').every(r=>r.values.slice(5,11).every(value=>value==='')));assert.equal(rows.filter(r=>r.kind==='order').length,2);assert.match(rows.find(r=>r.kind==='order').values[4],/Order 41 — Bin Gate — Villa V135/);assert.equal(rows.filter(r=>r.kind==='component').length,9);assert.equal(rows.reduce((sum,r)=>sum+(Number(r.values[GATE_PROGRESS_HEADERS.indexOf('Order area (m²)')])||0),0),20.5);assert.ok(rows.filter(r=>r.kind==='component').every(r=>r.values[GATE_PROGRESS_HEADERS.indexOf('Order area (m²)')]===''));
 const sent=rows.find(r=>r.kind==='component'&&r.values[GATE_PROGRESS_HEADERS.indexOf('Dispatched')]==='✓');assert.equal(sent.values[GATE_PROGRESS_HEADERS.indexOf('Ready for dispatch')],'✓');assert.equal(sent.values[GATE_PROGRESS_HEADERS.indexOf('Fabricated/QA')],'✓');assert.ok(rows.every(r=>r.values.length===GATE_PROGRESS_HEADERS.length));
 for(const label of ['Toolpathed','Routed / cut','Sent to PC','Final QA'])assert.ok(!GATE_PROGRESS_HEADERS.includes(label));
 const parts=partsOf(await buildGateProgressDraft(sample.orders,{sample:true}));assert.match(parts['xl/workbook.xml'],/Gate Progress/);assert.doesNotMatch(parts['xl/worksheets/sheet1.xml'],/outline|hidden=|collapsed=/);assert.doesNotMatch(parts['xl/styles.xml'],/indent=/);assert.match(parts['xl/styles.xml'],/FFE2E8F0/);assert.match(parts['xl/styles.xml'],/textRotation="90"/);assert.match(parts['xl/styles.xml'],/horizontal="center" vertical="bottom" wrapText="0"/);assert.match(parts['xl/styles.xml'],/horizontal="left" vertical="bottom" textRotation="90" wrapText="0"/);assert.match(parts['xl/styles.xml'],/FF155E75/);assert.match(parts['xl/styles.xml'],/<sz val="10"\/>/);assert.match(parts['xl/styles.xml'],/FF8CE28C/);assert.match(parts['xl/styles.xml'],/FFFFFF99/);assert.match(parts['xl/worksheets/sheet1.xml'],/Fabricated\/QA/);assert.match(parts['xl/worksheets/sheet1.xml'],/Ready for dispatch/);assert.match(parts['xl/worksheets/sheet1.xml'],/<row r="1" ht="142" customHeight="1">/);assert.match(parts['xl/worksheets/sheet1.xml'],/<pane ySplit="1" topLeftCell="A2"/);assert.match(parts['xl/drawings/gateProgressBrand.xml'],/<a:t>Gate Progress — Sample<\/a:t>/);assert.match(parts['xl/drawings/_rels/gateProgressBrand.xml.rels'],/Target="\.\.\/media\/lennox-logo.png"/);assert.ok(parts['xl/media/lennox-logo.png']);assert.doesNotMatch(parts['xl/worksheets/sheet1.xml'],/DRAFT · SAMPLE DATA|SNAPSHOT|<mergeCells/);assert.doesNotMatch(parts['xl/worksheets/sheet1.xml'],/<f>/);
 const unsafe=partsOf(await buildGateProgressDraft([{...sample.orders[0],project:'=1+1 <script> & value'}]));assert.match(unsafe['xl/worksheets/sheet1.xml'],/=1\+1 &lt;script&gt; &amp; value/);assert.doesNotMatch(unsafe['xl/worksheets/sheet1.xml'],/<script>|<f>/);
 if(process.env.GATE_DRAFT_OUTPUT)fs.writeFileSync(process.env.GATE_DRAFT_OUTPUT,await buildGateProgressDraft(sample.orders,{sample:true}));
});
test('flexible set counts replace highlights with posts while retaining legacy part keys',()=>{
 const legacy=gateComponentSlots('Bin Gate',{highlights:[1]});
 const sets=gateComponentSpec('Bin Gate',{highlights:[1]});assert.deepEqual(sets,{sets:[{gates:1,highlights:1,posts:1}]});
 assert.deepEqual(gateComponentSlots('Bin Gate',sets),legacy);
 const replacement=gateComponentSlots('Bin Gate',{sets:[{gates:1,highlights:0,posts:2}]});
 assert.deepEqual(replacement.map(part=>part.kind),['Gate','Post','Post']);assert.equal(replacement[0].key,legacy[1].key);assert.equal(replacement[1].key,legacy[2].key);assert.equal(replacement[2].key,'set-1-post-2');
 assert.equal(gateComponentSlots('Side Access Gate',{sets:[{gates:0,highlights:0,posts:2},{gates:1,highlights:2,posts:0}]}).length,5);
 assert.deepEqual(gateComponentSlots('Buggy Gate',{sets:[{gates:2,highlights:0,posts:0}]}),gateComponentSlots('Buggy Gate',{gateCount:2}));
 for(const sets of [[],[{gates:0,highlights:0,posts:0}],[{gates:1,highlights:-1,posts:1}],[{gates:1,highlights:1.5,posts:1}],[{gates:1,highlights:0,posts:5}],[{gates:1,posts:1}],[{gates:1,highlights:0,posts:1,other:2}]])assert.throws(()=>gateComponentSlots('Bin Gate',{sets}));
 assert.throws(()=>gateComponentSlots('Buggy Gate',{sets:[{gates:3,highlights:0,posts:0}]}));
});
test('buggy gate layouts contain one or two gates with no highlights or posts',()=>{
 for(const gates of [1,2]){
  const spec={sets:[{gates,highlights:0,posts:0}]};
  assert.deepEqual(gateComponentSpec('Buggy Gate',spec),spec);
  const slots=gateComponentSlots('Buggy Gate',spec);
  assert.equal(slots.length,gates);assert.ok(slots.every(part=>part.kind==='Gate'&&part.set===1));
  assert.deepEqual(slots.map(part=>part.key),Array.from({length:gates},(_,index)=>'gate-'+(index+1)));
  assert.deepEqual(slots,gateComponentSlots('Buggy Gate',{gateCount:gates}));
 }
 for(const counts of [{gates:1,highlights:1,posts:0},{gates:2,highlights:0,posts:1},{gates:1,highlights:2,posts:2},{gates:0,highlights:0,posts:0},{gates:3,highlights:0,posts:0}]){
  assert.throws(()=>gateComponentSpec('Buggy Gate',{sets:[counts]}));
  assert.throws(()=>gateComponentSlots('Buggy Gate',{sets:[counts]}));
 }
 assert.throws(()=>gateComponentSpec('Buggy Gate',{sets:[{gates:1,highlights:0,posts:0},{gates:1,highlights:0,posts:0}]}));
});
test('matrix steps use the production schedule and preserve completion through dispatch',()=>{
 const order={id:'schedule-order',orderType:'Bin Gate',requestedDeliveryDate:'2026-11-17',scheduledDeliveryDate:'2026-11-18'};
 const entry={orderId:order.id,assignedUsername:'worker',scheduleType:'general',status:'planned'};
 const scheduled=entries=>gateComponentOrders([order],[],entries)[0].scheduledForProduction;
 assert.equal(scheduled([]),false);assert.equal(scheduled([entry]),true);assert.equal(scheduled([{...entry,scheduleType:'cnc'}]),true);
 for(const change of [{assignedUsername:''},{status:'cancelled'},{scheduleType:'delivery'},{orderId:'another-order'}])assert.equal(scheduled([{...entry,...change}]),false);
 const component={qaStatus:'approved',ready:false,shipment:{at:'2026-11-10T00:00:00Z'},delivery:null};
 const stages=Object.fromEntries(gateProgressStages([component],{scheduled:1}).map(stage=>[stage.key,stage]));
 for(const key of ['drawn','scheduledForProduction','fabricatedQa','readyForDispatch','dispatched'])assert.equal(stages[key].symbol,'✓');
 for(const key of ['toolpathed','cut','sentToPc','finalQa'])assert.equal(stages[key],undefined);
 assert.equal(stages.delivered.symbol,'-');
 const partial=gateProgressStages([component,{qaStatus:'awaiting'}]);assert.equal(partial.find(stage=>stage.key==='fabricatedQa').symbol,'-');
 const missing=gateProgressStages([component],{missing:true});assert.equal(missing.find(stage=>stage.key==='fabricatedQa').symbol,'-');
});
test('staging components retain QA through additive edits, dispatch partially, confirm delivery and credit m² only once',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'gate-components-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'gate-components-test',GATE_COMPONENTS_ENABLED:'true',CNC_PUBLIC_TOKEN:'synthetic-components',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let admin,inspector;const call=async(path,body,token=admin)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.body;};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),users={};for(const [username,pin]of [['admin','123456'],['inspector','654321']])users[username]={isAdmin:true,pinHash:createHash('sha256').update(pin+':'+username+':panelstock').digest('hex')};await kv.put('users',JSON.stringify(users));
  const page=await mf.dispatchFetch('http://localhost/gate-progress',{redirect:'manual'});assert.equal(page.status,302);assert.equal(page.headers.get('Location'),'/?page=gate-progress');assert.equal((await mf.dispatchFetch('http://localhost/gate-progress/export')).status,401);assert.equal((await mf.dispatchFetch('http://localhost/gate-progress/draft.xlsx')).status,200);
  admin=(await ok('/login',{username:'admin',pin:'123456'})).token;inspector=(await ok('/login',{username:'inspector',pin:'654321'})).token;
  const created=(await ok('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Component test',villa:'V135',colour:'Spruce',orderType:'Bin Gate',siteContact:'PRIVATE CONTACT',phone:'PRIVATE PHONE',requestedDeliveryDate:'2026-11-15',items:[{quantity:1,description:'Bin Gate set'}]}})).order,id=created.id;
  let order=(await ok('/gate-components/orders/'+id+'/plan',{expectedUpdatedAt:created.updatedAt,spec:{highlights:[1]},areaM2:12.5})).order;assert.equal(order.components.length,3);assert.equal(order.summary.qa,0);
  const checklist=(await ok('/gate-components')).checklist,results=Object.fromEntries(checklist.map(([key])=>[key,'pass']));
  const approve=async component=>ok('/qa/check',{id:component.qaId,kind:'metalwork',results},inspector),latest=async()=>{order=(await ok('/gate-components')).orders.find(o=>o.id===id);return order;};
  const tracker=await mf.dispatchFetch('http://localhost/cnc-tracker?token=synthetic-components');assert.equal(tracker.status,200);assert.match(tracker.headers.get('Content-Disposition'),/PRODUCTION_TRACKER.xlsx/);const trackerParts=partsOf(await tracker.arrayBuffer());assert.equal((trackerParts['xl/workbook.xml'].match(/<sheet /g)||[]).length,7);assert.match(trackerParts['xl/worksheets/sheet7.xml'],/Component test/);assert.doesNotMatch(trackerParts['xl/worksheets/sheet7.xml'],/PRIVATE/);
  const gateFeed=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-components&report=gate-progress&gateProgressVersion=1');assert.equal(gateFeed.status,200);const gateHtml=await gateFeed.text();assert.match(gateHtml,/Highlight 01/);assert.doesNotMatch(gateHtml,/PRIVATE|photo|qaHistory/);assert.equal((await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=wrong&report=gate-progress&gateProgressVersion=1')).status,404);
  const first=order.components[0];
  const failedResults={...results,[Object.keys(results)[0]]:'fail'};await ok('/qa/check',{id:first.qaId,kind:'metalwork',results:failedResults,notes:'Synthetic correction needed',photo:'data:image/png;base64,aGVsbG8='},inspector);await latest();assert.equal(order.components[0].qaStatus,'recut');
  await approve(first);await latest();assert.equal(order.summary.qa,1);
  const bad=await call('/gate-components/orders/'+id+'/dispatch',{expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),componentIds:[order.components[1].id],destination:'Site',transport:'Truck',driver:'Driver'});assert.equal(bad.status,409);
  const shipment={expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),componentIds:[first.id],destination:'Site A',transport:'Truck',driver:'Driver'};order=(await ok('/gate-components/orders/'+id+'/dispatch',shipment)).order;assert.equal(order.summary.dispatched,1);assert.notEqual(order.status,'dispatched');assert.equal((await call('/orders/'+id+'/status',{expectedUpdatedAt:order.updatedAt,status:'cancelled'})).status,409);assert.equal((await call('/orders/'+id+'/progress',{expectedUpdatedAt:order.updatedAt,stages:{drawn:'pending'}})).status,409);assert.equal((await ok('/gate-components/orders/'+id+'/dispatch',shipment)).duplicate,true);assert.equal((await call('/gate-components/orders/'+id+'/dispatch',{...shipment,driver:'Changed'})).status,409);
  const before=(await ok('/orders/'+id)).order;assert.equal(before.completedAt,null);const feed=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-components&report=monthly&reportVersion=2');assert.doesNotMatch(await feed.text(),/x:num="12.5"/);
  assert.equal((await call('/qa/check',{id:first.qaId,kind:'metalwork',results},inspector)).status,409);
  order=(await ok('/gate-components/orders/'+id+'/plan',{expectedUpdatedAt:order.updatedAt,spec:{highlights:[2,1]},areaM2:12.5})).order;assert.equal(order.components.length,7);assert.equal(order.components[0].id,first.id);assert.equal(order.components[0].qaStatus,'approved');assert.equal(order.summary.dispatched,1);
  const secondHighlight=order.components.find(c=>c.key==='set-1-highlight-2');await approve(secondHighlight);await latest();assert.equal((await call('/gate-components/orders/'+id+'/plan',{expectedUpdatedAt:order.updatedAt,spec:{highlights:[1,1]},areaM2:12.5})).status,409);
  const delivery={expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),componentIds:[first.id],receivedBy:'Site foreman',notes:'Post and gate to follow'};order=(await ok('/gate-components/orders/'+id+'/delivery',delivery)).order;assert.equal(order.summary.delivered,1);assert.equal((await ok('/gate-components/orders/'+id+'/delivery',delivery)).duplicate,true);
  for(const c of order.components.filter(c=>c.qaStatus!=='approved'))await approve(c);await latest();assert.equal(order.summary.qa,7);assert.equal(order.status,'completed');
  assert.ok((await ok('/dispatch/orders')).orders.some(item=>item.id===id&&item.ready&&item.usesGateComponents));
  const areaFeed=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-components&report=monthly&reportVersion=2');assert.match(await areaFeed.text(),/x:num="12.5"/);
  order=(await ok('/gate-components/orders/'+id+'/dispatch',{expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),componentIds:order.components.filter(c=>!c.shipment).map(c=>c.id),destination:'Site B',transport:'Ute',driver:'Other driver'})).order;assert.equal(order.status,'dispatched');assert.equal(order.summary.dispatched,7);
  order=(await ok('/gate-components/orders/'+id+'/delivery',{expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),componentIds:order.components.filter(c=>!c.delivery).map(c=>c.id),receivedBy:'Site foreman'})).order;assert.equal(order.summary.delivered,7);
  const exportResponse=await mf.dispatchFetch('http://localhost/gate-progress/export',{headers:{Authorization:'Bearer '+admin}});assert.equal(exportResponse.status,200);const exported=partsOf(await exportResponse.arrayBuffer());assert.doesNotMatch(exported['xl/worksheets/sheet1.xml'],/Component test/);assert.doesNotMatch(exported['xl/worksheets/sheet1.xml'],/PRIVATE/);
  const legacy=(await ok('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Legacy QA preserved',villa:'V300',colour:'Spruce',orderType:'Side Access Gate',siteContact:'Contact',phone:'Stage',requestedDeliveryDate:'2026-11-15',items:[{quantity:1,description:'Legacy line'}]}})).order;
  await ok('/orders/'+legacy.id+'/progress',{expectedUpdatedAt:legacy.updatedAt,areaM2:4,stages:{drawn:'complete'}});const legacyQa=(await ok('/qa')).items.find(item=>item.gateOrderId===legacy.id);await ok('/qa/check',{id:legacyQa.id,kind:'metalwork',results},inspector);const legacyOrder=(await ok('/orders/'+legacy.id)).order;
  assert.equal((await call('/gate-components/orders/'+legacy.id+'/plan',{expectedUpdatedAt:legacyOrder.updatedAt,spec:{highlights:[1]},areaM2:4})).status,409);assert.deepEqual((await ok('/orders/'+legacy.id)).order.manualProduction,legacyOrder.manualProduction);
  const legacyView=(await ok('/gate-components')).orders.find(order=>order.id===legacy.id);assert.equal(legacyView.legacyStages.drawn,true);assert.equal(legacyView.legacyStages.fabricatedQa,true);assert.equal(legacyView.hasRecordedQa,true);
  const converted=(await ok('/gate-components/orders/'+legacy.id+'/plan',{expectedUpdatedAt:legacyOrder.updatedAt,spec:{sets:[{gates:1,highlights:0,posts:1}]},areaM2:4,confirmLegacyQa:true})).order;assert.equal(converted.components.length,2);assert.equal(converted.summary.qa,0);assert.equal(converted.previousQa[0].id,legacyQa.id);assert.equal(converted.previousQa[0].status,'approved');assert.equal(converted.previousQa[0].history.length,1);assert.ok(converted.components.every(part=>part.qaId!==legacyQa.id));
  const flexible=(await ok('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Flexible parts',villa:'V401',colour:'Spruce',orderType:'Bin Gate',siteContact:'Contact',phone:'Staging',requestedDeliveryDate:'2026-11-15',items:[{quantity:1,description:'Variable set'}]}})).order;
  let flexibleView=(await ok('/gate-components/orders/'+flexible.id+'/plan',{expectedUpdatedAt:flexible.updatedAt,spec:{sets:[{gates:1,highlights:1,posts:1}]},areaM2:3.75})).order;
  const post=flexibleView.components.find(part=>part.kind==='Post');await approve(post);flexibleView=(await ok('/gate-components')).orders.find(order=>order.id===flexible.id);
  flexibleView=(await ok('/gate-components/orders/'+flexible.id+'/plan',{expectedUpdatedAt:flexibleView.updatedAt,spec:{sets:[{gates:1,highlights:0,posts:2}]},areaM2:3.75})).order;
  assert.equal(flexibleView.components.find(part=>part.id===post.id).qaStatus,'approved');assert.equal(flexibleView.components.find(part=>part.label==='Post 02').qaStatus,'awaiting');assert.ok(!flexibleView.components.some(part=>part.kind==='Highlight'));assert.equal(flexibleView.areaM2,3.75);
  assert.equal((await call('/gate-components/orders/'+flexible.id+'/plan',{expectedUpdatedAt:flexibleView.updatedAt,spec:{sets:[{gates:1,highlights:0,posts:0}]},areaM2:3.75})).status,409);
  const buggy=(await ok('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Buggy gates only',villa:'V450',colour:'Spruce',orderType:'Buggy Gate',siteContact:'Contact',phone:'Test',requestedDeliveryDate:'2026-11-15',items:[{quantity:1,description:'Buggy Gate'}]}})).order;
  const rejectBuggyParts=async()=>{
   const before=(await ok('/orders/'+buggy.id)).order,qaBefore=(await ok('/qa')).items;
   for(const counts of [{gates:1,highlights:1,posts:0},{gates:2,highlights:0,posts:1},{gates:1,highlights:1,posts:1},{gates:3,highlights:0,posts:0}]){
    const rejected=await call('/gate-components/orders/'+buggy.id+'/plan',{expectedUpdatedAt:before.updatedAt,spec:{sets:[counts]},areaM2:6});
    assert.equal(rejected.status,400,JSON.stringify(rejected));
    assert.deepEqual((await ok('/orders/'+buggy.id)).order,before);
    assert.deepEqual((await ok('/qa')).items,qaBefore);
   }
  };
  await rejectBuggyParts();
  let buggyView=(await ok('/gate-components/orders/'+buggy.id+'/plan',{expectedUpdatedAt:buggy.updatedAt,spec:{sets:[{gates:1,highlights:0,posts:0}]},areaM2:6})).order;
  assert.deepEqual(buggyView.components.map(part=>part.kind),['Gate']);
  const buggyFirst=buggyView.components[0];await approve(buggyFirst);buggyView=(await ok('/gate-components')).orders.find(item=>item.id===buggy.id);
  const buggyQaHistory=buggyView.components[0].qaHistory;assert.equal(buggyQaHistory.length,1);
  buggyView=(await ok('/gate-components/orders/'+buggy.id+'/plan',{expectedUpdatedAt:buggyView.updatedAt,spec:{sets:[{gates:2,highlights:0,posts:0}]},areaM2:6})).order;
  assert.deepEqual(buggyView.components.map(part=>part.kind),['Gate','Gate']);assert.equal(buggyView.summary.total,2);assert.equal(buggyView.summary.qa,1);assert.equal(buggyView.areaM2,6);
  assert.equal(buggyView.components[0].id,buggyFirst.id);assert.equal(buggyView.components[0].qaId,buggyFirst.qaId);assert.equal(buggyView.components[0].qaStatus,'approved');assert.deepEqual(buggyView.components[0].qaHistory,buggyQaHistory);
  assert.notEqual(buggyView.components[1].id,buggyFirst.id);assert.equal(buggyView.components[1].qaStatus,'awaiting');assert.deepEqual(buggyView.components[1].qaHistory,[]);
  await rejectBuggyParts();
  const whole=(await ok('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Standard gate dispatch',villa:'V500',colour:'Spruce',orderType:'Buggy Gate',siteContact:'Contact',phone:'Test',requestedDeliveryDate:'2026-11-15',items:[{quantity:1,description:'Buggy Gate'}]}})).order;
  let wholeView=(await ok('/gate-components/orders/'+whole.id+'/plan',{expectedUpdatedAt:whole.updatedAt,spec:{sets:[{gates:1,highlights:0,posts:0}]},areaM2:4})).order;
  const wholeDispatch={id:whole.id,expectedUpdatedAt:wholeView.updatedAt,mutationId:'test-gate-dispatch-request-000001',destination:'Site',transport:'Truck',driver:'Driver'};
  assert.equal((await call('/dispatch/orders',wholeDispatch)).status,409);await approve(wholeView.components[0]);wholeView=(await ok('/gate-components')).orders.find(item=>item.id===whole.id);wholeDispatch.expectedUpdatedAt=wholeView.updatedAt;
  assert.ok((await ok('/dispatch')).entries.some(entry=>entry.order?.id===whole.id&&entry.ready));
  const wholeSent=await ok('/dispatch/orders',wholeDispatch);assert.equal(wholeSent.order.status,'dispatched');assert.equal((await ok('/dispatch/orders',wholeDispatch)).idempotent,true);assert.equal((await call('/dispatch/orders',{...wholeDispatch,driver:'Changed'})).status,409);
  assert.equal((await call('/orders/'+whole.id+'/reverse-dispatch',{expectedUpdatedAt:wholeSent.order.updatedAt,mutationId:crypto.randomUUID(),reason:'Synthetic test'})).status,409);
  const received=await ok('/orders/'+whole.id+'/receipts',{id:crypto.randomUUID(),expectedUpdatedAt:wholeSent.order.updatedAt,lines:[{index:0,arrived:true,accepted:1,damaged:0,missing:0}],notes:'All Gate components received',acknowledgement:receiptAck()});
  assert.equal(received.order.gateComponents.deliveries.length,1);assert.equal(received.order.gateComponents.deliveries[0].source,'order-receipt');assert.equal(received.order.gateComponents.deliveries[0].componentIds.length,1);
  assert.equal((await mf.dispatchFetch('http://localhost/gate-components')).status,401);
 }finally{await mf.dispose();}
});
