import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correctStocktakeReportingMonth,validReportingMonth} from '../src/stocktake-reporting-month.js';
import {applyWorkshop,handleWorkshop,workshopView} from '../src/workshop-stock.js';
import {countedStockItemsThisMonth,stocktakeMonth} from '../src/stocktake-month.js';
import {OCTOBER_STOCKTAKE_CORRECTION_ID,applyOctoberStocktakeReportingCorrection,octoberStocktakeReportingCorrectionStatus} from '../src/stocktake-reporting-correction.js';

const admin={username:'admin',isAdmin:true},worker={username:'counter',tasks:{'factory.stock':true}},at='2026-11-12T05:00:00.000Z';
const completed=patch=>({id:'october',name:'October Monthly Stocktake',status:'completed',categories:['fixings'],supplier:'Supplier',createdAt:'2026-10-29T00:00:00.000Z',completedAt:'2026-11-08T00:00:00.000Z',uncountedThisMonth:true,stocktakeMonth:'2026-10',itemIds:['a','zero'],counts:{a:{quantity:4,expectedQty:5,item:{name:'A',category:'fixings',unit:'each'},at:'2026-11-07T01:00:00.000Z',user:'counter'},zero:{quantity:0,expectedQty:0,item:{name:'Zero',category:'fixings',unit:'each'},at:'2026-11-08T00:00:00.000Z',user:'counter'}},report:{version:2,name:'October Monthly Stocktake',completedAt:'2026-11-08T00:00:00.000Z',pricingCapturedAt:'2026-11-08T00:00:00.000Z',pricing:{basis:'completion'},stocktakeSettings:{cosGroups:[{id:'fixings',label:'Fixings',accountCode:'00500'}]},panelSnapshot:{capturedAt:'2026-11-08T00:00:00.000Z',itemIds:['variant:sheet']},rows:[{itemId:'a',quantity:4,expectedQty:5,variance:-1,unitCost:12.34,at:'2026-11-07T01:00:00.000Z',pricingCapturedAt:'2026-11-08T00:00:00.000Z'},{itemId:'zero',quantity:0,expectedQty:0,variance:0,unitCost:0,at:'2026-11-08T00:00:00.000Z'},{itemId:'variant:sheet',quantity:7,quantitySource:'soh-snapshot',quantityCapturedAt:'2026-11-08T00:00:00.000Z',at:'2026-11-08T00:00:00.000Z',catalogueCost:{catalogId:'white',ratePerM2:25,width:2400,height:1200}}]},...patch});
const state=()=>({revision:3,items:[{id:'a',name:'A',category:'fixings',qty:4,unit:'each',reservations:{},unitCost:99},{id:'zero',name:'Zero',category:'fixings',qty:0,unit:'each',reservations:{}}],metadata:{},movements:[{id:'movement-a',action:'stocktake',stocktakeId:'october',itemId:'a',quantity:-1,at:'2026-11-07T01:00:00.000Z'},{id:'movement-zero',action:'stocktake',stocktakeId:'october',itemId:'zero',quantity:0,at:'2026-11-08T00:00:00.000Z'}],stocktakes:[completed()]});
const correction=(patch={})=>({action:'stocktake_reporting_month',stocktakeId:'october',reportingMonth:'2026-10',reason:'October stocktake completed during November testing',mutationId:crypto.randomUUID(),...patch});
function storeFor(current=state()){
 const docs=new Map([['workshop-stock',structuredClone(current)],['revision',10],['app:variants',[{id:'sheet',sku:'SHEET',qty:7,color:'White',material:'ACP',thickness:3,width:2400,height:1200}]],['app:transactions',[{id:'original',type:'workshop',qty:-1}]]]);
 const store={docs,writes:0,audits:[],broadcasts:[],read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>{store.writes++;docs.set(key,structuredClone(value));},requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task]){const error=Error('Forbidden');error.status=403;throw error;}},audit:(...args)=>store.audits.push(structuredClone(args)),broadcastRevision:revision=>store.broadcasts.push(revision),ctx:{storage:{transactionSync:fn=>{const original=structuredClone([...docs]);try{return fn();}catch(error){docs.clear();for(const [key,value] of original)docs.set(key,value);throw error;}}}}};return store;
}

