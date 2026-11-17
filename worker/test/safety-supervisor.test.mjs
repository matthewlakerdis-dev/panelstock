import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,degrees} from 'pdf-lib';
import {handleSafetyDocuments,safetyAcknowledgementContent} from '../src/safety-documents.js';
import {scanSafetyPdf} from '../src/safety-scan.js';
import {digest} from '../src/security.js';

const admin={username:'admin',isAdmin:true},collector={username:'collector'};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const profileDetails={role:'',licenceClass:'',licenceNumber:'',qualifications:''};
const supervisorField=()=>({page:1,width:792,height:612,name:'Eugene Molenaar',label:'Signature',rect:[160,170,220,16]});
const workerTable=()=>({page:2,width:792,height:612,columns:{name:[50,90],role:[140,100],type:[240,90],class:[330,90],number:[420,90],date:[510,80],signature:[590,140]},rows:[{top:200,height:36}]});
const scanResult=(tables=true)=>({status:'detected',pages:tables?[workerTable()]:[],candidatePages:[1,2],supervisors:[supervisorField()]});

function fixture(){
 const docs=new Map([['users',{eugene:{displayName:'Eugene Molenaar',active:true},worker:{displayName:'Worker Name',active:true},inactive:{displayName:'Inactive User',active:false}}]]);
 return {docs,env:{PDF_CONVERTER_URL:'https://scanner.example.test',PDF_CONVERTER_TOKEN:'synthetic'},read:(k,fallback=null)=>structuredClone(docs.has(k)?docs.get(k):fallback),write:(k,v)=>docs.set(k,structuredClone(v)),ctx:{storage:{transactionSync:fn=>fn()}},requireTask(actor){if(actor!==admin&&actor!==collector)throw Object.assign(Error('Forbidden'),{status:403});},audit(){}};
}
const call=(s,path,body={},actor=admin)=>handleSafetyDocuments(s,'/toolbox/safety-documents'+path,'POST',body,actor);
async function upload(s,{rotation=0,id=crypto.randomUUID(),expectedRevision=0}={}){
 const pdf=await PDFDocument.create();pdf.addPage([792,612]).setRotation(degrees(rotation));pdf.addPage([792,612]);
 const bytes=await pdf.save();
 return (await call(s,'',{id,type:'SWMS',title:'Fabrication SWMS',versionLabel:'Rev 1',fileName:'fabrication.pdf',data:Buffer.from(bytes).toString('base64'),expectedRevision,mutationId:crypto.randomUUID()})).body;
}
async function withScanner(result,fn){
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify(result));
 try{return await fn();}finally{globalThis.fetch=original;}
}
const scan=(s,d)=>call(s,'/'+d.document.id+'/scan',{expectedRevision:d.document.revision,versionId:d.version.id}).then(r=>r.body);
const configure=(s,d,usernames=['eugene'],extra={})=>call(s,'/'+d.document.id+'/signoff',{expectedRevision:d.document.revision,useDetected:true,supervisorUsernames:usernames,...extra}).then(r=>r.body);
async function acknowledgement(v,username='eugene',name='Eugene Molenaar'){
 return {versionId:v.id,username,details:{...profileDetails},mutationId:crypto.randomUUID(),signature:{image,at:new Date().toISOString(),contentHash:await digest(safetyAcknowledgementContent(v,{username,name,details:profileDetails}))}};
}

for(const tables of [true,false])test(`supervisor ${tables?'and worker':'only'} detection maps a named user and saves server geometry before signing`,async()=>{
 const s=fixture(),uploaded=await upload(s),detected=scanResult(tables);
 await withScanner(detected,async()=>{
  const scanned=await scan(s,uploaded),suggestion=scanned.version.scanSuggestion;
  assert.equal(suggestion.status,'detected');assert.equal(scanned.version.signoff,undefined);
  assert.deepEqual(suggestion.supervisors,[{...supervisorField(),username:'eugene'}]);
  assert.equal(suggestion.fileHash,uploaded.version.fileHash);
  const configured=await configure(s,scanned,['eugene'],{supervisors:[{...supervisorField(),rect:[0,0,792,612],username:'worker'}]});
  assert.deepEqual(configured.version.signoff.supervisors,suggestion.supervisors,'The client cannot override detected coordinates');
  assert.deepEqual(configured.version.signoff.pages,detected.pages);
  assert.deepEqual(configured.version.requiredSigners,['eugene']);
  assert.equal(configured.version.fileHash,uploaded.version.fileHash);
  const signed=(await call(s,'/'+uploaded.document.id+'/acknowledge',await acknowledgement(configured.version),collector)).body;
  assert.equal(signed.acknowledgements[0].username,'eugene');
  assert.deepEqual(signed.acknowledgements[0].signoff,configured.version.signoff);
  await assert.rejects(configure(s,configured),{status:409});
 });
});

