import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {panelQaResolution,sameQaOrder,sameQaReference} from '../src/qa-resolution.js';
import {migrateQaRecords} from '../src/qa-status.js';
import {requireCondition as check} from '../src/security.js';
import {panelLoadView,reconcilePanelLoads,transitionPanelLoad} from '../src/panel-dispatch.js';
import {buildOrderProductionProgress} from '../src/order-production-progress.js';
import {readyOrderIds,notifyReadyOrders} from '../src/order-notifications.js';

const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const method=(name,next)=>source.slice(source.indexOf(`  ${name}(`),source.indexOf(`  ${next}(`));
const methods=[method('qaPanelItem','qaItemsFor'),method('qaItemsFor','qaOrderReport'),method('qaOrderReport','createQaMetalwork'),method('resolveQaRecut','panelCoatingStock'),method('requireTask','requireMutationTasks')].join(',');
const createMethods=new Function('cleanText','check','ok','migrateQaRecords','panelQaResolution','sameQaOrder','sameQaReference','readyOrderIds','notifyReadyOrders',`return ({${methods}})`);
const cleanText=(value,max=200)=>String(value||'').trim().slice(0,max),admin={username:'manager',isAdmin:true};
const order={id:'order-qa-resolution',project:'141 Queen Street Mall',orderNumber:'TEST PANELS',orderType:'Panels',requestedBy:'requester'};
const panel=(id,extra={})=>({id,jobReference:order.project,orderNumber:order.orderNumber,sheetNumber:'1',panelNumber:'Z4W9-16',status:'completed',completedAt:'2026-10-25T00:00:00Z',completedBy:'operator',...extra});
const failed={id:'failure',status:'recut',checkedBy:'reviewer',checkedAt:'2026-10-26T00:00:00Z',results:{finish:'fail'},notes:'Damaged face',photo:'data:image/png;base64,aGVsbG8='};
const original=(extra={})=>({id:'original',kind:'panel',status:'replaced',replacementStatus:'resolved-separately',resolvedSeparatelyAt:'2026-10-26T01:00:00Z',resolvedSeparatelyBy:'old-manager',resolvedSeparatelyReason:'Recut completed and scheduled separately',latest:structuredClone(failed),history:[structuredClone(failed)],...extra});
const approved=(id='replacement',extra={})=>({id,kind:'panel',status:'approved',latest:{id:'approval',status:'approved',checkedBy:'replacement-reviewer',checkedAt:'2026-10-27T01:00:00Z',results:{finish:'pass'}},history:[{id:'approval',status:'approved',checkedBy:'replacement-reviewer',checkedAt:'2026-10-27T01:00:00Z',results:{finish:'pass'}}],...extra});
function harness(panels=[panel('original'),panel('replacement',{completedAt:'2026-10-27T00:00:00Z'})],records=[original(),approved()]){
  const data={'app:cncPanels':structuredClone(panels),'qa-checks':structuredClone(records),orders:[structuredClone(order)]},events=[],notifications=[];
  const store=createMethods(cleanText,check,(body,status=200)=>({body,status}),migrateQaRecords,panelQaResolution,sameQaOrder,sameQaReference,readyOrderIds,notifyReadyOrders);
  return Object.assign(store,{data,events,notifications,read:(key,fallback)=>structuredClone(data[key]??fallback),write:(key,value)=>{data[key]=structuredClone(value);},qaSettings:()=>({enabledFrom:'2026-10-01T00:00:00Z',panelChecks:[['finish','Finish']]}),qaChecklists:()=>({panel:[['finish','Finish']]}),panelCoatingStock:()=>[],audit:(by,action,details)=>events.push({by,action,details}),notify:(users,payload)=>notifications.push({users,payload}),ctx:{storage:{transactionSync:callback=>callback()}}});
}
const dispatch={action:'dispatch',destinationType:'site',destination:'Address',transport:'Truck',driver:'Driver'};

