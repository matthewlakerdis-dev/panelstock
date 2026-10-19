import {requireCondition as check,digest} from './security.js';
import {validSafetyDate} from './safety-dates.js';

const ROOT='/toolbox/walks/actions',key=(audit,action)=>'safety:audit-action:'+audit+':'+action;
const identity=a=>a.originAuditId+':'+a.originActionId;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const ok=body=>({status:200,body:{ok:true,...body}});
const field=(v,max)=>{check(typeof v==='string'&&v.length<=max,'Invalid corrective action details');return v.trim();};
const photos=files=>[...new Map(files.map(f=>[f.id,f])).values()];
function fromAudit(r,a,previous){const originAuditId=a.originAuditId||r.id,originActionId=a.originActionId||a.id;return {...a,originAuditId,originActionId,originDocumentNo:a.originDocumentNo||r.documentNo||'Legacy audit',auditDate:previous?.auditDate||r.date,area:previous?.area||r.area,originResult:a.originResult||r.answers.find(v=>v.ref===a.ref)?.result||'NC',photos:photos([...(a.photos||[]),...(r.evidence||[]).filter(f=>f.actionId===a.id).map(f=>({...f,auditId:r.id}))]),photoArchive:photos([...(previous?.photoArchive||[]),...(a.photos||[]),...(r.evidence||[]).filter(f=>f.actionId===a.id).map(f=>({...f,auditId:r.id}))]),revision:0,updatedAt:r.completedAt||r.updatedAt,updatedBy:r.createdBy,history:previous?.history||[]};}

