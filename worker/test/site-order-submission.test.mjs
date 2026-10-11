import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {File} from 'node:buffer';
import {webcrypto,randomUUID} from 'node:crypto';
import {orderAttachment} from '../src/order-attachments.js';

const orderId='11111111-1111-4111-8111-111111111111';
const order={id:orderId,orderNumber:'42',project:'Airport',orderType:'Panels',status:'submitted',requestedBy:'alice',createdAt:'2026-10-01',items:[{quantity:2,description:'Panels'}],attachments:[]};
const attachment=(name='drawing.pdf')=>{const file=new File(['sample drawing'],name);return {metadata:{id:randomUUID(),name,size:file.size},file};};
const packet=(id='request-a',files=[])=>({localId:id,idempotencyKey:'stable-'+id,order:{...order,id:undefined,orderNumber:undefined},attachments:files.map(value=>({...value.metadata})),createdAt:order.createdAt});
const outboxKey='panelstock:site-orders:outbox:v1';
function server(){
 const docs=new Map([['orders',[structuredClone(order)]]]),objects=new Map(),audits=[],keys=new Map();
 const actor={username:'alice',tasks:{'site.orders.view':true,'site.orders.create':true}};
 const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask:(_,task)=>assert.equal(actor.tasks[task],true),audit:(...args)=>audits.push(args),ctx:{storage:{transactionSync:fn=>fn()}},env:{CAD_PROJECT_FILES:{put:async(key,bytes)=>objects.set(key,bytes),get:async key=>objects.get(key),delete:async key=>objects.delete(key)}}};
 async function api(path,options){
  if(path==='/orders'&&options?.method==='POST'){
   const body=JSON.parse(options.body);let result=keys.get(body.idempotencyKey);
   if(!result){result={...order,...body.order,id:keys.size?randomUUID():orderId,orderNumber:String(42+keys.size),attachments:[]};keys.set(body.idempotencyKey,result);docs.set('orders',[result,...store.read('orders').filter(value=>value.id!==result.id)]);}
   return Response.json({order:result});
  }
  const id=path.split('/')[2],saved=store.read('orders').find(value=>value.id===id);
  if(!saved)return Response.json({error:'Order not found'},{status:404});
  if(path.endsWith('/attachments'))return Response.json(await orderAttachment(store,id,null,'POST',JSON.parse(options.body),actor));
  return Response.json({order:saved});
 }
 return {api,docs,store,objects,audits,keys};
}
function harness({saved=new Map(),files=new Map(),backend=server()}={}){
 let failStorage=false,reads=[],writes=[],requests=[],renders=0,refreshes=0;
 const controls=new Map(),queueNode={innerHTML:''},orderNode={innerHTML:''};
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>{if(failStorage)throw Error('Device storage full');saved.set(key,value);},removeItem:key=>saved.delete(key)};
 const root={innerHTML:'Unfinished form',appendChild(){},addEventListener(){},querySelector:selector=>controls.get(selector)||null,querySelectorAll:selector=>selector==='[data-submission-queue]'?[queueNode]:selector==='[data-submission-order]'?[orderNode]:[]};
 const context={console,URL,Headers,Response,AbortSignal,Map,Set,Date,Promise,Uint8Array,File,
  FileReader:class{readAsDataURL(file){file.arrayBuffer().then(bytes=>{this.result="data:application/octet-stream;base64,"+Buffer.from(bytes).toString("base64");this.onload();}).catch(()=>this.onerror());}},
  document:{getElementById:()=>root,createElement:()=>({textContent:''}),head:root,body:root,querySelectorAll:()=>[]},localStorage:storage,sessionStorage:storage,navigator:{onLine:true},window:{addEventListener(){}},MutationObserver:class{observe(){}},crypto:{subtle:webcrypto.subtle,randomUUID}};
 let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
 source=source.split("  window.addEventListener('online'")[0]+`
  session={username:'alice',token:'synthetic',taskAccess:{'site.orders.view':true,'site.orders.create':true,'site.orders.receive':false}};
  globalThis.ui={flush,reattachSubmissionFile,omitSubmissionFile,submissionQueueContent,orderList,clearAccountState,
   setData(packets,owner='alice'){outbox={owner,queue:packets};saveOutbox();},setApi(fn){api=fn;},setStorage(fn){attachmentDb=fn;},setRefresh(fn){refresh=fn;},
   setRender(fn){render=fn;},setLoaders(fn){loadOrderHistory=fn;loadProductionProgress=fn;},
   setView(value){view=value;},setOrders(value){orders=value;},select(id){selectedOrderId=id;view='order';},
   setDraftApi(fn){draftApi=fn;},setOnline(value){navigator.onLine=value;},
   state:()=>({outbox,orders,message,busy,submissionState,fileRecovery,selectedOrderId}),wireSubmissionRecovery};
 })();`;
 vm.runInNewContext(source,context);const ui=context.ui;
 ui.setApi(async(path,options)=>{requests.push({path,options});return backend.api(path,options);});
 const db=async(action,values)=>{if(action==='get'){reads.push(values);return files.get(values);}writes.push({action,values});for(const value of values){if(action==='put')files.set(value.id,value.file);else files.delete(value.id);}};
 ui.setStorage(db);ui.setRender(()=>{renders++;root.innerHTML='Rendered';});ui.setRefresh(async()=>{refreshes++;});ui.setLoaders(()=>{});
 function seed(value,owner='alice'){ui.setData(value,owner);}
 const durable=()=>JSON.parse(saved.get(outboxKey));
 return {...ui,seed,saved,files,backend,requests,reads,writes,db,root,queueNode,orderNode,durable,failStorage(value=true){failStorage=value;},renders:()=>renders,refreshes:()=>refreshes};
}

