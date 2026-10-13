import {handleSafetyCredentials} from './safety-credentials.js';
import {safetyProfileDirectory,saveSafetyProfile} from './safety-profiles.js';
import {handleSafetyDocuments} from './safety-documents.js';
import {toolboxEmailSettings,saveToolboxEmailSettings,retryToolboxEmail,enqueueToolboxEmail} from './toolbox-email.js';
import {requireCondition as check,digest} from './security.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const ok=body=>({status:200,body:{ok:true,...body}});
const text=(value,max)=>{check(typeof value==='string'&&value.length<=max,'Invalid or overlong toolbox text');return value.trim();};
const recordKey=id=>'toolbox:record:'+id;
const indexKey='toolbox:index';
export const TOOLBOX_TITLES=['Hazard identification','Personal protective equipment','Safe work practices','Emergency procedures','Incident reporting & first aid','Questions & discussion'];
export const TOOLBOX_DAILY_TITLES=['Tasks for the day','High-risk activities','Issues from previous shift'];
export const TOOLBOX_DEFAULTS={
 daily:['List the tasks planned for today and any changed conditions.','Identify high-risk activities and the controls required before work starts.','Record outstanding issues from the previous shift and agreed follow-up.'],
 weekly:['Review recurring fabrication hazards and inspections. Select a focus such as welding fumes, hot work, sharp sheet metal, grinding, lifting or vehicle movement.','Discuss PPE selection, limitations, fit, inspection, care and replacement. Invite equipment concerns.','Review an approved procedure using a practical scenario: hot work, guarding and isolation, lifting, handling material or mobile plant. Record improvements.','Review emergency roles for fire, serious injury and evacuation. Confirm the assembly point and how to raise the alarm.','Discuss relevant incidents and near misses without unnecessary personal details. Review reporting, first aid, corrective actions and outstanding follow-up.','Ask what could make work safer, check understanding and revisit unresolved concerns from previous talks.']
};

