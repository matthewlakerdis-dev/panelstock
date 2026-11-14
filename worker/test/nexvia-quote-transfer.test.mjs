import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stageQuoteTransfer,retainQuoteTransfer,discardQuoteTransfer,queueQuoteTransferDelete,processQuoteTransferCleanup} from '../src/nexvia-quote-transfer.js';

const ID='35fc4244-267c-42c6-885c-6ab93a55b899',OTHER='22be921c-f1c9-4ba5-a212-5c2e91f43cca',ROOT='purchase-request:quote-transfer:',TTL=24*3600000;
const bytes=()=>new TextEncoder().encode('%PDF-1.7\nOriginal supplier quote\n%%EOF');
const hash=value=>createHash('sha256').update(value).digest('hex');
const itemKey=ref=>ROOT+'item:'+ref.requestId+':'+ref.sha256;
function fixture(){
 const docs=new Map(),files=new Map(),deleted=[],puts=[];
 const store={env:{CAD_PROJECT_FILES:{put:async(key,value,options)=>{puts.push({key,options});if(options?.onlyIf&&files.has(key))return null;files.set(key,value.slice());return {};},delete:async key=>{deleted.push(key);files.delete(key);}}},read:(key,fallback=null)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>{assert.ok(key.startsWith(ROOT)||key.startsWith('purchase-request:record:')||key==='purchase-request:work','must not mutate unrelated state');docs.set(key,structuredClone(value));},ctx:{storage:{transactionSync(fn){const before=structuredClone([...docs]);try{return fn();}catch(error){docs.clear();for(const [key,value] of before)docs.set(key,value);throw error;}}}}};
 return {store,docs,files,deleted,puts};
}
async function staged(f,id=ID){const pdf=bytes();return stageQuoteTransfer(f.store,id,pdf,hash(pdf));}
function saved(f,ref,changes={}){
 const record={id:ref.requestId,state:'queued',quote:{filename:'supplier.pdf',bytes:ref.bytes},quoteFile:ref,quoteTransfer:{version:1,state:'pending',expiresAt:ref.expiresAt},...changes};
 f.store.ctx.storage.transactionSync(()=>{f.store.write('purchase-request:record:'+ref.requestId,record);retainQuoteTransfer(f.store,ref);});return record;
}
const status=code=>error=>error.status===code;

test('temporary quotes register before storage, retain immutable expiry and clean up unused or lost-ack objects',async t=>{
 const now=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});const f=fixture(),put=f.store.env.CAD_PROJECT_FILES.put;
 f.store.env.CAD_PROJECT_FILES.put=async(...args)=>{assert.equal(f.docs.get(ROOT+'registry').length,1);return put(...args);};const ref=await staged(f);
 assert.deepEqual(ref,{version:1,requestId:ID,key:'nexvia-quote-transfers/'+ID+'/'+hash(bytes())+'.pdf',sha256:hash(bytes()),bytes:bytes().length,expiresAt:new Date(now+TTL).toISOString()});
 t.mock.timers.setTime(now+1000);assert.deepEqual(await staged(f),ref);assert.equal(f.docs.get(ROOT+'registry').length,1);assert.deepEqual(f.puts[0].options.onlyIf,{etagDoesNotMatch:'*'});
 assert.equal((await processQuoteTransferCleanup(f.store,now+TTL-1)).processed,0);assert.equal((await processQuoteTransferCleanup(f.store,now+TTL)).deleted,1);assert.equal(f.files.size,0);assert.equal(f.docs.get(itemKey(ref)).ref.expiresAt,ref.expiresAt);
 const lost=fixture(),lostPut=lost.store.env.CAD_PROJECT_FILES.put;lost.store.env.CAD_PROJECT_FILES.put=async(...args)=>{await lostPut(...args);throw Error('lost storage acknowledgement');};await assert.rejects(staged(lost));assert.equal(lost.files.size,1);assert.equal(lost.docs.get(ROOT+'registry').length,1);assert.equal((await processQuoteTransferCleanup(lost.store,now+1000+TTL)).deleted,1);assert.equal(lost.files.size,0);
});

