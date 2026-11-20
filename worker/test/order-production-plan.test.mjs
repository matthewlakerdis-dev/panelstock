import test from 'node:test';
import assert from 'node:assert/strict';
import {updateProductionPlanFromBooking,PLAN_STAGES,powderPickupDate,getProductionPlan,saveProductionPlan,productionPlanSchedule,removeProductionPlan,productionPlanDates,productionPlanSummaries} from '../src/order-production-plan.js';

const admin={username:'admin',isAdmin:true},manager={username:'manager',isAdmin:false,tasks:{'schedule.manage':true,'site.orders.view':true}},viewer={username:'viewer',tasks:{'site.orders.view':true,'schedule.view':true}};
const order={id:'order',orderNumber:'3',project:'Synthetic project',projectId:'project',orderType:'Panels',status:'submitted',requestedBy:'requester',requestedDeliveryDate:'2026-11-30',scheduledDeliveryDate:'',scheduledDeliveryTime:'',items:[{quantity:2,description:'PANELS'}],manualDrawing:{drawn:false},updatedAt:'2026-11-19T00:00:00Z'};
const stages=()=>Object.fromEntries(PLAN_STAGES.map(([name])=>[name,{date:'',notApplicable:false,assignedUsername:'',notes:''}]));
function fixture(){
 let docs=new Map([['orders',[structuredClone(order)]]]),audit=[],alerts=[];const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>{if(store.fail===key)throw Error('Storage failed');docs.set(key,structuredClone(value));},audit:(...args)=>audit.push(args),notify:(...args)=>alerts.push(args),scheduleAllPeople:()=>[{username:'manager',displayName:'Manager'},{username:'vehicle:ute',displayName:'Ute',kind:'vehicle'}],requireTask:(actor,code)=>{if(!actor.isAdmin&&!actor.tasks?.[code])throw Error('Access denied');},ctx:{storage:{transactionSync:fn=>{const before=structuredClone(docs),events=structuredClone(audit),messages=structuredClone(alerts);try{return fn();}catch(e){docs=before;audit=events;alerts=messages;throw e;}}}},sql:{exec:(_,key)=>docs.delete(key)}};
 const body=()=>({mutationId:crypto.randomUUID(),expectedRevision:getProductionPlan(store,'order',admin).plan.revision,expectedOrderUpdatedAt:store.read('orders')[0].updatedAt,stages:stages(),scheduledDeliveryDate:'',scheduledDeliveryTime:''});
 return {store,body,docs:()=>docs,audit:()=>audit,alerts:()=>alerts};
}
test('powder pickup is five working days after sending across weekends, leap dates and year ends',()=>{
 for(const [send,pickup] of [['2026-11-20','2026-11-27'],['2026-11-21','2026-11-27'],['2026-12-31','2027-01-07'],['2028-02-25','2028-03-03']])assert.equal(powderPickupDate(send),pickup);assert.equal(powderPickupDate(''),'');
});
test('the plan uses the requested compact stages, and reading an unplanned order never writes',()=>{
 const f=fixture(),before=structuredClone(f.docs()),data=getProductionPlan(f.store,'order',viewer);assert.deepEqual([...f.docs()], [...before]);assert.equal(data.canEdit,false);assert.deepEqual(data.people,[]);assert.deepEqual(Object.keys(data.plan.stages),['stockOrder','drawnCnc','cnc','fabrication','powderCoating']);assert.equal(data.plan.revision,0);assert.equal(f.audit().length,0);
});
test('planning leaves production, QA, requested dates and items intact and never creates schedule bookings',()=>{
 const f=fixture(),body=f.body();body.stages.drawnCnc.date='2026-11-23';body.stages.fabrication.date='2026-11-24';body.stages.powderCoating.date='2026-11-20';body.stages.powderCoating.assignedUsername='manager';const before=f.store.read('orders');
 const result=saveProductionPlan(f.store,'order',body,manager);assert.equal(result.plan.powderPickupDate,'2026-11-27');assert.deepEqual(f.store.read('orders'),before);assert.deepEqual(f.store.read('schedule',[]),[]);assert.equal(f.alerts().length,0);assert.equal(f.audit().length,1);assert.equal(result.canScheduleDelivery,false);
 const retry=saveProductionPlan(f.store,'order',body,manager);assert.equal(retry.duplicate,true);assert.equal(f.audit().length,1);
 const milestones=productionPlanSchedule(f.store,admin);assert.equal(milestones.length,4);assert.equal(milestones.find(row=>row.stage==='powderPickup').date,'2026-11-27');assert.equal(milestones.find(row=>row.stage==='powderPickup').assignedTo,'');assert.equal(new Set(milestones.map(row=>row.id)).size,4);
});
test('invalid, unauthorized and stale plans cannot change stored dates or delivery',()=>{
 const f=fixture(),body=f.body();assert.throws(()=>saveProductionPlan(f.store,'order',body,viewer),/requires schedule access/);
 for(const change of [b=>b.stages.powderCoating.date='2026-02-30',b=>b.stages.drawnCnc.date='bad',b=>b.stages.fabrication.notes='x'.repeat(501),b=>b.stages.finalQa={date:'2026-11-20'},b=>{b.stages.stockOrder.date='2026-11-20';b.stages.stockOrder.notApplicable=true;}]){const value=structuredClone(body);change(value);assert.throws(()=>saveProductionPlan(f.store,'order',value,admin));}
 assert.equal(f.audit().length,0);body.scheduledDeliveryDate='2026-12-01';assert.throws(()=>saveProductionPlan(f.store,'order',body,manager),/Only admins/);body.scheduledDeliveryDate='';body.stages.stockOrder.date='2026-11-20';saveProductionPlan(f.store,'order',body,admin);
 const stale={...body,mutationId:crypto.randomUUID()};assert.throws(()=>saveProductionPlan(f.store,'order',stale,admin),e=>e.code==='PLAN_CONFLICT');assert.equal(f.audit().length,1);
 const changed=f.body();changed.expectedOrderUpdatedAt='old';assert.throws(()=>saveProductionPlan(f.store,'order',changed,admin),e=>e.code==='ORDER_CONFLICT');
});
test('delivery uses the existing confirmed-date workflow and rolls back with a failed plan save',()=>{
 const f=fixture(),body=f.body();body.stages.powderCoating.date='2026-11-20';body.scheduledDeliveryDate='2026-11-30';body.scheduledDeliveryTime='09:30';const before=f.store.read('orders'),notify=f.store.notify;let attemptedNotifications=0;f.store.notify=(...args)=>{attemptedNotifications++;notify(...args);};f.store.fail='production-plan:order';assert.throws(()=>saveProductionPlan(f.store,'order',body,admin),/Storage failed/);assert.deepEqual(f.store.read('orders'),before);assert.equal(f.alerts().length,0);assert.equal(f.audit().length,0);assert.equal(attemptedNotifications,0);
 f.store.fail='';const result=saveProductionPlan(f.store,'order',body,admin);assert.equal(result.order.scheduledDeliveryDate,'2026-11-30');assert.equal(result.order.scheduledDeliveryTime,'09:30');assert.equal(result.order.requestedDeliveryDate,order.requestedDeliveryDate);assert.equal(result.order.status,order.status);assert.equal(f.alerts().length,1);assert.equal(f.audit().length,2);assert.equal(productionPlanSchedule(f.store,admin).find(row=>row.stage==='siteDelivery').date,'2026-11-30');saveProductionPlan(f.store,'order',body,admin);assert.equal(f.alerts().length,1);
});
test('Schedule permissions, closed orders and deletion preserve privacy and prevent orphan milestones',()=>{
 const f=fixture(),body=f.body();body.stages.stockOrder.date='2026-11-20';saveProductionPlan(f.store,'order',body,admin);assert.equal(productionPlanSchedule(f.store,viewer).length,1);assert.equal(productionPlanSchedule(f.store,{tasks:{'schedule.view':true}}).length,0);assert.equal(productionPlanSchedule(f.store,{tasks:{'site.orders.view':true,'schedule.cnc.view':true}}).length,0);
 const values=f.store.read('orders');values[0].status='dispatched';f.store.write('orders',values);assert.equal(productionPlanSchedule(f.store,admin).length,0);assert.equal(getProductionPlan(f.store,'order',admin).canEdit,false);assert.equal(saveProductionPlan(f.store,'order',body,admin).duplicate,true);assert.throws(()=>saveProductionPlan(f.store,'order',f.body(),admin),/cannot be replanned/);removeProductionPlan(f.store,'order');assert.equal(f.store.read('production-plan:order',null),null);assert.deepEqual(f.store.read('production-plan-index'),[]);
});

