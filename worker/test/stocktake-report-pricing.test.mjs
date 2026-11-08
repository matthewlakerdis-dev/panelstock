import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,handleWorkshop,stocktakeReport,workshopView} from '../src/workshop-stock.js';
import {captureStocktakeReportPricing} from '../src/stocktake-report-pricing.js';
import {defaultStocktakeSettings,handleStocktakeSettings} from '../src/stocktake-settings.js';

const admin={username:'admin',isAdmin:true},counter={username:'counter',tasks:{'factory.stock':true}};
const completedAt='2026-11-10T00:00:00.000Z';
const stock=(id,patch={})=>({id,name:'Original '+id,sku:id.toUpperCase(),category:'extrusions',colour:'Black',lengthMm:6000,dimensions:'25 x 25',location:'Rack A',supplier:'Lennox',unit:'lengths',details:'Original details '+id,qty:5,reservations:{},unitCost:10,xeroGroup:'materials',...patch});
const identity=(id,patch={})=>({name:'Counted '+id,sku:id.toUpperCase(),category:'extrusions',colour:'Black',lengthMm:6000,dimensions:'25 x 25',location:'Counted rack',supplier:'Counted supplier',unit:'lengths',details:'Counted details',...patch});
const panel=(id,patch={})=>({id,sku:id.toUpperCase(),catalogId:'white',color:'White',material:'ACP',thickness:3,width:2000,height:1000,qty:5,...patch});
const panelIdentity=(id,patch={})=>identity(id,{category:'panels',unit:'sheets',...panel(id),...patch});
const base=items=>({revision:0,items:items||[stock('a'),stock('b')],movements:[],metadata:{},categories:{extrusions:'Profiles'}});
const apply=(state,input,settings=defaultStocktakeSettings(),context={})=>applyWorkshop(state,input,admin,settings,context).next;
const create=state=>apply(state,{action:'stocktake_create',name:'November count',categories:['extrusions','fixings']});
const submit=(state,countId,ids,settings=defaultStocktakeSettings(),context={})=>apply(state,{action:'stocktake_batch',stocktakeId:countId,counts:ids.map(([itemId,quantity])=>({itemId,quantity,expectedQty:state.items.find(row=>row.id===itemId).qty}))},settings,context);
function fixture(entries,patch={},context={},settings=defaultStocktakeSettings()){
 const state={...base(entries.flatMap(entry=>entry.current?[entry.current]:[])),...patch};
 const count={id:'count',name:'Completed count',categories:['extrusions','panels','offcuts'],supplier:'',itemIds:entries.map(entry=>entry.id),status:'completed',createdBy:'admin',completedAt,counts:Object.fromEntries(entries.map(entry=>[entry.id,{quantity:entry.quantity??5,expectedQty:entry.expectedQty??5,item:entry.identity||identity(entry.id),user:'counter',at:'2026-11-09T00:00:00.000Z'}]))};
 const legacy=stocktakeReport(state,count),report=captureStocktakeReportPricing(legacy,state,count,settings,context);
 return {state,count,settings,context,legacy,report};
}
function storeFor(state=base(),extra={}){
 const documents=new Map(Object.entries({'workshop-stock':structuredClone(state),'stocktake-settings':defaultStocktakeSettings(),...extra}));
 const store={documents,writes:0,events:[],audits:[],read:(key,fallback)=>{store.events.push({type:'read',key});return structuredClone(documents.has(key)?documents.get(key):fallback);},write:(key,value)=>{store.events.push({type:'write',key});store.writes++;documents.set(key,structuredClone(value));},requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task]){const error=Error('Forbidden');error.status=403;throw error;}},ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>store.audits.push(structuredClone(args)),broadcastRevision(){}};
 return store;
}
const post=(store,input,actor=admin)=>handleWorkshop(store,'POST',{expectedRevision:store.read('workshop-stock').revision,mutationId:crypto.randomUUID(),...input},actor);

