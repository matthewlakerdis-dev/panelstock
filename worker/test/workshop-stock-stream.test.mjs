import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('internal stock response preserves the existing handler result and forwards all authentication context',async()=>{
 const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8'),start=source.indexOf('  async workshopStockResponse('),end=source.indexOf('  async handle(',start);
 assert.ok(start>=0&&end>start);
 const endpoint=new Function('return ({'+source.slice(start,end)+'});')(),calls=[];
 endpoint.handle=async(...args)=>{calls.push(args);return {status:403,body:{ok:false,error:'App access denied',code:'APP_ACCESS_DENIED'}};};
 let response=await endpoint.workshopStockResponse('POST',{action:'bulk_metadata'},'session-token','127.0.0.1','app');
 assert.equal(response.status,403);assert.equal(response.headers.get('Content-Type'),'application/json');
 assert.deepEqual(await response.json(),{ok:false,error:'App access denied',code:'APP_ACCESS_DENIED'});
 assert.deepEqual(calls,[['/workshop-stock','POST',{action:'bulk_metadata'},'session-token','127.0.0.1','app']]);
 endpoint.handle=async()=>({status:200,body:{ok:true,items:[{id:'one',name:'Aluminium × 3 mm'}],duplicate:true}});
 response=await endpoint.workshopStockResponse('GET',{},'token','ip');
 assert.deepEqual(await response.json(),{ok:true,items:[{id:'one',name:'Aluminium × 3 mm'}],duplicate:true});
});

test('full image stock responses stream above 32 MiB with CORS, app access, atomic prices and exact retry',async()=>{
 const bundle=process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url);
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'stock-stream',modules:true,script:fs.readFileSync(bundle,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'stock-stream',MIGRATION_READY:'true',ALLOWED_ORIGINS:'https://app.panelstockhq.com,https://web.panelstockhq.com'}}]}));
 const mobile='https://app.panelstockhq.com',web='https://web.panelstockhq.com';let token;
 const raw=(path,body,options={})=>mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:options.origin||mobile,...((options.token??token)?{Authorization:'Bearer '+(options.token??token)}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const request=async(path,body,options)=>{const response=await raw(path,body,options),text=await response.text();return {status:response.status,headers:response.headers,size:Buffer.byteLength(text),body:JSON.parse(text)};};
 const checkHeaders=headers=>{assert.equal(headers.get('Access-Control-Allow-Origin'),mobile);assert.equal(headers.get('Cache-Control'),'no-store');assert.equal(headers.get('Content-Type'),'application/json');assert.equal(headers.get('X-Content-Type-Options'),'nosniff');assert.equal(headers.get('Referrer-Policy'),'no-referrer');assert.equal(headers.get('Vary'),'Origin');};
 const hash=value=>createHash('sha256').update(value).digest('hex');
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),pinHash=user=>createHash('sha256').update('123456:'+user+':panelstock').digest('hex');
  await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:pinHash('admin')},worker:{isAdmin:false,pinHash:pinHash('worker')},webonly:{isAdmin:false,pinHash:pinHash('webonly'),appAccess:{app:false,web:true,site:false}}}));
  const variants=Array.from({length:3},(_,index)=>({id:'sheet-'+index,sku:'SHEET-'+index,color:'White',material:'ACP',thickness:3,width:2000,height:1000,qty:5}));
  await kv.put('app:variants',JSON.stringify(variants));
  let result=await request('/workshop-stock');assert.equal(result.status,401);checkHeaders(result.headers);
  result=await request('/login',{username:'admin',pin:'123456'});assert.equal(result.status,200,result.body.error);token=result.body.token;assert.ok(token);
  const workerToken=(await request('/login',{username:'worker',pin:'123456'})).body.token;
  const webToken=(await request('/login',{username:'webonly',pin:'123456'},{origin:web})).body.token;assert.ok(webToken);
  const denied=await request('/workshop-stock',undefined,{token:webToken});assert.equal(denied.status,403);assert.equal(denied.body.code,'APP_ACCESS_DENIED');checkHeaders(denied.headers);
  assert.equal((await request('/workshop-stock',undefined,{token:webToken,origin:web})).status,200);
  const expected=new Map();
  for(let index=0;index<3;index++){
   const bytes=Buffer.alloc(4*1024*1024,index+1);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
   const image='data:image/png;base64,'+bytes.toString('base64');expected.set('variant:sheet-'+index,{length:image.length,hash:hash(image)});
   result=await request('/workshop-stock',{action:'metadata',itemId:'variant:sheet-'+index,image,expectedRevision:index,mutationId:randomUUID()});
   assert.equal(result.status,200,result.body.error);assert.equal(result.body.revision,index+1);checkHeaders(result.headers);
  }
  assert.ok(result.size>32*1024*1024);
  const checkImages=body=>{for(const [id,image] of expected){const row=body.items.find(item=>item.id===id);assert.equal(row.image.length,image.length);assert.equal(hash(row.image),image.hash);assert.equal(hash(body.metadata[id].image),image.hash);assert.equal(row.qty,5);}};
  checkImages(result.body);
  result=await request('/workshop-stock');assert.equal(result.status,200,result.body.error);assert.ok(result.size>32*1024*1024);checkImages(result.body);
  const bulk={action:'bulk_metadata',itemIds:variants.map(row=>'variant:'+row.id),changes:{unitCost:12.34},expectedRevision:3,mutationId:randomUUID()};
  const lost=await raw('/workshop-stock',bulk);assert.equal(lost.status,200);await lost.body.cancel();
  result=await request('/workshop-stock',bulk);assert.equal(result.status,200,result.body.error);assert.equal(result.body.duplicate,true);assert.equal(result.body.revision,4);assert.ok(result.size>32*1024*1024);checkImages(result.body);checkHeaders(result.headers);
  assert.ok(result.body.items.every(row=>row.unitCost===12.34));assert.equal(result.body.movements.filter(row=>row.action==='bulk_metadata').length,3);
  const history=await request('/data');assert.equal(history.body.transactions.filter(row=>row.type==='workshop').length,6);
  result=await request('/workshop-stock',{...bulk,changes:{unitCost:99}});assert.equal(result.status,409);assert.match(result.body.error,/reused/);checkHeaders(result.headers);
  result=await request('/workshop-stock',{...bulk,mutationId:randomUUID()});assert.equal(result.status,409);assert.match(result.body.error,/stock changed/);
  result=await request('/workshop-stock',{...bulk,mutationId:randomUUID(),expectedRevision:4,changes:{unitCost:-1}});assert.equal(result.status,400);
  result=await request('/workshop-stock',{...bulk,mutationId:randomUUID(),expectedRevision:4},{token:workerToken});assert.equal(result.status,403);checkHeaders(result.headers);
  result=await request('/workshop-stock');assert.equal(result.body.revision,4);assert.ok(result.body.items.every(row=>row.unitCost===12.34));assert.equal(result.body.movements.length,6);checkImages(result.body);
 }finally{await mf.dispose();}
});
