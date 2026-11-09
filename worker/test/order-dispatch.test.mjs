import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchOrders,dispatchOrder,completeDispatchedPanelOrders} from '../src/order-dispatch.js';
import {buildSiteOrderRows,SITE_ORDER_COLUMNS} from '../src/site-orders-excel.js';
import {readyOrderIds} from '../src/order-notifications.js';

const actor={username:'dispatcher',tasks:{'factory.dispatch':true}};
const order={id:'11111111-1111-4111-8111-111111111111',project:'Project',orderNumber:'001',orderType:'Fixings',
  status:'completed',completedAt:'2026-10-10T01:00:00Z',updatedAt:'2026-10-10T01:00:00Z',requestedBy:'requester',
  items:[{quantity:3,description:'Fixing pack'}],attachments:[{data:'PRIVATE_ATTACHMENT'}],comments:['PRIVATE_COMMENT']};
const body={id:order.id,mutationId:'22222222-2222-4222-8222-222222222222',expectedUpdatedAt:order.updatedAt,destination:'Site address',transport:'Truck',driver:'Alex',notes:'Call before arrival'};
function fixture(orders=[order],panels=[],loads=[],qa=[]){
  const docs=new Map([['orders',structuredClone(orders)],['app:cncPanels',panels],['panel-dispatch-loads',loads],['qa-checks',qa],['app:variants',[{id:'stock',qty:10}]]]),audits=[],alerts=[];
  const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),
    ordersWithDrawingProgress:()=>structuredClone(docs.get('orders')),panelCoatingStock:()=>[],
    requireTask(user,task){assert.equal(task,'factory.dispatch');if(!user.isAdmin&&!user.tasks?.[task])throw Error('Denied');},
    ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>audits.push(args),notify:(...args)=>alerts.push(args)};
  return {store,docs,audits,alerts};
}

test('dispatch permission lists ready and dispatched orders without private order documents',()=>{
  const {store}=fixture([order,{...order,id:'active',status:'ordered'},{...order,id:'cancelled',status:'cancelled'},
    {...order,id:'sent',status:'dispatched'},{...order,id:'panel',orderType:'Panels',status:'submitted'}]);
  assert.throws(()=>dispatchOrders(store,{tasks:{'site.orders.manage':true}}),/Denied/);
  const rows=dispatchOrders(store,actor);assert.deepEqual(rows.map(row=>row.id),[order.id,'sent']);
  assert.equal(rows[0].ready,true);assert.equal(rows[1].ready,false);
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_|attachments|comments/);
});

test('dispatch records actor and details once, notifies requester, preserves completion and stock',()=>{
  const {store,docs,audits,alerts}=fixture(),stock=structuredClone(docs.get('app:variants'));
  const result=dispatchOrder(store,body,actor);assert.equal(result.order.status,'dispatched');
  assert.equal(result.order.completedAt,order.completedAt);assert.equal(result.order.dispatchedBy,actor.username);
  assert.deepEqual(result.order.dispatch,{destination:'Site address',transport:'Truck',driver:'Alex',notes:'Call before arrival',mutationId:body.mutationId,by:actor.username,at:result.order.dispatchedAt});
  assert.notEqual(result.order.updatedAt,order.updatedAt);assert.equal(audits.length,1);assert.equal(alerts.length,1);
  assert.equal(alerts[0][1].title,'Order #001: dispatched');assert.equal(alerts[0][1].orderId,order.id);
  const repeated=dispatchOrder(store,body,actor);assert.equal(repeated.idempotent,true);
  assert.equal(audits.length,1);assert.equal(alerts.length,1);assert.deepEqual(docs.get('app:variants'),stock);
  assert.throws(()=>dispatchOrder(store,{...body,driver:'Changed'},actor),/different details/);
  assert.throws(()=>dispatchOrder(store,body,{...actor,username:'someone-else'}),/different details/);
  const duplicate=dispatchOrder(store,{...body,mutationId:'33333333-3333-4333-8333-333333333333'},actor);
  assert.equal(duplicate.code,'ORDER_CONFLICT');assert.equal(audits.length,1);
  assert.equal(readyOrderIds(store).has(order.id),false);
  const row=buildSiteOrderRows([docs.get('orders')[0]])[0];assert.equal(row.Status,'Dispatched');
  assert.equal(row['Ready for dispatch'],'✓');assert.equal(row.Notes,'Dispatched to site');
  assert.equal(SITE_ORDER_COLUMNS.indexOf('Schedule delivery')+1,SITE_ORDER_COLUMNS.indexOf('Drawn'));
});

test('not-ready, cancelled, stale, malformed and direct panel dispatches cannot write',()=>{
  for(const current of [{...order,status:'ordered'},{...order,status:'cancelled'},{...order,orderType:'Panels'}]){
    const {store,docs,audits}=fixture([current]);assert.throws(()=>dispatchOrder(store,body,actor));
    assert.deepEqual(docs.get('orders'),[current]);assert.equal(audits.length,0);
  }
  const {store,docs}=fixture();assert.equal(dispatchOrder(store,{...body,expectedUpdatedAt:'stale'},actor).code,'ORDER_CONFLICT');
  assert.throws(()=>dispatchOrder(store,{...body,transport:''},actor),/required/);
  assert.throws(()=>dispatchOrder(store,{...body,driver:42},actor),/text/);
  assert.throws(()=>dispatchOrder(store,{...body,mutationId:''},actor),/request ID/);
  assert.deepEqual(docs.get('orders'),[order]);
});

