import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeNexviaConfirmation,buildNexviaConfirmationEmail,enqueueNexviaConfirmation,attachNexviaConfirmationDocument,acceptNexviaConfirmation,enqueueNexviaTestConfirmation,nexviaConfirmationResult,processNexviaConfirmationEmails} from '../src/nexvia-confirmation-email.js';

const TOKEN='synthetic-nexvia-machine-credential-123456789';
const input=()=>({requestId:'35fc4244-267c-42c6-885c-6ab93a55b899',requestReference:'REQ-7413',recipient:'matt@lennoxfacades.com',project:'Jardin building',purchaseOrderId:1421,purchaseOrderNumber:'PO7413',projectPageId:60,totalCents:110000,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt:'2026-11-12T23:10:00.000Z',test:false});
function fixture(){
 const docs=new Map([['orders',[{id:'untouched-order'}]],['workshop-stock',{purchaseOrders:[{reference:'PO7413'}]}]]),audit=[],writes=[],files=new Map();
 const store={env:{EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic-resend-key',NEXVIA_CONFIRMATION_TOKEN:TOKEN,FROM_EMAIL:'reports@example.test',ORDER_FROM_EMAIL:'orders@example.test',PO_REQUEST_FROM_EMAIL:'PanelStockHQ <porequest@panelstockhq.com>'},read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>{assert.ok(key.startsWith('nexvia-confirmation-email:'),'must not write PO/order state');writes.push(key);docs.set(key,structuredClone(value));},audit:(...args)=>audit.push(args),ctx:{storage:{transactionSync:fn=>fn()}}};
 store.env.CAD_PROJECT_FILES={get:async key=>files.has(key)?{size:files.get(key).length,arrayBuffer:async()=>files.get(key).slice().buffer}:null};
 return {store,docs,audit,writes,files};
}
const job=(docs,lane='live',id=1421)=>docs.get('nexvia-confirmation-email:job:'+lane+':'+id);
const documentFor=(bytes,confirmation=input())=>{const sha256=createHash('sha256').update(bytes).digest('hex');return {key:'nexvia-po-documents/'+confirmation.requestId+'/'+confirmation.purchaseOrderId+'/'+sha256+'.pdf',name:confirmation.purchaseOrderNumber+'.pdf',size:bytes.length,sha256};};
const originalPdf=()=>new TextEncoder().encode('%PDF-1.7\nOriginal Nexvia PDF bytes\n\u00e9\u00ff\n%%EOF');
function attach(store,files,bytes=originalPdf(),confirmation=input()){
 const document=documentFor(bytes,confirmation);files.set(document.key,bytes.slice());return {document,result:store.ctx.storage.transactionSync(()=>attachNexviaConfirmationDocument(store,confirmation,document))};
}

test('PO confirmation preserves GST-inclusive cents, sender, exact recipient and escaped details',()=>{
 const confirmation=normalizeNexviaConfirmation(input());
 const payload=buildNexviaConfirmationEmail(confirmation,'PanelStockHQ <porequest@panelstockhq.com>');
 assert.equal(payload.from,'PanelStockHQ <porequest@panelstockhq.com>');assert.deepEqual(payload.to,['matt@lennoxfacades.com']);
 assert.equal(payload.subject,'PO confirmation: PO7413 | Jardin building');assert.match(payload.text,/Total including GST: \$1,100\.00 AUD/);assert.doesNotMatch(payload.text,/1,210/);
 const safe=buildNexviaConfirmationEmail({...confirmation,project:'Jardin <script> & building'});assert.match(safe.html,/Jardin &lt;script&gt; &amp; building/);assert.doesNotMatch(safe.html,/<script>/);
});

test('unverified states, arbitrary fields, unsafe addresses and malformed monetary values are rejected',()=>{
 for(const changes of [{state:'CREATE_SUBMITTED'},{state:'NEEDS_RECONCILIATION'},{recipient:'matt@example.com\nBcc:x@example.com'},{totalCents:'110000'},{totalCents:-1},{totalCents:110000.1},{purchaseOrderId:0},{projectPageId:0},{currency:'USD'},{verifiedAt:null},{verifiedAt:'2026-02-30T00:00:00Z'},{test:undefined},{createPurchaseOrder:true},{documentExpected:true}]){
  assert.throws(()=>normalizeNexviaConfirmation({...input(),...changes}));
 }
});

test('machine credentials require configuration, and callbacks cannot enqueue while read-only',()=>{
 const {store,writes}=fixture();
 assert.throws(()=>acceptNexviaConfirmation(store,input(),'wrong'),error=>error.status===401);
 delete store.env.NEXVIA_CONFIRMATION_TOKEN;assert.throws(()=>acceptNexviaConfirmation(store,input(),TOKEN),error=>error.status===503);
 store.env.NEXVIA_CONFIRMATION_TOKEN='too-short';assert.throws(()=>acceptNexviaConfirmation(store,input(),'too-short'),error=>error.status===503);
 store.env.NEXVIA_CONFIRMATION_TOKEN=TOKEN;store.env.READ_ONLY='true';assert.throws(()=>acceptNexviaConfirmation(store,input(),TOKEN),error=>error.status===503);assert.equal(writes.length,0);
});

test('legacy confirmation callbacks cannot race a managed PDF request before or after PO verification',async()=>{
 for(const state of ['processing','created_verified']){
  const {store,docs,writes}=fixture(),confirmation=input(),record={id:confirmation.requestId,state,documentExpected:true};docs.set('purchase-request:record:'+confirmation.requestId,record);
  if(state==='created_verified')enqueueNexviaConfirmation(store,confirmation,'nexvia-request-worker',{documentExpected:true});
  const before=structuredClone([...docs]),count=writes.length;
  assert.throws(()=>acceptNexviaConfirmation(store,{...confirmation,requestId:confirmation.requestId.toUpperCase()},TOKEN),error=>error.status===409&&/managed by the Nexvia request worker/.test(error.message));
  await processNexviaConfirmationEmails(store,()=>assert.fail('legacy scanner must never send a managed PDF confirmation'));
  assert.deepEqual([...docs],before);assert.equal(writes.length,count);assert.equal(docs.has('nexvia-confirmation-email:pending'),false);
 }
 for(const documentExpected of [undefined,false]){
  const {store,docs}=fixture(),confirmation=input();docs.set('purchase-request:record:'+confirmation.requestId,{state:'processing',...(documentExpected===false?{documentExpected:false}:{})});
  assert.equal(acceptNexviaConfirmation(store,confirmation,TOKEN).confirmation.status,'queued');let calls=0;await processNexviaConfirmationEmails(store,async()=>{calls++;return Response.json({id:'legacy-accepted'});});assert.equal(calls,1);
 }
});

test('duplicate callbacks share one job, changed details conflict, test and live confirmations use separate lanes',async()=>{
 const {store,docs,audit}=fixture(),first=acceptNexviaConfirmation(store,input(),TOKEN);
 const duplicate=acceptNexviaConfirmation(store,{...input()},TOKEN);assert.equal(first.confirmation.id,duplicate.confirmation.id);assert.equal(duplicate.duplicate,true);assert.equal(audit.length,1);
 for(const changes of [{recipient:'changed@example.test'},{totalCents:120000},{project:'Changed building'},{requestId:'71e6b4e1-f2e8-4024-9c97-bf83acd07933'},{verifiedAt:'2026-11-12T23:11:00.000Z'}])assert.throws(()=>acceptNexviaConfirmation(store,{...input(),...changes},TOKEN),error=>error.status===409);
 assert.throws(()=>enqueueNexviaTestConfirmation(store,{username:'staff'}),error=>error.status===403);
 const testJob=enqueueNexviaTestConfirmation(store,{isAdmin:true,username:'admin'});assert.equal(testJob.confirmation.id,'test:1421');
 assert.equal(job(docs,'test').confirmation.verifiedAt,null);assert.equal(job(docs,'test').confirmation.evidenceSource,'user-authorized-existing-po-test');
 assert.match(job(docs,'test').payload.subject,/^TEST/);assert.match(job(docs,'test').payload.text,/does not create another purchase order/);
 assert.equal(enqueueNexviaTestConfirmation(store,{isAdmin:true,username:'admin'}).duplicate,true);
 let calls=0;await processNexviaConfirmationEmails(store,async()=>{calls++;return Response.json({id:'accepted-'+calls});});assert.equal(calls,2);
 assert.equal(job(docs).status,'sent');assert.equal(job(docs,'test').status,'sent');assert.equal(nexviaConfirmationResult(store,first).confirmation.providerId,'accepted-1');
 await processNexviaConfirmationEmails(store,()=>assert.fail('must never resend accepted confirmations'));
 assert.deepEqual(docs.get('orders'),[{id:'untouched-order'}]);assert.deepEqual(docs.get('workshop-stock'),{purchaseOrders:[{reference:'PO7413'}]});
});

test('timeouts retry with the exact stored payload and provider key, without changing any existing sender',async()=>{
 const {store,docs}=fixture(),now=Date.now();enqueueNexviaConfirmation(store,input());const calls=[];
 await processNexviaConfirmationEmails(store,async(url,options)=>{calls.push({url,body:options.body,key:options.headers['Idempotency-Key']});throw Error('timeout');},now);
 assert.equal(job(docs).status,'retrying');store.env.PO_REQUEST_FROM_EMAIL='changed@example.test';
 await processNexviaConfirmationEmails(store,()=>assert.fail('retry too early'),now+60000);
 await processNexviaConfirmationEmails(store,async(url,options)=>{calls.push({url,body:options.body,key:options.headers['Idempotency-Key']});return Response.json({id:'resend-accepted'});},now+16*60000);
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].key,'nexvia-po-confirmation-live-1421');assert.equal(JSON.parse(calls[1].body).from,'PanelStockHQ <porequest@panelstockhq.com>');
 assert.equal(job(docs).providerId,'resend-accepted');assert.equal(store.env.FROM_EMAIL,'reports@example.test');assert.equal(store.env.ORDER_FROM_EMAIL,'orders@example.test');
});

