import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {qaJsonResponse} from '../src/qa-media.js';

const encoder=new TextEncoder();
const small='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function largePng(){
 // A real PNG with a valid ancillary chunk, at the workshop's 4 MiB file limit.
 const base=Buffer.from(small.split(',')[1],'base64'),data=Buffer.alloc(4*1024*1024-base.length-12,65),type=Buffer.from('tEXt'),length=Buffer.alloc(4),crc=Buffer.alloc(4);
 data.write('Comment\0Synthetic evidence');length.writeUInt32BE(data.length);let checksum=0xffffffff;
 for(const byte of Buffer.concat([type,data])){checksum^=byte;for(let bit=0;bit<8;bit++)checksum=(checksum>>>1)^((checksum&1)?0xedb88320:0);}
 crc.writeUInt32BE((checksum^0xffffffff)>>>0);
 return 'data:image/png;base64,'+Buffer.concat([base.subarray(0,-12),length,type,data,crc,base.subarray(-12)]).toString('base64');
}
const reference=value=>'qa-r2:v1:'+createHash('sha256').update(value).digest('hex')+':'+Buffer.byteLength(value);
const store=bucket=>({env:{SITE_ID:'synthetic-stream-test',CAD_PROJECT_FILES:bucket}});
async function consume(response){
 const reader=response.body.getReader(),parts=[];let count=0,max=0;
 while(true){const {value,done}=await reader.read();if(done)break;assert.ok(value.byteLength>0&&value.byteLength<=16384,'Every response chunk stays within 16 KiB');parts.push(value);count++;max=Math.max(max,value.byteLength);}
 return {text:Buffer.concat(parts).toString('utf8'),count,max};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('4 MiB original PNG and long keys stream byte-exact JSON without whole-string serialization',async t=>{
 const photo=largePng(),key='key🙂'.repeat(3000),body={photo,[key]:'Original evidence',count:3},expected=JSON.stringify(body);
 assert.equal(Buffer.from(photo.split(',')[1],'base64').length,4*1024*1024);
 const native=JSON.stringify;
 t.mock.method(JSON,'stringify',(value,...args)=>{assert.ok(typeof value!=='string'||value.length<=8192,'Large strings must use the bounded serializer');return native(value,...args);});
 const phases=[],response=qaJsonResponse(store(),body,200,{onStreamEvent:phase=>phases.push(phase)}),result=await consume(response);
 assert.equal(response.headers.get('Content-Type'),'application/json');assert.equal(result.text,expected);assert.equal(result.max,16384);assert.ok(result.count>300);assert.deepEqual(phases,[2,3]);
});

test('Unicode, control characters, lone surrogates and boundary keys retain native JSON bytes',async()=>{
 const controls=Array.from({length:32},(_,i)=>String.fromCharCode(i)).join(''),text=('a'.repeat(4094)+'🙂漢字'+controls+'"\\\b\f\n\r\t'+'\ud800!\udc00').repeat(4),body={['🙂'.repeat(4097)+'\ud800']:text,values:[text,null,undefined,true,1.25],nested:{toJSON(){return {text};}}};
 assert.equal((await consume(qaJsonResponse(store(),body))).text,JSON.stringify(body));
});

test('a single oversized private R2 source chunk is bounded and resolves only authorized evidence fields',async()=>{
 const photo=largePng(),ref=reference(photo),bytes=encoder.encode(photo),keys=[];let sourcePulls=0;
 const body={photo:ref,photos:[ref],notes:ref};
 // A fresh source stream is required for each occurrence of the same evidence.
 const bucket={async get(key){keys.push(key);let emitted=false;return {size:bytes.byteLength,body:new ReadableStream({pull(controller){sourcePulls++;if(!emitted){emitted=true;controller.enqueue(bytes);}else controller.close();}},{highWaterMark:0})};}};
 const result=await consume(qaJsonResponse(store(bucket),body));
 assert.equal(result.text,JSON.stringify({photo,photos:[photo],notes:ref}));assert.equal(result.max,16384);assert.equal(sourcePulls,4);assert.equal(keys.length,2);assert.ok(keys.every(key=>key.startsWith('qa-evidence/v1/synthetic-stream-test/')));
 let forbiddenReads=0;const unresolved=qaJsonResponse(store({get(){forbiddenReads++;throw Error('Must not resolve');}}),{photo:ref},200,{resolveEvidence:false});
 assert.equal((await consume(unresolved)).text,JSON.stringify({photo:ref}));assert.equal(forbiddenReads,0);
});

test('consumer backpressure stops traversal and cancellation releases an oversized pending R2 chunk',async()=>{
 const bytes=encoder.encode('data:image/png;base64,'+'A'.repeat(100000)),ref=reference(bytes),phases=[];let gets=0,pulls=0,cancels=0,tailVisits=0;
 const bucket={async get(){gets++;return {size:bytes.byteLength,body:new ReadableStream({pull(controller){pulls++;controller.enqueue(bytes);},cancel(){cancels++;}},{highWaterMark:0})};}};
 const response=qaJsonResponse(store(bucket),{photo:ref,tail:{toJSON(){tailVisits++;return 'tail';}}},200,{onStreamEvent:phase=>phases.push(phase)});
 await turn();assert.equal(gets,0);const reader=response.body.getReader(),first=await reader.read();assert.equal(first.value.byteLength,16384);
 await turn();assert.equal(gets,1);assert.equal(pulls,1);assert.equal(tailVisits,0);
 await reader.cancel();assert.equal(cancels,1);assert.equal(tailVisits,0);assert.deepEqual(phases,[2,4]);assert.equal((await reader.read()).done,true);
});

test('cancellation interrupts a stalled evidence source read without advancing or closing the JSON',{timeout:10000},async()=>{
 let sourceCancel=0,sourceRead;const reading=new Promise(resolve=>sourceRead=resolve),phases=[];
 const bytes=encoder.encode(small),bucket={async get(){return {size:bytes.byteLength,body:new ReadableStream({pull(){sourceRead();},cancel(){sourceCancel++;}},{highWaterMark:0})};}};
 const reader=qaJsonResponse(store(bucket),{photo:reference(bytes)},200,{onStreamEvent:phase=>phases.push(phase)}).body.getReader(),pending=reader.read();
 await reading;await reader.cancel();assert.equal(sourceCancel,1);assert.equal((await pending).done,true);assert.deepEqual(phases,[2,4]);
});

test('private evidence stays closed on missing, wrong-sized or corrupt content and reports one error phase',async t=>{
 t.mock.method(console,'error',()=>{});
 for(const failure of ['missing','size','hash']){
  const phases=[],bytes=encoder.encode(small),corrupt=bytes.slice();corrupt[corrupt.length-1]=65;
  const bucket={async get(){return failure==='missing'?null:{size:bytes.length+(failure==='size'?1:0),body:new Response(failure==='hash'?corrupt:bytes).body};}};
  await assert.rejects(consume(qaJsonResponse(store(bucket),{photo:reference(small)},200,{onStreamEvent:phase=>phases.push(phase)})),/unavailable|integrity/);
  assert.deepEqual(phases,[2,5]);
 }
});

test('stream tracing is content-free and callback failures never fail successful, canceled or failed responses',async t=>{
 t.mock.method(console,'error',()=>{});
 for(const mode of ['throw','reject']){
  const seen=[],onStreamEvent=(...args)=>{assert.equal(args.length,1);assert.ok([2,3,4,5].includes(args[0]));seen.push(args[0]);if(mode==='throw')throw Error('Tracing unavailable');return Promise.reject(Error('Tracing unavailable'));};
  assert.equal((await consume(qaJsonResponse(store(),{ok:true},200,{onStreamEvent}))).text,'{"ok":true}');assert.deepEqual(seen,[2,3]);
  seen.length=0;const reader=qaJsonResponse(store(),{photo:small},200,{onStreamEvent}).body.getReader();await reader.cancel();assert.deepEqual(seen,[2,4]);
  seen.length=0;await assert.rejects(consume(qaJsonResponse(store({get:async()=>null}),{photo:reference(small)},200,{onStreamEvent})));assert.deepEqual(seen,[2,5]);
 }
 await turn();
});
