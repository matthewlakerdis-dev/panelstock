import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOrderProductionProgress,orderProductionProgress} from '../src/order-production-progress.js';

const order={id:'11111111-1111-4111-8111-111111111111',projectId:'project-a',project:'Project A',orderNumber:'007',orderType:'Panels',status:'submitted',drawingProgress:{drawn:true},phone:'PRIVATE',attachments:[{name:'SECRET'}]};
const panel={id:'panel-a',projectId:'project-a',jobReference:'Project A',orderNumber:'007',status:'completed',stockSku:'WHITE',private:'PRIVATE'};
const qa={id:panel.id,kind:'panel',status:'approved',evidence:'SECRET'};
const stage=(progress,label)=>progress.stages.find(stage=>stage.label===label).state;
const progress=(panels=[],records=[],loads=[],source=order,stock=[])=>buildOrderProductionProgress(source,panels,records,loads,stock);

test('only recorded stages are complete; an empty schedule is not dispatch ready',()=>{
  const result=progress();
  assert.equal(stage(result,'Drawn'),'complete');
  for(const label of ['Toolpathed','Routed / cut','QA','Sent to PC','Final QA','Ready for dispatch'])assert.equal(stage(result,label),'pending');
  assert.equal(stage(progress([{...panel,status:'pending'}]),'Toolpathed'),'complete');
  assert.equal(stage(progress([{...panel,status:'pending'}]),'Routed / cut'),'pending');
});

test('whole order progress regresses for new panels and recuts and ignores other projects',()=>{
  assert.equal(stage(progress([panel],[qa]),'Ready for dispatch'),'complete');
  assert.equal(stage(progress([panel,{...panel,id:'new',status:'pending'}],[qa]),'Ready for dispatch'),'pending');
  assert.equal(stage(progress([panel],[{...qa,status:'recut'}]),'QA'),'pending');
  assert.equal(stage(progress([{...panel,projectId:'other'}],[qa]),'Toolpathed'),'pending');
  assert.equal(stage(progress([{...panel,orderNumber:'7'}],[qa]),'Toolpathed'),'pending');
});

test('powder coating and final QA gate dispatch readiness',()=>{
  const stock=[{sku:'MILL',color:'Milled'}],milled={...panel,stockSku:'MILL'};
  const load={projectId:'project-a',project:'Project A',orderNumber:'007',panelIds:[panel.id],status:'at_powder_coaters',legs:[{destinationType:'powder_coaters',phone:'PRIVATE'}]};
  const get=loads=>progress([milled],[qa],loads,order,stock);
  assert.equal(stage(get([]),'Ready for dispatch'),'pending');
  assert.equal(stage(get([load]),'Sent to PC'),'complete');
  assert.match(get([load]).notes,/At powder coaters/);
  const returned={...load,coatingCompleted:{by:'Staff'}};
  assert.equal(stage(get([returned]),'Final QA'),'pending');
  assert.equal(stage(get([returned]),'Ready for dispatch'),'pending');
  const final={...returned,finalQa:{by:'QA'},status:'ready_for_site'};
  assert.equal(stage(get([final]),'Final QA'),'complete');
  assert.equal(stage(get([final]),'Ready for dispatch'),'complete');
  assert.equal(stage(progress([panel],[qa]),'Final QA'),'not_applicable');
});

test('cancelled orders cannot be ready and non-panel stages are not applicable',()=>{
  const cancelled=progress([panel],[qa],[],{...order,status:'cancelled'});
  assert.equal(cancelled.cancelled,true);assert.equal(stage(cancelled,'Ready for dispatch'),'pending');
  const other=progress([],[],[],{...order,orderType:'Fixings',status:'in_stock'});
  assert.ok(other.stages.slice(0,-1).every(stage=>stage.state==='not_applicable'));
  assert.equal(stage(other,'Ready for dispatch'),'pending');
  assert.equal(stage(progress([],[],[],{...order,orderType:'Fixings',status:'completed'}),'Ready for dispatch'),'complete');
});

test('the viewer receives only a summary and reads do not write or notify',()=>{
  const docs=new Map([['app:cncPanels',[panel]],['qa-checks',[qa]],['panel-dispatch-loads',[]]]);
  const store={requireTask(actor,task){assert.equal(task,'site.orders.view');assert.equal(actor.allowed,true);},ordersWithDrawingProgress:()=>[order],read:(key,fallback)=>docs.get(key)||fallback,panelCoatingStock:()=>[],write(){assert.fail('must not write');},notify(){assert.fail('must not notify');}};
  const result=orderProductionProgress(store,order.id,{allowed:true});
  assert.equal(result.ok,true);assert.equal(result.progress.orderId,order.id);
  assert.deepEqual(Object.keys(result.progress),['orderId','cancelled','stages','notes']);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|stockSku|evidence|panelIds/);
  assert.throws(()=>orderProductionProgress(store,order.id,{allowed:false}));
  assert.throws(()=>orderProductionProgress(store,'missing',{allowed:true}),/not found/);
});
