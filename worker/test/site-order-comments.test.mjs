import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {orderComments} from '../src/order-comments.js';
const order={id:randomUUID(),orderNumber:'42',project:'Airport',requestedBy:'alice',orderType:'Panels'};
const access={'site.orders.view':true,'site.orders.create':true,'site.orders.manage':false};
function harness(saved=new Map()){
 let failStorage=false,calls=0;
 const fields={text:{value:'',disabled:false},kind:{value:'comment'},send:{},cancel:{},label:{},list:{innerHTML:''},notice:{},refresh:{}};
 const form={dataset:{commentForm:order.id},querySelector:selector=>({'[name=commentText]':fields.text,'[name=commentKind]':fields.kind,'[type=submit]':fields.send,'[data-cancel-comment-reply]':fields.cancel,'[data-comment-reply-label]':fields.label})[selector],addEventListener(){}};
 const section={dataset:{orderDiscussion:order.id},querySelector:selector=>({'[data-comment-form]':form,'[data-comment-list]':fields.list,'[data-comment-notice]':fields.notice,'[data-refresh-comments]':fields.refresh})[selector],querySelectorAll:()=>[]};
 const root={querySelector:selector=>selector==='[data-comment-form]'?form:selector==='[data-order-discussion]'?section:null,querySelectorAll:()=>[],appendChild(){},addEventListener(){}};
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>{if(failStorage)throw Error('Storage full');saved.set(key,value);},removeItem:key=>saved.delete(key)};
 const context={console,URL,Headers,Response,AbortSignal,Date,Map,Set,Promise,crypto:{randomUUID},localStorage:storage,sessionStorage:storage,navigator:{onLine:true},document:{getElementById:()=>root,createElement:()=>({textContent:''}),head:root,body:root,querySelectorAll:()=>[]},window:{addEventListener(){}},MutationObserver:class{observe(){}}};
 let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
 source=source.split("  window.addEventListener('pagehide'")[0]+`
 session={username:'alice',token:'synthetic',taskAccess:${JSON.stringify(access)}};orders=[${JSON.stringify(order)}];selectedOrderId=${JSON.stringify(order.id)};view='order';
 globalThis.ui={commentDraft,captureComment,sendOrderComment,loadOrderComments,orderDiscussion,updateCommentUI,clearAccountState,
  setApi(fn){api=fn;},setUser(username,tasks=${JSON.stringify(access)}){session={username,taskAccess:tasks};},setView(v,id){view=v;selectedOrderId=id;},setOnline(v){navigator.onLine=v;},
  setState(id,state){commentStates[id]=state;},state:()=>({commentStates,commentDrafts,session,sessionVersion})};render=()=>{captureComment();};})();`;
 vm.runInNewContext(source,context);const ui=context.ui;
 const docs=new Map([['orders',[order]],['users',{alice:{},office:{}}]]),alerts=[];
 const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask(){},taskAccess:username=>username==='office'?{'site.orders.view':true,'site.orders.manage':true}:access,audit(){},notify:(...args)=>alerts.push(args),ctx:{storage:{transactionSync:fn=>fn()}}};
 const backend=async(path,options)=>{calls++;try{return Response.json(orderComments(store,path.split('/')[2],options?.method||'GET',options?.body?JSON.parse(options.body):{},{username:'alice',tasks:access}));}catch(error){return Response.json({error:error.message},{status:error.status||400});}};
 ui.setApi(backend);
 return {...ui,fields,form,section,root,saved,docs,alerts,backend,calls:()=>calls,failStorage:()=>{failStorage=true;},send:()=>ui.sendOrderComment({preventDefault(){},currentTarget:form})};
}
test('unsent messages survive reload and stay scoped to account and order',()=>{
 const h=harness();h.fields.text.value='Keep my question';h.fields.kind.value='clarification';h.captureComment();const id=h.commentDraft(order.id).id;
 const restored=harness(h.saved);assert.equal(restored.commentDraft(order.id).text,'Keep my question');assert.equal(restored.commentDraft(order.id).id,id);assert.equal(restored.commentDraft(randomUUID()).text,'');
 restored.fields.text.value='Keep my question';restored.fields.kind.value='clarification';restored.clearAccountState();restored.setUser('bob');assert.equal(restored.commentDraft(order.id).text,'');assert.equal(JSON.parse(h.saved.get('panelstock:site-orders:comment:v1:alice:'+order.id)).text,'Keep my question');
});
test('lost confirmations retry the same ID and create one post and notification',async()=>{
 const h=harness();h.fields.text.value='Confirm satin white?';h.fields.kind.value='clarification';let first=true;
 h.setApi(async(...args)=>{const result=await h.backend(...args);if(first){first=false;throw Error('Response lost');}return result;});
 await h.send();const id=h.commentDraft(order.id).id;assert.match(h.fields.notice.textContent,/Response lost/);assert.equal(h.fields.text.value,'Confirm satin white?');
 await h.send();assert.equal(h.docs.get('order-comments:'+order.id).length,1);assert.equal(h.docs.get('order-comments:'+order.id)[0].id,id);assert.equal(h.alerts.length,1);assert.equal(h.fields.text.value,'');assert.equal(h.commentDraft(order.id).text,'');assert.equal(h.fields.notice.textContent,'Message sent.');
});
test('editing after a failed send uses a new ID and a wrong acknowledgement retains the draft',async()=>{
 const h=harness();h.fields.text.value='First';h.setApi(async()=>Response.json({orderId:'wrong',comments:[]}));await h.send();const first=h.commentDraft(order.id).id;assert.match(h.fields.notice.textContent,/could not be verified/);
 h.fields.text.value='Edited';h.captureComment();assert.notEqual(h.commentDraft(order.id).id,first);assert.equal(h.fields.text.value,'Edited');assert.equal(h.commentDraft(order.id).text,'Edited');
});
test('discussion refresh updates only its thread and preserves the active message form',async()=>{
 const h=harness();h.fields.text.value='Unfinished';h.captureComment();const form=h.form;await h.loadOrderComments(order.id);
 assert.equal(h.form,form);assert.equal(h.fields.text.value,'Unfinished');assert.equal(h.fields.list.innerHTML,'<p>No comments yet.</p>');assert.equal(h.commentDraft(order.id).text,'Unfinished');
});
test('out-of-order refreshes and a refresh racing a post cannot overwrite newer discussion',async()=>{
 const h=harness();let resolve;h.setApi(()=>new Promise(done=>{resolve=done;}));const old=h.loadOrderComments(order.id);
 h.setApi(h.backend);h.fields.text.value='New message';await h.send();resolve(Response.json({orderId:order.id,comments:[],canComment:true}));await old;
 assert.equal(h.state().commentStates[order.id].comments.length,1);assert.match(h.fields.list.innerHTML,/New message/);
 let end;h.setApi(()=>new Promise(done=>{end=done;}));const first=h.loadOrderComments(order.id);h.setApi(h.backend);await h.loadOrderComments(order.id);end(Response.json({orderId:order.id,comments:[],canComment:true}));await first;assert.equal(h.state().commentStates[order.id].comments.length,1);
});
test('late send after logout leaves the old account draft intact and cannot affect a new account',async()=>{
 const h=harness();h.fields.text.value='Old account';let finish;h.setApi(()=>new Promise(resolve=>{finish=resolve;}));const pending=h.send();const payload={...h.commentDraft(order.id)};
 h.clearAccountState();h.setUser('bob');finish(Response.json({orderId:order.id,comments:[{...payload,author:'alice',createdAt:'2026-10-01'}],canComment:true}));await pending;
 assert.equal(h.state().session.username,'bob');assert.equal(h.state().commentStates[order.id],undefined);assert.equal(h.commentDraft(order.id).text,'');assert.equal(JSON.parse(h.saved.get('panelstock:site-orders:comment:v1:alice:'+order.id)).text,'Old account');
});
test('offline and storage failures keep text without issuing requests; revoked writers cannot post',async()=>{
 const h=harness();h.fields.text.value='Saved offline';h.setOnline(false);await h.send();assert.equal(h.calls(),0);assert.match(h.fields.notice.textContent,/Connect/);
 h.setOnline(true);h.failStorage();h.fields.text.value='Updated without storage';h.captureComment();assert.match(h.fields.notice.textContent,/free some storage/);h.fields.text.value='Saved offline';await h.send();assert.equal(h.calls(),0);assert.equal(h.commentDraft(order.id).text,'Saved offline');assert.match(h.fields.notice.textContent,/free some storage/);
 const denied=harness();denied.fields.text.value='No permission';denied.setState(order.id,{canComment:false});await denied.send();assert.equal(denied.calls(),0);denied.setUser('viewer',{'site.orders.view':true});await denied.send();assert.equal(denied.calls(),0);
});
test('thread rendering escapes untrusted text, groups replies and keeps local orders unavailable',()=>{
 const h=harness(),question={id:randomUUID(),text:'<img src=x onerror=bad()>',kind:'clarification',replyTo:'',author:'<script>',createdAt:'2026-10-01'};
 h.setState(order.id,{comments:[question,{...question,id:randomUUID(),replyTo:question.id,text:'Answer'}],canComment:true});const html=h.orderDiscussion(order);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/site-comment-reply/);assert.match(html,/Clarification question/);assert.match(h.orderDiscussion({...order,local:true}),/Finish syncing/);
});
test('reply metadata survives reload and never turns a reply into a new question',async()=>{
 const h=harness(),question={id:randomUUID(),text:'Confirm finish?',kind:'clarification',replyTo:'',author:'office',createdAt:'2026-10-01'};h.docs.set('order-comments:'+order.id,[question]);
 const draft=h.commentDraft(order.id);draft.replyTo=question.id;h.fields.text.value='Satin white';h.fields.kind.value='clarification';h.captureComment();assert.equal(draft.kind,'comment');
 const restored=harness(h.saved);assert.equal(restored.commentDraft(order.id).replyTo,question.id);await h.send();assert.equal(h.docs.get('order-comments:'+order.id)[1].replyTo,question.id);assert.equal(h.commentDraft(order.id).replyTo,'');
});
