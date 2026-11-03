import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../templates/safety-audit-upload-store.js',import.meta.url),'utf8');
function harness(available=true){
 const timers=new Map(),opens=[],transactions=[],writes=[];let serial=0,closed=0,aborted=0;
 const db={objectStoreNames:{contains:()=>true},close(){closed++},transaction(table,mode){
  const tx={table,mode,error:null,abort(){aborted++},objectStore(){return {
   get(key){const request={};tx.read={key,request};return request;},
   openCursor(){const request={};tx.cursor={request};return request;},
   put(value,key){const request={};writes.push({operation:'write',value,key,request});return request;},
   delete(key){const request={};writes.push({operation:'remove',key,request});return request;}
  }}};transactions.push(tx);return tx;
 }};
 const context=vm.createContext({setTimeout:(callback,ms)=>{const id=++serial;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),...(available?{indexedDB:{open(name,version){const request={};opens.push({name,version,request});return request;}}}:{})});
 vm.runInContext(source,context);
 const h={api:vm.runInContext('auditUploadStore',context),opens,transactions,writes,timers,db,get closed(){return closed},get aborted(){return aborted}};
 h.connected=async()=>{const request=opens.at(-1).request;request.result=db;request.onsuccess();await Promise.resolve();return transactions.at(-1);};
 h.readResult=(tx,value)=>{tx.read.request.result=value;tx.read.request.onsuccess();};
 h.fireTimer=ms=>{const timer=[...timers.values()].find(item=>item.ms===ms);assert.ok(timer,'Expected storage timer');timer.callback();};
 return h;
}

test('audit photo writes resolve only after transaction commit and keep separate account/audit keys',async()=>{
 const h=harness(),value={entries:[{queueId:'photo-one',data:'captured-image'}],pending:{mutationId:'same-on-retry'}};
 let settled=false;const saving=h.api.write('first-user','audit-one',value).then(result=>{settled=true;return result;});
 const tx=await h.connected();assert.equal(tx.mode,'readwrite');assert.deepEqual(Array.from(tx.read.key),['first-user','audit-one']);
 h.readResult(tx,undefined);const write=h.writes[0];assert.equal(write.value.revision,1);assert.equal(write.value.value,value);
 write.request.onsuccess?.();await Promise.resolve();assert.equal(settled,false,'Request success is not a committed transaction');assert.equal(h.closed,0);
 tx.oncomplete();assert.equal(await saving,1);assert.equal(h.closed,1);assert.equal(h.timers.size,0);
 const reading=h.api.read('second-user','audit-one'),readTx=await h.connected();assert.equal(readTx.mode,'readonly');assert.deepEqual(Array.from(readTx.read.key),['second-user','audit-one']);h.readResult(readTx,undefined);readTx.oncomplete();assert.equal(await reading,null);
});

test('successful photo requests still reject if the containing transaction aborts or exhausts storage',async()=>{
 const h=harness(),saving=h.api.write('user','audit',{entries:['photo']},3),tx=await h.connected();
 h.readResult(tx,{revision:3,value:{entries:[]}});h.writes[0].request.onsuccess?.();
 const quota=Object.assign(Error('Disk full'),{name:'QuotaExceededError'});tx.error=quota;tx.onabort();
 await assert.rejects(saving,error=>error.auditPhotoStorage&&/enough space/.test(error.message));assert.equal(h.closed,1);assert.equal(h.timers.size,0);
});

test('stale photo writes and removals cannot overwrite another tab',async()=>{
 for(const operation of ['write','remove']){
  const h=harness(),changing=operation==='write'?h.api.write('user','audit',{entries:['older-photo']},1):h.api.remove('user','audit',1),tx=await h.connected();
  h.readResult(tx,{revision:2,value:{entries:['newer-photo']}});
  await assert.rejects(changing,error=>error.auditPhotoStorage&&error.auditPhotoConflict&&/another tab/.test(error.message));
  assert.equal(h.writes.length,0);assert.equal(h.aborted,1);assert.equal(h.closed,1);assert.equal(h.timers.size,0);
 }
 const h=harness();await assert.rejects(h.api.remove('user','audit'),/Reopen this audit/);assert.equal(h.opens.length,0,'Deletion requires an explicit expected revision');
});

