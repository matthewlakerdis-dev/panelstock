import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handlePurchaseRequests,handleNexviaRequestWorker,renamePurchaseRequestOwner} from '../src/purchase-requests.js';

const REQUEST='35fc4244-267c-42c6-885c-6ab93a55b899',WORKER='0cfe27f4-acdf-4423-afd3-fc2c13e80c9a',OTHER_WORKER='22be921c-f1c9-4ba5-a212-5c2e91f43cca';
const TOKEN='synthetic-request-worker-token-123456789';
const owner={username:'requestor',tasks:{'purchase-requests.create':true}},other={username:'other',tasks:{'purchase-requests.create':true}},manager={username:'manager',tasks:{'purchase-requests.manage':true}},admin={username:'admin',isAdmin:true};
const catalog=()=>({projectPageId:60,supplierSearch:'',suppliers:[{id:225,text:'Example Supplier',disabled:false}],services:[{id:8,name:'Materials'}],breakdowns:[{id:'b_70',name:'Miscellaneous'}],accounts:[{id:51097,name:'Materials'}],taxes:[{id:1,name:'GST',rate:10},{id:2,name:'GST free',rate:0}]});
const input=(revision='revision')=>({requestId:REQUEST,projectPageId:60,catalogRevision:revision,requestor:{name:'Requestor Name',email:'requestor@example.test'},date:'2026-11-13',supplierId:'225',supplierReference:'QUOTE-1',serviceId:'8',breakdownType:'b_70',quote:null,quoteBase64:'',lines:[{description:'BLANKET PO',quantity:'1',unitPriceExGst:'1000',chartOfAccountId:'51097',taxRateId:'1',breakdownType:'b_70'}]});
function fixture(){
 const docs=new Map([['users',{requestor:{displayName:'Requestor Name',email:'requestor@example.test'}}],['orders',[{id:'existing-site-order'}]],['workshop-stock',{purchaseOrders:[{id:'existing-stock-po'}]}]]),files=new Map(),audits=[],waits=[];
 const accounts=new Map(['requestor','other','manager','admin'].map(username=>[username,{createdAt:'2026-01-01T00:00:00.000Z',name:username==='requestor'?'Requestor Name':username,email:username+'@example.test'}]));
 const store={sql:{exec:(_query,username)=>({toArray:()=>accounts.has(username)?[structuredClone(accounts.get(username))]:[]})},env:{NEXVIA_REQUEST_TOKEN:TOKEN,NEXVIA_CONFIRMATION_TOKEN:'different-confirmation-token-123456789',EMAIL_ENABLED:'false',CAD_PROJECT_FILES:{put:async(key,bytes,options={})=>{if(options.onlyIf&&files.has(key))return null;files.set(key,new Uint8Array(bytes));return {key};},get:async key=>files.has(key)?{size:files.get(key).length,arrayBuffer:async()=>files.get(key).buffer}:null,delete:async key=>files.delete(key)}},read:(key,fallback=null)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>{assert.ok(key.startsWith('purchase-request:')||key.startsWith('nexvia-confirmation-email:'),'must not write existing stock/PO state');docs.set(key,structuredClone(value));},audit:(...args)=>audits.push(args),ctx:{waitUntil:promise=>waits.push(promise),storage:{transactionSync:fn=>{const before=structuredClone([...docs]),count=audits.length;try{return fn();}catch(error){docs.clear();for(const [key,value] of before)docs.set(key,value);audits.length=count;throw error;}}}}};return {store,docs,files,audits,waits,accounts};
}
const user=(store,path,method='GET',body={},actor=owner)=>handlePurchaseRequests(store,path,method,body,actor);
const machine=(store,path,body,token=TOKEN,method='POST')=>handleNexviaRequestWorker(store,'/integrations/nexvia/'+path,method,body,token);
async function ready(store,actor=owner){
 await machine(store,'request-work',{workerId:WORKER,projects:[{projectPageId:60,name:'Jardin building'}]});const lookup=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60},actor)).body.lookup;
 const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 const response=await machine(store,'request-results',{workerId:WORKER,id:lookup.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:catalog()});return response.body.catalog;
}
const status=value=>error=>error.status===value;
const CHILD='9341a945-6435-4cdf-9b5c-506a5a40c689',OTHER_CHILD='c6e0b027-7728-4874-bf2c-8e7c46fe66d3';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const nasHash=value=>createHash('sha256').update(canonical(value).replace(/[\u007f-\uffff]/g,unit=>'\\u'+unit.charCodeAt(0).toString(16).padStart(4,'0'))).digest('hex');
const review=(store,action,note,actor=manager)=>user(store,'/purchase-requests/'+REQUEST+'/review','POST',{action,...(note===undefined?{}:{note})},actor);
const quoteInput=()=>({quote:{filename:'quote.pdf'},quoteBase64:Buffer.from('%PDF-1.4\nquote').toString('base64')});
async function failed(store,quoted=false){
 const choices=await ready(store);await user(store,'/purchase-requests','POST',{...input(choices.revision),...(quoted?quoteInput():{}),lines:[{...input().lines[0],description:'Survey façade 🏢'}]});
 const work=(await machine(store,'request-work',{workerId:WORKER,documentExpected:true,...(quoted?{quoteAttachmentVersion:1}:{})})).body.work;
 await machine(store,'request-results',{workerId:WORKER,id:REQUEST,claimToken:work.claimToken,kind:'request',state:'needs_review',message:'Fresh preparation failed; no submission authorized'});
 return {choices,work};
}
async function assessed(store,{status:assessmentStatus='retry_ready',checkedAt=new Date().toISOString(),evidenceChange}={}){
 await review(store,'check');const claim=(await machine(store,'request-work',{workerId:WORKER,reviewVersion:1})).body.review;
 const {claimToken,...source}=claim.sourceWork;
 const body={version:1,workerId:WORKER,id:claim.id,claimToken:claim.claimToken,requestId:REQUEST,sourceOutcomeHash:claim.previous.outcomeHash,status:assessmentStatus,message:assessmentStatus==='retry_ready'?'No preparation or submission attempt exists.':'An attempt needs manual inspection.',checkedAt,evidence:assessmentStatus==='retry_ready'?{sourceWorkHash:nasHash(source),sourceRequestHash:nasHash(source.payload),sourceJournalHash:'a'.repeat(64),markersAbsent:true}:null};
 if(evidenceChange)Object.assign(body.evidence,evidenceChange);await machine(store,'request-review-result',body);return {claim,body};
}
const retryBody=(choices,id,reviewId,extra={})=>({...input(choices.revision),requestId:id,retryOf:{requestId:REQUEST,reviewId},...extra});

