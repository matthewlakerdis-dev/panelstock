import leadTimes from '../../order-lead-times.js';
import {orderTypes} from './order-types.js';
import {HttpError,requireCondition as check} from './security.js';

export function orderLeadTimes(store){
 const saved=store.read('order-lead-times',{}),types=orderTypes(store);
 return {basis:'working_days',days:Object.fromEntries(types.map(type=>[type,leadTimes.daysFor(saved,type)])),updatedAt:saved.updatedAt||''};
}
export function setOrderLeadTimes(store,body,actor){
 check(actor.isAdmin===true,'Admin access required',403);
 check(body.basis===undefined||body.basis==='working_days','Lead times use working days (Monday–Friday)');
 check(body.days&&typeof body.days==='object'&&!Array.isArray(body.days),'Enter minimum lead days for each order type');
 return store.ctx.storage.transactionSync(()=>{
  const current=orderLeadTimes(store),types=orderTypes(store);
  check(body.expectedUpdatedAt===current.updatedAt,'Lead times changed. Reload the settings before saving.',409);
  const days=Object.fromEntries(types.map(type=>[type,current.days[type]]));
  for(const [type,value] of Object.entries(body.days)){
   check(types.includes(type),'Unknown order type: '+type);
   check(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=365,'Minimum lead time must be a whole number from 0 to 365 days');
   days[type]=value;
  }
  for(const type of types)if(!Object.hasOwn(days,type))days[type]=current.days[type];
  const updatedAt=new Date(Math.max(Date.now(),Date.parse(current.updatedAt||'')+1||0)).toISOString(),settings={basis:'working_days',days,updatedAt};
  store.write('order-lead-times',settings);store.audit(actor.username,'order-lead-times-updated',{basis:settings.basis,days});
  return {ok:true,leadTimes:settings};
 });
}
export function checkOrderLeadTime(store,type,date,previous,now){
 if(previous&&previous.orderType===type&&previous.requestedDeliveryDate===date)return;
 const message=leadTimes.error(orderLeadTimes(store),type,date,leadTimes.today(now));
 if(message){const error=new HttpError(400,message);error.code='ORDER_LEAD_TIME';throw error;}
}