function seedFiles(h,values){for(const value of values)h.files.set(value.metadata.id,value.file);}

test('partial failure checkpoints uploaded files and a reload retries only remaining work',async()=>{
 const first=attachment(),second=attachment('photo.jpg'),h=harness();seedFiles(h,[first,second]);h.seed([packet('first',[first,second])]);
 let fail=true;h.setApi(async(path,options)=>{h.requests.push({path,options});if(path.endsWith('/attachments')&&JSON.parse(options.body).id===second.metadata.id&&fail)return Response.json({error:'Upload interrupted'},{status:503});return h.backend.api(path,options);});
 await h.flush();assert.equal(h.state().outbox.queue.length,1);assert.equal(h.durable().queue[0].orderId,orderId);assert.equal(h.durable().queue[0].attachments[0].uploaded,true);assert.equal(h.state().outbox.queue[0].error.fileId,second.metadata.id);
 assert.match(h.queueNode.innerHTML,/1 of 2 files uploaded/);assert.match(h.queueNode.innerHTML,/Uploaded/);assert.match(h.queueNode.innerHTML,/Retry file/);
 const resumed=harness({saved:h.saved,files:h.files,backend:h.backend});await resumed.flush();
 assert.equal(resumed.state().outbox.queue.length,0);assert.equal(resumed.backend.objects.size,2);
 assert.equal(resumed.requests.filter(value=>value.path==='/orders'&&value.options?.method==='POST').length,0);
 assert.deepEqual(resumed.reads,[second.metadata.id]);assert.equal(resumed.backend.audits.length,2);
});

test('a lost upload response is reconciled without a second upload even if its device file disappeared',async()=>{
 const file=attachment(),h=harness();seedFiles(h,[file]);h.seed([packet('lost',[file])]);
 h.setApi(async(path,options)=>{h.requests.push({path,options});const response=await h.backend.api(path,options);if(path.endsWith('/attachments'))throw Error('Response lost');return response;});
 await h.flush();assert.equal(h.backend.objects.size,1);assert.equal(h.durable().queue[0].attachments[0].uploaded,undefined);assert.match(h.durable().queue[0].attachments[0].sha256,/^[a-f0-9]{64}$/);
 h.files.clear();const resumed=harness({saved:h.saved,files:h.files,backend:h.backend});await resumed.flush();
 assert.equal(resumed.state().outbox.queue.length,0);assert.equal(resumed.reads.length,0);assert.equal(resumed.requests.filter(value=>value.options?.method==='POST').length,0);assert.equal(h.backend.audits.length,1);
});

test('a lost order confirmation retries the original idempotency key without creating another order',async()=>{
 const h=harness();h.seed([packet('lost-order')]);let lose=true;
 h.setApi(async(path,options)=>{h.requests.push({path,options});const result=await h.backend.api(path,options);if(lose){lose=false;throw Error('Response lost');}return result;});
 await h.flush();assert.equal(h.durable().queue[0].orderId,undefined);await h.flush('lost-order');
 const keys=h.requests.filter(value=>value.path==='/orders').map(value=>JSON.parse(value.options.body).idempotencyKey);
 assert.deepEqual(keys,['stable-lost-order','stable-lost-order']);assert.equal(h.backend.keys.size,1);assert.equal(h.state().outbox.queue.length,0);
});

