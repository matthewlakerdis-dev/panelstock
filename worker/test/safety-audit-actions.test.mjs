import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {handleToolbox} from '../src/toolbox.js';
import {WALK_TEMPLATE} from '../src/safety-walk-template.js';
import {walkContent,walkNewAction} from '../src/safety-walks.js';
import {digest} from '../src/security.js';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const actor={username:'auditor',tasks:{'factory.toolbox':true}},other={username:'other',tasks:{'factory.toolbox':true}},member={username:'member'};
function store(){const docs=new Map([['users',{auditor:{displayName:'Conductor'},other:{displayName:'Other Supervisor'}}]]);return {docs,read:(k,d=null)=>structuredClone(docs.has(k)?docs.get(k):d),write:(k,v)=>docs.set(k,structuredClone(v)),audit(){},ctx:{storage:{transactionSync:f=>f()}},requireTask(a){if(!a?.tasks?.['factory.toolbox'])throw Object.assign(Error('Forbidden'),{status:403});}};}
const call=(s,path='',body,who=actor)=>handleToolbox(s,'/toolbox/walks'+path,body===undefined?'GET':'POST',body||{},who);
function draft(date='2026-01-05'){return {id:crypto.randomUUID(),status:'Draft',date,auditors:'Conductor',area:'Workshop',previousReviewed:'Yes',answers:WALK_TEMPLATE.sections.flatMap(s=>s.items.map(i=>({ref:i.ref,result:'C',comments:''}))),actions:[],summary:{escalation:'',resources:'',findings:'',priorities:['','','']},review:{by:'',date:'',position:'',nextAuditDue:'',actionsAccepted:'',escalationRequired:'',comments:''}};}
const save=async(s,r=draft())=>(await call(s,'/'+r.id,{record:r,expectedRevision:r.revision||0,mutationId:crypto.randomUUID()})).body.record;
async function finish(s,r){r=await save(s,r);r.status='Completed';r.signature={image,at:new Date().toISOString(),contentHash:await digest(walkContent(r))};return (await call(s,'/'+r.id,{record:r,expectedRevision:r.revision,mutationId:crypto.randomUUID()})).body.record;}
async function raised(s,day='2026-01-05',result='NC'){let r=await save(s,draft(day));r.answers[0].result=result;r=await save(s,r);Object.assign(r.actions[0],{risk:'M',correctiveAction:'Replace damaged guard',due:'2026-02-01'});return finish(s,r);}
const path=a=>'/actions/'+a.originAuditId+'/'+a.originActionId;
const list=async s=>(await call(s,'/actions')).body.actions;
const update=(a,fields={})=>({operation:'update',expectedRevision:a.revision,mutationId:crypto.randomUUID(),...Object.fromEntries(['status','owner','due','closeEvidence','verifiedBy','verifiedDate'].map(k=>[k,a[k]])),...fields});
const photo=(r,a,name='guard.png')=>({action:'upload',ref:a.ref,actionId:a.id,fileName:name,mime:'image/png',data:image.split(',')[1],expectedRevision:r.revision,mutationId:crypto.randomUUID()});

