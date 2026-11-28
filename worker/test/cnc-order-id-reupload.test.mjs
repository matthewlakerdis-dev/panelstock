import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderIdReupload,stageCncOrderIdAnalysis} from '../src/cnc-order-id-reupload.js';
import {correctCompletedPanelId} from '../src/cnc-panel-id-correction.js';
import {activePanelQaExemption,effectivePanelQaStatus,qaProductionSignature} from '../src/qa-exemptions.js';
import {undoCncCompletion} from '../src/cnc-completion-undo.js';
import {attestQaAssemblyPanels} from '../src/qa-assemblies.js';

const admin={username:'admin',isAdmin:true},staff={username:'staff',isAdmin:false},scope={project:'Tower',orderNumber:'007'},cut='2026-11-20T00:00:00Z',source={fileName:'replacement.pdf',sha256:'a'.repeat(64),bytes:1234};
const panel=(id,label,status='completed',extra={})=>({id,panelNumber:label,status,jobReference:'Tower',orderNumber:'007',sheetNumber:'1',completedAt:status==='completed'?cut:null,completedBy:status==='completed'?'Cutter':null,uploadedAt:'2026-11-01T00:00:00Z',uploadedBy:'Original uploader',stockItemId:'stock',stockItemType:'variant',stockSku:'AL-SHEET',sheetWidth:3000,sheetHeight:1200,totalPanelArea:1.234,panelAreaScope:'sheet',pdfPage:9,pdfRevision:2,...extra});
const inspection=(id,status='approved')=>({id,kind:'panel',status,latest:{id:'check-'+id,status,checkedAt:'2026-11-21T00:00:00Z',checkedBy:'Inspector',results:{finish:status==='recut'?'fail':'pass'},photo:'PRIVATE PHOTO',panelArea:{method:'manual',areaM2:1.234}},history:[{id:'first-'+id,status:'recut',notes:'Original history'}]});
const exemption=p=>({id:p.id,kind:'panel',status:'not_required',latest:null,history:[],qaExemption:{id:'grant-'+p.id,reason:'Existing exemption',by:'Original admin',at:cut,cutAt:p.completedAt,productionSignature:qaProductionSignature(p)},qaExemptionHistory:[{action:'grant',id:'event-'+p.id}]});
const loadSignature=panels=>JSON.stringify(panels.slice().sort((a,b)=>a.id.localeCompare(b.id)));
let seq=0;
function fixture(panels=[panel('a','old-A'),panel('b','old-B','pending')],records=[inspection('a')]){
  const docs={'app:cncPanels':structuredClone(panels),'qa-checks':structuredClone(records),'panel-dispatch-loads':[],'app:transactions':[{id:'original-activity',type:'cnc',desc:'Original cut',timestamp:cut,qty:''}],'app:variants':[{id:'stock',sku:'AL-SHEET',qty:4}],'app:offcuts':[{id:'offcut',qty:2}],'qa-panel-area:a':{value:null,resetId:'keep-reset-marker',revision:3,cutAt:cut},orders:[{id:'order',status:'completed',project:'Tower',orderNumber:'007'}],revision:12,restoreEpoch:0},writes=[],audits=[],broadcasts=[];
  let hook=null;
  const store={docs,writes,audits,broadcasts,read:(key,fallback)=>Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback,write:(key,value)=>{writes.push(key);docs[key]=structuredClone(value);},audit:(by,action,detail)=>audits.push({by,action,detail}),requireTask:(actor,task)=>{assert.equal(task,'factory.cnc');if(actor.blockCnc)throw Object.assign(Error('CNC access required'),{status:403});},broadcastRevision:revision=>broadcasts.push(revision),syncPanelLoads:()=>{throw Error('ID-only upload must not reset production loads');},beforeTransaction:fn=>{hook=fn;},ctx:{storage:{transactionSync:fn=>{
    if(hook){const current=hook;hook=null;current();}
    const before=structuredClone(docs),writesBefore=writes.length,auditsBefore=audits.length;
    try{return fn();}catch(error){for(const key of Object.keys(docs))delete docs[key];Object.assign(docs,before);writes.length=writesBefore;audits.length=auditsBefore;throw error;}
  }}},sql:{exec:query=>{assert.match(query,/SELECT id,payload,revision FROM mutations/);return {toArray:()=>store.origin?[structuredClone(store.origin)]:[]};}}};
  return store;
}
const page=(ids,extra={})=>({page:1,orderNumber:'007',sheetNumber:'1',quantity:1,panelIds:ids,...extra});
const stage=(store,pages=[page(['new-A','new-B'])],extra={})=>stageCncOrderIdAnalysis(store,{...scope,source,pages,...extra},admin);
const mapping=(staged,panelId,index,extra={})=>({panelId,occurrenceIds:[staged.occurrences[index].occurrenceId],...extra});
function review(store,staged,mappings){return orderIdReupload(store,{action:'preview',analysisId:staged.analysisId,mappings},admin).plan;}
function saveBody(plan,mappings,extra={}){return {action:'save',analysisId:plan.analysisId,mappings,snapshot:plan.snapshot,revision:plan.revision,restoreEpoch:plan.restoreEpoch,mutationId:'order-id-reupload-'+String(++seq).padStart(5,'0'),reason:'Update references from the corrected CNC PDF',confirmed:true,...extra};}
function analysisDoc(store,staged){return store.docs['cnc-order-id-analysis:'+staged.analysisId];}

