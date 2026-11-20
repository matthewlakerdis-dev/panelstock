import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleSafetyDocuments,safetyAcknowledgementContent} from '../src/safety-documents.js';
import {safetyProfile,safetyProfileDetails,safetyProfileDirectory} from '../src/safety-profiles.js';
import {digest} from '../src/security.js';

const actor={username:'collector',isAdmin:true};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(count=4,{card=true}={}){
 const documentId=crypto.randomUUID(),versionId=crypto.randomUUID(),version={id:versionId,documentId,title:'Factory SWMS',type:'SWMS',label:'Rev 01',fileHash:'a'.repeat(64),requiredSigners:['worker'],signoff:{layout:'lf-swms-v1',firstPage:2,continuationPage:3,statement:'Read and understood.'}};
 const licenses=Array.from({length:count},(_,i)=>({id:'licence-'+i,type:'Licence '+i,class:'CLASS-'+i,number:'NUMBER-'+i,expiryDate:'2030-01-01',notes:'Profile note '+i}));
 if(card&&licenses.length)licenses[Math.min(2,licenses.length-1)].type='White Card';
 const values=new Map([['users',{worker:{displayName:'Worker Name',title:'Factory Manager'}}],['safety:document:'+documentId,{id:documentId,currentVersion:versionId,type:'SWMS',versions:[version],revision:1}]]);
 const store={values,employee:{licenses,inductions:[]},row:{displayName:'Worker Name',title:'Factory Manager'},
  read:(key,fallback=null)=>structuredClone(values.has(key)?values.get(key):fallback),write:(key,value)=>values.set(key,structuredClone(value)),employeeProfile:()=>structuredClone(store.employee),
  sql:{exec:()=>({toArray:()=>[structuredClone(store.row)]})},requireTask:()=>{},audit:()=>{},ctx:{storage:{transactionSync:fn=>{store.beforeTransaction?.();return fn();}}}};
 return {store,version,path:'/toolbox/safety-documents/'+documentId};
}
async function packet(store,version,{legacy=false}={}){
 const user=(await safetyProfileDirectory(store))[0],details=legacy?safetyProfileDetails(user):structuredClone(user.signoffDetails);
 const card=user.licenses.find(l=>/^(construction card|construction induction card)$/i.test(l.type))||user.licenses.find(l=>/^white card$/i.test(l.type));
 const other=user.licenses.filter(l=>l!==card);
 return {versionId:version.id,username:user.username,details,profileRevision:user.profileRevision,profileLicenceIds:[0,1].map(i=>other[i]?.id||''),mutationId:crypto.randomUUID(),signature:{image,at:'2026-11-20T00:00:00.000Z',contentHash:await digest(safetyAcknowledgementContent(version,{username:user.username,name:user.displayName,details}))}};
}
const sign=(s,path,body,selfService=false)=>handleSafetyDocuments(s,path+'/acknowledge','POST',body,selfService?{username:'worker'}:actor,selfService);

for(const count of [0,3,4,50])test('signed licence snapshot retains all '+count+' profile entries and is immutable after later profile edits',async()=>{
 const {store,version,path}=fixture(count),body=await packet(store,version),profile=safetyProfile(store,'worker'),original=structuredClone(body.details);
 assert.equal(body.details.allLicences.length,count);assert.equal(body.details.licences.length,2);
 const designated=profile.licenses.find(l=>l.type==='White Card'),ordered=[...(designated?[designated]:[]),...profile.licenses.filter(l=>l!==designated)];
 assert.deepEqual(body.details.allLicences,ordered.map(l=>({description:l.type,class:l.class,number:l.number})));
 if(count){assert.equal(body.details.allLicences[0].description,'White Card');assert.ok(body.details.allLicences.every(l=>Object.keys(l).join(',')==='description,class,number'));}
 const saved=(await sign(store,path,body,true)).body.acknowledgements[0];
 assert.deepEqual(saved.details,original);assert.equal(saved.signature.contentHash,body.signature.contentHash);
 assert.equal((await sign(store,path,body,true)).body.duplicate,true);assert.equal(store.read('safety:ack:'+version.id).length,1);
 store.employee.licenses.push({id:'new',type:'Later licence',class:'NEW',number:'NEW-NUMBER'});if(count)store.employee.licenses[0].number='CHANGED-AFTER-SIGNING';store.row.title='Changed role';
 const fetched=(await handleSafetyDocuments(store,path,'GET',{},actor)).body.acknowledgements[0];
 assert.deepEqual(fetched.details,original);assert.equal(await digest(safetyAcknowledgementContent(version,fetched)),body.signature.contentHash);assert.notDeepEqual(safetyProfile(store,'worker'),profile);
});