test('NC/O completion needs corrective details without inspection comments; inherited actions flag their point without duplicates',async()=>{for(const result of ['NC','O']){const s=store(),first=await raised(s,undefined,result);assert.equal(first.answers[0].comments,'');let next=await save(s,draft('2026-02-02'));assert.equal(next.answers[0].result,result);assert.equal(next.answers[0].carriedFlag,true);assert.equal(next.actions.length,0);assert.equal(next.carriedActions.length,1);next.answers[0].result='C';next=await save(s,next);assert.equal(next.answers[0].result,result);assert.equal(next.actions.length,0);assert.equal((await finish(s,next)).status,'Completed');assert.equal((await list(s)).length,1);}});
test('register closure updates future carry, rejects stale audit signatures, and preserves both signed reports and records',async()=>{const s=store(),first=await raised(s),before=JSON.stringify(s.read('safety:walk:'+first.id)),pdf=JSON.stringify(s.read('safety:walk-pdf:'+first.id)),actionsPdf=JSON.stringify(s.read('safety:audit-actions-pdf:'+first.id));let pending=await save(s,draft('2026-02-02')),a=(await list(s))[0];await assert.rejects(call(s,path(a),update(a,{status:'Closed'})),{status:400});a=(await call(s,path(a),update(a,{status:'Closed',closeEvidence:'Guard replaced and tested',verifiedBy:'Other Supervisor',verifiedDate:'2026-01-20'}),other)).body.action;assert.equal(a.status,'Closed');assert.equal(a.history.at(-1).by,'other');assert.equal(a.history.at(-1).verifiedBy,'Other Supervisor');await assert.rejects(finish(s,pending),{status:409});pending=s.read('safety:walk:'+pending.id);pending=(await call(s,'/'+pending.id+'/carry-forward',{expectedRevision:pending.revision,mutationId:crypto.randomUUID()})).body.record;assert.equal(pending.carriedActions.length,0);assert.equal(pending.answers[0].result,'');assert.equal(pending.answers[0].carriedFlag,undefined);pending.answers[0].result='C';await finish(s,pending);assert.equal((await save(s,draft('2026-03-02'))).carriedActions.length,0);assert.equal(JSON.stringify(s.read('safety:walk:'+first.id)),before);assert.equal(JSON.stringify(s.read('safety:walk-pdf:'+first.id)),pdf);assert.equal(JSON.stringify(s.read('safety:audit-actions-pdf:'+first.id)),actionsPdf);});
test('action-linked audit photos are signed, appear in both PDFs and carry into the live register',async()=>{const s=store();let r=await save(s);r.answers[0].result='NC';r=await save(s,r);Object.assign(r.actions[0],{risk:'L',correctiveAction:'Replace guard',due:r.date});r=await save(s,r);const p=photo(r,r.actions[0]),uploaded=await call(s,'/'+r.id+'/file',p);r=uploaded.body.record;assert.equal(r.evidence[0].actionId,r.actions[0].id);assert.equal((await call(s,'/'+r.id+'/file',p)).body.duplicate,true);r=await finish(s,r);const a=(await list(s))[0];assert.equal(a.photos.length,1);assert.equal(a.photos[0].hash,r.evidence[0].hash);const report=(await call(s,'/'+r.id+'/actions-pdf')).body;assert.equal((await PDFDocument.load(Buffer.from(report.data,'base64'))).getPageCount(),2);const next=await save(s,draft('2026-02-02'));assert.equal(next.carriedActions[0].photos[0].id,r.evidence[0].id);const data=(await call(s,path(a),{operation:'download-photo',fileId:a.photos[0].id,mutationId:crypto.randomUUID()})).body;assert.equal(data.data,image.split(',')[1]);await assert.rejects(call(s,path(a),{operation:'download-photo',fileId:crypto.randomUUID(),mutationId:crypto.randomUUID()}),{status:404});});
test('register photo retries deduplicate safely, enforce limits and types, and reject cross-user access without supervisor permission',async()=>{const s=store();await raised(s);let a=(await list(s))[0];const original=s.read('safety:walk:'+a.originAuditId),p={operation:'upload-photo',expectedRevision:a.revision,mutationId:crypto.randomUUID(),fileName:'repair.png',mime:'image/png',data:image.split(',')[1]};a=(await call(s,path(a),p)).body.action;assert.equal(a.photos.length,1);assert.equal((await call(s,path(a),p)).body.duplicate,true);await assert.rejects(call(s,path(a),{...p,fileName:'changed.png'}),{status:409});await assert.rejects(call(s,path(a),{...p,mutationId:crypto.randomUUID()}),{status:409});await assert.rejects(call(s,path(a),{...p,expectedRevision:a.revision,mutationId:crypto.randomUUID(),mime:'text/plain',fileName:'bad.txt'}),{status:400});for(let i=2;i<=5;i++)a=(await call(s,path(a),{...p,expectedRevision:a.revision,mutationId:crypto.randomUUID(),fileName:'repair'+i+'.png'})).body.action;await assert.rejects(call(s,path(a),{...p,expectedRevision:a.revision,mutationId:crypto.randomUUID(),fileName:'six.png'}),{status:400});await assert.rejects(call(s,'/actions',undefined,member),{status:403});await assert.rejects(call(s,path(a),undefined,member),{status:403});await assert.rejects(call(s,path(a),update(a),member),{status:403});assert.deepEqual(s.read('safety:walk:'+a.originAuditId),original);});
test('concurrent close-out cannot overwrite later changes; a reopened action reappears as the same origin in future audits',async()=>{const s=store();await raised(s);let a=(await list(s))[0],old=structuredClone(a);a=(await call(s,path(a),update(a,{status:'Closed',closeEvidence:'Verified repair',verifiedBy:'Manager',verifiedDate:'2026-01-20'}))).body.action;await assert.rejects(call(s,path(old),update(old,{status:'In progress'}),other),{status:409});assert.equal((await save(s,draft('2026-02-02'))).carriedActions.length,0);a=(await call(s,path(a),update(a,{status:'Open'}),other)).body.action;const next=await save(s,draft('2026-03-02'));assert.equal(next.carriedActions.length,1);assert.equal(next.carriedActions[0].originActionId,a.originActionId);assert.equal(next.answers[0].result,'NC');assert.equal((await list(s)).length,1);});
test('forged action photo links are rejected and action photos survive changing an unused result',async()=>{const s=store();let r=await save(s);r.answers[0].result='NC';r=await save(s,r);await assert.rejects(call(s,'/'+r.id+'/file',{...photo(r,r.actions[0]),actionId:crypto.randomUUID()}),{status:400});await assert.rejects(call(s,'/'+r.id+'/file',{...photo(r,r.actions[0]),ref:'2.2'}),{status:400});r=(await call(s,'/'+r.id+'/file',photo(r,r.actions[0]))).body.record;r.answers[0].result='C';r=await save(s,r);assert.equal(r.actions.length,1);assert.equal(r.evidence.length,1);});

