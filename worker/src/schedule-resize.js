import {requireCondition as check} from './security.js';
const mins=value=>{const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value||''));return match?Number(match[1])*60+Number(match[2]):null;};
const time=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
export function scheduleEntryTask(entry){
 return entry.scheduleType==='cnc'&&!entry.productionPlanStage?'schedule.cnc.manage':'schedule.manage';
}
export function resizeScheduleEntry(store,id,input,actor){
 const entries=store.read('schedule',[]),index=entries.findIndex(entry=>entry.id===id);check(index>=0,'Schedule entry not found',404);const previous=entries[index];
 store.requireTask(actor,scheduleEntryTask(previous));if(previous.assignedResourceType==='vehicle')store.requireTask(actor,'schedule.manage');
 check(['start','end'].includes(input.edge),'Choose a start or end edge');const next=mins(input.time);check(next!==null&&next%30===0,'The changed time must be on a 30-minute increment');
 check(typeof input.expectedUpdatedAt==='string'&&input.expectedUpdatedAt===(previous.updatedAt||previous.createdAt||''),'This booking changed. Refresh the schedule before resizing it',409);
 const settings=store.scheduleSettings(),start=mins(previous.startTime)??settings.startHour*60,end=mins(previous.endTime)??Math.min(settings.endHour*60,start+60),startTime=input.edge==='start'?next:start,endTime=input.edge==='end'?next:end;
 check(startTime>=settings.startHour*60&&endTime<=settings.endHour*60&&endTime-startTime>=30,'Keep the booking within working hours and at least 30 minutes long');
 if(startTime===start&&endTime===end)return {ok:true,unchanged:true,entry:previous,entries:store.scheduleEntriesFor(actor)};
 const now=new Date(Math.max(Date.now(),Date.parse(previous.updatedAt||previous.createdAt||'')+1||0)).toISOString(),entry={...previous,...(previous.productionPlanStage&&{productionPlanOverride:true}),startTime:time(startTime),endTime:time(endTime),updatedAt:now,updatedBy:actor.username};entries[index]=entry;
 store.ctx.storage.transactionSync(()=>{store.write('schedule',entries);store.notify([entry.assignedUsername].filter(value=>value&&!value.startsWith('vehicle:')),{title:'Schedule time changed',message:`${entry.date} · ${entry.title} · ${entry.startTime} – ${entry.endTime}`,kind:'schedule',priority:'important',link:'schedule'});store.audit(actor.username,'schedule-time-updated',{scheduleId:id,previousStart:previous.startTime,previousEnd:previous.endTime,startTime:entry.startTime,endTime:entry.endTime});});return {ok:true,entry,entries:store.scheduleEntriesFor(actor)};
}

export function moveScheduleEntry(store,id,input,actor){
 const entry=store.read('schedule',[]).find(row=>row.id===id);check(entry,'Schedule entry not found',404);
 store.requireTask(actor,scheduleEntryTask(entry));
 if(entry.assignedResourceType==='vehicle')store.requireTask(actor,'schedule.manage');
 check(typeof input.expectedUpdatedAt==='string'&&input.expectedUpdatedAt===(entry.updatedAt||entry.createdAt||''),'This booking changed. Refresh the schedule before moving it',409);
 const settings=store.scheduleSettings(),start=mins(input.startTime),end=mins(input.endTime),oldStart=mins(entry.startTime)??settings.startHour*60,oldEnd=mins(entry.endTime)??Math.min(settings.endHour*60,oldStart+60);
 check(start!==null&&end!==null&&start%30===0,'Move the booking in 30-minute increments');
 check(end-start===oldEnd-oldStart&&end>start,'Moving a booking must preserve its duration');
 check(start>=settings.startHour*60&&end<=settings.endHour*60,'Keep the booking within working hours');
 check(typeof input.date==='string'&&typeof input.assignedUsername==='string','Choose a date and person or vehicle');
 if(input.date===entry.date&&input.assignedUsername===entry.assignedUsername&&input.startTime===entry.startTime&&input.endTime===entry.endTime)return {status:200,body:{ok:true,unchanged:true,entry,entries:store.scheduleEntriesFor(actor)}};
 return store.updateScheduleEntry(id,{...entry,date:input.date,startTime:input.startTime,endTime:input.endTime,assignedUsername:input.assignedUsername},actor);
}