test('context exposes current small status identities without changing progress, including a legacy blank project',()=>{
  const p=panel('a',undefined,'completed',{jobReference:'',completedAt:undefined,completedBy:undefined}),store=fixture([p],[]),before=structuredClone(store.docs),result=orderIdReupload(store,{action:'context',project:'',orderNumber:'007'},admin);
  assert.deepEqual(result.scope,{project:'',orderNumber:'007'});assert.equal(result.panels[0].panelId,'a');assert.equal(result.panels[0].panelNumber,null);assert.equal(result.panels[0].completedAt,null);assert.equal(result.panels[0].completedBy,null);assert.equal(result.panels[0].qaStatus,'awaiting');assert.equal(result.panels[0].fabricationStatus,null);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);
});

test('trusted staging binds the PDF source, selected order and owner; quantities expand source copies without invented sheet numbers',()=>{
  const store=fixture(),before=structuredClone(store.docs),staged=stage(store,[page(['Aa','Bb'],{quantity:2,sheetNumber:'S-01'})]);
  assert.equal(staged.ok,true);assert.deepEqual(staged.source,source);assert.deepEqual(staged.scope,scope);assert.equal(staged.occurrences.length,4);assert.deepEqual(staged.occurrences.map(value=>value.copyIndex),[0,0,1,1]);assert.ok(staged.occurrences.every(value=>value.quantity===2&&value.sheetNumber==='S-01'&&value.eligible));assert.equal(new Set(staged.occurrences.map(value=>value.occurrenceId)).size,4);
  const saved=analysisDoc(store,staged);assert.equal(saved.owner,'admin');assert.ok(Date.parse(saved.expiresAt)-Date.parse(saved.createdAt)>=2*60*60*1000);assert.equal(saved.restoreEpoch,0);assert.deepEqual(saved.source,source);
  assert.equal(store.writes.length,1);for(const [key,value]of Object.entries(before))assert.deepEqual(store.docs[key],value);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
});

test('explicit wrong-order labels are ineligible; missing headers warn and require explicit reviewed mapping',()=>{
  const store=fixture(),staged=stage(store,[page(['WRONG'],{page:1,orderNumber:'008'}),page(['NoHeader'],{page:2,orderNumber:'',sheetNumber:''})]);
  assert.equal(staged.occurrences[0].eligible,false);assert.match(staged.occurrences[0].error,/008/);assert.equal(staged.occurrences[1].eligible,true);assert.ok(staged.warnings.some(value=>value.includes('order number is missing')));assert.ok(staged.warnings.some(value=>value.includes('sheet number is missing')));
  assert.throws(()=>review(store,staged,[mapping(staged,'a',0)]),error=>error.status===409);const plan=review(store,staged,[mapping(staged,'a',1)]);assert.equal(plan.rows[0].newPanelNumber,'NoHeader');assert.deepEqual(plan.unmatchedPanelIds,['b']);assert.deepEqual(plan.unmatchedOccurrenceIds,[staged.occurrences[0].occurrenceId]);
});

