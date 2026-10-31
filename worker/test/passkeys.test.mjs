import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {DatabaseSync} from 'node:sqlite';
import {authenticator,hash} from './passkey-fixture.mjs';
import {initializePasskeys,handlePasskeys} from '../src/passkeys.js';
const web='https://web.panelstockhq.com',app='https://app.panelstockhq.com',site='https://site.panelstockhq.com';let mf,admin,alice,bob,requestCount=0;
async function request(path,body={},token,origin=web){const response=await mf.dispatchFetch('https://worker.test'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.'+(++requestCount),...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
async function login(name,pin='123456'){const result=await request('/login',{username:name,pin});assert.equal(result.status,200,JSON.stringify(result));return result.body.token;}
async function enroll(token,name,deviceKind='personal'){
 const key=authenticator(),options=await request('/passkeys/register/options',{pin:'123456',deviceKind,label:name},token);assert.equal(options.status,200,JSON.stringify(options));assert.equal(options.body.options.authenticatorSelection.residentKey,'required');assert.equal(options.body.options.authenticatorSelection.userVerification,'required');
 if(deviceKind==='shared')assert.equal(options.body.options.authenticatorSelection.authenticatorAttachment,'cross-platform');
 const response=key.register(options.body.options,web),verified=await request('/passkeys/register/verify',{requestId:options.body.requestId,response},token);assert.equal(verified.status,200,JSON.stringify(verified));return {key,options,response};
}
async function use(key,{origin=web,signedOrigin=origin,counter=1,flags=5,userHandle,wrongKey=false}={}){
 const options=await request('/passkeys/authenticate/options',{},undefined,origin);assert.equal(options.status,200,JSON.stringify(options));const response=key.assert(options.body.options,signedOrigin,{counter,flags,...(userHandle===undefined?{}:{userHandle}),wrongKey});return {result:await request('/passkeys/authenticate/verify',{requestId:options.body.requestId,response},undefined,origin),options,response};
}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'passkey-test',modules:true,script:fs.readFileSync(process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'passkey-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:[web,app,site].join(',')}}]}));
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