test('review notes and closure require management and never rewrite original request or work',async()=>{
 const {store,docs,audits}=fixture();await failed(store);const original=structuredClone(docs.get('purchase-request:record:'+REQUEST)),work=structuredClone(docs.get('purchase-request:work'));
 await assert.rejects(review(store,'note','Cannot act',owner),status(403));await assert.rejects(review(store,'note','Private',other),status(404));
 await assert.rejects(review(store,'close','   '),status(400));
 let result=(await review(store,'note','Checked Nexvia.\r\nNo PO was found.')).body.request.review;assert.equal(result.note,'Checked Nexvia.\nNo PO was found.');assert.equal(result.reviewedBy,'manager');assert.equal(result.events.at(-1).action,'note');
 result=(await review(store,'close','Resolved outside PanelStock.')).body.request.review;assert.equal(result.status,'closed');assert.equal(result.canCheck,false);assert.equal(result.canClose,false);
 result=(await review(store,'reopen')).body.request.review;assert.equal(result.status,'open');assert.equal(result.assessment,null);assert.equal(result.events.length,3);
 assert.deepEqual(docs.get('purchase-request:record:'+REQUEST),original);assert.deepEqual(docs.get('purchase-request:work'),work);assert.ok(audits.some(row=>row[1]==='purchase-request-review-close'));
 const summary=(await user(store,'/purchase-requests','GET',{},manager)).body.requests[0];assert.equal(summary.review.note,undefined);assert.equal(summary.review.events,undefined);
 const detail=(await user(store,'/purchase-requests/'+REQUEST)).body.request;assert.equal(detail.review.note,'Resolved outside PanelStock.');assert.equal(detail.review.events.length,3);assert.doesNotMatch(JSON.stringify(detail),/claimToken|sourceJournalHash|sourceOutcomeHash|reviewCreatorGeneration/);
});