test('malformed parser/source data, too many pages and more than 500 physical occurrences reject before staging',()=>{
  const cases=[{source:{...source,sha256:'bad'}},{source:{...source,bytes:8*1024*1024+1}},{source:{...source,fileName:'bad\nname.pdf'}},{pages:[]},{pages:Array.from({length:301},(_,i)=>page(['A'],{page:i+1}))},{pages:[page(['A'],{quantity:0})]},{pages:[page(['A'],{quantity:1.5})]},{pages:[page(Array.from({length:251},(_,i)=>'A'+i),{quantity:2})]},{pages:[page(['A']),page(['B'])]},{pages:[page(['A'],{page:0})]},{pages:[page(['A'],{panelIds:{bad:true}})]}];
  for(const patch of cases){const store=fixture();assert.throws(()=>stage(store,patch.pages??[page(['A'])],patch));assert.equal(store.writes.length,0);}
  const invalid=stage(fixture(),[page(['good',123,'bad\nid'])]);assert.deepEqual(invalid.occurrences.map(value=>value.eligible),[true,false,false]);
});

test('all entry points require admin CNC access, and staged analyses cannot be borrowed by another admin',()=>{
  for(const actor of [staff,{...admin,blockCnc:true}]){
    const store=fixture();assert.throws(()=>orderIdReupload(store,{action:'context',...scope},actor),error=>error.status===403);assert.throws(()=>stageCncOrderIdAnalysis(store,{...scope,source,pages:[page(['A'])]},actor),error=>error.status===403);assert.equal(store.writes.length,0);
  }
  const store=fixture(),staged=stage(store);assert.throws(()=>orderIdReupload(store,{action:'preview',analysisId:staged.analysisId,mappings:[mapping(staged,'a',0)]},{...admin,username:'another-admin'}),error=>error.status===403);
  assert.throws(()=>orderIdReupload(store,{action:'context',project:undefined,orderNumber:'007'},admin));assert.throws(()=>orderIdReupload(store,{action:'context',project:'Tower',orderNumber:' '},admin));
});

test('mixed cut/pending and QA states keep all physical metadata, areas, evidence and dates while only reviewed names change',()=>{
  const ps=[panel('a','old-A'),panel('b','old-B','pending'),panel('c','old-C'),panel('d','old-D')],records=[inspection('a'),inspection('c','recut'),inspection('d','replaced')],store=fixture(ps,records),staged=stage(store,[page(['c1F-A','c1F-B','c1F-C','c1F-D'])]),mappings=ps.map((p,index)=>mapping(staged,p.id,index)),plan=review(store,staged,mappings),before=structuredClone(store.docs),result=orderIdReupload(store,saveBody(plan,mappings),admin);
  assert.equal(result.summary.mappedCount,4);assert.equal(result.summary.changedCount,4);assert.deepEqual(result.summary.rows,plan.rows);assert.equal(result.revision,13);assert.deepEqual(store.broadcasts,[13]);
  for(const [index,p]of ps.entries())assert.deepEqual(store.docs['app:cncPanels'][index],{...p,panelNumber:staged.occurrences[index].panelNumber});
  for(const key of ['qa-checks','app:variants','app:offcuts','qa-panel-area:a','orders'])assert.deepEqual(store.docs[key],before[key]);
  assert.deepEqual(store.docs['app:transactions'].slice(1),before['app:transactions']);assert.equal(store.docs['app:transactions'][0].source,'cnc-order-id-reupload');assert.equal(store.docs['app:transactions'][0].sha256,source.sha256);assert.equal(store.audits[0].action,'cnc-order-ids-reuploaded');
  assert.deepEqual(analysisDoc(store,staged),before['cnc-order-id-analysis:'+staged.analysisId]);
  const receipt=store.docs['cnc-order-id-reupload:'+store.audits[0].detail.mutationId];assert.deepEqual(receipt.source,source);assert.deepEqual(receipt.mappings,mappings);
  assert.deepEqual(receipt.sourceOccurrences,staged.occurrences);assert.equal(receipt.sourceOccurrences[0].page,1);assert.equal(receipt.sourceOccurrences[0].sheetNumber,'1');
});

test('printed project mismatches warn without switching scope, and malformed project headers cannot be staged',()=>{
  const store=fixture(),s=stage(store,[page(['New'],{project:'Other tower'})]);assert.deepEqual(s.scope,scope);assert.equal(s.occurrences[0].eligible,true);assert.ok(s.warnings.some(value=>value.includes('Other tower')&&value.includes('Tower')));
  for(const project of [{bad:true},'x'.repeat(201),'bad\nproject']){const f=fixture();assert.throws(()=>stage(f,[page(['A'],{project})]));assert.equal(f.writes.length,0);}
});