test('supervisor matching uses one exact normalized active profile name, not a partial or ambiguous name',async()=>{
 for(const [name,users,expected] of [
  ['  EUGENE   MOLENAAR  ',{eugene:{displayName:'Eugene Molenaar',active:true}},'eugene'],
  ['Eugene',{eugene:{displayName:'Eugene Molenaar',active:true}},''],
  ['Eugene Molenaar',{eugene:{displayName:'Eugene Molenaar',active:false}},''],
  ['Eugene Molenaar',{eugene:{displayName:'Eugene Molenaar'},duplicate:{displayName:' eugene molenaar '}},'']
 ]){
  const s=fixture();s.write('users',users);const uploaded=await upload(s),result=scanResult(false);result.supervisors[0].name=name;
  const suggestion=await withScanner(result,()=>scanSafetyPdf(s,uploaded.version));
  assert.equal(suggestion.supervisors[0].username,expected,name);
 }
});

test('SQL profile names are authoritative over stale account display names when suggesting a supervisor',async()=>{
 const s=fixture(),uploaded=await upload(s);s.write('users',{eugene:{displayName:'Old profile name'},worker:{displayName:'Eugene Molenaar'}});
 const profiles={eugene:{username:'eugene',displayName:'Eugene Molenaar',active:1},worker:{username:'worker',displayName:'Worker Name',active:1}};
 s.sql={exec(query,...params){assert.match(query,/access_users/);return {toArray:()=>params.length?[profiles[params[0]]].filter(Boolean):Object.values(profiles)};}};
 const result=await withScanner(scanResult(false),()=>scanSafetyPdf(s,uploaded.version));
 assert.equal(result.supervisors[0].username,'eugene');
});

test('malformed or overlapping supervisor geometry cannot be persisted',async()=>{
 const invalid=[
  r=>r.supervisors={},
  r=>r.supervisors=Array.from({length:21},supervisorField),
  r=>r.supervisors[0].page=0,
  r=>r.supervisors[0].page=3,
  r=>r.supervisors[0].width=800,
  r=>r.supervisors[0].height=600,
  r=>r.supervisors[0].name='',
  r=>r.supervisors[0].name='x'.repeat(121),
  r=>r.supervisors[0].label='Authorised by',
  r=>r.supervisors[0].rect=[1,2,3],
  r=>r.supervisors[0].rect=[-1,170,220,16],
  r=>r.supervisors[0].rect=[160,-1,220,16],
  r=>r.supervisors[0].rect=[700,170,220,16],
  r=>r.supervisors[0].rect=[160,605,220,16],
  r=>r.supervisors[0].rect=[160,170,0,16],
  r=>r.supervisors[0].rect=[160,170,220,Infinity],
  r=>r.supervisors.push({...supervisorField(),name:'Worker Name',rect:[170,175,200,16]}),
  r=>Object.assign(r.supervisors[0],{page:2,rect:[100,205,160,16]})
 ];
 for(const change of invalid){
  const s=fixture(),uploaded=await upload(s),result=scanResult();change(result);
  await withScanner(result,()=>assert.rejects(scan(s,uploaded),{status:400}));
  const saved=s.read('safety:document:'+uploaded.document.id);
  assert.equal(saved.revision,1);assert.equal(saved.versions[0].scanSuggestion,undefined);
 }
 const s=fixture(),rotated=await upload(s,{rotation:90});
 await withScanner(scanResult(false),()=>assert.rejects(scan(s,rotated),{status:400}));
});

test('supervisor setup requires admin access, current geometry and an explicit active account mapping',async()=>{
 const s=fixture(),uploaded=await upload(s);
 await withScanner(scanResult(),async()=>{
  await assert.rejects(call(s,'/'+uploaded.document.id+'/scan',{expectedRevision:1,versionId:uploaded.version.id},collector),{status:403});
  const scanned=await scan(s,uploaded),path='/'+uploaded.document.id+'/signoff';
  await assert.rejects(call(s,path,{expectedRevision:2,useDetected:true,supervisorUsernames:['eugene']},collector),{status:403});
  for(const supervisorUsernames of [undefined,[],[''],['inactive'],['missing'],['constructor'],[null],[{}],['eugene','worker']]){
   await assert.rejects(call(s,path,{expectedRevision:2,useDetected:true,supervisorUsernames}),{status:400});
  }
  await assert.rejects(configure(s,scanned,['eugene'],{expectedRevision:1}),{status:409});
  const stored=s.read('safety:document:'+uploaded.document.id);stored.versions[0].scanSuggestion.fileHash='stale';s.write('safety:document:'+stored.id,stored);
  await assert.rejects(configure(s,scanned),{status:400});
  assert.equal(s.read('safety:document:'+uploaded.document.id).revision,2);
 });
});

