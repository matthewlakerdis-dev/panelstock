import {equal,requireCondition as check} from './security.js';

const ROOT='purchase-request:quote-transfer:',REGISTRY=ROOT+'registry',R2_PREFIX='nexvia-quote-transfers/';
const TTL_MS=24*3600000,MAX_BYTES=10*1024*1024,MAX_ITEMS=5000,MAX_BATCH=25,RETRY_MS=5*60000,LEASE_MS=60000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const itemId=ref=>ref.requestId+':'+ref.sha256,itemKey=id=>ROOT+'item:'+id;
const writable=store=>check(store.env.READ_ONLY!=='true','Supplier quote transfer is paused for maintenance',503);
const bytesHash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
const alarmStates=new WeakMap();

function reference(value){
 check(object(value)&&Object.keys(value).every(key=>['version','requestId','key','sha256','bytes','expiresAt'].includes(key)),'Invalid quote transfer reference');
 check(value.version===1&&typeof value.requestId==='string'&&UUID.test(value.requestId)&&typeof value.sha256==='string'&&HASH.test(value.sha256),'Invalid quote transfer identity');
 check(value.key===R2_PREFIX+value.requestId+'/'+value.sha256+'.pdf'&&Number.isSafeInteger(value.bytes)&&value.bytes>=5&&value.bytes<=MAX_BYTES,'Invalid quote transfer file');
 check(typeof value.expiresAt==='string'&&Number.isFinite(Date.parse(value.expiresAt))&&new Date(value.expiresAt).toISOString()===value.expiresAt,'Invalid quote transfer expiry');
 return {version:1,requestId:value.requestId,key:value.key,sha256:value.sha256,bytes:value.bytes,expiresAt:value.expiresAt};
}
const same=(left,right)=>JSON.stringify(reference(left))===JSON.stringify(reference(right));
function registry(store){
 const rows=store.read(REGISTRY,[]);check(Array.isArray(rows)&&rows.length<=MAX_ITEMS,'Quote transfer registry is unavailable',503);
 const seen=new Set();for(const row of rows){check(object(row)&&typeof row.id==='string'&&row.id.length===101&&UUID.test(row.id.slice(0,36))&&row.id[36]===':'&&HASH.test(row.id.slice(37))&&!seen.has(row.id)&&(row.nextAt===null||Number.isFinite(row.nextAt)&&row.nextAt>=0),'Quote transfer registry is unavailable',503);seen.add(row.id);}
 return rows;
}
function scheduleCleanup(store){
 const storage=store.ctx.storage;if(typeof storage.getAlarm!=='function'||typeof storage.setAlarm!=='function')return;
 let state=alarmStates.get(store);if(state){state.dirty=true;return;}
 state={dirty:true};alarmStates.set(store,state);
 // Defer storage APIs until after the caller's synchronous transaction. A
 // single coalesced task always rereads the latest schedule before setting it.
 const task=Promise.resolve().then(async()=>{
  do{
   state.dirty=false;const existing=await storage.getAlarm(),times=registry(store).map(row=>row.nextAt).filter(value=>value!==null);
   if(!times.length)continue;
   const target=Math.max(Date.now()+1000,Math.min(...times));
   if(existing===null||existing===undefined||existing>target)await storage.setAlarm(target);
  }while(state.dirty);
 }).catch(()=>{state.dirty=false;}).finally(()=>{alarmStates.delete(store);if(state.dirty)scheduleCleanup(store);});
 if(typeof store.ctx.waitUntil==='function')store.ctx.waitUntil(task);
}
function saveItem(store,item,nextAt){
 const id=itemId(item.ref),rows=registry(store),index=rows.findIndex(row=>row.id===id);
 check(index>=0,'Quote transfer is not registered',409);rows[index]={id,nextAt};
 store.write(itemKey(id),{...item,nextAt});store.write(REGISTRY,rows);scheduleCleanup(store);
}
function currentItem(store,ref){
 const item=store.read(itemKey(itemId(ref)),null);check(item&&same(item.ref,ref),'Quote transfer reference changed or is unavailable',409);return item;
}
function savedRecord(store,ref){
 const record=store.read('purchase-request:record:'+ref.requestId,null);
 if(!record?.quoteFile)return null;
 try{return same(record.quoteFile,ref)?record:null;}catch{return null;}
}
const claimed=record=>!!(record.workerId||record.claimToken);
const purgeable=(record,ref,now)=>record.state==='cancelled'||record.quoteTransfer?.state==='attached'||record.quoteTransfer?.state==='cancelled'||Date.parse(ref.expiresAt)<=now;
function expireRecord(store,ref,record,now){
 if(Date.parse(ref.expiresAt)>now||record.quoteTransfer?.version!==1||['attached','cancelled'].includes(record.quoteTransfer.state))return false;
 let saved={...record,quoteTransfer:{...record.quoteTransfer,state:'expired'}},changed=record.quoteTransfer.state!=='expired';
 if(record.state==='queued'&&!claimed(record)){
  saved={...saved,state:'needs_review',message:'The supplier quote expired before the Nexvia worker collected it. Upload the quote again for review.'};changed=true;
  store.write('purchase-request:work',store.read('purchase-request:work',[]).filter(work=>work.kind!=='request'||work.id!==ref.requestId));
 }
 if(changed)store.write('purchase-request:record:'+ref.requestId,saved);
 return changed;
}

