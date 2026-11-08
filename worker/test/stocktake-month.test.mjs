import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stocktakeMonth,countedStockItemsThisMonth} from '../src/stocktake-month.js';
import {applyWorkshop,handleWorkshop,workshopView} from '../src/workshop-stock.js';

const admin={username:'admin',isAdmin:true},worker={username:'counter',tasks:{'factory.stock':true}},now='2026-11-03T00:00:00.000Z';
const month=stocktakeMonth(now),inMonth='2026-10-31T14:00:00.000Z',previous='2026-10-31T13:59:59.999Z';
const freeze=t=>t.mock.timers.enable({apis:['Date'],now:Date.parse(now)});
const stock=(id,patch={})=>({id,name:id,sku:id,category:'extrusions',supplier:'Supplier A',unit:'lengths',qty:5,reservations:{},...patch});
const session=(id,patch={})=>({id,name:id,categories:['extrusions'],itemIds:[],counts:{},status:'open',...patch});
const base=()=>({revision:1,items:[stock('partial'),stock('previous',{qty:0}),stock('unsubmitted'),stock('manual'),stock('archived',{qty:0,archivedAt:previous}),stock('fixing',{category:'fixings'}),stock('other-supplier',{supplier:'Supplier B'}),stock('offcut',{category:'offcuts',qty:0})],metadata:{},movements:[{id:'manual-count',itemId:'manual',action:'stocktake',quantity:0,at:inMonth},{id:'created',itemId:'unsubmitted',action:'create',at:inMonth}],stocktakes:[session('open',{itemIds:['partial','unsubmitted'],counts:{partial:{quantity:5,at:inMonth}}}),session('prior',{status:'completed',itemIds:['previous'],counts:{previous:{quantity:0,at:previous}},completedAt:inMonth})]});
function storeFor(state=base()){
 const documents=new Map([['workshop-stock',structuredClone(state)],['app:variants',[{id:'sheet',sku:'SHEET',color:'White',material:'ACP',thickness:4,width:2400,height:1200,qty:2}]]]);
 const store={writes:0,read:(key,fallback)=>structuredClone(documents.has(key)?documents.get(key):fallback),write:(key,value)=>{store.writes++;documents.set(key,structuredClone(value));},requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task]){const error=Error('Forbidden');error.status=403;throw error;}},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};
 return store;
}
const create=(state,patch={})=>applyWorkshop(state,{action:'stocktake_create',name:'November count',categories:['extrusions'],supplier:'Supplier A',uncountedThisMonth:true,stocktakeMonth:'2026-11',...patch},admin).next;
const post=(store,body,actor=admin)=>handleWorkshop(store,'POST',{mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision,...body},actor);

test('stocktake calendar uses Brisbane month boundaries, year rollover and leap years',()=>{
 for(const [at,key,label] of [
  ['2026-10-31T13:59:59.999Z','2026-10','October 2026'],['2026-10-31T14:00:00.000Z','2026-11','November 2026'],
  ['2026-12-31T13:59:59.999Z','2026-12','December 2026'],['2026-12-31T14:00:00.000Z','2027-01','January 2027'],
  ['2024-02-29T13:59:59.999Z','2024-02','February 2024'],['2024-02-29T14:00:00.000Z','2024-03','March 2024'],
  ['2025-02-28T13:59:59.999Z','2025-02','February 2025'],['2025-02-28T14:00:00.000Z','2025-03','March 2025']
 ])assert.deepEqual(stocktakeMonth(at),{key,label,timeZone:'Australia/Brisbane'});
 const state={movements:[{action:'stocktake',itemId:'last',at:'2024-02-29T13:59:59.999Z'},{action:'stocktake',itemId:'next',at:'2024-02-29T14:00:00.000Z'}]};
 assert.deepEqual([...countedStockItemsThisMonth(state,stocktakeMonth('2024-02-15'))],['last']);
 assert.deepEqual([...countedStockItemsThisMonth(state,stocktakeMonth('2024-03-15'))],['next']);
});

test('submitted partial, open and manual counts include zero quantities and zero adjustments',()=>{
 const state={movements:[{action:'stocktake',itemId:'manual-zero',quantity:0,at:inMonth},{action:'stocktake',itemId:'manual-negative',quantity:-2,at:inMonth},{action:'stocktake',itemId:'old',quantity:0,at:previous},{action:'receive',itemId:'received',quantity:5,at:inMonth},{action:'stocktake_create',itemId:'created',quantity:0,at:inMonth},{action:'stocktake',itemId:'invalid',at:'invalid'}],stocktakes:[session('open',{counts:{zero:{quantity:0,at:inMonth},same:{quantity:5,expectedQty:5,at:inMonth},missing:{quantity:null,at:inMonth},blank:{quantity:'',at:inMonth},invalid:{quantity:3,at:'invalid'},draft:{quantity:0}}}),session('partial',{status:'partial',counts:{partial:{quantity:3,at:inMonth}}}),session('draft',{status:'draft',createdAt:inMonth,counts:{'draft-entry':{quantity:0,at:inMonth}}})]};
 assert.deepEqual([...countedStockItemsThisMonth(state,month)].sort(),['manual-negative','manual-zero','partial','same','zero']);
});

