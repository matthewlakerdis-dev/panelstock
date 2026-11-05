import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Keep a literal origin: this verifier cannot be redirected at a live service.
const TEST_ORIGIN='https://panelstock-attendance-ios10-test.matthewlakerdis.workers.dev';
const config=JSON.parse(await fs.readFile(new URL('../wrangler.attendance-ios10-test.jsonc',import.meta.url),'utf8'));
assert.equal(config.name,'panelstock-attendance-ios10-test');
assert.equal(config.main,'src/attendance-ios10-test.js');
assert.equal(config.workers_dev,true);
assert.deepEqual(config.vars,{ATTENDANCE_TEST_ENV:'ios10',SITE_ID:'attendance-ios10-test',MIGRATION_READY:'false',EMAIL_ENABLED:'false',READ_ONLY:'false',ALLOWED_ORIGINS:''});
assert.deepEqual(config.durable_objects,{bindings:[{name:'INVENTORY',class_name:'AttendanceIos10TestStore'}]});
assert.deepEqual(config.migrations,[{tag:'attendance-ios10-test-v1',new_sqlite_classes:['AttendanceIos10TestStore']}]);
assert.deepEqual(config.assets,{directory:'./dist-attendance-ios10',binding:'ATTENDANCE_TEST_ASSETS',run_worker_first:true,html_handling:'none'});
const configKeys=new Set(['$schema','name','main','compatibility_date','compatibility_flags','workers_dev','preview_urls','assets','vars','durable_objects','migrations']);
assert.ok(Object.keys(config).every(key=>configKeys.has(key)),'Test configuration must not contain KV, R2, routes, cron or environment overrides');
console.log('Verified dedicated test Worker, isolated SQLite class, asset binding and disabled imports/email.');
if(process.argv.includes('--config-only'))process.exit(0);
assert.equal(process.argv.length,2,'The test verifier does not accept a target URL');

async function request(path,{body,token,expected=200,html=false,binary=false,method=body===undefined?'GET':'POST'}={}){
  const response=await fetch(TEST_ORIGIN+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(response.status,expected,'Test endpoint '+path+' returned an unexpected status');
  assert.equal(response.headers.get('X-Attendance-Environment'),'ios10-test','Dedicated test response marker missing');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  if(html)return {response,text:await response.text()};
  if(binary)return {response,bytes:Buffer.from(await response.arrayBuffer())};
  try{return await response.json();}catch{throw Error('Test endpoint '+path+' did not return JSON');}
}
function verifyHomeScreenMetadata(html,path){
  const metaTags=html.match(/<meta\b[^>]*>/gi)||[];
  for(const [name,value] of [['apple-mobile-web-app-capable','yes'],['apple-mobile-web-app-title','Lennox Test'],['apple-mobile-web-app-status-bar-style','default']]){
    assert.ok(metaTags.some(tag=>tag.includes('name="'+name+'"')&&tag.includes('content="'+value+'"')),'Home Screen metadata missing: '+name);
  }
  const iconTag=(html.match(/<link\b[^>]*>/gi)||[]).find(tag=>tag.includes('rel="apple-touch-icon"'));
  const href=iconTag?.match(/\bhref="([^"]+)"/)?.[1];
  assert.equal(href,'/sign-in/apple-touch-icon.png','Dedicated Home Screen icon link missing');
  assert.equal(new URL(href,TEST_ORIGIN+path).origin,TEST_ORIGIN,'Home Screen icon must use the isolated test origin');
}
const expectedIcon=await fs.readFile(new URL('../../icon-adaptive-v4-192.png',import.meta.url));

