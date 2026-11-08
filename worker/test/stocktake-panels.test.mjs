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

test('panel scope comes from trusted variants, uses shared supplier and excludes legacy offcuts and archived rows',()=>{
 const current=state({items:[stock(),stock('archived',{archivedAt:'2026-10-01'}),stock('bad-copy',{category:'panels'})]}),trusted=context({variants:[panel(),panel('other'),panel('archived',{archivedAt:'2026-10-01'})]});
 current.metadata['variant:other']={supplier:'Supplier B'};
 const original=JSON.stringify({current,trusted});
 const input={action:'stocktake_create',name:'Supplier panels',categories:['panels','fixings'],supplier:' Supplier A ',variants:[panel('forged')],items:[panel('forged')]};
 const result=applyWorkshop(current,input,admin,defaultStocktakeSettings(),trusted);
 assert.deepEqual(result.next.stocktakes[0].itemIds,['fixing','variant:sheet']);assert.equal(result.next.stocktakes[0].supplier,'Supplier A');
 assert.ok(!result.next.stocktakes[0].itemIds.includes('offcut:cut'));assert.equal(JSON.stringify({current,trusted}),original);
 const only=applyWorkshop(current,{...input,categories:['panels'],supplier:''},admin,defaultStocktakeSettings(),trusted).next.stocktakes[0];assert.deepEqual(only.itemIds,['variant:sheet','variant:other']);
 assert.throws(()=>applyWorkshop(current,{...input,categories:['panels']},admin),/No stock items/);
 assert.throws(()=>applyWorkshop(current,{...input,categories:['missing']},admin,defaultStocktakeSettings(),trusted),/valid stock categories/);
});

test('mixed panel and workshop counts update raw panels only and preserve exact submitted identities and signed movements',()=>{
 const current=state(),trusted=context(),original=JSON.stringify({current,trusted});
 const created=applyWorkshop(current,{action:'stocktake_create',name:'Mixed',categories:['panels','fixings']},admin,defaultStocktakeSettings(),trusted).next,id=created.stocktakes[0].id;
 const result=applyWorkshop(created,{action:'stocktake_batch',stocktakeId:id,counts:[{itemId:'fixing',expectedQty:10,quantity:9.125},{itemId:'variant:sheet',expectedQty:5,quantity:'3',item:{name:'Forged',width:1},reserved:0}]},counter,defaultStocktakeSettings(),trusted);
 assert.equal(result.next.items.length,1);assert.equal(result.next.items[0].qty,9.125);assert.equal(result.panelVariants[0].qty,3);
 assert.deepEqual({...result.panelVariants[0],qty:5},trusted.variants[0]);assert.equal(JSON.stringify({current,trusted}),original);
 const count=result.next.stocktakes[0],entry=count.counts['variant:sheet'];assert.equal(count.status,'completed');assert.equal(entry.quantity,3);assert.equal(entry.expectedQty,5);
 assert.deepEqual(Object.fromEntries(['catalogId','color','material','thickness','width','height','sku'].map(key=>[key,entry.item[key]])),Object.fromEntries(['catalogId','color','material','thickness','width','height','sku'].map(key=>[key,trusted.variants[0][key]])));
 assert.equal(entry.item.name,'Named full panel');assert.equal(entry.item.category,'panels');assert.equal(entry.item.unit,'sheets');assert.equal(entry.item.supplier,'Supplier A');assert.equal(entry.item.location,'Panel rack');assert.equal(entry.item.dimensions,'2400 × 1200 mm');
 assert.deepEqual(result.movements.map(row=>[row.itemId,row.quantity,row.action,row.stocktakeId]),[['fixing',-.875,'stocktake',id],['variant:sheet',-2,'stocktake',id]]);assert.equal(result.next.revision,created.revision+1);
});

