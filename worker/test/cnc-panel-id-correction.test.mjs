import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correctCompletedPanelId} from '../src/cnc-panel-id-correction.js';
import {activePanelQaExemption,effectivePanelQaStatus,qaProductionSignature} from '../src/qa-exemptions.js';
import {undoCncCompletion} from '../src/cnc-completion-undo.js';

const admin={username:'admin',isAdmin:true},staff={username:'staff',isAdmin:false},cut='2026-11-20T00:00:00Z';
const panel=(id='p',extra={})=>({id,status:'completed',jobReference:'Tower',orderNumber:'007',sheetNumber:'1',panelNumber:'wrong-id',completedAt:cut,completedBy:'Cutter',uploadedAt:'2026-11-01T00:00:00Z',uploadedBy:'Scheduler',stockItemId:'stock',stockItemType:'variant',stockSku:'AL-SHEET',sheetWidth:3000,sheetHeight:1200,totalPanelArea:1.234,panelAreaScope:'sheet',pdfRevision:1,pdfPage:3,isRemake:false,...extra});
const inspected=(id='p',status='approved')=>({id,kind:'panel',status,latest:{id:'attempt-'+id,status,checkedAt:'2026-11-21T00:00:00Z',checkedBy:'Inspector',results:{finish:status==='recut'?'fail':'pass'},panelArea:{method:'manual',areaM2:1.234},photo:'PRIVATE PHOTO',notes:'Original inspection'},history:[{id:'older-'+id,status:'recut',photo:'OLD PRIVATE PHOTO'}],photoAdditions:[{id:'added-photo',photo:'NEW PRIVATE PHOTO'}],replacementId:'replacement',remakeOf:'original'});
const exempt=(p,extra={})=>({id:p.id,kind:'panel',status:'not_required',latest:null,history:[],qaExemption:{id:'grant-'+p.id,reason:'Existing requirement',by:'original-admin',at:'2026-11-20T01:00:00Z',cutAt:p.completedAt??null,productionSignature:qaProductionSignature(p)},qaExemptionHistory:[{id:'event-'+p.id,action:'grant',reason:'Original grant'}],...extra});
const signature=panels=>JSON.stringify(panels.slice().sort((a,b)=>a.id.localeCompare(b.id)));
let sequence=0;
function fixture(panels=[panel()],records=[inspected()]){
  const docs={'app:cncPanels':structuredClone(panels),'qa-checks':structuredClone(records),'panel-dispatch-loads':[],'app:transactions':[{id:'old-activity',type:'cnc',desc:'Original completion',timestamp:cut,qty:''}],'app:variants':[{id:'stock',sku:'AL-SHEET',qty:4}],'app:offcuts':[{id:'saved-offcut',qty:1}],'qa-panel-area:p':{value:{method:'manual',areaM2:1.234},revision:9,cutAt:cut},revision:12,restoreEpoch:0},audits=[],writes=[],broadcasts=[],tasks=[];
  let beforeTransaction=null;
  const store={docs,audits,writes,broadcasts,tasks,read:(key,fallback)=>Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback,write:(key,value)=>{writes.push(key);docs[key]=structuredClone(value);},audit:(by,action,detail)=>audits.push({by,action,detail}),requireTask:(actor,task)=>{tasks.push(task);if(actor.blockCnc)throw Object.assign(Error('CNC access required'),{status:403});},broadcastRevision:revision=>broadcasts.push(revision),syncPanelLoads:()=>{throw Error('A label correction must not reconcile production loads');},beforeTransaction:callback=>{beforeTransaction=callback;},ctx:{storage:{transactionSync:callback=>{
    if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;hook();}
    const before=structuredClone(docs),auditCount=audits.length,writeCount=writes.length;
    try{return callback();}catch(error){for(const key of Object.keys(docs))delete docs[key];Object.assign(docs,before);audits.length=auditCount;writes.length=writeCount;throw error;}
  }}},sql:{exec:query=>{assert.match(query,/SELECT id,payload,revision FROM mutations/);return {toArray:()=>store.origin?[structuredClone(store.origin)]:[]};}}};
  return store;
}
function command(store,newPanelNumber='fixed-id',extra={}){
  const {plan}=correctCompletedPanelId(store,{action:'preview',panelId:extra.panelId||'p'},admin);
  return {action:'save',panelId:plan.panelId,newPanelNumber,reason:'Correct the label to match the drawing',mutationId:'panel-id-correction-'+String(++sequence).padStart(4,'0'),expectedPanelNumber:plan.panelNumber,expectedCompletedAt:plan.completedAt,productionSignature:plan.productionSignature,revision:plan.revision,restoreEpoch:plan.restoreEpoch,...extra};
}

