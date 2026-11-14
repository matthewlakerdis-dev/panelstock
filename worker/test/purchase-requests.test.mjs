import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {handlePurchaseRequests,handleNexviaRequestWorker,normalizePurchaseRequestInput,renamePurchaseRequestOwner} from '../src/purchase-requests.js';
import {processNexviaConfirmationEmails,acceptNexviaConfirmation,enqueueNexviaTestConfirmation,enqueueNexviaConfirmation} from '../src/nexvia-confirmation-email.js';

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
async function submitted(store,actor=owner,changes={}){const choices=await ready(store,actor);return user(store,'/purchase-requests','POST',{...input(choices.revision),...changes},actor);}
const status=value=>error=>error.status===value;
function choicePayload(body){const {serverTime,...payload}=body;assert.match(serverTime,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);return payload;}
const complete=(work,overrides={})=>({workerId:WORKER,id:work.id,claimToken:work.claimToken,kind:'request',state:'created_verified',result:{state:'CREATED_VERIFIED',requestReference:'REQ-'+REQUEST,projectPageId:60,purchaseOrderId:1421,purchaseOrderNumber:'PO7413',url:'https://lennox.nexvia.com.au/staff/project-purchase-order-modify/60/1421',totalCents:110000,verifiedAt:'2026-11-13T00:00:00.123456+00:00',...overrides}});
async function poDocument(work,label='Original Nexvia PDF'){
 const pdf=await PDFDocument.create();pdf.addPage().drawText(label);const bytes=await pdf.save();
 return {bytes,body:{workerId:WORKER,id:work.id,claimToken:work.claimToken,purchaseOrderId:1421,purchaseOrderNumber:'PO7413',projectPageId:60,sha256:createHash('sha256').update(bytes).digest('hex'),contentBase64:Buffer.from(bytes).toString('base64')}};
}

test('purchase requests require explicit task access and machine credentials remain separate',async()=>{
 const {store,docs}=fixture();for(const actor of [{username:'none'},{username:'stock',tasks:{'factory.receive':true}}])await assert.rejects(user(store,'/purchase-requests','GET',{},actor),status(403));
 await assert.rejects(machine(store,'request-work',{workerId:WORKER},store.env.NEXVIA_CONFIRMATION_TOKEN),status(401));await assert.rejects(machine(store,'request-work',{workerId:WORKER},TOKEN,'GET'),status(405));
 store.env.NEXVIA_REQUEST_TOKEN='short';await assert.rejects(machine(store,'request-work',{workerId:WORKER},'short'),status(503));assert.equal(docs.has('purchase-request:heartbeat'),false);
});

test('catalog lookup requires project identity and captures normalized snapshot with a stable revision',async()=>{
 const {store,docs}=fixture();const choices=await ready(store);assert.equal(choices.projectPageId,60);assert.match(choices.revision,/^[a-f0-9]{64}$/);assert.equal(choices.suppliers[0].id,'225');assert.equal(choices.taxes[0].rate,10);
 docs.set('purchase-request:catalog:60',{...choices,updatedAt:new Date(Date.now()-5*60000).toISOString()});
 const lookup=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.lookup;const claim=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 await assert.rejects(machine(store,'request-results',{workerId:WORKER,id:lookup.id,claimToken:claim.claimToken,kind:'lookup',state:'ready',catalog:{...catalog(),projectPageId:61}}),status(400));
 await assert.rejects(user(store,'/purchase-requests/lookups/'+lookup.id,'GET',{},other),status(404));const repeated=await user(store,'/purchase-requests/lookups','POST',{projectPageId:60});assert.equal(repeated.body.lookup.id,lookup.id);
});

test('fresh per-project choices are returned immediately without a NAS job or a timestamp refresh',async()=>{
 const {store,docs}=fixture(),choices=await ready(store),writes=[],write=store.write;
 store.write=(key,value)=>{writes.push(key);return write(key,value);};
 const loaded=await user(store,'/purchase-requests/lookups','POST',{projectPageId:60});
 assert.equal(loaded.body.lookup.state,'ready');assert.deepEqual(loaded.body.catalog,choices);assert.equal(writes.length,0,'the most recent owned ready lookup is reused without writes');
 assert.deepEqual(choicePayload((await user(store,'/purchase-requests/lookups/'+loaded.body.lookup.id)).body),choicePayload(loaded.body));
 assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work,null);assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);
});

test('shared choices expose only common menus to authorized users without leaking private requests or EOW',async()=>{
 const {store,docs}=fixture(),choices=await ready(store);await user(store,'/purchase-requests','POST',input(choices.revision));
 const writes=[],write=store.write;store.write=(key,value)=>{writes.push(key);return write(key,value);};
 const shared=(await user(store,'/purchase-requests/shared-choices','GET',{},other)).body.sharedChoices;
 assert.deepEqual(shared,{suppliers:choices.suppliers,services:choices.services,accounts:choices.accounts,taxes:choices.taxes,updatedAt:choices.updatedAt});
 assert.deepEqual(Object.keys(shared).sort(),['accounts','services','suppliers','taxes','updatedAt']);assert.equal(shared.breakdowns,undefined);assert.equal(shared.revision,undefined);assert.equal(shared.projectPageId,undefined);
 assert.deepEqual((await user(store,'/purchase-requests','GET',{},other)).body.requests,[]);await assert.rejects(user(store,'/purchase-requests/'+REQUEST,'GET',{},other),status(404));
 for(const actor of [{username:'none'},{username:'stock',tasks:{'factory.receive':true}}])await assert.rejects(user(store,'/purchase-requests/shared-choices','GET',{},actor),status(403));
 await assert.rejects(user(store,'/purchase-requests/shared-choices','PUT'),status(405));assert.deepEqual(writes,[]);assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);
 assert.equal((await user(store,'/purchase-requests')).body.sharedChoices,undefined,'the frequent history response does not include the shared directory');
});

test('saved EOW choices are thin current-project previews and remain read-only during maintenance',async t=>{
 const start=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now:start});
 const {store,docs}=fixture(),choices=await ready(store),old=new Date(start-2*24*3600000).toISOString();
 docs.set('purchase-request:catalog:60',{...choices,updatedAt:old,breakdowns:[{id:'ew_234',name:'Cladding',disabled:false,private:'never expose'},{id:'0',name:'Unavailable scope',disabled:true}]});docs.set('purchase-request:catalog:999',{...choices,projectPageId:999});docs.set('purchase-request:catalog-failure:60',{lookupId:REQUEST,failedAt:new Date(start).toISOString()});
 const before=structuredClone([...docs]);store.env.READ_ONLY='true';store.write=()=>assert.fail('preview GET must not write or queue NAS work');
 const response=await user(store,'/purchase-requests/eow-choices');assert.deepEqual(response.body,{ok:true,eowPreviews:[{projectPageId:60,breakdowns:[{id:'ew_234',name:'Cladding',disabled:false},{id:'0',name:'Unavailable scope',disabled:true}],updatedAt:old}],truncated:false,serverTime:new Date(start).toISOString()});
 assert.deepEqual((await user(store,'/purchase-requests/eow-choices','GET',{},other)).body,response.body);assert.deepEqual((await user(store,'/purchase-requests/eow-choices','GET',{},manager)).body,response.body);
 for(const actor of [{username:'none'},{username:'stock',tasks:{'factory.receive':true}}])await assert.rejects(user(store,'/purchase-requests/eow-choices','GET',{},actor),status(403));
 for(const method of ['POST','PUT','DELETE'])await assert.rejects(user(store,'/purchase-requests/eow-choices',method),status(405));
 assert.deepEqual([...docs],before);assert.equal(response.body.eowPreviews[0].revision,undefined);assert.equal(response.body.eowPreviews[0].suppliers,undefined);assert.equal((await user(store,'/purchase-requests')).body.eowPreviews,undefined);
});

test('EOW previews reject malformed, future and over-age snapshots without returning partial choices',async t=>{
 const start=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now:start});
 const {store,docs}=fixture(),choices=await ready(store),scope={id:'ew_234',name:'Cladding',disabled:false};store.write=()=>assert.fail('preview validation must not write');
 for(const changes of [{projectPageId:61},{supplierSearch:'filtered'},{revision:'unverified'},{updatedAt:'invalid'},{updatedAt:new Date(start+1).toISOString()},{updatedAt:new Date(start-30*24*3600000-1).toISOString()},{breakdowns:[]},{breakdowns:Array.from({length:10001},(_,id)=>({...scope,id:String(id)}))},{breakdowns:[scope,{...scope}]},{breakdowns:[{...scope,id:'../../other'}]},{breakdowns:[{...scope,id:true}]},{breakdowns:[{...scope,name:' '}]},{breakdowns:[{...scope,name:'X'.repeat(501)}]},{breakdowns:[{...scope,name:'Bad\nlabel'}]},{breakdowns:[{...scope,disabled:'false'}]},{breakdowns:[scope,{...scope,id:'ew_235',name:null}]}]){
  docs.set('purchase-request:catalog:60',{...choices,...changes});const response=(await user(store,'/purchase-requests/eow-choices')).body;assert.deepEqual(response.eowPreviews,[]);assert.equal(response.truncated,true);
 }
 docs.set('purchase-request:catalog:60',{...choices,updatedAt:new Date(start-30*24*3600000).toISOString()});assert.equal((await user(store,'/purchase-requests/eow-choices')).body.eowPreviews.length,1,'the30-day display boundary is inclusive');
 docs.delete('purchase-request:catalog:60');assert.deepEqual(choicePayload((await user(store,'/purchase-requests/eow-choices')).body),{ok:true,eowPreviews:[],truncated:false});
});

test('startup EOW previews inspect only the highest50 current projects and never scan older catalog scope',async()=>{
 const {store,docs}=fixture(),choices=await ready(store),projects=Array.from({length:60},(_,index)=>({projectPageId:index+1,name:'Project '+(index+1)}));docs.set('purchase-request:projects',projects);
 for(const project of projects)docs.set('purchase-request:catalog:'+project.projectPageId,{...choices,projectPageId:project.projectPageId});
 const read=store.read,catalogReads=[];store.read=(key,fallback)=>{if(key.startsWith('purchase-request:catalog:'))catalogReads.push(key);return read(key,fallback);};store.write=()=>assert.fail('bulk previews must not write');
 const response=(await user(store,'/purchase-requests/eow-choices')).body;assert.deepEqual(response.eowPreviews.map(row=>row.projectPageId),Array.from({length:50},(_,index)=>60-index));assert.equal(response.truncated,true);assert.equal(catalogReads.length,50);assert.equal(catalogReads.includes('purchase-request:catalog:10'),false);assert.equal(catalogReads.includes('purchase-request:catalog:1'),false);
 assert.deepEqual(docs.get('purchase-request:work'),[]);assert.equal(docs.has('purchase-request:index'),false);
});