test('SOH panel fields preserve existing purchase-order identities while count snapshots derive sheet details',()=>{
 const store=storeFor(),before=workshopView(store).items.find(row=>row.id==='variant:sheet');
 assert.equal(Object.hasOwn(before,'dimensions'),false);assert.equal(Object.hasOwn(before,'colour'),false);assert.equal(before.color,'White');assert.equal(before.width,2400);assert.equal(before.height,1200);
 const count=create(store,{categories:['panels']}),result=submit(store,count.id,[{itemId:before.id,expectedQty:5,quantity:5}]).body,after=result.items.find(row=>row.id===before.id),identity=result.stocktakes[0].counts[before.id].item;
 assert.equal(Object.hasOwn(after,'dimensions'),false);assert.equal(Object.hasOwn(after,'colour'),false);assert.equal(identity.dimensions,'2400 × 1200 mm');assert.equal(identity.colour,'White');
 const current=store.read('workshop-stock');Object.assign(current.metadata[before.id],{dimensions:'Existing metadata dimensions',colour:'Existing metadata colour'});store.documents.set('workshop-stock',current);
 const metadataView=workshopView(store).items.find(row=>row.id===before.id);assert.equal(metadataView.dimensions,'Existing metadata dimensions');assert.equal(metadataView.colour,'Existing metadata colour');
});

test('partial panel submissions share progress; final counts freeze completion catalogue prices and COS settings',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-08T01:00:00Z')});
 const store=storeFor(),count=create(store),submitted=submit(store,count.id,[{itemId:'variant:sheet',expectedQty:5,quantity:4}]).body.stocktakes[0];
 assert.equal(submitted.status,'open');assert.equal(submitted.report,undefined);assert.equal(store.read('app:variants')[0].qty,4);assert.equal(store.read('workshop-stock').items.length,1);
 // A later panel resize and price change must use counted geometry at completion.
 store.documents.set('app:variants',[panel('sheet',{width:3000,height:1500,qty:4})]);store.documents.set('app:catalog',catalogue(25));
 const settings=defaultStocktakeSettings();settings.revision=2;settings.cosGroups.find(group=>group.id==='cladding').accountCode='00500';store.documents.set('stocktake-settings',settings);
 t.mock.timers.setTime(Date.parse('2026-11-09T02:00:00Z'));
 const completed=submit(store,count.id,[{itemId:'fixing',expectedQty:10,quantity:10}]).body.stocktakes[0],report=completed.report,row=report.rows.find(row=>row.itemId==='variant:sheet');
 assert.equal(completed.status,'completed');assert.equal(report.version,2);assert.equal(report.pricingCapturedAt,'2026-11-09T02:00:00.000Z');assert.equal(row.at,'2026-11-08T01:00:00.000Z');assert.equal(row.quantity,4);assert.equal(row.expectedQty,5);assert.equal(row.variance,-1);
 assert.equal(row.costBasis,'catalogue-area');assert.equal(row.catalogueCost.ratePerM2,25);assert.equal(row.catalogueCost.width,2400);assert.equal(row.catalogueCost.height,1200);assert.equal(row.width,2400);assert.equal(row.height,1200);assert.equal(row.details,'Protect film');assert.equal(row.xeroAccountCode,'00500');assert.equal(row.xeroGroup,'cladding');assert.deepEqual(report.stocktakeSettings,settings);
 const frozen=structuredClone(report);store.documents.set('app:catalog',catalogue(99));store.documents.set('stocktake-settings',defaultStocktakeSettings());assert.deepEqual(workshopView(store).stocktakes[0].report,frozen);
});

test('panel counts retain manual pack pricing and explicit zero catalogue prices at completion',()=>{
 for(const rate of [undefined,0]){
  const current=state({items:[]});current.metadata['variant:sheet']={costBasis:'pack',packCost:120,packSize:3,unitCost:999,xeroGroup:'materials'};
  const trusted=context({catalog:rate===undefined?[]:catalogue(rate)}),created=applyWorkshop(current,{action:'stocktake_create',name:'Panel prices',categories:['panels']},admin,defaultStocktakeSettings(),trusted).next;
  const result=applyWorkshop(created,{action:'stocktake_batch',stocktakeId:created.stocktakes[0].id,counts:[{itemId:'variant:sheet',expectedQty:5,quantity:0}]},counter,defaultStocktakeSettings(),trusted),row=result.next.stocktakes[0].report.rows[0];
  assert.equal(row.quantity,0);assert.equal(row.pricingCapturedAt,result.next.stocktakes[0].completedAt);
  if(rate===0){assert.equal(row.costBasis,'catalogue-area');assert.equal(row.catalogueCost.ratePerM2,0);}else{assert.equal(row.costBasis,'pack');assert.equal(row.packCost,120);assert.equal(row.packSize,3);assert.equal(row.catalogueCost,null);}
 }
});