test('read-only preview supports legacy cut rows with absent IDs, completion dates, stock and area fields',()=>{
  const legacy={id:'legacy',status:'completed',panelAreaScope:'wrong-old-value',totalPanelArea:0,orderNumber:'ORDER #7',jobReference:'  OLD JOB  ',isRemake:true},store=fixture([legacy],[]),before=JSON.stringify(store.docs),
    {plan}=correctCompletedPanelId(store,{action:'preview',panelId:'legacy'},admin);
  assert.equal(plan.panelNumber,null);assert.equal(plan.completedAt,null);assert.equal(plan.completedBy,null);assert.equal(plan.project,'  OLD JOB  ');assert.equal(plan.orderNumber,'ORDER #7');assert.equal(plan.revision,12);assert.equal(plan.restoreEpoch,0);assert.equal(plan.productionSignature,qaProductionSignature(legacy));
  assert.equal(JSON.stringify(store.docs),before);assert.deepEqual(store.writes,[]);assert.deepEqual(store.audits,[]);assert.deepEqual(store.broadcasts,[]);assert.equal(store.tasks.at(-1),'factory.cnc');
  const body=command(store,'legacy-FIX',{panelId:'legacy'}),result=correctCompletedPanelId(store,body,admin);
  assert.deepEqual(store.docs['app:cncPanels'][0],{...legacy,panelNumber:'legacy-FIX'});assert.equal(result.summary.oldPanelNumber,null);assert.equal(result.summary.completedAt,null);
});

test('a correction changes only the human label, preserves its exact trimmed case and retains all evidence and stock',()=>{
  const store=fixture(),before=structuredClone(store.docs),body=command(store,'  c1F-27-a  '),result=correctCompletedPanelId(store,body,admin);
  assert.deepEqual(store.docs['app:cncPanels'][0],{...before['app:cncPanels'][0],panelNumber:'c1F-27-a'});
  for(const key of ['qa-checks','qa-panel-area:p','app:variants','app:offcuts'])assert.deepEqual(store.docs[key],before[key]);
  assert.deepEqual(store.docs['app:transactions'].slice(1),before['app:transactions']);assert.equal(store.docs['app:transactions'][0].source,'cnc-panel-id-correction');assert.deepEqual(store.docs['app:transactions'][0].panelRecordIds,['p']);assert.equal(store.docs['app:transactions'][0].oldPanelNumber,'wrong-id');assert.equal(store.docs['app:transactions'][0].newPanelNumber,'c1F-27-a');assert.equal(store.docs['app:transactions'][0].reason,body.reason);
  assert.equal(store.docs.revision,13);assert.deepEqual(store.broadcasts,[13]);assert.equal(store.audits.length,1);assert.equal(store.audits[0].action,'cnc-panel-id-corrected');assert.equal(result.summary.oldPanelNumber,'wrong-id');assert.equal(result.summary.newPanelNumber,'c1F-27-a');assert.equal(result.summary.completedAt,cut);assert.equal(result.summary.qaExemptionRebased,false);
});

test('administrator and CNC access are both required; pending or ambiguous identities cannot be corrected',()=>{
  for(const actor of [staff,{...admin,blockCnc:true}]){
    const store=fixture();assert.throws(()=>correctCompletedPanelId(store,{action:'preview',panelId:'p'},actor),error=>error.status===403);assert.throws(()=>correctCompletedPanelId(store,{},actor),error=>error.status===403);assert.equal(store.writes.length,0);
  }
  for(const panels of [[panel('p',{status:'pending'})],[panel(),panel()]]){
    const store=fixture(panels);assert.throws(()=>correctCompletedPanelId(store,{action:'preview',panelId:'p'},admin),error=>error.status===409);assert.equal(store.writes.length,0);
  }
  assert.throws(()=>correctCompletedPanelId(fixture(),{action:'preview',panelId:'missing'},admin),error=>error.status===404);
});