test('expiry moves only an unclaimed queued quote to review and removes only its request work item',async t=>{
 const now=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});const f=fixture(),ref=await staged(f);saved(f,ref);f.docs.set('purchase-request:work',[{id:ID,kind:'request'},{id:ID,kind:'lookup'},{id:OTHER,kind:'request'}]);
 const result=await processQuoteTransferCleanup(f.store,now+TTL);assert.equal(result.expired,1);assert.equal(result.deleted,1);const record=f.docs.get('purchase-request:record:'+ID);assert.equal(record.state,'needs_review');assert.equal(record.quoteTransfer.state,'expired');assert.equal(record.quoteTransfer.expiresAt,ref.expiresAt);assert.deepEqual(f.docs.get('purchase-request:work'),[{id:ID,kind:'lookup'},{id:OTHER,kind:'request'}]);assert.equal(f.files.size,0);
});

test('all claimed quote bytes expire at the original24h deadline while state, claims, results and work remain intact',async t=>{
 const now=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});
 for(const state of ['processing','created_verified','needs_review','queued']){
  t.mock.timers.setTime(now);const f=fixture(),ref=await staged(f),record=saved(f,ref,{state,workerId:OTHER,claimToken:'private-claim',outcomeHash:'frozen-outcome',result:{purchaseOrderId:1421,purchaseOrderNumber:'PO7413'}}),before=structuredClone(record),work=[{id:ID,kind:'request'},{id:OTHER,kind:'lookup'}];f.docs.set('purchase-request:work',work);
  const generated='nexvia-po-documents/'+ID+'/1421/'+ref.sha256+'.pdf';f.files.set(generated,bytes());
  assert.equal(queueQuoteTransferDelete(f.store,ref,'aborted'),false,'an aborted upload cannot delete an active saved quote early');assert.equal(f.docs.get(itemKey(ref)).nextAt,Date.parse(ref.expiresAt));assert.equal((await processQuoteTransferCleanup(f.store,now+TTL-1)).processed,0);assert.equal(f.files.has(ref.key),true);
  t.mock.timers.setTime(now+TTL);const expired=await processQuoteTransferCleanup(f.store);assert.equal(expired.expired,1);assert.equal(expired.deleted,1);assert.equal(expired.held,0);
  assert.deepEqual(f.docs.get('purchase-request:record:'+ID),{...before,quoteTransfer:{...before.quoteTransfer,state:'expired'}});assert.deepEqual(f.docs.get('purchase-request:work'),work);assert.equal(f.files.has(ref.key),false);assert.equal(f.files.has(generated),true);assert.equal(f.docs.get(itemKey(ref)).ref.expiresAt,ref.expiresAt);assert.equal(f.docs.get(itemKey(ref)).nextAt,null);await assert.rejects(staged(f),status(409));
 }
});

test('a quote upload finishing after its original expiry is rejected and scheduled for purge without extending TTL',async t=>{
 const now=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});const f=fixture(),put=f.store.env.CAD_PROJECT_FILES.put;let release;
 f.store.env.CAD_PROJECT_FILES.put=async(...args)=>{await new Promise(resolve=>release=resolve);return put(...args);};const pending=staged(f).catch(error=>error);while(!release)await new Promise(setImmediate);t.mock.timers.setTime(now+TTL);release();assert.equal((await pending).status,409);
 const item=[...f.docs].find(([key])=>key.startsWith(ROOT+'item:'))[1];assert.equal(item.ref.expiresAt,new Date(now+TTL).toISOString());assert.equal(item.nextAt,0);assert.equal(item.status,'delete_pending');assert.equal((await processQuoteTransferCleanup(f.store)).deleted,1);assert.equal(f.files.size,0);
});

