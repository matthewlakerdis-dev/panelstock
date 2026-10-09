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
