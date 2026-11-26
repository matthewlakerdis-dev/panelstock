import {requireCondition as check} from './security.js';
import {qaProductionSignature} from './qa-exemptions.js';
import {preparePanelIdUpdates} from './cnc-panel-id-updates.js';

const control=/[\u0000-\u001f\u007f]/;
const completion=panel=>panel.completedAt??null;
const originalReference=panel=>panel.panelNumber??null;
const saveFields=new Set(['action','panelId','newPanelNumber','reason','mutationId','expectedPanelNumber','expectedCompletedAt','productionSignature','revision','restoreEpoch']);

function selectedPanel(store,panelId){
  const panels=store.read('app:cncPanels',[]);
  check(Array.isArray(panels),'The CNC tracker cannot be read. Refresh before correcting a panel ID.',409);
  const matches=panels.filter(panel=>panel?.id===panelId);
  check(matches.length>0,'CNC panel not found',404);
  check(matches.length===1,'This CNC panel has conflicting saved identities. Resolve them before correcting its ID.',409);
  const panel=matches[0];
  check(panel.status==='completed','Only panels already marked as cut can use this correction.',409);
  return {panels,panel};
}

function correctionPlan(store,panel){
  return {
    panelId:panel.id,panelNumber:originalReference(panel),project:String(panel.jobReference??''),
    orderNumber:String(panel.orderNumber??''),sheetNumber:String(panel.sheetNumber??''),
    completedAt:completion(panel),completedBy:panel.completedBy??null,
    productionSignature:qaProductionSignature(panel),revision:store.read('revision',0),restoreEpoch:store.read('restoreEpoch',0)
  };
}

// Correct the human-readable label only. The stable CNC record ID and original
// cutting/inspection/stock evidence continue to identify the same physical part.
export function correctCompletedPanelId(store,body,actor){
  check(actor?.isAdmin===true,'Only administrators can correct IDs on cut panels',403);
  store.requireTask(actor,'factory.cnc');
  check(body&&typeof body==='object'&&!Array.isArray(body),'Choose a cut panel to correct');
  check(['preview','save'].includes(body.action)&&typeof body.panelId==='string'&&body.panelId.trim().length>0&&body.panelId.length<=100&&!control.test(body.panelId),'Choose a cut panel to correct');
  if(body.action==='preview'){
    const {panel}=selectedPanel(store,body.panelId);
    return {ok:true,plan:correctionPlan(store,panel)};
  }
  check(Object.keys(body).every(key=>saveFields.has(key)),'Only the panel ID and correction reason can be changed');
  check(typeof body.newPanelNumber==='string'&&body.newPanelNumber.trim().length>0&&body.newPanelNumber.trim().length<=200&&!control.test(body.newPanelNumber),'Enter a panel ID of 1 to 200 characters without control characters');
  check(typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.trim().length<=1000&&!control.test(body.reason),'Enter a correction reason of 1 to 1000 characters without control characters');
  check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Start a new panel ID correction');
  check(Object.hasOwn(body,'expectedPanelNumber')&&(body.expectedPanelNumber===null||typeof body.expectedPanelNumber==='string'),'Refresh the original panel ID before saving');
  check(Object.hasOwn(body,'expectedCompletedAt')&&(body.expectedCompletedAt===null||typeof body.expectedCompletedAt==='string'),'Refresh the original CNC completion before saving');
  check(typeof body.productionSignature==='string'&&/^[a-f0-9]{64}$/.test(body.productionSignature),'Refresh the cut panel before saving');
  check(Number.isSafeInteger(body.revision)&&body.revision>=0&&Number.isSafeInteger(body.restoreEpoch)&&body.restoreEpoch>=0,'Refresh the CNC tracker before saving');
  const newPanelNumber=body.newPanelNumber.trim(),reason=body.reason.trim(),
    fingerprint=JSON.stringify({panelId:body.panelId,newPanelNumber,reason,expectedPanelNumber:body.expectedPanelNumber,expectedCompletedAt:body.expectedCompletedAt,productionSignature:body.productionSignature,revision:body.revision,restoreEpoch:body.restoreEpoch}),
    receiptKey='cnc-panel-id-correction:'+body.mutationId;
  let changed=false;
  const result=store.ctx.storage.transactionSync(()=>{
    check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Refresh before correcting a panel ID.',409);
    const receipt=store.read(receiptKey,null);
    if(receipt){
      check(receipt.by===actor.username&&receipt.fingerprint===fingerprint,'This correction request has already been used with different details.',409);
      return {...receipt.result,idempotent:true};
    }
    const {panels,panel}=selectedPanel(store,body.panelId),plan=correctionPlan(store,panel);
    check(body.revision===plan.revision&&plan.revision<Number.MAX_SAFE_INTEGER,'The CNC tracker changed. Refresh and review this correction.',409);
    check(body.expectedPanelNumber===plan.panelNumber&&body.expectedCompletedAt===plan.completedAt&&body.productionSignature===plan.productionSignature,'This cut panel changed. Refresh and review its ID before saving.',409);
    check(newPanelNumber!==panel.panelNumber,'Enter a different panel ID',409);
    const records=store.read('qa-checks',[]),loads=store.read('panel-dispatch-loads',[]),transactions=store.read('app:transactions',[]);
    check(Array.isArray(records)&&Array.isArray(loads)&&Array.isArray(transactions),'Saved production history cannot be read. Refresh before correcting this ID.',409);
    const now=new Date().toISOString(),prepared=preparePanelIdUpdates({panels,records,loads,updates:[{panelId:panel.id,newPanelNumber}],actor,operationId:body.mutationId,now}),
      {qaExemptionRebased,qaExemptionKeptInactive}=prepared.corrections[0],revision=plan.revision+1,
      summary={panelId:panel.id,oldPanelNumber:plan.panelNumber,newPanelNumber,project:plan.project,orderNumber:plan.orderNumber,sheetNumber:plan.sheetNumber,completedAt:plan.completedAt,reason,qaExemptionRebased,qaExemptionKeptInactive,waitingLoadsUpdated:prepared.waitingLoadsUpdated},
      result={ok:true,panelId:panel.id,panelNumber:newPanelNumber,previousPanelNumber:plan.panelNumber,revision,summary},
      activity={id:crypto.randomUUID(),type:'cnc',source:'cnc-panel-id-correction',user:actor.username,timestamp:now,serverTimestamp:now,qty:'',panelRecordIds:[panel.id],oldPanelNumber:plan.panelNumber,newPanelNumber,reason,desc:`Corrected cut panel ID: ${plan.panelNumber??'(not recorded)'} → ${newPanelNumber} · ${plan.project||'No project'} · Order ${plan.orderNumber} · Sheet ${plan.sheetNumber}`.slice(0,4000)};
    store.write('app:cncPanels',prepared.panels);
    if(prepared.qaRecordsChanged)store.write('qa-checks',prepared.records);
    if(prepared.loadsChanged)store.write('panel-dispatch-loads',prepared.loads);
    store.write('app:transactions',[activity,...transactions]);
    store.write('revision',revision);
    store.audit(actor.username,'cnc-panel-id-corrected',{mutationId:body.mutationId,...summary,revision});
    store.write(receiptKey,{by:actor.username,at:now,fingerprint,result});
    changed=true;
    return result;
  });
  if(changed)store.broadcastRevision(result.revision);
  return result;
}
