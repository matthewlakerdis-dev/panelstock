import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyWorkshop,handleWorkshop,workshopView} from '../src/workshop-stock.js';
import {handlePurchaseOrders} from '../src/purchase-orders.js';
import {stockIdentity,poKey} from '../src/supplier-stock-references.js';

const admin={username:'admin',isAdmin:true},reader={username:'reader',isAdmin:false,tasks:{'factory.stock':true}};
const current=()=>({id:'angle',sku:'OUR-ANGLE',name:'Our angle',category:'extrusions',unit:'lengths',colour:'Black',lengthMm:6000,dimensions:'30 x 30 x 3',qty:9,reservations:{'Job A':2},location:'Rack A',supplier:'Internal supplier',unitCost:15,reorderLevel:2,packSize:1,costBasis:'unit'});
const initial=()=>({revision:7,items:[current()],metadata:{},movements:[],purchaseOrders:[{id:'open-po',reference:'PO1',supplier:'Supplier',status:'open',version:1,lines:[{itemId:'angle',ordered:12,received:3}],attachments:[],receipts:[]}],stocktakes:[]});
function setup(state=initial()){
 const docs=new Map([['workshop-stock',structuredClone(state)],['revision',10],['app:transactions',[{id:'prior-activity',desc:'Earlier movement'}]]]),audits=[],broadcasts=[];
 const store={read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>audits.push(args),broadcastRevision:value=>broadcasts.push(value)};
 return {store,docs,audits,broadcasts,snapshot:()=>JSON.stringify([...docs]),post:body=>handleWorkshop(store,'POST',body,admin).body};
}
const source=(patch={})=>({sku:'SUP-01',description:'Supplier black angle',colour:'Black',lengthMm:6000,dimensions:'30 x 30 x 3',unit:'lengths',...patch});
const matched=(patch={})=>({key:'0',mode:'match',itemId:'angle',expectedItemIdentity:stockIdentity(current()),supplier:'Supplier A',remember:true,expectedReferenceVersion:0,source:source(),...patch});
const created=(patch={})=>({key:'1',mode:'create',supplier:'Supplier B',remember:true,expectedReferenceVersion:0,source:source({sku:'00042',description:'Supplier screws',colour:'',lengthMm:null,dimensions:'M6 x 20',unit:'each'}),item:{name:'Our screw',sku:'SCREW-01',category:'fixings',unit:'each',colour:'Silver',dimensions:'M6 x 20',supplier:'Supplier B',unitCost:0.5},...patch});
const batch=(rows=[matched(),created()],patch={})=>({action:'catalogue_import',mutationId:crypto.randomUUID(),expectedRevision:7,fileName:'Nexvia materials.pdf',rows,...patch});

test('reviewed catalogue photos persist at zero stock without changing current inventory or imported price, including retries',()=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',x=setup(),before=x.store.read('workshop-stock').items[0];
 const request=batch([created({item:{...created().item,image,qty:0,unitCost:29.59,sku:'815581 EN7492(ME9395)'}})]),result=x.post(request),state=x.store.read('workshop-stock');
 assert.deepEqual(state.items[0],before);const item=state.items.find(item=>item.id!==before.id);assert.equal(item.image,image);assert.equal(item.qty,0);assert.equal(item.unitCost,29.59);assert.equal(item.sku,'815581 EN7492(ME9395)');const saved=x.snapshot();assert.equal(x.post(request).duplicate,true);assert.equal(x.snapshot(),saved);assert.equal(result.importSummary.created,1);
});
test('catalogue photos reject remote URLs and invalid image data atomically',()=>{
 for(const image of ['https://shop.capral.com.au/profile.png','data:image/png;base64,YWJjZA==']){
  const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch([created({item:{...created().item,image}})])),/image|PNG/i);assert.equal(x.snapshot(),before);
 }
});

