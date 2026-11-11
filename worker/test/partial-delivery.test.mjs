import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {dispatchOrder} from '../src/order-dispatch.js';
import {dispatchQueue} from '../src/dispatch-queue.js';
import {dispatchBalances} from '../src/partial-dispatch.js';
import {panelLoadView,splitPanelDispatch,reconcilePanelLoads} from '../src/panel-dispatch.js';
import {reverseOrderDispatch} from '../src/order-dispatch-reversal.js';
globalThis.crypto||=webcrypto;
const actor={username:'dispatcher',isAdmin:true},base={id:'order',project:'Project',orderNumber:'007',orderType:'Fixings',status:'completed',updatedAt:'v1',createdAt:'2026-11-11T01:00:00Z',items:[{quantity:10,description:'Fixings'},{quantity:2,description:'Brackets'}]};
function fixture(){const docs=new Map([['orders',[structuredClone(base)]]]),audits=[];return {docs,audits,store:{requireTask(){},read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>audits.push(args),notify(){},ordersWithDrawingProgress:()=>structuredClone(docs.get('orders')),panelDispatchLoads:()=>[],panelCoatingStock:()=>[]}};}
const details={destination:'Site',transport:'Truck',driver:'Alex',notes:'Rear entrance'};
const request={id:'order',mutationId:'first-delivery-1234',expectedUpdatedAt:'v1',...details,lines:[{index:0,quantity:4}]};
test('part deliveries persist separate trips, retain the balance, retry safely and complete only after the last items',()=>{
 const {store,docs,audits}=fixture();let result=dispatchOrder(store,request,actor);assert.equal(result.partial,true);assert.equal(result.order.status,'completed');assert.deepEqual(result.order.dispatchItems.map(line=>line.remaining),[6,2]);assert.equal(result.order.dispatchedAt,undefined);
 assert.equal(dispatchOrder(store,request,actor).idempotent,true);assert.equal(audits.length,1);
 assert.throws(()=>dispatchOrder(store,{...request,lines:[{index:0,quantity:3}]},actor),/different/);
 const rows=dispatchQueue(store,actor);assert.equal(rows.filter(row=>row.status==='ready').length,1);assert.equal(rows.filter(row=>row.status==='dispatched').length,1);assert.deepEqual(rows.find(row=>row.status==='dispatched').order.items.map(line=>line.quantity),[4]);
 const next={...request,mutationId:'second-delivery-123',expectedUpdatedAt:result.order.updatedAt,lines:[{index:0,quantity:6},{index:1,quantity:2}]};
 assert.throws(()=>dispatchOrder(store,{...next,lines:[{index:0,quantity:7}]},actor),/exceeds/);
 assert.equal(dispatchOrder(store,{...next,expectedUpdatedAt:'stale'},actor).code,'ORDER_CONFLICT');
 result=dispatchOrder(store,next,actor);assert.equal(result.partial,false);assert.equal(result.order.status,'dispatched');assert.ok(result.order.dispatchedAt);assert.deepEqual(dispatchBalances(docs.get('orders')[0]).map(line=>line.remaining),[0,0]);
 assert.equal(dispatchQueue(store,actor).filter(row=>row.status==='dispatched').length,2);assert.equal(dispatchQueue(store,actor).filter(row=>row.ready).length,0);
 assert.deepEqual(docs.get('orders')[0].items,base.items);assert.equal(dispatchOrder(store,request,actor).idempotent,true);
});
test('empty, duplicate, invalid and nonpositive delivery quantities do not save',()=>{
 for(const lines of [[],[{index:0,quantity:0}],[{index:0,quantity:-1}],[{index:0,quantity:11}],[{index:0,quantity:1},{index:0,quantity:1}],[{index:99,quantity:1}],[{index:0,quantity:'2'}]]){const {store,docs}=fixture();assert.throws(()=>dispatchOrder(store,{...request,lines},actor));assert.deepEqual(docs.get('orders'),[base]);}
});
test('reversing a completed multipart order restores every quantity and retires every trip ID',()=>{
 const {store,docs}=fixture();const first=dispatchOrder(store,request,actor).order;
 const final=dispatchOrder(store,{...request,mutationId:'final-delivery-1234',expectedUpdatedAt:first.updatedAt,lines:[{index:0,quantity:6},{index:1,quantity:2}]},actor).order;
 const reversed=reverseOrderDispatch(store,'order',{mutationId:'reverse-delivery-123',reason:'Wrong delivery',expectedUpdatedAt:final.updatedAt},actor).order;
 assert.deepEqual(dispatchBalances(reversed).map(line=>line.remaining),[10,2]);assert.equal(reversed.dispatchReversals[0].dispatches.length,2);assert.throws(()=>dispatchOrder(store,{...request,expectedUpdatedAt:reversed.updatedAt},actor),/reversed/);
});
const panels=[1,2,3].map(n=>({id:'p'+n,jobReference:'Project',orderNumber:'007',panelNumber:String(n),status:'completed',stockColor:'White'}));
const qa=panels.map(panel=>({id:panel.id,kind:'panel',status:'approved'}));
function readyLoad(){return panelLoadView({id:'load',orderKey:JSON.stringify(['project','007']),project:'Project',orderNumber:'007',panelIds:panels.map(panel=>panel.id),status:'waiting',legs:[]},panels,qa);}
const loadRequest={id:'load',action:'dispatch',destinationType:'site',mutationId:'panel-delivery-1234',panelIds:['p1'],expectedPanelIds:['p1','p2','p3'],expectedStatus:'waiting',...details};
test('panel part deliveries split disjoint manifests and reconciliation cannot reabsorb shipped panels',()=>{
 const load=readyLoad(),{sent,remainder}=splitPanelDispatch(load,loadRequest,actor,panels);assert.equal(sent.status,'dispatched_to_site');assert.deepEqual(sent.panelIds,['p1']);assert.deepEqual(remainder.panelIds,['p2','p3']);assert.equal(remainder.status,'waiting');assert.notEqual(remainder.id,sent.id);
 const synced=reconcilePanelLoads([sent,remainder],panels,[],undefined,[]);assert.deepEqual(synced.find(item=>item.id===sent.id).panelIds,['p1']);assert.deepEqual(synced.find(item=>item.id===remainder.id).panelIds,['p2','p3']);assert.equal(panelLoadView(remainder,panels,qa).ready,true);
 assert.throws(()=>splitPanelDispatch(load,{...loadRequest,expectedPanelIds:['p1']},actor,panels),/changed/);
 assert.throws(()=>splitPanelDispatch({...load,ready:false},loadRequest,actor,panels),/complete/);
 assert.throws(()=>splitPanelDispatch(load,{...loadRequest,panelIds:['unknown']},actor,panels),/this load/);
});
test('coated load splits retain coating and final QA history for the remainder',()=>{
 const load={...readyLoad(),status:'ready_for_site',requiresPowderCoating:true,finalQa:{by:'qa'},coatingCompleted:{by:'coater'},legs:[{destinationType:'powder_coaters',...details}]};
 const {sent,remainder}=splitPanelDispatch(load,{...loadRequest,expectedStatus:'ready_for_site'},actor,panels);
 assert.equal(sent.legs.length,2);assert.equal(remainder.legs.length,1);assert.deepEqual(remainder.finalQa,load.finalQa);assert.equal(remainder.status,'ready_for_site');
});

