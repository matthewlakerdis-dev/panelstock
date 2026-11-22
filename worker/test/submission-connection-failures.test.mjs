import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {File} from 'node:buffer';
import {createHash,randomUUID,webcrypto} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const outboxKey='panelstock:site-orders:outbox:v1';
const order={project:'Synthetic connection test',orderType:'Fixings',siteContact:'Synthetic contact',phone:'0400000000',requestedDeliveryDate:'2099-12-01',items:[{quantity:3,description:'FIXING PACK'}],locationNotes:'Keep the original delivery details'};
const packet=(files=[])=>({localId:randomUUID(),idempotencyKey:randomUUID(),order:structuredClone(order),attachments:files.map(({file,...metadata})=>metadata),createdAt:new Date().toISOString()});

async function backend(t){
 const name='submission-faults-'+randomUUID();
 const mf=new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name,modules:true,script:fs.readFileSync(process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:name,MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 t.after(()=>mf.dispose());
 const kv=await mf.getKVNamespace('LEGACY_KV');
 await kv.put('users',JSON.stringify(Object.fromEntries(['alice','bob'].map(username=>[username,{isAdmin:true,pinHash:createHash('sha256').update('123456:'+username+':panelstock').digest('hex')}]))));
 const raw=(path,options={},token)=>mf.dispatchFetch('http://localhost'+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...options.headers}});
 const post=async(path,body,token)=>{const response=await raw(path,{method:'POST',body:JSON.stringify(body)},token);return {status:response.status,body:await response.json()};};
 const tokens={};for(const username of ['alice','bob']){const response=await post('/login',{username,pin:'123456'});assert.equal(response.status,200);tokens[username]=response.body.token;}
 const storage=await mf.unsafeGetDurableObjectStorage(name,'InventoryStore',{name});
 const read=async(key,fallback=null)=>{const rows=await storage.exec('SELECT value FROM documents WHERE key=? ORDER BY part',key);return rows.length?JSON.parse(rows.map(row=>row.value).join('')):fallback;};
 const write=async(key,value)=>{const text=JSON.stringify(value);await storage.exec('DELETE FROM documents WHERE key=?',key);for(let i=0;i<text.length;i+=100000)await storage.exec('INSERT INTO documents(key,part,value) VALUES(?,?,?)',key,i/100000,text.slice(i,i+100000));};
 // Queue real jobs but prevent every provider call, including background waitUntil work.
 await write('order-email-config',{enabled:true,recipients:['synthetic@example.invalid']});
 return {mf,storage,read,write,tokens,post,raw,api:(path,options)=>raw(path,options,tokens.alice)};
}

function client(server,{saved=new Map(),files=new Map(),transport=server.api}={}){
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 const node={innerHTML:'',appendChild(){},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]};
 const context={console,URL,Headers,Response,AbortSignal,Map,Set,Date,Promise,Uint8Array,File,
  FileReader:class{readAsDataURL(file){file.arrayBuffer().then(bytes=>{this.result='data:application/octet-stream;base64,'+Buffer.from(bytes).toString('base64');this.onload();}).catch(()=>this.onerror());}},
  document:{getElementById:()=>node,createElement:()=>({textContent:''}),head:node,body:node,querySelectorAll:()=>[]},localStorage:storage,sessionStorage:storage,navigator:{onLine:true},window:{addEventListener(){}},MutationObserver:class{observe(){}},crypto:{subtle:webcrypto.subtle,randomUUID}};
 let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
 source=source.split("  window.addEventListener('online'")[0]+`
  session={username:'alice',token:'synthetic-session',taskAccess:{'site.orders.view':true,'site.orders.create':true}};
  globalThis.ui={flush,seed(queue){outbox={owner:'alice',queue};saveOutbox();},setApi(fn){api=fn;},setStorage(fn){attachmentDb=fn;},
   setup(){render=()=>{};refresh=async()=>{};loadOrderHistory=()=>{};loadProductionProgress=()=>{};},snapshot:()=>({outbox,message,busy})};
 })();`;
 vm.runInNewContext(source,context);const ui=context.ui;ui.setup();ui.setApi(transport);
 ui.setStorage(async(action,values)=>{if(action==='get')return files.get(values);for(const value of values){if(action==='delete')files.delete(value.id);else files.set(value.id,value.file);}});
 return {...ui,saved,files,durable:()=>JSON.parse(saved.get(outboxKey))};
}

async function assertOneOrder(server,idempotencyKey){
 const orders=await server.read('orders',[]);assert.equal(orders.length,1);const saved=orders[0];
 assert.deepEqual(saved.items,order.items);assert.equal(saved.locationNotes,order.locationNotes);
 const mutations=await server.storage.exec('SELECT id,username,order_id FROM order_mutations');assert.equal(mutations.length,1);assert.equal(mutations[0].id,idempotencyKey);assert.equal(mutations[0].order_id,saved.id);
 assert.equal((await server.storage.exec("SELECT count(*) AS count FROM audit WHERE action='order-created'"))[0].count,1);
 assert.deepEqual(await server.read('order-email-jobs'),[saved.id]);const job=await server.read('order-email:'+saved.id);assert.equal(job.attempts,0);assert.equal(job.providerId,undefined);
 return saved;
}