test('reporting corrections preserve every actual date, quantity, price and creation-time month filter',()=>{
 const original=completed(),before=structuredClone(original),result=correctStocktakeReportingMonth(original,correction({mutationId:'correction-id'}),admin,at),changed=result.count;
 assert.deepEqual(original,before);assert.equal(changed.reportingMonth,'2026-10');assert.equal(changed.report.reportingMonth,'2026-10');assert.equal(changed.stocktakeMonth,'2026-10');
 assert.deepEqual(changed.counts,before.counts);assert.deepEqual(changed.report.rows,before.report.rows);assert.deepEqual(changed.report.panelSnapshot,before.report.panelSnapshot);assert.deepEqual(changed.report.stocktakeSettings,before.report.stocktakeSettings);assert.equal(changed.createdAt,before.createdAt);assert.equal(changed.completedAt,before.completedAt);assert.equal(changed.report.pricingCapturedAt,before.report.pricingCapturedAt);assert.equal(changed.report.version,2);
 assert.deepEqual(result.correction,{id:'correction-id',stocktakeId:'october',previousMonth:null,reportingMonth:'2026-10',reason:'October stocktake completed during November testing',user:'admin',at,source:'admin'});assert.deepEqual(changed.reportingMonthAudit,[result.correction]);
 const next=correctStocktakeReportingMonth(changed,correction({reportingMonth:'2026-09',mutationId:'second'}),admin,'2026-11-12T06:00:00Z').count;assert.equal(next.reportingMonthAudit.length,2);assert.deepEqual(next.reportingMonthAudit[0],result.correction);assert.equal(next.reportingMonthAudit[1].previousMonth,'2026-10');
});

test('strict month validation, admin checks, completed-only targets and correction reasons reject invalid changes',()=>{
 for(const value of ['2026-00','2026-13','2026-1','0000-10','2026-10-01','2026-10\n',null,1,{},undefined]){assert.equal(validReportingMonth(value),false);assert.throws(()=>correctStocktakeReportingMonth(completed(),correction({reportingMonth:value}),admin,at),/valid reporting month/);}
 for(const value of ['0001-01','2026-10','9999-12'])assert.equal(validReportingMonth(value),true);
 assert.throws(()=>correctStocktakeReportingMonth(completed(),correction(),worker,at),error=>error.status===403);assert.throws(()=>correctStocktakeReportingMonth(undefined,correction(),admin,at),error=>error.status===404);
 for(const status of ['open','draft'])assert.throws(()=>correctStocktakeReportingMonth(completed({status}),correction(),admin,at),error=>error.status===409);
 for(const reason of ['', ' ', null, 1, 'a'.repeat(501)])assert.throws(()=>correctStocktakeReportingMonth(completed(),correction({reason}),admin,at),/reason/);
 assert.throws(()=>correctStocktakeReportingMonth(completed({reportingMonth:'2026-10'}),correction(),admin,at),error=>error.status===409&&/already/.test(error.message));
});

test('corrected completed submissions and linked movements count only toward the explicit month, including zero and legacy recovery',()=>{
 const current=state();current.stocktakes[0]=correctStocktakeReportingMonth(current.stocktakes[0],correction(),admin,at).count;
 assert.deepEqual([...countedStockItemsThisMonth(current,stocktakeMonth('2026-10-15'))].sort(),['a','variant:sheet','zero']);assert.deepEqual([...countedStockItemsThisMonth(current,stocktakeMonth('2026-11-15'))],[]);
 current.movements.push({action:'stocktake',itemId:'a',quantity:0,at:'2026-11-10T00:00:00Z'});assert.deepEqual([...countedStockItemsThisMonth(current,stocktakeMonth('2026-11-15'))],['a']);
 current.stocktakes[0].counts={};assert.ok(countedStockItemsThisMonth(current,stocktakeMonth('2026-10-15')).has('zero'),'valid saved report rows and linked movements recover the reporting month');
 current.stocktakes[0].report.reportingMonth='2026-10';delete current.stocktakes[0].reportingMonth;assert.ok(countedStockItemsThisMonth(current,stocktakeMonth('2026-10-15')).has('zero'));
});

