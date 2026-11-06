import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {initializeAttendance,handlePublicAttendance,handleAttendanceAdmin,attendanceBackup} from '../src/attendance.js';
import {digest} from '../src/security.js';

const admin={username:'admin',isAdmin:true},staff={username:'staff',isAdmin:false};
function fixture(beforeInitialize){
  const db=new DatabaseSync(':memory:'),events=[],limits=[];let onLimit;
  const store={sql:{exec(query,...params){const statement=db.prepare(query);if(!statement.columns().length){statement.run(...params);return {toArray:()=>[]};}const rows=statement.all(...params);return {toArray:()=>rows};}},ctx:{storage:{transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}}},audit:(...event)=>events.push(event),consumeLimit:(...args)=>{limits.push(args);onLimit?.(...args);}};
  beforeInitialize?.(db);
  initializeAttendance(store);
  const management=(path,body={},actor=admin,method='POST')=>handleAttendanceAdmin(store,'/attendance/'+path,method,body,actor);
  const publicRequest=(path,body)=>handlePublicAttendance(store,'/attendance/'+path,body,'synthetic-ip');
  return {db,store,events,limits,management,publicRequest,setOnLimit:fn=>onLimit=fn};
}
const arrival=(kioskToken,patch={})=>({kioskToken,requestId:crypto.randomUUID(),type:'visitor',name:'Alex Visitor',company:'Example Company',contact:'private-contact@example.test',host:'Jordan',...patch});
const safetyFields=['visitorSafetyAcknowledged','workshopAccess','ppeConfirmed'];
const safetyAnswers={visitorSafetyAcknowledged:true,workshopAccess:true,ppeConfirmed:false};
const answers=entry=>Object.fromEntries(safetyFields.map(field=>[field,entry[field]]));
const unknownAnswers={visitorSafetyAcknowledged:null,workshopAccess:null,ppeConfirmed:null};

test('attendance unit: old and partly migrated schemas preserve historic records and a warm schema starts without writes',async()=>{
  for(const partlyMigrated of [false,true]){
    const id=crypto.randomUUID();let previous,changesBefore;
    const f=fixture(db=>{
      db.exec("CREATE TABLE attendance_entries (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,type TEXT NOT NULL CHECK(type IN ('visitor','contractor','employee')),name TEXT NOT NULL,name_key TEXT NOT NULL,company TEXT NOT NULL,company_key TEXT NOT NULL,contact TEXT NOT NULL,host TEXT NOT NULL,purpose TEXT NOT NULL,signed_in_at TEXT NOT NULL,signed_out_at TEXT,signed_out_by TEXT)");
      if(partlyMigrated)db.exec('ALTER TABLE attendance_entries ADD COLUMN visitor_safety_acknowledged INTEGER CHECK(visitor_safety_acknowledged IN (0,1))');
      db.prepare('INSERT INTO attendance_entries(id,type,name,name_key,company,company_key,contact,host,purpose,signed_in_at,signed_out_at,signed_out_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'visitor','Historic Visitor','historic visitor','Historic Company','historic company','historic@example.invalid','Historic Host','Historic reason','2025-01-01T00:00:00.000Z','2025-01-01T01:00:00.000Z','historical-admin');
      previous=db.prepare('SELECT * FROM attendance_entries').get();changesBefore=db.prepare('SELECT total_changes() AS n').get().n;
    });
    const columns=f.db.prepare('PRAGMA table_info(attendance_entries)').all();
    for(const name of ['visitor_safety_acknowledged','workshop_access','ppe_confirmed']){
      const column=columns.find(column=>column.name===name);assert.ok(column);assert.equal(column.notnull,0);assert.equal(column.dflt_value,null);
    }
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changesBefore,'migration must not rewrite historical rows');
    const current=f.db.prepare('SELECT * FROM attendance_entries').get();
    for(const [field,value] of Object.entries(previous))assert.equal(current[field],value);
    assert.deepEqual(answers(attendanceBackup(f.store).entries[0]),unknownAnswers);
    const historical=(await f.management('register')).body.entries[0];
    assert.equal(historical.purpose,'Historic reason');assert.equal(historical.contact,'historic@example.invalid');assert.equal(historical.signedOutBy,'historical-admin');
    const schemaVersion=f.db.prepare('PRAGMA schema_version').get().schema_version;
    f.db.exec('PRAGMA query_only=ON');initializeAttendance(f.store);initializeAttendance(f.store);
    assert.equal(f.db.prepare('PRAGMA schema_version').get().schema_version,schemaVersion);
    assert.deepEqual((await f.management('register')).body.entries,[historical]);assert.deepEqual(attendanceBackup(f.store).entries,[historical]);
    f.db.close();
  }
});

