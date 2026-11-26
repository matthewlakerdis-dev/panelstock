import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const match=source.match(/  async stageCncOrderIdAnalysis\(token,app,input\) \{([\s\S]*?)\n  \}\n/);
assert.ok(match,'The private drawing-analysis RPC must be present');
const invoke=new Function('stageOrderIdAnalysis','ok',`return async function(token,app,input){${match[1]}}`);
const envelope=(body,status=200)=>({status,body});

test('staging resolves current authentication before passing trusted parser data to the authorized preparer',async()=>{
 let resolveActor,staged=false;
 const actor={username:'current-admin',isAdmin:true},input={source:{sha256:'a'.repeat(64)}},store={
  actor(token,app){assert.equal(token,'session');assert.equal(app,'mobile');return new Promise(resolve=>{resolveActor=resolve;});}
 };
 const rpc=invoke((actualStore,actualInput,actualActor)=>{staged=true;assert.equal(actualStore,store);assert.equal(actualInput,input);assert.equal(actualActor,actor);return {ok:true,analysisId:'trusted'};},envelope);
 const pending=rpc.call(store,'session','mobile',input);
 assert.equal(staged,false);resolveActor(actor);
 assert.deepEqual(await pending,{status:200,body:{ok:true,analysisId:'trusted'}});assert.equal(staged,true);
});

test('expired authentication or revoked staging permission cannot write an analysis',async()=>{
 for(const [status,message]of [[401,'Login required'],[403,'Admin access required']]){
  let staged=false;
  const denied=Object.assign(Error(message),{status}),store={actor:async()=>{if(status===401)throw denied;return {username:'no-longer-admin',isAdmin:false};}};
  const rpc=invoke(()=>{staged=true;throw denied;},envelope),result=await rpc.call(store,'old-session','desktop',{});
  assert.deepEqual(result,{status,body:{ok:false,error:message}});assert.equal(staged,status===403);
 }
});

test('private staging failures do not disclose internal storage details',async()=>{
 const rpc=invoke(()=>{throw Error('internal database failure with confidential details');},envelope);
 assert.deepEqual(await rpc.call({actor:async()=>({username:'admin'})},'session','mobile',{}),{status:500,body:{ok:false,error:'The CNC PDF analysis could not be staged.'}});
 assert.doesNotMatch(source,/path\s*===\s*['\"][^'\"]*(?:stageCncOrderIdAnalysis|order-id-reupload\/stage)/);
});