test('open, draft and malformed overrides never suppress actual dated evidence or infer month from count names',()=>{
 for(const patch of [{status:'open',reportingMonth:'2026-10'},{reportingMonth:'2026-13',report:{rows:[]}},{name:'October Monthly Stocktake'}]){
  const current=state();Object.assign(current.stocktakes[0],patch);assert.ok(countedStockItemsThisMonth(current,stocktakeMonth('2026-11-15')).has('a'));assert.ok(!countedStockItemsThisMonth(current,stocktakeMonth('2026-10-15')).has('a'));
 }
 const current=state();current.stocktakes[0].status='draft';current.stocktakes[0].reportingMonth='2026-10';assert.deepEqual([...countedStockItemsThisMonth(current,stocktakeMonth('2026-11-15'))],[]);
});

test('admin correction is atomic, revisioned and retry safe without touching stock, movements or transaction history',()=>{
 const store=storeFor(),input={...correction(),expectedRevision:3},before=store.read('workshop-stock'),variants=store.read('app:variants'),history=store.read('app:transactions');
 assert.throws(()=>handleWorkshop(store,'POST',input,worker),error=>error.status===403);assert.equal(store.writes,0);const output=handleWorkshop(store,'POST',input,admin).body,saved=store.read('workshop-stock');
 assert.equal(output.stocktakes[0].reportingMonth,'2026-10');assert.equal(saved.revision,4);assert.equal(store.read('revision'),11);assert.deepEqual(saved.items,before.items);assert.deepEqual(saved.movements,before.movements);assert.deepEqual(store.read('app:variants'),variants);assert.deepEqual(store.read('app:transactions'),history);assert.equal(store.audits.length,1);assert.equal(store.audits[0][1],'stocktake-reporting-month');assert.deepEqual(store.broadcasts,[11]);
 const writes=store.writes;assert.equal(handleWorkshop(store,'POST',input,admin).body.duplicate,true);assert.equal(store.writes,writes);assert.equal(store.audits.length,1);assert.throws(()=>handleWorkshop(store,'POST',{...input,reportingMonth:'2026-09'},admin),error=>error.status===409&&/reused/.test(error.message));assert.throws(()=>handleWorkshop(store,'POST',{...input,mutationId:crypto.randomUUID()},admin),error=>error.status===409&&/changed/.test(error.message));
});

test('correction makes November workshop items eligible while preserving read-only legacy report timestamps',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-12T05:00:00Z')});
 const current=state();delete current.stocktakes[0].report;const store=storeFor(current);handleWorkshop(store,'POST',{...correction(),expectedRevision:3},admin);
 const view=workshopView(store),fallback=view.stocktakes[0].report;assert.equal(fallback.version,1);assert.equal(fallback.reportingMonth,'2026-10');assert.equal(fallback.completedAt,'2026-11-08T00:00:00.000Z');assert.equal(fallback.rows[0].at,'2026-11-07T01:00:00.000Z');assert.equal(fallback.pricingCapturedAt,undefined);assert.ok(view.items.filter(item=>!item.legacy).every(item=>item.countedThisMonth===false));
 const next=applyWorkshop(store.read('workshop-stock'),{action:'stocktake_create',name:'November remainder',categories:['fixings'],uncountedThisMonth:true,stocktakeMonth:'2026-11'},admin).next;assert.deepEqual(next.stocktakes[0].itemIds,['a','zero']);
});

