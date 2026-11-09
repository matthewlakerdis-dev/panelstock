let walkUploads=[],walkUploadRevision=0,walkUploadLoaded='',walkUploadStorageError='',walkUploadPersisting=Promise.resolve(),walkCaptureSettled=Promise.resolve();
const walkUploadMemory=new Map();let walkRecoveryDrafts=[];
function walkHasUploads(){return walkUploads.length>0||!!walkUploadPending}
function walkUploadOwner(){return actor?.username+':'+walkRecord?.id}
function resetWalkUploads(){walkRecoveryDrafts=[];if(walkHasUploads()&&walkUploadStorageError&&walkRecord?.createdBy===actor?.username)walkUploadMemory.set(walkUploadOwner(),walkUploadSnapshot());walkUploads=[];walkUploadRevision=0;walkUploadLoaded='';walkUploadStorageError='';walkUploadPersisting=Promise.resolve()}
function walkUploadSnapshot(){return {uploads:structuredClone(walkUploads),uploadPending:structuredClone(walkUploadPending),record:structuredClone(walkRecord),version:walkEditVersion,dirty:walkDirty,pending:structuredClone(walkPending),finish:structuredClone(walkFinishPending)}}
async function restoreWalkUploads(restoreDraft=false){
 const owner=walkUploadOwner(),username=actor?.username,id=walkRecord?.id,generation=walkGeneration;
 if(!username||!id||walkUploadLoaded===owner)return;
 let stored;try{stored=await auditUploadStore.read(username,id);}catch(error){if(owner===walkUploadOwner()&&generation===walkGeneration)applyWalkUploadRecovery(walkUploadMemory.get(owner),restoreDraft);throw error;}
 if(owner!==walkUploadOwner()||generation!==walkGeneration)return;
 walkUploadLoaded=owner;walkUploadRevision=stored?.revision||0;walkUploadStorageError='';
 applyWalkUploadRecovery(stored?.value,restoreDraft);const memory=walkUploadMemory.get(owner);applyWalkUploadRecovery(memory,restoreDraft);if(memory&&walkHasUploads())walkUploadStorageError='Some files are held in memory only. Retry saving them before leaving this screen.';
}
function applyWalkUploadRecovery(value,restoreDraft){
 if(!value||value.record?.id!==walkRecord?.id||value.record?.createdBy!==actor?.username)return;
 walkUploads=[...new Map([...(value.uploads||[]),...walkUploads].map(file=>[file.id,file])).values()];walkUploadPending=walkUploadPending||value.uploadPending||null;
 if(restoreDraft&&walkHasUploads()&&!walkRecord.archived&&walkRecord.status==='Draft'&&(value.version||0)>=walkEditVersion){walkRecord=value.record;walkEditVersion=value.version||0;walkDirty=!!value.dirty;walkPending=value.pending||null;walkFinishPending=value.finish||null;}
 cacheWalk();
}
function persistWalkUploads(){
 const owner=walkUploadOwner(),username=actor?.username,id=walkRecord?.id,generation=walkGeneration;
 const save=async()=>{
  if(!username||!id||owner!==walkUploadOwner()||generation!==walkGeneration)return false;
  try{
   if(walkUploadLoaded!==owner)await restoreWalkUploads();
   if(owner!==walkUploadOwner()||generation!==walkGeneration)return false;
   const value=walkUploadSnapshot(),revision=walkUploadRevision;
   if(value.uploads.length||value.uploadPending){const next=await auditUploadStore.write(username,id,value,revision);if(owner===walkUploadOwner()&&generation===walkGeneration)walkUploadRevision=next;}
   else if(revision){const next=await auditUploadStore.remove(username,id,revision);if(owner===walkUploadOwner()&&generation===walkGeneration)walkUploadRevision=next;}
   if(owner!==walkUploadOwner()||generation!==walkGeneration)return false;
   walkUploadStorageError='';walkUploadMemory.delete(owner);cacheWalk();return true;
  }catch(error){if(owner===walkUploadOwner()&&generation===walkGeneration){walkUploadStorageError=error.message;cacheWalk();}throw error;}
 };
 const result=walkUploadPersisting.catch(()=>{}).then(save);walkUploadPersisting=result;return result;
}
async function walkRequest(path,body){
 const controller=typeof AbortController==='function'?new AbortController():null;let timer;
 try{return await Promise.race([api(path,body,{signal:controller?.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(Error('Connection timed out. Your pending files are kept for retry.'));},20000)})]);}
 finally{clearTimeout(timer)}
}
function walkPendingFiles(ref,actionId=''){return walkUploads.filter(f=>f.ref===ref&&(f.actionId||'')===actionId)}
function walkUploadStatusHTML(){
 if(!walkHasUploads()&&!walkUploadStorageError)return '';
 const count=walkUploads.length;
 return `<div class="notice"><strong>${count?count+' '+(count===1?'file':'files')+' waiting to upload':'An evidence change is waiting to sync'}</strong><p>${walkUploadStorageError?'Not saved on this device: '+esc(walkUploadStorageError)+' Keep this screen open and download the pending files.':'Files are saved on this device. They will retry when a connection is available and this audit is open.'}</p><div class="row"><button onclick="retryWalkUpload()">Retry uploads</button>${count?'<button onclick="downloadPendingWalkFiles()">Download pending files</button>':''}</div></div>`;
}
function walkPendingFilesHTML(ref,actionId=''){
 const files=walkPendingFiles(ref,actionId);
 return files.length?`<ul class="walk-evidence-list">${files.map(f=>`<li data-pending-audit-file="${esc(f.id)}">${walkPhotoThumbnail(f,'','download',true)}<div class="walk-evidence-file"><strong>${esc(f.fileName)}</strong><span>${f.error?esc(f.error):walkUploadStorageError?'Not saved on device':'Saved on device · Waiting to upload'}</span></div><div class="walk-evidence-actions"><button onclick="downloadPendingWalkFile('${esc(f.id)}')">Download photo / file</button>${walkUploadPending?.queueId===f.id?'':`<button class="danger" onclick="removePendingWalkFile('${esc(f.id)}')">Remove pending file</button>`}</div></li>`).join('')}</ul>`:'';
}
function downloadPendingWalkFile(id){const file=walkUploads.find(f=>f.id===id);if(file)download(file.fileName,Uint8Array.from(atob(file.data),c=>c.charCodeAt(0)),file.mime)}
function downloadPendingWalkFiles(){for(const file of walkUploads)downloadPendingWalkFile(file.id)}
async function removePendingWalkFile(id){
 if(busy||walkSaving||walkUploadPending?.queueId===id)return;
 const file=walkUploads.find(f=>f.id===id);if(!file)return;
 const owner=walkUploadOwner(),generation=walkGeneration,previous=walkUploads;
 busy=true;walkUploads=walkUploads.filter(f=>f.id!==id);
 try{await persistWalkUploads();}
 catch(error){if(owner===walkUploadOwner()&&generation===walkGeneration){walkUploads=previous;notify(error.message);}}
 finally{busy=false;if(owner===walkUploadOwner()&&generation===walkGeneration){cacheWalk();if(page==='walks')view('walks');}}
}
function refreshWalkUploadStatus(){
 const element=document.getElementById('walk-upload-status');if(element)element.innerHTML=walkUploadStatusHTML();
 if(!walkRecord||page!=='walks'||auditRegister)return;
 const editable=!walkRecord.archived&&walkRecord.status==='Draft'&&walkRecord.createdBy===actor?.username&&!walkFinishPending;
 for(const answer of walkRecord.answers){
  const files=walkRecord.evidence.filter(f=>f.ref===answer.ref&&!f.actionId),count=files.length+walkPendingFiles(answer.ref).length;
  const list=document.getElementById('walk-evidence-list-'+answer.ref);if(list)list.innerHTML=walkEvidenceList(files,editable)+walkPendingFilesHTML(answer.ref);
  const label=document.getElementById('walk-evidence-count-'+answer.ref);if(label)label.textContent=count+' / 5 files';
  const input=document.getElementById('walk-files-'+answer.ref);if(input)input.disabled=!editable||count>=5;
 }
 for(const action of [...walkRecord.actions,...(walkRecord.carriedActions||[])]){
  const local=walkRecord.evidence.filter(f=>f.actionId===action.id),files=[...(action.photos||[]).filter(f=>walkPhotoSource(f)==='audit'),...local],count=files.length+walkPendingFiles(action.ref,action.id).length;
  const list=document.getElementById('walk-action-photo-list-'+action.id);if(list)list.innerHTML=walkActionPhotoList(action,files,local,editable)+walkPendingFilesHTML(action.ref,action.id);
  const label=document.getElementById('walk-action-photo-count-'+action.id);if(label)label.textContent=count+' / 5 photos';
  const input=document.getElementById('walk-action-photos-'+action.id);if(input)input.disabled=!editable||count>=5;
 }
 refreshWalkPhotoThumbnails();
}
async function retryWalkUploadsWhenOnline(){
 if(!actor?.canRunToolbox||!walkRecord||walkRecord.status!=='Draft'||walkRecord.createdBy!==actor.username||busy||walkSaving||walkFinishPending||typeof navigator!=='undefined'&&navigator.onLine===false||document.hidden)return;
 if(walkHasUploads()||walkDirty||walkPending){await syncWalk();walkStatus();refreshWalkUploadStatus();}
}
window.addEventListener?.('online',()=>void retryWalkUploadsWhenOnline());
window.addEventListener?.('focus',()=>void retryWalkUploadsWhenOnline());
document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)void retryWalkUploadsWhenOnline()});

if(typeof setInterval==='function')setInterval(()=>void retryWalkUploadsWhenOnline(),30000);

async function refreshWalkRecoveryDrafts(){
 const username=actor?.username,generation=walkGeneration;if(!username)return;let rows=[];
 try{rows=await auditUploadStore.list(username);}catch{}
 for(const [owner,value] of walkUploadMemory)if(owner===username+':'+value.record.id&&!rows.some(v=>v.id===value.record.id))rows.push({id:value.record.id,documentNo:value.record.documentNo,area:value.record.area,date:value.record.date});
 if(actor?.username===username&&generation===walkGeneration)walkRecoveryDrafts=rows;
}
