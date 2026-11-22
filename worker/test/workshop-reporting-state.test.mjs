import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readWorkshopReportingState} from '../src/workshop-reporting-state.js';
import {OCTOBER_STOCKTAKE_CORRECTION_ID as operation,applyOctoberStocktakeReportingCorrection,octoberStocktakeReportingCorrectionStatus} from '../src/stocktake-reporting-correction.js';

function fromChunks(chunks){
 return {exec(query,key){
  assert.equal(query,'SELECT value FROM documents WHERE key=? ORDER BY part');assert.equal(key,'workshop-stock');
  return {[Symbol.iterator]:function*(){for(const value of chunks)yield {value};}};
 }};
}
function split(raw,size){return function*(){for(let index=0;index<raw.length;index+=size)yield raw.slice(index,index+size);}();}
const projected=(raw,size=100000)=>readWorkshopReportingState(fromChunks(split(raw,size)));

test('workshop reporting projection preserves exact selected JSON across escapes and every small chunk boundary',()=>{
 const raw=String.raw`{"items":[{"image":"data:image/png;base64,AAAA","nested":[true,false,null,-1.25e+3,{"x":"escaped \" } ] \\ \n \u263a"}]}],"rev\u0069sion":4,"stock\u0074akes":[{"id":"月 😀","nested":{"quotation":"say \"hello\"","line":"\r\n","surrogate":"\ud83d\ude00"},"numbers":[0,-0,12,1.25,1e-9]}],"unknown":{"stocktakes":"ignored"}}`;
 const {revision,stocktakes}=JSON.parse(raw);
 for(let size=1;size<=19;size++)assert.deepEqual(projected(raw,size),{revision,stocktakes},'chunk size '+size);
 assert.deepEqual(projected('{"revision":1,"stocktakes":[],"revision":2,"stocktakes":[null]}',1),{revision:2,stocktakes:[null]},'duplicate keys follow JSON.parse last-value semantics');
 assert.deepEqual(projected('{"'+'x'.repeat(1000)+'":42,"revision":4,"stocktakes":[]}',7),{revision:4,stocktakes:[]});
});

test('production-sized unrelated images are scanned incrementally and never passed to JSON.parse',t=>{
 const nativeParse=JSON.parse;let largestParse=0,sourceBytes=0,rows=0;
 t.mock.method(JSON,'parse',raw=>{largestParse=Math.max(largestParse,raw.length);return nativeParse(raw);});
 function* chunks(){
  const values=['{"items":[{"image":"data:image/png;base64,',...Array(280).fill('A'.repeat(100000)),'"}],"metadata":{"private":"omitted"},"purchaseOrders":[],"revision":7,"stocktakes":[{"id":"proof","report":{"rows":[{"quantity":0,"label":"\\u263a"}]}}]}'];
  for(const value of values){sourceBytes+=value.length;rows++;yield value;}
 }
 const result=readWorkshopReportingState(fromChunks(chunks()));
 assert.deepEqual(result,{revision:7,stocktakes:[{id:'proof',report:{rows:[{quantity:0,label:'☺'}]}}]});
 assert.ok(sourceBytes>27843115);assert.ok(rows>280);assert.ok(largestParse<1024,'only keys and the small reporting projection can be parsed');
 assert.equal(JSON.stringify(result).includes('private'),false);
});

test('malformed skipped JSON and malformed selected JSON fail closed at chunk boundaries',()=>{
 const invalid=[
  '[]','null','{"revision":4','{"revision":4}x','{"revision":4}{"stocktakes":[]}',
  '{"items":[1,],"revision":4,"stocktakes":[]}',
  '{"items":{"x":1,},"revision":4,"stocktakes":[]}',
  '{"items":{"x" 1},"revision":4,"stocktakes":[]}',
  '{"items":[true false],"revision":4,"stocktakes":[]}',
  '{"items":01,"revision":4,"stocktakes":[]}',
  '{"items":1.,"revision":4,"stocktakes":[]}',
  '{"items":1e+,"revision":4,"stocktakes":[]}',
  '{"items":nul,"revision":4,"stocktakes":[]}',
  String.raw`{"items":"bad\q","revision":4,"stocktakes":[]}`,
  String.raw`{"items":"bad\u00xz","revision":4,"stocktakes":[]}`,
  '{"items":"bad\ncontrol","revision":4,"stocktakes":[]}',
  '{"items":"unfinished','{"stocktakes":[{"id":"unfinished}',
  '{"items":'+'['.repeat(513)+'0'+']'.repeat(513)+',"revision":4,"stocktakes":[]}',
 ];
 for(const raw of invalid)for(const size of [1,7,100000])assert.throws(()=>projected(raw,size),undefined,'must reject '+JSON.stringify(raw.slice(0,80))+' with chunk size '+size);
 assert.equal(readWorkshopReportingState(fromChunks([])),null);
 assert.throws(()=>readWorkshopReportingState(fromChunks([''])));
 const fallback={missing:true};assert.equal(readWorkshopReportingState(fromChunks([]),fallback),fallback);
 assert.throws(()=>readWorkshopReportingState(fromChunks([null])));
});

