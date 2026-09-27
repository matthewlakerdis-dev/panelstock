// Transactional metadata references private, immutable R2 file chunks.
import {archiveProject,historyFileKeys,readVersion,projectIndex,baseOrderName,orderKey} from './cad-history.js';
export const PROJECT_LIMIT=100*1024*1024,CHUNK_LIMIT=1024*1024;
const META_LIMIT=2*1024*1024,DAY=86400000,HASH=/^[a-f0-9]{64}$/;
const reply=(body,status=200)=>({body,status});
const conflict=()=>reply({error:'This project was updated on another device.',conflict:true},409);
const bytes=value=>new TextEncoder().encode(value);
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');}
function encode(value){let binary='';for(let i=0;i<value.length;i+=32768)binary+=String.fromCharCode(...value.subarray(i,i+32768));return btoa(binary);}
export function inspectManifest(manifest){
 const text=JSON.stringify(manifest),project=manifest?.project;
 if(!text||bytes(text).length>META_LIMIT||manifest.format!=='panelstock-cloud-project'||![2,3].includes(manifest.version)||typeof project?.name!=='string'||project.name.length>100||!Array.isArray(project.panels)||project.panels.length>30)throw Error('Invalid project details.');
 const chunks={};let size=bytes(text).length,count=0;
 function asset(value){
  if(!value||!Number.isSafeInteger(value.size)||value.size<0||!Array.isArray(value.chunks)||value.chunks.length>101)throw Error('Invalid project file.');
  let total=0;
  for(const chunk of value.chunks){
   if(!HASH.test(chunk?.hash)||!Number.isInteger(chunk.size)||chunk.size<1||chunk.size>CHUNK_LIMIT||++count>512)throw Error('Invalid project file chunk.');
   if(chunks[chunk.hash]&&chunks[chunk.hash]!==chunk.size)throw Error('Conflicting file sizes.');
   chunks[chunk.hash]=chunk.size;total+=chunk.size;
  }
  if(total!==value.size)throw Error('Invalid project file size.');size+=total;
 }
 if(project.pdfSources!==undefined&&(!Array.isArray(project.pdfSources)||project.pdfSources.length>30||manifest.version!==3))throw Error('Invalid original PDFs.');
 for(const file of project.pdfSources||[]){if(typeof file?.name!=='string'||!['application/pdf','image/png','image/jpeg'].includes(file.type)||!file.asset||file.asset.size>25*1024*1024)throw Error('Invalid original PDF.');asset(file.asset);}
 for(const panel of project.panels){
  if(!panel||typeof panel!=='object'||Array.isArray(panel)||!Number.isInteger(panel.quantity)||panel.quantity<1||panel.quantity>9999)throw Error('Invalid panel details.');
  if(panel.file){if(typeof panel.file.name!=='string'||!['image/png','image/jpeg','application/pdf'].includes(panel.file.type)||panel.file.asset?.size>25*1024*1024)throw Error('Invalid sketch.');asset(panel.file.asset);}
  if(panel.result)asset(panel.result);
  if(panel.sourcePdf!==undefined&&panel.sourcePdf!==null&&(!Number.isInteger(panel.sourcePdf)||panel.sourcePdf<0||panel.sourcePdf>=(project.pdfSources||[]).length))throw Error('Invalid original PDF reference.');
 }
 if(size>PROJECT_LIMIT)throw Error('Account projects must be 100 MB or smaller. Your browser copy is retained.');
 return {chunks,size,text};
}

