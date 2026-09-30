import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handlePurchaseOrders,purchaseOrderFile} from '../src/purchase-orders.js';
import {workshopView} from '../src/workshop-stock.js';
const admin={username:'admin',isAdmin:true},worker={username:'receiver',tasks:{'factory.receive':true}};
function setup(){
 const docs=new Map(),files=new Map(),audits=[];let onPut;
 const store={env:{CAD_PROJECT_FILES:{async put(key,bytes){files.set(key,new Uint8Array(bytes));await onPut?.();},async get(key){const bytes=files.get(key);return bytes?{size:bytes.length,async arrayBuffer(){return bytes.buffer;}}:null;},async delete(key){files.delete(key);}}},read:(k,d)=>structuredClone(docs.has(k)?docs.get(k):d),write:(k,v)=>docs.set(k,structuredClone(v)),requireTask:(a,t)=>{if(!a.isAdmin&&!a.tasks?.[t])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>{const before=structuredClone(docs);try{return fn();}catch(e){docs.clear();for(const [k,v] of before)docs.set(k,v);throw e;}}}},audit:(...v)=>audits.push(v),broadcastRevision(){}};
 store.write('workshop-stock',{revision:0,items:[{id:'angle',sku:'ANG',name:'Angle',category:'extrusions',unit:'lengths',qty:10,reservations:{'Job A':4},colour:'Black',lengthMm:6000},{id:'rivet',sku:'RIV',name:'Rivets',category:'fixings',unit:'boxes',qty:2,reservations:{}}],metadata:{},movements:[]});
 store.write('app:variants',[{id:'panel',sku:'ACP',color:'White',material:'ACP',thickness:4,width:2400,height:1200,qty:5}]);
 const post=(body,actor=admin)=>handlePurchaseOrders(store,'POST',{mutationId:crypto.randomUUID(),restoreEpoch:0,...body},actor).body;
 const create=(lines=[{itemId:'angle',ordered:8},{itemId:'variant:panel',ordered:5}])=>{const orderId=crypto.randomUUID();return post({action:'save',orderId,expectedVersion:0,reference:'PO-100',supplier:'Supplier',lines}).orders[0];};
 const upload=order=>purchaseOrderFile(store,order.id,null,'POST',{id:crypto.randomUUID(),name:'PO.pdf',data:btoa('%PDF-1.7\ntest'),restoreEpoch:0},admin);
 const current=id=>store.read('workshop-stock').purchaseOrders.find(o=>o.id===id);
 const ready=async()=>{const o=create();await upload(o);post({action:'publish',orderId:o.id,expectedVersion:current(o.id).version});return current(o.id);};
 return {store,docs,files,audits,post,create,upload,current,ready,setOnPut:fn=>onPut=fn};
}
test('admins prepare drafts; workers see only released POs and cannot set ordered quantities',async()=>{
 const x=setup(),o=x.create();assert.equal(o.status,'draft');assert.equal(x.store.read('workshop-stock').items[0].qty,10);
 assert.equal(handlePurchaseOrders(x.store,'GET',{},worker).body.orders.length,0);assert.equal(workshopView(x.store).purchaseOrders,undefined);
 assert.throws(()=>x.post({action:'save',orderId:o.id,expectedVersion:1,reference:'EDIT',supplier:'Supplier',lines:[]},worker),/Administrator/);
 assert.throws(()=>x.post({action:'publish',orderId:o.id,expectedVersion:1}),/Upload/);
 await x.upload(o);x.post({action:'publish',orderId:o.id,expectedVersion:x.current(o.id).version});
 assert.equal(handlePurchaseOrders(x.store,'GET',{},worker).body.orders[0].status,'open');
 assert.throws(()=>handlePurchaseOrders(x.store,'GET',{},{}),/Forbidden/);
});
test('mixed panel and workshop receipts are additive, partial and idempotent with delivery history',async()=>{
 const x=setup(),o=await x.ready();
 const body={action:'receive',orderId:o.id,expectedVersion:o.version,deliveryReference:'D-001',notes:'Balance next week',mutationId:crypto.randomUUID(),lines:[{itemId:'angle',quantity:3},{itemId:'variant:panel',quantity:2}]};
 let result=x.post(body,worker);assert.equal(result.orders[0].status,'partial');assert.equal(x.store.read('workshop-stock').items[0].qty,13);assert.equal(x.store.read('app:variants')[0].qty,7);assert.equal(x.store.read('workshop-stock').items[0].reservations['Job A'],4);
 assert.equal(result.orders[0].receipts[0].user,'receiver');assert.equal(result.orders[0].receipts[0].reference,'D-001');assert.equal(x.store.read('app:transactions').length,2);
 assert.equal(x.post(body,worker).duplicate,true);assert.equal(x.store.read('workshop-stock').items[0].qty,13);assert.equal(x.store.read('app:transactions').length,2);
 assert.throws(()=>x.post({...body,lines:[{itemId:'angle',quantity:1}]},worker),/reused/);
 result=x.post({action:'receive',orderId:o.id,expectedVersion:x.current(o.id).version,lines:[{itemId:'angle',quantity:5},{itemId:'variant:panel',quantity:3}]},worker);
 assert.equal(result.orders[0].status,'received');assert.equal(result.orders[0].receipts.length,2);assert.equal(x.store.read('workshop-stock').items[0].qty,18);assert.equal(x.store.read('app:variants')[0].qty,10);
 assert.throws(()=>x.post({action:'receive',orderId:o.id,expectedVersion:x.current(o.id).version,lines:[{itemId:'angle',quantity:1}]},worker),/not available/);
});
test('stale, excessive, fractional panel and invalid receipts leave all stock unchanged',async()=>{
 const x=setup(),o=await x.ready(),before=JSON.stringify([...x.docs]);
 for(const lines of [[{itemId:'angle',quantity:3},{itemId:'variant:panel',quantity:6}],[{itemId:'variant:panel',quantity:0.5}],[{itemId:'rivet',quantity:1}],[{itemId:'angle',quantity:1},{itemId:'angle',quantity:1}],[{itemId:'angle',quantity:-1}],[{itemId:'angle',quantity:0.0001}],[]]){
  assert.throws(()=>x.post({action:'receive',orderId:o.id,expectedVersion:o.version,lines},worker));assert.equal(JSON.stringify([...x.docs]),before);
 }
 assert.throws(()=>x.post({action:'receive',orderId:o.id,expectedVersion:o.version-1,lines:[{itemId:'angle',quantity:1}]},worker),/changed/);
 assert.throws(()=>x.post({action:'receive',orderId:o.id,expectedVersion:o.version,restoreEpoch:5,lines:[{itemId:'angle',quantity:1}]},worker),/restored/);
});
test('draft validation rejects duplicate stock variants and duplicate supplier PO references',()=>{
 const x=setup();for(const lines of [[{itemId:'missing',ordered:2}],[{itemId:'angle',ordered:0}],[{itemId:'variant:panel',ordered:0.5}],[{itemId:'angle',ordered:1},{itemId:'angle',ordered:2}]])assert.throws(()=>x.create(lines));
 x.create();assert.throws(()=>x.create(),/already exists/);
});
test('cancelling outstanding deliveries preserves receipts and prevents further stock changes',async()=>{
 const x=setup(),o=await x.ready();x.post({action:'receive',orderId:o.id,expectedVersion:o.version,lines:[{itemId:'angle',quantity:2}]},worker);
 assert.throws(()=>x.post({action:'cancel',orderId:o.id,expectedVersion:x.current(o.id).version,reason:'No more stock'},worker),/Administrator/);
 x.post({action:'cancel',orderId:o.id,expectedVersion:x.current(o.id).version,reason:'Supplier cancelled balance'});
 assert.equal(x.current(o.id).receipts.length,1);assert.equal(x.store.read('workshop-stock').items[0].qty,12);assert.equal(x.current(o.id).status,'cancelled');
});
test('PO files are private, validated, idempotent and stored outside stock documents',async()=>{
 const x=setup(),o=x.create(),body={id:crypto.randomUUID(),name:'PO.pdf',data:btoa('%PDF-1.7\nTest'),restoreEpoch:0};
 await assert.rejects(purchaseOrderFile(x.store,o.id,null,'POST',body,worker),/not found|Administrator/);
 for(const patch of [{name:'evil.html',data:btoa('<html>bad</html>')},{name:'PO.pdf',data:btoa('not pdf')},{data:'A'.repeat(7*1024*1024)}])await assert.rejects(purchaseOrderFile(x.store,o.id,null,'POST',{...body,...patch},admin));
 await purchaseOrderFile(x.store,o.id,null,'POST',body,admin);await purchaseOrderFile(x.store,o.id,null,'POST',body,admin);assert.equal(x.current(o.id).attachments.length,1);assert.equal(x.files.size,1);assert.equal(x.current(o.id).attachments[0].data,undefined);
 await assert.rejects(purchaseOrderFile(x.store,o.id,body.id,'GET',{},worker),/not found/);
 x.post({action:'publish',orderId:o.id,expectedVersion:x.current(o.id).version});const downloaded=await purchaseOrderFile(x.store,o.id,body.id,'GET',{},worker);assert.equal(downloaded.body.file.data,body.data);
});
test('asynchronous uploads reread latest state and never overwrite concurrent stock changes',async()=>{
 const x=setup(),o=x.create();x.setOnPut(()=>{const current=x.store.read('workshop-stock');current.items[0].qty=99;current.revision++;x.store.write('workshop-stock',current);});await x.upload(o);assert.equal(x.store.read('workshop-stock').items[0].qty,99);
});