test('legacy completed counts fall back to linked movements, report rows and completion only with submitted evidence',()=>{
 const state={movements:[{action:'stocktake',stocktakeId:'legacy',itemId:'linked-old',at:previous},{action:'stocktake',stocktakeId:'legacy',itemId:'linked-now',at:inMonth}],stocktakes:[session('legacy',{status:'completed',createdAt:inMonth,completedAt:inMonth,itemIds:['scope-only'],counts:{'entry-old':{quantity:0,at:previous},'linked-old':{quantity:0},'linked-now':{quantity:1},'report-old':{quantity:1},completion:{quantity:0},invalid:{quantity:null}},report:{rows:[{itemId:'entry-old',quantity:0,at:inMonth},{itemId:'report-old',quantity:1,at:previous},{itemId:'report-only',quantity:0,at:inMonth},{itemId:'report-completion',quantity:0},{itemId:'report-empty',quantity:null,at:inMonth}]}}),session('empty',{status:'completed',createdAt:inMonth,completedAt:inMonth,itemIds:['empty-scope'],counts:{empty:{}}}),session('bad-date',{status:'completed',completedAt:'invalid',counts:{'bad-date':{quantity:0}}}),session('report-completed-date',{status:'completed',counts:{'report-date':{quantity:0}},report:{completedAt:inMonth,rows:[]}})]};
 assert.deepEqual([...countedStockItemsThisMonth(state,month)].sort(),['completion','linked-now','report-completion','report-date','report-only']);
});

test('month-spanning sessions retain submitted months when completed later',()=>{
 const state={movements:[{action:'stocktake',stocktakeId:'spanning',itemId:'october',at:inMonth}],stocktakes:[session('spanning',{status:'completed',createdAt:'2026-10-01T00:00:00Z',completedAt:inMonth,counts:{october:{quantity:0,at:previous},november:{quantity:0,at:inMonth}}})]};
 assert.deepEqual([...countedStockItemsThisMonth(state,month)],['november']);
 assert.deepEqual([...countedStockItemsThisMonth(state,stocktakeMonth(previous))],['october']);
});

test('history indexing tolerates duplicate and unordered movements without depending on scans per item',()=>{
 const movements=Array.from({length:10000},(_,i)=>({action:'stocktake',stocktakeId:'legacy',itemId:'item-'+i,quantity:0,at:previous}));
 movements.unshift({action:'stocktake',stocktakeId:'legacy',itemId:'item-9999',quantity:0,at:inMonth});
 movements.push({action:'stocktake',stocktakeId:'legacy',itemId:'item-9999',quantity:0,at:previous});
 movements.find=()=>{throw Error('History must be indexed');};
 const counts=Object.fromEntries(Array.from({length:10000},(_,i)=>['item-'+i,{quantity:0}]));
 const state={movements,stocktakes:[session('legacy',{status:'completed',completedAt:inMonth,counts})]};
 assert.deepEqual([...countedStockItemsThisMonth(state,month)],['item-9999']);
});

test('stock view returns current month and workshop flags without persisting derived fields',t=>{
 freeze(t);const state=base(),store=storeFor(state),view=workshopView(store);
 assert.deepEqual(view.stocktakeMonth,month);assert.equal(store.writes,0);assert.deepEqual(store.read('workshop-stock'),state);
 for(const row of view.items.filter(row=>!row.legacy))assert.equal(row.countedThisMonth,['partial','manual'].includes(row.id));
 assert.ok(!view.items.some(row=>row.id==='archived'));assert.ok(view.items.find(row=>row.legacy));
 assert.equal(Object.hasOwn(view.items.find(row=>row.id==='variant:sheet'),'countedThisMonth'),false);
});

test('monthly creation combines category, supplier and active workshop scope and stores its audit month',t=>{
 freeze(t);const state=base(),next=create(state),count=next.stocktakes[0];
 assert.deepEqual(count.itemIds,['previous','unsubmitted']);assert.equal(count.uncountedThisMonth,true);assert.equal(count.stocktakeMonth,'2026-11');assert.equal(count.supplier,'Supplier A');
 assert.deepEqual(create(state,{categories:['extrusions','offcuts']}).stocktakes[0].itemIds,['previous','unsubmitted','offcut']);
 assert.deepEqual(create(state,{supplier:'Supplier B'}).stocktakes[0].itemIds,['other-supplier']);
 assert.deepEqual(create(state,{categories:['fixings']}).stocktakes[0].itemIds,['fixing']);
 assert.deepEqual(state,base());
});

