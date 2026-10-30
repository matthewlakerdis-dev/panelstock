import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activePanelQaExemption,effectivePanelQaStatus,panelQaExemptionFields,qaProductionSignature,preparePanelQaExemptions} from '../src/qa-exemptions.js';
import {panelQaResolution} from '../src/qa-resolution.js';
import {panelLoadView,reconcilePanelLoads,transitionPanelLoad} from '../src/panel-dispatch.js';
import {buildSiteOrderRows,buildSiteOrderFeed} from '../src/site-orders-excel.js';
import {buildOrderProductionProgress} from '../src/order-production-progress.js';
const actor={username:'manager',isAdmin:true},at='2026-10-30T01:00:00Z',panel={id:'p1',jobReference:'Project',orderNumber:'001',sheetNumber:'1',panelNumber:'P1',status:'completed',completedAt:'2026-10-29T01:00:00Z',completedBy:'cutter',stockColor:'White',sheetWidth:1200},order={id:'11111111-1111-4111-8111-111111111111',project:'Project',orderNumber:'001',orderType:'Panels'};
const state=(panels=[panel],records=[],loads=[])=>({panels:structuredClone(panels),records:structuredClone(records),loads:structuredClone(loads),dispatches:[]});
const input=(p=panel,record=null)=>({id:p.id,cutAt:p.completedAt||null,productionSignature:qaProductionSignature(p),expectedExemptionId:record?.qaExemption?.id||null});
const grant=(data,overrides={})=>preparePanelQaExemptions(data,{action:'grant',reason:'No inspection required for this order',panels:data.panels.map(p=>input(p,data.records.find(r=>r.id===p.id))),...overrides},actor,at);
const dispatch={action:'dispatch',destinationType:'site',destination:'Site',transport:'Truck',driver:'Driver'};

test('production signatures are stable across object key order and bind every current production field',()=>{
  assert.match(qaProductionSignature(panel),/^[0-9a-f]{64}$/);assert.ok(!qaProductionSignature(panel).includes(panel.jobReference));
  assert.equal(qaProductionSignature(panel),qaProductionSignature(Object.fromEntries(Object.entries(panel).reverse())));
  assert.notEqual(qaProductionSignature(panel),qaProductionSignature({...panel,sheetWidth:1300}));
  const record=grant(state()).records[0];assert.equal(activePanelQaExemption(panel,record),true);
  for(const changed of [{...panel,status:'pending'},{...panel,completedAt:'later'},{...panel,sheetWidth:1300},{...panel,completedBy:'another-cutter'},{...panel,panelNumber:'P2'}]){
    assert.equal(activePanelQaExemption(changed,record),false);assert.equal(effectivePanelQaStatus(changed,record),'awaiting');
  }
  assert.equal(activePanelQaExemption(panel,{...record,latest:{status:'approved'}}),false);
});

test('bulk grants record explicit exemptions without creating inspection evidence or changing CNC panels',()=>{
  const data=state([panel,{...panel,id:'p2',panelNumber:'P2'}]),before=structuredClone(data),result=grant(data);
  assert.deepEqual(data,before);assert.equal(result.records.length,2);assert.equal(result.events.length,2);
  for(const record of result.records){
    assert.equal(record.status,'not_required');assert.equal(record.latest,null);assert.deepEqual(record.history,[]);
    assert.equal(record.qaExemption.by,actor.username);assert.equal(record.qaExemption.at,at);assert.equal(record.qaExemption.reason,'No inspection required for this order');
    assert.deepEqual(record.qaExemptionHistory.map(event=>event.action),['grant']);assert.equal(record.qaExemptionHistory[0].exemptionId,record.qaExemption.id);
    const fields=panelQaExemptionFields(data.panels.find(p=>p.id===record.id),record);assert.equal(fields.qaExemption.active,true);assert.equal(fields.qaExemptionEligible,false);assert.equal(fields.qaExemptionRevocable,true);
  }
});