test('completion captures current prices for earlier partial submissions while preserving submitted identities',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-08T00:00:00Z')});
 let state=create(base());const id=state.stocktakes[0].id;state=apply(state,{action:'metadata',itemId:'a',unitCost:12});
 t.mock.timers.setTime(Date.parse('2026-11-09T00:00:00Z'));state=submit(state,id,[['a',4]]);assert.equal(state.stocktakes[0].report,undefined);
 state.stocktakes[0].counts.a.item.unitCost=999;state.stocktakes[0].counts.a.item.packCost=999;
 state=apply(state,{action:'metadata',itemId:'a',name:'Renamed later',details:'Changed later',unitCost:25});state=apply(state,{action:'metadata',itemId:'b',unitCost:30});
 const settings=defaultStocktakeSettings();settings.cosGroups.find(group=>group.id==='materials').label='Completion materials';settings.cosGroups.find(group=>group.id==='materials').accountCode='00555';settings.revision=2;
 t.mock.timers.setTime(Date.parse(completedAt));state=submit(state,id,[['b',3]],settings);
 const report=state.stocktakes[0].report,a=report.rows.find(row=>row.itemId==='a');
 assert.equal(report.version,2);assert.equal(report.pricingCapturedAt,completedAt);assert.deepEqual(report.pricing,{basis:'completion',label:'Prices captured at completion',capturedAt:completedAt});
 assert.deepEqual(report.rows.map(row=>row.unitCost),[25,30]);assert.equal(a.name,'Original a');assert.equal(a.details,'Original details a');assert.equal(a.quantity,4);assert.equal(a.expectedQty,5);assert.equal(a.variance,-1);assert.equal(a.at,'2026-11-09T00:00:00.000Z');
 assert.equal(a.categoryLabel,'Profiles');assert.equal(a.xeroGroupLabel,'Completion materials');assert.equal(a.xeroAccountCode,'00555');assert.ok(report.rows.every(row=>row.pricingCapturedAt===completedAt));assert.deepEqual(report.stocktakeSettings,settings);
 settings.cosGroups[0].label='Mutated caller';assert.notEqual(report.stocktakeSettings.cosGroups[0].label,'Mutated caller');
});

test('zero, cleared, missing and pack prices are explicit and never substituted from old identity snapshots',()=>{
 const entries=[{id:'zero',current:stock('zero',{unitCost:0}),quantity:0},{id:'missing',current:stock('missing',{unitCost:undefined})},{id:'cleared',current:stock('cleared',{unitCost:null})},{id:'free-pack',current:stock('free-pack',{costBasis:'pack',unitCost:99,packCost:0,packSize:10})},{id:'pack',current:stock('pack',{costBasis:'pack',unitCost:99,packCost:200,packSize:25})}].map(entry=>({...entry,identity:identity(entry.id,{unitCost:999,packCost:999,packSize:999})}));
 const {report}=fixture(entries),byId=new Map(report.rows.map(row=>[row.itemId,row]));
 assert.equal(byId.get('zero').unitCost,0);assert.equal(byId.get('zero').quantity,0);assert.equal(byId.get('missing').unitCost,null);assert.equal(byId.get('cleared').unitCost,null);
 assert.equal(byId.get('free-pack').costBasis,'pack');assert.equal(byId.get('free-pack').packCost,0);assert.equal(byId.get('free-pack').packSize,10);assert.equal(byId.get('pack').packCost,200);assert.equal(byId.get('pack').packSize,25);
 for(const row of report.rows){assert.ok(Object.hasOwn(row,'unitCost'));assert.ok(Object.hasOwn(row,'packCost'));assert.equal(row.areaCost,null);assert.equal(row.catalogueCost,null);assert.equal(row.width,null);assert.equal(row.height,null);}
});

test('saved completion prices and settings survive later edits, GETs and exact mutation retries',()=>{
 const store=storeFor();const created=post(store,{action:'stocktake_create',name:'Count',categories:['extrusions']}).body.stocktakes[0];
 post(store,{action:'stocktake_batch',stocktakeId:created.id,counts:[{itemId:'a',expectedQty:5,quantity:4}]},counter);
 post(store,{action:'bulk_metadata',itemIds:['a','b'],changes:{unitCost:20}});
 const body={action:'stocktake_batch',stocktakeId:created.id,counts:[{itemId:'b',expectedQty:5,quantity:3}],expectedRevision:store.read('workshop-stock').revision,mutationId:crypto.randomUUID()};
 const done=handleWorkshop(store,'POST',body,counter),frozen=structuredClone(done.body.stocktakes.find(row=>row.id===created.id).report);
 post(store,{action:'metadata',itemId:'a',unitCost:999,name:'New name',details:'New details',xeroGroup:'fixings'});post(store,{action:'category_save',categoryId:'extrusions',name:'Renamed category'});
 const current=store.read('stocktake-settings');handleStocktakeSettings(store,'POST',{...current,cosGroups:current.cosGroups.map(group=>({...group,label:'Changed '+group.label,accountCode:'00999'})),expectedRevision:current.revision,mutationId:crypto.randomUUID()},admin);
 const writes=store.writes,get=handleWorkshop(store,'GET',{},counter);assert.deepEqual(get.body.stocktakes.find(row=>row.id===created.id).report,frozen);assert.equal(store.writes,writes);
 const retry=handleWorkshop(store,'POST',body,counter);assert.equal(retry.body.duplicate,true);assert.deepEqual(retry.body.stocktakes.find(row=>row.id===created.id).report,frozen);assert.equal(store.writes,writes);
});

