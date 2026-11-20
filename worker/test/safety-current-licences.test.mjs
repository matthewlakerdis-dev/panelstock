import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleSafetyDocuments,safetyAcknowledgementContent} from '../src/safety-documents.js';
import {handleSafetySelfService} from '../src/safety-self-service.js';
import {safetyLicenceUpdates} from '../src/safety-licence-updates.js';
import {digest} from '../src/security.js';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const manager={username:'manager',isAdmin:true},worker={username:'worker'};
const card={description:'White Card',class:'General',number:'WC-123'},forklift={description:'Forklift',class:'LF',number:'LF-456'},ewp={description:'EWP',class:'WP',number:'WP-789'};
const profileLicence=(entry,index=0)=>({id:'licence-'+index,type:entry.description,class:entry.class,number:entry.number,expiryDate:'2030-01-01',notes:'PRIVATE PROFILE NOTE'});
async function fixture({legacy=false,other=true}={}){
 const id=crypto.randomUUID(),version={id:crypto.randomUUID(),documentId:id,title:'Factory SWMS',type:'SWMS',label:'Rev 01',fileName:'factory.pdf',fileHash:'a'.repeat(64),requiredSigners:['worker','other'],signoff:{layout:'lf-swms-v1',firstPage:1,continuationPage:2,statement:'Read and understood.'}};
 const ack={id:crypto.randomUUID(),username:'worker',name:'Worker Name',documentId:id,versionId:version.id,fileHash:version.fileHash,signoff:structuredClone(version.signoff),details:{role:'Fabricator',licenceDescription:'White Card',licenceClass:'General',licenceNumber:'WC-123',licences:[forklift,ewp],...(!legacy?{allLicences:[card,forklift,ewp]}:{})},signature:{image,at:'2026-11-20T00:00:00.000Z'}};
 ack.signature.contentHash=await digest(safetyAcknowledgementContent(version,ack));
 const otherAck={...structuredClone(ack),id:crypto.randomUUID(),username:'other',name:'Other Person'};otherAck.signature.contentHash=await digest(safetyAcknowledgementContent(version,otherAck));
 const data=Buffer.from('%PDF-original-exact-version').toString('base64'),values=new Map([['users',{worker:{displayName:'Worker Name'},other:{displayName:'Other Person'},unsigned:{displayName:'Unsigned Person'}}],['safety:document:'+id,{id,currentVersion:version.id,type:'SWMS',archived:false,revision:7,versions:[version]}],['safety:file:'+version.id,{data}],['safety:ack:'+version.id,other?[ack,otherAck]:[ack]]]);
 const profiles={worker:{licenses:[card,forklift,ewp].map(profileLicence)},other:{licenses:[card,forklift,ewp].map(profileLicence)},unsigned:{licenses:[{id:'private',type:'PRIVATE UNSIGNED LICENCE',class:'',number:'PRIVATE'}]}};
 const reads=[],store={values,profiles,reads,read:(key,fallback=null)=>structuredClone(values.has(key)?values.get(key):fallback),employeeProfile:username=>{reads.push(username);return structuredClone(profiles[username]||{});},requireTask:actor=>{if(actor!==manager)throw Object.assign(Error('Forbidden'),{status:403});},write:()=>assert.fail('Export must not write storage'),audit:()=>assert.fail('Export must not write an audit mutation'),ctx:{storage:{transactionSync:()=>assert.fail('Read-only export must not open a write transaction')}}};
 return {id,store,version,ack,data,path:'/toolbox/safety-documents/'+id};
}
const exportSigned=(f,body={versionId:f.version.id},actor=manager)=>handleSafetyDocuments(f.store,f.path+'/signed-export','POST',body,actor);
const selfExport=(f,body={versionId:f.version.id},actor=worker)=>handleSafetySelfService(f.store,f.path.replace('/toolbox/','/toolbox/self/')+'/signed-export','POST',body,actor);

