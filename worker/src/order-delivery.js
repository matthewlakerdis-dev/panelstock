import {requireCondition as check} from './security.js';
import {orderConflict,nextOrderStamp,notifyOrderChange} from './order-updates.js';

export function scheduleOrderDelivery(store,id,body,actor){
  check(actor.isAdmin,'Admin access required',403);
  const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===id);
  check(index>=0,'Order request not found',404);
  const previous=orders[index];
  check(!['dispatched','cancelled'].includes(previous.status),'Dispatched or cancelled orders cannot be rescheduled',409);
  const conflict=orderConflict(previous,body);if(conflict)return conflict;
  const date=body.scheduledDeliveryDate,rawTime=body.scheduledDeliveryTime??previous.scheduledDeliveryTime??'';
  check(typeof date==='string','Choose a scheduled delivery date or clear the schedule');
  const parsed=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T12:00:00Z'):null;
  check(!date||parsed&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date,'Choose a valid scheduled delivery date');
  check(typeof rawTime==='string'&&(!rawTime||/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime)),'Choose a valid scheduled delivery time');
  const time=date?rawTime:'';
  if(date===(previous.scheduledDeliveryDate||'')&&time===(previous.scheduledDeliveryTime||''))return {ok:true,order:previous,unchanged:true};
  const current={...previous,scheduledDeliveryDate:date,scheduledDeliveryTime:time,updatedAt:nextOrderStamp(previous),updatedBy:actor.username};
  orders[index]=current;
  store.ctx.storage.transactionSync(()=>{
    store.write('orders',orders);
    notifyOrderChange(store,previous,current,actor);
    store.audit(actor.username,'order-delivery-updated',{orderId:id,orderNumber:current.orderNumber,
      previousScheduledDeliveryDate:previous.scheduledDeliveryDate||'',previousScheduledDeliveryTime:previous.scheduledDeliveryTime||'',
      scheduledDeliveryDate:date,scheduledDeliveryTime:time});
  });
  return {ok:true,order:current};
}
