import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {applyWorkshop,handleWorkshop,workshopView} from '../src/workshop-stock.js';
import {defaultStocktakeSettings} from '../src/stocktake-settings.js';
import {countedStockItemsThisMonth,stocktakeMonth} from '../src/stocktake-month.js';

const admin={username:'admin',isAdmin:true},counter={username:'counter',tasks:{'factory.stock':true}};
const panel=(id='sheet',patch={})=>({id,sku:'SHEET-'+id,catalogId:'white',color:'White',material:'ACP',thickness:3,width:2400,height:1200,qty:5,...patch});
const stock=(id='fixing',patch={})=>({id,name:'Fixing '+id,sku:'FIX-'+id,category:'fixings',unit:'each',qty:10,reservations:{},unitCost:2.5,xeroGroup:'fixings',supplier:'Supplier A',...patch});
const state=(patch={})=>({revision:0,items:[stock()],metadata:{'variant:sheet':{name:'Named full panel',supplier:'Supplier A',location:'Panel rack',details:'Protect film',xeroGroup:'cladding',unitCost:100}},movements:[],...patch});
const catalogue=(rate=20)=>[{id:'white',color:'White',material:'ACP',thickness:3,unitCostPerM2:rate}];
const context=(patch={})=>({variants:[panel()],catalog:catalogue(),cncPanels:[],offcuts:[panel('cut',{width:500,height:400,qty:2})],...patch});
function storeFor(stockState=state(),extra={}){
 const documents=new Map(Object.entries({'workshop-stock':structuredClone(stockState),'app:variants':[panel()],'app:offcuts':[panel('cut',{width:500,height:400,qty:2})],'app:catalog':catalogue(),'stocktake-settings':defaultStocktakeSettings(),revision:10,...extra}));
 const store={documents,writes:0,events:[],audits:[],broadcasts:[],inTransaction:false,
  read:(key,fallback)=>structuredClone(documents.has(key)?documents.get(key):fallback),
  write:(key,value)=>{assert.equal(store.inTransaction,true,'all stock writes share a transaction');store.writes++;store.events.push(key);documents.set(key,structuredClone(value));},
  requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task]){const error=Error('Forbidden');error.status=403;throw error;}},
  ctx:{storage:{transactionSync:fn=>{assert.equal(store.inTransaction,false);const before=structuredClone([...documents]);store.inTransaction=true;try{return fn();}catch(error){documents.clear();for(const [key,value] of before)documents.set(key,value);throw error;}finally{store.inTransaction=false;}}}},
  audit:(...args)=>{assert.equal(store.inTransaction,true);store.audits.push(structuredClone(args));},broadcastRevision:revision=>{assert.equal(store.inTransaction,false);store.broadcasts.push(revision);}};
 return store;
}
const post=(store,input,actor=admin)=>handleWorkshop(store,'POST',{mutationId:randomUUID(),expectedRevision:store.read('workshop-stock').revision,...input},actor);
const create=(store,patch={})=>post(store,{action:'stocktake_create',name:'Mixed count',categories:['panels','fixings'],...patch}).body.stocktakes[0];
const submit=(store,id,counts)=>post(store,{action:'stocktake_batch',stocktakeId:id,counts},counter);
const snapshot=store=>JSON.stringify([...store.documents]);

test('manual scope excludes panels and automatic inclusion is independent of supplier, category and monthly filters',()=>{
 const current=state({items:[stock(),stock('other',{supplier:'Supplier B'}),stock('archived',{archivedAt:'2026-10-01'}),stock('bad-copy',{category:'panels'})]}),trusted=context({variants:[panel(),panel('other'),panel('archived',{archivedAt:'2026-10-01'})]});
 current.metadata['variant:other']={supplier:'Supplier B'};const before=JSON.stringify({current,trusted});
 const input={action:'stocktake_create',name:'Supplier count',categories:['panels','fixings'],supplier:' Supplier A ',variants:[panel('forged')]};
 const created=applyWorkshop(current,input,admin,defaultStocktakeSettings(),trusted).next,count=created.stocktakes[0];assert.deepEqual(count.itemIds,['fixing']);assert.deepEqual(count.categories,['fixings']);assert.equal(count.supplier,'Supplier A');assert.equal(count.includePanels,true);
 const done=applyWorkshop(created,{action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'fixing',expectedQty:10,quantity:9}]},counter,defaultStocktakeSettings(),trusted).next.stocktakes[0];
 assert.deepEqual(done.report.panelSnapshot.itemIds,['variant:sheet','variant:other']);assert.deepEqual(done.report.categories,['fixings','panels']);assert.equal(done.report.supplier,'Supplier A');assert.equal(done.report.rows.find(row=>row.itemId==='variant:other').supplier,'Supplier B');assert.equal(JSON.stringify({current,trusted}),before);
 assert.deepEqual(applyWorkshop(current,{...input,categories:[],supplier:'No match'},admin,defaultStocktakeSettings(),trusted).next.stocktakes[0].itemIds,[]);
 assert.throws(()=>applyWorkshop(state({items:[]}),{...input,categories:[]},admin),/No workshop items/);
 assert.throws(()=>applyWorkshop(current,{...input,categories:['missing']},admin,defaultStocktakeSettings(),trusted),/valid stock categories/);
});

