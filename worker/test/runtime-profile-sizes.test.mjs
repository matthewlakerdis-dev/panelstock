import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runtimeDocumentSizes,runtimeDocumentSizeLog,storageSizeState} from '../src/runtime-document-sizes.js';

const profileNames=['profileCount','profilesBytes','largestProfileBytes','activeProfileCount','activeProfilesBytes','largestActiveProfileBytes'];
const profileMetrics={profileCount:2,profilesBytes:300,largestProfileBytes:200,activeProfileCount:1,activeProfilesBytes:100,largestActiveProfileBytes:100};
const bytes=value=>Buffer.byteLength(value,'utf8');
function fixture({profiles=true,access=true}={}){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE documents(key TEXT,part INTEGER,value TEXT NOT NULL,PRIMARY KEY(key,part))');
 if(profiles)db.exec('CREATE TABLE employee_profiles(username TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL)');
 if(access)db.exec('CREATE TABLE access_users(username TEXT PRIMARY KEY,active INTEGER NOT NULL)');
 const queries=[],sql={exec(query,...parameters){queries.push(query);const statement=db.prepare(query);return {toArray:()=>statement.all(...parameters)};}};
 const seed=(key,part,value)=>db.prepare('INSERT INTO documents VALUES(?,?,?)').run(key,part,value);
 return {db,sql,queries,seed};
}
function fakeSql({profiles=[profileMetrics],users=[{usersBytes:123,usersChunks:2}],documents=[{key:'orders',bytes:2,chunks:1}]}={}){
 return {exec(query){
  const value=query.includes('employee_profiles')?profiles:query.includes("key='users'")?users:documents;
  if(value instanceof Error)throw value;
  return {toArray:()=>value};
 }};
}
function numericOnly(log){
 for(const [key,value]of Object.entries(log))if(key==='event')assert.equal(value,'inventory_storage_sizes');else if(key==='riskState')assert.ok(['normal','warning','unavailable'].includes(value));else assert.ok(Number.isSafeInteger(value)&&value>=0,key+' must be a nonnegative integer');
}
function unavailableProfiles(log){
 assert.equal(log.profilesMeasurementAvailable,0);
 for(const name of profileNames)assert.equal(Object.hasOwn(log,name),false,name+' must stay unknown');
}

test('fixed SQL measures UTF-8 user/profile bytes and active subsets without parsing or exposing private data',t=>{
 const f=fixture();try{
  f.seed('orders',0,'é');f.seed('qa-checks',0,'[]');f.seed('private-token',0,'private-secret-token');
  const userParts=['{"private-user":"José', ' 月 😀"}'];userParts.forEach((part,index)=>f.seed('users',index,part));
  const data={activeSmall:'{"profilePhoto":"private-active 月 😀"}',activeLarge:'private-active-photo:'+ 'A'.repeat(1000),inactive:'private-inactive-photo:'+'B'.repeat(2000),orphan:'private-orphan-photo:'+'C'.repeat(3000)};
  const insertProfile=f.db.prepare('INSERT INTO employee_profiles VALUES(?,?,?)');
  for(const [username,value]of Object.entries(data))insertProfile.run(username,value,'private-updated-at');
  f.db.prepare('INSERT INTO access_users VALUES(?,?)').run('activeSmall',1);f.db.prepare('INSERT INTO access_users VALUES(?,?)').run('activeLarge',1);f.db.prepare('INSERT INTO access_users VALUES(?,?)').run('inactive',0);
  const before=f.db.prepare('SELECT total_changes() AS count').get().count;
  t.mock.method(JSON,'parse',()=>{throw Error('Stored values must never be parsed');});
  const log=runtimeDocumentSizeLog(f.sql);
  assert.equal(log.usersChunks,2);assert.equal(log.usersBytes,userParts.reduce((sum,value)=>sum+bytes(value),0));
  assert.equal(log.profilesMeasurementAvailable,1);assert.equal(log.profileCount,4);assert.equal(log.profilesBytes,Object.values(data).reduce((sum,value)=>sum+bytes(value),0));assert.equal(log.largestProfileBytes,bytes(data.orphan));
  assert.equal(log.activeProfileCount,2);assert.equal(log.activeProfilesBytes,bytes(data.activeSmall)+bytes(data.activeLarge));assert.equal(log.largestActiveProfileBytes,bytes(data.activeLarge));
  assert.equal(log.trackedSourceBytes,4);assert.equal(log.observedSourceCount,2);assert.equal(log.riskState,'normal');numericOnly(log);
  assert.equal(f.db.prepare('SELECT total_changes() AS count').get().count,before,'diagnostics must remain read-only');
  const serialized=JSON.stringify(log);
  for(const secret of ['private-user','José','月','😀','activeSmall','activeLarge','inactive','orphan','profilePhoto','private-secret-token','private-updated-at'])assert.equal(serialized.includes(secret),false,secret+' must remain private');
  assert.ok(f.queries.every(query=>/^SELECT\b/i.test(query)));assert.ok(f.queries.some(query=>query.includes('LEFT JOIN access_users')));
 }finally{f.db.close();}
});

