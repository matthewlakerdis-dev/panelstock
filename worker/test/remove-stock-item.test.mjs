import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,workshopView,handleWorkshop,stocktakeReport} from '../src/workshop-stock.js';
const admin={username:'admin',isAdmin:true};
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const create=(state=empty(),patch={})=>applyWorkshop(state,{action:'create',item:{name:'Angle',sku:'ANG',category:'extrusions',unit:'lengths',qty:0,dimensions:'25 x 25',...patch}},admin).next;
const archive=(state,itemId=state.items[0].id,actor=admin)=>applyWorkshop(state,{action:'archive',itemId},actor);
const status=code=>error=>error.status===code;
function storeFor(state){
 const docs=new Map([['workshop-stock',structuredClone(state)]]),events=[];
 return {events,read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit:(...event)=>events.push(event),broadcastRevision(){}};
}
test('removal archives a zero-stock workshop item while preserving history and completed report snapshots',()=>{
 const state=create(),id=state.items[0].id;
 state.movements.unshift({id:'old',itemId:id,action:'stocktake',quantity:0,stocktakeId:'done'});
 const count={id:'done',name:'Completed count',categories:['extrusions'],supplier:'',status:'completed',completedAt:'2026-11-02T00:00:00Z',itemIds:[id],counts:{[id]:{quantity:0,expectedQty:0,item:{...state.items[0]},user:'counter',at:'2026-11-01T23:00:00Z'}}};
 count.report=stocktakeReport(state,count);state.stocktakes=[count];const report=structuredClone(count.report),before=structuredClone(state);
 const result=archive(state),stored=result.next.items[0];assert.equal(stored.archivedBy,'admin');assert.ok(!Number.isNaN(Date.parse(stored.archivedAt)));assert.equal(stored.qty,0);
 assert.equal(result.movement.action,'archive');assert.equal(result.movement.quantity,0);assert.equal(result.movement.itemId,id);assert.equal(result.movement.user,'admin');assert.ok(result.next.movements.some(m=>m.id==='old'));
 assert.deepEqual(result.next.stocktakes[0].report,report);assert.deepEqual(state,before);
 const store=storeFor(result.next);assert.deepEqual(workshopView(store).items,[]);assert.deepEqual(workshopView(store).stocktakes[0].report,report);
});
test('stock and reservation guards reject removal atomically',()=>{
 for(const patch of [{qty:1},{qty:0.001},{qty:0,reservations:{'Job A':1}}]){
  const state=create();Object.assign(state.items[0],patch);const before=structuredClone(state);
  assert.throws(()=>archive(state),status(409));assert.deepEqual(state,before);
 }
 const state=create();state.items[0].reservations={'Released job':0};assert.ok(archive(state).next.items[0].archivedAt);
});
test('draft, open and partial POs block removal even when a line has no outstanding balance',()=>{
 for(const orderStatus of ['draft','open','partial']){
  const state=create(),id=state.items[0].id;state.purchaseOrders=[{id:'po',status:orderStatus,lines:[{itemId:id,ordered:2,received:2}]}];
  assert.throws(()=>archive(state),error=>error.status===409&&/purchase orders/.test(error.message));assert.equal(state.items[0].archivedAt,undefined);
 }
 for(const orderStatus of ['received','cancelled','closed_short']){
  const state=create(),id=state.items[0].id;state.purchaseOrders=[{id:'po',status:orderStatus,lines:[{itemId:id,ordered:2,received:2}]}];assert.ok(archive(state).next.items[0].archivedAt);
 }
 const unrelated=create();unrelated.purchaseOrders=[{status:'open',lines:[{itemId:'other',ordered:2}]}];assert.ok(archive(unrelated).next.items[0].archivedAt);
});
test('uncounted membership in an open stocktake blocks removal; submitted counts retain their snapshot',()=>{
 const state=create(),id=state.items[0].id;
 state.stocktakes=[{id:'count',name:'In progress',categories:['extrusions'],status:'open',itemIds:[id,'another'],counts:{}}];
 assert.throws(()=>archive(state),error=>error.status===409&&/stocktake/.test(error.message));
 const snapshot={quantity:0,expectedQty:0,item:{...state.items[0]},user:'worker',at:'2026-11-02T00:00:00Z'};state.stocktakes[0].counts[id]=snapshot;
 const next=archive(state).next;assert.ok(next.items[0].archivedAt);assert.deepEqual(next.stocktakes[0].counts[id],snapshot);assert.equal(stocktakeReport(next,next.stocktakes[0]).rows[0].name,'Angle');
});
test('archived IDs reject new archive, movements, metadata, bulk and batch count operations',()=>{
 const next=archive(create()).next,id=next.items[0].id,before=structuredClone(next);
 const requests=[{action:'archive',itemId:id},{action:'metadata',itemId:id,name:'Changed'},...['receive','return','use','reserve','release','damage','stocktake'].map(action=>({action,itemId:id,quantity:0,job:'Job',reason:'Check'})),{action:'bulk_metadata',itemIds:[id],changes:{name:'Changed'}},{action:'bulk_metadata',itemIds:[id],changes:{dimensions:'Changed'}},{action:'stocktake_batch',counts:[{itemId:id,quantity:0,expectedQty:0}],reason:'Check'}];
 for(const request of requests)assert.throws(()=>applyWorkshop(next,request,admin),status(404));assert.deepEqual(next,before);
});
test('archive is admin-only in both direct application and the authenticated handler',()=>{
 const state=create(),id=state.items[0].id,staff={username:'staff',tasks:{'factory.stock':true,'factory.dispatch':true,'factory.receive':true}};
 assert.throws(()=>archive(state,id,staff),status(403));
 const store=storeFor(state),request={action:'archive',itemId:id,mutationId:crypto.randomUUID(),expectedRevision:state.revision};assert.throws(()=>handleWorkshop(store,'POST',request,staff),status(403));assert.equal(store.read('workshop-stock').items[0].archivedAt,undefined);
});
test('legacy panel and sheet-offcut removal stays in its existing workflows',()=>{
 for(const id of ['variant:sheet','offcut:sheet'])assert.throws(()=>archive(empty(),id),error=>error.status===400&&/existing stock workflows/.test(error.message));
});
test('archived codes may be reused without inheriting metadata or blocking active profile edits and new counts',()=>{
 let state=create();const archivedId=state.items[0].id;state=archive(state).next;
 state=create(state,{name:'New profile',dimensions:'50 x 50'});const active=state.items[1];assert.notEqual(active.id,archivedId);assert.equal(active.name,'New profile');
 state=applyWorkshop(state,{action:'metadata',itemId:active.id,dimensions:'100 x 100'},admin).next;assert.equal(state.items[0].dimensions,'25 x 25');assert.equal(state.items[1].dimensions,'100 x 100');
 state=applyWorkshop(state,{action:'bulk_metadata',itemIds:[active.id],changes:{category:'steel'}},admin).next;assert.equal(state.items[1].category,'steel');
 state=applyWorkshop(state,{action:'stocktake_create',name:'New count',categories:['steel','extrusions']},admin).next;assert.deepEqual(state.stocktakes[0].itemIds,[active.id]);
 let noCode=create(empty(),{sku:'',name:'First'});noCode=create(noCode,{sku:'',name:'Second'});const first=noCode.items[0].id;noCode=archive(noCode,first).next;noCode=create(noCode,{sku:'',name:'Third'});assert.deepEqual(workshopView(storeFor(noCode)).items.map(i=>i.name),['Second','Third']);assert.notEqual(noCode.items[1].id,noCode.items[2].id);
});
test('mutation retries remain idempotent and a fresh request for an archived ID returns 404',()=>{
 const state=create(),id=state.items[0].id,store=storeFor(state),request={action:'archive',itemId:id,mutationId:crypto.randomUUID(),expectedRevision:state.revision};
 const first=handleWorkshop(store,'POST',request,admin);assert.equal(first.status,200);assert.deepEqual(first.body.items,[]);
 assert.equal(handleWorkshop(store,'POST',request,admin).body.duplicate,true);assert.equal(store.read('workshop-stock').revision,state.revision+1);assert.equal(store.read('app:transactions').length,1);assert.equal(store.events.length,1);
 assert.throws(()=>handleWorkshop(store,'POST',{...request,mutationId:crypto.randomUUID(),expectedRevision:state.revision+1},admin),status(404));
});
