import {requireCondition as check} from './security.js';
import {workshopView} from './workshop-stock.js';
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const read=store=>store.read('workshop-stock',empty());
const text=(value,max=160)=>String(value??'').trim().slice(0,max);
const round=value=>Math.round(value*1000)/1000;
const quantity=value=>{check(value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<=1e9,'Enter a quantity greater than zero');const n=Number(value);check(Math.abs(n*1000-Math.round(n*1000))<0.0001,'Quantities support up to three decimal places');return n;};
const access=(store,actor)=>store.requireTask(actor,'factory.receive');
const admin=actor=>check(actor.isAdmin,'Administrator access required',403);
const find=(state,id)=>{const order=(state.purchaseOrders||[]).find(o=>o.id===id);check(order,'Purchase order not found',404);return order;};
function view(store,actor){
 const state=read(store);
 return {ok:true,orders:(state.purchaseOrders||[]).filter(o=>actor.isAdmin||o.status!=='draft'),items:workshopView(store).items,restoreEpoch:store.read('restoreEpoch',0)};
}
function record(store,state,actor,action,detail,transactions=[]){
 const revision=store.read('revision',0)+1;state.revision++;
 store.write('workshop-stock',state);store.write('revision',revision);
 if(transactions.length)store.write('app:transactions',[...transactions,...store.read('app:transactions',[])]);
 store.audit(actor.username,'purchase-order-'+action,detail);
 return revision;
}
export function handlePurchaseOrders(store,method,body,actor){
 access(store,actor);
 if(method==='GET')return {status:200,body:view(store,actor)};
 check(method==='POST','Method not allowed',405);
 const action=body.action;
 check(['save','publish','receive','cancel'].includes(action),'Unknown purchase order action');
 if(action!=='receive')admin(actor);
 check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Mutation ID required');
 check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Refresh before continuing.',409);
 const key='purchase-order-mutation:'+body.mutationId,payload=JSON.stringify(body),prior=store.read(key,null);
 if(prior){check(prior.user===actor.username&&prior.payload===payload,'Mutation ID reused',409);return {status:200,body:{...view(store,actor),orderId:prior.orderId,duplicate:true}};}
 const next=read(store),orders=next.purchaseOrders||[],now=new Date().toISOString();
 let order=orders.find(o=>o.id===body.orderId),transactions=[],legacyWrites=new Map();
 if(action==='save'&&!order){
  check(body.expectedVersion===0,'Purchase order no longer exists',409);
  check(/^[a-f0-9-]{36}$/i.test(body.orderId||''),'Invalid purchase order identifier');
  order={id:body.orderId,version:0,status:'draft',lines:[],attachments:[],receipts:[],createdBy:actor.username,createdAt:now};orders.unshift(order);
 }else{check(order,'Purchase order not found',404);check(body.expectedVersion===order.version,'Purchase order changed. Refresh and review before trying again.',409);}
 if(action==='save'){
  const previousStatus=order.status;
  if(previousStatus!=='draft')check(Array.isArray(body.lines)&&body.lines.length>0,'Keep at least one item on an issued PO');
  check(order.lines.filter(l=>l.received>0).every(l=>(body.lines||[]).some(input=>input.itemId===l.itemId)),'Received items cannot be removed from a PO',409);
  const reference=text(body.reference,100),supplier=text(body.supplier),notes=text(body.notes,1000);
  check(reference&&supplier,'PO number and supplier are required');
  check(!orders.some(o=>o.id!==order.id&&o.status!=='cancelled'&&o.reference.toLowerCase()===reference.toLowerCase()&&o.supplier.toLowerCase()===supplier.toLowerCase()),'This supplier and PO number already exists',409);
  check(Array.isArray(body.lines)&&body.lines.length<=200,'A PO can contain up to 200 items');
  const items=workshopView(store).items,seen=new Set();
  const lines=body.lines.map(input=>{
   const item=items.find(i=>i.id===input.itemId);check(item,'Select an existing stock item');
   check(!seen.has(item.id),'Each stock item can appear only once on a PO');seen.add(item.id);
   const ordered=quantity(input.ordered);if(item.legacy)check(Number.isInteger(ordered),'Panel quantities must be whole sheets');
   const received=order.lines.find(l=>l.itemId===item.id)?.received||0;check(ordered>=received,'Ordered quantity cannot be below the received quantity for '+item.name,409);
   return {itemId:item.id,name:item.name,sku:item.sku||'',unit:item.unit,category:item.category,colour:item.colour||item.color||'',dimensions:item.dimensions||(item.width?item.width+' × '+item.height+' mm':''),lengthMm:item.lengthMm||null,ordered,received};
  });
  order.edits=[...(order.edits||[]),{at:now,user:actor.username,previous:{reference:order.reference||'',supplier:order.supplier||'',notes:order.notes||'',lines:order.lines}}];
  Object.assign(order,{reference,supplier,notes,lines});
  if(!['draft','cancelled'].includes(previousStatus)){order.status=lines.every(l=>l.received===l.ordered)?'received':lines.some(l=>l.received>0)?'partial':'open';if(order.status==='received')order.completedAt=order.completedAt||now;else delete order.completedAt;}
 }else if(action==='publish'){
  check(order.status==='draft','Only drafts can be made available for receiving',409);
  check(order.attachments.length>0,'Upload the PO document first');check(order.lines.length>0,'Add at least one PO item');
  const ids=new Set(workshopView(store).items.map(i=>i.id));check(order.lines.every(l=>ids.has(l.itemId)),'A stock item was removed. Edit the PO lines first.',409);
  order.status='open';order.publishedAt=now;order.publishedBy=actor.username;
 }else if(action==='cancel'){
  check(['draft','open','partial'].includes(order.status),'This PO is already closed',409);
  const reason=text(body.reason,500);check(reason,'Enter a cancellation reason');order.status='cancelled';order.cancelledAt=now;order.cancelledBy=actor.username;order.cancelReason=reason;
 }else{
  check(['open','partial'].includes(order.status),'This PO is not available for receiving',409);
  check(Array.isArray(body.lines)&&body.lines.length>0&&body.lines.length<=200,'Enter the quantities delivered');
  const seen=new Set(),receipt={id:crypto.randomUUID(),at:now,user:actor.username,reference:text(body.deliveryReference,160),notes:text(body.notes,1000),lines:[]};
  for(const input of body.lines){
   const line=order.lines.find(l=>l.itemId===input.itemId);check(line&&!seen.has(input.itemId),'Invalid or duplicate PO item');seen.add(input.itemId);
   const delivered=quantity(input.quantity);check(delivered<=round(line.ordered-line.received),'Quantity exceeds the outstanding amount for '+line.name,409);
   const legacy=/^(variant|offcut):(.+)$/.exec(line.itemId);let item;
   if(legacy){
    check(Number.isInteger(delivered),'Panel quantities must be whole sheets');
    const field=legacy[1]==='variant'?'variants':'offcuts';if(!legacyWrites.has(field))legacyWrites.set(field,store.read('app:'+field,[]));
    item=legacyWrites.get(field).find(i=>i.id===legacy[2]);
   }else item=next.items.find(i=>i.id===line.itemId);
   check(item,'Stock item no longer exists',409);const updated=round(Number(item.qty||0)+delivered);check(Number.isFinite(updated)&&updated<=1e9,'Stock quantity is too large');item.qty=updated;
   line.received=round(line.received+delivered);receipt.lines.push({itemId:line.itemId,quantity:delivered});
   const movement={id:crypto.randomUUID(),itemId:line.itemId,sku:line.sku,action:'receive',quantity:delivered,job:'',reason:'PO '+order.reference+(receipt.reference?' · '+receipt.reference:''),user:actor.username,at:now,purchaseOrderId:order.id,receiptId:receipt.id};
   next.movements.unshift(movement);
   transactions.push({id:movement.id,type:legacy?'receipt':'workshop',desc:'PO '+order.reference+' · '+line.name,qty:delivered,ref:receipt.reference||order.reference,user:actor.username,timestamp:now,purchaseOrderId:order.id,receiptId:receipt.id,...(legacy?{itemType:legacy[1],sku:item.sku,color:item.color,material:item.material,thickness:item.thickness,width:item.width,height:item.height}:{sku:item.sku})});
  }
  order.receipts.unshift(receipt);order.status=order.lines.every(l=>l.received===l.ordered)?'received':'partial';if(order.status==='received')order.completedAt=now;
 }
 order.version++;order.updatedAt=now;next.purchaseOrders=orders;
 let revision;
 store.ctx.storage.transactionSync(()=>{
  for(const [field,value] of legacyWrites)store.write('app:'+field,value);
  revision=record(store,next,actor,action,{orderId:order.id,reference:order.reference,version:order.version,...(action==='receive'?{receipt:order.receipts[0]}:{})},transactions);
  store.write(key,{user:actor.username,payload,orderId:order.id});
 });
 store.broadcastRevision(revision);
 return {status:200,body:{...view(store,actor),orderId:order.id}};
}
const MAX_FILE=5*1024*1024;
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export async function purchaseOrderFile(store,orderId,fileId,method,body,actor){
 access(store,actor);const order=find(read(store),orderId);check(actor.isAdmin||order.status!=='draft','Purchase order not found',404);
 const bucket=store.env.CAD_PROJECT_FILES;check(bucket,'PO file storage is unavailable',503);
 const objectKey=file=>'purchase-orders/'+orderId+'/'+file.id+'/'+file.sha256;
 if(method==='GET'){
  const file=order.attachments.find(f=>f.id===fileId);check(file,'PO file not found',404);
  const object=await bucket.get(objectKey(file));check(object,'PO file unavailable',404);check(object.size<=MAX_FILE,'PO file is too large',413);
  return {status:200,body:{ok:true,file:{...file,data:encode(new Uint8Array(await object.arrayBuffer()))}}};
 }
 check(method==='POST','Method not allowed',405);admin(actor);
 check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Refresh before continuing.',409);
 check(/^[a-f0-9-]{36}$/i.test(body.id||''),'Invalid file identifier');
 check(typeof body.name==='string'&&body.name.trim()&&body.name.length<=200&&!/[\u0000-\u001f\u007f]/.test(body.name),'Invalid filename');
 check(typeof body.data==='string'&&body.data.length<=4*Math.ceil(MAX_FILE/3)&&body.data.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(body.data),'Choose a PO file up to 5 MB');
 let raw;try{raw=atob(body.data);}catch{check(false,'Invalid file');}
 check(raw.length>0&&raw.length<=MAX_FILE,'Choose a PO file up to 5 MB');
 const ext=body.name.toLowerCase().split('.').pop();
 const type=ext==='pdf'&&raw.startsWith('%PDF-')?'application/pdf':ext==='png'&&raw.startsWith('\x89PNG\r\n\x1a\n')?'image/png':['jpg','jpeg'].includes(ext)&&raw.startsWith('\xff\xd8\xff')?'image/jpeg':ext==='xlsx'&&raw.startsWith('PK\x03\x04')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':null;
 check(type,'Choose a PDF, PNG, JPG or Excel (.xlsx) PO file');
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 const file={id:body.id,name:body.name.trim().replace(/[\\/]/g,'_'),type,size:bytes.length,sha256,uploadedBy:actor.username,uploadedAt:new Date().toISOString()};
 const validate=current=>{const prior=current.attachments.find(f=>f.id===file.id);if(prior){check(prior.sha256===sha256&&prior.name===file.name,'File identifier reused',409);return prior;}check(current.attachments.length<5,'A PO can have up to five files');return null;};
 if(validate(order))return {status:200,body:{...view(store,actor),orderId}};
 await bucket.put(objectKey(file),bytes,{httpMetadata:{contentType:'application/octet-stream'}});
 let revision;
 store.ctx.storage.transactionSync(()=>{
  check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Refresh before continuing.',409);
  const latest=read(store),current=find(latest,orderId);if(!validate(current)){
   current.attachments.push(file);current.version++;current.updatedAt=file.uploadedAt;
   revision=record(store,latest,actor,'file',{orderId,fileId:file.id,name:file.name});
  }
 });
 if(revision!==undefined)store.broadcastRevision(revision);
 return {status:200,body:{...view(store,actor),orderId}};
}
