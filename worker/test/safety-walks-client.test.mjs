import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildToolboxPage} from '../src/toolbox-page.js';
import {handleToolbox} from '../src/toolbox.js';
import {applyMonthlyAuditReset,MONTHLY_AUDIT_RESET_ID} from '../src/safety-audit-reset.js';
function storage(){const docs=new Map([['users',{supervisor:{displayName:'Supervisor'},other:{displayName:'Other'}}]]);return {docs,read:(k,f=null)=>structuredClone(docs.has(k)?docs.get(k):f),write:(k,v)=>docs.set(k,structuredClone(v)),ctx:{storage:{transactionSync:f=>f()}},audit(){},requireTask(a){if(!a.tasks?.['factory.toolbox'])throw Object.assign(Error('Forbidden'),{status:403});}};}
function device(s,username='supervisor'){
 const nodes=new Map(),cache=new Map(),requests=[],timers=new Map();let serial=0;const h={cache,requests,timers,username,offline:false,dropResponse:false,gate:null};
 const element=()=>({style:{},classList:{add(){},remove(){}},addEventListener(){},innerHTML:'',textContent:'',setAttribute(){},removeAttribute(){},querySelectorAll:()=>[],focus(){},scrollIntoView(){},close(){},showModal(){}});
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,URLSearchParams,location:{search:'',hash:'',pathname:'/toolbox'},setTimeout:(f,ms)=>{const id=++serial;timers.set(id,{f,ms});return id;},clearTimeout:id=>timers.delete(id),confirm:()=>true,localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},window:{scrollY:0,scrollX:0,scrollTo(){}},document:{addEventListener(){},createElement:element,querySelector:element,querySelectorAll:()=>[],getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)}},fetch:async(path,options={})=>{const packet=options.body?JSON.parse(options.body):undefined;requests.push({path,packet});if(path==='/session')return {ok:true,json:async()=>({username:h.username,isAdmin:false,taskAccess:{'factory.toolbox':true}})};if(path==='/toolbox/users')return {ok:true,json:async()=>({users:[{username:h.username,displayName:h.username}]})};if(path==='/toolbox/safety-documents/summary')return {ok:true,json:async()=>({outstanding:0,assigned:0,completed:0,pending:[]})};if(path==='/logout')return {ok:true,json:async()=>({ok:true})};if(h.offline)throw Error('Network unavailable');try{if(h.gate&&path.startsWith('/toolbox/walks/')&&packet?.record)await h.gate;if(h.fileGate&&path.endsWith('/file')&&packet?.action!=='download')await h.fileGate;const r=await handleToolbox(s,path,packet?'POST':'GET',packet||{},{username:h.username,tasks:{'factory.toolbox':true}});if(h.dropActionResponse&&path.startsWith('/toolbox/walks/actions/')&&packet?.operation){h.dropActionResponse=false;throw Error('Response lost');}if(h.dropResponse&&path.startsWith('/toolbox/walks/')&&packet?.record){h.dropResponse=false;throw Error('Response lost');}if(h.dropFileResponse&&path.endsWith('/file')&&packet?.action!=='download'){h.dropFileResponse=false;throw Error('Photo response lost');}return {ok:true,status:r.status,json:async()=>r.body};}catch(e){if(!e.status)throw e;return {ok:false,status:e.status,json:async()=>({error:e.message})};}}});
 vm.runInContext(buildToolboxPage().split('<script>')[1].split('</script>')[0],context);h.context=context;h.run=c=>vm.runInContext(c,context);h.login=()=>h.run("token='synthetic';startSession()");h.record=()=>JSON.parse(h.run('JSON.stringify(walkRecord)'));h.start=async()=>{await h.login();await h.run('openWalks()');await h.run('newWalk()');};return h;
}
test('monthly draft autosave keeps edits after a clean save and resumes the selected account on another device',async()=>{const s=storage(),a=device(s);await a.start();await a.run('syncWalk()');a.run("walkSet('area','CNC workshop');walkSet('answers.10.comments','Extraction inspected')");assert.equal(await a.run('syncWalk()'),true);assert.equal(s.read('safety:walk:'+a.record().id).area,'CNC workshop');const b=device(s);await b.login();await b.run(`loadWalk('${a.record().id}')`);assert.equal(b.record().answers[10].comments,'Extraction inspected');const other=device(s,'other');await other.login();await other.run('openWalks()');assert.equal(other.run('walkData.total'),0);});
test('an uncertain monthly save confirms its original packet before saving subsequent edits',async()=>{const s=storage(),a=device(s);await a.start();a.run("walkSet('area','Original area')");a.dropResponse=true;assert.equal(await a.run('syncWalk()'),false);const original=a.run('walkPending.body.mutationId');assert.equal(s.read('safety:walk:'+a.record().id).area,'Original area');a.run("walkSet('area','Latest area')");assert.equal(await a.run('syncWalk()'),true);assert.equal(s.read('safety:walk:'+a.record().id).area,'Latest area');assert.equal(s.read('safety:walks').length,1);assert.equal(a.requests.filter(r=>r.packet?.mutationId===original).length,2);assert.equal(a.record().revision,3);});
test('typing during an in-flight monthly save preserves both edits and advances the correct revision',async()=>{const s=storage(),a=device(s);await a.start();let release;a.gate=new Promise(r=>release=r);a.run("walkSet('area','First area')");const saving=a.run('syncWalk()');a.run("walkSet('summary.findings','New notes during save')");a.gate=null;release();assert.equal(await saving,true);assert.equal(s.read('safety:walk:'+a.record().id).summary.findings,'New notes during save');assert.equal(a.record().revision,3);});
test('conflicts and offline changes keep a private device copy and do not overwrite newer account records',async()=>{const s=storage(),a=device(s);await a.start();const b=device(s);await b.login();await b.run(`loadWalk('${a.record().id}')`);a.run("walkSet('area','Device A newer')");await a.run('syncWalk()');b.run("walkSet('area','Device B unsaved')");assert.equal(await b.run('syncWalk()'),false);assert.equal(b.record().area,'Device B unsaved');assert.equal(s.read('safety:walk:'+a.record().id).area,'Device A newer');assert.match(b.run('walkSaveError'),/another device/);assert.equal(JSON.parse([...b.cache.values()].find(v=>v.includes('Device B unsaved'))).record.area,'Device B unsaved');const c=device(s,'other');await c.start();c.offline=true;c.run("walkSet('area','Offline changes')");assert.equal(await c.run('syncWalk()'),false);c.offline=false;assert.equal(await c.run('syncWalk()'),true);assert.equal(s.read('safety:walk:'+c.record().id).area,'Offline changes');});

