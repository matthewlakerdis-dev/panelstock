import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {initializeAttendance,handlePublicAttendance,handleAttendanceAdmin,attendanceBackup} from '../src/attendance.js';
import {digest} from '../src/security.js';

const admin={username:'admin',isAdmin:true},staff={username:'staff',isAdmin:false};
function fixture(){
  const db=new DatabaseSync(':memory:'),events=[],limits=[];let onLimit;
  const store={sql:{exec(query,...params){const statement=db.prepare(query);if(!statement.columns().length){statement.run(...params);return {toArray:()=>[]};}return {toArray:()=>statement.all(...params)};}},ctx:{storage:{transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}}},audit:(...event)=>events.push(event),consumeLimit:(...args)=>{limits.push(args);onLimit?.(...args);}};
  initializeAttendance(store);
  const management=(path,body={},actor=admin,method='POST')=>handleAttendanceAdmin(store,'/attendance/'+path,method,body,actor);
  const publicRequest=(path,body)=>handlePublicAttendance(store,'/attendance/'+path,body,'synthetic-ip');
  return {db,store,events,limits,management,publicRequest,setOnLimit:fn=>onLimit=fn};
}
const arrival=(kioskToken,patch={})=>({kioskToken,requestId:crypto.randomUUID(),type:'visitor',name:'Alex Visitor',company:'Example Company',contact:'private-contact@example.test',host:'Jordan',purpose:'Meeting',...patch});

test('attendance unit: only administrators can manage records and kiosk tokens are hashed, rotated and revoked',async()=>{
  const f=fixture();
  for(const actor of [staff,{...admin,toolboxOnly:true},{...admin,safetySelfOnly:true}])for(const path of ['kiosk','kiosk/revoke','register','admin-check-out'])await assert.rejects(f.management(path,{},actor),e=>e.status===403);
  const first=(await f.management('kiosk')).body.kioskToken;
  assert.match(first,/^[a-f0-9]{64}$/);
  assert.equal(f.db.prepare('SELECT kiosk_hash FROM attendance_settings').get().kiosk_hash,await digest(first));
  assert.ok(!JSON.stringify(f.events).includes(first));
  const second=(await f.management('kiosk')).body.kioskToken;assert.notEqual(first,second);
  await assert.rejects(f.publicRequest('check-in',arrival(first)),e=>e.status===401);
  await f.publicRequest('check-in',arrival(second));
  await f.management('kiosk/revoke');
  await assert.rejects(f.publicRequest('lookup',{kioskToken:second,name:'Alex Visitor'}),e=>e.status===401);
  assert.equal((await f.management('register')).body.entries.length,1);
  assert.ok(f.events.some(event=>event[1]==='attendance-kiosk-revoked'));
  f.db.close();
});

test('attendance unit: role-specific validation, bounded text and UUIDs reject malformed arrivals without writing',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken;
  for(const patch of [{type:'admin'},{name:''},{name:{}},{name:'n'.repeat(121)},{company:[]},{requestId:'reused'},{host:''},{purpose:''},{type:'contractor',company:''},{contact:'x'.repeat(161)}])await assert.rejects(f.publicRequest('check-in',arrival(token,patch)),e=>e.status===400);
  const employee=(await f.publicRequest('check-in',arrival(token,{type:'employee',name:'Self Reported Employee',company:'',host:'',purpose:'',username:'admin',isAdmin:true,signedInAt:'1900-01-01'}))).body.entry;
  assert.equal(employee.type,'employee');assert.ok(Date.parse(employee.signedInAt)>Date.parse('2026-01-01'));assert.equal(employee.username,undefined);assert.equal(employee.isAdmin,undefined);
  const contractor=(await f.publicRequest('check-in',arrival(token,{type:'contractor',name:'Contractor Person'}))).body.entry;
  assert.equal(contractor.type,'contractor');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_entries').get().n,2);
  f.db.close();
});

test('attendance unit: arrival retries, normalized active identity and simultaneous submissions do not create duplicate presence',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken,body=arrival(token);
  const results=await Promise.all([f.publicRequest('check-in',body),f.publicRequest('check-in',body)]);
  assert.equal(results[0].body.entry.id,results[1].body.entry.id);
  assert.ok(results.some(result=>result.body.duplicate));
  const duplicate=await f.publicRequest('check-in',arrival(token,{name:'  ALEX   Visitor ',company:'example company',contact:'different@example.test'}));
  assert.equal(duplicate.body.entry.id,results[0].body.entry.id);assert.equal(duplicate.body.duplicate,true);
  await assert.rejects(f.publicRequest('check-in',{...body,name:'Someone Else'}),e=>e.status===409);
  const entry=(await f.management('register')).body.entries[0];assert.equal(entry.contact,'private-contact@example.test');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_entries').get().n,1);
  assert.equal(f.events.filter(event=>event[1]==='attendance-check-in').length,1);
  f.db.close();
});

