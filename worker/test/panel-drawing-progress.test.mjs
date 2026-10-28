import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updatePanelDrawing,checkPanelDrawingEdit} from '../src/panel-drawing-progress.js';
import {orderDrawingProgress} from '../src/order-drawing-progress.js';
const base={id:'order-one',orderType:'Panels',project:'Notre Dame',projectId:'project-a',orderNumber:'23',status:'approved',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',items:[{description:'CFC',quantity:30}]};
function fixture(order=base){let orders=[structuredClone(order)];const audits=[],writes=[];const store={read:(key,fallback)=>key==='orders'?structuredClone(orders):fallback,write:(key,value)=>{assert.equal(key,'orders');writes.push(key);orders=value;},ctx:{storage:{transactionSync:fn=>fn()}},requireTask(actor,key){assert.ok(actor.isAdmin||actor.tasks?.[key]);},audit:(...args)=>audits.push(args)};const actor={username:'manager',tasks:{'site.orders.manage':true}};return {store,actor,audits,writes,order:()=>orders[0],save:(drawn,patch={})=>updatePanelDrawing(store,order.id,{drawn,expectedUpdatedAt:orders[0].updatedAt,...patch},actor)};}
test('manual Drawn saves actor/date, preserves workflow and can be reset without CAD',()=>{
 const f=fixture();let result=f.save(true);assert.equal(result.order.manualDrawing.drawn,true);assert.equal(result.order.manualDrawing.updatedBy,'manager');assert.ok(result.order.manualDrawing.updatedAt>base.updatedAt);assert.equal(result.order.status,base.status);assert.deepEqual(result.order.items,base.items);assert.equal(result.order.manualProduction,undefined);assert.deepEqual(f.writes,['orders']);assert.equal(f.audits.length,1);
 assert.equal(orderDrawingProgress(result.order,[]).drawn,true);assert.equal(f.save(true).unchanged,true);assert.equal(f.writes.length,1);
 result=f.save(false);assert.equal(orderDrawingProgress(result.order,[]).drawn,false);
 const cad=[{revision:1,drawingProgress:{projectId:base.projectId,orderNumber:'23',drawn:true,ready:1,total:1}}];assert.equal(orderDrawingProgress(result.order,cad).drawn,false);
});
test('stale saves, invalid input, non-panel and terminal orders cannot mutate progress',()=>{
 const f=fixture();assert.equal(f.save(true,{expectedUpdatedAt:'stale'}).code,'ORDER_CONFLICT');assert.equal(f.writes.length,0);assert.throws(()=>f.save('complete'));
 for(const patch of [{orderType:'Gate'},{orderType:'Fixings'},{status:'dispatched'},{status:'cancelled'}]){const g=fixture({...base,...patch});assert.throws(()=>g.save(true));assert.equal(g.writes.length,0);}
 assert.throws(()=>updatePanelDrawing(f.store,base.id,{drawn:true,expectedUpdatedAt:base.updatedAt},{username:'viewer',tasks:{}}));
});
test('drawn panel definitions require a reset before project, items or type changes',()=>{
 const order={...base,manualDrawing:{drawn:true}};assert.doesNotThrow(()=>checkPanelDrawingEdit(order,'Panels',base));
 for(const next of [{...base,project:'Other'},{...base,projectId:'other'},{...base,items:[{description:'CFC',quantity:31}]}])assert.throws(()=>checkPanelDrawingEdit(order,'Panels',next));
 assert.throws(()=>checkPanelDrawingEdit(order,'Gate',base));assert.doesNotThrow(()=>checkPanelDrawingEdit({...order,manualDrawing:{drawn:false}},'Gate',{}));
});
