import {readPanelAreaWithSticker} from '../src/qa-panel-area.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {panelQaResetEnrolled,panelQaApplies,assertPanelQaResetToken,inspectionResetFields,inspectionHistoryForReset} from '../src/qa-panel-reset.js';
import {qaOrderReset} from '../src/qa-order-reset.js';
import {correctCompletedPanelId} from '../src/cnc-panel-id-correction.js';
import {undoCncCompletion} from '../src/cnc-completion-undo.js';
import {requireCondition as check,HttpError,normalizeUsername} from '../src/security.js';
import {panelQaResolution} from '../src/qa-resolution.js';
import {migrateQaRecords} from '../src/qa-status.js';
import {activePanelQaExemption,panelQaExemptionFields,qaExemptionShippedIds} from '../src/qa-exemptions.js';
import {panelAreaFor,panelAreaFields,preparePanelArea,commitPanelArea,readPanelAreas} from '../src/qa-panel-area.js';
import {reconcilePanelLoads} from '../src/panel-dispatch.js';
import {qaInspectionEvidence} from '../src/qa-photos.js';
import {qaWriteGuard,assertQaWriteGuard} from '../src/qa-media.js';
import {fabricationProductionReportRows} from '../src/fabrication-production-report.js';

const admin={username:'inspector',isAdmin:true},scope={project:'Tower',orderNumber:'007'},cut='2026-10-01T00:00:00Z',checked='2026-10-02T00:00:00Z',enabledFrom='2026-11-01T00:00:00Z';
const panel=(extra={})=>({id:'legacy',panelNumber:'OLD-ID',status:'completed',jobReference:scope.project,orderNumber:scope.orderNumber,sheetNumber:'1',completedAt:cut,completedBy:'Cutter',panelAreaScope:'sheet',totalPanelArea:8.76,...extra});
const attempt=(extra={})=>({id:'old-attempt',status:'approved',checkedAt:checked,checkedBy:'Old inspector',results:{finish:'pass'},photo:'OLD PRIVATE PHOTO',panelArea:{method:'manual',areaM2:1.234},...extra});
const reset=(extra={})=>({schemaVersion:1,id:'qa-order-reset-00000001',at:'2026-11-26T00:00:00Z',by:'admin',reason:'Corrected identifiers',cutAt:cut,previousAttemptId:'old-attempt',pending:true,...extra});
const record=(extra={})=>({id:'legacy',kind:'panel',status:'awaiting',latest:attempt(),history:[attempt()],photoAdditions:[{id:'addition',attemptId:'old-attempt',photos:['EXTRA PRIVATE PHOTO']}],qaReset:reset(),qaResetHistory:[{...reset(),previousStatus:'approved',referenceAtReset:'OLD-ID'}],...extra});
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
function method(name,next){
 const find=value=>{const plain=source.indexOf('  '+value+'('),async=source.indexOf('  async '+value+'(');return plain<0?async:async<0?plain:Math.min(plain,async);};
 const start=find(name),end=find(next);assert.ok(start>=0&&end>start,'Extract current store method '+name);return source.slice(start,end).trim();
}
const methods=[['qaPanelItem','qaItemsFor'],['qaItemsFor','qaOrderReport'],['qaOrderReport','createQaMetalwork'],['syncPanelLoads','panelDispatchLoads'],['submitQaCheck','replaceSupervisor'],['requireTask','requireMutationTasks']].map(([name,next])=>method(name,next)).join(',\n');
const cleanText=(value,max=200)=>String(value??'').trim().slice(0,max),envelope=(body,status=200)=>({body,status});
function harness(ps=[panel()],rs=[record()],extra={}){
 const docs={'app:cncPanels':structuredClone(ps),'qa-checks':structuredClone(rs),'panel-dispatch-loads':[],'qa-dispatches':[],orders:[],'app:transactions':[],'app:variants':[],'app:offcuts':[],revision:12,restoreEpoch:0},writes=[],audits=[],broadcasts=[];
 let mediaHook=null;
 const deps={readPanelAreaWithSticker,cleanText,check,HttpError,ok:envelope,normalizeUsername,migrateQaRecords,panelQaResolution,activePanelQaExemption,panelQaExemptionFields,qaExemptionShippedIds,panelQaResetEnrolled,panelQaApplies,assertPanelQaResetToken,inspectionResetFields,inspectionHistoryForReset,panelAreaFor,panelAreaFields,preparePanelArea,commitPanelArea,readPanelAreas,reconcilePanelLoads,qaInspectionEvidence,qaWriteGuard,assertQaWriteGuard,
  supportPhoto:value=>value||'',currentGateQaRecord:()=>true,gateQaOrderMetadata:order=>order,requireCurrentGateQa:()=>{throw Error('Only panel inspection expected');},syncGateQaProgress:(_store,item)=>{assert.equal(item.kind,'panel');},readyOrderIds:()=>new Set(),notifyReadyOrders:()=>{},externalizeQaValue:async(store,value)=>{if(mediaHook)await mediaHook(store);return value;}};
 const store=Object.assign(new Function(...Object.keys(deps),'return ({'+methods+'});')(...Object.values(deps)),{
  docs,writes,audits,broadcasts,env:{QA_MEDIA_ENABLED:'false'},read:(key,fallback)=>Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback,write:(key,value)=>{writes.push(key);docs[key]=structuredClone(value);},audit:(by,action,detail)=>audits.push({by,action,detail}),broadcastRevision:revision=>broadcasts.push(revision),qaSettings:()=>({enabledFrom,panelChecks:[['finish','Finish']],requireQaPhoto:false,requireFailurePhoto:false,preventSelfApproval:false}),qaChecklists:()=>({panel:[['finish','Finish']]}),panelCoatingStock:()=>[],duringMedia:fn=>{mediaHook=fn;},
  sql:{exec(query,key){let rows=[];if(query.startsWith('SELECT value FROM documents'))rows=Object.hasOwn(docs,key)?[{value:JSON.stringify(docs[key])}]:[];else if(query.includes("key GLOB 'qa-panel-area:*'"))rows=Object.entries(docs).filter(([key])=>key.startsWith('qa-panel-area:')).map(([key,value])=>({key,value:JSON.stringify(value)}));else if(!/FROM (access_users|user_task_access|role_task_access|user_roles)/.test(query))throw Error('Unexpected SQL in fixture: '+query);rows.toArray=()=>rows;return rows;}},
  ctx:{storage:{transactionSync:fn=>{const before=structuredClone(docs),writeCount=writes.length,auditCount=audits.length;try{return fn();}catch(error){for(const key of Object.keys(docs))delete docs[key];Object.assign(docs,before);writes.length=writeCount;audits.length=auditCount;throw error;}}}},...extra
 });return store;
}
const submit=(store,extra={})=>store.submitQaCheck({id:'legacy',kind:'panel',expectedQaResetId:store.docs['qa-checks'][0].qaReset?.id??null,results:{finish:'pass'},notes:'Rechecked corrected panel',photo:'NEW PRIVATE PHOTO',...extra},admin);

