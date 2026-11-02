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
async function create(){const result=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{projectId:project.id,project:project.name,orderType:'Panels',siteContact:'Leading Hand',phone:'0400123456',requestedDeliveryDate:'2026-11-05',items:[{quantity:2,description:'BOLTS'}]}},manager);assert.equal(result.status,201,JSON.stringify(result.body));return result.body.order;}
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
 const results=await Promise.all([request(path,{orderType:'Gate',expectedUpdatedAt},admin),request(path,{orderType:'Gate',expectedUpdatedAt},admin)]);assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
 const saved=results.find(result=>result.status===200).body.order;assert.equal(saved.orderType,'Gate');assert.equal(saved.status,order.status);assert.equal(saved.manualProduction,undefined);
 const progress=(await request('/orders/'+order.id+'/progress',undefined,manager)).body.progress;assert.equal(progress.stages.find(stage=>stage.label==='Fabricated / QA').state,'pending');assert.equal(progress.stages.at(-1).state,'pending');
});