test('completion captures current panel quantities and geometry without writing raw stock or false panel movements',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-08T01:00:00Z')});
 const store=storeFor(state({items:[stock(),stock('second')]})),count=create(store,{categories:['fixings']});
 submit(store,count.id,[{itemId:'fixing',expectedQty:10,quantity:9.125}]);assert.equal(store.read('workshop-stock').stocktakes[0].report,undefined);
 const raw=[panel('sheet',{qty:3,width:3000,height:1500}),panel('new',{qty:0}),panel('archived',{qty:99,archivedAt:'2026-11-08'})];store.documents.set('app:variants',raw);store.documents.set('app:catalog',catalogue(25));
 store.documents.get('workshop-stock').metadata['variant:new']={supplier:'Supplier B',xeroGroup:'materials'};
 const settings=defaultStocktakeSettings();settings.revision=2;settings.cosGroups.find(group=>group.id==='cladding').accountCode='00500';store.documents.set('stocktake-settings',settings);
 t.mock.timers.setTime(Date.parse('2026-11-09T02:00:00Z'));const beforeWrites=store.events.length,done=submit(store,count.id,[{itemId:'second',expectedQty:10,quantity:10}]).body.stocktakes[0],report=done.report,rows=report.rows.filter(row=>row.quantitySource==='soh-snapshot');
 assert.equal(done.status,'completed');assert.equal(report.version,2);assert.deepEqual(report.panelSnapshot,{capturedAt:'2026-11-09T02:00:00.000Z',itemIds:['variant:sheet','variant:new']});assert.deepEqual(rows.map(row=>row.quantity),[3,0]);assert.deepEqual(store.read('app:variants'),raw);assert.ok(!store.events.slice(beforeWrites).includes('app:variants'));
 const sheet=rows[0];assert.equal(sheet.width,3000);assert.equal(sheet.height,1500);assert.equal(sheet.catalogueCost.ratePerM2,25);assert.equal(sheet.catalogueCost.width,3000);assert.equal(sheet.xeroAccountCode,'00500');assert.equal(sheet.name,'Named full panel');assert.equal(sheet.details,'Protect film');assert.equal(sheet.dimensions,'3000 × 1500 mm');
 for(const row of rows){assert.equal(row.expectedQty,null);assert.equal(row.variance,null);assert.equal(row.user,'');assert.equal(row.at,done.completedAt);assert.equal(row.quantityCapturedAt,done.completedAt);assert.equal(row.pricingCapturedAt,done.completedAt);assert.equal(row.category,'panels');assert.equal(row.unit,'sheets');assert.equal(Object.hasOwn(done.counts,row.itemId),false);}
 assert.ok(store.read('workshop-stock').movements.every(row=>!row.itemId.startsWith('variant:')));assert.ok(store.read('app:transactions').every(row=>!row.desc.includes('SHEET-')));assert.deepEqual(report.stocktakeSettings,settings);assert.equal(report.rows.find(row=>row.itemId==='fixing').at,'2026-11-08T01:00:00.000Z');
});