// Deployment propagation can take a few seconds. Retry read-only readiness only.
let ready=false;
for(let attempt=0;attempt<6;attempt++){
  try{
    const health=await request('/health');
    assert.deepEqual(health,{ok:true,environment:'ios10-test',siteId:'attendance-ios10-test',productionData:false});
    for(const path of ['/sign-in','/sign-in/','/sign-in/manage','/sign-in/manage/']){
      const page=await request(path,{html:true});
      assert.ok(page.text.includes('iOS 10 compatibility test'),'Test banner missing');
      const policy=page.response.headers.get('Content-Security-Policy');
      assert.ok(policy?.includes("script-src 'sha256-"),'Hashed script CSP missing');
      assert.match(policy,/(?:^|;)\s*img-src 'self' data:(?:;|$)/,'CSP must allow the same-origin Home Screen icon');
      if(path.includes('manage'))assert.ok(page.text.includes('ipadtest')&&page.text.includes('103434'),'Demo account notice missing');
      else verifyHomeScreenMetadata(page.text,path);
    }
    for(const path of ['/sign-in/apple-touch-icon.png','/apple-touch-icon.png']){
      const icon=await request(path,{binary:true});
      assert.equal(icon.response.headers.get('Content-Type'),'image/png');
      assert.equal(icon.response.headers.get('X-Content-Type-Options'),'nosniff');
      assert.deepEqual([...icon.bytes.subarray(0,8)],[137,80,78,71,13,10,26,10],'Home Screen icon must be a PNG');
      assert.equal(icon.bytes.toString('ascii',12,16),'IHDR');
      assert.equal(icon.bytes.readUInt32BE(16),192);assert.equal(icon.bytes.readUInt32BE(20),192);
      assert.deepEqual(icon.bytes,expectedIcon,'Home Screen icon must match the existing Lennox artwork');
      const head=await request(path,{method:'HEAD',binary:true});
      assert.equal(head.response.headers.get('Content-Type'),'image/png');assert.equal(head.bytes.length,0);
    }
    ready=true;
    break;
  }catch(error){if(attempt===5)throw error;await new Promise(resolve=>setTimeout(resolve,5000));}
}
assert.ok(ready);
for(const path of ['/sign-in/apple-touch-icon.png','/apple-touch-icon.png'])await request(path,{body:{},expected:404});
console.log('Verified test health, banners, Home Screen metadata, Lennox PNG icon routes and page security headers.');

let token,kioskToken,entryId;
try{
  const login=await request('/login',{body:{username:'ipadtest',pin:'103434'}});
  assert.ok(login.ok&&login.isAdmin&&/^[a-f0-9]{64}$/.test(login.token),'Demo login failed');
  token=login.token;
  const session=await request('/session',{token});
  assert.ok(session.isAdmin&&session.username==='ipadtest','Wrong test account');
  const register=await request('/attendance/register',{token});
  assert.ok(register.ok&&Array.isArray(register.entries),'Isolated register unavailable');
  await request('/data',{expected:404});
  if(register.kioskConfigured){
    // Never rotate an existing test iPad's pairing during a compatibility update.
    console.log('Verified demo login, isolated register and route restrictions. Existing test station preserved; pairing and synthetic attendance checks skipped.');
  }else{
    const kiosk=await request('/attendance/kiosk',{body:{},token});
    kioskToken=kiosk.kioskToken;
    assert.ok(/^[a-f0-9]{64}$/.test(kioskToken),'Test station pairing failed');
    const signedIn=await request('/attendance/check-in',{body:{kioskToken,requestId:randomUUID(),type:'visitor',name:'iPad compatibility test '+randomUUID().slice(0,8),company:'Made-up test company',host:'Test host',purpose:'Compatibility check'}});
    entryId=signedIn.entry?.id;
    assert.ok(entryId,'Synthetic arrival failed');
    const roster=await request('/attendance/lookup',{body:{kioskToken}});
    assert.ok(roster.entries.some(entry=>entry.id===entryId),'Synthetic arrival missing from sign-out roster');
    const signedOut=await request('/attendance/check-out',{body:{kioskToken,id:entryId,requestId:randomUUID()}});
    assert.ok(signedOut.entry?.signedOutAt,'Synthetic departure failed');
    entryId=undefined;
    const after=await request('/attendance/lookup',{body:{kioskToken}});
    assert.ok(!after.entries.some(entry=>entry.id===signedIn.entry.id),'Signed-out test visitor remains in roster');
    console.log('Verified demo login, isolated register, first station pairing, synthetic sign-in, sign-out roster and departure. Tokens were not logged.');
  }
}finally{
  // Keep even a failed smoke check from leaving its made-up visitor signed in.
  if(entryId&&token)await request('/attendance/admin-check-out',{body:{id:entryId},token}).catch(()=>{});
  if(token)await request('/logout',{body:{},token}).catch(()=>{});
}