const panel={id:'p1',jobReference:'Project',orderNumber:'001',status:'completed',panelNumber:'P1',stockColor:'White'};
const sent={id:'load1',project:'Project',orderNumber:'001',panelIds:['p1'],status:'dispatched_to_site',legs:[{destinationType:'site',destination:'Site',transport:'Truck',driver:'Alex',by:'dispatcher',at:'2026-10-12T01:00:00Z'}]};
const approved=[{id:'p1',kind:'panel',status:'approved'}];
test('panel orders complete only after every current panel and load has passed QA and gone to site',()=>{
  const panelOrder={...order,orderType:'Panels',status:'submitted'};
  const cases=[[[panel],[{...sent,status:'at_powder_coaters'}],approved],[[panel],[sent],[]],
    [[panel,{...panel,id:'p2'}],[sent],approved],[[panel],[sent,{...sent,id:'second',status:'waiting'}],approved]];
  for(const [panels,loads,qa] of cases){const {store,docs}=fixture([panelOrder],panels,loads,qa);completeDispatchedPanelOrders(store,actor,sent);assert.equal(docs.get('orders')[0].status,'submitted');}
  const {store,docs,audits,alerts}=fixture([panelOrder,{...panelOrder,id:'other',project:'Other'},{...panelOrder,id:'cancelled',status:'cancelled'}],[panel],[sent],approved);
  const ready=dispatchOrders(store,actor).find(row=>row.id===panelOrder.id);assert.equal(ready.usesPanelLoads,true);
  completeDispatchedPanelOrders(store,actor,sent);assert.equal(docs.get('orders')[0].status,'dispatched');
  assert.equal(docs.get('orders')[1].status,'submitted');assert.equal(docs.get('orders')[2].status,'cancelled');
  assert.deepEqual(docs.get('orders')[0].dispatch.loadIds,['load1']);assert.equal(audits.length,1);assert.equal(alerts.length,1);
  completeDispatchedPanelOrders(store,actor,sent);assert.equal(audits.length,1);assert.equal(alerts.length,1);
});

test('a site leg for milled panels cannot finish the order without post-coating final QA',()=>{
  const milled={...panel,stockColor:'Milled'},coated={...sent,legs:[{destinationType:'powder_coaters'},...sent.legs],coatingCompleted:{by:'coater',at:'earlier'}};
  for(const finalQa of [undefined,{by:'inspector',at:'checked'}]){
    const {store,docs}=fixture([{...order,orderType:'Panels',status:'submitted'}],[milled],[{...coated,finalQa}],approved);
    completeDispatchedPanelOrders(store,actor,sent);assert.equal(docs.get('orders')[0].status,finalQa?'dispatched':'submitted');
  }
});

test('a panel dispatch does not rewrite an unrelated historical order with sent loads',()=>{
  const first={...order,orderType:'Panels',status:'submitted'},other={...first,id:'historical',project:'Other project'};
  const otherPanel={...panel,id:'historical-panel',jobReference:other.project},otherLoad={...sent,id:'historical-load',project:other.project,panelIds:[otherPanel.id]};
  const {store,docs,audits}=fixture([first,other],[panel,otherPanel],[sent,otherLoad],[...approved,{id:otherPanel.id,kind:'panel',status:'approved'}]);
  completeDispatchedPanelOrders(store,actor,sent);
  assert.equal(docs.get('orders')[0].status,'dispatched');assert.deepEqual(docs.get('orders')[1],other);
  assert.equal(audits.length,1);
});

test('dispatch addresses use the linked project or an unambiguous legacy name without mutating orders',()=>{
 const examples=[
  {...order,id:'linked',projectId:'linked-project',project:'Outdated project name',villa:'V12',location:'Level 2'},
  {...order,id:'legacy',project:'  leGACY   Project  '},
  {...order,id:'inactive',projectId:'inactive-project'},
  {...order,id:'missing-id',projectId:'deleted-project',project:'Legacy Project'},
  {...order,id:'ambiguous',project:'Duplicate'},
  {...order,id:'no-address',project:'No Address',notes:'Never an address',locationNotes:'Also not an address'},
  {...order,id:'unknown',project:'Unknown',location:'Not an address'}
 ];
 const projects=[{id:'linked-project',name:'Renamed project',address:'1 Linked Road',notes:'PRIVATE_PROJECT_NOTES'},
  {id:'legacy-project',name:'Legacy Project',address:'2 Legacy Street'},
  {id:'inactive-project',name:'Inactive',active:false,address:'3 Completed Avenue'},
  {id:'dup-a',name:'Duplicate',address:'Wrong A'},{id:'dup-b',name:' duplicate ',address:'Wrong B'},
  {id:'blank',name:'No Address',address:''}];
 const {store,docs,audits,alerts}=fixture(examples);docs.set('projects',projects);const before=structuredClone([...docs]);
 const rows=dispatchOrders(store,actor);
 assert.deepEqual(rows.map(row=>row.siteAddress),['1 Linked Road','2 Legacy Street','3 Completed Avenue','','','','']);
 assert.deepEqual([...docs],before);assert.equal(audits.length,0);assert.equal(alerts.length,0);
 assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_PROJECT_NOTES|attachments|PRIVATE_ATTACHMENT/);
 projects[0].address='4 Updated Road';docs.set('projects',projects);assert.equal(dispatchOrders(store,actor)[0].siteAddress,'4 Updated Road');
});
