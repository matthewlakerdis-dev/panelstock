import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeUsername,requireCondition as check} from '../src/security.js';
import {migrateQaRecords} from '../src/qa-status.js';
import {panelQaResolution} from '../src/qa-resolution.js';
import {currentGateQaRecord,requireCurrentGateQa,syncGateQaProgress} from '../src/gate-order-qa.js';
import {readyOrderIds,notifyReadyOrders} from '../src/order-notifications.js';
import {qaInspectionEvidence} from '../src/qa-photos.js';

const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const method=(name,next)=>source.slice(source.indexOf(`  ${name}(`),source.indexOf(`  ${next}(`));
const methods=[['qaSettings','qaChecklists'],['qaChecklists','qaSettingsFor'],['qaSettingsFor','updateQaSettings'],['updateQaSettings','qaPanelItem'],['qaPanelItem','qaItemsFor'],['qaItemsFor','qaOrderReport'],['submitQaCheck','replaceSupervisor'],['requireTask','requireMutationTasks']].map(([name,next])=>method(name,next)).join(',');
const constants=source.slice(source.indexOf('const QA_CHECKLISTS='),source.indexOf('const ok='));
const makeMethods=new Function('cleanText','supportPhoto','check','ok','normalizeUsername','migrateQaRecords','panelQaResolution','currentGateQaRecord','requireCurrentGateQa','syncGateQaProgress','readyOrderIds','notifyReadyOrders','qaInspectionEvidence',`${constants}return ({${methods}});`);
const admin={username:'inspector',isAdmin:true},staff={username:'inspector',tasks:{'factory.qa':true}},photo='data:image/png;base64,aGVsbG8=';
const cleanText=(value,max=200)=>String(value||'').trim().slice(0,max);
function fixture(saved={}){
  const revision='gate-revision',order={id:'gate-order',project:'Gate project',orderNumber:'001',orderType:'Gate',status:'approved',requestedBy:'requester',updatedAt:'2026-10-01T00:00:00Z',manualProduction:{qaWorkflowVersion:1,qaRevision:revision,qaItemIds:['gate-1','gate-2'],stages:{drawn:'complete',fabricatedQa:'pending',readyForDispatch:'pending'}}};
  const gate=id=>({id,kind:'metalwork',gateOrderId:order.id,gateRevision:revision,project:order.project,orderNumber:order.orderNumber,reference:id,quantity:1,drawnBy:'drawing-person',fabricatedBy:'',createdAt:'2026-10-01T00:00:00Z',status:'awaiting',latest:null,history:[]});
  const records=[gate('gate-1'),gate('gate-2'),{id:'bracket',kind:'metalwork',project:'Other project',orderNumber:'002',reference:'Bracket',quantity:1,fabricatedBy:'fabricator',status:'awaiting',latest:null,history:[]}];
  const docs=new Map([['orders',[order]],['qa-checks',records],['qa-settings',saved],['app:cncPanels',[]]]),writes=[],audits=[],alerts=[];
  const store=Object.assign(makeMethods(cleanText,value=>value||'',check,(body,status=200)=>({body,status}),normalizeUsername,migrateQaRecords,panelQaResolution,currentGateQaRecord,requireCurrentGateQa,syncGateQaProgress,readyOrderIds,notifyReadyOrders,qaInspectionEvidence),{
    read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>{writes.push(key);docs.set(key,structuredClone(value));},ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>audits.push(args),notify:(...args)=>alerts.push(args),panelCoatingStock:()=>[]
  });
  const results=kind=>Object.fromEntries(store.qaChecklists()[kind].map(([key])=>[key,'pass']));
  const submit=(id='gate-1',body={})=>store.submitQaCheck({id,kind:'metalwork',results:results(id==='bracket'?'metalwork':'gate'),...body},admin);
  return {store,docs,writes,audits,alerts,results,submit,order:()=>store.read('orders')[0],record:id=>store.read('qa-checks').find(item=>item.id===id)};
}

test('existing settings gain an independent editable starter Gate checklist without rewriting storage',()=>{
  const f=fixture({metalworkChecks:[['ordinary','Ordinary metalwork check']],activeMetalworkChecks:['ordinary']}),settings=f.store.qaSettingsFor(admin);
  assert.equal(settings.settings.gateChecks.length,10);assert.equal(settings.settings.activeGateChecks.length,10);
  assert.deepEqual(settings.availableChecklists.gate,settings.settings.gateChecks);
  assert.ok(settings.availableChecklists.gate.some(([key])=>key==='hinges'));
  assert.deepEqual(f.store.qaChecklists().metalwork,[['ordinary','Ordinary metalwork check']]);
  assert.deepEqual(f.store.qaChecklists().gate,settings.settings.gateChecks);assert.equal(f.writes.length,0);
  assert.throws(()=>f.store.qaSettingsFor(staff),error=>error.status===403);
});

