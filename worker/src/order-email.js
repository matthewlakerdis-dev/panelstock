import {orderEmailFileIds,orderEmailFileBody} from './order-email-files.js';
import {orderTypeLabel} from './order-types.js';
import {requireCondition as check} from './security.js';
import {buildOrderPdf,orderPdfFilename} from './order-pdf.js';
const orderSender=env=>env.ORDER_FROM_EMAIL||env.FROM_EMAIL;
const CONFIG='order-email-config',INDEX='order-email-jobs',key=id=>'order-email:'+id;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function orderEmailConfig(store){return store.read(CONFIG,{enabled:false,recipients:[]});}
export function orderEmailAdmin(store,actor){check(actor.isAdmin,'Admin access required',403);return {ok:true,config:orderEmailConfig(store),providerReady:store.env.EMAIL_ENABLED==='true'&&!!store.env.RESEND_API_KEY&&!!orderSender(store.env),jobs:store.read(INDEX,[]).slice(-100).reverse().map(id=>{const job=store.read(key(id));return job?{id:job.id,orderNumber:job.order.orderNumber,project:job.order.project,orderedBy:job.orderedBy,recipients:job.recipients,cc:job.cc||[],status:job.status,kind:job.kind||'order',fileCount:(job.files||[]).length,waitingFileCount:job.status==='waiting_files'?(job.expectedAttachmentIds||[]).length:0,attempts:job.attempts||0,error:job.error||'',createdAt:job.createdAt,sentAt:job.sentAt||null,providerId:job.providerId||null}:null;}).filter(Boolean)};}
export function saveOrderEmailConfig(store,body,actor){check(actor.isAdmin,'Admin access required',403);check(Array.isArray(body.recipients)&&body.recipients.length<=20,'Enter up to 20 email addresses');const recipients=[...new Set(body.recipients.map(value=>String(value).trim().toLowerCase()))];check(recipients.every(value=>value.length<=254&&/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(value)),'Enter valid email addresses');const config={enabled:body.enabled===true,recipients};check(!config.enabled||recipients.length>0,'Add at least one recipient before enabling');store.ctx.storage.transactionSync(()=>{store.write(CONFIG,config);store.audit(actor.username,'order-email-settings-updated',config);});return orderEmailAdmin(store,actor);}
export function enqueueOrderEmail(store,order,options={}){const config=orderEmailConfig(store);if(!config.enabled||!config.recipients.length)return;const id=options.id||order.id,existing=store.read(key(id));if(existing)return existing;const user=store.read('users',{})[order.requestedBy]||{};const profile=store.sql?.exec('SELECT email FROM access_users WHERE username=?',order.requestedBy).toArray()[0],email=String(profile?.email??user.email??'').trim().toLowerCase(),cc=email.length<=254&&/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)&&!config.recipients.some(value=>value.toLowerCase()===email)?[email]:[];const displayName=String(user.displayName||order.requestedBy),orderedBy=displayName===order.requestedBy?displayName:`${displayName} (${order.requestedBy})`;const files=options.files||[],waiting=(options.expectedAttachmentIds||[]).length>0&&!options.filesFinalized;const job={id,order:structuredClone(order),orderedBy,requesterName:displayName,recipients:[...config.recipients],cc,createdAt:new Date().toISOString(),status:waiting?'waiting_files':'queued',attempts:0,nextAttemptAt:0,leaseUntil:0,...options,files:structuredClone(files)};store.write(key(id),job);store.write(INDEX,[...store.read(INDEX,[]),id]);return job;}
export function buildOrderEmail(job,from){const order=job.order,rows=order.items.map(item=>`<tr><td style="padding:8px;border-bottom:1px solid #ddd">${esc(item.quantity)}</td><td style="padding:8px;border-bottom:1px solid #ddd">${esc(item.description)}</td></tr>`).join(''),fields=[['Project',order.project],['Ordered by',job.orderedBy],['Order type',orderTypeLabel(order)],['Requested delivery',[order.requestedDeliveryDate,order.requestedDeliveryTime].filter(Boolean).join(' · ')],['Site contact',order.siteContact],['Phone',order.phone],['Location / notes',order.locationNotes]],html=`<div style="font-family:Arial,sans-serif;max-width:720px;color:#163344"><h1>New site order #${esc(order.orderNumber)}</h1>${fields.map(([label,value])=>`<p><strong>${label}:</strong> ${esc(value||'Not provided').replace(/\n/g,'<br>')}</p>`).join('')}<table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Quantity</th><th align="left">Item</th></tr></thead><tbody>${rows}</tbody></table><p><a href="https://web.panelstockhq.com/">Open PanelStock</a> to view the order and its latest updates.</p><p>This email is a copy of the order when it was created. Requested delivery is not a confirmed delivery date.</p></div>`,pdf=buildOrderPdf({...order,requestedBy:job.orderedBy}),binary=Array.from(pdf,byte=>String.fromCharCode(byte)).join('');return {from,to:job.recipients,...(job.cc?.length?{cc:job.cc}:{}),subject:[`Site Order #${order.orderNumber}`,order.project,orderTypeLabel(order),job.requesterName||job.orderedBy||order.requestedBy||'Unknown requester'].map(value=>String(value||'').replace(/[\r\n\t]+/g,' ').trim()).join(' | ')+(job.kind==='files'?' | Additional files':''),html:job.kind==='files'?html.replace('New site order #','Additional files for site order #').replace('This email is a copy of the order when it was created.','This email includes the newly attached files and a copy of the order when these files were submitted.'):html,text:`${job.kind==='files'?'Additional files for site order':'New site order'} #${order.orderNumber}\n${fields.map(([label,value])=>label+': '+(value||'Not provided')).join('\n')}\n\n${order.items.map(item=>item.quantity+' × '+item.description).join('\n')}\n\nOpen PanelStock: https://web.panelstockhq.com/`,attachments:[{filename:orderPdfFilename(order),content:btoa(binary)}]};}
export async function processOrderEmails(store,fetcher=fetch,now=Date.now()){
 if(store.env.READ_ONLY==='true'||store.env.EMAIL_ENABLED!=='true'||!store.env.RESEND_API_KEY||!orderSender(store.env)||!orderEmailConfig(store).enabled)return;
 let processed=0;for(const id of store.read(INDEX,[])){
  if(processed>=3)break;let job=store.read(key(id));
  if(!job||!['queued','retrying','sending'].includes(job.status)||job.leaseUntil>now||job.nextAttemptAt>now)continue;
  if(job.firstAttemptAt&&now-job.firstAttemptAt>=23*3600000){store.write(key(id),{...job,status:'needs_review',leaseUntil:0,error:'Sending stopped to avoid a duplicate after the safe retry window. Check the email provider before taking further action.'});continue;}
  processed++;job={...job,status:'sending',claimId:crypto.randomUUID(),leaseUntil:now+60000};store.write(key(id),job);
  let body;
  try{
   job={...job,payload:job.payload||buildOrderEmail(job,orderSender(store.env))};store.write(key(id),job);
   body=(job.files||[]).length?await orderEmailFileBody(store,job):JSON.stringify(job.payload);
  }catch{if(store.read(key(id))?.claimId===job.claimId)store.write(key(id),{...job,status:'failed',leaseUntil:0,error:'Order PDF or attached files could not be prepared. Check file storage and retry; this attempt was not sent.'});continue;}
  if(store.read(key(id))?.claimId!==job.claimId)continue;
  if(!orderEmailConfig(store).enabled){store.write(key(id),{...job,status:'queued',leaseUntil:0});continue;}
  job={...job,attempts:(job.attempts||0)+1,firstAttemptAt:job.firstAttemptAt||now};store.write(key(id),job);
  try{
   const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+store.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'order-created-'+id},body,signal:AbortSignal.timeout(10000)}),result=await response.json().catch(()=>({}));
   if(store.read(key(id))?.claimId!==job.claimId)continue;
   if(response.ok&&result.id)store.write(key(id),{...job,status:'sent',sentAt:new Date().toISOString(),providerId:String(result.id),leaseUntil:0,error:''});
   else{const retry=response.status===429||response.status>=500||response.status===409||response.ok;store.write(key(id),{...job,status:retry?'retrying':'failed',leaseUntil:0,nextAttemptAt:now+15*60000,error:`Email provider ${response.status}. ${retry?'A safe retry is scheduled.':'Check the sender and provider configuration.'}`});}
  }catch{if(store.read(key(id))?.claimId===job.claimId)store.write(key(id),{...job,status:'retrying',leaseUntil:0,nextAttemptAt:now+15*60000,error:'Delivery could not be confirmed. A safe retry is scheduled.'});}
 }
}
export function finalizeOrderEmailAttachments(store,orderId,body,actor){
 store.requireTask(actor,'site.orders.view');
 const order=store.read('orders',[]).find(value=>value.id===orderId);check(order,'Order not found',404);
 check(actor.isAdmin||actor.tasks?.['site.orders.manage']===true||order.requestedBy===actor.username,'Only the requester or an order manager can email order files',403);
 if(!actor.isAdmin&&actor.tasks?.['site.orders.manage']!==true)store.requireTask(actor,'site.orders.create');
 check(typeof body.batchId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.batchId),'Attachment batch ID required');
 const ids=orderEmailFileIds(body.attachmentIds),omitted=orderEmailFileIds(body.omittedAttachmentIds),original=store.read(key(orderId));
 check(!ids.some(id=>omitted.includes(id)),'An attached file cannot also be omitted');
 const signature=JSON.stringify({ids:[...ids].sort(),omitted:[...omitted].sort()}),initial=original?.attachmentBatchId===body.batchId;
 const id=initial?orderId:orderId+'-files-'+body.batchId,existing=store.read(key(id));
 if(existing?.filesFinalized){check(existing.fileSignature===signature,'This attachment batch was already finalized with different files',409);return {ok:true,emailJobId:id,unchanged:true};}
 if(initial){check(!original.payload&&!original.firstAttemptAt,'The original order email is already prepared',409);const expected=original.expectedAttachmentIds||[];check(omitted.every(value=>expected.includes(value))&&expected.every(value=>ids.includes(value)||omitted.includes(value)),'Finish or explicitly omit every file selected with the order',409);}
 else check(!omitted.length,'Only original submission files may be omitted');
 const files=ids.map(id=>{const file=(order.attachments||[]).find(file=>file.id===id);check(file,'Finish uploading every selected file before emailing the order',409);return {id:file.id,name:file.name,size:file.size,sha256:file.sha256};});
 check(!omitted.some(id=>(order.attachments||[]).some(file=>file.id===id)),'An uploaded file cannot be omitted from its order email',409);
 return store.ctx.storage.transactionSync(()=>{
  const claimsKey='order-email-file-claims:'+orderId,claims=store.read(claimsKey,{}),unclaimed=files.filter(file=>!claims[file.id]||claims[file.id]===id);
  let job;
  if(initial){job={...original,files:unclaimed,filesFinalized:true,fileSignature:signature,omittedAttachmentIds:omitted,status:'queued',leaseUntil:0};store.write(key(id),job);}
  else if(unclaimed.length)job=enqueueOrderEmail(store,order,{id,kind:'files',attachmentBatchId:body.batchId,filesFinalized:true,fileSignature:signature,files:unclaimed});
  if(job){for(const file of unclaimed)claims[file.id]=id;store.write(claimsKey,claims);store.audit(actor.username,'order-email-files-queued',{orderId,emailJobId:id,fileIds:unclaimed.map(file=>file.id),omittedFileIds:omitted});}
  return {ok:true,...(job?{emailJobId:id}:{skipped:true})};
 });
}
export function retryOrderEmail(store,body,actor){check(actor.isAdmin,'Admin access required',403);const job=store.read(key(String(body.id||'')));check(job,'Email job not found',404);check(['failed','retrying'].includes(job.status)&&job.leaseUntil<=Date.now(),'This email cannot be retried now',409);check(!job.firstAttemptAt||Date.now()-job.firstAttemptAt<23*3600000,'Safe retry window expired. Check the email provider before taking further action.',409);store.ctx.storage.transactionSync(()=>{store.write(key(job.id),{...job,status:'queued',nextAttemptAt:0,error:''});store.audit(actor.username,'order-email-retry',{orderId:job.id});});return {ok:true};}
