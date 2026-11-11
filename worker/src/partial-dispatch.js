import {requireCondition as check} from './security.js';
import {orderConflict,nextOrderStamp,notifyOrderChange} from './order-updates.js';

export function dispatchBalances(order){
 return (order.items||[]).map((item,index)=>{
  const quantity=Number(item.quantity),rawDispatched=Array.isArray(order.dispatches)?order.dispatches.reduce((total,trip)=>total+(trip.lines||[]).filter(line=>line.index===index).reduce((sum,line)=>sum+Number(line.quantity||0),0),0):order.status==='dispatched'?quantity:0;
  const dispatched=Number(rawDispatched.toPrecision(15));
  return {index,description:item.description,quantity,dispatched,remaining:Math.max(0,Number((quantity-dispatched).toPrecision(15)))};
 });
}
function requestLines(value){
 if(value===undefined)return null;
 check(Array.isArray(value)&&value.length>0&&value.length<=300,'Choose at least one delivery item');
 const seen=new Set();return value.map(line=>{
  check(line&&Number.isInteger(line.index)&&line.index>=0&&!seen.has(line.index),'Invalid or duplicate delivery item');seen.add(line.index);
  check(typeof line.quantity==='number'&&Number.isFinite(line.quantity)&&line.quantity>0,'Delivery quantities must be greater than zero');
  return {index:line.index,quantity:line.quantity};
 }).sort((a,b)=>a.index-b.index);
}
export function dispatchQuantities(store,previous,body,actor,details,ready){
 const requested=requestLines(body.lines),fingerprint=JSON.stringify({details,lines:requested}),existing=(previous.dispatches||[]).find(trip=>trip.mutationId===body.mutationId);
 if(existing){check(existing.by===actor.username&&existing.fingerprint===fingerprint,'This delivery request was already used with different items or details',409);return {ok:true,idempotent:true,order:previous};}
 check(!(previous.dispatchReversals||[]).some(record=>(record.dispatches||[]).some(trip=>trip.mutationId===body.mutationId)),'This delivery was reversed. Start a new dispatch request',409);
 const conflict=orderConflict(previous,body);if(conflict)return conflict;
 check(ready,'Only orders ready for dispatch can be dispatched',409);
 check((previous.dispatches||[]).length<200,'Delivery history is full; contact an administrator',409);
 const balances=dispatchBalances(previous),selected=requested||balances.filter(line=>line.remaining>0).map(line=>({index:line.index,quantity:line.remaining}));
 check(selected.length>0,'No items remain to dispatch',409);
 const lines=selected.map(line=>{const item=balances[line.index];check(item&&line.quantity<=item.remaining,'Delivery quantity exceeds the remaining quantity',409);return {...line,description:item.description};});
 const now=nextOrderStamp(previous),trip={...details,mutationId:body.mutationId,by:actor.username,at:now,lines,fingerprint};
 const dispatches=[...(previous.dispatches||[]),trip],allSent=dispatchBalances({...previous,dispatches}).every(line=>line.remaining===0);
 const current={...previous,dispatches,dispatch:trip,status:allSent?'dispatched':previous.status,updatedAt:now,updatedBy:actor.username,...(allSent?{dispatchedAt:now,dispatchedBy:actor.username}:{})};
 const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===previous.id);check(index>=0,'Order not found',404);orders[index]=current;
 store.ctx.storage.transactionSync(()=>{
  store.write('orders',orders);notifyOrderChange(store,previous,current,actor);
  store.audit(actor.username,'order-dispatched',{orderId:current.id,orderNumber:current.orderNumber,project:current.project,status:current.status,partial:!allSent,lines,...details});
  if(!allSent&&current.requestedBy&&current.requestedBy!==actor.username)store.notify([current.requestedBy],{title:`Order #${current.orderNumber}: part dispatched`,message:`${current.project} · ${lines.map(line=>line.quantity+' × '+line.description).join('; ')} · More items remain to be sent`,kind:'orders',priority:'important',link:'orders',orderId:current.id});
 });
 return {ok:true,order:current,partial:!allSent};
}