test('the real Site outbox retains the exact request before send and confirms a lost committed Worker response without duplicate writes',async t=>{
 const server=await backend(t),value=packet(),posts=[];let phase='before';
 const transport=async(path,options)=>{
  if(path==='/orders'&&options?.method==='POST'){
   posts.push(options.body);assert.equal(JSON.parse(h.saved.get(outboxKey)).queue[0].idempotencyKey,value.idempotencyKey,'The original request must already be durable before the network write');
   if(phase==='before')throw TypeError('Synthetic connection dropped before send');
   const response=await server.api(path,options);await response.body.cancel();throw TypeError('Synthetic reply dropped after durable commit');
  }
  return server.api(path,options);
 };
 const h=client(server,{transport});h.seed([value]);await h.flush();
 assert.equal((await server.read('orders',[])).length,0);assert.equal(h.durable().queue.length,1);assert.equal(h.durable().queue[0].idempotencyKey,value.idempotencyKey);assert.deepEqual(h.durable().queue[0].order,order);
 phase='after';const resumed=client(server,{saved:h.saved,files:h.files,transport});await resumed.flush();
 assert.deepEqual(posts,[posts[0],posts[0]]);assert.equal(resumed.durable().queue.length,0);
 const committed=await assertOneOrder(server,value.idempotencyKey);assert.equal(resumed.snapshot().outbox.queue.length,0);assert.equal(committed.status,'submitted');
});

test('an unavailable confirmation preserves a committed Site request across reload, and another account cannot claim its result',async t=>{
 const server=await backend(t),value=packet(),posts=[];let unavailable=true;
 const transport=async(path,options)=>{
  if(path==='/orders'&&options?.method==='POST'){posts.push(options.body);const response=await server.api(path,options);if(unavailable){await response.body.cancel();throw TypeError('Synthetic committed reply lost');}return response;}
  if(path==='/orders/submission-status'&&unavailable)throw TypeError('Synthetic confirmation unavailable');
  return server.api(path,options);
 };
 const h=client(server,{transport});h.seed([value]);await h.flush();const first=await assertOneOrder(server,value.idempotencyKey);
 assert.equal(h.durable().queue.length,1);assert.equal(h.durable().queue[0].orderId,undefined);assert.deepEqual(h.durable().queue[0].order,order);
 const before=await server.read('orders');assert.equal((await server.post('/orders/submission-status',{idempotencyKey:value.idempotencyKey},server.tokens.bob)).status,409);assert.equal((await server.post('/orders',JSON.parse(posts[0]),server.tokens.bob)).status,409);assert.deepEqual(await server.read('orders'),before);
 unavailable=false;const resumed=client(server,{saved:h.saved,transport});await resumed.flush();assert.deepEqual(posts,[posts[0],posts[0]]);assert.equal(resumed.durable().queue.length,0);assert.equal((await assertOneOrder(server,value.idempotencyKey)).id,first.id);
});

test('a real SQLite failure rolls back a staged Site order, numbering and email job before an identical retry commits once',async t=>{
 const server=await backend(t),value=packet(),posts=[];
 const transport=async(path,options)=>{if(path==='/orders'&&options?.method==='POST')posts.push(options.body);return server.api(path,options);};
 await server.storage.exec("CREATE TRIGGER fail_site_mutation BEFORE INSERT ON order_mutations BEGIN SELECT RAISE(ABORT,'synthetic interrupted commit'); END");
 const h=client(server,{transport});h.seed([value]);await h.flush();
 assert.deepEqual(await server.read('orders',[]),[]);assert.deepEqual(await server.read('order-project-sequences',{}),{});assert.deepEqual(await server.read('order-email-jobs',[]),[]);assert.equal((await server.storage.exec('SELECT count(*) AS count FROM order_mutations'))[0].count,0);assert.equal((await server.storage.exec("SELECT count(*) AS count FROM audit WHERE action='order-created'"))[0].count,0);assert.equal(h.durable().queue[0].idempotencyKey,value.idempotencyKey);
 await server.storage.exec('DROP TRIGGER fail_site_mutation');const resumed=client(server,{saved:h.saved,transport});await resumed.flush();assert.deepEqual(posts,[posts[0],posts[0]]);assert.equal(resumed.durable().queue.length,0);assert.equal((await assertOneOrder(server,value.idempotencyKey)).orderNumber,'1');
});

test('a lost real R2 attachment reply is reconciled after reload without a second upload, another email job or missing original bytes',async t=>{
 const server=await backend(t),bytes=Buffer.from('synthetic original photo bytes'),file=new File([bytes],'connection-photo.jpg'),metadata={id:randomUUID(),name:file.name,size:file.size,file},value=packet([metadata]);let uploads=0;
 const transport=async(path,options)=>{const response=await server.api(path,options);if(path.endsWith('/attachments')&&options?.method==='POST'){uploads++;await response.body.cancel();throw TypeError('Synthetic upload acknowledgement lost');}return response;};
 const h=client(server,{files:new Map([[metadata.id,file]]),transport});h.seed([value]);await h.flush();const committed=await assertOneOrder(server,value.idempotencyKey);assert.equal(committed.attachments.length,1);assert.equal(h.durable().queue[0].attachments[0].uploaded,undefined);assert.equal((await server.read('order-email:'+committed.id)).status,'waiting_files');
 const resumed=client(server,{saved:h.saved,files:new Map(),transport});await resumed.flush();assert.equal(uploads,1);assert.equal(resumed.durable().queue.length,0);const saved=await assertOneOrder(server,value.idempotencyKey);assert.equal(saved.attachments.length,1);assert.equal((await server.read('order-email:'+saved.id)).status,'queued');assert.equal((await server.storage.exec("SELECT count(*) AS count FROM audit WHERE action='order-attachment-added'"))[0].count,1);
 const download=await server.api('/orders/'+saved.id+'/attachments/'+metadata.id);assert.equal(download.status,200);const result=await download.json();assert.deepEqual(Buffer.from(result.file.data,'base64'),bytes);assert.equal(result.file.sha256,createHash('sha256').update(bytes).digest('hex'));
});