test('new submissions freeze raw geometry and details before later material relinks and resizing',()=>{
 const original=panel('a',{name:'Original a',category:'extrusions',unit:'lengths',details:'Original geometry',reservations:{},unitCost:5});
 let state=create(base([original,stock('b')]));const countId=state.stocktakes[0].id;state=submit(state,countId,[['a',4]]);
 const captured=state.stocktakes[0].counts.a.item;for(const key of ['catalogId','color','material','thickness','width','height','details'])assert.equal(captured[key],original[key]);
 Object.assign(state.items[0],{catalogId:'blue',color:'Blue',material:'Steel',thickness:6,width:4000,height:3000,details:'Later geometry'});
 const context={catalog:[{id:'white',color:'White',material:'ACP',thickness:3,unitCostPerM2:120},{id:'blue',color:'Blue',material:'Steel',thickness:6,unitCostPerM2:999}],variants:[],offcuts:[]};
 state=submit(state,countId,[['b',5]],defaultStocktakeSettings(),context);const row=state.stocktakes[0].report.rows.find(row=>row.itemId==='a');
 assert.equal(row.costBasis,'catalogue-area');assert.equal(row.width,2000);assert.equal(row.height,1000);assert.equal(row.catalogueCost.catalogId,'white');assert.equal(row.catalogueCost.ratePerM2,120);assert.equal(row.details,'Original geometry');
});

test('catalogue rates value counted full-sheet and offcut geometry without source sheets, including an authoritative zero rate',()=>{
 for(const ratePerM2 of [123.45,0]){
  const context={catalog:[{id:'white',color:'White',material:'ACP',thickness:3,unitCostPerM2:ratePerM2}],variants:[panel('sheet',{width:4000,height:3000})],offcuts:[panel('cut',{width:900,height:800})]};
  const {report}=fixture([{id:'variant:sheet',identity:panelIdentity('sheet')},{id:'offcut:cut',identity:panelIdentity('cut',{category:'offcuts',width:500,height:400})}],{metadata:{'variant:sheet':{unitCost:999,costBasis:'pack',packCost:500,packSize:5,xeroGroup:'cladding'},'offcut:cut':{unitCost:999,costBasis:'area'}}},context);
  for(const row of report.rows){assert.equal(row.costBasis,'catalogue-area');assert.equal(row.catalogueCost.ratePerM2,ratePerM2);assert.equal(row.areaCost,null);}
  assert.deepEqual(report.rows.map(row=>[row.width,row.height]),[[2000,1000],[500,400]]);assert.equal(report.rows[0].xeroAccountCode,'51050');assert.equal(report.rows[1].catalogueCost.width,500);
 }
});

test('source-area prices use current source pack pricing and the submitted offcut dimensions',()=>{
 const context={catalog:[],variants:[panel('sheet')],offcuts:[panel('cut',{width:900,height:800})]};
 const value=fixture([{id:'offcut:cut',identity:panelIdentity('cut',{category:'offcuts',width:500,height:400})}],{metadata:{'variant:sheet':{name:'Completion source',costBasis:'pack',packCost:600,packSize:3,unitCost:999},'offcut:cut':{costBasis:'area',costSourceItemId:'variant:sheet',unitCost:99}}},context);
 const row=value.report.rows[0];assert.equal(row.costBasis,'area');assert.equal(row.areaCost.sourcePackCost,600);assert.equal(row.areaCost.sourcePackSize,3);assert.equal(row.areaCost.sourceCostBasis,'pack');assert.equal(row.areaCost.ratePerM2,100);assert.equal(row.areaCost.effectiveUnitCost,20);assert.equal(row.areaCost.offcutWidth,500);assert.equal(row.areaCost.offcutHeight,400);
 value.state.metadata['variant:sheet'].packCost=1200;context.variants[0].width=9000;assert.equal(row.areaCost.sourcePackCost,600);assert.equal(row.areaCost.sourceWidth,2000);
});

