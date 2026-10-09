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
 store.notify([current.requestedBy],{title:`Order #${current.orderNumber} updated`,message:`${current.project} · ${changes.join(' · ')}`,kind:'orders',priority:'important',link:'orders'});
}
