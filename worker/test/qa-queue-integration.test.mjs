import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash} from 'node:crypto';
import fs from 'node:fs';

const site='qa-queue-test',origin='https://app.panelstockhq.com',photo='data:image/png;base64,aGVsbG8=',addedPhoto='data:image/jpeg;base64,d29ybGQ=',sha=value=>createHash('sha256').update(value).digest('hex'),reference=value=>'qa-r2:v1:'+sha(value)+':'+value.length,stalledSha='b'.repeat(64),stalledRef='qa-r2:v1:'+stalledSha+':100';
let mf,storage,admin,team,viewer,checks,records;
async function request(path,body,token=team){
 const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,headers:response.headers,body:await response.json()};
}
const login=async(username,pin)=>(await request('/login',{username,pin},null)).body.token;
async function save(key,value){await storage.exec('DELETE FROM documents WHERE key=?',key);await storage.exec('INSERT INTO documents(key,part,value) VALUES(?,0,?)',key,JSON.stringify(value));}
async function raw(key){return (await storage.exec('SELECT value FROM documents WHERE key=? ORDER BY part',key)).map(row=>row.value).join('');}
const manual=(id,extra={})=>({id,kind:'metalwork',project:'Queue project',orderNumber:'1',reference:id,quantity:1,fabricatedBy:'fabricator',createdBy:'admin',createdAt:'2026-11-23T00:00:00Z',status:'awaiting',latest:null,history:[],...extra});
before(async()=>{
 // Keep the real Worker, auth, routes and store. Only the test DO's private
 // bucket adapter makes one unrelated evidence lookup deliberately never settle.
 const original=fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),script=original+`\nexport class QaQueueProbe extends InventoryStore {constructor(ctx,env){const bucket=env.CAD_PROJECT_FILES;super(ctx,{...env,CAD_PROJECT_FILES:{head:(...args)=>bucket.head(...args),put:(...args)=>bucket.put(...args),get:(key,...args)=>key.endsWith('${stalledSha}')?new Promise(()=>{}):bucket.get(key,...args)}});}}`;
 mf=new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name:site,modules:true,script,compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'QaQueueProbe',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:site,QA_MEDIA_ENABLED:'true',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:origin}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV'),users={};for(const [username,pin,isAdmin]of [['admin','123456',true],['qa-team','654321',false],['viewer','456789',false]])users[username]={isAdmin,pinHash:sha(`${pin}:${username}:panelstock`)};await kv.put('users',JSON.stringify(users));
 admin=await login('admin','123456');const tasks=(await request('/admin/users',{},admin)).body.tasks.map(task=>task.code);
 for(const targetUsername of ['qa-team','viewer'])assert.equal((await request('/admin/set-task-access',{targetUsername,taskCodes:tasks,allowed:false},admin)).status,200);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'qa-team',taskCode:'factory.qa',allowed:true},admin)).status,200);team=await login('qa-team','654321');viewer=await login('viewer','456789');
 checks=(await request('/qa/queue')).body.checklists;storage=await mf.unsafeGetDurableObjectStorage(site,'QaQueueProbe',{name:site});
 const bucket=await mf.getR2Bucket('CAD_PROJECT_FILES');for(const value of [photo,addedPhoto])await bucket.put('qa-evidence/v1/'+site+'/'+sha(value),value,{customMetadata:{sha256:sha(value)}});
 const results=Object.fromEntries(checks.metalwork.map(([key])=>[key,'pass'])),attempt={id:'saved-attempt',status:'approved',results,notes:'Keep original inspection notes',photo:reference(photo),photos:[reference(photo)],checkedBy:'original-inspector',checkedAt:'2026-11-23T00:00:00Z'},addition={id:'saved-addition',attemptId:attempt.id,photos:[reference(addedPhoto)],addedBy:'photo-contributor',addedAt:'2026-11-23T00:01:00Z',mutationId:'saved-mutation'};
 records=[manual('selected / piece?',{status:'approved',latest:attempt,history:[attempt],photoAdditions:[addition]}),manual('stalled-unrelated',{status:'approved',latest:{...attempt,id:'stalled-attempt',photo:stalledRef,photos:[stalledRef]},history:[{...attempt,id:'stalled-attempt',photo:stalledRef,photos:[stalledRef]}]}),manual('legacy-rework',{status:'rework',latest:{...attempt,id:'legacy-attempt',status:'rework',photo},history:[{...attempt,id:'legacy-attempt',status:'rework',photo}]}),manual('pending-save')];
 await save('qa-checks',records);await save('qa-dispatches',[{id:'saved-dispatch',photo:stalledRef,notes:'Keep dispatch notes',lines:[{id:'stalled-unrelated',quantity:0}]}]);
});
after(async()=>{await mf?.dispose();});

