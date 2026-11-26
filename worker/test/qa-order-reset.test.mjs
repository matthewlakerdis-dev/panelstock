import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qaOrderReset} from '../src/qa-order-reset.js';
import {activePanelQaExemption,qaProductionSignature} from '../src/qa-exemptions.js';
import {panelQaResolution} from '../src/qa-resolution.js';
import {panelLoadView} from '../src/panel-dispatch.js';

const admin={username:'admin',isAdmin:true},staff={username:'staff',isAdmin:false},scope={project:'Tower',orderNumber:'007'},cut='2026-11-20T00:00:00Z',checked='2026-11-21T00:00:00Z';
const panel=(id='a',extra={})=>({id,panelNumber:'C1F-'+id,status:'completed',jobReference:'Tower',orderNumber:'007',sheetNumber:'1',completedAt:cut,completedBy:'Cutter',uploadedAt:'2026-11-01T00:00:00Z',uploadedBy:'Uploader',stockItemId:'stock',stockItemType:'variant',stockSku:'AL-SHEET',sheetWidth:3000,sheetHeight:1200,totalPanelArea:1.234,panelAreaScope:'sheet',pdfPage:9,pdfRevision:2,...extra});
const inspection=(id='a',extra={})=>{const attempt={id:'latest-'+id,status:'approved',checkedAt:checked,checkedBy:'Inspector',results:{finish:'pass',dimensions:'pass'},photo:'PRIVATE PHOTO '+id,photos:['PRIVATE SECOND PHOTO '+id],panelArea:{method:'manual',areaM2:1.234},notes:'Original notes'};return {id,kind:'panel',status:'approved',latest:attempt,history:[{id:'older-'+id,status:'recut',photo:'PRIVATE OLD PHOTO '+id,checkedAt:'2026-11-19T00:00:00Z',results:{finish:'fail'}},structuredClone(attempt)],photoAdditions:[{id:'addition-'+id,attemptId:attempt.id,photos:['PRIVATE ADDED PHOTO '+id],addedAt:checked,addedBy:'Other inspector'}],...extra};};
const exemption=p=>({id:p.id,kind:'panel',status:'not_required',latest:null,history:[],qaExemption:{id:'grant-'+p.id,reason:'Cap excluded from QA',by:'Original admin',at:cut,cutAt:p.completedAt,productionSignature:qaProductionSignature(p)},qaExemptionHistory:[{id:'event-'+p.id,action:'grant'}]});
const signature=panels=>JSON.stringify(panels.slice().sort((a,b)=>a.id.localeCompare(b.id)));
let sequence=0;
function fixture(panels=[panel()],records=[inspection()]){
 const docs={'app:cncPanels':structuredClone(panels),'qa-checks':structuredClone(records),'panel-dispatch-loads':[],'qa-dispatches':[],'app:transactions':[{id:'original-activity',source:'cnc',desc:'Original cut',timestamp:cut}],orders:[{id:'order',project:'Tower',orderNumber:'007',status:'completed',completedAt:checked}],'app:variants':[{id:'stock',qty:4}],'app:offcuts':[{id:'offcut',qty:2}],'qa-panel-area:a':{value:{method:'manual',areaM2:1.234},revision:4,cutAt:cut,resetId:'old-area-reset'},revision:12,restoreEpoch:0},writes=[],audits=[],broadcasts=[],tasks=[];
 let hook=null;
 const store={docs,writes,audits,broadcasts,tasks,read:(key,fallback)=>Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback,write:(key,value)=>{writes.push(key);docs[key]=structuredClone(value);},audit:(by,action,detail)=>audits.push({by,action,detail}),broadcastRevision:revision=>broadcasts.push(revision),requireTask:(actor,task)=>{tasks.push(task);assert.equal(task,'factory.qa');if(actor.blockQa)throw Object.assign(Error('QA access required'),{status:403});},qaSettings:()=>({enabledFrom:'2026-11-01T00:00:00Z'}),syncPanelLoads:()=>{throw Error('A QA reset must not reconcile or rewrite production loads');},beforeTransaction:fn=>{hook=fn;},ctx:{storage:{transactionSync:fn=>{
  if(hook){const current=hook;hook=null;current();}
  const before=structuredClone(docs),writeCount=writes.length,auditCount=audits.length;
  try{return fn();}catch(error){for(const key of Object.keys(docs))delete docs[key];Object.assign(docs,before);writes.length=writeCount;audits.length=auditCount;throw error;}
 }}}};return store;
}
const context=(store,extra={})=>qaOrderReset(store,{action:'context',...scope,...extra},admin);
const preview=(store,panelIds=['a'],extra={})=>qaOrderReset(store,{action:'preview',...scope,panelIds,...extra},admin).plan;
const saveBody=(plan,panelIds=['a'],extra={})=>({action:'save',...scope,panelIds,snapshot:plan.snapshot,revision:plan.revision,restoreEpoch:plan.restoreEpoch,mutationId:'qa-order-reset-'+String(++sequence).padStart(5,'0'),reason:'Reinspect against the corrected panel IDs',confirmed:true,...extra});