test('malformed, duplicate, stale and ineligible bulk selections reject before any source changes',()=>{
  const data=state([panel,{...panel,id:'p2'}]),before=structuredClone(data),good=input();
  const invalid=[{}, {action:'unknown'}, {reason:''}, {reason:'x'.repeat(1001)}, {panels:[]}, {panels:Array(501).fill(good)}, {panels:[good,good]}, {panels:[{...good,id:'missing'}]}, {panels:[{...good,cutAt:null}]}, {panels:[{...good,productionSignature:'stale'}]}, {panels:[{id:panel.id}]}, {panels:[{...good,expectedExemptionId:'old'}]}, {panels:[good,{...input(data.panels[1]),productionSignature:'stale'}]}];
  for(const override of invalid){
    const body={action:'grant',reason:'Reason',panels:[good],...override};
    // The empty object represents an entirely missing request definition.
    assert.throws(()=>preparePanelQaExemptions(data,Object.keys(override).length?body:override,actor,at));assert.deepEqual(data,before);
  }
  assert.throws(()=>preparePanelQaExemptions(data,{action:'grant',reason:'Reason',panels:[good]},{username:'staff',isAdmin:false}),error=>error.status===403);
});

test('inspection history, approved panels, failed originals and unfinished routing cannot be exempted',()=>{
  for(const record of [{status:'approved'},{status:'recut'},{status:'replaced'},{status:'rework'},{status:'awaiting',latest:{status:'recut'}},{status:'awaiting',history:[{status:'recut'}]}]){
    const data=state([panel],[{id:panel.id,kind:'panel',...record}]);assert.equal(panelQaExemptionFields(panel,data.records[0]).qaExemptionEligible,false);assert.throws(()=>grant(data),error=>error.status===409);
  }
  assert.throws(()=>grant(state([{...panel,status:'pending'}])),/Only completed/);
  assert.equal(activePanelQaExemption({...panel,qaExemption:{active:true}},null),false);
});

test('revoke and regrant preserve separate immutable history and require the exact current exemption ID',()=>{
  const data=state(),first=grant(data).records[0];data.records=[first];const before=structuredClone(first);
  assert.throws(()=>grant(data),/Only uninspected/);
  assert.throws(()=>preparePanelQaExemptions(data,{action:'revoke',reason:'Inspection now required',panels:[input()]},actor),/requirement changed/);
  const revoked=preparePanelQaExemptions(data,{action:'revoke',reason:'Inspection now required',panels:[input(panel,first)]},actor,'2026-10-30T02:00:00Z').records[0];
  assert.deepEqual(first,before);assert.equal(revoked.status,'awaiting');assert.equal(revoked.qaExemption,null);assert.deepEqual(revoked.history,[]);
  assert.deepEqual(revoked.qaExemptionHistory.map(event=>event.action),['grant','revoke']);assert.deepEqual(revoked.qaExemptionHistory[0],first.qaExemptionHistory[0]);
  data.records=[revoked];const second=grant(data).records[0];assert.notEqual(second.qaExemption.id,first.qaExemption.id);assert.equal(second.qaExemptionHistory.length,3);
});

test('expired grants remain visible, can be revoked, and can be replaced only with the current production signature and old exemption ID',()=>{
  const data=state(),first=grant(data).records[0];data.records=[first];data.panels[0].sheetWidth=1300;
  const fields=panelQaExemptionFields(data.panels[0],first);assert.equal(fields.qaStatus,'awaiting');assert.equal(fields.qaExemption.active,false);assert.equal(fields.qaExemptionEligible,true);assert.equal(fields.qaExemptionRevocable,true);
  assert.throws(()=>grant(data,{panels:[input(panel,first)]}),/production changed/);
  assert.throws(()=>grant(data,{panels:[input(data.panels[0])]}),/requirement changed/);
  const replaced=grant(data).records[0];assert.equal(activePanelQaExemption(data.panels[0],replaced),true);assert.equal(replaced.qaExemptionHistory.length,2);
  const revoked=preparePanelQaExemptions(data,{action:'revoke',reason:'Require inspection',panels:[input(data.panels[0],first)]},actor).records[0];assert.equal(revoked.status,'awaiting');
});

test('completed legacy panels with unknown cut time use null and never invent a completion timestamp',()=>{
  const legacy={...panel,completedAt:null},data=state([legacy]),record=grant(data).records[0];
  assert.equal(record.qaExemption.cutAt,null);assert.equal(record.qaExemptionHistory[0].cutAt,null);assert.equal(activePanelQaExemption(legacy,record),true);assert.equal(data.panels[0].completedAt,null);
  assert.equal(activePanelQaExemption({...legacy,completedAt:at},record),false);
});