// Collect retired files during later saves, after a grace period for open readers.
// Unique upload paths prevent a later save from reusing a deleted object key.
async function collect(store,key,bucket){
 const state=store.read(key,{uploads:{},garbage:[]}),now=Date.now();state.uploads||={};state.garbage||=[];
 for(const [id,upload] of Object.entries(state.uploads))if(upload.expiresAt<now){
  state.garbage.push(...[...Object.values(upload.files).filter(f=>f.owned),...Object.values(upload.staged||{})].map(f=>({key:f.key,after:now-1})));delete state.uploads[id];
 }
 const protectedKeys=new Set([...Object.values(state.files||{}),...Object.values(state.uploads).flatMap(u=>Object.values(u.files))].map(f=>f.key));
 for(const key of historyFileKeys(state))protectedKeys.add(key);
 let alias=state;for(let i=0;alias.mergedInto&&i<100;i++){alias=store.read(key.slice(0,key.lastIndexOf(':')+1)+alias.mergedInto,{});for(const f of Object.values(alias.files||{}))protectedKeys.add(f.key);for(const k of historyFileKeys(alias))protectedKeys.add(k);}
 const remove=[...new Set(state.garbage.filter(f=>f.after<now&&!protectedKeys.has(f.key)).map(f=>f.key))];
 state.garbage=state.garbage.filter(f=>!remove.includes(f.key));store.write(key,state);
 if(remove.length)try{for(let i=0;i<remove.length;i+=1000)await bucket.delete(remove.slice(i,i+1000));}catch{
  const latest=store.read(key);latest.garbage.push(...remove.map(key=>({key,after:now})));store.write(key,latest);
 }
}