test('only the original capable worker claims checks and old NAS polling keeps ordinary work unchanged',async()=>{
 const {store,docs}=fixture();await failed(store);const original=structuredClone(docs.get('purchase-request:record:'+REQUEST));
 const first=(await review(store,'check')).body.request.review,again=(await review(store,'check')).body.request.review;assert.equal(first.assessment.id,again.assessment.id);assert.equal(first.status,'checking');
 assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.review,undefined);assert.equal((await machine(store,'request-work',{workerId:OTHER_WORKER,reviewVersion:1})).body.review,undefined);
 const reply=(await machine(store,'request-work',{workerId:WORKER,reviewVersion:1})).body;assert.equal(reply.work,null);assert.equal(reply.review.requestId,REQUEST);assert.equal(reply.review.sourceWork.claimToken,original.claimToken);assert.equal(reply.review.previous.outcomeHash,original.outcomeHash);
 assert.deepEqual((await machine(store,'request-work',{workerId:WORKER,reviewVersion:1})).body.review,reply.review);assert.deepEqual(docs.get('purchase-request:record:'+REQUEST),original);assert.deepEqual(docs.get('purchase-request:work'),[]);
 await assert.rejects(machine(store,'request-work',{workerId:WORKER,reviewVersion:2}),status(400));
});

test('claim-bound ASCII evidence authorizes one linked replacement and preserves requester access',async()=>{
 const {store,docs}=fixture(),{choices}=await failed(store);const original=structuredClone(docs.get('purchase-request:record:'+REQUEST));const {claim,body}=await assessed(store);
 assert.equal((await user(store,'/purchase-requests/'+REQUEST)).body.request.review.status,'retry_ready');
 assert.equal((await machine(store,'request-review-result',body)).body.duplicate,true);
 await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),manager),status(403));
 const submitted=(await user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),admin)).body.request;
 assert.equal(submitted.id,CHILD);assert.equal(submitted.submittedBy,'requestor');assert.equal(submitted.requestor.email,'requestor@example.test');assert.equal(submitted.retryOf.id,REQUEST);assert.equal(submitted.retryOf.displayReference,'REQ-0001');
 const parent=(await user(store,'/purchase-requests/'+REQUEST)).body.request;assert.equal(parent.review.status,'replaced');assert.equal(parent.review.replacement.id,CHILD);assert.equal(parent.review.canRetry,false);assert.equal(parent.state,'needs_review');
 assert.deepEqual(docs.get('purchase-request:record:'+REQUEST),original);assert.equal((await user(store,'/purchase-requests/'+CHILD)).body.request.id,CHILD);await assert.rejects(user(store,'/purchase-requests/'+CHILD,'GET',{},other),status(404));
 const replay=await user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),admin);assert.equal(replay.body.duplicate,true);assert.equal(replay.body.request.id,CHILD);
 await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,OTHER_CHILD,claim.id),admin),error=>error.status===409&&error.code==='PURCHASE_REQUEST_REVIEW_CHANGED');assert.equal(docs.get('purchase-request:index').length,2);
});