test('attendance unit: visitor answers retain false PPE, stay private, and survive checkout, history and backup',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken;
  const cases=[safetyAnswers,{visitorSafetyAcknowledged:true,workshopAccess:true,ppeConfirmed:true},{visitorSafetyAcknowledged:true,workshopAccess:false,ppeConfirmed:null}];
  const publicKeys=['company','id','name','signedInAt','signedOutAt','type'];
  for(const [index,expected] of cases.entries()){
    const body=arrival(token,{name:'Safety Visitor '+index,...expected}),entry=(await f.publicRequest('check-in',body)).body.entry;
    assert.deepEqual(Object.keys(entry).sort(),publicKeys);
    const retry=(await f.publicRequest('check-in',body)).body;assert.equal(retry.duplicate,true);assert.equal(retry.entry.id,entry.id);assert.deepEqual(Object.keys(retry.entry).sort(),publicKeys);
    const register=(await f.management('register')).body;
    assert.deepEqual(answers(register.entries.find(saved=>saved.id===entry.id)),expected);
    assert.deepEqual(answers(register.activeEntries.find(saved=>saved.id===entry.id)),expected);
    const raw=f.db.prepare('SELECT visitor_safety_acknowledged,workshop_access,ppe_confirmed FROM attendance_entries WHERE id=?').get(entry.id);
    assert.deepEqual({...raw},{visitor_safety_acknowledged:1,workshop_access:Number(expected.workshopAccess),ppe_confirmed:expected.ppeConfirmed===null?null:Number(expected.ppeConfirmed)});
    assert.deepEqual(answers(attendanceBackup(f.store).entries.find(saved=>saved.id===entry.id)),expected);
    const lookup=(await f.publicRequest('lookup',{kioskToken:token,name:body.name})).body.entries[0];assert.deepEqual(Object.keys(lookup).sort(),publicKeys);
    const duplicate=(await f.publicRequest('check-in',arrival(token,{name:body.name,...expected}))).body;assert.equal(duplicate.duplicate,true);assert.deepEqual(Object.keys(duplicate.entry).sort(),publicKeys);
    const otherAnswers=(await f.publicRequest('check-in',arrival(token,{name:body.name,visitorSafetyAcknowledged:true,workshopAccess:true,ppeConfirmed:expected.ppeConfirmed!==true}))).body;
    assert.equal(otherAnswers.entry.id,entry.id);assert.equal(otherAnswers.duplicate,true);
    assert.deepEqual(answers(attendanceBackup(f.store).entries.find(saved=>saved.id===entry.id)),expected,'duplicate active identity must not overwrite original answers');
    const checkout={kioskToken:token,id:entry.id,requestId:crypto.randomUUID()};
    for(const response of [await f.publicRequest('check-out',checkout),await f.publicRequest('check-out',checkout)])assert.deepEqual(Object.keys(response.body.entry).sort(),publicKeys);
    assert.deepEqual(answers((await f.management('admin-check-out',{id:entry.id})).body.entry),expected);
    assert.deepEqual(answers((await f.management('register')).body.entries.find(saved=>saved.id===entry.id)),expected);
    assert.deepEqual(answers(attendanceBackup(f.store).entries.find(saved=>saved.id===entry.id)),expected);
  }
  const active=(await f.publicRequest('check-in',arrival(token,{name:'Active Safety Visitor',...safetyAnswers}))).body.entry;
  const roster=(await f.publicRequest('lookup',{kioskToken:token})).body.entries;assert.deepEqual(roster,[active]);assert.deepEqual(Object.keys(roster[0]).sort(),publicKeys);
  assert.equal(f.events.filter(event=>event[1]==='attendance-check-in').length,4);
  for(const event of f.events)for(const field of safetyFields)assert.equal(JSON.stringify(event).includes(field),false);
  f.db.close();
});

