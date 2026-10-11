import {requireCondition as check} from './security.js';

const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const canCommentOnOrder=(actor,order)=>!!(actor.isAdmin||actor.tasks?.['site.orders.manage']===true||order.requestedBy===actor.username&&actor.tasks?.['site.orders.create']===true);
// Discussion is separate from order definitions, production progress and exports.
export function orderComments(store,orderId,method,body,actor){
  store.requireTask(actor,'site.orders.view');
  const order=store.read('orders',[]).find(value=>value.id===orderId);
  check(order,'Order request not found',404);
  const key='order-comments:'+orderId;
  const result=comments=>({ok:true,orderId,canComment:canCommentOnOrder(actor,order),comments});
  if(method==='GET')return result(store.read(key,[]));
  check(method==='POST','Method not allowed',405);
  check(canCommentOnOrder(actor,order),'Only the requester or an order manager can comment',403);
  check(validId(body.id),'Invalid comment identifier');
  check(typeof body.text==='string'&&body.text.trim().length>0&&body.text.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.text),'Enter a comment between 1 and 2000 characters');
  check(['comment','clarification'].includes(body.kind),'Choose a comment or clarification question');
  const replyTo=body.replyTo||'';
  check(!replyTo||validId(replyTo),'Invalid reply identifier');
  check(!replyTo||body.kind==='comment','A reply must be a comment');
  const value={id:body.id,text:body.text.trim(),kind:body.kind,replyTo,author:actor.username,createdAt:new Date().toISOString()};
  return store.ctx.storage.transactionSync(()=>{
    const comments=store.read(key,[]),existing=comments.find(comment=>comment.id===value.id);
    if(existing){check(['text','kind','replyTo','author'].every(field=>existing[field]===value[field]),'Comment identifier is already in use',409);return result(comments);}
    if(replyTo)check(comments.some(comment=>comment.id===replyTo&&!comment.replyTo),'The original comment is unavailable',404);
    check(comments.length<500,'This discussion has reached its 500 comment limit',409);
    comments.push(value);store.write(key,comments);
    store.audit(actor.username,'order-comment-added',{orderId,commentId:value.id,kind:value.kind,replyTo});
    const users=store.read('users',{}),participants=new Set([order.requestedBy,...comments.map(comment=>comment.author)]);
    const recipients=Object.keys(users).filter(username=>{
      if(username===actor.username||users[username].active===false)return false;
      const tasks=store.taskAccess(username,!!users[username].isAdmin);
      return tasks['site.orders.view']===true&&(participants.has(username)||tasks['site.orders.manage']===true||users[username].isAdmin);
    });
    store.notify(recipients,{title:`Order #${order.orderNumber}: ${replyTo?'new reply':value.kind==='clarification'?'clarification requested':'new comment'}`,message:`${order.project} · ${actor.username}: ${value.text}`,kind:'orders',priority:value.kind==='clarification'?'important':'normal',link:'orders',orderId});
    return result(comments);
  });
}
