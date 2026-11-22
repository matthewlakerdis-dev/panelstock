import test from 'node:test';
import assert from 'node:assert/strict';
import {configureStorageAlerts,storageAlertPlan} from '../scripts/configure-storage-alerts.mjs';
const account='a'.repeat(32),env={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'private-synthetic-token'};
function fixture({samples=3,existing=[],tamper=false}={}){
 const policies=[{id:'budget',name:'Existing budget',enabled:true,alert_type:'billing_budget_alert',mechanisms:{email:[{id:'private@example.invalid'}]},filters:{total_spend_dollars:['10']}},...structuredClone(existing)],calls=[],logs=[];
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;calls.push({path,method:options.method,body});
  const ok=data=>({ok:true,status:200,json:async()=>structuredClone(data)});
  if(path==='/client/v4/analytics/sql')return ok({data:[{value:body.query.includes("AND attributes['riskState']='warning' AND")?0:samples}]});
  if(options.method==='POST'){assert.equal(body.enabled,false,'New rules must be saved disabled');policies.push({...body,id:'policy-'+policies.length});}
  if(options.method==='PUT'){const id=path.split('/').at(-1),index=policies.findIndex(value=>value.id===id);assert.ok(index>=0);policies[index]={...body,id};}
  const result=structuredClone(policies);if(tamper){for(const value of result)if(value.alert_type==='custom_analytics')value.mechanisms.email=[{id:'unapproved@example.invalid'}];}
  return ok({success:true,result});
 };
 const run=()=>configureStorageAlerts(env,{fetcher,logger:{log:value=>logs.push(value)},maxWaitMs:0});
 return {run,policies,calls,logs};
}
test('new native rules are verified disabled before activation, and repeat setup never duplicates or resets them',async()=>{
 const f=fixture();await f.run();assert.equal(f.policies.length,3);assert.ok(f.policies.slice(1).every(value=>value.enabled));assert.equal(f.calls.filter(value=>value.method==='POST'&&value.path.endsWith('/policies')).length,2);assert.equal(f.calls.filter(value=>value.method==='PUT').length,2);
 const before=structuredClone(f.policies),writes=f.calls.filter(value=>value.method==='PUT'||value.method==='POST'&&value.path.endsWith('/policies')).length;await f.run();assert.deepEqual(f.policies,before);assert.equal(f.calls.filter(value=>value.method==='PUT'||value.method==='POST'&&value.path.endsWith('/policies')).length,writes);assert.equal(f.logs.join('\n').includes('private@example.invalid'),false);assert.equal(f.logs.join('\n').includes('private-synthetic-token'),false);
});
test('missing real telemetry cannot activate pressure or silence alerts',async()=>{
 const f=fixture({samples:0});await assert.rejects(f.run(),/not indexed yet/);assert.equal(f.policies.length,1);assert.equal(f.calls.some(value=>value.method==='PUT'),false);
});
test('unexpected notification recipients cannot be activated',async()=>{
 const f=fixture({tamper:true});await assert.rejects(f.run(),/readback differs/);assert.ok(f.policies.slice(1).every(value=>value.enabled===false));assert.equal(f.calls.some(value=>value.method==='PUT'),false);
});
test('an existing named policy with different filters is never overwritten',async()=>{
 const wanted=storageAlertPlan(account,[{id:'private@example.invalid'}]).policies[0];const f=fixture({existing:[{...wanted,id:'existing',enabled:true,filters:{source:['other']}}]});await assert.rejects(f.run(),/readback differs/);assert.equal(f.calls.some(value=>value.method==='PUT'),false);assert.deepEqual(f.policies[1].filters,{source:['other']});
});
test('unexpected extra notification mechanisms are rejected while empty provider defaults remain compatible',async()=>{
 const wanted=storageAlertPlan(account,[{id:'private@example.invalid'}]).policies[0];
 const extra=fixture({existing:[{...wanted,id:'existing',enabled:true,mechanisms:{...wanted.mechanisms,webhooks:[{id:'unapproved-hook'}]}}]});await assert.rejects(extra.run(),/readback differs/);assert.equal(extra.calls.some(value=>value.method==='PUT'),false);
 const empty=fixture({existing:[{...wanted,id:'existing',enabled:true,mechanisms:{...wanted.mechanisms,webhooks:[],pagerduty:[]}}]});await empty.run();assert.equal(empty.policies.filter(value=>value.name===wanted.name).length,1);
});
