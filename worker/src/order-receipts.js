import {prepareReceiptPhoto} from './receipt-photos.js';
import {signedReceiptRecord,receiptSignatureKey,canRecordReceipt} from './receipt-acknowledgement.js';
import {deliveryIssues,issueResolutionNotifications} from './delivery-issues.js';
import {requireCondition as check} from './security.js';
import {orderConflict,nextOrderStamp} from './order-updates.js';
export function receiptSummary(order){return (order.items||[]).map((item,index)=>{const received=(order.receipts||[]).reduce((sum,receipt)=>sum+Number(receipt.lines.find(line=>line.index===index)?.accepted||0),0);return {index,description:item.description,quantity:item.quantity,received,outstanding:Math.max(0,Number(item.quantity)-received)};});}
export function recordOrderReceipt(store,id,body,actor,options={}){
 store.requireTask(actor,'site.orders.view');
 const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===id),order=orders[index];check(order,'Order not found',404);
 check(!order.gateComponents,'Confirm the selected components in Gate Progress',409);
 check(canRecordReceipt(actor,order),'Only the requester or an order manager can confirm delivery',403);
 check(/^[a-f0-9-]{36}$/i.test(body.id||''),'Invalid receipt identifier');
 const existing=(order.receipts||[]).find(receipt=>receipt.id===body.id);
 if(existing){check(existing.by===actor.username,'Receipt identifier already used',409);return {ok:true,order:{...order,deliveryIssues:deliveryIssues(order)},duplicate:true};}
 const conflict=orderConflict(order,body);if(conflict)return {...conflict,order:{...order,deliveryIssues:deliveryIssues(order)}};
 check(order.status!=='cancelled','Cancelled orders cannot receive deliveries',409);
 check((order.receipts||[]).length<200,'Receipt limit reached; contact an administrator');
 const totals=receiptSummary(order),seen=new Set();check(Array.isArray(body.lines)&&body.lines.length>0&&body.lines.length<=totals.length,'Select receipt quantities');
 const checklist=body.mode==='site-checklist';
 if(checklist){const outstanding=totals.filter(line=>line.outstanding>0);check(body.lines.length===outstanding.length&&outstanding.every(line=>body.lines.some(input=>input.index===line.index)),'Include every outstanding item');}
 const lines=body.lines.map(line=>{check(Number.isInteger(line.index)&&totals[line.index]&&!seen.has(line.index),'Invalid receipt line');seen.add(line.index);if(checklist)check(typeof line.arrived==='boolean','Confirm whether each item arrived');const accepted=line.arrived===true?Number(line.accepted??0):0,values=checklist?[accepted,0,totals[line.index].outstanding-accepted]:['accepted','damaged','missing'].map(key=>Number(line[key]??0));check(values.every(value=>Number.isFinite(value)&&value>=0),'Quantities must be zero or greater');check(values.reduce((a,b)=>a+b,0)<=totals[line.index].outstanding+1e-9,'Receipt exceeds outstanding quantity');const replacementIssueId=checklist?'':String(line.replacementIssueId||'');if(replacementIssueId){const issue=deliveryIssues(order).find(issue=>issue.id===replacementIssueId);check(issue&&issue.index===line.index&&issue.status!=='resolved'&&values[0]>0&&values[0]<=issue.remaining+1e-9,'Choose an open issue and a replacement quantity within its remaining amount');}check(!values[0]&&!values[1]||line.arrived===true,'Confirm the arrival checkbox for each received item');check(line.arrived!==true||values[0]+values[1]>0,'Enter a quantity for each item confirmed as arrived');return {replacementIssueId,index:line.index,description:totals[line.index].description,arrived:line.arrived===true,accepted:values[0],damaged:values[1],missing:values[2]};});
 check(lines.some(line=>line.accepted+line.damaged+line.missing>0),'Enter a received, damaged or missing quantity');
 const notes=String(body.notes||'').trim();check(notes.length<=1000,'Notes must be 1000 characters or less');
 const attachmentIds=checklist?[]:[...new Set(Array.isArray(body.attachmentIds)?body.attachmentIds:[])];check(attachmentIds.length<=10&&attachmentIds.every(id=>(order.attachments||[]).some(file=>file.id===id)),'Choose files attached to this order');
 const receipt={id:body.id,by:actor.username,at:new Date().toISOString(),lines,notes,attachmentIds};
 if(checklist)receipt.mode='site-checklist';if(options.deliveryPhoto)receipt.deliveryPhoto=options.deliveryPhoto;
 const signed=signedReceiptRecord(order,receipt,body.acknowledgement);receipt.acknowledgement={name:signed.name,at:signed.at,by:signed.by,contentHash:signed.contentHash};
 const updated={...order,receipts:[...(order.receipts||[]),receipt],updatedAt:nextOrderStamp(order),updatedBy:actor.username};
 const outstanding=receiptSummary(updated).reduce((sum,line)=>sum+line.outstanding,0),issues=lines.some(line=>line.damaged||line.missing);
 if(options.dryRun)return {ok:true,order:updated,receipt};
 orders[index]=updated;
 store.ctx.storage.transactionSync(()=>{store.write(receiptSignatureKey(id,receipt.id),signed);store.write('orders',orders);issueResolutionNotifications(store,order,updated,actor);store.audit(actor.username,'order-received',{orderId:id,receiptId:receipt.id,outstanding,issues});const recipients=Object.entries(store.read('users',{})).filter(([username,user])=>user.active!==false&&username!==actor.username&&(user.isAdmin||store.taskAccess(username,user.isAdmin)['site.orders.manage']===true)).map(([username])=>username);store.notify(recipients,{title:`Order #${order.orderNumber}: ${outstanding?'partial receipt':'fully received'}`,message:`${order.project} · received by ${actor.username}${issues?' · missing or damaged items reported':''} · ${outstanding} outstanding`,kind:'orders',priority:issues?'important':'normal',link:'orders',orderId:order.id});});
 return {ok:true,order:{...updated,deliveryIssues:deliveryIssues(updated)},receipt};
}

// Upload delivery evidence privately; the synchronous receipt transaction remains the commit point.
export async function submitOrderReceipt(store,id,body,actor){
 if(!body.deliveryPhoto)return recordOrderReceipt(store,id,body,actor);
 const preview=recordOrderReceipt(store,id,body,actor,{dryRun:true});if(!preview.ok||preview.duplicate)return preview;
 const bucket=store.env.CAD_PROJECT_FILES;check(bucket,'Delivery photo storage is unavailable',503);
 const photo=prepareReceiptPhoto(id,body.id,body.deliveryPhoto,actor);
 photo.metadata.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',photo.bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 await bucket.put(photo.metadata.key,photo.bytes,{httpMetadata:{contentType:photo.metadata.contentType}});
 try{const result=recordOrderReceipt(store,id,body,actor,{deliveryPhoto:photo.metadata});if(!result.ok||result.duplicate){await bucket.delete(photo.metadata.key).catch(()=>{});}return result;}
 catch(error){await bucket.delete(photo.metadata.key).catch(()=>{});throw error;}
}