test('only new opt-in jobs wait for a private document and duplicate enqueue never upgrades legacy jobs',async()=>{
 const {store,docs,files}=fixture(),first=enqueueNexviaConfirmation(store,input(),'test',{documentExpected:true});
 assert.equal(first.confirmation.status,'awaiting_document');assert.equal(job(docs).documentExpected,true);assert.equal(job(docs).firstAttemptAt,undefined);assert.equal(job(docs).attempts,0);assert.equal(docs.has('nexvia-confirmation-email:pending'),false);
 await processNexviaConfirmationEmails(store,()=>assert.fail('waiting document cannot send'));
 const frozen=structuredClone(job(docs));store.env.PO_REQUEST_FROM_EMAIL='changed@example.test';assert.equal(enqueueNexviaConfirmation(store,input(),'test',{documentExpected:true}).duplicate,true);assert.equal(enqueueNexviaConfirmation(store,input()).duplicate,true);assert.deepEqual(job(docs),frozen);
 const legacy={...input(),purchaseOrderId:1422,purchaseOrderNumber:'PO7414'};enqueueNexviaConfirmation(store,legacy);const before=structuredClone(job(docs,'live',1422));assert.throws(()=>enqueueNexviaConfirmation(store,legacy,'test',{documentExpected:true}),error=>error.status===409);assert.deepEqual(job(docs,'live',1422),before);assert.throws(()=>attachNexviaConfirmationDocument(store,legacy,documentFor(originalPdf(),legacy)),error=>error.status===409);
 await processNexviaConfirmationEmails(store,async()=>Response.json({id:'legacy-receipt'}));const sentLegacy=structuredClone(job(docs,'live',1422));assert.equal(sentLegacy.status,'sent');assert.throws(()=>enqueueNexviaConfirmation(store,legacy,'test',{documentExpected:true}),error=>error.status===409);assert.deepEqual(job(docs,'live',1422),sentLegacy);
 const {result}=attach(store,files);assert.equal(result.confirmation.status,'queued');assert.deepEqual(Object.keys(result.confirmation).sort(),['acceptedAt','attempts','error','id','providerId','purchaseOrderId','purchaseOrderNumber','status','test']);assert.equal(job(docs).payload.from,frozen.payload.from);
});

