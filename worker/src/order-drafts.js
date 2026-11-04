import {requireCondition as check} from './security.js';
const uuid=value=>/^[a-f0-9-]{36}$/i.test(value||'');
const MAX_FILE=5*1024*1024,MAX_TOTAL=25*1024*1024;
const ownerKey=actor=>'order-drafts:'+encodeURIComponent(actor.username);
const draftKey=(actor,id)=>ownerKey(actor)+':'+id;
const fileKey=(actor,id,file)=>'order-drafts/'+encodeURIComponent(actor.username)+'/'+id+'/'+file.id+'/'+file.sha256+(file.uploadId?'/share-'+file.uploadId:'');
const summary=d=>({id:d.id,project:d.order.project,orderType:d.order.orderType,itemCount:d.order.items.length,fileCount:d.attachments.length,updatedAt:d.updatedAt,createdAt:d.createdAt});
const stamp=previous=>new Date(Math.max(Date.now(),Date.parse(previous?.updatedAt||'')+1||0)).toISOString();
function cleanOrder(input={}){
 const text=(key,max)=>{check(input[key]==null||typeof input[key]==='string','Invalid draft field');return String(input[key]||'').slice(0,max);};
 const order={};
 for(const [key,max] of Object.entries({projectId:100,project:120,orderType:80,orderTypeOther:80,siteContact:100,phone:40,requestedDeliveryDate:10,requestedDeliveryTime:20,locationNotes:300}))order[key]=text(key,max);
 check(!order.requestedDeliveryDate||/^\d{4}-\d{2}-\d{2}$/.test(order.requestedDeliveryDate),'Invalid requested date');
 check(Array.isArray(input.items)&&input.items.length<=300,'A draft can have up to 300 items');
 order.items=input.items.map(item=>{check(item&&typeof item.description==='string'&&item.description.length<=180,'Invalid item description');check(['string','number'].includes(typeof item.quantity)&&String(item.quantity).length<=20,'Invalid item quantity');const description=item.description.toUpperCase();check(description.length<=180,'Invalid item description');return {quantity:item.quantity,description};});
 order.status='submitted';return order;
}
function readDraft(store,actor,id){check(uuid(id),'Invalid draft identifier');const d=store.read(draftKey(actor,id));check(d,'Draft not found',404);return d;}
function writeDraft(store,actor,draft){
 store.write(draftKey(actor,draft.id),draft);
 const list=store.read(ownerKey(actor),[]).filter(item=>item.id!==draft.id);
 store.write(ownerKey(actor),[summary(draft),...list]);return draft;
}
// A Shortcut creates a complete private draft in one commit. Keep a durable
// receipt so a lost response cannot recreate a submitted or discarded draft.
export async function importSharedDraft(store,actor,body,assertAccess){
 check(typeof body.id==='string'&&body.id.length>0&&body.id.length<=200&&!/[\u0000-\u001f\u007f]/.test(body.id),'Invalid share identifier');
 if(!uuid(body.id)){
  // Native Shortcuts can combine a formatted date and Random Number; it
  // does not need a third-party UUID action. Scope that retry key to its owner.
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(actor.username+'\0'+body.id))),v=>v.toString(16).padStart(2,'0')).join('');
  body={...body,id:hash.slice(0,8)+'-'+hash.slice(8,12)+'-8'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32)};
 }
 check(typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=200&&!/[\u0000-\u001f\u007f]/.test(body.name)&&/\.pdf$/i.test(body.name),'Export the Goodnotes file as a PDF');
 check(typeof body.data==='string'&&body.data.length<=4*Math.ceil(MAX_FILE/3)&&body.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(body.data),'Choose a PDF up to 5 MB');
 const bytes=Uint8Array.from(atob(body.data),c=>c.charCodeAt(0));
 check(bytes.length>=5&&bytes.length<=MAX_FILE,'Choose a PDF up to 5 MB');
 check(String.fromCharCode(...bytes.subarray(0,5))==='%PDF-','Export the Goodnotes file as a PDF');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 const file={id:body.id,name:body.name.trim().replace(/[\\/]/g,'_'),size:bytes.length,sha256,uploadId:crypto.randomUUID()};
 const receiptKey='order-share-import:'+encodeURIComponent(actor.username)+':'+body.id;
 const previous=()=>{const receipt=store.read(receiptKey);if(receipt)check(receipt.sha256===sha256&&receipt.name===file.name,'This share identifier already has a different file',409);return receipt;};
 assertAccess();
 if(previous())return {id:body.id};
 check(store.read(ownerKey(actor),[]).length<20,'You can save up to 20 drafts');
 check(!store.read(draftKey(actor,body.id)),'Draft identifier already in use',409);
 const bucket=store.env.CAD_PROJECT_FILES;check(bucket,'File storage is unavailable',503);
 store.consumeLimit('order-share-owner:'+actor.username,60,3600000);
 // Each upload attempt owns its object until commit. Never delete another
 // successful concurrent attempt's file during error cleanup.
 const key=fileKey(actor,body.id,file);
 try{
  await bucket.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});
  assertAccess();
  return store.ctx.storage.transactionSync(()=>{
   assertAccess();if(previous())return {id:body.id};
   check(store.read(ownerKey(actor),[]).length<20,'You can save up to 20 drafts');
   check(!store.read(draftKey(actor,body.id)),'Draft identifier already in use',409);
   const user=store.read('users',{})[actor.username]||{},now=stamp();
   const order=cleanOrder({items:[],siteContact:String(user.displayName||'').slice(0,100),phone:String(user.phone||'').slice(0,40)});
   writeDraft(store,actor,{id:body.id,createdAt:now,updatedAt:now,order,attachments:[file]});
   store.write(receiptKey,{id:body.id,name:file.name,sha256});
   store.audit(actor.username,'order-draft-shared',{draftId:body.id,fileId:file.id});
   return {id:body.id};
  });
 }finally{
  const current=store.read(draftKey(actor,body.id));
  if(!(current?.attachments||[]).some(item=>item.uploadId===file.uploadId))await bucket.delete(key).catch(()=>{});
 }
}
export async function handleOrderDrafts(store,path,method,body,actor){
 store.requireTask(actor,'site.orders.create');
 const match=path.match(/^\/order-drafts(?:\/([a-f0-9-]{36})(?:\/(?:files(?:\/([a-f0-9-]{36}))?|discard))?)?$/i);check(match,'Not found',404);
 const id=match[1],fileId=match[2],files=path.includes('/files');
 if(!id){check(method==='GET','Method not allowed',405);return {ok:true,drafts:store.read(ownerKey(actor),[])};}
 if(files){
  const draft=readDraft(store,actor,id),bucket=store.env.CAD_PROJECT_FILES;check(bucket,'File storage is unavailable',503);
  if(method==='GET'){
   const file=draft.attachments.find(item=>item.id===fileId);check(file,'Draft file not found',404);
   const object=await bucket.get(fileKey(actor,id,file));check(object,'Draft file is unavailable',404);check(object.size<=MAX_FILE,'File exceeds limit',413);
   const bytes=new Uint8Array(await object.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return {ok:true,file:{...file,data:btoa(binary)}};
  }
  check(method==='POST'&&!fileId,'Method not allowed',405);
  check(uuid(body.id)&&typeof body.name==='string'&&body.name.trim()&&body.name.length<=200&&!/[\u0000-\u001f\u007f]/.test(body.name),'Invalid filename');
  check(typeof body.data==='string'&&body.data.length<=4*Math.ceil(MAX_FILE/3)&&body.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(body.data),'Choose a file up to 5 MB');
  const bytes=Uint8Array.from(atob(body.data),c=>c.charCodeAt(0));check(bytes.length>0&&bytes.length<=MAX_FILE,'Choose a file up to 5 MB');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const file={id:body.id,name:body.name.trim().replace(/[\\/]/g,'_'),size:bytes.length,sha256};
  const validate=current=>{const existing=current.attachments.find(item=>item.id===file.id);if(existing){check(existing.sha256===sha256&&existing.name===file.name,'File identifier already in use',409);return existing;}check(current.attachments.length<10&&current.attachments.reduce((sum,f)=>sum+f.size,0)+file.size<=MAX_TOTAL,'Choose up to 10 files and 25 MB in total');return null;};
  if(validate(draft))return {ok:true,draft};
  check(body.expectedUpdatedAt===draft.updatedAt,'This draft changed. Reopen it before saving.',409);
  const key=fileKey(actor,id,file);await bucket.put(key,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
  try{return store.ctx.storage.transactionSync(()=>{const current=readDraft(store,actor,id);if(validate(current))return {ok:true,draft:current};check(body.expectedUpdatedAt===current.updatedAt,'This draft changed. Reopen it before saving.',409);return {ok:true,draft:writeDraft(store,actor,{...current,attachments:[...current.attachments,file],updatedAt:stamp(current)})};});}
  catch(error){const current=store.read(draftKey(actor,id));if(!current?.attachments.some(f=>f.id===file.id&&f.sha256===sha256))await bucket.delete(key);throw error;}
 }
 if(method==='GET')return {ok:true,draft:readDraft(store,actor,id)};
 if(path.endsWith('/discard')){
  check(method==='POST','Method not allowed',405);
  return store.ctx.storage.transactionSync(()=>{const draft=readDraft(store,actor,id);check(body.expectedUpdatedAt===draft.updatedAt,'This draft changed. Reopen it before deleting.',409);
   store.write(ownerKey(actor),store.read(ownerKey(actor),[]).filter(d=>d.id!==id));store.write(draftKey(actor,id),null);
   if(store.env.CAD_PROJECT_FILES&&draft.attachments.length)store.ctx.waitUntil(store.env.CAD_PROJECT_FILES.delete(draft.attachments.map(file=>fileKey(actor,id,file))).catch(()=>{}));
   return {ok:true};});
 }
 check(method==='POST','Method not allowed',405);
 const order=cleanOrder(body.order);check(Array.isArray(body.attachmentIds)&&body.attachmentIds.every(uuid),'Invalid draft files');
 return store.ctx.storage.transactionSync(()=>{const previous=store.read(draftKey(actor,id)),list=store.read(ownerKey(actor),[]);
  if(previous)check(body.expectedUpdatedAt===previous.updatedAt,'This draft changed. Reopen it before saving.',409);
  else{check(!body.expectedUpdatedAt,'Draft not found',404);check(list.length<20,'You can save up to 20 drafts');}
  const now=stamp(previous),draft={id,createdAt:previous?.createdAt||now,updatedAt:now,order,attachments:(previous?.attachments||[]).filter(file=>body.attachmentIds.includes(file.id))};
  const removed=(previous?.attachments||[]).filter(file=>!body.attachmentIds.includes(file.id));
  writeDraft(store,actor,draft);
  if(store.env.CAD_PROJECT_FILES&&removed.length)store.ctx.waitUntil(store.env.CAD_PROJECT_FILES.delete(removed.map(file=>fileKey(actor,id,file))).catch(()=>{}));
  return {ok:true,draft};});
}
