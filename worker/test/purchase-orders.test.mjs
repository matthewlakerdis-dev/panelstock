import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handlePurchaseOrders,purchaseOrderFile} from '../src/purchase-orders.js';
import {workshopView} from '../src/workshop-stock.js';
const admin={username:'admin',isAdmin:true},worker={username:'receiver',tasks:{'factory.receive':true}};
test('admin creates zero-on-hand stock from a PO without creating an order; retries return the same item',()=>{
 const x=setup(),body={action:'create_item',mutationId:crypto.randomUUID(),item:{sku:'NEW',name:'New profile',category:'extrusions',unit:'lengths',colour:'Black',lengthMm:6000,supplier:'Supplier'}};
 assert.throws(()=>x.post(body,worker),/Administrator/);
 assert.throws(()=>x.post({...body,item:{...body.item,qty:5}}),/zero/);
 const result=x.post(body),item=result.items.find(i=>i.id===result.itemId);assert.equal(item.qty,0);assert.equal(item.supplier,'Supplier');assert.equal(result.orders.length,0);
 assert.equal(x.post(body).itemId,result.itemId);assert.equal(x.post(body).duplicate,true);
 assert.equal(x.store.read('workshop-stock').items.filter(i=>i.sku==='NEW').length,1);
 assert.throws(()=>x.post({...body,mutationId:crypto.randomUUID()}),/already exists/);
 assert.throws(()=>x.post({...body,item:{...body.item,name:'Different'}}),/reused/);
 assert.throws(()=>x.post({...body,mutationId:crypto.randomUUID(),restoreEpoch:1}),/restored/);
});
test('PO-created sheet stock uses the panel catalogue and only increases on receipt',async()=>{
 const x=setup(),item={sku:'NEW-PANEL',name:'White panel',category:'panels',colour:'White',material:'ACP',thickness:4,width:2400,height:1200};
 const result=x.post({action:'create_item',item}),id=result.itemId;
 assert.ok(id.startsWith('variant:'));assert.equal(result.items.find(i=>i.id===id).qty,0);assert.equal(x.store.read('app:catalog').length,1);
 assert.throws(()=>x.post({action:'create_item',item}),/already exists/);
 x.post({action:'create_item',item:{...item,width:3000}});assert.equal(x.store.read('app:catalog').length,1);
 const o=x.create([{itemId:id,ordered:2}]);await x.upload(o);x.post({action:'publish',orderId:o.id,expectedVersion:x.current(o.id).version});
 x.post({action:'receive',orderId:o.id,expectedVersion:x.current(o.id).version,lines:[{itemId:id,quantity:1}]},worker);
 assert.equal(workshopView(x.store).items.find(i=>i.id===id).qty,1);assert.equal(x.current(o.id).status,'partial');
});
test('invalid new stock and duplicate colour-length variants leave inventory unchanged',()=>{
 const x=setup(),before=JSON.stringify([...x.docs]);
 for(const item of [{sku:'X',name:'X',category:'missing',unit:'each'},{sku:'X',name:'X',category:'panels',colour:'White',material:'ACP',width:0,height:1200,thickness:4},{sku:'ANG',name:'Angle',category:'extrusions',unit:'lengths',colour:'Black',lengthMm:6000},{sku:'X',name:'X',category:'offcuts',unit:'lengths'}]){
  assert.throws(()=>x.post({action:'create_item',item}));assert.equal(JSON.stringify([...x.docs]),before);
 }
});
const report=(x,o,patch={})=>x.post({action:'report_issue',orderId:o.id,expectedVersion:x.current(o.id).version,itemId:'angle',kind:'damaged',quantity:2,notes:'Bent lengths rejected',deliveryReference:'D-102',...patch},worker);