test('reviewed PDF import matches current stock and creates zero-stock catalogue items atomically',()=>{
 const x=setup(),before=x.store.read('workshop-stock'),result=x.post(batch()),state=x.store.read('workshop-stock');
 assert.equal(result.importSummary.created,1);assert.equal(result.importSummary.matched,1);assert.equal(result.importSummary.fileName,'Nexvia materials.pdf');assert.equal(result.importSummary.rows[0].itemId,'angle');
 assert.equal(state.revision,8);assert.equal(state.items.length,2);assert.deepEqual(state.items[0],before.items[0]);assert.deepEqual(state.purchaseOrders,before.purchaseOrders);
 const added=state.items[1];assert.equal(added.name,'Our screw');assert.equal(added.sku,'SCREW-01');assert.equal(added.qty,0);assert.deepEqual(added.reservations,{});assert.equal(added.unitCost,0.5);
 assert.equal(state.poStockReferences.length,2);assert.equal(state.poStockReferences[0].source.sku,'SUP-01');assert.equal(state.poStockReferences[1].source.sku,'00042');assert.equal(state.poStockReferences[1].itemId,added.id);
 assert.equal(state.movements.length,2);assert.ok(state.movements.every(m=>m.quantity===0));assert.ok(state.movements.some(m=>m.importSummary?.created===1));assert.ok(x.audits.every(entry=>entry[1]==='workshop-stock'));assert.deepEqual(x.broadcasts,[11]);
 const history=x.store.read('app:transactions');assert.equal(history.length,3);assert.ok(history.some(m=>m.desc.includes('Nexvia materials.pdf')));
});

test('catalogue matches use the same supplier references returned to future PO reviews',()=>{
 const x=setup(),request=batch([matched()]);x.post(request);
 const po=handlePurchaseOrders(x.store,'GET',{},admin).body;
 assert.equal(po.stockReferences[0].key,poKey('Supplier A',source()));assert.equal(po.stockReferences[0].itemIdentity,stockIdentity(current()));assert.equal(po.stockReferences[0].catalogueImportId,request.mutationId);
 assert.equal(workshopView(x.store).poStockReferences,undefined);
 const catalogue=handleWorkshop(x.store,'GET',{},admin).body;assert.equal(catalogue.stockLearning,true);assert.equal(catalogue.materialImportPricingVersion,1);assert.equal(catalogue.stockReferences[0].key,po.stockReferences[0].key);
 const publicStock=handleWorkshop(x.store,'GET',{},reader).body;assert.equal(publicStock.stockReferences,undefined);assert.equal(publicStock.stockLearning,undefined);
});

test('only stock administrators may import and source aliases are not exposed to stock readers',()=>{
 const x=setup(),before=x.snapshot();
 assert.throws(()=>handleWorkshop(x.store,'POST',batch(),reader),/Administrator/);assert.throws(()=>handleWorkshop(x.store,'GET',{},{}),/Forbidden/);
 assert.equal(x.snapshot(),before);assert.equal(x.audits.length,0);
});

test('a bad later row leaves earlier creates, learned matches, revisions and audit history unchanged',()=>{
 for(const bad of [created({key:'2',item:{...created().item,sku:'OTHER',unit:'invalid'}}),matched({key:'2',itemId:'missing'}),matched({key:'2',expectedItemIdentity:'stale'})]){
  const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch([created(),bad])));assert.equal(x.snapshot(),before);assert.equal(x.audits.length,0);assert.equal(x.broadcasts.length,0);
 }
});

test('optimistic stock revision, stock identity and supplier reference version each require re-review',()=>{
 const x=setup();x.post(batch([matched()]));const before=x.snapshot();
 assert.throws(()=>x.post(batch([matched()])),/stock changed/i);
 assert.throws(()=>x.post(batch([matched({expectedItemIdentity:'stale',expectedReferenceVersion:1})],{expectedRevision:8})),/variant changed/i);
 assert.throws(()=>x.post(batch([matched()],{expectedRevision:8})),/supplier stock match changed/i);
 assert.equal(x.snapshot(),before);
});

