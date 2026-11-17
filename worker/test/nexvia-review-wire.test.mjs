import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {handlePurchaseRequests,handleNexviaRequestWorker} from '../src/purchase-requests.js';

const SOURCE='41864072-935f-46fb-ae15-e0959dc06ac4',CHILD='f8a3bdd3-47bc-4637-b89c-a98b64da844f';
const WORKER='c1f6c43d-3ca3-4f2c-86a7-72c948033b66',TOKEN='synthetic-cross-language-review-token-12345';
const owner={username:'requester',tasks:{'purchase-requests.create':true}};
const manager={username:'reviewer',tasks:{'purchase-requests.create':true,'purchase-requests.manage':true}};
const catalogue={projectPageId:60,supplierSearch:'',suppliers:[{id:'225',text:'Example supplier'}],services:[{id:'8',name:'Consultant'}],breakdowns:[{id:'ig_1',name:'Miscellaneous'}],accounts:[{id:'51052',name:'Consultant'}],taxes:[{id:'1',name:'GST',rate:10}]};
function fixture(){
 const docs=new Map(),files=new Map();
 const store={syncNexviaProjects:()=>{},env:{NEXVIA_REQUEST_TOKEN:TOKEN,EMAIL_ENABLED:'false',CAD_PROJECT_FILES:{
  put:async(key,bytes,options={})=>{if(options.onlyIf&&files.has(key))return null;files.set(key,new Uint8Array(bytes));return {key};},
  get:async key=>files.has(key)?{size:files.get(key).length,arrayBuffer:async()=>files.get(key).buffer}:null,delete:async key=>files.delete(key)}},
  sql:{exec:(_query,username)=>({toArray:()=>['requester','reviewer'].includes(username)?[{createdAt:'2026-01-01T00:00:00.000Z',name:username,email:username+'@example.test'}]:[]})},
  read:(key,fallback=null)=>structuredClone(docs.has(key)?docs.get(key):fallback),
  write:(key,value)=>{assert.ok(key.startsWith('purchase-request:')||key.startsWith('nexvia-confirmation-email:'));docs.set(key,structuredClone(value));},audit:()=>{},
  ctx:{waitUntil:()=>{},storage:{transactionSync:fn=>{const before=structuredClone([...docs]);try{return fn();}catch(error){docs.clear();for(const entry of before)docs.set(...entry);throw error;}}}}};
 return {store,docs};
}
const user=(store,url,method='GET',body={},actor=owner)=>handlePurchaseRequests(store,url,method,body,actor);
const machine=(store,url,body)=>handleNexviaRequestWorker(store,'/integrations/nexvia/'+url,'POST',body,TOKEN);
async function sourceRequest(store){
 await machine(store,'request-work',{workerId:WORKER,projects:[{projectPageId:60,name:'Façade project 🏢'}]});
 const lookup=(await user(store,'/purchase-requests/lookups','POST',{projectPageId:60})).body.lookup;
 const claim=(await machine(store,'request-work',{workerId:WORKER})).body.work;
 const choices=(await machine(store,'request-results',{workerId:WORKER,id:lookup.id,claimToken:claim.claimToken,kind:'lookup',state:'ready',catalog:catalogue})).body.catalog;
 const pdf=await PDFDocument.create();pdf.addPage();const quoteBase64=Buffer.from(await pdf.save()).toString('base64');
 const input={requestId:SOURCE,projectPageId:60,catalogRevision:choices.revision,requestor:{name:'Chloé Example',email:'requester@example.test'},date:'2026-11-16',supplierId:'225',supplierReference:'Q-1',serviceId:'8',breakdownType:'ig_1',quote:{filename:'Façade 🏢 quote.pdf'},quoteBase64,lines:[{description:'Survey façade 🏢',quantity:'1',unitPriceExGst:'2800',chartOfAccountId:'51052',taxRateId:'1',breakdownType:'ig_1'}]};
 await user(store,'/purchase-requests','POST',input);
 const work=(await machine(store,'request-work',{workerId:WORKER,documentExpected:true,quoteAttachmentVersion:1})).body.work;
 await machine(store,'request-results',{workerId:WORKER,id:SOURCE,claimToken:work.claimToken,kind:'request',state:'needs_review',message:'Fresh preparation failed; no submission authorized'});
 return input;
}
const PYTHON=String.raw`
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import nexvia_requests as bridge
import nexvia_reviews as reviews
value=json.load(sys.stdin)
claim, worker=value['claim'],value['worker']
root=Path(sys.argv[2]); journals=root/'journal'; requests=root/'requests'
for directory in (journals,requests): directory.mkdir(mode=0o700)
folder=requests/claim['requestId']; folder.mkdir(mode=0o700)
source=claim['sourceWork']
journal={'version':1,'workerId':worker,'id':claim['requestId'],'kind':'request','claimToken':source['claimToken'],'workHash':bridge.claimed_work_hash(source),'phase':'TERMINAL','reported':True,'outbound':{'workerId':worker,'id':claim['requestId'],'kind':'request','claimToken':source['claimToken'],'state':'needs_review','message':claim['previous']['message']}}
for key in ('documentExpected','quoteAttachmentVersion'):
    if key in source: journal[key]=source[key]
request_path=folder/'request.json'; journal_path=journals/('request-'+claim['requestId']+'.json')
bridge.atomic_json(request_path,source['payload']); bridge.atomic_json(journal_path,journal)
if value['attempt']: bridge.atomic_json(folder/'nexvia-create-attempt.json',{'state':'SUBMISSION_STARTED'})
before=[p.read_bytes() for p in (request_path,journal_path)]
sent=[]
def post(endpoint,body,token):
    assert endpoint==reviews.REVIEW_RESULT_PATH and token=='synthetic-token'
    sent.append(body)
    return {'ok':True,'review':{key:body[key] for key in ('id','requestId','status')}}
with bridge.bridge_lock(journals):
    status=reviews.assess_review(claim,{'workerId':worker,'token':'synthetic-token'},journals,requests,post)
assert before==[p.read_bytes() for p in (request_path,journal_path)]
assert len(sent)==1
print(json.dumps({'status':status,'body':sent[0]}))
`;
function nasAssessment(claim,attempt){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'panelstock-review-wire-'));
 try{
  const modules=fileURLToPath(new URL('../../integrations/nexvia/',import.meta.url));
  const process=spawnSync('python3',['-B','-c',PYTHON,modules,temporary],{input:JSON.stringify({claim,worker:WORKER,attempt}),encoding:'utf8',timeout:15000});
  assert.equal(process.status,0,process.stderr);return JSON.parse(process.stdout);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

for(const attempt of [false,true])test('real Python review evidence crosses the Worker wire with Unicode and '+(attempt?'blocks existing PO-attempt evidence':'creates one linked, owner-visible replacement'),async()=>{
 const {store,docs}=fixture(),input=await sourceRequest(store),original=structuredClone(docs.get('purchase-request:record:'+SOURCE));
 await user(store,'/purchase-requests/'+SOURCE+'/review','POST',{action:'check'},manager);
 const poll=(await machine(store,'request-work',{workerId:WORKER,reviewVersion:1})).body;
 assert.equal(poll.work,null);assert.equal(poll.review.requestId,SOURCE);
 const assessed=nasAssessment(poll.review,attempt);
 assert.equal(assessed.status,attempt?'review_blocked':'review_retry_ready');
 const accepted=(await machine(store,'request-review-result',assessed.body)).body;
 assert.equal(accepted.review.status,attempt?'blocked':'retry_ready');
 assert.equal((await machine(store,'request-review-result',assessed.body)).body.duplicate,true);
 const parent=(await user(store,'/purchase-requests/'+SOURCE)).body.request;
 assert.equal(parent.review.canRetry,!attempt);
 assert.deepEqual(docs.get('purchase-request:record:'+SOURCE),original);
 const replacement={...input,requestId:CHILD,retryOf:{requestId:SOURCE,reviewId:poll.review.id}};
 if(attempt){
  await assert.rejects(()=>user(store,'/purchase-requests','POST',replacement,manager),error=>error.status===409&&error.code==='PURCHASE_REQUEST_REVIEW_CHANGED');
  assert.equal(docs.has('purchase-request:record:'+CHILD),false);
 }else{
  await assert.rejects(()=>user(store,'/purchase-requests','POST',{...replacement,quote:null,quoteBase64:''},manager),error=>error.status===422);
  const child=(await user(store,'/purchase-requests','POST',replacement,manager)).body.request;
  assert.equal(child.id,CHILD);assert.equal(child.retryOf.id,SOURCE);assert.equal(child.requestor.email,input.requestor.email);
  assert.equal((await user(store,'/purchase-requests/'+CHILD)).body.request.id,CHILD,'original requester retains access');
  assert.equal((await user(store,'/purchase-requests','POST',replacement,manager)).body.duplicate,true);
  const history=(await user(store,'/purchase-requests')).body.requests;
  assert.equal(history.find(row=>row.id===SOURCE).review.replacement.id,CHILD);
  assert.equal(history.filter(row=>row.id===CHILD).length,1);
 }
 assert.deepEqual(docs.get('purchase-request:record:'+SOURCE),original);
 assert.equal([...docs.keys()].some(key=>key.startsWith('nexvia-confirmation-email:job:')),false,'review does not create an email job');
});
