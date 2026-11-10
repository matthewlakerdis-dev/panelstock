import test from 'node:test';
import assert from 'node:assert/strict';
import {reverseOrderDispatch} from '../src/order-dispatch-reversal.js';
import {dispatchOrder} from '../src/order-dispatch.js';
import {panelLoadView,transitionPanelLoad} from '../src/panel-dispatch.js';
const admin={username:'admin',isAdmin:true},id='11111111-1111-4111-8111-111111111111';
const stamp='2026-11-01T00:00:00.000Z';
const order={id,orderNumber:'001',project:'Project',orderType:'Fixings',status:'dispatched',updatedAt:stamp,completedAt:'2026-10-31T00:00:00.000Z',requestedBy:'requester',items:[{quantity:3,description:'FIXINGS'}],dispatch:{mutationId:'22222222-2222-4222-8222-222222222222',destination:'Site',transport:'Truck',driver:'Alex',at:stamp,by:'dispatcher'},dispatchedAt:stamp,dispatchedBy:'dispatcher'};
const body={mutationId:'33333333-3333-4333-8333-333333333333',expectedUpdatedAt:stamp,reason:'Wrong load marked dispatched'};
function fixture(current=order,{panels=[],loads=[],qa=[],others=[]}={}){
 const docs=new Map([['orders',structuredClone([current,...others])],['app:cncPanels',panels],['panel-dispatch-loads',loads],['qa-checks',qa],['app:variants',[{id:'stock',qty:10}]]]),audits=[],alerts=[];
 const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),ordersWithDrawingProgress:()=>structuredClone(docs.get('orders')),panelCoatingStock:()=>[],requireTask(user,task){if(!user.isAdmin&&!user.tasks?.[task])throw Error('Denied');},audit:(...args)=>audits.push(args),notify:(...args)=>alerts.push(args)};
 store.ctx={storage:{transactionSync(fn){const snapshot=structuredClone([...docs]),a=audits.length,n=alerts.length;try{return fn();}catch(error){docs.clear();for(const pair of snapshot)docs.set(...pair);audits.length=a;alerts.length=n;throw error;}}}};
 return {store,docs,audits,alerts};
}
test('admin reversal clears active dispatch, preserves stock/items/history and notifies once',()=>{
 const {store,docs,audits,alerts}=fixture(),before=structuredClone(docs.get('app:variants'));
 const result=reverseOrderDispatch(store,id,body,admin);assert.equal(result.order.status,'completed');assert.equal(result.orders[0].ready,true);
 assert.equal(result.order.completedAt,order.completedAt);for(const key of ['dispatch','dispatchedAt','dispatchedBy'])assert.equal(key in result.order,false);
 assert.deepEqual(result.order.items,order.items);assert.deepEqual(result.order.dispatchReversals[0].dispatch,order.dispatch);assert.equal(result.order.dispatchReversals[0].reason,body.reason);assert.equal(result.order.updatedBy,'admin');assert.notEqual(result.order.updatedAt,stamp);
 assert.deepEqual(docs.get('app:variants'),before);assert.equal(audits.length,1);assert.equal(alerts.length,1);assert.equal(alerts[0][1].orderId,id);
 assert.equal(reverseOrderDispatch(store,id,body,admin).idempotent,true);assert.equal(audits.length,1);assert.equal(alerts.length,1);
 for(const patch of [{reason:'Changed'},{expectedUpdatedAt:'Changed'}])assert.throws(()=>reverseOrderDispatch(store,id,{...body,...patch},admin),/different details/);
 assert.throws(()=>reverseOrderDispatch(store,id,body,{...admin,username:'another'}),/different details/);
});
test('permissions, required reason, delivery records and stale versions reject without writes',()=>{
 for(const actor of [{username:'worker',tasks:{'factory.dispatch':true}},{username:'worker',tasks:{}}]){const {store,docs}=fixture();assert.throws(()=>reverseOrderDispatch(store,id,body,actor));assert.deepEqual(docs.get('orders'),[order]);}
 for(const patch of [{reason:''},{reason:'x'.repeat(1001)},{reason:123},{mutationId:''}]){const {store}=fixture();assert.throws(()=>reverseOrderDispatch(store,id,{...body,...patch},admin));}
 for(const current of [{...order,status:'completed'},{...order,receipts:[{signature:'keep evidence'}]}]){const {store,docs}=fixture(current);assert.throws(()=>reverseOrderDispatch(store,id,body,admin),/Only a dispatched|delivery has already/);assert.deepEqual(docs.get('orders'),[current]);}
 const {store,docs}=fixture();assert.equal(reverseOrderDispatch(store,id,{...body,expectedUpdatedAt:'old'},admin).code,'ORDER_CONFLICT');assert.deepEqual(docs.get('orders'),[order]);
});
test('lost response retry cannot undo a later dispatch and an old dispatch mutation cannot be replayed',()=>{
 const {store,audits}=fixture();const reversed=reverseOrderDispatch(store,id,body,admin).order;
 const delivery={id,mutationId:order.dispatch.mutationId,expectedUpdatedAt:reversed.updatedAt,destination:'Site',transport:'Truck',driver:'Alex'};
 assert.throws(()=>dispatchOrder(store,delivery,admin),/was reversed/);
 const sent=dispatchOrder(store,{...delivery,mutationId:'44444444-4444-4444-8444-444444444444'},admin).order;
 const retried=reverseOrderDispatch(store,id,body,admin);assert.equal(retried.idempotent,true);assert.deepEqual(retried.order.dispatch,sent.dispatch);assert.equal(retried.order.updatedAt,sent.updatedAt);assert.equal(retried.order.status,'dispatched');assert.equal(audits.length,2);
});
const panels=[{id:'p1',jobReference:'Project',orderNumber:'001',status:'completed',panelNumber:'P1',stockColor:'White'},{id:'p2',jobReference:'Project',orderNumber:'001',status:'completed',panelNumber:'P2',stockColor:'Milled'}];
const qa=panels.map(p=>({id:p.id,kind:'panel',status:'approved'}));
const siteLeg={destinationType:'site',destination:'Site',transport:'Truck',driver:'Alex',at:stamp,by:'dispatcher'};
const loads=[{id:'load1',project:'Project',orderNumber:'001',panelIds:['p1'],status:'dispatched_to_site',legs:[siteLeg]},{id:'load2',project:'Project',orderNumber:'001',panelIds:['p2'],status:'dispatched_to_site',legs:[{destinationType:'powder_coaters',destination:'Coater'},siteLeg],coatingCompleted:{by:'coater',at:stamp},finalQa:{by:'qa',at:stamp}}];
const panelOrder={...order,orderType:'Panels',dispatch:{...order.dispatch,source:'panel-loads',loadIds:loads.map(l=>l.id)}};
test('whole Panel order reversal archives only site legs, retains coating and QA, and requires fresh dispatch revision',()=>{
 const {store,docs}=fixture(panelOrder,{panels,loads,qa});const result=reverseOrderDispatch(store,id,body,admin);assert.equal(result.order.status,'completed');
 const reversed=docs.get('panel-dispatch-loads');assert.deepEqual(reversed.map(l=>l.status),['waiting','ready_for_site']);assert.equal(reversed[0].legs.length,0);assert.equal(reversed[1].legs.length,1);assert.deepEqual(reversed[1].finalQa,loads[1].finalQa);assert.deepEqual(reversed[1].coatingCompleted,loads[1].coatingCompleted);
 for(const load of reversed){assert.equal(load.dispatchRevision,1);assert.deepEqual(load.dispatchReversals[0].leg,siteLeg);const view=panelLoadView(load,panels,qa);assert.equal(view.readyForSite,true);const payload={action:'dispatch',...siteLeg};assert.throws(()=>transitionPanelLoad(view,payload,admin),/Refresh and review/);assert.equal(transitionPanelLoad(view,{...payload,dispatchRevision:1},admin).status,'dispatched_to_site');}
 assert.equal(reverseOrderDispatch(store,id,body,admin).idempotent,true);assert.deepEqual(docs.get('panel-dispatch-loads'),reversed);
});
test('reopened panel QA returns order to production tracking and cannot be bypassed by reversal',()=>{
 const {store,docs}=fixture(panelOrder,{panels,loads,qa:[]});const result=reverseOrderDispatch(store,id,body,admin);assert.equal(result.order.status,'ordered');assert.equal(result.order.completedAt,null);
 const load=panelLoadView(docs.get('panel-dispatch-loads')[0],panels,[]);assert.equal(load.ready,false);assert.throws(()=>transitionPanelLoad(load,{action:'dispatch',...siteLeg,dispatchRevision:1},admin),/must all be complete/);
});
test('unmatched, ambiguous, changed or legacy Panel manifests reject atomically',()=>{
 for(const config of [{loads:[]},{loads:[{...loads[0],status:'waiting'},loads[1]]},{loads,others:[{...panelOrder,id:'other-order'}]},{loads:[{...loads[0],legs:[]},loads[1]]}]){
  const {store,docs}=fixture(panelOrder,{panels,qa,...config}),before=structuredClone([...docs]);assert.throws(()=>reverseOrderDispatch(store,id,body,admin));assert.deepEqual([...docs],before);
 }
 const {store,docs}=fixture(panelOrder,{panels,loads,qa});docs.set('qa-dispatches',[{lines:[{kind:'panel',id:'p1'}]}]);assert.throws(()=>reverseOrderDispatch(store,id,body,admin),/Legacy panel/);assert.deepEqual(docs.get('orders'),[panelOrder]);
});
test('audit failure rolls back both the order and its panel loads',()=>{
 const {store,docs,alerts}=fixture(panelOrder,{panels,loads,qa}),before=structuredClone([...docs]);store.audit=()=>{throw Error('audit unavailable');};assert.throws(()=>reverseOrderDispatch(store,id,body,admin),/audit unavailable/);assert.deepEqual([...docs],before);assert.equal(alerts.length,0);
});
test('Gate reversal keeps completed QA and returns reopened production to tracking',()=>{
 for(const complete of [true,false]){const current={...order,orderType:'Bin Gate',manualProduction:{areaM2:4,stages:{drawn:'complete',fabricatedQa:complete?'complete':'pending',readyForDispatch:'complete'}}};const {store}=fixture(current),result=reverseOrderDispatch(store,id,body,admin);assert.equal(result.order.status,complete?'completed':'ordered');assert.deepEqual(result.order.manualProduction,current.manualProduction);}
});
test('legacy non-panel dispatch can be reversed and own-order reversal does not notify itself',()=>{
 const legacy={...order,requestedBy:'admin'};delete legacy.dispatch;const {store,alerts}=fixture(legacy);const result=reverseOrderDispatch(store,id,body,admin);assert.deepEqual(result.order.dispatchReversals[0].dispatch,{at:stamp,by:'dispatcher'});assert.equal(alerts.length,0);
});
