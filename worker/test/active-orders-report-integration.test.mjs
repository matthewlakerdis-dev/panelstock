import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('authenticated active PDF export enforces view permissions, CORS and a fresh read-only snapshot',async()=>{
  const name='active-orders-report',origin='https://web.panelstockhq.com',mf=new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name,modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:name,MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:origin}}]}));
  let admin,storage;
  const fetch=(route,token=admin,body)=>mf.dispatchFetch('http://localhost'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const json=async(...args)=>{const r=await fetch(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
  const write=async(key,value)=>{await storage.exec('DELETE FROM documents WHERE key=?',key);await storage.exec('INSERT INTO documents(key,part,value) VALUES(?,0,?)',key,JSON.stringify(value));};
  const snapshot=async()=>JSON.stringify(await storage.exec("SELECT key,part,value FROM documents WHERE key NOT LIKE 'last-%' ORDER BY key,part"));
  try{
    const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify(Object.fromEntries(['admin','reader'].map(username=>[username,{isAdmin:username==='admin',pinHash:createHash('sha256').update('123456:'+username+':panelstock').digest('hex')}]))));
    admin=(await json('/login',null,{username:'admin',pin:'123456'})).token;
    storage=await mf.unsafeGetDurableObjectStorage(name,'InventoryStore',{name});
    const tasks=(await json('/admin/users',admin,{})).tasks.map(task=>task.code);await json('/admin/set-task-access',admin,{targetUsername:'reader',taskCodes:tasks,allowed:false});
    let reader=(await json('/login',null,{username:'reader',pin:'123456'})).token;
    assert.equal((await fetch('/orders/active-report.pdf',null)).status,401);assert.equal((await fetch('/orders/active-report.pdf',reader)).status,403);
    await json('/admin/set-task-access',admin,{targetUsername:'reader',taskCode:'factory.dispatch',allowed:true});reader=(await json('/login',null,{username:'reader',pin:'123456'})).token;assert.equal((await fetch('/orders/active-report.pdf',reader)).status,403);
    await json('/admin/set-task-access',admin,{targetUsername:'reader',taskCode:'site.orders.view',allowed:true});reader=(await json('/login',null,{username:'reader',pin:'123456'})).token;
    const base={project:'Synthetic report project',siteContact:'Contact',phone:'0400',orderType:'Fixings',items:[{description:'ITEM',quantity:2}],createdAt:'2026-11-17T15:00:00Z'};
    const orders=['submitted','approved','ordered','in_stock','completed','dispatched','cancelled'].map((status,i)=>({...base,id:crypto.randomUUID(),orderNumber:String(i+1),status,requestedBy:i%2?'reader':'admin',requestedDeliveryDate:'2026-11-'+String(20+i),scheduledDeliveryDate:i%2?'2026-11-25':''}));
    await write('orders',orders);await write('order-admin-notes:'+orders[0].id,[{text:'PRIVATE NOTE FOR ADMIN',author:'admin',createdAt:base.createdAt}]);
    const before=await snapshot();
    const result=await json('/orders/active-report',reader);assert.equal(result.report.orders.length,5);assert.ok(result.report.orders.every(o=>o.adminNotes.length===0));
    const r=await fetch('/orders/active-report.pdf',reader);assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'application/pdf');assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(r.headers.get('Access-Control-Expose-Headers'),'Content-Disposition');assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.match(r.headers.get('Content-Disposition'),/^attachment; filename="Active_Site_Orders_\d{4}-\d{2}-\d{2}\.pdf"$/);
    const bytes=new Uint8Array(await r.arrayBuffer());assert.equal(new TextDecoder().decode(bytes.subarray(0,5)),'%PDF-');assert.ok((await PDFDocument.load(bytes)).getPageCount()>0);assert.equal(await snapshot(),before,'Export must not update documents, notifications, email jobs, QA or dispatch');
    const filtered=await json('/orders/active-report?scope=mine&status=approved&dateFrom=2026-11-21&dateTo=2026-11-21',reader);
    assert.deepEqual(filtered.report.orders.map(order=>order.orderNumber),['2']);assert.equal(filtered.report.filters.scope,'mine');
    const filteredPdf=await fetch('/orders/active-report.pdf?scope=mine&schedule=scheduled&dateField=scheduled&dateFrom=2026-11-25&dateTo=2026-11-25',reader);assert.equal(filteredPdf.status,200);assert.equal((await PDFDocument.load(new Uint8Array(await filteredPdf.arrayBuffer()))).getSubject(),'Layout A — Compact register');
    assert.equal((await json('/orders/active-report?schedule=unscheduled',reader)).report.orders.length,3);
    for(const suffix of ['?status=dispatched','?dateFrom=2026-02-31','?scope=mine&scope=all','?username=admin'])assert.equal((await fetch('/orders/active-report.pdf'+suffix,reader)).status,400,suffix);
    assert.equal(await snapshot(),before,'Filtered exports also remain read-only');
    orders[0].status='dispatched';await write('orders',orders);assert.equal((await json('/orders/active-report',reader)).report.orders.length,4,'A later export reads current order state');
    await write('orders',[]);assert.equal((await json('/orders/active-report',admin)).report.orders.length,0);assert.equal((await fetch('/orders/active-report.pdf',admin)).status,200);
    assert.equal((await fetch('/orders/active-report.pdf?tracker=invalid',null)).status,401,'Public tracker credentials cannot grant report access');
  }finally{await mf.dispose();}
});