test('order types determine the plan and timeline, including all Gate types and older stored plans',()=>{
 for(const [orderType,expected] of [['Panels',['Order stock','Drawn / Toolpath','CNC','Fabrication','Powder coating']],...['Gate','Bin Gate','Buggy Gate','Side Access Gate'].map(type=>[type,['Order stock','Drawn','Fabrication']]),...['Fabrication','Fibre Cement','Consumables','Fixings','Plant / Equipment','Other','Custom'].map(type=>[type,['Order']])]){
  const f=fixture(),orders=f.store.read('orders');orders[0].orderType=orderType;f.store.write('orders',orders);
  const oldStages=stages();for(const row of Object.values(oldStages)){row.date='2026-11-20';row.assignedUsername='manager';}
  f.store.write('production-plan:order',{revision:2,stages:oldStages});f.store.write('production-plan-index',['order']);const before=[...f.docs()];
  const data=getProductionPlan(f.store,'order',admin);assert.deepEqual(data.stageDefinitions.map(row=>row[1]),expected,orderType);assert.deepEqual(data.people,[]);assert.ok(Object.values(data.plan.stages).every(row=>row.assignedUsername===''));
  const milestones=productionPlanSchedule(f.store,admin);assert.equal(milestones.length,expected.length+(orderType==='Panels'?1:0));assert.ok(milestones.every(row=>row.assignedUsername===''&&row.assignedTo===''));assert.deepEqual([...f.docs()],before,'read projection must leave older stored plans intact');
  if(orderType!=='Panels')assert.equal(data.plan.powderPickupDate,'');if(expected.length===1)assert.deepEqual(milestones.map(row=>row.label),['Order']);
 }
});
test('unlinked Panels use the saved coating choice; linked finishes override it with safe project matching',()=>{
 const f=fixture(),body=f.body();body.panelCoating='already_coated';body.stages.powderCoating.date='2026-11-20';let data=saveProductionPlan(f.store,'order',body,admin);
 assert.equal(data.coating.canChoose,true);assert.equal(data.coating.selection,'already_coated');assert.equal(data.stageDefinitions.length,4);assert.equal(data.plan.powderPickupDate,'');assert.equal(f.store.read('production-plan:order').stages.powderCoating.date,'');
 const setPanels=values=>f.store.write('app:cncPanels',values),panel={id:'panel',projectId:'project',orderNumber:'3',stockColor:'Milled'};
 setPanels([{...panel,projectId:'other',stockColor:'White'}]);assert.equal(getProductionPlan(f.store,'order',admin).coating.canChoose,true);
 setPanels([panel]);data=getProductionPlan(f.store,'order',admin);assert.equal(data.coating.canChoose,false);assert.equal(data.stageDefinitions.length,5);assert.equal(data.coating.required,true);
 setPanels([{...panel,stockColor:'White'}]);data=getProductionPlan(f.store,'order',admin);assert.equal(data.stageDefinitions.length,4);assert.equal(data.coating.required,false);
 setPanels([{...panel,stockColor:'White'},{...panel,id:'mill'}]);assert.equal(getProductionPlan(f.store,'order',admin).stageDefinitions.length,5);
 setPanels([{...panel,stockColor:'',stockVariantId:'stock'}]);assert.equal(getProductionPlan(f.store,'order',admin).coating.canChoose,true);f.store.write('app:variants',[{id:'stock',color:'Norwegian Beech'}]);assert.equal(getProductionPlan(f.store,'order',admin).coating.canChoose,false);assert.equal(getProductionPlan(f.store,'order',admin).stageDefinitions.length,4);
});
test('omitted steps and deprecated people cannot be saved into effective schedules, even by an older client',()=>{
 const f=fixture(),orders=f.store.read('orders');orders[0].orderType='Bin Gate';f.store.write('orders',orders);const body=f.body();for(const row of Object.values(body.stages)){row.date='2026-11-20';row.assignedUsername='old-person';}
 const data=saveProductionPlan(f.store,'order',body,admin),saved=f.store.read('production-plan:order');assert.equal(saved.stages.powderCoating.date,'');assert.equal(data.plan.powderPickupDate,'');assert.ok(Object.values(saved.stages).every(row=>!Object.hasOwn(row,'assignedUsername')));assert.equal(data.stageDefinitions.find(([key])=>key==='drawnCnc')[1],'Drawn');assert.equal(productionPlanSummaries(f.store,orders).order.powderPickupDate,'');assert.ok(productionPlanSchedule(f.store,admin).every(row=>row.stage!=='powderCoating'&&row.stage!=='powderPickup'));
 orders[0].orderType='Fabrication';f.store.write('orders',orders);assert.deepEqual(productionPlanDates(orders[0],saved).map(row=>row.label),['Order']);
});
test('previous-client retries remain idempotent and a coating choice cannot change under an existing mutation',()=>{
 const f=fixture(),body=f.body();body.stages.drawnCnc.date='2026-11-20';delete body.stages.cnc;const oldFingerprint=JSON.stringify({stages:body.stages,scheduledDeliveryDate:'',scheduledDeliveryTime:''});f.store.write('production-plan:order',{revision:1,stages:body.stages,mutations:[{id:body.mutationId,fingerprint:oldFingerprint}]});
 assert.equal(saveProductionPlan(f.store,'order',body,admin).duplicate,true);assert.equal(f.audit().length,0);
 const next=f.body();next.panelCoating='required';next.stages.fabrication.date='2026-11-23';saveProductionPlan(f.store,'order',next,admin);next.panelCoating='already_coated';assert.throws(()=>saveProductionPlan(f.store,'order',next,admin),/different plan changes/);
});