test('administrators can add, edit, enable and remove Gate checks independently',()=>{
  const f=fixture(),defaults=f.store.qaSettings(),gateChecks=[['hinges','Inspect the fitted hinges'],['operator','Operator supplied check'],['inactive','Disabled check']];
  assert.throws(()=>f.store.updateQaSettings({...defaults,gateChecks,activeGateChecks:['hinges','operator']},staff),error=>error.status===403);
  const saved=f.store.updateQaSettings({...defaults,gateChecks,activeGateChecks:['hinges','operator']},admin).body;
  assert.deepEqual(saved.availableChecklists.gate,gateChecks);assert.deepEqual(f.store.qaChecklists().gate,gateChecks.slice(0,2));
  assert.deepEqual(saved.settings.panelChecks,defaults.panelChecks);assert.deepEqual(saved.settings.metalworkChecks,defaults.metalworkChecks);
  f.store.updateQaSettings({...saved.settings,gateChecks:[['operator','Renamed operator check']],activeGateChecks:['operator']},admin);
  assert.deepEqual(f.store.qaChecklists().gate,[['operator','Renamed operator check']]);
});

test('older settings clients preserve custom Gate definitions and active checks',()=>{
  const f=fixture(),settings={...f.store.qaSettings(),gateChecks:[['custom','My custom Gate check'],['disabled','Leave disabled']],activeGateChecks:['custom']};
  f.store.updateQaSettings(settings,admin);
  const {gateChecks,activeGateChecks,...legacyPayload}=f.store.qaSettings();
  const saved=f.store.updateQaSettings({...legacyPayload,requireQaPhoto:true},admin).body.settings;
  assert.deepEqual(saved.gateChecks,gateChecks);assert.deepEqual(saved.activeGateChecks,activeGateChecks);assert.equal(saved.requireQaPhoto,true);
});

test('malformed Gate settings are rejected before writing',()=>{
  const f=fixture(),defaults=f.store.qaSettings();
  const invalid=[{gateChecks:null},{gateChecks:[]},{gateChecks:[['duplicate','One'],['duplicate','Two']]},{gateChecks:[['empty','']]},{gateChecks:[['bad key','Label']]},{gateChecks:Array.from({length:51},(_,i)=>['key'+i,'Label'])},{activeGateChecks:[]},{activeGateChecks:['missing']},{activeGateChecks:['dimensions','dimensions']},{activeGateChecks:null}];
  const {gateChecks,activeGateChecks,...legacy}=defaults;
  invalid.push({...legacy,gateChecks},{...legacy,activeGateChecks});
  for(const value of invalid)assert.throws(()=>f.store.updateQaSettings(Object.hasOwn(value,'panelChecks')?value:{...defaults,...value},admin),error=>error.status===400);
  assert.equal(f.writes.length,0);
});

test('the stored Gate link selects Gate results even when a client requests metalwork checks',()=>{
  const f=fixture(),ordinary=f.results('metalwork');
  assert.throws(()=>f.submit('gate-1',{checklistKind:'metalwork',gateOrderId:'',results:ordinary}),/Complete every QA check/);
  assert.equal(f.record('gate-1').status,'awaiting');assert.equal(f.writes.length,0);
  assert.throws(()=>f.submit('gate-1',{kind:'gate'}),/Invalid QA item/);
  const item=f.submit('gate-1').body.item;
  assert.equal(item.kind,'metalwork');assert.equal(item.checklistKind,'gate');assert.equal(item.latest.checklistKind,'gate');
  assert.deepEqual(item.latest.checklist,f.store.qaChecklists().gate);assert.deepEqual(item.latest.results,f.results('gate'));
});

test('ordinary metalwork keeps its checklist and ignores forged Gate selectors',()=>{
  const f=fixture(),result=f.submit('bracket',{gateOrderId:'gate-order',checklistKind:'gate'}).body.item;
  assert.equal(result.checklistKind,'metalwork');assert.equal(result.latest.checklistKind,undefined);
  assert.equal(result.latest.checklist,undefined);assert.deepEqual(result.latest.results,f.results('metalwork'));assert.equal(result.gateOrderId,undefined);
  assert.ok(!Object.hasOwn(result.latest.results,'hinges'));
});

