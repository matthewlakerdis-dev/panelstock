import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {DatabaseSync} from 'node:sqlite';
import {authenticator,hash} from './passkey-fixture.mjs';
import {initializePasskeys,handlePasskeys} from '../src/passkeys.js';
const web='https://web.panelstockhq.com',app='https://app.panelstockhq.com',site='https://site.panelstockhq.com';const staging='https://panelstock-reports-staging.matthewlakerdis.workers.dev';let mf,admin,alice,bob,requestCount=0;
async function request(path,body={},token,origin=web){const response=await mf.dispatchFetch('https://worker.test'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.'+(++requestCount),...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
async function login(name,pin='123456'){const result=await request('/login',{username:name,pin});assert.equal(result.status,200,JSON.stringify(result));return result.body.token;}
async function enroll(token,name,deviceKind='personal'){
 const key=authenticator(),options=await request('/passkeys/register/options',{pin:'123456',deviceKind,label:name},token);assert.equal(options.status,200,JSON.stringify(options));assert.equal(options.body.options.authenticatorSelection.residentKey,'required');assert.equal(options.body.options.authenticatorSelection.userVerification,'required');
 assert.equal(options.body.options.authenticatorSelection.authenticatorAttachment,deviceKind==='shared'?'cross-platform':'platform');
 assert.deepEqual(options.body.options.pubKeyCredParams,[{alg:-7,type:'public-key'},{alg:-257,type:'public-key'}]);
 const response=key.register(options.body.options,web),verified=await request('/passkeys/register/verify',{requestId:options.body.requestId,response},token);assert.equal(verified.status,200,JSON.stringify(verified));return {key,options,response};
}
async function use(key,{origin=web,signedOrigin=origin,counter=1,flags=5,userHandle,wrongKey=false}={}){
 const options=await request('/passkeys/authenticate/options',{},undefined,origin);assert.equal(options.status,200,JSON.stringify(options));const response=key.assert(options.body.options,signedOrigin,{counter,flags,...(userHandle===undefined?{}:{userHandle}),wrongKey});return {result:await request('/passkeys/authenticate/verify',{requestId:options.body.requestId,response},undefined,origin),options,response};
}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'passkey-test',modules:true,script:fs.readFileSync(process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'panelstock-staging-review',PASSKEY_STAGING_ORIGIN:staging,MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:[web,app,site,staging].join(',')}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify(Object.fromEntries(['admin','alice','bob'].map(name=>[name,{isAdmin:name==='admin',active:true,displayName:name,pinHash:hash(Buffer.from('123456:'+name+':panelstock')).toString('hex')}]))));
 admin=await login('admin');alice=await login('alice');bob=await login('bob');
});after(async()=>{await mf?.dispose();});
test('registration needs a full session and current PIN, and shared setup requests an external authenticator',async()=>{
 assert.equal((await request('/passkeys/register/options',{pin:'123456',deviceKind:'personal'})).status,401);
 assert.equal((await request('/passkeys/register/options',{pin:'wrong',deviceKind:'personal'},alice)).status,403);
 assert.equal((await request('/passkeys/register/options',{pin:'123456',deviceKind:'personal'},alice,'https://evil.test')).status,403);
 const enrolled=await enroll(alice,'My phone');const used=await use(enrolled.key);assert.equal(used.result.status,200,JSON.stringify(used.result));assert.equal(used.result.body.username,'alice');assert.ok(used.result.body.token);
 assert.equal((await request('/passkeys/register/verify',{requestId:enrolled.options.body.requestId,response:enrolled.response},alice)).status,400);
 await enroll(bob,'Security key','shared');
});
test('signature, origin, user verification, account handle, counter and one-use challenges are enforced',async()=>{
 const {key}=await enroll(alice,'Verification tests');
 for(const settings of [{flags:1},{signedOrigin:'https://evil.test'},{wrongKey:true},{userHandle:Buffer.from('another-person').toString('base64url')}])assert.equal((await use(key,settings)).result.status,401,JSON.stringify(settings));
 const success=await use(key,{counter:4});assert.equal(success.result.status,200,JSON.stringify(success));
 assert.equal((await request('/passkeys/authenticate/verify',{requestId:success.options.body.requestId,response:success.response})).status,400);
 assert.equal((await use(key,{counter:3})).result.status,401);
 const cross=await request('/passkeys/authenticate/options');assert.equal((await request('/passkeys/authenticate/verify',{requestId:cross.body.requestId,response:key.assert(cross.body.options,app,{counter:5})},undefined,app)).status,400);
});
test('one passkey works on all three apps and current app access is checked at sign-in',async()=>{
 const {key}=await enroll(alice,'Across apps');for(const [origin,counter] of [[web,1],[app,2],[site,3]]){const used=await use(key,{origin,counter});assert.equal(used.result.status,200,JSON.stringify(used.result));}
 const options=await request('/passkeys/authenticate/options');assert.equal(options.body.options.allowCredentials,undefined);assert.equal(options.body.username,undefined);
 assert.equal((await request('/admin/set-app-access',{targetUsername:'alice',app:'web',allowed:false},admin)).status,200);
 assert.equal((await use(key,{counter:4})).result.status,403);
 assert.equal((await use(key,{origin:site,counter:4})).result.status,200);
 assert.equal((await request('/admin/set-app-access',{targetUsername:'alice',app:'web',allowed:true},admin)).status,200);alice=await login('alice');
});
test('PIN reset revokes passkeys while preserving PIN recovery',async()=>{
 const {key}=await enroll(alice,'Before reset'),link=await request('/admin/reset-pin',{targetUsername:'alice'},admin);assert.equal(link.status,200);
 const reset=await request('/invite/accept',{token:link.body.token,action:'accept',newPin:'654321'});assert.equal(reset.status,200);
 assert.equal((await use(key)).result.status,401);alice=await login('alice','654321');assert.deepEqual((await request('/passkeys/list',{},alice)).body.passkeys,[]);
});
test('owners and admins can remove passkeys, and other users cannot list or revoke them',async()=>{
 const {key}=await enroll(bob,'Removable');const list=await request('/passkeys/list',{},bob);assert.ok(list.body.passkeys.some(item=>item.id===key.id));
 assert.equal((await request('/passkeys/admin/list',{targetUsername:'bob'},alice)).status,403);
 assert.equal((await request('/passkeys/revoke',{id:key.id},alice)).status,404);
 assert.equal((await request('/passkeys/admin/revoke',{targetUsername:'bob',id:key.id},admin)).status,200);assert.equal((await use(key)).result.status,401);
});
test('renaming preserves passkeys, while deactivation and account removal block them',async()=>{
 bob=await login('bob');const {key}=await enroll(bob,'Rename test');
 const renamed=await request('/admin/rename-user',{targetUsername:'bob',newUsername:'bob.new',confirmedSynced:true},admin);assert.equal(renamed.status,200,JSON.stringify(renamed));
 const signIn=await use(key);assert.equal(signIn.result.status,200,JSON.stringify(signIn));assert.equal(signIn.result.body.username,'bob.new');
 assert.equal((await request('/admin/update-user',{targetUsername:'bob.new',displayName:'Bob',active:false,isAdmin:false,roleIds:[]},admin)).status,200);
 assert.equal((await use(key,{counter:2})).result.status,401);
 assert.equal((await request('/admin/update-user',{targetUsername:'bob.new',displayName:'Bob',active:true,isAdmin:false,roleIds:[]},admin)).status,200);
 assert.equal((await use(key,{counter:2})).result.status,200);
 assert.equal((await request('/admin/remove-user',{targetUsername:'bob.new'},admin)).status,200);
 assert.equal((await request('/admin/create-user',{targetUsername:'bob.new',displayName:'Different Bob'},admin)).status,201);
 assert.equal((await use(key,{counter:3})).result.status,401);
});
test('expired challenges are rejected and consumed before verification',async()=>{
 const db=new DatabaseSync(':memory:'),store={sql:{exec(query,...args){const statement=db.prepare(query);const rows=statement.all(...args);return{toArray:()=>rows};}},env:{ALLOWED_ORIGINS:web},consumeLimit(){}};
 initializePasskeys(store);const result=await handlePasskeys(store,'/passkeys/authenticate/options','POST',{},null,'ip',web);db.prepare('UPDATE passkey_challenges SET expires=0').run();
 await assert.rejects(handlePasskeys(store,'/passkeys/authenticate/verify','POST',{requestId:result.requestId,response:{}},null,'ip',web),/expired/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM passkey_challenges').get().n,0);db.close();
});

test('pausing passkeys blocks enrollment, authentication and management even for cached clients',async()=>{
 const store={env:{PASSKEYS_ENABLED:'false'}};
 for(const path of ['/passkeys/authenticate/options','/passkeys/authenticate/verify','/passkeys/register/options','/passkeys/register/verify','/passkeys/list','/passkeys/revoke','/passkeys/admin/list','/passkeys/admin/revoke']){
  await assert.rejects(handlePasskeys(store,path,'POST',{},null,'ip',web),error=>error.status===404&&error.message.includes('username and PIN'),path);
 }
});
test('the isolated staging origin gets its own RP ID and cannot change production relying-party settings',async()=>{
 const staging='https://panelstock-reports-staging.matthewlakerdis.workers.dev',db=new DatabaseSync(':memory:'),store={sql:{exec(query,...args){const rows=db.prepare(query).all(...args);return{toArray:()=>rows};}},env:{SITE_ID:'panelstock-staging-review',ALLOWED_ORIGINS:staging+','+web,PASSKEY_STAGING_ORIGIN:staging},consumeLimit(){}};
 initializePasskeys(store);
 const result=await handlePasskeys(store,'/passkeys/authenticate/options','POST',{app:'site'},null,'ip',staging);assert.equal(result.options.rpId,new URL(staging).hostname);
 const production=await handlePasskeys(store,'/passkeys/authenticate/options','POST',{app:'site'},null,'ip',web);assert.equal(production.options.rpId,'panelstockhq.com');
 store.env.SITE_ID='panelstock';await assert.rejects(handlePasskeys(store,'/passkeys/authenticate/options','POST',{app:'site'},null,'ip',staging),/secure PanelStock app/);db.close();
});

test('staging enrollment and sign-in use staging credentials, which cannot be reused for the live RP',async()=>{
 const key=authenticator();const options=await request('/passkeys/register/options',{pin:'654321',deviceKind:'shared',label:'Staging phone',app:'web'},alice,staging);assert.equal(options.status,200,JSON.stringify(options));assert.equal(options.body.options.rp.id,new URL(staging).hostname);
 assert.equal((await request('/passkeys/register/verify',{app:'web',requestId:options.body.requestId,response:key.register(options.body.options,staging)},alice,staging)).status,200);
 const authentication=await request('/passkeys/authenticate/options',{app:'web'},undefined,staging);const result=await request('/passkeys/authenticate/verify',{app:'web',requestId:authentication.body.requestId,response:key.assert(authentication.body.options,staging)},undefined,staging);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.username,'alice');
 const live=await use(key,{counter:2});assert.equal(live.result.status,401);
});