test('context is read-only, exposes stable identities and never leaks inspection photos',()=>{
 const store=fixture(),before=structuredClone(store.docs),result=context(store);
 assert.equal(result.ok,true);assert.deepEqual(result.scope,scope);assert.equal(result.panels.length,1);
 const item=result.panels[0];assert.equal(item.id,'a');assert.equal(item.panelId,'a');assert.equal(item.panelNumber,'C1F-a');assert.equal(item.completedAt,cut);assert.equal(item.latestAttemptId,'latest-a');assert.equal(item.eligible,true);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE PHOTO|PRIVATE OLD PHOTO|PRIVATE ADDED PHOTO/);assert.deepEqual(store.docs,before);assert.deepEqual(store.writes,[]);assert.deepEqual(store.audits,[]);assert.deepEqual(store.broadcasts,[]);
});

test('all actions require current admin and QA access before inspecting or changing an order',()=>{
 for(const actor of [staff,{...admin,blockQa:true}])for(const action of ['context','preview','save']){
  const store=fixture();assert.throws(()=>qaOrderReset(store,{action,...scope,panelIds:['a']},actor),error=>error.status===403);assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);
 }
});

test('explicit scope handles a legacy blank job and prefixed orders while preserving leading-zero distinctions',()=>{
 const ps=[panel('a',{jobReference:'',orderNumber:'Order 007'}),panel('b',{jobReference:'',orderNumber:'007'}),panel('c',{jobReference:'',orderNumber:'7'}),panel('foreign',{jobReference:'Elsewhere'})],store=fixture(ps,ps.map(p=>inspection(p.id))),before=structuredClone(store.docs),result=context(store,{project:'',orderNumber:'007'});
 assert.deepEqual(result.scope,{project:'',orderNumber:'007'});assert.deepEqual(result.panels.map(p=>p.id),['a','b']);assert.deepEqual(store.docs,before);
 for(const patch of [{project:undefined},{project:'x'.repeat(121)},{project:'bad\nname'},{orderNumber:''},{orderNumber:'bad\torder'},{orderNumber:'x'.repeat(201)}])assert.throws(()=>context(fixture(),patch));
});

