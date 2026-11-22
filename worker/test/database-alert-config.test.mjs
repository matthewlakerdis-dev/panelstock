import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseAlertPlan,configureDatabaseAlerts} from '../scripts/configure-database-alerts.mjs';
const account='b'.repeat(32),email=[{id:'monitor@example.invalid'}],env={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'synthetic-deployment-token'};
function fixture(samples){
 const plan=databaseAlertPlan(account,email),policies=[{id:'budget',enabled:true,alert_type:'billing_budget_alert',mechanisms:{email}}],writes=[],logs=[];
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):undefined;
  if(path.endsWith('/analytics/sql')){
   assert.ok([plan.sampleQuery,...plan.policies.map(value=>value.filters.selectors[0])].includes(body.query));
   return {ok:true,status:200,json:async()=>({data:[{value:body.query===plan.sampleQuery?samples:0}]})};
  }
  if(options.method==='POST'){assert.equal(body.enabled,false);writes.push(body);policies.push({...body,id:'rule-'+policies.length});}
  if(options.method==='PUT'){writes.push(body);const index=policies.findIndex(value=>path.endsWith('/'+value.id));assert.ok(index>=0);policies[index]={...body,id:policies[index].id};}
  return {ok:true,status:200,json:async()=>({success:true,result:structuredClone(policies)})};
 };
 return {policies,writes,logs,run:()=>configureDatabaseAlerts(env,{fetcher,logger:{log:value=>logs.push(value)},maxWaitMs:0})};
}
test('missing or unavailable database telemetry cannot activate native usage alerts',async()=>{
 const f=fixture(0);await assert.rejects(f.run(),/database usage measurements are not indexed yet/);assert.equal(f.writes.length,0);assert.equal(f.policies.length,1);
 const plan=databaseAlertPlan(account,email);assert.match(plan.sampleQuery,/metricsAvailable.*=1/);assert.doesNotMatch(plan.sampleQuery,/state.*='unavailable'/);
});
test('all database rules activate only after a real sample and preserve the existing email destination',async()=>{
 const f=fixture(2);await f.run();assert.equal(f.policies.length,4);assert.ok(f.policies.slice(1).every(value=>value.enabled));assert.equal(f.writes.filter(value=>value.enabled===false).length,3);assert.equal(f.writes.filter(value=>value.enabled===true).length,3);assert.ok(f.policies.slice(1).every(value=>JSON.stringify(value.mechanisms)==JSON.stringify({email})));
 assert.ok(!f.logs.join('\n').includes(email[0].id));assert.ok(!f.logs.join('\n').includes(env.CLOUDFLARE_API_TOKEN));
 const writes=f.writes.length;await f.run();assert.equal(f.writes.length,writes);
});
test('forecast gating stays in the validated collector and native rules distinguish unavailable samples from silence',()=>{
 const {policies}=databaseAlertPlan(account,email);
 assert.match(policies[0].filters.selectors[0],/state.*='warning'/);assert.doesNotMatch(policies[0].filters.selectors[0],/projectedDayWrites/);
 assert.match(policies[1].filters.selectors[0],/state.*='unavailable'/);assert.equal(policies[1].filters.alert_trigger_preferences_operator[0],'>=');
 assert.match(policies[2].filters.selectors[0],/INTERVAL '45' MINUTE/);assert.equal(policies[2].filters.alert_trigger_preferences_operator[0],'<');
 assert.ok(policies.every(value=>value.filters.execution_interval[0]==='15m'&&value.alert_interval==='1h'));
});
