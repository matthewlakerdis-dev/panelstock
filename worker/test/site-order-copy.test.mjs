import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {handleOrderDrafts} from '../src/order-drafts.js';
const sourceOrder={id:randomUUID(),orderNumber:'42',projectId:'airport',project:'Airport',orderType:'Other',orderTypeOther:'Safety signage',siteContact:'Taylor',phone:'0400 000 000',locationNotes:'Gate 2\nCall first',items:[{quantity:3,description:'Signs',id:'old-item',received:3}],requestedDeliveryDate:'2026-10-01',requestedDeliveryTime:'09:00',scheduledDeliveryDate:'2026-10-02',scheduledDeliveryTime:'10:00',requestedBy:'someone-else',status:'completed',createdAt:'old',updatedAt:'old',completedAt:'old',attachments:[{id:randomUUID(),name:'old-approved.pdf',size:10}],receipts:[{id:'receipt',lines:[],attachmentIds:[]}],deliveryIssues:[{id:'issue',status:'open'}],drawingProgress:{drawn:true},comments:[{text:'old'}]};
const draftKey='panelstock:site-orders:draft:v1:alice';
const access={'site.orders.view':true,'site.orders.create':true};
function harness(saved=new Map()){
 let renders=0,failStorage=false,form=null;const requests=[],dbCalls=[],docs=new Map(),fileObjects=new Map();
 const node={innerHTML:'Unfinished other form',addEventListener(){},appendChild(){},querySelector:selector=>selector==='[data-order]'?form:null,querySelectorAll:()=>[]};
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>{if(failStorage)throw Error('Storage full');saved.set(key,value);},removeItem:key=>saved.delete(key)};
 const context={console,URL,Headers,Response,AbortSignal,Date,Map,Set,Promise,crypto:{randomUUID},localStorage:storage,sessionStorage:storage,navigator:{onLine:true},document:{getElementById:()=>node,createElement:()=>({textContent:''}),head:node,body:node,querySelectorAll:()=>[]},window:{addEventListener(){}},MutationObserver:class{observe(){}},FormData:class{constructor(value){this.value=value;}get(key){return this.value[key]||'';}}};
 let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
 source=source.split("  window.addEventListener('pagehide'")[0]+`
 session={username:'alice',token:'synthetic',taskAccess:${JSON.stringify(access)}};orders=[${JSON.stringify(sourceOrder)}];projects=[{id:'airport',name:'Airport'}];selectedOrderId=${JSON.stringify(sourceOrder.id)};view='order';
 globalThis.ui={copiedOrderDraft,copyOrderToDraft,savedDraft,draftCount,submitOrder,orderDetails,clearAccountState,restoreDraftForm,
  setApi(fn){api=fn;},setDraftApi(fn){draftApi=fn;},setDB(fn){attachmentDb=fn;},setRender(fn){render=fn;},setOnline(v){navigator.onLine=v;},setUser(username,tasks=${JSON.stringify(access)}){session={username,taskAccess:tasks};},
  setView(v){view=v;},setProjects(v){projects=v;},setOrders(v){orders=v;},setBusy(v){busy=v;},setOutbox(v){outbox=v;},setDraft(v){orderDraft=v;draftOwner=v?.owner||'';selectedOrderFiles=v?.attachments||[];},
  setCloudDrafts(v){cloudDrafts=v;},state:()=>({orderDraft,draftOwner,selectedOrderFiles,view,message,busy,outbox,cloudDrafts}),setLoadCloud(fn){loadCloudDrafts=fn;}};
 })();`;
 vm.runInNewContext(source,context);const ui=context.ui;
 ui.setRender(()=>{renders++;});ui.setDB(async(...args)=>{dbCalls.push(args);return new Blob(['file']);});
 const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask(actor,task){assert.equal(task,'site.orders.create');assert.equal(actor.tasks[task],true);},ctx:{storage:{transactionSync:fn=>fn()},waitUntil:promise=>promise.catch(()=>{})},env:{CAD_PROJECT_FILES:{put:async(key,bytes)=>fileObjects.set(key,bytes),get:async key=>{const bytes=fileObjects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;},delete:async()=>{}}}};
 const draftApi=async(path,body)=>{requests.push({path:'/order-drafts'+path,body});return handleOrderDrafts(store,'/order-drafts'+path,body===undefined?'GET':'POST',body||{},{username:'alice',tasks:access});};
 ui.setDraftApi(draftApi);ui.setApi(async(path,options)=>{requests.push({path,options});return Response.json({order:sourceOrder});});
 return {...ui,saved,requests,dbCalls,docs,fileObjects,node,draftApi,renders:()=>renders,failStorage:()=>{failStorage=true;},setForm(value){form=value;}};
}
const existing=()=>({id:randomUUID(),owner:'alice',fields:{projectId:'airport',orderType:'Panels',siteContact:'Existing contact'},projectName:'Airport',items:[{quantity:1,description:'Unfinished panels'}],attachments:[],updatedAt:'before'});
test('copy allowlists editable fields and allocates a fresh identity without modifying its source',()=>{
 const h=harness(),before=structuredClone(sourceOrder),copy=h.copiedOrderDraft(sourceOrder,'alice');
 assert.notEqual(copy.id,sourceOrder.id);assert.equal(copy.owner,'alice');assert.equal(copy.fields.orderTypeOther,'Safety signage');assert.equal(copy.fields.projectId,'airport');assert.equal(copy.fields.locationNotes,sourceOrder.locationNotes);
 assert.deepEqual(JSON.parse(JSON.stringify(copy.items)),[{quantity:3,description:'Signs'}]);assert.equal(copy.fields.requestedDeliveryDate,'');assert.equal(copy.fields.requestedDeliveryTime,'');assert.equal(copy.attachments.length,0);
 for(const field of ['status','requestedBy','orderNumber','createdAt','completedAt','scheduledDeliveryDate','receipts','deliveryIssues','drawingProgress','comments','cloudUpdatedAt'])assert.equal(copy[field]??copy.fields[field],undefined);
 copy.items[0].description='New sign';assert.deepEqual(sourceOrder,before);
});
test('online copy uses the latest verified order and creates a durable draft without orders or files writes',async()=>{
 const h=harness();h.setApi(async(path)=>{h.requests.push({path});return Response.json({order:{...sourceOrder,items:[{quantity:4,description:'Latest sign'}]}});});await h.copyOrderToDraft(sourceOrder.id);
 assert.equal(h.state().view,'new');assert.equal(h.savedDraft().items[0].description,'Latest sign');assert.equal(h.state().orderDraft.id,h.savedDraft().id);assert.equal(h.state().busy,false);assert.equal(h.state().selectedOrderFiles.length,0);
 assert.deepEqual(h.requests.map(value=>value.path),['/orders/'+sourceOrder.id]);assert.equal(h.dbCalls.length,0);assert.equal(h.state().outbox.queue.length,0);assert.equal(h.docs.has('orders'),false);assert.match(h.state().message,/new delivery date/);
});
test('offline copy persists its loaded order and reload resumes the same fresh draft',async()=>{
 const h=harness();h.setOnline(false);await h.copyOrderToDraft(sourceOrder.id);const draft=h.savedDraft();assert.equal(h.requests.length,0);assert.equal(h.draftCount(),1);
 const restored=harness(h.saved);assert.equal(restored.savedDraft().id,draft.id);assert.equal(restored.savedDraft().fields.requestedDeliveryDate,'');restored.setUser('bob');assert.equal(restored.savedDraft(),null);
});
test('another draft is saved to the existing private account workflow before it is replaced',async()=>{
 const h=harness(),old=existing();h.saved.set(draftKey,JSON.stringify(old));h.setDraft(old);await h.copyOrderToDraft(sourceOrder.id);
 const archived=h.docs.get('order-drafts:alice:'+old.id);assert.equal(archived.order.items[0].description,'Unfinished panels');assert.notEqual(h.savedDraft().id,old.id);assert.equal(h.state().cloudDrafts.length,1);assert.equal(h.draftCount(),2);assert.match(h.state().message,/previous draft is saved/);
 assert.equal(h.requests.filter(value=>value.body).length,1);assert.equal(h.docs.has('orders'),false);
});
test('offline copying preserves an existing draft and its file metadata',async()=>{
 const h=harness(),old={...existing(),attachments:[{id:randomUUID(),name:'unfinished.pdf',size:4}]};h.saved.set(draftKey,JSON.stringify(old));h.setDraft(old);h.setOnline(false);await h.copyOrderToDraft(sourceOrder.id);
 assert.equal(h.savedDraft().id,old.id);assert.equal(h.state().selectedOrderFiles.length,1);assert.equal(h.state().view,'order');assert.match(h.state().message,/Connect to save your current draft/);assert.equal(h.requests.length,0);assert.equal(h.dbCalls.length,0);
});
test('draft conflicts and account-save limits abort copying without overwriting unfinished work',async()=>{
 for(const message of ['This draft changed. Reopen it before saving.','You can save up to 20 drafts']){
  const h=harness(),old=existing();h.saved.set(draftKey,JSON.stringify(old));h.setDraft(old);h.setDraftApi(async()=>{throw Error(message);});await h.copyOrderToDraft(sourceOrder.id);
  assert.equal(h.savedDraft().id,old.id);assert.equal(h.state().orderDraft.id,old.id);assert.equal(h.state().view,'order');assert.match(h.state().message,new RegExp(message.replaceAll('.','\\.')));
 }
});
test('device storage failure cannot replace an existing draft, and a draft already queued stays queued',async()=>{
 const h=harness(),old=existing();h.saved.set(draftKey,JSON.stringify(old));h.setDraft(old);h.failStorage();await h.copyOrderToDraft(sourceOrder.id);assert.equal(h.savedDraft().id,old.id);assert.equal(h.state().orderDraft.id,old.id);assert.equal(h.state().view,'order');
 const queued=harness(),draft=existing();queued.saved.set(draftKey,JSON.stringify(draft));queued.setDraft(draft);queued.setOutbox({owner:'alice',queue:[{idempotencyKey:draft.id,localId:'queued',order:{items:[]}}]});await queued.copyOrderToDraft(sourceOrder.id);
 assert.notEqual(queued.savedDraft().id,draft.id);assert.equal(queued.state().outbox.queue[0].idempotencyKey,draft.id);assert.equal(queued.requests.filter(value=>value.body).length,0);
});
test('copy failures or a wrong source response leave the current draft intact',async()=>{
 for(const response of [Response.json({error:'Order deleted'},{status:404}),Response.json({order:{...sourceOrder,id:randomUUID()}})]){
  const h=harness(),old=existing();h.saved.set(draftKey,JSON.stringify(old));h.setDraft(old);h.setApi(async()=>response);await h.copyOrderToDraft(sourceOrder.id);
  assert.equal(h.savedDraft().id,old.id);assert.equal(h.state().view,'order');assert.equal(h.requests.filter(value=>value.body).length,0);
 }
});
test('logout and navigation during a copy cannot install old-account data or replace a different form',async()=>{
 for(const logout of [true,false]){
  const h=harness();let finish;h.setApi(()=>new Promise(resolve=>{finish=resolve;}));const copying=h.copyOrderToDraft(sourceOrder.id),renders=h.renders();
  if(logout){h.clearAccountState();h.setUser('bob');}else h.setView('settings');finish(Response.json({order:sourceOrder}));await copying;
  assert.equal(h.saved.get(draftKey),undefined);assert.equal(h.state().orderDraft,null);assert.equal(h.renders(),renders);assert.equal(h.node.innerHTML,'Unfinished other form');assert.equal(h.state().busy,false);
 }
});
test('late account-save completion after logout cannot replace the new account draft',async()=>{
 const h=harness(),old=existing();h.saved.set(draftKey,JSON.stringify(old));h.setDraft(old);let finish;h.setDraftApi(()=>new Promise(resolve=>{finish=resolve;}));
 const copying=h.copyOrderToDraft(sourceOrder.id);while(!finish)await Promise.resolve();h.clearAccountState();h.setUser('bob');const bob={...existing(),owner:'bob'};h.setDraft(bob);
 finish({draft:{updatedAt:'saved',attachments:[]}});await copying;assert.equal(h.state().orderDraft.id,bob.id);assert.equal(JSON.parse(h.saved.get(draftKey)).id,old.id);
});
test('view-only access, busy state and local-only requests cannot start a copy',async()=>{
 const h=harness();h.setUser('alice',{'site.orders.view':true,'site.orders.create':false});assert.doesNotMatch(h.orderDetails(),/data-copy-order/);await h.copyOrderToDraft(sourceOrder.id);assert.equal(h.requests.length,0);
 h.setUser('alice',access);h.setBusy(true);await h.copyOrderToDraft(sourceOrder.id);h.setBusy(false);h.setOrders([{...sourceOrder,local:true}]);await h.copyOrderToDraft(sourceOrder.id);assert.equal(h.requests.length,0);
});
test('legacy names match available projects and unavailable project IDs and custom types remain reviewable',()=>{
 const h=harness();const legacy=h.copiedOrderDraft({...sourceOrder,projectId:null},'alice');assert.equal(legacy.fields.projectId,'airport');
 h.setProjects([]);const closed=h.copiedOrderDraft(sourceOrder,'alice');assert.equal(closed.fields.projectId,'airport');assert.equal(closed.projectName,'Airport');assert.equal(closed.fields.orderTypeOther,'Safety signage');
 assert.equal(h.copiedOrderDraft({...sourceOrder,orderType:'Fixings'},'alice').fields.orderTypeOther,'');
});
test('blank delivery dates stop submission before any queued request is created',async()=>{
 const h=harness();await h.copyOrderToDraft(sourceOrder.id);const draft=h.savedDraft();await h.submitOrder({preventDefault(){},currentTarget:{...draft.fields}});
 assert.match(h.state().message,/Choose a requested delivery date/);assert.equal(h.state().outbox.queue.length,0);assert.equal(h.savedDraft().id,draft.id);
});

test('a type-only or date-only edit is protected even before any items are entered',async()=>{
 for(const fields of [{orderType:'Fixings'},{requestedDeliveryDate:'2099-10-15'}]){
  const h=harness(),old={...existing(),fields,projectName:'',items:[{quantity:'1',description:''}]};h.setDraft(old);h.setOnline(false);await h.copyOrderToDraft(sourceOrder.id);
  assert.equal(h.state().orderDraft.id,old.id);assert.equal(h.state().view,'order');assert.match(h.state().message,/Connect to save your current draft/);
 }
});
