import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,workshopView,handleWorkshop} from '../src/workshop-stock.js';
const admin={username:'admin',isAdmin:true},staff={username:'counter',tasks:{'factory.stock':true,'factory.receive':true}};
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const details=patch=>({name:'Spacer',sku:'SPACER',category:'extrusions',unit:'each',qty:123,...patch});
const create=(state=empty(),patch={})=>applyWorkshop(state,{action:'create',item:details(patch)},admin).next;
const edit=(state,patch)=>applyWorkshop(state,{action:'metadata',itemId:state.items[0].id,...patch},admin).next;
function storeFor(state,extra={}){
 const docs=new Map(Object.entries({'workshop-stock':structuredClone(state),...extra}));
 return {read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};
}
const send=(store,body,actor=admin)=>handleWorkshop(store,'POST',{mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision,...body},actor);

test('pack pricing is optional, preserves old unit pricing, and stores pack cost without converting counts',()=>{
 const old=create(empty(),{unitCost:0.99,packSize:1.5});assert.equal(Object.hasOwn(old.items[0],'costBasis'),false);assert.equal(Object.hasOwn(old.items[0],'packCost'),false);assert.equal(old.items[0].packSize,1.5);
 const state=create(empty(),{costBasis:'pack',packCost:'13.98',packSize:100,unitCost:0.99});const row=state.items[0];
 assert.equal(row.unit,'each');assert.equal(row.qty,123);assert.equal(row.packSize,100);assert.equal(row.packCost,13.98);assert.equal(row.unitCost,0.99);assert.equal(row.costBasis,'pack');assert.equal(state.movements[0].quantity,123);
 const unspecified=create(empty(),{costBasis:'pack',unitCost:0.99});assert.equal(unspecified.items[0].packSize,1);assert.equal(Object.hasOwn(unspecified.items[0],'packCost'),false);
});

test('editing packaging and switching price bases preserves stock quantities, allocations, and independent prices',()=>{
 let state=create(empty(),{unitCost:0.25}),id=state.items[0].id;
 state=applyWorkshop(state,{action:'reserve',itemId:id,quantity:10,job:'Job A'},admin).next;
 state=edit(state,{costBasis:'pack',packCost:18.99,packSize:100});
 assert.equal(state.items[0].qty,123);assert.deepEqual(state.items[0].reservations,{'Job A':10});assert.equal(state.items[0].unit,'each');assert.equal(state.items[0].unitCost,0.25);assert.equal(state.items[0].packCost,18.99);
 state=edit(state,{costBasis:'unit'});assert.equal(state.items[0].costBasis,'unit');assert.equal(state.items[0].packCost,18.99);assert.equal(state.items[0].packSize,100);assert.equal(state.items[0].unitCost,0.25);
 state=edit(state,{costBasis:'pack'});assert.equal(state.items[0].packCost,18.99);
 const received=applyWorkshop(state,{action:'receive',itemId:id,quantity:1},staff).next;assert.equal(received.items[0].qty,124);assert.equal(received.items[0].packCost,18.99);assert.equal(received.items[0].packSize,100);
});

test('pack costs distinguish missing, cleared and zero values and allow valid two-decimal amounts',()=>{
 const state=create(empty(),{costBasis:'pack',packSize:100,packCost:1.15,unitCost:10});assert.equal(state.items[0].packCost,1.15);
 for(const blank of ['',null,undefined,'   ']){const cleared=edit(state,{packCost:blank});assert.equal(cleared.items[0].packCost,null);assert.equal(cleared.items[0].unitCost,10);assert.equal(cleared.items[0].costBasis,'pack');}
 for(const free of [0,'0','0.00'])assert.equal(edit(state,{packCost:free}).items[0].packCost,0);
 assert.equal(edit(state,{packCost:1e9}).items[0].packCost,1e9);
});

test('pack pricing requires a valid basis, whole positive pack size, and two-decimal nonnegative price atomically',()=>{
 const state=create(empty(),{costBasis:'pack',packCost:10,packSize:100}),before=structuredClone(state);
 const bad=[...['',null,undefined,'packs','each',true,{},[]].map(costBasis=>({costBasis})),...[0,-1,1.5,'1.001',1e9+1,Infinity,NaN,'',null,undefined,true,{},[]].map(packSize=>({packSize})),...[-1,'-0.01',1.001,0.0000001,1e9+0.01,Infinity,NaN,'bad',true,{},[]].map(packCost=>({packCost}))];
 for(const patch of bad){assert.throws(()=>edit(state,patch));assert.throws(()=>create(empty(),{costBasis:'pack',packSize:100,packCost:10,...patch}));assert.deepEqual(state,before);}
 assert.equal(edit(state,{packSize:1e9}).items[0].packSize,1e9);
 const legacy=create(empty(),{packSize:1.5});assert.throws(()=>edit(legacy,{costBasis:'pack'}),/whole number/);assert.equal(edit(legacy,{packSize:2.5,costBasis:'unit'}).items[0].packSize,2.5);
});

