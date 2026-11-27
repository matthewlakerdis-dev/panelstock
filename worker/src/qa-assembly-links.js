import {requireCondition as check} from './security.js';
import {qaAssemblyRelation,capReference,sameAssemblyOrder,qaAssemblyHash,ASSEMBLY_LINK_PREFIX,ASSEMBLY_LINK_RECEIPT,attestQaAssemblyPanels} from './qa-assemblies.js';
const control=/[\u0000-\u001f\u007f]/;
const normal=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
const identity=panel=>({id:panel.id,reference:panel.panelNumber??'',project:panel.jobReference??'',orderNumber:panel.orderNumber??'',sheetNumber:panel.sheetNumber??'',status:panel.status,completedAt:panel.completedAt??null});
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=100&&!control.test(value);
function stateFor(store,panelId){
  const panels=attestQaAssemblyPanels(store,store.read('app:cncPanels',[])),matches=panels.filter(panel=>panel.id===panelId);
  check(matches.length===1,'This component is missing or has conflicting saved identities. Refresh CNC and review it.',409);
  const component=matches[0],scopePanels=panels.filter(panel=>sameAssemblyOrder(component,panel)),relation=qaAssemblyRelation(component,panels),base=capReference(component)?.parentReference||component.panelNumber;
  check(!panels.some(panel=>qaAssemblyRelation(panel,panels)?.mainPanelId===component.id),'This record is already a main panel. A main panel cannot be included in another panel.',409);
  const candidates=scopePanels.filter(panel=>panel.id!==component.id&&panels.filter(other=>other.id===panel.id).length===1&&!qaAssemblyRelation(panel,panels)&&(panel.id===relation?.mainPanelId||normal(panel.panelNumber)===normal(base)));
  const records=store.read('qa-checks',[]).filter(record=>scopePanels.some(panel=>panel.id===record.id)),areas=scopePanels.map(panel=>[panel.id,store.read('qa-panel-area:'+panel.id,null)]),links=scopePanels.map(panel=>[panel.id,store.read(ASSEMBLY_LINK_PREFIX+panel.id,null)]),revision=store.read('revision',0),restoreEpoch=store.read('restoreEpoch',0);
  check(Number.isSafeInteger(revision)&&revision>=0&&revision<Number.MAX_SAFE_INTEGER&&Number.isSafeInteger(restoreEpoch)&&restoreEpoch>=0,'Refresh the saved production revision',409);
  return {component,relation,candidates,revision,restoreEpoch,snapshot:qaAssemblyHash({scopePanels,records,areas,links,revision,restoreEpoch})};
}
function planFor(store,panelId,mainPanelId){
  const state=stateFor(store,panelId),parent=state.candidates.find(panel=>panel.id===mainPanelId);
  check(parent,'Choose an existing main panel with the same panel reference, project and order. Refresh the review if it changed.',409);
  return {state,plan:{panelId,mainPanelId,component:identity(state.component),parent:identity(parent),snapshot:state.snapshot,revision:state.revision,restoreEpoch:state.restoreEpoch}};
}
export function qaAssemblyLink(store,body,actor){
  check(actor?.isAdmin===true,'Only administrators can associate components with a main panel',403);store.requireTask(actor,'factory.qa');
  check(body&&['context','preview','save'].includes(body.action)&&validId(body.panelId),'Choose an existing component');
  const allowed=new Set(['action','panelId',...(body.action==='context'?[]:['mainPanelId']),...(body.action==='save'?['snapshot','revision','restoreEpoch','mutationId','reason','confirmed']:[])]);
  check(Object.keys(body).every(key=>allowed.has(key)),'Only the reviewed component association can change');
  if(body.action==='context'){
    const state=stateFor(store,body.panelId);return {ok:true,component:identity(state.component),candidates:state.candidates.map(identity),qaAssembly:state.relation,revision:state.revision,restoreEpoch:state.restoreEpoch};
  }
  check(validId(body.mainPanelId),'Choose the full main panel');
  if(body.action==='preview')return {ok:true,plan:planFor(store,body.panelId,body.mainPanelId).plan};
  check(body.confirmed===true,'Confirm this component will be inspected with the full main panel');
  check(typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.trim().length<=1000&&!control.test(body.reason),'Enter the reason for this association');
  check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Start a fresh component review');
  check(typeof body.snapshot==='string'&&/^[a-f0-9]{64}$/.test(body.snapshot)&&Number.isSafeInteger(body.revision)&&Number.isSafeInteger(body.restoreEpoch),'Preview the current association before saving');
  const fingerprint=qaAssemblyHash({...body,reason:body.reason.trim()}),key=ASSEMBLY_LINK_RECEIPT+body.mutationId;let changed=false;
  const result=store.ctx.storage.transactionSync(()=>{
    check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Review the association again.',409);
    const receipt=store.read(key,null);if(receipt){check(receipt.by===actor.username&&receipt.fingerprint===fingerprint,'This review reference was used with different details.',409);return {...receipt.result,idempotent:true};}
    const {state,plan}=planFor(store,body.panelId,body.mainPanelId);
    check(plan.snapshot===body.snapshot&&plan.revision===body.revision&&plan.restoreEpoch===body.restoreEpoch,'The panels, QA evidence or areas changed. Review the association again.',409);
    const at=new Date().toISOString(),previous=store.read(ASSEMBLY_LINK_PREFIX+body.panelId,null),link={schemaVersion:1,id:body.mutationId,panelId:body.panelId,mainPanelId:body.mainPanelId,parentReference:plan.parent.reference,side:capReference(state.component)?.side||null,source:'admin_review',by:actor.username,at},revision=plan.revision+1,summary={panelId:body.panelId,mainPanelId:body.mainPanelId,component:plan.component,parent:plan.parent},result={ok:true,summary,revision};
    store.write(key,{schemaVersion:1,by:actor.username,at,fingerprint,reason:body.reason.trim(),previous,link,snapshot:plan.snapshot,result});
    store.write(ASSEMBLY_LINK_PREFIX+body.panelId,link);store.write('revision',revision);
    store.audit(actor.username,'qa-component-associated',{reviewId:body.mutationId,...summary,reason:body.reason.trim(),previous,revision});changed=true;return result;
  });
  if(changed)store.broadcastRevision(result.revision);return result;
}
