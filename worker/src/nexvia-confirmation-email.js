import {equal,requireCondition as check} from './security.js';

const INDEX='nexvia-confirmation-email:pending';
const PREFIX='nexvia-confirmation-email:job:';
const RETRY_MS=15*60000,LEASE_MS=60000,SAFE_RETRY_MS=23*3600000;
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

export function enqueueNexviaConfirmation(store,body,actor='nexvia-worker'){
 return enqueueValidatedConfirmation(store,normalizeNexviaConfirmation(body),actor);
}

function enqueueValidatedConfirmation(store,confirmation,actor){
 check(store.env.READ_ONLY!=='true','Confirmation sending is paused for maintenance',503);
 const id=identity(confirmation),key=PREFIX+id;
 let duplicate=false,job;
 store.ctx.storage.transactionSync(()=>{
  const prior=store.read(key,null);
  if(prior){check(JSON.stringify(prior.confirmation)===JSON.stringify(confirmation),'This purchase order already has a different confirmation. Review the original instead of resending.',409);duplicate=true;job=prior;return;}
  const pending=store.read(INDEX,[]);check(pending.length<5000,'The confirmation queue is full',503);
  job={id,confirmation,payload:buildNexviaConfirmationEmail(confirmation,store.env.PO_REQUEST_FROM_EMAIL||DEFAULT_SENDER),status:'queued',attempts:0,nextAttemptAt:0,leaseUntil:0,createdAt:new Date().toISOString()};
  store.write(key,job);store.write(INDEX,[...pending,id]);
  store.audit(actor,'nexvia-confirmation-queued',{id,purchaseOrderId:confirmation.purchaseOrderId,purchaseOrderNumber:confirmation.purchaseOrderNumber,test:confirmation.test});
 });
 return {ok:true,duplicate,confirmation:publicJob(job)};
}

export function acceptNexviaConfirmation(store,body,token){
 const expected=store.env.NEXVIA_CONFIRMATION_TOKEN;
 check(typeof expected==='string'&&expected.length>=32,'Nexvia confirmation connection is not configured',503);
 check(equal(token,expected),'Invalid Nexvia confirmation credential',401);
 return enqueueNexviaConfirmation(store,body);
}

// This fixture is an explicitly authorized email test, not a new Nexvia verification.
// It cannot be supplied through the machine callback or changed by an HTTP caller.
export function enqueueNexviaTestConfirmation(store,actor){
 check(actor?.isAdmin,'Administrator access required',403);
 const confirmation={requestId:'35fc4244-267c-42c6-885c-6ab93a55b899',requestReference:'PO7413 email test',recipient:'matt@lennoxfacades.com',project:'Jardin building',purchaseOrderId:1421,purchaseOrderNumber:'PO7413',projectPageId:60,totalCents:110000,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt:null,test:true,evidenceSource:'user-authorized-existing-po-test'};
 return enqueueValidatedConfirmation(store,confirmation,actor.username);
}

export function nexviaConfirmationResult(store,result){
 const job=store.read(PREFIX+result.confirmation.id,null);
 return {...result,confirmation:publicJob(job)};
}

export async function processNexviaConfirmationEmails(store,fetcher=fetch,now=Date.now()){
 if(store.env.READ_ONLY==='true'||store.env.EMAIL_ENABLED!=='true'||!store.env.RESEND_API_KEY)return;
 const pending=store.read(INDEX,[]);if(!pending.length)return;
 let processed=0;
 for(const id of pending){
  if(processed>=3)break;
  let job;
  // Claim and finalize against the latest stored attempt, never an await's stale snapshot.
  store.ctx.storage.transactionSync(()=>{
   const current=store.read(PREFIX+id,null);
   if(!current||!['queued','retrying','sending'].includes(current.status)||current.leaseUntil>now||current.nextAttemptAt>now)return;
   if(current.firstAttemptAt!==undefined&&now-current.firstAttemptAt>=SAFE_RETRY_MS){store.write(PREFIX+id,{...current,status:'needs_review',leaseUntil:0,error:'Safe retry window expired. Check Resend before taking further action.'});return;}
   job={...current,status:'sending',attempts:current.attempts+1,firstAttemptAt:current.firstAttemptAt??now,leaseUntil:now+LEASE_MS,attemptId:crypto.randomUUID()};
   store.write(PREFIX+id,job);
  });
  if(!job)continue;
  processed++;
  let update;
  try{
   const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+store.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'nexvia-po-confirmation-'+id.replace(':','-')},body:JSON.stringify(job.payload),signal:AbortSignal.timeout(10000)});
   const result=await response.json().catch(()=>({}));
   if(response.ok&&typeof result.id==='string'&&result.id){update={status:'sent',providerId:result.id,acceptedAt:new Date().toISOString(),leaseUntil:0,error:''};}
   else{const retry=response.status===429||response.status>=500||response.status===409||response.ok;update={status:retry?'retrying':'failed',leaseUntil:0,nextAttemptAt:now+RETRY_MS,error:'Resend returned '+response.status+'. '+(retry?'A safe retry is scheduled.':'Check the sender and Resend configuration.')};}
  }catch{update={status:'retrying',leaseUntil:0,nextAttemptAt:now+RETRY_MS,error:'Resend acceptance could not be confirmed. A safe retry is scheduled.'};}
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