test('panel counts validate whole sheets and inventory bounds atomically, retaining zero and numeric strings',()=>{
 for(const quantity of [-1,.5,10000001,NaN,Infinity,null,undefined,'',' ',true,{},'2.001']){
  const current=state(),trusted=context(),before=JSON.stringify({current,trusted});
  assert.throws(()=>applyWorkshop(current,{action:'stocktake_batch',reason:'Count',counts:[{itemId:'fixing',expectedQty:10,quantity:9},{itemId:'variant:sheet',expectedQty:5,quantity}]},counter,defaultStocktakeSettings(),trusted),/whole sheets/);assert.equal(JSON.stringify({current,trusted}),before);
 }
 for(const quantity of [0,'0',10000000,'2'])assert.equal(applyWorkshop(state(),{action:'stocktake_batch',reason:'Count',counts:[{itemId:'variant:sheet',expectedQty:5,quantity}]},counter,defaultStocktakeSettings(),context()).panelVariants[0].qty,Number(quantity));
});

test('CNC holds deduplicate normalized physical sheets, include legacy stock IDs and exclude completed panels',()=>{
 const base={status:'pending',jobReference:' project ',orderNumber:'Order 7',sheetNumber:'1',stockItemId:'sheet',stockItemType:'variant'};
 const cncPanels=[{...base,id:'a',panelNumber:'A'},{...base,id:'b',jobReference:'Project',orderNumber:'7',panelNumber:'B'},
  {...base,id:'legacy',stockItemId:undefined,stockItemType:undefined,stockVariantId:'sheet',sheetNumber:'2'},
  {...base,id:'done',status:'completed',sheetNumber:'3'},{...base,id:'other-type',stockItemType:'offcut',sheetNumber:'4'},
  {...base,id:'other-stock',stockItemId:'other',sheetNumber:'5'}];
 const store=storeFor(state(),{'app:cncPanels':cncPanels}),view=workshopView(store),row=view.items.find(row=>row.id==='variant:sheet');assert.equal(row.reserved,2);assert.equal(row.available,3);
 const count=create(store,{categories:['panels']}),before=snapshot(store);assert.throws(()=>submit(store,count.id,[{itemId:row.id,expectedQty:5,quantity:1,reserved:0}]),error=>error.status===409&&/reserved/.test(error.message));assert.equal(snapshot(store),before);
 submit(store,count.id,[{itemId:row.id,expectedQty:5,quantity:2}]);assert.equal(store.read('app:variants')[0].qty,2);assert.deepEqual(store.read('app:cncPanels'),cncPanels);
});

test('legacy scheduled and unset CNC statuses remain reserved in both SOH and panel counting',()=>{
 const base={jobReference:'Legacy job',orderNumber:'7',stockItemId:'sheet',stockItemType:'variant'};
 const cncPanels=[{...base,sheetNumber:'1',status:'scheduled'},{...base,sheetNumber:'1',status:'scheduled',panelNumber:'B'},{...base,sheetNumber:'2'},{...base,sheetNumber:'3',status:'completed'}];
 const store=storeFor(state(),{'app:cncPanels':cncPanels}),row=workshopView(store).items.find(row=>row.id==='variant:sheet');assert.equal(row.reserved,2);assert.equal(row.available,3);
 const count=create(store,{categories:['panels']}),before=snapshot(store);assert.throws(()=>submit(store,count.id,[{itemId:row.id,expectedQty:5,quantity:1}]),error=>error.status===409&&/reserved/.test(error.message));assert.equal(snapshot(store),before);
 submit(store,count.id,[{itemId:row.id,expectedQty:5,quantity:2}]);assert.equal(store.read('app:variants')[0].qty,2);
});

