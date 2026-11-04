import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
let mf,admin,alice,bob;
async function request(path,body,token,origin){
 const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json(),headers:response.headers};
}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'share-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:'goodnotes-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:'https://site.panelstockhq.com'}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV'),users={};
 for(const [username,isAdmin]of [['admin',true],['alice',false],['bob',false]])users[username]={isAdmin,displayName:username==='alice'?'Alice Leading Hand':username,phone:'0400111222',pinHash:createHash('sha256').update('123456:'+username+':panelstock').digest('hex')};
 await kv.put('users',JSON.stringify(users));
 admin=(await request('/login',{username:'admin',pin:'123456'})).body.token;
 for(const username of ['alice','bob'])for(const taskCode of ['site.orders.view','site.orders.create'])assert.equal((await request('/admin/set-task-access',{targetUsername:username,taskCode,allowed:true},admin)).status,200);
 alice=(await request('/login',{username:'alice',pin:'123456',app:'site'})).body.token;
 bob=(await request('/login',{username:'bob',pin:'123456',app:'site'})).body.token;
 assert.ok(admin&&alice&&bob);
});
after(async()=>{await mf?.dispose();});

test('the Worker accepts a Shortcut credential only for import and normal login owns the resulting draft',async()=>{
 const setup=await request('/order-share/keys',{action:'create',label:'Test iPad'},alice,'https://site.panelstockhq.com');
 assert.equal(setup.status,200);const key=setup.body.key;
 for(const path of ['/session','/orders','/order-drafts','/order-share/keys'])assert.equal((await request(path,undefined,key)).status,401,path);
 assert.equal((await request('/orders',{order:{}},key)).status,401);
 const original=(await request('/orders',undefined,alice)).body.orders;
 const body={id:'20261104123456999-123456789',name:'Goodnotes drawing.pdf',data:btoa('%PDF-1.7\nSynthetic Goodnotes export\n%%EOF')};
 assert.equal((await request('/order-share/import',body)).status,401);
 assert.equal((await request('/order-share/import',body,alice)).status,401);
 const imported=await request('/order-share/import',body,key);
 assert.equal(imported.status,200,JSON.stringify(imported.body));assert.equal(imported.headers.get('cache-control'),'no-store');
 assert.ok(!imported.body.openUrl.includes(key));assert.ok(!imported.body.openUrl.includes(body.data));
 const id=imported.body.draftId;
 assert.equal((await request('/order-drafts/'+id,undefined,bob)).status,404);
 const loaded=await request('/order-drafts/'+id,undefined,alice);
 assert.equal(loaded.status,200);assert.equal(loaded.body.draft.order.siteContact,'Alice Leading Hand');
 assert.equal(loaded.body.draft.order.phone,'0400111222');assert.equal(loaded.body.draft.order.requestedDeliveryDate,'');
 const file=await request('/order-drafts/'+id+'/files/'+id,undefined,alice);
 assert.equal(file.body.file.data,body.data);
 assert.equal((await request('/order-drafts/'+id+'/files/'+id,undefined,bob)).status,404);
 assert.deepEqual((await request('/orders',undefined,alice)).body.orders,original);
 assert.equal((await request('/order-share/import',body,key)).body.draftId,id);
 assert.equal((await request('/order-drafts',undefined,alice)).body.drafts.length,1);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'alice',taskCode:'site.orders.create',allowed:false},admin)).status,200);
 assert.equal((await request('/order-share/import',{...body,id:crypto.randomUUID()},key)).status,403);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'alice',taskCode:'site.orders.create',allowed:true},admin)).status,200);
 alice=(await request('/login',{username:'alice',pin:'123456',app:'site'})).body.token;
 const revoke=await request('/order-share/keys',{action:'revoke',id:setup.body.keys[0].id},alice);assert.equal(revoke.status,200);
 assert.equal((await request('/order-share/import',{...body,id:crypto.randomUUID()},key)).status,401);
 assert.equal((await request('/order-drafts/'+id,undefined,alice)).status,200);
});
