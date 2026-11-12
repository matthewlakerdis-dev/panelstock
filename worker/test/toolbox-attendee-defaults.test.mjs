import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleToolbox,toolboxContent,TOOLBOX_DEFAULTS} from '../src/toolbox.js';
import {requireCondition as check,digest} from '../src/security.js';

const path='/toolbox/attendee-defaults';
const supervisor={username:'supervisor',tasks:{'factory.toolbox':true}};
const other={username:'other',tasks:{'factory.toolbox':true}};
const admin={username:'admin',isAdmin:true};
const defaultsKey=username=>'toolbox:attendee-defaults:'+username;
function store(){
 const docs=new Map([['users',{
  supervisor:{active:true},other:{active:true},admin:{active:true,isAdmin:true},
  worker:{active:true,displayName:'Worker',tasks:{}},legacy:{displayName:'Legacy user'},inactive:{active:false}
 }]]),audits=[];
 const s={docs,audits,read:(key,fallback=null)=>structuredClone(docs.has(key)?docs.get(key):fallback),
  write:(key,value)=>docs.set(key,structuredClone(value)),audit:(...args)=>audits.push(args),
  requireTask:(actor,task)=>check(actor.isAdmin||actor.tasks?.[task],'Forbidden',403)};
 s.ctx={storage:{transactionSync:callback=>{
  s.beforeTransaction?.();
  const before=structuredClone(docs),auditCount=audits.length;
  try{return callback();}catch(error){docs.clear();for(const [key,value] of before)docs.set(key,value);audits.length=auditCount;throw error;}
 }}};
 return s;
}
const packet=(usernames,expectedRevision=0)=>({usernames,expectedRevision,mutationId:crypto.randomUUID()});
const save=(s,body,actor=supervisor)=>handleToolbox(s,path,'POST',body,actor);
const read=(s,actor=supervisor,body={})=>handleToolbox(s,path,'GET',body,actor);

test('default teams require Toolbox permission and permit only GET and POST',async()=>{
 const s=store(),denied={username:'worker',tasks:{}};
 await assert.rejects(read(s,denied),{status:403});
 await assert.rejects(save(s,packet(['worker']),denied),{status:403});
 for(const method of ['PUT','DELETE','PATCH'])await assert.rejects(handleToolbox(s,path,method,{},supervisor),{status:405});
 assert.deepEqual((await read(s)).body,{ok:true,defaults:{usernames:[],revision:0}});
 assert.deepEqual((await read(s,admin)).body.defaults,{usernames:[],revision:0});
 assert.equal(s.docs.size,1);assert.equal(s.audits.length,0);
});

test('the actor owns their default team even with another owner supplied in the request',async()=>{
 const s=store();
 const first=(await save(s,{...packet(['worker','legacy']),username:'other',ownerUsername:'other',updatedBy:'admin'})).body.defaults;
 assert.deepEqual(first.usernames,['worker','legacy']);assert.equal(first.revision,1);assert.equal(first.updatedBy,'supervisor');assert.ok(Number.isFinite(Date.parse(first.updatedAt)));
 assert.deepEqual((await read(s,other,{username:'supervisor'})).body.defaults,{usernames:[],revision:0});
 assert.deepEqual((await read(s,admin,{username:'supervisor'})).body.defaults,{usernames:[],revision:0});
 const second=(await save(s,{...packet(['admin']),username:'supervisor'},other)).body.defaults;
 const third=(await save(s,{...packet(['other']),username:'supervisor'},admin)).body.defaults;
 assert.equal(second.updatedBy,'other');assert.equal(third.updatedBy,'admin');
 assert.deepEqual((await read(s)).body.defaults,first);
 assert.deepEqual((await read(s,other)).body.defaults,second);
 assert.deepEqual((await read(s,admin)).body.defaults,third);
 assert.equal(s.audits.length,3);
});

test('save, replace and clear use increasing account revisions',async()=>{
 const s=store(),first=(await save(s,packet(['worker']))).body.defaults;
 const next=(await save(s,packet(['legacy','worker'],first.revision))).body.defaults;
 assert.deepEqual(next.usernames,['legacy','worker']);assert.equal(next.revision,2);
 const cleared=(await save(s,packet([],next.revision))).body.defaults;
 assert.deepEqual(cleared.usernames,[]);assert.equal(cleared.revision,3);
 assert.deepEqual((await read(s)).body.defaults,cleared);
 await assert.rejects(save(s,packet(['worker'],0)),{status:409});
 assert.equal(s.audits.length,3);
});

