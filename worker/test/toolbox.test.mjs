import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleToolbox,toolboxContent,TOOLBOX_DEFAULTS,normalizeToolboxRecord} from '../src/toolbox.js';
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
 const s=store();for(let i=0;i<27;i++)await save(s,await signed());
 const first=(await handleToolbox(s,'/toolbox/list','POST',{offset:0},other)).body;
 assert.equal(first.total,27);assert.equal(first.records.length,25);assert.equal(first.nextOffset,25);assert.equal(first.openActionTotal,27);
 assert.equal(JSON.stringify(first).includes('data:image'),false);
 const second=(await handleToolbox(s,'/toolbox/list','POST',{offset:first.nextOffset},other)).body;assert.equal(second.records.length,2);assert.equal(second.nextOffset,null);
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
