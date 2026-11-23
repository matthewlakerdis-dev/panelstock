import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('stock and receiving can defer a production-sized image library while authorized lazy images, saves and exact retries preserve originals',async()=>{
 let bundle=fs.readFileSync(process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url),'utf8');
 const defaultName=bundle.match(/(\w+) as default\s*\n?\}/)?.[1];assert.ok(defaultName);
 bundle+=`
 // Local fixture only: prove deferred reads never call the full stock parser.
 const fullStockTestRead=InventoryStore.prototype.read;
 InventoryStore.prototype.read=function(key,...rest){if(key==='workshop-stock'&&this._rejectFullStockTestRead)throw Error('A deferred request parsed the full stock library');return fullStockTestRead.call(this,key,...rest);};
 InventoryStore.prototype.localStockTest=function(action,input){
  if(action==='guard'){this._rejectFullStockTestRead=input.block;return true;}
  if(action==='receipt'){if(!/^[a-f0-9-]{36}$/.test(input.id))throw Error('Invalid fixture receipt');return this.read((input.kind==='po'?'purchase-order-mutation:':'workshop-mutation:')+input.id);}
  if(action==='parts'){if(!Number.isSafeInteger(input.offset)||input.offset<0)throw Error('Invalid fixture offset');return this.sql.exec('SELECT value FROM documents WHERE key=? AND part>=? ORDER BY part LIMIT 16','workshop-stock',input.offset).toArray();}
  throw Error('Unknown local fixture operation');
 };
 const fullStockTestFetch=${defaultName}.fetch;
 ${defaultName}.fetch=async function(request,env,ctx){
  if(new URL(request.url).pathname!=='/__local_stock_test')return fullStockTestFetch.call(this,request,env,ctx);
  const input=await request.json(),store=env.INVENTORY.getByName(env.SITE_ID);
  if(input.action==='seed'){for(const [key,value]of Object.entries(input.documents))await store.write(key,value);return Response.json({ok:true});}
  return Response.json(await store.localStockTest(input.action,input));
 };
 `;
 const name='stock-deferred-runtime',mobile='https://app.panelstockhq.com',web='https://web.panelstockhq.com';
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name,modules:true,script:bundle,compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:name,MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:mobile+','+web}}]}));
 let token='';
 const request=async(path,body,options={})=>{const started=Date.now(),response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:options.origin||mobile,...((options.token??token)?{Authorization:'Bearer '+(options.token??token)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text(),result=JSON.parse(text);return {status:response.status,headers:response.headers,size:Buffer.byteLength(text),body:result,elapsedMs:Date.now()-started};};
 const ok=async(...args)=>{const result=await request(...args);assert.ok(result.status<300,JSON.stringify(result.body));return result;};
 const control=async(action,extra={})=>(await ok('/__local_stock_test',{action,...extra})).body;
 const compact=result=>{assert.equal(result.status,200);assert.ok(result.size<1000000,'Routine stock/PO responses must stay below 1 MB');assert.equal(JSON.stringify(result.body).includes('data:image/'),false);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(result.headers.get('Access-Control-Allow-Origin'),mobile);return result.body;};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),users={};for(const username of ['admin','receiver','stock','denied','webonly'])users[username]={isAdmin:username==='admin',pinHash:hash('123456:'+username+':panelstock'),...(username==='webonly'?{appAccess:{app:false,web:true,site:false}}:{})};await kv.put('users',JSON.stringify(users));
  token=(await ok('/login',{username:'admin',pin:'123456'})).body.token;
  for(const [username,stock,receive]of [['receiver',false,true],['stock',true,false],['denied',false,false],['webonly',true,false]]){await ok('/admin/set-task-access',{targetUsername:username,taskCode:'factory.stock',allowed:stock});await ok('/admin/set-task-access',{targetUsername:username,taskCode:'factory.receive',allowed:receive});}
  const tokens={};for(const username of ['receiver','stock','denied'])tokens[username]=(await ok('/login',{username,pin:'123456'})).body.token;
  tokens.webonly=(await ok('/login',{username:'webonly',pin:'123456'},{origin:web})).body.token;
  await control('guard',{block:true});assert.deepEqual(compact(await ok('/workshop-stock?images=deferred')).items,[]);assert.deepEqual(compact(await ok('/purchase-orders?images=deferred')).orders,[]);await control('guard',{block:false});
  const metadata={},variants=[],images=new Map();for(let index=0;index<5;index++){const bytes=Buffer.alloc(4*1024*1024,index+1);bytes.set([137,80,78,71,13,10,26,10]);const image='data:image/png;base64,'+bytes.toString('base64'),id='sheet-'+index;metadata['variant:'+id]={image,name:'Original sheet '+index};variants.push({id,sku:'SHEET-'+index,color:'White',material:'ACP',thickness:3,width:2400,height:1200,qty:5});images.set('variant:'+id,hash(image));}
  metadata['offcut:hidden']={image:''};metadata['variant:missing']={image:png};
  const orderId=randomUUID(),workshop={revision:7,items:[{id:'manual',sku:'MANUAL',name:'Manual stock',category:'fixings',unit:'each',qty:10,reservations:{},unitCost:12.34,image:png},{id:'archived',sku:'OLD',name:'Archived',category:'fixings',unit:'each',qty:0,reservations:{},image:png,archivedAt:'2026-01-01T00:00:00Z'}],metadata,movements:[],purchaseOrders:[{id:orderId,version:1,status:'draft',reference:'PRIVATE-DRAFT',supplier:'Supplier',lines:[],attachments:[],receipts:[]}],poStockReferences:[{key:'private',itemId:'manual',source:{sku:'PRIVATE-SUPPLIER'}}]};assert.ok(JSON.stringify(workshop).length>27800000);
  await control('seed',{documents:{'workshop-stock':workshop,'app:variants':variants,'app:offcuts':[{id:'hidden',color:'White',material:'ACP',thickness:3,width:500,height:500,qty:1,image:png},{id:'visible',color:'White',material:'ACP',thickness:3,width:600,height:600,qty:1,image:png}]}});
  await control('guard',{block:true});
  const stockResponse=await request('/workshop-stock?images=deferred'),stock=compact(stockResponse);console.log('Deferred stock numeric timing: '+JSON.stringify({elapsedMs:stockResponse.elapsedMs,bytes:stockResponse.size}));assert.equal(stock.revision,7);assert.equal(stock.stockReferences[0].source.sku,'PRIVATE-SUPPLIER');assert.equal(stock.items.find(row=>row.id==='variant:sheet-0').hasImage,true);assert.equal(stock.items.find(row=>row.id==='variant:sheet-0').imageVersion,7);assert.equal(stock.items.find(row=>row.id==='manual').image,undefined);assert.equal(stock.metadata['variant:sheet-0'].image,undefined);assert.equal(stock.items.find(row=>row.id==='offcut:hidden').hasImage,false);
  const receivingResponse=await request('/purchase-orders?images=deferred',undefined,{token:tokens.receiver}),receiving=compact(receivingResponse);console.log('Deferred receiving numeric timing: '+JSON.stringify({elapsedMs:receivingResponse.elapsedMs,bytes:receivingResponse.size}));assert.deepEqual(receiving.orders,[]);assert.deepEqual(receiving.stockReferences,[]);assert.equal(receiving.stockImageRevision,7);assert.equal(receiving.restoreEpoch,0);assert.equal(receiving.items.find(row=>row.id==='manual').unitCost,12.34);
  assert.equal((await request('/workshop-stock?images=deferred',undefined,{token:tokens.receiver})).status,403);assert.equal((await request('/purchase-orders?images=deferred',undefined,{token:tokens.stock})).status,403);
  for(const itemId of ['manual','variant:sheet-0','offcut:visible']){const image=await request('/workshop-stock/images/'+encodeURIComponent(itemId),undefined,{token:tokens.receiver});assert.equal(image.status,200);assert.equal(image.body.itemId,itemId);assert.equal(hash(image.body.image),images.get(itemId)||hash(png));assert.equal(image.body.imageVersion,7);assert.equal(image.headers.get('Cache-Control'),'no-store');if(itemId==='variant:sheet-0')console.log('Lazy stock image numeric timing: '+JSON.stringify({elapsedMs:image.elapsedMs,bytes:image.size}));}
  for(const itemId of ['archived','variant:missing','offcut:hidden','unknown'])assert.equal((await request('/workshop-stock/images/'+encodeURIComponent(itemId))).status,404);
  assert.equal((await request('/workshop-stock/images/manual',undefined,{token:''})).status,401);assert.equal((await request('/workshop-stock/images/manual',undefined,{token:tokens.denied})).status,403);const wrongApp=await request('/workshop-stock/images/manual',undefined,{token:tokens.webonly});assert.equal(wrongApp.status,403);assert.equal(wrongApp.body.code,'APP_ACCESS_DENIED');
  await control('guard',{block:false});
  const mutation={action:'bulk_metadata',itemIds:['manual'],changes:{unitCost:0},expectedRevision:7,mutationId:randomUUID()};const changed=compact(await ok('/workshop-stock?images=deferred',mutation));assert.equal(changed.items.find(row=>row.id==='manual').unitCost,0);assert.equal((await control('receipt',{kind:'stock',id:mutation.mutationId})).payload,JSON.stringify(mutation));
  await control('guard',{block:true});assert.equal(compact(await ok('/workshop-stock?images=deferred',mutation)).duplicate,true);
  await control('guard',{block:false});const po={action:'save',orderId,expectedVersion:1,reference:'PRIVATE-DRAFT',supplier:'Supplier',lines:[{itemId:'manual',ordered:3}],restoreEpoch:0,mutationId:randomUUID()};const poSaved=compact(await ok('/purchase-orders?images=deferred',po));assert.equal(poSaved.orders[0].version,2);assert.equal((await control('receipt',{kind:'po',id:po.mutationId})).payload,JSON.stringify(po));
  await control('guard',{block:true});assert.equal(compact(await ok('/purchase-orders?images=deferred',po)).duplicate,true);
  await control('guard',{block:false});const file={id:randomUUID(),name:'PO.pdf',data:btoa('%PDF-1.7\nSynthetic document'),restoreEpoch:0};compact(await ok('/purchase-orders/'+orderId+'/files?images=deferred',file));await control('guard',{block:true});compact(await ok('/purchase-orders/'+orderId+'/files?images=deferred',file));const downloaded=await ok('/purchase-orders/'+orderId+'/files/'+file.id+'?images=deferred');assert.equal(downloaded.body.file.data,file.data);
  const chunks=[];for(let offset=0;;offset+=16){const parts=await control('parts',{offset});if(!parts.length)break;assert.ok(parts.length<=16);for(const row of parts)chunks.push(row.value);}const canonical=JSON.parse(chunks.join(''));for(const [id,digest]of images)assert.equal(hash(canonical.metadata[id].image),digest);assert.equal(canonical.items[0].image,png);assert.equal(canonical.metadata['offcut:hidden'].image,'');assert.equal(canonical.items[0].qty,10);assert.equal(canonical.items[0].unitCost,0);assert.equal(canonical.purchaseOrders[0].attachments.length,1);
  await control('guard',{block:false});const legacy=await ok('/workshop-stock');assert.ok(legacy.size>50000000);assert.equal(hash(legacy.body.items.find(row=>row.id==='variant:sheet-0').image),images.get('variant:sheet-0'));assert.equal(hash(legacy.body.metadata['variant:sheet-0'].image),images.get('variant:sheet-0'));
 }finally{await mf.dispose();}
});