test('list summaries include every applicable stage in production order and blank dates without creating plans',()=>{
 const f=fixture(),before=structuredClone([...f.docs()]),summary=productionPlanSummaries(f.store,f.store.read('orders')).order;
 assert.deepEqual(summary.milestones.map(row=>row.stage),['stockOrder','drawnCnc','cnc','fabrication','powderCoating','powderPickup']);assert.ok(summary.milestones.every(row=>row.date===''));assert.equal(summary.revision,0);assert.deepEqual([...f.docs()],before);
 const body=f.body();body.stages.drawnCnc.date='2026-11-24';body.stages.powderCoating.date='2026-11-20';const saved=saveProductionPlan(f.store,'order',body,admin);assert.deepEqual(saved.summary,productionPlanSummaries(f.store,f.store.read('orders')).order);assert.equal(saved.summary.milestones.find(row=>row.stage==='stockOrder').date,'');assert.equal(saved.summary.milestones.find(row=>row.stage==='powderPickup').date,'2026-11-27');
 const orders=f.store.read('orders');orders[0].orderType='Bin Gate';f.store.write('orders',orders);assert.deepEqual(productionPlanSummaries(f.store,orders).order.milestones.map(row=>row.label),['Order stock','Drawn','Fabrication']);orders[0].orderType='Consumables';f.store.write('orders',orders);assert.deepEqual(productionPlanSummaries(f.store,orders).order.milestones,[{stage:'stockOrder',label:'Order',date:''}]);
});

