import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {OCTOBER_STOCKTAKE_CORRECTION_ID as operation} from '../src/stocktake-reporting-correction.js';

let directory,worker,InventoryStore;
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'panelstock-reporting-proof-'));
 const outfile=join(directory,'worker.mjs');
 await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],outfile,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'durable-object-test-base',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'base',namespace:'stub'}));builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }'}));}}]});
 await symlink(new URL('../node_modules',import.meta.url).pathname,join(directory,'node_modules'),'dir');
 ({default:worker,InventoryStore}=await import(pathToFileURL(outfile)));
});
after(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});

const envFor=store=>({SITE_ID:'panelstock',STOCKTAKE_REPORTING_MONTH_CORRECTION_ID:operation,INVENTORY:{getByName:()=>store,idFromName:()=> 'canonical-production'}});
const request=(path='/session',options={})=>new Request('https://safety.panelstockhq.com'+path,options);
const stateFixture=()=>({revision:4,items:[{id:'a',qty:8,unitCost:123}],movements:[{id:'movement',at:'2026-11-07T00:00:00Z',quantity:-1}],stocktakes:[['remainder','October Stocktake - Remainder',11],['monthly','October Monthly Stocktake',61]].map(([id,name,size])=>{
 const at='2026-11-08T00:00:00.000Z',itemIds=Array.from({length:size},(_,index)=>id+'-'+index),counts=Object.fromEntries(itemIds.map((itemId,index)=>[itemId,{quantity:index===0?0:index,expectedQty:5,user:'counter',at,item:{name:itemId,unit:'each'}}]));
 return {id,name,status:'completed',createdAt:'2026-11-01T00:00:00.000Z',completedAt:at,stocktakeMonth:'2026-11',uncountedThisMonth:true,itemIds,counts,report:{version:2,name,completedAt:at,pricingCapturedAt:at,pricing:{basis:'completion'},stocktakeSettings:{cosGroups:[{id:'fixings',label:'Fixings',accountCode:'51066'}]},panelSnapshot:{capturedAt:at,itemIds:['variant:sheet']},rows:[...itemIds.map((itemId,index)=>({itemId,quantity:index===0?0:index,expectedQty:5,variance:index-5,at,unitCost:index===0?0:12.34,pricingCapturedAt:at})),{itemId:'variant:sheet',quantity:7,quantitySource:'soh-snapshot',quantityCapturedAt:at,at,catalogueCost:{catalogId:'white',ratePerM2:25,width:2400,height:1200}}]}};
})});

async function runtime(state=stateFixture()){
 const db=new DatabaseSync(':memory:'),pending=[];
 let writes=0;
 const sql={exec(query,...params){if(!/^\s*(SELECT|PRAGMA)\b/i.test(query))writes++;const statement=db.prepare(query),rows=statement.columns().length?statement.all(...params):(statement.run(...params),[]);return {toArray:()=>rows};}};
 const ctx={id:'canonical-production',storage:{sql,transactionSync:fn=>{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}},blockConcurrencyWhile:fn=>pending.push(fn()),getWebSockets:()=>[]};
 let store=new InventoryStore(ctx,{MIGRATION_READY:'false'});await Promise.all(pending.splice(0));
 store.write('initialized',true);store.write('workshop-stock',state);store.write('revision',7);store.write('app:variants',[{id:'sheet',qty:99}]);store.write('app:transactions',[{id:'transaction',qty:7,at:'2026-11-08T00:00:00Z'}]);
 const env=envFor(null);
 const restart=async()=>{store=new InventoryStore(ctx,env);await Promise.all(pending.splice(0));env.INVENTORY.getByName=()=>store;return store;};
 return {db,env,restart,get writes(){return writes;},get store(){return store;}};
}