test('legacy enrollment is tied to an explicit valid reset and its cut, survives consumption and ID correction, and expires on Undo or recut',()=>{
 const p=panel(),r=record();assert.equal(panelQaResetEnrolled(p,r),true);assert.equal(panelQaResetEnrolled(p,{...r,qaReset:{...r.qaReset,pending:false}}),true);assert.equal(panelQaResetEnrolled({...p,panelNumber:'CORRECTED-ID'},r),true);
 for(const [changedPanel,changedRecord]of [[{...p,status:'pending'},r],[{...p,completedAt:'2026-11-27'},r],[p,{...r,kind:'metalwork'}],[p,{...r,qaReset:{...r.qaReset,schemaVersion:undefined}}],[p,{...r,qaReset:{...r.qaReset,id:'short'}}],[p,{...r,qaReset:{...r.qaReset,cutAt:undefined}}],[p,{...r,qaReset:{...r.qaReset,pending:undefined}}]])assert.equal(panelQaResetEnrolled(changedPanel,changedRecord),false);
 const undated=panel({completedAt:undefined}),enrolled=record({qaReset:reset({cutAt:null})});assert.equal(panelQaResetEnrolled(undated,enrolled),true);assert.equal(panelQaResetEnrolled({...undated,completedAt:'new-cut'},enrolled),false);
});

