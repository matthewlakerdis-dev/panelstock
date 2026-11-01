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
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,URLSearchParams,location:{search:'',hash:'',pathname:'/toolbox'},setTimeout:(f,ms)=>{const id=++serial;timers.set(id,{f,ms});return id;},clearTimeout:id=>timers.delete(id),confirm:()=>true,localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},window:{scrollY:0,scrollX:0,scrollTo(){}},document:{addEventListener(){},createElement:element,querySelector:element,querySelectorAll:()=>[],getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)}},fetch:async(path,options={})=>{const packet=options.body?JSON.parse(options.body):undefined;requests.push({path,packet});if(path==='/session')return {ok:true,json:async()=>({username:h.username,isAdmin:false,taskAccess:{'factory.toolbox':true}})};if(path==='/toolbox/users')return {ok:true,json:async()=>({users:[{username:h.username,displayName:h.username}]})};if(path==='/toolbox/safety-documents/summary')return {ok:true,json:async()=>({outstanding:0,assigned:0,completed:0,pending:[]})};if(path==='/logout')return {ok:true,json:async()=>({ok:true})};if(h.offline)throw Error('Network unavailable');try{if(h.gate&&path.startsWith('/toolbox/walks/')&&packet?.record)await h.gate;if(h.fileGate&&path.endsWith('/file')&&packet?.action!=='download')await h.fileGate;if(h.actionGate&&path.startsWith('/toolbox/walks/actions/')&&packet?.operation)await h.actionGate;const r=await handleToolbox(s,path,packet?'POST':'GET',packet||{},{username:h.username,tasks:{'factory.toolbox':true}});if(h.dropActionResponse&&path.startsWith('/toolbox/walks/actions/')&&packet?.operation){h.dropActionResponse=false;throw Error('Response lost');}if(h.dropResponse&&path.startsWith('/toolbox/walks/')&&packet?.record){h.dropResponse=false;throw Error('Response lost');}if(h.dropFileResponse&&path.endsWith('/file')&&packet?.action!=='download'){h.dropFileResponse=false;throw Error('Photo response lost');}return {ok:true,status:r.status,json:async()=>r.body};}catch(e){if(!e.status)throw e;return {ok:false,status:e.status,json:async()=>({error:e.message})};}}});
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

test('completed audits offer a separate close-out download and retain both original reports',async()=>{
 const s=storage(),a=device(s);await a.start();
 assert.doesNotMatch(a.run('walksHTML()'),/onclick="downloadAuditCloseout\(\)"/);
 const r=seedAction(s,a);await a.run(`loadWalk('${r.id}')`);
 for(const name of ['downloadWalkPdf','downloadAuditActions','downloadAuditCloseout'])assert.ok(a.run('walksHTML()').includes('onclick="'+name+'()"'));
 a.context.downloadPaths=[];a.run('walkDownload=async path=>downloadPaths.push(path)');
 await a.run('downloadAuditCloseout()');assert.deepEqual(a.context.downloadPaths,[`/toolbox/walks/${r.id}/actions-closeout-pdf`]);
});

test('closed-action downloads save changed evidence but clean downloads do not add history',async()=>{
 const s=storage(),a=device(s);await a.start();const r=seedAction(s,a);await a.run('openAuditActions()');await a.run(`openAuditAction('${r.id}','${r.actions[0].id}')`);
 assert.doesNotMatch(a.run('auditActionsHTML()'),/onclick="downloadActionCloseout\(\)"/);
 a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Guard replaced and tested')");assert.equal(await a.run('saveAuditAction()'),true);
 assert.match(a.run('auditActionsHTML()'),/onclick="downloadActionCloseout\(\)"/);
 a.context.downloadPaths=[];a.run('walkDownload=async path=>downloadPaths.push(path)');
 const history=a.run('auditAction.history.length');
 await a.run('downloadActionCloseout()');assert.equal(a.run('auditAction.history.length'),history);
 a.run("auditActionSet('closeEvidence','Guard replaced, tested and photographed')");await a.run('downloadActionCloseout()');
 assert.equal(a.run('auditAction.closeEvidence'),'Guard replaced, tested and photographed');assert.equal(a.run('auditAction.history.length'),history+1);
 assert.deepEqual(a.context.downloadPaths,Array(2).fill(`/toolbox/walks/${r.id}/actions-closeout-pdf`));
 a.run("auditActionSet('closeEvidence','Further repair detail')");a.offline=true;await a.run('downloadActionCloseout()');
 assert.equal(a.context.downloadPaths.length,2,'An unconfirmed follow-up must not produce a stale report');assert.ok(a.run('auditActionPending'));
 a.offline=false;await a.run('downloadActionCloseout()');assert.equal(a.context.downloadPaths.length,3);assert.equal(a.run('auditAction.closeEvidence'),'Further repair detail');
});