test('legacy order prefixes use existing identity normalization while selected scope, source and leading zeros remain exact',()=>{
  const ps=[panel('a','A','completed',{orderNumber:'Order 007'}),panel('b','B','pending',{orderNumber:'007'}),panel('c','C','completed',{orderNumber:'7'})],store=fixture(ps,[]),s=stage(store,[page(['New-A','New-B'])],{orderNumber:'Order 007'});
  assert.equal(s.scope.orderNumber,'Order 007');assert.deepEqual(s.panels.map(p=>p.id),['a','b']);assert.ok(s.occurrences.every(item=>item.eligible));
  const m=[mapping(s,'a',0),mapping(s,'b',1)],plan=review(store,s,m);orderIdReupload(store,saveBody(plan,m),admin);assert.deepEqual(store.docs['app:cncPanels'].map(p=>p.orderNumber),['Order 007','007','7']);assert.equal(store.docs['app:cncPanels'][2].panelNumber,'C');
});

test('an order may contain more than 500 existing records while one reviewed PDF subset leaves every other row untouched',()=>{
  const ps=Array.from({length:501},(_,i)=>panel('p'+String(i).padStart(3,'0'),'OLD-'+i)),store=fixture(ps,[]),s=stage(store,[page(['ONE-NEW'])]),m=[mapping(s,'p000',0)],plan=review(store,s,m);
  assert.equal(s.panels.length,501);assert.equal(plan.unmatchedPanelIds.length,500);orderIdReupload(store,saveBody(plan,m),admin);assert.deepEqual(store.docs['app:cncPanels'][0],{...ps[0],panelNumber:'ONE-NEW'});assert.deepEqual(store.docs['app:cncPanels'].slice(1),ps.slice(1));
});

test('swaps and cycles validate the simultaneous final order, never an intermediate duplicate',()=>{
  for(const labels of [['A','B'],['A','B','C']]){
    const ps=labels.map((label,index)=>panel('p'+index,label)),store=fixture(ps,[]),rotated=labels.slice(1).concat(labels[0]),staged=stage(store,[page(rotated)]),mappings=ps.map((p,index)=>mapping(staged,p.id,index)),plan=review(store,staged,mappings),result=orderIdReupload(store,saveBody(plan,mappings),admin);
    assert.equal(result.summary.changedCount,labels.length);assert.deepEqual(store.docs['app:cncPanels'].map(p=>p.panelNumber),rotated);assert.equal(store.docs.revision,13);
  }
});

test('explicit aggregation combines source labels in page/copy order; it cannot accidentally collapse multiple physical records',()=>{
  const store=fixture(),staged=stage(store,[page(['last'],{page:3}),page(['first','second'],{page:1})]),ids=staged.occurrences.map(value=>value.occurrenceId),mappings=[{panelId:'a',occurrenceIds:ids.slice().reverse(),combineConfirmed:true}],plan=review(store,staged,mappings);
  assert.equal(plan.rows[0].newPanelNumber,'first, second, last');assert.deepEqual(plan.rows[0].occurrenceIds,ids);assert.deepEqual(plan.unmatchedPanelIds,['b']);orderIdReupload(store,saveBody(plan,mappings),admin);assert.equal(store.docs['app:cncPanels'].length,2);assert.equal(store.docs['app:cncPanels'][1].panelNumber,'old-B');
  const empty=fixture(),emptyStage=stage(empty);assert.throws(()=>review(empty,emptyStage,[]));
  const fresh=fixture(),s=stage(fresh);assert.throws(()=>review(fresh,s,[{panelId:'a',occurrenceIds:s.occurrences.map(value=>value.occurrenceId)}]));
  const long=stage(fresh,[page(['A'.repeat(150),'B'.repeat(150)])]);assert.throws(()=>review(fresh,long,[{panelId:'a',occurrenceIds:long.occurrences.map(value=>value.occurrenceId),combineConfirmed:true}]));
});

test('duplicate final labels, repeated rows/occurrences and cross-order mappings reject; unrelated order duplicates do not interfere',()=>{
  const store=fixture([panel('a','A'),panel('b','B'),panel('foreign','X','completed',{jobReference:'Other'})],[]),staged=stage(store,[page(['B','C'])]);
  for(const mappings of [[mapping(staged,'a',0)],[mapping(staged,'a',0),mapping(staged,'a',1)],[mapping(staged,'a',1),mapping(staged,'b',1)],[mapping(staged,'foreign',0)]])assert.throws(()=>review(store,staged,mappings));
  const others=fixture([panel('a','A'),panel('b','B'),panel('foreign-1','DUP','completed',{jobReference:'Other'}),panel('foreign-2','DUP','completed',{jobReference:'Other'})],[]),s=stage(others,[page(['NEW'])]),m=[mapping(s,'a',0)],plan=review(others,s,m);assert.equal(orderIdReupload(others,saveBody(plan,m),admin).ok,true);
});