test('startup EOW row budget skips whole projects and can still admit smaller later previews',async()=>{
 const {store,docs}=fixture(),choices=await ready(store),rows=count=>Array.from({length:count},(_,index)=>({id:String(index),name:'X',disabled:false}));docs.set('purchase-request:projects',[{projectPageId:60,name:'Small'},{projectPageId:61,name:'Does not fit'},{projectPageId:62,name:'First'}]);
 for(const [projectPageId,count] of [[62,6000],[61,5000],[60,4000]])docs.set('purchase-request:catalog:'+projectPageId,{...choices,projectPageId,breakdowns:rows(count)});
 const response=(await user(store,'/purchase-requests/eow-choices')).body;assert.deepEqual(response.eowPreviews.map(row=>row.projectPageId),[62,60]);assert.deepEqual(response.eowPreviews.map(row=>row.breakdowns.length),[6000,4000]);assert.equal(response.truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(response),'utf8')<=512*1024);
});

test('UTF-8 preview budget omits oversized whole projects in startup and pending lookup responses',async()=>{
 const {store,docs}=fixture(),choices=await ready(store),oversized={...choices,projectPageId:62,updatedAt:new Date(Date.now()-600000).toISOString(),breakdowns:Array.from({length:400},(_,index)=>({id:String(index),name:'界'.repeat(500),disabled:false}))};
 docs.set('purchase-request:projects',[{projectPageId:62,name:'Oversized'},{projectPageId:60,name:'Fits'}]);docs.set('purchase-request:catalog:62',oversized);
 assert.ok(JSON.stringify(oversized.breakdowns).length<512*1024);assert.ok(Buffer.byteLength(JSON.stringify(oversized.breakdowns),'utf8')>512*1024,'the limit counts UTF-8 bytes, not JS code units');
 const response=(await user(store,'/purchase-requests/eow-choices')).body;assert.deepEqual(response.eowPreviews.map(row=>row.projectPageId),[60]);assert.equal(response.truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(response),'utf8')<=512*1024);
 const queued=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:62})).body;assert.equal(queued.lookup.state,'queued');assert.equal(queued.eowPreview,undefined);assert.equal(queued.catalog,null);assert.ok(Buffer.byteLength(JSON.stringify(queued),'utf8')<=512*1024);
 const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;assert.equal(work.kind,'lookup');assert.equal((await user(store,'/purchase-requests/lookups/'+queued.lookup.id)).body.eowPreview,undefined);assert.equal(docs.has('purchase-request:index'),false);
});

test('stale EOW fallback stays owned and project-specific while current full choices remain authoritative',async t=>{
 const start=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now:start});
 const {store,docs}=fixture(),choices=await ready(store);t.mock.timers.setTime(start+5*60000+1);
 const queued=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body;assert.equal(queued.lookup.state,'queued');assert.equal(queued.catalog,null);assert.deepEqual(queued.eowPreview,{projectPageId:60,breakdowns:choices.breakdowns,updatedAt:choices.updatedAt});assert.equal(queued.eowPreview.revision,undefined);
 await assert.rejects(user(store,'/purchase-requests/lookups/'+queued.lookup.id,'GET',{},other),status(404));assert.deepEqual((await user(store,'/purchase-requests/lookups/'+queued.lookup.id)).body.eowPreview,queued.eowPreview);
 docs.set('purchase-request:projects',[]);assert.equal((await user(store,'/purchase-requests/lookups/'+queued.lookup.id)).body.eowPreview,undefined);assert.deepEqual((await user(store,'/purchase-requests/eow-choices')).body.eowPreviews,[]);
 docs.set('purchase-request:projects',[{projectPageId:60,name:'Jardin building'}]);docs.set('purchase-request:catalog-failure:60',{lookupId:REQUEST,failedAt:new Date(start+5*60000+1).toISOString()});assert.equal((await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.lookup.state,'queued');assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);
 const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;t.mock.timers.setTime(start+5*60000+1000);
 const refreshed=(await machine(store,'request-results',{workerId:WORKER,id:work.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:{...catalog(),breakdowns:[{id:'ew_999',name:'Updated scope'}]}})).body;assert.equal(refreshed.eowPreview,undefined);assert.equal(refreshed.lookup.state,'ready');assert.deepEqual(refreshed.catalog.breakdowns,[{id:'ew_999',name:'Updated scope',disabled:false}]);assert.notEqual(refreshed.catalog.revision,choices.revision);
 await assert.rejects(user(store,'/purchase-requests','POST',input(choices.revision)),error=>error.status===409&&error.code==='PURCHASE_REQUEST_CHOICES_CHANGED');assert.equal(docs.has('purchase-request:index'),false);assert.deepEqual(docs.get('purchase-request:work'),[]);
});

test('cold shared menus can queue and poll an owned read-only lookup before the user selects a project',async()=>{
 const {store,docs}=fixture();await machine(store,'request-work',{workerId:WORKER,projects:[{projectPageId:60,name:'Jardin building'},{projectPageId:61,name:'Salacia'}]});
 const before=structuredClone([...docs]);assert.equal((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices,null);assert.deepEqual([...docs],before,'cold GET does not queue work');
 const started=(await user(store,'/purchase-requests/shared-choices','POST',{})).body;
 assert.equal(started.sharedChoices,null);assert.equal(started.catalog,null);assert.equal(started.lookup.projectPageId,61);assert.equal(started.lookup.state,'queued');assert.deepEqual(docs.get('purchase-request:work'),[{id:started.lookup.id,kind:'lookup'}]);
 const repeated=(await user(store,'/purchase-requests/shared-choices','POST',{})).body;assert.equal(repeated.lookup.id,started.lookup.id);assert.equal(docs.get('purchase-request:work').length,1);
 await assert.rejects(user(store,'/purchase-requests/lookups/'+started.lookup.id,'GET',{},other),status(404));
 const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;assert.equal(work.kind,'lookup');assert.equal(work.projectPageId,61);assert.equal(work.payload,undefined);
 assert.equal((await user(store,'/purchase-requests/shared-choices','POST',{})).body.lookup.id,started.lookup.id,'an in-flight lookup is reused');
 await machine(store,'request-results',{workerId:WORKER,id:work.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:{...catalog(),projectPageId:61}});
 const polled=(await user(store,'/purchase-requests/lookups/'+started.lookup.id)).body;assert.equal(polled.lookup.state,'ready');assert.equal(polled.catalog.projectPageId,61);
 const common=(await user(store,'/purchase-requests/shared-choices')).body.sharedChoices;assert.deepEqual(common.suppliers,polled.catalog.suppliers);assert.equal(common.breakdowns,undefined);assert.equal(common.revision,undefined);assert.equal(common.projectPageId,undefined);
 assert.deepEqual(docs.get('purchase-request:work'),[]);assert.equal(docs.has('purchase-request:index'),false);assert.equal([...docs.keys()].some(key=>key.startsWith('purchase-request:record:')||key.startsWith('nexvia-confirmation-email:')),false);
 assert.deepEqual(docs.get('orders'),[{id:'existing-site-order'}]);assert.deepEqual(docs.get('workshop-stock'),{purchaseOrders:[{id:'existing-stock-po'}]});
});

test('shared refresh reuses fresh common choices without queueing work or renewing their receipt',async()=>{
 const {store,docs}=fixture(),choices=await ready(store),before=structuredClone([...docs]);store.write=()=>assert.fail('fresh shared refresh must not write');
 const response=await user(store,'/purchase-requests/shared-choices','POST',{});assert.deepEqual(choicePayload(response.body),{ok:true,sharedChoices:{suppliers:choices.suppliers,services:choices.services,accounts:choices.accounts,taxes:choices.taxes,updatedAt:choices.updatedAt}});assert.deepEqual([...docs],before);
});

test('choice responses report the current server clock separately from immutable catalog receipts',async t=>{
 const start=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now:start});
 const {store,docs}=fixture(),choices=await ready(store);assert.equal(choices.updatedAt,new Date(start).toISOString());
 t.mock.timers.setTime(start+120000);
 for(const [path,method,body] of [['/purchase-requests/shared-choices','GET',{}],['/purchase-requests/shared-choices','POST',{}],['/purchase-requests/lookups','POST',{projectPageId:60}]]){
  const response=(await user(store,path,method,body)).body;assert.equal(response.serverTime,new Date(start+120000).toISOString());assert.equal((response.sharedChoices||response.catalog).updatedAt,choices.updatedAt);
 }
 assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);assert.equal(docs.get('purchase-request:shared-source').updatedAt,choices.updatedAt);
 t.mock.timers.setTime(start+300000);const expired=(await user(store,'/purchase-requests/shared-choices')).body;assert.equal(expired.sharedChoices,null);assert.equal(expired.serverTime,new Date(start+300000).toISOString());
 const queued=(await user(store,'/purchase-requests/shared-choices','POST',{})).body;assert.equal(queued.lookup.state,'queued');assert.equal(queued.serverTime,new Date(start+300000).toISOString());assert.equal(queued.catalog,null);
 const claim=await machine(store,'request-work',{workerId:WORKER});assert.equal(claim.body.serverTime,undefined,'unrelated machine polls do not receive web choice metadata');
 t.mock.timers.setTime(start+300050);const processing=(await user(store,'/purchase-requests/lookups/'+queued.lookup.id)).body;assert.equal(processing.lookup.state,'processing');assert.equal(processing.serverTime,new Date(start+300050).toISOString());
 t.mock.timers.setTime(start+300100);const work=claim.body.work,finished=(await machine(store,'request-results',{workerId:WORKER,id:work.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:catalog()})).body;
 assert.equal(finished.lookup.state,'ready');assert.equal(finished.serverTime,new Date(start+300100).toISOString());assert.equal(finished.catalog.updatedAt,finished.serverTime);assert.equal(finished.catalog.revision,choices.revision);
 t.mock.timers.setTime(start+300200);const polled=(await user(store,'/purchase-requests/lookups/'+queued.lookup.id)).body;assert.equal(polled.serverTime,new Date(start+300200).toISOString());assert.deepEqual(polled.catalog,finished.catalog);assert.equal((await user(store,'/purchase-requests')).body.serverTime,undefined);
});

