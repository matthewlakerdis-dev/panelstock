import {createHash} from 'node:crypto';
import {requireCondition as check} from './security.js';
import {panelAreaFor,panelAreaResetGeneration,PANEL_AREA_RESET_GENERATION_KEY} from './qa-panel-area.js';

const ABSENT='__QA_PANEL_AREA_RESET_DOCUMENT_ABSENT__';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const requireAdmin=actor=>check(actor?.isAdmin===true,'Admin access required to reset QA panel areas',403);
const validResetId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(value);
const panelIdentity=panel=>Object.fromEntries(['id','status','completedAt','jobReference','orderNumber','sheetNumber','panelNumber','panelAreaScope','totalPanelArea','panelWidth','panelHeight'].filter(key=>Object.hasOwn(panel,key)).map(key=>[key,panel[key]]));
const attempt=value=>value?Object.fromEntries(['id','status','checkedAt','checkedBy','panelArea'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])):null;
const qaIdentity=record=>record?{id:record.id,kind:record.kind,status:record.status,latest:attempt(record.latest),history:(Array.isArray(record.history)?record.history:[]).map(attempt),exemptionId:record.qaExemption?.id||null}:null;

function resetState(store){
  const panels=store.read('app:cncPanels',[]),records=store.readQaForDispatch(),generationDocument=store.read(PANEL_AREA_RESET_GENERATION_KEY,ABSENT);
  check(Array.isArray(panels)&&Array.isArray(records),'Refresh QA panel data before resetting areas',409);
  const seen=new Set(),counts=new Map(),panelIdCounts=new Map(),checksById=new Map();
  for(const panel of panels)panelIdCounts.set(panel.id,(panelIdCounts.get(panel.id)||0)+1);
  for(const record of records){const matching=checksById.get(record.id)||[];matching.push(record);checksById.set(record.id,matching);}
  const targets=panels.filter(panel=>panel.status==='completed').map(panel=>{
    check(typeof panel.id==='string'&&panel.id.length>0&&panel.id.length<=100&&!seen.has(panel.id)&&panelIdCounts.get(panel.id)===1,'A completed panel has conflicting saved identities. Resolve them before resetting areas.',409);seen.add(panel.id);
    const matching=checksById.get(panel.id)||[];
    check(matching.length<=1&&(!matching.length||matching[0].kind==='panel'),'A panel has conflicting QA identities. Resolve them before resetting areas.',409);
    const record=matching[0]||null,previous=store.read('qa-panel-area:'+panel.id,ABSENT),exists=previous!==ABSENT,revision=exists?(previous?.revision??0):0;
    check(Number.isSafeInteger(revision)&&revision>=0&&revision<Number.MAX_SAFE_INTEGER,'A panel area has an invalid revision. Resolve it before resetting areas.',409);
    const status=record?.status||'awaiting';counts.set(status,(counts.get(status)||0)+1);
    return {panel,qa:qaIdentity(record),status,exists,previous:exists?previous:null,revision,known:!!panelAreaFor(panel,record,exists?previous:null)};
  }).sort((a,b)=>a.panel.id.localeCompare(b.panel.id));
  const generation=panelAreaResetGeneration(store),statusCounts=Object.fromEntries([...counts].sort(([a],[b])=>a.localeCompare(b))),
    snapshot=hash({generationDocument:generationDocument===ABSENT?{exists:false}:{exists:true,value:generationDocument},targets:targets.map(({panel,qa,exists,previous})=>({panel:panelIdentity(panel),qa,area:{exists,value:previous}}))});
  return {snapshot,generation,generationDocument,generationExists:generationDocument!==ABSENT,targets,panelCount:targets.length,knownAreaCount:targets.filter(target=>target.known).length,statusCounts};
}

export function previewPanelAreaReset(store,actor){
  requireAdmin(actor);
  const {snapshot,generation,panelCount,knownAreaCount,statusCounts}=resetState(store);
  return {ok:true,snapshot,generation,panelCount,knownAreaCount,statusCounts};
}