test('one failed order does not stop independent orders and a targeted retry sends only its request',async()=>{
 const h=harness();h.seed([packet('blocked'),packet('good')]);let fail=true;
 h.setApi(async(path,options)=>{h.requests.push({path,options});if(path==='/orders'&&JSON.parse(options.body).idempotencyKey==='stable-blocked'&&fail)return Response.json({error:'Choose an active project'},{status:400});return h.backend.api(path,options);});
 await h.flush();assert.equal(h.state().outbox.queue.length,1);assert.equal(h.state().outbox.queue[0].localId,'blocked');assert.equal(h.backend.keys.size,1);
 h.state().outbox.queue.push(packet('later'));fail=false;const before=h.requests.length;await h.flush('blocked');
 assert.equal(h.requests.length,before+1);assert.equal(h.state().outbox.queue[0].localId,'later');assert.equal(h.backend.keys.size,2);
});

test('Retry file uploads just that file, while Finish sync sends its remaining siblings',async()=>{
 const values=[attachment('a.txt'),attachment('b.txt'),attachment('c.txt')],h=harness();seedFiles(h,values);
 const request=packet('files',values);request.orderId=orderId;h.seed([request]);await h.flush('files',values[1].metadata.id);
 assert.equal(h.backend.objects.size,1);assert.equal(h.state().outbox.queue.length,1);assert.equal(h.refreshes(),0);assert.match(h.queueNode.innerHTML,/1 of 3 files uploaded/);
 await h.flush('files');assert.equal(h.backend.objects.size,3);assert.equal(h.backend.audits.length,3);assert.equal(h.state().outbox.queue.length,0);
});

test('missing files retain the saved order and offer local reattachment or explicit omission',async()=>{
 const file=attachment(),h=harness();h.seed([packet('missing',[file])]);await h.flush();
 const pending=h.state().outbox.queue[0];assert.equal(pending.orderId,orderId);assert.equal(pending.error.missing,true);assert.equal(h.backend.keys.size,1);
 assert.match(h.queueNode.innerHTML,/Reattach required/);assert.match(h.queueNode.innerHTML,/Reattach drawing.pdf/);assert.match(h.queueNode.innerHTML,/Omit file/);
 const input={dataset:{submissionPacket:'missing',reattachSubmission:file.metadata.id},files:[new File(['replacement'],'replacement.pdf')],value:'selected'};
 await h.reattachSubmissionFile({target:input});assert.equal(pending.attachments[0].id,file.metadata.id);assert.equal(pending.attachments[0].name,'replacement.pdf');assert.equal(input.value,'');
 await h.flush('missing');assert.equal(h.backend.keys.size,1);assert.equal(h.backend.objects.size,1);assert.equal(h.state().outbox.queue.length,0);
});

test('reattachment validation and failed persistence retain the previous metadata and file',async()=>{
 const file=attachment(),h=harness();seedFiles(h,[file]);const request=packet('replace',[file]);request.orderId=orderId;h.seed([request]);
 const input={dataset:{submissionPacket:'replace',reattachSubmission:file.metadata.id},files:[new File([new Uint8Array(5*1024*1024+1)],'too-big.pdf')],value:'selected'};
 await h.reattachSubmissionFile({target:input});assert.equal(h.writes.length,0);assert.match(h.state().fileRecovery.error,/5 MB/);
 input.files=[new File(['replacement'],'new.pdf')];h.failStorage();await h.reattachSubmissionFile({target:input});
 assert.equal(request.attachments[0].name,file.metadata.name);assert.equal(h.files.get(file.metadata.id),file.file);assert.equal(h.files.size,1);assert.match(h.state().fileRecovery.error,/Device storage full/);
});

test('omission requires confirmation, respects uploaded files and rolls back when device save fails',async()=>{
 const first=attachment(),second=attachment('waiting.pdf'),h=harness();seedFiles(h,[first,second]);const request=packet('omit',[first,second]);request.orderId=orderId;request.attachments[0].uploaded=true;h.seed([request]);
 await h.omitSubmissionFile('omit',first.metadata.id);assert.equal(request.attachments.length,2);
 await h.omitSubmissionFile('omit',second.metadata.id);assert.equal(request.attachments.length,2);assert.match(h.queueNode.innerHTML,/Yes, omit file/);
 h.failStorage();await h.omitSubmissionFile('omit',second.metadata.id);assert.equal(request.attachments.length,2);assert.equal(h.files.size,2);
 h.failStorage(false);await h.omitSubmissionFile('omit',second.metadata.id);assert.equal(request.attachments.length,1);assert.equal(request.attachments[0].uploaded,true);assert.deepEqual(Array.from(request.omittedFiles),['waiting.pdf']);assert.equal(h.files.has(first.metadata.id),true);assert.equal(h.files.has(second.metadata.id),false);assert.equal(h.requests.length,0);
});