test('private document finalization freezes one matching reference and cannot change an attached or sent job',async()=>{
 const {store,docs,files}=fixture();enqueueNexviaConfirmation(store,input(),'test',{documentExpected:true});const {document,result}=attach(store,files);assert.equal(result.duplicate,false);
 const before=structuredClone(job(docs));assert.equal(attachNexviaConfirmationDocument(store,input(),document).duplicate,true);assert.deepEqual(job(docs),before);
 const changed=documentFor(new TextEncoder().encode('%PDF-another file'));assert.throws(()=>attachNexviaConfirmationDocument(store,input(),changed),error=>error.status===409);
 for(const wrong of [{...document,key:'private/other.pdf'},{...document,name:'Other.pdf'},{...document,size:5*1024*1024+1},{...document,sha256:'wrong'},{...document,extra:true}])assert.throws(()=>attachNexviaConfirmationDocument(store,input(),wrong));
 assert.throws(()=>attachNexviaConfirmationDocument(store,{...input(),recipient:'other@example.test'},document),error=>error.status===409);
 await processNexviaConfirmationEmails(store,async()=>Response.json({id:'accepted'}));const sent=structuredClone(job(docs));assert.equal(attachNexviaConfirmationDocument(store,input(),document).duplicate,true);assert.deepEqual(job(docs),sent);
 await processNexviaConfirmationEmails(store,()=>assert.fail('sent document must not resend'));
});

