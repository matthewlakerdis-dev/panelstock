// Photos use authenticated evidence endpoints and embedded image sources, which
// work with both current and already-open Safety page security policies. Only
// small thumbnails stay cached; full-size sources are cleared when previews close.
let walkPhotoScope='',walkPhotoEpoch=0,walkPhotoObserver=null,walkPhotoObserved=new WeakSet(),walkPhotoQueue=[],walkPhotoActive=0,walkPhotoDialog=null,walkPhotoPreviewUrl='',walkPhotoPreviewRequest=0;
const walkPhotoThumbs=new Map();
function walkPhotoThumbnail(file,path='',operation='download',pending=false){
 if(!/^image\/(jpeg|png|webp|gif|avif)$/i.test(file.mime||''))return '';
 return `<button type="button" class="walk-photo-thumb" data-walk-photo data-file-id="${esc(file.id)}" data-file-name="${esc(file.fileName)}" data-photo-path="${esc(path)}" data-photo-operation="${esc(operation)}" data-photo-pending="${pending?'true':'false'}" onclick="openWalkPhoto(this)" aria-label="Preview photo ${esc(file.fileName)}"><span>Photo</span></button>`;
}
function walkPhotoContext(){return actor&&page==='walks'?JSON.stringify([actor.username,walkRecord?.id,auditRegister,auditAction?.originAuditId,auditAction?.originActionId]):''}
function clearWalkPhotos(){
 walkPhotoEpoch++;walkPhotoScope='';walkPhotoObserver?.disconnect();walkPhotoObserver=null;walkPhotoObserved=new WeakSet();walkPhotoQueue=[];
 closeWalkPhoto();walkPhotoThumbs.clear();
}
function walkPhotoDescriptor(button){return {id:button.dataset.fileId,fileName:button.dataset.fileName,path:button.dataset.photoPath,operation:button.dataset.photoOperation,pending:button.dataset.photoPending==='true'}}
async function walkPhotoData(photo){
 const file=photo.pending?walkUploads.find(file=>file.id===photo.id):await api(photo.path,{[photo.operation==='download'?'action':'operation']:photo.operation,fileId:photo.id,mutationId:crypto.randomUUID()});
 if(!file||!/^image\/(jpeg|png|webp|gif|avif)$/i.test(file.mime||''))throw Error('This photo cannot be previewed. Use Download to open the original file.');
 if(typeof file.data!=='string'||!file.data.length)throw Error('The saved photo has no image data. Close this preview and try downloading the file.');
 return 'data:'+file.mime+';base64,'+file.data;
}
async function smallWalkPhoto(source){
 const image=new Image();
 try{
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Photo could not be displayed. Use Download to open the original file.'));image.src=source;});
  const scale=Math.min(1,160/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.8);
 }finally{image.removeAttribute('src');}
}
function refreshWalkPhotoThumbnails(){
 const scope=walkPhotoContext();if(scope!==walkPhotoScope){clearWalkPhotos();walkPhotoScope=scope;}if(!scope)return;
 if(!walkPhotoObserver&&typeof IntersectionObserver==='function')walkPhotoObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){walkPhotoObserver.unobserve(entry.target);walkPhotoQueue.push({button:entry.target,epoch:walkPhotoEpoch});}pumpWalkPhotos();},{rootMargin:'160px'});
 for(const button of document.querySelectorAll('[data-walk-photo]'))if(!walkPhotoObserved.has(button)){walkPhotoObserved.add(button);if(walkPhotoObserver)walkPhotoObserver.observe(button);else walkPhotoQueue.push({button,epoch:walkPhotoEpoch});}
 pumpWalkPhotos();
}
function pumpWalkPhotos(){while(walkPhotoActive<2&&walkPhotoQueue.length){const item=walkPhotoQueue.shift();if(item.epoch!==walkPhotoEpoch||!item.button.isConnected)continue;walkPhotoActive++;loadWalkPhotoThumbnail(item).finally(()=>{walkPhotoActive--;pumpWalkPhotos();});}}
async function loadWalkPhotoThumbnail({button,epoch}){
 const photo=walkPhotoDescriptor(button),key=JSON.stringify([photo.pending,photo.path,photo.id]);
 let entry=walkPhotoThumbs.get(key);
 if(!entry){entry={};entry.ready=(async()=>{const url=await smallWalkPhoto(await walkPhotoData(photo));if(epoch!==walkPhotoEpoch)return '';entry.url=url;return url;})();walkPhotoThumbs.set(key,entry);}
 try{const url=await entry.ready;if(!url||epoch!==walkPhotoEpoch||!button.isConnected)return;const image=document.createElement('img');image.src=url;image.alt=photo.fileName;image.width=80;image.height=64;button.replaceChildren(image);}
 catch(error){if(walkPhotoThumbs.get(key)===entry)walkPhotoThumbs.delete(key);if(epoch===walkPhotoEpoch&&button.isConnected){button.textContent='Tap to preview';button.title=error.message;}}
}
function closeWalkPhoto(){walkPhotoPreviewRequest++;if(walkPhotoDialog){const dialog=walkPhotoDialog;walkPhotoDialog=null;if(dialog.open)dialog.close();dialog.remove();}walkPhotoPreviewUrl='';}
async function openWalkPhoto(button){
 const photo=walkPhotoDescriptor(button),epoch=walkPhotoEpoch;closeWalkPhoto();const request=walkPhotoPreviewRequest;
 const dialog=document.createElement('dialog');walkPhotoDialog=dialog;dialog.className='walk-photo-dialog';dialog.setAttribute('aria-labelledby','walk-photo-preview-title');
 dialog.innerHTML=`<div class="walk-photo-toolbar"><h2 id="walk-photo-preview-title">${esc(photo.fileName)}</h2><button type="button" onclick="closeWalkPhoto()" aria-label="Close photo preview" autofocus>Close</button></div><div class="walk-photo-preview-body"><p role="status">Loading photo…</p></div>`;
 dialog.addEventListener('cancel',event=>{event.preventDefault();closeWalkPhoto();});dialog.addEventListener('close',()=>{if(walkPhotoDialog===dialog)closeWalkPhoto();});dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeWalkPhoto();}});
 document.body.append(dialog);dialog.showModal();
 try{
  const source=await walkPhotoData(photo);if(request!==walkPhotoPreviewRequest||epoch!==walkPhotoEpoch)return;
  const image=document.createElement('img');image.alt=photo.fileName;walkPhotoPreviewUrl=source;image.src=walkPhotoPreviewUrl;
  image.onerror=()=>{if(walkPhotoDialog===dialog)dialog.querySelector('.walk-photo-preview-body').textContent='Photo could not be displayed. Close this preview and use Download to open the original file.';};dialog.querySelector('.walk-photo-preview-body').replaceChildren(image);
 }catch(error){if(request===walkPhotoPreviewRequest&&walkPhotoDialog===dialog)dialog.querySelector('.walk-photo-preview-body').textContent=error.message;}
}
