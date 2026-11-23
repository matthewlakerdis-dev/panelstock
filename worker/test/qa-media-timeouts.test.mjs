import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getEventListeners} from 'node:events';
import {qaJsonResponse,readQaPhoto} from '../src/qa-media.js';

const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const bytes=new TextEncoder().encode(photo);
const reference=value=>'qa-r2:v1:'+createHash('sha256').update(value).digest('hex')+':'+Buffer.byteLength(value);
const ref=reference(photo),store=bucket=>({env:{SITE_ID:'qa-timeout-test',CAD_PROJECT_FILES:bucket}});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const unavailable=error=>error.status===503&&/took too long/.test(error.message);
async function prompt(promise){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Cancellation did not settle promptly')),1000);})]);}finally{clearTimeout(timer);}
}
function trackedTimers(t){
 const active=new Set(),set=globalThis.setTimeout,clear=globalThis.clearTimeout;
 t.mock.method(globalThis,'setTimeout',(...args)=>{const timer=set(...args);active.add(timer);return timer;});
 t.mock.method(globalThis,'clearTimeout',timer=>{active.delete(timer);return clear(timer);});
 return active;
}

test('a stalled R2 get errors the JSON stream once and cancels a late body',async t=>{
 t.mock.method(console,'error',()=>{});
 const get=deferred(),phases=[];let cancels=0;
 const response=qaJsonResponse(store({get:()=>get.promise}),{photo:ref},200,{evidenceTimeoutMs:15,onStreamEvent:phase=>phases.push(phase)});
 await assert.rejects(response.text(),unavailable);assert.deepEqual(phases,[2,5]);
 get.resolve({size:bytes.length,body:new ReadableStream({cancel(){cancels++;}})});
 await turn();assert.equal(cancels,1);assert.deepEqual(phases,[2,5]);
});

test('a stalled R2 body read fails without a successful truncated JSON response',async t=>{
 t.mock.method(console,'error',()=>{});
 const phases=[];let cancels=0;
 const bucket={get:async()=>({size:bytes.length,body:new ReadableStream({pull(){},cancel(){cancels++;}},{highWaterMark:0})})};
 await assert.rejects(qaJsonResponse(store(bucket),{photo:ref},200,{evidenceTimeoutMs:15,onStreamEvent:phase=>phases.push(phase)}).json(),unavailable);
 assert.equal(cancels,1);assert.deepEqual(phases,[2,5]);
});

test('cancel wakes a pending R2 get immediately and disposes its late result',async()=>{
 const get=deferred(),started=deferred(),phases=[];let cancels=0;
 const response=qaJsonResponse(store({get(){started.resolve();return get.promise;}}),{photo:ref},200,{onStreamEvent:phase=>phases.push(phase)});
 const reader=response.body.getReader(),pending=reader.read();await started.promise;
 await prompt(reader.cancel());assert.equal((await prompt(pending)).done,true);assert.deepEqual(phases,[2,4]);
 get.resolve({size:bytes.length,body:new ReadableStream({cancel(){cancels++;return new Promise(()=>{});}})});
 await turn();assert.equal(cancels,1);assert.deepEqual(phases,[2,4]);
});

test('cancel does not await a storage body cleanup that never resolves',async()=>{
 const started=deferred(),phases=[];let cancels=0;
 const bucket={get:async()=>({size:bytes.length,body:new ReadableStream({pull(){started.resolve();},cancel(){cancels++;return new Promise(()=>{});}},{highWaterMark:0})})};
 const reader=qaJsonResponse(store(bucket),{photo:ref},200,{onStreamEvent:phase=>phases.push(phase)}).body.getReader(),pending=reader.read();
 await started.promise;await prompt(reader.cancel());assert.equal((await prompt(pending)).done,true);assert.equal(cancels,1);assert.deepEqual(phases,[2,4]);
});

