import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analysePurchaseOrder} from '../src/po-import.js';
const env={PDF_CONVERTER_URL:'https://converter.test',PDF_CONVERTER_TOKEN:'test-only'},body={name:'PO.pdf',data:btoa('%PDF-test')};
test('PO reader forwards only the document with server authentication',async()=>{
 const prior=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{sent={url,options};return Response.json({ok:true,lines:[],reference:'PO-1'});};
 try{assert.equal((await analysePurchaseOrder({...body,stock:'private'},env)).reference,'PO-1');assert.equal(sent.url,'https://converter.test/po-analyse');assert.equal(sent.options.headers.Authorization,'Bearer test-only');assert.deepEqual(JSON.parse(sent.options.body),body);}finally{globalThis.fetch=prior;}
});
test('invalid uploads and absent service are rejected before network calls',async()=>{
 await assert.rejects(analysePurchaseOrder(body,{}),/unavailable/);
 await assert.rejects(analysePurchaseOrder({...body,name:'bad.html'},env),/Choose/);
 await assert.rejects(analysePurchaseOrder({...body,data:'x'.repeat(7*1024*1024)},env),/Choose/);
 await assert.rejects(analysePurchaseOrder(body,{...env,PDF_CONVERTER_URL:'http://public.test'}),/HTTPS/);
});
test('invalid and oversized upstream results produce safe errors',async()=>{
 const prior=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('<html>not ready</html>',{status:404});await assert.rejects(analysePurchaseOrder(body,env),/unavailable/);
  globalThis.fetch=async()=>new Response('x'.repeat(512*1024+1));await assert.rejects(analysePurchaseOrder(body,env),/size limit/);
  globalThis.fetch=async()=>Response.json({lines:new Array(201).fill({})});await assert.rejects(analysePurchaseOrder(body,env),/invalid PO/);
 }finally{globalThis.fetch=prior;}
});
