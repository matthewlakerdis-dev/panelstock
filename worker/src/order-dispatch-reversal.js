import {requireCondition as check} from './security.js';
import {isPanelOrder,orderConflict,nextOrderStamp} from './order-updates.js';
import {isGateOrder,gateProductionReady} from './gate-order-progress.js';
import {dispatchOrders} from './order-dispatch.js';
import {buildSiteOrderRows,matchesSiteOrder} from './site-orders-excel.js';
import {migrateQaRecords} from './qa-status.js';

function reversePanelLoads(store,order,orders,record){
 const loads=store.read('panel-dispatch-loads',[]),matching=loads.filter(load=>matchesSiteOrder(order,load));
 const ids=order.dispatch?.loadIds||matching.filter(load=>load.status==='dispatched_to_site').map(load=>load.id);
 check(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length,'No unambiguous panel dispatch loads were found for this order',409);
 const selected=ids.map(id=>loads.find(load=>load.id===id));
 check(selected.every(load=>load&&matchesSiteOrder(order,load)&&load.status==='dispatched_to_site'),'Panel dispatch loads changed. Refresh and review the order',409);
 check(!orders.some(other=>other.id!==order.id&&isPanelOrder(other)&&selected.some(load=>matchesSiteOrder(other,load))),'These panel loads match more than one order; review the dispatch records first',409);
 const legacy=store.read('qa-dispatches',[]).flatMap(dispatch=>dispatch.lines||[]).filter(line=>line.kind==='panel');
 check(!selected.some(load=>legacy.some(line=>load.panelIds.includes(line.id))),'Legacy panel dispatch records require a separate review',409);
 const reversed=new Map();
 for(const load of selected){
  const legs=load.legs||[],leg=legs.at(-1);
  check(leg?.destinationType==='site','Only the final site delivery leg can be reversed',409);
  check((load.dispatchReversals||[]).length<100,'Panel dispatch reversal history is full; contact an administrator',409);
  const next=structuredClone(load);next.legs=next.legs.slice(0,-1);
  next.status=next.legs.some(value=>value.destinationType==='powder_coaters')?'ready_for_site':'waiting';
  next.dispatchRevision=(Number(load.dispatchRevision)||0)+1;
  next.dispatchReversals=[...(load.dispatchReversals||[]),{id:record.id,orderId:order.id,by:record.by,at:record.at,reason:record.reason,leg:structuredClone(leg)}];
  reversed.set(load.id,next);
 }
 record.panelDeliveries=selected.map(load=>({loadId:load.id,panelIds:load.panelIds.slice(),leg:structuredClone(load.legs.at(-1))}));
 record.loadIds=[...reversed.keys()];
 return loads.map(load=>reversed.get(load.id)||load);
}

export function reverseOrderDispatch(store,id,body,actor){
 store.requireTask(actor,'factory.dispatch');
 check(actor.isAdmin===true,'Only administrators can reverse an order dispatch',403);
 check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'A reversal request ID is required');
 check(typeof body.reason==='string','Enter a reason for reversing the dispatch');
 const reason=body.reason.trim();check(reason.length>0&&reason.length<=1000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason),'Enter a reversal reason of 1 to 1000 characters');
 const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===id),previous=orders[index];
 check(previous,'Order request not found',404);
 const existing=(previous.dispatchReversals||[]).find(record=>record.id===body.mutationId);
 if(existing){
  check(existing.by===actor.username&&existing.reason===reason&&existing.expectedUpdatedAt===body.expectedUpdatedAt,'This reversal request was already used with different details',409);
  return {ok:true,order:previous,orders:dispatchOrders(store,actor),idempotent:true};
 }
 const conflict=orderConflict(previous,body);if(conflict)return conflict;
 check(!previous.gateComponents,'Component shipments must retain their QA and delivery history; review the individual Gate components before correcting dispatch',409);
 check(previous.status==='dispatched','Only a dispatched order can have its dispatch reversed',409);
 check(!(previous.receipts||[]).length,'A delivery has already been recorded. Dispatch cannot be reversed without reviewing that delivery record',409);
 check((previous.dispatchReversals||[]).length<100,'Dispatch reversal history is full; contact an administrator',409);
 const now=nextOrderStamp(previous),record={id:body.mutationId,by:actor.username,at:now,reason,expectedUpdatedAt:body.expectedUpdatedAt,...(previous.dispatches?{dispatches:structuredClone(previous.dispatches)}:{}),dispatch:structuredClone(previous.dispatch||{at:previous.dispatchedAt||'',by:previous.dispatchedBy||''})};
 const loads=isPanelOrder(previous)?reversePanelLoads(store,previous,orders,record):null;
 const current={...previous,status:'completed',completedAt:previous.completedAt||now,updatedAt:now,updatedBy:actor.username,dispatchReversals:[...(previous.dispatchReversals||[]),record]};
 delete current.dispatch;delete current.dispatches;delete current.dispatchedAt;delete current.dispatchedBy;
 // Reversing a delivery never grants production, coating or QA approval.
 if(loads){
  const panels=store.read('app:cncPanels',[]),qa=migrateQaRecords(store.read('qa-checks',[])).records;
  if(buildSiteOrderRows([current],panels,qa,loads,store.panelCoatingStock())[0]['Ready for dispatch']!=='✓')current.status='ordered';
 }else if(isGateOrder(current)&&current.manualProduction&&!gateProductionReady(current.manualProduction.stages))current.status='ordered';
 if(current.status!=='completed')current.completedAt=null;
 orders[index]=current;
 store.ctx.storage.transactionSync(()=>{
  if(loads)store.write('panel-dispatch-loads',loads);
  store.write('orders',orders);
  store.audit(actor.username,'order-dispatch-reversed',{orderId:id,orderNumber:current.orderNumber,project:current.project,status:current.status,reason,mutationId:record.id,dispatch:record.dispatch,...(record.loadIds?{loadIds:record.loadIds}:{})});
  if(current.requestedBy&&current.requestedBy!==actor.username)store.notify([current.requestedBy],{title:'Order #'+current.orderNumber+': dispatch reversed',message:current.project+' · '+(current.status==='completed'?'Ready for dispatch':'Returned to production tracking')+' · '+reason,kind:'orders',priority:'important',link:'orders',orderId:id});
 });
 return {ok:true,order:current,orders:dispatchOrders(store,actor)};
}