test('cancelled and confirmed attached quote references can purge without changing PO state or generated documents',async()=>{
 for(const state of ['cancelled','attached']){
  const f=fixture(),ref=await staged(f);saved(f,ref);const key='purchase-request:record:'+ID,record=f.docs.get(key);record.state=state==='cancelled'?'cancelled':'created_verified';record.quoteTransfer.state=state;record.workerId=OTHER;record.claimToken='private';f.docs.set(key,record);
  const generated='nexvia-po-documents/'+ID+'/1421/'+ref.sha256+'.pdf';f.files.set(generated,bytes());assert.equal(discardQuoteTransfer(f.store,ref),false,'discard cannot remove any saved matching reference');assert.equal(queueQuoteTransferDelete(f.store,ref,state),true);const before=structuredClone(f.docs.get(itemKey(ref)));assert.equal(queueQuoteTransferDelete(f.store,ref,state),false);assert.deepEqual(f.docs.get(itemKey(ref)),before);
  assert.equal((await processQuoteTransferCleanup(f.store)).deleted,1);assert.deepEqual(f.docs.get(key),record);assert.equal(f.files.has(generated),true);assert.deepEqual(f.deleted,[ref.key]);
 }
});

test('failed deletion is idempotent, backs off and retries without expanding the deletion prefix',async()=>{
 const f=fixture(),ref=await staged(f);assert.equal(discardQuoteTransfer(f.store,ref),true);const remove=f.store.env.CAD_PROJECT_FILES.delete;let calls=0;f.store.env.CAD_PROJECT_FILES.delete=async key=>{calls++;if(calls===1)throw Error('storage unavailable');return remove(key);};const now=Date.now();
 assert.equal((await processQuoteTransferCleanup(f.store,now)).failed,1);const pending=structuredClone(f.docs.get(itemKey(ref)));assert.equal(discardQuoteTransfer(f.store,ref),false);assert.deepEqual(f.docs.get(itemKey(ref)),pending);assert.equal((await processQuoteTransferCleanup(f.store,now+1)).processed,0);assert.equal(calls,1);
 assert.equal((await processQuoteTransferCleanup(f.store,now+5*60000)).deleted,1);assert.equal(calls,2);assert.equal((await processQuoteTransferCleanup(f.store,now+10*60000)).processed,0);assert.equal(discardQuoteTransfer(f.store,ref),false);assert.deepEqual(f.deleted,[ref.key]);
 assert.throws(()=>queueQuoteTransferDelete(f.store,{...ref,key:'nexvia-po-documents/private.pdf'},'cancelled'),status(400));
});

test('identical uploads cannot let aborted cleanup delete a retained winner, and in-flight deletion fences saves',async()=>{
 const f=fixture(),[left,right]=await Promise.all([staged(f),staged(f)]);assert.deepEqual(left,right);assert.equal(f.files.size,1);assert.equal(f.docs.get(ROOT+'registry').length,1);
 discardQuoteTransfer(f.store,left);saved(f,right);assert.equal((await processQuoteTransferCleanup(f.store)).processed,0);assert.equal(f.files.has(right.key),true);
 const orphan=fixture(),ref=await staged(orphan);discardQuoteTransfer(orphan.store,ref);let release;orphan.store.env.CAD_PROJECT_FILES.delete=key=>new Promise(resolve=>release=()=>{orphan.files.delete(key);resolve();});const cleanup=processQuoteTransferCleanup(orphan.store);
 assert.throws(()=>saved(orphan,ref),status(503));assert.equal(orphan.docs.has('purchase-request:record:'+ID),false);await assert.rejects(staged(orphan),status(503));release();await cleanup;assert.equal(orphan.files.size,0);
 const restored=await staged(orphan);assert.deepEqual(restored,ref,'retry restores identical bytes without renewing the original expiry');saved(orphan,restored);assert.equal(orphan.files.has(ref.key),true);
});

