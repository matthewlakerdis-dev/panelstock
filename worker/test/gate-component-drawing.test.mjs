import test from 'node:test';
import assert from 'node:assert/strict';
import {handleGateComponents,gateComponentOrders} from '../src/gate-components.js';
import {currentGateQaRecord,requireCurrentGateQa,syncGateQaProgress} from '../src/gate-order-qa.js';
import {updateGateProduction} from '../src/gate-order-progress.js';

const manager={username:'manager',tasks:{'site.orders.manage':true,'site.orders.view':true}},inspector={username:'inspector',tasks:{'factory.qa':true}};
const id='11111111-1111-4111-8111-111111111111',spec={sets:[{gates:1,highlights:0,posts:0}]};
function fixture(){
 const order={id,orderNumber:100,project:'Gate drawing status',villa:'V100',orderType:'Buggy Gate',status:'approved',requestedBy:'requester',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',items:[{quantity:1,description:'Buggy Gate'}]};
 const docs=new Map([['orders',[order]],['qa-checks',[]]]),audits=[],writes=[];
 const store={env:{GATE_COMPONENTS_ENABLED:'true'},read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>{writes.push(key);docs.set(key,structuredClone(value));},requireTask:(actor,task)=>assert.ok(actor.tasks?.[task],'Task denied'),ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>audits.push(args),notify(){}};
 const raw=()=>store.read('orders',[])[0],records=()=>store.read('qa-checks',[]),view=()=>gateComponentOrders([raw()],records())[0];
 const save=(body={},actor=manager)=>handleGateComponents(store,'/gate-components/orders/'+id+'/plan','POST',{expectedUpdatedAt:raw().updatedAt,spec,areaM2:6,...body},actor);
 const approve=()=>{const rows=records();for(const row of rows.filter(record=>currentGateQaRecord(raw(),record))){const attempt={status:'approved',checkedBy:'inspector',checkedAt:new Date().toISOString(),results:{fit:'pass'},notes:'Original drawing approval'};row.status='approved';row.latest=attempt;row.history=[attempt];store.write('qa-checks',rows);syncGateQaProgress(store,row,inspector);}};
 return {store,raw,view,records,save,approve,writes,audits};
}

test('gate component plans can remain Undrawn with no area or queued QA, then be marked Drawn',()=>{
 const f=fixture(),pending=f.save({drawn:false,areaM2:''}).order;
 assert.equal(pending.drawn,false);assert.equal(pending.components.length,1);assert.ok(pending.components.every(part=>part.drawn===false&&!part.qaId&&!part.ready));assert.equal(pending.areaM2,null);assert.deepEqual(f.records(),[]);assert.equal(f.raw().manualProduction.qaRevision,null);assert.deepEqual(f.raw().manualProduction.qaItemIds,[]);
 const expanded=f.save({drawn:false,areaM2:null,spec:{sets:[{gates:2,highlights:0,posts:0}]}}).order;
 assert.equal(expanded.components[0].id,pending.components[0].id);assert.equal(expanded.components.length,2);assert.equal(f.records().length,0);
 const before=f.raw();assert.throws(()=>f.save({drawn:true,areaM2:''}),/area/);assert.deepEqual(f.raw(),before);assert.equal(f.records().length,0);
 const drawn=f.save({drawn:true,spec:expanded.spec}).order;
 assert.equal(drawn.drawn,true);assert.ok(drawn.components.every(part=>part.drawn&&part.qaStatus==='awaiting'&&part.qaId));assert.deepEqual(drawn.components.map(part=>part.id),expanded.components.map(part=>part.id));assert.equal(f.records().length,2);assert.ok(f.records().every(record=>currentGateQaRecord(f.raw(),record)));
});

test('resetting a gate to Undrawn retains QA evidence and stable parts, then requires a new QA revision',()=>{
 const f=fixture();f.save();f.approve();const approved=f.view(),oldOrder=f.raw(),oldRecords=f.records();
 assert.equal(approved.drawn,true);assert.equal(approved.status,'completed');assert.equal(approved.components[0].qaStatus,'approved');
 const corrected=f.save({drawn:true,areaM2:8}).order;assert.equal(corrected.status,'completed');assert.equal(corrected.components[0].qaId,approved.components[0].qaId);assert.deepEqual(f.records(),oldRecords);assert.equal(f.raw().manualProduction.drawnAt,oldOrder.manualProduction.drawnAt);
 const undrawn=f.save({drawn:false,areaM2:null}).order;
 assert.equal(undrawn.drawn,false);assert.equal(undrawn.status,'approved');assert.equal(undrawn.summary.qa,0);assert.equal(undrawn.components[0].id,approved.components[0].id);assert.equal(undrawn.components[0].drawn,false);assert.equal(undrawn.components[0].qaId,'');assert.equal(undrawn.components[0].ready,false);assert.equal(f.raw().completedAt,null);
 assert.deepEqual(f.raw().manualProduction.stages,{drawn:'pending',fabricatedQa:'pending',readyForDispatch:'pending'});assert.equal(f.raw().manualProduction.drawnAt,null);assert.equal(f.raw().manualProduction.drawnBy,'');assert.equal(f.raw().manualProduction.qaRevision,null);assert.deepEqual(f.raw().manualProduction.qaItemIds,[]);
 assert.deepEqual(f.records(),oldRecords);assert.deepEqual(undrawn.previousQa,oldRecords);assert.throws(()=>requireCurrentGateQa(f.store,oldRecords[0]),/no longer active/);
 f.save({drawn:false});assert.deepEqual(f.records(),oldRecords);assert.deepEqual(f.view().previousQa,oldRecords);
 const redrawn=f.save({drawn:true}).order;assert.equal(redrawn.drawn,true);assert.equal(redrawn.status,'approved');assert.equal(redrawn.components[0].id,approved.components[0].id);assert.notEqual(redrawn.components[0].qaId,approved.components[0].qaId);assert.equal(redrawn.components[0].qaStatus,'awaiting');assert.deepEqual(redrawn.components[0].qaHistory,[]);assert.equal(redrawn.components[0].ready,false);
 assert.notEqual(f.raw().manualProduction.qaRevision,oldOrder.manualProduction.qaRevision);assert.deepEqual(redrawn.previousQa,oldRecords);assert.deepEqual(f.records().find(record=>record.id===oldRecords[0].id),oldRecords[0]);
 const current=f.records().filter(record=>currentGateQaRecord(f.raw(),record));assert.equal(current.length,1);assert.equal(current[0].status,'awaiting');
 f.save({drawn:false});assert.deepEqual(f.view().previousQa,oldRecords,'empty awaiting checks do not clutter earlier QA reports');
});

test('component Drawn status follows Site Orders resets too, without losing earlier reported QA',()=>{
 const f=fixture();f.save();f.approve();const records=f.records();
 updateGateProduction(f.store,id,{expectedUpdatedAt:f.raw().updatedAt,stages:{drawn:'pending'}},manager);
 assert.equal(f.view().drawn,false);assert.equal(f.view().components[0].drawn,false);assert.equal(f.view().components[0].ready,false);assert.deepEqual(f.view().previousQa,records);
 const redrawn=f.save({drawn:true}).order;assert.equal(redrawn.drawn,true);assert.equal(redrawn.components[0].qaStatus,'awaiting');assert.notEqual(redrawn.components[0].qaId,records[0].id);assert.deepEqual(redrawn.previousQa,records);
});

test('converting an existing Drawn legacy order retains its original drawing actor and timestamp',()=>{
 const f=fixture();updateGateProduction(f.store,id,{expectedUpdatedAt:f.raw().updatedAt,stages:{drawn:'complete'},areaM2:6},manager);
 const legacy=f.raw();f.store.write('orders',[{...legacy,manualProduction:{...legacy.manualProduction,drawnBy:'original-drafter',drawnAt:'2026-11-02T01:00:00Z'}}]);
 f.save({drawn:true});assert.equal(f.raw().manualProduction.drawnBy,'original-drafter');assert.equal(f.raw().manualProduction.drawnAt,'2026-11-02T01:00:00Z');
});

test('drawing status validation and dispatched-history guards leave gate plans and QA unchanged',()=>{
 const f=fixture();
 for(const drawn of [null,'pending','false',0,1,{}]){assert.throws(()=>f.save({drawn}),/Drawn or Undrawn/);assert.equal(f.writes.length,0);}
 for(const areaM2 of [-1,0,100000,Infinity,'NaN',true,{}]){assert.throws(()=>f.save({drawn:false,areaM2}),/area/);assert.equal(f.writes.length,0);}
 assert.throws(()=>f.save({drawn:false},inspector),/Task denied/);assert.equal(f.writes.length,0);
 assert.equal(f.save({drawn:false,expectedUpdatedAt:'stale'}).code,'ORDER_CONFLICT');assert.equal(f.writes.length,0);
 f.save();f.approve();const first=f.view().components[0],before=f.raw(),records=f.records();
 for(const field of ['shipments','deliveries']){
  const order=structuredClone(before);order.gateComponents[field]=[{id:'recorded-'+field,componentIds:[first.id]}];f.store.write('orders',[order]);const protectedOrder=f.raw();
  assert.throws(()=>f.save({drawn:false}),error=>error.status===409&&/Dispatched/.test(error.message));assert.deepEqual(f.raw(),protectedOrder);assert.deepEqual(f.records(),records);
 }
 f.store.write('orders',[before]);assert.throws(()=>f.save({drawn:false,spec:{sets:[{gates:2,highlights:0,posts:0}]},areaM2:NaN}),/area/);assert.deepEqual(f.raw(),before);
});

test('Undrawn component editing preserves inspected-part removal restrictions and default clients still confirm Drawn',()=>{
 const f=fixture();f.save({spec:{sets:[{gates:2,highlights:0,posts:0}]}});f.approve();const before=f.raw();
 assert.throws(()=>f.save({drawn:false}),error=>error.status===409&&/cannot be removed/.test(error.message));assert.deepEqual(f.raw(),before);
 const reset=f.save({drawn:false,spec:before.gateComponents.spec}).order;assert.equal(reset.drawn,false);
 assert.throws(()=>f.save({drawn:false}),error=>error.status===409&&/cannot be removed/.test(error.message));
 const redrawn=f.save({spec:before.gateComponents.spec}).order;assert.equal(redrawn.drawn,true);assert.ok(redrawn.components.every(part=>part.qaStatus==='awaiting'));
});