test('delivery issues are retry-safe and never change stock, receipts or incoming quantities',async()=>{
 const x=setup(),o=await x.ready(),mutationId=crypto.randomUUID();
 const body={mutationId,expectedVersion:o.version};
 const result=report(x,o,body),issue=result.orders[0].issues[0];
 assert.equal(issue.user,'receiver');assert.equal(issue.status,'open');assert.equal(issue.reference,'D-102');assert.ok(issue.at);
 assert.equal(report(x,o,body).duplicate,true);assert.equal(x.current(o.id).issues.length,1);
 assert.equal(x.current(o.id).receipts.length,0);assert.equal(x.store.read('workshop-stock').items[0].qty,10);
 assert.equal(workshopView(x.store).items.find(i=>i.id==='angle').onOrder,8);
 assert.equal(x.store.read('app:transactions',[]).length,0);
 assert.throws(()=>report(x,o,{...body,notes:'different'}),/reused/);
 assert.throws(()=>report(x,o,{expectedVersion:o.version}),/changed/);
 for(const patch of [{kind:'other'},{quantity:-1},{quantity:9},{quantity:0.0001},{notes:' '},{itemId:'missing'},{itemId:'variant:panel',quantity:0.5}])assert.throws(()=>report(x,o,patch));
 assert.throws(()=>handlePurchaseOrders(x.store,'POST',{action:'report_issue'}, {username:'no-access'}),/Forbidden/);
});

test('admin resolution and closing short preserve order totals and receipts but release incoming balance',async()=>{
 const x=setup(),o=await x.ready();
 x.post({action:'receive',orderId:o.id,expectedVersion:o.version,lines:[{itemId:'angle',quantity:3}]},worker);
 report(x,o,{kind:'missing',quantity:5});const issue=x.current(o.id).issues[0];
 const close=()=>({action:'close_short',orderId:o.id,expectedVersion:x.current(o.id).version,reason:'Supplier cannot supply the balance'});
 assert.throws(()=>x.post(close(),worker),/Administrator/);assert.throws(()=>x.post(close()),/Resolve delivery issues/);
 const resolve={action:'resolve_issue',orderId:o.id,expectedVersion:x.current(o.id).version,issueId:issue.id,reason:'Supplier credit agreed'};
 assert.throws(()=>x.post(resolve,worker),/Administrator/);assert.throws(()=>x.post({...resolve,reason:' '}),/resolved/);
 x.post(resolve);assert.equal(x.current(o.id).issues[0].resolvedBy,'admin');
 assert.throws(()=>x.post({...resolve,expectedVersion:x.current(o.id).version}),/already resolved/);
 assert.throws(()=>x.post({...close(),reason:''}),/reason/);
 const input={...close(),mutationId:crypto.randomUUID()},before=x.current(o.id);x.post(input);assert.equal(x.post(input).duplicate,true);
 const closed=x.current(o.id);assert.equal(closed.status,'closed_short');assert.deepEqual(closed.lines,before.lines);assert.deepEqual(closed.receipts,before.receipts);
 assert.equal(closed.closedBalance.find(l=>l.itemId==='angle').quantity,5);assert.equal(closed.closedBy,'admin');assert.ok(closed.closedAt);
 assert.equal(x.store.read('workshop-stock').items[0].qty,13);assert.equal(workshopView(x.store).items.find(i=>i.id==='angle').onOrder,0);
 assert.throws(()=>x.post({action:'receive',orderId:o.id,expectedVersion:closed.version,lines:[{itemId:'angle',quantity:1}]},worker),/not available/);
 assert.throws(()=>x.post({action:'save',orderId:o.id,expectedVersion:closed.version}),/cannot be edited/);
 assert.throws(()=>report(x,o),/not available/);
});

