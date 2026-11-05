import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,handleWorkshop} from '../src/workshop-stock.js';

const admin={username:'admin',isAdmin:true},worker={username:'worker',tasks:{'factory.stock':true}};
const stock=(id,patch={})=>({id,name:'Stock '+id,sku:'SKU-'+id,category:'extrusions',unit:'lengths',qty:5,reservations:{'Job A':1},location:'Rack A',supplier:'Supplier A',reorderLevel:2,dimensions:'25 x 25',colour:'Black',lengthMm:6000,packSize:1,costBasis:'unit',unitCost:10,packCost:20,...patch});
const stateFor=(count=3)=>({revision:7,items:Array.from({length:count},(_,i)=>stock('item-'+i)),movements:[{id:'old',itemId:'item-0',action:'receive',quantity:1,user:'admin',at:'2026-11-01T00:00:00Z'}],metadata:{}});
const bulk=(state,itemIds,changes,actor=admin)=>applyWorkshop(state,{action:'bulk_metadata',itemIds,changes},actor);
const unchangedStock=row=>Object.fromEntries(['qty','reservations','category','unit','packSize','packCost','costBasis','location','supplier','reorderLevel'].map(key=>[key,row[key]]));
function storeFor(state){
 const docs=new Map([['workshop-stock',structuredClone(state)],['app:variants',[{id:'sheet',sku:'SHEET',color:'White',material:'ACP',thickness:3,width:2400,height:1200,qty:4}]]]);
 const store={writes:0,transactions:0,audits:[],broadcasts:[],read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>{store.writes++;docs.set(key,structuredClone(value));},requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task]){const error=Error('Forbidden');error.status=403;throw error;}},ctx:{storage:{transactionSync:fn=>{store.transactions++;return fn();}}},audit:(...args)=>store.audits.push(structuredClone(args)),broadcastRevision:revision=>store.broadcasts.push(revision)};
 return store;
}

test('bulk unit prices preserve zero, clear blanks and leave unchecked stock fields unchanged',()=>{
 const state=stateFor(),ids=state.items.slice(0,2).map(row=>row.id),before=structuredClone(state);
 for(const [entered,stored] of [[12.34,12.34],[0,0],['0',0],['',null],['   ',null],[null,null]]){
  const next=bulk(state,ids,{unitCost:entered}).next;
  assert.deepEqual(next.items.slice(0,2).map(row=>row.unitCost),[stored,stored]);
  for(let i=0;i<2;i++)assert.deepEqual(unchangedStock(next.items[i]),unchangedStock(state.items[i]));
  assert.deepEqual(next.items[2],state.items[2]);assert.deepEqual(state,before);
 }
});

test('invalid bulk prices fail atomically without changing the caller state',()=>{
 const state=stateFor(),before=structuredClone(state),ids=state.items.map(row=>row.id);
 for(const value of [-1,Infinity,NaN,1e9+0.01,1.001,0.0000001,true,{},[]]){
  assert.throws(()=>bulk(state,ids,{unitCost:value}),/Unit cost/);assert.deepEqual(state,before);
 }
});

test('late pack validation failure discards earlier valid draft changes',()=>{
 const state=stateFor();state.items[1].costBasis='pack';state.items[1].packSize=2;
 const before=structuredClone(state);
 assert.throws(()=>bulk(state,['item-0','item-1'],{packSize:1.5,unitCost:0}),/whole number/);
 assert.deepEqual(state,before);
 const store=storeFor(state),body={action:'bulk_metadata',itemIds:['item-0','item-1'],changes:{packSize:1.5,unitCost:0},expectedRevision:state.revision,mutationId:crypto.randomUUID()};
 assert.throws(()=>handleWorkshop(store,'POST',body,admin),/whole number/);
 assert.deepEqual(store.read('workshop-stock'),before);assert.equal(store.writes,0);assert.equal(store.transactions,0);assert.equal(store.audits.length,0);
});

test('late duplicate variant failure discards changes to independent earlier items',()=>{
 const state=stateFor();state.items[1].sku='SHARED';state.items[1].colour='White';state.items[2].sku='SHARED';state.items[2].colour='Blue';
 const before=structuredClone(state);
 assert.throws(()=>bulk(state,['item-0','item-1'],{colour:'Blue',unitCost:25}),/already exists/);
 assert.deepEqual(state,before);
});

test('bulk edits retain large images on selected and unselected items',()=>{
 const bytes=Buffer.alloc(4*1024*1024);bytes.set([137,80,78,71,13,10,26,10]);
 const selected='data:image/png;base64,'+bytes.toString('base64');bytes[bytes.length-1]=1;
 const unselected='data:image/png;base64,'+bytes.toString('base64');
 const state=stateFor(2);state.items[0].image=selected;state.items[1].image=unselected;
 const next=bulk(state,['item-0'],{supplier:'New supplier',unitCost:0}).next;
 assert.equal(next.items[0].image,selected);assert.equal(next.items[1].image,unselected);
 assert.equal(state.items[0].image,selected);assert.equal(state.items[0].supplier,'Supplier A');assert.deepEqual(next.items[1],state.items[1]);
});

test('bulk mutation clones the whole state once for one, fifty and five hundred selected items',t=>{
 const clone=globalThis.structuredClone;let calls=0;
 t.mock.method(globalThis,'structuredClone',(...args)=>{calls++;return clone(...args);});
 for(const count of [1,50,500]){
  const state=stateFor(count),ids=state.items.map(row=>row.id);calls=0;
  const result=bulk(state,ids,{unitCost:0});assert.equal(calls,1);
  assert.equal(result.movements.length,count);assert.ok(result.next.items.every(row=>row.unitCost===0));
  assert.ok(state.items.every(row=>row.unitCost===10));assert.equal(result.next.revision,state.revision+1);
 }
});

