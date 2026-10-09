import {deliveryIssues,issueResolutionNotifications} from './delivery-issues.js';
import {requireCondition as check} from './security.js';
import {orderConflict,nextOrderStamp} from './order-updates.js';
export function receiptSummary(order){return (order.items||[]).map((item,index)=>{const received=(order.receipts||[]).reduce((sum,receipt)=>sum+Number(receipt.lines.find(line=>line.index===index)?.accepted||0),0);return {index,description:item.description,quantity:item.quantity,received,outstanding:Math.max(0,Number(item.quantity)-received)};});}
export function recordOrderReceipt(store,id,body,actor){
 store.requireTask(actor,'site.orders.view');
 const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===id),order=orders[index];check(order,'Order not found',404);
 check(actor.isAdmin||actor.tasks?.['site.orders.manage']===true||(actor.tasks?.['site.orders.create']===true&&order.requestedBy===actor.username),'Only the requester or an order manager can confirm delivery',403);
 check(/^[a-f0-9-]{36}$/i.test(body.id||''),'Invalid receipt identifier');
 const existing=(order.receipts||[]).find(receipt=>receipt.id===body.id);
 if(existing){check(existing.by===actor.username,'Receipt identifier already used',409);return {ok:true,order,duplicate:true};}
 const conflict=orderConflict(order,body);if(conflict)return {...conflict,order:{...order,deliveryIssues:deliveryIssues(order)}};
 check(order.status!=='cancelled','Cancelled orders cannot receive deliveries',409);
 check((order.receipts||[]).length<200,'Receipt limit reached; contact an administrator');
 const totals=receiptSummary(order),seen=new Set();check(Array.isArray(body.lines)&&body.lines.length>0&&body.lines.length<=totals.length,'Select receipt quantities');
 const lines=body.lines.map(line=>{check(Number.isInteger(line.index)&&totals[line.index]&&!seen.has(line.index),'Invalid receipt line');seen.add(line.index);const values=['accepted','damaged','missing'].map(key=>Number(line[key]??0));check(values.every(value=>Number.isFinite(value)&&value>=0),'Quantities must be zero or greater');check(values.reduce((a,b)=>a+b,0)<=totals[line.index].outstanding+1e-9,'Receipt exceeds outstanding quantity');const replacementIssueId=String(line.replacementIssueId||'');if(replacementIssueId){const issue=deliveryIssues(order).find(issue=>issue.id===replacementIssueId);check(issue&&issue.index===line.index&&issue.status!=='resolved'&&values[0]>0&&values[0]<=issue.remaining+1e-9,'Choose an open issue and a replacement quantity within its remaining amount');}return {replacementIssueId,index:line.index,description:totals[line.index].description,accepted:values[0],damaged:values[1],missing:values[2]};});
 check(lines.some(line=>line.accepted+line.damaged+line.missing>0),'Enter a received, damaged or missing quantity');
 const notes=String(body.notes||'').trim();check(notes.length<=1000,'Notes must be 1000 characters or less');
 const attachmentIds=[...new Set(Array.isArray(body.attachmentIds)?body.attachmentIds:[])];check(attachmentIds.length<=10&&attachmentIds.every(id=>(order.attachments||[]).some(file=>file.id===id)),'Choose files attached to this order');
 const receipt={id:body.id,by:actor.username,at:new Date().toISOString(),lines,notes,attachmentIds};
 const updated={...order,receipts:[...(order.receipts||[]),receipt],updatedAt:nextOrderStamp(order),updatedBy:actor.username};
 const outstanding=receiptSummary(updated).reduce((sum,line)=>sum+line.outstanding,0),issues=lines.some(line=>line.damaged||line.missing);
 orders[index]=updated;
 store.ctx.storage.transactionSync(()=>{store.write('orders',orders);issueResolutionNotifications(store,order,updated,actor);store.audit(actor.username,'order-received',{orderId:id,receiptId:receipt.id,outstanding,issues});const recipients=Object.entries(store.read('users',{})).filter(([username,user])=>user.active!==false&&username!==actor.username&&(user.isAdmin||store.taskAccess(username,user.isAdmin)['site.orders.manage']===true)).map(([username])=>username);store.notify(recipients,{title:`Order #${order.orderNumber}: ${outstanding?'partial receipt':'fully received'}`,message:`${order.project} · received by ${actor.username}${issues?' · missing or damaged items reported':''} · ${outstanding} outstanding`,kind:'orders',priority:issues?'important':'normal',link:'orders'});});
 return {ok:true,order:{...updated,deliveryIssues:deliveryIssues(updated)},receipt};
}
