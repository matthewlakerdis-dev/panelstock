import {requireCondition as check} from './security.js';
import {workshopView,applyWorkshop} from './workshop-stock.js';
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const read=store=>store.read('workshop-stock',empty());
const text=(value,max=160)=>String(value??'').trim().slice(0,max);
const deliveryDate=value=>{
 if(value===null||value==='')return '';
 check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>0,'Enter a valid expected delivery date');
 const date=new Date(value+'T00:00:00Z');
 check(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value,'Enter a valid expected delivery date');
 return value;
};
const round=value=>Math.round(value*1000)/1000;
const quantity=value=>{check(value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<=1e9,'Enter a quantity greater than zero');const n=Number(value);check(Math.abs(n*1000-Math.round(n*1000))<0.0001,'Quantities support up to three decimal places');return n;};
const access=(store,actor)=>store.requireTask(actor,'factory.receive');
const admin=actor=>check(actor.isAdmin,'Administrator access required',403);
const find=(state,id)=>{const order=(state.purchaseOrders||[]).find(o=>o.id===id);check(order,'Purchase order not found',404);return order;};

const poNormal=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
const poSource=input=>{
 check(input&&typeof input==='object'&&!Array.isArray(input),'Invalid supplier stock details');
 const result={};
 for(const [field,max] of [['sku',100],['description',500],['colour',160],['dimensions',160],['unit',40]]){
  check(input[field]===undefined||input[field]===null||typeof input[field]==='string','Invalid supplier '+field);
  check(String(input[field]||'').length<=max,'Supplier '+field+' is too long');result[field]=text(input[field],max);
 }
 check(result.sku||result.description,'A supplier code or description is required');
 const n=input.lengthMm;check(n===undefined||n===null||n===''||(Number.isFinite(Number(n))&&Number(n)>0&&Number(n)<=1e6),'Invalid supplier stock length');
 result.lengthMm=n===undefined||n===null||n===''?null:Number(n);return result;
};
const stockIdentity=item=>JSON.stringify([item.sku,item.colour||item.color,item.dimensions,item.lengthMm,item.unit,item.width,item.height,item.thickness,item.material].map(v=>poNormal(v)));
const poKey=(supplier,source)=>JSON.stringify([supplier,source.sku,source.description,source.colour,source.dimensions,source.lengthMm||'',source.unit].map(poNormal));
function learnStock(next,updates,supplier,items,lines,actor,orderId,now){
 check(Array.isArray(updates)&&updates.length<=200,'A PO can update up to 200 supplier stock references');
 const refs=[...(next.poStockReferences||[])],seen=new Map(),names=new Map(),changes=[];
 for(const update of updates){
  check(update&&typeof update==='object','Invalid stock update');
  const item=items.find(i=>i.id===update.itemId);check(item&&lines.some(l=>l.itemId===item.id),'Stock updates must belong to the saved PO');
  check(update.expectedItemIdentity===stockIdentity(item),'Stock variant changed. Review its code, colour, size and unit before saving.',409);
  check(poNormal(update.supplier)===poNormal(supplier),'Supplier changed. Review the stock updates again.',409);
  const source=poSource(update.source),key=poKey(supplier,source),index=refs.findIndex(r=>r.key===key),prior=index<0?null:refs[index];
  check(!seen.has(key)||seen.get(key)===item.id,'The same supplier details cannot match two stock items');
  if(!seen.has(key)){
   check(Number.isInteger(update.expectedReferenceVersion)&&update.expectedReferenceVersion===(prior?.version||0),'A supplier stock match changed. Review the latest match before saving.',409);
   const reference={key,supplier,source,itemId:item.id,itemIdentity:stockIdentity(item),version:(prior?.version||0)+1,updatedBy:actor.username,updatedAt:now,purchaseOrderId:orderId};
   if(index<0)refs.push(reference);else refs[index]=reference;
   changes.push({itemId:item.id,source,previousMatch:prior?.itemId||null});seen.set(key,item.id);
  }
  check(update.updateDetails===undefined||typeof update.updateDetails==='boolean','Invalid stock detail option');
  if(update.updateDetails){
   const name=text(source.description);check(name,'A PO description is required to update the stock name');
   check(update.expectedName===item.name&&String(update.expectedSupplier||'')===String(item.supplier||''),'Stock details changed. Review the latest stock name and supplier before saving.',409);
   check(!names.has(item.id)||names.get(item.id)===name,'Choose only one PO description for this stock item');
   const target=item.legacy?(next.metadata[item.id]||={}):next.items.find(i=>i.id===item.id);
   target.name=name;target.supplier=supplier;names.set(item.id,name);
   for(const line of lines)if(line.itemId===item.id)line.name=name;
   changes.push({itemId:item.id,previous:{name:item.name,supplier:item.supplier||''},next:{name,supplier}});
  }
 }
 check(refs.length<=20000,'Supplier stock reference limit reached');
 next.poStockReferences=refs;return changes;
}

