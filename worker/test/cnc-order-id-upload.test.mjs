import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {HttpError} from '../src/security.js';
import {analyseCncOrderIdUpload,CNC_ORDER_ID_PDF_MAX_BYTES} from '../src/cnc-order-id-upload.js';

const binary=Buffer.from([37,80,68,70,45,49,46,55,10,0,128,255,13,10]);
const dataUrl=bytes=>'data:application/pdf;base64,'+Buffer.from(bytes).toString('base64');
const page={page:1,project:'Printed title',orderNumber:'007',sheetNumber:'1',quantity:1,panelIds:['A-1'],warnings:['Review note'],sheetWidth:4000,panelArea:8,proposedOffcuts:[{length:400,width:1200}],status:'pending',completedAt:null};
const request=extra=>({project:'Tower',orderNumber:'007',fileName:'Order 7 revised.pdf',pdf:dataUrl(binary),...extra});
function fixture(extra={}){
 const calls={contexts:[],analyses:[],stages:[]},context={status:200,body:{ok:true,scope:{project:'Tower',orderNumber:'007'},panels:[{id:'stable-panel',status:'completed'}]}};
 const store={
  handle:async(...args)=>{calls.contexts.push(args);return extra.context||{...context,body:{...context.body,scope:{project:args[2].project,orderNumber:args[2].orderNumber}}};},
  stageCncOrderIdAnalysis:async(...args)=>{
   calls.stages.push(args);
   if(extra.stage)return typeof extra.stage==='function'?extra.stage(...args):extra.stage;
   return {status:200,body:{ok:true,analysisId:'analysis-000000000001',scope:{project:args[2].project,orderNumber:args[2].orderNumber},source:args[2].source,occurrences:[{occurrenceId:'p1-c1-i1',panelNumber:'A-1'}]}};
  },
  write(){throw Error('The gateway must not write production documents');}
 };
 const analyse=async pdf=>{calls.analyses.push(pdf);if(extra.analyse)return extra.analyse(pdf);return {pages:[page],stock:{qty:999}};};
 return {store,analyse,calls,run:body=>analyseCncOrderIdUpload({store,analyse,body:body||request(),token:'current-session',ip:'192.0.2.1',app:'mobile'})};
}

test('trusted staging hashes the actual binary PDF bytes and forwards only parser identity fields',async()=>{
 const f=fixture(),before=structuredClone(page),r=await f.run(request({source:{sha256:'forged',bytes:1},pages:[{panelIds:['FORGED']}],status:'pending'}));
 assert.equal(r.status,200);assert.equal(r.body.source.sha256,createHash('sha256').update(binary).digest('hex'));assert.equal(r.body.source.bytes,binary.length);
 assert.deepEqual(f.calls.contexts,[['/cnc/order-id-reupload','POST',{action:'context',project:'Tower',orderNumber:'007'},'current-session','192.0.2.1','mobile']]);
 assert.equal(f.calls.analyses.length,1);assert.deepEqual(f.calls.stages[0].slice(0,2),['current-session','mobile']);
 assert.deepEqual(f.calls.stages[0][2],{project:'Tower',orderNumber:'007',source:{fileName:'Order 7 revised.pdf',sha256:createHash('sha256').update(binary).digest('hex'),bytes:binary.length},pages:[{page:1,project:'Printed title',orderNumber:'007',sheetNumber:'1',quantity:1,panelIds:['A-1'],warnings:['Review note']}]});
 assert.deepEqual(page,before);assert.equal(f.calls.stages.length,1);
});

test('explicit blank-project groups and exact leading-zero order identities remain scoped, not inferred from PDF titles',async()=>{
 const f=fixture();await f.run(request({project:'',orderNumber:' 007 ',fileName:' Revised.pdf '}));
 assert.deepEqual(f.calls.contexts[0][2],{action:'context',project:'',orderNumber:'007'});
 assert.equal(f.calls.stages[0][2].project,'');assert.equal(f.calls.stages[0][2].orderNumber,'007');assert.equal(f.calls.stages[0][2].source.fileName,'Revised.pdf');
});

test('denied or missing order context stops conversion and staging, preserving its HTTP status',async()=>{
 for(const status of [401,403,404,409,503]){
  const denied={status,body:{ok:false,error:'Context unavailable'}},f=fixture({context:denied});
  assert.deepEqual(await f.run(),denied);assert.equal(f.calls.analyses.length,0);assert.equal(f.calls.stages.length,0);
 }
 for(const context of [{status:200,body:{ok:true,panels:[]}},{status:200,body:{ok:false,panels:[{}]}},{body:{ok:true}},{status:200,body:[]}]){
  const f=fixture({context});await assert.rejects(f.run(),error=>[409,503].includes(error.status));assert.equal(f.calls.analyses.length,0);assert.equal(f.calls.stages.length,0);
 }
});

