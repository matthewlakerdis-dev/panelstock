import test from 'node:test';
import assert from 'node:assert/strict';
import {monitoringWindow,sumMetric,collectUsage,assessUsage,runScheduledDatabaseMonitor} from '../src/database-usage-monitor.js';

const account='a'.repeat(32),token='dedicated-analytics-secret',now=new Date('2026-11-22T12:05:00Z');
const env={DATABASE_ANALYTICS_TOKEN:token,DATABASE_ANALYTICS_ACCOUNT_ID:account};
const sample=(extra={})=>({asOf:'2026-11-22T12:00:00.000Z',dayStart:'2026-11-22T00:00:00.000Z',dayWrites:43210,dayReads:36429254,hourWrites:1000,memoryErrors:0,cpuErrors:0,internalErrors:0,...extra});
const data=(extra={})=>({data:{viewer:{accounts:[{day:[{sum:{rowsWritten:43210,rowsRead:36429254}}],hour:[{sum:{rowsWritten:1000}}],recent:[{sum:{exceededMemoryErrors:0,exceededCpuErrors:0,fatalInternalErrors:0}}],...extra}]}}});
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
async function runtime({bindings=env,fetcher=async()=>response(data()),time=now,logger}={}){
 const logs=[],result=await runScheduledDatabaseMonitor(bindings,{fetcher,now:time,logger:logger||{log:event=>logs.push(event)}});
 return {logs,result,event:logs[0]};
}

test('the delayed UTC window explicitly follows the previous day just after midnight',()=>{
 const previous=monitoringWindow(new Date('2026-11-22T00:03:00Z'));
 assert.deepEqual(previous,{asOf:'2026-11-21T23:58:00.000Z',dayStart:'2026-11-21T00:00:00.000Z',hourStart:'2026-11-21T22:58:00.000Z',recentStart:'2026-11-21T23:43:00.000Z'});
 assert.equal(monitoringWindow(new Date('2026-11-22T00:06:00Z')).dayStart,'2026-11-22T00:00:00.000Z');
 for(const value of [new Date('invalid'),NaN,Infinity])assert.throws(()=>monitoringWindow(value));
});

test('account-wide aggregation rejects invalid or overflowing counts and preserves empty CLI aggregation',()=>{
 assert.equal(sumMetric([{sum:{rowsWritten:2}},{sum:{rowsWritten:3}}],'rowsWritten'),5);
 assert.equal(sumMetric([],'rowsWritten'),0);
 for(const groups of [undefined,null,{},[{sum:{}}],[{sum:{rowsWritten:-1}}],[{sum:{rowsWritten:0.5}}],[{sum:{rowsWritten:'2'}}],[{sum:{rowsWritten:Number.MAX_SAFE_INTEGER}},{sum:{rowsWritten:1}}]])assert.throws(()=>sumMetric(groups,'rowsWritten'));
});

test('the shared collector queries account-wide SQLite rows and failure counters with bounded windows',async()=>{
 let sent;
 const measured=await collectUsage({token,account,now,fetcher:async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return response(data());}});
 assert.equal(measured.dayWrites,43210);assert.equal(measured.dayReads,36429254);assert.equal(measured.asOf,'2026-11-22T12:00:00.000Z');
 assert.equal(sent.url,'https://api.cloudflare.com/client/v4/graphql');assert.equal(sent.options.method,'POST');assert.equal(sent.options.headers.Authorization,'Bearer '+token);assert.ok(sent.options.signal);
 assert.match(sent.body.query,/durableObjectsPeriodicGroups/);assert.match(sent.body.query,/rowsWritten rowsRead/);assert.match(sent.body.query,/exceededMemoryErrors exceededCpuErrors fatalInternalErrors/);assert.doesNotMatch(sent.body.query,/namespaceId|scriptName|mutation/);
 assert.deepEqual(sent.body.variables,{account,day:'2026-11-22T00:00:00.000Z',hour:'2026-11-22T11:00:00.000Z',recent:'2026-11-22T11:45:00.000Z',until:'2026-11-22T12:00:00.000Z'});
 assert.equal(sent.options.body.includes(token),false);
});