test('panel quantities and optional raw identity leases reject concurrent inventory edits before any writes',()=>{
 for(const patch of [{qty:6},{width:3000},{material:'Solid Aluminium'},{sku:'NEW-SKU'}]){
  const store=storeFor(),count=create(store),row=workshopView(store).items.find(row=>row.id==='variant:sheet');store.documents.set('app:variants',[panel('sheet',patch)]);
  const before=snapshot(store),writes=store.writes;
  assert.throws(()=>submit(store,count.id,[{itemId:'fixing',expectedQty:10,quantity:9},{itemId:row.id,expectedQty:5,quantity:3,expectedIdentity:row.stocktakeIdentity}]),error=>error.status===409&&/changed/.test(error.message));assert.equal(snapshot(store),before);assert.equal(store.writes,writes);
 }
 const store=storeFor(),count=create(store,{categories:['panels']});store.documents.set('app:variants',[panel('sheet',{width:3000})]);submit(store,count.id,[{itemId:'variant:sheet',expectedQty:5,quantity:3}]);assert.equal(store.read('workshop-stock').stocktakes[0].counts['variant:sheet'].item.width,3000,'omitted identity remains compatible and snapshots at submission');
});

test('panel batches reject removed, archived, out-of-scope, duplicate and already submitted items atomically',()=>{
 for(const variantList of [[],[panel('sheet',{archivedAt:'2026-11-08'})]]){
  const store=storeFor(),count=create(store);store.documents.set('app:variants',variantList);const before=snapshot(store);
  assert.throws(()=>submit(store,count.id,[{itemId:'fixing',expectedQty:10,quantity:9},{itemId:'variant:sheet',expectedQty:5,quantity:3}]),error=>error.status===409&&/no longer exists/.test(error.message));assert.equal(snapshot(store),before);
 }
 const store=storeFor(),count=create(store),entry={itemId:'variant:sheet',expectedQty:5,quantity:5},before=snapshot(store);
 assert.throws(()=>submit(store,count.id,[entry,entry]),/Duplicate/);assert.equal(snapshot(store),before);
 assert.throws(()=>submit(store,count.id,[{itemId:'offcut:cut',expectedQty:2,quantity:1}]),/outside/);assert.equal(snapshot(store),before);
 submit(store,count.id,[entry]);assert.throws(()=>submit(store,count.id,[entry]),error=>error.status===409&&/already counted/.test(error.message));
});

test('malformed batch entries return validation errors without touching panel or workshop stock',()=>{
 for(const entry of [null,undefined,[],true,'variant:sheet']){
  const store=storeFor(),count=create(store),before=snapshot(store);
  assert.throws(()=>submit(store,count.id,[entry]),error=>error.status===400&&/valid stocktake item/.test(error.message));assert.equal(snapshot(store),before);
 }
});

test('panel membership, prices and reservations cannot be supplied by a client; permissions remain unchanged',()=>{
 const store=storeFor(),body={action:'stocktake_create',name:'Panels',categories:['panels'],reportContext:context({variants:[panel('forged')]}),variants:[panel('forged')]};
 assert.throws(()=>post(store,body,counter),error=>error.status===403);assert.throws(()=>handleWorkshop(store,'GET',{},{}),error=>error.status===403);
 const count=create(store,{...body});assert.deepEqual(count.itemIds,['variant:sheet']);
 const result=post(store,{action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'variant:sheet',expectedQty:5,quantity:3,item:{width:1,color:'Forged',unitCost:999}}],reportContext:context({catalog:catalogue(999)}),stocktakeSettings:{cosGroups:[]}},counter).body;
 const row=result.stocktakes[0].report.rows[0];assert.equal(row.width,2400);assert.equal(row.catalogueCost.ratePerM2,20);assert.equal(row.xeroAccountCode,'51050');
 const denied=storeFor();assert.throws(()=>post(denied,{action:'stocktake_batch',reason:'Count',counts:[{itemId:'variant:sheet',expectedQty:5,quantity:3}]},{username:'no-stock',tasks:{'factory.dispatch':true}}),error=>error.status===403);assert.equal(denied.writes,0);
});

