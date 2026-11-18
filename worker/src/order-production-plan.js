import leadTimes from '../../order-lead-times.js';
import {HttpError,requireCondition as check} from './security.js';
import {scheduleOrderDelivery} from './order-delivery.js';

export const PLAN_STAGES=[['stockOrder','Order stock'],['drawnCnc','Drawn / Toolpath / CNC'],['fabrication','Fabrication'],['powderCoating','Powder coating']];
const key=id=>'production-plan:'+id;
const editable=actor=>actor.isAdmin===true||actor.tasks?.['schedule.manage']===true;
const closed=order=>['dispatched','cancelled'].includes(order.status);
const stamp=order=>order.updatedAt||order.createdAt||'';
const blankStages=()=>Object.fromEntries(PLAN_STAGES.map(([name])=>[name,{date:'',notApplicable:false,assignedUsername:'',notes:''}]));
export const powderPickupDate=sendDate=>sendDate?leadTimes.minimumDate({days:{powderCoating:5}},'powderCoating',sendDate):'';
function findOrder(store,id){const order=store.read('orders',[]).find(row=>row.id===id);check(order,'Order request not found',404);return order;}
function orderInfo(order){return Object.fromEntries(['id','orderNumber','projectId','project','orderType','status','requestedDeliveryDate','requestedDeliveryTime','scheduledDeliveryDate','scheduledDeliveryTime','updatedAt','createdAt'].map(name=>[name,order[name]??'']));}
function storedPlan(store,id){return store.read(key(id),null);}
function people(store){return store.scheduleAllPeople().filter(person=>person.kind!=='vehicle').map(({username,displayName})=>({username,displayName}));}
function publicPlan(value){return value?{revision:value.revision,stages:value.stages,powderPickupDate:powderPickupDate(value.stages.powderCoating.date),createdAt:value.createdAt,createdBy:value.createdBy,updatedAt:value.updatedAt,updatedBy:value.updatedBy}:{revision:0,stages:blankStages(),powderPickupDate:'',updatedAt:'',updatedBy:''};}
export function getProductionPlan(store,id,actor){
 store.requireTask(actor,'site.orders.view');const order=findOrder(store,id);
 const plan=publicPlan(storedPlan(store,id)),assigned=new Set(Object.values(plan.stages).map(row=>row.assignedUsername));
 return {ok:true,order:orderInfo(order),plan,canEdit:editable(actor)&&!closed(order),canScheduleDelivery:actor.isAdmin===true&&!closed(order),people:people(store).filter(person=>editable(actor)||assigned.has(person.username))};
}
function normalizeStages(input,available){
 check(input&&typeof input==='object'&&!Array.isArray(input),'Enter production plan dates');
 check(Object.keys(input).length===PLAN_STAGES.length&&PLAN_STAGES.every(([name])=>Object.hasOwn(input,name)),'Use the current production plan stages');
 return Object.fromEntries(PLAN_STAGES.map(([name,label])=>{
  const value=input[name];check(value&&typeof value==='object'&&!Array.isArray(value),'Invalid '+label+' plan');
  check(typeof value.date==='string'&&(!value.date||leadTimes.dateValue(value.date)),'Choose a valid '+label+' date');
  check(typeof value.notApplicable==='boolean','Choose whether '+label+' applies');
  check(typeof value.assignedUsername==='string'&&value.assignedUsername.length<=80,'Choose a responsible person');
  check(!available||!value.assignedUsername||available.some(person=>person.username===value.assignedUsername),'Choose an active responsible person');
  check(typeof value.notes==='string'&&value.notes.length<=500,'Plan notes must be 500 characters or fewer');
  check(!value.notApplicable||!value.date,'Clear the date for stages marked N/A');
  return [name,{date:value.date,notApplicable:value.notApplicable,assignedUsername:value.notApplicable?'':value.assignedUsername,notes:value.notes.trim()}];
 }));
}
function conflict(message,code='PLAN_CONFLICT'){const error=new HttpError(409,message);error.code=code;throw error;}
export function saveProductionPlan(store,id,body,actor){
 store.requireTask(actor,'site.orders.view');check(editable(actor),'Production plan management requires schedule access',403);
 const order=findOrder(store,id);
 check(typeof body.mutationId==='string'&&/^[a-f0-9-]{36}$/i.test(body.mutationId),'A plan save identifier is required');
 const previous=storedPlan(store,id),stages=normalizeStages(body.stages,null);
 const deliveryDate=body.scheduledDeliveryDate??order.scheduledDeliveryDate??'',deliveryTime=body.scheduledDeliveryTime??order.scheduledDeliveryTime??'';
 check(typeof deliveryDate==='string'&&(!deliveryDate||leadTimes.dateValue(deliveryDate)),'Choose a valid scheduled delivery date');
 check(typeof deliveryTime==='string'&&(!deliveryTime||/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime)),'Choose a valid scheduled delivery time');
 const desiredTime=deliveryDate?deliveryTime:'',fingerprint=JSON.stringify({stages,scheduledDeliveryDate:deliveryDate,scheduledDeliveryTime:desiredTime}),retry=previous?.mutations?.find(value=>value.id===body.mutationId);
 if(retry){check(retry.fingerprint===fingerprint,'This save identifier belongs to different plan changes',409);return {...getProductionPlan(store,id,actor),duplicate:true};}
 check(!closed(order),'Dispatched or cancelled orders cannot be replanned',409);
 normalizeStages(stages,people(store));
 const deliveryChanged=deliveryDate!==(order.scheduledDeliveryDate||'')||desiredTime!==(order.scheduledDeliveryTime||'');
 check(!deliveryChanged||actor.isAdmin===true,'Only admins can change scheduled delivery',403);
 if(body.expectedRevision!==(previous?.revision||0))conflict('The production plan changed. Reload it before saving. Your changes have not been saved.');
 if(body.expectedOrderUpdatedAt!==stamp(order))conflict('The order changed. Reload the production plan before saving. Your changes have not been saved.','ORDER_CONFLICT');
 const sameStages=previous&&JSON.stringify(stages)===JSON.stringify(previous.stages);
 const now=new Date(Math.max(Date.now(),Date.parse(previous?.updatedAt||'')+1||0)).toISOString();
 const plan={version:1,revision:(previous?.revision||0)+1,stages,createdAt:previous?.createdAt||now,createdBy:previous?.createdBy||actor.username,updatedAt:now,updatedBy:actor.username,mutations:[...(previous?.mutations||[]),{id:body.mutationId,fingerprint}].slice(-20)};
 const persist=()=>{store.write(key(id),plan);const ids=store.read('production-plan-index',[]);if(!ids.includes(id))store.write('production-plan-index',[...ids,id]);store.audit(actor.username,'order-production-plan-updated',{orderId:id,revision:plan.revision,stages:Object.fromEntries(PLAN_STAGES.map(([name])=>[name,{date:stages[name].date,notApplicable:stages[name].notApplicable}])),powderPickupDate:powderPickupDate(stages.powderCoating.date)});};
 if(sameStages&&!deliveryChanged)return {...getProductionPlan(store,id,actor),unchanged:true};
 if(deliveryChanged){const result=scheduleOrderDelivery(store,id,{expectedUpdatedAt:body.expectedOrderUpdatedAt,scheduledDeliveryDate:deliveryDate,scheduledDeliveryTime:desiredTime},actor,persist);if(!result.ok)conflict(result.error,'ORDER_CONFLICT');}
 else store.ctx.storage.transactionSync(persist);
 return getProductionPlan(store,id,actor);
}
export function removeProductionPlan(store,id){
 if(!storedPlan(store,id))return;
 store.sql.exec('DELETE FROM documents WHERE key=?',key(id));
 store.write('production-plan-index',store.read('production-plan-index',[]).filter(value=>value!==id));
}
export function productionPlanDates(order,plan){
 if(!plan)return [];
 const dates=PLAN_STAGES.flatMap(([stage,label])=>{const item=plan.stages[stage];if(!item?.date||item.notApplicable)return [];const rows=[{stage,label:stage==='powderCoating'?'Powder coating · Send':label,date:item.date,assignedUsername:item.assignedUsername,notes:item.notes}];if(stage==='powderCoating')rows.push({stage:'powderPickup',label:'Powder coating · Pickup',date:powderPickupDate(item.date),assignedUsername:item.assignedUsername,notes:item.notes});return rows;});
 if(order.scheduledDeliveryDate)dates.push({stage:'siteDelivery',label:'Site delivery',date:order.scheduledDeliveryDate,assignedUsername:'',notes:''});
 return dates.sort((a,b)=>a.date.localeCompare(b.date)||a.stage.localeCompare(b.stage));
}
export function productionPlanSummaries(store,orders){
 const available=new Map(orders.map(order=>[order.id,order]));
 return Object.fromEntries(store.read('production-plan-index',[]).flatMap(id=>{const order=available.get(id),plan=order&&storedPlan(store,id);if(!plan)return [];const dates=productionPlanDates(order,plan);return [[id,{revision:plan.revision,dateCount:dates.length,powderPickupDate:powderPickupDate(plan.stages.powderCoating.date),updatedAt:plan.updatedAt}]];}));
}
export function productionPlanSchedule(store,actor){
 if(!(actor.isAdmin||actor.tasks?.['schedule.view'])||!(actor.isAdmin||actor.tasks?.['site.orders.view']))return [];
 const orders=new Map(store.read('orders',[]).map(order=>[order.id,order])),names=new Map(people(store).map(person=>[person.username,person.displayName]));
 return store.read('production-plan-index',[]).flatMap(id=>{const order=orders.get(id);if(!order||closed(order))return [];return productionPlanDates(order,storedPlan(store,id)).map(row=>({...row,id:'production-plan:'+id+':'+row.stage,orderId:id,orderNumber:order.orderNumber,project:order.project,projectId:order.projectId||'',orderType:order.orderType,assignedTo:names.get(row.assignedUsername)||''}));}).sort((a,b)=>a.date.localeCompare(b.date)||a.project.localeCompare(b.project)||a.orderNumber.localeCompare(b.orderNumber));
}
