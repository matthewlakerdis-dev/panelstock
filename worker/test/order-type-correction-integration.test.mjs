import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
let mf,admin,manager,project;
async function request(path,body,token){const response=await mf.dispatchFetch('https://order-type.test'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'type-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'order-type-tests',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const hash=value=>createHash('sha256').update(value).digest('hex');const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},manager:{isAdmin:false,pinHash:hash('654321:manager:panelstock')}}));
 admin=(await request('/login',{username:'admin',pin:'123456'})).body.token;
 for(const taskCode of ['site.orders.view','site.orders.create','site.orders.manage'])assert.equal((await request('/admin/set-task-access',{targetUsername:'manager',taskCode,allowed:true},admin)).status,200);
 manager=(await request('/login',{username:'manager',pin:'654321'})).body.token;
 project=(await request('/projects',{name:'Correction project'},admin)).body.project;
 assert.ok(admin&&manager&&project?.id);
 assert.equal((await request('/order-types',{name:'Gate'},admin)).status,200);
});
after(async()=>{await mf?.dispose();});
async function create(){const result=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{projectId:project.id,project:project.name,orderType:'Panels',location:'Level 1',siteContact:'Leading Hand',phone:'0400123456',requestedDeliveryDate:'2026-11-05',items:[{quantity:2,description:'BOLTS'}]}},manager);assert.equal(result.status,201,JSON.stringify(result.body));return result.body.order;}
test('authenticated type correction is admin-only, audited and cannot alter production status or other order fields',async()=>{
 const order=await create(),path='/orders/'+order.id+'/type',body={orderType:'Fixings',expectedUpdatedAt:order.updatedAt||order.createdAt};
 assert.equal((await request(path,body)).status,401);assert.equal((await request(path,body,manager)).status,403);
 const locked=await request('/orders/'+order.id,{order:{...order,orderType:'Fixings'},expectedUpdatedAt:body.expectedUpdatedAt},admin);assert.equal(locked.status,403);
 const saved=await request(path,{...body,status:'completed',items:[],scheduledDeliveryDate:'2099-01-01'},admin);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.order.orderType,'Fixings');
 for(const key of ['id','orderNumber','requestedBy','status','items','siteContact','phone','requestedDeliveryDate','scheduledDeliveryDate','attachments'])assert.deepEqual(saved.body.order[key],order[key],key);
 const history=await request('/orders/'+order.id+'/history',undefined,manager);assert.equal(history.status,200);assert.ok(history.body.events.some(event=>event.actor==='admin'&&event.label==='Order type: Panels → Fixings'));
 const stale=await request(path,body,admin);assert.equal(stale.status,409);assert.equal(stale.body.code,'ORDER_CONFLICT');assert.equal(stale.body.order.orderType,'Fixings');
 const current=await request('/orders/'+order.id,undefined,manager);assert.equal(current.body.order.orderType,'Fixings');
});
test('concurrent corrections save once and converting to Gate starts with pending QA stages',async()=>{
 const order=await create(),path='/orders/'+order.id+'/type',expectedUpdatedAt=order.updatedAt||order.createdAt;
 const results=await Promise.all([request(path,{orderType:'Gate',villa:'Villa 12',colour:'Spruce',expectedUpdatedAt},admin),request(path,{orderType:'Gate',villa:'Villa 12',colour:'Spruce',expectedUpdatedAt},admin)]);assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
 const saved=results.find(result=>result.status===200).body.order;assert.equal(saved.orderType,'Gate');assert.equal(saved.status,order.status);assert.equal(saved.manualProduction,undefined);
 const progress=(await request('/orders/'+order.id+'/progress',undefined,manager)).body.progress;assert.equal(progress.stages.find(stage=>stage.label==='Fabricated / QA').state,'pending');assert.equal(progress.stages.at(-1).state,'pending');
});

