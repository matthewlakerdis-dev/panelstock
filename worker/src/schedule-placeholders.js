import {requireCondition as check,normalizeUsername} from './security.js';
const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
export function createSchedulePlaceholders(store,input,actor){
 store.requireTask(actor,'schedule.manage');
 check(typeof input.placeholderBatchId==='string'&&/^[a-f0-9-]{36}$/i.test(input.placeholderBatchId),'Reopen the planned task form and try again');
 const first=input.date,last=input.endDate||first;check(validDate(first)&&validDate(last)&&first<=last,'Choose a valid first and last day');
 const span=(Date.parse(last)-Date.parse(first))/86400000+1;check(span<=31,'Book up to 31 days at a time');
 check(input.assignedUsernames===undefined||Array.isArray(input.assignedUsernames),'Select the people to reserve');const raw=input.assignedUsernames||[input.assignedUsername];check(raw.every(value=>typeof value==='string'),'Select the people to reserve');
 const usernames=[...new Set(raw.map(normalizeUsername).filter(Boolean))].sort();check(usernames.length>0&&usernames.length<=50,'Select between 1 and 50 people');check(!usernames.some(value=>value.startsWith('vehicle:')),'Planned tasks reserve people; book vehicles separately');
 const weekdays=store.scheduleSettings().visibleWeekdays,dates=[];
 for(let offset=0;offset<span;offset++){const date=new Date(first+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+offset);if(input.includeNonWorkingDays===true||weekdays.includes(date.getUTCDay()))dates.push(date.toISOString().slice(0,10));}
 check(dates.length>0,'There are no selected working days in this range. Change the dates or include hidden days');check(dates.length*usernames.length<=500,'Book up to 500 person-days at a time');
 const drafts=usernames.map(assignedUsername=>store.scheduleValue({...input,isPlaceholder:true,assignedUsername,date:first}));
 const fingerprint=JSON.stringify({drafts,dates}),key='schedule-placeholder-batch:'+actor.username+':'+input.placeholderBatchId,previous=store.read(key,null);
 if(previous){check(previous.fingerprint===fingerprint,'This planned task request changed after saving. Refresh the schedule before creating another reservation',409);return {ok:true,duplicate:true,createdCount:previous.entryIds.length,entries:store.scheduleEntriesFor(actor)};}
 const now=new Date().toISOString(),created=drafts.flatMap(draft=>dates.map(date=>({...draft,date,id:crypto.randomUUID(),placeholderBatchId:input.placeholderBatchId,createdAt:now,createdBy:actor.username,updatedAt:now,updatedBy:actor.username}))),entries=[...store.read('schedule',[]),...created];
 store.ctx.storage.transactionSync(()=>{store.write('schedule',entries);store.write(key,{fingerprint,entryIds:created.map(entry=>entry.id)});store.notify(usernames,{title:({general:'General work',cnc:'CNC work',delivery:'Delivery',pickup:'Pickup'}[drafts[0].scheduleType]||'General work')+' booking',message:`${first}${last!==first?' – '+last:''} · ${drafts[0].title} · ${drafts[0].project}`,kind:'schedule',priority:'important',link:'schedule'});store.audit(actor.username,'schedule-placeholders-created',{batchId:input.placeholderBatchId,count:created.length,project:drafts[0].project,first,last});});
 return {ok:true,entry:created[0],createdCount:created.length,entries:store.scheduleEntriesFor(actor)};
}
