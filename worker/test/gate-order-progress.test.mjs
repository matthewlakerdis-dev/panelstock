import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateGateProduction,gateProductionStages,checkGateOrderEdit} from '../src/gate-order-progress.js';
import {buildSiteOrderRows,buildSiteOrderFeed} from '../src/site-orders-excel.js';
import {buildOrderProductionProgress} from '../src/order-production-progress.js';
import {dispatchOrders,dispatchOrder} from '../src/order-dispatch.js';
const base={id:'11111111-1111-4111-8111-111111111111',project:'Gate project',orderNumber:'001',orderType:'Gate',status:'approved',requestedBy:'leading-hand',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',requestedDeliveryDate:'2026-11-03',scheduledDeliveryDate:'2026-11-04',siteContact:'PRIVATE',phone:'PRIVATE',items:[{quantity:2,description:'GATES'}],attachments:[{name:'SECRET'}]};
const manager={username:'manager',tasks:{'site.orders.manage':true,'factory.dispatch':true}},pending={drawn:'pending',fabricatedQa:'pending',readyForDispatch:'pending'},done={drawn:'complete',fabricatedQa:'complete',readyForDispatch:'complete'};
function fixture(order=base){
 const docs=new Map([['orders',[structuredClone(order),{...base,id:'other'}]],['app:cncPanels',[]],['qa-checks',[]],['panel-dispatch-loads',[]]]),audits=[],alerts=[],writes=[];
 const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,next)=>{writes.push(key);docs.set(key,structuredClone(next));},ctx:{storage:{transactionSync:fn=>fn()}},requireTask(actor,key){assert.ok(actor.isAdmin||actor.tasks?.[key],'Task denied');},audit:(...args)=>audits.push(args),notify:(...args)=>alerts.push(args),panelCoatingStock:()=>[],ordersWithDrawingProgress:()=>store.read('orders',[])};
 const orderNow=()=>docs.get('orders')[0],save=(stages,body={},actor=manager)=>updateGateProduction(store,base.id,{stages,expectedUpdatedAt:orderNow().updatedAt,...body},actor);
 return {store,save,orderNow,audits,alerts,writes};
}
test('Gate progress updates only the requested order, preserves definitions and feeds the exact three tracker columns',()=>{
 const f=fixture();let result=f.save({...pending,drawn:'complete'},{status:'dispatched',manualProduction:{stages:done},items:[]});
 assert.equal(result.order.status,'approved');assert.equal(result.order.manualProduction.updatedBy,'manager');assert.deepEqual(result.order.items,base.items);assert.equal(result.order.scheduledDeliveryDate,base.scheduledDeliveryDate);assert.equal(result.order.requestedDeliveryDate,base.requestedDeliveryDate);
 let row=buildSiteOrderRows([result.order])[0];assert.equal(row.Drawn,'✓');assert.equal(row.QA,'-');assert.equal(row['Ready for dispatch'],'-');
 for(const key of ['Toolpathed','Routed / cut','Sent to PC','Final QA'])assert.equal(row[key],'N/A');
 const summary=buildOrderProductionProgress(result.order);assert.equal(summary.stages.find(stage=>stage.label==='Fabricated / QA').state,'pending');assert.doesNotMatch(JSON.stringify(summary),/PRIVATE|SECRET/);
 assert.doesNotMatch(buildSiteOrderFeed([row]),/PRIVATE|SECRET|manualProduction/);
 assert.equal(f.alerts.length,0);assert.equal(f.audits[0][1],'order-production-updated');assert.deepEqual(f.writes,['orders']);assert.deepEqual(f.store.read('orders',[])[1],{...base,id:'other'});
 result=f.save(done);row=buildSiteOrderRows([result.order])[0];assert.equal(row.Drawn,'✓');assert.equal(row.QA,'✓');assert.equal(row['Ready for dispatch'],'✓');assert.equal(result.order.status,'completed');assert.ok(result.order.completedAt);assert.match(f.alerts[0][1].title,/ready for dispatch/);
 const stamp=result.order.updatedAt;assert.equal(f.save(done).unchanged,true);assert.equal(f.orderNow().updatedAt,stamp);assert.equal(f.audits.length,2);assert.equal(f.alerts.length,1);
});
test('readiness appears in Dispatch and corrections withdraw it until rechecked; dispatch locks manual progress',()=>{
 const f=fixture();f.save(done);assert.equal(dispatchOrders(f.store,manager).length,1);
 const correction=f.save({...pending,drawn:'complete'});assert.equal(correction.order.status,'approved');assert.equal(correction.order.completedAt,null);assert.equal(dispatchOrders(f.store,manager).length,0);assert.equal(f.alerts.length,2);
 f.save(done);const result=dispatchOrder(f.store,{id:base.id,expectedUpdatedAt:f.orderNow().updatedAt,mutationId:crypto.randomUUID(),destination:'Site',transport:'Truck',driver:'Driver'},manager);assert.equal(result.order.status,'dispatched');assert.throws(()=>f.save(pending),/cannot be changed/);
 assert.equal(buildSiteOrderRows([f.orderNow()])[0]['Ready for dispatch'],'✓');assert.deepEqual(f.writes.filter(key=>key!=='orders'),[]);
});
test('missing permissions, non-Gates, terminal orders, stale edits and invalid stages never write',()=>{
 const f=fixture();assert.throws(()=>f.save(pending,{}, {username:'viewer'}),/denied/);
 for(const stages of [null,[],{}, {...pending,drawn:'not_applicable'}, {...pending,extra:'complete'}, {...pending,fabricatedQa:true}])assert.throws(()=>f.save(stages),/stage|state/);
 assert.throws(()=>f.save({...pending,readyForDispatch:'complete'}),/Complete Drawn/);
 assert.equal(f.save(done,{expectedUpdatedAt:'stale'}).code,'ORDER_CONFLICT');assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);assert.equal(f.alerts.length,0);
 for(const order of [{...base,orderType:'Panels'},{...base,orderType:'Fixings'},{...base,status:'cancelled'},{...base,status:'dispatched'}]){const h=fixture(order);assert.throws(()=>h.save(done),/only available|cannot be changed/);assert.equal(h.writes.length,0);}
 const missing=fixture({...base,id:'missing'});assert.throws(()=>missing.save(done),/not found/);
});
test('generic status edits cannot bypass fabrication checks or detach recorded production from its Gate type',()=>{
 assert.throws(()=>checkGateOrderEdit(base,'Gate','completed'),/Record Gate production/);
 const recorded={...base,manualProduction:{stages:done}};assert.doesNotThrow(()=>checkGateOrderEdit(recorded,'Gate','completed'));
 assert.throws(()=>checkGateOrderEdit(recorded,'Gate','approved',{...recorded,project:'Another project'}),/production to pending/);
 assert.throws(()=>checkGateOrderEdit(recorded,'Gate','approved',{...recorded,items:[{quantity:3,description:'GATES'}]}),/production to pending/);
 assert.doesNotThrow(()=>checkGateOrderEdit(recorded,'Gate','approved',recorded));
 assert.throws(()=>checkGateOrderEdit(recorded,'Fixings','approved'),/keep its order type/);
 assert.doesNotThrow(()=>checkGateOrderEdit({...base,orderType:'Fixings'},'Fixings','completed'));
 const legacy={...base,status:'completed'};assert.equal(gateProductionStages(legacy).readyForDispatch,'complete');assert.doesNotThrow(()=>checkGateOrderEdit(legacy,'Gate','completed'));
});
test('automatic panel progress and unrelated non-panel types retain the existing production rules',()=>{
 const gate=buildSiteOrderRows([{...base,orderType:' gAtE '}])[0];assert.equal(gate.Drawn,'-');assert.equal(gate.QA,'-');
 const panel=buildSiteOrderRows([{...base,orderType:'Panels',manualProduction:{stages:done}}])[0];assert.equal(panel.Drawn,'-');assert.equal(panel.QA,'-');assert.equal(panel['Ready for dispatch'],'-');
 const fixings=buildSiteOrderRows([{...base,orderType:'Fixings'}])[0];assert.equal(fixings.Drawn,'N/A');assert.equal(fixings.QA,'N/A');
});

test('legacy Gate readiness is retained without inventing fabrication records; restored orders can explicitly become ready again',()=>{
 const f=fixture({...base,status:'completed',completedAt:'legacy-ready'});
 assert.equal(dispatchOrders(f.store,manager).length,1);const stages=gateProductionStages(f.orderNow());assert.equal(stages.drawn,'pending');assert.equal(stages.fabricatedQa,'pending');assert.equal(stages.readyForDispatch,'complete');
 const restored=fixture({...base,status:'approved',manualProduction:{stages:done,statusBeforeReady:'approved'}});
 assert.equal(restored.save(done).order.status,'completed');
});
