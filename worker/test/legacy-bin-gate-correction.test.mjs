import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {checkGateOrderEdit} from '../src/gate-order-progress.js';

test('legacy Gate to Bin Gate is a classification correction within the same production workflow',()=>{
 const definition={projectId:'project',project:'Palm Lakes Program',items:[{quantity:1,description:'GATE SET - SPRUCE'}]};
 for(const drawn of ['pending','complete']){
  const previous={...definition,orderType:'Gate',manualProduction:{stages:{drawn,fabricatedQa:'pending',readyForDispatch:'pending'}}};
  assert.doesNotThrow(()=>checkGateOrderEdit(previous,'Bin Gate','approved',definition));
  assert.doesNotThrow(()=>checkGateOrderEdit(previous,' bin   gate ','approved',definition));
  for(const type of ['Side Access Gate','Fixings','Panels'])assert.throws(()=>checkGateOrderEdit(previous,type,'approved',definition),/keep its order type/);
 }
 const drawn={...definition,orderType:'Gate',manualProduction:{stages:{drawn:'complete',fabricatedQa:'pending',readyForDispatch:'pending'}}};
 assert.throws(()=>checkGateOrderEdit(drawn,'Bin Gate','approved',{...definition,project:'Different project'}),/production to pending/);
 assert.throws(()=>checkGateOrderEdit(drawn,'Bin Gate','approved',{...definition,items:[{quantity:2,description:'GATE SET - SPRUCE'}]}),/production to pending/);
 for(const [previous,type]of [['Bin Gate','Buggy Gate'],['Bin Gate','Gate'],['Buggy Gate','Bin Gate'],['Side Access Gate','Bin Gate']])assert.throws(()=>checkGateOrderEdit({...drawn,orderType:previous},type,'approved',definition),/keep its order type/);
});