test('final dispatched manifests and legacy dispatched panels cannot be exempted or revoked',()=>{
  const data=state(),record=grant(data).records[0];data.records=[record];data.loads=[{id:'sent',status:'dispatched_to_site',panelIds:[panel.id],legs:[{destinationType:'site'}]}];const before=structuredClone(data);
  assert.throws(()=>preparePanelQaExemptions(data,{action:'revoke',reason:'Changed requirement',panels:[input(panel,record)]},actor),/Dispatched panels/);assert.deepEqual(data,before);
  const legacy=state();legacy.dispatches=[{lines:[{id:panel.id,kind:'panel'}]}];assert.throws(()=>grant(legacy),/Dispatched panels/);
});

test('all-exempt loads resolve the production requirement without inventing a fabrication inspection',()=>{
  const data=state(),record=grant(data).records[0],load=reconcilePanelLoads([],data.panels)[0],view=panelLoadView(load,data.panels,[record]);
  assert.equal(view.qaComplete,true);assert.equal(view.fabricationComplete,true);assert.equal(view.fabrication,null);assert.equal(view.readyForSite,true);
  assert.equal(view.items[0].qaStatus,'not_required');assert.equal(view.items[0].qaExemption.active,true);
  assert.equal(transitionPanelLoad(view,dispatch,actor).status,'dispatched_to_site');
  const row=buildSiteOrderRows([order],data.panels,[record])[0];assert.equal(row.QA,'N/A');assert.equal(row['Ready for dispatch'],'✓');assert.equal(row.Notes,'QA not required for 1 panel');
  assert.equal(buildOrderProductionProgress(order,data.panels,[record]).stages.find(stage=>stage.label==='QA').state,'not_applicable');
  const feed=buildSiteOrderFeed([row]);assert.doesNotMatch(feed,/No inspection required|manager|productionSignature|qaExemptionHistory/);
});

test('mixed inspected and exempted panels resolve QA while coating and final QA remain mandatory',()=>{
  const milled={...panel,stockColor:'Milled'},other={...panel,id:'p2',panelNumber:'P2'},data=state([milled,other]),record=grant(state([milled])).records[0],approved={id:other.id,kind:'panel',status:'approved',latest:{checkedBy:'inspector',checkedAt:at}},records=[record,approved];
  let row=buildSiteOrderRows([order],data.panels,records)[0];assert.equal(row.QA,'✓');assert.equal(row['Ready for dispatch'],'-');
  let load=panelLoadView(reconcilePanelLoads([],[milled])[0],[milled],[record]);assert.equal(load.ready,true);assert.equal(load.readyForSite,false);assert.throws(()=>transitionPanelLoad(load,dispatch,actor),/Milled panels/);
  load=transitionPanelLoad(load,{...dispatch,destinationType:'powder_coaters'},actor);load=transitionPanelLoad(panelLoadView(load,[milled],[record]),{action:'coating-complete'},actor);
  assert.equal(panelLoadView(load,[milled],[record]).readyForSite,false);
  load=transitionPanelLoad(panelLoadView(load,[milled],[record]),{action:'final-qa',confirmed:true},actor);
  assert.equal(panelLoadView(load,[milled],[record]).readyForSite,true);
  const pending={...milled,status:'pending'},view=panelLoadView(load,[pending],[record]);assert.equal(view.routing,false);assert.equal(view.qaComplete,false);assert.equal(view.readyForSite,false);
});

test('an exempt replacement cannot resolve the failed original that still needs an inspected replacement',()=>{
  const replacement={...panel,id:'replacement'},record=grant(state([replacement])).records[0],failed={id:panel.id,kind:'panel',status:'replaced',replacementId:replacement.id},panels=new Map([[panel.id,panel],[replacement.id,replacement]]),records=new Map([[panel.id,failed],[replacement.id,record]]);
  const resolution=panelQaResolution(panel,failed,panels,records);assert.equal(resolution.qaResolved,false);assert.equal(resolution.qaBlocker,'Replacement needs QA');
});