test('bulk packaging edits validate the final state per item and fail atomically across mixed current states',()=>{
 let state=create(empty(),{packSize:100,unitCost:1});state=create(state,{sku:'OTHER',name:'Other spacer',packSize:1.5,unitCost:2});const ids=state.items.map(i=>i.id),before=structuredClone(state);
 assert.throws(()=>applyWorkshop(state,{action:'bulk_metadata',itemIds:ids,changes:{costBasis:'pack',packCost:10}},admin),/whole number/);assert.deepEqual(state,before);
 state=applyWorkshop(state,{action:'bulk_metadata',itemIds:ids,changes:{costBasis:'pack',packCost:10,packSize:100}},admin).next;
 assert.deepEqual(state.items.map(i=>[i.unit,i.qty,i.packSize,i.packCost,i.unitCost]),[['each',123,100,10,1],['each',123,100,10,2]]);
 state=applyWorkshop(state,{action:'bulk_metadata',itemIds:ids,changes:{packCost:null}},admin).next;assert.ok(state.items.every(i=>i.packCost===null));
 state=applyWorkshop(state,{action:'bulk_metadata',itemIds:ids,changes:{costBasis:'unit',packSize:1.5}},admin).next;assert.ok(state.items.every(i=>i.costBasis==='unit'&&i.packSize===1.5));
});

test('panel and sheet-offcut packaging metadata is editable without altering underlying sheet quantities',()=>{
 const variants=[{id:'panel',color:'White',material:'ACP',thickness:4,width:2400,height:1200,qty:3}],offcuts=[{id:'offcut',color:'Black',material:'ACP',thickness:4,width:800,height:400,qty:1}];
 const state=create(),id=state.items[0].id,store=storeFor(state,{'app:variants':variants,'app:offcuts':offcuts});
 let view=send(store,{action:'metadata',itemId:'variant:panel',costBasis:'pack',packCost:250.5,packSize:10}).body;assert.equal(view.items.find(i=>i.id==='variant:panel').packCost,250.5);assert.equal(view.items.find(i=>i.id==='variant:panel').unit,'sheets');
 view=send(store,{action:'bulk_metadata',itemIds:[id,'variant:panel','offcut:offcut'],changes:{costBasis:'pack',packCost:0,packSize:100}}).body;
 assert.ok(view.items.every(i=>i.costBasis==='pack'&&i.packCost===0&&i.packSize===100));assert.deepEqual(store.read('app:variants'),variants);assert.deepEqual(store.read('app:offcuts'),offcuts);assert.equal(store.read('workshop-stock').items[0].qty,123);
});

test('all packaging price writes require admin access while costs remain readable with stock access',()=>{
 const state=create(empty(),{costBasis:'pack',packCost:50,packSize:100}),id=state.items[0].id,store=storeFor(state),before=structuredClone(state);
 for(const patch of [{costBasis:'unit'},{packCost:0},{packSize:100}]){
  for(const request of [{action:'create',item:details(patch)},{action:'metadata',itemId:id,...patch},{action:'bulk_metadata',itemIds:[id],changes:patch}]){
   assert.throws(()=>applyWorkshop(state,request,staff),e=>e.status===403);assert.throws(()=>send(store,request,staff),e=>e.status===403);
  }
 }
 assert.deepEqual(store.read('workshop-stock'),before);const view=handleWorkshop(store,'GET',{},staff).body;assert.equal(view.items[0].packCost,50);assert.equal(view.items[0].packSize,100);assert.equal(view.items[0].costBasis,'pack');
});

test('pack metadata stays item-specific rather than sharing prices with same-code variants',()=>{
 let state=create(empty(),{costBasis:'pack',packCost:10,packSize:100});state=create(state,{colour:'Black',costBasis:'pack',packCost:20,packSize:50});
 state=edit(state,{packCost:30,packSize:25});assert.deepEqual(state.items.map(i=>[i.packCost,i.packSize]),[[30,25],[20,50]]);
});

test('pack price changes cannot rewrite completed stocktake snapshots or count values',()=>{
 let state=create(empty(),{costBasis:'pack',packCost:10,packSize:100}),id=state.items[0].id;
 state=applyWorkshop(state,{action:'stocktake_create',name:'Spacer count',categories:['extrusions']},admin).next;const countId=state.stocktakes[0].id;
 state=applyWorkshop(state,{action:'stocktake_batch',stocktakeId:countId,counts:[{itemId:id,quantity:117,expectedQty:123}]},staff).next;
 const report=structuredClone(state.stocktakes[0].report),counts=structuredClone(state.stocktakes[0].counts);
 state=edit(state,{costBasis:'unit',packCost:15,packSize:200,unitCost:0.02});assert.equal(state.items[0].qty,117);assert.equal(state.items[0].unit,'each');assert.deepEqual(state.stocktakes[0].report,report);assert.deepEqual(state.stocktakes[0].counts,counts);
});