test('late identical puts and lost acknowledgements re-arm deletion after an earlier cleanup completed',async()=>{
 for(const lostAcknowledgement of [false,true]){
  const f=fixture(),put=f.store.env.CAD_PROJECT_FILES.put;let release,calls=0;f.store.env.CAD_PROJECT_FILES.put=async(...args)=>{if(++calls===1){await new Promise(resolve=>release=resolve);const result=await put(...args);if(lostAcknowledgement)throw Error('late lost acknowledgement');return result;}return put(...args);};
  const late=staged(f).catch(error=>error);while(!release)await new Promise(setImmediate);const first=await staged(f);discardQuoteTransfer(f.store,first);assert.equal((await processQuoteTransferCleanup(f.store)).deleted,1);assert.equal(f.files.size,0);
  release();const error=await late;assert.equal(error.status, lostAcknowledgement?undefined:503);assert.equal(f.files.size,1);assert.equal(f.docs.get(itemKey(first)).status,'delete_pending');assert.equal(f.docs.get(itemKey(first)).nextAt,0);
  assert.equal((await processQuoteTransferCleanup(f.store,Date.now()+48*3600000)).deleted,1);assert.equal(f.files.size,0);
 }
});

test('an unsettled upload ledger cannot be evicted at registry capacity after cleanup deletes its current object',async()=>{
 const f=fixture(),put=f.store.env.CAD_PROJECT_FILES.put;let release,calls=0;f.store.env.CAD_PROJECT_FILES.put=async(...args)=>{if(++calls===1)await new Promise(resolve=>release=resolve);return put(...args);};
 const late=staged(f).catch(error=>error);while(!release)await new Promise(setImmediate);const ref=await staged(f);discardQuoteTransfer(f.store,ref);await processQuoteTransferCleanup(f.store);assert.equal(f.docs.get(itemKey(ref)).uploadsInFlight,1);assert.notEqual(f.docs.get(itemKey(ref)).nextAt,null);
 const index=f.docs.get(ROOT+'registry'),sha=hash(bytes());f.docs.set(ROOT+'registry',[...index,...Array.from({length:4999},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0')+':'+sha,nextAt:Date.now()+TTL}))]);
 await assert.rejects(staged(f,OTHER),status(503));assert.equal(f.docs.get(itemKey(ref)).uploadsInFlight,1);assert.equal(f.docs.get(ROOT+'registry').length,5000);
 release();assert.equal((await late).status,503);assert.equal(f.docs.get(itemKey(ref)).uploadsInFlight,0);assert.equal(f.docs.get(itemKey(ref)).nextAt,0);assert.equal((await processQuoteTransferCleanup(f.store)).deleted,1);assert.equal(f.files.size,0);
});

test('a put finishing during a delayed delete acknowledgement remains scheduled for another bounded purge',async()=>{
 const f=fixture(),put=f.store.env.CAD_PROJECT_FILES.put;let releasePut,releaseDelete,calls=0;f.store.env.CAD_PROJECT_FILES.put=async(...args)=>{if(++calls===1)await new Promise(resolve=>releasePut=resolve);return put(...args);};
 const late=staged(f).catch(error=>error);while(!releasePut)await new Promise(setImmediate);const ref=await staged(f);discardQuoteTransfer(f.store,ref);f.store.env.CAD_PROJECT_FILES.delete=async key=>{f.files.delete(key);await new Promise(resolve=>releaseDelete=resolve);};
 const cleaning=processQuoteTransferCleanup(f.store);assert.ok(releaseDelete);releasePut();assert.equal((await late).status,503);assert.equal(f.files.size,1);releaseDelete();await cleaning;assert.equal(f.docs.get(itemKey(ref)).status,'delete_pending');assert.equal(f.docs.get(itemKey(ref)).nextAt,0);
 f.store.env.CAD_PROJECT_FILES.delete=async key=>f.files.delete(key);await processQuoteTransferCleanup(f.store);assert.equal(f.files.size,0);
});

test('cleanup caps reads and delete attempts per batch, and the private registry rejects overflow',async t=>{
 const now=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});const f=fixture();
 for(let i=0;i<27;i++)await staged(f,'00000000-0000-4000-8000-'+String(i).padStart(12,'0'));
 let itemReads=0;const read=f.store.read;f.store.read=(key,fallback)=>{if(key.startsWith(ROOT+'item:'))itemReads++;return read(key,fallback);};const result=await processQuoteTransferCleanup(f.store,now+TTL);assert.equal(result.processed,25);assert.equal(result.deleted,25);assert.equal(f.deleted.length,25);assert.ok(itemReads<=50);assert.equal((await processQuoteTransferCleanup(f.store,now+TTL)).deleted,2);
 const full=fixture(),sha=hash(bytes());full.docs.set(ROOT+'registry',Array.from({length:5000},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0')+':'+sha,nextAt:now+TTL})));await assert.rejects(staged(full),status(503));assert.equal(full.puts.length,0);assert.equal(full.docs.get(ROOT+'registry').length,5000);
});

test('invalid content and maintenance cannot stage or delete transfers',async()=>{
 const f=fixture(),pdf=bytes();await assert.rejects(stageQuoteTransfer(f.store,'bad',pdf,hash(pdf)),status(400));await assert.rejects(stageQuoteTransfer(f.store,ID,pdf,'0'.repeat(64)),status(400));await assert.rejects(stageQuoteTransfer(f.store,ID,new Uint8Array(10*1024*1024+1),'0'.repeat(64)),status(400));assert.equal(f.puts.length,0);assert.equal(f.docs.size,0);
 const ref=await staged(f);discardQuoteTransfer(f.store,ref);const before=structuredClone([...f.docs]);f.store.env.READ_ONLY='true';await assert.rejects(staged(f),status(503));assert.deepEqual(await processQuoteTransferCleanup(f.store),{processed:0,deleted:0,held:0,expired:0,failed:0});assert.deepEqual([...f.docs],before);assert.equal(f.files.has(ref.key),true);
});

test('private alarms preserve earlier schedules and rapidly drain bounded cleanup batches',async t=>{
 const now=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});const f=fixture(),tasks=[],alarms=[];let alarm=null;
 f.store.ctx.waitUntil=task=>tasks.push(task);f.store.ctx.storage.getAlarm=async()=>alarm;f.store.ctx.storage.setAlarm=async value=>{alarm=value;alarms.push(value);};const flush=async()=>{while(tasks.length)await Promise.all(tasks.splice(0));};
 const first=await staged(f);await flush();assert.equal(alarm,now+TTL);const second=await staged(f,OTHER);await flush();assert.equal(alarms.length,1,'a later/equal expiry does not push the existing alarm out');
 discardQuoteTransfer(f.store,first);discardQuoteTransfer(f.store,second);await flush();assert.equal(alarm,now+1000);
 alarm=null;assert.equal((await processQuoteTransferCleanup(f.store,now,1)).deleted,1);await flush();assert.equal(alarm,now+1000,'remaining due work gets another short alarm rather than a cron-sized backlog');
 alarm=null;assert.equal((await processQuoteTransferCleanup(f.store,now,1)).deleted,1);await flush();assert.equal(alarm,null,'no active transfers need another alarm');
 const failing=fixture(),pending=[];failing.store.ctx.waitUntil=task=>pending.push(task);failing.store.ctx.storage.getAlarm=async()=>{throw Error('alarm unavailable');};failing.store.ctx.storage.setAlarm=async()=>assert.fail('failed alarm reads must use cron fallback');assert.ok(await staged(failing));await Promise.all(pending);
});

test('an earlier cleanup mutation during alarm completion is rescheduled instead of lost',async t=>{
 const now=Date.parse('2026-11-14T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});const f=fixture(),tasks=[];let alarm=null,ref,mutated=false;
 f.store.ctx.waitUntil=task=>tasks.push(task);f.store.ctx.storage.getAlarm=async()=>alarm;
 f.store.ctx.storage.setAlarm=value=>{alarm=value;if(!mutated)queueMicrotask(()=>queueMicrotask(()=>{mutated=true;discardQuoteTransfer(f.store,ref);}));return Promise.resolve();};
 ref=await staged(f);while(tasks.length)await Promise.all(tasks.splice(0));assert.equal(mutated,true);assert.equal(f.docs.get(itemKey(ref)).nextAt,0);assert.equal(alarm,now+1000);
});