test('Cloudflare success accepts null or empty errors and nullable optional metadata',async()=>{
 for(const errors of [null,[]]){
  const fetcher=async()=>response({...data(),errors,extensions:null});
  const measured=await collectUsage({token,account,now,fetcher});
  assert.equal(measured.dayWrites,43210);assert.equal(measured.dayReads,36429254);
  const {result,event}=await runtime({fetcher});
  assert.deepEqual(result,{state:'normal'});assert.equal(event.metricsAvailable,1);assert.equal(event.dayWrites,43210);
 }
});

test('existing assessment semantics retain operational thresholds, projection gates and failure warnings',()=>{
 const normal=assessUsage(sample());assert.equal(normal.state,'normal');assert.equal(normal.forecast,55210);assert.deepEqual(normal.warnings,[]);
 assert.equal(assessUsage(sample({dayWrites:79999,hourWrites:0})).state,'normal');assert.equal(assessUsage(sample({dayWrites:80000,hourWrites:0})).state,'warning');
 assert.match(assessUsage(sample({dayWrites:25000,hourWrites:12000})).warnings[0],/projected/);
 for(const input of [{asOf:'2026-11-22T00:20:00Z',dayWrites:25000,hourWrites:25000},{dayWrites:19999,hourWrites:10000},{dayWrites:25000,hourWrites:9999}])assert.equal(assessUsage(sample(input)).state,'normal');
 for(const key of ['memoryErrors','cpuErrors','internalErrors'])assert.match(assessUsage(sample({[key]:1})).warnings[0],/failures/);
 for(const input of [{dayWrites:undefined},{hourWrites:-1},{asOf:'invalid'},{dayStart:'2026-11-22T01:00:00Z'},{asOf:'2026-11-23T00:00:00Z'},{hourWrites:Number.MAX_SAFE_INTEGER}])assert.throws(()=>assessUsage(sample(input)));
 for(const config of [{warning:0},{warning:NaN},{warning:90000,forecastReference:80000}])assert.throws(()=>assessUsage(sample(),config));
});

test('scheduled monitoring emits one fixed numeric event without credentials, account identifiers or payloads',async()=>{
 const {result,logs,event}=await runtime();
 assert.deepEqual(result,{state:'normal'});assert.equal(logs.length,1);
 assert.deepEqual(event,{event:'database_usage_metrics',state:'normal',metricsAvailable:1,collectedAtMs:+now,asOfMs:Date.parse('2026-11-22T12:00:00Z'),utcDayStartMs:Date.parse('2026-11-22T00:00:00Z'),dayWrites:43210,dayReads:36429254,hourWrites:1000,projectedDayWrites:55210,warningReference:80000,forecastReference:100000,dailyWarning:0,forecastWarning:0,runtimeFailureWarning:0,memoryErrors:0,cpuErrors:0,internalErrors:0});
 for(const [key,value]of Object.entries(event))if(!['event','state'].includes(key))assert.ok(Number.isSafeInteger(value),key);
 assert.equal(JSON.stringify(event).includes(token),false);assert.equal(JSON.stringify(event).includes(account),false);
});

test('native warning flags preserve the projection eligibility gates instead of relying on a large raw forecast',async()=>{
 const largeRate={day:[{sum:{rowsWritten:25000,rowsRead:0}}],hour:[{sum:{rowsWritten:12000}}]};
 const sustained=await runtime({fetcher:async()=>response(data(largeRate))});assert.equal(sustained.event.state,'warning');assert.equal(sustained.event.dailyWarning,0);assert.equal(sustained.event.forecastWarning,1);
 const early=await runtime({fetcher:async()=>response(data(largeRate)),time:new Date('2026-11-22T00:25:00Z')});assert.ok(early.event.projectedDayWrites>100000);assert.equal(early.event.forecastWarning,0);assert.equal(early.event.state,'normal');
 const daily=await runtime({fetcher:async()=>response(data({day:[{sum:{rowsWritten:80000,rowsRead:0}}],hour:[{sum:{rowsWritten:0}}]}))});assert.equal(daily.event.dailyWarning,1);assert.equal(daily.event.state,'warning');
 const failed=await runtime({fetcher:async()=>response(data({recent:[{sum:{exceededMemoryErrors:1,exceededCpuErrors:0,fatalInternalErrors:0}}]}))});assert.equal(failed.event.runtimeFailureWarning,1);assert.equal(failed.event.memoryErrors,1);
});