test('actual SQL-backed startup corrects both requested records once and unauthenticated session proves it without private data',async()=>{
 const fixture=await runtime();
 try{
  const before=fixture.store.read('workshop-stock'),variants=fixture.store.read('app:variants'),history=fixture.store.read('app:transactions');
  const store=await fixture.restart(),after=store.read('workshop-stock');
  assert.deepEqual(store.stocktakeReportingCorrectionStatus(),{status:'verified'});
  assert.equal(after.revision,5);assert.equal(store.read('revision'),8);
  for(let index=0;index<2;index++){
   const {reportingMonth,reportingMonthAudit,report,...actual}=after.stocktakes[index],{report:originalReport,...original}=before.stocktakes[index];
   assert.equal(reportingMonth,'2026-10');assert.equal(reportingMonthAudit.length,1);assert.equal(report.reportingMonth,'2026-10');
   const {reportingMonth:reportMonth,...unchangedReport}=report;
   assert.deepEqual(actual,original);assert.deepEqual(unchangedReport,originalReport,'all count prices, timestamps and automatic panel snapshot evidence stay frozen');
   assert.equal(actual.createdAt,'2026-11-01T00:00:00.000Z');assert.equal(actual.stocktakeMonth,'2026-11');
  }
  assert.deepEqual(store.read('app:variants'),variants);assert.deepEqual(store.read('app:transactions'),history);assert.deepEqual(after.items,before.items);assert.deepEqual(after.movements,before.movements);
  assert.equal(store.sql.exec("SELECT COUNT(*) AS n FROM audit WHERE action='stocktake-reporting-month-correction'").toArray()[0].n,1);
  const savedWrites=fixture.writes;await fixture.restart();assert.equal(fixture.writes,savedWrites,'receipt makes the next startup entirely read-only');
  const response=await worker.fetch(request(),fixture.env);
  assert.equal(response.status,401);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),'verified');assert.equal(response.headers.get('X-Stocktake-Reporting-Correction-Reason'),null);
  const visible=JSON.stringify([...response.headers])+await response.text();
  for(const value of ['October Stocktake','remainder','monthly','2026-10','12.34','variant:sheet'])assert.ok(!visible.includes(value),value+' must stay private');
 }finally{fixture.db.close();}
});

test('guard mismatch keeps SQL stocktake records unchanged and normal application authentication available',async()=>{
 const state=stateFixture();state.stocktakes[1].itemIds.pop();const fixture=await runtime(state);
 try{
  await fixture.restart();assert.deepEqual(fixture.store.read('workshop-stock'),state);assert.equal(fixture.store.read('revision'),7);
  const response=await worker.fetch(request(),fixture.env);assert.equal(response.status,401);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),'blocked');assert.equal(response.headers.get('X-Stocktake-Reporting-Correction-Reason'),'target_count_mismatch');
  assert.equal(fixture.store.sql.exec("SELECT COUNT(*) AS n FROM audit WHERE action='stocktake-reporting-month-correction'").toArray()[0].n,0);
 }finally{fixture.db.close();}
});

test('proof is confined to the flagged unauthenticated production session response and only exposes bounded codes',async()=>{
 let calls=0,proof={status:'verified',name:'private count',id:'private-id',quantity:123},responseStatus=401;
 const store={handle:async()=>({status:responseStatus,body:{error:'Sign in required'}}),stocktakeReportingCorrectionStatus:async()=>{calls++;return proof;}};
 const env=envFor(store);
 let response=await worker.fetch(request(),env);assert.deepEqual(await response.json(),{error:'Sign in required'});assert.equal(calls,1);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),'verified');assert.ok(!JSON.stringify([...response.headers]).includes('private'));
 for(const change of [{SITE_ID:'staging'},{STOCKTAKE_REPORTING_MONTH_CORRECTION_ID:undefined},{STOCKTAKE_REPORTING_MONTH_CORRECTION_ID:'wrong-operation'}]){response=await worker.fetch(request(),{...env,...change});assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),null);}
 for(const [path,options] of [['/other',{}],['/session',{method:'POST'}],['/session',{headers:{Authorization:'Bearer invalid-token'}}]]){response=await worker.fetch(request(path,options),env);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),null);}
 responseStatus=200;response=await worker.fetch(request(),env);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),null);assert.equal(calls,1);responseStatus=401;
 proof={status:'pending'};response=await worker.fetch(request(),env);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),'pending');
 proof={status:'blocked',reason:'targets_missing'};response=await worker.fetch(request(),env);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction-Reason'),'targets_missing');
 proof={status:'private-details',reason:'private details\nrecords'};response=await worker.fetch(request(),env);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),'blocked');assert.equal(response.headers.get('X-Stocktake-Reporting-Correction-Reason'),null);
 store.stocktakeReportingCorrectionStatus=async()=>{throw Error('private storage detail');};response=await worker.fetch(request(),env);assert.equal(response.status,401);assert.equal(response.headers.get('X-Stocktake-Reporting-Correction'),'blocked');assert.equal(response.headers.get('X-Stocktake-Reporting-Correction-Reason'),'verification_failed');assert.deepEqual(await response.json(),{error:'Sign in required'});
});
