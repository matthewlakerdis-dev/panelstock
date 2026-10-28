import {requireCondition as check} from './security.js';
import {nextOrderStamp,notifyOrderChange} from './order-updates.js';
import {orderCompletionStamp} from './order-history.js';

// A saved order ID, revision and item ID link the QA record. Names alone never link work.
export function currentGateQaRecord(order,record){
  return !!order&&String(order.orderType||'').trim().toLowerCase()==='gate'&&order.status!=='cancelled'&&
    order.manualProduction?.qaWorkflowVersion===1&&order.manualProduction.stages.drawn==='complete'&&
    record.gateOrderId===order.id&&record.gateRevision===order.manualProduction.qaRevision&&
    Array.isArray(order.manualProduction.qaItemIds)&&order.manualProduction.qaItemIds.includes(record.id);
}
export function queueGateQa(order,actor,now,records){
  const revision=crypto.randomUUID(),items=(order.items||[]).map((item,index)=>({
    id:crypto.randomUUID(),kind:'metalwork',gateOrderId:order.id,gateRevision:revision,gateItemIndex:index,
    project:order.project,orderNumber:order.orderNumber,sheetNumber:'',reference:'Gate: '+item.description,
    quantity:item.quantity,fabricatedBy:'',drawnBy:actor.username,createdBy:actor.username,createdAt:now,
    status:'awaiting',latest:null,history:[]
  }));
  check(items.length,'Add Gate items before sending the order to QA');
  return {records:[...items,...records],qaRevision:revision,qaItemIds:items.map(item=>item.id)};
}
export function requireCurrentGateQa(store,record){
  if(!record.gateOrderId)return;
  const order=store.read('orders',[]).find(value=>value.id===record.gateOrderId);
  check(currentGateQaRecord(order,record)&&order.status!=='dispatched',
    'This Gate QA entry is no longer active. Refresh QA before checking it.',409);
}
// Called in the QA transaction, after saving its evidence. Every current item must pass.
export function syncGateQaProgress(store,record,actor){
  if(!record.gateOrderId)return;
  const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===record.gateOrderId),previous=orders[index];
  check(currentGateQaRecord(previous,record)&&previous.status!=='dispatched','This Gate QA entry is no longer active',409);
  const records=store.read('qa-checks',[]),production=previous.manualProduction;
  const approved=production.qaItemIds.length>0&&production.qaItemIds.every(id=>records.some(item=>item.id===id&&currentGateQaRecord(previous,item)&&item.status==='approved'));
  const now=nextOrderStamp(previous),stages={drawn:'complete',fabricatedQa:approved?'complete':'pending',readyForDispatch:approved?'complete':'pending'};
  const statusBeforeReady=previous.status==='completed'?(production.statusBeforeReady||'approved'):previous.status;
  const status=approved?'completed':previous.status==='completed'?statusBeforeReady:previous.status;
  const current={...previous,manualProduction:{...production,stages,statusBeforeReady,updatedAt:now,updatedBy:actor.username},status,
    completedAt:orderCompletionStamp(previous,status,now),updatedAt:now,updatedBy:actor.username};
  orders[index]=current;store.write('orders',orders);notifyOrderChange(store,previous,current,actor);
  store.audit(actor.username,'order-production-updated',{orderId:current.id,orderNumber:current.orderNumber,status,source:'qa',qaId:record.id,previousStages:production.stages,stages});
}
