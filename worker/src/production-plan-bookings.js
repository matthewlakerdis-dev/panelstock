import {requireCondition as check} from './security.js';

export const productionBookingStages=[
 ['stockOrder','Order stock'],['drawnCnc','Drawn / Toolpath'],['cnc','CNC'],['fabrication','Fabrication'],
 ['powderCoating','Powder coating · Send'],['powderPickup','Powder coating · Pickup']
];
const stageTypes={cnc:'cnc',powderPickup:'pickup'};
const exclusionKey=orderId=>'production-plan-booking-exclusions:'+orderId;

export function validateProductionBookingDefaults(input,people,previous={}){
 check(input&&typeof input==='object'&&!Array.isArray(input),'Invalid production booking defaults');
 const available=new Set(people.filter(person=>person.kind!=='vehicle').map(person=>person.username));
 return Object.fromEntries(Object.entries(input).map(([stage,rule])=>{
  check(productionBookingStages.some(([key])=>key===stage),'Invalid production booking task');
  check(rule&&(available.has(rule.username)||previous[stage]?.username===rule.username),'Select an active person for each production booking');
  check(Number.isInteger(rule.durationMinutes)&&rule.durationMinutes>=15&&rule.durationMinutes<=720,'Booking duration must be 15 to 720 minutes');
  return [stage,{username:rule.username,durationMinutes:rule.durationMinutes}];
 }));
}

const minutes=value=>{const [hours,mins]=value.split(':').map(Number);return hours*60+mins;};
const clock=value=>[Math.floor(value/60),value%60].map(part=>String(part).padStart(2,'0')).join(':');

function availableSlot(entries,date,username,duration,startHour,endHour){
 let start=startHour*60;
 const end=endHour*60;
 const occupied=entries.filter(entry=>entry.date===date&&entry.assignedUsername===username&&entry.status!=='cancelled')
  .map(entry=>[entry.startTime?minutes(entry.startTime):start,entry.endTime?minutes(entry.endTime):end])
  .sort(([a],[b])=>a-b);
 for(const [from,to] of occupied){
  if(start+duration<=from)break;
  start=Math.max(start,to);
 }
 return start+duration<=end?{startTime:clock(start),endTime:clock(start+duration)}:null;
}

export function syncProductionBookings(store,order,dates,actor,now){
 const settings=store.read('schedule-settings',{});
 const defaults=settings.productionBookingDefaults||{};
 const entries=store.read('schedule',[]);
 const current=entries.filter(entry=>entry.orderId===order.id&&entry.productionPlanStage);
 const savedExclusions=store.read(exclusionKey(order.id),[]);
 if(!current.length&&!Object.keys(defaults).length&&!savedExclusions.length)return false;
 const planned=new Map(dates.filter(row=>row.stage!=='siteDelivery').map(row=>[row.stage,row]));
 const excluded=savedExclusions.filter(stage=>planned.has(stage));
 if(excluded.length!==savedExclusions.length)store.write(exclusionKey(order.id),excluded);
 const slotsToFill=new Set();
 const next=entries.filter(entry=>{
  if(entry.orderId!==order.id||!entry.productionPlanStage||entry.productionPlanOverride||entry.status!=='planned')return true;
  const row=planned.get(entry.productionPlanStage);
  if(row?.date===entry.date)return true;
  slotsToFill.add(entry.productionPlanStage);
  return false;
 });
 const people=new Map(store.scheduleAllPeople().filter(person=>person.kind!=='vehicle'&&(!settings.visibleUsernames||settings.visibleUsernames.includes(person.username))).map(person=>[person.username,person]));
 const occupiedStages=new Set(next.filter(entry=>entry.orderId===order.id&&entry.productionPlanStage).map(entry=>entry.productionPlanStage));
 for(const [stage] of productionBookingStages){
  const row=planned.get(stage),rule=defaults[stage],person=people.get(rule?.username);
  if(!row||!person||excluded.includes(stage)||occupiedStages.has(stage))continue;
  const previous=slotsToFill.has(stage)?current.find(entry=>entry.productionPlanStage===stage):null;
  const slot=availableSlot(next,row.date,person.username,rule.durationMinutes,settings.startHour??6,settings.endHour??18);
  if(!slot)continue;
  next.push({
   id:previous?.id||crypto.randomUUID(),orderId:order.id,productionPlanStage:stage,
   projectId:order.projectId||'',project:order.project,title:(row.label+' · Order '+order.orderNumber).slice(0,160),
   date:row.date,...slot,assignedResourceType:'person',assignedUsername:person.username,assignedTo:person.displayName,
   status:'planned',scheduleType:stageTypes[stage]||'general',notes:'',
   createdAt:previous?.createdAt||now,createdBy:previous?.createdBy||actor.username,updatedAt:now,updatedBy:actor.username
  });
 }
 if(next.length===entries.length&&next.every((entry,index)=>entry===entries[index]))return false;
 store.write('schedule',next);
 return true;
}

export function excludeProductionBooking(store,entry){
 if(!entry.productionPlanStage)return;
 const key=exclusionKey(entry.orderId);
 const excluded=store.read(key,[]);
 if(!excluded.includes(entry.productionPlanStage))store.write(key,[...excluded,entry.productionPlanStage]);
}

export function removeProductionBookings(store,orderId){
 const entries=store.read('schedule',[]);
 const remaining=entries.filter(entry=>entry.orderId!==orderId||!entry.productionPlanStage);
 if(remaining.length!==entries.length)store.write('schedule',remaining);
 store.sql.exec('DELETE FROM documents WHERE key=?',exclusionKey(orderId));
}
