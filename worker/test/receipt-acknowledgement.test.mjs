import {test} from 'node:test';
import assert from 'node:assert/strict';
import UPNGModule from '@pdf-lib/upng';
import {recordOrderReceipt} from '../src/order-receipts.js';
import {readReceiptAcknowledgement,receiptSignatureKey} from '../src/receipt-acknowledgement.js';
import {amendReceipt} from '../src/delivery-issues.js';
import {receiptAck} from './receipt-ack-fixture.mjs';
const UPNG=UPNGModule.default||UPNGModule,owner={username:'site',tasks:{'site.orders.view':true,'site.orders.create':true}},admin={username:'admin',isAdmin:true};
function fixture(){const docs=new Map([['orders',[{id:'order',orderNumber:'7',project:'Project',status:'dispatched',requestedBy:'site',updatedAt:'v1',items:[{quantity:10,description:'ANGLE'}]}]],['users',{}]]),writes=[],alerts=[];const store={read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>{writes.push(key);docs.set(key,structuredClone(value));},requireTask:(actor,key)=>{if(!actor.isAdmin&&!actor.tasks?.[key])throw Error('Denied');},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},notify:(...args)=>alerts.push(args),taskAccess:()=>({})};return {store,docs,writes,alerts};}
const body=()=>({id:crypto.randomUUID(),expectedUpdatedAt:'v1',lines:[{index:0,arrived:true,accepted:4,damaged:1,missing:2}],notes:'Left at gate',acknowledgement:receiptAck()});
test('signed deliveries preserve status and immutable original quantities without putting images in order feeds',()=>{
 const f=fixture(),input=body(),saved=recordOrderReceipt(f.store,'order',input,owner);assert.equal(saved.order.status,'dispatched');assert.equal(saved.receipt.acknowledgement.name,'Site Recipient');assert.match(saved.receipt.acknowledgement.contentHash,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(saved.order),/data:image/);
 const ack=readReceiptAcknowledgement(f.store,'order',input.id,owner).acknowledgement;assert.equal(ack.image,input.acknowledgement.image);assert.equal(ack.lines[0].accepted,4);assert.equal(ack.notes,'Left at gate');const original=structuredClone(ack);
 amendReceipt(f.store,'order',{mutationId:crypto.randomUUID(),receiptId:input.id,expectedUpdatedAt:saved.order.updatedAt,reason:'Correct count',lines:[{index:0,accepted:5,damaged:0,missing:2}]},admin);assert.deepEqual(readReceiptAcknowledgement(f.store,'order',input.id,owner).acknowledgement,original);
 const before=f.writes.length;assert.equal(recordOrderReceipt(f.store,'order',input,owner).duplicate,true);assert.equal(f.writes.length,before);assert.deepEqual(f.docs.get(receiptSignatureKey('order',input.id)),original);
});
test('signature access is restricted even when another user can view the order',()=>{
 const f=fixture(),input=body();recordOrderReceipt(f.store,'order',input,owner);assert.throws(()=>readReceiptAcknowledgement(f.store,'order',input.id,{...owner,username:'other'}),/Only the requester/);assert.throws(()=>readReceiptAcknowledgement(f.store,'order','unknown',admin),/not found/);assert.equal(readReceiptAcknowledgement(f.store,'order',input.id,admin).ok,true);
});
test('missing names, unchecked arrivals, invalid images and empty signatures cannot write or notify',()=>{
 const blank='data:image/png;base64,'+Buffer.from(UPNG.encode([new Uint8Array(300*100*4).fill(255).buffer],300,100,0)).toString('base64');
 const bad=[{acknowledgement:undefined},{acknowledgement:{...receiptAck(),name:''}},{acknowledgement:{...receiptAck(),name:'x'.repeat(121)}},{acknowledgement:{...receiptAck(),image:'https://example.test/signature.png'}},{acknowledgement:{...receiptAck(),image:blank}},{acknowledgement:{...receiptAck(),image:'data:image/png;base64,AAAA'}},{lines:[{index:0,arrived:false,accepted:4}]},{lines:[{index:0,arrived:true,accepted:0,damaged:0,missing:1}]}];
 for(const patch of bad){const f=fixture();assert.throws(()=>recordOrderReceipt(f.store,'order',{...body(),...patch},owner));assert.equal(f.writes.length,0);assert.equal(f.alerts.length,0);}
});
test('legacy receipts remain readable and their old retry identifier does not require a new signature',()=>{
 const f=fixture(),input=body(),order=f.docs.get('orders')[0];order.receipts=[{id:input.id,by:owner.username,at:'old',lines:[{index:0,accepted:1}],notes:'Earlier receipt',attachmentIds:[]}];assert.equal(recordOrderReceipt(f.store,'order',{id:input.id},owner).duplicate,true);assert.throws(()=>readReceiptAcknowledgement(f.store,'order',input.id,owner),/No signature/);assert.equal(f.writes.length,0);
});