test('invalid labels, reasons, request fields and attempts to change physical fields reject without writes',()=>{
  const mutations=[...['','  ','x'.repeat(201),'line\nbreak','tab\t','bad\u0000id','bad\u007fid'].map(newPanelNumber=>({newPanelNumber})),...['','  ','x'.repeat(1001),'line\nbreak'].map(reason=>({reason})),{mutationId:'short'},{action:'unknown'},{productionSignature:'old'},{revision:-1},{restoreEpoch:-1},{expectedPanelNumber:undefined},{expectedCompletedAt:undefined},{sheetWidth:5},{totalPanelArea:10}];
  for(const patch of mutations){const store=fixture(),body=command(store);assert.throws(()=>correctCompletedPanelId(store,{...body,...patch},admin));assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);}
});

test('duplicate project/order/sheet identities are blocked for pending and cut records, while case-only correction is allowed',()=>{
  for(const status of ['pending','completed']){
    const store=fixture([panel(),panel('other',{panelNumber:'FIXED-ID',status})]);assert.throws(()=>correctCompletedPanelId(store,command(store),admin),error=>error.status===409);assert.equal(store.writes.length,0);
  }
  for(const extra of [{jobReference:'Other project'},{orderNumber:'008'},{sheetNumber:'2'}]){
    const store=fixture([panel(),panel('other',{panelNumber:'fixed-id',...extra})]);assert.equal(correctCompletedPanelId(store,command(store),admin).ok,true);
  }
  const store=fixture();assert.equal(correctCompletedPanelId(store,command(store,'WRONG-ID'),admin).panelNumber,'WRONG-ID');
});

test('stale row, completion, revision, restore epoch and concurrently changed data reject atomically',()=>{
  for(const mutate of [store=>{store.docs['app:cncPanels'][0].panelNumber='already-fixed';},store=>{store.docs['app:cncPanels'][0].completedAt='changed';},store=>{store.docs['app:cncPanels'][0].completedBy='Changed cutter';},store=>{store.docs.revision++;},store=>{store.docs.restoreEpoch++;}]){
    const store=fixture(),body=command(store);mutate(store);const before=structuredClone(store.docs);assert.throws(()=>correctCompletedPanelId(store,body,admin),error=>error.status===409);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);
  }
  const store=fixture(),body=command(store);store.beforeTransaction(()=>{store.docs.revision++;});assert.throws(()=>correctCompletedPanelId(store,body,admin),error=>error.status===409);assert.equal(store.docs['app:cncPanels'][0].panelNumber,'wrong-id');assert.equal(store.writes.length,0);
});

test('idempotent retries cannot reverse later corrections and actor, payload or restored-backup reuse is rejected',()=>{
  const store=fixture(),first=command(store),original=correctCompletedPanelId(store,first,admin),second=command(store,'later-ID');correctCompletedPanelId(store,second,admin);
  const before=structuredClone(store.docs),writes=store.writes.length,audits=store.audits.length,broadcasts=store.broadcasts.length,retry=correctCompletedPanelId(store,first,admin);
  assert.equal(retry.idempotent,true);assert.equal(retry.revision,original.revision);assert.equal(retry.summary.newPanelNumber,'fixed-id');assert.deepEqual(store.docs,before);assert.equal(store.writes.length,writes);assert.equal(store.audits.length,audits);assert.equal(store.broadcasts.length,broadcasts);
  assert.throws(()=>correctCompletedPanelId(store,{...first,newPanelNumber:'other'},admin),error=>error.status===409);assert.throws(()=>correctCompletedPanelId(store,first,{...admin,username:'other-admin'}),error=>error.status===409);
  store.docs.restoreEpoch++;assert.throws(()=>correctCompletedPanelId(store,first,admin),error=>error.status===409);assert.equal(store.docs['app:cncPanels'][0].panelNumber,'later-ID');
});