test('retrying an acknowledged import returns the same new IDs and summary without reapplying it',()=>{
 const x=setup(),request=batch(),first=x.post(request),state=x.snapshot(),auditCount=x.audits.length;
 const retry=x.post(request);assert.equal(retry.duplicate,true);assert.deepEqual(retry.importSummary,first.importSummary);assert.equal(x.snapshot(),state);assert.equal(x.audits.length,auditCount);assert.deepEqual(x.broadcasts,[11]);
 assert.throws(()=>x.post({...request,fileName:'Changed.pdf'}),/Mutation ID reused/);
});
const pricedMatch=(patch={})=>matched({source:source({category:'extrusions',stockUnit:'lengths',unitCost:21.95,priceUnit:'length',currency:'AUD',taxBasis:'exGST'}),priceUpdate:{unitCost:21.95,expectedUnitCost:15},...patch});
test('a reviewed matched PDF price updates only unit cost and audits its zero-quantity provenance',()=>{
 const state=initial();state.stocktakes=[{id:'finished',status:'completed',report:{unitCost:15}}];
 const x=setup(state),request=batch([pricedMatch()],{fileName:'Supplier catalogue.pdf'}),first=x.post(request),after=x.store.read('workshop-stock');
 assert.deepEqual(after.items[0],{...state.items[0],unitCost:21.95});assert.deepEqual(after.purchaseOrders,state.purchaseOrders);assert.deepEqual(after.stocktakes,state.stocktakes);
 assert.equal(first.importSummary.priceUpdated,1);const change=first.importSummary.rows[0].priceUpdate;
 assert.deepEqual(change,{itemId:'angle',fileName:'Supplier catalogue.pdf',rowKey:'0',oldUnitCost:15,newUnitCost:21.95,costBasis:'unit',priceUnit:'length',currency:'AUD',taxBasis:'exGST'});
 assert.equal(after.movements.length,2);assert.ok(after.movements.every(m=>m.quantity===0));assert.deepEqual(after.movements.find(m=>m.action==='catalogue_price_update').priceUpdate,change);
 assert.ok(x.audits.some(entry=>entry[2].priceUpdate?.oldUnitCost===15));
 assert.deepEqual(after.poStockReferences[0].source,source());assert.equal(after.poStockReferences[0].key,poKey('Supplier A',source()));
 const snapshot=x.snapshot(),audits=x.audits.length,retry=x.post(request);assert.equal(retry.duplicate,true);assert.deepEqual(retry.importSummary,first.importSummary);assert.equal(x.snapshot(),snapshot);assert.equal(x.audits.length,audits);assert.deepEqual(x.broadcasts,[11]);
});
test('omitting price update leaves a matched item unchanged even when its PDF has a safe price',()=>{
 const row=pricedMatch();delete row.priceUpdate;
 const x=setup(),result=x.post(batch([row]));assert.deepEqual(x.store.read('workshop-stock').items[0],current());assert.equal(result.importSummary.priceUpdated,0);assert.equal(result.importSummary.rows[0].priceUpdate,undefined);
});
test('full 6500 mm extrusion each prices update full-length unit costs without conversion',()=>{
 const state=initial();state.items[0].lengthMm=6500;
 const row=pricedMatch({expectedItemIdentity:stockIdentity(state.items[0]),source:source({unit:'EA',category:'extrusions',lengthMm:6500,stockUnit:'lengths',unitCost:21.95,priceUnit:'EA',currency:'AUD',taxBasis:'exGST'})});
 const x=setup(state);x.post(batch([row]));assert.equal(x.store.read('workshop-stock').items[0].unitCost,21.95);
});
test('a reviewed each-counted full extrusion price preserves its existing each stock unit',()=>{
 const state=initial();Object.assign(state.items[0],{unit:'each',lengthMm:6500});
 const row=pricedMatch({expectedItemIdentity:stockIdentity(state.items[0]),source:source({unit:'EA',category:'extrusions',lengthMm:6500,stockUnit:'lengths',unitCost:12.02,priceUnit:'EA',currency:'AUD',taxBasis:'exGST'}),priceUpdate:{unitCost:12.02,expectedUnitCost:15}});
 const x=setup(state),result=x.post(batch([row]));assert.deepEqual(x.store.read('workshop-stock').items[0],{...state.items[0],unitCost:12.02});assert.equal(result.importSummary.rows[0].priceUpdate.newUnitCost,12.02);
});
test('zero is a valid PDF update and an absent prior unit cost is compared as null',()=>{
 const state=initial();delete state.items[0].unitCost;const x=setup(state),row=pricedMatch();row.source.unitCost=0;row.priceUpdate={unitCost:0,expectedUnitCost:null};
 const result=x.post(batch([row]));assert.equal(x.store.read('workshop-stock').items[0].unitCost,0);assert.equal(result.importSummary.rows[0].priceUpdate.oldUnitCost,null);
 const fresh=setup(),same=pricedMatch();same.source.unitCost=15;same.priceUpdate.unitCost=15;
 const unchanged=fresh.post(batch([same]));assert.equal(unchanged.importSummary.priceUpdated,0);assert.equal(fresh.store.read('workshop-stock').movements.length,1);
});
test('stale, unsafe, malformed and conflicting matched prices reject the entire import atomically',()=>{
 const base=pricedMatch(),unsafeSources=[{currency:'USD'},{currency:''},{taxBasis:'incGST'},{taxBasis:'unknown'},{priceUnit:'per metre'},{priceUnit:'100 lengths'},{dimensions:'40 x 40 x 4'},{dimensions:''},{lengthMm:6500},{lengthMm:null},{lengthMm:undefined},{colour:'White'},{category:'fixings'},{unitCost:20},{unitCost:'21.95'},{unitCost:21.951}];
 const invalidRows=[...unsafeSources.map(patch=>({...base,source:{...base.source,...patch}})),...[
  null,[],{unitCost:21.95},{unitCost:21.95,expectedUnitCost:14},{unitCost:'21.95',expectedUnitCost:15},{unitCost:21.95,expectedUnitCost:'15'},{unitCost:21.95,expectedUnitCost:15,qty:100}
 ].map(priceUpdate=>({...base,priceUpdate}))];
 for(const row of invalidRows){const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch([created(),row])));assert.equal(x.snapshot(),before);assert.equal(x.audits.length,0);assert.equal(x.broadcasts.length,0);}
 const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch([pricedMatch({priceUpdate:{unitCost:21.95,expectedUnitCost:14}})])),error=>error.status===409&&/Unit cost changed/.test(error.message));assert.equal(x.snapshot(),before);
 for(const costBasis of ['pack','area']){const state=initial();state.items[0].costBasis=costBasis;const x=setup(state),before=x.snapshot();assert.throws(()=>x.post(batch([pricedMatch()])));assert.equal(x.snapshot(),before);}
 for(const row of [created({priceUpdate:{unitCost:0.5,expectedUnitCost:null}}),pricedMatch({item:{name:'Overwrite'}})]){const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch([row])));assert.equal(x.snapshot(),before);}
 const repeated=setup(),snapshot=repeated.snapshot();assert.throws(()=>repeated.post(batch([pricedMatch(),pricedMatch({key:'2',supplier:'Supplier C',priceUpdate:{unitCost:21.95,expectedUnitCost:21.95}})])),/one PDF price/);assert.equal(repeated.snapshot(),snapshot);
});

