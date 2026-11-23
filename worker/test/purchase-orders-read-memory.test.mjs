import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {handlePurchaseOrders,purchaseOrderFile} from '../src/purchase-orders.js';

const admin={username:'admin',isAdmin:true},worker={username:'receiver',tasks:{'factory.receive':true}};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const draftId='11111111-1111-4111-8111-111111111111',openId='22222222-2222-4222-8222-222222222222';
function fixture(image=png,large=false){
 const item=index=>({id:'angle-'+index,sku:'ANGLE-'+index,name:'Angle '+index,category:'extrusions',unit:'lengths',qty:10,reservations:{'Job A':4},unitCost:12.34,colour:'Black',lengthMm:6000,image});
 const po=(id,status)=>({id,version:1,reference:'PO-'+status,supplier:'Supplier',status,notes:'Original PO notes',lines:[{itemId:'angle-0',name:'Angle 0',sku:'ANGLE-0',unit:'lengths',ordered:8,received:0}],attachments:[{id:randomUUID(),name:'Original.pdf',sha256:'a'.repeat(64)}],receipts:[]});
 const state={revision:7,items:Array.from({length:large?6:2},(_,index)=>item(index)),metadata:{'variant:panel':{unitCost:88,image:png}},movements:[],purchaseOrders:[po(draftId,'draft'),po(openId,'open')],poStockReferences:[{key:'private',itemId:'angle-0',source:{sku:'PRIVATE-SUPPLIER-ALIAS'}}]};
 const docs=new Map([['workshop-stock',JSON.stringify(state)],['revision','10'],['restoreEpoch','0'],['app:variants',JSON.stringify([{id:'panel',sku:'SHEET',color:'White',material:'ACP',thickness:3,width:2400,height:1200,qty:5}])]]),objects=new Map(),writes=[],audits=[];let reads=0,budget=Infinity,onPut;
 const store={read(key,fallback){if(key==='workshop-stock'){reads++;assert.ok(reads<=budget,'The request reparsed the complete image-bearing stock state');}return docs.has(key)?JSON.parse(docs.get(key)):fallback;},write(key,value){writes.push(key);docs.set(key,JSON.stringify(value));},requireTask(actor,task){if(!actor.isAdmin&&!actor.tasks?.[task])throw Error('Forbidden');},audit:(...args)=>audits.push(args),broadcastRevision(){},ctx:{storage:{transactionSync(fn){const before=new Map(docs),writeCount=writes.length,auditCount=audits.length;try{return fn();}catch(error){docs.clear();for(const row of before)docs.set(...row);writes.length=writeCount;audits.length=auditCount;throw error;}}}},env:{CAD_PROJECT_FILES:{async put(key,bytes){objects.set(key,new Uint8Array(bytes));await onPut?.();},async get(key){const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;}}}};
 const stored=()=>JSON.parse(docs.get('workshop-stock'));
 function start(max){reads=0;budget=max;}
 const request=(method,body={},actor=admin,max=1)=>{start(max);const result=handlePurchaseOrders(store,method,body,actor).body;assert.equal(reads,max);return result;};
 const post=(body,actor=admin)=>request('POST',{mutationId:randomUUID(),restoreEpoch:0,...body},actor);
 return {store,docs,writes,audits,objects,stored,request,post,reset:start,get reads(){return reads;},onPut:fn=>onPut=fn};
}

test('PO GET reads a production-sized stock document once and preserves images, costs and administrator-only data',()=>{
 const bytes=Buffer.alloc(4*1024*1024,1);bytes.set([137,80,78,71,13,10,26,10]);const image='data:image/png;base64,'+bytes.toString('base64'),f=fixture(image,true);assert.ok(f.docs.get('workshop-stock').length>33000000);
 const result=f.request('GET');assert.equal(result.orders.length,2);assert.equal(result.stockReferences[0].source.sku,'PRIVATE-SUPPLIER-ALIAS');for(const row of result.items.filter(row=>!row.legacy)){assert.equal(row.image,image);assert.equal(row.qty,10);assert.equal(row.unitCost,12.34);}
 const ordinary=f.request('GET',{},worker);assert.deepEqual(ordinary.stockReferences,[]);assert.equal(ordinary.orders.length,1);assert.equal(ordinary.orders[0].id,openId);assert.equal(f.writes.length,0);f.reset(0);assert.throws(()=>handlePurchaseOrders(f.store,'GET',{},{}),/Forbidden/);assert.equal(f.reads,0);
});

test('PO save, publish, receive and correction reuse one current state and exact retries return the latest result without writes',()=>{
 const f=fixture(),saved=f.post({action:'save',orderId:draftId,expectedVersion:1,reference:'PO-edited',supplier:'Supplier',lines:[{itemId:'angle-0',ordered:10}]});assert.equal(saved.orders[0].version,2);assert.equal(saved.items.find(row=>row.id==='angle-0').qty,10);
 const released=f.post({action:'publish',orderId:draftId,expectedVersion:2});assert.equal(released.orders[0].status,'open');
 const receive={action:'receive',orderId:draftId,expectedVersion:3,mutationId:randomUUID(),lines:[{itemId:'angle-0',quantity:3}]},received=f.post(receive,worker);assert.equal(received.orders.find(row=>row.id===draftId).status,'partial');assert.equal(received.items.find(row=>row.id==='angle-0').qty,13);
 const receipt=received.orders.find(row=>row.id===draftId).receipts[0],corrected=f.post({action:'correct_receipt',orderId:draftId,expectedVersion:4,receiptId:receipt.id,reason:'Correct synthetic docket',lines:[{itemId:'angle-0',quantity:2}]});assert.equal(corrected.items.find(row=>row.id==='angle-0').qty,12);assert.equal(corrected.items.find(row=>row.id==='angle-0').reserved,4);assert.equal(corrected.items.find(row=>row.id==='angle-0').unitCost,12.34);assert.equal(corrected.items.find(row=>row.id==='angle-0').image,png);
 const writes=f.writes.length,audits=f.audits.length,retry=f.post(receive,worker);assert.equal(retry.duplicate,true);assert.equal(retry.items.find(row=>row.id==='angle-0').qty,12);assert.equal(retry.orders.find(row=>row.id===draftId).version,5);assert.equal(f.writes.length,writes);assert.equal(f.audits.length,audits);
 f.reset(0);assert.throws(()=>handlePurchaseOrders(f.store,'POST',{...receive,restoreEpoch:0,lines:[{itemId:'angle-0',quantity:9}]},worker),/reused/);assert.equal(f.writes.length,writes);
});

