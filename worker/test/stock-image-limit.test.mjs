import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {stockImage,applyWorkshop} from '../src/workshop-stock.js';

const LIMIT=4*1024*1024;
const signatures={png:Buffer.from([137,80,78,71,13,10,26,10]),jpeg:Buffer.from([255,216,255]),webp:Buffer.from('RIFF\x00\x00\x00\x00WEBP','binary')};
function image(type,size){const bytes=Buffer.alloc(size);signatures[type].copy(bytes);return `data:image/${type};base64,`+bytes.toString('base64');}
const admin={username:'admin',isAdmin:true};
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});

for(const type of Object.keys(signatures))test(`${type} stock images accept the decoded 4 MiB boundary and reject one byte over`,()=>{
 for(const size of [LIMIT-1,LIMIT]){
  const value=image(type,size);assert.equal(Buffer.from(value.split(',')[1],'base64').length,size);assert.equal(stockImage(value),value);
 }
 assert.throws(()=>stockImage(image(type,LIMIT+1)),/image.*4 MB/i);
});

test('stock images still reject unsupported MIME types, malformed base64 and mismatched signatures',()=>{
 const png=image('png',100);
 for(const value of [null,42,{},'https://example.com/image.png',png.replace('image/png','image/svg+xml'),png.replace('image/png','image/jpeg'),png.replace('image/png','image/webp'),'data:image/png;base64,','data:image/png;base64,iVBORw0KGgo','data:image/png;base64,iVBORw0KGgo=!!!!','data:image/png;base64,aGVsbG8=','data:image/webp;base64,'+Buffer.from('RIFF0000NOPE').toString('base64')])assert.throws(()=>stockImage(value),/image|PNG/i);
 assert.equal(stockImage(undefined),'');assert.equal(stockImage(''),'');
});

test('oversized create and edit leave the previous stock state unchanged',()=>{
 const initial=empty(),item={category:'extrusions',unit:'lengths',name:'Angle',sku:'ANGLE',qty:4};
 assert.throws(()=>applyWorkshop(initial,{action:'create',item:{...item,image:image('png',LIMIT+1)}},admin),/4 MB/);
 assert.deepEqual(initial,empty());
 const state=applyWorkshop(initial,{action:'create',item:{...item,image:image('png',3*1024*1024)}},admin).next;
 const before=structuredClone(state);
 assert.throws(()=>applyWorkshop(state,{action:'metadata',itemId:state.items[0].id,image:image('jpeg',LIMIT+1)},admin),/4 MB/);
 assert.deepEqual(state,before);
});

test('images above the old 2 MiB limit round-trip through requests, SQLite transactions and safe retries',async()=>{
 const bundle=process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url);
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'stock-image-limits',modules:true,script:fs.readFileSync(bundle,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'stock-image-limits',MIGRATION_READY:'true'}}]}));
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');
  await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));
  await kv.put('app:variants',JSON.stringify([{id:'sheet',sku:'SHEET',color:'White',material:'ACP',thickness:4,width:2400,height:1200,qty:3}]));
  let token;
  const request=async(path,body)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  token=(await request('/login',{username:'admin',pin:'123456'})).body.token;assert.ok(token);
  const first=image('png',3*1024*1024),boundary=image('jpeg',LIMIT);
  const create={action:'create',expectedRevision:0,mutationId:randomUUID(),item:{category:'extrusions',unit:'lengths',name:'Angle',sku:'ANGLE',qty:4,image:first}};
  let result=await request('/workshop-stock',create);assert.equal(result.status,200,result.body.error);
  const id=result.body.items.find(row=>!row.legacy).id;assert.equal(result.body.items.find(row=>row.id===id).image,first);
  result=await request('/workshop-stock',create);assert.equal(result.body.duplicate,true);assert.equal(result.body.items.filter(row=>!row.legacy).length,1);
  const edit={action:'metadata',itemId:id,expectedRevision:result.body.revision,mutationId:randomUUID(),image:boundary};
  assert.ok(Buffer.byteLength(JSON.stringify(edit))<8*1024*1024);
  result=await request('/workshop-stock',edit);assert.equal(result.status,200,result.body.error);
  assert.equal(result.body.items.find(row=>row.id===id).image,boundary);assert.equal(result.body.items.find(row=>row.id===id).qty,4);
  result=await request('/workshop-stock',edit);assert.equal(result.body.duplicate,true);
  result=await request('/workshop-stock');assert.equal(result.body.items.find(row=>row.id===id).image,boundary);
  const revision=result.body.revision;
  result=await request('/workshop-stock',{...edit,expectedRevision:revision,mutationId:randomUUID(),image:image('webp',LIMIT+1)});
  assert.equal(result.status,400);assert.match(result.body.error,/4 MB/);
  result=await request('/workshop-stock');assert.equal(result.body.revision,revision);assert.equal(result.body.items.find(row=>row.id===id).image,boundary);
  result=await request('/workshop-stock',{...edit,expectedRevision:revision,mutationId:randomUUID(),image:''});assert.equal(result.status,200,result.body.error);assert.equal(result.body.items.find(row=>row.id===id).image,'');
  result=await request('/workshop-stock',{action:'metadata',itemId:'variant:sheet',expectedRevision:result.body.revision,mutationId:randomUUID(),image:boundary});assert.equal(result.status,200,result.body.error);assert.equal(result.body.items.find(row=>row.id==='variant:sheet').image,boundary);
  result=await request('/workshop-stock');assert.equal(result.body.items.find(row=>row.id==='variant:sheet').image,boundary);
 }finally{await mf.dispose();}
});