test('an explicit shared refresh bypasses a fresh snapshot and deduplicates read-only lookup work',async()=>{
 const {store,docs}=fixture(),choices=await ready(store);
 const queued=(await user(store,'/purchase-requests/shared-choices','POST',{refresh:true})).body;assert.equal(queued.sharedChoices,null);assert.equal(queued.catalog,null);assert.equal(queued.lookup.state,'queued');choicePayload(queued);
 assert.equal((await user(store,'/purchase-requests/shared-choices','POST',{refresh:true})).body.lookup.id,queued.lookup.id);assert.deepEqual(docs.get('purchase-request:work'),[{id:queued.lookup.id,kind:'lookup'}]);
 for(const body of [{},{refresh:false}]){const cached=(await user(store,'/purchase-requests/shared-choices','POST',body)).body;assert.equal(cached.lookup,undefined);assert.equal(cached.sharedChoices.updatedAt,choices.updatedAt);assert.deepEqual(cached.sharedChoices.suppliers,choices.suppliers);}
 const before=structuredClone([...docs]);for(const refresh of ['true','false',1,0,null,[],{}])await assert.rejects(user(store,'/purchase-requests/shared-choices','POST',{refresh}),status(400));assert.deepEqual([...docs],before);
 assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);assert.equal(docs.get('purchase-request:shared-source').updatedAt,choices.updatedAt);assert.equal(docs.has('purchase-request:index'),false);
});

test('shared lookup source prefers its current known project and otherwise uses the highest current project ID',async()=>{
 for(const [source,expected] of [[{projectPageId:60,updatedAt:'2020-01-01T00:00:00Z'},60],[{projectPageId:99,updatedAt:'2020-01-01T00:00:00Z'},62],[null,62]]){
  const {store,docs}=fixture();docs.set('purchase-request:projects',[{projectPageId:62,name:'Recent'},{projectPageId:60,name:'Known source'},{projectPageId:61,name:'Other'}]);if(source)docs.set('purchase-request:shared-source',source);
  const response=(await user(store,'/purchase-requests/shared-choices','POST',{})).body;assert.equal(response.lookup.projectPageId,expected);assert.equal(response.sharedChoices,null);assert.equal(docs.get('purchase-request:work')[0].kind,'lookup');
 }
});

test('expired shared choices trigger a fresh owned lookup and failed refreshes remain unavailable until success',async t=>{
 const start=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now:start});
 const {store,docs}=fixture(),choices=await ready(store);t.mock.timers.setTime(start+5*60000);
 assert.equal((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices,null);
 const expired=(await user(store,'/purchase-requests/shared-choices','POST',{})).body;assert.equal(expired.lookup.state,'queued');assert.equal(expired.catalog,null);assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);
 const failedWork=(await machine(store,'request-work',{workerId:WORKER})).body.work;await machine(store,'request-results',{workerId:WORKER,id:failedWork.id,claimToken:failedWork.claimToken,kind:'lookup',state:'needs_review',message:'Synthetic connection failure.'});
 assert.equal((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices,null);const retry=(await user(store,'/purchase-requests/shared-choices','POST',{})).body;assert.notEqual(retry.lookup.id,expired.lookup.id);assert.equal(retry.lookup.state,'queued');
 const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;t.mock.timers.setTime(start+5*60000+1000);await machine(store,'request-results',{workerId:WORKER,id:work.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:catalog()});
 const recovered=(await user(store,'/purchase-requests/shared-choices','POST',{})).body;assert.ok(recovered.sharedChoices);assert.notEqual(recovered.sharedChoices.updatedAt,choices.updatedAt);assert.equal(recovered.lookup,undefined);assert.equal(docs.get('purchase-request:catalog-failure:60'),null);assert.deepEqual(docs.get('purchase-request:work'),[]);
});

test('shared preload preserves task, account, maintenance, body and current project protections',async()=>{
 const {store,docs,accounts}=fixture();
 for(const actor of [{username:'none'},{username:'stock',tasks:{'factory.receive':true}}])await assert.rejects(user(store,'/purchase-requests/shared-choices','POST',{},actor),status(403));
 await assert.rejects(user(store,'/purchase-requests/shared-choices','POST',{}),error=>error.status===503&&/project choices/.test(error.message));assert.equal(docs.has('purchase-request:work'),false);
 for(const body of [{projectPageId:60},{refresh:null},null,[]])await assert.rejects(user(store,'/purchase-requests/shared-choices','POST',body),status(400));
 await ready(store);store.env.READ_ONLY='true';await assert.rejects(user(store,'/purchase-requests/shared-choices','POST',{}),status(503));assert.ok((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices,'maintenance still permits read-only GET');store.env.READ_ONLY='false';
 accounts.delete(owner.username);await assert.rejects(user(store,'/purchase-requests/shared-choices','POST',{}),status(503));accounts.set(owner.username,{createdAt:'2026-01-01T00:00:00.000Z'});
 docs.set('purchase-request:projects',[]);await assert.rejects(user(store,'/purchase-requests/shared-choices','POST',{}),status(503));assert.deepEqual(docs.get('purchase-request:work'),[]);assert.equal(docs.has('purchase-request:index'),false);
});

test('an existing warm catalog seeds the shared pointer on a cache hit without NAS work or timestamp renewal',async()=>{
 const {store,docs}=fixture(),choices=await ready(store);docs.delete('purchase-request:shared-source');
 const writes=[],write=store.write;store.write=(key,value)=>{writes.push(key);return write(key,value);};
 assert.equal((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices,null);assert.deepEqual(writes,[],'GET never scans or bootstraps legacy catalogs');
 const cached=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body;assert.deepEqual(cached.catalog,choices);assert.equal(cached.lookup.state,'ready');
 assert.deepEqual(writes,['purchase-request:shared-source']);assert.deepEqual(docs.get('purchase-request:shared-source'),{projectPageId:60,updatedAt:choices.updatedAt});
 assert.equal((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices.updatedAt,choices.updatedAt);assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);assert.deepEqual(docs.get('purchase-request:work'),[]);
 docs.delete('purchase-request:shared-source');writes.length=0;const ownedCache=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60},other)).body;
 assert.equal(ownedCache.lookup.state,'ready');assert.equal(docs.get('purchase-request:shared-source').updatedAt,choices.updatedAt);assert.deepEqual(docs.get('purchase-request:work'),[]);
});

test('shared choices require a fresh complete current source and do not hide failed project refreshes',async()=>{
 const {store,docs}=fixture(),choices=await ready(store),source={projectPageId:60,updatedAt:choices.updatedAt};
 const unavailable=[
  ()=>docs.set('purchase-request:catalog:60',{...choices,updatedAt:new Date(Date.now()-5*60000).toISOString()}),
  ()=>docs.set('purchase-request:catalog:60',{...choices,updatedAt:new Date(Date.now()+60000).toISOString()}),
  ()=>docs.set('purchase-request:catalog:60',{...choices,updatedAt:'invalid'}),
  ()=>docs.set('purchase-request:catalog:60',{...choices,services:[]}),
  ()=>docs.set('purchase-request:catalog:60',{...choices,projectPageId:61}),
  ()=>docs.set('purchase-request:catalog-failure:60',{lookupId:REQUEST,failedAt:choices.updatedAt}),
  ()=>docs.set('purchase-request:projects',[]),
  ()=>docs.set('purchase-request:shared-source',{projectPageId:61,updatedAt:choices.updatedAt}),
  ()=>docs.set('purchase-request:shared-source',{projectPageId:60,updatedAt:'invalid'}),
  ()=>docs.set('purchase-request:catalog:60',{...choices,updatedAt:new Date(Date.parse(choices.updatedAt)-1).toISOString()})
 ];
 store.write=()=>assert.fail('reading shared choices must not write or renew the catalog');
 for(const change of unavailable){docs.set('purchase-request:catalog:60',choices);docs.set('purchase-request:shared-source',source);docs.set('purchase-request:projects',[{projectPageId:60,name:'Jardin building'}]);docs.delete('purchase-request:catalog-failure:60');change();assert.equal((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices,null);}
});

test('shared source advances by original catalog receipt time and ignores older ready results and cache hits',async t=>{
 const start=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now:start});
 const {store,docs}=fixture();await ready(store);await machine(store,'request-work',{workerId:WORKER,projects:[{projectPageId:60,name:'Jardin building'},{projectPageId:61,name:'Salacia'}]});
 t.mock.timers.setTime(start+500);const old=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:true})).body.lookup,oldWork=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 t.mock.timers.setTime(start+1000);const newer=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:61},other)).body.lookup,newWork=(await machine(store,'request-work',{workerId:OTHER_WORKER})).body.work;
 const newest=(await machine(store,'request-results',{workerId:OTHER_WORKER,id:newer.id,claimToken:newWork.claimToken,kind:'lookup',state:'ready',catalog:{...catalog(),projectPageId:61,suppliers:[{id:226,text:'New supplier'}],breakdowns:[{id:'b_99',name:'Salacia EOW'}]}})).body.catalog;
 assert.deepEqual(docs.get('purchase-request:shared-source'),{projectPageId:61,updatedAt:newest.updatedAt});
 t.mock.timers.setTime(start+500);await machine(store,'request-results',{workerId:WORKER,id:old.id,claimToken:oldWork.claimToken,kind:'lookup',state:'ready',catalog:catalog()});
 t.mock.timers.setTime(start+1500);await user(store,'/purchase-requests/lookups','POST',{projectPageId:60});assert.deepEqual(docs.get('purchase-request:shared-source'),{projectPageId:61,updatedAt:newest.updatedAt});
 const shared=(await user(store,'/purchase-requests/shared-choices')).body.sharedChoices;assert.deepEqual(shared.suppliers,newest.suppliers);assert.equal(shared.updatedAt,newest.updatedAt);
 t.mock.timers.setTime(start+2000);const refresh=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:true})).body.lookup,work=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 const latest=(await machine(store,'request-results',{workerId:WORKER,id:refresh.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:catalog()})).body.catalog;assert.deepEqual(docs.get('purchase-request:shared-source'),{projectPageId:60,updatedAt:latest.updatedAt});
});

test('shared global changes do not compose another project EOW or revision into a submitted request',async()=>{
 const {store,docs}=fixture(),jardin=await ready(store);await machine(store,'request-work',{workerId:WORKER,projects:[{projectPageId:60,name:'Jardin building'},{projectPageId:61,name:'Salacia'}]});
 const lookup=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:61})).body.lookup,work=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 const salacia=(await machine(store,'request-results',{workerId:WORKER,id:lookup.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:{...catalog(),projectPageId:61,suppliers:[{id:226,text:'Added supplier'}],services:[{id:9,name:'Updated service'}],breakdowns:[{id:'b_99',name:'Salacia EOW'}]}})).body.catalog;
 const shared=(await user(store,'/purchase-requests/shared-choices')).body.sharedChoices;assert.deepEqual(shared.suppliers,salacia.suppliers);assert.equal(shared.breakdowns,undefined);assert.equal(shared.revision,undefined);
 await assert.rejects(user(store,'/purchase-requests','POST',input(salacia.revision)),error=>error.status===409&&error.code==='PURCHASE_REQUEST_CHOICES_CHANGED');
 await assert.rejects(user(store,'/purchase-requests','POST',{...input(jardin.revision),supplierId:'226'}),status(400));await assert.rejects(user(store,'/purchase-requests','POST',{...input(jardin.revision),serviceId:'9'}),status(400));
 const wrongEow=input(jardin.revision);wrongEow.breakdownType='b_99';wrongEow.lines[0].breakdownType='b_99';await assert.rejects(user(store,'/purchase-requests','POST',wrongEow),status(400));
 assert.equal(docs.has('purchase-request:index'),false);assert.deepEqual((await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.catalog,jardin);
 assert.equal((await user(store,'/purchase-requests','POST',input(jardin.revision))).status,201);
});