test('order saves enforce type details, retain them on reads and protect duplicate submission retries',async()=>{
 const base={projectId:project.id,project:project.name,siteContact:'Leading hand',phone:'0400',requestedDeliveryDate:'2026-11-10',items:[{quantity:2,description:'test item'}]};
 const place=(order,key=crypto.randomUUID())=>request('/orders',{idempotencyKey:key,order:{...base,colour:order.orderType==='Gate'?'Spruce':'',...order}},manager);
 for(const [orderType,field,message] of [['Gate','villa','Villa'],['Panels','location','Location']]){
  for(const value of ['',null,'  ']){const rejected=await place({orderType,[field]:value});assert.equal(rejected.status,400);assert.match(rejected.body.error,new RegExp(message));}
  const key=crypto.randomUUID(),created=await place({orderType,[field]:'  Detail 12  ',notes:'Optional notes'},key);assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.order[field],'Detail 12');
  const retry=await place({orderType,[field]:''},key);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.order.id,created.body.order.id);
  const saved=(await request('/orders/'+created.body.order.id,undefined,manager)).body.order;assert.equal(saved[field],'Detail 12');
  if(orderType==='Panels')assert.equal(saved.notes,'Optional notes');
  else {const rejected=await request('/orders/'+saved.id,{order:{...saved,villa:''},expectedUpdatedAt:saved.updatedAt},admin);assert.equal(rejected.status,400);assert.match(rejected.body.error,/Villa/);}
 }
 const panel=await create();const rejected=await request('/orders/'+panel.id+'/type',{orderType:'Gate',expectedUpdatedAt:panel.updatedAt},admin);assert.equal(rejected.status,400);assert.match(rejected.body.error,/Villa/);
});

test('corrected Panel details stay readable and survive subsequent non-panel contact edits',async()=>{
 const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{projectId:project.id,project:project.name,orderType:'Panels',location:'East elevation',notes:'Keep wrapped',siteContact:'Contact',phone:'0400',requestedDeliveryDate:'2026-11-10',items:[{quantity:1,description:'FIXING'}]}},manager);
 assert.equal(created.status,201);let order=created.body.order;
 const corrected=await request('/orders/'+order.id+'/type',{orderType:'Fixings',expectedUpdatedAt:order.updatedAt},admin);assert.equal(corrected.status,200);order=corrected.body.order;
 const edited=await request('/orders/'+order.id,{order:{...order,siteContact:'Updated contact'},expectedUpdatedAt:order.updatedAt},admin);assert.equal(edited.status,200,JSON.stringify(edited.body));
 assert.equal(edited.body.order.location,'East elevation');assert.equal(edited.body.order.notes,'Keep wrapped');assert.equal(edited.body.order.siteContact,'Updated contact');
});

test('one Notes field saves and round trips for every order type, including older draft text',async()=>{
 const base={projectId:project.id,project:project.name,siteContact:'Contact',phone:'0400',requestedDeliveryDate:'2026-11-10',items:[{quantity:1,description:'ITEM'}]};
 for(const orderType of ['Gate','Panels','Fixings','Other']){
  const order={...base,orderType,colour:orderType==='Gate'?'Spruce':'',villa:orderType==='Gate'?'12':'',location:orderType==='Panels'?'North elevation':'',notes:'Keep wrapped '+orderType};
  const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order},manager);assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal(created.body.order.notes,order.notes);assert.equal((await request('/orders/'+created.body.order.id,undefined,manager)).body.order.notes,order.notes);
  const draftId=crypto.randomUUID(),draft=await request('/order-drafts/'+draftId,{order,attachmentIds:[],expectedUpdatedAt:''},manager);assert.equal(draft.status,200);assert.equal((await request('/order-drafts/'+draftId,undefined,manager)).body.draft.order.notes,order.notes);
 }
 const old=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{...base,orderType:'Fixings',locationNotes:'Older order note'}},manager);assert.equal(old.status,201);const order=old.body.order;
 const updated=await request('/orders/'+order.id,{order:{...order,notes:order.locationNotes,locationNotes:''},expectedUpdatedAt:order.updatedAt},admin);assert.equal(updated.status,200);assert.equal(updated.body.order.notes,'Older order note');assert.equal(updated.body.order.locationNotes,'');
});