test('only active custom Gate checks are required and inspection wording is snapshotted',()=>{
  const f=fixture(),settings=f.store.qaSettings();
  f.store.updateQaSettings({...settings,gateChecks:[['custom-latch','Latch wording at inspection'],['disabled','Disabled check']],activeGateChecks:['custom-latch']},admin);
  assert.throws(()=>f.submit('gate-1',{results:f.results('metalwork')}),/Complete every QA check/);
  const first=f.submit('gate-1',{results:{'custom-latch':'pass',disabled:'fail'}}).body.item.latest;
  assert.deepEqual(first.results,{'custom-latch':'pass'});assert.deepEqual(first.checklist,[['custom-latch','Latch wording at inspection']]);
  f.store.updateQaSettings({...f.store.qaSettings(),gateChecks:[['changed','New inspection wording']],activeGateChecks:['changed']},admin);
  assert.deepEqual(f.record('gate-1').latest,first);
  const second=f.submit('gate-1',{results:{changed:'pass'}}).body.item;
  assert.deepEqual(second.history[0],first);assert.deepEqual(second.history[1].checklist,[['changed','New inspection wording']]);
});

test('a failed Gate inspection blocks readiness until every current Gate line passes',()=>{
  const f=fixture();f.submit('gate-1');assert.equal(f.order().status,'approved');
  f.submit('gate-2',{results:{...f.results('gate'),hinges:'fail'},notes:'Hinge needs correction',photo});
  assert.equal(f.record('gate-2').status,'recut');assert.equal(f.order().manualProduction.stages.readyForDispatch,'pending');assert.equal(f.order().status,'approved');
  const corrected=f.submit('gate-2').body.item;assert.equal(corrected.history.length,2);assert.equal(corrected.history[0].results.hinges,'fail');
  assert.equal(f.order().status,'completed');assert.equal(f.order().manualProduction.stages.fabricatedQa,'complete');assert.equal(f.order().manualProduction.stages.readyForDispatch,'complete');
  assert.equal(f.alerts.filter(([,value])=>value.title.includes('ready for dispatch')).length,1);
});

test('legacy Gate approval and metalwork inspection history stay unchanged when settings are read or edited',()=>{
  const f=fixture(),records=f.store.read('qa-checks'),old={id:'old-attempt',status:'approved',results:{dimensions:'pass',welds:'pass'},photo,checkedBy:'old-inspector',checkedAt:'2026-10-01T00:00:00Z'};
  records[0]={...records[0],status:'approved',latest:old,history:[old]};f.docs.set('qa-checks',records);
  const before=structuredClone(records[0]),view=f.store.qaItemsFor(admin).items.find(item=>item.id==='gate-1');
  assert.equal(view.checklistKind,'gate');assert.deepEqual(view.latest,old);assert.deepEqual(view.history,[old]);assert.equal(view.latest.checklistKind,undefined);
  f.store.updateQaSettings({...f.store.qaSettings(),gateChecks:[['new','Future Gate check']],activeGateChecks:['new']},admin);
  assert.deepEqual(f.record('gate-1'),before);
  f.submit('gate-1',{results:{new:'pass'}});assert.deepEqual(f.record('gate-1').history[0],old);
});

test('Gate photo selections satisfy evidence requirements and preserve earlier inspection evidence',()=>{
  const f=fixture({requireQaPhoto:true}),second='data:image/jpeg;base64,d29ybGQ=';
  assert.throws(()=>f.submit('gate-1',{photos:[]}),/Add a QA photo/);assert.equal(f.writes.length,0);
  const failed=f.submit('gate-1',{photos:[photo,second],results:{...f.results('gate'),hinges:'fail'},notes:'Hinge needs correction'}).body.item.latest;
  assert.equal(failed.photo,photo);assert.deepEqual(failed.photos,[photo,second]);assert.equal(f.order().manualProduction.stages.readyForDispatch,'pending');
  const corrected=f.submit('gate-1',{photo:second}).body.item;
  assert.deepEqual(corrected.latest.photos,[second]);assert.deepEqual(corrected.history[0],failed);
  assert.deepEqual(f.store.qaItemsFor(admin).items.find(item=>item.id==='gate-1').history[0].photos,[photo,second]);
});

test('only saved Gate membership permits multiple photos and rejected evidence causes no writes',()=>{
  const f=fixture();
  assert.throws(()=>f.submit('bracket',{gateOrderId:'gate-order',checklistKind:'gate',photos:[photo,photo]}),/only available for Gate/);
  for(const photos of [null,[''],[null],Array(11).fill(photo)])assert.throws(()=>f.submit('gate-1',{photos}),error=>error.status===400);
  assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);assert.equal(f.record('gate-1').status,'awaiting');
});
