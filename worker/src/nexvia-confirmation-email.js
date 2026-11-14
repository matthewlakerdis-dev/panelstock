import {equal,requireCondition as check} from './security.js';

const INDEX='nexvia-confirmation-email:pending';
const PREFIX='nexvia-confirmation-email:job:';
const DOCUMENT_TEST_ID='test-document:1421';
const RETRY_MS=15*60000,LEASE_MS=60000,SAFE_RETRY_MS=23*3600000,MAX_DOCUMENT=5*1024*1024;
const DEFAULT_SENDER='PanelStockHQ <porequest@panelstockhq.com>';
const fields=['requestId','requestReference','recipient','project','purchaseOrderId','purchaseOrderNumber','projectPageId','totalCents','currency','state','verifiedAt','test'];
const clean=(value,max,label)=>{check(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value),'Invalid '+label);return value.trim();};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const identity=confirmation=>(confirmation.test?'test:':'live:')+confirmation.purchaseOrderId;
const publicJob=job=>({id:job.id,status:job.status,purchaseOrderId:job.confirmation.purchaseOrderId,purchaseOrderNumber:job.confirmation.purchaseOrderNumber,test:job.confirmation.test,attempts:job.attempts,providerId:job.providerId||null,acceptedAt:job.acceptedAt||null,error:job.error||''});

export function normalizeNexviaConfirmation(body){
 check(body&&typeof body==='object'&&!Array.isArray(body),'Confirmation details are required');
 check(Object.keys(body).every(key=>fields.includes(key)),'Unknown confirmation field');
 const requestId=clean(body.requestId,36,'request ID').toLowerCase();
 check(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId),'Invalid request ID');
 const requestReference=clean(body.requestReference,160,'request reference');
 const recipient=clean(body.recipient,254,'recipient').toLowerCase();
 check(/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(recipient),'Invalid recipient');
 const project=clean(body.project,160,'project');
 check(Number.isSafeInteger(body.purchaseOrderId)&&body.purchaseOrderId>0,'Invalid purchase order ID');
 const purchaseOrderNumber=clean(body.purchaseOrderNumber,40,'purchase order number').toUpperCase();
 check(/^PO\d+$/.test(purchaseOrderNumber),'Invalid purchase order number');
 check(Number.isSafeInteger(body.projectPageId)&&body.projectPageId>0,'Invalid project page ID');
 check(Number.isSafeInteger(body.totalCents)&&body.totalCents>=0&&body.totalCents<=1e12,'Invalid GST-inclusive total in cents');
 check(body.currency==='AUD','Confirmation currency must be AUD');
 check(body.state==='CREATED_VERIFIED','An existing verified Nexvia PO is required');
 const verifiedAt=clean(body.verifiedAt,40,'verification timestamp');
 check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(verifiedAt)&&Number.isFinite(Date.parse(verifiedAt))&&new Date(verifiedAt).toISOString().slice(0,19)===verifiedAt.slice(0,19)&&Date.parse(verifiedAt)<=Date.now()+60000,'Invalid verification timestamp');
 check(typeof body.test==='boolean','Specify whether this is a test confirmation');
 return {requestId,requestReference,recipient,project,purchaseOrderId:body.purchaseOrderId,purchaseOrderNumber,projectPageId:body.projectPageId,totalCents:body.totalCents,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt,test:body.test};
}

