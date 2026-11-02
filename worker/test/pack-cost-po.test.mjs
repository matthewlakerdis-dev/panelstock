import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handlePurchaseOrders} from '../src/purchase-orders.js';
const actor={username:'admin',isAdmin:true};
function setup(){
 const docs=new Map([['workshop-stock',{revision:0,items:[],metadata:{},movements:[]}]]);
 const store={read:(k,d)=>structuredClone(docs.has(k)?docs.get(k):d),write:(k,v)=>docs.set(k,structuredClone(v)),requireTask(){},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};
 return {docs,store,post:body=>handlePurchaseOrders(store,'POST',{restoreEpoch:0,mutationId:crypto.randomUUID(),...body},actor).body};
}
test('PO stock creation preserves a 100-each purchase pack without creating stock or altering counts',()=>{
 const x=setup(),body={action:'create_item',mutationId:crypto.randomUUID(),item:{sku:'PACK-SPACER',name:'Spacer',category:'extrusions',unit:'each',qty:0,costBasis:'pack',packSize:100,packCost:12.34}};
 const result=x.post(body),item=result.items.find(i=>i.id===result.itemId);assert.equal(item.unit,'each');assert.equal(item.qty,0);assert.equal(item.packSize,100);assert.equal(item.costBasis,'pack');assert.equal(item.packCost,12.34);assert.equal(result.orders.length,0);
 assert.equal(x.post(body).duplicate,true);assert.equal(x.store.read('workshop-stock').items.length,1);
});
test('an invalid PO-created pack is rejected before inventory is written',()=>{
 const x=setup(),before=structuredClone(x.docs);
 assert.throws(()=>x.post({action:'create_item',item:{name:'Spacer',category:'extrusions',unit:'each',qty:0,costBasis:'pack',packSize:0,packCost:1}}),/Pack|pack/);assert.deepEqual(x.docs,before);
});
