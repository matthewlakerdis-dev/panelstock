import test from 'node:test';
import assert from 'node:assert/strict';
import {monitoringWindow,sumMetric,collectUsage,assessUsage,reportUsage} from '../database-write-monitor.mjs';
const sample=(extra={})=>({asOf:'2026-11-22T12:00:00.000Z',dayStart:'2026-11-22T00:00:00.000Z',dayWrites:43210,dayReads:36429254,hourWrites:1000,memoryErrors:0,cpuErrors:0,internalErrors:0,...extra});
test('ingestion delay around midnight keeps a complete and explicitly dated UTC window',()=>{
 const w=monitoringWindow(new Date('2026-11-22T00:03:00Z'));assert.equal(w.dayStart,'2026-11-21T00:00:00.000Z');assert.equal(w.asOf,'2026-11-21T23:58:00.000Z');assert.equal(w.hourStart,'2026-11-21T22:58:00.000Z');
 const next=monitoringWindow(new Date('2026-11-22T00:06:00Z'));assert.equal(next.dayStart,'2026-11-22T00:00:00.000Z');
});
test('actual measured totals and the last-hour rate produce a normal report',()=>{
 const r=assessUsage(sample());assert.equal(r.state,'normal');assert.equal(r.forecast,55210);assert.match(reportUsage(r),/not verified account quotas/);assert.match(reportUsage(r),/does not send Cloudflare notification emails/);
});
test('the daily warning is inclusive and remains active after an earlier spike subsides',()=>{
 assert.equal(assessUsage(sample({dayWrites:79999,hourWrites:0})).state,'normal');
 const r=assessUsage(sample({dayWrites:80000,hourWrites:0}));assert.equal(r.state,'warning');assert.match(r.warnings[0],/80,000/);
});
test('sustained growth can warn before the actual daily threshold is reached',()=>{
 const r=assessUsage(sample({dayWrites:25000,hourWrites:12000}));assert.equal(r.forecast,169000);assert.equal(r.warnings.length,1);assert.match(r.warnings[0],/projected/);
});
test('brief midnight traffic and small samples cannot project a full-day warning',()=>{
 assert.equal(assessUsage(sample({asOf:'2026-11-22T00:20:00Z',dayWrites:25000,hourWrites:25000})).state,'normal');
 assert.equal(assessUsage(sample({dayWrites:1000,hourWrites:10000})).state,'normal');
});
test('memory, CPU and internal failures warn independently of write volume',()=>{
 for(const key of ['memoryErrors','cpuErrors','internalErrors']){const r=assessUsage(sample({[key]:1}));assert.equal(r.state,'warning');assert.match(r.warnings[0],/failures/);}
});
test('missing, negative, overflowing or invalid telemetry and invalid thresholds cannot report healthy',()=>{
 for(const groups of [undefined,null,[{sum:{}}],[{sum:{rowsWritten:-1}}],[{sum:{rowsWritten:Number.MAX_SAFE_INTEGER}},{sum:{rowsWritten:1}}]])assert.throws(()=>sumMetric(groups,'rowsWritten'));
 assert.equal(sumMetric([],'rowsWritten'),0);
 for(const changed of [{dayWrites:undefined},{hourWrites:-1},{asOf:'not-a-date'},{dayStart:'2026-11-22T01:00:00Z'}])assert.throws(()=>assessUsage(sample(changed)));
 for(const config of [{warning:0},{warning:NaN},{warning:90000,forecastReference:80000}])assert.throws(()=>assessUsage(sample(),config));
});
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
test('the live-shaped query uses account-wide periodic SQLite rows and read-only GraphQL',async()=>{
 let sent;const r=await collectUsage({token:'synthetic-secret',account:'synthetic-account',now:new Date('2026-11-22T12:05:00Z'),fetcher:async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return response({data:{viewer:{accounts:[{day:[{sum:{rowsWritten:43210,rowsRead:36429254}}],hour:[{sum:{rowsWritten:1000}}],recent:[{sum:{exceededMemoryErrors:0,exceededCpuErrors:0,fatalInternalErrors:0}}]}]}}});}});
 assert.equal(r.dayWrites,43210);assert.equal(r.asOf,'2026-11-22T12:00:00.000Z');assert.equal(sent.options.method,'POST');assert.match(sent.body.query,/durableObjectsPeriodicGroups/);assert.doesNotMatch(sent.body.query,/namespaceId|mutation/);assert.equal(sent.body.variables.day,'2026-11-22T00:00:00.000Z');assert.equal(reportUsage(assessUsage(r)).includes('synthetic-secret'),false);
});
test('denied access, schema errors and missing account or metric results stay unknown',async()=>{
 for(const fetcher of [
  async()=>response({},403),
  async()=>response({errors:[{message:'Denied'}]}),
  async()=>response({data:{viewer:{accounts:[]}}}),
  async()=>response({data:{viewer:{accounts:[{day:null,hour:[],recent:[]}]}}}),
 ])await assert.rejects(collectUsage({token:'synthetic',account:'synthetic',fetcher}));
});