export function buildNexviaConfirmationEmail(confirmation,from=DEFAULT_SENDER){
 const amount=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(confirmation.totalCents/100);
 const title=(confirmation.test?'TEST — ':'')+'PO confirmation: '+confirmation.purchaseOrderNumber+' | '+confirmation.project;
 const intro=confirmation.test?'This is a test confirmation for an existing Nexvia purchase order.':'Your Nexvia purchase order has been created and verified.';
 const details=[['Purchase order',confirmation.purchaseOrderNumber],['Building / project',confirmation.project],['Total including GST',amount+' AUD'],['Request reference',confirmation.requestReference]];
 const footer=confirmation.test?'This test only sends an email. It does not create another purchase order.':'This confirmation refers to the verified purchase order in Nexvia.';
 return {from,to:[confirmation.recipient],subject:title,text:intro+'\n\n'+details.map(([label,value])=>label+': '+value).join('\n')+'\n\n'+footer,html:'<div style="font-family:Arial,sans-serif;color:#163344;max-width:640px"><h1>'+escape(title)+'</h1><p>'+escape(intro)+'</p>'+details.map(([label,value])=>'<p><strong>'+escape(label)+':</strong> '+escape(value)+'</p>').join('')+'<p>'+escape(footer)+'</p></div>'};
}

export function enqueueNexviaConfirmation(store,body,actor='nexvia-worker',options={}){
 check(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(key=>key==='documentExpected')&&(options.documentExpected===undefined||typeof options.documentExpected==='boolean'),'Invalid confirmation options');
 return enqueueValidatedConfirmation(store,normalizeNexviaConfirmation(body),actor,options.documentExpected===true);
}

function enqueueValidatedConfirmation(store,confirmation,actor,documentExpected=false){
 check(store.env.READ_ONLY!=='true','Confirmation sending is paused for maintenance',503);
 const id=identity(confirmation),key=PREFIX+id;
 let duplicate=false,job;
 store.ctx.storage.transactionSync(()=>{
  const prior=store.read(key,null);
  if(prior){check(JSON.stringify(prior.confirmation)===JSON.stringify(confirmation),'This purchase order already has a different confirmation. Review the original instead of resending.',409);check(!documentExpected||prior.documentExpected===true,'This confirmation was already frozen without a PO document. Review the original instead of changing it.',409);duplicate=true;job=prior;return;}
  const pending=store.read(INDEX,[]);check(pending.length<5000,'The confirmation queue is full',503);
  job={id,confirmation,payload:buildNexviaConfirmationEmail(confirmation,store.env.PO_REQUEST_FROM_EMAIL||DEFAULT_SENDER),status:documentExpected?'awaiting_document':'queued',attempts:0,nextAttemptAt:0,leaseUntil:0,createdAt:new Date().toISOString(),...(documentExpected?{documentExpected:true}:{})};
  store.write(key,job);if(!documentExpected)store.write(INDEX,[...pending,id]);
  store.audit(actor,'nexvia-confirmation-queued',{id,purchaseOrderId:confirmation.purchaseOrderId,purchaseOrderNumber:confirmation.purchaseOrderNumber,test:confirmation.test});
 });
 return {ok:true,duplicate,confirmation:publicJob(job)};
}

function documentReference(confirmation,document){
 check(document&&typeof document==='object'&&!Array.isArray(document)&&Object.keys(document).every(key=>['key','name','size','sha256'].includes(key)),'Invalid PO document reference');
 check(typeof document.sha256==='string'&&/^[a-f0-9]{64}$/.test(document.sha256),'Invalid PO document hash');
 check(document.key==='nexvia-po-documents/'+confirmation.requestId+'/'+confirmation.purchaseOrderId+'/'+document.sha256+'.pdf'&&document.name===confirmation.purchaseOrderNumber+'.pdf','PO document identity does not match the confirmation',409);
 check(Number.isSafeInteger(document.size)&&document.size>=5&&document.size<=MAX_DOCUMENT,'Invalid PO document size');
 return {key:document.key,name:document.name,size:document.size,sha256:document.sha256};
}