test('panel-only stocktakes explicitly complete empty counts and preserve empty authoritative snapshots',()=>{
 const store=storeFor(state({items:[]})),count=create(store,{categories:[]});assert.deepEqual(count.itemIds,[]);assert.deepEqual(count.counts,{});assert.equal(count.status,'open');
 const raw=store.read('app:variants'),history=store.read('app:transactions'),movements=store.read('workshop-stock').movements;
 let done=submit(store,count.id,[]).body.stocktakes[0];assert.equal(done.status,'completed');assert.deepEqual(done.counts,{});assert.deepEqual(done.report.panelSnapshot.itemIds,['variant:sheet']);assert.deepEqual(store.read('app:variants'),raw);assert.deepEqual(store.read('app:transactions'),history);assert.deepEqual(store.read('workshop-stock').movements,movements);assert.ok(store.audits.some(([,action,entry])=>action==='stocktake-complete'&&entry.panelItems===1));
 const another=storeFor(state({items:[]})),empty=create(another,{categories:['panels']});another.documents.set('app:variants',[]);done=submit(another,empty.id,[]).body.stocktakes[0];assert.equal(done.status,'completed');assert.deepEqual(done.report.rows,[]);assert.deepEqual(done.report.panelSnapshot,{capturedAt:done.completedAt,itemIds:[]});
 assert.throws(()=>post(store,{action:'stocktake_batch',reason:'Not a named count',counts:[]},counter),/remaining workshop/);
 const manual=storeFor(),open=create(manual),before=snapshot(manual);assert.throws(()=>submit(manual,open.id,[]),/remaining workshop/);assert.equal(snapshot(manual),before);
});

test('all new manual panel submissions reject old clients and cannot modify either inventory in mixed batches',()=>{
 for(const named of [true,false])for(const quantity of [0,3,.5]){
  const store=storeFor(),count=create(store),before=snapshot(store),body={action:'stocktake_batch',...(named?{stocktakeId:count.id}:{reason:'Old client'}),counts:[{itemId:'fixing',expectedQty:10,quantity:8},{itemId:'variant:sheet',expectedQty:5,quantity,expectedIdentity:'old'}]};
  assert.throws(()=>post(store,body,counter),error=>error.status===409&&/captured automatically/.test(error.message));assert.equal(snapshot(store),before);
 }
});

test('open legacy manual-panel sessions project only manual progress and complete from fresh whole SOH',()=>{
 const oldEntry={quantity:99,expectedQty:5,item:{name:'Old manually entered panel',width:1,height:1},user:'old-counter',at:'2026-10-31T00:00:00Z'};
 const oldCount={id:'legacy',name:'Legacy open',categories:['panels','fixings'],itemIds:['fixing','variant:sheet','variant:deleted'],counts:{'variant:sheet':oldEntry},status:'open',createdBy:'admin'},store=storeFor(state({stocktakes:[oldCount]}));
 const stored=snapshot(store),view=workshopView(store).stocktakes[0];assert.deepEqual(view.itemIds,['fixing']);assert.deepEqual(view.counts,{});assert.equal(view.includePanels,true);assert.equal(snapshot(store),stored,'GET projection performs no migration writes');
 const done=submit(store,oldCount.id,[{itemId:'fixing',expectedQty:10,quantity:9}]).body.stocktakes[0],persisted=store.read('workshop-stock').stocktakes[0];assert.equal(done.status,'completed');assert.deepEqual(done.itemIds,['fixing']);assert.deepEqual(persisted.counts['variant:sheet'],oldEntry,'old submitted evidence is retained for audit');assert.equal(done.report.rows.filter(row=>row.itemId==='variant:sheet').length,1);assert.equal(done.report.rows.find(row=>row.itemId==='variant:sheet').quantity,5);assert.ok(!done.report.rows.some(row=>row.itemId==='variant:deleted'));
 const panelOnly=storeFor(state({items:[],stocktakes:[{...oldCount,id:'panel-only',itemIds:['variant:deleted'],counts:{}}]}),{'app:variants':[]});const empty=submit(panelOnly,'panel-only',[]).body.stocktakes[0];assert.equal(empty.status,'completed');assert.deepEqual(empty.report.panelSnapshot.itemIds,[]);
});

test('CNC held sheets never block an automatic SOH snapshot and SOH purchase-order field shapes stay stable',()=>{
 const cncPanels=Array.from({length:8},(_,index)=>({status:index?'scheduled':undefined,stockVariantId:'sheet',sheetNumber:String(index)})),store=storeFor(state(),{'app:variants':[panel('sheet',{qty:1})],'app:cncPanels':cncPanels}),before=workshopView(store).items.find(row=>row.id==='variant:sheet');
 assert.equal(before.reserved,8);assert.equal(before.available,-7);assert.equal(Object.hasOwn(before,'dimensions'),false);assert.equal(Object.hasOwn(before,'colour'),false);assert.equal(Object.hasOwn(before,'stocktakeIdentity'),false);assert.equal(Object.hasOwn(before,'countedThisMonth'),false);
 const count=create(store),done=submit(store,count.id,[{itemId:'fixing',expectedQty:10,quantity:10}]).body.stocktakes[0];assert.equal(done.report.rows.find(row=>row.itemId==='variant:sheet').quantity,1);assert.deepEqual(store.read('app:cncPanels'),cncPanels);assert.equal(store.read('app:variants')[0].qty,1);
});