test('evidence tampering, unknown attempts and stale sources cannot authorize replacement creation',async()=>{
 for(const change of [{markersAbsent:false},{sourceWorkHash:'0'.repeat(64)},{sourceRequestHash:'0'.repeat(64)}]){
  const {store,docs}=fixture();await failed(store);await assert.rejects(assessed(store,{evidenceChange:change}),error=>[400,409].includes(error.status));assert.equal((await user(store,'/purchase-requests/'+REQUEST)).body.request.review.canRetry,false);assert.equal(docs.get('purchase-request:index').length,1);
 }
 const {store,docs}=fixture(),{choices}=await failed(store);const {claim}=await assessed(store,{status:'blocked'});await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),admin),error=>error.code==='PURCHASE_REQUEST_REVIEW_CHANGED');assert.equal(docs.has('purchase-request:record:'+CHILD),false);
});

test('expired or closed checks accept frozen delivery but cannot enable a retry',async()=>{
 const {store,docs}=fixture(),{choices}=await failed(store);const {claim,body}=await assessed(store,{checkedAt:new Date(Date.now()-16*60000).toISOString()});assert.equal((await user(store,'/purchase-requests/'+REQUEST)).body.request.review.canRetry,false);
 await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),admin),error=>error.code==='PURCHASE_REQUEST_REVIEW_CHANGED');assert.equal((await machine(store,'request-review-result',body)).body.duplicate,true);
 await review(store,'check');const next=(await machine(store,'request-work',{workerId:WORKER,reviewVersion:1})).body.review;const {claimToken,...source}=next.sourceWork;const pending={...body,id:next.id,claimToken:next.claimToken,checkedAt:new Date().toISOString(),evidence:{...body.evidence,sourceWorkHash:nasHash(source)}};
 await review(store,'close','Do not retry this request.');assert.equal((await machine(store,'request-review-result',pending)).body.review.status,'retry_ready');assert.equal((await user(store,'/purchase-requests/'+REQUEST)).body.request.review.status,'closed');assert.equal(docs.has('purchase-request:record:'+CHILD),false);
});

test('quoted reviewed retries require a fresh PDF and never reuse the original temporary file',async()=>{
 const {store,docs,files}=fixture(),{choices}=await failed(store,true),{claim}=await assessed(store);const before=files.size;
 await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),admin),status(422));assert.equal(files.size,before);
 await user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id,quoteInput()),admin);
 const original=docs.get('purchase-request:record:'+REQUEST),child=docs.get('purchase-request:record:'+CHILD);assert.notEqual(original.quoteFile.key,child.quoteFile.key);assert.equal(child.quoteTransfer.state,'pending');assert.equal(files.size,before+1);
});

test('review changes during asynchronous PDF staging prevent a child and discard its orphan transfer',async()=>{
 const {store,docs,files}=fixture(),{choices}=await failed(store,true),{claim}=await assessed(store);const put=store.env.CAD_PROJECT_FILES.put;
 store.env.CAD_PROJECT_FILES.put=async(...args)=>{const value=await put(...args);await review(store,'close','Closed during submission.');return value;};
 await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id,quoteInput()),admin),error=>error.code==='PURCHASE_REQUEST_REVIEW_CHANGED');assert.equal(docs.has('purchase-request:record:'+CHILD),false);assert.equal(files.size,1);assert.equal(docs.get('purchase-request:index').length,1);
});

test('deleted or replaced requester accounts reject unsaved retries with a recoverable review error',async()=>{
 for(const phase of ['before-stage','during-stage']){
  const {store,docs,files,accounts}=fixture(),{choices}=await failed(store,true),{claim}=await assessed(store);let writes=0;
  const put=store.env.CAD_PROJECT_FILES.put;
  store.env.CAD_PROJECT_FILES.put=async(...args)=>{writes++;const uploaded=await put(...args);accounts.set('requestor',{createdAt:'2026-12-01T00:00:00Z'});return uploaded;};
  if(phase==='before-stage')accounts.delete('requestor');
  await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id,quoteInput()),admin),error=>error.status===409&&error.code==='PURCHASE_REQUEST_REVIEW_CHANGED');
  assert.equal(writes,phase==='before-stage'?0:1);assert.equal(docs.has('purchase-request:record:'+CHILD),false);assert.equal(docs.get('purchase-request:index').length,1);assert.deepEqual(docs.get('purchase-request:work'),[]);assert.equal(files.size,1,'only the original quote transfer remains');
 }
});