test('older panel plans retain their drawing date and older saves preserve separately planned CNC',()=>{
 const f=fixture(),oldStages=stages();delete oldStages.cnc;
 oldStages.drawnCnc={date:'2026-11-20',notApplicable:false,notes:'Original plan'};
 f.store.write('production-plan:order',{revision:1,stages:oldStages});
 const initial=getProductionPlan(f.store,'order',admin);
 assert.equal(initial.plan.stages.drawnCnc.date,'2026-11-20');
 assert.equal(initial.plan.stages.drawnCnc.notes,'Original plan');
 assert.equal(initial.plan.stages.cnc.date,'');
 const body=f.body();body.stages.drawnCnc=oldStages.drawnCnc;
 body.stages.cnc={date:'2026-11-23',notApplicable:false,notes:'CNC setup'};
 saveProductionPlan(f.store,'order',body,admin);
 const legacy=f.body();legacy.stages.drawnCnc.date='2026-11-24';delete legacy.stages.cnc;
 const saved=saveProductionPlan(f.store,'order',legacy,admin);
 assert.equal(saved.plan.stages.drawnCnc.date,'2026-11-24');
 assert.equal(saved.plan.stages.cnc.date,'2026-11-23');
 assert.equal(saved.plan.stages.cnc.notes,'CNC setup');
 assert.equal(saveProductionPlan(f.store,'order',legacy,admin).duplicate,true);
});

