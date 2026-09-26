import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HttpError} from '../src/security.js';
import {cadRequest} from '../src/cad-api.js';
const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{InventoryStore\}.*;\r?\n/m,'').replace('export default {','const worker={');
function harness(access){const calls=[];const worker=new Function('HttpError','cadRequest',source+';return worker;')(HttpError,async(path,body)=>{calls.push({path,body});return {ok:true};});const env={INVENTORY:{getByName:()=>({handle:async()=>access})}};return {worker,env,calls};}
test('CAD routes require verified factory access before reading input',async()=>{
 for(const [access,status] of [[{status:401,body:{error:'Login required'}},401],[{status:200,body:{isAdmin:false,taskAccess:{}}},403]]){
  const h=harness(access);const r=await h.worker.fetch(new Request('https://example/cad/generate',{method:'POST',body:'bad json'}),h.env);assert.equal(r.status,status);assert.equal(h.calls.length,0);
 }
});
test('CAD generation forwards only authenticated bounded JSON and respects maintenance',async()=>{
 const h=harness({status:200,body:{taskAccess:{'factory.cnc':true}}});
 const r=await h.worker.fetch(new Request('https://example/cad/generate',{method:'POST',body:'{"panelId":"Z3-130"}'}),h.env);assert.equal(r.status,200);assert.equal(h.calls[0].body.panelId,'Z3-130');
 const over=await h.worker.fetch(new Request('https://example/cad/generate',{method:'POST',body:'x'.repeat(10*1024*1024+1)}),h.env);assert.equal(over.status,413);assert.equal(h.calls.length,1);
 h.env.READ_ONLY='true';assert.equal((await h.worker.fetch(new Request('https://example/cad/generate',{method:'POST',body:'{}'}),h.env)).status,503);
});
test('converter missing configuration fails explicitly',async()=>{await assert.rejects(cadRequest('/cad/generate',{},{}),{status:503});});

test('combined DXF payload above 128 KB reaches converter unchanged',async()=>{
 const h=harness({status:200,body:{taskAccess:{'factory.cnc':true}}});
 const drawings=['0\nSECTION\n'.repeat(20000)];
 const r=await h.worker.fetch(new Request('https://example/cad/generate',{method:'POST',body:JSON.stringify({drawings})}),h.env);
 assert.equal(r.status,200);assert.deepEqual(h.calls[0].body.drawings,drawings);
});
