import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,workshopView,handleWorkshop} from '../src/workshop-stock.js';
const actor={username:'operator',isAdmin:true};
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const create=(category='fixings',unit='each')=>applyWorkshop(empty(),{action:'create',item:{category,unit,name:'Workshop item',sku:'STOCK-1',qty:20,reorderLevel:5,packSize:1}},actor).next;
const move=(s,action,quantity,job='Job A',reason='Count checked')=>applyWorkshop(s,{action,itemId:s.items[0].id,quantity,job,reason},actor).next;
test('reservations protect other jobs; usage consumes own allocation; returns restore on hand',()=>{
 let s=create();s=move(s,'reserve',12);assert.equal(s.items[0].qty,20);
 assert.throws(()=>move(s,'use',9,'Job B'),/unavailable/);
 assert.throws(()=>move(s,'reserve',9,'Job B'),/Not enough/);
 s=move(s,'use',5);assert.equal(s.items[0].qty,15);assert.equal(s.items[0].reservations['Job A'],7);
 s=move(s,'release',7);s=move(s,'return',2);assert.equal(s.items[0].qty,17);assert.equal(s.items[0].reservations['Job A'],0);
 assert.equal(s.movements.length,5);assert.equal(s.movements[0].user,'operator');
});
test('stocktake cannot undercut reservations and invalid movements leave state unchanged',()=>{
 const s=move(create(),'reserve',10),before=JSON.stringify(s);
 for(const [action,q] of [['stocktake',9],['damage',11],['release',11],['receive',-1],['use',NaN],['reserve',0]])assert.throws(()=>move(s,action,q));
 assert.equal(JSON.stringify(s),before);const counted=move(s,'stocktake',14);assert.equal(counted.items[0].qty,14);assert.equal(counted.movements[0].quantity,-6);
 assert.throws(()=>move(s,'damage',1,'',''),/reason/);assert.throws(()=>move(s,'use',1,''),/Job reference/);
 assert.throws(()=>move(s,'reserve',1,'__proto__'),/Invalid job/);
});
test('all new categories support bounded fractional quantities and unique stock codes',()=>{
 for(const [c,u] of [['extrusions','lengths'],['fixings','boxes'],['consumables','litres']]){
 let s=create(c,u);s=move(s,'receive',0.125);assert.equal(s.items[0].qty,20.125);
 assert.throws(()=>move(s,'receive',0.0001),/decimal/);
 assert.throws(()=>applyWorkshop(s,{action:'create',item:{category:c,unit:u,name:'Duplicate',sku:'stock-1',qty:1}},actor),/already exists/);
 }
});
function fakeStore(){const docs=new Map();return {read:(k,d)=>structuredClone(docs.has(k)?docs.get(k):d),write:(k,v)=>docs.set(k,structuredClone(v)),requireTask:(a,t)=>{if(!a.isAdmin&&!a.tasks?.[t])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};}
test('shared sheet overview deduplicates CNC sheets and preserves panel quantities',()=>{
 const store=fakeStore();store.write('app:variants',[{id:'sheet',qty:5,color:'White',material:'ACP',thickness:4,width:1200,height:2400}]);
 store.write('app:cncPanels',[1,2].map(id=>({id,stockItemId:'sheet',stockItemType:'variant',jobReference:'Job',orderNumber:'1',sheetNumber:'1',status:'pending'})));
 const row=workshopView(store).items[0];assert.equal(row.reserved,1);assert.equal(row.available,4);assert.equal(store.read('app:variants')[0].qty,5);
});
test('permissions, stale revisions and duplicate retries are enforced at route boundary',()=>{
 const store=fakeStore(),body={mutationId:crypto.randomUUID(),expectedRevision:0,action:'create',item:{category:'extrusions',unit:'lengths',name:'Angle',sku:'ANGLE',qty:5}};
 assert.throws(()=>handleWorkshop(store,'GET',{},{}),/Forbidden/);
 assert.throws(()=>handleWorkshop(store,'POST',body,{username:'staff',tasks:{'factory.stock':true}}),/Administrator/);
 assert.equal(handleWorkshop(store,'POST',body,actor).status,200);
 assert.equal(handleWorkshop(store,'POST',body,actor).body.duplicate,true);assert.equal(store.read('workshop-stock').items.length,1);assert.equal(store.read('app:transactions').length,1);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,item:{...body.item,qty:9}},actor),/reused/);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,mutationId:crypto.randomUUID()},actor),/changed/);
});
test('offcuts require remaining dimensions and metadata does not alter quantities',()=>{
 const input={action:'create',item:{category:'offcuts',unit:'lengths',name:'Angle offcut',sku:'OFF-01',qty:1}};
 assert.throws(()=>applyWorkshop(empty(),input,actor),/dimensions/);
 input.item.details='25 × 25 × 3 mm angle; 860 mm remaining';const s=applyWorkshop(empty(),input,actor).next;
 const edited=applyWorkshop(s,{action:'metadata',itemId:s.items[0].id,location:'Rack D',supplier:'Supplier',reorderLevel:0},actor).next;
 assert.equal(edited.items[0].qty,1);assert.equal(edited.items[0].location,'Rack D');
});
test('profile images persist on create/edit, survive unrelated edits and can be removed',()=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 let s=applyWorkshop(empty(),{action:'create',item:{category:'extrusions',unit:'lengths',name:'Angle',sku:'PROFILE',qty:4,image}},actor).next;
 assert.equal(s.items[0].image,image);const id=s.items[0].id;
 s=applyWorkshop(s,{action:'metadata',itemId:id,location:'A'},actor).next;assert.equal(s.items[0].image,image);
 s=applyWorkshop(s,{action:'metadata',itemId:id,image:''},actor).next;assert.equal(s.items[0].image,'');assert.equal(s.items[0].qty,4);
 s=applyWorkshop(s,{action:'metadata',itemId:'variant:sheet',image,location:'B'},actor).next;
 s=applyWorkshop(s,{action:'metadata',itemId:'variant:sheet',location:'C'},actor).next;assert.equal(s.metadata['variant:sheet'].image,image);
 for(const value of ['data:image/svg+xml;base64,PHN2Zz4=','https://example.com/image.png','data:image/png;base64,YWJjZA==','data:image/png;base64,'+'A'.repeat(700000)])assert.throws(()=>applyWorkshop(s,{action:'metadata',itemId:id,image:value},actor),/image|PNG/);
});
test('length, dimensions and colour are saved separately and validated',()=>{
 let s=applyWorkshop(empty(),{action:'create',item:{category:'extrusions',unit:'lengths',name:'RHS',sku:'RHS',qty:2,lengthMm:6000,dimensions:'80 × 40 × 3 mm',colour:'Black'}},actor).next;
 const id=s.items[0].id;assert.equal(s.items[0].lengthMm,6000);assert.equal(s.items[0].dimensions,'80 × 40 × 3 mm');assert.equal(s.items[0].colour,'Black');
 s=applyWorkshop(s,{action:'metadata',itemId:id,location:'A'},actor).next;assert.equal(s.items[0].lengthMm,6000);
 s=applyWorkshop(s,{action:'metadata',itemId:id,lengthMm:3000,colour:'White',dimensions:'40 × 20 mm'},actor).next;assert.equal(s.items[0].lengthMm,3000);assert.equal(s.items[0].colour,'White');assert.equal(s.items[0].qty,2);
 for(const n of [-1,0,'not a length'])assert.throws(()=>applyWorkshop(s,{action:'metadata',itemId:id,lengthMm:n},actor),/Length/);
 s=applyWorkshop(s,{action:'metadata',itemId:id,lengthMm:''},actor).next;assert.equal(s.items[0].lengthMm,null);
});
test('profile variants share drawings and dimensions but keep stock and reservations independent',()=>{
 const base={category:'extrusions',unit:'lengths',name:'RHS',sku:'RHS-8040',qty:10,lengthMm:6500,colour:'Black',dimensions:'80 × 40 mm'};
 let s=applyWorkshop(empty(),{action:'create',item:base},actor).next;
 s=applyWorkshop(s,{action:'create',item:{...base,sku:' rhs-8040 ',colour:'Norwegian Beech',qty:7,dimensions:'wrong',image:''}},actor).next;
 s=applyWorkshop(s,{action:'create',item:{...base,lengthMm:3000,qty:2}},actor).next;
 assert.equal(s.items.length,3);assert.equal(new Set(s.items.map(i=>i.id)).size,3);
 assert.equal(s.items[1].dimensions,base.dimensions);assert.equal(s.items[1].sku,base.sku);
 s=move(s,'reserve',6);s=move(s,'use',3);
 assert.equal(s.items[0].qty,7);assert.equal(s.items[0].reservations['Job A'],3);
 assert.equal(s.items[1].qty,7);assert.deepEqual(s.items[1].reservations,{});assert.equal(s.items[2].qty,2);
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 s=applyWorkshop(s,{action:'metadata',itemId:s.items[1].id,dimensions:'80 × 40 × 3 mm',image,location:'Rack B',reorderLevel:2},actor).next;
 for(const item of s.items){assert.equal(item.dimensions,'80 × 40 × 3 mm');assert.equal(item.image,image);}
 assert.equal(s.items[0].location,'');assert.equal(s.items[1].location,'Rack B');assert.equal(s.items[0].reorderLevel,0);
 s=applyWorkshop(s,{action:'metadata',itemId:s.items[0].id,image:''},actor).next;
 assert.ok(s.items.every(i=>i.image===''));
});
test('duplicate variants are rejected on create and edit with normalised code and colour',()=>{
 const base={category:'extrusions',unit:'lengths',name:'RHS',sku:'RHS',qty:3,lengthMm:6500,colour:'Mill finish'};
 let s=applyWorkshop(empty(),{action:'create',item:base},actor).next;
 assert.throws(()=>applyWorkshop(s,{action:'create',item:{...base,sku:' rhs ',colour:' MILL   FINISH ',lengthMm:'6500'}},actor),/already exists/);
 s=applyWorkshop(s,{action:'create',item:{...base,colour:'Black'}},actor).next;
 const before=JSON.stringify(s);
 assert.throws(()=>applyWorkshop(s,{action:'metadata',itemId:s.items[1].id,colour:'mill finish',image:''},actor),/already exists/);
 assert.equal(JSON.stringify(s),before);
 assert.throws(()=>applyWorkshop(s,{action:'create',item:{...base,colour:'White',unit:'each'}},actor),/stock unit/);
 assert.throws(()=>applyWorkshop(s,{action:'create',item:{...base,colour:'White',category:'fixings'}},actor),/category/);
});
test('workers submit atomic stocktakes with zero counts, audit and safe retries',()=>{
 const store=fakeStore();let s=create();s=applyWorkshop(s,{action:'create',item:{category:'fixings',unit:'each',name:'Other',sku:'OTHER',qty:5}},actor).next;store.write('workshop-stock',s);
 const worker={username:'worker',tasks:{'factory.stock':true}};
 const body={action:'stocktake_batch',expectedRevision:s.revision,mutationId:crypto.randomUUID(),reason:'Monthly count',counts:s.items.map((i,n)=>({itemId:i.id,expectedQty:i.qty,quantity:n?0:18}))};
 const result=handleWorkshop(store,'POST',body,worker);assert.deepEqual(result.body.items.map(i=>i.qty),[18,0]);assert.equal(result.body.revision,s.revision+1);assert.equal(store.read('app:transactions').length,2);
 assert.equal(handleWorkshop(store,'POST',body,worker).body.duplicate,true);assert.equal(store.read('app:transactions').length,2);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,mutationId:crypto.randomUUID()},worker),/changed/);
});
test('stocktakes reject stale counts and reservation conflicts without partial changes',()=>{
 let s=move(create(),'reserve',10);s=applyWorkshop(s,{action:'create',item:{category:'fixings',unit:'each',name:'Other',sku:'OTHER',qty:5}},actor).next;
 const before=JSON.stringify(s),counts=[{itemId:s.items[1].id,expectedQty:5,quantity:2},{itemId:s.items[0].id,expectedQty:20,quantity:9}];
 assert.throws(()=>applyWorkshop(s,{action:'stocktake_batch',reason:'Count',counts},actor),/reserved/);assert.equal(JSON.stringify(s),before);
 counts[1].quantity=15;counts[1].expectedQty=19;
 assert.throws(()=>applyWorkshop(s,{action:'stocktake_batch',reason:'Count',counts},actor),/changed/);
 assert.throws(()=>applyWorkshop(s,{action:'stocktake_batch',reason:'Count',counts:[counts[0],counts[0]]},actor),/Duplicate/);
});
test('panel previews use catalogue hex colours and follow catalogue edits',()=>{
 const store=fakeStore();store.write('app:catalog',[{id:'c1',color:'White',material:'ACP',thickness:3,colorHex:'#F0F1F2'}]);
 store.write('app:variants',[{id:'v1',catalogId:'c1',color:'White',material:'ACP',thickness:3,qty:4}]);
 store.write('app:offcuts',[{id:'o1',color:'White',material:'ACP',thickness:3,qty:1}]);
 assert.ok(workshopView(store).items.every(i=>i.colorHex==='#F0F1F2'));
 store.write('app:catalog',[{id:'c1',color:'White',material:'ACP',thickness:3,colorHex:'#112233'}]);
 assert.ok(workshopView(store).items.every(i=>i.colorHex==='#112233'));
 store.write('app:catalog',[]);assert.ok(workshopView(store).items.every(i=>i.colorHex===''));
});
test('admins link old offcuts to catalogue without altering size or quantity',()=>{
 const store=fakeStore(),old={id:'old',sku:'OLD',color:'Carbon old name',material:'Alum',thickness:3,width:1700,height:750,qty:2};
 store.write('app:offcuts',[old]);store.write('app:catalog',[{id:'carbon',color:'Carbon',material:'Solid Aluminium',thickness:3,colorHex:'#222222'}]);
 const body={action:'metadata',itemId:'offcut:old',catalogId:'carbon',expectedMaterial:JSON.stringify(['',old.color,old.material,3]),expectedRevision:0,mutationId:crypto.randomUUID()};
 assert.throws(()=>handleWorkshop(store,'POST',body,{username:'worker',tasks:{'factory.stock':true}}),/Administrator/);
 const result=handleWorkshop(store,'POST',body,actor);assert.equal(result.body.items[0].colorHex,'#222222');
 assert.deepEqual(store.read('app:offcuts')[0],{...old,catalogId:'carbon',color:'Carbon',material:'Solid Aluminium'});
 assert.equal(handleWorkshop(store,'POST',body,actor).body.duplicate,true);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,expectedRevision:1,mutationId:crypto.randomUUID()},actor),/material changed/);
});
test('stock names can be edited without changing identity or quantities',()=>{
 const s=create(),id=s.items[0].id;
 const result=applyWorkshop(s,{action:'metadata',itemId:id,name:'New stock name'},actor).next;
 assert.equal(result.items[0].name,'New stock name');assert.equal(result.items[0].qty,20);assert.equal(result.items[0].sku,'STOCK-1');
 assert.throws(()=>applyWorkshop(s,{action:'metadata',itemId:id,name:'  '},actor),/name is required/);
 const store=fakeStore();store.write('app:offcuts',[{id:'old',color:'Carbon',material:'Aluminium',thickness:3,qty:2}]);
 store.write('workshop-stock',applyWorkshop(empty(),{action:'metadata',itemId:'offcut:old',name:'Carbon offcut rack A'},actor).next);
 assert.equal(workshopView(store).items[0].name,'Carbon offcut rack A');assert.equal(store.read('app:offcuts')[0].qty,2);
});
test('admins add and rename categories while preserving item category IDs',()=>{
 let s=create('extrusions','lengths');
 s=applyWorkshop(s,{action:'category_save',categoryId:'extrusions',name:'Profiles & Sections'},actor).next;
 assert.equal(s.items[0].category,'extrusions');assert.equal(s.categories.extrusions,'Profiles & Sections');
 s=applyWorkshop(s,{action:'category_save',name:'Steel sections'},actor).next;
 const key=Object.keys(s.categories).find(k=>k.startsWith('cat-'));
 s=applyWorkshop(s,{action:'create',item:{category:key,unit:'lengths',name:'Top hat',sku:'TH',qty:2}},actor).next;
 assert.equal(s.items[1].category,key);
 assert.throws(()=>applyWorkshop(s,{action:'category_save',name:' steel   sections '},actor),/already exists/);
 assert.throws(()=>applyWorkshop(s,{action:'category_save',categoryId:'__proto__',name:'Bad'},actor),/not found/);
 assert.throws(()=>applyWorkshop(s,{action:'category_save',name:' '},actor),/required/);
 const store=fakeStore();assert.throws(()=>handleWorkshop(store,'POST',{action:'category_save',name:'Steel'},{username:'worker',tasks:{'factory.stock':true}}),/Administrator/);
});
test('SOH adds Steel and Other without duplicating an existing custom Steel category',()=>{
 const store=fakeStore();const s=empty();s.categories={'cat-existing':'Steel'};store.write('workshop-stock',s);
 const view=workshopView(store);assert.equal(view.categories['cat-existing'],'Steel');assert.equal(view.categories.steel,undefined);assert.equal(view.categories.other,'Other');assert.equal(view.categories.panels,'Panels');
 assert.equal(applyWorkshop(empty(),{action:'create',item:{category:'other',unit:'each',name:'Other stock',sku:'OTHER',qty:1}},actor).next.items[0].category,'other');
});
test('named counts enforce admin setup, category scope, shared progress and completion',()=>{
 const store=fakeStore(),worker={username:'counter',tasks:{'factory.stock':true}};
 let s=create();s=applyWorkshop(s,{action:'create',item:{category:'steel',unit:'each',name:'Steel',sku:'STEEL',qty:3}},actor).next;store.write('workshop-stock',s);
 const send=(body,user=actor)=>handleWorkshop(store,'POST',{...body,mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision},user).body;
 assert.throws(()=>send({action:'stocktake_create',name:'October',categories:['fixings']},worker),/Administrator/);
 for(const categories of [[],['panels'],['missing']])assert.throws(()=>send({action:'stocktake_create',name:'October',categories}));
 assert.throws(()=>send({action:'stocktake_create',name:'',categories:['fixings']}),/name/);
 let view=send({action:'stocktake_create',name:'October workshop',categories:['fixings','steel']});const count=view.stocktakes[0];
 assert.equal(count.itemIds.length,2);assert.equal(count.status,'open');
 const submit=(id,quantity,expectedQty)=>send({action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:id,quantity,expectedQty}]},worker);
 assert.throws(()=>submit('outside',0,0),/outside/);
 view=submit(s.items[0].id,18,20);assert.equal(view.stocktakes[0].status,'open');assert.equal(view.stocktakes[0].counts[s.items[0].id].quantity,18);assert.equal(view.stocktakes[0].counts[s.items[0].id].user,'counter');
 assert.throws(()=>submit(s.items[0].id,17,18),/already counted/);
 assert.throws(()=>submit(s.items[1].id,2,2),/changed/);
 view=submit(s.items[1].id,0,3);assert.equal(view.stocktakes[0].status,'completed');assert.ok(view.stocktakes[0].completedAt);assert.equal(view.items.find(i=>i.id===s.items[1].id).qty,0);
 assert.throws(()=>submit(s.items[1].id,1,0),/completed/);
 assert.equal(view.movements[0].stocktakeId,count.id);assert.equal(view.movements[0].reason,'October workshop');
});
test('bulk edits preserve unchecked fields, quantities and panel identities with safe retries',()=>{
 const store=fakeStore();let state=create();state=applyWorkshop(state,{action:'metadata',itemId:state.items[0].id,location:'Old rack',supplier:'Existing supplier',reorderLevel:7},actor).next;store.write('workshop-stock',state);
 store.write('app:variants',[{id:'sheet',qty:5,color:'White',material:'ACP',thickness:4,width:1200,height:2400}]);
 const body={action:'bulk_metadata',itemIds:[state.items[0].id,'variant:sheet'],changes:{location:'Rack B'},expectedRevision:state.revision,mutationId:crypto.randomUUID()};
 assert.throws(()=>handleWorkshop(store,'POST',body,{username:'worker',tasks:{'factory.stock':true}}),/Administrator/);
 const result=handleWorkshop(store,'POST',body,actor).body;assert.equal(result.items.find(i=>i.id===state.items[0].id).supplier,'Existing supplier');assert.equal(result.items.find(i=>i.id===state.items[0].id).reorderLevel,7);
 assert.equal(result.items.find(i=>i.id==='variant:sheet').location,'Rack B');assert.equal(store.read('app:variants')[0].qty,5);assert.equal(store.read('workshop-stock').items[0].qty,20);
 assert.equal(handleWorkshop(store,'POST',body,actor).body.duplicate,true);assert.equal(store.read('app:transactions').length,2);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,mutationId:crypto.randomUUID()},actor),/changed/);
});
test('bulk category and dimensions require all profile variants; invalid variants are atomic',()=>{
 let state=create('extrusions','lengths');state=applyWorkshop(state,{action:'metadata',itemId:state.items[0].id,colour:'Black',dimensions:'20 x 20',lengthMm:6000},actor).next;
 state=applyWorkshop(state,{action:'create',item:{category:'extrusions',unit:'lengths',name:'Workshop item',sku:'STOCK-1',colour:'White',lengthMm:6000,qty:4}},actor).next;
 const ids=state.items.map(i=>i.id),before=JSON.stringify(state);
 assert.throws(()=>applyWorkshop(state,{action:'bulk_metadata',itemIds:[ids[0]],changes:{category:'steel'}},actor),/all colour/);
 assert.throws(()=>applyWorkshop(state,{action:'bulk_metadata',itemIds:ids,changes:{colour:'Blue'}},actor),/already exists/);assert.equal(JSON.stringify(state),before);
 const next=applyWorkshop(state,{action:'bulk_metadata',itemIds:ids,changes:{category:'steel',dimensions:'30 x 30',supplier:''}},actor).next;
 assert.ok(next.items.every(i=>i.category==='steel'&&i.dimensions==='30 x 30'));assert.deepEqual(next.items.map(i=>i.qty),[20,4]);assert.equal(next.revision,state.revision+1);
 for(const changes of [{qty:999},{image:''},{category:'panels'},{}])assert.throws(()=>applyWorkshop(state,{action:'bulk_metadata',itemIds:ids,changes},actor));
 const store=fakeStore();store.write('workshop-stock',state);store.write('app:offcuts',[{id:'old',qty:1}]);
 assert.throws(()=>handleWorkshop(store,'POST',{action:'bulk_metadata',itemIds:['offcut:old'],changes:{colour:'Black'},expectedRevision:state.revision,mutationId:crypto.randomUUID()},actor),/only support/);
 assert.throws(()=>handleWorkshop(store,'POST',{action:'bulk_metadata',itemIds:['variant:missing'],changes:{name:'No'},expectedRevision:state.revision,mutationId:crypto.randomUUID()},actor),/no longer exists/);
});