function moveBooking(f,stage,date,actor=manager){
 const previous=f.store.read('schedule',[]).find(row=>row.productionPlanStage===stage),entry={...previous,date,productionPlanOverride:true};
 f.store.ctx.storage.transactionSync(()=>{f.store.write('schedule',f.store.read('schedule',[]).map(row=>row.id===entry.id?entry:row));updateProductionPlanFromBooking(f.store,previous,entry,actor);});return entry;
}
function bookedPlan(){
 const f=fixture(),body=f.body();body.stages.fabrication.date='2026-11-23';body.stages.cnc.date='2026-11-24';body.stages.powderCoating.date='2026-11-25';
 f.store.write('schedule-settings',{startHour:6,endHour:18,productionBookingDefaults:Object.fromEntries(['fabrication','cnc','powderCoating','powderPickup','siteDelivery'].map(stage=>[stage,{username:'manager',durationMinutes:60}]))});saveProductionPlan(f.store,'order',body,manager);return f;
}
test('moving an automatic task updates only its plan date and invalidates an older plan editor',()=>{
 const f=bookedPlan(),before=getProductionPlan(f.store,'order',manager),oldOrder=f.store.read('orders');
 const entry=moveBooking(f,'cnc','2026-11-27'),after=getProductionPlan(f.store,'order',manager);
 assert.equal(after.plan.stages.cnc.date,entry.date);assert.equal(after.plan.revision,before.plan.revision+1);assert.equal(after.plan.updatedBy,'manager');assert.deepEqual(after.plan.stages.fabrication,before.plan.stages.fabrication);assert.deepEqual(f.store.read('orders'),oldOrder);
 const stale={...f.body(),expectedRevision:before.plan.revision};assert.throws(()=>saveProductionPlan(f.store,'order',stale,manager),error=>error.status===409);
 const revision=after.plan.revision;moveBooking(f,'cnc',entry.date);assert.equal(getProductionPlan(f.store,'order',manager).plan.revision,revision);
});
test('a moved powder pickup displays the booked date and a changed send date preserves an explicitly booked pickup',()=>{
 const f=bookedPlan();moveBooking(f,'powderPickup','2026-12-08');
 let data=getProductionPlan(f.store,'order',manager);assert.equal(data.plan.powderPickupDate,'2026-12-08');assert.equal(data.summary.powderPickupDate,'2026-12-08');assert.equal(productionPlanSchedule(f.store,admin).find(row=>row.stage==='powderPickup').date,'2026-12-08');
 const body=f.body();body.stages=structuredClone(data.plan.stages);body.stages.fabrication.notes='Keep manual pickup';saveProductionPlan(f.store,'order',body,manager);assert.equal(getProductionPlan(f.store,'order',manager).plan.powderPickupDate,'2026-12-08');
 moveBooking(f,'powderCoating','2026-11-26');data=getProductionPlan(f.store,'order',manager);assert.equal(data.plan.powderPickupDate,'2026-12-08');assert.equal(data.plan.stages.powderCoating.date,'2026-11-26');
});
test('a manager moving a generated delivery updates the confirmed delivery date while retaining its time',()=>{
 const f=bookedPlan(),body=f.body();body.stages=getProductionPlan(f.store,'order',admin).plan.stages;body.scheduledDeliveryDate='2026-12-10';body.scheduledDeliveryTime='10:00';saveProductionPlan(f.store,'order',body,admin);
 moveBooking(f,'siteDelivery','2026-12-11');const data=getProductionPlan(f.store,'order',manager);assert.equal(data.order.scheduledDeliveryDate,'2026-12-11');assert.equal(data.order.scheduledDeliveryTime,'10:00');
 const direct=f.body();direct.stages=data.plan.stages;direct.scheduledDeliveryDate='2026-12-12';direct.scheduledDeliveryTime='10:00';assert.throws(()=>saveProductionPlan(f.store,'order',direct,manager),error=>error.status===403);
});
test('failed, unauthorized or closed-order moves leave both records unchanged',()=>{
 for(const kind of ['write','permission','closed']){
  const f=bookedPlan();if(kind==='write')f.store.fail='production-plan:order';if(kind==='closed')f.store.write('orders',f.store.read('orders').map(row=>({...row,status:'dispatched'})));
  const plan=f.store.read('production-plan:order'),schedule=f.store.read('schedule');assert.throws(()=>moveBooking(f,'cnc','2026-12-02',kind==='permission'?viewer:manager));assert.deepEqual(f.store.read('production-plan:order'),plan);assert.deepEqual(f.store.read('schedule'),schedule);
 }
});

test('saving a full production plan creates seven bookings with seven distinct task types',()=>{
 const f=fixture(),body=f.body();
 f.store.write('schedule-settings',{startHour:6,endHour:18,productionBookingDefaults:Object.fromEntries(['stockOrder','drawnCnc','cnc','fabrication','powderCoating','powderPickup','siteDelivery'].map(stage=>[stage,{username:'manager',durationMinutes:60}]))});
 for(const row of Object.values(body.stages))row.date='2026-11-23';body.scheduledDeliveryDate='2026-12-01';
 saveProductionPlan(f.store,'order',body,admin);
 const bookings=f.store.read('schedule');assert.equal(bookings.length,7);assert.equal(new Set(bookings.map(entry=>entry.scheduleType)).size,7);assert.equal(new Set(bookings.map(entry=>entry.id)).size,7);
 assert.equal(bookings.find(entry=>entry.productionPlanStage==='fabrication').scheduleType,'fabrication');assert.equal(bookings.find(entry=>entry.productionPlanStage==='powderPickup').scheduleType,'powder-pickup');
});