test('attendance unit: partial or malformed visitor questionnaires cannot create a visit or request record',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken;
  const malformed=[
    {visitorSafetyAcknowledged:null,workshopAccess:null,ppeConfirmed:null},
    ...[undefined,null,false,0,1,'true',{},[]].map(visitorSafetyAcknowledged=>({...safetyAnswers,visitorSafetyAcknowledged})),
    ...[undefined,null,0,1,'false',{},[]].map(workshopAccess=>({...safetyAnswers,workshopAccess})),
    ...[undefined,null,0,1,'false',{},[]].map(ppeConfirmed=>({...safetyAnswers,ppeConfirmed})),
    ...[undefined,true,false,0,''].map(ppeConfirmed=>({...safetyAnswers,workshopAccess:false,ppeConfirmed})),
    ...safetyFields.map(field=>({[field]:safetyAnswers[field]})),
    ...safetyFields.map(field=>Object.fromEntries(Object.entries(safetyAnswers).filter(([key])=>key!==field)))
  ];
  for(const patch of malformed)await assert.rejects(f.publicRequest('check-in',arrival(token,patch)),error=>error.status===400,JSON.stringify(patch));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_entries').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_requests').get().n,0);
  assert.equal(f.events.filter(event=>event[1]==='attendance-check-in').length,0);
  f.db.close();
});