test('unmatched records and occurrences are listed and remain untouched, including repeated source quantities',()=>{
  const store=fixture([panel('a','old-A'),panel('b','old-B','pending',{sheetNumber:'2'}),panel('c','old-C')],[]),staged=stage(store,[page(['new-A'],{quantity:2})]),m=[mapping(staged,'a',0),mapping(staged,'b',1)],plan=review(store,staged,m);
  assert.deepEqual(plan.unmatchedPanelIds,['c']);assert.deepEqual(plan.unmatchedOccurrenceIds,[]);orderIdReupload(store,saveBody(plan,m),admin);assert.deepEqual(store.docs['app:cncPanels'].map(p=>p.sheetNumber),['1','2','1']);assert.equal(store.docs['app:cncPanels'][2].panelNumber,'old-C');assert.equal(store.docs['app:cncPanels'].length,3);
});

test('unchanged detected names are still auditable and retained in plan/summary without rewriting CNC rows',()=>{
  const store=fixture([panel('a','Same')],[]),staged=stage(store,[page(['Same'])]),m=[mapping(staged,'a',0)],plan=review(store,staged,m),before=structuredClone(store.docs['app:cncPanels']),start=store.writes.length,result=orderIdReupload(store,saveBody(plan,m),admin);
  assert.equal(plan.changedCount,0);assert.equal(result.summary.changedCount,0);assert.equal(result.summary.mappedCount,1);assert.equal(result.summary.rows[0].newPanelNumber,'Same');assert.deepEqual(store.docs['app:cncPanels'],before);assert.ok(!store.writes.slice(start).includes('app:cncPanels'));assert.equal(store.docs.revision,13);
});

test('an order, QA, load, mapping or revision change after preview rejects the entire save',()=>{
  const mutators=[store=>{store.docs['app:cncPanels'][0].panelNumber='changed';},store=>{store.docs['app:cncPanels'][1].status='completed';},store=>{store.docs['qa-checks'][0].status='recut';},store=>{store.docs['qa-checks'][0].latest.photo='new evidence';},store=>{store.docs['panel-dispatch-loads'][0].fabrication.by='Changed fabricator';},store=>{store.docs.revision++;},store=>{store.docs['app:cncPanels'].push(panel('new-row','NEW'));}];
  for(const mutate of mutators){
    const store=fixture();store.docs['panel-dispatch-loads']=[{id:'load',status:'waiting',panelIds:['a','b'],productionSignature:loadSignature(store.docs['app:cncPanels']),fabrication:{by:'Original'}}];const s=stage(store),m=[mapping(s,'a',0),mapping(s,'b',1)],plan=review(store,s,m),body=saveBody(plan,m);mutate(store);const before=structuredClone(store.docs),writes=store.writes.length;assert.throws(()=>orderIdReupload(store,body,admin),error=>error.status===409);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,writes);
  }
  const store=fixture(),s=stage(store),m=[mapping(s,'a',0),mapping(s,'b',1)],plan=review(store,s,m);assert.throws(()=>orderIdReupload(store,saveBody(plan,[mapping(s,'a',1),mapping(s,'b',0)]),admin),error=>error.status===409);
});

test('area-only corrections stay independent while stale restore epochs and in-transaction progress changes reject',()=>{
  const store=fixture(),s=stage(store),m=[mapping(s,'a',0)],plan=review(store,s,m),body=saveBody(plan,m);store.docs['qa-panel-area:a']={value:{method:'manual',areaM2:2.5},revision:99,cutAt:cut};assert.equal(orderIdReupload(store,body,admin).ok,true);assert.equal(store.docs['qa-panel-area:a'].revision,99);
  for(const mutate of [store=>{store.docs.restoreEpoch++;},store=>{store.docs['qa-checks'][0].latest.id='new-check';}]){const f=fixture(),st=stage(f),ms=[mapping(st,'a',0)],p=review(f,st,ms),b=saveBody(p,ms),before=f.docs['app:cncPanels'][0].panelNumber;f.beforeTransaction(()=>mutate(f));assert.throws(()=>orderIdReupload(f,b,admin),error=>error.status===409);assert.equal(f.docs['app:cncPanels'][0].panelNumber,before);}
});

