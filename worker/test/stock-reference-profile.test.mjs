import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,handleWorkshop,workshopView} from '../src/workshop-stock.js';

const actor={username:'admin',isAdmin:true};
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const base=(patch={})=>({category:'extrusions',unit:'lengths',name:'Fabricated profile',sku:'PROFILE',qty:9,lengthMm:6500,dimensions:'80 x 40 x 3 mm',colour:'Mill Finish',unitCost:12.02,reorderLevel:2,...patch});
const create=(state=empty(),patch={})=>applyWorkshop(state,{action:'create',item:base(patch)},actor).next;
const edit=(state,referenceProfile,patch={})=>applyWorkshop(state,{action:'metadata',itemId:state.items[0].id,location:state.items[0].location,supplier:state.items[0].supplier,reorderLevel:state.items[0].reorderLevel,referenceProfile,...patch},actor);
const storeFor=(state=empty())=>{
 const docs=new Map([['workshop-stock',structuredClone(state)],['revision',3]]),audits=[];
 return {read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask(user,task){assert.ok(user.isAdmin||user.tasks?.[task],'Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit:(...entry)=>audits.push(entry),broadcastRevision(){},audits};
};

test('every supported reference choice persists through create and stock views without changing stock or pricing',()=>{
 for(const referenceProfile of ['','none','shs','rhs','chs','angle','channel','flat-bar','round-bar','square-bar','tee','i-beam','zed','top-hat']){
  const state=create(empty(),{referenceProfile}),view=workshopView(storeFor(state)),item=view.items[0];
  assert.equal(item.referenceProfile,referenceProfile);assert.equal(item.qty,9);assert.equal(item.unitCost,12.02);assert.deepEqual(item.reservations,{});assert.equal(item.image,'');assert.equal(view.stockProfileReferenceVersion,1);
 }
 const old=create();assert.equal(Object.hasOwn(old.items[0],'referenceProfile'),false);assert.equal(workshopView(storeFor(old)).stockProfileReferenceVersion,1);
});

test('metadata choices are shared across active same-code variants while quantities, prices and photos stay unchanged',()=>{
 let state=create(empty(),{referenceProfile:'rhs'});state=create(state,{colour:'Black',qty:4,unitCost:15});state=create(state,{sku:'OTHER',qty:2,referenceProfile:'shs'});
 state.items[0].reservations={'Job A':3};state.items[0].image='data:image/png;base64,iVBORw0KGgo=';state.items.push({...state.items[0],id:'archived-profile',archivedAt:'2026-10-01T00:00:00Z'});
 const before=structuredClone(state),result=edit(state,'none');
 assert.deepEqual(state,before);assert.equal(result.movement.quantity,0);assert.equal(result.movement.action,'metadata');
 assert.equal(result.next.items[0].referenceProfile,'none');assert.equal(result.next.items[1].referenceProfile,'none');assert.equal(result.next.items[2].referenceProfile,'shs');assert.equal(result.next.items[3].referenceProfile,'rhs');
 for(let index=0;index<state.items.length;index++)assert.deepEqual({...result.next.items[index],referenceProfile:state.items[index].referenceProfile},state.items[index]);
});

test('new shared-profile variants inherit the existing reference instead of replacing it',()=>{
 for(const existing of [undefined,'','none','rhs']){
  let state=create(empty(),existing===undefined?{}:{referenceProfile:existing});
  state=create(state,{sku:' profile ',colour:'Black',referenceProfile:'shs'});
  assert.equal(state.items[1].referenceProfile,existing??'');assert.equal(state.items[0].referenceProfile,existing);assert.equal(state.items[1].image,state.items[0].image);
 }
});

test('older metadata clients preserve saved choices and explicit blank restores automatic references',()=>{
 let state=create(empty(),{referenceProfile:'channel'}),id=state.items[0].id;
 state=applyWorkshop(state,{action:'metadata',itemId:id,location:'Rack A'},actor).next;assert.equal(state.items[0].referenceProfile,'channel');
 state=edit(state,'none').next;assert.equal(state.items[0].referenceProfile,'none');
 state=edit(state,'').next;assert.equal(state.items[0].referenceProfile,'');assert.equal(state.items[0].qty,9);assert.equal(state.items[0].unitCost,12.02);
});

test('malformed reference choices are rejected atomically on create, metadata and inherited variants',()=>{
 const state=create(empty(),{referenceProfile:'rhs'}),before=structuredClone(state);
 for(const referenceProfile of [undefined,null,false,1,[],{},'SHS','rhs ','automatic','unknown','data:image/svg+xml,test']){
  assert.throws(()=>create(empty(),{referenceProfile}),/valid reference profile/);
  assert.throws(()=>edit(state,referenceProfile),/valid reference profile/);
  assert.throws(()=>create(state,{colour:'Black',referenceProfile}),/valid reference profile/);
  assert.deepEqual(state,before);
 }
});

test('legacy panel and panel-offcut metadata rejects provided references while older metadata remains supported',()=>{
 const state=empty();
 for(const itemId of ['variant:sheet','offcut:panel-piece']){
  for(const referenceProfile of ['','none','shs',null])assert.throws(()=>applyWorkshop(state,{action:'metadata',itemId,referenceProfile},actor),/only available for workshop stock/);
  const next=applyWorkshop(state,{action:'metadata',itemId,location:'Rack P'},actor).next;assert.equal(next.metadata[itemId].location,'Rack P');assert.equal(Object.hasOwn(next.metadata[itemId],'referenceProfile'),false);
 }
 assert.deepEqual(state,empty());
});

test('reviewed catalogue creates save reference selection at zero stock and reject a bad later row atomically',()=>{
 const row=(key,referenceProfile)=>({key,mode:'create',supplier:'Example Metals',source:{sku:'SUP-'+key,description:'Fabricated structural profile '+key,unit:'lengths'},item:base({sku:'NEW-'+key,qty:0,referenceProfile})});
 const request={action:'catalogue_import',fileName:'Example materials.pdf',mutationId:crypto.randomUUID(),rows:[row('0','rhs')]},state=empty();
 const result=applyWorkshop(state,request,actor);assert.equal(result.next.items[0].referenceProfile,'rhs');assert.equal(result.next.items[0].qty,0);assert.equal(result.next.items[0].unitCost,12.02);assert.equal(result.importSummary.created,1);
 assert.throws(()=>applyWorkshop(state,{...request,rows:[row('0','rhs'),row('1','invalid')]},actor),/valid reference profile/);assert.deepEqual(state,empty());
});

test('route keeps reference changes admin-only, audited and idempotent without stock movement',()=>{
 const state=create(empty(),{referenceProfile:'shs'}),store=storeFor(state),request={action:'metadata',itemId:state.items[0].id,referenceProfile:'rhs',expectedRevision:state.revision,mutationId:crypto.randomUUID()};
 assert.throws(()=>handleWorkshop(store,'POST',request,{username:'worker',tasks:{'factory.stock':true}}),/Administrator/);
 const result=handleWorkshop(store,'POST',request,actor),saved=store.read('workshop-stock');assert.equal(result.body.stockProfileReferenceVersion,1);assert.equal(result.body.items[0].referenceProfile,'rhs');assert.equal(saved.items[0].qty,9);assert.equal(saved.items[0].unitCost,12.02);assert.equal(saved.movements[0].quantity,0);assert.equal(store.audits.length,1);
 const retry=handleWorkshop(store,'POST',request,actor);assert.equal(retry.body.duplicate,true);assert.deepEqual(store.read('workshop-stock'),saved);assert.equal(store.audits.length,1);
});