test('runtime requires the dedicated credential and a strict account ID, with no deployment-token fallback',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return response(data());};
 for(const bindings of [{},{CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account},{...env,DATABASE_ANALYTICS_TOKEN:''},{...env,DATABASE_ANALYTICS_ACCOUNT_ID:'synthetic-account'},{...env,DATABASE_ANALYTICS_ACCOUNT_ID:account+'x'},{...env,DATABASE_ANALYTICS_ACCOUNT_ID:' '+account},{...env,DATABASE_DAILY_WRITE_WARNING:'0'},{...env,DATABASE_DAILY_WRITE_FORECAST_REFERENCE:'invalid'}]){
  const {result,logs,event}=await runtime({bindings,fetcher});assert.deepEqual(result,{state:'unavailable'});assert.equal(logs.length,1);assert.equal(event.metricsAvailable,0);assert.ok(Number.isSafeInteger(event.unavailableCode));assert.equal(Object.hasOwn(event,'dayWrites'),false);
 }
 assert.equal(calls,0);
});

test('denied, malformed, partial or failed upstream telemetry remains unavailable and cannot leak errors',async()=>{
 const privateMessage='private customer payload '+token+' '+account;
 const fetchers=[
  async()=>{throw Error(privateMessage);},
  async()=>response({privateMessage},403),
  async()=>({ok:true,json:async()=>{throw Error(privateMessage);}}),
  async()=>response(null),
  async()=>response({errors:[{message:privateMessage}],...data()}),
  async()=>response({errors:{message:privateMessage},...data()}),
  async()=>response({errors:false,...data()}),
  async()=>response({errors:0,...data()}),
  async()=>response({errors:'',...data()}),
  async()=>response({data:{viewer:{accounts:[]}}}),
  async()=>response({data:{viewer:{accounts:[{},{}]}}}),
  async()=>response(data({day:null})),
  async()=>response(data({hour:[{sum:{rowsWritten:NaN}}]})),
  async()=>response(data({recent:[{sum:{exceededMemoryErrors:undefined,exceededCpuErrors:0,fatalInternalErrors:0}}]})),
 ];
 for(const fetcher of fetchers){
  const {result,logs,event}=await runtime({fetcher});assert.deepEqual(result,{state:'unavailable'});assert.equal(logs.length,1);assert.equal(event.metricsAvailable,0);assert.equal(Object.hasOwn(event,'dayWrites'),false);assert.equal(Object.hasOwn(event,'projectedDayWrites'),false);
  const text=JSON.stringify(logs);for(const value of [privateMessage,token,account])assert.equal(text.includes(value),false);
  for(const [key,value]of Object.entries(event))if(!['event','state'].includes(key))assert.ok(Number.isSafeInteger(value),key);
 }
});

test('scheduled runtime does not call an entirely absent activity sample healthy',async()=>{
 const body=data({day:[],hour:[],recent:[]}),fetcher=async()=>response(body);
 const result=await runtime({fetcher});assert.equal(result.event.state,'unavailable');assert.equal(result.event.unavailableCode,11);assert.equal(Object.hasOwn(result.event,'memoryErrors'),false);
 const cli=await collectUsage({token,account,now,fetcher});assert.equal(cli.dayWrites,0);assert.equal(cli.hourWrites,0);
 // Explicit zero-valued groups are an observed sample, rather than absent telemetry.
 const observed=await runtime({fetcher:async()=>response(data({day:[{sum:{rowsWritten:0,rowsRead:0}}],hour:[],recent:[]}))});assert.equal(observed.event.state,'normal');assert.equal(observed.event.metricsAvailable,1);
});

test('invalid monitoring time or projection cannot produce healthy numeric telemetry',async()=>{
 const invalid=await runtime({time:new Date('invalid')});assert.equal(invalid.event.state,'unavailable');assert.equal(Object.hasOwn(invalid.event,'collectedAtMs'),false);
 const overflow=await runtime({fetcher:async()=>response(data({hour:[{sum:{rowsWritten:Number.MAX_SAFE_INTEGER}}]}))});assert.equal(overflow.event.state,'unavailable');assert.equal(overflow.event.unavailableCode,12);
});

test('a failing logger cannot reject the maintenance task or invoke network side effects again',async()=>{
 for(const logger of [()=>{throw Error('Logging failed');},{log:async()=>{throw Error('Async logging failed');}}]){
  let calls=0;
  assert.deepEqual(await runScheduledDatabaseMonitor(env,{now,fetcher:async()=>{calls++;return response(data());},logger}),{state:'normal'});
  assert.equal(calls,1);
 }
});