test('issue photos allow receivers, enforce image types and limits, and remain private and retry-safe',async()=>{
 const x=setup(),o=await x.ready();report(x,o);const issue=x.current(o.id).issues[0];
 const body={id:crypto.randomUUID(),issueId:issue.id,name:'damage.jpg',data:btoa('\xff\xd8\xfftest'),restoreEpoch:0};
 const upload=(patch={},actor=worker)=>purchaseOrderFile(x.store,o.id,null,'POST',{...body,...patch},actor);
 await upload();await upload();assert.equal(x.current(o.id).attachments.filter(f=>f.issueId).length,1);
 const file=x.current(o.id).attachments.find(f=>f.issueId);assert.equal(file.uploadedBy,'receiver');assert.equal(file.data,undefined);
 assert.equal((await purchaseOrderFile(x.store,o.id,body.id,'GET',{},worker)).body.file.data,body.data);
 await assert.rejects(purchaseOrderFile(x.store,o.id,body.id,'GET',{}, {username:'outsider'}),/Forbidden/);
 await assert.rejects(upload({issueId:null}),/Administrator/);
 await assert.rejects(upload({issueId:crypto.randomUUID()}),/not found/);
 await assert.rejects(upload({id:crypto.randomUUID(),name:'evidence.pdf',data:btoa('%PDF-1.7')}),/photo/);
 await assert.rejects(upload({restoreEpoch:2}),/restored/);
 for(let n=0;n<4;n++)await upload({id:crypto.randomUUID()});
 await assert.rejects(upload({id:crypto.randomUUID()}),/five photos/);
 x.post({action:'resolve_issue',orderId:o.id,expectedVersion:x.current(o.id).version,issueId:issue.id,reason:'Credit received'});
 await upload();await assert.rejects(upload({id:crypto.randomUUID()}),/resolved/);
 assert.equal(x.store.read('workshop-stock').items[0].qty,10);
});

test('photo upload revalidates a concurrent issue resolution and issue lines cannot be removed',async()=>{
 const x=setup(),o=await x.ready();report(x,o);const issue=x.current(o.id).issues[0];
 assert.throws(()=>x.post({action:'save',orderId:o.id,expectedVersion:x.current(o.id).version,reference:o.reference,supplier:o.supplier,lines:[{itemId:'variant:panel',ordered:5}]}),/cannot be removed/);
 x.setOnPut(()=>x.post({action:'resolve_issue',orderId:o.id,expectedVersion:x.current(o.id).version,issueId:issue.id,reason:'Supplier confirmed credit'}));
 await assert.rejects(purchaseOrderFile(x.store,o.id,null,'POST',{id:crypto.randomUUID(),issueId:issue.id,name:'damage.png',data:btoa('\x89PNG\r\n\x1a\ntest'),restoreEpoch:0},worker),/resolved/);
 assert.equal(x.current(o.id).attachments.filter(f=>f.issueId).length,0);assert.equal(x.current(o.id).issues[0].status,'resolved');
});
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
test('admins edit issued POs without rewriting stock or received lines; stale edits fail',async()=>{
 const x=setup(),o=await x.ready();x.post({action:'receive',orderId:o.id,expectedVersion:o.version,lines:[{itemId:'angle',quantity:3}]},worker);
 const current=x.current(o.id),base={action:'save',orderId:o.id,expectedVersion:current.version,reference:'PO-100-revised',supplier:'Revised supplier',notes:'Updated',lines:[{itemId:'angle',ordered:10},{itemId:'rivet',ordered:2}]};
 assert.throws(()=>x.post(base,worker),/Administrator/);
 assert.throws(()=>x.post({...base,expectedVersion:o.version}),/changed/);
 assert.throws(()=>x.post({...base,lines:[{itemId:'angle',ordered:2}]}),/below the received/);
 assert.throws(()=>x.post({...base,lines:[{itemId:'rivet',ordered:2}]}),/cannot be removed/);
 const result=x.post(base).orders[0];assert.equal(result.status,'partial');assert.equal(result.lines[0].received,3);assert.equal(result.lines[1].received,0);assert.equal(result.receipts.length,1);assert.equal(result.attachments.length,1);assert.equal(x.store.read('workshop-stock').items[0].qty,13);assert.equal(x.store.read('app:variants')[0].qty,5);assert.equal(result.edits.at(-1).previous.reference,'PO-100');
 await x.upload(result);assert.equal(x.current(o.id).attachments.length,2);
});
test('editing ordered totals recalculates completion without reopening cancelled POs',async()=>{
 const x=setup(),o=await x.ready();x.post({action:'receive',orderId:o.id,expectedVersion:o.version,lines:[{itemId:'angle',quantity:3}]},worker);
 const edit=lines=>x.post({action:'save',orderId:o.id,expectedVersion:x.current(o.id).version,reference:o.reference,supplier:o.supplier,lines}).orders[0];
 assert.equal(edit([{itemId:'angle',ordered:3}]).status,'received');assert.equal(edit([{itemId:'angle',ordered:4}]).status,'partial');assert.equal(x.current(o.id).completedAt,undefined);
 x.post({action:'cancel',orderId:o.id,expectedVersion:x.current(o.id).version,reason:'Cancelled balance'});
 assert.equal(edit([{itemId:'angle',ordered:5}]).status,'cancelled');assert.equal(x.store.read('workshop-stock').items[0].qty,13);
});

