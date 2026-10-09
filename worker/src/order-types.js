import {requireCondition as check} from './security.js';
export const DEFAULT_ORDER_TYPES=['Panels','Fixings','Plant / Equipment','Other'];
const clean=value=>String(value??'').trim().replace(/\s+/g,' ');
export function orderTypes(store){return [...DEFAULT_ORDER_TYPES,...store.read('order-types',[])].filter((name,index,all)=>all.findIndex(value=>value.toLowerCase()===name.toLowerCase())===index);}
export function selectOrderType(store,value,previous){
 const name=clean(value)||'Other',found=orderTypes(store).find(type=>type.toLowerCase()===name.toLowerCase());
 check(found||previous===name,'Choose an available order type. Ask an administrator to add a new type.');
 return found||name;
}
export function addOrderType(store,body,actor){
 check(actor.isAdmin===true,'Admin access required',403);
 check(typeof body.name==='string','Enter an order type');
 const name=clean(body.name);check(name.length>0&&name.length<=80&&!/[\u0000-\u001f\u007f]/.test(name),'Enter an order type of 1 to 80 characters');
 return store.ctx.storage.transactionSync(()=>{
  const current=orderTypes(store);check(!current.some(type=>type.toLowerCase()===name.toLowerCase()),'This order type already exists',409);check(current.length<100,'A maximum of 100 order types is supported');
  store.write('order-types',[...store.read('order-types',[]),name]);store.audit(actor.username,'order-type-added',{name});
  return {ok:true,orderTypes:orderTypes(store)};
 });
}

export function otherOrderType(value,type){
 if(String(type).toLowerCase()!=='other')return '';
 check(value==null||typeof value==='string','Other order type must be text');
 const detail=clean(value);check(detail.length<=80&&!/[\u0000-\u001f\u007f]/.test(detail),'Please specify the order type in 80 characters or fewer');return detail;
}
export function orderTypeLabel(order){return String(order.orderType).toLowerCase()==='other'&&order.orderTypeOther?`Other: ${order.orderTypeOther}`:order.orderType;}
