import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleToolbox,toolboxContent,toolboxAttendeeSnapshot,TOOLBOX_DEFAULTS,normalizeToolboxRecord} from '../src/toolbox.js';
import {digest} from '../src/security.js';
const admin={username:'admin',isAdmin:true};
const supervisor={username:'supervisor',tasks:{'factory.toolbox':true}};
const other={username:'other',tasks:{'factory.toolbox':true}};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function store(){const docs=new Map(),audits=[];return {docs,audits,read:(k,d=null)=>structuredClone(docs.has(k)?docs.get(k):d),write:(k,v)=>docs.set(k,structuredClone(v)),ctx:{storage:{transactionSync:f=>f()}},audit:(...args)=>audits.push(args),requireTask:(a,t)=>{assert.ok(a.isAdmin||a.tasks?.[t],'Forbidden');}}}
function draft(){return {id:crypto.randomUUID(),type:'daily',status:'Draft',date:'2026-10-13',time:'06:30',company:'Fabricator',site:'Workshop',facilitator:'Supervisor',tasks:'Weld frames',focus:'',topics:TOOLBOX_DEFAULTS.daily.map(text=>({text,notes:'',reviewed:true})),people:[{name:'Worker',ack:true,signature:null}],actions:[{text:'Inspect extraction',owner:'Maintenance',due:'2026-10-14'}],supervisorSignature:null};}
async function signed(){const r=draft();r.status='Completed';const sig={image,at:new Date().toISOString(),contentHash:await digest(toolboxContent(r))};r.people[0].signature=sig;r.supervisorSignature=sig;return r;}
const path=r=>'/toolbox/records/'+r.id;
const packet=(r,revision=0)=>({record:r,expectedRevision:revision,mutationId:crypto.randomUUID()});
const save=(s,r,revision=0,a=supervisor)=>handleToolbox(s,path(r),'POST',packet(r,revision),a);

