import {requireCondition as check} from './security.js';
const MAX_FILE=5*1024*1024,MAX_TOTAL=25*1024*1024,MAX_COUNT=10;
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export async function orderAttachment(store,orderId,fileId,method,body,actor){
 store.requireTask(actor,'site.orders.view');
 const find=()=>{const orders=store.read('orders',[]),order=orders.find(item=>item.id===orderId);check(order,'Order not found',404);return {orders,order};};
 const canUpload=order=>{check(actor.isAdmin||actor.tasks?.['site.orders.manage']===true||order.requestedBy===actor.username,'Only the requester or an order manager can add attachments',403);if(!actor.isAdmin&&actor.tasks?.['site.orders.manage']!==true)store.requireTask(actor,'site.orders.create');};
 let {order}=find();const bucket=store.env.CAD_PROJECT_FILES;check(bucket,'Order file storage is unavailable',503);
 if(method==='GET'){
  const file=(order.attachments||[]).find(item=>item.id===fileId);check(file,'Attachment not found',404);
  const object=await bucket.get('order-attachments/'+orderId+'/'+file.id+'/'+file.sha256);check(object,'Attachment is unavailable',404);
  check(object.size<=MAX_FILE,'Attachment exceeds the file limit',413);
  return {ok:true,file:{...file,data:encode(new Uint8Array(await object.arrayBuffer()))}};
 }
 check(method==='POST','Method not allowed',405);canUpload(order);
 check(/^[a-f0-9-]{36}$/i.test(body.id||''),'Invalid attachment identifier');
 check(typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=200&&!/[\u0000-\u001f\u007f]/.test(body.name),'Invalid filename');
 check(typeof body.data==='string'&&body.data.length<=4*Math.ceil(MAX_FILE/3)&&body.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(body.data),'Choose a file up to 5 MB');
 const bytes=Uint8Array.from(atob(body.data),char=>char.charCodeAt(0));check(bytes.length>0&&bytes.length<=MAX_FILE,'Choose a file between 1 byte and 5 MB');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 const file={id:body.id,name:body.name.trim().replace(/[\\/]/g,'_'),size:bytes.length,sha256,uploadedBy:actor.username,uploadedAt:new Date().toISOString()};
 const validate=current=>{const files=current.attachments||[],existing=files.find(item=>item.id===file.id);if(existing){check(existing.sha256===sha256&&existing.name===file.name,'Attachment identifier is already in use',409);return existing;}check(files.length<MAX_COUNT,'An order can have up to 10 attachments');check(files.reduce((sum,item)=>sum+item.size,0)+file.size<=MAX_TOTAL,'Attachments must total 25 MB or less');return null;};
 const existing=validate(order);if(existing)return {ok:true,attachment:existing,attachments:order.attachments};
 const key='order-attachments/'+orderId+'/'+file.id+'/'+sha256;
 await bucket.put(key,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
 try{return store.ctx.storage.transactionSync(()=>{const current=find();canUpload(current.order);const duplicate=validate(current.order);if(!duplicate){current.order.attachments=[...(current.order.attachments||[]),file];store.write('orders',current.orders);store.audit(actor.username,'order-attachment-added',{orderId,attachmentId:file.id,name:file.name,size:file.size});}return {ok:true,attachment:duplicate||file,attachments:current.order.attachments};});}
 catch(error){const current=store.read('orders',[]).find(item=>item.id===orderId);if(!(current?.attachments||[]).some(item=>item.id===file.id&&item.sha256===sha256))await bucket.delete(key);throw error;}
}