test('password-manager setup allows configured providers while preserving PIN, user verification and one-use challenges',async()=>{
 const body={pin:'123456',deviceKind:'personal',setupMethod:'password-manager',label:'My password manager'};
 assert.equal((await request('/passkeys/register/options',{...body,deviceKind:'shared'},admin)).status,400);
 assert.equal((await request('/passkeys/register/options',{...body,setupMethod:'unknown'},admin)).status,400);
 assert.equal((await request('/passkeys/register/options',{...body,pin:'wrong'},admin)).status,403);
 const key=authenticator(),first=await request('/passkeys/register/options',body,admin);assert.equal(first.status,200,JSON.stringify(first));
 const options=first.body.options;
 assert.equal(options.authenticatorSelection.authenticatorAttachment,undefined);
 assert.equal(options.authenticatorSelection.residentKey,'required');assert.equal(options.authenticatorSelection.requireResidentKey,true);assert.equal(options.authenticatorSelection.userVerification,'required');
 assert.deepEqual(options.hints,[]);assert.deepEqual(options.pubKeyCredParams,[{alg:-7,type:'public-key'},{alg:-257,type:'public-key'}]);
 const unverified={requestId:first.body.requestId,response:key.register(options,web,{flags:0x41})};
 assert.equal((await request('/passkeys/register/verify',unverified,admin)).status,400);
 assert.deepEqual((await request('/passkeys/list',{},admin)).body.passkeys,[]);
 assert.equal((await request('/passkeys/register/verify',unverified,admin)).status,400);
 const fresh=await request('/passkeys/register/options',body,admin);assert.equal(fresh.status,200,JSON.stringify(fresh));assert.notEqual(fresh.body.requestId,first.body.requestId);
 const response=key.register(fresh.body.options,web);response.authenticatorAttachment='cross-platform';
 const verified=await request('/passkeys/register/verify',{requestId:fresh.body.requestId,response},admin);assert.equal(verified.status,200,JSON.stringify(verified));
 const used=await use(key);assert.equal(used.result.status,200,JSON.stringify(used));assert.equal(used.result.body.username,'admin');
 const listed=(await request('/passkeys/list',{},admin)).body.passkeys;assert.equal(listed.length,1);assert.equal(listed[0].deviceKind,'personal');
});
