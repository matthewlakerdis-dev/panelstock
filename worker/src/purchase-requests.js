import {digest,equal,HttpError,requireCondition as check} from './security.js';
import {PDFDocument} from 'pdf-lib';
import {enqueueNexviaConfirmation,normalizeNexviaConfirmation,attachNexviaConfirmationDocument,prepareNexviaDocumentTestConfirmation,attachNexviaDocumentTestConfirmation,nexviaDocumentTestResult} from './nexvia-confirmation-email.js';
import {stageQuoteTransfer,retainQuoteTransfer,discardQuoteTransfer,queueQuoteTransferDelete,processQuoteTransferCleanup} from './nexvia-quote-transfer.js';

const ROOT='purchase-request:',INDEX=ROOT+'index',WORK=ROOT+'work',PROJECTS=ROOT+'projects',HEARTBEAT=ROOT+'heartbeat',SHARED_SOURCE=ROOT+'shared-source',REFERENCE_SYNC=ROOT+'reference-sync',SHARED_DATA=ROOT+'shared-data';
const requestKey=id=>ROOT+'record:'+id,lookupKey=id=>ROOT+'lookup:'+id,catalogKey=id=>ROOT+'catalog:'+id,catalogFailureKey=id=>ROOT+'catalog-failure:'+id,referenceAckKey=id=>ROOT+'reference-ack:'+id;
const ownerIndex=(username,generation)=>ROOT+'owner-index:'+username+':'+generation;
const lookupOwnerIndex=(username,generation)=>ROOT+'lookup-owner-index:'+username+':'+generation;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_PDF=10*1024*1024,MAX_PO_DOCUMENT=5*1024*1024,MAX_TOTAL=1000000000000n,CATALOG_CACHE_MS=30*24*3600000,EOW_PREVIEW_AGE_MS=30*24*3600000,REFERENCE_SYNC_MS=24*3600000,REFERENCE_RETRY_MS=15*60000;
const REVIEW_ROOT=ROOT+'review:',REVIEW_QUEUE=ROOT+'review-queue',REVIEW_TTL_MS=15*60000;
const REVIEW_INDEX=REVIEW_ROOT+'jobs';
const reviewKey=id=>REVIEW_ROOT+'record:'+id,reviewJobKey=id=>REVIEW_ROOT+'job:'+id;
const EOW_PREVIEW_PROJECTS=50,EOW_PREVIEW_ROWS=10000,EOW_PREVIEW_BYTES=512*1024;
const result=(body,status=200)=>({status,body:{ok:true,...body}});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function text(value,max,label,empty=false){check(typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value),'Invalid '+label);const cleaned=value.trim();check(empty||cleaned.length,'Enter '+label);return cleaned;}
function uuid(value,label='request ID'){check(typeof value==='string'&&UUID.test(value),'Invalid '+label);return value;}
function positive(value,label){check(Number.isSafeInteger(value)&&value>0,'Invalid '+label);return value;}
function choiceId(value,label){check(typeof value==='string'||typeof value==='number','Invalid '+label);if(typeof value==='number')check(Number.isSafeInteger(value)&&value>=0,'Invalid '+label);const id=String(value);check(/^[a-zA-Z0-9_-]{1,80}$/.test(id),'Invalid '+label);return id;}
function fields(value,allowed,label){check(object(value),'Invalid '+label);check(Object.keys(value).every(key=>allowed.includes(key)),'Unknown '+label+' field');}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
async function bytesDigest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}
function writable(store){check(store.env.READ_ONLY!=='true','Purchase requests are paused for maintenance',503);}
function choicesCurrent(condition,message){if(condition)return;const error=new HttpError(409,message);error.code='PURCHASE_REQUEST_CHOICES_CHANGED';throw error;}
function permissions(actor){return {create:actor.isAdmin===true||actor.tasks?.['purchase-requests.create']===true,manage:actor.isAdmin===true||actor.tasks?.['purchase-requests.manage']===true};}
function access(actor){const allowed=permissions(actor);check(allowed.create||allowed.manage,'You do not have access to purchase requests',403);return allowed;}
function accountGeneration(store,username){const row=store.sql.exec('SELECT created_at AS createdAt FROM access_users WHERE username=?',username).toArray()[0];check(typeof row?.createdAt==='string'&&row.createdAt.length>0,'Account identity is unavailable; sign in again',503);return row.createdAt;}
function belongsTo(store,record,actor){return record.submittedBy===actor.username&&record.ownerCreatedAt===accountGeneration(store,actor.username);}
function owned(store,record,actor){check(record&&(permissions(actor).manage||belongsTo(store,record,actor)),'Purchase request not found',404);return record;}
function connection(store){const lastSeenAt=store.read(HEARTBEAT,null);return {lastSeenAt,connected:!!lastSeenAt&&Date.now()-Date.parse(lastSeenAt)<10*60000};}
const displayReference=ordinal=>'REQ-'+String(ordinal).padStart(4,'0');
// The global index is append-only, including cancelled requests. Its ordinal
// gives legacy records a stable label without rewriting their frozen evidence.
const displayReferences=ids=>new Map(ids.map((id,index)=>[id,displayReference(index+1)]));
// NAS evidence uses Python's ensure_ascii=True canonical JSON. Schema keys
// are ASCII; escaping UTF-16 units also preserves supplementary characters.
const nasFingerprint=value=>digest(canonical(value).replace(/[\u007f-\uffff]/g,unit=>'\\u'+unit.charCodeAt(0).toString(16).padStart(4,'0')));
function reviewChanged(condition,message){if(condition)return;const error=new HttpError(409,message);error.code='PURCHASE_REQUEST_REVIEW_CHANGED';throw error;}
function reviewSourceWork(record){return {id:record.id,kind:'request',claimToken:record.claimToken,projectPageId:record.projectPageId,payload:nasPayload(record),...(record.documentExpected===true?{documentExpected:true}:{}),...(record.quoteAttachmentVersion===1?{quoteAttachmentVersion:1}:{})};}
function reviewSourceMatches(record,job){
 if(!record||record.state!=='needs_review'||record.result||record.workerId!==job.sourceWorkerId||record.claimToken!==job.sourceWork.claimToken||record.outcomeHash!==job.sourceOutcomeHash||record.message!==job.sourceMessage)return false;
 try{return canonical(reviewSourceWork(record))===canonical(job.sourceWork);}catch{return false;}
}
function readyReview(store,record,reviewId){
 const review=store.read(reviewKey(record.id),null),job=review?.assessmentId?store.read(reviewJobKey(review.assessmentId),null):null;
 const checked=Date.parse(job?.checkedAt),accepted=Date.parse(job?.acceptedAt),age=Date.now()-Math.min(checked,accepted);
 return review&&!review.replacementId&&review.status==='open'&&review.assessmentId===reviewId&&job?.id===reviewId&&job.state==='completed'&&job.status==='retry_ready'&&Number.isFinite(age)&&age>=0&&age<=REVIEW_TTL_MS&&reviewSourceMatches(record,job)?{review,job}:null;
}
function requestLink(store,id){const record=store.read(requestKey(id),null);return record?{id,displayReference:record.displayReference||displayReferences(store.read(INDEX,[])).get(id)||record.reference,state:record.state}:null;}
function publicRetrySource(store,id){const linked=requestLink(store,id);return linked?{id:linked.id,displayReference:linked.displayReference}:null;}
function publicReview(store,record){
 const saved=store.read(reviewKey(record.id),null);if(!saved&&record.state!=='needs_review')return null;
 const review=saved||{status:'open',note:'',reviewedBy:'',reviewedAt:null,events:[]},job=review.assessmentId?store.read(reviewJobKey(review.assessmentId),null):null;
 const active=record.state==='needs_review'&&!record.result,linked=!!review.replacementId,closed=review.status==='closed',fresh=!!(job&&readyReview(store,record,job.id));
 let status=linked?'replaced':closed?'closed':job&&['queued','processing'].includes(job.state)?'checking':fresh?'retry_ready':job?'blocked':'open';
 const bound=typeof record.workerId==='string'&&UUID.test(record.workerId)&&typeof record.claimToken==='string'&&UUID.test(record.claimToken)&&typeof record.outcomeHash==='string'&&/^[a-f0-9]{64}$/.test(record.outcomeHash);
 let message=job?.message||'Waiting for the Nexvia connection to check the saved request.';
 if(job?.status==='retry_ready'&&!fresh)message='This check is no longer current. Check the request again before preparing a retry.';
 return {status,note:review.note||'',reviewedBy:review.reviewedBy||'',reviewedAt:review.reviewedAt||null,events:review.events||[],assessment:job?{id:job.id,status:fresh?'retry_ready':job.state==='completed'?'blocked':'checking',message,checkedAt:job.checkedAt||null}:null,replacement:linked?requestLink(store,review.replacementId):null,canCheck:active&&!closed&&!linked&&status!=='checking'&&bound,canRetry:active&&!closed&&!linked&&fresh,canClose:active&&!closed&&!linked};
}
function reviewNote(value,required){check(typeof value==='string'&&value.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'Invalid review note');const note=value.replace(/\r\n?/g,'\n').trim();check(!required||note,'Enter a review note');return note;}
function reviewEvent(review,actor,action,note){const at=new Date().toISOString();return {...review,reviewedBy:actor.username,reviewedAt:at,...(note?{note}:{}),events:[...(review.events||[]),{action,note:note||'',by:actor.username,at}].slice(-20)};}
function cancelReviewJob(store,review){if(!review.assessmentId)return;const job=store.read(reviewJobKey(review.assessmentId),null);if(job&&['queued','processing'].includes(job.state))store.write(reviewJobKey(job.id),{...job,state:'cancelled'});store.write(REVIEW_QUEUE,store.read(REVIEW_QUEUE,[]).filter(id=>id!==review.assessmentId));}
function updateReview(store,record,body,actor){
 check(permissions(actor).manage,'You cannot review purchase requests',403);writable(store);fields(body,['action','note'],'request review');check(['check','note','close','reopen'].includes(body.action),'Choose a review action');
 const note=reviewNote(body.note??'',['note','close'].includes(body.action));check(!['note','close'].includes(body.action)||note,'Enter a review note');const generation=accountGeneration(store,actor.username);let saved;
 store.ctx.storage.transactionSync(()=>{
  check(accountGeneration(store,actor.username)===generation,'Account identity changed; sign in again',403);const source=owned(store,store.read(requestKey(record.id),null),actor);check(source.state==='needs_review'&&!source.result,'Only a failed request can be reviewed',409);
  let review=store.read(reviewKey(source.id),null)||{version:1,requestId:source.id,status:'open',note:'',reviewedBy:'',reviewedAt:null,events:[],assessmentId:null,replacementId:null};
  if(body.action==='check'){
   check(review.status!=='closed'&&!review.replacementId,'This review is closed or has a replacement',409);const pending=review.assessmentId?store.read(reviewJobKey(review.assessmentId),null):null;if(pending&&['queued','processing'].includes(pending.state)){saved=source;return;}
   check(UUID.test(source.workerId||'')&&UUID.test(source.claimToken||'')&&/^[a-f0-9]{64}$/.test(source.outcomeHash||''),'This request has no matching NAS work record to inspect. Record a review note instead.',409);
   const queue=store.read(REVIEW_QUEUE,[]),history=store.read(REVIEW_INDEX,[]);check(queue.length<5000&&history.length<5000,'Review storage is full; contact an administrator',503);const id=crypto.randomUUID(),job={version:1,id,requestId:source.id,state:'queued',sourceWorkerId:source.workerId,sourceWork:reviewSourceWork(source),sourceOutcomeHash:source.outcomeHash,sourceMessage:source.message,requestedAt:new Date().toISOString(),requestedBy:actor.username,message:'Waiting for the Nexvia connection to check the saved request.'};
   store.write(reviewJobKey(id),job);store.write(REVIEW_INDEX,[...history,id]);store.write(REVIEW_QUEUE,[...queue,id]);review={...review,assessmentId:id};
  }else if(body.action==='close'){check(!review.replacementId,'This request already has a replacement',409);cancelReviewJob(store,review);review={...review,status:'closed'};}
  else if(body.action==='reopen'){check(review.status==='closed'&&!review.replacementId,'This review cannot be reopened',409);review={...review,status:'open',assessmentId:null};}
  review=reviewEvent(review,actor,body.action,note);store.write(reviewKey(source.id),review);store.audit(actor.username,'purchase-request-review-'+body.action,{requestId:source.id,reviewId:review.assessmentId});saved=source;
 });return result({request:publicRequest(store,saved)});
}
function claimReview(store,workerId){
 const ids=store.read(REVIEW_QUEUE,[]),discarded=new Set();const clean=()=>{if(discarded.size)store.write(REVIEW_QUEUE,ids.filter(id=>!discarded.has(id)));};for(const id of ids){let job=store.read(reviewJobKey(id),null);if(!job||!['queued','processing'].includes(job.state)){discarded.add(id);continue;}if(job.sourceWorkerId!==workerId)continue;const source=store.read(requestKey(job.requestId),null),review=store.read(reviewKey(job.requestId),null);
  if(!source||!review||review.status!=='open'||review.replacementId||review.assessmentId!==job.id||!reviewSourceMatches(source,job)){store.write(reviewJobKey(id),{...job,state:'cancelled'});discarded.add(id);continue;}
  if(job.state==='queued'){job={...job,state:'processing',workerId,claimToken:crypto.randomUUID()};store.write(reviewJobKey(id),job);}
  clean();return {version:1,id:job.id,claimToken:job.claimToken,requestId:job.requestId,sourceWork:job.sourceWork,previous:{state:'needs_review',message:job.sourceMessage,outcomeHash:job.sourceOutcomeHash}};
 }clean();return null;
}
async function acceptReviewResult(store,body){
 fields(body,['version','workerId','id','claimToken','requestId','sourceOutcomeHash','status','message','checkedAt','evidence'],'request review result');check(body.version===1,'Unsupported review version');const workerId=uuid(body.workerId,'worker ID'),id=uuid(body.id,'review ID'),claimToken=uuid(body.claimToken,'review claim'),requestId=uuid(body.requestId);
 check(['retry_ready','blocked'].includes(body.status),'Invalid review result status');const message=text(body.message,500,'review message');check(message===body.message,'Review message must be normalized');check(typeof body.checkedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(body.checkedAt)&&Number.isFinite(Date.parse(body.checkedAt))&&Date.parse(body.checkedAt)<=Date.now()+60000,'Invalid review check time');
 const initial=store.read(reviewJobKey(id),null);check(initial&&initial.workerId===workerId&&equal(initial.claimToken,claimToken)&&initial.requestId===requestId&&initial.sourceOutcomeHash===body.sourceOutcomeHash,'Review work claim not found',404);
 let evidence=null;
 if(body.status==='retry_ready'){
  fields(body.evidence,['sourceWorkHash','sourceRequestHash','sourceJournalHash','markersAbsent'],'review evidence');check(Object.keys(body.evidence).length===4&&body.evidence.markersAbsent===true&&['sourceWorkHash','sourceRequestHash','sourceJournalHash'].every(key=>typeof body.evidence[key]==='string'&&/^[a-f0-9]{64}$/.test(body.evidence[key])),'The review has no complete no-submission evidence');
  const {claimToken:ignored,...work}=initial.sourceWork;check(body.evidence.sourceWorkHash===await nasFingerprint(work)&&body.evidence.sourceRequestHash===await nasFingerprint(initial.sourceWork.payload),'Review evidence does not match the original request',409);evidence={...body.evidence};
 }else check(body.evidence===null,'Blocked review cannot authorize a retry');
 const hash=await digest(canonical(body));let duplicate=false;
 store.ctx.storage.transactionSync(()=>{const job=store.read(reviewJobKey(id),null);check(job&&job.workerId===workerId&&equal(job.claimToken,claimToken)&&job.requestId===requestId&&job.sourceOutcomeHash===body.sourceOutcomeHash,'Review work claim not found',404);
  if(job.resultHash){check(job.resultHash===hash,'This review already has a different result',409);duplicate=true;return;}
  check(['processing','cancelled'].includes(job.state),'Review is not awaiting a result',409);store.write(reviewJobKey(id),{...job,state:'completed',status:body.status,message,checkedAt:body.checkedAt,evidence,resultHash:hash,acceptedAt:new Date().toISOString()});store.write(REVIEW_QUEUE,store.read(REVIEW_QUEUE,[]).filter(value=>value!==id));store.audit('nexvia-request-worker','purchase-request-review-checked',{requestId,reviewId:id,status:body.status});
 });return result({duplicate,review:{id,requestId,status:body.status}});
}
function validateRetrySource(store,input,actor){
 if(!input.retryOf)return null;check(permissions(actor).manage,'You cannot retry reviewed purchase requests',403);const source=store.read(requestKey(input.retryOf.requestId),null);reviewChanged(!!source,'The original request is unavailable. Refresh its review.');const assessment=readyReview(store,source,input.retryOf.reviewId);reviewChanged(!!assessment,'This review changed or expired. Check the original request again before retrying.');
 let generation;try{generation=accountGeneration(store,source.submittedBy);}catch{reviewChanged(false,'The original requester account is unavailable; refresh the review.');}reviewChanged(generation===source.ownerCreatedAt,'The original requester account changed; refresh the review before retrying.');check(!source.quote||!!input.quote,'Attach the quote PDF again for this reviewed request',422);check(input.requestId!==source.id,'A reviewed retry needs a new request ID',409);return {source,...assessment};
}
function replayMatches(record,input,inputHash,actor,generation){return record.inputHash===inputHash&&(input.retryOf?record.retrySourceId===input.retryOf.requestId&&record.retryReviewId===input.retryOf.reviewId&&record.reviewCreatedBy===actor.username&&record.reviewCreatorGeneration===generation:record.submittedBy===actor.username&&record.ownerCreatedAt===generation&&!record.retrySourceId);}
function publicRequest(store,record,references){
 const {inputHash,catalogRevision,claimToken,workerId,quoteKey,quoteFile,quoteAttachmentReceipt,quoteAttachmentVersion,outcomeHash,reconciliationEvidence,ownerCreatedAt,documentExpected,retrySourceId,retryReviewId,reviewCreatedBy,reviewCreatorGeneration,...visible}=record;
 const email=record.result?store.read('nexvia-confirmation-email:job:live:'+record.result.purchaseOrderId,null):null;
 return {...visible,displayReference:record.displayReference||(references||displayReferences(store.read(INDEX,[]))).get(record.id)||record.reference,confirmation:email?{status:email.status,providerId:email.providerId||null}:null,review:publicReview(store,record),...(retrySourceId?{retryOf:publicRetrySource(store,retrySourceId)}:{})};
}
function publicSummary(store,record,references){const {lines,review,...summary}=publicRequest(store,record,references);return {...summary,lineCount:lines.length,...(review?{review:{status:review.status,assessment:review.assessment,replacement:review.replacement,canCheck:review.canCheck,canRetry:review.canRetry,canClose:review.canClose}}:{review:null})};}
function publicLookup(lookup){return {id:lookup.id,projectPageId:lookup.projectPageId,state:lookup.state,message:lookup.message||''};}
async function lookupReply(store,lookup){
 const preview=lookup.state!=='ready'&&store.read(PROJECTS,[]).some(row=>row.projectPageId===lookup.projectPageId)?eowPreview(store.read(catalogKey(lookup.projectPageId),null),lookup.projectPageId):null;
 const reply={lookup:publicLookup(lookup),catalog:lookup.state==='ready'?(await composedCatalog(store,lookup.projectPageId)).catalog:null,serverTime:new Date().toISOString()};
 if(preview&&new TextEncoder().encode(JSON.stringify({ok:true,...reply,eowPreview:preview})).length<=EOW_PREVIEW_BYTES)reply.eowPreview=preview;
 return reply;
}
function eowPreview(catalog,projectPageId){
 const age=Date.now()-Date.parse(catalog?.eowUpdatedAt||catalog?.updatedAt);
 if(!object(catalog)||catalog.projectPageId!==projectPageId||catalog.supplierSearch!==''||typeof catalog.revision!=='string'||!/^[a-f0-9]{64}$/.test(catalog.revision)||typeof catalog.updatedAt!=='string'||!Number.isFinite(age)||age<0||age>EOW_PREVIEW_AGE_MS||!Array.isArray(catalog.breakdowns)||catalog.breakdowns.length<1||catalog.breakdowns.length>EOW_PREVIEW_ROWS)return null;
 const seen=new Set(),breakdowns=[];
 for(const row of catalog.breakdowns){
  if(!object(row)||!(typeof row.id==='string'||typeof row.id==='number'&&Number.isSafeInteger(row.id)&&row.id>=0)||!/^[a-zA-Z0-9_-]{1,80}$/.test(String(row.id))||seen.has(String(row.id))||typeof row.name!=='string'||!row.name.trim()||row.name.length>500||/[\u0000-\u001f\u007f]/.test(row.name)||typeof row.disabled!=='boolean')return null;
  const id=String(row.id);seen.add(id);breakdowns.push({id,name:row.name.trim(),disabled:row.disabled});
 }
 // A preview is display-only; it never carries a revision or a complete catalog.
 return {projectPageId,breakdowns,updatedAt:catalog.eowUpdatedAt||catalog.updatedAt};
}
function eowPreviews(store){
 const projects=store.read(PROJECTS,[]).slice().sort((a,b)=>b.projectPageId-a.projectPageId),previews=[],encoder=new TextEncoder(),serverTime=new Date().toISOString();let truncated=projects.length>EOW_PREVIEW_PROJECTS,rows=0,bytes=encoder.encode(JSON.stringify({ok:true,eowPreviews:[],truncated:false,serverTime})).length;
 for(const project of projects.slice(0,EOW_PREVIEW_PROJECTS)){
  const cached=store.read(catalogKey(project.projectPageId),null),preview=eowPreview(cached,project.projectPageId);
  if(!preview){if(cached!==null)truncated=true;continue;}
  const size=encoder.encode(JSON.stringify(preview)).length+(previews.length?1:0);
  if(rows+preview.breakdowns.length>EOW_PREVIEW_ROWS||bytes+size>EOW_PREVIEW_BYTES){truncated=true;continue;}
  previews.push(preview);rows+=preview.breakdowns.length;bytes+=size;
 }
 return {eowPreviews:previews,truncated,serverTime};
}
function usableCatalog(catalog,projectPageId,eowOnly=false){
 const stamp=eowOnly?(catalog?.eowUpdatedAt||catalog?.updatedAt):catalog?.updatedAt,age=Date.now()-Date.parse(stamp);
 // Sync frequency and menu usability are independent. A failed daily refresh
 // keeps the last complete snapshot; reads never renew its source timestamp.
 if(!object(catalog)||catalog.projectPageId!==projectPageId||catalog.supplierSearch!==''||typeof catalog.revision!=='string'||!/^[a-f0-9]{64}$/.test(catalog.revision)||!Number.isFinite(age)||age<0||age>CATALOG_CACHE_MS||!Number.isFinite(Date.parse(catalog.updatedAt))||Date.parse(catalog.updatedAt)>Date.now()||!['suppliers','services','breakdowns','accounts','taxes'].every(field=>Array.isArray(catalog[field])&&catalog[field].length<=10000&&(field==='suppliers'||catalog[field].length>0)))return null;
 return catalog;
}
const cachedCatalog=(store,projectPageId,eowOnly=false)=>usableCatalog(store.read(catalogKey(projectPageId),null),projectPageId,eowOnly);
const freshCatalog=(store,projectPageId)=>cachedCatalog(store,projectPageId);
function sharedCatalog(store){
 const saved=store.read(SHARED_DATA,null);
 if(Number.isSafeInteger(saved?.projectPageId)&&saved.projectPageId>0&&usableCatalog(saved,saved.projectPageId))return saved;
 const source=store.read(SHARED_SOURCE,null);if(!Number.isSafeInteger(source?.projectPageId)||source.projectPageId<=0||!Number.isFinite(Date.parse(source.updatedAt))||!store.read(PROJECTS,[]).some(row=>row.projectPageId===source.projectPageId))return null;
 const catalog=freshCatalog(store,source.projectPageId);return catalog&&Date.parse(catalog.updatedAt)>=Date.parse(source.updatedAt)?catalog:null;
}
function catalogSources(store,projectPageId){const project=cachedCatalog(store,projectPageId,true),shared=sharedCatalog(store)||freshCatalog(store,projectPageId);return {project,shared};}
function catalogVersion(store,projectPageId){return canonical(catalogSources(store,projectPageId));}
async function composedCatalog(store,projectPageId){
 const sources=catalogSources(store,projectPageId),version=canonical(sources),{project,shared}=sources;
 if(!project||!shared)return {catalog:null,version};
 const common=['suppliers','services','accounts','taxes'],same=common.every(field=>canonical(project[field])===canonical(shared[field]));
 if(same&&project.updatedAt===shared.updatedAt)return {catalog:project,version};
 const core={projectPageId,supplierSearch:'',...Object.fromEntries(common.map(field=>[field,shared[field]])),breakdowns:project.breakdowns},eowUpdatedAt=project.eowUpdatedAt||project.updatedAt;
 const updatedAt=new Date(Math.min(Date.parse(eowUpdatedAt),Date.parse(shared.updatedAt))).toISOString();
 return {catalog:{...core,revision:same?project.revision:await digest(canonical(core)),updatedAt,eowUpdatedAt,commonUpdatedAt:shared.updatedAt},version};
}
function publishSharedSource(store,catalog){
 if(!catalog)return;const previous=store.read(SHARED_SOURCE,null),updatedAt=Date.parse(catalog.updatedAt),previousAt=Date.parse(previous?.updatedAt);
 if(!Number.isFinite(updatedAt)||Number.isFinite(previousAt)&&previousAt>updatedAt)return;
 // Keep common data independent of the project's EOW record. A newer EOW can
 // legitimately arrive with an older directory capture after a failed sync.
 if(canonical(store.read(SHARED_DATA,null))!==canonical(catalog))store.write(SHARED_DATA,catalog);
 if(previous?.projectPageId!==catalog.projectPageId||previous.updatedAt!==catalog.updatedAt)store.write(SHARED_SOURCE,{projectPageId:catalog.projectPageId,updatedAt:catalog.updatedAt});
}
function sharedChoices(store){
 const catalog=sharedCatalog(store);if(!catalog)return null;
 const {suppliers,services,accounts,taxes,updatedAt}=catalog;return {suppliers,services,accounts,taxes,updatedAt};
}
function decimal(value,places,label,positiveOnly=false){
 check(typeof value==='string'||typeof value==='number','Invalid '+label);check(typeof value!=='number'||Number.isFinite(value),'Invalid '+label);
 const raw=String(value);check(raw.length<=32&&/^\d+(?:\.\d+)?$/.test(raw),'Invalid '+label);
 const [whole,fraction='']=raw.split('.');check(fraction.length<=places,'Too many decimal places in '+label);
 const scaled=BigInt(whole)*10n**BigInt(places)+BigInt((fraction+'0'.repeat(places)).slice(0,places)||'0');
 check(scaled<=1000000000n*10n**BigInt(places)&&(!positiveOnly||scaled>0),'Invalid '+label);
 const normalizedWhole=BigInt(whole).toString(),tail=fraction.replace(/0+$/,'');return {value:normalizedWhole+(tail?'.'+tail:''),scaled};
}
export function normalizePurchaseRequestInput(body){
 fields(body,['requestId','projectPageId','catalogRevision','requestor','date','supplierId','supplierReference','serviceId','breakdownType','quote','quoteBase64','lines','subtotalCents','taxCents','totalCents','retryOf'],'purchase request');
 fields(body.requestor,['name','email'],'requestor');const name=text(body.requestor.name,100,'requestor name'),email=text(body.requestor.email,254,'work email').toLowerCase();check(/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email),'Enter a valid work email');
 const date=text(body.date,10,'order date');check(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'Enter a valid order date');
 const breakdownType=choiceId(body.breakdownType,'EOW');check(Array.isArray(body.lines)&&body.lines.length>=1&&body.lines.length<=200,'Enter between 1 and 200 line items');
 const lines=body.lines.map(row=>{fields(row,['description','quantity','unitPriceExGst','chartOfAccountId','taxRateId','breakdownType'],'line item');check(choiceId(row.breakdownType,'line EOW')===breakdownType,'Line EOW must match the order');return {description:text(row.description,2000,'line description'),quantity:decimal(row.quantity,6,'quantity',true).value,unitPriceExGst:decimal(row.unitPriceExGst,6,'unit price').value,chartOfAccountId:choiceId(row.chartOfAccountId,'COS account'),taxRateId:choiceId(row.taxRateId,'tax'),breakdownType};});
 let quote=null,pdf=null;
 if(body.quote!==null&&body.quote!==undefined){
  fields(body.quote,['filename'],'quote');const filename=text(body.quote.filename,180,'quote filename');check(/\.pdf$/i.test(filename)&&!/[\\/]/.test(filename),'Choose a PDF quote');
  const encoded=body.quoteBase64;check(typeof encoded==='string'&&encoded.length<=4*Math.ceil(MAX_PDF/3)&&encoded.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'Invalid PDF content');
  let raw;try{raw=atob(encoded);}catch{check(false,'Invalid PDF content');}check(raw.length>=5&&raw.length<=MAX_PDF&&raw.startsWith('%PDF-'),'Quote must be a PDF no larger than 10 MB');pdf=Uint8Array.from(raw,c=>c.charCodeAt(0));quote={filename,bytes:pdf.length};
 }else check(body.quoteBase64===undefined||body.quoteBase64==='','Unexpected quote content');
 let retryOf=null;if(body.retryOf!==undefined){fields(body.retryOf,['requestId','reviewId'],'reviewed retry');retryOf={requestId:uuid(body.retryOf.requestId),reviewId:uuid(body.retryOf.reviewId,'review ID')};}
 return {input:{...(retryOf?{retryOf}:{}),requestId:uuid(body.requestId),projectPageId:positive(body.projectPageId,'project'),catalogRevision:text(body.catalogRevision,128,'project choices revision'),requestor:{name,email},date,supplierId:choiceId(body.supplierId,'supplier'),supplierReference:text(body.supplierReference??'',200,'supplier reference',true),serviceId:choiceId(body.serviceId,'service'),breakdownType,quote,lines},pdf};
}
function select(id,rows,label){const selected=rows.find(row=>row.id===id);check(selected&&!selected.disabled,'Choose a current '+label);return selected;}
function priceRequest(input,catalog){
 const supplier=select(input.supplierId,catalog.suppliers,'supplier'),service=select(input.serviceId,catalog.services,'service'),breakdown=select(input.breakdownType,catalog.breakdowns,'EOW');let subtotal=0n,tax=0n;
 for(const line of input.lines){
  select(line.chartOfAccountId,catalog.accounts,'COS account');const taxRow=select(line.taxRateId,catalog.taxes,'tax');const quantity=decimal(line.quantity,6,'quantity',true).scaled,price=decimal(line.unitPriceExGst,6,'unit price').scaled;
  const amount=(quantity*price+5000000000n)/10000000000n,rate=decimal(taxRow.rate,4,'tax rate').scaled;subtotal+=amount;tax+=(amount*rate+500000n)/1000000n;check(subtotal+tax<=MAX_TOTAL,'Request total is too large');
 }
 return {supplierName:supplier.text,serviceName:service.name,breakdownName:breakdown.name,subtotalCents:Number(subtotal),taxCents:Number(tax),totalCents:Number(subtotal+tax)};
}
function profile(store,actor){const user=store.read('users',{})[actor.username]||{};const saved=store.sql?.exec('SELECT display_name AS name,email FROM access_users WHERE username=?',actor.username).toArray()[0];return {name:saved?.name||user.displayName||actor.username,email:saved?.email||user.email||''};}
async function saveRequest(store,body,actor){
 check(permissions(actor).create,'You cannot submit purchase requests',403);writable(store);const ownerCreatedAt=accountGeneration(store,actor.username),{input,pdf}=normalizePurchaseRequestInput(body),pdfHash=pdf?await bytesDigest(pdf):null,inputHash=await digest(canonical({...input,pdfHash})),key=requestKey(input.requestId);
 if(input.retryOf)check(permissions(actor).manage,'You cannot retry reviewed purchase requests',403);
 const previous=store.read(key,null);if(previous){check(replayMatches(previous,input,inputHash,actor,ownerCreatedAt),'This request ID already belongs to a different submission',409);return result({duplicate:true,request:publicRequest(store,previous)});}
 validateRetrySource(store,input,actor);
 const project=store.read(PROJECTS,[]).find(row=>row.projectPageId===input.projectPageId);check(project,'Choose a current project');const snapshot=await composedCatalog(store,input.projectPageId),catalog=snapshot.catalog;choicesCurrent(catalog&&catalog.revision===input.catalogRevision,'Project choices changed. Refresh choices before submitting.');const totals=priceRequest(input,catalog);check(store.read(INDEX,[]).length<5000&&store.read(WORK,[]).length<5000,'Purchase request storage is full; contact an administrator',503);
 const quoteFile=pdf?await stageQuoteTransfer(store,input.requestId,pdf,pdfHash):null;
 let saved,existing=false;
 try{store.ctx.storage.transactionSync(()=>{
  check(accountGeneration(store,actor.username)===ownerCreatedAt,'Account identity changed; sign in again',403);
  const prior=store.read(key,null);if(prior){check(replayMatches(prior,input,inputHash,actor,ownerCreatedAt),'This request ID already belongs to a different submission',409);saved=prior;existing=true;return;}
  choicesCurrent(catalogVersion(store,input.projectPageId)===snapshot.version,'Project choices changed. Refresh choices before submitting.');const index=store.read(INDEX,[]),work=store.read(WORK,[]);check(index.length<5000&&work.length<5000,'Purchase request storage is full; contact an administrator',503);const retry=validateRetrySource(store,input,actor),{requestId,retryOf,...details}=input;
  saved={id:requestId,reference:'REQ-'+requestId,displayReference:displayReference(index.length+1),...details,project:project.name,...totals,inputHash,quoteKey:null,...(quoteFile?{quoteFile,quoteTransfer:{version:1,state:'pending',expiresAt:quoteFile.expiresAt}}:{}),submittedBy:retry?retry.source.submittedBy:actor.username,ownerCreatedAt:retry?retry.source.ownerCreatedAt:ownerCreatedAt,...(retry?{retrySourceId:retry.source.id,retryReviewId:retry.job.id,reviewCreatedBy:actor.username,reviewCreatorGeneration:ownerCreatedAt}:{}),createdAt:new Date().toISOString(),state:'queued',message:pdf?'Waiting for Nexvia to create the PO with the attached quote.':'Waiting for the Nexvia worker.',result:null};
  store.write(key,saved);if(quoteFile)retainQuoteTransfer(store,quoteFile);store.write(INDEX,[...index,requestId]);store.write(ownerIndex(saved.submittedBy,saved.ownerCreatedAt),[...store.read(ownerIndex(saved.submittedBy,saved.ownerCreatedAt),[]),requestId]);if(retry)store.write(reviewKey(retry.source.id),reviewEvent({...retry.review,replacementId:requestId},actor,'retry','Created a reviewed replacement request.'));store.write(WORK,[...work,{id:requestId,kind:'request'}]);store.audit(actor.username,'purchase-request-submitted',{requestId,projectPageId:input.projectPageId,totalCents:totals.totalCents,quote:!!pdf});
 });}catch(error){
  // A competing identical submission may already reference this immutable key.
  // Delete only after positively observing that no saved request retains it.
  if(quoteFile)try{discardQuoteTransfer(store,quoteFile);await processQuoteTransferCleanup(store);}catch{}
  throw error;
 }return result({duplicate:existing,request:publicRequest(store,saved)},existing?200:201);
}
async function createLookup(store,body,actor){
 writable(store);fields(body,['projectPageId','refresh'],'lookup');check(body.refresh===undefined||typeof body.refresh==='boolean','Invalid project choices refresh');const projectPageId=positive(body.projectPageId,'project'),ownerCreatedAt=accountGeneration(store,actor.username);check(store.read(PROJECTS,[]).some(row=>row.projectPageId===projectPageId),'Choose a current project');let lookup;
 const cached=body.refresh!==true?(await composedCatalog(store,projectPageId)).catalog:null;
 if(cached){
  const index=lookupOwnerIndex(actor.username,ownerCreatedAt),ids=store.read(index,[]),previous=ids.length?store.read(lookupKey(ids.at(-1)),null):null;
  if(previous?.state==='ready'&&previous.projectPageId===projectPageId&&previous.submittedBy===actor.username&&previous.ownerCreatedAt===ownerCreatedAt){store.ctx.storage.transactionSync(()=>{if(!store.read(SHARED_SOURCE,null))publishSharedSource(store,freshCatalog(store,projectPageId));});return result(await lookupReply(store,previous));}
  // Retain an owned lookup ID for the normal status endpoint, without putting
  // a read-only cache hit into the NAS work queue or altering existing claims.
  const now=new Date().toISOString();lookup={id:crypto.randomUUID(),projectPageId,submittedBy:actor.username,ownerCreatedAt,state:'ready',message:'Current Nexvia choices loaded.',createdAt:now,completedAt:now};
  store.ctx.storage.transactionSync(()=>{if(!store.read(SHARED_SOURCE,null))publishSharedSource(store,freshCatalog(store,projectPageId));store.write(lookupKey(lookup.id),lookup);store.write(index,[...store.read(index,[]).slice(-4999),lookup.id]);});
  return result(await lookupReply(store,lookup));
 }
 store.ctx.storage.transactionSync(()=>{const work=store.read(WORK,[]);for(const item of work){if(item.kind!=='lookup')continue;const previous=store.read(lookupKey(item.id),null);if(previous?.submittedBy===actor.username&&previous.ownerCreatedAt===ownerCreatedAt&&previous.projectPageId===projectPageId&&['queued','processing'].includes(previous.state)){lookup=previous;return;}}
  check(work.length<5000,'Purchase request work queue is full',503);lookup={id:crypto.randomUUID(),projectPageId,submittedBy:actor.username,ownerCreatedAt,state:'queued',message:'Waiting for current Nexvia choices.',createdAt:new Date().toISOString()};store.write(lookupKey(lookup.id),lookup);store.write(lookupOwnerIndex(actor.username,ownerCreatedAt),[...store.read(lookupOwnerIndex(actor.username,ownerCreatedAt),[]).slice(-4999),lookup.id]);store.write(WORK,[...work,{id:lookup.id,kind:'lookup'}]);});return result(await lookupReply(store,lookup));
}
async function refreshSharedChoices(store,body,actor){
 writable(store);fields(body,['refresh'],'shared choices refresh');check(body.refresh===undefined||typeof body.refresh==='boolean','Invalid shared choices refresh');accountGeneration(store,actor.username);
 const shared=body.refresh!==true?sharedChoices(store):null;if(shared)return result({sharedChoices:shared,serverTime:new Date().toISOString()});
 const projects=store.read(PROJECTS,[]),source=store.read(SHARED_SOURCE,null);
 const project=projects.find(row=>row.projectPageId===source?.projectPageId)||projects.reduce((latest,row)=>!latest||row.projectPageId>latest.projectPageId?row:latest,null);
 check(project,'Nexvia project choices are not available yet. Wait for the connection and retry.',503);
 // This only queues an owned, read-only catalog lookup. Its source project is
 // internal context and never selects the user's project or creates a PO.
 const response=await createLookup(store,{projectPageId:project.projectPageId,refresh:true},actor);
 return {...response,body:{...response.body,sharedChoices:null}};
}
function referenceSyncStatus(store,actor){
 const sync=store.read(REFERENCE_SYNC,null);return {id:sync?.id||null,state:sync?.state||'idle',requestedAt:sync?.requestedAt||null,completedProjects:sync?.completedProjects||0,totalProjects:sync?.totalProjects||0,lastSuccessfulAt:sync?.lastSuccessfulAt||null,message:sync?.message||'Saved Nexvia data is refreshed daily by the connection.',canSync:actor.isAdmin===true};
}
function newReferenceSync(previous){return {id:crypto.randomUUID(),state:'queued',phase:'directories',requestedAt:new Date(Math.max(Date.now(),(Date.parse(previous?.requestedAt)||0)+1)).toISOString(),completedProjects:0,totalProjects:0,processedProjects:0,failedProjects:0,lastSuccessfulAt:previous?.lastSuccessfulAt||null,message:'Waiting for the Nexvia connection to sync saved data.'};}
function requestReferenceSync(store,actor){
 check(actor.isAdmin===true,'Administrator access is required to sync Nexvia data',403);writable(store);store.ctx.storage.transactionSync(()=>{const previous=store.read(REFERENCE_SYNC,null);if(!previous||!['queued','refreshing'].includes(previous.state)){store.write(REFERENCE_SYNC,newReferenceSync(previous));store.audit(actor.username,'nexvia-reference-sync-requested',{});}});return result({referenceSync:referenceSyncStatus(store,actor)});
}
function prepareReferenceSync(store,workerId,ack){
 let sync=store.read(REFERENCE_SYNC,null);
 if(ack){
  const receipt=store.read(referenceAckKey(ack.id),null);
  if(receipt)check(receipt.workerId===workerId&&receipt.state===ack.state,'Reference sync acknowledgement changed',409);
  else{
   check(sync&&sync.id===ack.id&&sync.workerId===workerId,'Reference sync command not found',404);
   check(sync.phase==='directories'&&sync.state==='refreshing','Reference sync command is not awaiting its directory result',409);
   sync={...sync,directoryAckState:ack.state};
   if(ack.state==='ready'){
    const projectIds=store.read(PROJECTS,[]).map(row=>row.projectPageId);sync={...sync,phase:'catalogs',projectIds,totalProjects:projectIds.length,message:'Updating saved project choices.'};
    if(!projectIds.length)sync={...sync,state:'completed',completedAt:new Date().toISOString(),lastSuccessfulAt:new Date().toISOString(),message:'Nexvia data is up to date.'};
   }else sync={...sync,state:'failed',completedAt:new Date().toISOString(),message:'Nexvia sync could not finish. Previously saved choices are still available.'};
   store.write(referenceAckKey(ack.id),{workerId,state:ack.state});store.write(REFERENCE_SYNC,sync);
  }
 }
 const completedAt=Date.parse(sync?.completedAt),due=sync?.state==='failed'&&sync.phase==='directories'?REFERENCE_RETRY_MS:REFERENCE_SYNC_MS;
 if(!sync||['completed','failed'].includes(sync.state)&&Number.isFinite(completedAt)&&Date.now()-completedAt>=due){sync=newReferenceSync(sync);store.write(REFERENCE_SYNC,sync);}
 if(sync.state==='queued'){
  sync={...sync,state:'refreshing',workerId,startedAt:new Date().toISOString(),message:'Updating saved Nexvia directories.'};store.write(REFERENCE_SYNC,sync);
 }
 return sync;
}
function nextReferenceLookup(store,sync,workerId){
 if(!sync||sync.state!=='refreshing'||sync.phase!=='catalogs'||sync.workerId!==workerId||sync.currentLookupId)return null;
 const projectPageId=sync.projectIds[sync.processedProjects];if(!projectPageId)return null;
 const record={id:crypto.randomUUID(),projectPageId,submittedBy:'__nexvia_reference_sync__',ownerCreatedAt:'reference-cache-v1',backgroundSyncId:sync.id,state:'queued',createdAt:new Date().toISOString(),message:'Updating saved Nexvia project choices.'};
 store.write(lookupKey(record.id),record);store.write(WORK,[...store.read(WORK,[]),{id:record.id,kind:'lookup'}]);store.write(REFERENCE_SYNC,{...sync,currentLookupId:record.id});return {item:{id:record.id,kind:'lookup'},record};
}
function completeReferenceLookup(store,record){
 if(!record.backgroundSyncId)return;const sync=store.read(REFERENCE_SYNC,null);if(!sync||sync.id!==record.backgroundSyncId||sync.currentLookupId!==record.id)return;
 const processedProjects=sync.processedProjects+1,completedProjects=sync.completedProjects+(record.state==='ready'?1:0),failedProjects=sync.failedProjects+(record.state==='ready'?0:1),complete=processedProjects>=sync.totalProjects,now=new Date().toISOString();
 store.write(REFERENCE_SYNC,{...sync,currentLookupId:null,processedProjects,completedProjects,failedProjects,...(complete?{state:failedProjects?'failed':'completed',completedAt:now,lastSuccessfulAt:failedProjects?sync.lastSuccessfulAt:now,message:failedProjects?'Some Nexvia choices could not be updated. Previously saved choices are still available.':'Nexvia data is up to date.'}:{message:'Updating saved project choices.'})});
}
export function nexviaProjectDirectory(store){
 return store.read(PROJECTS,[]);
}
export async function handlePurchaseRequests(store,path,method,body,actor){
 const allowed=access(actor);
 if(path==='/purchase-requests/reference-sync'){if(method==='GET')return result({referenceSync:referenceSyncStatus(store,actor)});check(method==='POST','Method not allowed',405);fields(body,[],'reference sync');return requestReferenceSync(store,actor);}
 if(path==='/purchase-requests/eow-choices'){check(method==='GET','Method not allowed',405);return result(eowPreviews(store));}
 if(path==='/purchase-requests/shared-choices'){if(method==='GET')return result({sharedChoices:sharedChoices(store),serverTime:new Date().toISOString()});check(method==='POST','Method not allowed',405);return refreshSharedChoices(store,body,actor);}
 if(path==='/purchase-requests'){
  if(method==='GET'){const generation=accountGeneration(store,actor.username),index=store.read(INDEX,[]),references=displayReferences(index),visibleIds=allowed.manage?index:store.read(ownerIndex(actor.username,generation),[]);return result({requests:visibleIds.slice(-200).reverse().map(id=>store.read(requestKey(id),null)).filter(record=>record&&(allowed.manage||(record.submittedBy===actor.username&&record.ownerCreatedAt===generation))).map(record=>publicSummary(store,record,references)),historyTruncated:visibleIds.length>200,totalCount:visibleIds.length,projects:store.read(PROJECTS,[]),profile:profile(store,actor),permissions:allowed,connection:connection(store),referenceSync:referenceSyncStatus(store,actor)});}
  check(method==='POST','Method not allowed',405);return saveRequest(store,body,actor);
 }
 if(path==='/purchase-requests/lookups'){check(method==='POST','Method not allowed',405);return createLookup(store,body,actor);}
 const lookupMatch=path.match(/^\/purchase-requests\/lookups\/([a-f0-9-]{36})$/);if(lookupMatch){check(method==='GET','Method not allowed',405);return result(await lookupReply(store,owned(store,store.read(lookupKey(uuid(lookupMatch[1])),null),actor)));}
 const match=path.match(/^\/purchase-requests\/([a-f0-9-]{36})(?:\/(cancel|quote|review))?$/);check(match,'Not found',404);const id=uuid(match[1]),record=owned(store,store.read(requestKey(id),null),actor);
 if(match[2]==='review'){check(method==='POST','Method not allowed',405);return updateReview(store,record,body,actor);}
 if(match[2]==='quote'){
  check(method==='GET','Method not allowed',405);check(record.quoteTransfer?.version!==1,'Quote files are transferred to Nexvia and have no PanelStock download copy',410);check(record.quoteKey&&store.env.CAD_PROJECT_FILES,'Quote not found',404);const file=await store.env.CAD_PROJECT_FILES.get(record.quoteKey);check(file,'Quote not found',404);const bytes=new Uint8Array(await file.arrayBuffer());let encoded='';for(let offset=0;offset<bytes.length;offset+=32768)encoded+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return result({quote:{filename:record.quote.filename,base64:btoa(encoded)}});
 }
 if(match[2]==='cancel'){
  check(method==='POST','Method not allowed',405);writable(store);fields(body,[],'cancellation');let saved;store.ctx.storage.transactionSync(()=>{const current=owned(store,store.read(requestKey(id),null),actor);check(current.state==='queued','Only a request that is still queued can be cancelled',409);saved={...current,state:'cancelled',message:'Cancelled before the NAS worker collected it.',...(current.quoteTransfer?.version===1?{quoteTransfer:{...current.quoteTransfer,state:'cancelled'}}:{})};store.write(requestKey(id),saved);if(current.quoteFile)queueQuoteTransferDelete(store,current.quoteFile,'cancelled');store.write(WORK,store.read(WORK,[]).filter(item=>item.kind!=='request'||item.id!==id));store.audit(actor.username,'purchase-request-cancelled',{requestId:id});});if(saved.quoteFile)await processQuoteTransferCleanup(store).catch(()=>{});return result({request:publicRequest(store,saved)});
 }
 check(method==='GET','Method not allowed',405);return result({request:publicRequest(store,record)});
}
function machineAuth(store,token,write=true){const expected=store.env.NEXVIA_REQUEST_TOKEN;check(typeof expected==='string'&&expected.length>=32,'Nexvia purchase request connection is not configured',503);check(equal(token,expected),'Invalid Nexvia request credential',401);if(write)writable(store);}
function normalizeProjects(projects){check(Array.isArray(projects)&&projects.length<=5000,'Invalid project directory');const seen=new Set();return projects.map(row=>{fields(row,['projectPageId','name'],'project');const projectPageId=positive(row.projectPageId,'project');check(!seen.has(projectPageId),'Duplicate project');seen.add(projectPageId);return {projectPageId,name:text(row.name,160,'project name')};}).sort((a,b)=>a.projectPageId-b.projectPageId);}
function nasPayload(record){const {id,reference,projectPageId,requestor,date,supplierId,supplierReference,serviceId,breakdownType,lines,subtotalCents,taxCents,totalCents}=record;let quote=null;if(record.quoteTransfer?.version===1){check(record.quote&&record.quoteFile?.sha256,'The quote transfer needs review',503);quote={filename:record.quote.filename,bytes:record.quote.bytes,sha256:record.quoteFile.sha256};}return {requestId:id,reference,projectPageId,requestor,date,supplierId,supplierReference,serviceId,breakdownType,quote,lines,subtotalCents,taxCents,totalCents,testOnly:true,nexviaSubmissionEnabled:false};}
function claimWork(store,body){
 fields(body,['workerId','projects','documentExpected','quoteAttachmentVersion','referenceCacheVersion','referenceSyncAck','reviewVersion'],'worker poll');check(body.reviewVersion===undefined||body.reviewVersion===1,'Unsupported review version');check(body.referenceCacheVersion===undefined||body.referenceCacheVersion===1,'Unsupported reference cache version');if(body.referenceSyncAck!==undefined){check(body.referenceCacheVersion===1,'Reference sync requires the reference cache capability');fields(body.referenceSyncAck,['id','state'],'reference sync acknowledgement');uuid(body.referenceSyncAck.id,'reference sync ID');check(['ready','failed'].includes(body.referenceSyncAck.state),'Invalid reference sync acknowledgement');}check(body.documentExpected===undefined||typeof body.documentExpected==='boolean','Invalid PO document capability');check(body.quoteAttachmentVersion===undefined||body.quoteAttachmentVersion===1,'Unsupported quote attachment version');const workerId=uuid(body.workerId,'worker ID'),projects=body.projects===undefined?null:normalizeProjects(body.projects),quoteSupported=body.quoteAttachmentVersion===1&&body.documentExpected===true,referenceCapable=body.referenceCacheVersion===1;let claimed,syncCommand,reviewClaim;
 store.ctx.storage.transactionSync(()=>{
  const previous=store.read(HEARTBEAT,null);if(!previous||Date.now()-Date.parse(previous)>=5*60000)store.write(HEARTBEAT,new Date().toISOString());
  if(projects){
   const previousDirectory=nexviaProjectDirectory(store);
   store.syncNexviaProjects(projects,previousDirectory);
   if(canonical(projects)!==canonical(previousDirectory))store.write(PROJECTS,projects);
  }
  const sync=referenceCapable?prepareReferenceSync(store,workerId,body.referenceSyncAck):null;
  const work=store.read(WORK,[]),expired=new Set();let selected=null;for(const item of work){const record=store.read(item.kind==='lookup'?lookupKey(item.id):requestKey(item.id),null);
   if(record?.backgroundSyncId&&(!referenceCapable||sync?.workerId!==workerId||record.backgroundSyncId!==sync.id))continue;
   if(item.kind==='request'&&record?.quote){
    if(record.quoteTransfer?.version!==1)continue;
    if(record.state==='queued'&&!record.workerId&&!record.claimToken&&Date.parse(record.quoteTransfer.expiresAt)<=Date.now()){const saved={...record,state:'needs_review',message:'The quote transfer expired before collection. Review and upload the quote again.',quoteTransfer:{...record.quoteTransfer,state:'expired'}};store.write(requestKey(item.id),saved);if(record.quoteFile)queueQuoteTransferDelete(store,record.quoteFile,'expired');expired.add(item.id);continue;}
    if(record.state==='queued'&&(record.workerId||record.claimToken))continue;
    if(!quoteSupported||record.state==='processing'&&record.quoteAttachmentVersion!==1)continue;
   }
   if(record?.state==='processing'&&record.workerId===workerId){selected={item,record};break;}if(record?.state==='queued'&&(!selected||selected.record.backgroundSyncId&&!record.backgroundSyncId))selected={item,record};
  }if(expired.size)store.write(WORK,work.filter(item=>item.kind!=='request'||!expired.has(item.id)));if(body.reviewVersion===1&&(!selected||selected.record.backgroundSyncId)){reviewClaim=claimReview(store,workerId);if(reviewClaim)return;}if(!selected&&referenceCapable)selected=nextReferenceLookup(store,sync,workerId);if(!selected){if(referenceCapable&&sync?.workerId===workerId&&sync.phase==='directories'&&sync.state==='refreshing')syncCommand={id:sync.id};return;}let {item,record}=selected;
  if(record.state==='queued'){record={...record,state:'processing',workerId,claimToken:crypto.randomUUID(),message:item.kind==='lookup'?'Reading current Nexvia choices.':'Collected by the Nexvia worker.',collectedAt:new Date().toISOString(),...(item.kind==='request'&&body.documentExpected===true?{documentExpected:true}:{}),...(item.kind==='request'&&record.quoteTransfer?.version===1?{quoteAttachmentVersion:1}:{})};store.write(item.kind==='lookup'?lookupKey(item.id):requestKey(item.id),record);}claimed={id:item.id,kind:item.kind,claimToken:record.claimToken,projectPageId:record.projectPageId,...(item.kind==='request'?{payload:nasPayload(record)}:{}),...(record.documentExpected===true?{documentExpected:true}:{}),...(record.quoteAttachmentVersion===1?{quoteAttachmentVersion:1}:{})};
 });return result({work:claimed||null,connection:connection(store),...(syncCommand?{referenceSync:syncCommand}:{}),...(reviewClaim?{review:reviewClaim}:{})});
}
async function normalizeCatalog(value,projectPageId,historical=false){
 fields(value,['projectPageId','supplierSearch','suppliers','services','breakdowns','accounts','taxes','sourceUpdatedAt','eowUpdatedAt'],'Nexvia choices');check(value.projectPageId===projectPageId&&value.supplierSearch==='','Nexvia choices do not match the requested project');const catalog={projectPageId,supplierSearch:''};
 for(const list of ['suppliers','services','breakdowns','accounts','taxes']){
  check(Array.isArray(value[list])&&value[list].length<=10000,'Invalid '+list+' choices');const seen=new Set();catalog[list]=value[list].map(row=>{check(object(row),'Invalid '+list+' choice');const id=choiceId(row.id,list+' ID');check(!seen.has(id),'Duplicate '+list+' choice');seen.add(id);const normalized={id,[list==='suppliers'?'text':'name']:text(row[list==='suppliers'?'text':'name'],500,list+' label'),disabled:row.disabled===true};if(list==='taxes'){const rate=decimal(row.rate,4,'tax rate');check(rate.scaled<=1000000n,'Invalid tax rate');normalized.rate=Number(rate.value);}return normalized;});
 }
 const sourceUpdatedAt=value.sourceUpdatedAt,eowUpdatedAt=value.eowUpdatedAt;for(const stamp of [sourceUpdatedAt,eowUpdatedAt])if(stamp!==undefined){check(typeof stamp==='string'&&stamp.length<=40&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(stamp)&&Number.isFinite(Date.parse(stamp))&&Date.parse(stamp)<=Date.now()&&(historical||Date.now()-Date.parse(stamp)<=CATALOG_CACHE_MS),'Invalid Nexvia source capture time');}check(eowUpdatedAt===undefined||sourceUpdatedAt!==undefined&&Date.parse(eowUpdatedAt)>=Date.parse(sourceUpdatedAt),'Invalid EOW capture time');
 return {...catalog,revision:await digest(canonical(catalog)),updatedAt:sourceUpdatedAt?new Date(sourceUpdatedAt).toISOString():new Date().toISOString(),...(sourceUpdatedAt?{sourceUpdatedAt:new Date(sourceUpdatedAt).toISOString()}:{}),...(eowUpdatedAt?{eowUpdatedAt:new Date(eowUpdatedAt).toISOString()}: {})};
}
function normalizedVerifiedResult(value,record){
 fields(value,['state','requestReference','projectPageId','purchaseOrderId','purchaseOrderNumber','url','totalCents','verifiedAt','jobId','requestorEmailSent','documentExpected'],'verified PO result');check(value.documentExpected===undefined||typeof value.documentExpected==='boolean','Invalid PO document expectation');check(record.documentExpected!==true||value.documentExpected===true,'The claimed request requires its managed PO document',409);check(value.state==='CREATED_VERIFIED'&&value.requestReference===record.reference&&value.projectPageId===record.projectPageId&&value.totalCents===record.totalCents,'Verified PO does not match the saved request');check(typeof value.verifiedAt==='string'&&value.verifiedAt.length<=40&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.verifiedAt)&&Number.isFinite(Date.parse(value.verifiedAt))&&new Date(value.verifiedAt).toISOString().slice(0,19)===value.verifiedAt.slice(0,19),'Invalid PO verification timestamp');const verifiedAt=new Date(value.verifiedAt).toISOString();
 const confirmation=normalizeNexviaConfirmation({requestId:record.id,requestReference:record.reference,recipient:record.requestor.email,project:record.project,purchaseOrderId:value.purchaseOrderId,purchaseOrderNumber:value.purchaseOrderNumber,projectPageId:record.projectPageId,totalCents:record.totalCents,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt,test:false});const url='https://lennox.nexvia.com.au/staff/project-purchase-order-modify/'+record.projectPageId+'/'+confirmation.purchaseOrderId;check(value.url===url,'Verified PO URL does not match the saved request');return {verified:{state:'CREATED_VERIFIED',requestReference:record.reference,projectPageId:record.projectPageId,purchaseOrderId:confirmation.purchaseOrderId,purchaseOrderNumber:confirmation.purchaseOrderNumber,url,totalCents:record.totalCents,verifiedAt,...(value.documentExpected===true?{documentExpected:true}:{})},confirmation};
}
function documentBinding(store,body){
 const record=store.read(requestKey(body.id),null);check(record&&record.workerId===body.workerId&&equal(record.claimToken,body.claimToken),'Work claim not found',404);
 check(record.state==='created_verified'&&record.result,'The purchase order must be verified before its PDF is attached',409);
 check(record.result.documentExpected===true,'This confirmation does not expect a PO document',409);
 check(record.result.purchaseOrderId===body.purchaseOrderId&&record.result.purchaseOrderNumber===body.purchaseOrderNumber&&record.projectPageId===body.projectPageId,'The PDF does not match the verified purchase order');
 const {confirmation}=normalizedVerifiedResult(record.result,record),job=store.read('nexvia-confirmation-email:job:live:'+body.purchaseOrderId,null);
 check(job,'The confirmation is not ready for its document; retry the saved verification result first',503);
 check(job.documentExpected===true&&JSON.stringify(job.confirmation)===JSON.stringify(confirmation),'The frozen confirmation does not match this document',409);
 return {record,confirmation,job};
}
function quoteDownload(store,body){
 fields(body,['workerId','id','claimToken','sha256'],'quote download');uuid(body.workerId,'worker ID');uuid(body.id);uuid(body.claimToken,'claim token');check(typeof body.sha256==='string'&&/^[a-f0-9]{64}$/.test(body.sha256),'Invalid quote hash');
 const record=store.read(requestKey(body.id),null);check(record&&record.workerId===body.workerId&&equal(record.claimToken,body.claimToken),'Work claim not found',404);
 check(record.quoteAttachmentVersion===1&&record.documentExpected===true&&record.quoteTransfer?.version===1&&['processing','created_verified'].includes(record.state),'This request has no active managed quote claim',409);
 check(['pending','needs_review'].includes(record.quoteTransfer.state)&&record.quoteFile&&record.quote&&Date.parse(record.quoteFile.expiresAt)>Date.now(),'The quote transfer is no longer available',410);const key='nexvia-quote-transfers/'+record.id+'/'+body.sha256+'.pdf';check(record.quoteFile.version===1&&record.quoteFile.requestId===record.id&&record.quoteFile.key===key&&equal(record.quoteFile.sha256,body.sha256)&&record.quoteFile.bytes===record.quote.bytes,'The quote does not match the saved request',409);
 return result({transfer:{key,filename:record.quote.filename,bytes:record.quote.bytes,sha256:record.quoteFile.sha256}});
}
async function acceptQuoteReceipt(store,body,token){
 fields(body,['workerId','id','claimToken','version','sha256','bytes','projectPageId','purchaseOrderId','purchaseOrderNumber','nativeFileIds'],'quote attachment receipt');uuid(body.workerId,'worker ID');uuid(body.id);uuid(body.claimToken,'claim token');check(body.version===1,'Unsupported quote attachment receipt version');check(typeof body.sha256==='string'&&/^[a-f0-9]{64}$/.test(body.sha256),'Invalid quote hash');check(Number.isSafeInteger(body.bytes)&&body.bytes>=5&&body.bytes<=MAX_PDF,'Invalid quote size');positive(body.projectPageId,'project');positive(body.purchaseOrderId,'purchase order');check(typeof body.purchaseOrderNumber==='string'&&/^PO\d+$/.test(body.purchaseOrderNumber),'Invalid purchase order number');check(Array.isArray(body.nativeFileIds)&&body.nativeFileIds.length===1,'The receipt must identify exactly one native quote file');positive(body.nativeFileIds[0],'native quote file');
 const receipt={version:1,sha256:body.sha256,bytes:body.bytes,projectPageId:body.projectPageId,purchaseOrderId:body.purchaseOrderId,purchaseOrderNumber:body.purchaseOrderNumber,nativeFileIds:[body.nativeFileIds[0]]};let saved,duplicate=false;
 store.ctx.storage.transactionSync(()=>{
  machineAuth(store,token);const record=store.read(requestKey(body.id),null);check(record&&record.workerId===body.workerId&&equal(record.claimToken,body.claimToken),'Work claim not found',404);check(record.state==='created_verified'&&record.result?.state==='CREATED_VERIFIED','The existing PO must be verified before its quote attachment is acknowledged',409);
  check(record.quoteAttachmentVersion===1&&record.documentExpected===true&&record.quoteTransfer?.version===1&&record.quoteFile&&record.quote,'This request has no managed quote attachment',409);
  check(record.projectPageId===body.projectPageId&&record.result.projectPageId===body.projectPageId&&record.result.purchaseOrderId===body.purchaseOrderId&&record.result.purchaseOrderNumber===body.purchaseOrderNumber&&record.quote.bytes===body.bytes&&record.quoteFile.bytes===body.bytes&&equal(record.quoteFile.sha256,body.sha256),'The attachment receipt does not match the frozen quote and verified PO',409);
  if(record.quoteAttachmentReceipt){check(canonical(record.quoteAttachmentReceipt)===canonical(receipt)&&record.quoteTransfer.state==='attached','This quote already has a different native attachment receipt',409);duplicate=true;saved=record;return;}
  check(['pending','needs_review','expired'].includes(record.quoteTransfer.state),'This quote attachment cannot be changed',409);
  saved={...record,message:'Purchase order created and verified in Nexvia. Quote attached.',quoteAttachmentReceipt:receipt,quoteTransfer:{...record.quoteTransfer,state:'attached',attachedAt:new Date().toISOString()}};store.write(requestKey(body.id),saved);queueQuoteTransferDelete(store,record.quoteFile,'attached');store.audit('nexvia-request-worker','purchase-request-quote-attached',{requestId:body.id,purchaseOrderId:body.purchaseOrderId});
 });
 // A lost receipt response also repairs a previously interrupted enqueue. The
 // input quote and the immutable generated email PDF have separate lifecycles.
 const {confirmation}=normalizedVerifiedResult(saved.result,saved);enqueueNexviaConfirmation(store,confirmation,'nexvia-request-worker',{documentExpected:true});
 await processQuoteTransferCleanup(store).catch(()=>{});
 return result({duplicate,quoteTransfer:saved.quoteTransfer,receipt});
}
async function poDocumentBytes(body){
 check(typeof body.sha256==='string'&&/^[a-f0-9]{64}$/.test(body.sha256),'Invalid PDF hash');
 const encoded=body.contentBase64;check(typeof encoded==='string'&&encoded.length>0&&encoded.length<=4*Math.ceil(MAX_PO_DOCUMENT/3)&&encoded.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'Choose a PDF no larger than 5 MB');
 let raw;try{raw=atob(encoded);}catch{check(false,'Invalid PDF content');}check(btoa(raw)===encoded,'PDF base64 must be canonical');check(raw.length>=5&&raw.length<=MAX_PO_DOCUMENT&&raw.startsWith('%PDF-'),'Choose a Nexvia PDF no larger than 5 MB');
 const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));check(equal(await bytesDigest(bytes),body.sha256),'The PDF hash does not match its contents');
 try{const pdf=await PDFDocument.load(bytes,{updateMetadata:false});check(pdf.getPageCount()>0,'The PDF has no pages');}catch{check(false,'Choose a readable Nexvia PO PDF');}
 return bytes;
}
async function acceptRequestDocument(store,body,token){
 fields(body,['workerId','id','claimToken','purchaseOrderId','purchaseOrderNumber','projectPageId','sha256','contentBase64'],'PO document');
 uuid(body.workerId,'worker ID');uuid(body.id);uuid(body.claimToken,'claim token');positive(body.purchaseOrderId,'purchase order');positive(body.projectPageId,'project');check(typeof body.purchaseOrderNumber==='string'&&/^PO\d+$/.test(body.purchaseOrderNumber),'Invalid purchase order number');documentBinding(store,body);
 const bytes=await poDocumentBytes(body);
 const document={key:'nexvia-po-documents/'+body.id+'/'+body.purchaseOrderId+'/'+body.sha256+'.pdf',name:body.purchaseOrderNumber+'.pdf',size:bytes.length,sha256:body.sha256};
 machineAuth(store,token);const current=documentBinding(store,body);let accepted;
 if(current.job.document){accepted=store.ctx.storage.transactionSync(()=>{const latest=documentBinding(store,body);return attachNexviaConfirmationDocument(store,latest.confirmation,document);});}
 else{
  check(current.job.status==='awaiting_document'&&current.job.firstAttemptAt===undefined,'The confirmation can no longer accept a new document',409);
  check(store.env.CAD_PROJECT_FILES,'PO document storage is unavailable',503);
  // Content-addressed private objects are immutable. A lost/stale upload may
  // leave an unreferenced object; deleting it could race an identical replay.
  await store.env.CAD_PROJECT_FILES.put(document.key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/pdf'}});
  machineAuth(store,token);accepted=store.ctx.storage.transactionSync(()=>{const latest=documentBinding(store,body);return attachNexviaConfirmationDocument(store,latest.confirmation,document);});
 }
 if(store.processNexviaConfirmationEmailQueue)store.ctx.waitUntil(store.processNexviaConfirmationEmailQueue().catch(()=>{}));
 return result({duplicate:accepted.duplicate,confirmation:accepted.confirmation});
}
async function acceptDocumentTest(store,body,token){
 fields(body,['sha256','contentBase64'],'fixed PO PDF test');const bytes=await poDocumentBytes(body);machineAuth(store,token);
 const job=prepareNexviaDocumentTestConfirmation(store,body.sha256,bytes.length),confirmation=job.confirmation;
 const document={key:'nexvia-po-documents/'+confirmation.requestId+'/'+confirmation.purchaseOrderId+'/'+body.sha256+'.pdf',name:confirmation.purchaseOrderNumber+'.pdf',size:bytes.length,sha256:body.sha256};
 if(!job.document){
  check(store.env.CAD_PROJECT_FILES,'PO document storage is unavailable',503);
  await store.env.CAD_PROJECT_FILES.put(document.key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/pdf'}});
 }
 machineAuth(store,token);const accepted=store.ctx.storage.transactionSync(()=>attachNexviaDocumentTestConfirmation(store,document));
 if(store.processNexviaConfirmationEmailQueue&&['queued','retrying','sending'].includes(accepted.confirmation.status))await store.processNexviaConfirmationEmailQueue().catch(()=>{});
 return {status:200,body:{...nexviaDocumentTestResult(store),duplicate:accepted.duplicate}};
}
async function reconcileRequest(store,body,token){
 fields(body,['workerId','id','claimToken','version','previous','result'],'request reconciliation');const workerId=uuid(body.workerId,'worker ID'),id=uuid(body.id),claimToken=uuid(body.claimToken,'claim token');check(body.version===1,'Invalid reconciliation version');fields(body.previous,['state','message'],'previous worker result');check(body.previous.state==='needs_review','Only a review result can be reconciled');const message=text(body.previous.message,500,'previous worker result message');check(message===body.previous.message,'Provide the exact normalized previous worker result message');
 const key=requestKey(id),initial=store.read(key,null);check(initial&&initial.workerId===workerId&&equal(initial.claimToken,claimToken),'Work claim not found',404);
 check(initial.documentExpected===true&&initial.quote===null&&!initial.quoteTransfer&&!initial.quoteFile&&!initial.quoteKey&&!initial.quoteAttachmentVersion,'Only a managed request without a quote can be reconciled',409);
 const {verified,confirmation}=normalizedVerifiedResult(body.result,initial),originalOutcomeHash=await digest(canonical({state:'needs_review',message})),originalMessageSha256=await digest(message),resultHash=await digest(canonical(verified)),hash=await digest(canonical({version:1,originalOutcomeHash,result:verified}));let saved,duplicate=false;
 // Hashing yields to other requests. Recheck the credential, claim and immutable
 // original outcome before changing this existing PO's verification state.
 machineAuth(store,token);store.ctx.storage.transactionSync(()=>{
  const current=store.read(key,null);check(current&&current.workerId===workerId&&equal(current.claimToken,claimToken),'Work claim not found',404);check(current.documentExpected===true&&current.quote===null&&!current.quoteTransfer&&!current.quoteFile&&!current.quoteKey&&!current.quoteAttachmentVersion,'Only a managed request without a quote can be reconciled',409);check(current.outcomeHash===originalOutcomeHash,'The original worker result does not match this reconciliation',409);
  if(current.reconciliationEvidence){check(current.reconciliationEvidence.version===1&&current.reconciliationEvidence.hash===hash&&current.reconciliationEvidence.originalOutcomeHash===originalOutcomeHash&&current.state==='created_verified'&&canonical(current.result)===canonical(verified),'This request already has different reconciliation evidence',409);saved=current;duplicate=true;return;}
  check(current.state==='needs_review'&&current.result===null&&current.message===message,'Only the original unresolved review result can be reconciled',409);
  const job=store.read('nexvia-confirmation-email:job:live:'+verified.purchaseOrderId,null);check(!job||(job.documentExpected===true&&JSON.stringify(job.confirmation)===JSON.stringify(confirmation)),'This purchase order already has a different confirmation',409);
  saved={...current,state:'created_verified',message:'Existing purchase order verified in Nexvia. Waiting for its PDF confirmation.',result:verified,reconciliationEvidence:{version:1,hash,originalState:'needs_review',originalMessageSha256,originalOutcomeHash,resultHash,reconciledAt:new Date().toISOString()}};
  store.write(key,saved);store.audit('nexvia-request-worker','purchase-request-reconciled',{id,purchaseOrderNumber:verified.purchaseOrderNumber});
 });
 // The original terminal hash and work item stay untouched. An identical retry
 // repairs an interrupted enqueue with the same PO identity and frozen PDF gate.
 enqueueNexviaConfirmation(store,confirmation,'nexvia-request-worker',{documentExpected:true});return result({duplicate,acceptedState:'created_verified',reconciliation:{version:1,hash},request:publicRequest(store,saved)});
}
async function finishWork(store,body){
 fields(body,['workerId','id','claimToken','kind','state','catalog','result','message'],'worker result');const workerId=uuid(body.workerId,'worker ID'),id=uuid(body.id),claimToken=uuid(body.claimToken,'claim token');check(['lookup','request'].includes(body.kind),'Invalid work kind');const key=body.kind==='lookup'?lookupKey(id):requestKey(id),initial=store.read(key,null);check(initial&&initial.workerId===workerId&&equal(initial.claimToken,claimToken),'Work claim not found',404);const message=text(body.message??'',500,'worker result message',true);let catalog,verified,confirmation;
 if(body.state==='ready'){check(body.kind==='lookup'&&body.result===undefined,'Invalid lookup result');catalog=await normalizeCatalog(body.catalog,initial.projectPageId,initial.state!=='processing');}
 else if(body.state==='created_verified'){check(body.kind==='request'&&body.catalog===undefined,'Invalid PO result');({verified,confirmation}=normalizedVerifiedResult(body.result,initial));}
 else{check(body.state==='needs_review'&&body.catalog===undefined&&body.result===undefined,'Invalid worker result');check(message,'Provide a review message');}
 const outcomeHash=await digest(canonical({state:body.state,message,...(catalog?{catalog:{...catalog,updatedAt:null}}:{}),...(verified?{result:verified}:{})}));let final;
 store.ctx.storage.transactionSync(()=>{
  const current=store.read(key,null);check(current&&current.workerId===workerId&&equal(current.claimToken,claimToken),'Work claim not found',404);if(current.state!=='processing'){check(current.outcomeHash===outcomeHash,'This work item already has a different result',409);final=current;return;}
  final={...current,state:body.state,message:message||(body.state==='ready'?'Nexvia choices refreshed.':verified&&current.quoteTransfer?.version===1&&current.quoteTransfer.state!=='attached'?'Purchase order created and verified. Waiting for its quote to be attached.':'Purchase order created and verified in Nexvia.'),outcomeHash,completedAt:new Date().toISOString(),...(verified?{result:verified}:{}),...(body.kind==='request'&&body.state==='needs_review'&&current.quoteTransfer?.version===1?{quoteTransfer:{...current.quoteTransfer,state:current.quoteTransfer.state==='expired'?'expired':'needs_review'}}:{})};
  if(catalog){if(!store.read(SHARED_DATA,null)){const previousShared=sharedCatalog(store);if(previousShared)store.write(SHARED_DATA,previousShared);}const previous=store.read(catalogKey(current.projectPageId),null);if(!previous||Date.parse(previous.eowUpdatedAt||previous.updatedAt)<=Date.parse(catalog.eowUpdatedAt||catalog.updatedAt))store.write(catalogKey(current.projectPageId),catalog);if(store.read(catalogFailureKey(current.projectPageId),null))store.write(catalogFailureKey(current.projectPageId),null);publishSharedSource(store,catalog);}
  else if(body.kind==='lookup'&&body.state==='needs_review'){
   const collectedAt=Date.parse(current.collectedAt),updatedAt=Date.parse(store.read(catalogKey(current.projectPageId),null)?.updatedAt);
   // A late failure from an older in-flight read must not invalidate a newer
   // successfully published snapshot. Terminal replays return above unchanged.
   if(!Number.isFinite(collectedAt)||!Number.isFinite(updatedAt)||collectedAt>=updatedAt)store.write(catalogFailureKey(current.projectPageId),{lookupId:id,failedAt:final.completedAt});
  }
  store.write(key,final);completeReferenceLookup(store,final);store.write(WORK,store.read(WORK,[]).filter(item=>item.id!==id||item.kind!==body.kind));store.audit('nexvia-request-worker','purchase-request-'+body.state,{id,kind:body.kind,...(verified?{purchaseOrderNumber:verified.purchaseOrderNumber}:{})});
 });
 // Enqueue outside the result transaction. A terminal-result replay always repairs
 // a missing confirmation after an interrupted write, using the exact same key.
 if(confirmation&&(final.quoteTransfer?.version!==1||final.quoteTransfer.state==='attached')){enqueueNexviaConfirmation(store,confirmation,'nexvia-request-worker',{documentExpected:final.result.documentExpected===true});if(store.processNexviaConfirmationEmailQueue)store.ctx.waitUntil(store.processNexviaConfirmationEmailQueue().catch(()=>{}));}
 return result(body.kind==='lookup'?await lookupReply(store,final):{request:publicRequest(store,final),...(final.reconciliationEvidence?{acceptedState:body.state}:{})});
}
export async function handleNexviaRequestWorker(store,path,method,body,token){
 if(path==='/integrations/nexvia/test-document-confirmation'&&method==='GET'){machineAuth(store,token,false);fields(body,[],'fixed PO PDF test status');return {status:200,body:nexviaDocumentTestResult(store)};}
 if(path==='/integrations/nexvia/request-quote'){machineAuth(store,token,false);check(method==='POST','Method not allowed',405);return quoteDownload(store,body);}
 machineAuth(store,token);check(method==='POST','Method not allowed',405);if(path==='/integrations/nexvia/request-work')return claimWork(store,body);if(path==='/integrations/nexvia/request-review-result')return acceptReviewResult(store,body);if(path==='/integrations/nexvia/request-document')return acceptRequestDocument(store,body,token);if(path==='/integrations/nexvia/request-quote-receipt')return acceptQuoteReceipt(store,body,token);if(path==='/integrations/nexvia/request-reconcile')return reconcileRequest(store,body,token);if(path==='/integrations/nexvia/test-document-confirmation')return acceptDocumentTest(store,body,token);check(path==='/integrations/nexvia/request-results','Not found',404);return finishWork(store,body);
}

// Called inside the existing account-rename transaction, while both account rows
// retain the same immutable creation timestamp. Reused usernames never match it.
export function renamePurchaseRequestOwner(store,from,to){
 const generation=accountGeneration(store,from);check(accountGeneration(store,to)===generation,'Purchase request account identity changed',409);
 for(const [indexFor,keyFor] of [[ownerIndex,requestKey],[lookupOwnerIndex,lookupKey]]){
  const sourceKey=indexFor(from,generation),targetKey=indexFor(to,generation),ids=store.read(sourceKey,[]);if(!ids.length)continue;
  const migrated=[];for(const id of ids){const record=store.read(keyFor(id),null);if(record?.submittedBy===from&&record.ownerCreatedAt===generation){store.write(keyFor(id),{...record,submittedBy:to});migrated.push(id);}}
  if(migrated.length)store.write(targetKey,[...new Set([...store.read(targetKey,[]),...migrated])]);store.write(sourceKey,[]);
 }
 for(const id of store.read(INDEX,[])){const record=store.read(requestKey(id),null);if(record?.reviewCreatedBy===from&&record.reviewCreatorGeneration===generation)store.write(requestKey(id),{...record,reviewCreatedBy:to});}
}
