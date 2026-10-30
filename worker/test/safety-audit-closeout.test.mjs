import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {handleToolbox} from '../src/toolbox.js';
import {buildAuditActionCloseoutReport} from '../src/safety-audit-actions.js';
import {WALK_TEMPLATE} from '../src/safety-walk-template.js';
import {walkContent} from '../src/safety-walks.js';
import {digest} from '../src/security.js';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const actor={username:'auditor',tasks:{'factory.toolbox':true}},other={username:'other',tasks:{'factory.toolbox':true}};
function store(){
 const docs=new Map([['users',{auditor:{displayName:'Conductor'},other:{displayName:'Other Supervisor'}}]]);
 return {docs,read:(k,d=null)=>structuredClone(docs.has(k)?docs.get(k):d),write:(k,v)=>docs.set(k,structuredClone(v)),audit(){},ctx:{storage:{transactionSync:f=>f()}},requireTask(a){if(!a?.tasks?.['factory.toolbox'])throw Object.assign(Error('Forbidden'),{status:403});}};
}
const call=(s,path='',body,who=actor)=>handleToolbox(s,'/toolbox/walks'+path,body===undefined?'GET':'POST',body||{},who);
const path=a=>'/actions/'+a.originAuditId+'/'+a.originActionId;
const registerKey=a=>'safety:audit-action:'+a.originAuditId+':'+a.originActionId;
const snapshot=s=>structuredClone([...s.docs]);
const fields=a=>Object.fromEntries(['status','owner','due','closeEvidence','verifiedBy','verifiedDate'].map(k=>[k,a[k]]));
const update=async(s,a,changes)=>(await call(s,path(a),{operation:'update',expectedRevision:a.revision,mutationId:crypto.randomUUID(),...fields(a),...changes})).body.action;
const closure={status:'Closed',closeEvidence:'Replacement guard installed and tested.',verifiedBy:'Other Supervisor',verifiedDate:'2026-01-20'};
function draft(){
 return {id:crypto.randomUUID(),status:'Draft',date:'2026-01-05',auditors:'Conductor',area:'Workshop',previousReviewed:'Yes',answers:WALK_TEMPLATE.sections.flatMap(section=>section.items.map(item=>({ref:item.ref,result:'C',comments:''}))),actions:[],summary:{escalation:'',resources:'',findings:'',priorities:['','','']},review:{by:'',date:'',position:'',nextAuditDue:'',actionsAccepted:'',escalationRequired:'',comments:''}};
}
const save=async(s,r)=>(await call(s,'/'+r.id,{record:r,expectedRevision:r.revision||0,mutationId:crypto.randomUUID()})).body.record;
async function completedAudit(s){
 let r=await save(s,draft());
 r.answers[0].result='NC';r.answers[1].result='O';r=await save(s,r);
 for(const action of r.actions)Object.assign(action,{risk:'M',correctiveAction:'Replace damaged guard',due:'2026-02-01'});
 r=await save(s,r);
 r=(await call(s,'/'+r.id+'/file',{action:'upload',ref:r.actions[1].ref,actionId:r.actions[1].id,fileName:'original-guard.png',mime:'image/png',data:image.split(',')[1],expectedRevision:r.revision,mutationId:crypto.randomUUID()})).body.record;
 r.status='Completed';r.signature={image,at:new Date().toISOString(),contentHash:await digest(walkContent(r))};
 return (await call(s,'/'+r.id,{record:r,expectedRevision:r.revision,mutationId:crypto.randomUUID()})).body.record;
}
function seedAudit(s,record){
 s.write('safety:walk:'+record.id,record);
 s.write('safety:walks',[...s.read('safety:walks',[]),{id:record.id,date:record.date,status:'Completed',completedAt:record.completedAt}]);
}
function action(id=crypto.randomUUID(),ref='1.1'){
 return {id,ref,issue:'Missing guard',risk:'M',immediateControl:'Isolate machine',correctiveAction:'Replace guard',owner:'Conductor',due:'2026-02-01',status:'Open',closeEvidence:'',verifiedBy:'',verifiedDate:''};
}