test('attendance unit: cached clients retain unknown answers and pre-questionnaire request hashes; nonvisitors ignore stale answers',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken,body=arrival(token);
  const entry=(await f.publicRequest('check-in',body)).body.entry;
  const oldValue={type:body.type,name:body.name,company:body.company,contact:body.contact,host:body.host,purpose:''};
  const previousHash=await digest(JSON.stringify(oldValue));
  assert.equal(f.db.prepare('SELECT payload_hash FROM attendance_requests WHERE request_id=?').get(body.requestId).payload_hash,previousHash);
  assert.deepEqual(answers((await f.management('register')).body.entries[0]),unknownAnswers);
  assert.deepEqual(answers(attendanceBackup(f.store).entries[0]),unknownAnswers);
  assert.equal((await f.publicRequest('check-in',body)).body.entry.id,entry.id);
  await assert.rejects(f.publicRequest('check-in',{...body,...safetyAnswers}),error=>error.status===409);
  const acknowledged=arrival(token,{name:'Acknowledged Visitor',...safetyAnswers});
  await f.publicRequest('check-in',acknowledged);
  for(const patch of [{ppeConfirmed:true},{workshopAccess:false,ppeConfirmed:null}])await assert.rejects(f.publicRequest('check-in',{...acknowledged,...patch}),error=>error.status===409);
  const omitted={...acknowledged};for(const field of safetyFields)delete omitted[field];
  await assert.rejects(f.publicRequest('check-in',omitted),error=>error.status===409);
  for(const type of ['employee','contractor']){
    const stale=arrival(token,{type,name:'Stale '+type,visitorSafetyAcknowledged:{stale:true},workshopAccess:'old',ppeConfirmed:['old']}),created=(await f.publicRequest('check-in',stale)).body.entry;
    const retry={...stale,visitorSafetyAcknowledged:false,workshopAccess:undefined,ppeConfirmed:null};
    assert.equal((await f.publicRequest('check-in',retry)).body.entry.id,created.id);
    assert.deepEqual(answers((await f.management('register')).body.entries.find(saved=>saved.id===created.id)),unknownAnswers);
    assert.deepEqual(answers(attendanceBackup(f.store).entries.find(saved=>saved.id===created.id)),unknownAnswers);
  }
  for(const kioskToken of [undefined,'invalid','0'.repeat(64)])await assert.rejects(f.publicRequest('check-in',arrival(kioskToken,{...safetyAnswers})),error=>error.status===401);
  for(const actor of [staff,{...admin,toolboxOnly:true},{...admin,safetySelfOnly:true}])await assert.rejects(f.management('register',{},actor),error=>error.status===403);
  f.db.close();
});

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
  for(const patch of [{type:'admin'},{requestId:'reused'}])await assert.rejects(f.publicRequest('check-in',arrival(token,patch)),e=>e.status===400);
  for(const type of ['visitor','contractor','employee']){
    for(const field of type==='employee'?['name','host']:['name','company','host']){
      for(const value of [undefined,'  '])await assert.rejects(f.publicRequest('check-in',arrival(token,{type,[field]:value})),e=>e.status===400&&/is required/.test(e.message));
    }
    for(const patch of [{name:{}},{name:'n'.repeat(121)},{host:'h'.repeat(121)},{contact:'c'.repeat(161)},{contact:{}},{contact:'bad\u0001contact'}])await assert.rejects(f.publicRequest('check-in',arrival(token,{type,...patch})),e=>e.status===400);
  }
  for(const type of ['visitor','contractor'])for(const company of [{},'c'.repeat(161),'bad\u0001company'])await assert.rejects(f.publicRequest('check-in',arrival(token,{type,company})),e=>e.status===400);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_entries').get().n,0);
  const employeeBody=arrival(token,{type:'employee',name:'  Self  Reported Employee ',company:{stale:'ignored'},host:'  Site  Host  ',contact:'  employee@example.invalid  ',purpose:{obsolete:'ignored'},username:'admin',isAdmin:true,signedInAt:'1900-01-01'});
  const employee=(await f.publicRequest('check-in',employeeBody)).body.entry;
  assert.equal(employee.type,'employee');assert.ok(Date.parse(employee.signedInAt)>Date.parse('2026-01-01'));assert.equal(employee.username,undefined);assert.equal(employee.isAdmin,undefined);
  const retry=(await f.publicRequest('check-in',{...employeeBody,company:['different stale value'],purpose:'Different obsolete reason'})).body;
  assert.equal(retry.entry.id,employee.id);assert.equal(retry.duplicate,true);
  const contractor=(await f.publicRequest('check-in',arrival(token,{type:'contractor',name:'Contractor Person',contact:undefined}))).body.entry;
  const visitor=(await f.publicRequest('check-in',arrival(token,{name:'  Visitor  Person ',company:'  Visitor  Company ',host:'  Visitor  Host ',contact:undefined,purpose:'Ignored reason'}))).body.entry;
  assert.equal(contractor.type,'contractor');
  const saved=(await f.management('register')).body.entries;
  const savedEmployee=saved.find(entry=>entry.id===employee.id),savedVisitor=saved.find(entry=>entry.id===visitor.id);
  assert.equal(savedEmployee.name,'Self Reported Employee');assert.equal(savedEmployee.company,'');assert.equal(savedEmployee.host,'Site Host');assert.equal(savedEmployee.contact,'employee@example.invalid');
  assert.equal(savedVisitor.name,'Visitor Person');assert.equal(savedVisitor.company,'Visitor Company');assert.equal(savedVisitor.host,'Visitor Host');assert.equal(savedVisitor.contact,'');
  assert.ok(saved.every(entry=>entry.purpose===''));assert.equal(saved.find(entry=>entry.id===contractor.id).contact,'');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM attendance_entries').get().n,3);
  f.db.close();
});

