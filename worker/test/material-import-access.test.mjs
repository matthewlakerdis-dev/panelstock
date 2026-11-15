import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('PDF catalogue reading requires an administrator full session without changing stock',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'material-reader-access',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'material-reader-access',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const request=async(path,body,token)=>{const response=await mf.dispatchFetch('https://material.test'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const hash=value=>createHash('sha256').update(value).digest('hex');
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},staff:{pinHash:hash('654321:staff:panelstock')}}));
  const admin=(await request('/login',{username:'admin',pin:'123456',app:'web'})).body.token,staff=(await request('/login',{username:'staff',pin:'654321',app:'app'})).body.token;
  const pdf={name:'Materials.pdf',data:btoa('%PDF-test')};
  assert.equal((await request('/material-catalogue/analyse',pdf)).status,401);
  assert.equal((await request('/material-catalogue/analyse',pdf,staff)).status,403);
  // Admin access reaches configuration validation; this fixture has no reader.
  assert.equal((await request('/material-catalogue/analyse',pdf,admin)).status,503);
  const before=(await request('/workshop-stock',undefined,admin)).body;
  const ticket=(await request('/toolbox/session-ticket',{app:'web'},admin)).body.ticket,child=(await request('/toolbox/session',{app:'web',ticket},admin)).body.token;
  assert.equal((await request('/material-catalogue/analyse',pdf,child)).status,403);
  const after=(await request('/workshop-stock',undefined,admin)).body;assert.deepEqual(after.items,before.items);assert.equal(after.revision,before.revision);
 }finally{await mf.dispose();}
});

test('PDF catalogue reading respects the production maintenance gate',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'material-reader-maintenance',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'material-reader-maintenance',MIGRATION_READY:'true',READ_ONLY:'true'}}]}));
 try{
  const response=await mf.dispatchFetch('https://material.test/material-catalogue/analyse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Materials.pdf',data:btoa('%PDF-test')})});
  assert.equal(response.status,503);assert.match((await response.json()).error,/paused for maintenance/);
 }finally{await mf.dispose();}
});