test('attendance unit: public lookup is exact and minimal; checkout is durable and retry-safe; re-arrival creates a new visit',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken,body=arrival(token),first=(await f.publicRequest('check-in',body)).body.entry;
  assert.equal((await f.publicRequest('lookup',{kioskToken:token,name:'Alex'})).body.entries.length,0);
  const lookup=(await f.publicRequest('lookup',{kioskToken:token,name:'  alex   visitor '})).body.entries;
  assert.equal(lookup.length,1);assert.equal(lookup[0].id,first.id);
  for(const response of [first,lookup[0]])for(const field of ['contact','host','purpose','signedOutBy'])assert.equal(Object.hasOwn(response,field),false);
  const checkout={kioskToken:token,id:first.id,requestId:crypto.randomUUID()},closed=await f.publicRequest('check-out',checkout);
  assert.ok(closed.body.entry.signedOutAt);assert.equal((await f.publicRequest('check-out',checkout)).body.entry.signedOutAt,closed.body.entry.signedOutAt);
  await assert.rejects(f.publicRequest('check-in',{...body,requestId:checkout.requestId}),e=>e.status===409);
  await assert.rejects(f.publicRequest('check-out',{...checkout,id:crypto.randomUUID()}),e=>e.status===409);
  await assert.rejects(f.publicRequest('check-out',{...checkout,id:crypto.randomUUID(),requestId:crypto.randomUUID()}),e=>e.status===404);
  assert.equal((await f.publicRequest('lookup',{kioskToken:token,name:'Alex Visitor'})).body.entries.length,0);
  const replay=(await f.publicRequest('check-in',body)).body.entry;assert.equal(replay.id,first.id);assert.ok(replay.signedOutAt);
  const second=(await f.publicRequest('check-in',arrival(token))).body.entry;assert.notEqual(second.id,first.id);
  initializeAttendance(f.store);assert.equal((await f.management('register')).body.entries.length,2);
  assert.equal(attendanceBackup(f.store).entries.length,2);
  assert.equal(f.events.filter(event=>event[1]==='attendance-check-out').length,1);
  assert.ok(f.limits.some(limit=>limit[0]==='attendance:ip:synthetic-ip'));
  f.db.close();
});

test('attendance unit: token revocation while hashing prevents the subsequent mutation',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken;
  f.setOnLimit(name=>{if(name.startsWith('attendance:kiosk:')){f.db.exec('DELETE FROM attendance_settings');f.setOnLimit(null);}});
  await assert.rejects(f.publicRequest('check-in',arrival(token)),e=>e.status===401);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_entries').get().n,0);
  f.db.close();
});

test('attendance unit: administrator register pages stable history and keeps all active people and counts separate',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken;
  const ids=[];
  for(const [name,type] of [['V One','visitor'],['C One','contractor'],['E One','employee'],['V Two','visitor']])ids.push((await f.publicRequest('check-in',arrival(token,{name,type}))).body.entry.id);
  const closed=(await f.management('admin-check-out',{id:ids[0]})).body.entry;
  assert.equal(closed.signedOutBy,'admin');assert.ok(closed.signedOutAt);
  assert.equal((await f.management('admin-check-out',{id:ids[0]})).body.entry.signedOutAt,closed.signedOutAt);
  const first=(await f.management('register',{limit:2})).body;
  assert.equal(first.entries.length,2);assert.equal(first.activeEntries.length,3);
  assert.deepEqual(first.counts,{active:3,visitors:1,contractors:1,employees:1});
  assert.ok(first.nextCursor);assert.equal(first.kioskConfigured,true);
  await f.publicRequest('check-in',arrival(token,{name:'Later Arrival'}));
  const second=(await f.management('register',{limit:2,cursor:first.nextCursor})).body;
  assert.deepEqual([...first.entries,...second.entries].map(entry=>entry.id),ids.toReversed());
  assert.equal(second.nextCursor,null);assert.equal(second.activeEntries.length,4);
  for(const patch of [{limit:0},{limit:251},{limit:1.5},{cursor:'invalid'},{cursor:'v1.3.2'}])await assert.rejects(f.management('register',patch),e=>e.status===400);
  f.db.close();
});

