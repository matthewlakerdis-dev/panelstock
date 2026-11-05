import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {legacyAttendancePage} from '../scripts/build-attendance-ios10.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {digest} from '../src/security.js';
import {initializeAttendance,handlePublicAttendance,handleAttendanceAdmin,attendanceBackup} from '../src/attendance.js';
import {initializeIos10Install,handleIos10Install,expireIos10InstallCodes} from '../src/attendance-ios10-install.js';
import {normalizeIos10Visit} from '../src/attendance-ios10-fields.js';

const configPath=new URL('../wrangler.attendance-ios10-test.jsonc',import.meta.url);
const config=JSON.parse(readFileSync(configPath,'utf8'));
const script=process.env.ATTENDANCE_IOS10_TEST_BUNDLE
  ?readFileSync(process.env.ATTENDANCE_IOS10_TEST_BUNDLE,'utf8')
  :(await build({entryPoints:[new URL('../src/attendance-ios10-test.js',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',external:['cloudflare:workers'],write:false,banner:{js:"import {createRequire} from 'node:module'; var require=createRequire('/worker/attendance-test.js');"}})).outputFiles[0].text;
const iconBytes=readFileSync(new URL('../../icon-adaptive-v4-192.png',import.meta.url));
const assets=new Map([
  ['/index.html',{body:legacyAttendancePage(),contentType:'text/html'}],
  ['/manage/index.html',{body:legacyAttendancePage(true),contentType:'text/html'}],
  ['/apple-touch-icon.png',{body:iconBytes,contentType:'image/png'}]
]);
function options({bindings={},storage=true,brokenAssets=false,assetOverrides=new Map(),assetRequests=[]}={}){
  return convertV4MiniflareOptions({workers:[{name:'attendance-ios10-test',modules:true,script,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
    ...(storage?{durableObjects:{INVENTORY:{className:'AttendanceIos10TestStore',useSQLite:true}}}:{}),
    bindings:{...config.vars,...bindings},
    serviceBindings:{ATTENDANCE_TEST_ASSETS:async request=>{
      const url=new URL(request.url),path=url.pathname;
      assetRequests.push({path,search:url.search,method:request.method});
      const asset=assetOverrides.has(path)?assetOverrides.get(path):assets.get(path);
      return new Response(brokenAssets?'Unbuilt page':asset?.body||'Not found',{status:asset?200:404,headers:{'Content-Type':brokenAssets?'text/html':asset?.contentType||'text/plain'}});
    }}
  }]});
}
async function api(mf,path,body,token,headers={}){
  const response=await mf.dispatchFetch('https://ios10.test'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,headers:response.headers,body:await response.json()};
}
async function login(mf){
  const result=await api(mf,'/login',{username:'ipadtest',pin:'103434'});
  assert.equal(result.status,200);assert.equal(result.body.isAdmin,true);assert.match(result.body.token,/^[a-f0-9]{64}$/);
  return result.body.token;
}

test('iOS 10 test configuration can deploy only its separate Worker and SQLite class',()=>{
  execFileSync(process.execPath,[new URL('../scripts/verify-attendance-ios10-test.mjs',import.meta.url).pathname,'--config-only'],{stdio:'pipe'});
  const workflow=readFileSync(new URL('../../.github/workflows/deploy-attendance-ios10-test.yml',import.meta.url),'utf8');
  assert.match(workflow,/branches: \[codex\/attendance-ios10-test\]/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/codex\/attendance-ios10-test'/);
  assert.doesNotMatch(workflow,/workflow_dispatch|wrangler\.production|branches: \[main\]/);
  assert.match(workflow,/deploy --config wrangler\.attendance-ios10-test\.jsonc\n/);
});

test('iOS 10 test environment guard rejects unsafe configuration before any storage access',async()=>{
  for(const bindings of [{SITE_ID:'panelstock'},{ATTENDANCE_TEST_ENV:'production'},{MIGRATION_READY:'true'},{EMAIL_ENABLED:'true'},{READ_ONLY:'true'},{ALLOWED_ORIGINS:'https://web.panelstockhq.com'},{LEGACY_KV:'accidental-live-binding'},{CAD_PROJECT_FILES:'accidental-live-binding'},{MONTHLY_AUDIT_RESET_ID:'unexpected-reset'}]){
    const mf=new Miniflare(options({bindings,storage:false}));
    try{
      for(const path of ['/health','/sign-in/manage','/sign-in/apple-touch-icon.png','/login','/attendance/install-code','/attendance/install-pair']){
        const result=await api(mf,path,path==='/login'?{username:'ipadtest',pin:'103434'}:path.startsWith('/attendance/install-')?{}:undefined);
        assert.equal(result.status,503,JSON.stringify(bindings));
        assert.equal(result.headers.get('X-Attendance-Environment'),'ios10-test');
        assert.match(result.body.error,/test configuration required/);
      }
    }finally{await mf.dispose();}
  }
});

test('iOS 10 test page routes serve only compiled assets and their hash policy',async()=>{
  const mf=new Miniflare(options({storage:false}));
  try{
    const root=await mf.dispatchFetch('https://ios10.test/',{redirect:'manual'});
    assert.equal(root.status,302);assert.equal(root.headers.get('Location'),'/sign-in/manage');
    assert.deepEqual((await api(mf,'/health')).body,{ok:true,environment:'ios10-test',siteId:'attendance-ios10-test',productionData:false});
    for(const path of ['/sign-in','/sign-in/','/sign-in/manage','/sign-in/manage/']){
      const response=await mf.dispatchFetch('https://ios10.test'+path+'?preview=true'),html=await response.text();
      assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
      assert.equal(response.headers.get('X-Attendance-Environment'),'ios10-test');
      assert.equal(html,assets.get(path.includes('manage')?'/manage/index.html':'/index.html').body);
      const meta=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
      assert.equal(response.headers.get('Content-Security-Policy'),meta+"; frame-ancestors 'none'");
      assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
    }
    for(const path of ['/data','/set-pin','/session/full','/admin/backup-now','/sign-in/index.html','/manage/index.html','/index.html','/toolbox','/attendance/unrecognized'])assert.equal((await api(mf,path)).status,404,path);
    assert.equal((await mf.dispatchFetch('https://ios10.test/sign-in',{method:'POST'})).status,404);
  }finally{await mf.dispose();}
  const broken=new Miniflare(options({storage:false,brokenAssets:true}));
  try{assert.equal((await api(broken,'/sign-in/manage')).status,503);}finally{await broken.dispose();}
});

test('iOS 10 Home Screen icon routes serve only the dedicated Lennox PNG without sign-in',async()=>{
  const assetRequests=[],assetOverrides=new Map();
  const mf=new Miniflare(options({storage:false,assetRequests,assetOverrides}));
  try{
    assert.deepEqual([...iconBytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(iconBytes.toString('ascii',12,16),'IHDR');
    assert.equal(iconBytes.readUInt32BE(16),192);assert.equal(iconBytes.readUInt32BE(20),192);
    for(const path of ['/sign-in/apple-touch-icon.png','/apple-touch-icon.png']){
      const response=await mf.dispatchFetch('https://ios10.test'+path+'?install=1');
      assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');
      assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Attendance-Environment'),'ios10-test');
      assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),iconBytes);
      const head=await mf.dispatchFetch('https://ios10.test'+path,{method:'HEAD'});
      assert.equal(head.status,200);assert.equal(head.headers.get('Content-Type'),'image/png');
      assert.equal(head.headers.get('Content-Length'),String(iconBytes.length));assert.equal(await head.text(),'');
      assert.equal((await api(mf,path,{})).status,404,'Icon accepts only GET and HEAD');
    }
    assert.deepEqual(assetRequests,Array.from({length:4},()=>({path:'/apple-touch-icon.png',search:'',method:'GET'})));
    for(const path of ['/sign-in/manage/apple-touch-icon.png','/manage/apple-touch-icon.png','/icon-adaptive-v4-192.png','/sign-in/other.png']){
      assert.equal((await api(mf,path)).status,404,'Other assets must remain private');
    }
    const badSignature=Buffer.from(iconBytes);badSignature[0]=0;
    const badDimensions=Buffer.from(iconBytes);badDimensions.writeUInt32BE(180,16);
    for(const bad of [null,{body:'<html>fallback</html>',contentType:'text/html'},{body:'not a PNG',contentType:'image/png'},{body:badSignature,contentType:'image/png'},{body:badDimensions,contentType:'image/png'}]){
      assetOverrides.set('/apple-touch-icon.png',bad);
      const result=await api(mf,'/sign-in/apple-touch-icon.png');
      assert.equal(result.status,503);assert.match(result.body.error,/test icon build/i);
    }
  }finally{await mf.dispose();}
});

test('iOS 10 test database seeds only the demo administrator and supports the whole isolated attendance flow',async()=>{
  const mf=new Miniflare(options());
  try{
    assert.equal((await api(mf,'/login',{username:'existing-live-admin',pin:'103434'})).status,401);
    assert.equal((await api(mf,'/login',{username:'ipadtest',pin:'wrong-pin'})).status,401);
    const token=await login(mf);
    const session=await api(mf,'/session',undefined,token);
    assert.equal(session.status,200);assert.equal(session.body.username,'ipadtest');
    const fresh=await api(mf,'/attendance/register',undefined,token);
    assert.equal(fresh.status,200);assert.deepEqual(fresh.body.entries,[]);assert.equal(fresh.body.kioskConfigured,false);
    const kioskToken=(await api(mf,'/attendance/kiosk',{},token)).body.kioskToken;
    assert.match(kioskToken,/^[a-f0-9]{64}$/);
    const signedIn=[];
    for(const [name,type] of [['Zed Visitor','visitor'],['Amy Contractor','contractor'],['Pat Employee','employee']]){
      const body={kioskToken,requestId:crypto.randomUUID(),type,name,company:'Made-up company',contact:'test@example.invalid',host:'Demo host',purpose:'Compatibility testing'};
      const result=await api(mf,'/attendance/check-in',body);
      assert.equal(result.status,200);signedIn.push(result.body.entry);
      assert.equal((await api(mf,'/attendance/check-in',body)).body.entry.id,result.body.entry.id,'Retries must not duplicate entries');
    }
    const register=await api(mf,'/attendance/register',undefined,token);
    assert.deepEqual(register.body.counts,{active:3,visitors:1,contractors:1,employees:1});
    assert.ok(register.body.entries.every(entry=>entry.purpose===''&&entry.contact==='test@example.invalid'&&entry.host==='Demo host'));
    assert.equal(register.body.entries.find(entry=>entry.type==='employee').company,'');
    const roster=await api(mf,'/attendance/lookup',{kioskToken});
    assert.deepEqual(roster.body.entries.map(entry=>entry.name),['Amy Contractor','Pat Employee','Zed Visitor']);
    assert.ok(roster.body.entries.every(entry=>!('contact' in entry)&&!('host' in entry)&&!('purpose' in entry)));
    const departure=await api(mf,'/attendance/check-out',{kioskToken,id:signedIn[0].id,requestId:crypto.randomUUID()});
    assert.equal(departure.status,200);assert.ok(departure.body.entry.signedOutAt);
    assert.equal((await api(mf,'/attendance/lookup',{kioskToken})).body.entries.length,2);
    assert.equal((await api(mf,'/attendance/register',undefined,kioskToken)).status,401);
    assert.equal((await api(mf,'/attendance/lookup',{kioskToken},{},{Origin:'https://untrusted.example'})).status,403);
    const second=await login(mf);
    assert.equal((await api(mf,'/attendance/register',undefined,second)).body.entries.length,3,'Later login must not reseed or erase the test register');
    await api(mf,'/logout',{},token);
    assert.equal((await api(mf,'/session',undefined,token)).status,401);
  }finally{await mf.dispose();}
  const separate=new Miniflare(options());
  try{
    const token=await login(separate),register=await api(separate,'/attendance/register',undefined,token);
    assert.deepEqual(register.body.entries,[],'A new namespace must never copy the other test database');
    assert.equal(register.body.kioskConfigured,false);
  }finally{await separate.dispose();}
});

test('iOS 10 new arrivals require role-specific fields before writes and retain employee host and optional contact',async()=>{
  const mf=new Miniflare(options());
  try{
    const admin=await login(mf),kioskToken=(await api(mf,'/attendance/kiosk',{},admin)).body.kioskToken;
    const base={kioskToken,type:'visitor',name:'Test Visitor',company:'Made-up company',host:'Site Contact'};
    assert.equal((await api(mf,'/attendance/check-in',{...base,kioskToken:'invalid',requestId:crypto.randomUUID(),name:'',host:''})).status,401,'Kiosk authorization precedes field validation');
    for(const type of ['visitor','contractor','employee']){
      for(const field of type==='employee'?['name','host']:['name','company','host']){
        for(const value of [undefined,'   ']){
          const result=await api(mf,'/attendance/check-in',{...base,type,[field]:value,requestId:crypto.randomUUID()});
          assert.equal(result.status,400,type+' '+field);assert.match(result.body.error,/is required/);
        }
      }
      for(const patch of [{name:'n'.repeat(121)},{host:'h'.repeat(121)},{contact:'c'.repeat(161)},{contact:{}},{contact:'bad\u0001contact'}]){
        assert.equal((await api(mf,'/attendance/check-in',{...base,type,...patch,requestId:crypto.randomUUID()})).status,400);
      }
    }
    for(const type of ['visitor','contractor'])for(const company of ['c'.repeat(161),{},'bad\u0001company']){
      assert.equal((await api(mf,'/attendance/check-in',{...base,type,company,requestId:crypto.randomUUID()})).status,400);
    }
    assert.deepEqual((await api(mf,'/attendance/register',undefined,admin)).body.entries,[],'Rejected forms must not create attendance records');
    const visitor=await api(mf,'/attendance/check-in',{...base,requestId:crypto.randomUUID(),name:'  Test  Visitor  ',company:'  Made-up  company  ',host:'  Site  Contact  ',purpose:{stale:'ignored'}});
    assert.equal(visitor.status,200);
    const employeeBody={...base,requestId:crypto.randomUUID(),type:'employee',name:'  Test  Employee ',company:{stale:'ignored'},contact:'  employee@example.invalid  ',host:'  Employee  Host  ',purpose:'obsolete reason'};
    const employee=await api(mf,'/attendance/check-in',employeeBody);assert.equal(employee.status,200);
    const retry=await api(mf,'/attendance/check-in',{...employeeBody,company:['different stale company'],purpose:{different:'ignored'}});
    assert.equal(retry.status,200);assert.equal(retry.body.entry.id,employee.body.entry.id);assert.equal(retry.body.duplicate,true);
    assert.equal((await api(mf,'/attendance/check-in',{...base,requestId:crypto.randomUUID(),type:'contractor',name:'Test Contractor'})).status,200);
    const entries=(await api(mf,'/attendance/register',undefined,admin)).body.entries;
    const savedVisitor=entries.find(entry=>entry.id===visitor.body.entry.id),savedEmployee=entries.find(entry=>entry.id===employee.body.entry.id);
    assert.equal(savedVisitor.name,'Test Visitor');assert.equal(savedVisitor.company,'Made-up company');assert.equal(savedVisitor.host,'Site Contact');assert.equal(savedVisitor.contact,'');
    assert.equal(savedEmployee.name,'Test Employee');assert.equal(savedEmployee.company,'');assert.equal(savedEmployee.host,'Employee Host');assert.equal(savedEmployee.contact,'employee@example.invalid');
    assert.ok(entries.every(entry=>entry.purpose===''));assert.equal(entries.length,3);
  }finally{await mf.dispose();}
});

function installFixture(){
  const db=new DatabaseSync(':memory:'),alarms=[],limits=[];
  db.exec('CREATE TABLE limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)');
  const store={sql:{exec(query,...params){const statement=db.prepare(query);if(!statement.columns().length){statement.run(...params);return {toArray:()=>[]};}return {toArray:()=>statement.all(...params)};}},ctx:{storage:{transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},async setAlarm(at){alarms.push(at);}}},consumeLimit:(...args)=>limits.push(args)};
  initializeAttendance(store);initializeIos10Install(store);
  return {db,store,alarms,limits,
    async station(token){db.prepare('INSERT INTO attendance_settings(id,kiosk_hash,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET kiosk_hash=excluded.kiosk_hash').run(await digest(token),new Date().toISOString());},
    issue:kioskToken=>handleIos10Install(store,'/attendance/install-code',{kioskToken},'fixture-ip'),
    redeem:code=>handleIos10Install(store,'/attendance/install-pair',{code},'fixture-ip')
  };
}

test('iOS 10 field policy leaves historical register and backup fields intact and the production validator unchanged',async()=>{
  const f=installFixture(),token='d'.repeat(64);
  f.store.audit=()=>{};
  const arrive=(body,normalizer)=>handlePublicAttendance(f.store,'/attendance/check-in',{kioskToken:token,requestId:crypto.randomUUID(),...body},'fixture-ip',normalizer);
  try{
    await f.station(token);
    const historical={type:'visitor',name:'Historical Visitor',company:'',contact:'historical@example.invalid',host:'Historical Host',purpose:'Historical reason'};
    await arrive(historical);
    await arrive({type:'employee',name:'Historical Employee',company:'Historical Company',contact:'old@example.invalid',host:'',purpose:'Old employee note'});
    const before=attendanceBackup(f.store).entries;
    await assert.rejects(arrive({...historical,name:'Production purpose required',purpose:''}),error=>error.status===400&&/Purpose/.test(error.message));
    await assert.rejects(arrive({...historical,name:'New test company required'},normalizeIos10Visit),error=>error.status===400&&/Company/.test(error.message));
    await arrive({type:'employee',name:'New Test Employee',company:'Ignored company',contact:'new@example.invalid',host:'New Host',purpose:'Ignored reason'},normalizeIos10Visit);
    const register=(await handleAttendanceAdmin(f.store,'/attendance/register','GET',{}, {username:'admin',isAdmin:true})).body;
    for(const entry of before)assert.deepEqual(register.entries.find(saved=>saved.id===entry.id),entry);
    const after=attendanceBackup(f.store).entries;
    assert.deepEqual(after.slice(0,before.length),before,'Existing export and backup source records are unchanged');
    assert.equal(after.at(-1).purpose,'');assert.equal(after.at(-1).company,'');assert.equal(after.at(-1).contact,'new@example.invalid');assert.equal(after.at(-1).host,'New Host');
  }finally{f.db.close();}
});

test('iOS 10 setup codes expire after ten minutes, replace earlier codes, and are removed by their alarm',async()=>{
  const f=installFixture(),token='a'.repeat(64);
  try{
    await f.station(token);
    const before=Date.now(),first=await f.issue(token),expires=Date.parse(first.expiresAt);
    assert.deepEqual(Object.keys(first).sort(),['code','expiresAt','ok']);assert.equal(first.ok,true);assert.match(first.code,/^\d{8}$/);
    assert.ok(expires>=before+10*60000&&expires<=Date.now()+10*60000);assert.equal(f.alarms.at(-1),expires);
    const row=f.db.prepare('SELECT * FROM attendance_ios10_install_codes').get();
    assert.equal(row.code_hash,await digest('ios10-install:'+first.code));assert.notEqual(row.code_hash,first.code);
    assert.equal(row.kiosk_hash,await digest(token));assert.equal(row.kiosk_token,token);
    const second=await f.issue(token);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_ios10_install_codes').get().n,1);
    await assert.rejects(f.redeem(first.code),error=>error.status===401);
    f.db.prepare('UPDATE attendance_ios10_install_codes SET expires=?').run(Date.now()-1);
    await assert.rejects(f.redeem(second.code),error=>error.status===401);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_ios10_install_codes').get().n,0);
    await f.issue(token);await expireIos10InstallCodes(f.store);assert.ok(f.alarms.at(-1)>Date.now());
    f.db.prepare('UPDATE attendance_ios10_install_codes SET expires=?').run(Date.now()-1);
    await expireIos10InstallCodes(f.store);assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_ios10_install_codes').get().n,0);
    assert.ok(!JSON.stringify(f.limits).includes(token),'Raw tokens must not appear in rate-limit keys');
  }finally{f.db.close();}
});

test('iOS 10 code redemption is atomic and station rotation or revocation wins races with hashing',async()=>{
  const f=installFixture(),first='b'.repeat(64),second='c'.repeat(64);
  try{
    await f.station(first);
    const code=await f.issue(first),results=await Promise.allSettled([f.redeem(code.code),f.redeem(code.code)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(results.find(result=>result.status==='fulfilled').value.kioskToken,first);
    assert.equal(results.find(result=>result.status==='rejected').reason.status,401);
    const old=await f.issue(first);await f.station(second);
    await assert.rejects(f.redeem(old.code),error=>error.status===401);await assert.rejects(f.issue(first),error=>error.status===401);
    const pendingIssue=f.issue(second);
    f.db.prepare('DELETE FROM attendance_settings').run();
    await assert.rejects(pendingIssue,error=>error.status===401);
    await f.station(second);const pendingCode=await f.issue(second),pendingRedemption=f.redeem(pendingCode.code);
    f.db.prepare('DELETE FROM attendance_settings').run();
    await assert.rejects(pendingRedemption,error=>error.status===401);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_ios10_install_codes').get().n,0);
  }finally{f.db.close();}
});

test('iOS 10 installed apps redeem setup codes without rotating or losing the existing station',async()=>{
  const mf=new Miniflare(options());
  try{
    const admin=await login(mf),kioskToken=(await api(mf,'/attendance/kiosk',{},admin)).body.kioskToken;
    for(const path of ['/attendance/install-code','/attendance/install-pair']){
      assert.equal((await api(mf,path)).status,404,'Setup credentials are never accepted by GET');
      const optionsResponse=await mf.dispatchFetch('https://ios10.test'+path,{method:'OPTIONS',headers:{Origin:'https://ios10.test'}});
      assert.equal(optionsResponse.status,200);assert.equal(optionsResponse.headers.get('X-Attendance-Environment'),'ios10-test');
      assert.equal((await api(mf,path,{kioskToken,code:'12345678'},undefined,{Origin:'https://untrusted.example'})).status,403);
    }
    assert.equal((await api(mf,'/attendance/install-code',{kioskToken:admin})).status,401,'Admin sessions are not kiosk credentials');
    const issued=await api(mf,'/attendance/install-code',{kioskToken});
    assert.equal(issued.status,200);assert.match(issued.body.code,/^\d{8}$/);assert.ok(Date.parse(issued.body.expiresAt)>Date.now());
    assert.equal(issued.headers.get('Cache-Control'),'no-store');assert.equal(issued.headers.get('X-Attendance-Environment'),'ios10-test');
    const paired=await api(mf,'/attendance/install-pair',{code:issued.body.code});
    assert.equal(paired.status,200);assert.deepEqual(paired.body,{ok:true,kioskToken});
    assert.equal((await api(mf,'/attendance/install-pair',{code:issued.body.code})).status,401);
    assert.equal((await api(mf,'/attendance/lookup',{kioskToken})).status,200,'Original Safari station remains paired');
    const previous=await api(mf,'/attendance/install-code',{kioskToken});
    const rotated=(await api(mf,'/attendance/kiosk',{},admin)).body.kioskToken;
    assert.equal((await api(mf,'/attendance/install-pair',{code:previous.body.code})).status,401);
    const revoked=await api(mf,'/attendance/install-code',{kioskToken:rotated});
    await api(mf,'/attendance/kiosk/revoke',{},admin);
    assert.equal((await api(mf,'/attendance/install-pair',{code:revoked.body.code})).status,401);
  }finally{await mf.dispose();}
});

test('iOS 10 setup code issuance and failed guesses have persistent station, IP and site limits',async()=>{
  const mf=new Miniflare(options());
  try{
    const admin=await login(mf),kioskToken=(await api(mf,'/attendance/kiosk',{},admin)).body.kioskToken;
    let issued;
    for(let i=0;i<5;i++){
      issued=await api(mf,'/attendance/install-code',{kioskToken});assert.equal(issued.status,200);
    }
    assert.equal((await api(mf,'/attendance/install-code',{kioskToken})).status,429,'A station can issue at most five codes per ten minutes');
    for(let i=0;i<5;i++){
      assert.equal((await api(mf,'/attendance/install-pair',{code:i===0?12345678:'invalid'},undefined,{'CF-Connecting-IP':'guessing-ip'})).status,400);
    }
    assert.equal((await api(mf,'/attendance/install-pair',{code:issued.body.code},undefined,{'CF-Connecting-IP':'guessing-ip'})).status,429,'Failed guesses block further attempts from that IP');
    const valid=await api(mf,'/attendance/install-pair',{code:issued.body.code},undefined,{'CF-Connecting-IP':'new-ip'});
    assert.equal(valid.status,200);assert.equal(valid.body.kioskToken,kioskToken);
    for(let i=0;i<25;i++)assert.equal((await api(mf,'/attendance/install-pair',{code:'invalid'},undefined,{'CF-Connecting-IP':'distributed-'+i})).status,400);
    assert.equal((await api(mf,'/attendance/install-pair',{code:'12345678'},undefined,{'CF-Connecting-IP':'another-ip'})).status,429,'Shared failed-attempt limit also bounds distributed guesses');
  }finally{await mf.dispose();}
});