test('a walk first started offline can be resumed and uploaded after reconnecting',async()=>{const s=storage(),a=device(s);await a.login();await a.run('openWalks()');a.offline=true;await a.run('newWalk()');const id=a.record().id;assert.equal(a.record().revision,0);a.run("walkSet('area','Offline first walk');walkRecord=null;walkDirty=false;walkPending=null");a.offline=false;await a.run(`loadWalk('${id}')`);assert.equal(a.record().area,'Offline first walk');assert.equal(await a.run('syncWalk()'),true);assert.equal(s.read('safety:walk:'+id).area,'Offline first walk');});
test('NC and O create inline actions without duplicates and default owner and point text automatically',async()=>{const s=storage(),a=device(s);await a.start();a.run("walkResult(0,'NC');walkResult(0,'O');walkResult(1,'O')");assert.equal(a.record().actions.length,2);assert.equal(a.record().actions[0].owner,a.record().signerName);assert.match(a.record().actions[0].issue,/^1\.1 · Previous audit actions/);a.run("walkResult(0,'C')");assert.equal(a.record().actions.length,1);a.run("walkSet('actions.0.correctiveAction','Keep this work');walkResult(1,'C')");assert.equal(a.record().actions.length,1);await a.run('syncWalk()');assert.equal(s.read('safety:walk:'+a.record().id).actions[0].correctiveAction,'Keep this work');});
test('date changes update automatic review and next-audit dates and the form removes manual month/version fields',async()=>{const s=storage(),a=device(s);await a.start();a.run("walkSet('date','2026-12-15')");assert.equal(a.record().review.date,'2026-12-25');assert.equal(a.record().review.nextAuditDue,'2027-01-04');const html=a.run('walksHTML()');assert.match(html,/Monthly Audit/);assert.match(html,/LF-MA-0001/);assert.doesNotMatch(html,/id="walk-month"|id="walk-issueDate"/);assert.match(html,/rows="1"/);await a.run('syncWalk()');assert.equal(s.read('safety:walk:'+a.record().id).review.date,'2026-12-25');});
test('reopening an older unsiged draft upgrades its automatic fields without losing audit notes',async()=>{const s=storage(),a=device(s);await a.start();const id=a.record().id,old=s.read('safety:walk:'+id);delete old.workflowVersion;delete old.carriedActions;delete old.carrySource;old.documentNo='OLD-MANUAL';old.answers[0].comments='Retain old audit notes';s.write('safety:walk:'+id,old);await a.run('openWalks()');await a.run(`loadWalk('${id}')`);assert.equal(a.record().workflowVersion,2);assert.equal(a.record().answers[0].comments,'Retain old audit notes');assert.match(a.record().documentNo,/^LF-MA-/);assert.equal(a.record().review.date,a.run('walkSchedule(walkRecord.date).reviewDate'));});

