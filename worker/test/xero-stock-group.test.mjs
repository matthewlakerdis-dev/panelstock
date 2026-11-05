import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,handleWorkshop,workshopView} from '../src/workshop-stock.js';

const admin={username:'admin',isAdmin:true},worker={username:'counter',tasks:{'factory.stock':true,'factory.receive':true}};
const groups=['cladding','fixings','materials','route-stiffeners','silicone'];
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const details=patch=>({name:'Angle',sku:'ANGLE',category:'extrusions',unit:'lengths',qty:5,unitCost:12.34,packSize:10,packCost:100,costBasis:'unit',...patch});
const create=(state=empty(),patch={})=>applyWorkshop(state,{action:'create',item:details(patch)},admin).next;
const edit=(state,patch)=>applyWorkshop(state,{action:'metadata',itemId:state.items[0].id,...patch},admin).next;
const financial=row=>Object.fromEntries(['qty','category','unit','unitCost','packCost','packSize','costBasis','reservations'].map(key=>[key,row[key]]));
const variants=[{id:'sheet',sku:'SHEET',color:'White',material:'ACP',thickness:4,width:2400,height:1200,qty:3}];
const offcuts=[{id:'offcut',sku:'OFFCUT',color:'White',material:'ACP',thickness:4,width:800,height:400,qty:1}];
function storeFor(state=create(),extra={}){
 const docs=new Map(Object.entries({'workshop-stock':structuredClone(state),'app:variants':variants,'app:offcuts':offcuts,...extra}));
 return {read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task]){const error=Error('Forbidden');error.status=403;throw error;}},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};
}
const send=(store,body,actor=admin)=>handleWorkshop(store,'POST',{mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision,...body},actor);

test('Xero group is optional and each exact supported value persists on creation',()=>{
 const state=create();assert.equal(Object.hasOwn(state.items[0],'xeroGroup'),false);
 assert.ok(workshopView(storeFor(state)).items.every(row=>!Object.hasOwn(row,'xeroGroup')));
 for(const xeroGroup of [...groups,'']){
  const next=create(empty(),{xeroGroup});assert.equal(next.items[0].xeroGroup,xeroGroup);assert.deepEqual(financial(next.items[0]),financial(state.items[0]));
 }
});

test('editing and clearing group preserves category, quantities, reservations and prices',()=>{
 let state=create(empty(),{xeroGroup:'materials'}),id=state.items[0].id;
 state=applyWorkshop(state,{action:'reserve',itemId:id,quantity:2,job:'Job A'},admin).next;
 const before=financial(state.items[0]);
 for(const xeroGroup of [...groups,'']){state=edit(state,{xeroGroup});assert.equal(state.items[0].xeroGroup,xeroGroup);assert.deepEqual(financial(state.items[0]),before);}
 state=edit(state,{xeroGroup:'route-stiffeners'});
 state=edit(state,{name:'Renamed angle'});assert.equal(state.items[0].xeroGroup,'route-stiffeners');
 state=applyWorkshop(state,{action:'receive',itemId:id,quantity:1},worker).next;assert.equal(state.items[0].xeroGroup,'route-stiffeners');assert.equal(state.items[0].qty,6);
});

test('group assignments stay independent for shared profile variants',()=>{
 let state=create(empty(),{xeroGroup:'cladding'});state=create(state,{colour:'Black',xeroGroup:'materials'});state=create(state,{colour:'White'});
 assert.deepEqual(state.items.map(row=>row.xeroGroup),['cladding','materials',undefined]);
 state=edit(state,{xeroGroup:'silicone'});assert.deepEqual(state.items.map(row=>row.xeroGroup),['silicone','materials',undefined]);
});

test('legacy sheet and offcut metadata expose shared assignments without changing legacy stock records',()=>{
 const store=storeFor(),initial=store.read('workshop-stock');
 let view=send(store,{action:'metadata',itemId:'variant:sheet',xeroGroup:'cladding'}).body;
 assert.equal(view.items.find(row=>row.id==='variant:sheet').xeroGroup,'cladding');
 assert.equal(store.read('workshop-stock').metadata['variant:sheet'].xeroGroup,'cladding');
 view=send(store,{action:'metadata',itemId:'offcut:offcut',xeroGroup:'materials'}).body;
 assert.equal(view.items.find(row=>row.id==='offcut:offcut').xeroGroup,'materials');
 const workerView=handleWorkshop(store,'GET',{},worker).body,adminView=handleWorkshop(store,'GET',{},admin).body;
 assert.deepEqual(workerView.items,adminView.items);
 view=send(store,{action:'metadata',itemId:'variant:sheet',xeroGroup:''}).body;assert.equal(view.items.find(row=>row.id==='variant:sheet').xeroGroup,'');
 assert.deepEqual(store.read('app:variants'),variants);assert.deepEqual(store.read('app:offcuts'),offcuts);assert.deepEqual(store.read('workshop-stock').items,initial.items);
});