test('shared fresh catalogs retain separate owned lookup identities across accounts and account recreation',async()=>{
 const {store,docs,accounts}=fixture();await ready(store);const first=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body;
 const second=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60},other)).body;
 assert.equal(second.lookup.state,'ready');assert.notEqual(second.lookup.id,first.lookup.id);assert.deepEqual(second.catalog,first.catalog);
 await assert.rejects(user(store,'/purchase-requests/lookups/'+second.lookup.id),status(404));await assert.rejects(user(store,'/purchase-requests/lookups/'+first.lookup.id,'GET',{},other),status(404));
 assert.equal((await user(store,'/purchase-requests/lookups/'+second.lookup.id,'GET',{},other)).body.lookup.id,second.lookup.id);assert.deepEqual(docs.get('purchase-request:work'),[]);
 accounts.set('requestor',{...accounts.get('requestor'),createdAt:'2026-11-14T00:00:00.000Z'});
 await assert.rejects(user(store,'/purchase-requests/lookups/'+first.lookup.id),status(404));
 const recreated=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body;
 assert.equal(recreated.lookup.state,'ready');assert.notEqual(recreated.lookup.id,first.lookup.id);assert.deepEqual(docs.get('purchase-request:work'),[]);
});

test('explicit refresh bypasses a fresh cache and deduplicates NAS lookup work without changing snapshot time',async()=>{
 const {store,docs}=fixture(),choices=await ready(store);
 const forced=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:true})).body;
 assert.equal(forced.lookup.state,'queued');assert.equal(forced.catalog,null);assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);
 const repeated=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:true})).body;assert.equal(repeated.lookup.id,forced.lookup.id);assert.equal(docs.get('purchase-request:work').length,1);
 const cached=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:false})).body;assert.equal(cached.lookup.state,'ready');assert.deepEqual(cached.catalog,choices);assert.equal(docs.get('purchase-request:work').length,1,'cache reads leave claimed or queued refresh work intact');
 assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work.id,forced.lookup.id);
 for(const refresh of ['true','false',1,0,null,[],{}])await assert.rejects(user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh}),status(400));
});

test('old, future, malformed or wrong-project snapshots still queue validated NAS work',async()=>{
 for(const changes of [{updatedAt:new Date(Date.now()-5*60000).toISOString()},{updatedAt:'invalid'},{updatedAt:new Date(Date.now()+60000).toISOString()},{projectPageId:61},{supplierSearch:'filtered'},{revision:'not-a-validated-revision'},{accounts:null},{services:[]},{breakdowns:[]},{accounts:[]},{taxes:[]}]){
  const {store,docs}=fixture(),choices=await ready(store);docs.set('purchase-request:catalog:60',{...choices,...changes});
  const loaded=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body;assert.equal(loaded.lookup.state,'queued');assert.equal(loaded.catalog,null);
  assert.equal((await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.lookup.id,loaded.lookup.id,'pending refresh is deduplicated');
  assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work.id,loaded.lookup.id);
 }
});

test('a validated empty supplier list remains cacheable when the other project choices are complete',async()=>{
 const {store}=fixture();await ready(store);const lookup=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:true})).body.lookup,work=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 await machine(store,'request-results',{workerId:WORKER,id:lookup.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:{...catalog(),suppliers:[]}});
 const cached=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body;assert.equal(cached.lookup.state,'ready');assert.deepEqual(cached.catalog.suppliers,[]);assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work,null);
});

test('a failed project refresh blocks cached reuse until success, without mutating the saved catalog',async()=>{
 const {store,docs}=fixture(),choices=await ready(store),lookup=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:true})).body.lookup,work=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 const failure={workerId:WORKER,id:lookup.id,claimToken:work.claimToken,kind:'lookup',state:'needs_review',message:'Check Nexvia sign-in.'};await machine(store,'request-results',failure);
 assert.deepEqual(docs.get('purchase-request:catalog:60'),choices);assert.equal(docs.get('purchase-request:catalog-failure:60').lookupId,lookup.id);
 assert.equal((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices,null);
 const retry=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60},other)).body;assert.equal(retry.lookup.state,'queued');assert.equal(retry.catalog,null);
 const claimed=(await machine(store,'request-work',{workerId:WORKER})).body.work;assert.equal(claimed.id,retry.lookup.id);
 await machine(store,'request-results',{workerId:WORKER,id:claimed.id,claimToken:claimed.claimToken,kind:'lookup',state:'ready',catalog:catalog()});
 assert.equal(docs.get('purchase-request:catalog-failure:60'),null);const recovered=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body;assert.equal(recovered.lookup.state,'ready');
 assert.equal((await user(store,'/purchase-requests/shared-choices')).body.sharedChoices.updatedAt,recovered.catalog.updatedAt);
 await machine(store,'request-results',failure);assert.equal(docs.get('purchase-request:catalog-failure:60'),null,'replaying a terminal failure cannot poison a later successful refresh');assert.equal((await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.lookup.state,'ready');
});

test('a late failure from an older in-flight lookup does not invalidate a newer successful project read',async()=>{
 const {store,docs}=fixture();await ready(store);
 const old=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:true})).body.lookup,oldWork=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 docs.set('purchase-request:lookup:'+old.id,{...docs.get('purchase-request:lookup:'+old.id),collectedAt:new Date(Date.now()-2000).toISOString()});
 const newer=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60,refresh:true},other)).body.lookup,newWork=(await machine(store,'request-work',{workerId:OTHER_WORKER})).body.work;assert.equal(newWork.id,newer.id);
 const published=(await machine(store,'request-results',{workerId:OTHER_WORKER,id:newer.id,claimToken:newWork.claimToken,kind:'lookup',state:'ready',catalog:{...catalog(),suppliers:[{id:225,text:'Updated supplier',disabled:false}]}})).body.catalog;
 await machine(store,'request-results',{workerId:WORKER,id:old.id,claimToken:oldWork.claimToken,kind:'lookup',state:'needs_review',message:'An older lookup could not finish.'});
 assert.equal(docs.get('purchase-request:catalog-failure:60'),undefined);assert.deepEqual(docs.get('purchase-request:catalog:60'),published);const cached=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body;assert.equal(cached.lookup.state,'ready');assert.deepEqual(cached.catalog,published);
});

test('cached lookup reuse keeps permissions, project membership and stale submission checks',async()=>{
 const {store,docs}=fixture(),choices=await ready(store);
 await assert.rejects(user(store,'/purchase-requests/lookups','POST',{projectPageId:60},{username:'none'}),status(403));
 await assert.rejects(user(store,'/purchase-requests/lookups','POST',{projectPageId:61}),status(400));
 docs.set('purchase-request:projects',[]);await assert.rejects(user(store,'/purchase-requests/lookups','POST',{projectPageId:60}),status(400));docs.set('purchase-request:projects',[{projectPageId:60,name:'Jardin building'}]);
 store.env.READ_ONLY='true';await assert.rejects(user(store,'/purchase-requests/lookups','POST',{projectPageId:60}),status(503));store.env.READ_ONLY='false';
 docs.set('purchase-request:catalog:60',{...choices,revision:'b'.repeat(64)});
 const latest=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.catalog;assert.equal(latest.revision,'b'.repeat(64));
 await assert.rejects(user(store,'/purchase-requests','POST',input(choices.revision)),error=>error.status===409&&error.code==='PURCHASE_REQUEST_CHOICES_CHANGED');
 docs.set('purchase-request:catalog:60',{...choices,updatedAt:'2020-01-01T00:00:00Z'});await assert.rejects(user(store,'/purchase-requests','POST',input(choices.revision)),error=>error.status===409&&error.code==='PURCHASE_REQUEST_CHOICES_CHANGED');assert.equal(docs.has('purchase-request:index'),false);
});

test('server recalculates exact half-up line/GST cents, normalizes decimals and ignores client totals',async()=>{
 const {store}=fixture(),choices=await ready(store),packet=input(choices.revision);packet.totalCents=999;packet.subtotalCents=888;packet.taxCents=111;packet.lines=[{...packet.lines[0],quantity:'1.005',unitPriceExGst:'1'},{...packet.lines[0],quantity:'0.125',unitPriceExGst:'2.000000'}];
 const saved=(await user(store,'/purchase-requests','POST',packet)).body.request;assert.equal(saved.subtotalCents,126);assert.equal(saved.taxCents,13);assert.equal(saved.totalCents,139);assert.equal(saved.lines[1].unitPriceExGst,'2');assert.equal(saved.state,'queued');assert.equal(saved.confirmation,null);
 const polling=(await user(store,'/purchase-requests')).body;assert.deepEqual(polling.profile,{name:'Requestor Name',email:'requestor@example.test'});assert.deepEqual(polling.permissions,{create:true,manage:false});assert.equal(polling.requests[0].lineCount,2);assert.equal(polling.requests[0].lines,undefined);assert.equal((await user(store,'/purchase-requests/'+REQUEST)).body.request.lines.length,2);
});

test('immutable UUID retry returns one submission even after catalog expiration, while changed details conflict',async()=>{
 const {store,docs,audits}=fixture(),choices=await ready(store),packet=input(choices.revision);const first=await user(store,'/purchase-requests','POST',packet);assert.equal(first.status,201);
 docs.set('purchase-request:catalog:60',{...choices,revision:'new-revision',updatedAt:'2020-01-01T00:00:00Z'});
 const retry=await user(store,'/purchase-requests','POST',{...packet,lines:[{...packet.lines[0],quantity:'1.000',unitPriceExGst:1000}]});assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);
 await assert.rejects(user(store,'/purchase-requests','POST',{...packet,supplierReference:'different'}),status(409));await assert.rejects(user(store,'/purchase-requests','POST',packet,other),status(409));assert.equal(docs.get('purchase-request:index').length,1);assert.equal(audits.filter(row=>row[1]==='purchase-request-submitted').length,1);
});