test('completion freezes manual pack prices, absent prices and authoritative zero catalogue rates',()=>{
 for(const rate of [undefined,0]){
  const current=state({items:[]});current.metadata['variant:sheet']={costBasis:'pack',packCost:120,packSize:3,unitCost:999,xeroGroup:'materials'};
  const trusted=context({catalog:rate===undefined?[]:catalogue(rate),variants:[panel(),panel('unpriced')]}),created=applyWorkshop(current,{action:'stocktake_create',name:'Panel pricing',categories:[]},admin,defaultStocktakeSettings(),trusted).next;
  const done=applyWorkshop(created,{action:'stocktake_batch',stocktakeId:created.stocktakes[0].id,counts:[]},counter,defaultStocktakeSettings(),trusted).next.stocktakes[0],row=done.report.rows[0];
  if(rate===0){assert.equal(row.costBasis,'catalogue-area');assert.equal(row.catalogueCost.ratePerM2,0);}else{assert.equal(row.costBasis,'pack');assert.equal(row.packCost,120);assert.equal(row.packSize,3);assert.equal(done.report.rows[1].unitCost,null);assert.equal(done.report.rows[1].catalogueCost,null);}
 }
});

test('snapshot provenance is bounded and never introduces panels into manual monthly eligibility',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-08T01:00:00Z')});
 const current=state({items:[]});current.metadata['variant:sheet'].image='private image';const store=storeFor(current),count=create(store,{categories:[],uncountedThisMonth:true,stocktakeMonth:'2026-11'}),done=submit(store,count.id,[]).body.stocktakes[0];
 const row=done.report.rows[0];for(const key of ['image','reservations','reserved','available','incomingOrders'])assert.equal(Object.hasOwn(row,key),false);assert.ok(!JSON.stringify(done.report).includes('private image'));assert.equal(Object.keys(done.counts).length,0);
 assert.equal(Object.hasOwn(workshopView(store).items.find(row=>row.id==='variant:sheet'),'countedThisMonth'),false);assert.equal(done.stocktakeMonth,'2026-11');assert.deepEqual(create(store,{categories:[],uncountedThisMonth:true,stocktakeMonth:'2026-11'}).itemIds,[]);
});

test('completed legacy reports and read-only old fallbacks are never backfilled with current panels',()=>{
 const report={version:2,name:'Saved',categories:['fixings'],rows:[{itemId:'fixing',quantity:1,unitCost:1,pricingCapturedAt:'2026-10-01T00:00:00Z'}]},count={id:'old',name:'Old',status:'completed',categories:['fixings'],itemIds:['fixing'],counts:{fixing:{quantity:1,expectedQty:10}},completedAt:'2026-10-01T00:00:00Z',report},store=storeFor(state({stocktakes:[count]}));
 const before=snapshot(store),view=workshopView(store);assert.deepEqual(view.stocktakes[0].report,report);assert.equal(view.stocktakes[0].report.panelSnapshot,undefined);assert.equal(snapshot(store),before);
 const fallback=storeFor(state({stocktakes:[{...count,report:undefined}]})),legacy=workshopView(fallback).stocktakes[0].report;assert.equal(legacy.version,1);assert.deepEqual(legacy.rows.map(row=>row.itemId),['fixing']);assert.equal(legacy.panelSnapshot,undefined);
});