// Shared with the browser: signatures bind to the discussion and attendance,
// while later action resolution does not change the signed discussion.
export function toolboxContent(r){
 const trim=v=>String(v??'').trim();
 return JSON.stringify({id:r.id,type:r.type,date:trim(r.date),time:trim(r.time),company:trim(r.company),site:trim(r.site),facilitator:trim(r.facilitator),tasks:trim(r.tasks),focus:trim(r.focus),topics:r.topics.map(t=>({text:trim(t.text),notes:trim(t.notes),reviewed:t.reviewed===true})),people:r.people.map(p=>({name:trim(p.name)})),actions:r.actions.map(a=>({text:trim(a.text),owner:trim(a.owner),due:trim(a.due)})),...(r.prestart?{prestart:{highRisk:trim(r.prestart.highRisk),previousShift:trim(r.prestart.previousShift),checklist:r.prestart.checklist},attendanceTimes:r.people.map(p=>({timeIn:trim(p.timeIn),timeOut:trim(p.timeOut)}))}:{}),...(r.people.some(p=>p.employer!==undefined)?{employers:r.people.map(p=>trim(p.employer))}:{}),...(r.people.some(p=>p.userUsername!==undefined)?{attendeeUsers:r.people.map(p=>trim(p.userUsername))}:{})});
}
function date(value,optional=false){value=text(value,10);check((optional&&!value)||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value),'Invalid toolbox date');return value;}
export function signature(value){
 if(value==null)return null;
 check(value&&typeof value==='object'&&typeof value.image==='string'&&value.image.length<=150000&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.image),'Signature must be a PNG under 110 KB');
 const encoded=value.image.split(',')[1];check(encoded.length%4===0,'Invalid PNG encoding');const raw=atob(encoded);
 check(raw.length>=33&&raw.slice(0,8)==='\x89PNG\r\n\x1a\n'&&raw.slice(12,16)==='IHDR','Invalid PNG signature');
 const size=offset=>[0,1,2,3].reduce((n,i)=>n*256+raw.charCodeAt(offset+i),0);
 check(size(16)>0&&size(16)<=1500&&size(20)>0&&size(20)<=600,'Signature image dimensions are invalid');
 check(typeof value.at==='string'&&Number.isFinite(Date.parse(value.at))&&Date.parse(value.at)<=Date.now()+300000,'Invalid signing time');
 check(typeof value.contentHash==='string'&&/^[a-f0-9]{64}$/.test(value.contentHash),'Signature content hash is required');
 return {image:value.image,at:new Date(value.at).toISOString(),contentHash:value.contentHash};
}
export function normalizeToolboxRecord(input){
 check(input&&uuid(input.id)&&['daily','weekly'].includes(input.type),'Invalid toolbox record');
 check(['Draft','Completed'].includes(input.status),'Invalid toolbox status');
 const r={id:input.id,type:input.type,status:input.status,date:date(input.date),time:text(input.time,5)};
 check(/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time),'Invalid start time');
 for(const [k,max] of Object.entries({company:160,site:160,facilitator:120,tasks:5000,focus:200}))r[k]=text(input[k],max);
 check(Array.isArray(input.topics)&&(input.type==='daily'?[3,6].includes(input.topics.length):input.topics.length===6),'Invalid discussion sections');
 r.topics=input.topics.map(t=>{check(t&&typeof t.reviewed==='boolean','Invalid discussion section');return {text:text(t.text,5000),notes:text(t.notes,5000),reviewed:t.reviewed};});
 check(Array.isArray(input.people)&&input.people.length<=60,'A talk supports up to 60 attendees');
 r.people=input.people.map(p=>{check(p&&typeof p.ack==='boolean','Invalid attendance');return {name:text(p.name,120),...(p.employer!==undefined?{employer:text(p.employer,160)}:{}),ack:p.ack,signature:signature(p.signature),...(p.userUsername!==undefined?{userUsername:text(p.userUsername,40)}:{})};});
 check(Array.isArray(input.actions)&&input.actions.length<=50,'A talk supports up to 50 actions');
 r.actions=input.actions.map(a=>({text:text(a?.text,3000),owner:text(a?.owner,120),due:date(a?.due,true),closed:false}));
 if(input.prestart!==undefined){
  const p=input.prestart;check(p&&Array.isArray(p.checklist)&&p.checklist.length===13&&p.checklist.every(v=>['','Y','N','N/A'].includes(v)),'Invalid pre-start checklist');
  r.prestart={highRisk:text(p.highRisk,5000),previousShift:text(p.previousShift,5000),checklist:[...p.checklist]};
  r.people.forEach((p,i)=>{for(const k of ['timeIn','timeOut']){const v=text(input.people[i][k]??'',5);check(!v||/^([01]\d|2[0-3]):[0-5]\d$/.test(v),'Invalid attendance time');p[k]=v;}});
 }
 r.supervisorSignature=signature(input.supervisorSignature);
 check(JSON.stringify(r).length<=4*1024*1024,'Toolbox record exceeds 4 MB',413);
 return r;
}
function summary(r){return {id:r.id,type:r.type,date:r.date,site:r.site,facilitator:r.facilitator,focus:r.focus,status:r.status,revision:r.revision,updatedAt:r.updatedAt,createdBy:r.createdBy,people:r.people.map(p=>({name:p.name})),actions:r.actions.map(a=>({...a}))};}
function accessible(r,actor){return r.status==='Completed'||actor.isAdmin||r.createdBy===actor.username;}
function readRecord(store,id,actor){check(uuid(id),'Invalid toolbox identifier');const r=store.read(recordKey(id));check(r&&r.status!=='Deleted'&&accessible(r,actor),'Toolbox record not found',404);return r;}
function writeRecord(store,r){store.write(recordKey(r.id),r);store.write(indexKey,[summary(r),...store.read(indexKey,[]).filter(item=>item.id!==r.id)]);}
export async function handleToolbox(store,path,method,body,actor){
 store.requireTask(actor,'factory.toolbox');
 if(['/toolbox/credentials','/toolbox/credential-file'].includes(path))return handleSafetyCredentials(store,path,method,body,actor);
 if(path.startsWith('/toolbox/safety-documents'))return handleSafetyDocuments(store,path,method,body,actor);
 if(path==='/toolbox/email-settings'){check(['GET','POST'].includes(method),'Method not allowed',405);return ok(method==='GET'?toolboxEmailSettings(store,actor):saveToolboxEmailSettings(store,body,actor));}
 if(path==='/toolbox/email-retry'){check(method==='POST','Method not allowed',405);return ok(retryToolboxEmail(store,body,actor));}
 if(path==='/toolbox/user-profiles'){check(method==='POST','Method not allowed',405);return saveSafetyProfile(store,body,actor);}
 if(path==='/toolbox/users'){
  check(method==='GET','Method not allowed',405);
  return ok({users:await safetyProfileDirectory(store)});
 }
 if(path==='/toolbox/export-index'){
  check(method==='POST','Method not allowed',405);
  return ok({ids:store.read(indexKey,[]).filter(r=>accessible(r,actor)).map(r=>r.id),templates:store.read('toolbox:templates',{templates:TOOLBOX_DEFAULTS}).templates});
 }
 if(path==='/toolbox/templates'){
  const previous=store.read('toolbox:templates',{revision:0,templates:TOOLBOX_DEFAULTS});
  if(method==='GET')return ok({...previous,templates:{...previous.templates,daily:previous.templates.daily.length===3?previous.templates.daily:TOOLBOX_DEFAULTS.daily}});
  check(method==='POST','Method not allowed',405);check(actor.isAdmin,'Administrator access required',403);
  const templates={};for(const type of ['daily','weekly']){check(Array.isArray(body.templates?.[type])&&(type==='daily'?[3,6].includes(body.templates[type].length):body.templates[type].length===6),'Invalid template sections');templates[type]=body.templates[type].map(v=>text(v,5000));check(templates[type].every(Boolean),'Template talking points cannot be empty');}
  return store.ctx.storage.transactionSync(()=>{const current=store.read('toolbox:templates',{revision:0});check(body.expectedRevision===current.revision,'Templates changed. Reload before saving.',409);const saved={revision:current.revision+1,templates,updatedAt:new Date().toISOString(),updatedBy:actor.username};store.write('toolbox:templates',saved);store.audit(actor.username,'toolbox-templates-saved',{revision:saved.revision});return ok(saved);});
 }
 if(path==='/toolbox/list'){
  check(method==='POST','Method not allowed',405);
  const q=typeof body.search==='string'?body.search.slice(0,200).toLowerCase():'',offset=body.offset??0;
  check(Number.isSafeInteger(offset)&&offset>=0,'Invalid record page');
  const rows=store.read(indexKey,[]).filter(r=>accessible(r,actor)&&[r.date,r.site,r.facilitator,r.focus,r.type].join(' ').toLowerCase().includes(q));
  const actions=rows.flatMap(r=>r.status==='Completed'?r.actions.filter(a=>!a.closed).map(a=>({...a,record:r.id,site:r.site,index:r.actions.indexOf(a),revision:r.revision})):[]);
  return ok({records:rows.slice(offset,offset+25),total:rows.length,offset,nextOffset:offset+25<rows.length?offset+25:null,openActions:actions.slice(offset,offset+25),openActionTotal:actions.length,actionNextOffset:offset+25<actions.length?offset+25:null});
 }
 const match=path.match(/^\/toolbox\/records\/([a-f0-9-]{36})(\/(?:resolve|delete))?$/i);check(match,'Not found',404);
 const id=match[1];
 if(method==='GET'&&!match[2])return ok({record:readRecord(store,id,actor)});
 check(method==='POST','Method not allowed',405);check(uuid(body.mutationId),'Mutation identifier is required');
 const payloadHash=await digest(JSON.stringify({path,body}));
 let normalized,contentHash;
 if(!match[2]){normalized=normalizeToolboxRecord(body.record);check(normalized.id===id,'Record identifier mismatch');contentHash=await digest(toolboxContent(normalized));
  for(const sig of [...normalized.people.map(p=>p.signature),normalized.supervisorSignature].filter(Boolean))check(sig.contentHash===contentHash,'Talk changed after signing. Collect fresh signatures.',409);
  if(normalized.status==='Completed'){
   check(normalized.site&&normalized.facilitator&&(normalized.type==='daily'?normalized.tasks:normalized.focus),'Complete the required talk details');
   if(normalized.type==='daily'&&normalized.prestart)check(normalized.prestart.checklist.every(Boolean),'Answer all pre-start checklist questions');
   check(normalized.topics.every(t=>t.reviewed&&t.text),'Discuss all six sections');
   check(normalized.people.length&&normalized.people.every(p=>p.name&&p.ack&&p.signature),'Each attendee must sign');
   check(normalized.supervisorSignature,'Supervisor sign-off is required');
   check(normalized.actions.every(a=>a.text&&a.owner&&a.due),'Each action needs a description, owner and due date');
  }
 }
 return store.ctx.storage.transactionSync(()=>{
  const duplicate=store.read('toolbox:mutation:'+body.mutationId);
  if(duplicate){check(duplicate.recordId===id&&duplicate.username===actor.username&&duplicate.hash===payloadHash,'Mutation identifier reused with different data',409);return duplicate.deleted?ok({deleted:true,duplicate:true}):ok({record:readRecord(store,id,actor),duplicate:true});}
  const previous=store.read(recordKey(id));
  if(match[2]==='/delete'){
   check(previous,'Toolbox draft not found',404);
   check(actor.isAdmin||previous.createdBy===actor.username,'Only the owner or an administrator can delete this draft',403);
   if(previous.status==='Deleted'){check(body.expectedRevision===previous.revision-1,'Draft changed. Refresh records before deleting.',409);return ok({deleted:true,duplicate:true});}
   check(previous.status==='Draft','Completed talks cannot be deleted',409);
   check(body.expectedRevision===previous.revision,'Draft changed. Reopen it before deleting.',409);
   // Replace all document chunks with minimal deletion metadata so stale saves cannot recreate the draft.
   const deleted={id,status:'Deleted',createdBy:previous.createdBy,revision:previous.revision+1,deletedAt:new Date().toISOString(),deletedBy:actor.username};
   store.write(recordKey(id),deleted);store.write(indexKey,store.read(indexKey,[]).filter(r=>r.id!==id));
   store.write('toolbox:mutation:'+body.mutationId,{username:actor.username,hash:payloadHash,recordId:id,deleted:true});
   store.audit(actor.username,'toolbox-draft-deleted',{recordId:id,revision:deleted.revision});return ok({deleted:true});
  }
  check(!previous||previous.status!=='Deleted','This draft was deleted. Start a new talk.',409);
  if(previous){check(accessible(previous,actor)&&(actor.isAdmin||previous.createdBy===actor.username||match[2]&&previous.status==='Completed'),'Only the owner or an administrator can edit this draft',403);check(body.expectedRevision===previous.revision,'Record changed. Reopen it before saving.',409);}
  else check(body.expectedRevision===0&&!match[2],'Record not found or changed',409);
  let r;const now=new Date().toISOString();
  if(match[2]){check(previous.status==='Completed','Complete the talk before resolving actions');check(Number.isInteger(body.actionIndex)&&body.actionIndex>=0&&body.actionIndex<previous.actions.length,'Invalid action');r=structuredClone(previous);check(!r.actions[body.actionIndex].closed,'Action already resolved',409);r.actions[body.actionIndex]={...r.actions[body.actionIndex],closed:true,resolvedAt:now,resolvedBy:actor.username};}
  else{check(!previous||previous.status==='Draft','Completed talks cannot be edited',409);r={...normalized,createdAt:previous?.createdAt||now,createdBy:previous?.createdBy||actor.username,completedAt:normalized.status==='Completed'?now:null,completedBy:normalized.status==='Completed'?actor.username:null,contentHash};}
  r.revision=(previous?.revision||0)+1;r.updatedAt=now;r.updatedBy=actor.username;
  writeRecord(store,r);if(!match[2]&&r.status==='Completed')enqueueToolboxEmail(store,r);store.write('toolbox:mutation:'+body.mutationId,{username:actor.username,hash:payloadHash,recordId:id});store.audit(actor.username,match[2]?'toolbox-action-resolved':r.status==='Completed'?'toolbox-completed':'toolbox-draft-saved',{recordId:id,revision:r.revision});return ok({record:r,...(r.status==='Completed'?{emailStatus:store.read('toolbox:email:'+id)?.status||'disabled'}:{})});
 });
}