test('new submissions reject stale choices, invalid dropdown IDs, dates and unsafe totals',async()=>{
 const {store,docs}=fixture(),choices=await ready(store),base=input(choices.revision);
 for(const changes of [{catalogRevision:'wrong'},{supplierId:'999'},{serviceId:'9'},{breakdownType:'b_71'},{date:'2026-02-30'},{lines:[{...base.lines[0],chartOfAccountId:'unknown'}]},{lines:[{...base.lines[0],taxRateId:'99'}]},{lines:[{...base.lines[0],quantity:'0'}]},{lines:[{...base.lines[0],quantity:'1e3'}]},{lines:[{...base.lines[0],unitPriceExGst:'0.0000001'}]},{lines:[{...base.lines[0],quantity:'1000000000',unitPriceExGst:'1000000000'}]},{requestor:{name:'A',email:'one@example.test\nCc:bad@example.test'}}])await assert.rejects(user(store,'/purchase-requests','POST',{...base,...changes}));
 docs.set('purchase-request:catalog:60',{...choices,updatedAt:'2020-01-01T00:00:00Z'});await assert.rejects(user(store,'/purchase-requests','POST',base),status(409));assert.equal(docs.has('purchase-request:index'),false);
});

test('history and details are owner-only while managers can read all without creating or changing stock POs',async()=>{
 const {store,docs}=fixture();await submitted(store);assert.equal((await user(store,'/purchase-requests','GET',{},other)).body.requests.length,0);assert.equal((await user(store,'/purchase-requests','GET',{},manager)).body.requests.length,1);
 await assert.rejects(user(store,'/purchase-requests/'+REQUEST,'GET',{},other),status(404));assert.equal((await user(store,'/purchase-requests/'+REQUEST,'GET',{},manager)).body.request.id,REQUEST);
 await assert.rejects(user(store,'/purchase-requests','POST',input(),manager),status(403));assert.deepEqual(docs.get('orders'),[{id:'existing-site-order'}]);assert.deepEqual(docs.get('workshop-stock'),{purchaseOrders:[{id:'existing-stock-po'}]});
});

test('history reads only recent summaries, while account history and full detail remain distinct',async()=>{
 const {store,docs,accounts}=fixture();await submitted(store);const original=docs.get('purchase-request:record:'+REQUEST),ids=[];for(let index=0;index<205;index++){const id=crypto.randomUUID();ids.push(id);docs.set('purchase-request:record:'+id,{...original,id,reference:'REQ-'+id});}docs.set('purchase-request:index',ids);docs.set('purchase-request:owner-index:requestor:'+accounts.get('requestor').createdAt,ids);
 let recordReads=0;const read=store.read;store.read=(key,fallback)=>{if(key.startsWith('purchase-request:record:'))recordReads++;return read(key,fallback);};const response=await user(store,'/purchase-requests');assert.equal(response.body.historyTruncated,true);assert.equal(response.body.requests.length,200);assert.equal(recordReads,200);assert.equal(response.body.requests[0].id,ids.at(-1));assert.ok(response.body.requests.every(row=>row.lines===undefined&&row.lineCount===1));assert.equal((await user(store,'/purchase-requests/'+ids[0])).body.request.lines.length,1);
});

test('deleted and recreated usernames cannot inherit old requests, quote files or lookup choices',async()=>{
 const {store,accounts}=fixture(),choices=await ready(store);await user(store,'/purchase-requests','POST',{...input(choices.revision),quote:{filename:'quote.pdf'},quoteBase64:btoa('%PDF-private')});const lookup=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.lookup;
 accounts.set('requestor',{...accounts.get('requestor'),createdAt:'2026-11-13T10:00:00.000Z'});assert.equal((await user(store,'/purchase-requests')).body.requests.length,0);await assert.rejects(user(store,'/purchase-requests/'+REQUEST),status(404));await assert.rejects(user(store,'/purchase-requests/'+REQUEST+'/quote'),status(404));await assert.rejects(user(store,'/purchase-requests/lookups/'+lookup.id),status(404));await assert.rejects(user(store,'/purchase-requests','POST',input(choices.revision)),status(409));assert.equal((await user(store,'/purchase-requests','GET',{},manager)).body.requests.length,1);
});

test('renaming an account migrates its matching request history and lookups inside the existing transaction',async()=>{
 const {store,accounts,docs}=fixture();await submitted(store);const lookup=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.lookup;accounts.set('renamed',structuredClone(accounts.get('requestor')));store.ctx.storage.transactionSync(()=>renamePurchaseRequestOwner(store,'requestor','renamed'));accounts.delete('requestor');const renamed={...owner,username:'renamed'};
 assert.equal((await user(store,'/purchase-requests','GET',{},renamed)).body.requests[0].id,REQUEST);assert.equal((await user(store,'/purchase-requests/'+REQUEST,'GET',{},renamed)).body.request.submittedBy,'renamed');assert.equal((await user(store,'/purchase-requests/lookups/'+lookup.id,'GET',{},renamed)).body.lookup.id,lookup.id);assert.equal(docs.get('purchase-request:record:'+REQUEST).ownerCreatedAt,accounts.get('renamed').createdAt);
 accounts.set('requestor',{createdAt:'2026-11-13T10:00:00.000Z'});assert.equal((await user(store,'/purchase-requests')).body.requests.length,0);await assert.rejects(user(store,'/purchase-requests/'+REQUEST),status(404));
});

test('claim is transactional, persists on disconnect and never automatically hands an uncertain request to another worker',async()=>{
 const {store,docs}=fixture();await submitted(store);const first=(await machine(store,'request-work',{workerId:WORKER})).body.work;assert.equal(first.kind,'request');assert.equal(first.payload.quote,null);assert.equal(first.payload.testOnly,true);assert.equal(first.payload.requestId,REQUEST);
 const retry=(await machine(store,'request-work',{workerId:WORKER})).body.work;assert.deepEqual(retry,first);assert.equal((await machine(store,'request-work',{workerId:OTHER_WORKER})).body.work,null);
 const heartbeat=docs.get('purchase-request:heartbeat');await machine(store,'request-work',{workerId:WORKER});assert.equal(docs.get('purchase-request:heartbeat'),heartbeat);
 await assert.rejects(user(store,'/purchase-requests/'+REQUEST+'/cancel','POST',{}),status(409));await assert.rejects(machine(store,'request-results',{...complete(first),workerId:OTHER_WORKER}),status(404));
});

test('queued cancellation is owned, removes work and cannot cancel after processing begins',async()=>{
 const {store}=fixture();await submitted(store);await assert.rejects(user(store,'/purchase-requests/'+REQUEST+'/cancel','POST',{},other),status(404));const cancelled=await user(store,'/purchase-requests/'+REQUEST+'/cancel','POST',{});assert.equal(cancelled.body.request.state,'cancelled');assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work,null);
});

test('verified NAS result validates PO/request identity before recording completion or queuing server-owned confirmation',async()=>{
 const {store,docs}=fixture();await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 for(const changes of [{totalCents:110001},{projectPageId:61},{requestReference:'other'},{url:'https://attacker.example/PO7413'},{purchaseOrderNumber:'bad'},{verifiedAt:'invalid'}])await assert.rejects(machine(store,'request-results',complete(work,changes)));
 assert.equal(docs.has('nexvia-confirmation-email:job:live:1421'),false);const done=await machine(store,'request-results',complete(work));assert.equal(done.body.request.state,'created_verified');assert.equal(done.body.request.result.verifiedAt,'2026-11-13T00:00:00.123Z');assert.equal(done.body.request.confirmation.status,'queued');const job=docs.get('nexvia-confirmation-email:job:live:1421');assert.deepEqual(job.payload.to,['requestor@example.test']);assert.match(job.payload.text,/\$1,100\.00 AUD/);assert.equal(job.confirmation.requestReference,'REQ-'+REQUEST);
 const count=docs.get('nexvia-confirmation-email:pending').length;await machine(store,'request-results',complete(work));assert.equal(docs.get('nexvia-confirmation-email:pending').length,count);await assert.rejects(machine(store,'request-results',{workerId:WORKER,id:work.id,claimToken:work.claimToken,kind:'request',state:'needs_review',message:'changed'}),status(409));
});

test('opt-in verified PO waits for its original PDF and duplicate uploads never resend or recreate it',async()=>{
 const {store,docs,files}=fixture();await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER,documentExpected:true})).body.work,reply=complete(work,{documentExpected:true});assert.equal(work.documentExpected,true);assert.equal(work.payload.documentExpected,undefined);
 const verified=await machine(store,'request-results',reply);assert.equal(verified.body.request.state,'created_verified');assert.equal(verified.body.request.confirmation.status,'awaiting_document');
 const key='nexvia-confirmation-email:job:live:1421';assert.equal(docs.get(key).firstAttemptAt,undefined);assert.equal(docs.get(key).attempts,0);assert.equal(docs.get('nexvia-confirmation-email:pending'),undefined);assert.deepEqual(docs.get('purchase-request:work'),[]);
 assert.equal((await machine(store,'request-results',reply)).body.request.confirmation.status,'awaiting_document');
 const document=await poDocument(work),uploaded=await machine(store,'request-document',document.body);assert.equal(uploaded.body.duplicate,false);assert.equal(uploaded.body.confirmation.status,'queued');
 assert.equal(files.size,1);assert.deepEqual(files.get(docs.get(key).document.key),document.bytes);assert.equal(docs.get(key).document.name,'PO7413.pdf');assert.deepEqual(docs.get('nexvia-confirmation-email:pending'),['live:1421']);
 const publicReply=JSON.stringify(uploaded.body);assert.equal(publicReply.includes(document.body.sha256),false);assert.equal(publicReply.includes(document.body.contentBase64),false);assert.equal(publicReply.includes('nexvia-po-documents/'),false);assert.equal(publicReply.includes(work.claimToken),false);
 store.env.EMAIL_ENABLED='true';store.env.RESEND_API_KEY='synthetic';let sent;
 await processNexviaConfirmationEmails(store,async(url,options)=>{sent={url,options};return Response.json({id:'provider-original-pdf'});});
 const payload=JSON.parse(sent.options.body);assert.deepEqual(Buffer.from(payload.attachments[0].content,'base64'),Buffer.from(document.bytes));assert.equal(payload.attachments.length,1);assert.equal(payload.attachments[0].filename,'PO7413.pdf');assert.equal(sent.options.headers['Idempotency-Key'],'nexvia-po-confirmation-live-1421');
 const before=structuredClone(docs.get(key));assert.equal((await machine(store,'request-document',document.body)).body.duplicate,true);assert.deepEqual(docs.get(key),before);
 await processNexviaConfirmationEmails(store,()=>assert.fail('an accepted PO confirmation must not resend'));assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work,null);
 const changed=await poDocument(work,'Changed original');await assert.rejects(machine(store,'request-document',changed.body),status(409));assert.equal(files.size,1);assert.deepEqual(docs.get(key),before);
});

