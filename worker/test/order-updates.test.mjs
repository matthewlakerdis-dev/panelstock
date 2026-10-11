import test from 'node:test';
import assert from 'node:assert/strict';
import {orderConflict,nextOrderStamp,notifyOrderChange} from '../src/order-updates.js';
test('editing requires the current version, including legacy orders, and stamps always advance',()=>{
 const order={updatedAt:'2099-01-01T00:00:00.000Z'};
 for(const body of [{},{expectedUpdatedAt:'old'},{expectedUpdatedAt:null}])assert.equal(orderConflict(order,body).code,'ORDER_CONFLICT');
 assert.equal(orderConflict(order,{expectedUpdatedAt:order.updatedAt}),null);
 assert.equal(orderConflict({createdAt:'old'},{expectedUpdatedAt:'old'}),null);
 assert.equal(nextOrderStamp(order),'2099-01-01T00:00:00.001Z');
});
test('only meaningful status and delivery changes notify the requester, never the actor',()=>{
 const sent=[],store={notify:(...args)=>sent.push(args)},before={requestedBy:'alice',orderNumber:'1',project:'Hotel',status:'submitted'};
 notifyOrderChange(store,before,{...before,locationNotes:'new'},{username:'bob'});assert.equal(sent.length,0);
 notifyOrderChange(store,before,{...before,status:'ordered'},{username:'alice'});assert.equal(sent.length,0);
 notifyOrderChange(store,before,{...before,status:'ordered',scheduledDeliveryDate:'2026-10-15'},{username:'bob'});assert.equal(sent.length,1);assert.deepEqual(sent[0][0],['alice']);assert.equal(sent[0][1].kind,'orders');assert.match(sent[0][1].message,/2026-10-15/);
});

test('delivery alerts distinguish confirmation, delays, earlier dates and removed confirmation',()=>{
 const before={id:'11111111-1111-4111-8111-111111111111',requestedBy:'alice',project:'Hotel',orderNumber:'1',orderType:'Panels',status:'submitted'};
 const confirmed={...before,scheduledDeliveryDate:'2026-10-15',scheduledDeliveryTime:'09:30'};
 const cases=[
  [before,confirmed,'delivery confirmed'],
  [confirmed,{...confirmed,scheduledDeliveryDate:'2026-10-16'},'delivery delayed'],
  [confirmed,{...confirmed,scheduledDeliveryTime:'10:30'},'delivery delayed'],
  [confirmed,{...confirmed,scheduledDeliveryDate:'2026-10-14'},'delivery rescheduled'],
  [confirmed,{...confirmed,scheduledDeliveryTime:'08:30'},'delivery rescheduled'],
  [confirmed,{...confirmed,scheduledDeliveryDate:'',scheduledDeliveryTime:''},'delivery confirmation removed']
 ];
 for(const [previous,current,title] of cases){
  const sent=[];notifyOrderChange({notify:(...args)=>sent.push(args)},previous,current,{username:'bob'});
  assert.equal(sent.length,1);assert.equal(sent[0][1].title,`Order #1: ${title}`);
  assert.equal(sent[0][1].orderId,before.id);assert.equal(sent[0][1].link,'orders');
  if(previous.scheduledDeliveryDate)assert.match(sent[0][1].message,/Previously confirmed delivery: 2026-10-15 · 09:30/);
 }
});

test('completion alerts identify non-panel readiness and cancellation takes precedence over date changes',()=>{
 const before={id:'11111111-1111-4111-8111-111111111111',requestedBy:'alice',project:'Hotel',orderNumber:'1',orderType:'Fixings',status:'ordered',scheduledDeliveryDate:'2026-10-15'};
 for(const [current,title] of [[{...before,status:'completed'},'ready for dispatch'],[{...before,status:'cancelled',scheduledDeliveryDate:'2026-10-16'},'cancelled'],[{...before,orderType:'Panels',status:'completed'},'updated']]){
  let alert;notifyOrderChange({notify:(_,value)=>{alert=value;}},before,current,{username:'bob'});
  assert.equal(alert.title,`Order #1: ${title}`);
 }
});