test('expired analyses block new writes but never break a cached successful retry or revert later corrections',()=>{
  const store=fixture(),s=stage(store),m=[mapping(s,'a',0)],plan=review(store,s,m),body=saveBody(plan,m),first=orderIdReupload(store,body,admin);analysisDoc(store,s).expiresAt='2000-01-01T00:00:00Z';
  const {plan:manual}=correctCompletedPanelId(store,{action:'preview',panelId:'a'},admin);correctCompletedPanelId(store,{action:'save',panelId:'a',newPanelNumber:'later-manual-ID',reason:'Later correction',mutationId:'later-manual-correction-0001',expectedPanelNumber:manual.panelNumber,expectedCompletedAt:manual.completedAt,productionSignature:manual.productionSignature,revision:manual.revision,restoreEpoch:manual.restoreEpoch},admin);
  const before=structuredClone(store.docs),writes=store.writes.length,retry=orderIdReupload(store,body,admin);assert.equal(retry.idempotent,true);assert.equal(retry.revision,first.revision);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,writes);assert.equal(store.docs['app:cncPanels'][0].panelNumber,'later-manual-ID');
  assert.throws(()=>review(store,s,m),error=>error.status===409);assert.throws(()=>orderIdReupload(store,{...body,mutationId:'fresh-operation-expired-0001'},admin),error=>error.status===409);assert.throws(()=>orderIdReupload(store,{...body,reason:'Changed request'},admin),error=>error.status===409);assert.throws(()=>orderIdReupload(store,body,{...admin,username:'other-admin'}),error=>error.status===409);store.docs.restoreEpoch++;assert.throws(()=>orderIdReupload(store,body,admin),error=>error.status===409);
});

test('batch changes preserve active grants, keep expired grants inactive and rebase each valid waiting group once',()=>{
  const ps=[panel('a','old-A'),panel('b','old-B'),panel('c','old-C')],active=exemption(ps[0]),expired=exemption({...ps[1],panelNumber:'new-B'}),records=[active,expired,inspection('c')],store=fixture(ps,records),waiting={id:'waiting',status:'waiting',panelIds:ps.map(p=>p.id),productionSignature:loadSignature(ps),fabrication:{by:'Original fabricator',at:cut},legs:[]},sent={...waiting,id:'sent',status:'dispatched_to_site',legs:[{reference:'old-A',at:cut}]};
  store.docs['panel-dispatch-loads']=[waiting,sent];const s=stage(store,[page(['new-A','new-B','new-C'])]),m=ps.map((p,i)=>mapping(s,p.id,i)),plan=review(store,s,m),beforeHistory=structuredClone(records.map(record=>record.qaExemptionHistory)),result=orderIdReupload(store,saveBody(plan,m),admin),after=store.docs['app:cncPanels'],qa=store.docs['qa-checks'];
  assert.equal(activePanelQaExemption(after[0],qa[0]),true);assert.equal(effectivePanelQaStatus(after[1],qa[1]),'awaiting');assert.ok(qa[1].qaExemption.invalidatedAt);assert.deepEqual(qa.map(record=>record.qaExemptionHistory),beforeHistory);assert.deepEqual(qa[2],records[2]);assert.equal(store.docs['panel-dispatch-loads'][0].productionSignature,loadSignature(after));assert.deepEqual({...store.docs['panel-dispatch-loads'][0],productionSignature:waiting.productionSignature},waiting);assert.deepEqual(store.docs['panel-dispatch-loads'][1],sent);assert.equal(result.summary.changedCount,3);
});

test('a failure after preparing multiple panel/QA/load changes rolls the whole update back',()=>{
  const ps=[panel('a','A'),panel('b','B')],store=fixture(ps,[exemption(ps[0]),inspection('b')]);store.docs['panel-dispatch-loads']=[{id:'load',status:'waiting',panelIds:['a','b'],productionSignature:loadSignature(ps),fabrication:{by:'Original'}}];const s=stage(store,[page(['B','A'])]),m=[mapping(s,'a',0),mapping(s,'b',1)],plan=review(store,s,m),body=saveBody(plan,m),before=structuredClone(store.docs),write=store.write,start=store.writes.length;store.write=(key,value)=>{if(key==='cnc-order-id-reupload:'+body.mutationId)throw Error('Storage unavailable');write(key,value);};
  assert.throws(()=>orderIdReupload(store,body,admin),/Storage unavailable/);assert.deepEqual(store.docs,before);assert.equal(store.writes.length,start);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
});