test('invalid scope and file names reject before selected-order access or conversion',async()=>{
 for(const patch of [{project:null},{project:'a'.repeat(121)},{project:'Tower\n'},{orderNumber:''},{orderNumber:7},{orderNumber:'a'.repeat(201)},{orderNumber:'007\t'},{fileName:''},{fileName:'a'.repeat(201)},{fileName:'bad\rname.pdf'}]){
  const f=fixture();await assert.rejects(f.run(request(patch)),error=>error.status===400);assert.equal(f.calls.contexts.length,0);assert.equal(f.calls.analyses.length,0);assert.equal(f.calls.stages.length,0);
 }
 for(const body of [null,[],false]){
  const f=fixture();await assert.rejects(analyseCncOrderIdUpload({store:f.store,analyse:f.analyse,body,token:'x'}),error=>error.status===400);
 }
});

test('only bounded PDF data URIs with actual PDF signatures reach the converter',async()=>{
 for(const pdf of [null,{},'',dataUrl('not a PDF'),'data:text/plain;base64,'+binary.toString('base64'),'data:application/pdf;base64,=AAA','data:application/pdf;base64,A']){
  const f=fixture();await assert.rejects(f.run(request({pdf})),error=>error.status===400);assert.equal(f.calls.analyses.length,0);assert.equal(f.calls.stages.length,0);
 }
 const bytes=Buffer.alloc(CNC_ORDER_ID_PDF_MAX_BYTES+1);bytes.write('%PDF-');
 const oversized=fixture();await assert.rejects(oversized.run(request({pdf:dataUrl(bytes)})),error=>error.status===413);assert.equal(oversized.calls.analyses.length,0);assert.equal(oversized.calls.stages.length,0);
 const encoded=fixture();await assert.rejects(encoded.run(request({pdf:'data:application/pdf;base64,'+'A'.repeat(4*Math.ceil(CNC_ORDER_ID_PDF_MAX_BYTES/3)+4)})),error=>error.status===413);assert.equal(encoded.calls.analyses.length,0);
});