test('a reset retains all existing evidence and physical production data and only reopens selected approved QA',()=>{
 const ps=[panel('a'),panel('b')],store=fixture(ps,[inspection('a'),inspection('b')]),waiting={id:'waiting',status:'waiting',panelIds:['a','b'],productionSignature:signature(ps),fabrication:{by:'Fabricator',at:checked},legs:[]};store.docs['panel-dispatch-loads']=[waiting];
 const before=structuredClone(store.docs),plan=preview(store,['a']),result=qaOrderReset(store,saveBody(plan,['a']),admin),saved=store.docs['qa-checks'][0];
 assert.equal(result.ok,true);assert.equal(saved.status,'awaiting');assert.deepEqual(saved.latest,before['qa-checks'][0].latest);assert.deepEqual(saved.history,before['qa-checks'][0].history);assert.deepEqual(saved.photoAdditions,before['qa-checks'][0].photoAdditions);assert.deepEqual(store.docs['qa-checks'][1],before['qa-checks'][1]);
 assert.equal(saved.qaReset.id,result.summary.resetId);assert.equal(saved.qaReset.pending,true);assert.equal(saved.qaReset.by,'admin');assert.equal(saved.qaReset.previousAttemptId,'latest-a');assert.equal(saved.qaReset.cutAt,cut);assert.equal(saved.qaReset.reason,'Reinspect against the corrected panel IDs');assert.ok(Number.isFinite(Date.parse(saved.qaReset.at)));assert.equal(saved.qaResetHistory.length,1);assert.equal(saved.qaResetHistory[0].id,saved.qaReset.id);assert.equal(saved.qaResetHistory[0].previousAttemptId,'latest-a');assert.equal(result.summary.resetCount,1);
 for(const key of ['app:cncPanels','panel-dispatch-loads','qa-dispatches','orders','app:variants','app:offcuts','qa-panel-area:a'])assert.deepEqual(store.docs[key],before[key],key);
 assert.equal(store.docs.revision,13);assert.deepEqual(store.broadcasts,[13]);assert.equal(store.audits.length,1);assert.ok(store.writes.every(key=>key==='qa-checks'||key==='revision'||key.startsWith('qa-panel-order-reset:')));
 const byId=new Map(ps.map(p=>[p.id,p])),qaById=new Map(store.docs['qa-checks'].map(record=>[record.id,record]));assert.equal(panelQaResolution(ps[0],saved,byId,qaById).qaResolved,false);assert.equal(panelLoadView(waiting,ps,store.docs['qa-checks']).ready,false);
});

test('only current approval qualifies, including legacy missing evidence; pending, uninspected, awaiting and failed originals remain excluded',()=>{
 const ps=[panel('approved'),panel('legacy',{completedAt:undefined,completedBy:undefined,totalPanelArea:0,panelAreaScope:'legacy-value'}),panel('pending',{status:'pending',completedAt:null}),panel('uninspected'),panel('awaiting'),panel('recut'),panel('replaced'),panel('empty')],records=[inspection('approved'),inspection('legacy'),inspection('awaiting',{status:'awaiting'}),inspection('recut',{status:'recut'}),inspection('replaced',{status:'replaced'}),{id:'empty',kind:'panel',status:'approved',latest:null,history:[]}],store=fixture(ps,records),items=context(store).panels,eligible=items.filter(item=>item.eligible).map(item=>item.id).sort();
 assert.deepEqual(eligible,['approved','empty','legacy']);for(const item of items.filter(item=>!item.eligible))assert.ok(item.excludedReason?.length>0,item.id);
 const plan=preview(store,['legacy']),before=structuredClone(store.docs);assert.equal(plan.rows[0].completedAt,null);qaOrderReset(store,saveBody(plan,['legacy']),admin);assert.equal(store.docs['qa-checks'].find(r=>r.id==='legacy').qaReset.cutAt,null);assert.deepEqual(store.docs['app:cncPanels'],before['app:cncPanels']);
 const empty=fixture([panel()],[{id:'a',kind:'panel',status:'approved',latest:null,history:[]}]);qaOrderReset(empty,saveBody(preview(empty)),admin);const saved=empty.docs['qa-checks'][0];assert.equal(saved.latest,null);assert.deepEqual(saved.history,[]);assert.equal(saved.qaReset.previousAttemptId,null);assert.equal(saved.status,'awaiting');
});

