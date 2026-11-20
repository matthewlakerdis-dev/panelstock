import {syncProductionBookings,removeProductionBookings} from './production-plan-bookings.js';
import leadTimes from '../../order-lead-times.js';
import {HttpError,requireCondition as check} from './security.js';
import {scheduleOrderDelivery} from './order-delivery.js';
import {isGateType} from './order-types.js';
import {matchesSiteOrder} from './site-orders-excel.js';
import {panelRequiresPowderCoating} from './panel-dispatch.js';

export const PLAN_STAGES=[['stockOrder','Order stock'],['drawnCnc','Drawn / Toolpath'],['cnc','CNC'],['fabrication','Fabrication'],['powderCoating','Powder coating']];
const legacyStages=PLAN_STAGES.filter(([name])=>name!=='cnc');
const emptyStage={date:'',notApplicable:false,notes:''};
const key=id=>'production-plan:'+id;
const editable=actor=>actor.isAdmin===true||actor.tasks?.['schedule.manage']===true;
const closed=order=>['dispatched','cancelled'].includes(order.status);
const stamp=order=>order.updatedAt||order.createdAt||'';
export const defaultPowderCoatingWorkingDays=5;
export const validPowderCoatingWorkingDays=value=>Number.isInteger(value)&&value>=1&&value<=365;
const powderCoatingDays=value=>validPowderCoatingWorkingDays(value)?value:defaultPowderCoatingWorkingDays;
export const powderPickupDate=(sendDate,days)=>sendDate?leadTimes.minimumDate({days:{powderCoating:powderCoatingDays(days)}},'powderCoating',sendDate):'';
const configuredPowderCoatingDays=store=>powderCoatingDays(store.read('schedule-settings',{}).powderCoatingWorkingDays);
function findOrder(store,id){const order=store.read('orders',[]).find(row=>row.id===id);check(order,'Order request not found',404);return order;}
function orderInfo(order){return Object.fromEntries(['id','orderNumber','projectId','project','orderType','status','requestedDeliveryDate','requestedDeliveryTime','scheduledDeliveryDate','scheduledDeliveryTime','updatedAt','createdAt'].map(name=>[name,order[name]??'']));}
function storedPlan(store,id){return store.read(key(id),null);}
const normalized=value=>String(value||'').trim().toLowerCase();
function coatingContext(store){return {panels:store.read('app:cncPanels',[]),stock:[...store.read('app:variants',[]),...store.read('app:offcuts',[]),...store.read('app:catalog',[])]};}
function coatingFor(order,plan,context){
 if(normalized(order.orderType)!=='panels')return null;
 const panels=context.panels.filter(panel=>matchesSiteOrder(order,panel));
 const knownFinish=panel=>{const id=panel.stockItemId||panel.stockVariantId,item=context.stock.find(row=>id&&row.id===id)||context.stock.find(row=>panel.stockSku&&row.sku===panel.stockSku);return !!String(item?.color??panel.stockColor??panel.color??'').trim();};
 const needsCoating=panels.some(panel=>panelRequiresPowderCoating(panel,context.stock));
 if(needsCoating||panels.length&&panels.every(knownFinish))return {required:needsCoating,selection:needsCoating?'required':'already_coated',source:'stock',canChoose:false};
 const selection=plan?.panelCoating==='already_coated'?'already_coated':'required';
 return {required:selection==='required',selection,source:plan?.panelCoating?'plan':'default',canChoose:true};
}
export function productionPlanStages(order,coating){
 if(normalized(order.orderType)==='panels')return PLAN_STAGES.filter(([name])=>name!=='powderCoating'||coating?.required!==false);
 if(isGateType(order.orderType))return PLAN_STAGES.filter(([name])=>name!=='powderCoating'&&name!=='cnc').map(([name,label])=>[name,name==='drawnCnc'?'Drawn':label]);
 return [['stockOrder','Order']];
}
// Return every stage key so cached clients can still read their expected rows.
function projectedStages(value,definitions){const allowed=new Set(definitions.map(([name])=>name));return Object.fromEntries(PLAN_STAGES.map(([name])=>{const row=value?.stages?.[name];return [name,allowed.has(name)?{date:row?.date||'',notApplicable:row?.notApplicable===true,notes:row?.notes||'',assignedUsername:''}:{date:'',notApplicable:true,notes:'',assignedUsername:''}];}));}
function publicPlan(value,definitions){const stages=projectedStages(value,definitions);return {revision:value?.revision||0,stages,panelCoating:value?.panelCoating||'required',powderCoatingWorkingDays:powderCoatingDays(value?.powderCoatingWorkingDays),powderPickupDate:powderPickupDate(stages.powderCoating.date,value?.powderCoatingWorkingDays),createdAt:value?.createdAt||'',createdBy:value?.createdBy||'',updatedAt:value?.updatedAt||'',updatedBy:value?.updatedBy||''};}
export function getProductionPlan(store,id,actor){
 store.requireTask(actor,'site.orders.view');const order=findOrder(store,id),saved=storedPlan(store,id),context=coatingContext(store),coating=coatingFor(order,saved,context),stageDefinitions=productionPlanStages(order,coating);
 return {ok:true,order:orderInfo(order),plan:publicPlan(saved,stageDefinitions),summary:productionPlanSummary(order,saved,context),configuredPowderCoatingWorkingDays:configuredPowderCoatingDays(store),stageDefinitions,coating,canEdit:editable(actor)&&!closed(order),canScheduleDelivery:actor.isAdmin===true&&!closed(order),people:[]};
}
// Older dialogs render every returned definition but have no draft field for CNC.
export function legacyProductionPlanView(result){
 const {cnc,...stages}=result.plan.stages;
 return {...result,plan:{...result.plan,stages},stageDefinitions:result.stageDefinitions.filter(([name])=>name!=='cnc')};
}
function normalizeStages(input){
 check(input&&typeof input==='object'&&!Array.isArray(input),'Enter production plan dates');
 const definitions=Object.hasOwn(input,'cnc')?PLAN_STAGES:legacyStages;
 check(Object.keys(input).length===definitions.length&&definitions.every(([name])=>Object.hasOwn(input,name)),'Use the current production plan stages');
 return Object.fromEntries(definitions.map(([name,label])=>{
  const value=input[name];check(value&&typeof value==='object'&&!Array.isArray(value),'Invalid '+label+' plan');
  check(typeof value.date==='string'&&(!value.date||leadTimes.dateValue(value.date)),'Choose a valid '+label+' date');
  check(typeof value.notApplicable==='boolean','Choose whether '+label+' applies');
  check(typeof value.notes==='string'&&value.notes.length<=500,'Plan notes must be 500 characters or fewer');
  check(!value.notApplicable||!value.date,'Clear the date for stages marked N/A');
  return [name,{date:value.date,notApplicable:value.notApplicable,notes:value.notes.trim()}];
 }));
}
function conflict(message,code='PLAN_CONFLICT'){const error=new HttpError(409,message);error.code=code;throw error;}
export function saveProductionPlan(store,id,body,actor){
 store.requireTask(actor,'site.orders.view');check(editable(actor),'Production plan management requires schedule access',403);
 const order=findOrder(store,id);
 check(typeof body.mutationId==='string'&&/^[a-f0-9-]{36}$/i.test(body.mutationId),'A plan save identifier is required');
 const previous=storedPlan(store,id),submittedStages=normalizeStages(body.stages);
 check(body.panelCoating==null||['required','already_coated'].includes(body.panelCoating),'Choose whether Panels need powder coating');
 const panelCoating=body.panelCoating??previous?.panelCoating??'required',coating=coatingFor(order,{panelCoating},coatingContext(store)),definitions=productionPlanStages(order,coating),allowed=new Set(definitions.map(([name])=>name));
 const fallbackStages={cnc:allowed.has('cnc')?emptyStage:{...emptyStage,notApplicable:true}};
 const previousStages=previous?normalizeStages({...fallbackStages,...previous.stages}):null;
 const stages=Object.fromEntries(PLAN_STAGES.map(([name])=>[
  name,allowed.has(name)?submittedStages[name]??previousStages?.[name]??emptyStage:{...emptyStage,notApplicable:true}
 ]));
 const deliveryDate=body.scheduledDeliveryDate??order.scheduledDeliveryDate??'',deliveryTime=body.scheduledDeliveryTime??order.scheduledDeliveryTime??'';
 check(typeof deliveryDate==='string'&&(!deliveryDate||leadTimes.dateValue(deliveryDate)),'Choose a valid scheduled delivery date');
 check(typeof deliveryTime==='string'&&(!deliveryTime||/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime)),'Choose a valid scheduled delivery time');
 const desiredTime=deliveryDate?deliveryTime:'',fingerprint=JSON.stringify({stages:submittedStages,panelCoating:body.panelCoating??null,scheduledDeliveryDate:deliveryDate,scheduledDeliveryTime:desiredTime}),retry=previous?.mutations?.find(value=>value.id===body.mutationId);
 // Keep exact retries from the previous client valid after this release.
 const assignedStages=Object.fromEntries(Object.keys(submittedStages).map(name=>[name,{date:submittedStages[name].date,notApplicable:submittedStages[name].notApplicable,assignedUsername:body.stages[name].notApplicable?'':body.stages[name].assignedUsername||'',notes:submittedStages[name].notes}]));
 const legacyFingerprint=JSON.stringify({stages:assignedStages,scheduledDeliveryDate:deliveryDate,scheduledDeliveryTime:desiredTime});
 if(retry){check(retry.fingerprint===fingerprint||body.panelCoating==null&&retry.fingerprint===legacyFingerprint,'This save identifier belongs to different plan changes',409);return {...getProductionPlan(store,id,actor),duplicate:true};}
 check(!closed(order),'Dispatched or cancelled orders cannot be replanned',409);
 const deliveryChanged=deliveryDate!==(order.scheduledDeliveryDate||'')||desiredTime!==(order.scheduledDeliveryTime||'');
 check(!deliveryChanged||actor.isAdmin===true,'Only admins can change scheduled delivery',403);
 if(body.expectedRevision!==(previous?.revision||0))conflict('The production plan changed. Reload it before saving. Your changes have not been saved.');
 if(body.expectedOrderUpdatedAt!==stamp(order))conflict('The order changed. Reload the production plan before saving. Your changes have not been saved.','ORDER_CONFLICT');
 const powderCoatingWorkingDays=allowed.has('powderCoating')?configuredPowderCoatingDays(store):powderCoatingDays(previous?.powderCoatingWorkingDays);
 const sameStages=previous&&powderCoatingWorkingDays===powderCoatingDays(previous.powderCoatingWorkingDays)&&JSON.stringify(stages)===JSON.stringify(previousStages)&&panelCoating===(previous.panelCoating||'required');
 const now=new Date(Math.max(Date.now(),Date.parse(previous?.updatedAt||'')+1||0)).toISOString();
 const plan={version:2,panelCoating,powderCoatingWorkingDays,revision:(previous?.revision||0)+1,stages,createdAt:previous?.createdAt||now,createdBy:previous?.createdBy||actor.username,updatedAt:now,updatedBy:actor.username,mutations:[...(previous?.mutations||[]),{id:body.mutationId,fingerprint}].slice(-20)};
 const syncBookings=(current=order)=>syncProductionBookings(store,current,productionPlanDates(current,plan,coatingContext(store)),actor,now);
 const persistPlan=()=>{store.write(key(id),plan);const ids=store.read('production-plan-index',[]);if(!ids.includes(id))store.write('production-plan-index',[...ids,id]);store.audit(actor.username,'order-production-plan-updated',{orderId:id,revision:plan.revision,stages:Object.fromEntries(PLAN_STAGES.map(([name])=>[name,{date:stages[name].date,notApplicable:stages[name].notApplicable}])),powderPickupDate:powderPickupDate(stages.powderCoating.date,powderCoatingWorkingDays)});};
 if(sameStages&&!deliveryChanged){
  const booked=store.ctx.storage.transactionSync(()=>{
   const changed=syncBookings();
   if(changed)persistPlan();
   return changed;
  });
  return {...getProductionPlan(store,id,actor),...(!booked&&{unchanged:true})};
 }
 const persist=current=>{syncBookings(current);persistPlan();};
 if(deliveryChanged){const result=scheduleOrderDelivery(store,id,{expectedUpdatedAt:body.expectedOrderUpdatedAt,scheduledDeliveryDate:deliveryDate,scheduledDeliveryTime:desiredTime},actor,persist);if(!result.ok)conflict(result.error,'ORDER_CONFLICT');}
 else store.ctx.storage.transactionSync(persist);
 return getProductionPlan(store,id,actor);
}
export function removeProductionPlan(store,id){
 if(!storedPlan(store,id))return;
 removeProductionBookings(store,id);
 store.sql.exec('DELETE FROM documents WHERE key=?',key(id));
 store.write('production-plan-index',store.read('production-plan-index',[]).filter(value=>value!==id));
}
export function productionPlanDates(order,plan,context={panels:[],stock:[]}){
 if(!plan)return [];
 const dates=productionPlanStages(order,coatingFor(order,plan,context)).flatMap(([stage,label])=>{const item=plan.stages[stage];if(!item?.date||item.notApplicable)return [];const rows=[{stage,label:stage==='powderCoating'?'Powder coating · Send':label,date:item.date,assignedUsername:'',notes:item.notes}];if(stage==='powderCoating')rows.push({stage:'powderPickup',label:'Powder coating · Pickup',date:powderPickupDate(item.date,plan.powderCoatingWorkingDays),assignedUsername:'',notes:item.notes});return rows;});
 if(order.scheduledDeliveryDate)dates.push({stage:'siteDelivery',label:'Schedule delivery',date:order.scheduledDeliveryDate,assignedUsername:'',notes:''});
 return dates.sort((a,b)=>a.date.localeCompare(b.date)||a.stage.localeCompare(b.stage));
}
export function productionPlanSummary(order,plan,context={panels:[],stock:[]}){
 const stages=projectedStages(plan,productionPlanStages(order,coatingFor(order,plan,context)));
 const milestones=productionPlanStages(order,coatingFor(order,plan,context)).flatMap(([stage,label])=>{
  const row=stages[stage],date=row.notApplicable?'':row.date;
  return [{stage,label:stage==='powderCoating'?'Powder coating · Send':label,date},...(stage==='powderCoating'?[{stage:'powderPickup',label:'Powder coating · Pickup',date:powderPickupDate(date,plan?.powderCoatingWorkingDays)}]:[])];
 });
 return {revision:plan?.revision||0,dateCount:productionPlanDates(order,plan,context).length,powderPickupDate:milestones.find(row=>row.stage==='powderPickup')?.date||'',updatedAt:plan?.updatedAt||'',milestones};
}
export function productionPlanSummaries(store,orders){
 const context=coatingContext(store);
 // Unplanned orders need the same stage slots, with blank dates, without creating a plan.
 return Object.fromEntries(orders.map(order=>[order.id,productionPlanSummary(order,storedPlan(store,order.id),context)]));
}
export function productionPlanSchedule(store,actor){
 if(!(actor.isAdmin||actor.tasks?.['schedule.view'])||!(actor.isAdmin||actor.tasks?.['site.orders.view']))return [];
 const orders=new Map(store.read('orders',[]).map(order=>[order.id,order])),context=coatingContext(store);
 const booked=new Map(),visible=store.read('schedule-settings',{}).visibleUsernames;
 for(const entry of store.read('schedule',[])){
  if(!entry.productionPlanStage||entry.status==='cancelled'||visible&&!visible.includes(entry.assignedUsername))continue;
  booked.set(key(entry.orderId)+':'+entry.productionPlanStage,entry);
 }
 return store.read('production-plan-index',[]).flatMap(id=>{const order=orders.get(id);if(!order||closed(order))return [];return productionPlanDates(order,storedPlan(store,id),context).map(row=>({...row,id:'production-plan:'+id+':'+row.stage,orderId:id,orderNumber:order.orderNumber,project:order.project,projectId:order.projectId||'',orderType:order.orderType,assignedTo:'',bookingId:booked.get(key(id)+':'+row.stage)?.id||''}));}).sort((a,b)=>a.date.localeCompare(b.date)||a.project.localeCompare(b.project)||a.orderNumber.localeCompare(b.orderNumber));
}