test('only an already-active QA exemption is rebased, preserving its grant, inspection history and other records',()=>{
  const p=panel(),record=exempt(p),other=inspected('other'),store=fixture([p],[record,other]),before=structuredClone(store.docs['qa-checks']),result=correctCompletedPanelId(store,command(store),admin),saved=store.docs['qa-checks'][0];
  assert.equal(result.summary.qaExemptionRebased,true);assert.equal(activePanelQaExemption(store.docs['app:cncPanels'][0],saved),true);assert.equal(saved.qaExemption.productionSignature,qaProductionSignature(store.docs['app:cncPanels'][0]));
  assert.deepEqual(saved.qaExemption,{...before[0].qaExemption,productionSignature:saved.qaExemption.productionSignature});assert.deepEqual(saved.qaExemptionHistory,before[0].qaExemptionHistory);assert.deepEqual(saved.history,before[0].history);assert.equal(saved.latest,null);assert.equal(saved.status,'not_required');assert.deepEqual(store.docs['qa-checks'][1],other);
});

test('restoring a label that matches an expired exemption never revives QA exemption or changes its old grant/history',()=>{
  const p=panel(),record=exempt({...p,panelNumber:'fixed-id'}),before=structuredClone(record),store=fixture([p],[record]);
  assert.equal(effectivePanelQaStatus(p,record),'awaiting');const body=command(store),result=correctCompletedPanelId(store,body,admin),saved=store.docs['qa-checks'][0];
  assert.equal(result.summary.qaExemptionRebased,false);assert.equal(result.summary.qaExemptionKeptInactive,true);assert.equal(effectivePanelQaStatus(store.docs['app:cncPanels'][0],saved),'awaiting');assert.equal(activePanelQaExemption(store.docs['app:cncPanels'][0],saved),false);
  assert.equal(saved.qaExemption.productionSignature,before.qaExemption.productionSignature);assert.equal(saved.qaExemption.id,before.qaExemption.id);assert.equal(saved.qaExemption.reason,before.qaExemption.reason);assert.equal(saved.qaExemption.by,before.qaExemption.by);assert.equal(saved.qaExemption.at,before.qaExemption.at);assert.equal(saved.qaExemption.invalidatedByCorrection,body.mutationId);assert.ok(saved.qaExemption.invalidatedAt);assert.deepEqual(saved.qaExemptionHistory,before.qaExemptionHistory);
});

test('other expired, inspected, recut and replaced QA states remain unchanged and never become approved',()=>{
  const p=panel(),expired=exempt(p);expired.qaExemption.productionSignature='not-the-current-signature';
  for(const record of [expired,inspected('p','recut'),inspected('p','replaced'),inspected(),{...exempt(p),history:[{status:'recut',photo:'PRIVATE'}]}]){
    const store=fixture([p],[record]),before=structuredClone(store.docs['qa-checks']),result=correctCompletedPanelId(store,command(store),admin);assert.equal(result.summary.qaExemptionRebased,false);assert.equal(result.summary.qaExemptionKeptInactive,false);assert.deepEqual(store.docs['qa-checks'],before);assert.ok(!store.writes.includes('qa-checks'));
  }
});

test('valid waiting signatures are rebased without losing fabrication; stale waiting and sent manifests remain untouched',()=>{
  const p=panel(),other=panel('other',{panelNumber:'other-id'}),store=fixture([p,other],[inspected()]),fabrication={by:'Fabricator',at:cut,notes:'Preserve original completion'},
    waiting={id:'waiting',status:'waiting',panelIds:['p','other'],productionSignature:signature([p,other]),fabrication,legs:[]},
    stale={...waiting,id:'stale',productionSignature:'already stale'},sent={...waiting,id:'sent',status:'dispatched_to_site',legs:[{reference:'wrong-id',at:cut}]},coating={...waiting,id:'coating',status:'at_powder_coaters',coatingCompleted:{by:'Coater'}};
  store.docs['panel-dispatch-loads']=[waiting,stale,sent,coating];const result=correctCompletedPanelId(store,command(store),admin),loads=store.docs['panel-dispatch-loads'];
  assert.equal(result.summary.waitingLoadsUpdated,1);assert.equal(loads[0].productionSignature,signature(store.docs['app:cncPanels']));assert.deepEqual({...loads[0],productionSignature:waiting.productionSignature},waiting);assert.deepEqual(loads.slice(1),[stale,sent,coating]);
});