test('toolbox permissions and template revisions are enforced on the server',async()=>{
 const s=store();await assert.rejects(handleToolbox(s,'/toolbox/templates','GET',{},{}),/Forbidden/);
 const defaults=await handleToolbox(s,'/toolbox/templates','GET',{},supervisor);assert.equal(defaults.body.revision,0);
 const body={templates:TOOLBOX_DEFAULTS,expectedRevision:0};
 await assert.rejects(handleToolbox(s,'/toolbox/templates','POST',body,supervisor),{status:403});
 assert.equal((await handleToolbox(s,'/toolbox/templates','POST',body,admin)).body.revision,1);
 await assert.rejects(handleToolbox(s,'/toolbox/templates','POST',body,admin),{status:409});
 assert.equal(s.audits.length,1);
});
test('drafts are private to their owner and administrators; completed talks are shared',async()=>{
 const s=store(),r=draft();await save(s,r);
 await assert.rejects(handleToolbox(s,path(r),'GET',{},other),{status:404});
 await assert.rejects(save(s,r,1,other),{status:403});
 assert.equal((await handleToolbox(s,'/toolbox/list','POST',{},other)).body.total,0);
 assert.equal((await handleToolbox(s,path(r),'GET',{},admin)).body.record.createdBy,'supervisor');
 const completed=await signed();await save(s,completed);
 assert.equal((await handleToolbox(s,path(completed),'GET',{},other)).body.record.status,'Completed');
});
test('completion requires all discussed topics, attendee signatures and supervisor sign-off',async()=>{
 for(const change of [r=>r.people[0].signature=null,r=>r.people[0].ack=false,r=>r.people=[],r=>r.supervisorSignature=null,r=>r.topics[0].reviewed=false,r=>r.actions[0].owner='']){
  const r=await signed();change(r);const hash=await digest(toolboxContent(r));for(const sig of [...r.people.map(p=>p.signature),r.supervisorSignature].filter(Boolean))sig.contentHash=hash;
  await assert.rejects(save(store(),r),{status:400});
 }
});
test('signatures bind to the talk content, including attendee names and agreed actions',async()=>{
 for(const change of [r=>r.tasks='Cut new material',r=>r.people[0].name='Someone else',r=>r.topics[0].notes='New controls',r=>r.actions[0].due='2026-10-15']){
  const r=await signed();change(r);await assert.rejects(save(store(),r),{status:409});
 }
 const r=await signed();r.site=' '+r.site+' ';assert.equal((await save(store(),r)).status,200);
});
test('completed content is immutable and action resolution retains the signatures',async()=>{
 const s=store(),r=await signed();const saved=(await save(s,r)).body.record;
 await assert.rejects(save(s,r,1,admin),{status:409});
 const resolved=(await handleToolbox(s,path(r)+'/resolve','POST',{mutationId:crypto.randomUUID(),expectedRevision:1,actionIndex:0},other)).body.record;
 assert.equal(resolved.actions[0].closed,true);assert.equal(resolved.actions[0].resolvedBy,'other');assert.deepEqual(resolved.supervisorSignature,saved.supervisorSignature);
 assert.equal(await digest(toolboxContent(resolved)),saved.contentHash);assert.equal(resolved.revision,2);
 await assert.rejects(handleToolbox(s,path(r)+'/resolve','POST',{mutationId:crypto.randomUUID(),expectedRevision:1,actionIndex:0},other),{status:409});
});
test('save retries are idempotent and cannot reuse a mutation for different data or users',async()=>{
 const s=store(),r=await signed(),body=packet(r);
 const first=await handleToolbox(s,path(r),'POST',body,supervisor);const retry=await handleToolbox(s,path(r),'POST',body,supervisor);
 assert.equal(first.body.record.revision,1);assert.equal(retry.body.duplicate,true);assert.equal(s.audits.length,1);
 await assert.rejects(handleToolbox(s,path(r),'POST',{...body,expectedRevision:1},supervisor),{status:409});
 await assert.rejects(handleToolbox(s,path(r),'POST',body,other),{status:409});
});
test('concurrent draft saves reject a stale revision without losing the first save',async()=>{
 const s=store(),r=draft();await save(s,r);const one={...r,tasks:'One'},two={...r,tasks:'Two'};
 const results=await Promise.allSettled([save(s,one,1),save(s,two,1)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
 assert.equal((await handleToolbox(s,path(r),'GET',{},supervisor)).body.record.revision,2);
});
test('records paginate without exposing signature images in list responses',async()=>{
 const s=store(),records=[];for(let i=0;i<27;i++){const r=await signed();r.date='2026-09-'+String(i>=25?27:i+1).padStart(2,'0');r.time=i===26?'09:00':'07:00';r.people[0].signature.contentHash=r.supervisorSignature.contentHash=await digest(toolboxContent(r));await save(s,r);records.push(r);}
 // An older talk updated later must not rise above newer talk dates.
 await handleToolbox(s,path(records[0])+'/resolve','POST',{mutationId:crypto.randomUUID(),expectedRevision:1,actionIndex:0},other);
 // Existing index summaries have no start time; ties still use the saved talk time.
 s.write('toolbox:index',s.read('toolbox:index').map(({time,...r})=>r));
 const privateDraft=draft();privateDraft.date='2026-12-31';await save(s,privateDraft);
 const first=(await handleToolbox(s,'/toolbox/list','POST',{offset:0},other)).body;
 assert.equal(first.total,27);assert.equal(first.records.length,25);assert.equal(first.nextOffset,25);assert.equal(first.openActionTotal,26);assert.equal(first.records[0].id,records[26].id);assert.equal(first.records[1].id,records[25].id);
 assert.equal(JSON.stringify(first).includes('data:image'),false);
 const second=(await handleToolbox(s,'/toolbox/list','POST',{offset:first.nextOffset},other)).body;assert.equal(second.records.length,2);assert.equal(second.nextOffset,null);assert.equal(second.records.at(-1).id,records[0].id);
 assert.equal((await handleToolbox(s,'/toolbox/list','POST',{search:'missing'},other)).body.total,0);
 const exportIndex=(await handleToolbox(s,'/toolbox/export-index','POST',{},other)).body;
 await save(s,await signed());assert.equal(exportIndex.ids.length,27);
 assert.equal((await handleToolbox(s,'/toolbox/export-index','POST',{},other)).body.ids.length,28);
});
test('invalid dates, oversized data, unsupported images and client identity fields are rejected or ignored',async()=>{
 for(const mutate of [r=>r.date='2026-02-30',r=>r.date='2026-99-99',r=>r.tasks='x'.repeat(5001),r=>r.people=Array(61).fill(r.people[0]),r=>r.supervisorSignature={image:'data:image/svg+xml;base64,AAAA',at:new Date().toISOString(),contentHash:'a'.repeat(64)}]){
  const r=draft();mutate(r);assert.throws(()=>normalizeToolboxRecord(r));
 }
 const r=draft();Object.assign(r,{completedBy:'forged',createdBy:'forged',revision:999});const saved=(await save(store(),r)).body.record;assert.equal(saved.createdBy,'supervisor');assert.equal(saved.revision,1);assert.equal(saved.completedBy,null);
});

test('pre-start fields persist and bind signatures; legacy hashes remain compatible',async()=>{
 const legacy=await signed();assert.equal((await save(store(),legacy)).status,200);
 const r=draft();r.prestart={highRisk:'Lifting',previousShift:'Check extraction',checklist:Array(13).fill('Y')};r.people[0].timeIn='06:30';r.people[0].timeOut='06:50';r.status='Completed';const sig={image,at:new Date().toISOString(),contentHash:await digest(toolboxContent(r))};r.people[0].signature={...sig};r.supervisorSignature={...sig};
 const stored=(await save(store(),r)).body.record;assert.deepEqual(stored.prestart,r.prestart);assert.equal(stored.people[0].timeOut,'06:50');
 for(const change of [x=>x.prestart.checklist[0]='N',x=>x.prestart.highRisk='Changed lifting',x=>x.prestart.previousShift='New issue',x=>x.people[0].timeOut='07:00']){const changed=structuredClone(r);change(changed);await assert.rejects(save(store(),changed),{status:409});}
});
test('pre-start validation rejects missing checklist answers on completion and invalid times',async()=>{
 const r=draft();r.prestart={highRisk:'',previousShift:'',checklist:Array(13).fill('')};r.people[0].timeIn='25:00';assert.throws(()=>normalizeToolboxRecord(r),/Invalid attendance time/);r.people[0].timeIn='06:30';r.prestart.checklist[0]='invalid';assert.throws(()=>normalizeToolboxRecord(r),/Invalid pre-start checklist/);r.prestart.checklist[0]='';r.status='Completed';const sig={image,at:new Date().toISOString(),contentHash:await digest(toolboxContent(r))};r.people[0].signature=sig;r.supervisorSignature=sig;await assert.rejects(save(store(),r),/Answer all pre-start/);
});

test('weekly employers persist, bind signatures and do not require the daily checklist',async()=>{const r=draft();r.type='weekly';r.topics=TOOLBOX_DEFAULTS.weekly.map(text=>({text,notes:'',reviewed:true}));r.focus='Lifting safety';r.people[0].employer='Contractor';r.status='Completed';const sig={image,at:new Date().toISOString(),contentHash:await digest(toolboxContent(r))};r.people[0].signature={...sig};r.supervisorSignature={...sig};const saved=(await save(store(),r)).body.record;assert.equal(saved.people[0].employer,'Contractor');assert.equal(saved.prestart,undefined);r.people[0].employer='Different contractor';await assert.rejects(save(store(),r),{status:409});r.people[0].employer=123;assert.throws(()=>normalizeToolboxRecord(r),/Invalid or overlong/);});

test('selected attendee user identities bind signatures and legacy daily sections remain supported',async()=>{const r=draft();r.people[0].userUsername='worker';r.status='Completed';const sig={image,at:new Date().toISOString(),contentHash:await digest(toolboxContent(r))};r.people[0].signature=sig;r.supervisorSignature=sig;assert.equal((await save(store(),r)).body.record.people[0].userUsername,'worker');r.people[0].userUsername='different';await assert.rejects(save(store(),r),{status:409});const legacy=draft();legacy.topics=TOOLBOX_DEFAULTS.weekly.map(text=>({text,notes:'',reviewed:true}));assert.equal(normalizeToolboxRecord(legacy).topics.length,6);});

test('draft deletion removes content, list and export entries, is retryable, and blocks stale resurrection',async()=>{
 const s=store(),r=draft();await save(s,r);const deletion={mutationId:crypto.randomUUID(),expectedRevision:1};
 assert.equal((await handleToolbox(s,path(r)+'/delete','POST',deletion,supervisor)).body.deleted,true);
 await assert.rejects(handleToolbox(s,path(r),'GET',{},admin),{status:404});
 assert.equal((await handleToolbox(s,'/toolbox/list','POST',{},supervisor)).body.total,0);
 assert.deepEqual((await handleToolbox(s,'/toolbox/export-index','POST',{},admin)).body.ids,[]);
 const tombstone=s.read('toolbox:record:'+r.id);assert.equal(tombstone.status,'Deleted');assert.equal(tombstone.revision,2);assert.equal(tombstone.tasks,undefined);assert.equal(tombstone.people,undefined);
 assert.equal((await handleToolbox(s,path(r)+'/delete','POST',deletion,supervisor)).body.duplicate,true);
 assert.equal((await handleToolbox(s,path(r)+'/delete','POST',{...deletion,mutationId:crypto.randomUUID()},supervisor)).body.deleted,true);
 assert.equal(s.audits.filter(a=>a[1]==='toolbox-draft-deleted').length,1);
 await assert.rejects(save(s,r,0),{status:409});await assert.rejects(save(s,r,1),{status:409});
 await assert.rejects(handleToolbox(s,path(r)+'/delete','POST',deletion,other),{status:409});
});
test('only owners and admins can delete drafts, and stale revisions or completed talks are protected',async()=>{
 const s=store(),r=draft();await save(s,r);const remove=(record,revision,actor)=>handleToolbox(s,path(record)+'/delete','POST',{expectedRevision:revision,mutationId:crypto.randomUUID()},actor);
 await assert.rejects(remove(r,1,other),{status:403});await save(s,{...r,tasks:'Updated tasks'},1);
 await assert.rejects(remove(r,1,supervisor),{status:409});assert.equal(s.read('toolbox:record:'+r.id).tasks,'Updated tasks');
 assert.equal((await remove(r,2,admin)).body.deleted,true);
 const completed=await signed();await save(s,completed);await assert.rejects(remove(completed,1,admin),{status:409});assert.equal((await handleToolbox(s,path(completed),'GET',{},admin)).body.record.status,'Completed');
});
test('individual attendance signatures survive roster additions and removals while completed records retain every signature',async()=>{
 for(const type of ['daily','weekly']){
  const s=store(),r=draft();r.type=type;r.focus=type==='weekly'?'Welding':'';r.topics=TOOLBOX_DEFAULTS[type].map(text=>({text,notes:'',reviewed:true}));r.actions=[];r.people[0].userUsername='first';
  const sign=async i=>{const roster=[toolboxAttendeeSnapshot(r.people[i])];r.people[i].signature={image,at:new Date().toISOString(),attendeeRoster:roster,contentHash:await digest(toolboxContent({...r,people:roster}))};r.people[i].ack=true;};
  await sign(0);const first=structuredClone(r.people[0].signature);await save(s,r);
  r.people.push({name:'Second Worker',userUsername:'second',ack:false,signature:null});await sign(1);await save(s,r,1);assert.deepEqual(r.people[0].signature,first);
  r.people.push({name:'Temporary attendee',userUsername:'temp',ack:false,signature:null});await save(s,r,2);r.people.splice(2,1);await save(s,r,3);
  r.status='Completed';r.supervisorSignature={image,at:new Date().toISOString(),contentHash:await digest(toolboxContent(r))};const completed=(await save(s,r,4)).body.record;
  assert.deepEqual(completed.people[0].signature,first);assert.ok(completed.people[1].signature);assert.ok(completed.supervisorSignature);
 }
});
test('previous full-roster signatures retain their original hash through attendance snapshot migration',async()=>{
 const s=store(),r=await signed();r.status='Draft';r.supervisorSignature=null;const first=structuredClone(r.people[0].signature);await save(s,r);
 r.people[0].signature={...first,attendeeRoster:r.people.map(toolboxAttendeeSnapshot)};r.people.push({name:'New arrival',ack:false,signature:null});const saved=(await save(s,r,1)).body.record;
 assert.equal(saved.people[0].signature.image,first.image);assert.equal(saved.people[0].signature.at,first.at);assert.equal(saved.people[0].signature.contentHash,first.contentHash);
});
test('attendance snapshots cannot bypass changed discussion, signer details, record identity or supervisor roster validation',async()=>{
 for(const mutate of [r=>r.tasks='Changed work',r=>r.date='2026-10-14',r=>r.topics[0].notes='Changed controls',r=>r.actions[0].owner='Different owner',r=>r.people[0].name='Different worker',r=>r.people[0].userUsername='different',r=>r.people[0].employer='Different employer',r=>r.id=crypto.randomUUID()]){
  const r=draft();r.people[0].userUsername='first';const roster=[toolboxAttendeeSnapshot(r.people[0])];r.people[0].signature={image,at:new Date().toISOString(),attendeeRoster:roster,contentHash:await digest(toolboxContent({...r,people:roster}))};mutate(r);await assert.rejects(save(store(),r),{status:409});
 }
 const r=await signed();r.people[0].signature={...r.people[0].signature,attendeeRoster:r.people.map(toolboxAttendeeSnapshot)};r.people.push({name:'Another',ack:false,signature:null});await assert.rejects(save(store(),r),{status:409});
});
test('signed attendance metadata is bounded and rejects malformed identities and times',async()=>{
 for(const roster of [[],Array(61).fill({name:'Worker'}),[{name:'x'.repeat(121)}],[{name:'Worker',userUsername:42}],[{name:'Worker',timeIn:'25:00'}]]){
  const r=draft();r.people[0].signature={image,at:new Date().toISOString(),contentHash:'a'.repeat(64),attendeeRoster:roster};assert.throws(()=>normalizeToolboxRecord(r));
 }
});
test('admin drafts retain planned daily/weekly attendees without sharing signatures or completed inspection results',async()=>{
 const s=store();for(const type of ['daily','weekly']){
  const r=await signed();r.type=type;r.topics=TOOLBOX_DEFAULTS[type].map(text=>({text,notes:'Admin preparation',reviewed:true}));r.prestart={highRisk:'Hot work',previousShift:'Check extraction',checklist:Array(13).fill('Y')};r.people[0].userUsername='worker';r.people[0].employer='Private employer';r.people[0].timeIn='06:30';r.people[0].timeOut='07:00';r.people.push({name:'',userUsername:'',ack:false,signature:null});
  const id=crypto.randomUUID(),body={id,title:type+' preparation',record:r,expectedRevision:0,mutationId:crypto.randomUUID()};
  await assert.rejects(handleToolbox(s,'/toolbox/admin-drafts','POST',body,supervisor),{status:403});
  const saved=(await handleToolbox(s,'/toolbox/admin-drafts','POST',body,admin)).body.draft;assert.equal(saved.revision,1);assert.equal(saved.createdBy,'admin');assert.equal(saved.content.type,type);assert.deepEqual(saved.content.people,[{name:'Worker',userUsername:'worker'}]);assert.equal(saved.content.supervisorSignature,undefined);assert.equal(saved.content.date,undefined);assert.equal(saved.content.time,undefined);assert.equal(saved.content.facilitator,undefined);assert.equal(saved.content.actions[0].due,'');assert.deepEqual(saved.content.prestart.checklist,Array(13).fill(''));
  assert.equal((await handleToolbox(s,'/toolbox/admin-drafts','POST',body,admin)).body.duplicate,true);assert.equal((await handleToolbox(s,'/toolbox/admin-drafts/'+id,'GET',{},other)).body.draft.content.topics[0].notes,'Admin preparation');
  await assert.rejects(handleToolbox(s,'/toolbox/admin-drafts','POST',{...body,title:'Changed'},admin),{status:409});await assert.rejects(handleToolbox(s,'/toolbox/admin-drafts','POST',{...body,mutationId:crypto.randomUUID()},admin),{status:409});
  const updated=(await handleToolbox(s,'/toolbox/admin-drafts','POST',{...body,title:'Updated',expectedRevision:1,mutationId:crypto.randomUUID()},admin)).body.draft;assert.equal(updated.revision,2);
  const deletion={expectedRevision:2,mutationId:crypto.randomUUID()};await assert.rejects(handleToolbox(s,'/toolbox/admin-drafts/'+id+'/delete','POST',deletion,other),{status:403});assert.equal((await handleToolbox(s,'/toolbox/admin-drafts/'+id+'/delete','POST',deletion,admin)).body.deleted,true);assert.equal((await handleToolbox(s,'/toolbox/admin-drafts/'+id+'/delete','POST',deletion,admin)).body.duplicate,true);
  await assert.rejects(handleToolbox(s,'/toolbox/admin-drafts/'+id,'GET',{},supervisor),{status:404});await assert.rejects(handleToolbox(s,'/toolbox/admin-drafts','POST',{...body,expectedRevision:3,mutationId:crypto.randomUUID()},admin),{status:409});
 }
 assert.deepEqual((await handleToolbox(s,'/toolbox/admin-drafts','GET',{},supervisor)).body.drafts,[]);
});

test('admin attendee selections support older clients and reject malformed or oversized rosters',async()=>{
 const s=store(),record=draft();delete record.people;
 const send=record=>handleToolbox(s,'/toolbox/admin-drafts','POST',{id:crypto.randomUUID(),title:'Planned team',record,expectedRevision:0,mutationId:crypto.randomUUID()},admin);
 assert.deepEqual((await send(record)).body.draft.content.people,[]);
 for(const people of [42,{},[null],Array(61).fill({name:'Worker'}),[{name:'x'.repeat(121)}],[{name:'Worker',userUsername:42}],[{name:'Worker',userUsername:'x'.repeat(41)}]])await assert.rejects(send({...record,people}),{status:400});
 const saved=(await send({...record,people:[{name:' Worker ',userUsername:' worker ',ack:true,signature:{image:'invalid'},employer:'Private',timeIn:'invalid',attendeeRoster:[{name:'Other'}]}]})).body.draft;
 assert.deepEqual(saved.content.people,[{name:'Worker',userUsername:'worker'}]);
});
