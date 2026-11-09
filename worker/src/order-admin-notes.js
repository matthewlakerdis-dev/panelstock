import {requireCondition as check} from './security.js';
const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function orderAdminNotes(store,orderId,method,body,actor){
 store.requireTask(actor,'site.orders.view');
 const order=store.read('orders',[]).find(value=>value.id===orderId);check(order,'Order request not found',404);
 check(actor.isAdmin||order.requestedBy===actor.username,'Only administrators and the requester can read admin notes',403);
 const key='order-admin-notes:'+orderId,result=notes=>({ok:true,orderId,canAdd:actor.isAdmin===true,notes});
 if(method==='GET')return result(store.read(key,[]));
 check(method==='POST','Method not allowed',405);check(actor.isAdmin,'Only administrators can add admin notes',403);
 check(validId(body.id),'Invalid note identifier');
 check(typeof body.text==='string'&&body.text.trim().length>0&&body.text.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.text),'Enter a note between 1 and 2000 characters');
 const note={id:body.id,text:body.text.trim(),author:actor.username,createdAt:new Date().toISOString()};
 return store.ctx.storage.transactionSync(()=>{
  const notes=store.read(key,[]),existing=notes.find(value=>value.id===note.id);
  if(existing){check(existing.text===note.text&&existing.author===note.author,'Note identifier is already in use',409);return result(notes);}
  check(notes.length<500,'This order has reached its 500 admin note limit',409);
  notes.push(note);store.write(key,notes);store.audit(actor.username,'order-admin-note-added',{orderId,noteId:note.id});
  if(order.requestedBy&&order.requestedBy!==actor.username)store.notify([order.requestedBy],{title:`Order #${order.orderNumber}: admin note added`,message:`${order.project} · ${note.text}`,kind:'orders',link:'orders',orderId});
  return result(notes);
 });
}