test('caps and both active and expired not-required exemptions remain outside the reset without any grant changes',()=>{
 const ps=[panel('approved'),panel('cap'),panel('expired')],cap=exemption(ps[1]),expired=exemption(ps[2]);expired.qaExemption.productionSignature='old signature';const store=fixture(ps,[inspection('approved'),cap,expired]),before=structuredClone(store.docs['qa-checks']),items=context(store).panels;
 assert.equal(items.find(item=>item.id==='cap').eligible,false);assert.equal(items.find(item=>item.id==='expired').eligible,false);assert.equal(activePanelQaExemption(ps[1],cap),true);
 qaOrderReset(store,saveBody(preview(store,['approved']),['approved']),admin);assert.deepEqual(store.docs['qa-checks'].slice(1),before.slice(1));assert.equal(activePanelQaExemption(ps[1],store.docs['qa-checks'][1]),true);
});

test('all replacement, remake and separately-resolved links block reopening, including inverse links in other orders',()=>{
 for(const patch of [{remakeOf:'original'},{replacementId:'new'},{replacementStatus:'approved'},{resolvedSeparatelyAt:checked},{resolvedSeparatelyBy:'admin'},{resolvedSeparatelyReason:'External recut'}]){
  const store=fixture([panel()],[inspection('a',patch)]),before=structuredClone(store.docs);assert.equal(context(store).panels[0].eligible,false,JSON.stringify(patch));assert.deepEqual(store.docs,before);
 }
 for(const patch of [{replacementId:'a'},{remakeOf:'a'}]){
  const store=fixture([panel(),panel('foreign',{jobReference:'Other',orderNumber:'8'})],[inspection(),inspection('foreign',patch)]);assert.equal(context(store).panels[0].eligible,false,JSON.stringify(patch));
 }
});

test('non-waiting coating and delivery loads and legacy dispatch lines block resets without changing shipment history',()=>{
 for(const status of ['at_powder_coaters','awaiting_final_qa','ready_for_site','dispatched_to_site']){
  const store=fixture(),load={id:'load',status,panelIds:['a'],productionSignature:signature(store.docs['app:cncPanels']),fabrication:{by:'Fabricator',at:checked},coatingCompleted:{by:'Coater',at:checked},finalQa:{by:'Final inspector',at:checked},legs:[{destinationType:'powder_coaters',reference:'old ID',at:cut},{destinationType:'site',reference:'old ID',at:checked}]};store.docs['panel-dispatch-loads']=[load];const before=structuredClone(store.docs),item=context(store).panels[0];assert.equal(item.eligible,false,status);assert.ok(item.excludedReason.length>0);assert.deepEqual(store.docs,before);
 }
 const legacy=fixture();legacy.docs['qa-dispatches']=[{id:'legacy-dispatch',dispatchedAt:checked,lines:[{id:'a',kind:'panel',reference:'Historic printed name'}]}];assert.equal(context(legacy).panels[0].eligible,false);assert.equal(legacy.writes.length,0);
 const unrelated=fixture();unrelated.docs['panel-dispatch-loads']=[{id:'other-load',status:'dispatched_to_site',panelIds:['different'],legs:[{destinationType:'site'}]}];unrelated.docs['qa-dispatches']=[{id:'other-legacy',lines:[{id:'a',kind:'metalwork'}]}];assert.equal(context(unrelated).panels[0].eligible,true);
});

test('a preview explicitly lists exact selected changes and exclusions without making any production write',()=>{
 const ps=[panel('a'),panel('b'),panel('cap')],store=fixture(ps,[inspection('a'),inspection('b'),exemption(ps[2])]),before=structuredClone(store.docs),plan=preview(store,['b','a']);
 assert.deepEqual(plan.scope,scope);assert.deepEqual([...plan.panelIds].sort(),['a','b']);assert.deepEqual(plan.rows.map(row=>row.panelId).sort(),['a','b']);assert.ok(plan.rows.every(row=>row.oldQaStatus==='approved'&&row.newQaStatus==='awaiting'));assert.ok(plan.excluded.some(item=>item.panelId==='cap'&&item.eligible===false));assert.match(plan.snapshot,/^[a-f0-9]{64}$/);assert.equal(plan.revision,12);assert.equal(plan.restoreEpoch,0);assert.ok(Array.isArray(plan.warnings));assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);
});