test('an exactly 8 MB PDF is accepted and its full byte length and digest are retained',async()=>{
 const bytes=Buffer.alloc(CNC_ORDER_ID_PDF_MAX_BYTES,0x80);bytes.write('%PDF-');const f=fixture(),r=await f.run(request({pdf:dataUrl(bytes)}));
 assert.equal(r.body.source.bytes,bytes.length);assert.equal(r.body.source.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(f.calls.analyses.length,1);
});

test('converter failures or malformed page collections cannot stage an analysis',async()=>{
 const failed=fixture({analyse:async()=>{throw new HttpError(422,'Could not analyse');}});
 await assert.rejects(failed.run(),error=>error.status===422);assert.equal(failed.calls.stages.length,0);
 for(const value of [null,[],{},{pages:[]},{pages:[null]},{pages:Array.from({length:301},()=>page)}]){
  const f=fixture({analyse:async()=>value});await assert.rejects(f.run(),error=>error.status===422);assert.equal(f.calls.stages.length,0);
 }
});

test('fresh stage authorization can reject an expired or changed account after asynchronous analysis',async()=>{
 let analysed=false;
 const f=fixture({analyse:async()=>{await Promise.resolve();analysed=true;return {pages:[page]};},stage:async()=>{assert.equal(analysed,true);return {status:403,body:{ok:false,error:'Admin access revoked'}};}});
 const result=await f.run();assert.equal(result.status,403);assert.equal(result.body.error,'Admin access revoked');assert.equal(f.calls.stages.length,1);
});

test('context and staged scope must remain the explicitly selected project and exact order identity',async()=>{
 for(const scope of [{project:'Other tower',orderNumber:'007'},{project:'Tower',orderNumber:'7'},{project:'Tower',orderNumber:'008'},null]){
  const f=fixture({context:{status:200,body:{ok:true,scope,panels:[{id:'a'}]}}});
  await assert.rejects(f.run(),error=>error.status===409);assert.equal(f.calls.analyses.length,0);assert.equal(f.calls.stages.length,0);
 }
 const staged=fixture({stage:async(token,app,input)=>({status:200,body:{ok:true,analysisId:'analysis-known',scope:{project:'Other',orderNumber:'007'},source:input.source,occurrences:[]}})});
 await assert.rejects(staged.run(),error=>error.status===503);assert.equal(staged.calls.stages.length,1);
 const canonical=fixture({context:{status:200,body:{ok:true,scope:{project:' TOWER ',orderNumber:'007'},panels:[{id:'a'}]}}});assert.equal((await canonical.run()).status,200);
});

test('an unverified or mismatched staging acknowledgement is not reported as a successful upload',async()=>{
 for(const stage of [{status:200,body:{ok:true}},{status:200,body:{ok:true,analysisId:'known',occurrences:[],source:{fileName:'other.pdf',sha256:'fake',bytes:1}}},{status:200,body:[]},null]){
  const f=fixture({stage:stage===null?async()=>null:stage});await assert.rejects(f.run(),error=>error.status===503);assert.equal(f.calls.stages.length,1);
 }
});

const index=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const marker="      if(url.pathname==='/cnc-pdf/order-id-reupload/analyse' && request.method==='POST') {";
const next=index.indexOf('      // Account saves',index.indexOf(marker));
const routeSource=index.slice(index.indexOf(marker),next);
const runRoute=new Function('url','request','store','token','app','origin','readBody','MAX_PDF_BODY','analyseCncOrderIdUpload','analyseCncPdf','env','response',`return (async()=>{${routeSource}\nreturn null;})()`);
const maxBody=4*Math.ceil(CNC_ORDER_ID_PDF_MAX_BYTES/3)+64*1024;
function routeFixture(access){
 const calls={read:[],helper:[],analysis:[],settings:0};
 const store={handle:async(...args)=>{assert.deepEqual(args,['/session/full','GET',{},'auth','192.0.2.2','mobile']);return access;},readPublicCncSettings:async()=>{calls.settings++;return {minimumOffcutSizeMm:50,cutEdgeAllowanceMm:0};}};
 const request={method:'POST',headers:new Headers({'CF-Connecting-IP':'192.0.2.2'})};
 const execute=()=>runRoute(new URL('https://api.example/cnc-pdf/order-id-reupload/analyse'),request,store,'auth','mobile','https://app.example',async(r,limit)=>{calls.read.push([r,limit]);return {pdf:'PDF payload'};},maxBody,async options=>{calls.helper.push(options);await options.analyse(options.body.pdf);return {status:200,body:{ok:true,analysisId:'analysis'}};},async(...args)=>{calls.analysis.push(args);return {pages:[page]};},{configured:true},(body,status,origin)=>({body,status,origin}));
 return {calls,execute};
}

test('HTTP route checks current admin access before reading a base64 request body',async()=>{
 for(const access of [{status:401,body:{error:'Login required'}},{status:200,body:{isAdmin:false}}]){
  const f=routeFixture(access),r=await f.execute();assert.equal(r.status,access.status===401?401:403);assert.equal(f.calls.read.length,0);assert.equal(f.calls.helper.length,0);assert.equal(f.calls.analysis.length,0);
 }
});

test('HTTP route passes the bounded expanded-PDF limit and reuses current converter settings',async()=>{
 const f=routeFixture({status:200,body:{isAdmin:true}}),r=await f.execute();assert.equal(r.status,200);assert.equal(f.calls.read.length,1);assert.equal(f.calls.read[0][1],maxBody);assert.ok(maxBody>8*1024*1024);assert.equal(f.calls.settings,1);
 const args=f.calls.helper[0];assert.equal(args.token,'auth');assert.equal(args.app,'mobile');assert.equal(args.ip,'192.0.2.2');assert.equal(args.body.pdf,'PDF payload');
 assert.deepEqual(f.calls.analysis[0],[{configured:true},'PDF payload',{minimumOffcutSizeMm:50,cutEdgeAllowanceMm:0}]);
});

test('new route precedes the generic body reader and does not expose staging as an HTTP route',()=>{
 assert.ok(index.indexOf(marker)>=0);assert.ok(index.indexOf(marker)<index.indexOf("      const body=request.method==='POST'?await readBody(request,"));
 assert.match(index,/import \{analyseCncOrderIdUpload\} from '\.\/cnc-order-id-upload\.js'/);
 assert.doesNotMatch(index,/url\.pathname\s*===\s*['\"][^'\"]*stageCncOrderIdAnalysis/);
});

test('the existing CNC analysis route still accepts its original PDF-only request contract',async()=>{
 const start=index.indexOf("      if(url.pathname==='/cnc-pdf/analyse' && request.method==='POST') {");
 const original=index.slice(start,index.indexOf(marker));
 const run=new Function('url','request','store','token','app','origin','readBody','MAX_PDF_BODY','analyseCncPdf','env','response',`return (async()=>{${original}\nreturn null;})()`);
 let called=false;const store={handle:async()=>({status:200,body:{isAdmin:true}}),readPublicCncSettings:async()=>({minimumOffcutSizeMm:1})};
 const result=await run(new URL('https://api.example/cnc-pdf/analyse'),{method:'POST',headers:new Headers()},store,'auth','mobile','origin',async()=>({pdf:'legacy PDF'}),maxBody,async(env,pdf,settings)=>{called=true;assert.equal(pdf,'legacy PDF');assert.equal(settings.minimumOffcutSizeMm,1);return {pages:[page]};},{},(body,status)=>({body,status}));
 assert.equal(called,true);assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.deepEqual(result.body.pages,[page]);
});