test('close-out downloads wait for dictation and stop after navigation or a reopened local status',async()=>{
 const s=storage(),a=device(s);await a.start();const r=seedAction(s,a);await a.run('openAuditActions()');await a.run(`openAuditAction('${r.id}','${r.actions[0].id}')`);
 a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Tested')");assert.equal(await a.run('saveAuditAction()'),true);
 a.context.downloadPaths=[];a.run('walkDownload=async path=>downloadPaths.push(path)');
 a.run("auditActionSet('status','Open')");await a.run('downloadActionCloseout()');assert.equal(a.context.downloadPaths.length,0);
 a.run("auditActionSet('status','Closed')");let release;a.context.dictationGate=new Promise(resolve=>release=resolve);a.run('finishWalkDictation=()=>dictationGate');
 const downloading=a.run('downloadActionCloseout()');a.run("page='safety-home'");release(true);await downloading;
 assert.equal(a.context.downloadPaths.length,0);
});

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
async function untilAudit(condition){const deadline=Date.now()+5000;while(!condition()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(condition(),'Expected audit operation to reach the test gate');}

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

async function registerDevice(){
 const s=storage(),a=device(s);await a.start();const audit=seedAction(s,a);
 await a.run('openAuditActions()');await a.run(`openAuditAction('${audit.id}','${audit.actions[0].id}')`);
 return {s,a,audit,key:'safety:audit-action:'+audit.id+':'+audit.actions[0].id};
}
function registerPhotos(h,...names){
 syntheticAuditPhoto(h);
 return {files:names.map(name=>({name,type:'image/png'})),value:names.join(',')};
}
const registerMutations=h=>h.requests.filter(q=>q.path.startsWith('/toolbox/walks/actions/')&&q.packet?.operation&&q.packet.operation!=='download-photo');
const registerEdit=h=>JSON.parse(h.run('JSON.stringify(Object.fromEntries(["status","owner","due","closeEvidence","verifiedBy","verifiedDate"].map(key=>[key,auditActionEdit[key]])))'));

test('close-out photo controls appear with the evidence before Save and offer camera and photo selection',async()=>{
 const {a}=await registerDevice();const html=a.run('auditActionsHTML()');
 const photo=html.indexOf('id="register-photos"'),save=html.indexOf('onclick="saveAuditAction()"');
 assert.ok(photo>=0&&photo<save,'Photo evidence must be visible before the close-out save controls');
 assert.match(html,/<input[^>]+type="file"[^>]+capture="environment"/);
 assert.match(html,/Take (?:a )?photo/);assert.match(html,/Choose photos/);
 a.run("auditActionSet('status','Closed')");assert.match(a.run('auditActionsHTML()'),/id="register-photos"/);
});

test('close-out photos upload before required details are completed and preserve edits until explicitly saved',async()=>{
 const {s,a,audit,key}=await registerDevice(),original=s.read('safety:walk:'+audit.id);
 a.run("auditActionSet('status','Closed');auditActionSet('owner','');auditActionSet('due','');auditActionSet('closeEvidence','');auditActionSet('verifiedBy','');auditActionSet('verifiedDate','')");
 const edit=registerEdit(a);a.context.photoInput=registerPhotos(a,'guard-repair.png','guard-test.png');
 await a.run('auditActionPhotos(photoInput)');
 assert.deepEqual(registerMutations(a).map(q=>q.packet.operation),['upload-photo','upload-photo']);
 assert.equal(s.read(key).status,'Open','Attaching evidence must not close the action');
 assert.deepEqual(s.read(key).photos.map(f=>f.fileName),['guard-repair.png','guard-test.png']);
 assert.deepEqual(registerEdit(a),edit,'Uploads must not replace incomplete close-out fields with saved values');
 assert.equal(a.run('auditActionPending'),null);assert.equal(a.context.photoInput.value,'');
 await a.run('openAuditActions()');await a.run(`openAuditAction('${audit.id}','${audit.actions[0].id}')`);
 assert.deepEqual(registerEdit(a),edit,'The account revision and local edit cache must advance together');
 assert.equal(a.run('auditAction.photos.length'),2);assert.equal(a.run('auditActionError'),'');
 a.run("auditActionSet('owner','Supervisor');auditActionSet('due','2026-12-02');auditActionSet('closeEvidence','Guard replaced and tested');auditActionSet('verifiedBy','Verifier');auditActionSet('verifiedDate','2026-10-30')");
 assert.equal(await a.run('saveAuditAction()'),true);assert.equal(s.read(key).status,'Closed');assert.equal(s.read(key).photos.length,2);
 assert.deepEqual(s.read('safety:walk:'+audit.id),original,'Later close-out evidence must not change the signed audit snapshot');
});

test('removing an action photo preserves unsaved follow-up fields without closing the action',async()=>{
 const {s,a,key}=await registerDevice();a.context.photoInput=registerPhotos(a,'wrong-photo.png');await a.run('auditActionPhotos(photoInput)');
 a.run("auditActionSet('status','Closed');auditActionSet('owner','New owner');auditActionSet('due','2026-12-03');auditActionSet('closeEvidence','Keep these repair notes');auditActionSet('verifiedBy','Inspector');auditActionSet('verifiedDate','2026-10-29')");
 const edit=registerEdit(a);await a.run('removeAuditActionPhoto(auditAction.photos[0].id)');
 assert.deepEqual(registerMutations(a).map(q=>q.packet.operation),['upload-photo','remove-photo']);
 assert.equal(s.read(key).photos.length,0);assert.equal(s.read(key).status,'Open');assert.deepEqual(registerEdit(a),edit);
 assert.equal(await a.run('saveAuditAction()'),true);assert.equal(s.read(key).status,'Closed');assert.equal(s.read(key).closeEvidence,edit.closeEvidence);
});

test('uncertain photo uploads and removals retry the same mutation without duplicate evidence or losing close-out edits',async()=>{
 for(const operation of ['upload-photo','remove-photo']){
  const {s,a,audit,key}=await registerDevice();a.context.photoInput=registerPhotos(a,'repair.png');
  if(operation==='remove-photo')await a.run('auditActionPhotos(photoInput)');
  a.run("auditActionSet('status','Closed');auditActionSet('owner','Repair owner');auditActionSet('due','2026-12-04');auditActionSet('closeEvidence','');auditActionSet('verifiedBy','Verifier');auditActionSet('verifiedDate','2026-10-30')");
  const edit=registerEdit(a);a.dropActionResponse=true;
  if(operation==='upload-photo')await a.run('auditActionPhotos(photoInput)');else await a.run('removeAuditActionPhoto(auditAction.photos[0].id)');
  assert.equal(a.run('auditActionPending.body.operation'),operation);const mutation=a.run('auditActionPending.body.mutationId'),history=s.read(key).history.length;
  assert.equal(s.read(key).photos.length,operation==='upload-photo'?1:0);assert.deepEqual(registerEdit(a),edit);
  await a.run(`openAuditAction('${audit.id}','${audit.actions[0].id}')`);
  assert.equal(a.run('auditActionPending.body.mutationId'),mutation,'A reload must retain the original retry packet');assert.deepEqual(registerEdit(a),edit);
  assert.equal(await a.run('saveAuditAction()'),true,'Retry confirms evidence despite incomplete closing fields');
  assert.equal(a.run('auditActionPending'),null);assert.deepEqual(registerEdit(a),edit);assert.equal(s.read(key).status,'Open');
  assert.equal(s.read(key).history.length,history);assert.equal(a.run('auditAction.photos.length'),operation==='upload-photo'?1:0);
  assert.equal(registerMutations(a).filter(q=>q.packet.mutationId===mutation).length,2);
  assert.equal(registerMutations(a).filter(q=>q.packet.operation==='update').length,0,'Photo confirmation must not silently save the incomplete status change');
 }
});

test('empty, mixed-invalid and over-limit photo selections do not partially upload or change follow-up',async()=>{
 for(const names of [[],['valid.png','invalid.pdf'],['1.png','2.png','3.png','4.png','5.png','6.png']]){
  const {a}=await registerDevice();a.context.photoInput=registerPhotos(a,...names);
  if(names.includes('invalid.pdf'))a.context.photoInput.files[1].type='application/pdf';
  a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Unfinished repair notes')");const edit=registerEdit(a);
  await a.run('auditActionPhotos(photoInput)');
  assert.equal(registerMutations(a).length,0,'Validate the complete selection before uploading any files: '+names.join(','));
  assert.equal(a.run('auditAction.photos.length'),0);assert.equal(a.run('auditActionPending'),null);assert.equal(a.run('busy'),false);assert.deepEqual(registerEdit(a),edit);
 }
 const {a}=await registerDevice();a.context.fourPhotos=registerPhotos(a,'1.png','2.png','3.png','4.png');await a.run('auditActionPhotos(fourPhotos)');
 a.context.twoMore=registerPhotos(a,'5.png','6.png');const writes=registerMutations(a).length;await a.run('auditActionPhotos(twoMore)');
 assert.equal(registerMutations(a).length,writes,'The selection must respect the remaining capacity');assert.equal(a.run('auditAction.photos.length'),4);
});

test('photo selection is captured before dictation finishes and simultaneous selections cannot race revisions',async()=>{
 const {s,a,key}=await registerDevice();a.context.firstPhoto=registerPhotos(a,'first.png');a.context.secondPhoto=registerPhotos(a,'second.png');
 let release;a.context.dictationGate=new Promise(resolve=>release=resolve);a.run('finishWalkDictation=()=>dictationGate');
 const first=a.run('auditActionPhotos(firstPhoto)'),second=a.run('auditActionPhotos(secondPhoto)');
 a.context.firstPhoto.files=[];release(true);await Promise.all([first,second]);
 assert.deepEqual(registerMutations(a).map(q=>q.packet.fileName),['first.png'],'Only the first selection may hold the action while uploading');
 assert.equal(s.read(key).photos.length,1);assert.equal(a.run('auditAction.revision'),s.read(key).revision);assert.equal(a.run('auditActionPending'),null);assert.equal(a.run('busy'),false);
});

test('photo uploads stop if the account, page or action changes while dictation finishes or a photo is processed',async()=>{
 const changes=["page='safety-home'","actor={...actor,username:'other'}","auditAction={...auditAction,originActionId:crypto.randomUUID()}","walkGeneration++"];
 for(const stage of ['dictation','photo'])for(const change of changes){
  const {a}=await registerDevice();a.context.photoInput=registerPhotos(a,'repair.png');let release;
  if(stage==='dictation'){a.context.dictationGate=new Promise(resolve=>release=resolve);a.run('finishWalkDictation=()=>dictationGate');}
  else{a.context.photoGate=new Promise(resolve=>release=resolve);a.run("walkFileData=async file=>{photoStarted=true;await photoGate;return {fileName:file.name,mime:'image/png',data:auditPhotoData}};photoStarted=false");}
  const uploading=a.run('auditActionPhotos(photoInput)');if(stage==='photo')await untilAudit(()=>a.run('photoStarted'));
  a.run(change);release(true);await uploading;
  assert.equal(registerMutations(a).length,0,'Do not attach a photo to a changed context: '+stage+' / '+change);assert.equal(a.run('auditActionPending'),null);assert.equal(a.run('busy'),false);
 }
});

test('a definitively rejected close-out photo clears its pending request without losing edits or blocking a replacement',async()=>{
 const {s,a,key}=await registerDevice();a.context.invalid=registerPhotos(a,'invalid.png');
 a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Repair confirmed');walkFileData=async file=>({fileName:file.name,mime:'image/png',data:'QQ=='})");
 const edit=registerEdit(a);await a.run('auditActionPhotos(invalid)');
 assert.equal(a.run('auditActionPending'),null);assert.equal(a.run('auditAction.photos.length'),0);assert.equal(a.run('busy'),false);assert.deepEqual(registerEdit(a),edit);
 assert.match(a.run('auditActionError'),/PNG|image|readable/i);
 a.context.valid=registerPhotos(a,'replacement.png');await a.run('auditActionPhotos(valid)');
 assert.equal(a.run('auditActionError'),'');assert.equal(a.run('auditAction.photos.length'),1);assert.deepEqual(registerEdit(a),edit);assert.equal(s.read(key).status,'Open');
 assert.equal(await a.run('saveAuditAction()'),true);assert.equal(s.read(key).status,'Closed');assert.equal(s.read(key).photos[0].fileName,'replacement.png');
});

test('a photo revision conflict preserves local close-out edits and never overwrites another device follow-up',async()=>{
 const {s,a,audit,key}=await registerDevice(),other=device(s);await other.login();await other.run(`openAuditAction('${audit.id}','${audit.actions[0].id}')`);
 a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Local repair notes')");const edit=registerEdit(a);
 other.run("auditActionSet('status','In progress');auditActionSet('closeEvidence','Newer follow-up from another device')");assert.equal(await other.run('saveAuditAction()'),true);
 a.context.photoInput=registerPhotos(a,'repair.png');await a.run('auditActionPhotos(photoInput)');
 assert.equal(a.run('auditActionPending.body.operation'),'upload-photo');assert.match(a.run('auditActionError'),/changed|reload/i);assert.deepEqual(registerEdit(a),edit);
 assert.equal(s.read(key).photos.length,0);assert.equal(s.read(key).closeEvidence,'Newer follow-up from another device');assert.equal(s.read(key).status,'In progress');
 assert.equal(await a.run('saveAuditAction()'),false);assert.deepEqual(registerEdit(a),edit);assert.equal(s.read(key).photos.length,0);
});

test('close-out downloads confirm a pending photo then save remaining repair notes before generating the report',async()=>{
 const {s,a,audit,key}=await registerDevice();a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Original repair confirmation')");assert.equal(await a.run('saveAuditAction()'),true);
 a.run("auditActionSet('closeEvidence','Latest repair confirmation with photo')");a.context.photoInput=registerPhotos(a,'verified-repair.png');a.dropActionResponse=true;
 await a.run('auditActionPhotos(photoInput)');assert.ok(a.run('auditActionPending'));const mutation=a.run('auditActionPending.body.mutationId');
 a.context.reportSnapshots=[];a.context.readReportSnapshot=()=>s.read(key);a.run('walkDownload=async path=>reportSnapshots.push({path,action:readReportSnapshot()})');
 await a.run('downloadActionCloseout()');
 assert.equal(a.context.reportSnapshots.length,1);const report=a.context.reportSnapshots[0];assert.equal(report.path,`/toolbox/walks/${audit.id}/actions-closeout-pdf`);
 assert.equal(report.action.closeEvidence,'Latest repair confirmation with photo');assert.equal(report.action.photos.length,1);assert.equal(report.action.status,'Closed');
 assert.equal(registerMutations(a).filter(q=>q.packet.mutationId===mutation).length,2,'The lost photo response must be confirmed without a second attachment');
 assert.deepEqual(registerMutations(a).slice(-3).map(q=>q.packet.operation),['upload-photo','upload-photo','update']);
 assert.equal(s.read(key).history.filter(h=>h.event==='Photo attached').length,1);assert.equal(a.run('auditActionPending'),null);
});

test('rendered close-out fields lock during photo work and unlock after successful upload, retry and follow-up save',async()=>{
 const {a}=await registerDevice();a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Repair notes entered before taking a photo')");const edit=registerEdit(a);
 const assertFieldsDisabled=(expected,stage)=>{
  const html=a.run("document.getElementById('main').innerHTML");
  for(const id of ['register-status','register-owner','register-due','register-closeEvidence','register-verifiedBy','register-verifiedDate','register-photos','register-photos-camera']){
   const tag=html.match(new RegExp('<(?:input|select|textarea)\\b[^>]*\\bid="'+id+'"[^>]*>'))?.[0];
   assert.ok(tag,'The rendered form must include '+id+' during '+stage);assert.equal(/\sdisabled(?:\s|>)/.test(tag),expected,id+' during '+stage);
  }
 };
 assertFieldsDisabled(false,'initial editing');a.context.photoInput=registerPhotos(a,'repair.png');
 let releaseConversion,releaseUpload;a.context.conversionGate=new Promise(resolve=>releaseConversion=resolve);a.actionGate=new Promise(resolve=>releaseUpload=resolve);
 a.run("conversionStarted=false;walkFileData=async file=>{conversionStarted=true;await conversionGate;return {fileName:file.name,mime:'image/png',data:auditPhotoData}}");
 const uploading=a.run('auditActionPhotos(photoInput)');await untilAudit(()=>a.run('conversionStarted'));
 assertFieldsDisabled(true,'photo conversion');releaseConversion();await untilAudit(()=>registerMutations(a).some(q=>q.packet.operation==='upload-photo'));
 assertFieldsDisabled(true,'photo upload');a.actionGate=null;releaseUpload();await uploading;
 assertFieldsDisabled(false,'confirmed upload');assert.deepEqual(registerEdit(a),edit);
 let releaseRemoval;a.actionGate=new Promise(resolve=>releaseRemoval=resolve);a.dropActionResponse=true;
 const removing=a.run('removeAuditActionPhoto(auditAction.photos[0].id)');await untilAudit(()=>registerMutations(a).some(q=>q.packet.operation==='remove-photo'));
 assertFieldsDisabled(true,'photo removal');a.actionGate=null;releaseRemoval();await removing;
 assert.equal(a.run('busy'),false);assert.ok(a.run('auditActionPending'));assertFieldsDisabled(true,'unconfirmed removal');
 let releaseRetry;a.actionGate=new Promise(resolve=>releaseRetry=resolve);const retrying=a.run('saveAuditAction()');
 await untilAudit(()=>registerMutations(a).filter(q=>q.packet.operation==='remove-photo').length===2);assertFieldsDisabled(true,'removal retry');
 a.actionGate=null;releaseRetry();assert.equal(await retrying,true);assertFieldsDisabled(false,'confirmed retry');assert.deepEqual(registerEdit(a),edit);
 let releaseSave;a.actionGate=new Promise(resolve=>releaseSave=resolve);const saving=a.run('saveAuditAction()');
 await untilAudit(()=>registerMutations(a).some(q=>q.packet.operation==='update'));assertFieldsDisabled(true,'follow-up save');
 a.actionGate=null;releaseSave();assert.equal(await saving,true);assertFieldsDisabled(false,'confirmed follow-up save');assert.deepEqual(registerEdit(a),edit);
});

async function registerWithAuditPhotos(count=5){
 const state=await registerDevice(),{s,a,audit}=state;syntheticAuditPhoto(a);
 const record=s.read('safety:walk:'+audit.id),data=a.context.auditPhotoData;
 // Existing signed audits predate photoSource; reopening must still identify these photos.
 record.evidence=Array.from({length:count},(_,i)=>({id:webcrypto.randomUUID(),actionId:audit.actions[0].id,ref:'1.1',fileName:'audit-before-'+(i+1)+'.png',mime:'image/png',size:68,hash:'a'.repeat(64),uploadedAt:'2026-10-20T00:00:00.000Z',uploadedBy:'supervisor'}));
 for(const photo of record.evidence)s.write('safety:walk-file:'+photo.id,{data});
 s.write('safety:walk:'+audit.id,record);
 s.write('safety:walks',s.read('safety:walks').map(row=>row.id===audit.id?{...row,documentNo:record.documentNo,auditors:record.auditors,area:record.area,totals:{open:1,overdue:0}}:row));
 await a.run(`openAuditAction('${audit.id}','${audit.actions[0].id}',true)`);
 return {...state,auditSnapshot:record,auditPhotos:record.evidence,photoData:data};
}
const sourcePhotos=(h,source)=>JSON.parse(h.run('JSON.stringify(auditAction.photos.filter(f=>f.photoSource==='+JSON.stringify(source)+'))'));

test('five audit photos leave an independent five-photo allowance for corrective-action close-out',async()=>{
 const {s,a,audit,auditSnapshot}=await registerWithAuditPhotos();
 const pickerTag=()=>a.run('auditActionsHTML()').match(/<input\b[^>]*\bid="register-photos"[^>]*>/)?.[0];
 assert.equal(sourcePhotos(a,'audit').length,5);assert.equal(sourcePhotos(a,'closeout').length,0);
 assert.doesNotMatch(pickerTag(),/\sdisabled(?:\s|>)/,'A full audit photo set must not disable close-out uploads');
 a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Repair notes to retain')");const edit=registerEdit(a);
 a.context.photos=registerPhotos(a,'repair-1.png','repair-2.png');await a.run('auditActionPhotos(photos)');
 assert.equal(sourcePhotos(a,'audit').length,5);assert.equal(sourcePhotos(a,'closeout').length,2);assert.deepEqual(registerEdit(a),edit);
 const html=a.run('auditActionsHTML()'),auditHeading=html.indexOf('>Audit photos<'),closeoutHeading=html.indexOf('>Close-out photos<');
 assert.ok(auditHeading>=0&&closeoutHeading>auditHeading,'Original audit photos must have a distinct labelled section');
 const auditSection=html.slice(auditHeading,closeoutHeading),closeoutSection=html.slice(closeoutHeading);
 for(const name of auditSnapshot.evidence.map(f=>f.fileName)){assert.ok(auditSection.includes(name));assert.ok(!closeoutSection.includes(name),'Audit filenames must not appear in the close-out photo list');}
 for(const name of ['repair-1.png','repair-2.png']){assert.ok(!auditSection.includes(name));assert.ok(closeoutSection.includes(name));}
 assert.match(closeoutSection,/2\s*\/\s*5 photos/);
 a.context.more=registerPhotos(a,'repair-3.png','repair-4.png','repair-5.png');await a.run('auditActionPhotos(more)');
 assert.equal(sourcePhotos(a,'closeout').length,5);assert.match(pickerTag(),/\sdisabled(?:\s|>)/);
 const writes=registerMutations(a).length;a.context.extra=registerPhotos(a,'repair-6.png');await a.run('auditActionPhotos(extra)');
 assert.equal(registerMutations(a).length,writes,'Only close-out photos should count toward the independent limit');
 assert.deepEqual(s.read('safety:walk:'+audit.id),auditSnapshot,'Separating photo groups must not rewrite the signed audit');
});

test('audit photos remain downloadable and read-only while close-out photos can be removed independently',async()=>{
 const {s,a,audit,auditPhotos,auditSnapshot,photoData}=await registerWithAuditPhotos(2);
 a.context.repair=registerPhotos(a,'completed-repair.png');await a.run('auditActionPhotos(repair)');const closeout=sourcePhotos(a,'closeout')[0];
 let html=a.run('auditActionsHTML()');
 for(const file of auditPhotos){
  assert.ok(html.includes('registerPhotoDownload(\''+file.id+'\')'),'Audit photos remain available to download');
  assert.ok(!html.includes('removeAuditActionPhoto(\''+file.id+'\')'),'The register must not offer removal of signed audit evidence');
 }
 assert.ok(html.includes('removeAuditActionPhoto(\''+closeout.id+'\')'));
 const writes=registerMutations(a).length;await a.run(`removeAuditActionPhoto('${auditPhotos[0].id}')`);
 assert.equal(registerMutations(a).length,writes,'Even a stale button or direct handler must not submit removal of an audit photo');
 const downloaded=await a.run(`api(actionPath(),{operation:'download-photo',fileId:'${auditPhotos[0].id}',mutationId:crypto.randomUUID()})`);
 assert.equal(downloaded.fileName,auditPhotos[0].fileName);assert.equal(downloaded.data,photoData);
 a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Repair checked')");const edit=registerEdit(a);
 await a.run(`removeAuditActionPhoto('${closeout.id}')`);
 assert.equal(sourcePhotos(a,'closeout').length,0);assert.deepEqual(sourcePhotos(a,'audit').map(f=>f.id),auditPhotos.map(f=>f.id));assert.deepEqual(registerEdit(a),edit);
 for(const file of auditPhotos)assert.equal(s.read('safety:walk-file:'+file.id).data,photoData);
 assert.deepEqual(s.read('safety:walk:'+audit.id),auditSnapshot);
});

test('a lost close-out photo response and reopen retain both photo groups without duplicating evidence or losing notes',async()=>{
 const {s,a,audit,key,auditPhotos,auditSnapshot}=await registerWithAuditPhotos(3);
 a.run("auditActionSet('status','Closed');auditActionSet('owner','Repair supervisor');auditActionSet('closeEvidence','Repair details still being completed')");const edit=registerEdit(a);
 a.context.photo=registerPhotos(a,'repair-after.png');a.dropActionResponse=true;await a.run('auditActionPhotos(photo)');
 const mutation=a.run('auditActionPending.body.mutationId');assert.ok(mutation);assert.equal(s.read(key).photos.length,4);
 await a.run(`openAuditAction('${audit.id}','${audit.actions[0].id}')`);assert.deepEqual(registerEdit(a),edit);
 assert.equal(await a.run('saveAuditAction()'),true);assert.equal(a.run('auditActionPending'),null);assert.deepEqual(registerEdit(a),edit);
 assert.deepEqual(sourcePhotos(a,'audit').map(f=>f.id),auditPhotos.map(f=>f.id));assert.deepEqual(sourcePhotos(a,'closeout').map(f=>f.fileName),['repair-after.png']);
 assert.equal(registerMutations(a).filter(q=>q.packet.mutationId===mutation).length,2);assert.equal(s.read(key).history.filter(h=>h.event==='Photo attached').length,1);
 assert.equal(await a.run('saveAuditAction()'),true);
 const other=device(s);await other.login();await other.run(`openAuditAction('${audit.id}','${audit.actions[0].id}')`);
 assert.equal(other.run('auditAction.status'),'Closed');assert.equal(other.run('auditAction.closeEvidence'),edit.closeEvidence);
 assert.equal(sourcePhotos(other,'audit').length,3);assert.equal(sourcePhotos(other,'closeout').length,1);assert.deepEqual(s.read('safety:walk:'+audit.id),auditSnapshot);
});

test('brought-forward close-out photos remain separate and do not consume the new audit photo allowance',async()=>{
 const {s,a,audit,auditSnapshot}=await registerWithAuditPhotos(1);
 a.context.repairs=registerPhotos(a,'repair-1.png','repair-2.png','repair-3.png','repair-4.png','repair-5.png');await a.run('auditActionPhotos(repairs)');
 assert.equal(sourcePhotos(a,'closeout').length,5);
 await a.run('openWalks()');await a.run('newWalk()');
 const carried=a.record().carriedActions[0];assert.equal(carried.originAuditId,audit.id);
 const html=a.run('walkActionPhotos(walkRecord.carriedActions[0],true)'),input=html.match(/<input\b[^>]*\btype="file"[^>]*>/)?.[0];
 assert.ok(input);assert.doesNotMatch(input,/\sdisabled(?:\s|>)/,'Inherited close-out photos must not disable audit evidence uploads');
 assert.match(html,/Close-out photos/);
 a.context.followupPhoto=syntheticAuditPhoto(a,'next-audit-check.png');await a.run(`walkUpload(followupPhoto,'${carried.ref}','${carried.id}')`);
 assert.equal(a.run('walkSaveError'),'');assert.equal(a.record().evidence.length,1);assert.equal(a.record().evidence[0].photoSource,'audit');
 assert.equal(a.record().carriedActions[0].photos.filter(f=>f.photoSource==='closeout').length,5);
 assert.deepEqual(s.read('safety:walk:'+audit.id),auditSnapshot);
});

test('saved action reports download from the register without opening an audit or action',async()=>{
 const {a,audit}=await registerDevice();
 a.run("auditActionSet('status','Closed');auditActionSet('closeEvidence','Guard secured and verified')");assert.equal(await a.run('saveAuditAction()'),true);
 await a.run('openAuditActions()');a.run("auditActionFilter='Closed'");const html=a.run('auditActionsHTML()');
 assert.ok(html.includes("downloadAuditActions('"+audit.id+"')"));assert.ok(html.includes("downloadAuditCloseout('"+audit.id+"')"));
 a.context.reportPaths=[];a.run('walkDownload=async path=>reportPaths.push(path)');const before=a.requests.length;
 await a.run("downloadAuditActions('"+audit.id+"')");await a.run("downloadAuditCloseout('"+audit.id+"')");
 assert.deepEqual(a.context.reportPaths,[`/toolbox/walks/${audit.id}/actions-pdf`,`/toolbox/walks/${audit.id}/actions-closeout-pdf`]);
 assert.equal(a.run('auditAction'),null);assert.equal(a.run('walkRecord'),null);assert.equal(a.run('auditActionFilter'),'Closed');assert.equal(a.requests.length,before);
});
test('monthly audit list offers corrective action PDFs only for completed audits',async()=>{
 const {a,audit}=await registerDevice();a.context.listAudit={...audit,status:'Completed',totals:{open:1,closed:0,overdue:0}};a.run("walkRecord=null;auditRegister=false;walkData={records:[listAudit],completedThisMonth:1,total:1,nextOffset:null}");
 const html=a.run('walksHTML()');assert.ok(html.includes("downloadAuditActions('"+audit.id+"')"));
 a.run("walkData.records=walkData.records.map(r=>({...r,status:'Draft',createdBy:actor.username}))");assert.doesNotMatch(a.run('walksHTML()'),/onclick="downloadAuditActions\('/);
});