test('QA applicability preserves modern and exempt rules while enrolling only the specifically reset legacy cut',()=>{
 assert.equal(panelQaApplies(panel(),null,enabledFrom),false);assert.equal(panelQaApplies(panel({completedAt:'2026-11-02'}),null,enabledFrom),true);assert.equal(panelQaApplies(panel(),record(),enabledFrom),true);assert.equal(panelQaApplies(panel(),record({qaReset:{...reset(),pending:false}}),enabledFrom),true);assert.equal(panelQaApplies(panel(),{kind:'panel',qaExemptionHistory:[{id:'grant'}]},enabledFrom),true);assert.equal(panelQaApplies(panel({status:'pending'}),record(),enabledFrom),false);assert.equal(panelQaApplies(panel({completedAt:'2026-10-03T00:00:00Z'}),record(),enabledFrom),false);
});

test('reset tokens reject old open forms before and after consumption, while unrelated pre-reset inspections remain compatible',()=>{
 for(const pending of [true,false]){
  const r=record({qaReset:reset({pending})});for(const input of [{},{expectedQaResetId:undefined},{expectedQaResetId:null},{expectedQaResetId:'previous-reset-00000001'}])assert.throws(()=>assertPanelQaResetToken(r,input),error=>error.status===409);
  assert.doesNotThrow(()=>assertPanelQaResetToken(r,{expectedQaResetId:r.qaReset.id}));
 }
 assert.doesNotThrow(()=>assertPanelQaResetToken(null,{}));assert.doesNotThrow(()=>assertPanelQaResetToken(null,{expectedQaResetId:null}));assert.throws(()=>assertPanelQaResetToken(null,{expectedQaResetId:'old-reset-00000000001'}),error=>error.status===409);
});

test('inspection consumes only the current pending reset and retains its history and original immutable cycle metadata',()=>{
 const p=panel(),existing=record(),before=structuredClone(existing),nextAttempt=attempt({id:'new-attempt',checkedAt:'2026-11-26T01:00:00Z',checkedBy:'New inspector'}),fields=inspectionResetFields(p,existing,nextAttempt);
 assert.deepEqual(fields.qaReset,{...existing.qaReset,pending:false,attemptId:nextAttempt.id,inspectedAt:nextAttempt.checkedAt,inspectedBy:nextAttempt.checkedBy});assert.deepEqual(fields.qaResetHistory,existing.qaResetHistory);assert.deepEqual(existing,before);
 assert.deepEqual(inspectionResetFields(p,{...existing,...fields},attempt({id:'another-attempt'})),fields);assert.equal(inspectionResetFields({...p,completedAt:'changed'},existing,nextAttempt).qaReset.pending,true);assert.deepEqual(inspectionResetFields(p,null,nextAttempt),{});
});

test('actual QA queue, report and dispatch synchronization retain reset legacy rows before and after reinspection',()=>{
 const ps=[panel(),panel({id:'not-enrolled',panelNumber:'OTHER-ID'})],store=harness(ps,[record()]),before=structuredClone(store.docs),queue=store.qaItemsFor(admin),report=store.qaOrderReport(scope,admin).body.report;
 assert.deepEqual(queue.items.map(item=>item.id),['legacy']);assert.equal(queue.preQaCount,1);assert.equal(queue.items[0].status,'awaiting');assert.equal(report.items.find(item=>item.id==='legacy').status,'awaiting');assert.equal(report.items.find(item=>item.id==='not-enrolled').status,'pre_qa');assert.deepEqual(store.docs,before);
 assert.deepEqual(store.syncPanelLoads().flatMap(load=>load.panelIds),['legacy']);const r=store.docs['qa-checks'][0],newAttempt=attempt({id:'new-approval',checkedAt:'2026-11-26T01:00:00Z'});store.docs['qa-checks'][0]={...r,status:'approved',latest:newAttempt,history:[...r.history,newAttempt],...inspectionResetFields(ps[0],r,newAttempt)};
 assert.equal(store.qaItemsFor(admin).items[0].status,'approved');assert.equal(store.qaOrderReport(scope,admin).body.report.items.find(item=>item.id==='legacy').status,'approved');assert.deepEqual(store.syncPanelLoads().flatMap(load=>load.panelIds),['legacy']);
 store.docs['app:cncPanels'][0].status='pending';assert.equal(store.qaItemsFor(admin).items.length,0);assert.equal(store.qaOrderReport(scope,admin).body.report.items.find(item=>item.id==='legacy').status,'awaiting_routing');
});