test('incoming quantities include only outstanding issued PO lines and do not expose full PO records',()=>{
 const store=fakeStore(),state=create(),id=state.items[0].id;
 state.purchaseOrders=[
  {status:'open',lines:[{itemId:id,ordered:4.25,received:0},{itemId:'variant:sheet',ordered:10,received:0}]},
  {status:'partial',lines:[{itemId:id,ordered:5,received:2.125},{itemId:'variant:sheet',ordered:8,received:3}]},
  ...['draft','cancelled','received'].map(status=>({status,reference:'private',lines:[{itemId:id,ordered:100,received:0}]}))
 ];
 store.write('workshop-stock',state);store.write('app:variants',[{id:'sheet',qty:2}]);
 const view=workshopView(store);
 assert.equal(view.items.find(i=>i.id===id).onOrder,7.125);
 assert.equal(view.items.find(i=>i.id==='variant:sheet').onOrder,15);
 assert.equal(view.items.find(i=>i.id===id).available,20);
 assert.equal(Object.hasOwn(view,'purchaseOrders'),false);
 assert.deepEqual(store.read('workshop-stock'),state);
 state.purchaseOrders[0].status='cancelled';state.purchaseOrders[1].lines[0].received=5;
 store.write('workshop-stock',state);
 assert.equal(workshopView(store).items.find(i=>i.id===id).onOrder,0);
});