test('bulk selection limits reject empty, duplicate and over-five-hundred requests atomically',()=>{
 const state=stateFor(501),before=structuredClone(state),ids=state.items.map(row=>row.id);
 for(const selected of [[],ids,['item-0','item-0']])assert.throws(()=>bulk(state,selected,{location:'Rack B'}),/500|Duplicate/);
 assert.deepEqual(state,before);
});

test('bulk movement order and single revision preserve the existing batch audit contract',()=>{
 const state=stateFor(),selected=['item-2','item-0','item-1'],result=bulk(state,selected,{location:'Rack B',unitCost:12.34});
 assert.deepEqual(result.movements.map(row=>row.itemId),selected);assert.equal(result.movement,result.movements[0]);
 assert.deepEqual(result.next.movements.map(row=>row.itemId),['item-1','item-0','item-2','item-0']);
 assert.equal(new Set(result.movements.map(row=>row.id)).size,selected.length);assert.equal(result.next.movements.at(-1).id,'old');
 for(const row of result.movements){assert.equal(row.action,'bulk_metadata');assert.equal(row.quantity,0);assert.equal(row.job,'');assert.equal(row.user,'admin');assert.equal(row.reason,'Bulk edit: location, unitCost');assert.ok(Number.isFinite(Date.parse(row.at)));}
 assert.equal(result.next.revision,8);assert.equal(state.revision,7);assert.equal(state.movements.length,1);
});

test('bulk shared profile dimensions and categories require all variants and preserve stock quantities',()=>{
 const state=stateFor();state.items[0].sku='SHARED';state.items[0].colour='Black';state.items[1].sku=' shared ';state.items[1].colour='White';state.items[1].qty=9;
 const before=structuredClone(state);
 for(const changes of [{category:'steel'},{dimensions:'30 x 30'}])assert.throws(()=>bulk(state,['item-0'],changes),/all colour and length variants/);
 const next=bulk(state,['item-0','item-1'],{category:'offcuts',dimensions:'30 x 30',supplier:''}).next;
 for(const row of next.items.slice(0,2)){assert.equal(row.category,'offcuts');assert.equal(row.dimensions,'30 x 30');assert.equal(row.supplier,'');}
 assert.deepEqual(next.items.map(row=>row.qty),[5,9,5]);assert.deepEqual(next.items.map(row=>row.reservations),state.items.map(row=>row.reservations));
 assert.deepEqual(next.items[2],state.items[2]);assert.deepEqual(state,before);
});

test('bulk metadata still requires admin access for direct calls and handler calls',()=>{
 const state=stateFor(),before=structuredClone(state),body={action:'bulk_metadata',itemIds:['item-0','item-1'],changes:{unitCost:0},expectedRevision:state.revision,mutationId:crypto.randomUUID()};
 assert.throws(()=>applyWorkshop(state,body,worker),error=>error.status===403);
 const store=storeFor(state);assert.throws(()=>handleWorkshop(store,'POST',body,worker),error=>error.status===403);
 assert.equal(store.writes,0);assert.equal(store.transactions,0);assert.deepEqual(state,before);assert.deepEqual(store.read('workshop-stock'),before);
});

test('mixed workshop and legacy batch retries persist stock and history once',()=>{
 const state=stateFor(2);state.metadata['variant:sheet']={unitCost:50,location:'Old panel rack',supplier:'Panel supplier',reorderLevel:4};
 const store=storeFor(state),body={action:'bulk_metadata',itemIds:['item-1','variant:sheet','item-0'],changes:{unitCost:0,location:'Rack Z',xeroGroup:'materials'},expectedRevision:state.revision,mutationId:crypto.randomUUID()};
 const first=handleWorkshop(store,'POST',body,admin),saved=store.read('workshop-stock'),history=store.read('app:transactions'),writes=store.writes;
 assert.equal(first.status,200);assert.equal(saved.revision,state.revision+1);assert.ok(saved.items.every(row=>row.unitCost===0&&row.location==='Rack Z'&&row.xeroGroup==='materials'));
 assert.deepEqual(saved.items.map(row=>row.qty),state.items.map(row=>row.qty));assert.equal(saved.metadata['variant:sheet'].unitCost,0);assert.equal(saved.metadata['variant:sheet'].supplier,'Panel supplier');assert.equal(store.read('app:variants')[0].qty,4);
 assert.equal(history.length,body.itemIds.length);assert.equal(store.audits.length,body.itemIds.length);assert.equal(store.transactions,1);assert.equal(store.broadcasts.length,1);
 const retry=handleWorkshop(store,'POST',body,admin);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.revision,first.body.revision);
 assert.equal(store.writes,writes);assert.equal(store.transactions,1);assert.equal(store.audits.length,body.itemIds.length);assert.equal(store.broadcasts.length,1);
 assert.deepEqual(store.read('workshop-stock'),saved);assert.deepEqual(store.read('app:transactions'),history);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,changes:{unitCost:1}},admin),error=>error.status===409&&/reused/.test(error.message));
 assert.throws(()=>handleWorkshop(store,'POST',{...body,mutationId:crypto.randomUUID()},admin),error=>error.status===409&&/stock changed/.test(error.message));
});
