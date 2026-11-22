import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const scheduled=source.slice(source.indexOf('  async scheduled('),source.lastIndexOf('\n};'));
const makeWorker=collect=>new Function('runScheduledDatabaseMonitor','sendReport','localParts','return ({'+scheduled+'});')(collect,()=>assert.fail('No report email should be sent'),()=>assert.fail('No report should be built'));
test('account analytics can still be measured during application maintenance without accessing the database',async()=>{
 const env={READ_ONLY:'true',DATABASE_USAGE_MONITOR_ENABLED:'true',INVENTORY:{getByName:()=>assert.fail('Monitoring must not access application storage')}},calls=[];
 await makeWorker(async passed=>{assert.equal(passed,env);calls.push('analytics');}).scheduled({},env,{});assert.deepEqual(calls,['analytics']);
});
test('an unexpected analytics collector failure cannot stop existing maintenance queues',async t=>{
 t.mock.method(console,'error',()=>{});const calls=[];
 const store=Object.fromEntries(['compactQaEvidence','processSafetyExpiryReminders','processNexviaConfirmationEmailQueue','processNexviaQuoteTransferCleanup','processOrderEmailQueue','processToolboxEmailQueue'].map(name=>[name,async()=>calls.push(name)]));
 store.scheduledData=async()=>({config:{enabled:false}});
 const env={DATABASE_USAGE_MONITOR_ENABLED:'true',READ_ONLY:'false',EMAIL_ENABLED:'false',INVENTORY:{getByName:()=>{calls.push('store');return store;}}};
 await makeWorker(async()=>{calls.push('analytics');throw Error('Collector unavailable');}).scheduled({scheduledTime:Date.now()},env,{});
 assert.deepEqual(calls,['analytics','store','compactQaEvidence','processSafetyExpiryReminders','processNexviaConfirmationEmailQueue','processNexviaQuoteTransferCleanup','processOrderEmailQueue','processToolboxEmailQueue']);
});
