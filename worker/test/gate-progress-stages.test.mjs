import test from 'node:test';
import assert from 'node:assert/strict';
import {gateProgressStages,gateProgressSummary,isGateProgressComplete} from '../src/gate-progress-stages.js';
const part=(input={})=>({drawn:true,qaStatus:'awaiting',ready:false,shipment:null,delivery:null,...input});
const order=(components=[],input={})=>({components,scheduledForProduction:false,legacyStages:null,...input});
const byKey=stages=>Object.fromEntries(stages.map(stage=>[stage.key,stage]));
const approved=()=>part({qaStatus:'approved',ready:true});

test('stage counts are exposed numerically without changing the established state, symbol or detail',()=>{
 const stages=byKey(gateProgressStages([approved(),part()],{scheduled:1}));
 assert.equal(stages.drawn.count,2);assert.equal(stages.drawn.total,2);assert.equal(stages.drawn.state,'complete');assert.equal(stages.drawn.symbol,'✓');assert.equal(stages.drawn.detail,'2/2 complete');
 assert.equal(stages.fabricatedQa.count,1);assert.equal(stages.fabricatedQa.total,2);assert.equal(stages.fabricatedQa.state,'pending');assert.equal(stages.fabricatedQa.symbol,'-');assert.equal(stages.fabricatedQa.detail,'1/2 complete');
 assert.equal(stages.scheduledForProduction.count,1);assert.equal(stages.scheduledForProduction.total,1);assert.equal(stages.scheduledForProduction.detail,'1/1 complete');
 const legacy=byKey(gateProgressStages([],{missing:true,legacyStages:{drawn:true}}));assert.equal(legacy.drawn.count,1);assert.equal(legacy.drawn.total,1);assert.equal(legacy.drawn.state,'complete');
 assert.ok(Object.values(stages).every(stage=>typeof stage.count==='number'&&typeof stage.total==='number'));
});

test('villa summaries retain component progress while counting scheduling in orders rather than parts',()=>{
 const first=order([approved(),approved()],{scheduledForProduction:true});first.components[0].shipment={at:'2026-11-11T01:00:00Z'};
 const second=order([approved(),approved(),part(),part(),part(),part()]);
 const stages=byKey(gateProgressSummary([first,second]));
 assert.equal(stages.drawn.count,8);assert.equal(stages.drawn.total,8);assert.equal(stages.drawn.unit,'parts');assert.equal(stages.drawn.state,'complete');
 assert.equal(stages.scheduledForProduction.count,1);assert.equal(stages.scheduledForProduction.total,2);assert.equal(stages.scheduledForProduction.unit,'orders');assert.equal(stages.scheduledForProduction.state,'pending');assert.equal(stages.scheduledForProduction.setupOrders,0);
 for(const key of ['fabricatedQa','readyForDispatch']){assert.equal(stages[key].count,4);assert.equal(stages[key].total,8);assert.equal(stages[key].state,'pending');}
 assert.equal(stages.dispatched.count,1);assert.equal(stages.dispatched.total,8);assert.equal(stages.delivered.count,0);
});

test('mixed legacy and component orders report both kinds of progress without inventing parts or false completion',()=>{
 const shipped=order([approved(),approved()]);shipped.components.forEach(component=>{component.shipment={at:'2026-11-11T01:00:00Z'};});
 const legacy=order([],{legacyStages:{drawn:true,fabricatedQa:true,readyForDispatch:true,dispatched:false}}),stages=byKey(gateProgressSummary([shipped,legacy]));
 for(const key of ['drawn','fabricatedQa','readyForDispatch']){assert.equal(stages[key].count,2);assert.equal(stages[key].total,2);assert.equal(stages[key].unit,'parts');assert.equal(stages[key].setupOrders,1);assert.equal(stages[key].state,'complete');assert.match(stages[key].detail,/1\/1 orders without component details complete/);}
 assert.equal(stages.dispatched.count,2);assert.equal(stages.dispatched.total,2);assert.equal(stages.dispatched.state,'pending','undispatched legacy order prevents a false green summary');assert.match(stages.dispatched.detail,/0\/1 orders without component details complete/);
 const missing=byKey(gateProgressSummary([shipped,order()]));assert.equal(missing.drawn.count,2);assert.equal(missing.drawn.total,2);assert.equal(missing.drawn.state,'pending');assert.equal(missing.drawn.setupOrders,1);assert.match(missing.drawn.detail,/0\/1 orders without component details complete/);
});

