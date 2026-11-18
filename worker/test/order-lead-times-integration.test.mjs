import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import lead from '../../order-lead-times.js';

test('actual Worker enforces admin-configured lead times without losing idempotency or historical order edits',async()=>{
 const name='order-lead-test',mf=new Miniflare(convertV4MiniflareOptions({workers:[{name,modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:name,MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;const call=async(path,body)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.body;};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify(Object.fromEntries(['admin','staff'].map(username=>[username,{isAdmin:username==='admin',pinHash:createHash('sha256').update('123456:'+username+':panelstock').digest('hex')}]))));token=(await ok('/login',{username:'admin',pin:'123456'})).token;const admin=token;
  await ok('/order-types',{name:'Fabrication'});const historical={project:'Synthetic project',orderType:'Fixings',siteContact:'Contact',phone:'0400',requestedDeliveryDate:'2026-01-01',items:[{quantity:1,description:'TEST'}]},historicalKey=crypto.randomUUID(),old=(await ok('/orders',{idempotencyKey:historicalKey,order:historical})).order;
  const settings=(await ok('/order-lead-times',{days:{Fixings:2,Fabrication:5},expectedUpdatedAt:''})).leadTimes;assert.equal((await ok('/orders')).leadTimes.days.Fabrication,5);assert.equal((await ok('/orders',{idempotencyKey:historicalKey,order:historical})).order.id,old.id,'A successful old request can be retried after the policy changes');
  const edited=(await ok('/orders/'+old.id,{order:{...old,notes:'Keep historical requested date'},expectedUpdatedAt:old.updatedAt})).order;assert.equal(edited.requestedDeliveryDate,historical.requestedDeliveryDate);
  const earliest=lead.minimumDate(settings,'Fixings'),idempotencyKey=crypto.randomUUID(),before=(await ok('/orders')).orders.length;
  for(const extra of [{},{isAdmin:true},{skipLeadTime:true},{createdAt:'2020-01-01'}]){const r=await call('/orders',{idempotencyKey,order:{...historical,requestedDeliveryDate:lead.today(),...extra}});assert.equal(r.status,400);assert.equal(r.body.code,'ORDER_LEAD_TIME');assert.match(r.body.error,new RegExp(earliest));}
  assert.equal((await ok('/orders')).orders.length,before);const saved=(await ok('/orders',{idempotencyKey,order:{...historical,requestedDeliveryDate:earliest}})).order;assert.equal((await ok('/orders',{idempotencyKey,order:{...historical,requestedDeliveryDate:lead.today()}})).order.id,saved.id);
  const rejected=await call('/orders/'+saved.id,{order:{...saved,requestedDeliveryDate:lead.today()},expectedUpdatedAt:saved.updatedAt});assert.equal(rejected.body.code,'ORDER_LEAD_TIME');assert.equal((await ok('/orders/'+saved.id)).order.requestedDeliveryDate,earliest);
  token=(await ok('/login',{username:'staff',pin:'123456'})).token;assert.equal((await call('/order-lead-times',{days:{Fixings:0},expectedUpdatedAt:settings.updatedAt})).status,403);token=admin;assert.equal((await ok('/order-lead-times')).leadTimes.days.Fixings,2);
 }finally{await mf.dispose();}
});
