import test from 'node:test';
import assert from 'node:assert/strict';
import {orderAttachment} from '../src/order-attachments.js';
import {enqueueOrderEmail,saveOrderEmailConfig,finalizeOrderEmailAttachments,processOrderEmails,retryOrderEmail} from '../src/order-email.js';
const order={id:'11111111-1111-4111-8111-111111111111',orderNumber:'7',project:'Attachment test',requestedBy:'creator',orderType:'Gate',requestedDeliveryDate:'2026-11-03',siteContact:'Taylor',phone:'123',items:[{quantity:2,description:'GATES'}]};
const actor={username:'creator',tasks:{'site.orders.view':true,'site.orders.create':true}},admin={username:'admin',isAdmin:true};
function fixture(){
 const docs=new Map([['orders',[structuredClone(order)]],['users',{creator:{displayName:'Creator',email:'creator@example.com'}}]]),objects=new Map(),audits=[];
 const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),audit:(...args)=>audits.push(args),requireTask:(user,task)=>{if(!user.isAdmin&&!user.tasks?.[task])throw Error('Permission denied');},ctx:{storage:{transactionSync:fn=>fn()}},env:{EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic',ORDER_FROM_EMAIL:'orders@example.com',CAD_PROJECT_FILES:{put:async(key,bytes)=>objects.set(key,new Uint8Array(bytes)),head:async key=>objects.has(key)?{size:objects.get(key).length}:null,get:async key=>objects.has(key)?{size:objects.get(key).length,arrayBuffer:async()=>objects.get(key).slice().buffer}:null,delete:async key=>objects.delete(key)}}};
 saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);
 const upload=async(name,content,id=crypto.randomUUID())=>{const result=await orderAttachment(store,order.id,null,'POST',{id,name,data:btoa(content)},actor);return result.attachment;};
 const finalize=(batchId,ids,omitted=[])=>finalizeOrderEmailAttachments(store,order.id,{batchId,attachmentIds:ids,omittedAttachmentIds:omitted},actor);
 return {store,docs,objects,audits,upload,finalize,job:id=>store.read('order-email:'+(id||order.id))};
}
async function body(options){return typeof options.body==='string'?options.body:await new Response(options.body).text();}
test('an original order waits for uploads and finalization, then emails the PDF and exact private files to the original recipients and CC',async()=>{
 const f=fixture(),ids=[crypto.randomUUID(),crypto.randomUUID()],batchId=crypto.randomUUID();enqueueOrderEmail(f.store,order,{attachmentBatchId:batchId,expectedAttachmentIds:ids,filesFinalized:false});
 await processOrderEmails(f.store,()=>assert.fail('must wait for files'));assert.equal(f.job().status,'waiting_files');assert.equal(f.job().firstAttemptAt,undefined);
 await f.upload('drawing.pdf','%PDF-file',ids[0]);assert.throws(()=>f.finalize(batchId,ids),/Finish uploading/);await f.upload('photo.jpg','\x00\xffphoto',ids[1]);
 await processOrderEmails(f.store,()=>assert.fail('must wait for finalization'));f.finalize(batchId,ids);
 saveOrderEmailConfig(f.store,{enabled:true,recipients:['changed@example.com']},admin);let payload;
 await processOrderEmails(f.store,async(url,options)=>{payload=JSON.parse(await body(options));return Response.json({id:'provider'});});
 assert.deepEqual(payload.to,['office@example.com']);assert.deepEqual(payload.cc,['creator@example.com']);assert.equal(payload.attachments.length,3);assert.match(atob(payload.attachments[0].content),/^%PDF/);assert.equal(payload.attachments[1].filename,'drawing.pdf');assert.equal(atob(payload.attachments[1].content),'%PDF-file');assert.equal(atob(payload.attachments[2].content),'\x00\xffphoto');
 assert.equal(f.job().status,'sent');assert.equal(f.job().payload.attachments.length,1);assert.equal(f.finalize(batchId,ids).unchanged,true);
});
test('files added later send one follow-up with only the new files and the PDF; retries preserve every byte',async()=>{
 const f=fixture();enqueueOrderEmail(f.store,order);await processOrderEmails(f.store,async()=>Response.json({id:'original'}));const one=await f.upload('new.dwg','CAD DATA'),two=await f.upload('details.xlsx','EXCEL DATA'),batchId=crypto.randomUUID(),queued=f.finalize(batchId,[one.id,two.id]);
 const bodies=[],keys=[],now=Date.now();await processOrderEmails(f.store,async(url,options)=>{bodies.push(await body(options));keys.push(options.headers['Idempotency-Key']);throw Error('Lost provider response');},now);
 assert.equal(f.job(queued.emailJobId).status,'retrying');f.store.env.ORDER_FROM_EMAIL='changed@example.com';const changed=f.store.read('orders');changed[0].items[0].description='CHANGED AFTER QUEUED';f.store.write('orders',changed);
 await processOrderEmails(f.store,async(url,options)=>{bodies.push(await body(options));keys.push(options.headers['Idempotency-Key']);return Response.json({id:'follow-up'});},now+16*60000);
 assert.equal(bodies[0],bodies[1]);assert.equal(keys[0],keys[1]);assert.notEqual(keys[0],'order-created-'+order.id);const sent=JSON.parse(bodies[0]);assert.match(sent.subject,/Additional files/);assert.equal(sent.attachments.length,3);assert.equal(sent.from,'orders@example.com');assert.match(sent.text,/GATES/);assert.doesNotMatch(sent.text,/CHANGED AFTER/);
 f.finalize(batchId,[one.id,two.id]);f.finalize(crypto.randomUUID(),[one.id,two.id]);assert.equal(f.store.read('order-email-jobs').length,2);await processOrderEmails(f.store,()=>assert.fail('must not resend sent batches'),now+20*60000);
});
test('omitted files require explicit original IDs and cannot silently discard uploaded files',async()=>{
 const f=fixture(),id=crypto.randomUUID(),omitted=crypto.randomUUID(),batchId=crypto.randomUUID();enqueueOrderEmail(f.store,order,{attachmentBatchId:batchId,expectedAttachmentIds:[id,omitted],filesFinalized:false});await f.upload('drawing.pdf','PDF',id);
 assert.throws(()=>f.finalize(batchId,[id]),/explicitly omit/);assert.throws(()=>f.finalize(batchId,[],[id,omitted]),/uploaded file cannot be omitted/);f.finalize(batchId,[id],[omitted]);assert.equal(f.job().files.length,1);assert.deepEqual(f.job().omittedAttachmentIds,[omitted]);assert.throws(()=>f.finalize(batchId,[id,omitted]),/different files/);
});
test('missing or corrupt private files never fall back to a PDF-only email and expired attempts require review',async()=>{
 const f=fixture(),file=await f.upload('drawing.pdf','PDF'),queued=f.finalize(crypto.randomUUID(),[file.id]),key=[...f.objects.keys()][0];f.objects.delete(key);
 await processOrderEmails(f.store,()=>assert.fail('missing file must not reach provider'));assert.equal(f.job(queued.emailJobId).status,'failed');assert.equal(f.job(queued.emailJobId).firstAttemptAt,undefined);
 f.objects.set(key,new Uint8Array([1,2,3]));retryOrderEmail(f.store,{id:queued.emailJobId},admin);let calls=0;const now=Date.now();await processOrderEmails(f.store,async(url,options)=>{calls++;await body(options);return Response.json({id:'must-not-accept-corrupt'});},now);
 assert.equal(calls,1);assert.equal(f.job(queued.emailJobId).status,'retrying');await processOrderEmails(f.store,()=>assert.fail('must stop ambiguous late retries'),now+24*3600000);assert.equal(f.job(queued.emailJobId).status,'needs_review');
});
test('attachment finalization enforces order ownership, immutable batch IDs and file membership',async()=>{
 const f=fixture(),file=await f.upload('photo.jpg','PHOTO'),batchId=crypto.randomUUID();assert.throws(()=>finalizeOrderEmailAttachments(f.store,order.id,{batchId,attachmentIds:[file.id]},{username:'other',tasks:actor.tasks}),/requester or an order manager/);
 assert.throws(()=>f.finalize(batchId,[crypto.randomUUID()]),/Finish uploading/);assert.throws(()=>f.finalize('bad',[file.id]),/batch ID/);assert.throws(()=>f.finalize(batchId,[file.id,file.id]),/unique/);
 f.finalize(batchId,[file.id]);assert.throws(()=>f.finalize(batchId,[]),/different files/);assert.equal(f.job(),undefined);
});
test('a stale asynchronous file preparation claim cannot send or overwrite a newer queue claim',async()=>{
 const f=fixture(),file=await f.upload('photo.jpg','PHOTO'),queued=f.finalize(crypto.randomUUID(),[file.id]),originalHead=f.store.env.CAD_PROJECT_FILES.head;let release;
 f.store.env.CAD_PROJECT_FILES.head=()=>new Promise(resolve=>{release=resolve;});const now=Date.now(),first=processOrderEmails(f.store,()=>assert.fail('stale preparation must not send'),now);
 f.store.env.CAD_PROJECT_FILES.head=originalHead;await processOrderEmails(f.store,async(url,options)=>{await body(options);return Response.json({id:'new-claim'});},now+61000);release({size:5});await first;assert.equal(f.job(queued.emailJobId).providerId,'new-claim');
});