test('an acknowledgement for another file cannot mark the requested file uploaded',async()=>{
 const file=attachment(),h=harness();seedFiles(h,[file]);h.seed([packet('wrong-ack',[file])]);
 h.setApi(async(path,options)=>{h.requests.push({path,options});const result=await h.backend.api(path,options);return path.endsWith('/attachments')?Response.json({attachment:{id:randomUUID()}}):result;});
 await h.flush();assert.equal(h.state().outbox.queue.length,1);assert.notEqual(h.durable().queue[0].attachments[0].uploaded,true);assert.match(h.state().outbox.queue[0].error.message,/confirmation/);
});

test('storage failure stops more network writes and keeps acknowledged steps for recovery',async()=>{
 const first=attachment(),second=attachment('b.pdf'),h=harness();seedFiles(h,[first,second]);h.seed([packet('storage',[first,second]),packet('next')]);
 h.setApi(async(path,options)=>{h.requests.push({path,options});const result=await h.backend.api(path,options);if(path.endsWith('/attachments'))h.failStorage();return result;});
 await h.flush();assert.equal(h.backend.objects.size,1);assert.equal(h.backend.keys.size,1);assert.equal(h.state().outbox.queue.length,2);assert.equal(h.state().outbox.queue[0].attachments[0].uploaded,true);assert.equal(h.state().outbox.queue[0].error.step,'storage');
 const before=h.requests.length;await h.flush();assert.equal(h.requests.length,before);
});

test('logout while an upload completes cannot write late progress or render another account',async()=>{
 const file=attachment(),h=harness();seedFiles(h,[file]);h.seed([packet('logout',[file])]);let release,started;
 const ready=new Promise(resolve=>{started=resolve;});
 h.setApi(async(path,options)=>{h.requests.push({path,options});const result=await h.backend.api(path,options);if(path.endsWith('/attachments')){started();return new Promise(resolve=>{release=()=>resolve(result);});}return result;});
 const uploading=h.flush();await ready;h.clearAccountState();const before=h.saved.get(outboxKey),renders=h.renders();release();await uploading;
 assert.equal(h.saved.get(outboxKey),before);assert.notEqual(h.state().outbox.queue[0].attachments[0].uploaded,true);assert.equal(h.renders(),renders);assert.equal(h.state().busy,false);assert.deepEqual(Object.keys(h.state().submissionState),[]);
});

test('background progress and completion never replace an active order form',async()=>{
 const file=attachment(),h=harness();seedFiles(h,[file]);h.seed([packet('form',[file])]);h.setView('new');await h.flush();
 assert.equal(h.renders(),0);assert.equal(h.root.innerHTML,'Unfinished form');assert.equal(h.refreshes(),1);
});

test('an offline or different account cannot send or modify another owner’s pending files',async()=>{
 const file=attachment(),h=harness();h.seed([packet('private',[file])],'other');
 assert.equal(h.submissionQueueContent(),'');await h.flush('private');await h.omitSubmissionFile('private',file.metadata.id);await h.reattachSubmissionFile({target:{dataset:{submissionPacket:'private',reattachSubmission:file.metadata.id},files:[file.file]}});
 assert.equal(h.requests.length,0);assert.equal(h.state().outbox.queue[0].attachments.length,1);
 h.seed([packet('private',[file])]);h.setOnline(false);await h.flush();assert.equal(h.requests.length,0);assert.match(h.submissionQueueContent(),/offline/);assert.match(h.submissionQueueContent(),/data-retry-submission="private" disabled/);
});

test('progress escapes names and errors and the list does not duplicate a saved queued order',()=>{
 const file=attachment('<img src=x>.pdf'),h=harness();const request=packet('escape',[file]);request.orderId=orderId;request.order={...order,project:'<script>bad</script>'};request.error={step:'file',fileId:file.metadata.id,message:'<img src=x>'};h.seed([request]);h.setOrders([request.order]);
 const html=h.submissionQueueContent();assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<script>/);
 assert.equal((h.orderList().match(/class="order site-order-tile"/g)||[]).length,1);
});