test('bulk assignments and clearing support mixed stock types and preserve unselected items and pricing',()=>{
 let state=create(empty(),{xeroGroup:'materials'});state=create(state,{name:'Other',sku:'OTHER',xeroGroup:'silicone'});
 state.metadata['variant:sheet']={unitCost:125.5,location:'A',supplier:'Supplier',reorderLevel:2};
 state.metadata['offcut:offcut']={unitCost:5};
 const store=storeFor(state),id=state.items[0].id,other=state.items[1].id,before=workshopView(store).items.map(row=>[row.id,financial(row)]);
 for(const xeroGroup of ['fixings','']){
  const view=send(store,{action:'bulk_metadata',itemIds:[id,'variant:sheet','offcut:offcut'],changes:{xeroGroup}}).body;
  assert.ok(view.items.filter(row=>row.id!==other).every(row=>row.xeroGroup===xeroGroup));assert.equal(view.items.find(row=>row.id===other).xeroGroup,'silicone');
  assert.deepEqual(view.items.map(row=>[row.id,financial(row)]),before);
 }
 assert.deepEqual(store.read('app:variants'),variants);assert.deepEqual(store.read('app:offcuts'),offcuts);
 assert.equal(store.read('workshop-stock').metadata['variant:sheet'].location,'A');
});

test('invalid and non-string groups fail atomically for create, metadata, legacy and bulk writes',()=>{
 const state=create(empty(),{xeroGroup:'materials'}),store=storeFor(state),id=state.items[0].id,before=store.read('workshop-stock');
 for(const xeroGroup of [null,undefined,true,false,0,1,{},[],new String('fixings'),'Fixings',' fixings','fixings ','other','__proto__','silicone\n']){
  assert.throws(()=>create(state,{sku:'NEW',xeroGroup}),/Xero stock group/);
  assert.throws(()=>edit(state,{xeroGroup}),/Xero stock group/);
  assert.throws(()=>send(store,{action:'metadata',itemId:'variant:sheet',xeroGroup}),/Xero stock group/);
  assert.throws(()=>send(store,{action:'bulk_metadata',itemIds:[id,'variant:sheet'],changes:{xeroGroup}}),/Xero stock group/);
  assert.deepEqual(store.read('workshop-stock'),before);assert.deepEqual(state,before);
 }
});

test('group writes require administrator access, including direct calls and clearing',()=>{
 const state=create(empty(),{xeroGroup:'materials'}),store=storeFor(state),id=state.items[0].id;
 for(const xeroGroup of ['cladding','']){
  const plain={name:'New',sku:'NEW',category:'extrusions',unit:'lengths',qty:0,xeroGroup};
  for(const body of [{action:'create',item:plain},{action:'metadata',itemId:id,xeroGroup},{action:'metadata',itemId:'offcut:offcut',xeroGroup},{action:'bulk_metadata',itemIds:[id,'variant:sheet'],changes:{xeroGroup}}]){
   assert.throws(()=>applyWorkshop(state,body,worker),error=>error.status===403);assert.throws(()=>send(store,body,worker),error=>error.status===403);
  }
 }
 assert.equal(handleWorkshop(store,'GET',{},worker).body.items.find(row=>row.id===id).xeroGroup,'materials');
 assert.throws(()=>handleWorkshop(store,'GET',{},{}),error=>error.status===403);
 assert.deepEqual(store.read('workshop-stock'),state);
});

test('assignment handler retries are idempotent and reject changed payloads and stale devices',()=>{
 const state=create(),store=storeFor(state),id=state.items[0].id;
 const body={action:'bulk_metadata',itemIds:[id,'variant:sheet','offcut:offcut'],changes:{xeroGroup:'route-stiffeners'},mutationId:crypto.randomUUID(),expectedRevision:state.revision};
 const first=handleWorkshop(store,'POST',body,admin);assert.ok(first.body.items.every(row=>row.xeroGroup==='route-stiffeners'));
 const saved=store.read('workshop-stock'),history=store.read('app:transactions');
 const retry=handleWorkshop(store,'POST',body,admin);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.revision,first.body.revision);
 assert.deepEqual(store.read('workshop-stock'),saved);assert.deepEqual(store.read('app:transactions'),history);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,changes:{xeroGroup:'materials'}},admin),error=>error.status===409&&/reused/.test(error.message));
 assert.throws(()=>handleWorkshop(store,'POST',{...body,mutationId:crypto.randomUUID()},admin),error=>error.status===409&&/stock changed/.test(error.message));
});