test('the eighteen-panel separate recut stays visible and blocked consistently in QA, reports and dispatch',()=>{
  const panels=Array.from({length:18},(_,i)=>panel(i===17?'original':`p${i}`,{panelNumber:i===17?'Z4W9-16':`Panel ${i}`})),records=panels.map(p=>p.id==='original'?original():approved(p.id)),store=harness(panels,records),before=structuredClone(store.data);
  const item=store.qaItemsFor(admin).items.find(item=>item.id==='original');
  assert.equal(item.status,'replaced');
  assert.equal(item.qaResolved,false);
  assert.equal(item.qaBlocker,'Approved replacement required');
  assert.deepEqual(item.latest,failed);
  const report=store.qaOrderReport({project:order.project,orderNumber:order.orderNumber},admin).body.report;
  assert.equal(report.items.length,18);
  assert.equal(report.items.find(item=>item.id==='original').qaBlocker,item.qaBlocker);
  const load=reconcilePanelLoads([],panels)[0],view=panelLoadView(load,panels,records);
  assert.equal(view.routing,true);
  assert.equal(view.qaComplete,false);
  assert.equal(view.ready,false);
  assert.deepEqual(view.items.filter(item=>!item.qa).map(item=>[item.reference,item.qaBlocker]),[['Z4W9-16','Approved replacement required']]);
  assert.equal(view.items.find(item=>item.id==='original').resolvedSeparatelyBy,'old-manager');
  assert.throws(()=>transitionPanelLoad(view,dispatch,admin),/must all be complete/);
  assert.equal(buildOrderProductionProgress(order,panels,records).stages.find(stage=>stage.label==='QA').state,'pending');
  assert.deepEqual(store.data,before);
});

test('explicitly linking an approved later replacement preserves failure evidence and resolves the existing gate',()=>{
  const store=harness(),before=structuredClone(store.data),result=store.resolveQaRecut({id:'original',replacementId:'replacement',reason:'Approved replacement selected in QA Centre'},admin),item=result.body.item;
  assert.equal(result.status,200);
  assert.equal(item.status,'replaced');
  assert.equal(item.qaResolved,true);
  assert.equal(item.qaBlocker,'');
  assert.equal(item.replacementId,'replacement');
  assert.equal(item.replacementStatus,'approved');
  assert.equal(item.replacementReference,'Z4W9-16');
  const saved=store.data['qa-checks'].find(item=>item.id==='original'),replacement=store.data['qa-checks'].find(item=>item.id==='replacement');
  assert.deepEqual(saved.latest,before['qa-checks'][0].latest);
  assert.deepEqual(saved.history,before['qa-checks'][0].history);
  for(const key of ['resolvedSeparatelyAt','resolvedSeparatelyBy','resolvedSeparatelyReason'])assert.equal(saved[key],before['qa-checks'][0][key]);
  assert.equal(replacement.remakeOf,'original');
  const {remakeOf,...unchanged}=replacement;
  assert.deepEqual(unchanged,before['qa-checks'][1]);
  assert.deepEqual(store.data['app:cncPanels'],before['app:cncPanels']);
  assert.equal(store.events.at(-1).action,'qa-recut-replacement-linked');
  assert.equal(store.events.at(-1).details.replacementId,'replacement');
  const load=reconcilePanelLoads([],store.data['app:cncPanels'])[0],view=panelLoadView(load,store.data['app:cncPanels'],store.data['qa-checks']);
  assert.equal(view.ready,true);
  assert.equal(view.items.find(item=>item.id==='original').replaced,true);
  assert.equal(view.fabrication.by,'replacement-reviewer');
  assert.equal(transitionPanelLoad(view,dispatch,admin).status,'dispatched_to_site');
  assert.equal(buildOrderProductionProgress(order,store.data['app:cncPanels'],store.data['qa-checks']).stages.find(stage=>stage.label==='QA').state,'complete');
  assert.equal(store.notifications.length,1);
});

test('a linked approved replacement outside the selected load resolves global QA but still blocks that dispatch',()=>{
  const store=harness();store.resolveQaRecut({id:'original',replacementId:'replacement',reason:'Verified replacement'},admin);
  const storedManifest={id:'sent-load',project:order.project,orderNumber:order.orderNumber,panelIds:['original'],status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}]},before=structuredClone(storedManifest),view=panelLoadView(storedManifest,store.data['app:cncPanels'],store.data['qa-checks']);
  assert.equal(store.qaItemsFor(admin).items.find(item=>item.id==='original').qaResolved,true);
  assert.equal(view.items[0].qaResolved,false);
  assert.equal(view.items[0].qaBlocker,'Approved replacement outside this load');
  assert.equal(view.qaComplete,false);
  assert.deepEqual(storedManifest,before);
  const reconciled=reconcilePanelLoads([storedManifest],store.data['app:cncPanels']);
  assert.deepEqual(reconciled[0],before);
});