export async function stageQuoteTransfer(store,requestId,bytes,sha256){
 writable(store);check(typeof requestId==='string'&&UUID.test(requestId),'Invalid quote request ID');check(bytes instanceof Uint8Array&&bytes.length>=5&&bytes.length<=MAX_BYTES&&String.fromCharCode(...bytes.subarray(0,5))==='%PDF-','Choose a quote PDF no larger than10 MB');check(typeof sha256==='string'&&HASH.test(sha256)&&equal(await bytesHash(bytes),sha256),'Quote PDF hash does not match its contents');
 check(store.env.CAD_PROJECT_FILES,'Quote storage is unavailable',503);let ref;
 // Register before storage. Even a lost put acknowledgement leaves a bounded,
 // expiring private ledger entry instead of an untracked temporary object.
 store.ctx.storage.transactionSync(()=>{
  writable(store);const id=requestId+':'+sha256,rows=registry(store),previous=store.read(itemKey(id),null);
  if(previous){
   ref=reference(previous.ref);check(ref.bytes===bytes.length,'Quote transfer file changed',409);check(previous.status!=='deleting','Quote cleanup is in progress; retry this upload',503);
   check(Date.parse(ref.expiresAt)>Date.now(),'The temporary quote has expired; start a new request',409);
   check(Number.isSafeInteger(previous.uploadsInFlight??0)&&(previous.uploadsInFlight??0)>=0&&(previous.uploadsInFlight??0)<MAX_ITEMS,'Quote uploads are busy; retry later',503);
   if(previous.status==='deleted'||previous.status==='delete_pending'){
    check(!savedRecord(store,ref),'The saved quote can no longer be replaced',409);saveItem(store,{ref,status:'staging',attempts:previous.attempts||0,uploadsInFlight:(previous.uploadsInFlight||0)+1},Date.parse(ref.expiresAt));
   }else saveItem(store,{...previous,uploadsInFlight:(previous.uploadsInFlight||0)+1},previous.nextAt);
   return;
  }
  if(rows.length>=MAX_ITEMS){const tombstone=rows.findIndex(row=>{if(row.nextAt!==null)return false;const old=store.read(itemKey(row.id),null);return old?.status==='deleted'&&!(old.uploadsInFlight>0);});check(tombstone>=0,'Quote transfer storage is full; retry after cleanup',503);store.write(itemKey(rows[tombstone].id),null);rows.splice(tombstone,1);}
  ref={version:1,requestId,key:R2_PREFIX+requestId+'/'+sha256+'.pdf',sha256,bytes:bytes.length,expiresAt:new Date(Date.now()+TTL_MS).toISOString()};
  const nextAt=Date.parse(ref.expiresAt);store.write(itemKey(id),{ref,status:'staging',attempts:0,uploadsInFlight:1,nextAt});store.write(REGISTRY,[...rows,{id,nextAt}]);scheduleCleanup(store);
 });
 let putError;try{await store.env.CAD_PROJECT_FILES.put(ref.key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/pdf'}});}catch(error){putError=error;}
 let cleanupPending=false,expired=false;
 store.ctx.storage.transactionSync(()=>{
  const item=currentItem(store,ref),uploadsInFlight=Math.max(0,(item.uploadsInFlight||0)-1);
  // A slower identical put can finish after another caller discarded and
  // cleaned the object. Re-arm it even when the put acknowledgement was lost.
  expired=Date.parse(ref.expiresAt)<=Date.now();
  if(expired&&item.status!=='deleting'){
   const record=savedRecord(store,ref);if(record&&store.env.READ_ONLY!=='true')expireRecord(store,ref,record,Date.now());
   saveItem(store,{...item,status:'delete_pending',reason:'expired',uploadsInFlight},0);cleanupPending=true;
  }
  else if(item.status==='deleted'){saveItem(store,{...item,status:'delete_pending',reason:'aborted',uploadsInFlight},0);cleanupPending=true;}
  else if(item.status==='deleting'){saveItem(store,{...item,uploadsInFlight,latePut:true},item.nextAt);cleanupPending=true;}
  else saveItem(store,{...item,uploadsInFlight},item.nextAt);
 });
 if(putError)throw putError;
 writable(store);check(!expired,'The temporary quote expired during upload; start a new request',409);check(!cleanupPending,'Quote cleanup changed this upload; retry',503);
 return {...ref};
}

// Parent writes quoteFile + quoteTransfer first, then retains in the same save
// transaction. A cleanup lease blocks a save while deletion is in flight.
export function retainQuoteTransfer(store,value){
 writable(store);const ref=reference(value),item=currentItem(store,ref),record=savedRecord(store,ref);
 check(record?.quoteTransfer?.version===1,'Save the matching quote request before retaining its file',409);
 check(!['deleting','deleted'].includes(item.status),'Quote cleanup is in progress; retry this save',503);
 check(Date.parse(ref.expiresAt)>Date.now(),'The temporary quote expired before it was saved',409);
 check(item.status!=='delete_pending'||item.reason==='aborted','The quote is already queued for removal',409);
 saveItem(store,{...item,status:'retained'},Date.parse(ref.expiresAt));return {...ref};
}

export function queueQuoteTransferDelete(store,value,reason){
 writable(store);const ref=reference(value),id=itemId(ref),item=store.read(itemKey(id),null);if(!item)return false;
 check(same(item.ref,ref),'Quote transfer reference changed',409);check(['aborted','cancelled','attached','expired'].includes(reason),'Invalid quote cleanup reason');
 if(item.status==='deleted'||item.status==='deleting')return false;
 const record=savedRecord(store,ref),now=Date.now();if(record&&!purgeable(record,ref,now)){saveItem(store,{...item,status:'retained'},Date.parse(ref.expiresAt));return false;}
 if(record)expireRecord(store,ref,record,now);
 if(item.status==='delete_pending')return false;
 saveItem(store,{...item,status:'delete_pending',reason},0);return true;
}

export function discardQuoteTransfer(store,value,reason='aborted'){
 const ref=reference(value);if(savedRecord(store,ref))return false;
 return queueQuoteTransferDelete(store,ref,reason);
}

export async function processQuoteTransferCleanup(store,now=Date.now(),limit=MAX_BATCH){
 check(Number.isFinite(now)&&now>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=MAX_BATCH,'Invalid quote cleanup bounds');
 const counts={processed:0,deleted:0,held:0,expired:0,failed:0};if(store.env.READ_ONLY==='true'||!store.env.CAD_PROJECT_FILES)return counts;
 const due=registry(store).filter(row=>row.nextAt!==null&&row.nextAt<=now).sort((a,b)=>a.nextAt-b.nextAt).slice(0,limit);
 for(const entry of due){
  let deleting=null;
  store.ctx.storage.transactionSync(()=>{
   if(store.env.READ_ONLY==='true')return;
   const item=store.read(itemKey(entry.id),null);if(!item||item.status==='deleted'&&!(item.uploadsInFlight>0)||item.nextAt>now)return;
   const ref=reference(item.ref);check(itemId(ref)===entry.id,'Quote cleanup identity mismatch',409);counts.processed++;
   const record=savedRecord(store,ref);
   if(record&&expireRecord(store,ref,record,now))counts.expired++;
   if(record&&!purgeable(record,ref,now)){saveItem(store,{...item,status:'retained',leaseUntil:0},Date.parse(ref.expiresAt));counts.held++;return;}
   if(!record&&item.status!=='delete_pending'&&item.status!=='deleting'&&Date.parse(ref.expiresAt)>now){saveItem(store,item,Date.parse(ref.expiresAt));return;}
   deleting={...item,status:'deleting',attempts:(item.attempts||0)+1,latePut:false,cleanupId:crypto.randomUUID(),leaseUntil:now+LEASE_MS};saveItem(store,deleting,now+RETRY_MS);
  });
  if(!deleting)continue;
  let failed=false;try{await store.env.CAD_PROJECT_FILES.delete(deleting.ref.key);}catch{failed=true;}
  store.ctx.storage.transactionSync(()=>{
   const current=store.read(itemKey(entry.id),null);if(current?.status!=='deleting'||current.cleanupId!==deleting.cleanupId)return;
   if(failed){saveItem(store,{...current,status:'delete_pending',reason:current.reason||'expired',error:'Temporary quote cleanup will retry.'},now+RETRY_MS);counts.failed++;}
   else{saveItem(store,{...current,status:current.latePut?'delete_pending':'deleted',...(current.latePut?{reason:'aborted'}:{})},current.latePut?0:current.uploadsInFlight>0?now+RETRY_MS:null);counts.deleted++;}
  });
 }
 scheduleCleanup(store);
 return counts;
}