function migrationStore(){
 const current=state();current.stocktakes=[['remainder','October Stocktake - Remainder',11],['monthly','October Monthly Stocktake',61]].map(([id,name,size])=>{
  const count=completed({id,name,itemIds:Array.from({length:size},(_,index)=>id+'-'+index)});
  count.counts=Object.fromEntries(count.itemIds.map((itemId,index)=>[itemId,{quantity:index===0?0:5,expectedQty:5,user:'counter',at:count.completedAt,item:{name:itemId,unit:'each'}}]));
  count.report={...count.report,name,rows:[...count.itemIds.map((itemId,index)=>({itemId,quantity:index===0?0:5,expectedQty:5,variance:index===0?-5:0,unitCost:index===0?0:12.34,at:count.completedAt,pricingCapturedAt:count.completedAt})),count.report.rows.at(-1)]};return count;
 });
 current.stocktakes.push(completed({id:'unrelated',name:'Unrelated November count'}));const store=storeFor(current);store.docs.set('initialized',true);store.ctx.id='canonical';
 const env={SITE_ID:'panelstock',STOCKTAKE_REPORTING_MONTH_CORRECTION_ID:OCTOBER_STOCKTAKE_CORRECTION_ID,READ_ONLY:'false',INVENTORY:{idFromName:name=>name==='panelstock'?'canonical':'other'}};return {store,env};
}
const markerKey='stocktake-reporting-correction:'+OCTOBER_STOCKTAKE_CORRECTION_ID,backupKey='stocktake-reporting-correction-backup:'+OCTOBER_STOCKTAKE_CORRECTION_ID;
test('controlled October repair changes exactly two verified records, backs them up and preserves financial evidence',()=>{
 const {store,env}=migrationStore(),before=store.read('workshop-stock'),history=store.read('app:transactions'),stock=store.read('app:variants');assert.deepEqual(octoberStocktakeReportingCorrectionStatus(store,env),{status:'pending'});assert.equal(store.writes,0);
 const receipt=applyOctoberStocktakeReportingCorrection(store,env),after=store.read('workshop-stock');assert.equal(receipt.status,'applied');assert.equal(receipt.changedCount,2);assert.equal(receipt.stocktakes[0].manualItems,11);assert.equal(receipt.stocktakes[1].manualItems,61);assert.equal(after.revision,before.revision+1);assert.equal(store.read('revision'),11);assert.equal(store.audits.length,1);assert.equal(store.audits[0][0],'system');assert.equal(store.audits[0][1],'stocktake-reporting-month-correction');
 for(let index=0;index<2;index++){assert.equal(after.stocktakes[index].reportingMonth,'2026-10');assert.equal(after.stocktakes[index].report.reportingMonth,'2026-10');assert.deepEqual(after.stocktakes[index].counts,before.stocktakes[index].counts);assert.deepEqual(after.stocktakes[index].report.rows,before.stocktakes[index].report.rows);assert.deepEqual(after.stocktakes[index].report.panelSnapshot,before.stocktakes[index].report.panelSnapshot);assert.equal(after.stocktakes[index].stocktakeMonth,before.stocktakes[index].stocktakeMonth);assert.equal(after.stocktakes[index].completedAt,before.stocktakes[index].completedAt);assert.equal(after.stocktakes[index].reportingMonthAudit[0].source,'controlled-correction');}
 assert.deepEqual(after.stocktakes[2],before.stocktakes[2]);assert.deepEqual(after.items,before.items);assert.deepEqual(after.movements,before.movements);assert.deepEqual(store.read('app:transactions'),history);assert.deepEqual(store.read('app:variants'),stock);assert.deepEqual(store.read(backupKey).stocktakes,before.stocktakes.slice(0,2));
 const writes=store.writes;assert.deepEqual(octoberStocktakeReportingCorrectionStatus(store,env),{status:'verified'});assert.deepEqual(applyOctoberStocktakeReportingCorrection(store,env),receipt);assert.equal(store.writes,writes);assert.equal(store.audits.length,1);
});

test('controlled repair gates canonical initialized writable production and emits only bounded verification status',()=>{
 for(const change of [({env})=>env.SITE_ID='staging',({env})=>delete env.STOCKTAKE_REPORTING_MONTH_CORRECTION_ID,({env})=>env.READ_ONLY='true',({store})=>store.docs.set('initialized',false),({store})=>store.ctx.id='another-object']){
  const fixture=migrationStore();change(fixture);const before=JSON.stringify([...fixture.store.docs]);assert.equal(applyOctoberStocktakeReportingCorrection(fixture.store,fixture.env).status,'blocked');const status=octoberStocktakeReportingCorrectionStatus(fixture.store,fixture.env);assert.deepEqual(Object.keys(status).sort(),['reason','status']);assert.equal(fixture.store.writes,0);assert.equal(JSON.stringify([...fixture.store.docs]),before);
 }
});

