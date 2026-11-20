import {HttpError,requireCondition as check} from './security.js';

const key=id=>'order-materials:'+id;
const indexKey='order-materials-index';
const closed=order=>['dispatched','cancelled'].includes(order.status);
const stamp=order=>order.updatedAt||order.createdAt||'';
const text=value=>String(value??'').trim().replace(/\s+/g,' ').toUpperCase();
const signature=item=>JSON.stringify([Number(item.quantity),text(item.description)]);
const context=order=>JSON.stringify([order.projectId||text(order.project),text(order.orderType),text(order.orderTypeOther),text(order.location),text(order.villa),text(order.colour)]);
const statuses=new Set(['pending','ordered','not_required']);
function requireManager(store,actor){store.requireTask(actor,'site.orders.view');store.requireTask(actor,'site.orders.manage');}

// Only creation enrolls an order. Reads and edits never backfill pre-launch orders.
export function initializeOrderMaterials(store,order){
 if(store.read(key(order.id),null))return;
 const record={version:1,revision:0,context:context(order),createdAt:order.createdAt,items:order.items.map(item=>({...item,status:'pending',markedAt:'',markedBy:''})),mutations:[]};
 store.write(key(order.id),record);
 store.write(indexKey,[...new Set([...store.read(indexKey,[]),order.id])]);
}

function projectedItems(order,record){
 const remaining=context(order)===record.context?record.items.slice():[];
 return order.items.map((item,index)=>{
  const match=remaining.findIndex(previous=>signature(previous)===signature(item)),previous=match<0?null:remaining.splice(match,1)[0];
  return {index,quantity:item.quantity,description:item.description,status:previous?.status||'pending',markedAt:previous?.markedAt||'',markedBy:previous?.markedBy||''};
 });
}
function entry(order,record){
 const items=projectedItems(order,record),pendingCount=items.filter(item=>item.status==='pending').length;
 return {order:Object.fromEntries(['id','orderNumber','projectId','project','orderType','orderTypeOther','location','villa','colour','urgent','requestedBy','createdAt','requestedDeliveryDate','scheduledDeliveryDate','status'].map(name=>[name,order[name]??''])),revision:record.revision,orderUpdatedAt:stamp(order),items,pendingCount,orderedCount:items.filter(item=>item.status==='ordered').length,notRequiredCount:items.filter(item=>item.status==='not_required').length,complete:pendingCount===0,canEdit:!closed(order),orderChanged:context(order)!==record.context||JSON.stringify(order.items.map(signature))!==JSON.stringify(record.items.map(signature))};
}
export function orderMaterialsQueue(store,actor){
 requireManager(store,actor);
 const orders=new Map(store.read('orders',[]).map(order=>[order.id,order]));
 const entries=store.read(indexKey,[]).flatMap(id=>{
  const order=orders.get(id),record=store.read(key(id),null);
  if(!order||!record||order.status==='cancelled')return [];
  const value=entry(order,record);return closed(order)&&!value.complete?[]:[value];
 });
 entries.sort((a,b)=>Number(b.order.urgent===true)-Number(a.order.urgent===true)||(a.order.requestedDeliveryDate||'9999').localeCompare(b.order.requestedDeliveryDate||'9999')||(a.order.createdAt||'').localeCompare(b.order.createdAt||'')||a.order.id.localeCompare(b.order.id));
 return {ok:true,entries};
}
function conflict(message,code){const error=new HttpError(409,message);error.code=code;throw error;}
export function updateOrderMaterials(store,id,body,actor){
 requireManager(store,actor);
 check(typeof body.mutationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.mutationId),'A materials update identifier is required');
 check(Array.isArray(body.updates)&&body.updates.length>0&&body.updates.length<=300,'Select between 1 and 300 items');
 check(body.updates.every(value=>value&&Number.isInteger(value.index)&&value.index>=0&&statuses.has(value.status))&&new Set(body.updates.map(value=>value.index)).size===body.updates.length,'Choose valid, distinct order items and material statuses');
 check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0&&typeof body.expectedOrderUpdatedAt==='string','Reload the materials list before making changes');
 const updates=body.updates.map(({index,status})=>({index,status})).sort((a,b)=>a.index-b.index),fingerprint=JSON.stringify({updates,expectedRevision:body.expectedRevision,expectedOrderUpdatedAt:body.expectedOrderUpdatedAt});
 return store.ctx.storage.transactionSync(()=>{
  const order=store.read('orders',[]).find(order=>order.id===id);check(order,'Order request not found',404);
  const record=store.read(key(id),null);check(record,'This order predates the materials list',404);
  const retry=record.mutations.find(value=>value.id===body.mutationId);
  if(retry){check(retry.actor===actor.username&&retry.fingerprint===fingerprint,'This update identifier belongs to different materials changes',409);return {ok:true,entry:entry(order,record),duplicate:true};}
  check(!closed(order),'Dispatched or cancelled orders cannot have materials changed',409);
  if(record.revision!==body.expectedRevision)conflict('Materials were updated by someone else. Reload the list before making changes.','MATERIALS_CONFLICT');
  if(stamp(order)!==body.expectedOrderUpdatedAt)conflict('The order changed. Reload the materials list before making changes.','ORDER_CONFLICT');
  const items=projectedItems(order,record);check(updates.every(value=>value.index<items.length),'An order item is no longer available');
  const now=new Date().toISOString(),changes=[];
  for(const update of updates){const item=items[update.index];if(item.status===update.status)continue;changes.push({index:item.index,quantity:item.quantity,description:item.description,previousStatus:item.status,status:update.status});Object.assign(item,{status:update.status,markedAt:now,markedBy:actor.username});}
  const next={...record,revision:record.revision+1,context:context(order),items:items.map(({index,...item})=>item),mutations:[...record.mutations,{id:body.mutationId,actor:actor.username,fingerprint}].slice(-40)};
  store.write(key(id),next);
  if(changes.length)store.audit(actor.username,'order-materials-updated',{orderId:id,orderNumber:order.orderNumber,revision:next.revision,changes});
  return {ok:true,entry:entry(order,next)};
 });
}
export function removeOrderMaterials(store,id){
 const ids=store.read(indexKey,[]);if(!ids.includes(id))return;
 store.sql.exec('DELETE FROM documents WHERE key=?',key(id));
 store.write(indexKey,ids.filter(value=>value!==id));
}
