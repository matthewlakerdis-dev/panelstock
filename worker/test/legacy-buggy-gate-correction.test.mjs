import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {checkGateOrderEdit} from '../src/gate-order-progress.js';
import {isLegacyGateTypeCorrection} from '../src/order-types.js';
import {orderTypeFields} from '../src/order-type-fields.js';

test('legacy Gate to Buggy Gate corrects an unconfigured order without changing its production workflow',()=>{
 const definition={projectId:'project',project:'Palm Lakes Program',items:[{quantity:1,description:'V74 DOUBLE BUGGY GATE - SPRUCE'}]};
 assert.equal(isLegacyGateTypeCorrection(' gate ',' BUGGY   GATE '),true);assert.equal(isLegacyGateTypeCorrection('Gate','Bin Gate'),true);
 for(const drawn of ['pending','complete']){
  const order={...definition,orderType:'Gate',manualProduction:{stages:{drawn,fabricatedQa:'pending',readyForDispatch:'pending'}}};
  assert.doesNotThrow(()=>checkGateOrderEdit(order,'Buggy Gate','approved',definition));assert.doesNotThrow(()=>checkGateOrderEdit(order,' buggy   gate ','approved',definition));
  for(const gateComponents of [{},{components:[]},{components:[{key:'set-1-gate',id:'existing-gate'}]}])assert.throws(()=>checkGateOrderEdit({...order,gateComponents},'Buggy Gate','approved',definition),error=>error.status===409&&/configured components/.test(error.message));
  for(const type of ['Side Access Gate','Fixings','Panels'])assert.throws(()=>checkGateOrderEdit(order,type,'approved',definition),/keep its order type/);
 }
 const order={...definition,orderType:'Gate',manualProduction:{stages:{drawn:'complete',fabricatedQa:'pending',readyForDispatch:'pending'}}};
 for(const changed of [{...definition,project:'Different project'},{...definition,items:[{quantity:2,description:definition.items[0].description}]}])assert.throws(()=>checkGateOrderEdit(order,'Buggy Gate','approved',changed),/production to pending/);
 const legacy={orderType:'Gate',villa:'V74',colour:''},fields=orderTypeFields({...legacy},'Buggy Gate',legacy);assert.equal(fields.colour,'');
 for(const previous of ['Bin Gate','Side Access Gate'])assert.throws(()=>checkGateOrderEdit({...order,orderType:previous},'Buggy Gate','approved',definition),/keep its order type/);
 assert.throws(()=>checkGateOrderEdit({...order,orderType:'Buggy Gate'},'Bin Gate','approved',definition),/keep its order type/);
});