// The request-document endpoint calls this inside its post-upload identity
// transaction. All validation precedes the immutable reference/queue writes.
export function attachNexviaConfirmationDocument(store,body,document,actor='nexvia-request-worker'){
 check(store.env.READ_ONLY!=='true','Confirmation sending is paused for maintenance',503);
 const confirmation=normalizeNexviaConfirmation(body);check(!confirmation.test,'Test confirmations cannot acquire a PO document',409);
 const reference=documentReference(confirmation,document),id=identity(confirmation),key=PREFIX+id,job=store.read(key,null);
 check(job&&JSON.stringify(job.confirmation)===JSON.stringify(confirmation)&&job.documentExpected===true,'This confirmation is not waiting for the verified PO document',409);
 if(job.document){check(JSON.stringify(job.document)===JSON.stringify(reference),'This confirmation already has a different PO document',409);return {ok:true,duplicate:true,confirmation:publicJob(job)};}
 check(job.status==='awaiting_document'&&job.firstAttemptAt===undefined&&job.attempts===0,'The confirmation document can no longer be changed',409);
 const pending=store.read(INDEX,[]);check(pending.length<5000||pending.includes(id),'The confirmation queue is full',503);
 const saved={...job,document:reference,status:'queued'};store.write(key,saved);if(!pending.includes(id))store.write(INDEX,[...pending,id]);
 store.audit(actor,'nexvia-confirmation-document-attached',{id,purchaseOrderId:confirmation.purchaseOrderId});
 return {ok:true,duplicate:false,confirmation:publicJob(saved)};
}

async function documentPayload(store,job){
 const document=documentReference(job.confirmation,job.document),bucket=store.env.CAD_PROJECT_FILES;check(bucket,'PO document storage is unavailable');
 const object=await bucket.get(document.key);check(object&&object.size===document.size,'The frozen PO document is unavailable');
 const bytes=new Uint8Array(await object.arrayBuffer());check(bytes.length===document.size&&bytes.length<=MAX_DOCUMENT&&String.fromCharCode(...bytes.subarray(0,5))==='%PDF-','The frozen PO document changed');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');check(hash===document.sha256,'The frozen PO document contents changed');
 let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
 return {...job.payload,attachments:[{filename:document.name,content:btoa(binary)}]};
}

export function acceptNexviaConfirmation(store,body,token){
 const expected=store.env.NEXVIA_CONFIRMATION_TOKEN;
 check(typeof expected==='string'&&expected.length>=32,'Nexvia confirmation connection is not configured',503);
 check(equal(token,expected),'Invalid Nexvia confirmation credential',401);
 const confirmation=normalizeNexviaConfirmation(body);
 const request=store.read('purchase-request:record:'+confirmation.requestId,null);
 check(request?.documentExpected!==true&&request?.quoteTransfer?.version!==1,'This purchase request is managed by the Nexvia request worker and is waiting for its verified PO document and quote attachment.',409);
 return enqueueValidatedConfirmation(store,confirmation,'nexvia-worker');
}

// This fixture is an explicitly authorized email test, not a new Nexvia verification.
// It cannot be supplied through the machine callback or changed by an HTTP caller.
export function enqueueNexviaTestConfirmation(store,actor){
 check(actor?.isAdmin,'Administrator access required',403);
 const confirmation={requestId:'35fc4244-267c-42c6-885c-6ab93a55b899',requestReference:'PO7413 email test',recipient:'matt@lennoxfacades.com',project:'Jardin building',purchaseOrderId:1421,purchaseOrderNumber:'PO7413',projectPageId:60,totalCents:110000,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt:null,test:true,evidenceSource:'user-authorized-existing-po-test'};
 return enqueueValidatedConfirmation(store,confirmation,actor.username);
}

function documentTestConfirmation(){
 return {requestId:'74130000-0000-4000-8000-000000001421',requestReference:'PO7413 original PDF email test',recipient:'matt@lennoxfacades.com',project:'Jardin building',purchaseOrderId:1421,purchaseOrderNumber:'PO7413',projectPageId:60,totalCents:110000,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt:null,test:true,evidenceSource:'user-authorized-existing-po-document-test'};
}

function documentTestSource(sha256,size){
 check(typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256),'Invalid test PDF hash');
 check(Number.isSafeInteger(size)&&size>=5&&size<=MAX_DOCUMENT,'Invalid test PDF size');
 return {sha256,size};
}