test('consumer pauses do not run a response-wide evidence deadline',async()=>{
 const large='data:image/png;base64,'+'A'.repeat(100000),largeBytes=new TextEncoder().encode(large),phases=[];let reads=0;
 const bucket={get:async()=>{let emitted=false;return {size:largeBytes.length,body:new ReadableStream({pull(controller){reads++;if(!emitted){emitted=true;controller.enqueue(largeBytes);}else controller.close();}},{highWaterMark:0})};}};
 const reader=qaJsonResponse(store(bucket),{photo:reference(large)},200,{evidenceTimeoutMs:15,onStreamEvent:phase=>phases.push(phase)}).body.getReader(),parts=[];
 const first=await reader.read();parts.push(first.value);assert.equal(first.value.length,16384);assert.equal(reads,1);
 await new Promise(resolve=>setTimeout(resolve,40));assert.deepEqual(phases,[2]);assert.equal(reads,1);
 while(true){const {value,done}=await reader.read();if(done)break;assert.ok(value.length<=16384);parts.push(value);}
 assert.deepEqual(JSON.parse(Buffer.concat(parts).toString()),{photo:large});assert.deepEqual(phases,[2,3]);
});

test('readQaPhoto bounds both the object lookup and body read with 503 errors',async()=>{
 const get=deferred();let lateCancel=0;
 await assert.rejects(readQaPhoto(store({get:()=>get.promise}),ref,{timeoutMs:15}),unavailable);
 get.resolve({size:bytes.length,body:new ReadableStream({cancel(){lateCancel++;}})});await turn();assert.equal(lateCancel,1);
 let cancels=0;
 await assert.rejects(readQaPhoto(store({get:async()=>({size:bytes.length,body:new ReadableStream({pull(){},cancel(){cancels++;}},{highWaterMark:0})})}),ref,{timeoutMs:15}),unavailable);
 assert.equal(cancels,1);
 await assert.rejects(readQaPhoto(store({get:async()=>({size:bytes.length,text:()=>new Promise(()=>{})})}),ref,{timeoutMs:15}),unavailable);
});

test('successful, timed-out and aborted reads clear their timers and abort listeners',async t=>{
 const timers=trackedTimers(t),signal=new AbortController();
 assert.equal(await readQaPhoto(store({get:async()=>({size:bytes.length,body:new Response(bytes).body})}),ref,{timeoutMs:15,signal:signal.signal}),photo);
 assert.equal(timers.size,0);assert.equal(getEventListeners(signal.signal,'abort').length,0);
 await assert.rejects(readQaPhoto(store({get:()=>new Promise(()=>{})}),ref,{timeoutMs:15,signal:signal.signal}),unavailable);
 assert.equal(timers.size,0);assert.equal(getEventListeners(signal.signal,'abort').length,0);
 const abort=new AbortController(),started=deferred(),pending=readQaPhoto(store({get(){started.resolve();return new Promise(()=>{});}}),ref,{signal:abort.signal});
 await started.promise;abort.abort();await assert.rejects(pending,error=>error.name==='AbortError');
 assert.equal(timers.size,0);assert.equal(getEventListeners(abort.signal,'abort').length,0);
 let gets=0;await assert.rejects(readQaPhoto(store({get(){gets++;}}),ref,{signal:abort.signal}),error=>error.name==='AbortError');assert.equal(gets,0);assert.equal(timers.size,0);
});

test('JSON cancellation clears its pending read deadline',async t=>{
 const timers=trackedTimers(t),started=deferred(),phases=[];
 const reader=qaJsonResponse(store({get(){started.resolve();return new Promise(()=>{});}}),{photo:ref},200,{onStreamEvent:phase=>phases.push(phase)}).body.getReader(),pending=reader.read();
 await started.promise;assert.equal(timers.size,1);await reader.cancel();assert.equal((await pending).done,true);
 await turn();assert.equal(timers.size,0);assert.deepEqual(phases,[2,4]);
});