test('document-capable polls mark only new request claims and block the legacy scanner before verification',async()=>{
 const {store,docs}=fixture();for(const documentExpected of ['true','false',1,0,null,[],{}])await assert.rejects(machine(store,'request-work',{workerId:WORKER,documentExpected}),status(400));assert.equal(docs.has('purchase-request:heartbeat'),false);
 await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER,documentExpected:true})).body.work;assert.equal(docs.get('purchase-request:record:'+REQUEST).documentExpected,true);assert.equal((await user(store,'/purchase-requests/'+REQUEST)).body.request.documentExpected,undefined);
 assert.deepEqual((await machine(store,'request-work',{workerId:WORKER,documentExpected:false})).body.work,work,'resuming cannot downgrade the frozen claim requirement');
 const legacy={requestId:REQUEST,requestReference:'REQ-'+REQUEST,recipient:'requestor@example.test',project:'Jardin building',purchaseOrderId:1421,purchaseOrderNumber:'PO7413',projectPageId:60,totalCents:110000,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt:'2026-11-13T00:00:00.123Z',test:false};
 assert.throws(()=>acceptNexviaConfirmation(store,legacy,store.env.NEXVIA_CONFIRMATION_TOKEN),status(409));assert.equal(docs.has('nexvia-confirmation-email:job:live:1421'),false);
 for(const documentExpected of [undefined,false])await assert.rejects(machine(store,'request-results',complete(work,{documentExpected})),status(409));assert.equal(docs.get('purchase-request:record:'+REQUEST).state,'processing');
 await machine(store,'request-results',complete(work,{documentExpected:true}));const frozen=structuredClone(docs.get('nexvia-confirmation-email:job:live:1421'));assert.throws(()=>acceptNexviaConfirmation(store,legacy,store.env.NEXVIA_CONFIRMATION_TOKEN),status(409));assert.deepEqual(docs.get('nexvia-confirmation-email:job:live:1421'),frozen);
 const old=fixture();await submitted(old.store);const claimed=(await machine(old.store,'request-work',{workerId:WORKER})).body.work;assert.equal((await machine(old.store,'request-work',{workerId:WORKER,documentExpected:true})).body.work.documentExpected,undefined);assert.equal(old.docs.get('purchase-request:record:'+claimed.id).documentExpected,undefined,'existing processing requests are never retrofitted');
 const lookup=fixture();await machine(lookup.store,'request-work',{workerId:WORKER,projects:[{projectPageId:60,name:'Jardin'}]});const queued=(await user(lookup.store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.lookup;const lookupWork=(await machine(lookup.store,'request-work',{workerId:WORKER,documentExpected:true})).body.work;assert.equal(lookupWork.kind,'lookup');assert.equal(lookupWork.documentExpected,undefined);assert.equal(lookup.docs.get('purchase-request:lookup:'+queued.id).documentExpected,undefined);
});

test('PO document opt-in is strict and existing verification callbacks cannot be upgraded or downgraded',async()=>{
 const {store,docs}=fixture();await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 for(const documentExpected of ['true','false',1,0,null,[],{}])await assert.rejects(machine(store,'request-results',complete(work,{documentExpected})),status(400));
 await machine(store,'request-results',complete(work,{documentExpected:true}));await assert.rejects(machine(store,'request-results',complete(work)),status(409));await assert.rejects(machine(store,'request-results',complete(work,{documentExpected:false})),status(409));
 assert.equal(docs.get('nexvia-confirmation-email:job:live:1421').status,'awaiting_document');
 const legacy=fixture();await submitted(legacy.store);const old=(await machine(legacy.store,'request-work',{workerId:WORKER})).body.work;await machine(legacy.store,'request-results',complete(old));assert.equal((await machine(legacy.store,'request-results',complete(old,{documentExpected:false}))).body.request.confirmation.status,'queued');
 const document=await poDocument(old);await assert.rejects(machine(legacy.store,'request-document',document.body),status(409));assert.equal(legacy.files.size,0);assert.equal(legacy.docs.get('nexvia-confirmation-email:job:live:1421').documentExpected,undefined);
});

test('PO document uploads reject wrong claims, identities, hashes and malformed or oversized PDF data',async()=>{
 const {store,docs,files}=fixture();await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER})).body.work,document=await poDocument(work);
 await assert.rejects(machine(store,'request-document',document.body),status(409));await machine(store,'request-results',complete(work,{documentExpected:true}));
 for(const changes of [{workerId:OTHER_WORKER},{claimToken:OTHER_WORKER},{id:OTHER_WORKER}])await assert.rejects(machine(store,'request-document',{...document.body,...changes}),status(404));
 for(const changes of [{purchaseOrderId:9999},{purchaseOrderNumber:'PO9999'},{projectPageId:61},{recipient:'other@example.test'},{filename:'other.pdf'},{url:'https://example.test/file.pdf'},{sha256:'0'.repeat(64)},{sha256:'BAD'},{contentBase64:'not base64'},{contentBase64:'JVBERi14AB=='},{contentBase64:Buffer.from('not a PDF').toString('base64')},{contentBase64:Buffer.alloc(5*1024*1024+1).toString('base64')}])await assert.rejects(machine(store,'request-document',{...document.body,...changes}),status(400));
 const invalid=Buffer.from('%PDF- not readable');await assert.rejects(machine(store,'request-document',{...document.body,sha256:createHash('sha256').update(invalid).digest('hex'),contentBase64:invalid.toString('base64')}),status(400));
 await assert.rejects(machine(store,'request-document',document.body,store.env.NEXVIA_CONFIRMATION_TOKEN),status(401));await assert.rejects(machine(store,'request-document',document.body,TOKEN,'GET'),status(405));store.env.READ_ONLY='true';await assert.rejects(machine(store,'request-document',document.body),status(503));
 assert.equal(files.size,0);assert.equal(docs.get('nexvia-confirmation-email:job:live:1421').status,'awaiting_document');assert.equal(docs.get('nexvia-confirmation-email:pending'),undefined);
});

test('PO document upload rechecks its claim after private storage and can safely retry a lost storage response',async()=>{
 const {store,docs,files}=fixture();await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;await machine(store,'request-results',complete(work,{documentExpected:true}));const document=await poDocument(work),put=store.env.CAD_PROJECT_FILES.put;
 store.env.CAD_PROJECT_FILES.put=async(...args)=>{await put(...args);throw Error('Synthetic lost R2 acknowledgement');};await assert.rejects(machine(store,'request-document',document.body));assert.equal(files.size,1);assert.equal(docs.get('nexvia-confirmation-email:job:live:1421').status,'awaiting_document');
 store.env.CAD_PROJECT_FILES.put=put;assert.equal((await machine(store,'request-document',document.body)).body.duplicate,false);assert.equal((await machine(store,'request-document',document.body)).body.duplicate,true);assert.equal(files.size,1);
 const stale=fixture();await submitted(stale.store);const staleWork=(await machine(stale.store,'request-work',{workerId:WORKER})).body.work;await machine(stale.store,'request-results',complete(staleWork,{documentExpected:true}));const staleDoc=await poDocument(staleWork),stalePut=stale.store.env.CAD_PROJECT_FILES.put;
 stale.store.env.CAD_PROJECT_FILES.put=async(...args)=>{await stalePut(...args);const record=stale.docs.get('purchase-request:record:'+REQUEST);stale.docs.set('purchase-request:record:'+REQUEST,{...record,claimToken:OTHER_WORKER});};await assert.rejects(machine(stale.store,'request-document',staleDoc.body),status(404));assert.equal(stale.docs.get('nexvia-confirmation-email:job:live:1421').status,'awaiting_document');assert.equal(stale.docs.get('nexvia-confirmation-email:pending'),undefined);
});

test('concurrent PO PDF uploads freeze only one document and preserve an identical retained object',async()=>{
 const {store,docs,files}=fixture();await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER})).body.work;await machine(store,'request-results',complete(work,{documentExpected:true}));const document=await poDocument(work),responses=await Promise.all([machine(store,'request-document',document.body),machine(store,'request-document',document.body)]);
 assert.deepEqual(responses.map(value=>value.body.duplicate).sort(),[false,true]);assert.equal(files.size,1);assert.deepEqual(files.get(docs.get('nexvia-confirmation-email:job:live:1421').document.key),document.bytes);assert.deepEqual(docs.get('nexvia-confirmation-email:pending'),['live:1421']);
});

test('fixed PDF test sends exactly one separately labelled original attachment and preserves accepted old jobs',async()=>{
 const {store,docs,files}=fixture();store.env.EMAIL_ENABLED='true';store.env.RESEND_API_KEY='synthetic';
 enqueueNexviaTestConfirmation(store,{isAdmin:true,username:'admin'});enqueueNexviaConfirmation(store,{requestId:REQUEST,requestReference:'Existing confirmation',recipient:'matt@lennoxfacades.com',project:'Jardin building',purchaseOrderId:1421,purchaseOrderNumber:'PO7413',projectPageId:60,totalCents:110000,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt:'2026-11-13T00:00:00.123Z',test:false});await processNexviaConfirmationEmails(store,async()=>Response.json({id:'old-accepted'}));
 const oldTest=structuredClone(docs.get('nexvia-confirmation-email:job:test:1421')),oldLive=structuredClone(docs.get('nexvia-confirmation-email:job:live:1421')),beforeRequests=structuredClone(docs.get('orders')),beforePOs=structuredClone(docs.get('workshop-stock'));
 let calls=0,sent;store.processNexviaConfirmationEmailQueue=()=>processNexviaConfirmationEmails(store,async(url,options)=>{calls++;sent={url,options};return Response.json({id:'test-document-accepted'});});
 const pdf=await poDocument({id:REQUEST,claimToken:WORKER}),body={sha256:pdf.body.sha256,contentBase64:pdf.body.contentBase64};
 const response=await machine(store,'test-document-confirmation',body);assert.equal(response.body.confirmation.id,'test-document:1421');assert.equal(response.body.confirmation.test,true);assert.equal(response.body.confirmation.status,'sent');assert.equal(response.body.confirmation.providerId,'test-document-accepted');assert.equal(response.body.documentAttached,true);assert.equal(response.body.documentSha256,body.sha256);assert.equal(response.body.duplicate,false);
 const payload=JSON.parse(sent.options.body);assert.deepEqual(payload.to,['matt@lennoxfacades.com']);assert.match(payload.subject,/TEST.*PDF.*PO7413/i);assert.match(payload.text,/does not create another purchase order/i);assert.match(payload.text,/\$1,100\.00 AUD/);assert.equal(payload.attachments[0].filename,'PO7413.pdf');assert.deepEqual(Buffer.from(payload.attachments[0].content,'base64'),Buffer.from(pdf.bytes));assert.equal(sent.options.headers['Idempotency-Key'],'nexvia-po-confirmation-test-document-1421');
 const frozen=structuredClone(docs.get('nexvia-confirmation-email:job:test-document:1421'));store.env.CAD_PROJECT_FILES.put=()=>assert.fail('accepted replay must not write the private PDF');assert.equal((await machine(store,'test-document-confirmation',body)).body.duplicate,true);assert.equal(calls,1);assert.deepEqual(docs.get('nexvia-confirmation-email:job:test-document:1421'),frozen);
 const changed=await poDocument({id:REQUEST,claimToken:WORKER},'Changed PDF');await assert.rejects(machine(store,'test-document-confirmation',{sha256:changed.body.sha256,contentBase64:changed.body.contentBase64}),status(409));assert.equal(calls,1);assert.equal(files.size,1);assert.deepEqual(docs.get('nexvia-confirmation-email:job:test:1421'),oldTest);assert.deepEqual(docs.get('nexvia-confirmation-email:job:live:1421'),oldLive);assert.deepEqual(docs.get('orders'),beforeRequests);assert.deepEqual(docs.get('workshop-stock'),beforePOs);assert.equal(docs.has('purchase-request:index'),false);assert.equal(docs.has('purchase-request:work'),false);
});