test('componentless-only summaries use order units and trust only the recorded legacy stage flags',()=>{
 const first=order([],{scheduledForProduction:true,legacyStages:{drawn:true,fabricatedQa:true,readyForDispatch:true}}),second=order([],{legacyStages:{drawn:false,fabricatedQa:false,readyForDispatch:false}}),stages=byKey(gateProgressSummary([first,second]));
 for(const key of ['drawn','fabricatedQa','readyForDispatch']){assert.equal(stages[key].count,1);assert.equal(stages[key].total,2);assert.equal(stages[key].unit,'orders');assert.equal(stages[key].setupOrders,2);assert.equal(stages[key].state,'pending');}
 assert.equal(stages.scheduledForProduction.count,1);assert.equal(stages.scheduledForProduction.total,2);assert.equal(stages.scheduledForProduction.setupOrders,0);
 const legacyComplete=byKey(gateProgressSummary([first]));assert.equal(legacyComplete.drawn.state,'complete');assert.equal(legacyComplete.drawn.count,1);
 const unknown=byKey(gateProgressSummary([order([],{drawn:true,scheduledForProduction:true})]));assert.equal(unknown.drawn.count,0);assert.equal(unknown.drawn.total,1);assert.equal(unknown.drawn.state,'pending');assert.equal(unknown.scheduledForProduction.state,'complete');
});

test('rework takes precedence over a villa QA summary while preserving approved and scheduled counts',()=>{
 const stages=byKey(gateProgressSummary([order([approved(),part({qaStatus:'recut'})],{scheduledForProduction:true}),order([],{legacyStages:{fabricatedQa:true}})]));
 assert.equal(stages.fabricatedQa.count,1);assert.equal(stages.fabricatedQa.total,2);assert.equal(stages.fabricatedQa.state,'rework');assert.equal(stages.fabricatedQa.setupOrders,1);assert.match(stages.fabricatedQa.detail,/Rework required for 1 component/);
 assert.equal(stages.drawn.state,'pending','unknown legacy Drawn does not become complete because the configured parts are drawn');assert.equal(stages.scheduledForProduction.count,1);assert.equal(stages.scheduledForProduction.total,2);
});

test('explicit Undrawn parts remain pending and older components without that flag keep their existing behavior',()=>{
 const old=part();delete old.drawn;
 const stages=byKey(gateProgressSummary([order([part({drawn:false}),part({drawn:false})],{drawn:false}),order([old])]));
 assert.equal(stages.drawn.count,1);assert.equal(stages.drawn.total,3);assert.equal(stages.drawn.state,'pending');assert.equal(stages.drawn.symbol,'-');assert.equal(stages.fabricatedQa.count,0);
});

test('empty summaries never display completion and aggregation does not mutate or filter source orders',()=>{
 const empty=gateProgressSummary([]);assert.equal(empty.length,6);assert.ok(empty.every(stage=>stage.count===0&&stage.total===0&&stage.state==='pending'&&stage.setupOrders===0));
 const component=approved();component.shipment={at:'2026-11-11T01:00:00Z'};component.delivery={at:'2026-11-11T02:00:00Z'};const delivered=order([component],{status:'dispatched'}),input=[delivered],before=structuredClone(input);
 assert.equal(isGateProgressComplete(delivered),true);assert.equal(isGateProgressComplete({...delivered,components:[{...component,delivery:null}]}),false);assert.equal(isGateProgressComplete({components:[],status:'dispatched'}),true);
 const stages=byKey(gateProgressSummary(input));assert.equal(stages.delivered.count,1);assert.equal(stages.delivered.total,1);assert.equal(stages.delivered.state,'complete');assert.deepEqual(input,before);
});