test('actual SQLite chunk iteration projects reporting state without materializing row arrays',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE documents(key TEXT,part INTEGER,value TEXT,PRIMARY KEY(key,part))');
  const value={revision:5,items:[{image:'data:image/png;base64,'+'A'.repeat(100000)}],stocktakes:[{id:'exact',counts:{one:{quantity:0}},report:{rows:[]}}]},insert=db.prepare('INSERT INTO documents VALUES(?,?,?)');
  let part=0;for(const chunk of split(JSON.stringify(value),177))insert.run('workshop-stock',part++,chunk);
  const sql={exec(query,...parameters){return {[Symbol.iterator]:()=>db.prepare(query).iterate(...parameters)};}};
  assert.deepEqual(readWorkshopReportingState(sql),{revision:value.revision,stocktakes:value.stocktakes});
 }finally{db.close();}
});

function reportingFixture(){
 const stocktakes=[['remainder','October Stocktake - Remainder',11],['monthly','October Monthly Stocktake',61]].map(([id,name,size])=>{
  const itemIds=Array.from({length:size},(_,index)=>id+'-'+index),at='2026-11-08T00:00:00.000Z';
  return {id,name,status:'completed',createdAt:'2026-11-01T00:00:00.000Z',completedAt:at,itemIds,counts:Object.fromEntries(itemIds.map((itemId,index)=>[itemId,{quantity:index,user:'counter',at,item:{name:itemId,unitCost:12.34}}])),report:{version:2,completedAt:at,rows:itemIds.map((itemId,index)=>({itemId,quantity:index,unitCost:12.34,at})),pricing:{basis:'completion'}}};
 });
 const docs=new Map([['initialized',true],['revision',7],['workshop-stock',{revision:4,items:[{image:'unrelated image'}],stocktakes}]]);
 let fullReads=0,projectedReads=0;
 const store={ctx:{id:'canonical-production',storage:{transactionSync:fn=>fn()}},read(key,fallback=null){if(key==='workshop-stock')fullReads++;return docs.has(key)?structuredClone(docs.get(key)):fallback;},write:(key,value)=>docs.set(key,structuredClone(value)),audit:()=>{}};
 const env={SITE_ID:'panelstock',STOCKTAKE_REPORTING_MONTH_CORRECTION_ID:operation,INVENTORY:{idFromName:()=> 'canonical-production'}};
 const receipt=applyOctoberStocktakeReportingCorrection(store,env);assert.equal(receipt.status,'applied');
 store.readWorkshopReportingState=()=>{projectedReads++;return projected(JSON.stringify(docs.get('workshop-stock')),37);};
 return {store,env,docs,get fullReads(){return fullReads;},get projectedReads(){return projectedReads;}};
}

test('deep correction proof uses the projection and still detects any target count or report tampering',()=>{
 const fixture=reportingFixture(),{store,env,docs}=fixture,fullReads=fixture.fullReads;
 assert.deepEqual(octoberStocktakeReportingCorrectionStatus(store,env),{status:'verified'});
 assert.equal(fixture.fullReads,fullReads);assert.equal(fixture.projectedReads,1);
 const original=structuredClone(docs.get('workshop-stock'));
 const tamper=[
  state=>state.stocktakes[0].counts['remainder-0'].quantity++,
  state=>state.stocktakes[1].report.rows[0].unitCost++,
  state=>state.stocktakes[0].counts['remainder-0'].item.name='changed',
  state=>state.stocktakes[1].report.pricing.basis='changed',
  state=>state.stocktakes[0].completedAt='2026-11-09T00:00:00.000Z',
  state=>state.stocktakes[1].report.rows.push({itemId:'unexpected',quantity:1}),
  state=>state.stocktakes[0].report.reportingMonth='2026-11',
 ];
 for(const change of tamper){const changed=structuredClone(original);change(changed);docs.set('workshop-stock',changed);assert.deepEqual(octoberStocktakeReportingCorrectionStatus(store,env),{status:'blocked',reason:'receipt_mismatch'});}
 docs.set('workshop-stock',original);const backupKey='stocktake-reporting-correction-backup:'+operation,backup=docs.get(backupKey);backup.stocktakes[0].counts['remainder-0'].quantity++;
 assert.deepEqual(octoberStocktakeReportingCorrectionStatus(store,env),{status:'blocked',reason:'receipt_mismatch'});
 assert.equal(fixture.fullReads,fullReads,'proof must never fall back to the full workshop read when a projection is available');
});

test('simple stores retain full deep proof fallback and a failing projection cannot silently verify a receipt',()=>{
 const {store,env}=reportingFixture();delete store.readWorkshopReportingState;
 assert.deepEqual(octoberStocktakeReportingCorrectionStatus(store,env),{status:'verified'});
 store.readWorkshopReportingState=()=>{throw Error('Invalid workshop reporting document');};
 assert.throws(()=>octoberStocktakeReportingCorrectionStatus(store,env));
});