test('deleting an own draft removes its files, preserves numbering and blocks delayed saves from resurrecting it',async()=>{const s=store();let r=await save(s);r.answers[0].result='NC';r=await save(s,r);r=(await call(s,'/'+r.id+'/file',photo(r,r.actions[0]))).body.record;const oldSave={record:r,expectedRevision:r.revision,mutationId:crypto.randomUUID()};r=(await call(s,'/'+r.id,oldSave)).body.record;const deletion={expectedRevision:r.revision,mutationId:crypto.randomUUID()};await assert.rejects(call(s,'/'+r.id+'/delete',deletion,other),{status:404});await assert.rejects(call(s,'/'+r.id+'/delete',{...deletion,expectedRevision:0}),{status:409});assert.equal((await call(s,'/'+r.id+'/delete',deletion)).body.deletedId,r.id);assert.equal((await call(s,'/'+r.id+'/delete',deletion)).body.duplicate,true);assert.equal(s.read('safety:walk-file:'+r.evidence[0].id),null);await assert.rejects(call(s,'/'+r.id),{status:404});await assert.rejects(call(s,'/'+r.id,oldSave),{status:409});await assert.rejects(save(s,{...r,revision:0}),{status:409});assert.equal((await save(s)).documentNo,'LF-MA-0002');assert.equal((await call(s)).body.records.some(v=>v.id===r.id),false);});
test('signed audits cannot be deleted, including by their conductor',async()=>{const s=store(),r=await raised(s);await assert.rejects(call(s,'/'+r.id+'/delete',{expectedRevision:r.revision,mutationId:crypto.randomUUID()}),{status:409});assert.equal((await call(s,'/'+r.id)).body.record.status,'Completed');});

const registerPhoto=(a,name='repair.png')=>({operation:'upload-photo',expectedRevision:a.revision,mutationId:crypto.randomUUID(),fileName:name,mime:'image/png',data:image.split(',')[1]});
const actionKey=a=>'safety:audit-action:'+a.originAuditId+':'+a.originActionId;
function untagPhotos(action){for(const group of ['photos','photoArchive'])for(const file of action[group]||[]){delete file.photoSource;delete file.auditId;}return action;}

test('five signed audit photos leave five separate close-out slots and original photos remain read-only',async()=>{
 const s=store();let r=await save(s);r.answers[0].result='NC';r=await save(s,r);
 Object.assign(r.actions[0],{risk:'L',correctiveAction:'Replace guard',due:r.date});r=await save(s,r);
 for(let i=0;i<5;i++)r=(await call(s,'/'+r.id+'/file',photo(r,r.actions[0],'audit-'+i+'.png'))).body.record;
 assert.ok(r.evidence.every(f=>f.photoSource==='audit'&&f.auditId===r.id));
 r=await finish(s,r);const original=structuredClone(s.read('safety:walk:'+r.id));let a=(await list(s))[0];
 // Matching content and filename in the audit must not suppress a distinct close-out attachment.
 a=(await call(s,path(a),registerPhoto(a,'audit-0.png'))).body.action;
 for(let i=1;i<5;i++)a=(await call(s,path(a),registerPhoto(a,'repair-'+i+'.png'))).body.action;
 assert.equal(a.photos.filter(f=>f.photoSource==='audit').length,5);
 assert.equal(a.photos.filter(f=>f.photoSource==='closeout').length,5);
 assert.notEqual(a.photos[0].id,a.photos.find(f=>f.photoSource==='closeout'&&f.fileName==='audit-0.png').id);
 await assert.rejects(call(s,path(a),registerPhoto(a,'sixth-repair.png')),{status:400});
 await assert.rejects(call(s,path(a),{operation:'remove-photo',fileId:r.evidence[0].id,expectedRevision:a.revision,mutationId:crypto.randomUUID()}),{status:409});
 const removed=a.photos.find(f=>f.photoSource==='closeout');
 a=(await call(s,path(a),{operation:'remove-photo',fileId:removed.id,expectedRevision:a.revision,mutationId:crypto.randomUUID()})).body.action;
 a=(await call(s,path(a),registerPhoto(a,'replacement.png'))).body.action;
 assert.equal(a.photos.length,10);assert.ok(!a.photos.some(f=>f.id===removed.id));
 assert.ok(a.photoArchive.some(f=>f.id===removed.id&&f.photoSource==='closeout'));
 assert.deepEqual(s.read('safety:walk:'+r.id),original);
});