test('the physical cut remains undoable after metadata-only drawing ID replacement',()=>{
  const p=panel('a','old-A','completed',{offcutOutcome:'none',savedOffcuts:[]}),stock={id:'stock',sku:'AL-SHEET',color:'Milled',material:'Solid Aluminium',thickness:3,width:3000,height:1200,qty:4,catalogId:'cat'},dispatch={id:'original-stock-dispatch',type:'dispatch',source:'cnc',timestamp:cut,qty:1,itemType:'variant',sku:stock.sku,orderNumber:'007',panelIds:['old-A']},
    origin=[{field:'cncPanels',id:'a',before:{...p,status:'pending'},after:p},{field:'variants',id:'stock',before:{...stock,qty:5},after:stock},{field:'transactions',id:dispatch.id,before:null,after:dispatch}],store=fixture([p],[]);
  store.docs['app:variants']=[stock];store.docs['app:offcuts']=[];store.docs['app:transactions']=[dispatch];store.origin={id:'original-cut',payload:JSON.stringify(origin),revision:2};const s=stage(store,[page(['new-ID'])]),m=[mapping(s,'a',0)],plan=review(store,s,m);orderIdReupload(store,saveBody(plan,m),admin);
  const {plan:undo}=undoCncCompletion(store,{action:'preview',panelId:'a',expectedCompletedAt:cut},admin);assert.deepEqual(undo.stockAdjustments.map(value=>value.delta),[1]);assert.equal(undo.panels[0].panelNumber,'new-ID');store.syncPanelLoads=()=>{};undoCncCompletion(store,{action:'undo',panelId:'a',expectedCompletedAt:cut,revision:undo.revision,restoreEpoch:undo.restoreEpoch,reason:'Marked cut by mistake',mutationId:'undo-after-order-reupload-0001'},admin);assert.equal(store.docs['app:cncPanels'][0].panelNumber,'new-ID');assert.equal(store.docs['app:cncPanels'][0].status,'pending');assert.equal(store.docs['app:variants'][0].qty,5);assert.equal(store.origin.payload,JSON.stringify(origin));
});

test('large reupload contexts reuse assembly parsing across all rows and never write production history',()=>{
  const ps=[],qa=[];
  for(let i=0;i<248;i++){
    const selected=i<48,extra=selected?{}:{jobReference:'Other project',orderNumber:'Other order'};
    for(const [suffix,sheet] of [['','8'],[' EP-T','1'],[' EP-B','6']]){
      const id=`${i}-${sheet}`;ps.push(panel(id,`Z5W5-${i}a${suffix}`,'completed',{...extra,sheetNumber:sheet}));
      if(selected)qa.push(inspection(id));
    }
  }
  const store=fixture(ps,qa),saved=store.docs['app:cncPanels'],read=store.read,budget=saved.length*20;
  let labelReads=0;
  for(const p of saved){const label=p.panelNumber;Object.defineProperty(p,'panelNumber',{enumerable:true,get(){assert.ok(++labelReads<=budget,'Assembly identities must not be reparsed for every status row');return label;}});}
  store.read=(key,fallback)=>key==='app:cncPanels'?saved:read(key,fallback);
  const result=orderIdReupload(store,{action:'context',...scope},admin);
  assert.equal(result.panels.length,144);assert.equal(result.revision,12);assert.equal(result.restoreEpoch,0);
  assert.equal(result.panels.filter(p=>p.qaStatus==='included_with_main').length,96);
  assert.ok(result.panels.every(p=>p.fabricationStatus==='completed'));
  assert.deepEqual(result.panels.map(p=>p.panelNumber).sort(),ps.slice(0,144).map(p=>p.panelNumber).sort());
  assert.ok(labelReads<=budget);assert.deepEqual(saved.map(p=>({...p})),ps);
  assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
});