test('attendance unit: arrival retries, normalized active identity and simultaneous submissions do not create duplicate presence',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken,body=arrival(token);
  const results=await Promise.all([f.publicRequest('check-in',body),f.publicRequest('check-in',body)]);
  assert.equal(results[0].body.entry.id,results[1].body.entry.id);
  assert.ok(results.some(result=>result.body.duplicate));
  assert.equal((await f.publicRequest('check-in',{...body,purpose:{obsolete:'ignored'}})).body.entry.id,results[0].body.entry.id);
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

test('attendance unit: a paired kiosk sees all current people in stable alphabetical order with only public fields',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken,entries=[];
  for(const patch of [
    {name:'Zoe Last',type:'employee'},
    {name:'Alex Same',company:'Zulu Company',type:'visitor'},
    {name:'Alex Same',company:'Alpha Company',type:'visitor'},
    {name:'Alex Same',company:'Alpha Company',type:'employee'},
    {name:'Alex Same',company:'Alpha Company',type:'contractor'},
    {name:'  AARON   First ',company:'First Company'}
  ])entries.push((await f.publicRequest('check-in',arrival(token,patch))).body.entry);
  const departed=(await f.publicRequest('check-in',arrival(token,{name:'A Departed Person'}))).body.entry;
  await f.publicRequest('check-out',{kioskToken:token,id:departed.id,requestId:crypto.randomUUID()});
  const roster=(await f.publicRequest('lookup',{kioskToken:token})).body.entries;
  assert.deepEqual(roster.map(entry=>entry.id),[entries[5],entries[3],entries[4],entries[2],entries[1],entries[0]].map(entry=>entry.id));
  assert.deepEqual(roster.map(entry=>entry.name),['AARON First','Alex Same','Alex Same','Alex Same','Alex Same','Zoe Last']);
  assert.deepEqual(roster.map(entry=>entry.company),['First Company','','Alpha Company','Alpha Company','Zulu Company','']);
  for(const entry of roster){
    assert.deepEqual(Object.keys(entry).sort(),['company','id','name','signedInAt','signedOutAt','type']);
    assert.equal(entry.signedOutAt,null);
  }
  assert.deepEqual((await f.publicRequest('lookup',{kioskToken:token})).body.entries,roster);
  for(const name of [null,'','  ',{}])await assert.rejects(f.publicRequest('lookup',{kioskToken:token,name}),error=>error.status===400);
  f.db.close();
});

test('attendance unit: the current-person roster is not truncated at the legacy name lookup limit',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken,ids=[];
  for(let i=64;i>=0;i--)ids.push((await f.publicRequest('check-in',arrival(token,{name:'Person '+String(i).padStart(2,'0'),type:['visitor','contractor','employee'][i%3]}))).body.entry.id);
  const roster=(await f.publicRequest('lookup',{kioskToken:token})).body.entries;
  assert.equal(roster.length,65);
  assert.deepEqual(roster.map(entry=>entry.id),ids.toReversed());
  f.db.close();
});