test('configured supervisors remain required while admins change the rest of the assigned team',async()=>{
 const s=fixture(),uploaded=await upload(s);
 await withScanner(scanResult(),async()=>{
  const configured=await configure(s,await scan(s,uploaded)),path='/'+uploaded.document.id+'/assignees';
  let result=(await call(s,path,{versionId:configured.version.id,expectedRevision:configured.document.revision,usernames:['worker']})).body;
  assert.deepEqual(new Set(result.version.requiredSigners),new Set(['worker','eugene']));
  result=(await call(s,path,{versionId:result.version.id,expectedRevision:result.document.revision,usernames:[]})).body;
  assert.deepEqual(result.version.requiredSigners,['eugene']);
  const summary=(await handleSafetyDocuments(s,'/toolbox/safety-documents/summary','GET',{}, {username:'eugene'},true)).body;
  assert.equal(summary.outstanding,1);
 });
});

test('supervisor responsibilities bind to the exact signer and version without changing legacy content',async()=>{
 const legacy={documentId:'document',id:'version',title:'SWMS',type:'SWMS',label:'Rev 1',fileHash:'hash',signoff:{layout:'lf-swms-v1',firstPage:1,continuationPage:2,statement:'Existing declaration'}};
 const user={username:'eugene',name:'Eugene Molenaar',details:profileDetails};
 const expected=JSON.stringify({documentId:'document',versionId:'version',title:'SWMS',type:'SWMS',versionLabel:'Rev 1',fileHash:'hash',username:'eugene',name:'Eugene Molenaar',statement:'Existing declaration',signoff:legacy.signoff,details:profileDetails});
 assert.equal(safetyAcknowledgementContent(legacy,user),expected);
 const s=fixture(),uploaded=await upload(s);
 await withScanner(scanResult(),async()=>{
  let configured=await configure(s,await scan(s,uploaded));
  configured=(await call(s,'/'+uploaded.document.id+'/assignees',{expectedRevision:configured.document.revision,versionId:configured.version.id,usernames:['worker']})).body;
  const content=JSON.parse(safetyAcknowledgementContent(configured.version,user));
  assert.match(content.statement,/responsible person|supervisor/i);
  assert.equal(JSON.parse(safetyAcknowledgementContent(configured.version,{...user,username:'worker'})).statement,configured.version.signoff.statement);
  const ack=await acknowledgement(configured.version),path='/'+uploaded.document.id+'/acknowledge';
  await assert.rejects(call(s,path,{...ack,username:'worker'},collector),{status:409});
  const changedVersion=structuredClone(configured.version);changedVersion.signoff.supervisors[0].username='worker';
  assert.notEqual(await digest(safetyAcknowledgementContent(changedVersion,user)),ack.signature.contentHash);
  const signed=(await call(s,path,ack,collector)).body;
  assert.equal((await call(s,path,ack,collector)).body.duplicate,true);
  assert.equal(signed.acknowledgements[0].versionId,configured.version.id);
  assert.equal(signed.acknowledgements[0].fileHash,configured.version.fileHash);
  const replacement=await upload(s,{id:uploaded.document.id,expectedRevision:configured.document.revision});
  assert.equal(replacement.version.signoff,undefined);assert.deepEqual(replacement.acknowledgements,[]);
  await assert.rejects(call(s,path,{...ack,mutationId:crypto.randomUUID()},collector),{status:409});
 });
});

test('old table-only scans still configure without supervisor mapping or new signed fields',async()=>{
 const s=fixture(),uploaded=await upload(s),result={status:'detected',pages:[workerTable()],candidatePages:[2]};
 await withScanner(result,async()=>{
  const scanned=await scan(s,uploaded);
  const configured=(await call(s,'/'+uploaded.document.id+'/signoff',{expectedRevision:scanned.document.revision,useDetected:true})).body;
  assert.deepEqual(configured.version.signoff.pages,result.pages);
  assert.equal(Object.hasOwn(configured.version.signoff,'supervisors'),false);
  assert.deepEqual(configured.version.requiredSigners,[]);
 });
});