test('legacy register and duplicate responses gain photo provenance without changing signed data or snapshot revisions',async()=>{
 const s=store();let r=await save(s);r.answers[0].result='NC';r=await save(s,r);Object.assign(r.actions[0],{risk:'L',correctiveAction:'Replace guard',due:r.date});r=await save(s,r);
 r=(await call(s,'/'+r.id+'/file',photo(r,r.actions[0],'legacy-audit.png'))).body.record;
 // Emulate a draft completed before photo-source metadata existed, including a valid signature.
 for(const f of r.evidence){delete f.photoSource;delete f.auditId;}s.write('safety:walk:'+r.id,r);r=await finish(s,r);
 let a=(await list(s))[0],packet=registerPhoto(a,'legacy-closeout.png');a=(await call(s,path(a),packet)).body.action;
 const oldRevision=a.revision,old=s.read('safety:audit-action-mutation:'+packet.mutationId);old.response.action=untagPhotos(old.response.action);s.write('safety:audit-action-mutation:'+packet.mutationId,old);
 a=(await call(s,path(a),update(a,{closeEvidence:'Newer follow-up saved on another device'}))).body.action;
 s.write(actionKey(a),untagPhotos(a));const before=structuredClone([...s.docs]);
 const loaded=(await call(s,path(a))).body.action;
 assert.deepEqual(loaded.photos.map(f=>f.photoSource),['audit','closeout']);
 assert.equal(loaded.photos[0].auditId,r.id);assert.equal(loaded.photos[1].auditId,undefined);
 const retried=(await call(s,path(a),packet)).body;
 assert.equal(retried.duplicate,true);assert.equal(retried.action.revision,oldRevision);
 assert.deepEqual(retried.action.photos.map(f=>f.photoSource),['audit','closeout']);
 assert.deepEqual([...s.docs],before,'Read-time compatibility must not migrate or rewrite stored records');
 await assert.rejects(call(s,path(retried.action),update(retried.action,{closeEvidence:'Stale device text'})),{status:409});
 const archived=structuredClone(loaded);archived.photoArchive=[...archived.photos];archived.photos=[];s.write(actionKey(a),untagPhotos(archived));
 const removed=(await call(s,path(a))).body.action;
 assert.deepEqual(removed.photos,[],'Source classification must not restore previously removed photos');
 assert.deepEqual(removed.photoArchive.map(f=>f.photoSource),['audit','closeout']);
});

test('carried actions retain close-out provenance and a separate audit photo quota when a later audit is signed',async()=>{
 const s=store(),first=await raised(s);let a=(await list(s))[0];
 for(let i=0;i<5;i++)a=(await call(s,path(a),registerPhoto(a,'repair-'+i+'.png'))).body.action;
 let next=await save(s,draft('2026-02-02'));
 assert.equal(next.carriedActions[0].photos.filter(f=>f.photoSource==='closeout').length,5);
 for(let i=0;i<5;i++)next=(await call(s,'/'+next.id+'/file',photo(next,next.carriedActions[0],'later-audit-'+i+'.png'))).body.record;
 await assert.rejects(call(s,'/'+next.id+'/file',photo(next,next.carriedActions[0],'sixth-audit.png')),{status:400});
 next=await finish(s,next);a=(await list(s))[0];
 assert.equal(a.originAuditId,first.id);assert.equal(a.photos.filter(f=>f.photoSource==='audit').length,5);assert.equal(a.photos.filter(f=>f.photoSource==='closeout').length,5);
 assert.ok(a.photos.filter(f=>f.photoSource==='audit').every(f=>f.auditId===next.id));
 assert.ok(next.carriedActions[0].photos.every(f=>f.photoSource==='closeout'));
 const later=await save(s,draft('2026-03-02'));
 await assert.rejects(call(s,'/'+later.id+'/file',photo(later,later.carriedActions[0],'extra-audit.png')),{status:400});
});