test('queue completes without private evidence reads, preserving counts and inspection metadata without any evidence or migration write',{timeout:10000},async()=>{
 const before=await raw('qa-checks'),audits=await storage.exec('SELECT action FROM audit ORDER BY id'),queue=await request('/qa/queue');assert.equal(queue.status,200);assert.equal(queue.body.items.length,4);assert.equal(queue.body.items.filter(item=>item.status==='approved').length,2);assert.equal(queue.body.items.filter(item=>item.status==='recut').length,1);
 const item=queue.body.items.find(item=>item.id===records[0].id);assert.equal(item.evidenceLoaded,false);assert.equal(item.hasPhotoEvidence,true);assert.equal(item.latest.photoCount,2);assert.equal(item.history[0].photoCount,2);assert.equal(item.photoAdditions[0].photoCount,1);assert.deepEqual(item.latest.results,records[0].latest.results);assert.equal(item.latest.notes,records[0].latest.notes);assert.equal(item.photoAdditions[0].addedBy,'photo-contributor');assert.equal(queue.body.dispatches[0].notes,'Keep dispatch notes');
 assert.doesNotMatch(JSON.stringify(queue.body),/data:image\/|qa-r2:v1:|"photos?":/);assert.equal(await raw('qa-checks'),before);assert.deepEqual(await storage.exec('SELECT action FROM audit ORDER BY id'),audits);
 assert.equal(queue.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(queue.headers.get('Cache-Control'),'no-store');assert.equal(queue.headers.get('X-Content-Type-Options'),'nosniff');
});

test('selected evidence resolves only the exact current item and preserves its full original photos/history/additions',{timeout:10000},async()=>{
 const before=await raw('qa-checks'),result=await request('/qa/items/'+encodeURIComponent(records[0].id));assert.equal(result.status,200);assert.equal(result.body.evidenceLoaded,true);assert.equal(result.body.item.evidenceLoaded,true);assert.equal(result.body.item.id,records[0].id);assert.equal(result.body.item.latest.photo,photo);assert.deepEqual(result.body.item.latest.photos,[photo]);assert.equal(result.body.item.history[0].photo,photo);assert.deepEqual(result.body.item.photoAdditions[0].photos,[addedPhoto]);assert.equal(result.body.item.history[0].checkedBy,'original-inspector');assert.equal(await raw('qa-checks'),before);
});

test('queue/detail keep factory QA authorization and exact identity validation',async()=>{
 for(const path of ['/qa/queue','/qa/items/'+encodeURIComponent(records[0].id)]){assert.equal((await request(path,undefined,null)).status,401);assert.equal((await request(path,undefined,viewer)).status,403);}
 for(const id of ['%ZZ','%20bad','x'.repeat(101),'two/raw'])assert.equal((await request('/qa/items/'+id)).status,400);
 assert.equal((await request('/qa/items/missing')).status,404);
 await save('qa-checks',[...records,{...records[0],kind:'panel'}]);assert.equal((await request('/qa/items/'+encodeURIComponent(records[0].id))).status,409);await save('qa-checks',records);
});

test('compact mutation view returns a metadata queue and full selected evidence exactly once; legacy view remains complete',{timeout:10000},async()=>{
 const results=Object.fromEntries(checks.metalwork.map(([key])=>[key,'pass'])),saved=await request('/qa/check?view=queue',{id:'pending-save',kind:'metalwork',results,photo});assert.equal(saved.status,200);assert.equal(saved.body.item.status,'approved');assert.equal(saved.body.item.latest.photo,photo);assert.deepEqual(saved.body.item.history,[saved.body.item.latest]);assert.equal(saved.body.item.latest.checkedBy,'qa-team');assert.equal(saved.body.items.length,4);assert.doesNotMatch(JSON.stringify(saved.body.items),/data:image\/|qa-r2:v1:|"photos?":/);assert.ok(saved.body.items.every(item=>item.evidenceLoaded===false));assert.equal((await storage.exec("SELECT action FROM audit WHERE action='qa-approved'")).length,1);
 const uploaded=await request('/qa/photos?view=queue',{id:'pending-save',kind:'metalwork',attemptId:saved.body.item.latest.id,photos:[addedPhoto],mutationId:'new-queue-upload'});assert.equal(uploaded.status,200);assert.deepEqual(uploaded.body.addition.photos,[addedPhoto]);assert.equal(uploaded.body.item.latest.photo,photo);assert.deepEqual(uploaded.body.item.photoAdditions[0].photos,[addedPhoto]);assert.equal((await storage.exec("SELECT action FROM audit WHERE action='qa-approved'")).length,1);
 // Remove only the deliberately stalled fixture before exercising old clients.
 const rows=JSON.parse(await raw('qa-checks')).filter(item=>item.id!=='stalled-unrelated');await save('qa-checks',rows);await save('qa-dispatches',[]);
 const legacy=await request('/qa');assert.equal(legacy.status,200);const item=legacy.body.items.find(item=>item.id==='pending-save');assert.equal(item.evidenceLoaded,undefined);assert.equal(item.latest.photo,photo);assert.deepEqual(item.photoAdditions[0].photos,[addedPhoto]);
});