function matchingDocumentTest(job,source){
 return job?.id===DOCUMENT_TEST_ID&&job.documentExpected===true&&JSON.stringify(job.confirmation)===JSON.stringify(documentTestConfirmation())&&JSON.stringify(job.documentTestSource)===JSON.stringify(source);
}

// A separately authorized fixed PDF test has its own identity. It cannot
// replace or resend either the original number-only test or the live job.
export function prepareNexviaDocumentTestConfirmation(store,sha256,size){
 check(store.env.READ_ONLY!=='true','Confirmation sending is paused for maintenance',503);
 const source=documentTestSource(sha256,size),key=PREFIX+DOCUMENT_TEST_ID;let job;
 store.ctx.storage.transactionSync(()=>{
  const prior=store.read(key,null);
  if(prior){check(matchingDocumentTest(prior,source),'This fixed PDF test already has a different source document',409);job=prior;return;}
  const confirmation=documentTestConfirmation(),base=buildNexviaConfirmationEmail(confirmation,store.env.PO_REQUEST_FROM_EMAIL||DEFAULT_SENDER),subject='TEST — Original Nexvia PDF: PO7413 | Jardin building',note='The original Nexvia purchase order PDF is attached.';
  const payload={...base,subject,text:base.text+'\n\n'+note,html:base.html.replace('<h1>'+escape(base.subject)+'</h1>','<h1>'+escape(subject)+'</h1>').replace('</div>','<p>'+escape(note)+'</p></div>')};
  job={id:DOCUMENT_TEST_ID,confirmation,payload,status:'awaiting_document',attempts:0,nextAttemptAt:0,leaseUntil:0,createdAt:new Date().toISOString(),documentExpected:true,documentTestSource:source};
  store.write(key,job);store.audit('nexvia-document-test','nexvia-document-test-prepared',{id:DOCUMENT_TEST_ID,purchaseOrderId:1421});
 });
 return job;
}

// Called inside the fixed document-test endpoint's post-upload transaction.
export function attachNexviaDocumentTestConfirmation(store,document){
 check(store.env.READ_ONLY!=='true','Confirmation sending is paused for maintenance',503);
 const confirmation=documentTestConfirmation(),reference=documentReference(confirmation,document),source=documentTestSource(reference.sha256,reference.size),key=PREFIX+DOCUMENT_TEST_ID,job=store.read(key,null);
 check(matchingDocumentTest(job,source),'This fixed PDF test does not match the prepared source document',409);
 if(job.document){check(JSON.stringify(job.document)===JSON.stringify(reference),'This fixed PDF test already has a different attachment',409);return {ok:true,duplicate:true,confirmation:publicJob(job)};}
 check(job.status==='awaiting_document'&&job.firstAttemptAt===undefined&&job.attempts===0,'The fixed PDF test can no longer acquire an attachment',409);
 const pending=store.read(INDEX,[]);check(pending.length<5000||pending.includes(DOCUMENT_TEST_ID),'The confirmation queue is full',503);
 const saved={...job,document:reference,status:'queued'};store.write(key,saved);if(!pending.includes(DOCUMENT_TEST_ID))store.write(INDEX,[...pending,DOCUMENT_TEST_ID]);
 store.audit('nexvia-document-test','nexvia-document-test-attached',{id:DOCUMENT_TEST_ID,purchaseOrderId:1421});
 return {ok:true,duplicate:false,confirmation:publicJob(saved)};
}

export function nexviaDocumentTestResult(store){
 const job=store.read(PREFIX+DOCUMENT_TEST_ID,null);
 return {ok:true,confirmation:job?publicJob(job):null,documentAttached:!!job?.document,documentSha256:job?.documentTestSource?.sha256||null};
}

export function nexviaConfirmationResult(store,result){
 const job=store.read(PREFIX+result.confirmation.id,null);
 return {...result,confirmation:publicJob(job)};
}