test('cached contexts retain caps on other sheets, literal assembly scopes and approved replacement states',()=>{
  const ps=[panel('main','A'),panel('top','A EP-T','completed',{sheetNumber:'1'}),panel('bottom','A EP-B','completed',{sheetNumber:'6'}),
    panel('blocked','B'),panel('uncut','B EP-L','pending',{sheetNumber:'2'}),
    panel('prefixed','C','completed',{orderNumber:'Order 007'}),panel('literal-cap','C EP-R'),
    panel('original','OLD'),panel('replacement','NEW','completed',{sheetNumber:'10'}),
    panel('wrong-order','FOREIGN-OLD'),panel('foreign','FOREIGN-NEW','completed',{orderNumber:'other'}),
    panel('foreign-cap','A EP-L','pending',{jobReference:'Other'})];
  const qa=ps.map(p=>inspection(p.id));qa.find(r=>r.id==='original').status='replaced';qa.find(r=>r.id==='original').replacementId='replacement';
  qa.find(r=>r.id==='wrong-order').status='replaced';qa.find(r=>r.id==='wrong-order').replacementId='foreign';
  const store=fixture(ps,qa),before=structuredClone(store.docs),result=orderIdReupload(store,{action:'context',project:' tower ',orderNumber:'Order 007'},admin),byId=new Map(result.panels.map(p=>[p.id,p]));
  assert.equal(result.panels.length,10);assert.equal(byId.get('main').fabricationStatus,'completed');
  for(const id of ['top','bottom']){assert.equal(byId.get(id).qaStatus,'included_with_main');assert.equal(byId.get(id).fabricationStatus,'completed');}
  assert.equal(byId.get('blocked').qaStatus,'awaiting');assert.equal(byId.get('blocked').fabricationStatus,'pending');
  assert.equal(byId.get('uncut').qaStatus,'included_with_main');assert.equal(byId.get('uncut').fabricationStatus,'pending');
  assert.equal(byId.get('prefixed').fabricationStatus,'completed');assert.equal(byId.get('literal-cap').qaStatus,'included_with_main');assert.equal(byId.get('literal-cap').fabricationStatus,'pending');
  assert.equal(byId.get('original').fabricationStatus,'completed');assert.equal(byId.get('wrong-order').fabricationStatus,'pending');
  assert.ok(!byId.has('foreign')&&!byId.has('foreign-cap'));assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);
});

test('contexts retain global duplicate checks and tolerate unrelated rows without saved identities',()=>{
  for(const records of [[inspection('a'),inspection('a')],[inspection('a'),{id:'a',kind:'gate'}]]){
    const store=fixture([panel('a','A')],records);assert.throws(()=>orderIdReupload(store,{action:'context',...scope},admin),error=>error.status===409&&/QA identities/.test(error.message));assert.equal(store.writes.length,0);
  }
  const duplicate=fixture([panel('a','A'),panel('a','UNRELATED','completed',{jobReference:'Other'})],[inspection('a')]);
  assert.throws(()=>orderIdReupload(duplicate,{action:'context',...scope},admin),error=>error.status===409&&/CNC identities/.test(error.message));assert.equal(duplicate.writes.length,0);
  const store=fixture([panel('a','A'),null,{jobReference:'Other'}],[inspection('a')]);
  const result=orderIdReupload(store,{action:'context',...scope},admin);assert.equal(result.panels.length,1);assert.equal(result.panels[0].fabricationStatus,'completed');assert.equal(store.writes.length,0);
});

test('cached contexts keep server-attested manual component associations ahead of editable suffixes',()=>{
  const ps=[panel('main','ACTUAL'),panel('cap','OTHER EP-R','completed',{sheetNumber:'6'}),panel('other','OTHER')],store=fixture(ps,ps.map(p=>inspection(p.id))),
    link={schemaVersion:1,id:'existing-link',panelId:'cap',mainPanelId:'main',parentReference:'ACTUAL',side:'R'},read=store.read;
  store.docs['qa-assembly-link:cap']=link;store.docs['qa-assembly-link-receipt:existing-link']={link};
  store.read=(key,fallback)=>{const value=read(key,fallback);return key==='app:cncPanels'?attestQaAssemblyPanels(store,value):value;};
  const before=structuredClone(store.docs),result=orderIdReupload(store,{action:'context',...scope},admin),byId=new Map(result.panels.map(p=>[p.id,p]));
  assert.equal(byId.get('main').fabricationStatus,'completed');assert.equal(byId.get('cap').qaStatus,'included_with_main');assert.equal(byId.get('cap').fabricationStatus,'completed');
  assert.equal(byId.get('other').fabricationStatus,'completed');assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);
});