test('mixed stock, history, mutation and revision commit together; exact completed retries add no duplicate movement',()=>{
 const store=storeFor(),count=create(store),beforeGlobal=store.read('revision'),beforeWorkshop=store.read('workshop-stock').revision;
 const body={action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'variant:sheet',expectedQty:5,quantity:0},{itemId:'fixing',expectedQty:10,quantity:10}],mutationId:randomUUID(),expectedRevision:beforeWorkshop};
 const result=handleWorkshop(store,'POST',body,counter),frozen=structuredClone(result.body.stocktakes[0].report),writes=store.writes;
 assert.equal(result.body.revision,beforeWorkshop+1);assert.equal(store.read('revision'),beforeGlobal+1);assert.equal(store.read('app:transactions').length,3);assert.equal(store.read('app:variants')[0].qty,0);assert.equal(store.read('workshop-stock').items[0].qty,10);
 assert.deepEqual(store.audits.slice(-2).map(([,action,entry])=>[action,entry.itemId,entry.quantity]),[['workshop-stock','variant:sheet',-5],['workshop-stock','fixing',0]]);
 const retry=handleWorkshop(store,'POST',body,counter);assert.equal(retry.body.duplicate,true);assert.equal(store.writes,writes);assert.deepEqual(retry.body.stocktakes[0].report,frozen);assert.equal(store.read('app:transactions').length,3);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,counts:[{...body.counts[0],quantity:1}]},counter),error=>error.status===409&&/reused/.test(error.message));
 assert.throws(()=>handleWorkshop(store,'POST',body,{...counter,username:'other'}),error=>error.status===409&&/reused/.test(error.message));
 assert.throws(()=>handleWorkshop(store,'POST',{...body,mutationId:randomUUID()},counter),error=>error.status===409&&/changed/.test(error.message));
});

test('new panel zero counts immediately affect monthly eligibility; scope leases and omitted filters remain compatible',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-08T01:00:00Z')});
 const store=storeFor(state(),{'app:variants':[panel(),panel('unsubmitted',{qty:0}),panel('older',{qty:1})]}),now=stocktakeMonth();
 store.documents.get('workshop-stock').movements.push({action:'stocktake',itemId:'variant:older',quantity:0,at:'2026-10-31T13:59:59.999Z'});
 const count=create(store,{categories:['panels']});submit(store,count.id,[{itemId:'variant:sheet',expectedQty:5,quantity:0}]);
 const current=store.read('workshop-stock'),view=workshopView(store);assert.equal(view.items.find(row=>row.id==='variant:sheet').countedThisMonth,true);assert.equal(view.items.find(row=>row.id==='variant:unsubmitted').countedThisMonth,false);assert.ok(countedStockItemsThisMonth(current,now).has('variant:sheet'));
 const filtered=create(store,{categories:['panels'],uncountedThisMonth:true,stocktakeMonth:now.key});assert.deepEqual(filtered.itemIds,['variant:unsubmitted','variant:older']);assert.equal(filtered.uncountedThisMonth,true);assert.equal(filtered.stocktakeMonth,now.key);
 assert.ok(create(store,{categories:['panels'],uncountedThisMonth:false}).itemIds.includes('variant:sheet'));
 assert.throws(()=>create(store,{categories:['panels'],uncountedThisMonth:true,stocktakeMonth:'2026-10'}),error=>error.status===409&&/month changed/.test(error.message));
 assert.equal(view.items.find(row=>row.id==='offcut:cut').countedThisMonth,undefined);
});

test('panel raw data, progress and history roll back if transaction persistence fails',()=>{
 const store=storeFor(),count=create(store),before=snapshot(store),write=store.write;let fail=true;
 store.write=(key,value)=>{if(fail&&key==='app:transactions'){fail=false;throw Error('Storage unavailable');}return write(key,value);};
 const body={action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'variant:sheet',expectedQty:5,quantity:2},{itemId:'fixing',expectedQty:10,quantity:8}],expectedRevision:store.read('workshop-stock').revision,mutationId:randomUUID()};
 assert.throws(()=>handleWorkshop(store,'POST',body,counter),/Storage unavailable/);assert.equal(snapshot(store),before);const broadcasts=store.broadcasts.length;
 assert.equal(handleWorkshop(store,'POST',body,counter).status,200);assert.equal(store.read('app:variants')[0].qty,2);assert.equal(store.broadcasts.length,broadcasts+1);
});

