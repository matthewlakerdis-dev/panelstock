import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {runtimeDocumentSizes} from '../src/runtime-document-sizes.js';
import {OCTOBER_STOCKTAKE_CORRECTION_ID} from '../src/stocktake-reporting-correction.js';
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const method=(name,next)=>source.slice(source.indexOf('  '+name+'('),source.indexOf('  '+next+'('));
const methods=[method('snapshot','backup'),method('scheduledData','scheduledReportData'),method('scheduledReportData','claimReport')].join(',');
const factory=new Function('FIELDS','check','return ({'+methods+'});');
function fixture(){
 const docs=new Map([['initialized',true],['last-backup-date',new Date().toISOString().slice(0,10)],['config',{enabled:false}],['app:variants',[{id:'v',qty:7}]],['app:photos',{original:'private original image'}]]),reads=[],backups=[];
 const store=Object.assign(factory(['variants','photos'],(condition,message)=>{if(!condition)throw Error(message);}),{read(key,fallback){reads.push(key);return docs.has(key)?structuredClone(docs.get(key)):fallback;},write:(key,value)=>docs.set(key,value),backup:who=>backups.push(who),ctx:{storage:{transactionSync:fn=>fn()}}});
 return {store,docs,reads,backups};
}
test('scheduled metadata never loads image data when no email report is due',()=>{
 const f=fixture(),result=f.store.scheduledData(false);assert.equal(result.data,undefined);assert.deepEqual(result.config,{enabled:false});assert.equal(f.reads.includes('app:photos'),false);assert.equal(f.reads.includes('app:variants'),false);
});
test('scheduled report data omits images while ordinary inventory snapshots preserve original evidence',()=>{
 const f=fixture(),report=f.store.scheduledReportData();assert.deepEqual(report.variants,[{id:'v',qty:7}]);assert.deepEqual(report.photos,{});assert.equal(f.reads.includes('app:photos'),false);
 assert.deepEqual(f.store.snapshot().photos,{original:'private original image'});
});
test('metadata-only scheduling still takes the daily backup exactly once',()=>{
 const f=fixture();f.docs.set('last-backup-date','2000-01-01');f.store.scheduledData(false);f.store.scheduledData(false);assert.deepEqual(f.backups,['scheduled']);
});
test('completed historical correction does not reload the entire stock history on startup, but explicit verification remains available',()=>{
 let checks=0;const factory=new Function('OCTOBER_STOCKTAKE_CORRECTION_ID','applyOctoberStocktakeReportingCorrection','return ({'+method('applyReportingMonthCorrection','stocktakeReportingCorrectionStatus')+'});');
 const receipt={id:OCTOBER_STOCKTAKE_CORRECTION_ID,status:'applied'},store=Object.assign(factory(OCTOBER_STOCKTAKE_CORRECTION_ID,()=>{checks++;return {status:'verified'};}),{env:{SITE_ID:'panelstock',STOCKTAKE_REPORTING_MONTH_CORRECTION_ID:OCTOBER_STOCKTAKE_CORRECTION_ID},read(key){assert.equal(key,'stocktake-reporting-correction:'+OCTOBER_STOCKTAKE_CORRECTION_ID);return receipt;}});
 assert.equal(store.applyReportingMonthCorrection({verifyExisting:false}),receipt);assert.equal(checks,0);assert.deepEqual(store.applyReportingMonthCorrection(),{status:'verified'});assert.equal(checks,1);
});
test('runtime diagnostics aggregate SQLite bytes without reading or disclosing private values',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE documents(key TEXT,part INTEGER,value TEXT,PRIMARY KEY(key,part))');const insert=db.prepare('INSERT INTO documents VALUES(?,?,?)');insert.run('qa-checks',0,'not JSON: private photo bytes');insert.run('orders',0,'é');insert.run('secret-token',0,'must never appear');
  const sql={exec(query){return {toArray:()=>db.prepare(query).all()};}},sizes=runtimeDocumentSizes(sql);assert.equal(sizes.find(row=>row.key==='orders').bytes,2);assert.equal(sizes.some(row=>row.key==='secret-token'),false);assert.equal(JSON.stringify(sizes).includes('private photo bytes'),false);assert.equal(JSON.stringify(sizes).includes('must never appear'),false);
 }finally{db.close();}
});

const index=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const body=index.slice(index.indexOf('async scheduled(event,env,ctx) {')+'async scheduled(event,env,ctx) {'.length,index.lastIndexOf('\n  }'));
const makeSchedule=new Function('sendReport','localParts','return async(event,env,ctx)=>{'+body+'};');
test('scheduled reports load data only after the due-time check and successful lease claim',async()=>{
 for(const scenario of ['email-disabled','config-disabled','no-recipients','early','wrong-day','already-sent','lease-denied','due']){
  const calls=[],config={enabled:true,recipients:['synthetic@example.invalid'],days:scenario==='wrong-day'?[1]:[0],time:'07:00',timezone:'UTC'};if(scenario==='config-disabled')config.enabled=false;if(scenario==='no-recipients')config.recipients=[];
  const store={compactQaEvidence:async()=>{},processSafetyExpiryReminders:async()=>{},processNexviaConfirmationEmailQueue:async()=>{},processNexviaQuoteTransferCleanup:async()=>{},processOrderEmailQueue:async()=>{},processToolboxEmailQueue:async()=>{},scheduledData:async include=>{assert.equal(include,false);return {config,lastSent:scenario==='already-sent'?'day-2026-11-22':null};},claimReport:async()=>{calls.push('claim');return scenario!=='lease-denied';},scheduledReportData:async()=>{calls.push('data');return {variants:[]};},finishReport:async(_,success)=>calls.push('finish:'+success)};
  const run=makeSchedule(async()=>{calls.push('send');return {ok:true};},()=>({dateKey:'2026-11-22',dayOfWeek:0,hour:scenario==='early'?6:8,minute:0}));
  await run({scheduledTime:Date.parse('2026-11-22T08:00:00Z')},{READ_ONLY:'false',EMAIL_ENABLED:scenario==='email-disabled'?'false':'true',INVENTORY:{getByName:()=>store}},{});
  if(scenario==='due')assert.deepEqual(calls,['claim','data','send','finish:true']);else assert.equal(calls.includes('data'),false,scenario);
 }
});