test('reopened replacement QA and invalid cross-order links cannot resolve QA by status alone',()=>{
  const panels=[panel('original'),panel('replacement',{completedAt:'2026-10-27T00:00:00Z'})],record=original({replacementId:'replacement',replacementStatus:'approved'});
  let records=[record,approved('replacement',{status:'recut'})],view=panelLoadView({panelIds:['original','replacement'],status:'waiting'},panels,records);
  assert.equal(view.items[0].qaBlocker,'Replacement needs QA');
  assert.equal(view.ready,false);
  records=[record,approved()];panels[1].orderNumber='OTHER';
  view=panelLoadView({panelIds:['original','replacement'],status:'waiting'},panels,records);
  assert.equal(view.items[0].qaBlocker,'Approved replacement required');
  assert.equal(view.ready,false);
});

test('legacy closeout remains admin-only and never resolves QA without a replacement',()=>{
  const store=harness(undefined,[original({status:'recut',replacementStatus:null}),approved()]);
  assert.throws(()=>store.resolveQaRecut({id:'original',reason:'Closed separately'},{username:'staff',tasks:{'factory.qa':true}}),error=>error.status===403);
  const response=store.resolveQaRecut({id:'original',reason:'Closed separately'},admin);
  assert.equal(response.body.item.status,'replaced');
  assert.equal(response.body.item.qaResolved,false);
  assert.equal(response.body.item.qaBlocker,'Approved replacement required');
  assert.deepEqual(response.body.item.history,[failed]);
  assert.equal(store.events.at(-1).action,'qa-recut-resolved-separately');
  assert.throws(()=>store.resolveQaRecut({id:'original',reason:'Again'},admin),error=>error.status===404);
});

test('explicit linking also supports an active recut and normalized exact project, order and reference',()=>{
  const store=harness([panel('original'),panel('replacement',{jobReference:' 141 queen STREET mall ',orderNumber:' test panels ',panelNumber:' z4w9-16 ',completedAt:'2026-10-27T00:00:00Z'})],[original({status:'recut',replacementStatus:null}),approved()]);
  const response=store.resolveQaRecut({id:'original',replacementId:'replacement',reason:'Verified replacement'},admin);
  assert.equal(response.body.item.qaResolved,true);
});

test('invalid replacement choices reject atomically without changing records or failure history',async t=>{
  const cases=[
    ['same panel',store=>{},'original'],
    ['missing panel',store=>{},'missing'],
    ['different project',store=>{store.data['app:cncPanels'][1].jobReference='Other';}],
    ['different order',store=>{store.data['app:cncPanels'][1].orderNumber='OTHER';}],
    ['different panel reference',store=>{store.data['app:cncPanels'][1].panelNumber='Other';}],
    ['not completed',store=>{store.data['app:cncPanels'][1].status='pending';}],
    ['not approved',store=>{store.data['qa-checks'][1].status='recut';}],
    ['missing QA',store=>{store.data['qa-checks'].pop();}],
    ['completed before failure',store=>{store.data['app:cncPanels'][1].completedAt='2026-10-25T23:59:59Z';}],
    ['completed at failure',store=>{store.data['app:cncPanels'][1].completedAt=failed.checkedAt;}],
    ['unknown completion time',store=>{delete store.data['app:cncPanels'][1].completedAt;}],
    ['unknown failure time',store=>{store.data['qa-checks'][0].history=[];delete store.data['qa-checks'][0].latest.checkedAt;}],
    ['different existing replacement',store=>{store.data['qa-checks'][0].replacementId='another';}],
    ['claimed through remakeOf',store=>{store.data['qa-checks'][1].remakeOf='another';}],
    ['claimed through another original',store=>{store.data['qa-checks'].push(original({id:'another',replacementId:'replacement'}));}],
    ['non-recut original',store=>{store.data['qa-checks'][0].status='approved';}],
    ['empty explicit selection',store=>{},'']
  ];
  for(const [name,modify,replacementId='replacement'] of cases)await t.test(name,()=>{
    const store=harness();modify(store);const before=structuredClone(store.data);
    assert.throws(()=>store.resolveQaRecut({id:'original',replacementId,reason:'Verified replacement'},admin),error=>[400,404,409].includes(error.status));
    assert.deepEqual(store.data,before);
    assert.deepEqual(store.events,[]);
  });
});