test('advisory user and profile sizes never change the existing six-document risk references',()=>{
 const mib=1024*1024,log=runtimeDocumentSizeLog(fakeSql({users:[{usersBytes:100*mib,usersChunks:1000}],profiles:[{profileCount:10,profilesBytes:120*mib,largestProfileBytes:30*mib,activeProfileCount:5,activeProfilesBytes:80*mib,largestActiveProfileBytes:20*mib}]}));
 assert.equal(log.usersBytes,100*mib);assert.equal(log.profilesBytes,120*mib);assert.equal(log.riskState,'normal');assert.equal(log.trackedSourceBytes,2);assert.equal(log.observedSourceCount,1);
 assert.deepEqual(storageSizeState(log),{riskState:'normal',trackedSourceBytes:2,observedSourceCount:1});numericOnly(log);
 const warning=runtimeDocumentSizeLog(fakeSql({documents:[{key:'qa-checks',bytes:40*mib,chunks:420}]}));assert.equal(warning.riskState,'warning');assert.equal(warning.trackedSourceBytes,40*mib);
 const absent=runtimeDocumentSizeLog(fakeSql({documents:[]}));assert.equal(absent.riskState,'unavailable');assert.equal(absent.observedSourceCount,0);assert.equal(absent.usersBytes,123);assert.equal(absent.profilesMeasurementAvailable,1);
});

test('an observed empty profile table reports genuine zeros while a missing users document stays omitted',()=>{
 const f=fixture();try{
  f.seed('orders',0,'[]');const sizes=runtimeDocumentSizes(f.sql),log=runtimeDocumentSizeLog(f.sql);
  assert.deepEqual(sizes.map(row=>({...row})),[{key:'orders',chunks:1,bytes:2}]);assert.equal(log.profilesMeasurementAvailable,1);
  for(const name of profileNames)assert.equal(log[name],0,name);
  assert.equal(Object.hasOwn(log,'usersBytes'),false);assert.equal(Object.hasOwn(log,'usersChunks'),false);assert.equal(log.riskState,'normal');numericOnly(log);
 }finally{f.db.close();}
});

test('missing optional profile or access tables preserve valid document and users measurements',()=>{
 for(const options of [{profiles:false,access:false},{profiles:true,access:false},{profiles:false,access:true}]){
  const f=fixture(options);try{
   f.seed('orders',0,'é');f.seed('users',0,'{"private":"hidden"}');
   const log=runtimeDocumentSizeLog(f.sql);assert.equal(log.ordersBytes,2);assert.equal(log.usersBytes,20);assert.equal(log.usersChunks,1);assert.equal(log.riskState,'normal');assert.equal(log.trackedSourceBytes,2);unavailableProfiles(log);numericOnly(log);
  }finally{f.db.close();}
 }
});

test('malformed, missing or inconsistent optional profile aggregates stay unknown without masking source metrics',()=>{
 const invalid=[];
 for(const name of profileNames)for(const value of [null,undefined,NaN,Infinity,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1])invalid.push([{...profileMetrics,[name]:value}]);
 invalid.push([],null,[null],[profileMetrics,profileMetrics],[{...profileMetrics,activeProfileCount:3}],[{...profileMetrics,activeProfilesBytes:301}],[{...profileMetrics,largestProfileBytes:301}],[{...profileMetrics,largestActiveProfileBytes:101}],[{...profileMetrics,profileCount:0}],[{...profileMetrics,activeProfileCount:0}],new Error('private-profile-query-failure'));
 for(const profiles of invalid){
  const log=runtimeDocumentSizeLog(fakeSql({profiles}));assert.equal(log.riskState,'normal');assert.equal(log.ordersBytes,2);assert.equal(log.usersBytes,123);assert.equal(log.trackedSourceBytes,2);unavailableProfiles(log);numericOnly(log);
  assert.equal(JSON.stringify(log).includes('private-profile-query-failure'),false);
 }
});

test('failed or invalid users aggregates are independently omitted and do not suppress valid profiles',()=>{
 const invalid=[[],null,[null],[{usersBytes:null,usersChunks:1}],[{usersBytes:1,usersChunks:0}],[{usersBytes:-1,usersChunks:1}],[{usersBytes:'1',usersChunks:1}],[{usersBytes:1,usersChunks:1.5}],[{usersBytes:Number.MAX_SAFE_INTEGER+1,usersChunks:1}],[{usersBytes:0,usersChunks:0}],[{usersBytes:1,usersChunks:1},{usersBytes:1,usersChunks:1}],new Error('private-users-query-failure')];
 for(const users of invalid){
  const log=runtimeDocumentSizeLog(fakeSql({users}));assert.equal(Object.hasOwn(log,'usersBytes'),false);assert.equal(Object.hasOwn(log,'usersChunks'),false);assert.equal(log.profilesMeasurementAvailable,1);assert.equal(log.profileCount,2);assert.equal(log.riskState,'normal');assert.equal(log.trackedSourceBytes,2);numericOnly(log);assert.equal(JSON.stringify(log).includes('private-users-query-failure'),false);
 }
 const zero=runtimeDocumentSizeLog(fakeSql({users:[{usersBytes:0,usersChunks:1}]}));assert.equal(zero.usersBytes,0);assert.equal(zero.usersChunks,1);
});

test('optional measurement failures cannot turn absent or invalid original source telemetry into healthy data',()=>{
 const failure=new Error('private-query-failure'),log=runtimeDocumentSizeLog(fakeSql({documents:[],users:failure,profiles:failure}));
 assert.equal(log.riskState,'unavailable');assert.equal(log.trackedSourceBytes,0);assert.equal(log.observedSourceCount,0);unavailableProfiles(log);numericOnly(log);
 assert.throws(()=>runtimeDocumentSizeLog(fakeSql({documents:[{key:'orders',bytes:null,chunks:1}]})),/measurement is unavailable/);
});
