import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correctOrderType} from '../src/order-type-correction.js';
import {buildOrderProductionProgress} from '../src/order-production-progress.js';
const base={id:'order-one',orderNumber:'7',project:'Project A',projectId:'project-a',orderType:'Panels',status:'approved',requestedBy:'leading-hand',siteContact:'Contact',phone:'0400',requestedDeliveryDate:'2026-11-05',scheduledDeliveryDate:'2026-11-06',scheduledDeliveryTime:'08:00',items:[{quantity:2,description:'BOLTS'}],attachments:[{id:'file'}],receipts:[],createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
const admin={username:'admin',isAdmin:true};
function fixture(patch={},docs={}){
 let orders=[structuredClone({...base,...patch}),{...base,id:'unrelated'}];const audits=[],writes=[];
 const store={read:(key,fallback)=>key==='orders'?structuredClone(orders):structuredClone(docs[key]??fallback),write:(key,value)=>{writes.push(key);orders=structuredClone(value);},orderDrawingProjects:()=>docs.cad||[],ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>audits.push(args)};
 const save=(body={},actor=admin)=>correctOrderType(store,base.id,{orderType:'Fixings',expectedUpdatedAt:orders[0].updatedAt,...body},actor);
 return {store,save,audits,writes,orders:()=>orders};
}
test('an admin corrects a mistaken Panel type without changing the order, status, items, contacts, files or dates',()=>{
 const f=fixture(),saved=f.save({status:'completed',items:[],requestedBy:'attacker'}).order;
 const expected={...base,orderType:'Fixings',orderTypeOther:'',updatedBy:'admin',updatedAt:saved.updatedAt};assert.deepEqual(saved,expected);assert.ok(saved.updatedAt>base.updatedAt);assert.deepEqual(f.writes,['orders']);assert.equal(f.audits[0][1],'order-type-changed');assert.equal(f.audits[0][2].previousOrderType,'Panels');assert.equal(f.audits[0][2].orderType,'Fixings');assert.deepEqual(f.orders()[1],{...base,id:'unrelated'});
 const progress=buildOrderProductionProgress(saved);assert.ok(progress.stages.slice(0,-1).every(stage=>stage.state==='not_applicable'));assert.equal(progress.stages.at(-1).state,'pending');
});
test('configured types and Other details work; Gate begins pending without creating QA or bypassing readiness',()=>{
 const f=fixture({}, {'order-types':['Gate']});const gate=f.save({orderType:' gate '}).order;assert.equal(gate.orderType,'Gate');assert.equal(gate.status,'approved');assert.equal(gate.manualProduction,undefined);assert.ok(buildOrderProductionProgress(gate).stages.filter(stage=>['Drawn','Fabricated / QA','Ready for dispatch'].includes(stage.label)).every(stage=>stage.state==='pending'));assert.deepEqual(f.writes,['orders']);
 assert.equal(fixture().save({orderType:'Other',orderTypeOther:'  Safety   equipment '}).order.orderTypeOther,'Safety equipment');
});
test('non-admins, missing selections, unknown types and same-type changes cannot write',()=>{
 for(const actor of [{username:'user'},{username:'manager',isAdmin:false,tasks:{'site.orders.manage':true}}]){const f=fixture();assert.throws(()=>f.save({},actor),/Admin access/);assert.equal(f.writes.length,0);}
 for(const body of [{orderType:''},{orderType:null},{orderType:'Unknown'},{orderType:'PANELS'},{orderType:'Other',orderTypeOther:'x'.repeat(81)}]){const f=fixture();assert.throws(()=>f.save(body));assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);}
});
test('stale editors, already-corrected orders and terminal statuses cannot mutate the order',()=>{
 const f=fixture();assert.equal(f.save({expectedUpdatedAt:'old'}).code,'ORDER_CONFLICT');assert.equal(f.writes.length,0);
 for(const patch of [{orderType:'Fixings'},{status:'completed'},{status:'dispatched'},{status:'cancelled'}]){const f=fixture(patch);assert.throws(()=>f.save());assert.equal(f.writes.length,0);}
 assert.throws(()=>correctOrderType(f.store,'missing',{},admin),/not found/);
});
test('drawings, CNC, QA, dispatch loads and manual production cannot be detached by a type correction',()=>{
 const match={projectId:base.projectId,project:base.project,orderNumber:base.orderNumber};
 for(const docs of [{cad:[{drawingProgress:{projectId:base.projectId,orderNumber:'7',total:0,projectName:base.project}}]},{'app:cncPanels':[{...match,status:'pending'}]},{'qa-checks':[{...match,kind:'metalwork',status:'awaiting'}]},{'qa-checks':[{gateOrderId:base.id}]},{'panel-dispatch-loads':[{...match,panelIds:['panel']}]}]){const f=fixture({manualDrawing:{drawn:false}},docs);assert.throws(()=>f.save(),/linked drawings or factory production/);assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);}
 for(const patch of [{manualDrawing:{drawn:true}},{manualProduction:{stages:{drawn:'complete'}}}]){const f=fixture(patch);assert.throws(()=>f.save(),/linked drawings or factory production/);assert.equal(f.writes.length,0);}
});
test('another project or order does not prevent correcting this order; a repeated stale request cannot change it again',()=>{
 const f=fixture({}, {'app:cncPanels':[{projectId:'other-project',project:base.project,orderNumber:'7'},{projectId:base.projectId,orderNumber:'8'}]});assert.equal(f.save().ok,true);const again=f.save({expectedUpdatedAt:base.updatedAt});assert.equal(again.code,'ORDER_CONFLICT');assert.equal(f.writes.length,1);
});
