import {requireCondition as check,digest} from './security.js';
import {villaScopeAccess,mutateVillaScope} from './villa-scopes.js';
const MAX_FILE=5*1024*1024,MAX_TOTAL=100*1024*1024,CHUNK=60000;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const key=id=>'villa-scopes:document:'+id;
export function villaDocumentId(value){return typeof value==='string'?value.match(/^\/villa-scopes\/documents\/([a-f0-9-]{36})$/i)?.[1]:null;}
export function validateVillaDocumentRefs(store,record){
 for(const value of [record.VillaPDFURL,record.ScopePDFURL,...record.pos.map(p=>p.DocumentURL)]){
  const id=villaDocumentId(value);if(!id)continue;
  check(store.read(key(id))?.entryId===record.ScopeEntryID,'An uploaded PDF must belong to this scope entry');
 }
}
export function readVillaDocument(store,id){
 check(UUID.test(id),'Invalid document identifier');
 const file=store.read(key(id));check(file,'PDF not found',404);
 const entry=store.read('villa-scopes:entry:'+file.entryId);
 const url='/villa-scopes/documents/'+id;
 check(entry&&!entry.deleted&&[entry.record.VillaPDFURL,entry.record.ScopePDFURL,...entry.record.pos.map(p=>p.DocumentURL)].includes(url),'This PDF is no longer attached to the register',404);
 let data='';for(let i=0;i<file.chunks;i++){const chunk=store.read(key(id)+':'+i);check(typeof chunk==='string','PDF is unavailable',503);data+=chunk;}
 return {status:200,body:{ok:true,file:{id:file.id,name:file.name,size:file.size,data}}};
}
export async function uploadVillaDocument(store,body,actor){
 check(villaScopeAccess(actor).canManage,'Manage villa scopes access required',403);
 check(typeof body.id==='string'&&UUID.test(body.id),'Invalid document identifier');
 check(typeof body.entryId==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(body.entryId),'Invalid scope entry');
 check(['villa','scope','po'].includes(body.kind),'Choose the document destination');
 check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>0,'Save the scope entry before uploading a PDF');
 check(typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=200&&!/[\u0000-\u001f\u007f]/.test(body.name)&&/\.pdf$/i.test(body.name),'Choose a PDF file');
 check(typeof body.data==='string'&&body.data.length>0&&body.data.length<=4*Math.ceil(MAX_FILE/3)&&body.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(body.data),'Choose a PDF up to 5 MB',413);
 const decoded=atob(body.data);check(decoded.length<=MAX_FILE&&decoded.startsWith('%PDF-')&&decoded.slice(-2048).includes('%%EOF'),'The selected file is not a valid PDF or exceeds 5 MB');
 const fingerprint=await digest(body.data);
 return mutateVillaScope(store,actor,body,{kind:'upload-pdf',id:body.id,entryId:body.entryId,destination:body.kind,system:body.system||'',poNumber:body.poNumber||'',name:body.name,dataHash:fingerprint,expectedRevision:body.expectedRevision},()=>{
  const saved=store.read('villa-scopes:entry:'+body.entryId);check(saved&&!saved.deleted,'Scope entry not found',404);
  check(saved.revision===body.expectedRevision,'This scope entry changed. Refresh and review before uploading.',409);
  check(!store.read(key(body.id)),'Document identifier already used',409);
  const count=store.read('villa-scopes:document-count',0);check(count<1000,'PDF storage is full (1,000 files). Contact your administrator.',413);
  const usage=store.read('villa-scopes:document-usage',0);check(usage+decoded.length<=MAX_TOTAL,'PDF storage is full (100 MB). Contact your administrator.',413);
  const record=structuredClone(saved.record),url='/villa-scopes/documents/'+body.id;
  if(body.kind==='po'){const po=record.pos.find(p=>p.POSystem===body.system&&p.PONumber===body.poNumber);check(po,'Save this PO reference before uploading its PDF');po.DocumentURL=url;}else record[body.kind==='villa'?'VillaPDFURL':'ScopePDFURL']=url;
  const entrySize=new TextEncoder().encode(JSON.stringify(record)).length;
  const index=store.read('villa-scopes:index');check(index,'Register not found',404);
  check(entrySize<=32768,'Scope entry exceeds 32 KB',413);
  check(Object.values(index.entries).reduce((n,v)=>n+v,0)-index.entries[body.entryId]+entrySize<=4*1024*1024,'Register data exceeds 4 MB',413);
  const now=new Date().toISOString(),revision=saved.revision+1;
  const file={id:body.id,entryId:body.entryId,name:body.name.trim().replace(/[\\/]/g,'_'),size:decoded.length,chunks:Math.ceil(body.data.length/CHUNK),sha256:fingerprint,uploadedAt:now,uploadedBy:actor.username};
  for(let i=0;i<file.chunks;i++)store.write(key(body.id)+':'+i,body.data.slice(i*CHUNK,(i+1)*CHUNK));
  store.write(key(body.id),file);store.write('villa-scopes:document-count',count+1);store.write('villa-scopes:document-usage',usage+file.size);
  store.write('villa-scopes:entry:'+body.entryId,{...saved,record,revision,updatedAt:now,updatedBy:actor.username});index.entries[body.entryId]=entrySize;index.revision++;store.write('villa-scopes:index',index);
  store.audit(actor.username,'villa-scope-pdf-uploaded',{id:body.id,entryId:body.entryId,name:file.name,size:file.size});
  return {revision:index.revision,entry:{...record,_revision:revision,_updatedAt:now,_updatedBy:actor.username},document:{id:file.id,name:file.name,url,size:file.size}};
 });
}