test('stock users see only incoming line summaries, with exact variants and no private PO documents or notes',()=>{
 const store=fakeStore(),state=create('extrusions','lengths'),id=state.items[0].id;
 const po={id:'po-1',reference:'PO-104',supplier:'Supplier',status:'partial',expectedDelivery:'2026-10-09',notes:'Private',attachments:[{key:'private-key'}],receipts:[{notes:'Private docket note'}],duplicateOverrides:[{reason:'Private review'}],lines:[{itemId:id,ordered:8,received:3},{itemId:'variant:sheet',ordered:4,received:1},{itemId:'offcut:cut',ordered:2,received:2}]};
 state.purchaseOrders=[po,...['draft','received','closed_short','cancelled'].map(status=>({...po,id:status,status,reference:'Hidden '+status}))];state.poStockReferences=[{secret:'supplier learning'}];
 store.write('workshop-stock',state);store.write('app:variants',[{id:'sheet',qty:2}]);store.write('app:offcuts',[{id:'cut',qty:2}]);
 const user={username:'stock-viewer',tasks:{'factory.stock':true}},before=JSON.stringify(state),view=handleWorkshop(store,'GET',{},user).body;
 const item=view.items.find(i=>i.id===id);
 assert.equal(item.onOrder,5);assert.deepEqual(item.incomingOrders,[{orderId:'po-1',reference:'PO-104',supplier:'Supplier',status:'partial',expectedDelivery:'2026-10-09',ordered:8,received:3,outstanding:5}]);
 assert.equal(view.items.find(i=>i.id==='variant:sheet').incomingOrders[0].outstanding,3);
 assert.deepEqual(view.items.find(i=>i.id==='offcut:cut').incomingOrders,[]);
 assert.equal(view.purchaseOrders,undefined);assert.equal(view.poStockReferences,undefined);
 assert.ok(!JSON.stringify(item.incomingOrders).includes('Private'));assert.equal(JSON.stringify(store.read('workshop-stock')),before);
 assert.throws(()=>handleWorkshop(store,'GET',{},{}),/Forbidden/);
 po.lines[0].received=8;store.write('workshop-stock',state);
 const refreshed=handleWorkshop(store,'GET',{},user).body.items.find(i=>i.id===id);assert.equal(refreshed.onOrder,0);assert.deepEqual(refreshed.incomingOrders,[]);
});