test('recut audit dependencies remain with their approved replacement in a split manifest',()=>{
 const replacement={...panels[0],id:'replacement'},all=[...panels,replacement],records=[{...qa[0],status:'replaced',replacementId:'replacement'},qa[1],qa[2],{id:'replacement',kind:'panel',status:'approved'}];
 const view=panelLoadView({...readyLoad(),panelIds:all.map(panel=>panel.id)},all,records);assert.ok(view.ready);
 const {sent,remainder}=splitPanelDispatch(view,{...loadRequest,panelIds:['replacement'],expectedPanelIds:view.panelIds},actor,all);
 assert.deepEqual(sent.panelIds,['p1','replacement']);assert.deepEqual(remainder.panelIds,['p2','p3']);assert.ok(panelLoadView(remainder,all,records).ready);assert.ok(panelLoadView(sent,all,records).qaComplete);
});

test('fractional quantities retain their balance and each trip keeps its own chronological place in history',()=>{
 const {store,docs}=fixture();const decimal={...base,items:[{quantity:.3,description:'Area'}]};docs.set('orders',[decimal]);
 let first=dispatchOrder(store,{...request,lines:[{index:0,quantity:.1}]},actor).order;assert.equal(first.dispatchItems[0].remaining,.2);
 const final=dispatchOrder(store,{...request,mutationId:'decimal-final-1234',expectedUpdatedAt:first.updatedAt,lines:[{index:0,quantity:.2}]},actor).order;assert.equal(final.status,'dispatched');
 const stored=docs.get('orders')[0];stored.dispatches[0].at='2026-11-01T00:00:00Z';stored.dispatches[1].at='2026-11-03T00:00:00Z';stored.dispatchedAt=stored.dispatches[1].at;stored.dispatch=stored.dispatches[1];
 docs.set('orders',[stored,{...base,id:'middle',orderNumber:'008',status:'dispatched',dispatch:{at:'2026-11-02T00:00:00Z'}}]);
 assert.deepEqual(dispatchQueue(store,actor).map(entry=>entry.key),['delivery:order:decimal-final-1234','order:middle','delivery:order:first-delivery-1234']);
});
