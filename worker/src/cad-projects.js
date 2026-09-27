// Transactional metadata references private, immutable R2 file chunks.
export const PROJECT_LIMIT=100*1024*1024,CHUNK_LIMIT=1024*1024;
const META_LIMIT=2*1024*1024,DAY=86400000,HASH=/^[a-f0-9]{64}$/;
const reply=(body,status=200)=>({body,status});
const conflict=()=>reply({error:'This project was updated on another device.',conflict:true},409);
const bytes=value=>new TextEncoder().encode(value);
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');}
function encode(value){let binary='';for(let i=0;i<value.length;i+=32768)binary+=String.fromCharCode(...value.subarray(i,i+32768));return btoa(binary);}
export function inspectManifest(manifest){
 const text=JSON.stringify(manifest),project=manifest?.project;
 if(!text||bytes(text).length>META_LIMIT||manifest.format!=='panelstock-cloud-project'||manifest.version!==2||typeof project?.name!=='string'||project.name.length>100||!Array.isArray(project.panels)||!project.panels.length||project.panels.length>30)throw Error('Invalid project details.');
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
 for(const panel of project.panels){
  if(!panel||typeof panel!=='object'||Array.isArray(panel)||!Number.isInteger(panel.quantity)||panel.quantity<1||panel.quantity>9999)throw Error('Invalid panel details.');
  if(panel.file){if(typeof panel.file.name!=='string'||!['image/png','image/jpeg','application/pdf'].includes(panel.file.type)||panel.file.asset?.size>25*1024*1024)throw Error('Invalid sketch.');asset(panel.file.asset);}
  if(panel.result)asset(panel.result);
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
 const match=path.match(/^\/cad\/projects\/([a-zA-Z0-9-]{16,100})(?:\/(prepare|commit|chunks|upload|rename|delete)(?:\/([a-f0-9-]{36}|[a-f0-9]{64}))?(?:\/([a-f0-9]{64}))?)?$/);
 if(!match)return reply({error:'Invalid project address'},400);
 const [,id,action,part,hash]=match,key=prefix+id,bucket=store.env?.CAD_PROJECT_FILES,current=store.read(key);
 if(current?.deleted)return action==='prepare'?conflict():reply({error:'Project not found'},404);
 if(['rename','delete'].includes(action)&&method==='POST')return store.ctx.storage.transactionSync(()=>{
  const state=store.read(key);if(!state?.revision||state.deleted)return reply({error:'Project not found'},404);
  if(body.revision!==state.revision)return conflict();
  if(action==='rename'){
   if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100)return reply({error:'Enter a project name of 1 to 100 characters.'},400);
   const name=body.name.trim();
   if(state.manifest)state.manifest.project.name=name;else{const legacy=JSON.parse(state.project);legacy.project.name=name;state.project=JSON.stringify(legacy);}
   state.revision++;state.updatedAt=Date.now();store.write(key,state);
   store.write(indexKey,store.read(indexKey,[]).map(p=>p.projectId===id?{...p,name,revision:state.revision,updatedAt:state.updatedAt}:p));
  }else{
   state.deleted=true;state.revision++;state.updatedAt=Date.now();
   state.garbage||=[];state.garbage.push(...[...Object.values(state.files||{}),...Object.values(state.uploads||{}).flatMap(u=>[...Object.values(u.files).filter(f=>f.owned),...Object.values(u.staged||{})])].map(f=>({key:f.key,after:Date.now()+DAY})));
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
   state.uploads[uploadId]={manifest:body.manifest,revision,clientId:body.clientId||null,chunks:inspected.chunks,size:inspected.size,files,expiresAt:Date.now()+DAY};store.write(key,state);
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
  const keep=new Set(Object.values(upload.files).map(f=>f.key));
  state.garbage.push(...Object.values(state.files||{}).filter(f=>!keep.has(f.key)).map(f=>({key:f.key,after:Date.now()+DAY})));
  state.files=upload.files;state.manifest=upload.manifest;state.revision=(state.revision||0)+1;state.updatedAt=Date.now();state.lastUploadId=body.uploadId;delete state.project;delete state.uploads[body.uploadId];
  store.write(key,state);store.write(indexKey,[{projectId:id,name:upload.manifest.project.name,panelCount:upload.manifest.project.panels.length,updatedAt:state.updatedAt,revision:state.revision,size:upload.size},...store.read(indexKey,[]).filter(p=>p.projectId!==id)]);
  return reply({ok:true,revision:state.revision,updatedAt:state.updatedAt});
 });
 return reply({error:'Not found'},404);
}