test('attendance Worker integration: standalone pages, restricted register, kiosk scope, bounded requests and maintenance',async t=>{
  const built=process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url);
  const script=fs.readFileSync(built,'utf8');
  const options=readOnly=>convertV4MiniflareOptions({workers:[{name:'attendance-test',modules:true,script,compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'attendance-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:'http://localhost:8080',READ_ONLY:readOnly?'true':'false'}}]});
  const mf=new Miniflare(options(false));
  const seed=async instance=>{const kv=await instance.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')},staff:{isAdmin:false,pinHash:createHash('sha256').update('654321:staff:panelstock').digest('hex')}}));};
  const request=async(path,body,token,method=body===undefined?'GET':'POST',extraHeaders={})=>{const response=await mf.dispatchFetch('http://localhost'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  try{
    await seed(mf);
    const adminToken=(await request('/login',{username:'admin',pin:'123456'})).body.token,staffToken=(await request('/login',{username:'staff',pin:'654321'})).body.token;
    assert.ok(adminToken);assert.ok(staffToken);
    await t.test('register and kiosk administration require a current administrator session',async()=>{
      assert.equal((await request('/attendance/register')).status,401);
      assert.equal((await request('/attendance/register',undefined,staffToken)).status,403);
      assert.equal((await request('/attendance/kiosk',{},staffToken)).status,403);
      assert.equal((await request('/attendance/check-in',arrival('0'.repeat(64)))).status,401);
    });
    await t.test('Toolbox and safety self-service scoped administrator sessions cannot manage attendance',async()=>{
      for(const [ticketPath,redeemPath] of [['/toolbox/session-ticket','/toolbox/session'],['/toolbox/self/session-ticket','/toolbox/self/session']]){
        const issued=await request(ticketPath,{app:'web'},adminToken);assert.equal(issued.status,200,JSON.stringify(issued.body));
        const redeemed=await request(redeemPath,{ticket:issued.body.ticket,app:'web'});assert.equal(redeemed.status,200,JSON.stringify(redeemed.body));
        const scoped=redeemed.body.token;assert.ok(scoped);
        assert.equal((await request('/session',undefined,scoped)).body.isAdmin,true);
        assert.equal((await request('/attendance/register',undefined,scoped)).status,403);
        for(const path of ['/attendance/register','/attendance/kiosk','/attendance/kiosk/revoke','/attendance/admin-check-out'])assert.equal((await request(path,{},scoped)).status,403,path);
      }
    });
    const kioskToken=(await request('/attendance/kiosk',{},adminToken)).body.kioskToken;
    const body=arrival(kioskToken),signedIn=await request('/attendance/check-in',body);
    assert.equal(signedIn.status,200);assert.ok(signedIn.body.entry.id);
    await t.test('kiosk cannot read stock, register or current account and public entry data stays minimal',async()=>{
      for(const path of ['/data','/session','/attendance/register'])assert.equal((await request(path,undefined,kioskToken)).status,401);
      assert.equal((await request('/attendance/register',{kioskToken})).status,401);
      const lookup=await request('/attendance/lookup',{kioskToken,name:'alex visitor'});assert.equal(lookup.status,200);assert.equal(lookup.body.entries.length,1);assert.equal(lookup.body.entries[0].contact,undefined);
      const register=await request('/attendance/register',{limit:1},adminToken);assert.equal(register.status,200);assert.equal(register.body.entries[0].contact,body.contact);assert.equal(register.body.counts.active,1);
      const retries=await Promise.all([request('/attendance/check-in',body),request('/attendance/check-in',body)]);assert.ok(retries.every(value=>value.body.entry.id===signedIn.body.entry.id));
    });
    await t.test('page routes return no-store HTML with matching nonce CSP without embedding attendance data',async()=>{
      for(const path of ['/sign-in','/sign-in/','/sign-in/manage','/sign-in/manage/']){
        const response=await mf.dispatchFetch('http://localhost'+path),html=await response.text(),csp=response.headers.get('Content-Security-Policy');
        assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/text\/html/);assert.equal(response.headers.get('Cache-Control'),'no-store');
        const nonce=csp.match(/script-src 'nonce-([^']+)'/)[1];assert.ok(csp.includes("style-src 'nonce-"+nonce+"'"));assert.ok(html.includes('<script nonce="'+nonce+'"'));assert.ok(html.includes('<style nonce="'+nonce+'"'));
        assert.doesNotMatch(html,/private-contact@example\.test|Alex Visitor/);assert.match(csp,/frame-ancestors 'none'/);
      }
    });
    await t.test('edge rejects oversized requests and foreign origins; kiosk revocation takes effect immediately',async()=>{
      assert.equal((await request('/attendance/check-in',{...arrival(kioskToken),extra:'x'.repeat(17000)})).status,413);
      assert.equal((await request('/attendance/check-in',arrival(kioskToken),undefined,'POST',{Origin:'https://untrusted.example'})).status,403);
      assert.equal((await request('/attendance/kiosk/revoke',{},adminToken)).status,200);
      assert.equal((await request('/attendance/check-out',{kioskToken,id:signedIn.body.entry.id,requestId:crypto.randomUUID()})).status,401);
      assert.equal((await request('/attendance/admin-check-out',{id:signedIn.body.entry.id},adminToken)).status,200);
      assert.equal((await request('/attendance/register',undefined,adminToken)).body.counts.active,0);
      await request('/logout',{},adminToken);assert.equal((await request('/attendance/register',undefined,adminToken)).status,401);
    });
  }finally{await mf.dispose();}
  const paused=new Miniflare(options(true));
  try{
    await seed(paused);
    const login=await paused.dispatchFetch('http://localhost/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',pin:'123456'})});
    const {token}=await login.json();assert.ok(token);
    const register=await paused.dispatchFetch('http://localhost/attendance/register',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({limit:1})});
    assert.equal(register.status,200);assert.equal((await register.json()).entries.length,0);
    const response=await paused.dispatchFetch('http://localhost/attendance/check-in',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(arrival('0'.repeat(64)))});
    assert.equal(response.status,503);
    assert.match((await response.json()).error,/Sign-in and sign-out.*maintenance/);
  }finally{await paused.dispose();}
});