test('actual submission rejects stale reset tokens both pending and consumed without modifying evidence',async()=>{
 for(const pending of [true,false])for(const stale of [undefined,null,'old-reset-00000001']){
  const store=harness([panel()],[record({status:pending?'awaiting':'approved',qaReset:reset({pending})})]),before=structuredClone(store.docs);
  await assert.rejects(submit(store,{expectedQaResetId:stale}),error=>error.status===409);assert.deepEqual(store.docs,before);assert.deepEqual(store.writes,[]);assert.deepEqual(store.audits,[]);
 }
 const store=harness(),before=structuredClone(store.docs['qa-checks'][0]),result=await submit(store),saved=store.docs['qa-checks'][0];assert.equal(result.body.item.status,'approved');assert.equal(saved.qaReset.pending,false);assert.equal(saved.qaReset.at,before.qaReset.at);assert.equal(saved.qaReset.id,before.qaReset.id);assert.equal(saved.qaReset.attemptId,saved.latest.id);assert.deepEqual(saved.qaResetHistory,before.qaResetHistory);assert.deepEqual(saved.photoAdditions,before.photoAdditions);assert.deepEqual(saved.history[0],before.history[0]);
});

test('an inspection paused during evidence externalization cannot overwrite a newer administrative QA reset',async()=>{
 const store=harness([panel()],[record({status:'approved',qaReset:reset({pending:false,attemptId:'old-attempt'})})]);store.env.QA_MEDIA_ENABLED='true';let reviewed=false;
 store.duringMedia(async()=>{const plan=qaOrderReset(store,{action:'preview',...scope,panelIds:['legacy']},admin).plan;qaOrderReset(store,{action:'save',...scope,panelIds:['legacy'],snapshot:plan.snapshot,revision:plan.revision,restoreEpoch:plan.restoreEpoch,mutationId:'qa-order-reset-during-media',reason:'Newer drawing requires a new inspection',confirmed:true},admin);reviewed=true;});
 const oldReset=store.docs['qa-checks'][0].qaReset.id;await assert.rejects(submit(store,{expectedQaResetId:oldReset}),error=>error.status===409);assert.equal(reviewed,true);assert.equal(store.docs['qa-checks'][0].status,'awaiting');assert.equal(store.docs['qa-checks'][0].qaReset.id,'qa-order-reset-during-media');assert.equal(store.docs['qa-checks'][0].latest.id,'old-attempt');assert.deepEqual(store.writes,['qa-panel-order-reset:qa-order-reset-during-media','qa-checks','revision']);assert.equal(store.audits.length,1);assert.equal(store.audits[0].action,'qa-panel-order-reset');
});

test('reinspection retains a latest-only area and previous inspection evidence without inventing historical checklist results',async()=>{
 const latest=attempt(),store=harness([panel()],[record({latest,history:[]})]),before=structuredClone(store.docs['qa-checks'][0]);await submit(store);const saved=store.docs['qa-checks'][0];assert.deepEqual(saved.latest.panelArea,latest.panelArea);assert.deepEqual(saved.photoAdditions,before.photoAdditions);assert.ok(saved.history.some(item=>item.id===latest.id&&item.photo===latest.photo&&item.results.finish==='pass'));assert.equal(saved.history.at(-1).id,saved.latest.id);assert.equal(store.docs['qa-panel-area:legacy'],undefined);
 const empty=harness([panel()],[record({latest:null,history:[]})]);await submit(empty);assert.equal(empty.docs['qa-checks'][0].history.length,1);assert.equal(empty.docs['qa-checks'][0].qaReset.previousAttemptId,'old-attempt');
});