test('invalid selection and save inputs cannot change identities, physical fields or evidence',()=>{
 for(const panelIds of [[],['a','a'],['missing'],['a',12],Array.from({length:501},(_,i)=>'p'+i)]){
  const store=fixture();assert.throws(()=>preview(store,panelIds));assert.equal(store.writes.length,0);
 }
 const outside=fixture([panel(),panel('outside',{jobReference:'Other'})],[inspection(),inspection('outside')]);assert.throws(()=>preview(outside,['outside']));
 for(const patch of [{action:'unknown'},{confirmed:false},{confirmed:undefined},{reason:''},{reason:' '},{reason:'x'.repeat(1001)},{reason:'bad\nreason'},{mutationId:'short'},{snapshot:'wrong'},{revision:-1},{restoreEpoch:-1},{panelNumber:'change'},{totalPanelArea:4},{status:'completed'}]){
  const store=fixture(),body=saveBody(preview(store));assert.throws(()=>qaOrderReset(store,{...body,...patch},admin),JSON.stringify(patch));assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
 }
});

test('snapshot rejects changed CNC, exact inspection evidence, selected names, linked progress, deliveries, revision and restore state',()=>{
 const mutations=[store=>{store.docs['app:cncPanels'][0].panelNumber='Corrected after review';},store=>{store.docs['app:cncPanels'][0].completedAt='2026-11-22';},store=>{store.docs['qa-checks'][0].latest.photo='NEW PHOTO';},store=>{store.docs['qa-checks'][0].history[0].notes='New evidence';},store=>{store.docs['qa-checks'][0].photoAdditions[0].photos.push('LATER PHOTO');},store=>{store.docs['panel-dispatch-loads'].push({id:'waiting',status:'waiting',panelIds:['a'],fabrication:{by:'Other',at:checked}});},store=>{store.docs['qa-dispatches'].push({id:'delivery',lines:[{id:'a',kind:'panel'}]});},store=>{store.docs['qa-checks'].push(inspection('foreign',{replacementId:'a'}));},store=>{store.docs.revision++;},store=>{store.docs.restoreEpoch++;}];
 for(const mutate of mutations){const store=fixture(),body=saveBody(preview(store));mutate(store);const before=structuredClone(store.docs);assert.throws(()=>qaOrderReset(store,body,admin),error=>error.status===409);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);}
 const store=fixture([panel('a'),panel('b')],[inspection('a'),inspection('b')]),body=saveBody(preview(store,['a']),['b']);assert.throws(()=>qaOrderReset(store,body,admin),error=>error.status===409);assert.equal(store.writes.length,0);
});

test('independent m² changes do not invalidate a review or get overwritten, while transaction-entry progress races do',()=>{
 const store=fixture(),plan=preview(store);store.docs['qa-panel-area:a']={value:{method:'manual',areaM2:9.87},revision:9,cutAt:cut};const savedArea=structuredClone(store.docs['qa-panel-area:a']);assert.equal(qaOrderReset(store,saveBody(plan),admin).ok,true);assert.deepEqual(store.docs['qa-panel-area:a'],savedArea);assert.ok(!store.writes.some(key=>key.startsWith('qa-panel-area:')));
 const racing=fixture(),body=saveBody(preview(racing));racing.beforeTransaction(()=>{racing.docs['qa-checks'][0].photoAdditions.push({id:'new-concurrent-photo',photos:['Concurrent evidence']});});const originalStatus=racing.docs['qa-checks'][0].status;assert.throws(()=>qaOrderReset(racing,body,admin),error=>error.status===409);assert.equal(racing.docs['qa-checks'][0].status,originalStatus);assert.equal(racing.writes.length,0);
});

