export const isPanelOrder=order=>String(order.orderType||'').trim().toLowerCase()==='panels';
export const orderStatusLabel=status=>({submitted:'Submitted',approved:'Approved',ordered:'Ordered',in_stock:'In stock',completed:'Ready for dispatch',cancelled:'Cancelled'}[status]||String(status));
export function orderConflict(order,body){
 const expected=body.expectedUpdatedAt;
 if(typeof expected!=='string'||expected!==(order.updatedAt||order.createdAt||''))return {ok:false,code:'ORDER_CONFLICT',error:'This order changed or your editor is out of date. Review the latest order before saving. Your changes have not been saved.',order};
 return null;
}
export function nextOrderStamp(previous){return new Date(Math.max(Date.now(),(Date.parse(previous.updatedAt||previous.createdAt)||0)+1)).toISOString();}
export function notifyOrderChange(store,previous,current,actor){
 const fields=[['status','Status'],['requestedDeliveryDate','Requested delivery date'],['requestedDeliveryTime','Requested delivery time'],['scheduledDeliveryDate','Confirmed delivery date'],['scheduledDeliveryTime','Confirmed delivery time']];
 const changes=fields.filter(([key])=>(previous[key]||'')!==(current[key]||'')).map(([key,label])=>`${label}: ${key==='status'?orderStatusLabel(current[key]):current[key]||'not set'}`);
 if(!changes.length||!current.requestedBy||current.requestedBy===actor.username)return;
 const deliveryChanged=['scheduledDeliveryDate','scheduledDeliveryTime'].some(key=>(previous[key]||'')!==(current[key]||''));
 const delayed=deliveryChanged&&previous.scheduledDeliveryDate&&current.scheduledDeliveryDate&&
  (current.scheduledDeliveryDate>previous.scheduledDeliveryDate||current.scheduledDeliveryDate===previous.scheduledDeliveryDate&&previous.scheduledDeliveryTime&&current.scheduledDeliveryTime&&current.scheduledDeliveryTime>previous.scheduledDeliveryTime);
 let title='updated';
 if(previous.status!==current.status&&current.status==='cancelled')title='cancelled';
 else if(previous.status!==current.status&&current.status==='completed'&&!isPanelOrder(current))title='ready for dispatch';
 else if(delayed)title='delivery delayed';
 else if(deliveryChanged)title=!current.scheduledDeliveryDate?'delivery confirmation removed':!previous.scheduledDeliveryDate?'delivery confirmed':'delivery rescheduled';
 if(deliveryChanged&&previous.scheduledDeliveryDate)changes.push(`Previously confirmed delivery: ${previous.scheduledDeliveryDate}${previous.scheduledDeliveryTime?' · '+previous.scheduledDeliveryTime:''}`);
 store.notify([current.requestedBy],{title:`Order #${current.orderNumber}: ${title}`,message:`${current.project} · ${changes.join(' · ')}`,kind:'orders',priority:'important',link:'orders',orderId:current.id});
}
