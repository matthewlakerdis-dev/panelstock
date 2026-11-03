import {test} from 'node:test';import assert from 'node:assert/strict';
import {recordOrderReceipt,submitOrderReceipt} from '../src/order-receipts.js';
import {readReceiptPhoto} from '../src/receipt-photos.js';
import {deliveryIssues,amendReceipt} from '../src/delivery-issues.js';
import {readReceiptAcknowledgement} from '../src/receipt-acknowledgement.js';
import {receiptAck} from './receipt-ack-fixture.mjs';
const actor={username:'site',tasks:{'site.orders.view':true,'site.orders.create':true}},admin={username:'manager',isAdmin:true};
function fixture(){
 const docs=new Map([['orders',[{id:'order',orderNumber:'9',project:'Site',status:'dispatched',requestedBy:'site',updatedAt:'v1',items:[{quantity:10,description:'ANGLE'},{quantity:5,description:'BOLTS'}],attachments:[{id:'creation',name:'Creation photo.png'}]}]],['users',{manager:{isAdmin:true}}]]),objects=new Map(),writes=[],notifications=[],uploads=[],deleted=[];
 const bucket={async put(key,bytes){uploads.push(key);objects.set(key,bytes);},async get(key){const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;},async delete(key){deleted.push(key);objects.delete(key);}};
 const store={env:{CAD_PROJECT_FILES:bucket},read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>{writes.push(key);docs.set(key,structuredClone(value));},ctx:{storage:{transactionSync:fn=>fn()}},requireTask(a,task){if(!a.isAdmin&&!a.tasks?.[task])throw Error('Denied');},taskAccess:()=>({}),audit(){},notify:(...args)=>notifications.push(args)};
 return {store,docs,objects,uploads,deleted,writes,notifications,bucket};
}
const input=(stamp='v1')=>({id:crypto.randomUUID(),mode:'site-checklist',expectedUpdatedAt:stamp,lines:[{index:0,arrived:true,accepted:4},{index:1,arrived:false,accepted:5}],attachmentIds:[],notes:'At site',acknowledgement:receiptAck()});
const photo=()=>({id:crypto.randomUUID(),name:'Delivery.png',data:receiptAck().image.split(',')[1]});
test('unchecked and short quantities become missing without duplicate issues; later arrivals resolve existing issues',()=>{
 const f=fixture(),first=recordOrderReceipt(f.store,'order',input(),actor);assert.equal(first.receipt.mode,'site-checklist');assert.deepEqual(first.receipt.lines.map(line=>[line.accepted,line.damaged,line.missing]),[[4,0,6],[0,0,5]]);assert.equal(first.order.status,'dispatched');assert.equal(deliveryIssues(first.order).length,2);
 const repeat=recordOrderReceipt(f.store,'order',{...input(first.order.updatedAt),lines:[{index:0,arrived:false,accepted:6},{index:1,arrived:false,accepted:5}]},actor);assert.equal(deliveryIssues(repeat.order).length,2);assert.equal(deliveryIssues(repeat.order).reduce((sum,issue)=>sum+issue.remaining,0),11);
 const last=recordOrderReceipt(f.store,'order',{...input(repeat.order.updatedAt),lines:[{index:0,arrived:true,accepted:6},{index:1,arrived:true,accepted:5}]},actor);assert.ok(deliveryIssues(last.order).every(issue=>issue.status==='resolved'));assert.equal(last.order.status,'dispatched');
 const snapshot=readReceiptAcknowledgement(f.store,'order',first.receipt.id,actor).acknowledgement;assert.equal(snapshot.lines[0].missing,6);assert.equal(snapshot.lines[1].missing,5);
});
test('checklists require every outstanding item and valid quantities without mutating invalid requests',()=>{
 for(const patch of [{lines:[{index:0,arrived:true,accepted:4}]},{lines:[{index:0,arrived:true,accepted:11},{index:1,arrived:false}]},{lines:[{index:0,arrived:'yes',accepted:4},{index:1,arrived:false}]}]){const f=fixture();assert.throws(()=>recordOrderReceipt(f.store,'order',{...input(),...patch},actor));assert.equal(f.writes.length,0);}
});
test('receipt corrections recalculate automatic replacement allocation while preserving signed missing quantities',()=>{
 const f=fixture(),first=recordOrderReceipt(f.store,'order',input(),actor),next=recordOrderReceipt(f.store,'order',{...input(first.order.updatedAt),lines:[{index:0,arrived:true,accepted:3},{index:1,arrived:false}]},actor);
 assert.equal(deliveryIssues(next.order).find(issue=>issue.index===0).remaining,3);
 const corrected=amendReceipt(f.store,'order',{mutationId:crypto.randomUUID(),receiptId:next.receipt.id,expectedUpdatedAt:next.order.updatedAt,reason:'Only two angles arrived',lines:[{index:0,accepted:2,damaged:0,missing:4},{index:1,accepted:0,damaged:0,missing:5}]},admin);
 assert.equal(deliveryIssues(corrected.order).find(issue=>issue.index===0).remaining,4);assert.equal(deliveryIssues(corrected.order).filter(issue=>issue.index===0).length,1);assert.equal(readReceiptAcknowledgement(f.store,'order',next.receipt.id,actor).acknowledgement.lines[0].accepted,3);
});
test('optional delivery photos are private, signed, retry-safe and separate from creation attachments',async()=>{
 const f=fixture(),body={...input(),attachmentIds:['creation'],deliveryPhoto:photo()},saved=await submitOrderReceipt(f.store,'order',body,actor);assert.equal(f.uploads.length,1);assert.equal(saved.receipt.deliveryPhoto.id,body.deliveryPhoto.id);assert.match(saved.receipt.deliveryPhoto.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(saved.receipt.attachmentIds,[]);assert.deepEqual(saved.order.attachments,[{id:'creation',name:'Creation photo.png'}]);assert.doesNotMatch(JSON.stringify(saved.order),/data:image|base64/);
 const ack=readReceiptAcknowledgement(f.store,'order',body.id,actor).acknowledgement;assert.deepEqual(ack.deliveryPhoto,saved.receipt.deliveryPhoto);assert.equal((await readReceiptPhoto(f.store,'order',body.id,body.deliveryPhoto.id,actor)).photo.data,body.deliveryPhoto.data);
 await assert.rejects(()=>readReceiptPhoto(f.store,'order',body.id,body.deliveryPhoto.id,{...actor,username:'other'}),/Only the requester/);
 assert.equal((await submitOrderReceipt(f.store,'order',{...body,deliveryPhoto:photo()},actor)).duplicate,true);assert.equal(f.uploads.length,1);assert.equal(f.notifications.length,1);
});
test('photo failures do not save receipts and concurrent updates clean up only the uncommitted photo',async()=>{
 for(const patch of [{acknowledgement:{...receiptAck(),name:''}},{deliveryPhoto:{...photo(),data:'AAAA'}},{deliveryPhoto:{...photo(),name:'bad\nname'}}]){const f=fixture();await assert.rejects(()=>submitOrderReceipt(f.store,'order',{...input(),deliveryPhoto:photo(),...patch},actor));assert.equal(f.uploads.length,0);assert.equal(f.writes.length,0);}
 const f=fixture();f.bucket.put=async(key,bytes)=>{f.objects.set(key,bytes);const orders=f.docs.get('orders');orders[0].updatedAt='concurrent';};const conflict=await submitOrderReceipt(f.store,'order',{...input(),deliveryPhoto:photo()},actor);assert.equal(conflict.code,'ORDER_CONFLICT');assert.equal(f.objects.size,0);assert.equal(f.deleted.length,1);assert.equal(f.docs.get('orders')[0].receipts,undefined);
 const optional=fixture();delete optional.store.env.CAD_PROJECT_FILES;assert.equal((await submitOrderReceipt(optional.store,'order',input(),actor)).ok,true);
});
