import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('dispatch-only users receive the current project address without order writes and can confirm an edited destination',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'dispatch-address-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'dispatch-address-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const request=async(path,body,token)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  const hash=value=>createHash('sha256').update(value).digest('hex'),kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},dispatcher:{isAdmin:false,pinHash:hash('654321:dispatcher:panelstock')}}));
  const admin=(await request('/login',{username:'admin',pin:'123456'})).body.token;assert.ok(admin);
  assert.equal((await request('/admin/set-task-access',{targetUsername:'dispatcher',taskCode:'factory.dispatch',allowed:true},admin)).status,200);
  assert.equal((await request('/admin/set-task-access',{targetUsername:'dispatcher',taskCode:'site.orders.view',allowed:false},admin)).status,200);
  const dispatcher=(await request('/login',{username:'dispatcher',pin:'654321'})).body.token;assert.ok(dispatcher);
  const project=(await request('/projects',{name:'Address Test Project',address:'1 Project Road',notes:'PRIVATE PROJECT NOTES'},admin)).body.project;assert.ok(project.id);
  const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{projectId:project.id,project:project.name,siteContact:'Contact',phone:'0400',orderType:'Fixings',requestedDeliveryDate:'2026-11-10',location:'Never the postal address',items:[{quantity:1,description:'FIXINGS'}]}},admin);assert.equal(created.status,201,JSON.stringify(created.body));
  let order=created.body.order;const ready=await request('/orders/'+order.id+'/status',{status:'completed',expectedUpdatedAt:order.updatedAt},admin);assert.equal(ready.status,200);order=(await request('/orders/'+order.id,undefined,admin)).body.order;
  assert.equal((await request('/orders',undefined,dispatcher)).status,403);
  assert.equal((await request('/dispatch/orders')).status,401);
  let queue=await request('/dispatch/orders',undefined,dispatcher);assert.equal(queue.status,200);assert.equal(queue.body.orders.find(row=>row.id===order.id).siteAddress,'1 Project Road');assert.doesNotMatch(JSON.stringify(queue.body),/PRIVATE PROJECT NOTES/);
  assert.deepEqual((await request('/orders/'+order.id,undefined,admin)).body.order,order);
  for(const address of ['2 Updated Road','']){
   assert.equal((await request('/projects/'+project.id,{...project,address},admin)).status,200);
   order=(await request('/orders/'+order.id,undefined,admin)).body.order;
   queue=await request('/dispatch/orders',undefined,dispatcher);assert.equal(queue.body.orders.find(row=>row.id===order.id).siteAddress,address);
   assert.deepEqual((await request('/orders/'+order.id,undefined,admin)).body.order,order);
  }
  const payload={id:order.id,mutationId:crypto.randomUUID(),expectedUpdatedAt:order.updatedAt,destination:'Alternative delivery entrance',transport:'Truck',driver:'Driver',notes:'Call on arrival'};
  const dispatched=await request('/dispatch/orders',payload,dispatcher);assert.equal(dispatched.status,200,JSON.stringify(dispatched.body));assert.equal(dispatched.body.order.dispatch.destination,payload.destination);
  const retry=await request('/dispatch/orders',payload,dispatcher);assert.equal(retry.status,200);assert.equal(retry.body.idempotent,true);
  const saved=(await request('/orders/'+order.id,undefined,admin)).body.order;assert.equal(saved.status,'dispatched');assert.equal(saved.dispatch.destination,payload.destination);assert.equal(saved.siteAddress,undefined);
  const history=(await request('/orders/'+order.id+'/history',undefined,admin)).body.events;assert.equal(history.filter(event=>event.label==='Order dispatched').length,1);
 }finally{await mf.dispose();}
});
