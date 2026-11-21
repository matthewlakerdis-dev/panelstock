import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('Capral image routes authenticate full administrators before lookup and never alter stock',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'capral-reference-access',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'capral-reference-access',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const request=async(path,body,token)=>{const response=await mf.dispatchFetch('https://reference.test'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const hash=value=>createHash('sha256').update(value).digest('hex');
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},staff:{pinHash:hash('654321:staff:panelstock')}}));
  const admin=(await request('/login',{username:'admin',pin:'123456',app:'web'})).body.token,staff=(await request('/login',{username:'staff',pin:'654321',app:'app'})).body.token;
  const ticket=(await request('/toolbox/session-ticket',{app:'web'},admin)).body.ticket,child=(await request('/toolbox/session',{app:'web',ticket},admin)).body.token;
  const before=(await request('/workshop-stock',undefined,admin)).body;
  assert.equal(before.capralReferenceLookupVersion,1);assert.equal(before.supplierReferenceLookupVersion,1);
  for(const route of ['capral','rondo','gyprock-trade'].flatMap(source=>['/stock-images/'+source+'/search','/stock-images/'+source+'/image'])){
   assert.equal((await request(route,{code:'EX1234'})).status,401);
   assert.equal((await request(route,{code:'EX1234'},staff)).status,403);
   assert.equal((await request(route,{code:'EX1234'},child)).status,403);
   const invalid=await request(route,{code:'https://example.test/private'},admin);assert.ok([400,422].includes(invalid.status));
   assert.equal((await request(route,{code:'X'.repeat(5000)},admin)).status,413);
  }
  const rejected=await request('/stock-images/capral/image',{code:'EX1234',productUrl:'https://example.test/product',imageUrl:'https://example.test/image.png'},admin);assert.ok([400,422].includes(rejected.status));
  const after=(await request('/workshop-stock',undefined,admin)).body;assert.deepEqual(after.items,before.items);assert.equal(after.revision,before.revision);assert.deepEqual(after.movements,before.movements);
 }finally{await mf.dispose();}
});

test('Capral image lookup respects stock maintenance mode',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'capral-reference-maintenance',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'capral-reference-maintenance',MIGRATION_READY:'true',READ_ONLY:'true'}}]}));
 try{
  for(const route of ['capral','rondo','gyprock-trade'].flatMap(source=>['/stock-images/'+source+'/search','/stock-images/'+source+'/image'])){
   const response=await mf.dispatchFetch('https://reference.test'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'EX1234'})});assert.equal(response.status,503);assert.match((await response.json()).error,/paused for maintenance/);
  }
 }finally{await mf.dispose();}
});
