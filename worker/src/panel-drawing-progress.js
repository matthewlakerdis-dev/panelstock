import {requireCondition as check} from './security.js';
import {isPanelOrder,orderConflict,nextOrderStamp} from './order-updates.js';

export function checkPanelDrawingEdit(previous,type,definition){
  if(!isPanelOrder(previous)||previous.manualDrawing?.drawn!==true)return;
  check(isPanelOrder({orderType:type}),'Set Drawn to Pending before changing this panel order type',409);
  if(!definition)return;
  const normal=value=>String(value||'').trim().toLowerCase();
  const items=value=>JSON.stringify((value||[]).map(item=>({quantity:Number(item.quantity),description:String(item.description||'').trim().toUpperCase()})));
  check((!previous.projectId||!definition.projectId||previous.projectId===definition.projectId)&&normal(previous.project)===normal(definition.project)&&items(previous.items)===items(definition.items),
    'Set Drawn to Pending before changing this panel order project or items',409);
}
export function updatePanelDrawing(store,id,body,actor){
  store.requireTask(actor,'site.orders.manage');
  const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===id);
  check(index>=0,'Order request not found',404);
  const previous=orders[index];
  check(isPanelOrder(previous),'Manual Drawn is only available for panel orders',409);
  check(!['dispatched','cancelled'].includes(previous.status),'Dispatched or cancelled panel progress cannot be changed',409);
  const conflict=orderConflict(previous,body);if(conflict)return conflict;
  check(typeof body.drawn==='boolean','Choose Pending or Complete for Drawn');
  if(previous.manualDrawing?.drawn===body.drawn)return {ok:true,order:previous,unchanged:true};
  const now=nextOrderStamp(previous),current={...previous,manualDrawing:{drawn:body.drawn,updatedAt:now,updatedBy:actor.username},updatedAt:now,updatedBy:actor.username};
  orders[index]=current;
  store.ctx.storage.transactionSync(()=>{
    store.write('orders',orders);
    store.audit(actor.username,'order-production-updated',{orderId:id,orderNumber:current.orderNumber,status:current.status,previousStages:{drawn:previous.manualDrawing?.drawn===true?'complete':'pending'},stages:{drawn:body.drawn?'complete':'pending'}});
  });
  return {ok:true,order:current};
}