test('fixed PDF test status is strictly authenticated and read-only even during maintenance',async()=>{
 const {store,docs}=fixture(),before=structuredClone([...docs]);store.env.READ_ONLY='true';store.env.CAD_PROJECT_FILES.get=()=>assert.fail('status cannot fetch private bytes');store.env.CAD_PROJECT_FILES.put=()=>assert.fail('status cannot upload');store.processNexviaConfirmationEmailQueue=()=>assert.fail('status cannot send');
 assert.deepEqual((await machine(store,'test-document-confirmation',{},TOKEN,'GET')).body,{ok:true,confirmation:null,documentAttached:false,documentSha256:null});assert.deepEqual([...docs],before);
 await assert.rejects(machine(store,'test-document-confirmation',{},store.env.NEXVIA_CONFIRMATION_TOKEN,'GET'),status(401));await assert.rejects(machine(store,'test-document-confirmation',{recipient:'elsewhere@example.test'},TOKEN,'GET'),status(400));await assert.rejects(machine(store,'test-document-confirmation',{}),status(503));
 store.env.READ_ONLY='false';for(const extra of [{recipient:'elsewhere@example.test'},{purchaseOrderId:999},{projectPageId:61},{filename:'other.pdf'},{requestId:REQUEST}])await assert.rejects(machine(store,'test-document-confirmation',extra),status(400));await assert.rejects(machine(store,'test-document-confirmation',{sha256:'0'.repeat(64),contentBase64:'not base64'}),status(400));assert.deepEqual([...docs],before);
});

test('fixed PDF test freezes source through lost storage acknowledgement and post-await authentication changes',async()=>{
 const {store,docs,files}=fixture(),pdf=await poDocument({id:REQUEST,claimToken:WORKER}),body={sha256:pdf.body.sha256,contentBase64:pdf.body.contentBase64},put=store.env.CAD_PROJECT_FILES.put;
 store.env.CAD_PROJECT_FILES.put=async(...args)=>{await put(...args);throw Error('Lost R2 acknowledgement');};await assert.rejects(machine(store,'test-document-confirmation',body));const waiting=(await machine(store,'test-document-confirmation',{},TOKEN,'GET')).body;assert.equal(waiting.confirmation.status,'awaiting_document');assert.equal(waiting.documentAttached,false);assert.equal(waiting.documentSha256,body.sha256);assert.equal(docs.get('nexvia-confirmation-email:pending'),undefined);
 store.env.CAD_PROJECT_FILES.put=async(...args)=>{await put(...args);store.env.NEXVIA_REQUEST_TOKEN='rotated-request-worker-token-123456789';};await assert.rejects(machine(store,'test-document-confirmation',body),status(401));assert.equal(docs.get('nexvia-confirmation-email:job:test-document:1421').status,'awaiting_document');
 store.env.NEXVIA_REQUEST_TOKEN=TOKEN;store.env.CAD_PROJECT_FILES.put=put;assert.equal((await machine(store,'test-document-confirmation',body)).body.confirmation.status,'queued');assert.equal((await machine(store,'test-document-confirmation',body)).body.duplicate,true);assert.equal(files.size,1);assert.equal(docs.get('nexvia-confirmation-email:pending').length,1);
});

test('concurrent fixed PDF test uploads share one frozen job and provider acceptance',async()=>{
 const {store,docs,files}=fixture(),pdf=await poDocument({id:REQUEST,claimToken:WORKER}),body={sha256:pdf.body.sha256,contentBase64:pdf.body.contentBase64};store.env.EMAIL_ENABLED='true';store.env.RESEND_API_KEY='synthetic';let calls=0;
 store.processNexviaConfirmationEmailQueue=()=>processNexviaConfirmationEmails(store,async()=>{calls++;return Response.json({id:'one-test-acceptance'});});
 const responses=await Promise.all([machine(store,'test-document-confirmation',body),machine(store,'test-document-confirmation',body)]);assert.deepEqual(responses.map(value=>value.body.duplicate).sort(),[false,true]);assert.equal(calls,1);assert.equal(files.size,1);assert.equal(docs.get('nexvia-confirmation-email:job:test-document:1421').status,'sent');
 const before=structuredClone(docs.get('nexvia-confirmation-email:job:test-document:1421'));await machine(store,'test-document-confirmation',{},TOKEN,'GET');assert.deepEqual(docs.get('nexvia-confirmation-email:job:test-document:1421'),before);
});

test('fixed PDF test rechecks frozen source and maintenance after asynchronous storage',async()=>{
 for(const change of ['source','maintenance']){
  const {store,docs}=fixture(),pdf=await poDocument({id:REQUEST,claimToken:WORKER}),put=store.env.CAD_PROJECT_FILES.put;
  store.env.CAD_PROJECT_FILES.put=async(...args)=>{await put(...args);if(change==='maintenance')store.env.READ_ONLY='true';else{const key='nexvia-confirmation-email:job:test-document:1421',job=docs.get(key);docs.set(key,{...job,documentTestSource:{...job.documentTestSource,sha256:'0'.repeat(64)}});}};
  await assert.rejects(machine(store,'test-document-confirmation',{sha256:pdf.body.sha256,contentBase64:pdf.body.contentBase64}),status(change==='source'?409:503));assert.equal(docs.get('nexvia-confirmation-email:job:test-document:1421').status,'awaiting_document');assert.equal(docs.get('nexvia-confirmation-email:pending'),undefined);
 }
});

test('terminal result replay repairs a confirmation enqueue failure without claiming or creating the PO twice',async()=>{
 const {store,docs}=fixture();await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER})).body.work,original=store.write;let injected=false;
 store.write=(key,value)=>{if(!injected&&key==='nexvia-confirmation-email:job:live:1421'){injected=true;throw Error('Injected email queue failure');}return original(key,value);};await assert.rejects(machine(store,'request-results',complete(work)),/Injected/);assert.equal(docs.get('purchase-request:record:'+REQUEST).state,'created_verified');assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work,null);
 const repaired=await machine(store,'request-results',complete(work));assert.equal(repaired.body.request.confirmation.status,'queued');assert.equal(docs.get('nexvia-confirmation-email:pending').length,1);
});

test('PDF quotes are private, review-only, metadata-only on reads and never returned for NAS creation',async()=>{
 const {store,docs,files}=fixture(),bytes='%PDF-synthetic quote';const saved=await submitted(store,owner,{quote:{filename:'supplier.pdf'},quoteBase64:btoa(bytes)});assert.equal(saved.body.request.state,'needs_review');assert.deepEqual(saved.body.request.quote,{filename:'supplier.pdf',bytes:bytes.length});assert.equal(files.size,1);assert.ok([...files.keys()][0].startsWith('purchase-requests/'));
 assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work,null);const visible=JSON.stringify((await user(store,'/purchase-requests')).body);assert.ok(!visible.includes(btoa(bytes)));assert.ok(!visible.includes('quoteKey'));await assert.rejects(user(store,'/purchase-requests/'+REQUEST+'/quote','GET',{},other),status(404));const file=await user(store,'/purchase-requests/'+REQUEST+'/quote','GET',{},manager);assert.deepEqual(file.body.quote,{filename:'supplier.pdf',base64:btoa(bytes)});assert.equal(docs.has('nexvia-confirmation-email:pending'),false);
});

test('PDF validation and maintenance bounds apply without sending or staging malformed requests',async()=>{
 for(const changes of [{quote:{filename:'quote.pdf'},quoteBase64:btoa('not pdf')},{quote:{filename:'../quote.pdf'},quoteBase64:btoa('%PDF-x')},{quote:{filename:'quote.exe'},quoteBase64:btoa('%PDF-x')},{quote:null,quoteBase64:'unexpected'}])assert.throws(()=>normalizePurchaseRequestInput({...input(),...changes}));
 const {store}=fixture();await ready(store);store.env.READ_ONLY='true';await assert.rejects(user(store,'/purchase-requests','POST',input()),status(503));await assert.rejects(machine(store,'request-work',{workerId:WORKER}),status(503));assert.equal((await user(store,'/purchase-requests')).status,200);
});

test('a catalog change during quote upload returns a safe correction code and removes only an unreferenced upload',async()=>{
 const {store,docs,files}=fixture(),choices=await ready(store),packet={...input(choices.revision),quote:{filename:'quote.pdf'},quoteBase64:btoa('%PDF-upload')},put=store.env.CAD_PROJECT_FILES.put;
 store.env.CAD_PROJECT_FILES.put=async(key,bytes)=>{await put(key,bytes);docs.set('purchase-request:catalog:60',{...choices,revision:'changed-during-upload'});};await assert.rejects(user(store,'/purchase-requests','POST',packet),error=>error.status===409&&error.code==='PURCHASE_REQUEST_CHOICES_CHANGED');assert.equal(files.size,0);assert.equal(docs.has('purchase-request:record:'+REQUEST),false);
});

test('needs-review terminal results are idempotent and do not send confirmation or requeue creation',async()=>{
 const {store,docs}=fixture();await submitted(store);const work=(await machine(store,'request-work',{workerId:WORKER})).body.work,reply={workerId:WORKER,id:work.id,claimToken:work.claimToken,kind:'request',state:'needs_review',message:'Nexvia submission outcome requires reconciliation.'};const first=await machine(store,'request-results',reply);assert.equal(first.body.request.state,'needs_review');await machine(store,'request-results',reply);assert.equal((await machine(store,'request-work',{workerId:WORKER})).body.work,null);assert.equal(docs.has('nexvia-confirmation-email:pending'),false);
});

