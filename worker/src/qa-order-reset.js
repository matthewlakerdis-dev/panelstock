import {createHash} from 'node:crypto';
import {requireCondition as check} from './security.js';
import {normalizeCncInput} from './cnc-input.js';
import {effectivePanelQaStatus} from './qa-exemptions.js';

const control=/[\u0000-\u001f\u007f]/,MAX_SELECTION=500,RECEIPT='qa-panel-order-reset:';
const normal=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-AU');
const orderKey=value=>normal(normalizeCncInput({orderNumber:String(value??'')}).orderNumber||value);
const inScope=(panel,scope)=>normal(panel?.jobReference)===normal(scope.project)&&orderKey(panel?.orderNumber)===orderKey(scope.orderNumber);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textHash=value=>createHash('sha256').update(value).digest('hex');
function snapshotValue(value){
  if(value===null)return ['null'];
  if(typeof value==='string')return ['string',value.length,value.length>4096?['sha256',textHash(value)]:value];
  if(Array.isArray(value))return ['array',value.map(snapshotValue)];
  if(value&&typeof value==='object')return ['object',Object.keys(value).sort().map(key=>[key,snapshotValue(value[key])])];
  return [typeof value,value];
}
function authorize(store,actor){
  check(actor?.isAdmin===true,'Only administrators can reset panel order QA',403);
  store.requireTask(actor,'factory.qa');
}
function scopeOf(input){
  check(typeof input.project==='string'&&input.project.trim().length<=120&&!control.test(input.project),'Choose an existing CNC project');
  check(typeof input.orderNumber==='string'&&input.orderNumber.trim().length>0&&input.orderNumber.trim().length<=200&&!control.test(input.orderNumber),'Choose an existing CNC order');
  return {project:input.project.trim(),orderNumber:input.orderNumber.trim()};
}
function selectionOf(input){
  check(Array.isArray(input)&&input.length>0&&input.length<=MAX_SELECTION,'Select between 1 and 500 inspected panels');
  const seen=new Set();
  for(const id of input){check(typeof id==='string'&&id.trim().length>0&&id===id.trim()&&id.length<=100&&!control.test(id)&&!seen.has(id),'Select each saved panel once');seen.add(id);}
  return [...seen].sort((a,b)=>a.localeCompare(b));
}
function orderState(store,scope){
  const panels=store.read('app:cncPanels',[]),records=store.read('qa-checks',[]),loads=store.read('panel-dispatch-loads',[]),dispatches=store.read('qa-dispatches',[]);
  check([panels,records,loads,dispatches].every(Array.isArray),'Saved production history cannot be read. Refresh before resetting QA.',409);
  const selected=panels.filter(panel=>panel&&inScope(panel,scope)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  check(selected.length>0,'No existing CNC panels were found for this project and order',404);
  check(selected.length<=10000,'Choose an order containing at most 10,000 existing CNC records');
  const counts=new Map(),qaById=new Map();
  for(const panel of panels)if(typeof panel?.id==='string')counts.set(panel.id,(counts.get(panel.id)||0)+1);
  for(const record of records)if(typeof record?.id==='string'){const list=qaById.get(record.id)||[];list.push(record);qaById.set(record.id,list);}
  const ids=new Set(selected.map(panel=>panel.id)),affectedLoads=loads.filter(load=>Array.isArray(load?.panelIds)&&load.panelIds.some(id=>ids.has(id))),
    affectedDispatches=dispatches.filter(dispatch=>dispatch?.lines?.some(line=>line?.kind==='panel'&&ids.has(line.id))),
    dependencies=records.filter(record=>ids.has(record?.id)||ids.has(record?.remakeOf)||ids.has(record?.replacementId));
  for(const panel of selected){
    check(typeof panel.id==='string'&&panel.id.trim().length>0&&panel.id.length<=100&&counts.get(panel.id)===1,'This order has conflicting CNC identities. Resolve them before resetting QA.',409);
    const matching=qaById.get(panel.id)||[];
    check(matching.length<=1&&(!matching.length||matching[0].kind==='panel'),'This order has conflicting QA identities. Resolve them before resetting QA.',409);
  }
  const items=selected.map(panel=>{
    const matching=qaById.get(panel.id)||[],record=matching.length===1?matching[0]:null;
    let excludedReason='';
    if(typeof panel.id!=='string'||!panel.id.trim()||panel.id.length>100||counts.get(panel.id)!==1)excludedReason='This panel has conflicting CNC identities.';
    else if(matching.length>1||record&&record.kind!=='panel')excludedReason='This panel has conflicting QA identities.';
    else if(panel.status!=='completed')excludedReason='This panel has not been cut.';
    else if(record?.status==='not_required')excludedReason='QA is not required for this panel. Its exemption is preserved.';
    else if(['recut','rework','replaced'].includes(record?.status))excludedReason='Use the existing recut or replacement workflow for this panel.';
    else if(record?.status!=='approved')excludedReason='This panel is already awaiting QA or has no approved inspection.';
    else if(['remakeOf','replacementId','replacementStatus','resolvedSeparatelyAt','resolvedSeparatelyBy','resolvedSeparatelyReason'].some(key=>record[key]!==undefined&&record[key]!==null&&record[key]!=='')||records.some(other=>other?.id!==panel.id&&(other?.remakeOf===panel.id||other?.replacementId===panel.id)))excludedReason='This panel is linked to a recut or replacement. Review that workflow first.';
    else if(loads.some(load=>load?.panelIds?.includes(panel.id)&&(load.status!=='waiting'||load.finalQa||load.coatingCompleted||load.legs?.length)))excludedReason='This panel belongs to a dispatched or coating load. Review or reverse that dispatch first.';
    else if(dispatches.some(dispatch=>dispatch?.lines?.some(line=>line?.kind==='panel'&&line.id===panel.id)))excludedReason='This panel has a saved physical dispatch. Review that dispatch first.';
    return {id:panel.id,panelId:panel.id,panelNumber:panel.panelNumber??null,reference:panel.panelNumber??null,sheetNumber:String(panel.sheetNumber??''),
      status:panel.status,completedAt:panel.completedAt??null,completedBy:panel.completedBy??null,qaStatus:record?effectivePanelQaStatus(panel,record):panel.status==='completed'?'awaiting':'awaiting_routing',
      latestAttemptId:record?.latest?.id??null,qaReset:record?.qaReset??null,eligible:!excludedReason,excludedReason};
  });
  const revision=store.read('revision',0),restoreEpoch=store.read('restoreEpoch',0);
  check(Number.isSafeInteger(revision)&&revision>=0&&revision<Number.MAX_SAFE_INTEGER&&Number.isSafeInteger(restoreEpoch)&&restoreEpoch>=0,'The saved production revision is invalid. Refresh the tracker.',409);
  const snapshot=hash(snapshotValue({scope:{project:normal(scope.project),orderNumber:orderKey(scope.orderNumber)},panels:selected,records:dependencies,loads:affectedLoads,dispatches:affectedDispatches,revision,restoreEpoch}));
  return {scope,panels,records,loads,dispatches,selected,items,revision,restoreEpoch,snapshot};
}
function reviewedPlan(store,scope,panelIds){
  const state=orderState(store,scope),byId=new Map(state.items.map(item=>[item.panelId,item])),rows=[];
  for(const id of panelIds){const item=byId.get(id);check(item,'A selected panel is outside this project/order or no longer exists.',409);check(item.eligible,item.excludedReason||'This panel is no longer eligible for a QA reset.',409);rows.push({...item,oldQaStatus:item.qaStatus,newQaStatus:'awaiting'});}
  const warnings=['Selected panels will require a new inspection. Fabricated and Ready indicators depend on current QA approval.','Previous inspections, photos, panel m², cutting records, stock and offcuts will be retained.'],
    plan={scope,panelIds,rows,excluded:state.items.filter(item=>!item.eligible),warnings,revision:state.revision,restoreEpoch:state.restoreEpoch};
  plan.snapshot=hash(snapshotValue({state:state.snapshot,scope,panelIds,rows}));
  return {plan,state};
}

export function qaOrderReset(store,body,actor){
  authorize(store,actor);
  check(body&&typeof body==='object'&&!Array.isArray(body)&&['context','preview','save'].includes(body.action),'Choose a panel order QA reset action');
  const allowed=new Set(['action','project','orderNumber',...(body.action==='context'?[]:['panelIds']),...(body.action==='save'?['mutationId','reason','confirmed','snapshot','revision','restoreEpoch']:[])]);
  check(Object.keys(body).every(key=>allowed.has(key)),'Only the reviewed panel QA reset fields can be changed');
  const scope=scopeOf(body);
  if(body.action==='context'){const state=orderState(store,scope);return {ok:true,scope,panels:state.items,revision:state.revision,restoreEpoch:state.restoreEpoch};}
  const panelIds=selectionOf(body.panelIds);
  if(body.action==='preview')return {ok:true,plan:reviewedPlan(store,scope,panelIds).plan};
  check(body.confirmed===true,'Confirm these selected panels need a new QA inspection');
  check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Start a new panel order QA reset');
  check(typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.trim().length<=1000&&!control.test(body.reason),'Enter a reset reason of 1 to 1000 characters without control characters');
  check(typeof body.snapshot==='string'&&/^[a-f0-9]{64}$/.test(body.snapshot)&&Number.isSafeInteger(body.revision)&&body.revision>=0&&Number.isSafeInteger(body.restoreEpoch)&&body.restoreEpoch>=0,'Review the current panel QA before resetting');
  const reason=body.reason.trim(),fingerprint=hash(snapshotValue({scope,panelIds,snapshot:body.snapshot,revision:body.revision,restoreEpoch:body.restoreEpoch,reason,confirmed:true})),receiptKey=RECEIPT+body.mutationId;
  let committed=false;
  const result=store.ctx.storage.transactionSync(()=>{
    check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Review the order QA again.',409);
    const receipt=store.read(receiptKey,null);
    if(receipt){check(receipt.by===actor.username&&receipt.fingerprint===fingerprint,'This reset reference was already used with different details.',409);return {...receipt.result,idempotent:true};}
    const {plan,state}=reviewedPlan(store,scope,panelIds);
    check(body.revision===plan.revision&&body.restoreEpoch===plan.restoreEpoch&&body.snapshot===plan.snapshot,'This order, its QA or its dispatch progress changed. Review the reset again.',409);
    const now=new Date().toISOString(),selectedIds=new Set(panelIds),panelById=new Map(state.selected.map(panel=>[panel.id,panel])),beforeRecords=state.records.filter(record=>selectedIds.has(record.id)),byId=new Map(),
      records=state.records.map(record=>{
        if(!selectedIds.has(record?.id))return record;
        const panel=panelById.get(record.id),qaReset={schemaVersion:1,id:body.mutationId,at:now,by:actor.username,reason,cutAt:panel.completedAt??null,previousAttemptId:record.latest?.id??null,pending:true},
          updated={...record,status:'awaiting',qaReset,qaResetHistory:[...(record.qaResetHistory||[]),{...qaReset,previousStatus:record.status,referenceAtReset:panel.panelNumber??null}]};
        byId.set(record.id,updated);return updated;
      }),rows=plan.rows.map(row=>({...row,qaStatus:'awaiting',qaReset:byId.get(row.panelId).qaReset})),revision=state.revision+1,
      summary={scope,resetId:body.mutationId,rows,resetCount:rows.length},result={ok:true,revision,summary};
    // The immutable receipt also holds the exact prior evidence. Its original
    // photo bytes/references and inspection snapshots remain untouched in QA.
    store.write(receiptKey,{schemaVersion:1,resetId:body.mutationId,by:actor.username,at:now,reason,fingerprint,snapshot:plan.snapshot,scope,
      priorEvidence:beforeRecords,result});
    store.write('qa-checks',records);store.write('revision',revision);
    store.audit(actor.username,'qa-panel-order-reset',{resetId:body.mutationId,scope,panelIds,reason,priorEvidenceDocument:receiptKey,rows:plan.rows,revision});
    committed=true;return result;
  });
  if(committed)store.broadcastRevision(result.revision);
  return result;
}