test('close-out download uses current closed actions and active photos without changing signed records or PDF caches',async()=>{
 const s=store(),r=await completedAudit(s),route='/'+r.id+'/actions-closeout-pdf';
 const originals={record:s.read('safety:walk:'+r.id),auditPdf:s.read('safety:walk-pdf:'+r.id),actionsPdf:s.read('safety:audit-actions-pdf:'+r.id)};
 await assert.rejects(call(s,route),{status:409,message:'No corrective actions are closed for this audit yet.'});
 let a=(await call(s,'/actions')).body.actions.find(item=>item.originActionId===r.actions[1].id);
 a=await update(s,a,closure);
 a=(await call(s,path(a),{operation:'upload-photo',expectedRevision:a.revision,mutationId:crypto.randomUUID(),fileName:'verified-repair.png',mime:'image/png',data:image.split(',')[1]})).body.action;
 await assert.rejects(call(s,path(a),{operation:'remove-photo',fileId:r.evidence[0].id,expectedRevision:a.revision,mutationId:crypto.randomUUID()}),{status:409});
 const projection=buildAuditActionCloseoutReport(s,r,'2026-01-21T10:00:00.000Z');
 assert.deepEqual(projection.closeout,{generatedAt:'2026-01-21T10:00:00.000Z',total:2,closed:1,open:1});
 assert.equal(projection.actions[0].reportReference,'02');
 assert.equal(projection.actions[0].id,r.actions[1].id);
 assert.equal(projection.actions[0].closeEvidence,closure.closeEvidence);
 assert.equal(projection.actions[0].verifiedBy,closure.verifiedBy);
 assert.equal(projection.actions[0].verifiedDate,closure.verifiedDate);
 assert.deepEqual(projection.evidence.map(file=>file.fileName),['verified-repair.png']);
 assert.equal(projection.evidence[0].actionId,r.actions[1].id);
 assert.equal(projection.signature,undefined);
 assert.equal(projection.actions[0].photoArchive,undefined);
 const beforeDownload=snapshot(s),download=(await call(s,route,undefined,other)).body;
 assert.equal(download.mime,'application/pdf');
 assert.equal(download.fileName,'Lennox_Facades_'+r.documentNo+'_Corrective_Action_Closeout_05-01-2026.pdf');
 assert.equal(download.closeout.generatedAt,download.asOf);
 assert.ok(Number.isFinite(Date.parse(download.asOf)));
 assert.equal(download.closeout.closed,1);
 const pdf=await PDFDocument.load(Buffer.from(download.data,'base64'));
 assert.match(pdf.getTitle(),/close.out/i);
 assert.equal(pdf.getPageCount(),2,'Current action photo gets its own evidence page');
 assert.deepEqual(snapshot(s),beforeDownload,'Downloading does not write or replace any stored data');
 assert.deepEqual(s.read('safety:walk:'+r.id),originals.record);
 assert.deepEqual((await call(s,'/'+r.id+'/pdf')).body,{ok:true,...originals.auditPdf});
 assert.deepEqual((await call(s,'/'+r.id+'/actions-pdf')).body,{ok:true,...originals.actionsPdf});
 a=await update(s,a,{status:'Open'});
 await assert.rejects(call(s,route),{status:409,message:'No corrective actions are closed for this audit yet.'});
});

