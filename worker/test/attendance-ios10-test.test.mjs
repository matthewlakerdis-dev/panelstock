import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {legacyAttendancePage} from '../scripts/build-attendance-ios10.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const configPath=new URL('../wrangler.attendance-ios10-test.jsonc',import.meta.url);
const config=JSON.parse(readFileSync(configPath,'utf8'));
const script=process.env.ATTENDANCE_IOS10_TEST_BUNDLE
  ?readFileSync(process.env.ATTENDANCE_IOS10_TEST_BUNDLE,'utf8')
  :(await build({entryPoints:[new URL('../src/attendance-ios10-test.js',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',external:['cloudflare:workers'],write:false,banner:{js:"import {createRequire} from 'node:module'; var require=createRequire('/worker/attendance-test.js');"}})).outputFiles[0].text;
const assets=new Map([['/index.html',legacyAttendancePage()],['/manage/index.html',legacyAttendancePage(true)]]);
function options({bindings={},storage=true,brokenAssets=false}={}){
  return convertV4MiniflareOptions({workers:[{name:'attendance-ios10-test',modules:true,script,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
    ...(storage?{durableObjects:{INVENTORY:{className:'AttendanceIos10TestStore',useSQLite:true}}}:{}),
    bindings:{...config.vars,...bindings},
    serviceBindings:{ATTENDANCE_TEST_ASSETS:async request=>{
      const html=assets.get(new URL(request.url).pathname);
      return new Response(brokenAssets?'Unbuilt page':html||'Not found',{status:html?200:404,headers:{'Content-Type':'text/html'}});
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
      for(const path of ['/health','/sign-in/manage','/login']){
        const result=await api(mf,path,path==='/login'?{username:'ipadtest',pin:'103434'}:undefined);
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
      assert.equal(html,assets.get(path.includes('manage')?'/manage/index.html':'/index.html'));
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