test('matched records are immutable and panels, offcuts, archived or missing items cannot be selected',()=>{
 for(const patch of [{itemId:'missing'},{itemId:'variant:panel'},{itemId:'offcut:cut'},{item:{name:'Overwrite',qty:50}}]){
  const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch([matched(patch)])));assert.equal(x.snapshot(),before);
 }
 for(const patch of [{archivedAt:'2026-01-01'},{legacy:true},{category:'panels'},{category:'offcuts'}]){
  const state=initial();state.items[0]={...state.items[0],...patch};const x=setup(state),before=x.snapshot();assert.throws(()=>x.post(batch([matched({expectedItemIdentity:stockIdentity(state.items[0])})])));assert.equal(x.snapshot(),before);
 }
});

test('create rows cannot set stock quantities, reservations or panel/offcut records',()=>{
 for(const patch of [{qty:5},{qty:-1},{qty:null},{reservations:{}},{reserved:0},{available:0},{onOrder:5},{received:2},{category:'panels'},{category:'offcuts'},{legacy:true}]){
  const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch([created({item:{...created().item,...patch}})])));assert.equal(x.snapshot(),before);
 }
});

test('duplicate row keys and supplier aliases are rejected before any writes',()=>{
 for(const rows of [[matched(),created({key:'0'})],[matched(),matched({key:'2'})],[created(),created({key:'2'})],[created({remember:false}),created({key:'2',remember:false,item:{...created().item,sku:''}})]]){
  const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch(rows)),/unique key|repeated|already exists/i);assert.equal(x.snapshot(),before);
 }
});

test('new variants may share a current profile but cannot silently change its reviewed name or dimensions',()=>{
 const x=setup(),value={...current(),qty:0,colour:'White',lengthMm:3000};delete value.id;delete value.reservations;
 // Derived stock-only values are not part of a catalogue create.
 for(const key of ['available','reserved','onOrder','received'])delete value[key];
 const row=created({remember:false,item:value,source:source({colour:'White',lengthMm:3000})});
 for(const patch of [{name:'Different name'},{dimensions:'40 x 40 x 4'}])assert.throws(()=>x.post(batch([{...row,item:{...value,...patch}}])),/existing profile/);
 const response=x.post(batch([row])),state=x.store.read('workshop-stock');assert.equal(response.importSummary.created,1);assert.equal(state.items[1].sku,'OUR-ANGLE');assert.equal(state.items[1].colour,'White');assert.equal(state.items[1].qty,0);assert.deepEqual(state.items[0],current());
});
test('new variants cannot inherit an existing profile when the PDF explicitly identifies a different cross-section',()=>{
 const value={...current(),colour:'White',lengthMm:3000};delete value.id;delete value.reservations;delete value.qty;
 const row=created({remember:false,item:value,source:source({colour:'White',lengthMm:3000,dimensions:'32 x 20 x 1.6'})}),x=setup(),before=x.snapshot();
 assert.throws(()=>x.post(batch([row])),error=>error.status===409&&/PDF dimensions/.test(error.message));assert.equal(x.snapshot(),before);
 row.source.dimensions='30.0X30X3 mm';x.post(batch([row]));const after=x.store.read('workshop-stock');assert.equal(after.items[1].name,current().name);assert.equal(after.items[1].lengthMm,3000);assert.equal(after.items[1].colour,'White');
});

