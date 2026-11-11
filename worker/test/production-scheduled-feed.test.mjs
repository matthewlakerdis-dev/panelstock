import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {SITE_ORDER_COLUMNS} from '../src/site-orders-excel.js';
test('live spreadsheet feed follows person booking creation and removal and preserves old layouts',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'production-booking-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'booking-test',CNC_PUBLIC_TOKEN:'synthetic-booking-feed',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;const api=async(path,body,method=body===undefined?'GET':'POST')=>{const r=await mf.dispatchFetch('http://localhost'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;};
 const feed=async version=>{const r=await mf.dispatchFetch(`http://localhost/cnc-tracker/excel-data?report=site-orders&siteOrdersVersion=${version}&token=synthetic-booking-feed`);assert.equal(r.status,200);return [...(await r.text()).matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(m=>m[1]);};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),order={id:'12345678-1234-4234-8234-123456789012',project:'Example',orderNumber:'1',orderType:'Panels',status:'submitted'};
  await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));
  token=(await api('/login',{username:'admin',pin:'123456'})).token;
  const created=await api('/orders',{idempotencyKey:crypto.randomUUID(),order:{...order,location:'East',siteContact:'Test',phone:'0000',requestedDeliveryDate:'2026-11-09',items:[{quantity:1,description:'Panel'}]}});order.id=created.order.id;
  const schedule=await api('/schedule'),project=schedule.projects.find(p=>p.name==='Example'),column=16;
  assert.equal((await feed(11))[column],'-');
  assert.equal(schedule.orders.find(value=>value.id===order.id).location,'East');assert.equal(schedule.orders.find(value=>value.id===order.id).alreadyScheduled,false);
  const payload={projectId:project.id,orderId:order.id,assignedUsername:'admin',date:'2026-11-09',scheduleType:'general'};
  const first=await api('/schedule',payload),second=await api('/schedule',{...payload,scheduleType:'cnc'});
  assert.equal((await feed(11))[column],'✓');assert.equal((await feed(6)).length,21);
  assert.match(first.entry.title,/ · East$/);assert.equal((await api('/schedule')).orders.find(value=>value.id===order.id).alreadyScheduled,true);
  await api('/schedule/'+first.entry.id,undefined,'DELETE');assert.equal((await feed(11))[column],'✓');
  await api('/schedule/'+second.entry.id,undefined,'DELETE');assert.equal((await feed(11))[column],'-');
  await api('/schedule',{...payload,scheduleType:'delivery'});assert.equal((await feed(11))[column],'-');
  await api('/order-types',{name:'Gate'});
  const gate=await api('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Example',orderType:'Gate',villa:'V135',colour:'Spruce',siteContact:'Test',phone:'0000',requestedDeliveryDate:'2026-11-09',items:[{quantity:1,description:'Gate'}]}});
  assert.equal((await api('/schedule')).orders.find(value=>value.id===gate.order.id).villa,'V135');
  const gateBooking=await api('/schedule',{...payload,orderId:gate.order.id});assert.match(gateBooking.entry.title,/ · V135$/);
  assert.equal((await api('/schedule')).orders.find(value=>value.id===order.id).alreadyScheduled,true);
  const supply=(await api('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Supply order',orderType:'Fixings',siteContact:'Test',phone:'0000',requestedDeliveryDate:'2026-11-09',items:[{quantity:1,description:'Fixings'}]}})).order;
  for(const version of [7,8,9,10,11]){const r=await mf.dispatchFetch(`http://localhost/cnc-tracker/excel-data?report=site-orders&siteOrdersVersion=${version}&token=synthetic-booking-feed`);assert.equal(r.status,200);const row=(await r.text()).match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g).find(value=>value.includes(supply.id)),values=[...row.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);assert.equal(values[version===11?column:14],'n/a');assert.equal(values[version===11?12:version===10?19:10],'Submitted');}
  assert.equal((await api('/orders/'+supply.id)).order.status,'submitted');
 }finally{await mf.dispose();}
});