test('projection follows origin identities into later carried audits and excludes unrelated or originally carried actions',()=>{
 const s=store(),firstId=crypto.randomUUID(),secondId=crypto.randomUUID(),foreignId=crypto.randomUUID();
 const one=action(),two=action(undefined,'1.2'),foreign=action(undefined,'2.1');
 const original={id:firstId,documentNo:'LF-MA-0001',date:'2026-01-05',completedAt:'2026-01-05T10:00:00.000Z',auditors:'Conductor',area:'Workshop',createdBy:'auditor',status:'Completed',actions:[one,two],carriedActions:[{...foreign,originAuditId:foreignId,originActionId:foreign.id,...closure}],answers:[{ref:one.ref,result:'NC'},{ref:two.ref,result:'O'}],evidence:[],signature:{image,contentHash:'original-signed-hash'}};
 const carriedId=crypto.randomUUID(),photo={id:crypto.randomUUID(),fileName:'later-repair.png',mime:'image/png',actionId:carriedId,ref:two.ref};
 seedAudit(s,original);
 seedAudit(s,{id:secondId,documentNo:'LF-MA-0002',date:'2026-02-02',completedAt:'2026-02-02T10:00:00.000Z',createdBy:'auditor',actions:[{...action(),...closure}],carriedActions:[{...two,id:carriedId,originAuditId:firstId,originActionId:two.id,...closure,photos:[photo,photo]}],answers:[],evidence:[{...photo,id:crypto.randomUUID(),fileName:'later-audit.png'}]});
 const before=snapshot(s),report=buildAuditActionCloseoutReport(s,original,'2026-02-03T00:00:00.000Z');
 assert.equal(report.actions.length,1);
 assert.equal(report.closeout.total,2);
 assert.equal(report.closeout.closed,1);
 assert.equal(report.closeout.open,1);
 assert.equal(report.actions[0].reportReference,'02');
 assert.equal(report.actions[0].id,two.id);
 assert.equal(report.actions[0].originAuditId,firstId);
 assert.deepEqual(report.evidence.map(file=>file.id),[photo.id]);
 assert.equal(report.evidence[0].actionId,two.id);
 assert.equal(report.actions[0].photos[0].actionId,two.id);
 assert.deepEqual(snapshot(s),before);
 const live={...report.actions[0],photos:[],photoArchive:[photo],status:'Open',updatedAt:'2026-02-03T01:00:00.000Z'};
 s.write(registerKey(live),live);
 const reopened=buildAuditActionCloseoutReport(s,original);
 assert.equal(reopened.actions.length,0,'Live reopening takes precedence over closure in a signed carried copy');
 assert.equal(reopened.closeout.open,2);
 s.write(registerKey(live),{...live,status:'Closed'});
 const withoutRemovedPhoto=buildAuditActionCloseoutReport(s,original);
 assert.equal(withoutRemovedPhoto.actions.length,1);
 assert.deepEqual(withoutRemovedPhoto.evidence,[],'Archived photos must not return through the original or carried evidence');
});

test('close-out endpoint requires audit access and completion, accepts GET only, and handles no closed findings',async()=>{
 const s=store(),r=await save(s,draft()),route='/'+r.id+'/actions-closeout-pdf';
 await assert.rejects(call(s,route),{status:409,message:'Complete and sign this audit before downloading its reports'});
 await assert.rejects(call(s,route,undefined,other),{status:404});
 await assert.rejects(call(s,route,undefined,{username:'member'}),{status:403});
 await assert.rejects(call(s,route,{}),{status:405});
 await assert.rejects(call(s,'/'+crypto.randomUUID()+'/actions-closeout-pdf'),{status:404});
 const empty={...r,status:'Completed',completedAt:'2026-01-05T10:00:00.000Z'};
 s.write('safety:walk:'+r.id,empty);
 await assert.rejects(call(s,route),{status:409,message:'No corrective actions are closed for this audit yet.'});
});

test('archiving recent audits keeps an origin audit available for a current register close-out report',async()=>{
 const s=store(),id=crypto.randomUUID(),a=action();
 const r={id,documentNo:'LF-MA-0042',date:'2026-01-05',completedAt:'2026-01-05T10:00:00.000Z',auditors:'Conductor',area:'Workshop',createdBy:'auditor',status:'Completed',actions:[a],carriedActions:[],answers:[{ref:a.ref,result:'NC'}],evidence:[]};
 seedAudit(s,r);
 s.write('safety:walks',s.read('safety:walks').map(row=>({...row,archivedAt:'2026-02-01T00:00:00.000Z'})));
 s.write('safety:walk-archived:'+id,{at:'2026-02-01T00:00:00.000Z'});
 const live={...a,...closure,originAuditId:id,originActionId:a.id,photos:[],revision:2,updatedAt:'2026-02-02T00:00:00.000Z'};
 s.write(registerKey(live),live);
 const before=snapshot(s),report=(await call(s,'/'+id+'/actions-closeout-pdf',undefined,other)).body;
 assert.equal(report.closeout.closed,1);
 assert.equal(report.closeout.open,0);
 assert.equal((await PDFDocument.load(Buffer.from(report.data,'base64'))).getPageCount(),1);
 assert.deepEqual(snapshot(s),before);
});