test('supplier learning requires a known supplier, while an explicitly unremembered match needs none',()=>{
 const x=setup(),before=x.snapshot();assert.throws(()=>x.post(batch([matched({supplier:''})])),/Enter the supplier/);assert.equal(x.snapshot(),before);
 x.post(batch([matched({supplier:'',remember:false})]));assert.equal(x.store.read('workshop-stock').poStockReferences.length,0);assert.deepEqual(x.store.read('workshop-stock').items[0],current());
});

test('review can replace a known supplier match only with its current version and target identity',()=>{
 const state=initial(),other={...current(),id:'other',sku:'OTHER',qty:2};state.items.push(other);
 state.poStockReferences=[{key:poKey('Supplier A',source()),supplier:'Supplier A',source:source(),itemId:'angle',itemIdentity:stockIdentity(current()),version:3}];
 const x=setup(state);x.post(batch([matched({itemId:'other',expectedItemIdentity:stockIdentity(other),expectedReferenceVersion:3})]));const after=x.store.read('workshop-stock');assert.equal(after.poStockReferences.length,1);assert.equal(after.poStockReferences[0].itemId,'other');assert.equal(after.poStockReferences[0].version,4);assert.deepEqual(after.items,state.items);
});

test('bounded PDF imports reject empty, oversized or invalid source rows and filenames',()=>{
 const x=setup(),before=x.snapshot();
 for(const request of [batch([]),batch(Array.from({length:201},(_,index)=>matched({key:String(index)}))),batch([matched({source:{}})]),batch([matched({source:{description:'x',lengthMm:-1}})]),batch([matched()],{fileName:'materials.csv'}),batch([matched()],{fileName:'bad\nname.pdf'}),batch([matched()],{fileName:'A'.repeat(201)+'.pdf'})])assert.throws(()=>x.post(request));
 assert.equal(x.snapshot(),before);
});

test('the pure import helper rejects nonadministrators without mutating caller state',()=>{
 const state=initial(),before=structuredClone(state);assert.throws(()=>applyWorkshop(state,batch(),reader),/Administrator/);assert.deepEqual(state,before);
});

test('the real workshop response serializer preserves catalogue aliases only for administrator handlers',async()=>{
 const x=setup();x.post(batch([matched()]));
 const code=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8'),start=code.indexOf('  async workshopStockResponse('),end=code.indexOf('  async handle(',start);
 assert.ok(start>=0&&end>start);
 const endpoint=new Function('return ({'+code.slice(start,end)+'});')();
 endpoint.handle=async(path,method,body,token)=>{assert.equal(path,'/workshop-stock');return handleWorkshop(x.store,method,body,token==='admin'?admin:reader);};
 const privileged=await (await endpoint.workshopStockResponse('GET',{},'admin','ip','web')).json();
 assert.equal(privileged.stockLearning,true);assert.equal(privileged.stockReferences[0].itemId,'angle');
 const ordinary=await (await endpoint.workshopStockResponse('GET',{},'reader','ip','web')).json();
 assert.equal(ordinary.stockReferences,undefined);assert.equal(ordinary.stockLearning,undefined);
});

test('the maximum catalogue batch clones image-bearing inventory once instead of once per created row',t=>{
 const state=initial(),image='data:image/png;base64,'+'A'.repeat(4*1024*1024);state.items[0].image=image;
 const clone=globalThis.structuredClone;let calls=0;
 t.mock.method(globalThis,'structuredClone',(value,options)=>{calls++;return clone(value,options);});
 const rows=Array.from({length:200},(_,index)=>created({key:String(index),remember:false,source:source({sku:'SUP-'+index,description:'Material '+index}),item:{name:'Material '+index,sku:'NEW-'+index,category:'fixings',unit:'each'}}));
 const result=applyWorkshop(state,batch(rows),admin);
 assert.equal(calls,1);assert.equal(result.importSummary.created,200);assert.equal(result.next.items.length,201);assert.equal(result.next.revision,8);
 assert.equal(result.next.items[0].image,image);assert.equal(result.next.items[0].qty,9);assert.equal(state.items.length,1);assert.equal(state.revision,7);
 assert.ok(result.next.items.slice(1).every(item=>item.qty===0));
});
