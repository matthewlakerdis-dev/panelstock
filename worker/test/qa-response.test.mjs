import {qaJsonResponse} from '../src/qa-media.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HttpError,requireCondition as check} from '../src/security.js';
import {originApp} from '../src/app-access.js';

const storeSource=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const wrapper=storeSource.slice(storeSource.indexOf('  async qaResponse('),storeSource.indexOf('  runtimeStorageMetrics(',storeSource.indexOf('  async qaResponse(')));
const makeStore=check=>new Function('check','qaJsonResponse',`return ({${wrapper}});`)(check,qaJsonResponse);
const indexSource=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{InventoryStore\}.*;\r?\n/m,'').replace('export default {','const worker={');
const worker=new Function('originApp','HttpError','SAFETY_READER_PATH',indexSource+';return worker;')(originApp,HttpError,'/safety-reader/');
const photo='data:image/png;base64,aGVsbG8=',token='a'.repeat(64),webOrigin='https://web.panelstockhq.com';

function fixture({status=200,payload={ok:true,items:[]},readOnly=false}={}){
 const calls=[],generic=[],store={
  qaResponse:async(...args)=>{calls.push(args);return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});},
  handle:async(...args)=>{generic.push(args);return {status,body:payload};}
 };
 let connections=0;
 const env={SITE_ID:'qa-response-test',ALLOWED_ORIGINS:webOrigin,READ_ONLY:readOnly?'true':'false',INVENTORY:{getByName:name=>{assert.equal(name,'qa-response-test');connections++;return store;}}};
 return {calls,generic,store,env,connections:()=>connections};
}
function request(path,{method='GET',body,origin=webOrigin,auth=token,ip='192.0.2.18'}={}){
 return new Request('https://worker.example.test'+path,{method,headers:{...(origin?{Origin:origin}:{}),...(auth?{Authorization:'Bearer '+auth}:{}),'CF-Connecting-IP':ip,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
}


test('the QA response wrapper calls the existing handler once with unchanged arguments and preserves original evidence',async()=>{
 const attempt={id:'inspection',status:'approved',results:{fit:'pass'},photo,checkedBy:'inspector',checkedAt:'2026-11-19T01:00:00Z'},addition={id:'addition',attemptId:attempt.id,photos:[photo],addedBy:'team',addedAt:'2026-11-19T02:00:00Z',mutationId:'saved-upload-0001'},payload={ok:true,item:{id:'panel',kind:'panel',status:'approved',latest:attempt,history:[attempt],photoAdditions:[addition]}},before=structuredClone(payload),body={id:'panel',kind:'panel',attemptId:attempt.id,photos:[photo],mutationId:addition.mutationId},calls=[];
 const store=Object.assign(makeStore(check),{handle:async(...args)=>{calls.push(args);return {status:201,body:payload};}});
 const response=await store.qaResponse('/qa/photos','POST',body,token,'192.0.2.18','web');
 assert.equal(calls.length,1);assert.deepEqual(calls[0],['/qa/photos','POST',body,token,'192.0.2.18','web']);assert.equal(calls[0][2],body);
 assert.equal(response.status,201);assert.equal(response.headers.get('Content-Type'),'application/json');assert.deepEqual(await response.json(),before);assert.deepEqual(payload,before);
});

test('structured authentication, validation, conflict and quota errors pass through unchanged without retries',async()=>{
 for(const [status,code]of [[401,'SESSION_EXPIRED'],[403,'QA_ACCESS_REQUIRED'],[400,'INVALID_PHOTO'],[409,'QA_ALREADY_APPROVED'],[500,'SAVE_UNCONFIRMED'],[503,'DATABASE_WRITE_QUOTA']]){
  const payload={ok:false,error:'Original handler message',code},calls=[];
  const store=Object.assign(makeStore(check),{handle:async(...args)=>{calls.push(args);return {status,body:payload};}});
  const response=await store.qaResponse('/qa/check','POST',{id:'panel'},token,'unknown');assert.equal(response.status,status);assert.deepEqual(await response.json(),payload);assert.equal(calls.length,1);assert.equal(calls[0][5],'');
 }
 const failure=Error('Synthetic transport interruption');let calls=0;
 const store=Object.assign(makeStore(check),{handle:async()=>{calls++;throw failure;}});
 await assert.rejects(store.qaResponse('/qa','GET',{},token,'unknown'),error=>error===failure);assert.equal(calls,1);
});

test('the wrapper rejects non-QA paths before invoking the authenticated handler',async()=>{
 let calls=0;const store=Object.assign(makeStore(check),{handle:async()=>{calls++;return {status:200,body:{ok:true}};}});
 for(const path of [undefined,null,12,{},'/data','/qax','/qa-other','/other/qa','/qa?query=1'])await assert.rejects(store.qaResponse(path,'GET',{},token,'unknown'),error=>error.status===400);
 assert.equal(calls,0);
 for(const path of ['/qa','/qa/','/qa/report','/qa/unknown'])assert.equal((await store.qaResponse(path,'GET',{},token,'unknown')).status,200);
 assert.equal(calls,4);
});

test('the actual edge handler uses the streamed QA transport and keeps status, CORS and security headers',async()=>{
 const payload={ok:false,error:'Original permission denial',code:'QA_ACCESS_REQUIRED'},f=fixture({status:403,payload});
 const response=await worker.fetch(request('/qa'),f.env);
 assert.equal(f.calls.length,1);assert.equal(f.generic.length,0);assert.deepEqual(f.calls[0],['/qa','GET',{},token,'192.0.2.18','web']);
 assert.equal(response.status,403);assert.deepEqual(await response.json(),payload);
 assert.equal(response.headers.get('Content-Type'),'application/json');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Vary'),'Origin');assert.equal(response.headers.get('Access-Control-Allow-Origin'),webOrigin);
});

test('every QA route forwards its original request through the wrapper without falling back to object RPC',async()=>{
 const routes=['/qa/check','/qa/photos','/qa/report','/qa/gates/report','/qa/settings','/qa/panels/exemptions','/qa/metalwork','/qa/metalwork/delete','/qa/recut/resolve','/qa/dispatch'];
 for(const path of routes){
  const body={id:'saved-item',attemptId:'inspection',photos:[photo],mutationId:'upload-request-0001'},f=fixture({status:201,payload:{ok:true,item:{history:[{photo}]}}});
  const response=await worker.fetch(request(path,{method:'POST',body}),f.env);
  assert.equal(response.status,201,path);assert.deepEqual(await response.json(),{ok:true,item:{history:[{photo}]}});assert.deepEqual(f.calls,[[path,'POST',body,token,'192.0.2.18','web']]);assert.equal(f.generic.length,0);
 }
 const f=fixture();await worker.fetch(request('/qa',{origin:null,auth:null,ip:''}),f.env);assert.deepEqual(f.calls[0],['/qa','GET',{},'','unknown','']);
});

test('the edge forwards body streams without replacing them with serialized stream objects',async()=>{
 const f=fixture(),encoder=new TextEncoder(),parts=['{"ok":true,"items":[','{"photo":"'+photo+'"}',']}'];
 f.store.qaResponse=async(...args)=>{f.calls.push(args);return new Response(new ReadableStream({start(controller){for(const part of parts)controller.enqueue(encoder.encode(part));controller.close();}}),{status:200,headers:{'Content-Type':'application/json'}});};
 const response=await worker.fetch(request('/qa'),f.env);assert.deepEqual(await response.json(),{ok:true,items:[{photo}]});assert.equal(f.calls.length,1);assert.equal(f.generic.length,0);
});

test('origin checks, preflight and maintenance protection happen before QA method execution',async()=>{
 const denied=fixture();assert.equal((await worker.fetch(request('/qa',{origin:'https://untrusted.example'}),denied.env)).status,403);assert.equal(denied.connections(),0);assert.equal(denied.calls.length,0);
 const preflight=fixture(),response=await worker.fetch(request('/qa/photos',{method:'OPTIONS'}),preflight.env);assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),webOrigin);assert.equal(preflight.connections(),0);
 const readOnly=fixture({readOnly:true});
 for(const path of ['/qa/check','/qa/photos','/qa/metalwork/delete']){const blocked=await worker.fetch(request(path,{method:'POST',body:{id:'item'}}),readOnly.env);assert.equal(blocked.status,503);assert.match((await blocked.json()).error,/paused for maintenance/);}
 assert.equal(readOnly.calls.length,0);assert.equal(readOnly.generic.length,0);
 assert.equal((await worker.fetch(request('/qa'),readOnly.env)).status,200);assert.equal(readOnly.calls.length,1);
});

test('non-QA requests retain the generic handler and QA transport failures never retry mutation calls',async t=>{
 const f=fixture();
 for(const path of ['/data','/qax','/qa-other']){assert.equal((await worker.fetch(request(path),f.env)).status,200);assert.equal(f.generic.at(-1)[0],path);}
 assert.equal(f.calls.length,0);assert.equal(f.generic.length,3);
 const failures=fixture();t.mock.method(console,'error',()=>{});failures.store.qaResponse=async(...args)=>{failures.calls.push(args);throw Error('Synthetic interrupted QA response');};
 const response=await worker.fetch(request('/qa/check',{method:'POST',body:{id:'saved-item'}}),failures.env);assert.equal(response.status,503);const failure=await response.json();assert.match(failure.requestId,/^[a-f0-9-]{36}$/);assert.deepEqual({...failure,requestId:undefined},{ok:false,error:'Service unavailable; please retry',requestId:undefined});assert.equal(failures.calls.length,1);assert.equal(failures.generic.length,0);
});
