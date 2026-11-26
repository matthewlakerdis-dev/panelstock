import {decodeOrderFile} from './order-file-data.js';
import {requireCondition as check} from './security.js';
import {PDFDocument} from 'pdf-lib';
import {requireOrderFileAccess} from './order-file-access.js';
const MAX_FILE=10*1024*1024,MAX_TOTAL=25*1024*1024,MAX_COUNT=10;
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export async function orderAttachment(store,orderId,fileId,method,body,actor){
 store.requireTask(actor,'site.orders.view');
 const find=()=>{const orders=store.read('orders',[]),order=orders.find(item=>item.id===orderId);check(order,'Order not found',404);return {orders,order};};
 const canUpload=order=>requireOrderFileAccess(store,order,actor);
 let {order}=find();const bucket=store.env.CAD_PROJECT_FILES;check(bucket,'Order file storage is unavailable',503);
 if(method==='GET'){
  const file=(order.attachments||[]).find(item=>item.id===fileId);check(file,'Attachment not found',404);
  const object=await bucket.get('order-attachments/'+orderId+'/'+file.id+'/'+file.sha256);check(object,'Attachment is unavailable',404);
  check(object.size<=MAX_FILE,'Attachment exceeds the file limit',413);
  return {ok:true,file:{...file,data:encode(new Uint8Array(await object.arrayBuffer()))}};
 }
 check(method==='POST','Method not allowed',405);const pdfOnly=canUpload(order);
 check(/^[a-f0-9-]{36}$/i.test(body.id||''),'Invalid attachment identifier');
 check(typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=200&&!/[\u0000-\u001f\u007f]/.test(body.name),'Invalid filename');
 check(typeof body.data==='string'&&body.data.length<=4*Math.ceil(MAX_FILE/3)&&body.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(body.data),'Choose a file up to 10 MB');
 const bytes=decodeOrderFile(body.data);check(bytes.length>0&&bytes.length<=MAX_FILE,'Choose a file between 1 byte and 10 MB');
 if(pdfOnly){
  check(/\.pdf$/i.test(body.name.trim()),'Only PDF documents can be added to another team member’s Panel order',403);
  try{const pdf=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});check(!pdf.isEncrypted&&pdf.getPageCount()>0&&pdf.getPageCount()<200,'Choose an unencrypted PDF with 1–199 pages');}
  catch{check(false,'Choose a readable, unencrypted PDF document with 1–199 pages');}
 }
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 const file={id:body.id,name:body.name.trim().replace(/[\\/]/g,'_'),size:bytes.length,sha256,...(pdfOnly?{teamPanelPdf:true}:{}),uploadedBy:actor.username,uploadedAt:new Date().toISOString()};
 const validate=current=>{const files=current.attachments||[],existing=files.find(item=>item.id===file.id);if(existing){if(pdfOnly)check(existing.uploadedBy===actor.username&&existing.teamPanelPdf===true,'This attachment identifier belongs to another upload',409);check(existing.sha256===sha256&&existing.name===file.name,'Attachment identifier is already in use',409);return existing;}check(files.length<MAX_COUNT,'An order can have up to 10 attachments');check(files.reduce((sum,item)=>sum+item.size,0)+file.size<=MAX_TOTAL,'Attachments must total 25 MB or less');return null;};
 const existing=validate(order);if(existing)return {ok:true,attachment:existing,attachments:order.attachments};
 const key='order-attachments/'+orderId+'/'+file.id+'/'+sha256;
 await bucket.put(key,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
 try{return store.ctx.storage.transactionSync(()=>{const current=find();canUpload(current.order);const duplicate=validate(current.order);if(!duplicate){current.order.attachments=[...(current.order.attachments||[]),file];store.write('orders',current.orders);store.audit(actor.username,'order-attachment-added',{orderId,attachmentId:file.id,name:file.name,size:file.size});}return {ok:true,attachment:duplicate||file,attachments:current.order.attachments};});}
 catch(error){const current=store.read('orders',[]).find(item=>item.id===orderId);if(!(current?.attachments||[]).some(item=>item.id===file.id&&item.sha256===sha256))await bucket.delete(key);throw error;}
}