test('saving a legacy Gate as Bin Gate preserves components, QA evidence, area and schedule through the real order API',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name:'legacy-bin-gate-correction',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'legacy-bin-gate-correction',GATE_COMPONENTS_ENABLED:'true',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let admin,inspector;
 const request=async(path,body,token=admin)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const ok=async(...args)=>{const result=await request(...args);assert.ok(result.status<300,JSON.stringify(result));return result.body;};
 const raw=async id=>(await ok('/orders/'+id)).order,view=async id=>(await ok('/gate-components')).orders.find(order=>order.id===id);
 const create=async(villa,orderType='Gate')=>(await ok('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Palm Lakes Program',villa,colour:'Spruce',orderType,siteContact:'Synthetic contact',phone:'Synthetic phone',requestedDeliveryDate:'2026-11-20',items:[{quantity:1,description:'Front gate set'},{quantity:1,description:'Rear gate set'}]}})).order;
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),users={};for(const[username,pin]of [['admin','123456'],['inspector','654321']])users[username]={isAdmin:true,pinHash:createHash('sha256').update(pin+':'+username+':panelstock').digest('hex')};await kv.put('users',JSON.stringify(users));
  admin=(await ok('/login',{username:'admin',pin:'123456'},null)).token;inspector=(await ok('/login',{username:'inspector',pin:'654321'},null)).token;await ok('/order-types',{name:'Gate'});await ok('/projects',{name:'Palm Lakes Program'});
  const spec={sets:[{gates:1,highlights:2,posts:0},{gates:1,highlights:2,posts:0}]},results=Object.fromEntries((await ok('/gate-components')).checklist.map(([key])=>[key,'pass']));
  for(const state of ['drawn','undrawn','approved','blank-colour','partial-shipped']){
   const created=await create('V74-'+state);let configured=(await ok('/gate-components/orders/'+created.id+'/plan',{expectedUpdatedAt:created.updatedAt,spec,areaM2:6})).order;
   const inspected=state==='approved'?configured.components:configured.components.slice(0,1);
   for(const component of inspected)await ok('/qa/check',{id:component.qaId,kind:'metalwork',results,notes:'Keep original inspection evidence during type correction'},inspector);
   configured=await view(created.id);
   if(state==='partial-shipped'){
    configured=(await ok('/gate-components/orders/'+created.id+'/dispatch',{expectedUpdatedAt:configured.updatedAt,mutationId:crypto.randomUUID(),componentIds:[configured.components[0].id],destination:'Synthetic site',transport:'Synthetic ute',driver:'Synthetic driver'})).order;
    configured=(await ok('/gate-components/orders/'+created.id+'/delivery',{expectedUpdatedAt:configured.updatedAt,mutationId:crypto.randomUUID(),componentIds:[configured.components[0].id],receivedBy:'Synthetic foreman'})).order;
   }
   if(state==='undrawn')await ok('/gate-components/orders/'+created.id+'/plan',{expectedUpdatedAt:configured.updatedAt,spec,areaM2:6,drawn:false});
   const scheduleBefore=await ok('/schedule'),project=scheduleBefore.projects.find(project=>project.name==='Palm Lakes Program');assert.ok(project);
   const booking=(await ok('/schedule',{projectId:project.id,orderId:created.id,assignedUsername:'admin',date:'2026-11-20',scheduleType:'general'})).entry;
   if(state==='blank-colour'){
    // Reproduce an older persisted Gate: missing colour, unsuffixed item text and retained historical files/receipt.
    const storage=await mf.unsafeGetDurableObjectStorage('legacy-bin-gate-correction','InventoryStore',{name:'legacy-bin-gate-correction'});
    const stored=JSON.parse((await storage.exec('SELECT value FROM documents WHERE key=? ORDER BY part','orders')).map(row=>row.value).join('')),legacy=stored.find(order=>order.id===created.id);
    legacy.colour='';legacy.items=legacy.items.map(item=>({...item,description:item.description.replace(/ - SPRUCE$/,'')}));legacy.scheduledDeliveryDate='2026-11-21';legacy.scheduledDeliveryTime='10:00';legacy.attachments=[{id:crypto.randomUUID(),name:'original-gate-drawing.pdf',size:1024}];legacy.receipts=[{id:crypto.randomUUID(),at:'2026-11-10T02:00:00Z',by:'admin',lines:[{index:0,accepted:1,damaged:0,missing:0}]}];
    await storage.exec('UPDATE documents SET value=? WHERE key=? AND part=0',JSON.stringify(stored),'orders');
   }
   const before=await raw(created.id),gateBefore=await view(created.id),qaBefore=(await ok('/qa')).items,entriesBefore=(await ok('/schedule')).entries;
   const body={expectedUpdatedAt:before.updatedAt,order:{...before,orderType:'Bin Gate'}};
   const corrected=await request('/orders/'+created.id,body);assert.equal(corrected.status,200,JSON.stringify(corrected.body));const after=corrected.body.order;
   assert.equal(after.orderType,'Bin Gate');assert.equal(after.id,before.id);assert.equal(after.orderNumber,before.orderNumber);assert.ok(after.updatedAt>before.updatedAt);assert.equal(after.updatedBy,'admin');
   for(const key of ['status','completedAt','project','projectId','villa','colour','items','manualProduction','gateComponents','requestedDeliveryDate','scheduledDeliveryDate','scheduledDeliveryTime','receipts','attachments','requestedBy'])assert.deepEqual(after[key],before[key],key+' unchanged for '+state);
   const gateAfter=await view(created.id);assert.equal(gateAfter.orderType,'Bin Gate');assert.equal(gateAfter.drawn,gateBefore.drawn);assert.deepEqual(gateAfter.components,gateBefore.components);assert.deepEqual(gateAfter.previousQa,gateBefore.previousQa);assert.deepEqual(gateAfter.summary,gateBefore.summary);assert.equal(gateAfter.areaM2,6);assert.equal(gateAfter.scheduledForProduction,true);
   const qaAfter=(await ok('/qa')).items,withoutOrderMetadata=items=>items.map(({gateOrder,...item})=>item);assert.deepEqual(withoutOrderMetadata(qaAfter),withoutOrderMetadata(qaBefore));for(const item of qaAfter){const previous=qaBefore.find(record=>record.id===item.id);assert.deepEqual(item.gateOrder,previous.gateOrder?{...previous.gateOrder,orderType:item.gateOrderId===created.id?'Bin Gate':previous.gateOrder.orderType}:undefined);}const entriesAfter=(await ok('/schedule')).entries,identity=entries=>entries.map(({title,...entry})=>entry).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(identity(entriesAfter),identity(entriesBefore));assert.ok(entriesBefore.some(entry=>entry.id===booking.id&&entry.orderId===created.id));assert.equal(entriesAfter.find(entry=>entry.id===booking.id).title,entriesBefore.find(entry=>entry.id===booking.id).title.replace(' · Gate · ',' · Bin Gate · '));
   if(state==='blank-colour'){assert.equal(after.colour,'');assert.ok(after.items.every(item=>!item.description.includes(' - SPRUCE')));}
   const wrongType=await request('/orders/'+created.id,{expectedUpdatedAt:after.updatedAt,order:{...after,orderType:'Buggy Gate'}});assert.equal(wrongType.status,state==='blank-colour'?400:409);assert.match(wrongType.body.error,state==='blank-colour'?/Colour/:/keep its order type/);
   if(state==='approved'){assert.equal(after.status,'completed');assert.ok(gateAfter.components.every(component=>component.qaStatus==='approved'));}
   const rejected=await request('/orders/'+created.id,body);assert.equal(rejected.status,409);assert.equal(rejected.body.code,'ORDER_CONFLICT');assert.equal((await raw(created.id)).orderType,'Bin Gate');
   const history=(await ok('/orders/'+created.id+'/history')).events;assert.ok(history.some(event=>event.actor==='admin'&&/Order type: Gate → Bin Gate/.test(event.label)),'type correction has a visible audit event');
  }
  const blocked=await create('V80');let configured=(await ok('/gate-components/orders/'+blocked.id+'/plan',{expectedUpdatedAt:blocked.updatedAt,spec:{sets:[{gates:1,highlights:1,posts:1}]},areaM2:4})).order;
  await ok('/qa/check',{id:configured.components[0].qaId,kind:'metalwork',results},inspector);let before=await raw(blocked.id),qaBefore=(await ok('/qa')).items;
  for(const patch of [{orderType:'Buggy Gate'},{orderType:'Fixings'},{orderType:'Bin Gate',projectId:null,project:'Changed project'},{orderType:'Bin Gate',items:[{quantity:9,description:before.items[0].description}]}]){const rejected=await request('/orders/'+blocked.id,{expectedUpdatedAt:before.updatedAt,order:{...before,...patch}});assert.equal(rejected.status,409,JSON.stringify(rejected.body));assert.deepEqual(await raw(blocked.id),before);assert.deepEqual((await ok('/qa')).items,qaBefore);}
  configured=await view(blocked.id);await ok('/gate-components/orders/'+blocked.id+'/plan',{expectedUpdatedAt:configured.updatedAt,spec:configured.spec,areaM2:4,drawn:false});before=await raw(blocked.id);qaBefore=(await ok('/qa')).items;
  for(const orderType of ['Buggy Gate','Fixings']){const rejected=await request('/orders/'+blocked.id,{expectedUpdatedAt:before.updatedAt,order:{...before,orderType}});assert.equal(rejected.status,409);assert.match(rejected.body.error,orderType==='Buggy Gate'?/configured components/:/keep its order type/);assert.deepEqual(await raw(blocked.id),before);assert.deepEqual((await ok('/qa')).items,qaBefore);}
  configured=(await ok('/gate-components/orders/'+blocked.id+'/plan',{expectedUpdatedAt:before.updatedAt,spec:before.gateComponents.spec,areaM2:4,drawn:true})).order;
  for(const component of(await view(blocked.id)).components.filter(component=>component.qaStatus!=='approved'))await ok('/qa/check',{id:component.qaId,kind:'metalwork',results},inspector);
  configured=await view(blocked.id);await ok('/gate-components/orders/'+blocked.id+'/dispatch',{expectedUpdatedAt:configured.updatedAt,mutationId:crypto.randomUUID(),componentIds:configured.components.map(component=>component.id),destination:'Synthetic site',transport:'Synthetic truck',driver:'Synthetic driver'});before=await raw(blocked.id);qaBefore=(await ok('/qa')).items;
  const terminal=await request('/orders/'+blocked.id,{expectedUpdatedAt:before.updatedAt,order:{...before,orderType:'Bin Gate'}});assert.equal(terminal.status,409);assert.match(terminal.body.error,/Dispatched orders cannot be edited/);assert.deepEqual(await raw(blocked.id),before);assert.deepEqual((await ok('/qa')).items,qaBefore);
 }finally{await mf.dispose();}
});