export async function handleCadProjects(store,path,method,body,actor){
 if(!actor.isAdmin&&actor.tasks?.['factory.cnc']!==true)return reply({error:'Factory CNC access required'},403);
 const prefix='cad-projects:'+encodeURIComponent(actor.username)+':',indexKey=prefix+'index';
 if(path==='/cad/projects'&&method==='GET'){
  if(store.env?.CAD_PROJECT_FILES){const trashKey=prefix+'trash';for(const id of store.read(trashKey,[]))await collect(store,prefix+id,store.env.CAD_PROJECT_FILES);store.write(trashKey,store.read(trashKey,[]).filter(id=>store.read(prefix+id)?.garbage?.length));}
  return reply({ok:true,projects:store.read(indexKey,[]).filter(p=>p.revision>0)});
 }
 const match=path.match(/^\/cad\/projects\/([a-zA-Z0-9-]{16,100})(?:\/(prepare|commit|chunks|upload|rename|delete|versions|restore|merge)(?:\/([a-f0-9-]{36}|[a-f0-9]{64}))?(?:\/([a-f0-9]{64}))?)?$/);
 if(!match)return reply({error:'Invalid project address'},400);
 const [,id,action,part,hash]=match,key=prefix+id,bucket=store.env?.CAD_PROJECT_FILES,current=store.read(key);
 if(current?.mergedInto)return reply({error:'This copy has been combined into its order project.',conflict:true,mergedInto:current.mergedInto},409);
 if(current?.deleted)return action==='prepare'?conflict():reply({error:'Project not found'},404);
 if(action==='merge'&&method==='POST')return store.ctx.storage.transactionSync(()=>{
  const target=store.read(key);if(!target?.revision||target.revision!==body.revision)return conflict();
  if(!Array.isArray(body.sources)||body.sources.length>99)return reply({error:'Invalid order copies'},400);
  const targetName=projectIndex(id,target).name,group=orderKey(targetName);
  if(!group||group==='untitled project')return reply({error:'Name the order before combining its copies.'},400);
  const sources=[],seen=new Set([id]);
  for(const item of body.sources){
   if(!/^[a-zA-Z0-9-]{16,100}$/.test(item?.projectId)||seen.has(item.projectId))return reply({error:'Invalid order copies'},400);seen.add(item.projectId);
   const source=store.read(prefix+item.projectId);
   if(!source?.revision||source.deleted||source.mergedInto||source.revision!==item.revision)return conflict();
   if(orderKey(projectIndex(item.projectId,source).name)!==group)return reply({error:'Only copies of the same named order can be combined.'},400);
   if(source.updatedAt>target.updatedAt)return reply({error:'Choose the newest copy as the current project.',conflict:true},409);
   sources.push([item.projectId,source]);
  }
  for(const [sourceId,source] of sources){
   for(const v of source.history||[]){store.write(key+':version:'+v.id,readVersion(store,prefix+sourceId,source,v.id));target.history=[{...v,pinned:true},...(target.history||[])];}
   const imported={...source,history:target.history||[],garbage:target.garbage||[]};archiveProject(store,key,imported,'Combined copy: '+projectIndex(sourceId,source).name,true);target.history=imported.history;
   source.garbage||=[];source.garbage.push(...Object.values(source.uploads||{}).flatMap(u=>Object.values(u.staged||{})).map(f=>({key:f.key,after:Date.now()+DAY})));
   source.files={};source.history=[];source.uploads={};source.mergedInto=id;delete source.manifest;delete source.project;store.write(prefix+sourceId,source);
   store.write(prefix+'trash',[...new Set([...store.read(prefix+'trash',[]),sourceId])]);
  }
  if(target.manifest)target.manifest.project.name=baseOrderName(targetName);else{const parsed=JSON.parse(target.project);parsed.project.name=baseOrderName(targetName);target.project=JSON.stringify(parsed);}
  target.revision++;delete target.lastUploadId;store.write(key,target);
  store.write(indexKey,[projectIndex(id,target),...store.read(indexKey,[]).filter(p=>!seen.has(p.projectId))]);
  return reply({ok:true,...projectIndex(id,target)});
 });
 if(action==='versions'&&method==='GET'){
  if(!current?.revision)return reply({error:'Project not found'},404);
  if(!part)return reply({ok:true,revision:current.revision,versions:[...(current.history||[])].sort((a,b)=>b.updatedAt-a.updatedAt).map(({fileKeys,...v})=>v)});
  const version=readVersion(store,key,current,part);if(!version)return reply({error:'Version not found'},404);
  if(!hash)return reply({ok:true,...version});
  if(!bucket)return reply({error:'Account file storage is unavailable'},503);
  const file=version.files[hash],object=file?await bucket.get(file.key):null;if(!object)return reply({error:'Version file is unavailable'},404);
  return reply({ok:true,data:encode(new Uint8Array(await object.arrayBuffer()))});
 }
 if(action==='restore'&&method==='POST')return store.ctx.storage.transactionSync(()=>{
  const state=store.read(key);if(!state?.revision)return reply({error:'Project not found'},404);
  if(state.revision!==body.revision)return conflict();
  const previous=readVersion(store,key,state,body.versionId);if(!previous)return reply({error:'Version not found'},404);
  const name=projectIndex(id,state).name;archiveProject(store,key,state,'Before restoring a version');
  state.files=previous.files;state.manifest=previous.manifest;state.project=previous.project;
  if(state.manifest)state.manifest.project.name=name;else{const parsed=JSON.parse(state.project);parsed.project.name=name;state.project=JSON.stringify(parsed);}
  state.revision++;state.updatedAt=Date.now();delete state.importId;delete state.lastUploadId;store.write(key,state);
  store.write(indexKey,[projectIndex(id,state),...store.read(indexKey,[]).filter(p=>p.projectId!==id)]);
  return reply({ok:true,revision:state.revision,updatedAt:state.updatedAt});
 });
 if(['rename','delete'].includes(action)&&method==='POST')return store.ctx.storage.transactionSync(()=>{
  const state=store.read(key);if(!state?.revision||state.deleted)return reply({error:'Project not found'},404);
  if(body.revision!==state.revision)return conflict();
  if(action==='rename'){
   if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100)return reply({error:'Enter a project name of 1 to 100 characters.'},400);
   const name=body.name.trim();
   archiveProject(store,key,state,'Before renaming');
   if(state.manifest)state.manifest.project.name=name;else{const legacy=JSON.parse(state.project);legacy.project.name=name;state.project=JSON.stringify(legacy);}
   state.revision++;state.updatedAt=Date.now();store.write(key,state);
   store.write(indexKey,store.read(indexKey,[]).map(p=>p.projectId===id?{...p,name,revision:state.revision,updatedAt:state.updatedAt}:p));
  }else{
   state.deleted=true;state.revision++;state.updatedAt=Date.now();
   state.garbage||=[];state.garbage.push(...[...Object.values(state.files||{}),...Object.values(state.uploads||{}).flatMap(u=>[...Object.values(u.files).filter(f=>f.owned),...Object.values(u.staged||{})])].map(f=>({key:f.key,after:Date.now()+DAY})));
   state.garbage.push(...historyFileKeys(state).map(key=>({key,after:Date.now()+DAY})));
   for(const v of state.history||[])store.write(key+':version:'+v.id,null);state.history=[];
   state.files={};state.uploads={};delete state.manifest;delete state.project;store.write(key,state);
   store.write(indexKey,store.read(indexKey,[]).filter(p=>p.projectId!==id));
   store.write(prefix+'trash',[...new Set([...store.read(prefix+'trash',[]),id])]);
  }
  return reply({ok:true,revision:state.revision,updatedAt:state.updatedAt});
 });
 if(!action&&method==='GET'){
  if(!current?.revision)return reply({error:'Project not found'},404);
  return reply({ok:true,revision:current.revision,updatedAt:current.updatedAt,...(current.manifest?{manifest:current.manifest}:{project:current.project})});
 }
 if(!bucket)return reply({error:'Account file storage is not configured. Your browser copy is retained.'},503);
 if(action==='chunks'&&method==='GET'&&HASH.test(part)){
  const file=current?.files?.[part];if(!file)return reply({error:'The project changed while opening. Open it again to load the latest save.'},409);
  const object=await bucket.get(file.key);if(!object)return reply({error:'A saved project file is unavailable. Your current workspace has not been changed.'},503);
  return reply({ok:true,data:encode(new Uint8Array(await object.arrayBuffer()))});
 }
 if(method!=='POST')return reply({error:'Not found'},404);
 if(action==='prepare'){
  let inspected;try{inspected=inspectManifest(body.manifest);}catch(error){return reply({error:error.message},400);}
  if(!Number.isInteger(body.revision)||body.revision<0)return reply({error:'Invalid project revision'},400);
  await collect(store,key,bucket);
  return store.ctx.storage.transactionSync(()=>{
   const state=store.read(key),revision=state.revision||0;
   if(state.deleted)return conflict();
   if(state.mergedInto)return conflict();
   if(body.importId&&(!HASH.test(body.importId)||!Number.isFinite(body.sourceUpdatedAt)))return reply({error:'Invalid version import'},400);
   if(body.importId&&(state.importId===body.importId||state.history?.some(v=>v.importId===body.importId)))return reply({ok:true,saved:true,revision,updatedAt:state.updatedAt});
   if(state.manifest&&JSON.stringify(state.manifest)===inspected.text)return reply({ok:true,saved:true,revision,updatedAt:state.updatedAt});
   if(body.revision!==revision)return conflict();
   const projects=store.read(indexKey,[]);
   if(!projects.some(p=>p.projectId===id)&&projects.length>=100)return reply({error:'Your account has reached its 100 project limit.'},409);
   const old=Object.entries(state.uploads).find(([,u])=>u.revision===revision&&JSON.stringify(u.manifest)===inspected.text);
   if(old)return reply({ok:true,uploadId:old[0],missing:Object.keys(inspected.chunks).filter(h=>!old[1].files[h])});
   if(body.clientId!==undefined&&!/^[a-f0-9-]{36}$/.test(body.clientId))return reply({error:'Invalid save identifier'},400);
   for(const [oldId,u] of Object.entries(state.uploads))if(u.revision!==revision||(body.clientId&&u.clientId===body.clientId)){
    state.garbage.push(...[...Object.values(u.files).filter(f=>f.owned),...Object.values(u.staged||{})].map(f=>({key:f.key,after:Date.now()+DAY})));delete state.uploads[oldId];
   }
   if(Object.keys(state.uploads).length>=3)return reply({error:'There are unfinished saves for this project. Retry after they finish or expire.'},409);
   const uploadId=crypto.randomUUID(),files={};
   for(const [h,size] of Object.entries(inspected.chunks))if(state.files?.[h]?.size===size)files[h]={...state.files[h],owned:false};
   state.uploads[uploadId]={manifest:body.manifest,revision,clientId:body.clientId||null,importId:body.importId||null,sourceUpdatedAt:body.importId?Math.max(0,Math.min(Date.now(),body.sourceUpdatedAt)):null,chunks:inspected.chunks,size:inspected.size,files,expiresAt:Date.now()+DAY};store.write(key,state);
   if(!projects.some(p=>p.projectId===id))store.write(indexKey,[...projects,{projectId:id,revision:0}]);
   return reply({ok:true,uploadId,missing:Object.keys(inspected.chunks).filter(h=>!files[h])});
  });
 }
 if(action==='upload'&&hash){
  const upload=current?.uploads?.[part];
  if(!upload||upload.expiresAt<Date.now()||!upload.chunks[hash])return reply({error:'This save expired. Save the project again.'},409);
  if(upload.files[hash])return reply({ok:true});
  let value;try{if(typeof body.data!=='string'||body.data.length>4*Math.ceil(CHUNK_LIMIT/3))throw Error();value=Uint8Array.from(atob(body.data),c=>c.charCodeAt(0));}catch{return reply({error:'Invalid file data'},400);}
  if(value.length!==upload.chunks[hash]||await digest(value)!==hash)return reply({error:'File verification failed. Retry saving.'},400);
  const objectKey='projects/'+encodeURIComponent(actor.username)+'/'+id+'/'+part+'/'+hash;
  const before=store.read(key),active=before.uploads?.[part];if(!active)return reply({error:'This save expired. Save the project again.'},409);
  active.staged||={};active.staged[hash]={key:objectKey};store.write(key,before);
  await bucket.put(objectKey,value,{httpMetadata:{contentType:'application/octet-stream'}});
  const latest=store.read(key),pending=latest.uploads?.[part];
  if(!pending||pending.expiresAt<Date.now()){
   if(!Object.values(latest.files||{}).some(f=>f.key===objectKey)){latest.garbage.push({key:objectKey,after:Date.now()+DAY});store.write(key,latest);}
   return reply({error:'This save expired. Save the project again.'},409);
  }
  pending.files[hash]={key:objectKey,size:value.length,owned:true};store.write(key,latest);return reply({ok:true});
 }
 if(action==='commit')return store.ctx.storage.transactionSync(()=>{
  const state=store.read(key);
  if(state?.lastUploadId===body.uploadId&&body.uploadId)return reply({ok:true,revision:state.revision,updatedAt:state.updatedAt});
  const upload=state?.uploads?.[body.uploadId];if(!upload||upload.expiresAt<Date.now())return reply({error:'This save expired. Save the project again.'},409);
  if(upload.revision!==(state.revision||0))return conflict();
  if(Object.keys(upload.chunks).some(h=>!upload.files[h]))return reply({error:'Some project files have not finished uploading. Retry saving.'},409);
  if(upload.importId&&state.revision&&upload.sourceUpdatedAt<=state.updatedAt){
   const imported={manifest:upload.manifest,files:upload.files,revision:1,updatedAt:upload.sourceUpdatedAt,history:state.history||[],garbage:state.garbage||[]};
   const entry=archiveProject(store,key,imported,'Imported device copy',true);entry.importId=upload.importId;state.history=imported.history;
   state.revision++;state.lastUploadId=body.uploadId;delete state.uploads[body.uploadId];store.write(key,state);
   store.write(indexKey,[projectIndex(id,state),...store.read(indexKey,[]).filter(p=>p.projectId!==id)]);
   return reply({ok:true,revision:state.revision,updatedAt:state.updatedAt});
  }
  const keep=new Set(Object.values(upload.files).map(f=>f.key));
  archiveProject(store,key,state);
  state.garbage.push(...Object.values(state.files||{}).filter(f=>!keep.has(f.key)).map(f=>({key:f.key,after:Date.now()+DAY})));
  state.files=upload.files;state.manifest=upload.manifest;state.revision=(state.revision||0)+1;state.updatedAt=upload.importId?upload.sourceUpdatedAt:Date.now();state.importId=upload.importId;state.lastUploadId=body.uploadId;delete state.project;delete state.uploads[body.uploadId];
  store.write(key,state);store.write(indexKey,[{projectId:id,name:upload.manifest.project.name,panelCount:upload.manifest.project.panels.length,updatedAt:state.updatedAt,revision:state.revision,size:upload.size},...store.read(indexKey,[]).filter(p=>p.projectId!==id)]);
  return reply({ok:true,revision:state.revision,updatedAt:state.updatedAt});
 });
 return reply({error:'Not found'},404);
}