export async function processNexviaConfirmationEmails(store,fetcher=fetch,now=Date.now()){
 if(store.env.READ_ONLY==='true'||store.env.EMAIL_ENABLED!=='true'||!store.env.RESEND_API_KEY)return;
 const pending=store.read(INDEX,[]);if(!pending.length)return;
 let processed=0;const started=Date.now(),currentTime=()=>now+Math.max(0,Date.now()-started);
 for(const id of pending){
  if(processed>=3)break;
  let job;
  // Claim and finalize against the latest stored attempt, never an await's stale snapshot.
  store.ctx.storage.transactionSync(()=>{
   const current=store.read(PREFIX+id,null);
   if(!current||!['queued','retrying','sending'].includes(current.status)||current.leaseUntil>now||current.nextAttemptAt>now)return;
   if(current.firstAttemptAt!==undefined&&now-current.firstAttemptAt>=SAFE_RETRY_MS){store.write(PREFIX+id,{...current,status:'needs_review',leaseUntil:0,error:'Safe retry window expired. Check Resend before taking further action.'});return;}
   job={...current,status:'sending',leaseUntil:now+LEASE_MS,attemptId:crypto.randomUUID()};
   store.write(PREFIX+id,job);
  });
  if(!job)continue;
  processed++;
  let update,payload=job.payload;
  if(job.documentExpected===true){
   try{payload=await documentPayload(store,job);}
   catch{update={status:'needs_review',leaseUntil:0,error:'The frozen PO document is missing or invalid. Review the stored document before sending.'};}
  }
  if(!update){
   let ready=false;
   store.ctx.storage.transactionSync(()=>{
    const current=store.read(PREFIX+id,null),at=currentTime();
    if(current?.attemptId!==job.attemptId||current.status!=='sending'||current.leaseUntil<=at)return;
    if(store.env.READ_ONLY==='true'||store.env.EMAIL_ENABLED!=='true'||!store.env.RESEND_API_KEY){store.write(PREFIX+id,{...current,status:'queued',leaseUntil:0});return;}
    if(current.firstAttemptAt!==undefined&&at-current.firstAttemptAt>=SAFE_RETRY_MS){store.write(PREFIX+id,{...current,status:'needs_review',leaseUntil:0,error:'Safe retry window expired. Check Resend before taking further action.'});return;}
    job={...current,attempts:current.attempts+1,firstAttemptAt:current.firstAttemptAt??at};store.write(PREFIX+id,job);ready=true;
   });
   if(!ready)continue;
  try{
   const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+store.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'nexvia-po-confirmation-'+id.replace(':','-')},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
   const result=await response.json().catch(()=>({}));
   if(response.ok&&typeof result.id==='string'&&result.id){update={status:'sent',providerId:result.id,acceptedAt:new Date().toISOString(),leaseUntil:0,error:''};}
   else{const retry=response.status===429||response.status>=500||response.status===409||response.ok;update={status:retry?'retrying':'failed',leaseUntil:0,nextAttemptAt:now+RETRY_MS,error:'Resend returned '+response.status+'. '+(retry?'A safe retry is scheduled.':'Check the sender and Resend configuration.')};}
  }catch{update={status:'retrying',leaseUntil:0,nextAttemptAt:now+RETRY_MS,error:'Resend acceptance could not be confirmed. A safe retry is scheduled.'};}
  }
  store.ctx.storage.transactionSync(()=>{
   const current=store.read(PREFIX+id,null);
   if(current?.attemptId!==job.attemptId||current.status!=='sending')return;
   store.write(PREFIX+id,{...current,...update});
   if(update.status==='sent')store.audit('nexvia-worker','nexvia-confirmation-accepted',{id,providerId:update.providerId});
  });
 }
 store.ctx.storage.transactionSync(()=>{
  const current=store.read(INDEX,[]),remaining=current.filter(id=>['queued','retrying','sending'].includes(store.read(PREFIX+id,null)?.status));
  if(remaining.length!==current.length)store.write(INDEX,remaining);
 });
}