test('ambiguous QA identities and storage failures cannot leave a partial label, exemption, load or activity correction',()=>{
  for(const records of [[inspected(),inspected()],[{id:'p',kind:'metalwork',status:'approved'}]]){
    const store=fixture([panel()],records);assert.throws(()=>correctCompletedPanelId(store,command(store),admin),error=>error.status===409);assert.equal(store.writes.length,0);
  }
  const p=panel(),store=fixture([p],[exempt(p)]);store.docs['panel-dispatch-loads']=[{id:'waiting',status:'waiting',panelIds:['p'],productionSignature:signature([p]),fabrication:{by:'F'}}];
  const body=command(store),before=structuredClone(store.docs),write=store.write;store.write=(key,value)=>{if(key==='app:transactions')throw Error('Storage unavailable');write(key,value);};
  assert.throws(()=>correctCompletedPanelId(store,body,admin),/Storage unavailable/);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
});

test('a waiting load with another ambiguous member is not treated as an exact production group',()=>{
  const p=panel(),first=panel('other',{panelNumber:'other-first'}),second=panel('other',{panelNumber:'other-second'}),store=fixture([p,first,second],[inspected()]),
    load={id:'ambiguous-load',status:'waiting',panelIds:['p','other'],productionSignature:signature([p,second]),fabrication:{by:'Preserve original fabricator'},legs:[]};
  store.docs['panel-dispatch-loads']=[load];const result=correctCompletedPanelId(store,command(store),admin);
  assert.equal(result.summary.waitingLoadsUpdated,0);assert.deepEqual(store.docs['panel-dispatch-loads'],[load]);assert.ok(!store.writes.includes('panel-dispatch-loads'));assert.equal(store.docs['app:cncPanels'][0].panelNumber,'fixed-id');
});

test('the same physical sheet remains undoable after correcting its ID, using its immutable original completion reference',()=>{
  const p=panel('p',{offcutOutcome:'none',savedOffcuts:[]}),stock={id:'stock',sku:'AL-SHEET',color:'Milled',material:'Solid Aluminium',thickness:3,width:3000,height:1200,qty:4,catalogId:'cat'},
    dispatch={id:'stock-dispatch',type:'dispatch',source:'cnc',timestamp:cut,qty:1,itemType:'variant',sku:stock.sku,orderNumber:p.orderNumber,panelIds:['wrong-id']},
    changes=[{field:'cncPanels',id:p.id,before:{...p,status:'pending'},after:p},{field:'variants',id:stock.id,before:{...stock,qty:5},after:stock},{field:'transactions',id:dispatch.id,before:null,after:dispatch}],store=fixture([p],[]);
  store.docs['app:variants']=[stock];store.docs['app:offcuts']=[];store.docs['app:transactions']=[dispatch];store.origin={id:'original-cut',payload:JSON.stringify(changes),revision:2};
  correctCompletedPanelId(store,command(store,'corrected-id'),admin);const originalHistory=store.origin.payload;
  const {plan}=undoCncCompletion(store,{action:'preview',panelId:'p',expectedCompletedAt:cut},admin);
  assert.deepEqual(plan.stockAdjustments.map(value=>value.delta),[1]);assert.equal(plan.panels[0].panelNumber,'corrected-id');
  store.syncPanelLoads=()=>{};undoCncCompletion(store,{action:'undo',panelId:'p',expectedCompletedAt:cut,revision:plan.revision,restoreEpoch:plan.restoreEpoch,reason:'Operator marked cut incorrectly',mutationId:'undo-after-id-correction-0001'},admin);
  assert.equal(store.docs['app:cncPanels'][0].status,'pending');assert.equal(store.docs['app:cncPanels'][0].panelNumber,'corrected-id');assert.equal(store.docs['app:variants'][0].qty,5);assert.equal(store.docs['app:transactions'].find(value=>value.id===dispatch.id).voided,true);assert.equal(store.origin.payload,originalHistory);
});