test('historical submissions without raw geometry remain unpriced instead of borrowing current dimensions or manual fallback',()=>{
 const context={catalog:[{id:'white',color:'White',material:'ACP',thickness:3,unitCostPerM2:100}],variants:[panel('sheet')],offcuts:[panel('cut',{width:500,height:400})]};
 const {report}=fixture([{id:'variant:sheet',identity:identity('sheet',{category:'panels',unitCost:1})},{id:'offcut:cut',identity:identity('cut',{category:'offcuts',unitCost:1})}],{metadata:{'variant:sheet':{unitCost:999},'offcut:cut':{unitCost:999}}},context);
 for(const row of report.rows){assert.equal(row.costBasis,'catalogue-area');assert.equal(row.catalogueCost,null);assert.equal(row.areaCost,null);assert.equal(row.unitCost,null);assert.equal(row.packCost,null);assert.equal(row.width,null);assert.equal(row.height,null);}
 const area=fixture([{id:'offcut:cut',identity:identity('cut',{category:'offcuts'})}],{metadata:{'variant:sheet':{unitCost:200},'offcut:cut':{costBasis:'area'}}},{...context,catalog:[]}).report.rows[0];assert.equal(area.costBasis,'area');assert.equal(area.areaCost,null);
 const incomplete=fixture([{id:'offcut:cut',identity:identity('cut',{category:'offcuts',catalogId:'white',color:'White',width:500,height:400})}],{metadata:{'variant:sheet':{unitCost:200},'offcut:cut':{costBasis:'area'}}},{...context,catalog:[{id:'white',color:'White',material:'ACP',thickness:3}]}).report.rows[0];
 assert.equal(incomplete.costBasis,'area');assert.equal(incomplete.areaCost,null);
});

test('catalogue-priced submissions with known material but missing or invalid dimensions cannot expose manual fallback prices',()=>{
 const context={catalog:[{id:'white',color:'White',material:'ACP',thickness:3,unitCostPerM2:100}],variants:[panel('sheet')],offcuts:[]};
 for(const geometry of [{width:undefined,height:undefined},{width:0,height:1000},{width:'invalid',height:1000},{width:2000,height:null}]){
  const row=fixture([{id:'variant:sheet',identity:panelIdentity('sheet',geometry)}],{metadata:{'variant:sheet':{unitCost:999,packCost:888,packSize:4,costBasis:'pack'}}},context).report.rows[0];
  assert.equal(row.costBasis,'catalogue-area');assert.equal(row.unitCost,null);assert.equal(row.packCost,null);assert.equal(row.areaCost,null);assert.equal(row.catalogueCost.ratePerM2,100);
  assert.ok(row.catalogueCost.width===null||row.catalogueCost.height===null);
 }
});

test('retained archived items supply completion prices while missing items never reuse old snapshot prices',()=>{
 const {report}=fixture([{id:'archived',current:stock('archived',{qty:0,unitCost:12.34,archivedAt:'2026-11-09T00:00:00Z'}),quantity:0},{id:'missing',identity:identity('missing',{unitCost:777,packCost:999})}]);
 assert.equal(report.rows[0].unitCost,12.34);assert.equal(report.rows[0].quantity,0);assert.equal(report.rows[1].unitCost,null);assert.equal(report.rows[1].packCost,null);assert.equal(report.rows[1].areaCost,null);assert.equal(report.rows[1].catalogueCost,null);assert.equal(report.rows[1].name,'Counted missing');
});

test('pricing reports include only bounded identity and pricing fields without images or live stock allocations',()=>{
 const image='data:image/png;base64,'+'A'.repeat(1024*1024),current=stock('a',{image,reservations:{'Private job':2},incomingOrders:[{private:'order details'}],purchaseOrders:[{private:'PO details'}]});
 const value=fixture([{id:'a',current,identity:identity('a',{image,reservations:current.reservations})}]),row=value.report.rows[0],serialized=JSON.stringify(value.report);
 for(const key of ['image','reservations','incomingOrders','purchaseOrders'])assert.equal(Object.hasOwn(row,key),false);
 assert.ok(!serialized.includes(image));assert.ok(!serialized.includes('Private job'));assert.ok(serialized.length<10000);assert.deepEqual(value.legacy.rows[0],stocktakeReport(value.state,value.count).rows[0]);assert.equal(Object.hasOwn(value.legacy.rows[0],'pricingCapturedAt'),false);
});