function view(store,actor){
 const state=read(store);
 const stock=workshopView(store);
 return {ok:true,stockLearning:true,receiptCorrections:true,stockReferences:actor.isAdmin?(state.poStockReferences||[]):[],orders:(state.purchaseOrders||[]).filter(o=>actor.isAdmin||o.status!=='draft'),items:stock.items,categories:stock.categories,catalog:stock.catalog,restoreEpoch:store.read('restoreEpoch',0)};
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
 check(['save','publish','receive','cancel','close_short','report_issue','resolve_issue','create_item','correct_receipt'].includes(action),'Unknown purchase order action');
 if(!['receive','report_issue'].includes(action))admin(actor);
 check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Mutation ID required');
 check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Refresh before continuing.',409);
 const key='purchase-order-mutation:'+body.mutationId,payload=JSON.stringify(body),prior=store.read(key,null);
 if(prior){check(prior.user===actor.username&&prior.payload===payload,'Mutation ID reused',409);return {status:200,body:{...view(store,actor),orderId:prior.orderId,itemId:prior.itemId,duplicate:true}};}
 if(action==='create_item'){
  const input=body.item;check(input&&typeof input==='object'&&!Array.isArray(input),'Enter stock item details');
  check(input.qty===undefined||Number(input.qty)===0,'New PO stock items must start at zero on hand');
  let state=read(store),itemId,movement;const writes=new Map(),now=new Date().toISOString();
  if(input.category==='panels'){
   const normal=v=>text(v).toLowerCase().replace(/\s+/g,' '),sku=text(input.sku,100),color=text(input.colour),material=text(input.material);
   check(sku&&color&&material&&text(input.name),'Stock code, name, colour and material are required');
   const dimension=value=>{const n=Number(value);check(Number.isFinite(n)&&n>0&&n<=1e6,'Panel dimensions must be positive millimetres');return n;};
   const thickness=dimension(input.thickness),width=dimension(input.width),height=dimension(input.height),catalog=store.read('app:catalog',[]),variants=store.read('app:variants',[]);
   const same=i=>normal(i.sku)===normal(sku)&&normal(i.color)===normal(color)&&normal(i.material)===normal(material)&&Number(i.thickness)===thickness;
   check(!variants.some(i=>same(i)&&Number(i.width)===width&&Number(i.height)===height),'This panel stock item already exists. Select it from the stock list.',409);
   let entry=catalog.find(same);
   if(!entry){entry={id:crypto.randomUUID(),sku,color,material,thickness,width:0,height:0};catalog.push(entry);writes.set('catalog',catalog);}
   const item={id:crypto.randomUUID(),catalogId:entry.id,sku:entry.sku,color:entry.color,material:entry.material,thickness,width,height,qty:0};
   variants.push(item);writes.set('variants',variants);itemId='variant:'+item.id;
   state.metadata[itemId]={name:text(input.name),supplier:text(input.supplier),reorderLevel:0};
   movement={id:crypto.randomUUID(),itemId,sku:item.sku,action:'create',quantity:0,job:'',reason:'Created from PO entry',user:actor.username,at:now};state.movements.unshift(movement);
  }else{
   const revision=state.revision,result=applyWorkshop(state,{action:'create',item:{...input,qty:0,reorderLevel:0,packSize:1,location:''}},actor);
   state=result.next;state.revision=revision;movement=result.movement;itemId=movement.itemId;movement.reason='Created from PO entry';
  }
  let revision;store.ctx.storage.transactionSync(()=>{
   for(const [field,value] of writes)store.write('app:'+field,value);
   revision=record(store,state,actor,'create-item',{itemId,sku:movement.sku,quantity:0},[{id:movement.id,type:'workshop',desc:'Created stock item from PO: '+movement.sku,qty:0,user:actor.username,timestamp:now}]);
   store.write(key,{user:actor.username,payload,itemId});
  });store.broadcastRevision(revision);
  return {status:200,body:{...view(store,actor),itemId}};
 }
 const next=read(store),orders=next.purchaseOrders||[],now=new Date().toISOString();
 let order=orders.find(o=>o.id===body.orderId),transactions=[],legacyWrites=new Map(),stockChanges=[];
 if(action==='save'&&!order){
  check(body.expectedVersion===0,'Purchase order no longer exists',409);
  check(/^[a-f0-9-]{36}$/i.test(body.orderId||''),'Invalid purchase order identifier');
  order={id:body.orderId,version:0,status:'draft',lines:[],attachments:[],receipts:[],createdBy:actor.username,createdAt:now};orders.unshift(order);
 }else{check(order,'Purchase order not found',404);check(body.expectedVersion===order.version,'Purchase order changed. Refresh and review before trying again.',409);}
 if(action==='save'){
  check(order.status!=='closed_short','Closed-short POs cannot be edited',409);
  const previousStatus=order.status;
  if(previousStatus!=='draft')check(Array.isArray(body.lines)&&body.lines.length>0,'Keep at least one item on an issued PO');
  check(order.lines.filter(l=>l.received>0||(order.issues||[]).some(i=>i.itemId===l.itemId)||(order.receipts||[]).some(r=>r.lines.some(i=>i.itemId===l.itemId))).every(l=>(body.lines||[]).some(input=>input.itemId===l.itemId)),'Received items or items with delivery issues cannot be removed from a PO',409);
  const reference=text(body.reference,100),supplier=text(body.supplier),notes=text(body.notes,1000);
  const expectedDelivery=body.expectedDelivery===undefined?(order.expectedDelivery||''):deliveryDate(body.expectedDelivery);
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
  if(body.stockUpdates!==undefined)stockChanges=learnStock(next,body.stockUpdates,supplier,items,lines,actor,order.id,now);
  order.edits=[...(order.edits||[]),{at:now,user:actor.username,previous:{reference:order.reference||'',supplier:order.supplier||'',expectedDelivery:order.expectedDelivery||'',notes:order.notes||'',lines:order.lines}}];
  Object.assign(order,{reference,supplier,notes,expectedDelivery,lines});
  if(!['draft','cancelled'].includes(previousStatus)){order.status=lines.every(l=>l.received===l.ordered)?'received':lines.some(l=>l.received>0)?'partial':'open';if(order.status==='received')order.completedAt=order.completedAt||now;else delete order.completedAt;}
 }else if(action==='publish'){
  check(order.status==='draft','Only drafts can be made available for receiving',409);
  check(order.attachments.some(f=>!f.issueId&&!f.receiptId),'Upload the PO document first');check(order.lines.length>0,'Add at least one PO item');
  const ids=new Set(workshopView(store).items.map(i=>i.id));check(order.lines.every(l=>ids.has(l.itemId)),'A stock item was removed. Edit the PO lines first.',409);
  order.status='open';order.publishedAt=now;order.publishedBy=actor.username;
 }else if(action==='correct_receipt'){
  check(['open','partial','received','cancelled','closed_short'].includes(order.status),'This PO has no correctable deliveries',409);
  const receipt=(order.receipts||[]).find(r=>r.id===body.receiptId);check(receipt,'Delivery receipt not found',404);
  const reason=text(body.reason,500);check(reason,'Enter a reason for correcting this receipt');
  check((receipt.corrections||[]).length<200,'This receipt has reached its correction limit');
  const before=receipt.currentLines||receipt.lines;
  check(Array.isArray(body.lines)&&body.lines.length===before.length&&body.lines.length>0&&body.lines.length<=200,'Include every original receipt item exactly once');
  const seen=new Set(),stock=workshopView(store).items,correction={id:crypto.randomUUID(),at:now,user:actor.username,reason,previousStatus:order.status,lines:[]};
  const currentLines=body.lines.map(input=>{
   check(input&&typeof input==='object','Invalid receipt item');
   const original=before.find(l=>l.itemId===input.itemId),line=order.lines.find(l=>l.itemId===input.itemId);
   check(original&&line&&!seen.has(input.itemId),'Invalid or duplicate receipt item');seen.add(input.itemId);
   const value=input.quantity;check((typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1e9,'Enter a corrected quantity of zero or more');
   const amount=Number(value);check(Math.abs(amount*1000-Math.round(amount*1000))<0.0001,'Quantities support up to three decimal places');
   const legacy=/^(variant|offcut):(.+)$/.exec(line.itemId);if(legacy)check(Number.isInteger(amount),'Panel quantities must be whole sheets');
   const delta=round(amount-original.quantity),received=round(line.received+delta);
   check(received>=0&&received<=line.ordered,'Corrected receipts exceed the ordered quantity for '+line.name,409);
   if(delta!==0){
    let item;if(legacy){const field=legacy[1]==='variant'?'variants':'offcuts';if(!legacyWrites.has(field))legacyWrites.set(field,store.read('app:'+field,[]));item=legacyWrites.get(field).find(i=>i.id===legacy[2]);}else item=next.items.find(i=>i.id===line.itemId);
    check(item,'Stock item no longer exists',409);
    const updated=round(Number(item.qty||0)+delta),held=Number(stock.find(i=>i.id===line.itemId)?.reserved||0);
    check(Number.isFinite(updated)&&updated>=0&&updated<=1e9,'Correction would make stock negative or exceed its limit for '+line.name,409);
    if(delta<0)check(updated>=held,'Correction would reduce reserved stock for '+line.name+'. Release allocations or reconcile stock first.',409);
    item.qty=updated;line.received=received;
    correction.lines.push({itemId:line.itemId,name:line.name,unit:line.unit,before:original.quantity,after:amount,delta});
    const movement={id:crypto.randomUUID(),itemId:line.itemId,sku:line.sku,action:'receipt_correction',quantity:delta,job:'',reason:'PO '+order.reference+': '+reason,user:actor.username,at:now,purchaseOrderId:order.id,receiptId:receipt.id,correctionId:correction.id};
    next.movements.unshift(movement);
    transactions.push({id:movement.id,type:legacy?'adjustment':'workshop',desc:'PO receipt correction '+order.reference+' · '+line.name,qty:delta,ref:receipt.reference||order.reference,user:actor.username,timestamp:now,purchaseOrderId:order.id,receiptId:receipt.id,correctionId:correction.id,...(legacy?{itemType:legacy[1],sku:item.sku,color:item.color,material:item.material,thickness:item.thickness,width:item.width,height:item.height}:{sku:item.sku})});
   }
   return {itemId:line.itemId,quantity:amount};
  });
  check(correction.lines.length,'Change at least one receipt quantity');
  receipt.currentLines=currentLines;receipt.corrections=[correction,...(receipt.corrections||[])];
  if(!['cancelled','closed_short'].includes(order.status)){
   order.status=order.lines.every(l=>l.received===l.ordered)?'received':order.lines.some(l=>l.received>0)?'partial':'open';
   if(order.status==='received')order.completedAt=order.completedAt||now;else delete order.completedAt;
  }else if(order.status==='closed_short'){
   correction.previousClosedBalance=order.closedBalance;
   order.closedBalance=order.lines.filter(l=>l.ordered>l.received).map(l=>({itemId:l.itemId,name:l.name,unit:l.unit,quantity:round(l.ordered-l.received)}));
  }
  correction.resultingStatus=order.status;
 }else if(action==='report_issue'){
  check(['open','partial','received'].includes(order.status),'This PO is not available for delivery issue reporting',409);
  const line=order.lines.find(l=>l.itemId===body.itemId);check(line,'Select a PO item');
  check(['damaged','missing','incorrect'].includes(body.kind),'Choose a delivery issue type');
  const amount=quantity(body.quantity);check(amount<=line.ordered,'Issue quantity exceeds the ordered amount');
  if(/^(variant|offcut):/.test(line.itemId))check(Number.isInteger(amount),'Panel quantities must be whole sheets');
  const notes=text(body.notes,1000);check(notes,'Describe the delivery issue');
  check((order.issues||[]).length<200,'This PO has reached its delivery issue limit');
  order.issues=[{id:crypto.randomUUID(),itemId:line.itemId,name:line.name,unit:line.unit,kind:body.kind,quantity:amount,notes,reference:text(body.deliveryReference,160),status:'open',at:now,user:actor.username},...(order.issues||[])];
 }else if(action==='resolve_issue'){
  const issue=(order.issues||[]).find(i=>i.id===body.issueId);check(issue,'Delivery issue not found',404);
  check(issue.status==='open','This issue is already resolved',409);
  const resolution=text(body.reason,1000);check(resolution,'Enter how this issue was resolved');
  Object.assign(issue,{status:'resolved',resolution,resolvedAt:now,resolvedBy:actor.username});
 }else if(action==='close_short'){
  check(['open','partial'].includes(order.status),'This PO is already closed',409);
  const reason=text(body.reason,500);check(reason,'Enter a reason for closing short');
  check(!(order.issues||[]).some(i=>i.status==='open'),'Resolve delivery issues before closing short',409);
  order.status='closed_short';order.closedAt=now;order.closedBy=actor.username;order.closeReason=reason;
  order.closedBalance=order.lines.filter(l=>l.ordered>l.received).map(l=>({itemId:l.itemId,name:l.name,unit:l.unit,quantity:round(l.ordered-l.received)}));
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
  revision=record(store,next,actor,action,{orderId:order.id,reference:order.reference,version:order.version,...(action==='save'?{expectedDelivery:order.expectedDelivery}:{}),...(stockChanges.length?{stockChanges}:{}),...(action==='receive'?{receipt:order.receipts[0]}:{}),...(action==='correct_receipt'?{receiptId:body.receiptId,correction:order.receipts.find(r=>r.id===body.receiptId).corrections[0]}:{}),...(action==='report_issue'?{issue:order.issues[0]}:{}),...(action==='resolve_issue'?{issueId:body.issueId,reason:text(body.reason,1000)}:{}),...(action==='close_short'?{reason:order.closeReason,balance:order.closedBalance}:{})},transactions);
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
 check(method==='POST','Method not allowed',405);
 const issueId=body.issueId||null,receiptId=body.receiptId||null;
 check(!(issueId&&receiptId),'Choose a receipt or delivery issue, not both');
 if(!issueId&&!receiptId)admin(actor);
 if(issueId)check((order.issues||[]).some(i=>i.id===issueId),'Delivery issue not found',404);
 if(receiptId)check((order.receipts||[]).some(r=>r.id===receiptId),'Delivery receipt not found',404);
 check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Refresh before continuing.',409);
 check(/^[a-f0-9-]{36}$/i.test(body.id||''),'Invalid file identifier');
 check(typeof body.name==='string'&&body.name.trim()&&body.name.length<=200&&!/[\u0000-\u001f\u007f]/.test(body.name),'Invalid filename');
 check(typeof body.data==='string'&&body.data.length<=4*Math.ceil(MAX_FILE/3)&&body.data.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(body.data),'Choose a PO file up to 5 MB');
 let raw;try{raw=atob(body.data);}catch{check(false,'Invalid file');}
 check(raw.length>0&&raw.length<=MAX_FILE,'Choose a PO file up to 5 MB');
 const ext=body.name.toLowerCase().split('.').pop();
 const type=ext==='pdf'&&raw.startsWith('%PDF-')?'application/pdf':ext==='png'&&raw.startsWith('\x89PNG\r\n\x1a\n')?'image/png':['jpg','jpeg'].includes(ext)&&raw.startsWith('\xff\xd8\xff')?'image/jpeg':ext==='xlsx'&&raw.startsWith('PK\x03\x04')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':null;
 check(type,'Choose a PDF, PNG, JPG or Excel (.xlsx) PO file');
 if(issueId)check(['image/png','image/jpeg'].includes(type),'Choose a PNG or JPG delivery issue photo');
 if(receiptId)check(['application/pdf','image/png','image/jpeg'].includes(type),'Choose a PDF, PNG or JPG delivery docket');
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 const file={id:body.id,name:body.name.trim().replace(/[\\/]/g,'_'),type,size:bytes.length,sha256,uploadedBy:actor.username,uploadedAt:new Date().toISOString(),...(issueId?{issueId}:{}),...(receiptId?{receiptId}:{})};
 const validate=current=>{if(receiptId)check((current.receipts||[]).some(r=>r.id===receiptId),'Delivery receipt not found',404);const prior=current.attachments.find(f=>f.id===file.id);if(prior){check(prior.sha256===sha256&&prior.name===file.name&&(prior.issueId||null)===issueId&&(prior.receiptId||null)===receiptId,'File identifier reused',409);return prior;}
  if(issueId){const issue=(current.issues||[]).find(i=>i.id===issueId);check(issue,'Delivery issue not found',404);check(issue.status==='open','This delivery issue is resolved',409);}
  check(current.attachments.filter(f=>(f.issueId||null)===issueId&&(f.receiptId||null)===receiptId).length<5,receiptId?'A receipt can have up to five docket files':issueId?'An issue can have up to five photos':'A PO can have up to five files');return null;};
 if(validate(order))return {status:200,body:{...view(store,actor),orderId}};
 await bucket.put(objectKey(file),bytes,{httpMetadata:{contentType:'application/octet-stream'}});
 let revision;
 store.ctx.storage.transactionSync(()=>{
  check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Refresh before continuing.',409);
  const latest=read(store),current=find(latest,orderId);if(!validate(current)){
   current.attachments.push(file);current.version++;current.updatedAt=file.uploadedAt;
   revision=record(store,latest,actor,'file',{orderId,fileId:file.id,name:file.name,...(receiptId?{receiptId}:{}),...(issueId?{issueId}:{})});
  }
 });
 if(revision!==undefined)store.broadcastRevision(revision);
 return {status:200,body:{...view(store,actor),orderId}};
}