for(const legacy of [false,true])test((legacy?'legacy three-row':'complete snapshot')+' signed exports include fresh profile additions without changing acknowledgement history',async()=>{
 const f=await fixture({legacy}),before=JSON.stringify([...f.store.values]),original=structuredClone(f.ack),added={description:'Crane Licence',class:'CN',number:'CN-NEW'};
 const initial=(await exportSigned(f)).body;assert.deepEqual(initial.licenceUpdates.entries,[]);
 f.store.profiles.worker.licenses.push(profileLicence(added,3));
 const result=(await exportSigned(f,{versionId:f.version.id,username:'unsigned',licenceUpdates:{entries:[{username:'unsigned',licences:[{description:'FORGED'}]}]}})).body;
 assert.equal(result.data,f.data);assert.deepEqual(result.version,f.version);assert.deepEqual(result.acknowledgements[0],original);
 assert.deepEqual(result.licenceUpdates.entries,[{acknowledgementId:original.id,username:'worker',licences:[added]}]);assert.ok(Number.isFinite(Date.parse(result.licenceUpdates.asOf)));
 assert.equal(await digest(safetyAcknowledgementContent(result.version,result.acknowledgements[0])),original.signature.contentHash);
 assert.ok(!JSON.stringify(result).includes('PRIVATE PROFILE NOTE'));assert.ok(!f.store.reads.includes('unsigned'));
 const again=(await exportSigned(f)).body;assert.deepEqual(again.licenceUpdates.entries,result.licenceUpdates.entries);
 assert.equal(JSON.stringify([...f.store.values]),before,'No stored file, version, acknowledgement or revision changes');
});

test('edits and removals retain signed values and only unmatched current values are shown as export updates',async()=>{
 const f=await fixture({other:false}),signed=structuredClone(f.ack);
 f.store.profiles.worker.licenses=[profileLicence({...forklift,number:'LF-REPLACED'}),profileLicence(ewp,1)];
 let result=(await exportSigned(f)).body;
 assert.deepEqual(result.licenceUpdates.entries[0].licences,[{...forklift,number:'LF-REPLACED'}]);assert.deepEqual(result.acknowledgements[0],signed);
 f.store.profiles.worker.licenses=[];result=(await exportSigned(f)).body;assert.deepEqual(result.licenceUpdates.entries,[]);assert.deepEqual(result.acknowledgements[0],signed);
});

test('canonical multiset comparison ignores case, whitespace and card aliases but preserves real duplicate entries and exact output labels',()=>{
 const ack={id:'ack',username:'worker',details:{allLicences:[card,forklift,forklift]}},current=[{...card,description:' construction induction card ',class:' general ',number:'wc-123'},{...forklift,description:' FORKLIFT ',class:' lf ',number:' lf-456 '},forklift,forklift,{description:'Elevated  Work Platform',class:'WP',number:'FULL-NUMBER'}];
 const store={read:()=>({worker:{}}),employeeProfile:()=>({licenses:current.map(profileLicence)})};
 assert.deepEqual(safetyLicenceUpdates(store,[ack],'2026-11-20T00:00:00.000Z'),{asOf:'2026-11-20T00:00:00.000Z',entries:[{acknowledgementId:'ack',username:'worker',licences:[forklift,current[4]]}]});
});

test('an empty legacy Construction Card placeholder cannot suppress a newly added card',()=>{
 const ack={id:'ack',username:'worker',details:{role:'Fabricator',licenceClass:'',licenceNumber:'',qualifications:''}},current={description:'White Card',class:'',number:''};
 const store={read:()=>({worker:{}}),employeeProfile:()=>({licenses:[profileLicence(current)]})};
 assert.deepEqual(safetyLicenceUpdates(store,[ack]).entries[0].licences,[current]);
});

test('missing profiles and unsigned users do not contribute current licences',async()=>{
 const f=await fixture({other:false});f.store.values.set('users',{unsigned:{displayName:'Unsigned Person'}});f.store.profiles.worker.licenses.push(profileLicence({description:'Stale removed account licence',class:'LF',number:'STALE'}));
 const result=(await exportSigned(f)).body;assert.deepEqual(result.licenceUpdates.entries,[]);assert.deepEqual(f.store.reads,[]);assert.deepEqual(result.acknowledgements,[f.ack]);
 f.store.values.set('safety:ack:'+f.version.id,[]);assert.deepEqual((await exportSigned(f)).body.licenceUpdates.entries,[]);
});

