import {requireCondition as check,digest} from './security.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const reminderKey=(versionId,username)=>'safety:reminded:'+versionId+':'+encodeURIComponent(username);
const pairKey=r=>r.versionId+':'+r.username;
const DAY=24*60*60*1000;

export function safetyCompliance(store){
 const users=store.read('users',{}),names=new Map((store.sql?.exec('SELECT username,display_name AS displayName FROM access_users WHERE active=1').toArray()||[]).map(u=>[u.username,u.displayName])),rows=[],documents=[],people=new Map(),now=Date.now();
 for(const entry of store.read('safety:documents',[])){
  const d=store.read('safety:document:'+entry.id);if(!d||d.archived||d.type!=='SWMS')continue;
  const v=d.versions.find(v=>v.id===d.currentVersion);if(!v)continue;
  documents.push({id:d.id,title:v.title,versionId:v.id,versionLabel:v.label});
  const acknowledgements=store.read('safety:ack:'+v.id,[]);
  for(const username of new Set(v.requiredSigners||[])){
   if(!Object.hasOwn(users,username)||users[username].active===false)continue;
   const name=names.get(username)||users[username].displayName||username,ack=acknowledgements.find(a=>a.username===username),lastRemindedAt=store.read(reminderKey(v.id,username))?.at||null;
   people.set(username,{username,name});rows.push({documentId:d.id,versionId:v.id,title:v.title,versionLabel:v.label,username,name,status:ack?'Acknowledged':'Outstanding',signedAt:ack?.signature?.at||null,lastRemindedAt,canRemind:!ack&&(!lastRemindedAt||now-Date.parse(lastRemindedAt)>=DAY)});
  }
 }
 rows.sort((a,b)=>a.name.localeCompare(b.name)||a.title.localeCompare(b.title));documents.sort((a,b)=>a.title.localeCompare(b.title));const outstanding=rows.filter(r=>r.status==='Outstanding');
 return {rows,documents,people:[...people.values()].sort((a,b)=>a.name.localeCompare(b.name)),totals:{assigned:rows.length,completed:rows.length-outstanding.length,outstanding:outstanding.length,peopleOutstanding:new Set(outstanding.map(r=>r.username)).size,documentsOutstanding:new Set(outstanding.map(r=>r.documentId)).size},reminderChannel:'Panelstock notifications and enabled device push',reminderIntervalHours:24};
}

export async function handleSafetyCompliance(store,path,method,body,actor){
 check(actor?.isAdmin,'Administrator access required',403);
 if(path.endsWith('/compliance')){check(method==='GET','Method not allowed',405);return {status:200,body:{ok:true,...safetyCompliance(store)}};}
 check(method==='POST','Method not allowed',405);check(uuid(body.mutationId),'Reminder request identifier is required');
 check(Array.isArray(body.items)&&body.items.length>0&&body.items.length<=5000,'Choose outstanding acknowledgements to remind');
 check(body.items.every(r=>r&&uuid(r.documentId)&&uuid(r.versionId)&&typeof r.username==='string'&&r.username.length>0&&r.username.length<=100),'Invalid reminder selection');
 const payloadHash=await digest(JSON.stringify(body)),mutationKey='safety:reminder-mutation:'+body.mutationId;
 return store.ctx.storage.transactionSync(()=>{
  const previous=store.read(mutationKey);if(previous){check(previous.username===actor.username&&previous.hash===payloadHash,'Reminder request identifier reused',409);return {status:200,body:{ok:true,...previous.result,duplicate:true}};}
  // Re-read assignments and signatures inside the transaction: never remind a stale version or a completed signer.
  const current=new Map(safetyCompliance(store).rows.map(r=>[pairKey(r),r])),selected=new Map(body.items.map(r=>[pairKey(r),r])),groups=new Map();let skipped=0;
  for(const [key,item] of selected){const row=current.get(key);if(!row||row.documentId!==item.documentId||!row.canRemind){skipped++;continue;}if(!groups.has(row.username))groups.set(row.username,[]);groups.get(row.username).push(row);}
  const at=new Date().toISOString();let reminded=0;
  for(const [username,rows] of groups){
   const titles=rows.slice(0,3).map(r=>r.title.slice(0,80)).join('; '),extra=rows.length>3?` and ${rows.length-3} more`:'';
   store.notify([username],{title:'SWMS acknowledgement reminder',message:`Please read and sign ${rows.length} outstanding SWMS: ${titles}${extra}. Open safety.panelstockhq.com to complete your acknowledgements.`,kind:'safety',priority:'important',link:'notifications'});
   for(const row of rows){store.write(reminderKey(row.versionId,username),{at,sentBy:actor.username});reminded++;}
  }
  const result={recipients:groups.size,reminded,skipped,at};store.write(mutationKey,{username:actor.username,hash:payloadHash,result});store.audit(actor.username,'safety-compliance-reminders-sent',result);
  return {status:200,body:{ok:true,...result}};
 });
}