test('competing managers cannot create two children and manager privilege removal blocks replay',async()=>{
 const {store,docs,accounts}=fixture(),{choices}=await failed(store),{claim}=await assessed(store);accounts.set('second-manager',{createdAt:'2026-01-01T00:00:00.000Z',name:'Second',email:'second@example.test'});const second={username:'second-manager',tasks:{'purchase-requests.create':true,'purchase-requests.manage':true}};
 const results=await Promise.allSettled([user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),admin),user(store,'/purchase-requests','POST',retryBody(choices,OTHER_CHILD,claim.id),second)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected')[0].reason.code,'PURCHASE_REQUEST_REVIEW_CHANGED');assert.equal(docs.get('purchase-request:index').length,2);
 if(docs.has('purchase-request:record:'+CHILD))await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),{username:'admin',tasks:{'purchase-requests.create':true}}),status(403));
});

test('maintenance, source mutation, stale catalog and recreated requester accounts reject review retries',async()=>{
 for(const mutation of ['maintenance','source','catalog','owner']){
  const {store,docs,accounts}=fixture(),{choices}=await failed(store),{claim}=await assessed(store);
  if(mutation==='maintenance')store.env.READ_ONLY='true';else if(mutation==='source')docs.set('purchase-request:record:'+REQUEST,{...docs.get('purchase-request:record:'+REQUEST),outcomeHash:'b'.repeat(64)});else if(mutation==='catalog')docs.set('purchase-request:catalog:60',{...choices,revision:'changed'});else accounts.set('requestor',{createdAt:'2026-02-01T00:00:00Z'});
  await assert.rejects(user(store,'/purchase-requests','POST',retryBody(choices,CHILD,claim.id),admin));assert.equal(docs.has('purchase-request:record:'+CHILD),false);assert.equal(docs.get('purchase-request:index').length,1);
 }
});

test('review history is bounded and closed checks do not occupy the active queue',async()=>{
 const {store,docs}=fixture();await failed(store);for(let index=0;index<24;index++)await review(store,'note','Review note '+index);
 assert.equal((await user(store,'/purchase-requests/'+REQUEST)).body.request.review.events.length,20);
 await review(store,'check');await review(store,'close','Closed without a retry.');assert.deepEqual(docs.get('purchase-request:review-queue'),[]);
 await review(store,'reopen');docs.set('purchase-request:review:jobs',Array.from({length:5000},()=>REQUEST));await assert.rejects(review(store,'check'),status(503));assert.deepEqual(docs.get('purchase-request:review-queue'),[]);
});

test('renaming a reviewer preserves a lost-response replay without transferring requester ownership',async()=>{
 const {store,docs,accounts}=fixture(),{choices}=await failed(store),{claim}=await assessed(store);const body=retryBody(choices,CHILD,claim.id);
 await user(store,'/purchase-requests','POST',body,admin);accounts.set('renamed-admin',{...accounts.get('admin')});renamePurchaseRequestOwner(store,'admin','renamed-admin');accounts.delete('admin');
 const replay=(await user(store,'/purchase-requests','POST',body,{username:'renamed-admin',isAdmin:true})).body;assert.equal(replay.duplicate,true);assert.equal(replay.request.submittedBy,'requestor');assert.equal(docs.get('purchase-request:record:'+CHILD).reviewCreatedBy,'renamed-admin');assert.deepEqual(replay.request.retryOf,{id:REQUEST,displayReference:'REQ-0001'});
});

