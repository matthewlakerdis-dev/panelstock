import {requireCondition as check} from './security.js';
const labels={'delivery-issue-updated':'Delivery issue updated','order-receipt-amended':'Delivery receipt corrected','order-received':'Delivery receipt recorded','order-created':'Order submitted','order-updated':'Order updated','order-status':'Status updated','order-attachment-added':'File added'};
export function orderHistory(store,id,actor){
  store.requireTask(actor,'site.orders.view');
  const order=store.read('orders',[]).find(order=>order.id===id);
  check(order,'Order request not found',404);
  const rows=store.sql.exec("SELECT id,username,action,at,detail FROM audit WHERE action IN ('order-created','order-updated','order-status','order-attachment-added','order-received','delivery-issue-updated','order-receipt-amended') AND json_extract(detail,'$.orderId')=? ORDER BY at ASC,id ASC",id).toArray();
  const events=rows.map(row=>{const detail=JSON.parse(row.detail);return {id:String(row.id),at:row.at,actor:row.username,label:labels[row.action],status:['order-status','order-updated'].includes(row.action)?String(detail.status||''):'',fileName:row.action==='order-attachment-added'?String(detail.name||''):''};});
  if(!rows.some(row=>row.action==='order-created')&&order.createdAt)events.unshift({id:'created',at:order.createdAt,actor:order.requestedBy||'',label:'Order submitted',status:'',fileName:''});
  return {ok:true,events};
}

export function orderCompletionStamp(previous,status,now=new Date().toISOString()){
  return status==='completed'?(previous.completedAt||(previous.status==='completed'?null:now)):null;
}
export function ordersWithCompletionDates(store,orders){
  if(!orders.some(order=>order.status==='completed'&&!order.completedAt))return orders;
  const rows=store.sql.exec("SELECT action,at,detail FROM audit WHERE action IN ('order-created','order-status','order-updated') AND json_extract(detail,'$.status') IS NOT NULL ORDER BY at ASC,id ASC").toArray();
  const dates=new Map(),statuses=new Map();
  for(const row of rows){
    const detail=JSON.parse(row.detail),id=detail.orderId,status=detail.status;
    if(status==='completed'&&statuses.get(id)!=='completed')dates.set(id,row.at);
    if(status!=='completed')dates.delete(id);
    statuses.set(id,status);
  }
  return orders.map(order=>order.status==='completed'&&!order.completedAt?{...order,completedAt:dates.get(order.id)||null}:order);
}