test('default and disabled filters preserve the full previous scope without storing month settings',t=>{
 freeze(t);for(const patch of [{uncountedThisMonth:false},{uncountedThisMonth:undefined}]){
  const input={action:'stocktake_create',name:'Normal count',categories:['extrusions'],supplier:'Supplier A',...patch};if(input.uncountedThisMonth===undefined)delete input.uncountedThisMonth;
  const count=applyWorkshop(base(),input,admin).next.stocktakes[0];
  assert.deepEqual(count.itemIds,['partial','previous','unsubmitted','manual']);assert.equal(Object.hasOwn(count,'uncountedThisMonth'),false);assert.equal(Object.hasOwn(count,'stocktakeMonth'),false);
 }
});

test('monthly creation rejects invalid flags, stale month leases and empty matching scope atomically',t=>{
 freeze(t);const state=base(),before=structuredClone(state);
 for(const value of ['true',1,0,null,undefined,{},[]])assert.throws(()=>create(state,{uncountedThisMonth:value}),error=>error.status===400&&/true or false/.test(error.message));
 for(const value of ['2026-10','2026-12',null,1])assert.throws(()=>create(state,{stocktakeMonth:value}),error=>error.status===409&&/month changed/.test(error.message));
 const withoutLease=applyWorkshop(state,{action:'stocktake_create',name:'Remaining',categories:['extrusions'],uncountedThisMonth:true},admin).next.stocktakes[0];
 assert.equal(withoutLease.stocktakeMonth,'2026-11');
 const countedOnly={...state,items:state.items.filter(row=>['partial','manual'].includes(row.id))};
 assert.throws(()=>create(countedOnly),error=>error.status===400&&/No uncounted workshop items.*November 2026/.test(error.message));
 assert.throws(()=>create(state,{supplier:'No matching supplier'}),/No uncounted workshop items/);
 assert.deepEqual(state,before);
});

test('monthly filter uses existing admin permissions and safe mutation retries before month rollover checks',t=>{
 freeze(t);const store=storeFor(),body={action:'stocktake_create',name:'Remaining November',categories:['extrusions'],supplier:'Supplier A',uncountedThisMonth:true,stocktakeMonth:'2026-11',expectedRevision:1,mutationId:crypto.randomUUID()};
 assert.throws(()=>handleWorkshop(store,'POST',body,worker),error=>error.status===403);
 assert.throws(()=>applyWorkshop(base(),body,worker),error=>error.status===403);
 assert.deepEqual(handleWorkshop(store,'GET',{},worker).body.stocktakeMonth,month);
 const result=handleWorkshop(store,'POST',body,admin);assert.deepEqual(result.body.stocktakes[0].itemIds,['previous','unsubmitted']);
 t.mock.timers.setTime(Date.parse('2026-11-30T14:00:00.000Z'));
 const retry=handleWorkshop(store,'POST',body,admin);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.stocktakes.length,result.body.stocktakes.length);
 assert.equal(retry.body.stocktakeMonth.key,'2026-12');assert.equal(retry.body.stocktakes[0].stocktakeMonth,'2026-11');
 assert.throws(()=>post(store,{...body,mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision}),error=>error.status===409&&/month changed/.test(error.message));
 assert.throws(()=>post(store,{...body,mutationId:crypto.randomUUID(),stocktakeMonth:'2026-12',expectedRevision:1}),error=>error.status===409&&/stock changed/.test(error.message));
 assert.throws(()=>handleWorkshop(store,'POST',{...body,name:'Changed'},admin),/reused/);
});

test('new zero and unchanged submissions immediately change eligibility while unsubmitted items remain eligible',t=>{
 freeze(t);const store=storeFor({revision:0,items:[stock('zero',{qty:0}),stock('same'),stock('remaining')],movements:[],metadata:{}});
 let result=post(store,{action:'stocktake_create',name:'All',categories:['extrusions']});const countId=result.body.stocktakes[0].id;
 result=post(store,{action:'stocktake_batch',stocktakeId:countId,counts:[{itemId:'zero',expectedQty:0,quantity:0},{itemId:'same',expectedQty:5,quantity:5}]},worker);
 assert.equal(result.body.stocktakes[0].status,'open');assert.ok(result.body.items.filter(row=>row.id!=='remaining'&&!row.legacy).every(row=>row.countedThisMonth));assert.equal(result.body.items.find(row=>row.id==='remaining').countedThisMonth,false);
 result=post(store,{action:'stocktake_create',name:'Remaining',categories:['extrusions'],uncountedThisMonth:true,stocktakeMonth:'2026-11'});
 assert.deepEqual(result.body.stocktakes[0].itemIds,['remaining']);
});
