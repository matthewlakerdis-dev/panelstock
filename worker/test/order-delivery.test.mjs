import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleOrderDelivery} from '../src/order-delivery.js';

const admin={username:'admin',isAdmin:true},base={id:'order',project:'Test project',orderNumber:'7',orderType:'Panels',status:'submitted',requestedBy:'leading-hand',requestedDeliveryDate:'2026-10-28',requestedDeliveryTime:'07:00',scheduledDeliveryDate:'',scheduledDeliveryTime:'',items:[{quantity:2,description:'PANELS'}],attachments:[{id:'file'}],createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
function fixture(order=base){
  let orders=[structuredClone(order),{...base,id:'other'}];const audits=[],alerts=[];
  const store={read:()=>structuredClone(orders),write:(_,next)=>{orders=structuredClone(next);},ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>audits.push(args),notify:(...args)=>alerts.push(args)};
  const save=(fields={},actor=admin)=>scheduleOrderDelivery(store,order.id,{expectedUpdatedAt:orders[0].updatedAt,...fields},actor);
  return {save,audits,alerts,orders:()=>orders};
}
test('only administrators can schedule; panel and ready orders keep their status, request, items and production fields',()=>{
  for(const order of [base,{...base,orderType:'Fixings',status:'completed',completedAt:'ready-at',drawingProgress:{drawn:true}}]){
    const f=fixture(order);
    assert.throws(()=>f.save({scheduledDeliveryDate:'2026-10-29'},{username:'manager',isAdmin:false,tasks:{'site.orders.manage':true}}),/Admin access/);
    assert.equal(f.audits.length,0);
    const result=f.save({scheduledDeliveryDate:'2026-10-29',scheduledDeliveryTime:'09:30',status:'dispatched',items:[]});
    assert.equal(result.order.status,order.status);assert.equal(result.order.completedAt,order.completedAt);assert.equal(result.order.requestedDeliveryDate,order.requestedDeliveryDate);assert.deepEqual(result.order.items,order.items);assert.deepEqual(result.order.attachments,order.attachments);
    assert.equal(result.order.scheduledDeliveryDate,'2026-10-29');assert.equal(result.order.scheduledDeliveryTime,'09:30');assert.equal(result.order.updatedBy,'admin');assert.notEqual(result.order.updatedAt,order.updatedAt);
    assert.deepEqual(f.orders()[1],{...base,id:'other'});assert.equal(f.audits.length,1);assert.equal(f.audits[0][1],'order-delivery-updated');assert.equal(f.alerts[0][1].title,'Order #7: delivery confirmed');
  }
});
test('rescheduling, clearing and unchanged saves use existing notifications without duplicate audit events',()=>{
  const f=fixture();let result=f.save({scheduledDeliveryDate:'2026-10-29',scheduledDeliveryTime:'09:30'});
  const stamp=result.order.updatedAt;result=f.save({scheduledDeliveryDate:'2026-10-29',scheduledDeliveryTime:'09:30'});
  assert.equal(result.unchanged,true);assert.equal(result.order.updatedAt,stamp);assert.equal(f.audits.length,1);assert.equal(f.alerts.length,1);
  f.save({scheduledDeliveryDate:'2026-10-30'});assert.equal(f.alerts[1][1].title,'Order #7: delivery delayed');assert.equal(f.orders()[0].scheduledDeliveryTime,'09:30');
  f.save({scheduledDeliveryDate:'2026-10-28',scheduledDeliveryTime:'08:00'});assert.equal(f.alerts[2][1].title,'Order #7: delivery rescheduled');
  f.save({scheduledDeliveryDate:''});assert.equal(f.orders()[0].scheduledDeliveryTime,'');assert.equal(f.alerts[3][1].title,'Order #7: delivery confirmation removed');
  assert.equal(f.audits[3][2].previousScheduledDeliveryDate,'2026-10-28');assert.equal(f.orders()[0].requestedDeliveryDate,base.requestedDeliveryDate);
});
test('stale, invalid and closed-order requests never modify orders or notify anyone',()=>{
  const f=fixture(),before=structuredClone(f.orders());
  assert.equal(f.save({expectedUpdatedAt:'old',scheduledDeliveryDate:'2026-10-29'}).code,'ORDER_CONFLICT');
  for(const date of ['2026-02-29','2026-02-30','2026-13-01','2026-1-01','tomorrow',null,{}])assert.throws(()=>f.save({scheduledDeliveryDate:date}),/valid|Choose/);
  for(const time of ['24:00','12:60','9:30',123]){
    assert.throws(()=>f.save({scheduledDeliveryDate:'2026-10-29',scheduledDeliveryTime:time}),/valid.*time/);
  }
  assert.deepEqual(f.orders(),before);assert.equal(f.alerts.length,0);assert.equal(f.audits.length,0);
  for(const status of ['dispatched','cancelled'])assert.throws(()=>fixture({...base,status}).save({scheduledDeliveryDate:'2026-10-29'}),/cannot be rescheduled/);
  assert.equal(f.save({scheduledDeliveryDate:'2028-02-29'}).order.scheduledDeliveryDate,'2028-02-29');
});