test('document emails send the exact original bytes once and timeout retries preserve body and provider key',async()=>{
 const {store,docs,files}=fixture(),bytes=originalPdf(),now=Date.now();enqueueNexviaConfirmation(store,input(),'test',{documentExpected:true});const {document}=attach(store,files,bytes),calls=[];
 await processNexviaConfirmationEmails(store,async(url,options)=>{calls.push({url,body:options.body,key:options.headers['Idempotency-Key']});throw Error('uncertain acceptance');},now);
 assert.equal(job(docs).status,'retrying');assert.equal(job(docs).attempts,1);const payload=JSON.parse(calls[0].body);assert.deepEqual(payload.attachments,[{filename:'PO7413.pdf',content:Buffer.from(bytes).toString('base64')}]);assert.deepEqual(Buffer.from(payload.attachments[0].content,'base64'),Buffer.from(bytes));assert.equal(job(docs).payload.attachments,undefined,'SQL job retains only frozen base fields and private reference');assert.deepEqual(job(docs).document,document);
 store.env.PO_REQUEST_FROM_EMAIL='changed@example.test';await processNexviaConfirmationEmails(store,async(url,options)=>{calls.push({url,body:options.body,key:options.headers['Idempotency-Key']});return Response.json({id:'provider-receipt'});},now+16*60000);
 assert.deepEqual(calls[1],calls[0]);assert.equal(calls[0].key,'nexvia-po-confirmation-live-1421');assert.equal(job(docs).status,'sent');await processNexviaConfirmationEmails(store,()=>assert.fail('accepted document cannot send again'));
});

test('missing, corrupt or inaccessible frozen PDFs require review without starting a provider attempt',async()=>{
 for(const corruption of ['missing','contents','size','read-error']){
  const {store,docs,files}=fixture();enqueueNexviaConfirmation(store,input(),'test',{documentExpected:true});const {document}=attach(store,files);
  if(corruption==='missing')files.delete(document.key);else if(corruption==='contents'){const bytes=files.get(document.key).slice();bytes[bytes.length-1]^=1;files.set(document.key,bytes);}else if(corruption==='size')files.set(document.key,new Uint8Array(document.size+1));else store.env.CAD_PROJECT_FILES.get=async()=>{throw Error('unavailable');};
  await processNexviaConfirmationEmails(store,()=>assert.fail('invalid frozen document cannot send'));assert.equal(job(docs).status,'needs_review');assert.equal(job(docs).attempts,0);assert.equal(job(docs).firstAttemptAt,undefined);assert.deepEqual(job(docs).document,document);
 }
});