test('older and archived versions use their exact file and signatures with current profile additions',async()=>{
 const f=await fixture({other:false}),doc=f.store.values.get('safety:document:'+f.id),replacement={...structuredClone(f.version),id:crypto.randomUUID(),fileHash:'b'.repeat(64),label:'Rev 02',fileName:'replacement.pdf'};
 doc.versions.push(replacement);doc.currentVersion=replacement.id;doc.archived=true;f.store.values.set('safety:file:'+replacement.id,{data:'OTHER-FILE'});f.store.values.set('safety:ack:'+replacement.id,[]);
 f.store.profiles.worker.licenses.push(profileLicence({description:'New Rigging',class:'RB',number:'RB-NEW'},3));
 const result=(await exportSigned(f)).body;assert.equal(result.version.id,f.version.id);assert.equal(result.data,f.data);assert.equal(result.acknowledgements[0].id,f.ack.id);assert.equal(result.licenceUpdates.entries[0].licences[0].number,'RB-NEW');
});

test('self-service export filters signatures before profile reads and requires both current and selected assignment',async()=>{
 const f=await fixture();f.store.profiles.worker.licenses.push(profileLicence({description:'Worker addition',class:'LF',number:'WORKER'}));f.store.profiles.other.licenses.push(profileLicence({description:'PRIVATE OTHER LICENCE',class:'WP',number:'PRIVATE-OTHER'}));
 const result=(await selfExport(f,{versionId:f.version.id,username:'other'})).body;assert.deepEqual(result.acknowledgements,[f.ack]);assert.deepEqual(result.licenceUpdates.entries.map(e=>e.username),['worker']);assert.deepEqual(f.store.reads,['worker']);assert.ok(!JSON.stringify(result).includes('PRIVATE-OTHER'));
 const doc=f.store.values.get('safety:document:'+f.id),replacement={...structuredClone(f.version),id:crypto.randomUUID(),requiredSigners:['other']};doc.versions.push(replacement);doc.currentVersion=replacement.id;
 await assert.rejects(selfExport(f),{status:404});replacement.requiredSigners=['worker'];doc.versions[0].requiredSigners=['other'];await assert.rejects(selfExport(f),{status:404});
 await assert.rejects(selfExport(f,undefined,null),{status:401});
});

test('signed-export permissions, method, version and acknowledgement consistency are checked without changing original file reads',async()=>{
 const f=await fixture({other:false});await assert.rejects(exportSigned(f,undefined,worker),{status:403});await assert.rejects(exportSigned(f,{}),{status:400});await assert.rejects(exportSigned(f,{versionId:crypto.randomUUID()}),{status:404});
 await assert.rejects(handleSafetyDocuments(f.store,f.path+'/signed-export','GET',{versionId:f.version.id},manager),{status:405});
 const original=(await handleSafetyDocuments(f.store,f.path+'/file','POST',{versionId:f.version.id},manager)).body;assert.deepEqual(original,{ok:true,fileName:f.version.fileName,data:f.data});
 for(const change of [{versionId:crypto.randomUUID()},{documentId:crypto.randomUUID()},{fileHash:'c'.repeat(64)},{signoff:{...f.version.signoff,statement:'Changed'}}]){f.store.values.set('safety:ack:'+f.version.id,[{...f.ack,...change}]);await assert.rejects(exportSigned(f),{status:409});}
 f.store.values.set('safety:ack:'+f.version.id,[f.ack]);f.store.values.delete('safety:file:'+f.version.id);await assert.rejects(exportSigned(f),{status:404});
});

test('up to fifty current profile entries retain their full central-profile licence numbers',async()=>{
 const f=await fixture({other:false}),current=Array.from({length:50},(_,i)=>({description:'Current Licence '+i,class:'LF',number:i===49?'N'.repeat(100):'CURRENT-'+i}));f.store.profiles.worker.licenses=current.map(profileLicence);
 const result=(await exportSigned(f)).body;assert.deepEqual(result.licenceUpdates.entries[0].licences,current);assert.equal(result.acknowledgements[0].details.allLicences.length,3);
});

test('unconfigured SWMS and SDS exports cannot expose current profile licence context',async()=>{
 for(const mode of ['unconfigured','SDS']){
  const f=await fixture(),doc=f.store.values.get('safety:document:'+f.id);
  if(mode==='unconfigured')delete doc.versions[0].signoff;else doc.type='SDS';
  await assert.rejects(exportSigned(f),{status:400});assert.deepEqual(f.store.reads,[]);
 }
});