test('permission, malformed entries, stale manual quantities and reservation failures remain atomic',()=>{
 const store=storeFor(state({items:[stock(),stock('reserved',{reservations:{Job:3}})]}));
 assert.throws(()=>post(store,{action:'stocktake_create',name:'Denied',categories:[]},counter),error=>error.status===403);assert.throws(()=>handleWorkshop(store,'GET',{},{}),error=>error.status===403);
 const count=create(store),before=snapshot(store);
 for(const entry of [null,undefined,[],true,'fixing']){assert.throws(()=>submit(store,count.id,[entry]),error=>error.status===400&&/valid stocktake item/.test(error.message));assert.equal(snapshot(store),before);}
 for(const counts of [[{itemId:'fixing',expectedQty:9,quantity:8}],[{itemId:'fixing',expectedQty:10,quantity:8},{itemId:'reserved',expectedQty:10,quantity:2}],[{itemId:'fixing',expectedQty:10,quantity:8},{itemId:'fixing',expectedQty:10,quantity:8}]]){assert.throws(()=>submit(store,count.id,counts));assert.equal(snapshot(store),before);assert.equal(store.read('workshop-stock').stocktakes[0].report,undefined);}
 assert.throws(()=>post(store,{action:'stocktake_batch',stocktakeId:count.id,counts:[]},{username:'outsider'}),error=>error.status===403);assert.equal(snapshot(store),before);
});

test('completion snapshot is immutable across current stock edits, GETs and exact mutation retries',()=>{
 const store=storeFor(),count=create(store),body={action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'fixing',expectedQty:10,quantity:8}],expectedRevision:store.read('workshop-stock').revision,mutationId:randomUUID()};
 const done=handleWorkshop(store,'POST',body,counter).body.stocktakes[0],frozen=structuredClone(done.report),beforeGlobal=store.read('revision'),writes=store.writes;
 store.documents.set('app:variants',[panel('different',{qty:99,width:4000,height:2000})]);store.documents.set('app:catalog',catalogue(999));store.documents.set('stocktake-settings',{...defaultStocktakeSettings(),revision:99});
 assert.deepEqual(workshopView(store).stocktakes[0].report,frozen);const retry=handleWorkshop(store,'POST',body,counter);assert.equal(retry.body.duplicate,true);assert.deepEqual(retry.body.stocktakes[0].report,frozen);assert.equal(store.writes,writes);assert.equal(store.read('revision'),beforeGlobal);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,counts:[{itemId:'fixing',expectedQty:10,quantity:7}]},counter),error=>error.status===409&&/reused/.test(error.message));assert.throws(()=>handleWorkshop(store,'POST',{...body,mutationId:randomUUID()},counter),error=>error.status===409&&/changed/.test(error.message));
});

test('storage failure rolls back manual stock, completion snapshot, mutation and revision together',()=>{
 const store=storeFor(),count=create(store),before=snapshot(store),write=store.write;let fail=true;
 store.write=(key,value)=>{if(fail&&key==='app:transactions'){fail=false;throw Error('Storage unavailable');}return write(key,value);};
 const body={action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'fixing',expectedQty:10,quantity:8}],expectedRevision:store.read('workshop-stock').revision,mutationId:randomUUID()};assert.throws(()=>handleWorkshop(store,'POST',body,counter),/Storage unavailable/);assert.equal(snapshot(store),before);
 assert.equal(handleWorkshop(store,'POST',body,counter).body.stocktakes[0].status,'completed');assert.equal(store.read('app:variants')[0].qty,5);
});

