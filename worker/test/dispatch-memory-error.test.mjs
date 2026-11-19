import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HttpError} from '../src/security.js';
import {originApp} from '../src/app-access.js';
const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{InventoryStore\}.*;\r?\n/m,'').replace('export default {','const worker={');
const worker=new Function('originApp','HttpError','SAFETY_READER_PATH',source+';return worker;')(originApp,HttpError,'/safety-reader/');
test('dispatch distinguishes platform memory resets without exposing internal error details or retrying a mutation',async()=>{
 for(const [error,status,code] of [[Error("Durable Object's isolate exceeded its memory limit and was reset."),503,'SERVER_MEMORY_LIMIT'],[Error('private diagnostic detail'),503,undefined],[new HttpError(403,'Permission denied'),403,undefined]]){
  let calls=0;const store={handle:async()=>{calls++;throw error;}},env={SITE_ID:'memory-response',INVENTORY:{getByName:()=>store}};
  const response=await worker.fetch(new Request('https://worker.test/dispatch/orders/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),env),body=await response.json();
  assert.equal(response.status,status);assert.equal(body.code,code);assert.equal(calls,1);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(!JSON.stringify(body).includes('private diagnostic detail'));
  if(code)assert.match(body.error,/memory limit.*No successful save was confirmed/);else if(status===503)assert.equal(body.error,'Service unavailable; please retry');
 }
});
