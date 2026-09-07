import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HttpError} from '../src/security.js';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace(/^export \{InventoryStore\}.*;\r?\n/m,'')
  .replace('export default {','const worker={');
function harness(isAdmin=true){
  const forwarded=[];
  const {worker,readBody,MAX_BODY,MAX_PDF_BODY}=new Function('HttpError','fetch',source+';return {worker,readBody,MAX_BODY,MAX_PDF_BODY};')(HttpError,async(url,options)=>{
    assert.equal(url,'https://converter.example/analyse-cnc');
    forwarded.push(options.body.byteLength);
    return Response.json({pages:[{pageNumber:1}]});
  });
  const env={PDF_CONVERTER_URL:'https://converter.example',PDF_CONVERTER_TOKEN:'synthetic-token',INVENTORY:{getByName:()=>({handle:async()=>({status:200,body:{isAdmin}}),readPublicCncSettings:async()=>({minimumOffcutSizeMm:1,cutEdgeAllowanceMm:10})})}};
  return {worker,env,forwarded,readBody,MAX_BODY,MAX_PDF_BODY};
}
function pdfBody(size){const bytes=Buffer.alloc(size,32);bytes.write('%PDF-1.7\n');return JSON.stringify({pdf:'data:application/pdf;base64,'+bytes.toString('base64')});}

test('7 MB and boundary-size 8 MB PDFs reach the converter without changing their bytes',async()=>{
  const h=harness();
  for(const size of [7*1024*1024,8*1024*1024-1,8*1024*1024]){
    const body=pdfBody(size),request=new Request('https://worker.example/cnc-pdf/analyse',{method:'POST',body,headers:{'Content-Length':String(Buffer.byteLength(body))}});
    const response=await h.worker.fetch(request,h.env);
    assert.equal(response.status,200,await response.text());
    assert.equal(h.forwarded.at(-1),size);
  }
});
test('PDF raw size remains bounded and non-admin uploads never reach analysis',async()=>{
  const h=harness(),request=new Request('https://worker.example/cnc-pdf/analyse',{method:'POST',body:pdfBody(8*1024*1024+1)});
  const response=await h.worker.fetch(request,h.env);
  assert.equal(response.status,413);assert.match((await response.json()).error,/8 MB/);assert.deepEqual(h.forwarded,[]);
  const denied=harness(false);
  assert.equal((await denied.worker.fetch(new Request('https://worker.example/cnc-pdf/analyse',{method:'POST',body:'not json'}),denied.env)).status,403);
  assert.deepEqual(denied.forwarded,[]);
});
test('encoded upload and ordinary request limits reject both declared and streamed excess',async()=>{
  const h=harness();
  for(const limit of [h.MAX_BODY,h.MAX_PDF_BODY]){
    await assert.rejects(h.readBody(new Request('https://worker.example',{method:'POST',body:'{}',headers:{'Content-Length':String(limit+1)}}),limit),{status:413});
    let cancelled=false;
    const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
    await assert.rejects(h.readBody(new Request('https://worker.example',{method:'POST',body,duplex:'half'}),limit),{status:413});
    assert.equal(cancelled,true);
  }
  assert.equal(h.MAX_BODY,8*1024*1024);
});
