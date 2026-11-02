import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,workshopView,handleWorkshop} from '../src/workshop-stock.js';

const admin={username:'admin',isAdmin:true};
const staff={username:'counter',tasks:{'factory.stock':true,'factory.receive':true}};
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const item=patch=>({name:'Angle',sku:'ANG',category:'extrusions',unit:'lengths',qty:5,...patch});
const create=(state=empty(),patch={})=>applyWorkshop(state,{action:'create',item:item(patch)},admin).next;
const edit=(state,cost)=>applyWorkshop(state,{action:'metadata',itemId:state.items[0].id,unitCost:cost},admin).next;
function storeFor(state,extra={}){
 const docs=new Map(Object.entries({'workshop-stock':structuredClone(state),...extra}));
 return {read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};
}
const send=(store,body,actor=admin)=>handleWorkshop(store,'POST',{mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision,...body},actor);

test('unit cost is optional and zero remains distinct from an unset cost',()=>{
 const without=create();assert.equal(Object.hasOwn(without.items[0],'unitCost'),false);
 assert.equal(Object.hasOwn(workshopView(storeFor(without)).items[0],'unitCost'),false);
 for(const value of [0,'0','0.00'])assert.equal(create(empty(),{unitCost:value}).items[0].unitCost,0);
 assert.equal(create(empty(),{unitCost:'12.30'}).items[0].unitCost,12.3);assert.equal(create(empty(),{unitCost:1.15}).items[0].unitCost,1.15);
 assert.equal(create(empty(),{unitCost:1e9}).items[0].unitCost,1e9);
 for(const value of ['',null,undefined,'   '])assert.equal(create(empty(),{unitCost:value}).items[0].unitCost,null);
});

test('cost validation rejects negative, non-finite, over-limit and sub-cent values atomically',()=>{
 for(const cost of [-1,'-0.01',1e9+0.01,Infinity,NaN,'not a price',1.001,0.0000001,'2.345',true,false,[],{}]){
  const state=create(),before=structuredClone(state);
  assert.throws(()=>create(state,{sku:'ANOTHER',unitCost:cost}),/Unit cost/);
  assert.throws(()=>edit(state,cost),/Unit cost/);
  assert.deepEqual(state,before);
 }
});

test('editing, clearing and unrelated stock actions retain the intended unit cost',()=>{
 let state=create(empty(),{unitCost:12.34}),id=state.items[0].id;
 state=edit(state,25.5);assert.equal(state.items[0].unitCost,25.5);assert.equal(state.items[0].qty,5);
 state=applyWorkshop(state,{action:'metadata',itemId:id,name:'New name'},admin).next;assert.equal(state.items[0].unitCost,25.5);
 state=applyWorkshop(state,{action:'receive',itemId:id,quantity:2},staff).next;assert.equal(state.items[0].unitCost,25.5);assert.equal(state.items[0].qty,7);
 for(const blank of ['',null,'   ',undefined])assert.equal(edit(state,blank).items[0].unitCost,null);
 assert.equal(edit(state,0).items[0].unitCost,0);
});

test('cost belongs to each item instead of being inherited or shared across profile variants',()=>{
 let state=create(empty(),{unitCost:10});state=create(state,{colour:'Black',unitCost:20});
 state=create(state,{colour:'White'});assert.equal(Object.hasOwn(state.items[2],'unitCost'),false);
 state=edit(state,30);assert.deepEqual(state.items.map(i=>i.unitCost),[30,20,undefined]);
});

test('panel and offcut costs are stored in workshop metadata and exposed without changing sheet records',()=>{
 const variants=[{id:'panel',color:'White',material:'ACP',thickness:4,width:2400,height:1200,qty:3}],offcuts=[{id:'offcut',color:'Black',material:'ACP',thickness:4,width:800,height:400,qty:1}];
 const store=storeFor(empty(),{'app:variants':variants,'app:offcuts':offcuts});
 assert.ok(workshopView(store).items.every(i=>!Object.hasOwn(i,'unitCost')));
 let view=send(store,{action:'metadata',itemId:'variant:panel',unitCost:'125.50'}).body;
 assert.equal(view.items.find(i=>i.id==='variant:panel').unitCost,125.5);
 assert.equal(store.read('workshop-stock').metadata['variant:panel'].unitCost,125.5);
 view=send(store,{action:'metadata',itemId:'offcut:offcut',unitCost:0}).body;assert.equal(view.items.find(i=>i.id==='offcut:offcut').unitCost,0);
 view=send(store,{action:'metadata',itemId:'variant:panel',unitCost:''}).body;assert.equal(view.items.find(i=>i.id==='variant:panel').unitCost,null);
 assert.deepEqual(store.read('app:variants'),variants);assert.deepEqual(store.read('app:offcuts'),offcuts);
});

test('bulk unit cost edits work across workshop stock and sheets and preserve unrelated prices',()=>{
 let state=create(empty(),{unitCost:2});state=create(state,{sku:'B',name:'Bracket',unitCost:3});
 const id=state.items[0].id,other=state.items[1].id,store=storeFor(state,{'app:variants':[{id:'sheet',color:'White',material:'ACP',thickness:4,width:2400,height:1200,qty:3}]});
 let view=send(store,{action:'bulk_metadata',itemIds:[id,'variant:sheet'],changes:{unitCost:42.75}}).body;
 assert.equal(view.items.find(i=>i.id===id).unitCost,42.75);assert.equal(view.items.find(i=>i.id==='variant:sheet').unitCost,42.75);assert.equal(view.items.find(i=>i.id===other).unitCost,3);
 view=send(store,{action:'bulk_metadata',itemIds:[id,'variant:sheet'],changes:{unitCost:null}}).body;assert.ok(view.items.filter(i=>i.id!==other).every(i=>i.unitCost===null));
 const before=store.read('workshop-stock');assert.throws(()=>send(store,{action:'bulk_metadata',itemIds:[id,'variant:sheet'],changes:{unitCost:2.345}}),/two decimal places/);assert.deepEqual(store.read('workshop-stock'),before);
});

test('unit cost editing requires administrator access and remains readable with stock access',()=>{
 const state=create(empty(),{unitCost:12.5}),id=state.items[0].id,store=storeFor(state);
 const requests=[{action:'create',item:item({unitCost:1})},{action:'metadata',itemId:id,unitCost:1},{action:'bulk_metadata',itemIds:[id],changes:{unitCost:1}}];
 for(const body of requests){assert.throws(()=>send(store,body,staff),e=>e.status===403);assert.throws(()=>applyWorkshop(state,body,staff),e=>e.status===403);}
 assert.equal(handleWorkshop(store,'GET',{},staff).body.items[0].unitCost,12.5);assert.deepEqual(store.read('workshop-stock'),state);
});

test('changing prices does not change completed stocktake reports or counted quantities',()=>{
 let state=create(empty(),{unitCost:10}),id=state.items[0].id;
 state=applyWorkshop(state,{action:'stocktake_create',name:'Count',categories:['extrusions']},admin).next;
 const countId=state.stocktakes[0].id;
 state=applyWorkshop(state,{action:'stocktake_batch',stocktakeId:countId,counts:[{itemId:id,quantity:4,expectedQty:5}]},staff).next;
 const report=structuredClone(state.stocktakes[0].report),count=structuredClone(state.stocktakes[0].counts[id]);
 state=edit(state,20);assert.deepEqual(state.stocktakes[0].report,report);assert.deepEqual(state.stocktakes[0].counts[id],count);assert.equal(state.items[0].qty,4);
});