test('attendance unit: roster lookup requires a current paired kiosk and keeps both rate limits',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken;
  for(const kioskToken of [undefined,'invalid','0'.repeat(64)])await assert.rejects(f.publicRequest('lookup',{kioskToken}),error=>error.status===401);
  assert.deepEqual((await f.publicRequest('lookup',{kioskToken:token})).body.entries,[]);
  assert.deepEqual(f.limits.slice(-2),[['attendance:ip:synthetic-ip',120,60000],['attendance:kiosk:'+await digest(token),1200,15*60000]]);
  const replacement=(await f.management('kiosk')).body.kioskToken;
  await assert.rejects(f.publicRequest('lookup',{kioskToken:token}),error=>error.status===401);
  assert.deepEqual((await f.publicRequest('lookup',{kioskToken:replacement})).body.entries,[]);
  await f.management('kiosk/revoke');
  await assert.rejects(f.publicRequest('lookup',{kioskToken:replacement}),error=>error.status===401);
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

test('attendance unit: new field policy preserves historical private fields in register and backups',async()=>{
  const f=fixture(),token=(await f.management('kiosk')).body.kioskToken;
  const insert=f.db.prepare('INSERT INTO attendance_entries(id,type,name,name_key,company,company_key,contact,host,purpose,signed_in_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  insert.run(crypto.randomUUID(),'visitor','Historical Visitor','historical visitor','','','old@example.invalid','Historical Host','Historical reason','2025-01-01T00:00:00.000Z');
  insert.run(crypto.randomUUID(),'employee','Historical Employee','historical employee','Historical Company','historical company','employee@example.invalid','','Old employee note','2025-01-02T00:00:00.000Z');
  const before=attendanceBackup(f.store).entries;
  await f.publicRequest('check-in',arrival(token,{name:'New Arrival',purpose:'Ignored new reason'}));
  initializeAttendance(f.store);
  const register=(await f.management('register')).body;
  for(const entry of before)assert.deepEqual(register.entries.find(saved=>saved.id===entry.id),entry);
  const after=attendanceBackup(f.store).entries;
  assert.deepEqual(after.slice(0,before.length),before);
  assert.equal(after.at(-1).purpose,'');assert.equal(after.at(-1).host,'Jordan');
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
    const body=arrival(kioskToken,safetyAnswers),signedIn=await request('/attendance/check-in',body);
    assert.equal(signedIn.status,200);assert.ok(signedIn.body.entry.id);
    await t.test('visitor questionnaires are validated at the JSON boundary and false PPE stays private',async()=>{
      const register=await request('/attendance/register',undefined,adminToken);
      assert.deepEqual(answers(register.body.entries.find(entry=>entry.id===signedIn.body.entry.id)),safetyAnswers);
      for(const field of safetyFields)assert.equal(Object.hasOwn(signedIn.body.entry,field),false);
      for(const patch of [{visitorSafetyAcknowledged:true},{...safetyAnswers,visitorSafetyAcknowledged:null},{...safetyAnswers,workshopAccess:false},{...safetyAnswers,ppeConfirmed:'false'}])assert.equal((await request('/attendance/check-in',arrival(kioskToken,{name:'Malformed Visitor',...patch}))).status,400);
      const noWorkshop=await request('/attendance/check-in',arrival(kioskToken,{name:'Office Visitor',visitorSafetyAcknowledged:true,workshopAccess:false,ppeConfirmed:null}));assert.equal(noWorkshop.status,200);
      const saved=(await request('/attendance/register',undefined,adminToken)).body.entries.find(entry=>entry.id===noWorkshop.body.entry.id);
      assert.deepEqual(answers(saved),{visitorSafetyAcknowledged:true,workshopAccess:false,ppeConfirmed:null});
      await request('/attendance/admin-check-out',{id:saved.id},adminToken);
    });
    await t.test('arrival policy is enforced by the Worker and employee contact and host are saved',async()=>{
      for(const patch of [{company:''},{company:'   '},{type:'contractor',company:''},{type:'employee',host:''}])assert.equal((await request('/attendance/check-in',arrival(kioskToken,patch))).status,400);
      const employeeBody=arrival(kioskToken,{type:'employee',name:'Worker Employee',company:{stale:'ignored'},contact:'employee@example.invalid',host:'Employee Host',purpose:{stale:'ignored'}});
      const employee=await request('/attendance/check-in',employeeBody);assert.equal(employee.status,200);
      assert.equal((await request('/attendance/check-in',{...employeeBody,company:'Different old company',purpose:'Old reason'})).body.entry.id,employee.body.entry.id);
      const saved=(await request('/attendance/register',undefined,adminToken)).body.entries.find(entry=>entry.id===employee.body.entry.id);
      assert.equal(saved.company,'');assert.equal(saved.contact,'employee@example.invalid');assert.equal(saved.host,'Employee Host');assert.equal(saved.purpose,'');
      await request('/attendance/admin-check-out',{id:employee.body.entry.id},adminToken);
    });
    await t.test('kiosk cannot read stock, register or current account and public entry data stays minimal',async()=>{
      for(const path of ['/data','/session','/attendance/register'])assert.equal((await request(path,undefined,kioskToken)).status,401);
      assert.equal((await request('/attendance/register',{kioskToken})).status,401);
      const lookup=await request('/attendance/lookup',{kioskToken,name:'alex visitor'});assert.equal(lookup.status,200);assert.equal(lookup.body.entries.length,1);assert.equal(lookup.body.entries[0].contact,undefined);
      const register=await request('/attendance/register',{limit:3},adminToken);assert.equal(register.status,200);assert.equal(register.body.entries.find(entry=>entry.id===signedIn.body.entry.id).contact,body.contact);assert.equal(register.body.counts.active,1);
      const retries=await Promise.all([request('/attendance/check-in',body),request('/attendance/check-in',body)]);assert.ok(retries.every(value=>value.body.entry.id===signedIn.body.entry.id));
    });
    await t.test('the current-person roster accepts a paired kiosk and rejects absent or invalid pairing',async()=>{
      const roster=await request('/attendance/lookup',{kioskToken});
      assert.equal(roster.status,200);assert.deepEqual(roster.body.entries,[signedIn.body.entry]);
      assert.deepEqual(Object.keys(roster.body.entries[0]).sort(),['company','id','name','signedInAt','signedOutAt','type']);
      for(const invalid of [{},{kioskToken:'invalid'},{kioskToken:'0'.repeat(64)}])assert.equal((await request('/attendance/lookup',invalid)).status,401);
    });
    await t.test('page routes return production HTML with matching script and style hashes without embedding attendance data',async()=>{
      for(const path of ['/sign-in','/sign-in/','/sign-in/manage','/sign-in/manage/']){
        const response=await mf.dispatchFetch('http://localhost'+path),html=await response.text(),csp=response.headers.get('Content-Security-Policy');
        assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/text\/html/);assert.equal(response.headers.get('Cache-Control'),'no-store');
        assert.equal(response.headers.get('X-Attendance-Environment'),'production');
        for(const tag of ['script','style']){
          const source=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))?.[1];assert.ok(source);
          const hash="'sha256-"+createHash('sha256').update(source).digest('base64')+"'";
          assert.ok(csp.includes(tag+'-src '+hash));assert.ok(html.includes(hash));
        }
        assert.doesNotMatch(html,/nonce=|private-contact@example\.test|Alex Visitor|Demo data only|Demo administrator:|iOS 10 compatibility test|Lennox Test/);assert.match(csp,/frame-ancestors 'none'/);
        if(!path.includes('manage')){
          assert.match(html,/name="apple-mobile-web-app-capable" content="yes"/);
          assert.match(html,/rel="apple-touch-icon" href="\/sign-in\/apple-touch-icon.png"/);
        }
      }
    });
    await t.test('Home Screen icon routes return the existing Lennox PNG without sign-in',async()=>{
      const expected=fs.readFileSync(new URL('../../icon-adaptive-v4-192.png',import.meta.url));
      for(const path of ['/sign-in/apple-touch-icon.png','/apple-touch-icon.png']){
        const response=await mf.dispatchFetch('http://localhost'+path),bytes=Buffer.from(await response.arrayBuffer());
        assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
        assert.deepEqual(bytes,expected);assert.equal(bytes.readUInt32BE(16),192);assert.equal(bytes.readUInt32BE(20),192);
        const head=await mf.dispatchFetch('http://localhost'+path,{method:'HEAD'});
        assert.equal(head.status,200);assert.equal(head.headers.get('Content-Type'),'image/png');assert.equal(head.headers.get('Content-Length'),String(expected.length));assert.equal(await head.text(),'');
      }
    });
    await t.test('edge rejects oversized requests and foreign origins; kiosk revocation takes effect immediately',async()=>{
      assert.equal((await request('/attendance/check-in',{...arrival(kioskToken),extra:'x'.repeat(17000)})).status,413);
      assert.equal((await request('/attendance/check-in',arrival(kioskToken),undefined,'POST',{Origin:'https://untrusted.example'})).status,403);
      assert.equal((await request('/attendance/kiosk/revoke',{},adminToken)).status,200);
      assert.equal((await request('/attendance/lookup',{kioskToken})).status,401);
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
