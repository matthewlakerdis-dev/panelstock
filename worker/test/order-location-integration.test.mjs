import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('Location is saved separately on all non-Gate types and required for Fabrication/Fibre Cement',async()=>{
 const name='order-location',mf=new Miniflare(convertV4MiniflareOptions({workers:[{name,modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:name,MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;
 const call=async(path,body)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const ok=async(...args)=>{const r=await call(...args);assert.ok(r.status<300,JSON.stringify(r));return r.body;};
 const base={project:'Synthetic location project',siteContact:'Contact',phone:'0400',requestedDeliveryDate:'2026-11-30',items:[{description:'ITEM',quantity:1}],notes:'Delivery notes',locationNotes:'Historical note'};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));token=(await ok('/login',{username:'admin',pin:'123456'})).token;
  for(const type of ['Fabrication','Fibre Cement','Consumables'])await ok('/order-types',{name:type});
  for(const type of ['Fabrication','Fibre Cement']){
   const idempotencyKey=crypto.randomUUID(),before=(await ok('/orders')).orders;
   for(const location of [undefined,'','   ']){const r=await call('/orders',{idempotencyKey,order:{...base,orderType:type,location}});assert.equal(r.status,400);assert.match(r.body.error,/Location is required/);}
   assert.deepEqual((await ok('/orders')).orders,before);
   const saved=(await ok('/orders',{idempotencyKey,order:{...base,orderType:type,location:' North elevation '}})).order;assert.equal(saved.location,'North elevation');assert.equal(saved.notes,base.notes);assert.equal(saved.locationNotes,base.locationNotes);
   assert.equal((await ok('/orders',{idempotencyKey,order:{...base,orderType:type,location:'Other'}})).order.id,saved.id,'Lost-response retry creates only one order');
   const rejected=await call('/orders/'+saved.id,{expectedUpdatedAt:saved.updatedAt,order:{...saved,location:''}});assert.equal(rejected.status,400);assert.equal((await ok('/orders/'+saved.id)).order.location,'North elevation');
   const edited=(await ok('/orders/'+saved.id,{expectedUpdatedAt:saved.updatedAt,order:{...saved,location:'South elevation'}})).order;assert.equal(edited.location,'South elevation');assert.equal(edited.dateOrdered,saved.dateOrdered);assert.deepEqual(edited.items,saved.items);
  }
  for(const type of ['Fixings','Consumables','Plant / Equipment']){
   const saved=(await ok('/orders',{idempotencyKey:crypto.randomUUID(),order:{...base,orderType:type,location:'Site shed'}})).order;assert.equal(saved.location,'Site shed');
   const cleared=(await ok('/orders/'+saved.id,{expectedUpdatedAt:saved.updatedAt,order:{...saved,location:''}})).order;assert.equal(cleared.location,'');
  }
 }finally{await mf.dispose();}
});
