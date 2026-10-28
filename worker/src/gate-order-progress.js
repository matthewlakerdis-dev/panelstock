import {requireCondition as check} from './security.js';
import {orderConflict,nextOrderStamp,notifyOrderChange} from './order-updates.js';
import {orderCompletionStamp} from './order-history.js';

export const GATE_STAGES=[['drawn','Drawn'],['toolpathed','Toolpathed'],['cut','Routed / cut'],['fabricatedQa','Fabricated / QA'],['sentToPc','Sent to PC'],['finalQa','Final QA'],['readyForDispatch','Ready for dispatch']];
export const GATE_EDITABLE_STAGES=GATE_STAGES.filter(([key])=>['drawn','fabricatedQa','readyForDispatch'].includes(key));
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
    'Record Gate production and mark Ready for dispatch in Production progress',409);
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
  const stages={};
  check(Object.keys(input).length===GATE_EDITABLE_STAGES.length,'Choose a state for each production stage');
  for(const [key,label] of GATE_EDITABLE_STAGES){
    check(['pending','complete'].includes(input[key]),'Choose a valid state for '+label);
    stages[key]=input[key];
  }
  check(stages.readyForDispatch!=='complete'||gateProductionReady(stages),'Complete Drawn and Fabricated / QA before marking Ready for dispatch',409);
  const prior=previous.manualProduction;
  if(prior&&GATE_EDITABLE_STAGES.every(([key])=>stages[key]===prior.stages[key])&&(stages.readyForDispatch==='complete'?previous.status==='completed':previous.status!=='completed'))return {ok:true,order:previous,unchanged:true};
  const now=nextOrderStamp(previous),statusBeforeReady=previous.status==='completed'?(prior?.statusBeforeReady||'approved'):previous.status;
  const status=stages.readyForDispatch==='complete'?'completed':previous.status==='completed'?statusBeforeReady:previous.status;
  const current={...previous,manualProduction:{stages,updatedAt:now,updatedBy:actor.username,statusBeforeReady},status,
    completedAt:orderCompletionStamp(previous,status,now),updatedAt:now,updatedBy:actor.username};
  orders[index]=current;
  store.ctx.storage.transactionSync(()=>{
    store.write('orders',orders);
    notifyOrderChange(store,previous,current,actor);
    store.audit(actor.username,'order-production-updated',{orderId:id,orderNumber:current.orderNumber,status,
      previousStages:gateProductionStages(previous),stages});
  });
  return {ok:true,order:current};
}
