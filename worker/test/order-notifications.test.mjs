import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationOrderId,readyOrderIds,notifyReadyOrders} from '../src/order-notifications.js';

const order={id:'11111111-1111-4111-8111-111111111111',projectId:'p1',project:'Project A',orderNumber:'007',orderType:'Panels',status:'submitted',requestedBy:'alice'};
const panel={id:'panel-a',projectId:'p1',jobReference:order.project,orderNumber:order.orderNumber,status:'completed',stockSku:'WHITE'};
const qa={id:panel.id,kind:'panel',status:'approved'};
function harness(){
 const docs=new Map([['orders',[order]],['app:cncPanels',[panel]],['qa-checks',[]],['panel-dispatch-loads',[]]]),sent=[];
 return {docs,sent,read:(key,fallback)=>structuredClone(docs.get(key)??fallback),panelCoatingStock:()=>[{sku:'MILL',color:'Milled'}],notify:(...args)=>sent.push(args)};
}

test('optional order metadata is restricted to order alerts and safe IDs',()=>{
 assert.equal(notificationOrderId('orders',order.id),order.id);
 for(const id of [null,{},'','https://example.com','../private',order.id+'/history','a'.repeat(101)])assert.equal(notificationOrderId('orders',id),'');
 assert.equal(notificationOrderId('support',order.id),'');
});

test('readiness snapshots never notify and transitions notify once for the whole order',()=>{
 const store=harness(),before=readyOrderIds(store);assert.equal(before.size,0);assert.equal(store.sent.length,0);
 store.docs.set('app:cncPanels',[panel,{...panel,id:'panel-b',status:'pending'}]);store.docs.set('qa-checks',[qa]);
 notifyReadyOrders(store,before,{username:'bob'});assert.equal(store.sent.length,0);
 store.docs.set('app:cncPanels',[panel,{...panel,id:'panel-b'}]);store.docs.set('qa-checks',[qa,{...qa,id:'panel-b'}]);
 notifyReadyOrders(store,before,{username:'bob'});assert.equal(store.sent.length,1);
 assert.deepEqual(store.sent[0][0],['alice']);assert.equal(store.sent[0][1].orderId,order.id);assert.match(store.sent[0][1].title,/ready for dispatch/);
 assert.doesNotMatch(JSON.stringify(store.sent),/panelIds|stockSku|evidence/);
 notifyReadyOrders(store,readyOrderIds(store),{username:'bob'});assert.equal(store.sent.length,1);
});

test('readiness alerts wait for every coated load to pass final QA',()=>{
 const store=harness();store.docs.set('app:cncPanels',[{...panel,stockSku:'MILL'},{...panel,id:'panel-b',stockSku:'MILL'}]);store.docs.set('qa-checks',[qa,{...qa,id:'panel-b'}]);
 const load={projectId:'p1',project:order.project,orderNumber:order.orderNumber,status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}],coatingCompleted:{by:'bob'}};
 store.docs.set('panel-dispatch-loads',[{...load,panelIds:[panel.id]},{...load,panelIds:['panel-b']}]);
 const before=readyOrderIds(store);assert.equal(before.size,0);
 store.docs.set('panel-dispatch-loads',[{...load,panelIds:[panel.id],finalQa:{by:'bob'}},{...load,panelIds:['panel-b']}]);
 notifyReadyOrders(store,before,{username:'bob'});assert.equal(store.sent.length,0);
 store.docs.set('panel-dispatch-loads',[{...load,panelIds:[panel.id],finalQa:{by:'bob'}},{...load,panelIds:['panel-b'],finalQa:{by:'bob'}}]);
 notifyReadyOrders(store,before,{username:'bob'});assert.equal(store.sent.length,1);
});

test('cancelled, mismatched projects and the actor never receive readiness alerts',()=>{
 for(const source of [{...order,status:'cancelled'},{...order,projectId:'other'},order]){
  const store=harness();store.docs.set('orders',[source]);store.docs.set('qa-checks',[qa]);
  notifyReadyOrders(store,new Set(),{username:'alice'});assert.equal(store.sent.length,0);
  if(source!==order){notifyReadyOrders(store,new Set(),{username:'bob'});assert.equal(store.sent.length,0);}
 }
});