const supplierSource={sku:'SUP-ANGLE',description:'Supplier black angle 6m',colour:'Black',lengthMm:6000,unit:'lengths'};
const learningUpdate=(patch={})=>({itemId:'angle',supplier:'Supplier',source:supplierSource,expectedReferenceVersion:0,expectedItemIdentity:JSON.stringify(['ang','black','','6000','lengths','','','','']),updateDetails:false,expectedName:'Angle',expectedSupplier:'',...patch});
const learningSave=(x,updates,patch={})=>x.post({action:'save',orderId:crypto.randomUUID(),expectedVersion:0,reference:'LEARN-'+crypto.randomUUID(),supplier:'Supplier',lines:[{itemId:'angle',ordered:4}],stockUpdates:updates,...patch});
test('supplier references save atomically with the PO, are audited and do not change stock by default',()=>{
 const x=setup(),mutationId=crypto.randomUUID(),orderId=crypto.randomUUID(),patch={mutationId,orderId,reference:'LEARN'};
 const r=learningSave(x,[learningUpdate()],patch),state=x.store.read('workshop-stock'),ref=state.poStockReferences[0];
 assert.equal(ref.itemId,'angle');assert.equal(ref.source.sku,'SUP-ANGLE');assert.equal(ref.version,1);assert.ok(ref.itemIdentity);
 assert.equal(state.items[0].qty,10);assert.equal(state.items[0].name,'Angle');assert.equal(state.movements.length,0);
 assert.equal(learningSave(x,[learningUpdate()],patch).duplicate,true);assert.equal(x.store.read('workshop-stock').poStockReferences.length,1);
 assert.equal(r.stockLearning,true);assert.equal(r.stockReferences.length,1);
 assert.ok(x.audits.some(a=>a[2].stockChanges?.length));
 assert.equal(handlePurchaseOrders(x.store,'GET',{},worker).body.stockReferences.length,0);
 assert.equal(workshopView(x.store).poStockReferences,undefined);
 const before=JSON.stringify([...x.docs]);assert.throws(()=>learningSave(x,[learningUpdate()],{reference:'BAD'}),/match changed/);assert.equal(JSON.stringify([...x.docs]),before);
});
test('reviewed name and supplier updates support workshop stock and panels without changing identity or quantity',()=>{
 const x=setup();learningSave(x,[learningUpdate({updateDetails:true})]);
 let item=workshopView(x.store).items.find(i=>i.id==='angle');assert.equal(item.name,supplierSource.description);assert.equal(item.supplier,'Supplier');assert.equal(item.sku,'ANG');assert.equal(item.qty,10);assert.equal(item.lengthMm,6000);assert.equal(item.colour,'Black');
 item=workshopView(x.store).items.find(i=>i.id==='variant:panel');const before=x.store.read('app:variants');
 const r=learningSave(x,[learningUpdate({itemId:item.id,source:{sku:'SHEET',description:'Supplier white sheet',unit:'sheets'},updateDetails:true,expectedName:item.name,expectedItemIdentity:JSON.stringify(['acp','white','','','sheets','2400','1200','4','acp'])})],{lines:[{itemId:item.id,ordered:3}]});
 assert.equal(r.items.find(i=>i.id===item.id).name,'Supplier white sheet');assert.deepEqual(x.store.read('app:variants'),before);
 assert.equal(r.orders[0].lines[0].name,'Supplier white sheet');
});
test('invalid or conflicting learned details roll back the PO and stock updates',()=>{
 const x=setup();
 for(const updates of [
  [learningUpdate({itemId:'rivet'})],
  [learningUpdate({source:{}})],
  [learningUpdate({expectedItemIdentity:'stale'})],
  [learningUpdate({supplier:'Different supplier'})],
  [learningUpdate({updateDetails:true,expectedName:'Stale name'})],
  [learningUpdate(),learningUpdate({itemId:'rivet'})],
  [learningUpdate({source:{...supplierSource,lengthMm:-2}})],
  Array(201).fill(learningUpdate())
 ]){
  const before=JSON.stringify([...x.docs]);assert.throws(()=>learningSave(x,updates));assert.equal(JSON.stringify([...x.docs]),before);
 }
 assert.throws(()=>x.post({action:'save',stockUpdates:[learningUpdate()]},worker),/Administrator/);
});
test('a reviewed supplier mapping can be corrected without changing the old stock record',()=>{
 const x=setup();learningSave(x,[learningUpdate()]);
 const update=learningUpdate({itemId:'rivet',expectedReferenceVersion:1,expectedItemIdentity:JSON.stringify(['riv','','','','boxes','','','',''])});
 learningSave(x,[update],{lines:[{itemId:'rivet',ordered:2}]});
 const state=x.store.read('workshop-stock');assert.equal(state.poStockReferences.length,1);assert.equal(state.poStockReferences[0].itemId,'rivet');assert.equal(state.poStockReferences[0].version,2);assert.equal(state.items[0].qty,10);assert.equal(state.items[1].qty,2);
});

