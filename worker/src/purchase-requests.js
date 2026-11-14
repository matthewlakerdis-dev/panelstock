import {digest,equal,HttpError,requireCondition as check} from './security.js';
import {enqueueNexviaConfirmation,normalizeNexviaConfirmation} from './nexvia-confirmation-email.js';

const ROOT='purchase-request:',INDEX=ROOT+'index',WORK=ROOT+'work',PROJECTS=ROOT+'projects',HEARTBEAT=ROOT+'heartbeat',SHARED_SOURCE=ROOT+'shared-source';
const requestKey=id=>ROOT+'record:'+id,lookupKey=id=>ROOT+'lookup:'+id,catalogKey=id=>ROOT+'catalog:'+id,catalogFailureKey=id=>ROOT+'catalog-failure:'+id;
const ownerIndex=(username,generation)=>ROOT+'owner-index:'+username+':'+generation;
const lookupOwnerIndex=(username,generation)=>ROOT+'lookup-owner-index:'+username+':'+generation;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_PDF=10*1024*1024,MAX_TOTAL=1000000000000n,CATALOG_CACHE_MS=5*60000;
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
function publicRequest(store,record){
 const {inputHash,catalogRevision,claimToken,workerId,quoteKey,outcomeHash,ownerCreatedAt,...visible}=record;
 const email=record.result?store.read('nexvia-confirmation-email:job:live:'+record.result.purchaseOrderId,null):null;
 return {...visible,confirmation:email?{status:email.status,providerId:email.providerId||null}:null};
}
function publicSummary(store,record){const {lines,...summary}=publicRequest(store,record);return {...summary,lineCount:lines.length};}
function publicLookup(lookup){return {id:lookup.id,projectPageId:lookup.projectPageId,state:lookup.state,message:lookup.message||''};}
function lookupReply(store,lookup){return {lookup:publicLookup(lookup),catalog:lookup.state==='ready'?store.read(catalogKey(lookup.projectPageId),null):null,serverTime:new Date().toISOString()};}
function freshCatalog(store,projectPageId){
 const catalog=store.read(catalogKey(projectPageId),null),age=Date.now()-Date.parse(catalog?.updatedAt);
 // Only complete snapshots published by the validated NAS result path qualify.
 // Reading one never extends its verification timestamp or changes its revision.
 if(!object(catalog)||catalog.projectPageId!==projectPageId||catalog.supplierSearch!==''||typeof catalog.revision!=='string'||!/^[a-f0-9]{64}$/.test(catalog.revision)||!Number.isFinite(age)||age<0||age>=CATALOG_CACHE_MS||!['suppliers','services','breakdowns','accounts','taxes'].every(field=>Array.isArray(catalog[field])&&catalog[field].length<=10000&&(field==='suppliers'||catalog[field].length>0))||store.read(catalogFailureKey(projectPageId),null))return null;
 return catalog;
}
function publishSharedSource(store,catalog){
 const previous=store.read(SHARED_SOURCE,null),updatedAt=Date.parse(catalog.updatedAt),previousAt=Date.parse(previous?.updatedAt);
 if(!Number.isFinite(updatedAt)||(Number.isFinite(previousAt)&&previousAt>updatedAt)||(previous?.projectPageId===catalog.projectPageId&&previous.updatedAt===catalog.updatedAt))return;
 store.write(SHARED_SOURCE,{projectPageId:catalog.projectPageId,updatedAt:catalog.updatedAt});
}
function sharedChoices(store){
 const source=store.read(SHARED_SOURCE,null);if(!Number.isSafeInteger(source?.projectPageId)||source.projectPageId<=0||!Number.isFinite(Date.parse(source.updatedAt))||!store.read(PROJECTS,[]).some(row=>row.projectPageId===source.projectPageId))return null;
 const catalog=freshCatalog(store,source.projectPageId);if(!catalog||Date.parse(catalog.updatedAt)<Date.parse(source.updatedAt))return null;
 // The complete project catalog remains the sole submission authority. Shared
 // menus deliberately expose neither project-specific EOW nor its revision.
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
 fields(body,['requestId','projectPageId','catalogRevision','requestor','date','supplierId','supplierReference','serviceId','breakdownType','quote','quoteBase64','lines','subtotalCents','taxCents','totalCents'],'purchase request');
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
 return {input:{requestId:uuid(body.requestId),projectPageId:positive(body.projectPageId,'project'),catalogRevision:text(body.catalogRevision,128,'project choices revision'),requestor:{name,email},date,supplierId:choiceId(body.supplierId,'supplier'),supplierReference:text(body.supplierReference??'',200,'supplier reference',true),serviceId:choiceId(body.serviceId,'service'),breakdownType,quote,lines},pdf};
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
 const previous=store.read(key,null);if(previous){check(previous.submittedBy===actor.username&&previous.ownerCreatedAt===ownerCreatedAt&&previous.inputHash===inputHash,'This request ID already belongs to a different submission',409);return result({duplicate:true,request:publicRequest(store,previous)});}
 const project=store.read(PROJECTS,[]).find(row=>row.projectPageId===input.projectPageId);check(project,'Choose a current project');const catalog=store.read(catalogKey(input.projectPageId),null);choicesCurrent(catalog&&catalog.revision===input.catalogRevision,'Project choices changed. Refresh choices before submitting.');choicesCurrent(Date.now()-Date.parse(catalog.updatedAt)<24*3600000,'Project choices have expired. Refresh choices before submitting.');const totals=priceRequest(input,catalog);check(store.read(INDEX,[]).length<5000&&store.read(WORK,[]).length<5000,'Purchase request storage is full; contact an administrator',503);let quoteKey=null;
 if(pdf){check(store.env.CAD_PROJECT_FILES,'Quote storage is unavailable',503);quoteKey='purchase-requests/'+input.requestId+'/'+(await digest(actor.username)).slice(0,16)+'-'+pdfHash+'.pdf';await store.env.CAD_PROJECT_FILES.put(quoteKey,pdf,{httpMetadata:{contentType:'application/pdf'}});}
 let saved,existing=false;
 try{store.ctx.storage.transactionSync(()=>{
  check(accountGeneration(store,actor.username)===ownerCreatedAt,'Account identity changed; sign in again',403);
  const prior=store.read(key,null);if(prior){check(prior.submittedBy===actor.username&&prior.ownerCreatedAt===ownerCreatedAt&&prior.inputHash===inputHash,'This request ID already belongs to a different submission',409);saved=prior;existing=true;return;}
  choicesCurrent(store.read(catalogKey(input.projectPageId),null)?.revision===input.catalogRevision,'Project choices changed. Refresh choices before submitting.');const index=store.read(INDEX,[]),work=store.read(WORK,[]);check(index.length<5000&&work.length<5000,'Purchase request storage is full; contact an administrator',503);const {requestId,...details}=input;
  saved={id:requestId,reference:'REQ-'+requestId,...details,project:project.name,...totals,inputHash,quoteKey,submittedBy:actor.username,ownerCreatedAt,createdAt:new Date().toISOString(),state:pdf?'needs_review':'queued',message:pdf?'Quote attached. This request needs review before a Nexvia PO can be created.':'Waiting for the Nexvia worker.',result:null};
  store.write(key,saved);store.write(INDEX,[...index,requestId]);store.write(ownerIndex(actor.username,ownerCreatedAt),[...store.read(ownerIndex(actor.username,ownerCreatedAt),[]),requestId]);if(!pdf)store.write(WORK,[...work,{id:requestId,kind:'request'}]);store.audit(actor.username,'purchase-request-submitted',{requestId,projectPageId:input.projectPageId,totalCents:totals.totalCents,quote:!!pdf});
 });}catch(error){
  // A competing identical submission may already reference this immutable key.
  // Delete only after positively observing that no saved request retains it.
  if(quoteKey){let retained=true;try{retained=store.read(key,null)?.quoteKey===quoteKey;}catch{}if(!retained)try{await store.env.CAD_PROJECT_FILES.delete(quoteKey);}catch{}}
  throw error;
 }return result({duplicate:existing,request:publicRequest(store,saved)},existing?200:201);
}
function createLookup(store,body,actor){
 writable(store);fields(body,['projectPageId','refresh'],'lookup');check(body.refresh===undefined||typeof body.refresh==='boolean','Invalid project choices refresh');const projectPageId=positive(body.projectPageId,'project'),ownerCreatedAt=accountGeneration(store,actor.username);check(store.read(PROJECTS,[]).some(row=>row.projectPageId===projectPageId),'Choose a current project');let lookup;
 const cached=body.refresh!==true?freshCatalog(store,projectPageId):null;
 if(cached){
  const index=lookupOwnerIndex(actor.username,ownerCreatedAt),ids=store.read(index,[]),previous=ids.length?store.read(lookupKey(ids.at(-1)),null):null;
  if(previous?.state==='ready'&&previous.projectPageId===projectPageId&&previous.submittedBy===actor.username&&previous.ownerCreatedAt===ownerCreatedAt){store.ctx.storage.transactionSync(()=>publishSharedSource(store,cached));return result(lookupReply(store,previous));}
  // Retain an owned lookup ID for the normal status endpoint, without putting
  // a read-only cache hit into the NAS work queue or altering existing claims.
  const now=new Date().toISOString();lookup={id:crypto.randomUUID(),projectPageId,submittedBy:actor.username,ownerCreatedAt,state:'ready',message:'Current Nexvia choices loaded.',createdAt:now,completedAt:now};
  store.ctx.storage.transactionSync(()=>{publishSharedSource(store,cached);store.write(lookupKey(lookup.id),lookup);store.write(index,[...store.read(index,[]).slice(-4999),lookup.id]);});
  return result(lookupReply(store,lookup));
 }
 store.ctx.storage.transactionSync(()=>{const work=store.read(WORK,[]);for(const item of work){if(item.kind!=='lookup')continue;const previous=store.read(lookupKey(item.id),null);if(previous?.submittedBy===actor.username&&previous.ownerCreatedAt===ownerCreatedAt&&previous.projectPageId===projectPageId&&['queued','processing'].includes(previous.state)){lookup=previous;return;}}
  check(work.length<5000,'Purchase request work queue is full',503);lookup={id:crypto.randomUUID(),projectPageId,submittedBy:actor.username,ownerCreatedAt,state:'queued',message:'Waiting for current Nexvia choices.',createdAt:new Date().toISOString()};store.write(lookupKey(lookup.id),lookup);store.write(lookupOwnerIndex(actor.username,ownerCreatedAt),[...store.read(lookupOwnerIndex(actor.username,ownerCreatedAt),[]).slice(-4999),lookup.id]);store.write(WORK,[...work,{id:lookup.id,kind:'lookup'}]);});return result(lookupReply(store,lookup));
}
function refreshSharedChoices(store,body,actor){
 writable(store);fields(body,['refresh'],'shared choices refresh');check(body.refresh===undefined||typeof body.refresh==='boolean','Invalid shared choices refresh');accountGeneration(store,actor.username);
 const shared=body.refresh!==true?sharedChoices(store):null;if(shared)return result({sharedChoices:shared,serverTime:new Date().toISOString()});
 const projects=store.read(PROJECTS,[]),source=store.read(SHARED_SOURCE,null);
 const project=projects.find(row=>row.projectPageId===source?.projectPageId)||projects.reduce((latest,row)=>!latest||row.projectPageId>latest.projectPageId?row:latest,null);
 check(project,'Nexvia project choices are not available yet. Wait for the connection and retry.',503);
 // This only queues an owned, read-only catalog lookup. Its source project is
 // internal context and never selects the user's project or creates a PO.
 const response=createLookup(store,{projectPageId:project.projectPageId,refresh:true},actor);
 return {...response,body:{...response.body,sharedChoices:null}};
}
export async function handlePurchaseRequests(store,path,method,body,actor){
 const allowed=access(actor);
 if(path==='/purchase-requests/shared-choices'){if(method==='GET')return result({sharedChoices:sharedChoices(store),serverTime:new Date().toISOString()});check(method==='POST','Method not allowed',405);return refreshSharedChoices(store,body,actor);}
 if(path==='/purchase-requests'){
  if(method==='GET'){const generation=accountGeneration(store,actor.username),visibleIds=store.read(allowed.manage?INDEX:ownerIndex(actor.username,generation),[]);return result({requests:visibleIds.slice(-200).reverse().map(id=>store.read(requestKey(id),null)).filter(record=>record&&(allowed.manage||(record.submittedBy===actor.username&&record.ownerCreatedAt===generation))).map(record=>publicSummary(store,record)),historyTruncated:visibleIds.length>200,totalCount:visibleIds.length,projects:store.read(PROJECTS,[]),profile:profile(store,actor),permissions:allowed,connection:connection(store)});}
  check(method==='POST','Method not allowed',405);return saveRequest(store,body,actor);
 }
 if(path==='/purchase-requests/lookups'){check(method==='POST','Method not allowed',405);return createLookup(store,body,actor);}
 const lookupMatch=path.match(/^\/purchase-requests\/lookups\/([a-f0-9-]{36})$/);if(lookupMatch){check(method==='GET','Method not allowed',405);return result(lookupReply(store,owned(store,store.read(lookupKey(uuid(lookupMatch[1])),null),actor)));}
 const match=path.match(/^\/purchase-requests\/([a-f0-9-]{36})(?:\/(cancel|quote))?$/);check(match,'Not found',404);const id=uuid(match[1]),record=owned(store,store.read(requestKey(id),null),actor);
 if(match[2]==='quote'){
  check(method==='GET','Method not allowed',405);check(record.quoteKey&&store.env.CAD_PROJECT_FILES,'Quote not found',404);const file=await store.env.CAD_PROJECT_FILES.get(record.quoteKey);check(file,'Quote not found',404);const bytes=new Uint8Array(await file.arrayBuffer());let encoded='';for(let offset=0;offset<bytes.length;offset+=32768)encoded+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return result({quote:{filename:record.quote.filename,base64:btoa(encoded)}});
 }
 if(match[2]==='cancel'){
  check(method==='POST','Method not allowed',405);writable(store);fields(body,[],'cancellation');let saved;store.ctx.storage.transactionSync(()=>{const current=owned(store,store.read(requestKey(id),null),actor);check(current.state==='queued','Only a request that is still queued can be cancelled',409);saved={...current,state:'cancelled',message:'Cancelled before the NAS worker collected it.'};store.write(requestKey(id),saved);store.write(WORK,store.read(WORK,[]).filter(item=>item.kind!=='request'||item.id!==id));store.audit(actor.username,'purchase-request-cancelled',{requestId:id});});return result({request:publicRequest(store,saved)});
 }
 check(method==='GET','Method not allowed',405);return result({request:publicRequest(store,record)});
}
function machineAuth(store,token){const expected=store.env.NEXVIA_REQUEST_TOKEN;check(typeof expected==='string'&&expected.length>=32,'Nexvia purchase request connection is not configured',503);check(equal(token,expected),'Invalid Nexvia request credential',401);writable(store);}
function normalizeProjects(projects){check(Array.isArray(projects)&&projects.length<=5000,'Invalid project directory');const seen=new Set();return projects.map(row=>{fields(row,['projectPageId','name'],'project');const projectPageId=positive(row.projectPageId,'project');check(!seen.has(projectPageId),'Duplicate project');seen.add(projectPageId);return {projectPageId,name:text(row.name,160,'project name')};}).sort((a,b)=>a.projectPageId-b.projectPageId);}
function nasPayload(record){const {id,reference,projectPageId,requestor,date,supplierId,supplierReference,serviceId,breakdownType,lines,subtotalCents,taxCents,totalCents}=record;return {requestId:id,reference,projectPageId,requestor,date,supplierId,supplierReference,serviceId,breakdownType,quote:null,lines,subtotalCents,taxCents,totalCents,testOnly:true,nexviaSubmissionEnabled:false};}
function claimWork(store,body){
 fields(body,['workerId','projects'],'worker poll');const workerId=uuid(body.workerId,'worker ID'),projects=body.projects===undefined?null:normalizeProjects(body.projects);let claimed;
 store.ctx.storage.transactionSync(()=>{
  const previous=store.read(HEARTBEAT,null);if(!previous||Date.now()-Date.parse(previous)>=5*60000)store.write(HEARTBEAT,new Date().toISOString());if(projects&&canonical(projects)!==canonical(store.read(PROJECTS,[])))store.write(PROJECTS,projects);
  const work=store.read(WORK,[]);let selected=null;for(const item of work){const record=store.read(item.kind==='lookup'?lookupKey(item.id):requestKey(item.id),null);if(record?.state==='processing'&&record.workerId===workerId){selected={item,record};break;}if(!selected&&record?.state==='queued')selected={item,record};}if(!selected)return;let {item,record}=selected;
  if(record.state==='queued'){record={...record,state:'processing',workerId,claimToken:crypto.randomUUID(),message:item.kind==='lookup'?'Reading current Nexvia choices.':'Collected by the Nexvia worker.',collectedAt:new Date().toISOString()};store.write(item.kind==='lookup'?lookupKey(item.id):requestKey(item.id),record);}claimed={id:item.id,kind:item.kind,claimToken:record.claimToken,projectPageId:record.projectPageId,...(item.kind==='request'?{payload:nasPayload(record)}:{})};
 });return result({work:claimed||null,connection:connection(store)});
}
async function normalizeCatalog(value,projectPageId){
 fields(value,['projectPageId','supplierSearch','suppliers','services','breakdowns','accounts','taxes'],'Nexvia choices');check(value.projectPageId===projectPageId&&value.supplierSearch==='','Nexvia choices do not match the requested project');const catalog={projectPageId,supplierSearch:''};
 for(const list of ['suppliers','services','breakdowns','accounts','taxes']){
  check(Array.isArray(value[list])&&value[list].length<=10000,'Invalid '+list+' choices');const seen=new Set();catalog[list]=value[list].map(row=>{check(object(row),'Invalid '+list+' choice');const id=choiceId(row.id,list+' ID');check(!seen.has(id),'Duplicate '+list+' choice');seen.add(id);const normalized={id,[list==='suppliers'?'text':'name']:text(row[list==='suppliers'?'text':'name'],500,list+' label'),disabled:row.disabled===true};if(list==='taxes'){const rate=decimal(row.rate,4,'tax rate');check(rate.scaled<=1000000n,'Invalid tax rate');normalized.rate=Number(rate.value);}return normalized;});
 }return {...catalog,revision:await digest(canonical(catalog)),updatedAt:new Date().toISOString()};
}
function normalizedVerifiedResult(value,record){
 fields(value,['state','requestReference','projectPageId','purchaseOrderId','purchaseOrderNumber','url','totalCents','verifiedAt','jobId','requestorEmailSent'],'verified PO result');check(value.state==='CREATED_VERIFIED'&&value.requestReference===record.reference&&value.projectPageId===record.projectPageId&&value.totalCents===record.totalCents,'Verified PO does not match the saved request');check(typeof value.verifiedAt==='string'&&value.verifiedAt.length<=40&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.verifiedAt)&&Number.isFinite(Date.parse(value.verifiedAt))&&new Date(value.verifiedAt).toISOString().slice(0,19)===value.verifiedAt.slice(0,19),'Invalid PO verification timestamp');const verifiedAt=new Date(value.verifiedAt).toISOString();
 const confirmation=normalizeNexviaConfirmation({requestId:record.id,requestReference:record.reference,recipient:record.requestor.email,project:record.project,purchaseOrderId:value.purchaseOrderId,purchaseOrderNumber:value.purchaseOrderNumber,projectPageId:record.projectPageId,totalCents:record.totalCents,currency:'AUD',state:'CREATED_VERIFIED',verifiedAt,test:false});const url='https://lennox.nexvia.com.au/staff/project-purchase-order-modify/'+record.projectPageId+'/'+confirmation.purchaseOrderId;check(value.url===url,'Verified PO URL does not match the saved request');return {verified:{state:'CREATED_VERIFIED',requestReference:record.reference,projectPageId:record.projectPageId,purchaseOrderId:confirmation.purchaseOrderId,purchaseOrderNumber:confirmation.purchaseOrderNumber,url,totalCents:record.totalCents,verifiedAt},confirmation};
}
async function finishWork(store,body){
 fields(body,['workerId','id','claimToken','kind','state','catalog','result','message'],'worker result');const workerId=uuid(body.workerId,'worker ID'),id=uuid(body.id),claimToken=uuid(body.claimToken,'claim token');check(['lookup','request'].includes(body.kind),'Invalid work kind');const key=body.kind==='lookup'?lookupKey(id):requestKey(id),initial=store.read(key,null);check(initial&&initial.workerId===workerId&&equal(initial.claimToken,claimToken),'Work claim not found',404);const message=text(body.message??'',500,'worker result message',true);let catalog,verified,confirmation;
 if(body.state==='ready'){check(body.kind==='lookup'&&body.result===undefined,'Invalid lookup result');catalog=await normalizeCatalog(body.catalog,initial.projectPageId);}
 else if(body.state==='created_verified'){check(body.kind==='request'&&body.catalog===undefined,'Invalid PO result');({verified,confirmation}=normalizedVerifiedResult(body.result,initial));}
 else{check(body.state==='needs_review'&&body.catalog===undefined&&body.result===undefined,'Invalid worker result');check(message,'Provide a review message');}
 const outcomeHash=await digest(canonical({state:body.state,message,...(catalog?{catalog:{...catalog,updatedAt:null}}:{}),...(verified?{result:verified}:{})}));let final;
 store.ctx.storage.transactionSync(()=>{
  const current=store.read(key,null);check(current&&current.workerId===workerId&&equal(current.claimToken,claimToken),'Work claim not found',404);if(current.state!=='processing'){check(current.outcomeHash===outcomeHash,'This work item already has a different result',409);final=current;return;}
  final={...current,state:body.state,message:message||(body.state==='ready'?'Nexvia choices refreshed.':'Purchase order created and verified in Nexvia.'),outcomeHash,completedAt:new Date().toISOString(),...(verified?{result:verified}:{})};
  if(catalog){store.write(catalogKey(current.projectPageId),catalog);if(store.read(catalogFailureKey(current.projectPageId),null))store.write(catalogFailureKey(current.projectPageId),null);publishSharedSource(store,catalog);}
  else if(body.kind==='lookup'&&body.state==='needs_review'){
   const collectedAt=Date.parse(current.collectedAt),updatedAt=Date.parse(store.read(catalogKey(current.projectPageId),null)?.updatedAt);
   // A late failure from an older in-flight read must not invalidate a newer
   // successfully published snapshot. Terminal replays return above unchanged.
   if(!Number.isFinite(collectedAt)||!Number.isFinite(updatedAt)||collectedAt>=updatedAt)store.write(catalogFailureKey(current.projectPageId),{lookupId:id,failedAt:final.completedAt});
  }
  store.write(key,final);store.write(WORK,store.read(WORK,[]).filter(item=>item.id!==id||item.kind!==body.kind));store.audit('nexvia-request-worker','purchase-request-'+body.state,{id,kind:body.kind,...(verified?{purchaseOrderNumber:verified.purchaseOrderNumber}:{})});
 });
 // Enqueue outside the result transaction. A terminal-result replay always repairs
 // a missing confirmation after an interrupted write, using the exact same key.
 if(confirmation){enqueueNexviaConfirmation(store,confirmation,'nexvia-request-worker');if(store.processNexviaConfirmationEmailQueue)store.ctx.waitUntil(store.processNexviaConfirmationEmailQueue().catch(()=>{}));}
 return result(body.kind==='lookup'?lookupReply(store,final):{request:publicRequest(store,final)});
}
export async function handleNexviaRequestWorker(store,path,method,body,token){machineAuth(store,token);check(method==='POST','Method not allowed',405);if(path==='/integrations/nexvia/request-work')return claimWork(store,body);check(path==='/integrations/nexvia/request-results','Not found',404);return finishWork(store,body);}

// Called inside the existing account-rename transaction, while both account rows
// retain the same immutable creation timestamp. Reused usernames never match it.
export function renamePurchaseRequestOwner(store,from,to){
 const generation=accountGeneration(store,from);check(accountGeneration(store,to)===generation,'Purchase request account identity changed',409);
 for(const [indexFor,keyFor] of [[ownerIndex,requestKey],[lookupOwnerIndex,lookupKey]]){
  const sourceKey=indexFor(from,generation),targetKey=indexFor(to,generation),ids=store.read(sourceKey,[]);if(!ids.length)continue;
  const migrated=[];for(const id of ids){const record=store.read(keyFor(id),null);if(record?.submittedBy===from&&record.ownerCreatedAt===generation){store.write(keyFor(id),{...record,submittedBy:to});migrated.push(id);}}
  if(migrated.length)store.write(targetKey,[...new Set([...store.read(targetKey,[]),...migrated])]);store.write(sourceKey,[]);
 }
}