test('handler completion uses trusted server rates and settings while ignoring forged client snapshots and report contexts',()=>{
 const physical=stock('a',{...panel('a'),category:'extrusions',unit:'lengths'}),serverSettings=defaultStocktakeSettings();serverSettings.cosGroups.find(group=>group.id==='materials').accountCode='00050';
 const store=storeFor(base([physical]),{'stocktake-settings':serverSettings,'app:catalog':[{id:'white',color:'White',material:'ACP',thickness:3,unitCostPerM2:50}]});
 const count=post(store,{action:'stocktake_create',name:'Trusted count',categories:['extrusions']}).body.stocktakes[0];
 const forged={catalog:[{id:'white',color:'White',material:'ACP',thickness:3,unitCostPerM2:999}]},fakeSettings={...serverSettings,cosGroups:serverSettings.cosGroups.map(group=>({...group,accountCode:'99999'}))};
 const result=post(store,{action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'a',expectedQty:5,quantity:4,item:{name:'Forged name',unitCost:999,width:1,height:1}}],reportContext:forged,context:forged,stocktakeSettings:fakeSettings},counter),report=result.body.stocktakes[0].report;
 assert.equal(report.rows[0].catalogueCost.ratePerM2,50);assert.equal(report.rows[0].width,2000);assert.equal(report.rows[0].height,1000);assert.equal(report.rows[0].name,'Original a');assert.equal(report.rows[0].xeroAccountCode,'00050');assert.deepEqual(report.stocktakeSettings,serverSettings);
});

test('an invalid final batch leaves the count open without a partial report or persisted stock changes',()=>{
 const store=storeFor(base([stock('a'),stock('b'),stock('c',{reservations:{'Job A':2}})]));
 const count=post(store,{action:'stocktake_create',name:'Atomic count',categories:['extrusions']}).body.stocktakes[0];post(store,{action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'a',expectedQty:5,quantity:4}]},counter);
 const before=store.read('workshop-stock'),writes=store.writes;
 assert.throws(()=>post(store,{action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'b',expectedQty:5,quantity:3},{itemId:'c',expectedQty:5,quantity:1}]},counter),/reserved/);
 assert.deepEqual(store.read('workshop-stock'),before);assert.equal(store.writes,writes);assert.equal(before.stocktakes[0].status,'open');assert.equal(Object.hasOwn(before.stocktakes[0],'report'),false);
});

test('stored version one reports and read-only legacy fallbacks are never enriched with live prices',()=>{
 const state=base([stock('a',{unitCost:999})]),count={id:'legacy',name:'Legacy',categories:['extrusions'],supplier:'',itemIds:['a'],counts:{a:{quantity:0,expectedQty:5,item:identity('a'),at:'2026-10-01T00:00:00Z'}},status:'completed',completedAt:'2026-10-01T00:00:00Z',createdBy:'admin'};
 const stored=stocktakeReport(state,count);assert.equal(stored.version,1);
 state.stocktakes=[{...count,report:stored},{...count,id:'fallback'}];const store=storeFor(state),before=store.read('workshop-stock');
 const view=workshopView(store);assert.deepEqual(view.stocktakes[0].report,stored);assert.equal(view.stocktakes[1].report.version,1);
 for(const entry of view.stocktakes){assert.equal(Object.hasOwn(entry.report,'stocktakeSettings'),false);assert.equal(Object.hasOwn(entry.report,'pricingCapturedAt'),false);assert.equal(Object.hasOwn(entry.report.rows[0],'unitCost'),false);}
 assert.deepEqual(store.read('workshop-stock'),before);assert.equal(store.writes,0);
});

test('handler reads the extra raw pricing context before writes only for a completing submission',()=>{
 const store=storeFor(),count=post(store,{action:'stocktake_create',name:'Lazy context',categories:['extrusions']}).body.stocktakes[0];
 store.events=[];post(store,{action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'a',expectedQty:5,quantity:4}]},counter);
 let beforeWrite=store.events.slice(0,store.events.findIndex(event=>event.type==='write'));assert.ok(!beforeWrite.some(event=>event.type==='read'&&['app:catalog','app:variants','app:offcuts'].includes(event.key)));
 store.events=[];post(store,{action:'stocktake_batch',stocktakeId:count.id,counts:[{itemId:'b',expectedQty:5,quantity:4}]},counter);
 beforeWrite=store.events.slice(0,store.events.findIndex(event=>event.type==='write'));for(const key of ['app:catalog','app:variants','app:offcuts'])assert.ok(beforeWrite.some(event=>event.type==='read'&&event.key===key));
});