test('a slow document read cannot send after losing its attempt or lease, or start the retry clock early',async()=>{
 const {store,docs,files}=fixture(),now=Date.now();enqueueNexviaConfirmation(store,input(),'test',{documentExpected:true});const {document}=attach(store,files),get=store.env.CAD_PROJECT_FILES.get;let release,reads=0,calls=0;
 store.env.CAD_PROJECT_FILES.get=key=>++reads===1?new Promise(resolve=>release=async()=>resolve(await get(key))):get(key);
 const first=processNexviaConfirmationEmails(store,()=>{calls++;return Response.json({id:'stale'});},now);assert.equal(job(docs).attempts,0);assert.equal(job(docs).firstAttemptAt,undefined);
 await processNexviaConfirmationEmails(store,()=>assert.fail('live lease blocks overlap'),now+30000);
 await processNexviaConfirmationEmails(store,async()=>{calls++;return Response.json({id:'current'});},now+61000);assert.equal(job(docs).status,'sent');assert.equal(job(docs).attempts,1);assert.ok(job(docs).firstAttemptAt>=now+61000);
 await release();await first;assert.equal(calls,1);assert.equal(job(docs).providerId,'current');assert.deepEqual(job(docs).document,document);
});

test('document preparation time is bounded by the lease and uncertain sends retain the23-hour cutoff',async t=>{
 const now=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});
 const {store,docs,files}=fixture();enqueueNexviaConfirmation(store,input(),'test',{documentExpected:true});attach(store,files);const get=store.env.CAD_PROJECT_FILES.get;
 store.env.CAD_PROJECT_FILES.get=async key=>{t.mock.timers.setTime(now+60001);return get(key);};await processNexviaConfirmationEmails(store,()=>assert.fail('expired preparation lease cannot send'),now);assert.equal(job(docs).attempts,0);assert.equal(job(docs).firstAttemptAt,undefined);
 store.env.CAD_PROJECT_FILES.get=get;await processNexviaConfirmationEmails(store,async()=>{throw Error('timeout');},now+60002);assert.equal(job(docs).attempts,1);const firstAttemptAt=job(docs).firstAttemptAt;
 await processNexviaConfirmationEmails(store,()=>assert.fail('uncertain late document cannot resend'),firstAttemptAt+23*3600000);assert.equal(job(docs).status,'needs_review');assert.equal(job(docs).attempts,1);
});

test('leases block overlapping sends and stale completions cannot overwrite a newer attempt',async()=>{
 const {store,docs}=fixture(),now=Date.now();enqueueNexviaConfirmation(store,input());let finish,calls=0;
 const pending=processNexviaConfirmationEmails(store,async()=>{calls++;return new Promise(resolve=>finish=resolve);},now);
 await processNexviaConfirmationEmails(store,()=>assert.fail('lease must block overlap'),now+30000);assert.equal(calls,1);
 await processNexviaConfirmationEmails(store,async()=>{calls++;return Response.json({id:'current-attempt'});},now+61000);
 finish(Response.json({id:'stale-attempt'}));await pending;assert.equal(calls,2);assert.equal(job(docs).providerId,'current-attempt');assert.equal(job(docs).status,'sent');
});