test('authenticated SQLite API snapshots completion SOH without panel writes or recount ledgers and retries a lost response',async()=>{
 const bundle=process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url);
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'stocktake-panels',modules:true,script:fs.readFileSync(bundle,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'stocktake-panels',MIGRATION_READY:'true',ALLOWED_ORIGINS:'https://app.panelstockhq.com,https://web.panelstockhq.com'}}]}));
 const origin='https://app.panelstockhq.com';let token;
 const raw=(path,body,auth=token)=>mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const request=async(path,body,auth=token)=>{const response=await raw(path,body,auth);return {status:response.status,body:await response.json(),headers:response.headers};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),pinHash=user=>createHash('sha256').update('123456:'+user+':panelstock').digest('hex');
  await kv.put('users',JSON.stringify(Object.fromEntries(['admin','counter','denied'].map(user=>[user,{isAdmin:user==='admin',pinHash:pinHash(user)}]))));
  await kv.put('app:variants',JSON.stringify([panel()]));await kv.put('app:offcuts',JSON.stringify([panel('cut',{width:500,height:400,qty:2})]));await kv.put('app:catalog',JSON.stringify(catalogue()));
  await kv.put('app:cncPanels',JSON.stringify(Array.from({length:8},(_,index)=>({id:'cnc-'+index,stockVariantId:'sheet',stockSku:'SHEET-sheet',sheetNumber:String(index),status:'pending',orderNumber:'1',panelNumber:'A'}))));
  assert.equal((await request('/workshop-stock',undefined,'')).status,401);token=(await request('/login',{username:'admin',pin:'123456'},'')).body.token;assert.ok(token);
  const counterToken=(await request('/login',{username:'counter',pin:'123456'},'')).body.token;assert.equal((await request('/admin/set-task-access',{targetUsername:'denied',taskCode:'factory.stock',allowed:false})).status,200);const deniedToken=(await request('/login',{username:'denied',pin:'123456'},'')).body.token;
  assert.equal((await request('/workshop-stock',undefined,deniedToken)).status,403);
  let result=await request('/workshop-stock',{action:'create',item:{name:'Fixings',category:'fixings',unit:'each',qty:10,unitCost:2},expectedRevision:0,mutationId:randomUUID()});assert.equal(result.status,200,result.body.error);const workshopId=result.body.items.find(row=>!row.legacy).id;
  const setup={action:'stocktake_create',name:'SQLite snapshot',categories:['fixings'],expectedRevision:1,mutationId:randomUUID()};assert.equal((await request('/workshop-stock',setup,counterToken)).status,403);result=await request('/workshop-stock',setup);assert.equal(result.status,200,result.body.error);const count=result.body.stocktakes[0];assert.deepEqual(count.itemIds,[workshopId]);assert.equal(count.includePanels,true);
  const current=(await request('/data')).body,updated={...current.variants[0],qty:3,width:3000,height:1500},now=new Date().toISOString();
  result=await request('/mutations',{mutationId:randomUUID(),restoreEpoch:current.restoreEpoch,changes:[{field:'variants',id:updated.id,before:current.variants[0],after:updated},{field:'transactions',id:'external-adjustment',before:null,after:{id:'external-adjustment',type:'adjustment',desc:'Existing admin inventory correction',qty:2,timestamp:now,user:'admin'}}]});assert.equal(result.status,200,result.body.error);
  const initial=(await request('/data')).body,invalid={action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:workshopId,expectedQty:10,quantity:8},{itemId:'variant:sheet',expectedQty:3,quantity:0}],expectedRevision:2,mutationId:randomUUID()};assert.equal((await request('/workshop-stock',invalid,counterToken)).status,409);assert.deepEqual((await request('/data')).body.variants,initial.variants);assert.equal((await request('/data')).body.revision,initial.revision);
  const body={...invalid,mutationId:randomUUID(),counts:[{itemId:workshopId,expectedQty:10,quantity:8}]},lost=await raw('/workshop-stock',body,counterToken);assert.equal(lost.status,200);await lost.body.cancel();result=await request('/workshop-stock',body,counterToken);assert.equal(result.status,200,result.body.error);assert.equal(result.body.duplicate,true);assert.equal(result.headers.get('Access-Control-Allow-Origin'),origin);
  const saved=(await request('/data')).body,done=result.body.stocktakes[0],row=done.report.rows.find(row=>row.itemId==='variant:sheet');assert.deepEqual(saved.variants,initial.variants);assert.deepEqual(saved.offcuts,initial.offcuts);assert.deepEqual(saved.cncPanels,initial.cncPanels);assert.equal(saved.transactions.length,initial.transactions.length+1);assert.equal(saved.revision,initial.revision+1);assert.equal(row.quantity,3);assert.equal(row.width,3000);assert.equal(row.quantitySource,'soh-snapshot');assert.equal(row.expectedQty,null);assert.equal(row.variance,null);assert.equal(row.catalogueCost.ratePerM2,20);assert.equal(Object.hasOwn(done.counts,'variant:sheet'),false);
  assert.equal((await request('/workshop-stock',{...body,mutationId:randomUUID()},counterToken)).status,409);
  result=await request('/workshop-stock',{action:'stocktake_create',name:'Only panels',categories:[],expectedRevision:3,mutationId:randomUUID()});assert.equal(result.status,200,result.body.error);const only=result.body.stocktakes[0];const beforeEmpty=(await request('/data')).body;
  result=await request('/workshop-stock',{action:'stocktake_batch',stocktakeId:only.id,counts:[],expectedRevision:4,mutationId:randomUUID()},counterToken);assert.equal(result.status,200,result.body.error);assert.equal(result.body.stocktakes[0].status,'completed');assert.deepEqual((await request('/data')).body.variants,beforeEmpty.variants);assert.deepEqual((await request('/data')).body.transactions,beforeEmpty.transactions);
 }finally{await mf.dispose();}
});