test('expected delivery dates validate real calendar dates and invalid saves leave stock and PO unchanged',()=>{
 const x=setup(),o=x.create(),save=expectedDelivery=>x.post({action:'save',orderId:o.id,expectedVersion:x.current(o.id).version,reference:o.reference,supplier:o.supplier,lines:o.lines,expectedDelivery});
 for(const value of ['2026-02-29','2026-04-31','2026-13-01','01/10/2026','2026-1-1','2026-10-01T12:00:00Z',123,{},'0000-01-01']){
  const before=JSON.stringify([...x.docs]);assert.throws(()=>save(value),/valid expected delivery/);assert.equal(JSON.stringify([...x.docs]),before);
 }
 save('2028-02-29');assert.equal(x.current(o.id).expectedDelivery,'2028-02-29');assert.equal(x.store.read('workshop-stock').items[0].qty,10);
 save('');assert.equal(x.current(o.id).expectedDelivery,'');assert.equal(x.current(o.id).edits.at(-1).previous.expectedDelivery,'2028-02-29');
 save(null);assert.equal(x.current(o.id).expectedDelivery,'');
});
test('expected dates survive older clients and receipts and changing dates is admin-only, versioned and retry-safe',async()=>{
 const x=setup(),o=await x.ready(),body={action:'save',orderId:o.id,expectedVersion:o.version,reference:o.reference,supplier:o.supplier,lines:o.lines,expectedDelivery:'2026-10-05',mutationId:crypto.randomUUID()};
 assert.throws(()=>x.post(body,worker),/Administrator/);x.post(body);assert.equal(x.post(body).duplicate,true);
 assert.throws(()=>x.post({...body,mutationId:crypto.randomUUID(),expectedDelivery:'2026-10-06'}),/changed/);
 x.post({action:'save',orderId:o.id,expectedVersion:x.current(o.id).version,reference:o.reference,supplier:o.supplier,lines:o.lines});
 assert.equal(x.current(o.id).expectedDelivery,'2026-10-05');
 x.post({action:'receive',orderId:o.id,expectedVersion:x.current(o.id).version,lines:[{itemId:'angle',quantity:1}]},worker);
 assert.equal(x.current(o.id).expectedDelivery,'2026-10-05');assert.equal(x.current(o.id).status,'partial');
 assert.ok(x.audits.some(a=>a[2].expectedDelivery==='2026-10-05'));
});
