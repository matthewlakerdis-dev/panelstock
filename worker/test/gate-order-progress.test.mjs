import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateGateProduction,gateProductionStages,checkGateOrderEdit} from '../src/gate-order-progress.js';
import {currentGateQaRecord,requireCurrentGateQa,syncGateQaProgress} from '../src/gate-order-qa.js';
import {buildSiteOrderRows,buildSiteOrderFeed} from '../src/site-orders-excel.js';
import {buildOrderProductionProgress} from '../src/order-production-progress.js';
import {dispatchOrders,dispatchOrder} from '../src/order-dispatch.js';
import {readyOrderIds,notifyReadyOrders} from '../src/order-notifications.js';
const base={id:'11111111-1111-4111-8111-111111111111',project:'Gate project',orderNumber:'001',orderType:'Gate',status:'approved',requestedBy:'leading-hand',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',requestedDeliveryDate:'2026-11-03',scheduledDeliveryDate:'2026-11-04',siteContact:'PRIVATE',phone:'PRIVATE',items:[{quantity:2,description:'GATE A'},{quantity:1,description:'GATE B'}],attachments:[{name:'SECRET'}]};
const manager={username:'manager',tasks:{'site.orders.manage':true,'factory.dispatch':true}},inspector={username:'inspector',tasks:{'factory.qa':true}},done={drawn:'complete',fabricatedQa:'complete',readyForDispatch:'complete'};
function fixture(order=base){
 const docs=new Map([['orders',[structuredClone(order),{...base,id:'other'}]],['app:cncPanels',[]],['qa-checks',[]],['panel-dispatch-loads',[]]]),audits=[],alerts=[],writes=[];
 const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,next)=>{writes.push(key);docs.set(key,structuredClone(next));},ctx:{storage:{transactionSync:fn=>fn()}},requireTask(actor,key){assert.ok(actor.isAdmin||actor.tasks?.[key],'Task denied');},audit:(...args)=>audits.push(args),notify:(...args)=>alerts.push(args),panelCoatingStock:()=>[],ordersWithDrawingProgress:()=>store.read('orders',[])};
 const orderNow=()=>docs.get('orders')[0],save=(drawn='complete',body={},actor=manager)=>updateGateProduction(store,base.id,{stages:{drawn},expectedUpdatedAt:orderNow().updatedAt,...body},actor);
 const qa=(item,status='approved')=>{requireCurrentGateQa(store,item);const before=readyOrderIds(store),records=store.read('qa-checks',[]),index=records.findIndex(value=>value.id===item.id);records[index]={...records[index],status};store.write('qa-checks',records);syncGateQaProgress(store,records[index],inspector);notifyReadyOrders(store,before,inspector);};
 return {store,save,orderNow,qa,audits,alerts,writes,records:()=>store.read('qa-checks',[])};
}
test('Drawn queues each Gate item exactly once and preserves definitions without inventing a fabricator',()=>{
 const f=fixture(),result=f.save('complete',{status:'dispatched',items:[]});
 assert.equal(result.order.status,'approved');assert.deepEqual(result.order.items,base.items);assert.equal(result.order.scheduledDeliveryDate,base.scheduledDeliveryDate);assert.equal(result.order.requestedDeliveryDate,base.requestedDeliveryDate);
 const records=f.records();assert.equal(records.length,2);assert.deepEqual(records.map(item=>item.quantity),[2,1]);assert.ok(records.every(item=>item.kind==='metalwork'&&item.status==='awaiting'&&item.fabricatedBy===''&&item.drawnBy==='manager'&&currentGateQaRecord(result.order,item)));assert.equal(f.alerts.length,0);
 const stamp=result.order.updatedAt;assert.equal(f.save().unchanged,true);assert.equal(f.orderNow().updatedAt,stamp);assert.deepEqual(f.records(),records);assert.deepEqual(f.store.read('orders',[])[1],{...base,id:'other'});
 const row=buildSiteOrderRows([result.order])[0];assert.equal(row.Drawn,'✓');assert.equal(row.QA,'-');assert.equal(row['Ready for dispatch'],'-');for(const key of ['Toolpathed','Routed / cut','Sent to PC','Final QA'])assert.equal(row[key],'N/A');
 assert.doesNotMatch(buildSiteOrderFeed([row]),/PRIVATE|SECRET|manualProduction/);assert.doesNotMatch(JSON.stringify(buildOrderProductionProgress(result.order)),/PRIVATE|SECRET/);
});
test('all current items must pass QA before automatic readiness and exactly one requester notification',()=>{
 const f=fixture();f.save();const records=f.records();f.qa(records[0]);assert.equal(f.orderNow().status,'approved');assert.equal(dispatchOrders(f.store,manager).length,0);
 f.qa(records[1]);assert.equal(f.orderNow().status,'completed');assert.deepEqual(f.orderNow().manualProduction.stages,done);assert.ok(f.orderNow().completedAt);assert.equal(dispatchOrders(f.store,manager).length,1);assert.equal(f.alerts.length,1);assert.match(f.alerts[0][1].title,/ready for dispatch/);
 const row=buildSiteOrderRows([f.orderNow()])[0];assert.equal(row.QA,'✓');assert.equal(row['Ready for dispatch'],'✓');assert.equal(f.save().unchanged,true);assert.equal(f.alerts.length,1);
 f.qa(records[0],'recut');assert.equal(f.orderNow().status,'approved');assert.equal(f.orderNow().completedAt,null);assert.equal(dispatchOrders(f.store,manager).length,0);assert.equal(f.orderNow().manualProduction.stages.fabricatedQa,'pending');
 f.qa(records[0]);assert.equal(f.orderNow().status,'completed');
 const dispatched=dispatchOrder(f.store,{id:base.id,expectedUpdatedAt:f.orderNow().updatedAt,mutationId:crypto.randomUUID(),destination:'Site',transport:'Truck',driver:'Driver'},manager);assert.equal(dispatched.order.status,'dispatched');assert.throws(()=>requireCurrentGateQa(f.store,records[0]),/no longer active/);
});
test('resetting Drawn withdraws QA work and a new revision cannot reuse old approvals',()=>{
 const f=fixture();f.save();const old=f.records();old.forEach(item=>f.qa(item));assert.equal(f.orderNow().status,'completed');
 f.save('pending');assert.equal(f.orderNow().status,'approved');assert.ok(old.every(item=>!currentGateQaRecord(f.orderNow(),item)));assert.throws(()=>f.qa(old[0]),/no longer active/);
 f.save();const current=f.records().filter(item=>currentGateQaRecord(f.orderNow(),item));assert.equal(current.length,2);assert.ok(current.every(item=>!old.some(previous=>previous.id===item.id)&&item.status==='awaiting'));assert.equal(f.orderNow().manualProduction.stages.readyForDispatch,'pending');assert.equal(f.records().filter(item=>old.some(previous=>previous.id===item.id)&&item.status==='approved').length,2);
});
test('permissions, stale versions, terminal orders and direct QA/readiness overrides cannot bypass the workflow',()=>{
 const f=fixture();assert.throws(()=>f.save('complete',{},inspector),/denied/);
 for(const stages of [null,[],{}, {drawn:'not_applicable'}, {...done}, {drawn:'complete',extra:'pending'}])assert.throws(()=>f.save('complete',{stages}),/stage|Drawn|automatically/);
 assert.equal(f.save('complete',{expectedUpdatedAt:'stale'}).code,'ORDER_CONFLICT');assert.equal(f.writes.length,0);
 for(const order of [{...base,orderType:'Panels'},{...base,status:'cancelled'},{...base,status:'dispatched'}])assert.throws(()=>fixture(order).save(),/only available|cannot be changed/);
 assert.throws(()=>checkGateOrderEdit(base,'Gate','completed'),/complete its QA/);
 f.save();assert.throws(()=>checkGateOrderEdit(f.orderNow(),'Gate','completed'),/complete its QA/);assert.throws(()=>checkGateOrderEdit(f.orderNow(),'Fixings','approved'),/keep its order type/);assert.throws(()=>checkGateOrderEdit(f.orderNow(),'Gate','approved',{...base,project:'Another project'}),/production to pending/);
});
test('legacy readiness is not bulk rewritten, but explicitly saving Drawn routes it through real QA',()=>{
 const f=fixture({...base,status:'completed',completedAt:'old',manualProduction:{stages:done}});assert.equal(dispatchOrders(f.store,manager).length,1);assert.equal(f.records().length,0);assert.equal(gateProductionStages(f.orderNow()).readyForDispatch,'complete');
 f.save();assert.equal(f.orderNow().status,'approved');assert.equal(f.records().length,2);assert.equal(f.orderNow().manualProduction.stages.fabricatedQa,'pending');
 const panel=buildSiteOrderRows([{...base,orderType:'Panels',manualProduction:{stages:done}}])[0];assert.equal(panel.QA,'-');assert.equal(buildSiteOrderRows([{...base,orderType:'Fixings'}])[0].QA,'N/A');
});