test('PO item creation responds from committed workshop or panel data without reloading the stock library',()=>{
 const f=fixture(),manual=f.post({action:'create_item',item:{category:'fixings',unit:'each',name:'New bolts',sku:'NEW-BOLT',unitCost:2.5}});assert.equal(manual.items.find(row=>row.id===manual.itemId).qty,0);assert.equal(manual.items.find(row=>row.id===manual.itemId).unitCost,2.5);
 const panel=f.post({action:'create_item',item:{category:'panels',name:'New sheet',sku:'NEW-SHEET',colour:'Blue',material:'ACP',thickness:4,width:2000,height:1000}});assert.equal(panel.items.find(row=>row.id===panel.itemId).qty,0);assert.equal(panel.items.find(row=>row.id===panel.itemId).name,'New sheet');assert.equal(panel.items.find(row=>row.id==='angle-0').image,png);
});

test('PO file completion rereads once after storage and preserves concurrent stock, PO and supplier-reference changes',async t=>{
 const f=fixture(),body={id:randomUUID(),name:'PO.pdf',data:btoa('%PDF-1.7\nSynthetic PO file'),restoreEpoch:0};
 f.onPut(()=>{const state=f.stored();state.items[0].qty=99;state.poStockReferences[0].source.sku='CONCURRENT-PRIVATE-ALIAS';const order=state.purchaseOrders.find(row=>row.id===draftId);order.notes='Concurrent office notes';order.version=9;state.revision++;f.docs.set('workshop-stock',JSON.stringify(state));});
 f.reset(2);const result=(await purchaseOrderFile(f.store,draftId,null,'POST',body,admin)).body;assert.equal(f.reads,2);assert.equal(result.items.find(row=>row.id==='angle-0').qty,99);assert.equal(result.stockReferences[0].source.sku,'CONCURRENT-PRIVATE-ALIAS');assert.equal(result.orders[0].notes,'Concurrent office notes');assert.equal(result.orders[0].version,10);assert.equal(result.orders[0].attachments.length,2);assert.equal(result.items.find(row=>row.id==='angle-0').unitCost,12.34);assert.equal(result.items.find(row=>row.id==='angle-0').image,png);
 const writes=f.writes.length,audits=f.audits.length;f.onPut(()=>assert.fail('An identical file retry must not upload again'));
 const digest=crypto.subtle.digest.bind(crypto.subtle);t.mock.method(crypto.subtle,'digest',async(...args)=>{const hash=await digest(...args),state=f.stored();state.items[0].qty=68;state.poStockReferences[0].source.sku='EDITED-DURING-HASH';f.docs.set('workshop-stock',JSON.stringify(state));return hash;});
 f.reset(2);const retry=(await purchaseOrderFile(f.store,draftId,null,'POST',body,admin)).body;assert.equal(f.reads,2);assert.equal(retry.items.find(row=>row.id==='angle-0').qty,68);assert.equal(retry.stockReferences[0].source.sku,'EDITED-DURING-HASH');assert.equal(f.objects.size,1);assert.equal(f.writes.length,writes);assert.equal(f.audits.length,audits);
});

test('concurrent identical PO file completion returns the latest state without recording another file and restored epochs still reject delayed uploads',async()=>{
 const f=fixture(),body={id:randomUUID(),name:'PO.pdf',data:btoa('%PDF-1.7\nSynthetic duplicate'),restoreEpoch:0};
 f.onPut(()=>{const state=f.stored(),order=state.purchaseOrders.find(row=>row.id===draftId);order.attachments.push({id:body.id,name:body.name,sha256:createHash('sha256').update(Buffer.from(body.data,'base64')).digest('hex')});order.notes='Concurrent identical upload';order.version=8;state.items[0].qty=77;f.docs.set('workshop-stock',JSON.stringify(state));});
 f.reset(2);const result=(await purchaseOrderFile(f.store,draftId,null,'POST',body,admin)).body;assert.equal(f.reads,2);assert.equal(result.orders[0].notes,'Concurrent identical upload');assert.equal(result.orders[0].version,8);assert.equal(result.items.find(row=>row.id==='angle-0').qty,77);assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);
 const blocked=fixture();blocked.onPut(()=>blocked.docs.set('restoreEpoch','1'));blocked.reset(1);await assert.rejects(purchaseOrderFile(blocked.store,draftId,null,'POST',{...body,id:randomUUID()},admin),/restored/);assert.equal(blocked.stored().purchaseOrders[0].attachments.length,1);assert.equal(blocked.writes.length,0);
});