test('the complete snapshot has no artificial construction card and preserves profile labels and non-card ordering',async()=>{
 const {store,version}=fixture(4,{card:false});store.employee.licenses[1].type='Elevated Work Platform';
 const body=await packet(store,version);
 assert.deepEqual(body.details.allLicences,store.employee.licenses.map(l=>({description:l.type,class:l.class,number:l.number})));
 const legacy=safetyProfileDetails(safetyProfile(store,'worker'));assert.equal(Object.hasOwn(legacy,'allLicences'),false);
});

test('missing, reordered, duplicated or forged extra licences fail even with a freshly computed signature hash',async()=>{
 const {store,version,path}=fixture(4),body=await packet(store,version);
 for(const change of [
  entries=>entries.slice(0,3),entries=>[],entries=>[entries[0],entries[1],entries[2],entries[2]],entries=>[...entries].reverse(),
  entries=>entries.map((entry,i)=>i===3?{...entry,number:'FORGED'}:entry),entries=>entries.map((entry,i)=>i===3?{...entry,description:'A different licence'}:entry),entries=>entries.map((entry,i)=>i===3?{...entry,class:'OTHER'}:entry)
 ]){
  const forged=structuredClone(body);forged.details.allLicences=change(forged.details.allLicences);forged.signature.contentHash=await digest(safetyAcknowledgementContent(version,{username:'worker',name:'Worker Name',details:forged.details}));
  await assert.rejects(sign(store,path,forged),{status:409});assert.deepEqual(store.read('safety:ack:'+version.id,[]),[]);
 }
});

test('full snapshots require a checked profile and reject invalid or oversized licence arrays',async()=>{
 const {store,version,path}=fixture(4),body=await packet(store,version),unverified=structuredClone(body);delete unverified.profileRevision;
 await assert.rejects(sign(store,path,unverified),{status:409});
 for(const allLicences of [null,{},Array(51).fill(body.details.allLicences[0]),[null],[[]],[{description:'',class:'LF',number:'123'}],[{description:'x'.repeat(121),class:'',number:''}],[{description:'Forklift',class:'x'.repeat(19),number:''}],[{description:'Forklift',class:'LF',number:'x'.repeat(25)}]]){
  await assert.rejects(sign(store,path,{...body,details:{...body.details,allLicences}}),{status:400});
 }
 assert.deepEqual(store.read('safety:ack:'+version.id,[]),[]);
});

test('a changed extra licence or transaction-time profile edit requires a fresh acknowledgement',async()=>{
 for(const atTransaction of [false,true]){
  const {store,version,path}=fixture(4),body=await packet(store,version),edit=()=>{store.employee.licenses[3].number='NEW-NUMBER';};
  if(atTransaction)store.beforeTransaction=edit;else edit();
  await assert.rejects(sign(store,path,body),{status:409});assert.deepEqual(store.read('safety:ack:'+version.id,[]),[]);
 }
});

test('cached clients retain their three-row signature contract and mutation replay still protects the captured snapshot',async()=>{
 const {store,version,path}=fixture(4),body=await packet(store,version,{legacy:true});
 assert.equal(Object.hasOwn(body.details,'allLicences'),false);
 const saved=(await sign(store,path,body)).body.acknowledgements[0];assert.deepEqual(saved.details,body.details);assert.equal(Object.hasOwn(saved.details,'allLicences'),false);
 assert.equal((await sign(store,path,body)).body.duplicate,true);
 await assert.rejects(sign(store,path,{...body,signature:{...body.signature,at:'2026-11-20T00:01:00.000Z'}}),{status:409});
 assert.deepEqual(store.read('safety:ack:'+version.id)[0],saved);
});