test('legacy Gate to Buggy Gate API correction preserves QA, schedule, area and evidence while rejecting incompatible component plans',async()=>{
 const name='legacy-buggy-gate-correction',mf=new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name,modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:name,GATE_COMPONENTS_ENABLED:'true',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let admin,inspector;
 const request=async(path,body,token=admin)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const ok=async(...args)=>{const result=await request(...args);assert.ok(result.status<300,JSON.stringify(result));return result.body;};
 const raw=async id=>(await ok('/orders/'+id)).order,view=async id=>(await ok('/gate-components')).orders.find(order=>order.id===id),qa=async id=>(await ok('/qa')).items.filter(item=>item.gateOrderId===id);
 const create=async(villa)=>(await ok('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Palm Lakes Program',villa,colour:'Spruce',orderType:'Gate',siteContact:'Synthetic contact',phone:'Synthetic phone',requestedDeliveryDate:'2026-11-20',items:[{quantity:1,description:'V74 DOUBLE BUGGY GATE'},{quantity:1,description:'REAR BUGGY GATE'}]}})).order;
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),users={};for(const[username,pin]of [['admin','123456'],['inspector','654321']])users[username]={isAdmin:true,pinHash:createHash('sha256').update(pin+':'+username+':panelstock').digest('hex')};await kv.put('users',JSON.stringify(users));
  admin=(await ok('/login',{username:'admin',pin:'123456'},null)).token;inspector=(await ok('/login',{username:'inspector',pin:'654321'},null)).token;await ok('/order-types',{name:'Gate'});await ok('/projects',{name:'Palm Lakes Program'});
  const results=Object.fromEntries((await ok('/gate-components')).checklist.map(([key])=>[key,'pass']));
  const approve=async item=>ok('/qa/check',{id:item.id,kind:'metalwork',results,notes:'Keep original legacy buggy-gate inspection'},inspector);
  let conversionId;
  for(const state of ['pending','drawn','partial-qa','approved','blank-colour']){
   const created=await create('V74-'+state);await ok('/orders/'+created.id+'/progress',{expectedUpdatedAt:created.updatedAt,stages:{drawn:state==='pending'?'pending':'complete'},areaM2:7.07});
   const items=await qa(created.id);if(state==='approved')for(const item of items)await approve(item);else if(['partial-qa','blank-colour'].includes(state))await approve(items[0]);
   const schedule=await ok('/schedule'),project=schedule.projects.find(project=>project.name==='Palm Lakes Program');
   const booking=(await ok('/schedule',{projectId:project.id,orderId:created.id,assignedUsername:'admin',date:'2026-11-20',startTime:'07:00',endTime:'09:00',scheduleType:'general'})).entry;
   if(state==='blank-colour'){
    // Historical fixture only: a pre-colour order retains unsuffixed descriptions and stored evidence.
    const storage=await mf.unsafeGetDurableObjectStorage(name,'InventoryStore',{name}),orders=JSON.parse((await storage.exec('SELECT value FROM documents WHERE key=? ORDER BY part','orders')).map(row=>row.value).join('')),legacy=orders.find(order=>order.id===created.id);
    legacy.colour='';legacy.items=legacy.items.map(item=>({...item,description:item.description.replace(/ - SPRUCE$/,'')}));legacy.scheduledDeliveryDate='2026-11-21';legacy.scheduledDeliveryTime='10:00';legacy.attachments=[{id:crypto.randomUUID(),name:'original-buggy-gate-drawing.pdf',size:1024}];legacy.receipts=[{id:crypto.randomUUID(),by:'admin',at:'2026-11-10T02:00:00Z',lines:[{index:0,accepted:1,damaged:0,missing:0}]}];
    await storage.exec('UPDATE documents SET value=? WHERE key=? AND part=0',JSON.stringify(orders),'orders');
   }
   const before=await raw(created.id),gateBefore=await view(created.id),qaBefore=await qa(created.id),entriesBefore=(await ok('/schedule')).entries;
   assert.equal(before.gateComponents,undefined);assert.equal(gateBefore.components.length,0);
   const body={expectedUpdatedAt:before.updatedAt,order:{...before,orderType:'Buggy Gate'}},corrected=await request('/orders/'+created.id,body);assert.equal(corrected.status,200,JSON.stringify(corrected.body));const after=corrected.body.order;
   assert.equal(after.orderType,'Buggy Gate');assert.equal(after.updatedBy,'admin');assert.ok(after.updatedAt>before.updatedAt);
   for(const key of ['id','orderNumber','status','completedAt','project','projectId','villa','colour','items','manualProduction','gateComponents','requestedDeliveryDate','scheduledDeliveryDate','scheduledDeliveryTime','attachments','receipts','requestedBy'])assert.deepEqual(after[key],before[key],key+' preserved for '+state);
   assert.deepEqual(await qa(created.id),qaBefore);const gateAfter=await view(created.id);for(const key of ['components','summary','areaM2','drawn','legacyStages','previousQa'])assert.deepEqual(gateAfter[key],gateBefore[key],key+' gate view preserved for '+state);assert.equal(gateAfter.spec,null);assert.equal(gateAfter.scheduledForProduction,true);
   const entriesAfter=(await ok('/schedule')).entries,identity=entries=>entries.map(({title,...entry})=>entry).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(identity(entriesAfter),identity(entriesBefore));assert.equal(entriesAfter.find(entry=>entry.id===booking.id).title,entriesBefore.find(entry=>entry.id===booking.id).title.replace(' · Gate · ',' · Buggy Gate · '));
   if(state==='approved'){assert.equal(after.status,'completed');assert.ok((await qa(created.id)).every(item=>item.status==='approved'));}
   if(state==='blank-colour'){assert.equal(after.colour,'');assert.ok(after.items.every(item=>!item.description.includes(' - SPRUCE')));}
   assert.ok((await ok('/orders/'+created.id+'/history')).events.some(event=>event.actor==='admin'&&event.label==='Order type: Gate → Buggy Gate'));
   const stale=await request('/orders/'+created.id,body);assert.equal(stale.status,409);assert.equal(stale.body.code,'ORDER_CONFLICT');assert.equal((await raw(created.id)).orderType,'Buggy Gate');
   if(state==='partial-qa')conversionId=created.id;
  }
  // Confirming actual Buggy components is a separate explicit operation with fresh per-gate QA.
  const beforeConversion=await raw(conversionId),oldQa=await qa(conversionId),body={expectedUpdatedAt:beforeConversion.updatedAt,spec:{gateCount:2},areaM2:7.07};
  const unconfirmed=await request('/gate-components/orders/'+conversionId+'/plan',body);assert.equal(unconfirmed.status,409);assert.match(unconfirmed.body.error,/Review the earlier QA/);assert.deepEqual(await raw(conversionId),beforeConversion);assert.deepEqual(await qa(conversionId),oldQa);
  const converted=(await ok('/gate-components/orders/'+conversionId+'/plan',{...body,confirmLegacyQa:true})).order;assert.deepEqual(converted.components.map(part=>part.kind),['Gate','Gate']);assert.deepEqual(converted.components.map(part=>part.key),['gate-1','gate-2']);assert.ok(converted.components.every(part=>part.qaStatus==='awaiting'&&!oldQa.some(old=>old.id===part.qaId)));assert.equal(converted.previousQa.length,1);for(const key of ['id','gateRevision','status','history','latest'])assert.deepEqual(converted.previousQa[0][key],oldQa.find(item=>item.history.length>0)[key]);assert.equal(converted.areaM2,7.07);
  const incompatible=[{sets:[{gates:1,highlights:0,posts:0}]},{sets:[{gates:2,highlights:0,posts:0}]},{sets:[{gates:1,highlights:1,posts:1}]},{sets:[{gates:1,highlights:0,posts:0},{gates:1,highlights:0,posts:0}]}];
  for(const [index,spec]of incompatible.entries()){
   const created=await create('V80-'+index);let configured=(await ok('/gate-components/orders/'+created.id+'/plan',{expectedUpdatedAt:created.updatedAt,spec,areaM2:4})).order;
   await approve({id:configured.components[0].qaId});const before=await raw(created.id),qaBefore=await qa(created.id),body={expectedUpdatedAt:before.updatedAt,order:{...before,orderType:'Buggy Gate'}};
   const rejected=await request('/orders/'+created.id,body);assert.equal(rejected.status,409);assert.match(rejected.body.error,/configured components/);assert.deepEqual(await raw(created.id),before);assert.deepEqual(await qa(created.id),qaBefore);
   configured=await view(created.id);const undrawn=(await ok('/gate-components/orders/'+created.id+'/plan',{expectedUpdatedAt:configured.updatedAt,spec,areaM2:4,drawn:false})).order,beforePending=await raw(created.id);
   const pendingRejected=await request('/orders/'+created.id,{expectedUpdatedAt:undrawn.updatedAt,order:{...beforePending,orderType:'Buggy Gate'}});assert.equal(pendingRejected.status,409);assert.match(pendingRejected.body.error,/configured components/);assert.deepEqual(await raw(created.id),beforePending);
  }
  const locked=await create('V90');await ok('/orders/'+locked.id+'/progress',{expectedUpdatedAt:locked.updatedAt,stages:{drawn:'complete'},areaM2:4});for(const item of await qa(locked.id))await approve(item);let before=await raw(locked.id);
  for(const patch of [{projectId:null,project:'Another project'},{items:[{quantity:8,description:before.items[0].description}]}]){const rejected=await request('/orders/'+locked.id,{expectedUpdatedAt:before.updatedAt,order:{...before,...patch,orderType:'Buggy Gate'}});assert.equal(rejected.status,409);assert.match(rejected.body.error,/production to pending/);assert.deepEqual(await raw(locked.id),before);}
  await ok('/dispatch/orders',{id:locked.id,expectedUpdatedAt:before.updatedAt,mutationId:crypto.randomUUID(),destination:'Synthetic site',transport:'Synthetic truck',driver:'Synthetic driver'});before=await raw(locked.id);const qaBefore=await qa(locked.id),dispatched=await request('/orders/'+locked.id,{expectedUpdatedAt:before.updatedAt,order:{...before,orderType:'Buggy Gate'}});assert.equal(dispatched.status,409);assert.match(dispatched.body.error,/Dispatched orders cannot be edited/);assert.deepEqual(await raw(locked.id),before);assert.deepEqual(await qa(locked.id),qaBefore);
 }finally{await mf.dispose();}
});
