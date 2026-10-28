import {isGateOrder,gateProductionReady} from './gate-order-progress.js';
import {requireCondition as check} from './security.js';
import {isPanelOrder,orderConflict,nextOrderStamp,notifyOrderChange} from './order-updates.js';
import {buildSiteOrderRows,matchesSiteOrder} from './site-orders-excel.js';
import {migrateQaRecords} from './qa-status.js';

function summary(order,ready){
  const fields=['id','orderNumber','project','orderType','orderTypeOther','siteContact','phone','locationNotes',
    'requestedDeliveryDate','requestedDeliveryTime','scheduledDeliveryDate','scheduledDeliveryTime',
    'items','status','createdAt','updatedAt','completedAt','dispatchedAt','dispatchedBy','dispatch'];
  return {...Object.fromEntries(fields.filter(key=>Object.hasOwn(order,key)).map(key=>[key,order[key]])),
    ready,usesPanelLoads:isPanelOrder(order)};
}

export function dispatchOrders(store,actor){
  store.requireTask(actor,'factory.dispatch');
  const panels=store.read('app:cncPanels',[]),records=migrateQaRecords(store.read('qa-checks',[])).records,
    loads=store.read('panel-dispatch-loads',[]),stock=store.panelCoatingStock();
  return store.ordersWithDrawingProgress().filter(order=>order.status!=='cancelled').flatMap(order=>{
    const ready=order.status!=='dispatched'&&(isPanelOrder(order)?
      buildSiteOrderRows([order],panels,records,loads,stock)[0]['Ready for dispatch']==='✓':order.status==='completed'&&(!isGateOrder(order)||!order.manualProduction||gateProductionReady(order.manualProduction.stages)));
    return ready||order.status==='dispatched'?[summary(order,ready)]:[];
  });
}

function dispatchDetails(body){
  const fields={};
  for(const key of ['destination','transport','driver','notes']){
    check(body[key]==null||typeof body[key]==='string',`${key} must be text`);
    fields[key]=String(body[key]||'').trim();
    check(fields[key].length<=(key==='notes'?5000:300),`${key} is too long`);
    if(key!=='notes')check(fields[key],`${key} is required`);
  }
  return fields;
}

export function dispatchOrder(store,body,actor){
  store.requireTask(actor,'factory.dispatch');
  check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'A dispatch request ID is required');
  const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===body.id);
  check(index>=0,'Order request not found',404);
  const previous=orders[index],details=dispatchDetails(body);
  check(!isPanelOrder(previous),'Dispatch panels using Panel loads so production and QA checks are preserved',409);
  if(previous.dispatch?.mutationId===body.mutationId){
    check(previous.dispatch.by===actor.username&&Object.entries(details).every(([key,value])=>previous.dispatch[key]===value),
      'This dispatch request was already used with different details',409);
    return {ok:true,order:summary(previous,false),orders:dispatchOrders(store,actor),idempotent:true};
  }
  const conflict=orderConflict(previous,body);if(conflict)return {...conflict,order:summary(previous,false)};
  check(previous.status==='completed','Only orders marked Ready for dispatch can be dispatched',409);
  check(!isGateOrder(previous)||!previous.manualProduction||gateProductionReady(previous.manualProduction.stages),'Gate production is not ready for dispatch',409);
  const now=nextOrderStamp(previous),dispatch={...details,mutationId:body.mutationId,by:actor.username,at:now};
  const current={...previous,status:'dispatched',dispatch,dispatchedAt:now,dispatchedBy:actor.username,updatedAt:now,updatedBy:actor.username};
  orders[index]=current;
  store.ctx.storage.transactionSync(()=>{
    store.write('orders',orders);
    notifyOrderChange(store,previous,current,actor);
    store.audit(actor.username,'order-dispatched',{orderId:current.id,orderNumber:current.orderNumber,project:current.project,status:'dispatched',...details});
  });
  return {ok:true,order:summary(current,false),orders:dispatchOrders(store,actor)};
}

// Called inside the existing panel dispatch transaction. A partial load or a
// powder-coater leg never completes the Site Order or bypasses its production gates.
export function completeDispatchedPanelOrders(store,actor,changedLoad){
  if(changedLoad?.status!=='dispatched_to_site')return;
  const orders=store.read('orders',[]),loads=store.read('panel-dispatch-loads',[]),panels=store.read('app:cncPanels',[]),
    records=migrateQaRecords(store.read('qa-checks',[])).records,stock=store.panelCoatingStock();
  let changed=false;
  for(let index=0;index<orders.length;index++){
    const previous=orders[index];
    if(!isPanelOrder(previous)||!matchesSiteOrder(previous,changedLoad)||['cancelled','dispatched'].includes(previous.status))continue;
    const orderLoads=loads.filter(load=>matchesSiteOrder(previous,load)),scheduled=panels.filter(panel=>matchesSiteOrder(previous,panel));
    if(!orderLoads.length||!scheduled.length||!orderLoads.every(load=>load.status==='dispatched_to_site')||
      !scheduled.every(panel=>orderLoads.some(load=>load.panelIds.includes(panel.id)))||
      buildSiteOrderRows([previous],panels,records,loads,stock)[0]['Ready for dispatch']!=='✓')continue;
    const last=orderLoads.flatMap(load=>load.legs||[]).filter(leg=>leg.destinationType==='site').sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];
    if(!last)continue;
    const now=nextOrderStamp(previous),dispatch={...last,source:'panel-loads',loadIds:orderLoads.map(load=>load.id)};
    const current={...previous,status:'dispatched',dispatch,dispatchedAt:last.at,dispatchedBy:actor.username,updatedAt:now,updatedBy:actor.username};
    orders[index]=current;changed=true;
    notifyOrderChange(store,previous,current,actor);
    store.audit(actor.username,'order-dispatched',{orderId:current.id,orderNumber:current.orderNumber,project:current.project,status:'dispatched',loadIds:dispatch.loadIds});
  }
  if(changed)store.write('orders',orders);
}