test('missing, ambiguous, inconsistent or conflicting targets fail closed together without poisoning startup',()=>{
 for(const change of [
  state=>state.stocktakes.pop()&&state.stocktakes.shift(),
  state=>state.stocktakes.push(structuredClone(state.stocktakes[0])),
  state=>state.stocktakes[2].id=state.stocktakes[0].id,
  state=>state.stocktakes[0].status='open',
  state=>state.stocktakes[0].createdAt='2026-12-01T00:00:00Z',
  state=>state.stocktakes[0].createdAt='2026-09-30T13:59:59Z',
  state=>state.stocktakes[0].completedAt='2026-10-31T13:59:59Z',
  state=>state.stocktakes[0].itemIds.pop(),
  state=>delete state.stocktakes[0].counts['remainder-0'],
  state=>state.stocktakes[0].report.rows.shift(),
  state=>state.stocktakes[0].report.rows[0].quantity=null,
  state=>state.stocktakes[0].reportingMonth='2026-09',
  state=>state.stocktakes[0].report.reportingMonth='2026-12',
  state=>state.stocktakes[0].reportingMonth='2026-10'
 ]){
  const {store,env}=migrationStore(),current=store.read('workshop-stock');change(current);store.docs.set('workshop-stock',current);const before=JSON.stringify([...store.docs]);assert.equal(applyOctoberStocktakeReportingCorrection(store,env).status,'blocked');assert.equal(octoberStocktakeReportingCorrectionStatus(store,env).status,'blocked');assert.equal(store.writes,0);assert.equal(store.read(markerKey),undefined);assert.equal(JSON.stringify([...store.docs]),before);
 }
});

test('verified prior admin corrections are retained while the other target is repaired',()=>{
 const {store,env}=migrationStore(),current=store.read('workshop-stock');current.stocktakes[0]=correctStocktakeReportingMonth(current.stocktakes[0],correction(),admin,at).count;store.docs.set('workshop-stock',current);const audit=structuredClone(current.stocktakes[0].reportingMonthAudit);
 const receipt=applyOctoberStocktakeReportingCorrection(store,env);assert.equal(receipt.changedCount,1);assert.deepEqual(store.read('workshop-stock').stocktakes[0].reportingMonthAudit,audit);assert.equal(octoberStocktakeReportingCorrectionStatus(store,env).status,'verified');
});

test('the two explicitly requested reports may have been created during November testing without backdating creation or its filter',()=>{
 const {store,env}=migrationStore(),current=store.read('workshop-stock');current.stocktakes[0].createdAt='2026-10-31T14:00:00Z';current.stocktakes[0].stocktakeMonth='2026-11';current.stocktakes[1].createdAt='2026-11-08T00:00:00Z';store.docs.set('workshop-stock',current);
 assert.equal(applyOctoberStocktakeReportingCorrection(store,env).status,'applied');const after=store.read('workshop-stock');assert.equal(after.stocktakes[0].createdAt,current.stocktakes[0].createdAt);assert.equal(after.stocktakes[0].stocktakeMonth,'2026-11');assert.equal(after.stocktakes[1].createdAt,current.stocktakes[1].createdAt);assert.equal(octoberStocktakeReportingCorrectionStatus(store,env).status,'verified');
});

test('readonly proof rejects altered evidence after application and failed storage rolls back both corrections',()=>{
 let {store,env}=migrationStore();applyOctoberStocktakeReportingCorrection(store,env);const current=store.read('workshop-stock');current.stocktakes[0].report.rows[0].unitCost=999;store.docs.set('workshop-stock',current);assert.deepEqual(octoberStocktakeReportingCorrectionStatus(store,env),{status:'blocked',reason:'receipt_mismatch'});const writes=store.writes;assert.equal(applyOctoberStocktakeReportingCorrection(store,env).status,'blocked');assert.equal(store.writes,writes);
 ({store,env}=migrationStore());const before=JSON.stringify([...store.docs]),write=store.write;store.write=(key,value)=>{if(key==='revision')throw Error('Storage unavailable');write(key,value);};assert.deepEqual(applyOctoberStocktakeReportingCorrection(store,env),{status:'blocked',reason:'storage_error'});assert.equal(JSON.stringify([...store.docs]),before);assert.equal(store.read(markerKey),undefined);assert.equal(store.audits.length,0);
});
