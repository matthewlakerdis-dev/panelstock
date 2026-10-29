import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('the Worker sends streamed private files with the original and follow-up PDFs through its provider request',async()=>{
 const messages=[],keys=[],waiters=[];
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'email-files-runtime',modules:true,script:fs.readFileSync(process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:'email-files-runtime',MIGRATION_READY:'true',EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic-test-key',ORDER_FROM_EMAIL:'orders@example.com',ALLOWED_ORIGINS:'http://localhost'},outboundService:async request=>{
  assert.equal(request.url,'https://api.resend.com/emails');messages.push(await request.json());keys.push(request.headers.get('Idempotency-Key'));for(const waiter of waiters)waiter();return Response.json({id:'synthetic-provider-'+messages.length});
 }}]}));
 const waitFor=async count=>{if(messages.length>=count)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Provider request was not observed')),5000);waiters.push(()=>{if(messages.length>=count){clearTimeout(timer);resolve();}});});};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({creator:{isAdmin:true,pinHash:createHash('sha256').update('123456:creator:panelstock').digest('hex')}}));
  async function request(path,body,token){const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
  const login=await request('/login',{username:'creator',pin:'123456'});assert.equal(login.status,200);const token=login.body.token;
  assert.equal((await request('/order-email-settings',{enabled:true,recipients:['office@example.com']},token)).status,200);
  const fileId=crypto.randomUUID(),batchId=crypto.randomUUID(),created=await request('/orders',{idempotencyKey:batchId,attachmentIds:[fileId],order:{project:'Streamed email test',siteContact:'Creator',phone:'123',requestedDeliveryDate:'2026-11-03',orderType:'Fixings',items:[{quantity:1,description:'FIXINGS'}]}},token);assert.equal(created.status,201);const path='/orders/'+created.body.order.id;
  assert.equal(messages.length,0);assert.equal((await request(path+'/attachments',{id:fileId,name:'drawing.pdf',data:btoa('%PDF-private drawing')},token)).status,200);assert.equal(messages.length,0);
  const finalize={batchId,attachmentIds:[fileId]};assert.equal((await request(path+'/email-attachments',finalize,token)).status,200);await waitFor(1);
  assert.equal(messages[0].attachments.length,2);assert.match(atob(messages[0].attachments[0].content),/^%PDF/);assert.equal(messages[0].attachments[1].filename,'drawing.pdf');assert.equal(atob(messages[0].attachments[1].content),'%PDF-private drawing');assert.deepEqual(messages[0].to,['office@example.com']);
  const lateId=crypto.randomUUID(),lateBatch=crypto.randomUUID();assert.equal((await request(path+'/attachments',{id:lateId,name:'later.xlsx',data:btoa('PRIVATE EXCEL')},token)).status,200);
  const late={batchId:lateBatch,attachmentIds:[lateId]};assert.equal((await request(path+'/email-attachments',late,token)).status,200);await waitFor(2);assert.equal(messages[1].attachments.length,2);assert.equal(messages[1].attachments[1].filename,'later.xlsx');assert.equal(atob(messages[1].attachments[1].content),'PRIVATE EXCEL');assert.notEqual(keys[0],keys[1]);assert.match(messages[1].subject,/Additional files/);
  assert.equal((await request(path+'/email-attachments',late,token)).body.unchanged,true);assert.equal((await request(path+'/email-attachments',finalize,token)).body.unchanged,true);assert.equal(messages.length,2);
 }finally{await mf.dispose();}
});