test('success from local details selects the saved order and changed drafts are retained without repeat submission',async()=>{
 const h=harness(),request=packet('details');request.cloudDraftId='draft';request.cloudDraftVersion='reviewed-version';h.seed([request]);h.select('details');
 h.setDraftApi(async(path,body)=>{assert.equal(path,'/draft/discard');assert.equal(body.expectedUpdatedAt,'reviewed-version');throw Error('This draft changed');});
 await h.flush();assert.equal(h.state().selectedOrderId,orderId);assert.match(h.state().message,/saved draft was retained/);assert.equal(h.state().outbox.queue.length,0);await h.flush();assert.equal(h.backend.keys.size,1);
});

test('a replaced waiting file cannot overwrite a different file already accepted by the server',async()=>{
 const original=attachment(),h=harness();seedFiles(h,[original]);const request=packet('mismatch',[original]);request.orderId=orderId;h.seed([request]);
 await h.backend.api('/orders/'+orderId+'/attachments',{method:'POST',body:JSON.stringify({id:original.metadata.id,name:original.metadata.name,data:Buffer.from(await original.file.arrayBuffer()).toString('base64')})});
 const replacement=new File(['different bytes'],'different.pdf');await h.reattachSubmissionFile({target:{dataset:{submissionPacket:'mismatch',reattachSubmission:original.metadata.id},files:[replacement],value:'selected'}});
 await h.flush('mismatch');assert.equal(h.state().outbox.queue.length,1);assert.match(h.state().outbox.queue[0].error.message,/already uploaded with different details/);assert.equal(h.backend.audits.length,1);assert.equal(h.backend.objects.size,1);
 assert.equal(h.requests.filter(value=>value.path.endsWith('/attachments')).length,0);
});

test('a late reattachment save cannot change a queue after logout and deletes its unused temporary copy',async()=>{
 const original=attachment(),h=harness();seedFiles(h,[original]);h.seed([packet('late-file',[original])]);let release,started;
 const ready=new Promise(resolve=>{started=resolve;});h.setStorage(async(action,values)=>{if(action==='put'){await h.db(action,values);started();await new Promise(resolve=>{release=resolve;});}else return h.db(action,values);});
 const pending=h.reattachSubmissionFile({target:{dataset:{submissionPacket:'late-file',reattachSubmission:original.metadata.id},files:[new File(['new'],'new.pdf')],value:'selected'}});
 await ready;h.clearAccountState();const saved=h.saved.get(outboxKey);release();await pending;
 assert.equal(h.saved.get(outboxKey),saved);assert.equal(h.state().outbox.queue[0].attachments[0].name,original.metadata.name);assert.equal(h.files.size,1);assert.equal(h.files.get(original.metadata.id),original.file);assert.equal(h.state().busy,false);
});

test('reattached content with the same name and size is not silently replaced by an older accepted file',async()=>{
 const original=attachment(),h=harness();seedFiles(h,[original]);const request=packet('same-details',[original]);request.orderId=orderId;h.seed([request]);
 await h.backend.api('/orders/'+orderId+'/attachments',{method:'POST',body:JSON.stringify({id:original.metadata.id,name:original.metadata.name,data:Buffer.from(await original.file.arrayBuffer()).toString('base64')})});
 await h.reattachSubmissionFile({target:{dataset:{submissionPacket:'same-details',reattachSubmission:original.metadata.id},files:[new File([Buffer.alloc(original.file.size,120)],original.metadata.name)],value:'selected'}});
 assert.match(request.attachments[0].sha256,/^[a-f0-9]{64}$/);await h.flush('same-details');
 assert.equal(h.state().outbox.queue.length,1);assert.equal(h.durable().queue[0].attachments[0].uploaded,undefined);assert.match(request.error.message,/already uploaded with different details/);assert.equal(h.backend.objects.size,1);assert.equal(h.backend.audits.length,1);
});

test('finishing an acknowledged request still checks that its saved order exists',async()=>{
 const h=harness(),request=packet('removed-order');request.orderId=orderId;h.seed([request]);h.backend.docs.set('orders',[]);
 await h.flush('removed-order');assert.equal(h.state().outbox.queue.length,1);assert.equal(h.backend.keys.size,0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].path,'/orders/'+orderId);assert.match(request.error.message,/Order not found/);assert.doesNotMatch(h.state().message,/submitted/);
});