// Signed audits are immutable snapshots. The register holds subsequent follow-up.
export function auditActions(store,day='',exclude=''){
 const result=new Map(),audits=store.read('safety:walks',[]).filter(r=>r.status==='Completed'&&r.id!==exclude&&(!day||r.date<=day)).sort((a,b)=>(a.completedAt||a.updatedAt||'').localeCompare(b.completedAt||b.updatedAt||'')||a.id.localeCompare(b.id));
 for(const row of audits){const r=store.read('safety:walk:'+row.id);if(!r)continue;for(const a of [...(r.carriedActions||[]),...r.actions]){const id=(a.originAuditId||r.id)+':'+(a.originActionId||a.id);result.set(id,fromAudit(r,a,result.get(id)));}}
 for(const [id,a] of result){const live=store.read(key(a.originAuditId,a.originActionId));if(live)result.set(id,live);}
 return [...result.values()].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||identity(a).localeCompare(identity(b)));
}
export function assertAuditActionsCurrent(store,r){
 const live=new Map(auditActions(store,r.date,r.id).map(a=>[identity(a),a])),carried=r.carriedActions||[];
 for(const a of carried)check(live.get(identity(a))?.revision===(a.registerRevision||0),'A corrective action changed in the register. Refresh brought-forward actions, review and sign again.',409);
 for(const a of live.values())if(a.status!=='Closed')check(carried.some(v=>identity(v)===identity(a)),'Open corrective actions changed. Refresh brought-forward actions, review and sign again.',409);
}
export function publishAuditActions(store,r,actor){
 for(const a of [...(r.carriedActions||[]),...r.actions]){const old=store.read(key(a.originAuditId||r.id,a.originActionId||a.id)),value=fromAudit(r,a,old);value.revision=(old?.revision||0)+1;value.history=[...(old?.history||[]),{at:r.completedAt,by:actor.username,event:'Audit signed',status:a.status,auditDocumentNo:r.documentNo,closeEvidence:a.closeEvidence,verifiedBy:a.verifiedBy,verifiedDate:a.verifiedDate}];store.write(key(value.originAuditId,value.originActionId),value);}
}
export async function handleAuditActionRegister(store,path,method,body,actor,validateEvidence){
 if(path===ROOT){check(method==='GET','Method not allowed',405);return ok({actions:auditActions(store)});}
 const match=path.match(/^\/toolbox\/walks\/actions\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/i);check(match&&uuid(match[1])&&uuid(match[2]),'Corrective action not found',404);const [auditId,actionId]=match.slice(1),read=()=>{const a=auditActions(store).find(a=>a.originAuditId===auditId&&a.originActionId===actionId);check(a,'Corrective action not found',404);return a;};
 if(method==='GET')return ok({action:read()});check(method==='POST','Method not allowed',405);check(uuid(body.mutationId),'Request identifier is required');const hash=await digest(JSON.stringify({path,body})),mutation='safety:audit-action-mutation:'+body.mutationId,duplicate=()=>{const old=store.read(mutation);if(!old)return null;check(old.by===actor.username&&old.hash===hash,'Request identifier reused',409);return ok({...old.response,duplicate:true});};const retry=duplicate();if(retry)return retry;
 const current=read();if(body.operation==='download-photo'){const file=[...current.photos,...(current.photoArchive||[])].find(f=>f.id===body.fileId);check(file,'Action photo not found',404);const data=store.read('safety:walk-file:'+file.id);check(data,'Action photo is unavailable',404);return ok({...file,...data});}
 check(['update','upload-photo','remove-photo'].includes(body.operation),'Choose a corrective action operation');check(body.expectedRevision===current.revision,'This corrective action changed. Reload it before saving.',409);let file;
 if(body.operation==='upload-photo'){check(['image/jpeg','image/png'].includes(body.mime),'Choose a photo for this corrective action');file={...await validateEvidence(body),id:crypto.randomUUID(),uploadedAt:new Date().toISOString(),uploadedBy:actor.username,actionId,ref:current.ref};}
 const update=body.operation==='update'?{status:field(body.status,20),owner:field(body.owner,160),due:field(body.due,10),closeEvidence:field(body.closeEvidence,2000),verifiedBy:field(body.verifiedBy,160),verifiedDate:field(body.verifiedDate,10)}:{};
 if(body.operation==='update'){check(['Open','In progress','Closed'].includes(update.status),'Choose a valid action status');check(update.owner&&validSafetyDate(update.due),'Complete the owner and due date');check(!update.verifiedDate||validSafetyDate(update.verifiedDate),'Choose a valid verification date');check(update.status!=='Closed'||update.closeEvidence&&update.verifiedBy&&update.verifiedDate,'Record close-out evidence, verified by and verification date before closing this action');}
 return store.ctx.storage.transactionSync(()=>{const retry=duplicate();if(retry)return retry;const latest=read();check(body.expectedRevision===latest.revision,'This corrective action changed. Reload it before saving.',409);let files=latest.photos;
  if(file){const existing=files.find(f=>f.fileName===file.fileName&&f.hash===file.hash);if(existing){const response={action:latest,alreadyUploaded:true};store.write(mutation,{by:actor.username,hash,response});return ok(response);}check(files.length<5,'Add up to five photos per corrective action');store.write('safety:walk-file:'+file.id,{data:body.data});files=[...files,file];}
  if(body.operation==='remove-photo'){check(files.some(f=>f.id===body.fileId),'Action photo not found',404);files=files.filter(f=>f.id!==body.fileId);}
  const now=new Date().toISOString(),event=body.operation==='update'?(latest.status!==update.status?'Status changed':'Follow-up updated'):file?'Photo attached':'Photo removed',updated={...latest,...update,photos:files,photoArchive:photos([...(latest.photoArchive||[]),...latest.photos,...(file?[file]:[])]),revision:latest.revision+1,updatedAt:now,updatedBy:actor.username,history:[...latest.history,{at:now,by:actor.username,event,status:update.status||latest.status,...update,...(file?{fileId:file.id,fileName:file.fileName,hash:file.hash}:{})}]};
  store.write(key(auditId,actionId),updated);const response={action:updated};store.write(mutation,{by:actor.username,hash,response});store.audit(actor.username,'safety-corrective-action-'+body.operation,{originAuditId:auditId,originActionId:actionId,status:updated.status,revision:updated.revision,...update});return ok(response);
 });
}
