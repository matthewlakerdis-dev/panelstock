import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PDFDocument} from 'pdf-lib';
const {IndexedOutboxStorage,Outbox}=createRequire(import.meta.url)('../../panelstock-client.modern.js');
const KEY='panelstock:outbox:v2';
const hash=value=>createHash('sha256').update(value).digest('hex');
function brokenDb(){return {transaction(){const tx={objectStore:()=>({put(){queueMicrotask(()=>tx.onabort());}}),error:Error('QuotaExceededError')};return tx;}};}
test('storage exhaustion blocks sending and further edits, retaining pending memory for export',async()=>{
 const notices=[],storage=new IndexedOutboxStorage({setItem(){throw Error('QuotaExceededError');}},(...args)=>notices.push(args));
 storage.db=brokenDb();let sent=0;
 const box=new Outbox({...storage,getItem:()=>null,setItem:storage.setItem.bind(storage),flushWrites:storage.flushWrites.bind(storage)},async()=>{sent++;});
 box.snapshot({variants:[],revision:0,restoreEpoch:0},'staff');
 box.stage({variants:[{id:'v1',qty:1}]},'staff');
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(storage.flushWrites(),/only in memory/);
 assert.equal(sent,0);assert.equal(box.pending(),true);
 assert.throws(()=>box.stage({variants:[]},'staff'),/not saved/);
 assert.ok(notices.some(([,message])=>/only in memory/.test(message)));
});
test('fallback survives IndexedDB failure and is migrated before stale IndexedDB data on reload',async()=>{
 const map=new Map(),fallback={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const storage=new IndexedOutboxStorage(fallback);storage.db=brokenDb();storage.setItem(KEY,'new pending edits');await storage.flushWrites();
 assert.equal(map.get(KEY),'new pending edits');assert.equal(storage.db,null);
 let saved='older IndexedDB state';const old=globalThis.indexedDB;
 globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={transaction(){const tx={objectStore(){return {get(){const r={};queueMicrotask(()=>{r.result=saved;r.onsuccess();});return r;},put(value){queueMicrotask(()=>{saved=value;tx.oncomplete();});}};}};return tx;}};request.onsuccess();});return request;}};
 try{const restored=await new IndexedOutboxStorage(fallback).ready();assert.equal(restored.value,'new pending edits');assert.equal(saved,'new pending edits');assert.equal(map.size,0);}finally{if(old)globalThis.indexedDB=old;else delete globalThis.indexedDB;}
});
test('Worker rejects restricted-session escapes, unassigned SWMS downloads and fictitious stock receipts',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'audit-regression',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'audit-regression',MIGRATION_READY:'true',EMAIL_ENABLED:'false',CNC_PUBLIC_TOKEN:'synthetic-share-secret'}}]}));
 const request=async(path,body,token)=>{const r=await mf.dispatchFetch('https://audit.test'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},staff:{pinHash:hash('654321:staff:panelstock')}}));
  const stock={id:'v1',catalogId:'c1',sku:'SKU1',color:'White',material:'Aluminium',thickness:3,width:1200,height:2400,qty:10};await kv.put('app:variants',JSON.stringify([stock]));
  const admin=(await request('/login',{username:'admin',pin:'123456',app:'web'})).body.token,staff=(await request('/login',{username:'staff',pin:'654321',app:'app'})).body.token;
  for(const namespace of ['/toolbox','/toolbox/self']){
   const ticket=(await request(namespace+'/session-ticket',{app:'web'},admin)).body.ticket,child=(await request(namespace+'/session',{app:'web',ticket})).body.token;
   assert.ok(child);assert.equal((await request('/session',undefined,child)).status,200);
   for(const route of ['/cnc-share','/cad/analyse','/cad/generate','/cnc-pdf/analyse','/purchase-orders/analyse'])assert.equal((await request(route,route==='/cnc-share'?undefined:{},child)).status,403,route);
  }
  assert.equal((await request('/cnc-share',undefined,admin)).status,200);
  const tx={id:randomUUID(),type:'receipt',desc:'Receipt',qty:500,itemType:'variant',sku:stock.sku,timestamp:new Date().toISOString()};
  const packet=after=>({mutationId:randomUUID(),restoreEpoch:0,changes:[{field:'variants',id:stock.id,before:stock,after},{field:'transactions',id:tx.id,before:null,after:tx}]});
  assert.equal((await request('/mutations',packet(stock),staff)).status,400);
  let snapshot=(await request('/data',undefined,staff)).body;assert.equal(snapshot.variants[0].qty,10);assert.equal(snapshot.transactions.length,0);
  assert.equal((await request('/mutations',packet({...stock,qty:510}),staff)).status,200);
  const pdf=await PDFDocument.create();pdf.addPage();const data=Buffer.from(await pdf.save()).toString('base64'),id=randomUUID();
  const uploaded=await request('/toolbox/safety-documents',{id,mutationId:randomUUID(),type:'SWMS',title:'Assigned SWMS',versionLabel:'1',fileName:'audit.pdf',data,expectedRevision:0},admin);assert.equal(uploaded.status,200);
  const ticket=(await request('/toolbox/self/session-ticket',{app:'app'},staff)).body.ticket,self=(await request('/toolbox/self/session',{ticket,app:'app'})).body.token,base='/toolbox/self/safety-documents/'+id;
  for(const [route,body]of [[base,undefined],[base+'/detail',{}],[base+'/file',{}]])assert.equal((await request(route,body,self)).status,404,route);
  assert.equal((await request('/toolbox/safety-documents/'+id+'/assignees',{expectedRevision:1,versionId:uploaded.body.version.id,usernames:['staff']},admin)).status,200);
  assert.equal((await request(base+'/file',{},self)).status,200);
  const sdsId=randomUUID();assert.equal((await request('/toolbox/safety-documents',{id:sdsId,mutationId:randomUUID(),type:'SDS',title:'Shared SDS',versionLabel:'1',fileName:'audit.pdf',data,expectedRevision:0},admin)).status,200);
  assert.equal((await request('/toolbox/self/safety-documents/'+sdsId+'/file',{},self)).status,200);
 }finally{await mf.dispose();}
});
