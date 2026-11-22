import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAlertDelivery} from '../scripts/verify-alert-delivery.mjs';

const START=Date.parse('2026-11-22T12:00:00Z'),address='private@example.invalid',secret='private-synthetic-token';
const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:secret,GITHUB_RUN_ID:'12345',SEND_MONITOR_TEST:'true'};
const budget=()=>({id:'budget',enabled:true,alert_type:'billing_budget_alert',mechanisms:{email:[{id:address}]}});
const policy=()=>({id:'growth',name:'PanelStock source document growth',enabled:true,alert_type:'custom_analytics',mechanisms:{email:[{id:address}],webhooks:[],pagerduty:[]}});
const record=(extra={})=>({id:'sent-one',policy_id:'growth',mechanism_type:'email',mechanism:address,sent:new Date(START).toISOString(),alert_body:'private notification body',...extra});
function fixture({policies=[budget(),policy()],records=[record()],post='accepted',history}={}){
 let clock=START,historyCalls=0;const calls=[],logs=[];
 const fetcher=async(url,options)=>{
  const parsed=new URL(url),body=options.body?JSON.parse(options.body):undefined;calls.push({url:parsed,method:options.method,body});
  const response=(result,status=200)=>({ok:status<400,status,json:async()=>({success:true,result})});
  if(parsed.pathname.endsWith('/policies'))return response(policies);
  if(parsed.pathname.endsWith('/test')){
   if(post==='timeout')throw Error(secret+' '+address+' private failure payload');
   if(post==='500')return {ok:false,status:500,json:async()=>{throw Error('Must not read a private error body');}};
   if(post==='403')return {ok:false,status:403,json:async()=>{throw Error('Must not read a private error body');}};
   return response({});
  }
  if(parsed.pathname.endsWith('/history'))return response(history?history(historyCalls++):records);
  throw Error('Unexpected test request');
 };
 const run=(changedEnv={},options={})=>verifyAlertDelivery({...env,...changedEnv},{fetcher,logger:value=>logs.push(value),now:()=>clock,pause:async ms=>{clock+=ms;},maxWaitMs:0,...options});
 return {run,calls,logs};
}
test('an explicitly requested test sends one INFO notification through the approved policy and prints only bounded dispatch evidence',async()=>{
 const f=fixture(),result=await f.run({MONITOR_TEST_EMAIL:'unapproved@example.invalid'});
 assert.deepEqual(result,{state:'dispatched',testRequest:'accepted',matchedEmailRecords:1,latestSent:new Date(START).toISOString()});
 const writes=f.calls.filter(call=>call.method!=='GET');assert.equal(writes.length,1);assert.ok(writes[0].url.pathname.endsWith('/policies/growth/test'));assert.deepEqual(writes[0].body,{severity:1,source:'PanelStock monitoring delivery test 12345'});
 const output=JSON.stringify({logs:f.logs,result});for(const value of [address,secret,'unapproved@example.invalid','private notification body'])assert.equal(output.includes(value),false);assert.match(f.logs.join('\n'),/does not confirm inbox receipt/);
});
test('a rerun without the explicit send flag reads the last day of history and never sends a notification',async()=>{
 const f=fixture(),result=await f.run({SEND_MONITOR_TEST:'false',GITHUB_RUN_ATTEMPT:'2'});assert.equal(result.state,'history_only');assert.equal(result.testRequest,'not_sent');assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.equal(f.calls.find(call=>call.url.pathname.endsWith('/history')).url.searchParams.get('since'),new Date(START-24*60*60*1000).toISOString());
});
test('ambiguous timeouts and server errors are never resent; only read-only history polling continues',async()=>{
 for(const post of ['timeout','500']){
  const f=fixture({post,history:index=>index? [record({sent:new Date(START+1000).toISOString()})]:[]});const result=await f.run({},{maxWaitMs:10000});assert.equal(result.state,'dispatched');assert.equal(result.testRequest,'unknown');assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.logs.join('\n').includes(secret),false);assert.equal(f.logs.join('\n').includes(address),false);
 }
});
test('an accepted test without a history record stays pending and a denied test stays rejected',async()=>{
 const pending=fixture({records:[]});assert.equal((await pending.run()).state,'pending');assert.equal(pending.calls.filter(call=>call.method==='POST').length,1);
 const denied=fixture({post:'403',records:[]});assert.equal((await denied.run()).state,'rejected');assert.equal(denied.calls.filter(call=>call.method==='POST').length,1);
});
test('missing, ambiguous, disabled or unexpected destinations cannot send a test',async()=>{
 const cases=[
  [],[budget(),policy(),policy()],[budget(),{...policy(),enabled:false}],[budget(),{...policy(),alert_type:'other'}],
  [budget(),{...policy(),mechanisms:{email:[{id:'unapproved@example.invalid'}]}}],
  [budget(),{...policy(),mechanisms:{...policy().mechanisms,webhooks:[{id:'unexpected-hook'}]}}],
  [budget(),{...budget(),id:'other-budget',mechanisms:{email:[{id:'other@example.invalid'}]}},policy()]
 ];
 for(const policies of cases){const f=fixture({policies});await assert.rejects(f.run());assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.equal(f.logs.join('\n').includes(address),false);}
});
test('history requires the selected policy, approved email destination and a current valid timestamp, and deduplicates records',async()=>{
 const good=record(),f=fixture({records:[good,good,record({id:'foreign-policy',policy_id:'other'}),record({id:'webhook',mechanism_type:'webhook'}),record({id:'foreign-address',mechanism:'other@example.invalid'}),record({id:'old',sent:new Date(START-1).toISOString()}),record({id:'invalid',sent:'not-a-date'}),record({id:'future',sent:new Date(START+10000).toISOString()})]});assert.equal((await f.run()).matchedEmailRecords,1);
});
test('untrusted run identifiers are rejected before any API call',async()=>{
 for(const GITHUB_RUN_ID of ['',secret,'123\n456','../test']){const f=fixture();await assert.rejects(f.run({GITHUB_RUN_ID}),/valid GitHub run identifier/);assert.equal(f.calls.length,0);}
});