test('HTTP routes keep NAS credentials separate from user sessions and stock APIs; task defaults are off',async()=>{
 const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');const built=process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url);const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'purchase-request-integration',modules:true,script:fs.readFileSync(built,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:'purchase-request-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false',NEXVIA_REQUEST_TOKEN:TOKEN,NEXVIA_CONFIRMATION_TOKEN:'synthetic-confirm-only-credential-123456'}}]}));
 const request=async(path,body,token,method=body===undefined?'GET':'POST')=>{const response=await mf.dispatchFetch('http://localhost'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),pinHash=(pin,user)=>createHash('sha256').update(`${pin}:${user}:panelstock`).digest('hex');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:pinHash('123456','admin')},requestor:{isAdmin:false,pinHash:pinHash('654321','requestor')}}));let a=(await request('/login',{username:'admin',pin:'123456',app:'web'})).body.token,s=(await request('/login',{username:'requestor',pin:'654321',app:'web'})).body.token;assert.ok(a&&s);
  const access=(await request('/admin/users',{},a)).body;assert.equal(access.tasks.find(task=>task.code==='purchase-requests.create').defaultWorker,0);assert.equal(access.tasks.find(task=>task.code==='purchase-requests.manage').defaultWorker,0);assert.equal((await request('/purchase-requests',undefined,s)).status,403);assert.equal((await request('/purchase-requests/shared-choices',undefined,s)).status,403);assert.equal((await request('/purchase-requests/shared-choices',{},s)).status,403);assert.equal((await request('/purchase-requests/shared-choices')).status,401);
  assert.equal((await request('/purchase-requests/eow-choices',undefined,s)).status,403);assert.equal((await request('/purchase-requests/eow-choices')).status,401);assert.equal((await request('/purchase-requests/eow-choices',undefined,TOKEN)).status,401);
  await request('/admin/set-task-access',{targetUsername:'requestor',taskCode:'purchase-requests.create',allowed:true},a);s=(await request('/login',{username:'requestor',pin:'654321',app:'web'})).body.token;assert.equal((await request('/purchase-requests',undefined,s)).status,200);
  for(const path of ['/purchase-requests','/purchase-requests/shared-choices','/orders','/purchase-orders','/session'])assert.equal((await request(path,undefined,TOKEN)).status,401);assert.equal((await request('/purchase-requests/shared-choices',{},TOKEN)).status,401);assert.equal((await request('/purchase-requests/shared-choices',undefined,s)).body.sharedChoices,null);assert.equal((await request('/purchase-requests/shared-choices',{},s)).status,503);assert.equal((await request('/integrations/nexvia/request-work',{workerId:WORKER},s)).status,401);assert.equal((await request('/integrations/nexvia/request-work',{workerId:WORKER},'synthetic-confirm-only-credential-123456')).status,401);assert.equal((await request('/integrations/nexvia/request-work',{workerId:WORKER,projects:[{projectPageId:60,name:'Jardin building'}]},TOKEN)).status,200);
  const preloaded=await request('/purchase-requests/shared-choices',{},s);assert.equal(preloaded.status,200);choicePayload(preloaded.body);assert.equal(preloaded.body.sharedChoices,null);assert.equal(preloaded.body.lookup.state,'queued');assert.equal((await request('/purchase-requests/shared-choices',{},s)).body.lookup.id,preloaded.body.lookup.id);
  const lookup=(await request('/purchase-requests/lookups',{projectPageId:60},s)).body.lookup,work=(await request('/integrations/nexvia/request-work',{workerId:WORKER},TOKEN)).body.work;assert.equal(lookup.id,preloaded.body.lookup.id);assert.equal(work.kind,'lookup');const choices=(await request('/integrations/nexvia/request-results',{workerId:WORKER,id:lookup.id,claimToken:work.claimToken,kind:'lookup',state:'ready',catalog:catalog()},TOKEN)).body.catalog;
  const common=await request('/purchase-requests/shared-choices',undefined,s);assert.equal(common.status,200);assert.deepEqual(common.body.sharedChoices,{suppliers:choices.suppliers,services:choices.services,accounts:choices.accounts,taxes:choices.taxes,updatedAt:choices.updatedAt});assert.deepEqual(choicePayload((await request('/purchase-requests/shared-choices',{},s)).body),choicePayload(common.body));assert.equal((await request('/purchase-requests/shared-choices',{projectPageId:60},s)).status,400);assert.equal((await request('/purchase-requests/shared-choices',{refresh:'true'},s)).status,400);assert.equal((await request('/purchase-requests/shared-choices',undefined,s,'PUT')).status,405);
  const previews=await request('/purchase-requests/eow-choices',undefined,s);assert.equal(previews.status,200);assert.deepEqual(choicePayload(previews.body),{ok:true,eowPreviews:[{projectPageId:60,breakdowns:choices.breakdowns,updatedAt:choices.updatedAt}],truncated:false});assert.equal((await request('/purchase-requests/eow-choices',{},s)).status,405);
  const cached=await request('/purchase-requests/lookups',{projectPageId:60},s);assert.equal(cached.status,200);choicePayload(cached.body);assert.equal(cached.body.lookup.state,'ready');assert.deepEqual(cached.body.catalog,choices);assert.equal((await request('/integrations/nexvia/request-work',{workerId:WORKER},TOKEN)).body.work,null);
  const forced=await request('/purchase-requests/lookups',{projectPageId:60,refresh:true},s);assert.equal(forced.body.lookup.state,'queued');assert.equal(forced.body.catalog,null);assert.equal((await request('/purchase-requests/lookups',{projectPageId:60,refresh:true},s)).body.lookup.id,forced.body.lookup.id);
  const created=await request('/purchase-requests',input(choices.revision),s);assert.equal(created.status,201);assert.equal(created.body.request.totalCents,110000);assert.equal((await request('/purchase-orders',undefined,a)).body.orders.length,0);assert.equal((await request('/orders',undefined,a)).body.orders.length,0);
  const renamed=await request('/admin/rename-user',{targetUsername:'requestor',newUsername:'requestor-renamed',confirmedSynced:true},a);assert.equal(renamed.status,200);s=(await request('/login',{username:'requestor-renamed',pin:'654321',app:'web'})).body.token;assert.ok(s);const history=await request('/purchase-requests',undefined,s);assert.equal(history.status,200);assert.equal(history.body.requests[0].submittedBy,'requestor-renamed');assert.equal(history.body.requests[0].id,REQUEST);assert.equal(history.body.requests[0].lines,undefined);assert.equal((await request('/purchase-requests/'+REQUEST,undefined,s)).body.request.lines.length,1);
  assert.equal((await request('/integrations/nexvia/request-document',{},s)).status,401);assert.equal((await request('/integrations/nexvia/request-document',{},'synthetic-confirm-only-credential-123456')).status,401);assert.equal((await request('/integrations/nexvia/request-document',undefined,TOKEN)).status,405);
  const refreshWork=(await request('/integrations/nexvia/request-work',{workerId:WORKER},TOKEN)).body.work;assert.equal(refreshWork.kind,'lookup');await request('/integrations/nexvia/request-results',{workerId:WORKER,id:refreshWork.id,claimToken:refreshWork.claimToken,kind:'lookup',state:'ready',catalog:catalog()},TOKEN);
  const poWork=(await request('/integrations/nexvia/request-work',{workerId:WORKER,documentExpected:true},TOKEN)).body.work;assert.equal(poWork.kind,'request');assert.equal(poWork.documentExpected,true);assert.equal(poWork.payload.documentExpected,undefined);
  const legacyCallback={requestId:REQUEST,requestReference:'REQ-'+REQUEST,recipient:'requestor@example.test',project:'Jardin building',purchaseOrderId:1421,purchaseOrderNumber:'PO7413',projectPageId:60,totalCents:110000,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt:'2026-11-13T00:00:00.123Z',test:false};assert.equal((await request('/integrations/nexvia/confirmations',legacyCallback,'synthetic-confirm-only-credential-123456')).status,409);
  const verified=await request('/integrations/nexvia/request-results',complete(poWork,{documentExpected:true}),TOKEN);assert.equal(verified.status,200);assert.equal(verified.body.request.state,'created_verified');assert.equal(verified.body.request.confirmation.status,'awaiting_document');
  const document=await poDocument(poWork),uploaded=await request('/integrations/nexvia/request-document',document.body,TOKEN);assert.equal(uploaded.status,200);assert.equal(uploaded.body.duplicate,false);assert.equal(uploaded.body.confirmation.status,'queued');assert.equal((await request('/integrations/nexvia/request-document',document.body,TOKEN)).body.duplicate,true);
  const privateBucket=await mf.getR2Bucket('CAD_PROJECT_FILES'),privatePdf=await privateBucket.get('nexvia-po-documents/'+REQUEST+'/1421/'+document.body.sha256+'.pdf');assert.deepEqual(new Uint8Array(await privatePdf.arrayBuffer()),document.bytes);assert.equal(JSON.stringify(uploaded.body).includes(document.body.sha256),false);assert.equal((await request('/integrations/nexvia/request-work',{workerId:WORKER},TOKEN)).body.work,null);
  for(const token of [undefined,s,'synthetic-confirm-only-credential-123456'])assert.equal((await request('/integrations/nexvia/test-document-confirmation',undefined,token)).status,401);
  const untouchedTest=await request('/integrations/nexvia/test-document-confirmation',undefined,TOKEN);assert.deepEqual(untouchedTest.body,{ok:true,confirmation:null,documentAttached:false,documentSha256:null});
  const testBody={sha256:document.body.sha256,contentBase64:document.body.contentBase64};assert.equal((await request('/integrations/nexvia/test-document-confirmation',{...testBody,recipient:'other@example.test'},TOKEN)).status,400);
  const pdfTest=await request('/integrations/nexvia/test-document-confirmation',testBody,TOKEN);assert.equal(pdfTest.status,200);assert.equal(pdfTest.body.confirmation.id,'test-document:1421');assert.equal(pdfTest.body.confirmation.test,true);assert.equal(pdfTest.body.confirmation.status,'queued');assert.equal(pdfTest.body.documentAttached,true);assert.equal(pdfTest.body.documentSha256,testBody.sha256);assert.equal((await request('/integrations/nexvia/test-document-confirmation',testBody,TOKEN)).body.duplicate,true);assert.equal((await request('/integrations/nexvia/test-document-confirmation',undefined,TOKEN)).body.documentSha256,testBody.sha256);
 }finally{await mf.dispose();}
});
