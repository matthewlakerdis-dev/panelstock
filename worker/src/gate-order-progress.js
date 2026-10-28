import {queueGateQa} from './gate-order-qa.js';
import {requireCondition as check} from './security.js';
import {orderConflict,nextOrderStamp,notifyOrderChange} from './order-updates.js';
import {orderCompletionStamp} from './order-history.js';

export const GATE_STAGES=[['drawn','Drawn'],['toolpathed','Toolpathed'],['cut','Routed / cut'],['fabricatedQa','Fabricated / QA'],['sentToPc','Sent to PC'],['finalQa','Final QA'],['readyForDispatch','Ready for dispatch']];
export const isGateOrder=order=>String(order.orderType||'').trim().toLowerCase()==='gate';
export function gateProductionStages(order){
  return Object.fromEntries(GATE_STAGES.map(([key])=>[key,['drawn','fabricatedQa','readyForDispatch'].includes(key)?
    order.manualProduction?.stages?.[key]||(key==='readyForDispatch'&&['completed','dispatched'].includes(order.status)?'complete':'pending'):'not_applicable']));
}
export function gateProductionReady(stages={}){
  return stages.readyForDispatch==='complete'&&stages.drawn==='complete'&&stages.fabricatedQa==='complete';
}
// Generic order edits cannot bypass the fabrication readiness check or detach its record.
export function checkGateOrderEdit(previous,type,status,definition){
  if(!isGateOrder(previous)&&!isGateOrder({orderType:type}))return;
  check(!previous.manualProduction||isGateOrder({orderType:type}),'A Gate with recorded production must keep its order type',409);
  if(definition&&previous.manualProduction&&['drawn','fabricatedQa'].some(key=>previous.manualProduction.stages[key]==='complete')){
    const projectMatches=(!previous.projectId||!definition.projectId||previous.projectId===definition.projectId)&&String(previous.project||'').trim().toLowerCase()===String(definition.project||'').trim().toLowerCase();
    const items=value=>JSON.stringify((value||[]).map(item=>({quantity:Number(item.quantity),description:String(item.description||'').trim().toUpperCase()})));
    check(projectMatches&&items(previous.items)===items(definition.items),'Set Gate production to pending before changing its project or items',409);
  }
  if(status==='completed'&&(previous.status!=='completed'||!isGateOrder(previous)))check(gateProductionReady(gateProductionStages(previous)),
    'Mark the Gate Drawn and complete its QA checks before dispatch',409);
}
export function updateGateProduction(store,id,body,actor){
  store.requireTask(actor,'site.orders.manage');
  const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===id);
  check(index>=0,'Order request not found',404);
  const previous=orders[index];
  check(isGateOrder(previous),'Manual production progress is only available for Gate orders',409);
  check(!['dispatched','cancelled'].includes(previous.status),'Dispatched or cancelled Gate progress cannot be changed',409);
  const conflict=orderConflict(previous,body);if(conflict)return conflict;
  const input=body.stages;
  check(input&&typeof input==='object'&&!Array.isArray(input),'Choose a state for each production stage');
  check(Object.keys(input).every(key=>['drawn','fabricatedQa','readyForDispatch'].includes(key))&&['pending','complete'].includes(input.drawn),'Choose Pending or Complete for Drawn');
  const previousStages=gateProductionStages(previous);
  for(const key of ['fabricatedQa','readyForDispatch'])if(Object.hasOwn(input,key))check(input[key]===previousStages[key]||(input.drawn==='pending'&&input[key]==='pending'),'Fabricated/QA and Ready for Dispatch update automatically from QA',409);
  const prior=previous.manualProduction;
  if(prior?.qaWorkflowVersion===1&&input.drawn===prior.stages.drawn)return {ok:true,order:previous,unchanged:true};
  const now=nextOrderStamp(previous),statusBeforeReady=previous.status==='completed'?(prior?.statusBeforeReady||'approved'):previous.status;
  const stages={drawn:input.drawn,fabricatedQa:'pending',readyForDispatch:'pending'};
  const queued=input.drawn==='complete'?queueGateQa(previous,actor,now,store.read('qa-checks',[])):null;
  const status=previous.status==='completed'?statusBeforeReady:previous.status;
  const current={...previous,manualProduction:{stages,updatedAt:now,updatedBy:actor.username,statusBeforeReady,qaWorkflowVersion:1,qaRevision:queued?.qaRevision||null,qaItemIds:queued?.qaItemIds||[],drawnBy:input.drawn==='complete'?actor.username:'',drawnAt:input.drawn==='complete'?now:null},status,
    completedAt:orderCompletionStamp(previous,status,now),updatedAt:now,updatedBy:actor.username};
  orders[index]=current;
  store.ctx.storage.transactionSync(()=>{
    store.write('orders',orders);
    if(queued)store.write('qa-checks',queued.records);
    notifyOrderChange(store,previous,current,actor);
    store.audit(actor.username,'order-production-updated',{orderId:id,orderNumber:current.orderNumber,status,
      previousStages:gateProductionStages(previous),stages});
  });
  return {ok:true,order:current};
}