export function readPanelAreaResetBackup(store,body,actor){
  requireAdmin(actor);
  check(body&&typeof body==='object'&&!Array.isArray(body)&&validResetId(body.resetId),'Choose a saved QA panel area reset');
  const backup=store.read('qa-panel-area-backup:'+body.resetId,null);
  check(backup,'QA panel area reset backup not found',404);
  check(backup.schemaVersion===1&&backup.resetId===body.resetId,'This QA panel area reset backup is invalid',409);
  return {ok:true,backup};
}

export function resetPanelAreas(store,body,actor){
  requireAdmin(actor);
  check(body&&typeof body==='object'&&!Array.isArray(body),'Review the QA panel area reset first');
  check(validResetId(body.resetId),'Start a new QA panel area reset');
  check(typeof body.expectedSnapshot==='string'&&/^[a-f0-9]{64}$/.test(body.expectedSnapshot),'Review the current QA panel areas before resetting');
  check(typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.trim().length<=1000,'Add a reset reason of 1 to 1000 characters');
  const reason=body.reason.trim(),fingerprint=hash({resetId:body.resetId,expectedSnapshot:body.expectedSnapshot,reason}),receiptKey='qa-panel-area-reset:'+body.resetId;
  return store.ctx.storage.transactionSync(()=>{
    const receipt=store.read(receiptKey,null);
    if(receipt){check(receipt.username===actor.username&&receipt.fingerprint===fingerprint,'This reset reference has already been used for a different request.',409);return receipt.result;}
    const current=resetState(store);
    check(current.snapshot===body.expectedSnapshot,'QA panels or areas changed after the preview. Refresh and review the reset again.',409);
    const now=new Date().toISOString(),backupId='qa-panel-area-backup:'+body.resetId,
      backup={schemaVersion:1,resetId:body.resetId,createdAt:now,createdBy:actor.username,reason,snapshot:current.snapshot,previousGeneration:current.generation,
        documents:[{key:PANEL_AREA_RESET_GENERATION_KEY,existed:current.generationExists,...(current.generationExists?{value:current.generationDocument}:{})},...current.targets.map(target=>({key:'qa-panel-area:'+target.panel.id,existed:target.exists,...(target.exists?{value:target.previous}:{})}))],
        targets:current.targets.map(({panel,status,revision})=>({id:panel.id,project:panel.jobReference||'',orderNumber:panel.orderNumber||'',sheetNumber:panel.sheetNumber||'',reference:panel.panelNumber||'',cutAt:panel.completedAt||null,qaStatus:status,previousAreaRevision:revision})),
        panelCount:current.panelCount,knownAreaCount:current.knownAreaCount,statusCounts:current.statusCounts};
    check(store.read(backupId,ABSENT)===ABSENT,'This reset backup already exists. Start a new reset.',409);
    store.write(backupId,backup);
    for(const {panel,revision} of current.targets)store.write('qa-panel-area:'+panel.id,{value:null,resetId:body.resetId,resetAt:now,resetBy:actor.username,revision:revision+1,cutAt:panel.completedAt||null});
    store.write(PANEL_AREA_RESET_GENERATION_KEY,{id:body.resetId,at:now,by:actor.username});
    const result={ok:true,resetId:body.resetId,backupId,panelCount:current.panelCount,knownAreaCount:current.knownAreaCount,statusCounts:current.statusCounts,generation:body.resetId,previousGeneration:current.generation};
    store.audit(actor.username,'qa-panel-areas-reset',{resetId:body.resetId,backupId,reason,panelCount:current.panelCount,knownAreaCount:current.knownAreaCount,statusCounts:current.statusCounts,previousGeneration:current.generation});
    store.write(receiptKey,{username:actor.username,fingerprint,result,createdAt:now});
    return result;
  });
}