test('reads and removals wait for the transaction and preserve the stored revision envelope',async()=>{
 const h=harness(),value={revision:8,value:{entries:['camera-photo'],pending:{mutationId:'upload'}}},reading=h.api.read('user','audit'),readTx=await h.connected();
 h.readResult(readTx,value);readTx.oncomplete();assert.equal(await reading,value);
 let removed=false;const removing=h.api.remove('user','audit',8).then(result=>{removed=true;return result;}),removeTx=await h.connected();
 h.readResult(removeTx,value);assert.equal(h.writes[0].operation,'remove');assert.deepEqual(Array.from(h.writes[0].key),['user','audit']);
 await Promise.resolve();assert.equal(removed,false);removeTx.oncomplete();assert.equal(await removing,true);assert.equal(h.closed,2);
});

test('blocked and timed-out database opens fail clearly and close any late connection',async()=>{
 for(const trigger of ['blocked','timeout']){
  const h=harness(),reading=h.api.read('user','audit'),request=h.opens[0].request;
  if(trigger==='blocked')request.onblocked();else h.fireTimer(10000);
  await assert.rejects(reading,error=>error.auditPhotoStorage&&/storage/.test(error.message));
  request.result=h.db;request.onsuccess();assert.equal(h.closed,1);assert.equal(h.transactions.length,0);assert.equal(h.timers.size,0);
 }
 const missing=harness(false);await assert.rejects(missing.api.write('user','audit',{}),error=>error.auditPhotoStorage&&/unavailable/.test(error.message));assert.equal(missing.timers.size,0);
});

test('photo storage request failures and stalled transactions cannot report a successful save',async()=>{
 const h=harness(),saving=h.api.write('user','audit',{entries:['photo']}),tx=await h.connected();h.readResult(tx,undefined);
 h.writes[0].request.error=Object.assign(Error('Too large'),{name:'QuotaExceededError'});h.writes[0].request.onerror();tx.onabort();
 await assert.rejects(saving,/enough space/);assert.equal(h.closed,1);
 const stalled=harness(),reading=stalled.api.read('user','audit'),readTx=await stalled.connected();stalled.fireTimer(30000);
 await assert.rejects(reading,error=>error.auditPhotoStorage);assert.equal(stalled.aborted,1);assert.equal(stalled.closed,1);readTx.oncomplete();assert.equal(stalled.timers.size,0);
});

test('pending audit discovery lists only the signed-in account metadata after its read transaction completes',async()=>{
 const h=harness();let settled=false,continued=0;
 const listing=h.api.list('owner').then(rows=>{settled=true;return rows;}),tx=await h.connected();assert.equal(tx.mode,'readonly');
 const emit=(key,value)=>{tx.cursor.request.result={key,value,continue(){continued++}};tx.cursor.request.onsuccess();};
 emit(['owner','audit-one'],{revision:3,value:{record:{id:'audit-one',createdBy:'owner',documentNo:'LF-MA-0001',area:'Factory',date:'2026-11-03'},uploads:[{data:'private photo bytes'}],pending:{mutationId:'private mutation'}}});
 tx.cursor.request.result={key:['other','audit-two'],get value(){throw Error('Other account data must not be accessed');},continue(){continued++}};tx.cursor.request.onsuccess();
 emit(['owner','audit-three'],{revision:1,value:{record:{id:'audit-three',createdBy:'other'},uploads:[{data:'wrong owner'}]}});
 emit(['owner','audit-four'],{revision:2,value:{record:{id:'audit-four',createdBy:'owner'},uploads:[]}});
 emit(['owner','audit-five'],{revision:1,value:{record:{id:'audit-five',createdBy:'owner'},uploads:[],uploadPending:{body:{action:'delete'}}}});
 tx.cursor.request.result=null;tx.cursor.request.onsuccess();await Promise.resolve();assert.equal(settled,false);assert.equal(continued,5);assert.equal(h.writes.length,0);
 tx.oncomplete();assert.deepEqual(JSON.parse(JSON.stringify(await listing)),[{id:'audit-one',documentNo:'LF-MA-0001',area:'Factory',date:'2026-11-03'},{id:'audit-five',documentNo:'',area:'',date:''}]);assert.equal(h.closed,1);assert.equal(h.timers.size,0);
 const invalid=harness();await assert.rejects(invalid.api.list(''),error=>error.auditPhotoStorage);assert.equal(invalid.opens.length,0);
});