test('default attendees match the active PanelStock directory, including accounts without task access',async()=>{
 const s=store(),directory=(await handleToolbox(s,'/toolbox/users','GET',{},supervisor)).body.users;
 assert.ok(directory.some(user=>user.username==='worker'));assert.ok(directory.some(user=>user.username==='legacy'));
 assert.ok(!directory.some(user=>user.username==='inactive'));
 const usernames=directory.map(user=>user.username);
 assert.deepEqual((await save(s,packet(usernames))).body.defaults.usernames,usernames);
 assert.equal(s.read(defaultsKey('supervisor')).usernames.length,5);
});

test('invalid selections, revisions and mutation identifiers cannot change a saved team',async()=>{
 const s=store();await save(s,packet(['worker']));const before=structuredClone(s.docs),auditCount=s.audits.length;
 const invalidUsernames=[undefined,null,'worker',{},[null],[3],[{}],[''],[' worker '],['WORKER'],['x'.repeat(81)],['missing'],['inactive'],['toString'],['__proto__'],['worker','worker'],Array(61).fill('worker')];
 for(const usernames of invalidUsernames)await assert.rejects(save(s,{...packet(['worker'],1),usernames}),{status:400});
 for(const expectedRevision of [undefined,null,'1',-1,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(save(s,{...packet(['worker'],1),expectedRevision}),{status:400});
 for(const mutationId of [undefined,null,2,'','not-a-uuid'])await assert.rejects(save(s,{...packet(['worker'],1),mutationId}),{status:400});
 for(const body of [undefined,null,[],{}])await assert.rejects(save(s,body),{status:400});
 assert.deepEqual(s.docs,before);assert.equal(s.audits.length,auditCount);
});

test('a default team can contain the full 60 unique active attendees',async()=>{
 const s=store(),usernames=Array.from({length:60},(_,index)=>'person'+index);
 s.write('users',Object.fromEntries(usernames.map(username=>[username,{active:true}])));
 const result=await save(s,packet(usernames));assert.deepEqual(result.body.defaults.usernames,usernames);assert.equal(result.body.defaults.revision,1);
});

test('directory usernames up to 80 characters work in defaults, saved talks and signed attendee snapshots',async()=>{
 const s=store(),usernames=['a'.repeat(41),'b'.repeat(80)],users=s.read('users');
 for(const username of usernames)users[username]={active:true,displayName:username.slice(0,1)};
 s.write('users',users);
 const directory=(await handleToolbox(s,'/toolbox/users','GET',{},supervisor)).body.users;
 assert.ok(usernames.every(username=>directory.some(user=>user.username===username)));
 const defaults=(await save(s,packet(usernames))).body.defaults;assert.deepEqual(defaults.usernames,usernames);
 const record={id:crypto.randomUUID(),type:'daily',status:'Draft',date:'2026-11-12',time:'06:30',company:'Fabricator',site:'Workshop',facilitator:'Supervisor',tasks:'Welding',focus:'',topics:TOOLBOX_DEFAULTS.daily.map(text=>({text,notes:'',reviewed:false})),people:defaults.usernames.map(userUsername=>({name:userUsername.slice(0,1),userUsername,ack:true,signature:null})),actions:[],supervisorSignature:null};
 const contentHash=await digest(toolboxContent(record)),attendeeRoster=record.people.map(({name,userUsername})=>({name,userUsername}));
 record.people[1].signature={image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',at:new Date().toISOString(),contentHash,attendeeRoster};
 const result=await handleToolbox(s,'/toolbox/records/'+record.id,'POST',{record,expectedRevision:0,mutationId:crypto.randomUUID()},supervisor);
 assert.equal(result.status,200);assert.deepEqual(result.body.record.people.map(person=>person.userUsername),usernames);
 assert.deepEqual(result.body.record.people[1].signature,record.people[1].signature);
 const changed=structuredClone(result.body.record);changed.people[1].userUsername='c'.repeat(80);
 await assert.rejects(handleToolbox(s,'/toolbox/records/'+record.id,'POST',{record:changed,expectedRevision:1,mutationId:crypto.randomUUID()},supervisor),{status:409});
});

test('replayed mutations return their original response after later saves and directory changes',async()=>{
 const s=store(),body=packet(['worker']),first=await save(s,body);
 await save(s,packet(['legacy'],1));const before=structuredClone(s.docs),auditCount=s.audits.length;
 const replay=await save(s,body);assert.deepEqual(replay.body,{...first.body,duplicate:true});
 assert.deepEqual(s.docs,before);assert.equal(s.audits.length,auditCount);
 const users=s.read('users');users.worker.active=false;s.write('users',users);
 const replayAfterDeactivation=await save(s,body);assert.deepEqual(replayAfterDeactivation.body,{...first.body,duplicate:true});
 assert.deepEqual((await read(s)).body.defaults.usernames,['legacy']);assert.equal((await read(s)).body.defaults.revision,2);
});

test('a mutation cannot be reused for different selections, revisions or accounts',async()=>{
 const s=store(),body=packet(['worker','legacy']);await save(s,body);
 for(const changed of [{...body,usernames:['legacy','worker']},{...body,usernames:[]},{...body,expectedRevision:1}])await assert.rejects(save(s,changed),{status:409});
 await assert.rejects(save(s,body,other),{status:409});
 await assert.rejects(save(s,body,admin),{status:409});
 assert.deepEqual((await read(s)).body.defaults.usernames,body.usernames);
 assert.deepEqual((await read(s,other)).body.defaults,{usernames:[],revision:0});
 assert.equal(s.audits.length,1);
});

test('concurrent saves accept one revision and reject the stale writer',async()=>{
 const s=store();await save(s,packet(['worker']));
 const results=await Promise.allSettled([save(s,packet(['legacy'],1)),save(s,packet(['other'],1))]);
 const saved=results.filter(result=>result.status==='fulfilled');assert.equal(saved.length,1);
 assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
 assert.equal(saved[0].value.body.defaults.revision,2);
 assert.deepEqual((await read(s)).body.defaults,saved[0].value.body.defaults);
 assert.equal(s.audits.length,2);
});

test('directory changes are filtered on read without changing the saved revision or records',async()=>{
 const s=store();await save(s,packet(['worker','legacy','other']));
 const saved=s.read(defaultsKey('supervisor')),users=s.read('users');users.worker.active=false;delete users.legacy;users.other.displayName='Renamed display name';s.write('users',users);
 const before=structuredClone(s.docs),auditCount=s.audits.length,result=(await read(s)).body.defaults;
 assert.deepEqual(result,{...saved,usernames:['other']});assert.deepEqual(s.docs,before);assert.equal(s.audits.length,auditCount);
 const updated=(await save(s,packet(result.usernames,result.revision))).body.defaults;
 assert.equal(updated.revision,2);assert.deepEqual(updated.usernames,['other']);
});

test('eligibility is checked in the save transaction and failed writes can be retried',async()=>{
 const s=store(),body=packet(['worker']);
 s.beforeTransaction=()=>{const users=s.read('users');users.worker.active=false;s.write('users',users);};
 await assert.rejects(save(s,body),{status:400});assert.equal(s.read(defaultsKey('supervisor')),null);
 s.beforeTransaction=null;const users=s.read('users');users.worker.active=true;s.write('users',users);
 const audit=s.audit;s.audit=()=>{throw new Error('Audit failure');};
 const before=structuredClone(s.docs);await assert.rejects(save(s,body),/Audit failure/);assert.deepEqual(s.docs,before);
 s.audit=audit;const saved=await save(s,body);assert.equal(saved.body.defaults.revision,1);assert.equal(saved.body.duplicate,undefined);assert.equal(s.audits.length,1);
});

test('saving defaults never changes drafts, completed talks, admin drafts or their indexes',async()=>{
 const s=store();
 for(const [key,value] of [
  ['toolbox:record:draft',{status:'Draft',people:[{name:'Guest',signature:null}],revision:4}],
  ['toolbox:record:completed',{status:'Completed',people:[{name:'Worker',signature:{image:'signed'}}],revision:2}],
  ['toolbox:admin-draft:daily',{type:'daily',people:[{name:'Admin attendee'}],revision:3}],
  ['toolbox:admin-draft:weekly',{type:'weekly',people:[],revision:5}],
  ['toolbox:index',[{id:'draft',status:'Draft'},{id:'completed',status:'Completed'}]],
  ['toolbox:templates',{revision:8,templates:{daily:['Daily'],weekly:['Weekly']}}]
 ])s.write(key,value);
 const before=structuredClone(s.docs);await save(s,packet(['worker']));await save(s,packet([],1));
 for(const [key,value] of before)assert.deepEqual(s.read(key),value,key);
 for(const key of s.docs.keys())assert.ok(before.has(key)||key===defaultsKey('supervisor')||key.startsWith('toolbox:attendee-defaults-mutation:'),key);
});