test('retry window stops uncertain late sends; permanent rejection stays failed and batch size is bounded',async()=>{
 const {store,docs}=fixture(),now=Date.now();enqueueNexviaConfirmation(store,input());
 await processNexviaConfirmationEmails(store,async()=>Response.json({message:'busy'},{status:503}),now);
 await processNexviaConfirmationEmails(store,()=>assert.fail('late retry would risk duplicates'),now+23*3600000);assert.equal(job(docs).status,'needs_review');
 for(let id=1422;id<=1425;id++)enqueueNexviaConfirmation(store,{...input(),purchaseOrderId:id,purchaseOrderNumber:'PO'+id});
 let calls=0;await processNexviaConfirmationEmails(store,async()=>{calls++;return Response.json({message:'invalid sender'},{status:422});},now);assert.equal(calls,3);
 assert.equal(job(docs,'live',1422).status,'failed');assert.equal(job(docs,'live',1425).status,'queued');
 await processNexviaConfirmationEmails(store,async()=>{calls++;return Response.json({id:'accepted'});},now);assert.equal(calls,4);
});

test('disabled or maintenance environments retain queued work without reporting successful acceptance',async()=>{
 for(const changes of [{EMAIL_ENABLED:'false'},{RESEND_API_KEY:''},{READ_ONLY:'true'}]){
  const {store,docs}=fixture(),result=enqueueNexviaConfirmation(store,input());Object.assign(store.env,changes);
  await processNexviaConfirmationEmails(store,()=>assert.fail('disabled sending'));assert.equal(job(docs).status,'queued');assert.equal(nexviaConfirmationResult(store,result).confirmation.providerId,null);
 }
});

test('HTTP integration scopes the machine credential to confirmations and keeps the fixed test administrator-only',async()=>{
 const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');
 const built=process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url);
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'nexvia-confirmation-integration',modules:true,script:fs.readFileSync(built,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:'nexvia-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false',NEXVIA_CONFIRMATION_TOKEN:TOKEN}}]}));
 const request=async(path,body,token,method=body===undefined?'GET':'POST')=>{const response=await mf.dispatchFetch('http://localhost'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),pinHash=(pin,user)=>createHash('sha256').update(`${pin}:${user}:panelstock`).digest('hex');
  await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:pinHash('123456','admin')},staff:{isAdmin:false,pinHash:pinHash('654321','staff')}}));
  const admin=(await request('/login',{username:'admin',pin:'123456'})).body.token,staff=(await request('/login',{username:'staff',pin:'654321'})).body.token;assert.ok(admin&&staff);
  for(const path of ['/session','/purchase-orders','/orders'])assert.equal((await request(path,undefined,TOKEN)).status,401);
  assert.equal((await request('/orders',{order:{project:'must not create'}},TOKEN)).status,401);
  assert.equal((await request('/integrations/nexvia/confirmations',input(),'bad')).status,401);
  assert.equal((await request('/integrations/nexvia/confirmations',input(),admin)).status,401);
  assert.equal((await request('/integrations/nexvia/confirmations',undefined,TOKEN)).status,405);
  const queued=await request('/integrations/nexvia/confirmations',input(),TOKEN);assert.equal(queued.status,200);assert.equal(queued.body.confirmation.status,'queued');assert.equal(queued.body.confirmation.providerId,null);
  assert.equal((await request('/integrations/nexvia/confirmations',input(),TOKEN)).body.duplicate,true);
  assert.equal((await request('/integrations/nexvia/confirmations',{...input(),totalCents:120000},TOKEN)).status,409);
  assert.equal((await request('/integrations/nexvia/test-confirmation',{},TOKEN)).status,401);
  assert.equal((await request('/integrations/nexvia/test-confirmation',{},staff)).status,403);
  assert.equal((await request('/integrations/nexvia/test-confirmation',{recipient:'elsewhere@example.test'},admin)).status,400);
  const fixed=await request('/integrations/nexvia/test-confirmation',{},admin);assert.equal(fixed.status,200);assert.equal(fixed.body.confirmation.test,true);assert.equal(fixed.body.confirmation.purchaseOrderNumber,'PO7413');
  assert.equal((await request('/orders',undefined,admin)).body.orders.length,0);assert.equal((await request('/purchase-orders',undefined,admin)).body.orders.length,0);
 }finally{await mf.dispose();}
});