test('saved mutation retries do not reopen a later approval and reject changed details, another actor or a restored epoch',()=>{
 const store=fixture(),body=saveBody(preview(store)),first=qaOrderReset(store,body,admin),record=store.docs['qa-checks'][0];record.status='approved';record.latest={...record.latest,id:'later-inspection',checkedAt:'2026-11-22T00:00:00Z'};record.history.push(structuredClone(record.latest));record.qaReset={...record.qaReset,pending:false,attemptId:'later-inspection',inspectedAt:'2026-11-22T00:00:00Z',inspectedBy:'Later inspector'};store.docs.revision++;
 const before=structuredClone(store.docs),counts=[store.writes.length,store.audits.length,store.broadcasts.length],retry=qaOrderReset(store,body,admin);assert.equal(retry.idempotent,true);assert.equal(retry.revision,first.revision);assert.deepEqual(store.docs,before);assert.deepEqual([store.writes.length,store.audits.length,store.broadcasts.length],counts);assert.equal(store.docs['qa-checks'][0].status,'approved');
 assert.throws(()=>qaOrderReset(store,{...body,reason:'Another reason'},admin),error=>error.status===409);assert.throws(()=>qaOrderReset(store,body,{...admin,username:'another-admin'}),error=>error.status===409);store.docs.restoreEpoch++;assert.throws(()=>qaOrderReset(store,body,admin),error=>error.status===409);
});

test('a later explicit reset appends reset history without altering earlier reset metadata or completed inspection attempts',()=>{
 const prior={id:'earlier-reset-00000001',by:'Earlier admin',at:'2026-11-20T01:00:00Z',reason:'Earlier correction',cutAt:cut,previousAttemptId:'older-a',pending:false,attemptId:'latest-a',inspectedAt:checked,inspectedBy:'Inspector'},oldGrant={id:'old-grant',reason:'Historic requirement',productionSignature:'expired signature'},record=inspection('a',{qaReset:prior,qaResetHistory:[{...prior,pending:true}],qaExemption:oldGrant,qaExemptionHistory:[{id:'historic-grant-event',action:'grant'}]}),store=fixture([panel()],[record]),before=structuredClone(record),body=saveBody(preview(store)),result=qaOrderReset(store,body,admin),saved=store.docs['qa-checks'][0];
 assert.equal(saved.status,'awaiting');assert.equal(saved.qaReset.id,body.mutationId);assert.equal(saved.qaReset.previousAttemptId,'latest-a');assert.equal(saved.qaResetHistory.length,2);assert.deepEqual(saved.qaResetHistory[0],before.qaResetHistory[0]);assert.deepEqual(saved.latest,before.latest);assert.deepEqual(saved.history,before.history);assert.deepEqual(saved.qaExemption,before.qaExemption);assert.deepEqual(saved.qaExemptionHistory,before.qaExemptionHistory);assert.equal(result.summary.resetCount,1);
});

test('any persistence failure rolls back the whole QA batch, receipt, revision and audit and never broadcasts',()=>{
 const store=fixture([panel('a'),panel('b')],[inspection('a'),inspection('b')]),plan=preview(store,['a','b']),body=saveBody(plan,['a','b']),before=structuredClone(store.docs),write=store.write;let attempts=0;store.write=(key,value)=>{write(key,value);if(++attempts===2)throw Error('Simulated storage failure');};assert.throws(()=>qaOrderReset(store,body,admin),/Simulated storage failure/);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
});

test('ambiguous stable identities or QA kinds reject safely rather than selecting a convenient duplicate',()=>{
 for(const [panels,records]of [[[panel(),panel()],[inspection()] ],[[panel()],[inspection(),inspection()] ],[[panel()],[{id:'a',kind:'metalwork',status:'approved',latest:{id:'wrong-kind'},history:[]}] ]]){
  const store=fixture(panels,records),before=structuredClone(store.docs);assert.throws(()=>context(store),error=>error.status===409);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);
 }
});