test('a global m² tombstone remains authoritative during reinspection instead of resurrecting old latest or CNC area',async()=>{
 const store=harness([panel({panelAreaScope:'panel',totalPanelArea:9.87})],[record()]),tombstone={value:null,resetId:'area-reset-00000001',revision:7,cutAt:cut};store.docs['qa-panel-area:legacy']=structuredClone(tombstone);assert.equal(store.qaItemsFor(admin).items[0].panelArea,null);await submit(store);const saved=store.docs['qa-checks'][0];assert.equal(Object.hasOwn(saved.latest,'panelArea'),false);assert.deepEqual(store.docs['qa-panel-area:legacy'],tombstone);assert.equal(store.qaItemsFor(admin).items[0].panelArea,null);assert.ok(!store.writes.some(key=>key.startsWith('qa-panel-area:')));
});

test('a manual ID-only correction between reset and reinspection preserves legacy enrollment, reset marker and evidence',async()=>{
 const store=harness([panel({completedAt:undefined})],[record({qaReset:reset({cutAt:null})})]),oldRecord=structuredClone(store.docs['qa-checks'][0]),{plan}=correctCompletedPanelId(store,{action:'preview',panelId:'legacy'},admin);correctCompletedPanelId(store,{action:'save',panelId:'legacy',newPanelNumber:'Corrected-ID',reason:'Correct panel reference',mutationId:'correct-enrolled-panel-0001',expectedPanelNumber:plan.panelNumber,expectedCompletedAt:plan.completedAt,productionSignature:plan.productionSignature,revision:plan.revision,restoreEpoch:plan.restoreEpoch},admin);
 assert.deepEqual(store.docs['qa-checks'][0],oldRecord);assert.equal(store.qaItemsFor(admin).items[0].reference,'Corrected-ID');assert.equal(store.qaOrderReport(scope,admin).body.report.items[0].status,'awaiting');await submit(store);assert.equal(store.qaItemsFor(admin).items[0].status,'approved');assert.equal(store.docs['qa-checks'][0].qaReset.pending,false);assert.equal(store.docs['qa-checks'][0].qaReset.cutAt,null);assert.equal(store.docs['app:cncPanels'][0].completedAt,undefined);
});

test('an otherwise empty legacy QA reset still counts as QA progress and prevents stock-changing Undo',()=>{
 for(const patch of [{qaReset:reset(),qaResetHistory:[]},{qaReset:undefined,qaResetHistory:[reset()]}]){
  const p=panel(),store=harness([p],[record({latest:null,history:[],photoAdditions:[],...patch})]),origin={id:'original-cut',revision:2,payload:JSON.stringify([{field:'cncPanels',id:p.id,before:{...p,status:'pending',completedAt:null},after:p}])},exec=store.sql.exec;store.sql.exec=(query,...args)=>query.includes('FROM mutations')?{toArray:()=>[origin]}:exec(query,...args);const before=structuredClone(store.docs);
  assert.throws(()=>undoCncCompletion(store,{action:'preview',panelId:p.id,expectedCompletedAt:cut},admin),error=>error.status===409&&/QA has already been recorded/.test(error.message));assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
 }
});

test('fabrication reporting uses the fresh inspection cycle after reset while retaining earliest approval behavior for ordinary records',async()=>{
 for(const completedAt of [cut,undefined]){
  const p=panel({completedAt}),r=record({qaReset:reset({cutAt:completedAt??null})}),store=harness([p],[r]);assert.deepEqual(fabricationProductionReportRows([p],[{...r,status:'approved'}]),[]);await submit(store);const saved=store.docs['qa-checks'][0],rows=fabricationProductionReportRows(store.docs['app:cncPanels'],store.docs['qa-checks']);assert.deepEqual(rows,[{id:'legacy',completedAt:saved.latest.checkedAt,areaM2:1.234}]);assert.notEqual(rows[0].completedAt,checked);
  const {qaReset,qaResetHistory,...ordinary}=saved,earliest=attempt({id:'first-approval',checkedAt:'2026-10-01T12:00:00Z'});ordinary.history=[earliest,...ordinary.history];assert.equal(fabricationProductionReportRows([p],[ordinary])[0].completedAt,earliest.checkedAt);
 }
});