test('authenticated SQLite API commits mixed panel counts atomically and retries after a lost response',async()=>{
 const bundle=process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url);
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'stocktake-panels',modules:true,script:fs.readFileSync(bundle,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'stocktake-panels',MIGRATION_READY:'true',ALLOWED_ORIGINS:'https://app.panelstockhq.com,https://web.panelstockhq.com'}}]}));
 const origin='https://app.panelstockhq.com';let token;
 const raw=(path,body,auth=token)=>mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const request=async(path,body,auth=token)=>{const response=await raw(path,body,auth);return {status:response.status,body:await response.json(),headers:response.headers};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),pinHash=user=>createHash('sha256').update('123456:'+user+':panelstock').digest('hex');
  await kv.put('users',JSON.stringify(Object.fromEntries(['admin','counter','denied'].map(user=>[user,{isAdmin:user==='admin',pinHash:pinHash(user)}]))));
  await kv.put('app:variants',JSON.stringify([panel()]));await kv.put('app:offcuts',JSON.stringify([panel('cut',{width:500,height:400,qty:2})]));await kv.put('app:catalog',JSON.stringify(catalogue()));
  assert.equal((await request('/workshop-stock',undefined,'')).status,401);
  token=(await request('/login',{username:'admin',pin:'123456'},'')).body.token;assert.ok(token);
  const counterToken=(await request('/login',{username:'counter',pin:'123456'},'')).body.token;
  assert.equal((await request('/admin/set-task-access',{targetUsername:'denied',taskCode:'factory.stock',allowed:false})).status,200);
  const deniedToken=(await request('/login',{username:'denied',pin:'123456'},'')).body.token;assert.equal((await request('/workshop-stock',undefined,deniedToken)).status,403);
  let result=await request('/workshop-stock',{action:'create',item:{name:'Fixings',category:'fixings',unit:'each',qty:10,unitCost:2},expectedRevision:0,mutationId:randomUUID()});assert.equal(result.status,200,result.body.error);const workshopId=result.body.items.find(row=>!row.legacy).id;
  const setup={action:'stocktake_create',name:'SQLite mixed',categories:['panels','fixings'],expectedRevision:1,mutationId:randomUUID()};assert.equal((await request('/workshop-stock',setup,counterToken)).status,403);
  result=await request('/workshop-stock',setup);assert.equal(result.status,200,result.body.error);const count=result.body.stocktakes[0],view=result.body,panelRow=view.items.find(row=>row.id==='variant:sheet');assert.deepEqual(count.itemIds,[workshopId,'variant:sheet']);
  const initial=(await request('/data')).body,invalid={action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:workshopId,expectedQty:10,quantity:8},{itemId:'variant:sheet',expectedQty:5,quantity:.5}],expectedRevision:2,mutationId:randomUUID()};
  assert.equal((await request('/workshop-stock',invalid,counterToken)).status,400);assert.deepEqual((await request('/data')).body.variants,initial.variants);assert.equal((await request('/data')).body.revision,initial.revision);
  const body={...invalid,mutationId:randomUUID(),counts:[{itemId:workshopId,expectedQty:10,quantity:8},{itemId:'variant:sheet',expectedQty:5,expectedIdentity:panelRow.stocktakeIdentity,quantity:3}]};
  const lost=await raw('/workshop-stock',body,counterToken);assert.equal(lost.status,200);await lost.body.cancel();
  result=await request('/workshop-stock',body,counterToken);assert.equal(result.status,200,result.body.error);assert.equal(result.body.duplicate,true);assert.equal(result.body.revision,3);assert.equal(result.headers.get('Access-Control-Allow-Origin'),origin);
  const saved=(await request('/data')).body;assert.equal(saved.variants[0].qty,3);assert.equal(saved.offcuts[0].qty,2);assert.equal(saved.revision,initial.revision+1);assert.equal(saved.transactions.filter(row=>row.type==='workshop').length,4);
  const completed=result.body.stocktakes[0];assert.equal(completed.status,'completed');assert.equal(completed.counts['variant:sheet'].item.width,2400);assert.equal(completed.report.rows.find(row=>row.itemId==='variant:sheet').catalogueCost.ratePerM2,20);assert.equal(result.body.items.find(row=>row.id==='variant:sheet').countedThisMonth,true);
  assert.equal((await request('/workshop-stock',{...body,mutationId:randomUUID()},counterToken)).status,409);assert.equal((await request('/workshop-stock',{...body,counts:[{...body.counts[0],quantity:7}]},counterToken)).status,409);
  assert.equal((await request('/data')).body.revision,saved.revision);
 }finally{await mf.dispose();}
});
