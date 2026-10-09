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