function seedAction(s,h){const r=h.record();r.status='Completed';r.completedAt=new Date().toISOString();r.actions=[{id:crypto.randomUUID(),ref:'1.1',issue:'Guard damaged',risk:'M',immediateControl:'Machine isolated',correctiveAction:'Replace guard',owner:'Supervisor',due:'2026-12-01',status:'Open',closeEvidence:'',verifiedBy:'',verifiedDate:''}];s.write('safety:walk:'+r.id,r);s.write('safety:walks',[{id:r.id,status:'Completed',date:r.date,completedAt:r.completedAt}]);return r;}
test('register follow-up survives an uncertain response and retries the same mutation without duplicating history',async()=>{const s=storage(),a=device(s);await a.start();const r=seedAction(s,a);await a.run('openAuditActions()');await a.run(`openAuditAction('${r.id}','${r.actions[0].id}')`);a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Replaced and tested')");assert.equal(a.run('auditActionEdit.verifiedDate'),a.run('today()'));a.dropActionResponse=true;assert.equal(await a.run('saveAuditAction()'),false);const pending=a.run('auditActionPending.body.mutationId');assert.equal(a.run('auditActionPending.body.status'),'Closed');await a.run('openAuditActions()');assert.equal(a.run('auditAction.originActionId'),r.actions[0].id);assert.equal(await a.run('saveAuditAction()'),true);assert.equal(a.run('auditAction.status'),'Closed');assert.equal(a.run('auditAction.history.length'),1);assert.equal(a.requests.filter(q=>q.packet?.mutationId===pending).length,2);});
test('register device drafts restore after leaving and offline updates remain recoverable',async()=>{const s=storage(),a=device(s);await a.start();const r=seedAction(s,a);await a.run('openAuditActions()');await a.run(`openAuditAction('${r.id}','${r.actions[0].id}')`);a.run("auditActionSet('closeEvidence','Repair notes kept on device')");await a.run('openAuditActions()');await a.run(`openAuditAction('${r.id}','${r.actions[0].id}')`);assert.equal(a.run('auditActionEdit.closeEvidence'),'Repair notes kept on device');a.offline=true;assert.equal(await a.run('saveAuditAction()'),false);assert.ok(a.run('auditActionPending'));a.offline=false;assert.equal(await a.run('saveAuditAction()'),true);assert.equal(a.run('auditAction.closeEvidence'),'Repair notes kept on device');});

test('deleting the current account draft clears its device copy and preserves the document sequence',async()=>{const s=storage(),a=device(s);await a.start();const id=a.record().id;a.run("walkSet('area','Unfinished audit')");await a.run(`deleteWalkDraft('${id}')`);assert.equal(s.read('safety:walk:'+id),null);assert.equal(a.run('cachedWalk()'),null);assert.equal(a.run('walkRecord'),null);await a.run('newWalk()');assert.equal(a.record().documentNo,'LF-MA-0002');});

function resetAuditSeries(s){s.write('initialized',true);s.ctx.id='synthetic-panelstock-id';applyMonthlyAuditReset(s,{SITE_ID:'panelstock',MONTHLY_AUDIT_RESET_ID,INVENTORY:{idFromName:()=>s.ctx.id}});}
test('a stale device autosave after archiving cannot restore an old audit or block starting LF-MA-0001',async()=>{const s=storage(),a=device(s);await a.start();const oldId=a.record().id;a.run("walkSet('area','Unsaved old audit')");resetAuditSeries(s);assert.equal(await a.run('syncWalk()'),false);assert.equal(a.run('walkRecord'),null);assert.equal(a.run('cachedWalk()'),null);await a.run('openWalks()');assert.equal(a.run('walkData.total'),0);await a.run('newWalk()');assert.equal(a.record().documentNo,'LF-MA-0001');assert.notEqual(a.record().id,oldId);assert.equal(s.read('safety:walks').filter(r=>!r.archivedAt).length,1);});
test('archived account drafts clear old device copies and open read-only when addressed directly',async()=>{const s=storage(),a=device(s);await a.start();const id=a.record().id;resetAuditSeries(s);await a.run('openWalks()');assert.equal(a.run('cachedWalk()'),null);await a.run(`loadWalk('${id}')`);assert.equal(a.record().archived,true);assert.doesNotMatch(a.run('walksHTML()'),/onclick="saveWalkDraft\(\)"|onclick="deleteWalkDraft\(walkRecord.id\)"/);});

test('monthly audit dictation controls appear only beside editable multiline fields',async()=>{
 const s=storage(),a=device(s);await a.start();a.run("walkResult(0,'NC')");
 const html=a.run('walksHTML()');
 for(const id of ['walk-action-0-immediateControl','walk-action-0-correctiveAction','walk-action-0-closeEvidence','walk-summary-findings','walk-review-comments'])assert.ok(html.includes('id="'+id+'-dictate"'));
 assert.ok(!html.includes('id="walk-action-0-issue-dictate"'),'Automatic issue text is read-only');
 a.run("walkRecord.status='Completed'");assert.doesNotMatch(a.run('walksHTML()'),/class="walk-dictation-button"/);
 const r=seedAction(s,a);await a.run('openAuditActions()');await a.run(`openAuditAction('${r.id}','${r.actions[0].id}')`);
 assert.match(a.run('auditActionsHTML()'),/id="register-closeEvidence-dictate"/);
 a.run('auditActionPending={body:{}}');assert.doesNotMatch(a.run('auditActionsHTML()'),/id="register-closeEvidence-dictate"/);
});

test('audit operations do not continue after navigation, account changes or busy state during dictation finishing',async()=>{
 for(const change of ["page='safety-home'","actor={...actor,username:'other'}","walkRecord={...walkRecord,id:crypto.randomUUID()}","busy=true"]){
  const s=storage(),a=device(s);await a.start();a.run("walkSet('summary.findings','Keep the current notes')");
  let release;a.context.dictationGate=new Promise(resolve=>release=resolve);a.run('finishWalkDictation=()=>dictationGate');
  const before=a.requests.length,saving=a.run('saveWalkDraft()');a.run(change);release(true);await saving;
  assert.equal(a.requests.length,before,'An invalidated finish must not submit an audit update: '+change);
 }
});

test('concurrent follow-up saves waiting for dictation send one update and create one history entry',async()=>{
 const s=storage(),a=device(s);await a.start();const r=seedAction(s,a);await a.run('openAuditActions()');await a.run(`openAuditAction('${r.id}','${r.actions[0].id}')`);
 a.run("auditActionSet('closeEvidence','Dictated repair notes')");
 let release;a.context.dictationGate=new Promise(resolve=>release=resolve);a.run('finishWalkDictation=()=>dictationGate');
 const first=a.run('saveAuditAction()'),second=a.run('saveAuditAction()');release(true);await Promise.all([first,second]);
 const writes=a.requests.filter(q=>q.path===`/toolbox/walks/actions/${r.id}/${r.actions[0].id}`&&q.packet?.operation==='update');
 assert.equal(writes.length,1);assert.equal(a.run('auditAction.history.length'),1);assert.equal(a.run('auditAction.closeEvidence'),'Dictated repair notes');
});


function syntheticAuditPhoto(h,name='guard.png'){
 h.context.auditPhotoData='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 h.run("walkFileData=async file=>({fileName:file.name,mime:'image/png',data:auditPhotoData})");
 return {files:[{name}],value:name};
}
async function untilAudit(condition){for(let i=0;i<50&&!condition();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(condition(),'Expected audit operation to reach the test gate');}

test('two photo selections waiting for the same draft save cannot race their evidence revisions',async()=>{
 const s=storage(),a=device(s);await a.start();a.run("walkSet('summary.findings','Notes before the photo')");
 a.context.firstPhoto=syntheticAuditPhoto(a,'guard.png');a.context.secondPhoto=syntheticAuditPhoto(a,'extraction.png');
 let release;a.gate=new Promise(resolve=>release=resolve);const first=a.run("walkUpload(firstPhoto,'1.1')"),second=a.run("walkUpload(secondPhoto,'1.1')");
 await untilAudit(()=>a.requests.some(q=>q.packet?.record?.summary.findings==='Notes before the photo'));
 a.gate=null;release();await Promise.all([first,second]);
 const files=a.requests.filter(q=>q.path.endsWith('/file')&&q.packet?.action==='upload');
 assert.equal(files.length,1,'A second selection must not start while the first upload operation holds the form');
 assert.equal(s.read('safety:walk:'+a.record().id).evidence.length,1);assert.equal(a.record().evidence.length,1);
 assert.equal(a.run('walkSaveError'),'');assert.equal(a.run('walkUploadPending'),null);
 const completedRevision=a.record().revision;assert.equal(completedRevision,s.read('safety:walk:'+a.record().id).revision);
});

test('a committed photo with a lost response is confirmed before autosaving later notes or adding another photo',async()=>{
 const s=storage(),a=device(s);await a.start();const id=a.record().id;
 a.context.firstPhoto=syntheticAuditPhoto(a,'guard.png');a.dropFileResponse=true;await a.run("walkUpload(firstPhoto,'1.1')");
 assert.equal(s.read('safety:walk:'+id).evidence.length,1);assert.ok(a.run('walkUploadPending'));
 const mutation=a.run('walkUploadPending.body.mutationId');
 a.run("walkSet('summary.findings','Notes typed after the photo upload')");
 assert.equal(await a.run('syncWalk()'),true,'Autosave should confirm the pending upload before using its revised draft');
 assert.equal(s.read('safety:walk:'+id).summary.findings,'Notes typed after the photo upload');
 assert.equal(a.record().summary.findings,'Notes typed after the photo upload');assert.equal(a.record().evidence.length,1);
 assert.equal(a.run('walkUploadPending'),null);assert.equal(a.run('walkSaveError'),'');
 a.context.secondPhoto=syntheticAuditPhoto(a,'extraction.png');await a.run("walkUpload(secondPhoto,'1.2')");
 const stored=s.read('safety:walk:'+id);assert.equal(stored.evidence.length,2);assert.deepEqual(stored.evidence.map(f=>f.fileName),['guard.png','extraction.png']);
 assert.equal(stored.summary.findings,'Notes typed after the photo upload');assert.equal(a.record().revision,stored.revision);
 assert.ok(a.requests.filter(q=>q.packet?.mutationId===mutation).length>=2,'Confirm the original upload request instead of creating a duplicate');
 const b=device(s);await b.login();await b.run(`loadWalk('${id}')`);assert.equal(b.record().summary.findings,stored.summary.findings);assert.equal(b.record().evidence.length,2);
});

test('confirming an uncertain photo never overwrites a genuine newer draft saved by another device',async()=>{
 const s=storage(),a=device(s);await a.start();const id=a.record().id;
 a.context.photo=syntheticAuditPhoto(a);a.dropFileResponse=true;await a.run("walkUpload(photo,'1.1')");
 const b=device(s);await b.login();await b.run(`loadWalk('${id}')`);b.run("walkSet('summary.findings','Newer notes from another device')");assert.equal(await b.run('syncWalk()'),true);
 a.run("walkSet('summary.findings','Unsaved local notes')");assert.equal(await a.run('syncWalk()'),false);
 assert.equal(s.read('safety:walk:'+id).summary.findings,'Newer notes from another device');assert.equal(s.read('safety:walk:'+id).evidence.length,1);
 assert.equal(a.record().summary.findings,'Unsaved local notes');assert.match(a.run('walkSaveError'),/another device|changed/i);
 assert.equal(JSON.parse([...a.cache.values()].find(v=>v.includes('Unsaved local notes'))).record.summary.findings,'Unsaved local notes');
});

test('an already-rejected stale autosave can recover after its own photo mutation is confirmed',async()=>{
 const s=storage(),a=device(s);await a.start();const id=a.record().id;
 a.context.photo=syntheticAuditPhoto(a);a.dropFileResponse=true;await a.run("walkUpload(photo,'1.1')");
 a.run("walkSet('summary.findings','Keep notes from the already-stuck draft');walkPending={version:walkEditVersion,body:{record:structuredClone(walkRecord),expectedRevision:walkRecord.revision,mutationId:crypto.randomUUID()}};");
 const rejectedMutation=a.run('walkPending.body.mutationId');
 await a.run("api('/toolbox/walks/'+walkRecord.id,walkPending.body).catch(e=>{walkSaveError=e.message;cacheWalk()})");
 assert.match(a.run('walkSaveError'),/another device/);assert.ok(a.run('walkPending'));
 assert.equal(await a.run('syncWalk()'),true,'An upload confirmed as this device’s revision change can release its rejected old save');
 assert.equal(a.record().summary.findings,'Keep notes from the already-stuck draft');assert.equal(s.read('safety:walk:'+id).summary.findings,a.record().summary.findings);
 assert.equal(a.record().evidence.length,1);assert.equal(a.run('walkSaveError'),'');assert.equal(a.run('walkPending'),null);
 const saves=a.requests.filter(q=>q.packet?.record?.summary.findings==='Keep notes from the already-stuck draft');
 assert.equal(saves[0].packet.mutationId,rejectedMutation);assert.notEqual(saves.at(-1).packet.mutationId,rejectedMutation,'A changed revision must use a fresh request identifier');
 a.context.nextPhoto=syntheticAuditPhoto(a,'next.png');await a.run("walkUpload(nextPhoto,'1.2')");assert.equal(a.record().evidence.length,2);
});

test('a deleted photo with a lost response is confirmed before later edits and another photo',async()=>{
 const s=storage(),a=device(s);await a.start();const id=a.record().id;
 a.context.photo=syntheticAuditPhoto(a);await a.run("walkUpload(photo,'1.1')");const fileId=a.record().evidence[0].id;
 a.dropFileResponse=true;await a.run('removeWalkFile(walkRecord.evidence[0])');
 assert.equal(s.read('safety:walk:'+id).evidence.length,0);assert.equal(s.read('safety:walk-file:'+fileId),null);
 assert.ok(a.run('walkUploadPending'),'Keep the unconfirmed deletion available for an idempotent retry');const mutation=a.run('walkUploadPending.body.mutationId');
 a.run("walkSet('summary.findings','Notes after removing the wrong photo')");assert.equal(await a.run('syncWalk()'),true);
 assert.equal(a.record().evidence.length,0);assert.equal(a.record().summary.findings,'Notes after removing the wrong photo');assert.equal(a.run('walkSaveError'),'');
 assert.ok(a.requests.filter(q=>q.packet?.mutationId===mutation).length>=2);
 a.context.replacement=syntheticAuditPhoto(a,'replacement.png');await a.run("walkUpload(replacement,'1.1')");assert.deepEqual(a.record().evidence.map(f=>f.fileName),['replacement.png']);assert.equal(a.record().revision,s.read('safety:walk:'+id).revision);
});

test('a rejected photo releases its pending request so later notes autosave and a valid photo can be added',async()=>{
 const s=storage(),a=device(s);await a.start();const id=a.record().id;
 a.context.invalidPhoto=syntheticAuditPhoto(a,'invalid.png');a.run("walkFileData=async file=>({fileName:file.name,mime:'image/png',data:'QQ=='})");
 await a.run("walkUpload(invalidPhoto,'1.1')");assert.equal(a.run('walkUploadPending'),null);assert.equal(s.read('safety:walk:'+id).evidence.length,0);assert.match(a.run('walkSaveError'),/PNG|image|readable/i);
 a.run("walkSet('summary.findings','Keep working after a rejected photo')");assert.equal(a.run('walkSaveError'),'');
 const timerId=a.run('walkTimer'),timer=a.timers.get(timerId);assert.equal(timer?.ms,900,'Typing should schedule the normal draft autosave again');a.timers.delete(timerId);timer.f();
 await untilAudit(()=>!a.run('walkSaving')&&!a.run('walkDirty'));
 assert.equal(s.read('safety:walk:'+id).summary.findings,'Keep working after a rejected photo');
 a.context.validPhoto=syntheticAuditPhoto(a,'valid.png');await a.run("walkUpload(validPhoto,'1.1')");assert.deepEqual(a.record().evidence.map(f=>f.fileName),['valid.png']);assert.equal(a.run('walkSaveError'),'');
});

test('logout confirms uncertain photos and later notes before clearing state, and stays signed in if confirmation is offline',async()=>{
 for(const offline of [false,true]){
  const s=storage(),a=device(s);await a.start();const id=a.record().id;
  a.context.photo=syntheticAuditPhoto(a);a.dropFileResponse=true;await a.run("walkUpload(photo,'1.1')");a.run("walkSet('summary.findings','Notes to keep when signing out')");
  if(offline){a.offline=true;await a.run('logout()');assert.equal(a.run('actor.username'),'supervisor');assert.ok(a.run('walkUploadPending'));assert.equal(a.record().summary.findings,'Notes to keep when signing out');assert.equal(a.requests.filter(q=>q.path==='/logout').length,0,'An unconfirmed audit must not be signed out');a.offline=false;}
  await a.run('logout()');assert.equal(a.run('actor'),null);assert.equal(a.run('walkRecord'),null);
  const record=s.read('safety:walk:'+id);assert.equal(record.evidence.length,1);assert.equal(record.summary.findings,'Notes to keep when signing out');
  const logoutIndex=a.requests.findIndex(q=>q.path==='/logout'),lastSaveIndex=a.requests.findLastIndex(q=>q.packet?.record?.summary.findings==='Notes to keep when signing out');assert.ok(lastSaveIndex>=0&&lastSaveIndex<logoutIndex,'Confirm the audit before invalidating its session');
 }
});

test('an unconfirmed action photo keeps its corrective action linked when the result changes or removal is attempted',async()=>{
 const s=storage(),a=device(s);await a.start();a.run("walkResult(0,'NC')");assert.equal(await a.run('syncWalk()'),true);
 const actionId=a.record().actions[0].id;a.context.photo=syntheticAuditPhoto(a);a.dropFileResponse=true;await a.run(`walkUpload(photo,'1.1','${actionId}')`);assert.ok(a.run('walkUploadPending'));
 a.run("walkResult(0,'C');walkRemoveAction(0)");assert.equal(a.record().actions.length,1,'Pending evidence must keep its action available');assert.equal(a.record().actions[0].id,actionId);
 assert.equal(await a.run('syncWalk()'),true);assert.equal(a.record().evidence.length,1);assert.equal(a.record().evidence[0].actionId,actionId);assert.equal(a.record().actions[0].id,actionId);
 assert.match(a.run('walkActionPhotos(walkRecord.actions[0],true)'),/guard\.png/);assert.equal(a.run('walkSaveError'),'');
});
