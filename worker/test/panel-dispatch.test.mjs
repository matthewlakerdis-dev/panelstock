import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePanelLoads,panelLoadView,transitionPanelLoad} from '../src/panel-dispatch.js';
const actor={username:'dispatcher'},p={id:'p1',jobReference:'Project',orderNumber:'001',panelNumber:'P1',status:'pending'};
const approved=[{id:'p1',kind:'panel',status:'approved'}];
const dispatch={action:'dispatch',destinationType:'site',destination:'Site address',transport:'Truck',driver:'Alex'};
function ready(){const panels=[{...p,status:'completed'}],load=reconcilePanelLoads([],panels)[0],view=panelLoadView(load,panels,approved);return view;}
test('schedule creates one stable load per project and order, removes cancelled empty loads',()=>{const loads=reconcilePanelLoads([],[p,{...p,id:'p2'}]);assert.equal(loads.length,1);assert.equal(loads[0].panelIds.length,2);assert.deepEqual(reconcilePanelLoads(loads,[p,{...p,id:'p2'}]),loads);assert.equal(reconcilePanelLoads(loads,[]).length,0);});
test('QA automatically confirms fabrication; pending or reopened QA blocks dispatch',()=>{const r=ready();assert.equal(r.fabricationComplete,true);assert.equal(r.ready,true);for(const panels of [[p],[{...p,status:'completed'}]]){const view=panelLoadView(r,panels,[]);assert.equal(view.fabricationComplete,false);assert.equal(view.ready,false);assert.throws(()=>transitionPanelLoad(view,dispatch,{...actor,isAdmin:true}),/must all be complete/);}assert.throws(()=>transitionPanelLoad(r,{action:'fabricate'},actor),/Unknown load action/);});
test('direct site dispatch is final and cannot be duplicated',()=>{const sent=transitionPanelLoad(ready(),dispatch,actor);assert.equal(sent.status,'dispatched_to_site');assert.equal(sent.legs.length,1);assert.throws(()=>transitionPanelLoad(sent,dispatch,actor),/cannot be dispatched again/);});
test('powder coating requires a separate final QA before site dispatch',()=>{
 const sent=transitionPanelLoad(ready(),{...dispatch,destinationType:'powder_coaters'},actor);
 assert.equal(sent.status,'at_powder_coaters');
 assert.throws(()=>transitionPanelLoad(sent,{action:'final-qa',confirmed:true},actor),/Complete powder coating/);
 const coated=transitionPanelLoad(sent,{action:'coating-complete'},actor),view=panelLoadView(coated,[{...p,status:'completed'}],approved);
 assert.equal(view.status,'awaiting_final_qa');assert.equal(view.ready,false);
 assert.throws(()=>transitionPanelLoad(view,dispatch,actor),/cannot be dispatched again/);
 assert.throws(()=>transitionPanelLoad(view,{action:'final-qa'},actor),/Confirm the whole load/);
 const checked=transitionPanelLoad(view,{action:'final-qa',confirmed:true},actor,'2026-09-29T01:00:00Z');
 assert.deepEqual(checked.finalQa,{by:'dispatcher',at:'2026-09-29T01:00:00Z'});
 const readyView=panelLoadView(checked,[{...p,status:'completed'}],approved);
 assert.equal(readyView.ready,true);
 assert.throws(()=>transitionPanelLoad(readyView,{...dispatch,destinationType:'powder_coaters'},actor),/must go to site/);
 const site=transitionPanelLoad(readyView,dispatch,actor);assert.equal(site.status,'dispatched_to_site');assert.equal(site.legs.length,2);
 assert.throws(()=>transitionPanelLoad(site,dispatch,actor),/cannot be dispatched again/);
});
test('old unsent coated loads cannot bypass final QA and reopened production QA blocks approval',()=>{
 const old={...ready(),status:'ready_for_site',coatingCompleted:{by:'old',at:'2026-09-01'}};
 const view=panelLoadView(old,[{...p,status:'completed'}],approved);assert.equal(view.status,'awaiting_final_qa');assert.equal(view.ready,false);
 assert.throws(()=>transitionPanelLoad(panelLoadView(old,[p],[]),{action:'final-qa',confirmed:true},actor),/must still be complete/);
});
test('new panels or edited production invalidate fabrication but never modify a sent manifest',()=>{const r=ready();assert.equal(reconcilePanelLoads([r],[{...p,status:'completed',panelNumber:'Changed'}])[0].fabrication,null);const sent=transitionPanelLoad(r,dispatch,actor),loads=reconcilePanelLoads([sent],[{...p,status:'completed'},{...p,id:'p2'}]);assert.equal(loads.length,2);assert.deepEqual(loads[0].panelIds,['p1']);assert.deepEqual(loads[1].panelIds,['p2']);});
test('legacy dispatched panels are not dispatched twice',()=>{assert.equal(reconcilePanelLoads([],[p],[{lines:[{id:'p1',kind:'panel',quantity:1}]}]).length,0);});
test('failed originals require an approved replacement in the same load',()=>{const panels=[{...p,status:'completed'},{...p,id:'replacement',status:'completed'}],load=reconcilePanelLoads([],panels)[0],records=[{id:'p1',kind:'panel',status:'replaced',replacementId:'replacement'},{id:'replacement',kind:'panel',status:'approved'}];assert.equal(panelLoadView(load,panels,records).qaComplete,true);records[1].status='recut';assert.equal(panelLoadView(load,panels,records).qaComplete,false);});
test('fabrication waits for every panel and records the final QA approval',()=>{const panels=[{...p,status:'completed'},{...p,id:'p2',status:'completed'}],load=reconcilePanelLoads([],panels)[0],first={...approved[0],latest:{checkedBy:'qa-one',checkedAt:'2026-09-29T05:00:00Z'}};assert.equal(panelLoadView(load,panels,[first]).fabricationComplete,false);const final={id:'p2',kind:'panel',status:'approved',latest:{checkedBy:'qa-two',checkedAt:'2026-09-29T05:05:00Z'}},view=panelLoadView(load,panels,[first,final]);assert.deepEqual(view.fabrication,{by:'qa-two',at:'2026-09-29T05:05:00Z',source:'qa'});assert.equal(view.ready,true);const expanded=reconcilePanelLoads([load],[...panels,{...p,id:'p3'}])[0];assert.equal(panelLoadView(expanded,[...panels,{...p,id:'p3'}],[first,final]).fabricationComplete,false);});
