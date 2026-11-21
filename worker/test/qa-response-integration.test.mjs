import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash,randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import fs from 'node:fs';

const origin='https://app.panelstockhq.com',webOrigin='https://web.panelstockhq.com',site='qa-response-test',script=fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8');
let mf,storage,admin,team,viewer,restricted,checks;
const environment=(name,readOnly=false)=>new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name,modules:true,script,compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:name,QA_MEDIA_ENABLED:'true',SAFETY_MEDIA_ENABLED:'true',MIGRATION_READY:'true',READ_ONLY:String(readOnly),EMAIL_ENABLED:'false',ALLOWED_ORIGINS:origin+','+webOrigin}}]}));
async function request(path,body,token=admin,extra={},instance=mf){
 const response=await instance.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)}),text=await response.text();
 return {status:response.status,headers:response.headers,bytes:Buffer.byteLength(text),body:JSON.parse(text)};
}
const login=async(username,pin,extra={},instance=mf)=>(await request('/login',{username,pin},null,extra,instance)).body.token;
async function seed(instance){
 const kv=await instance.getKVNamespace('LEGACY_KV'),users={};
 for(const [username,pin,isAdmin]of [['admin','123456',true],['qa-team','654321',false],['viewer','456789',false],['restricted','567890',false]])users[username]={isAdmin,pinHash:createHash('sha256').update(`${pin}:${username}:panelstock`).digest('hex'),...(username==='restricted'?{appAccess:{app:false}}:{})};
 await kv.put('users',JSON.stringify(users));
 const a=await login('admin','123456',{},instance),tasks=(await request('/admin/users',{},a,{},instance)).body.tasks.map(task=>task.code);
 for(const targetUsername of ['qa-team','viewer','restricted'])assert.equal((await request('/admin/set-task-access',{targetUsername,taskCodes:tasks,allowed:false},a,{},instance)).status,200);
 for(const targetUsername of ['qa-team','restricted'])assert.equal((await request('/admin/set-task-access',{targetUsername,taskCode:'factory.qa',allowed:true},a,{},instance)).status,200);
 return {admin:a,team:await login('qa-team','654321',{},instance),viewer:await login('viewer','456789',{},instance),restricted:await login('restricted','567890',{Origin:webOrigin},instance)};
}
before(async()=>{mf=environment(site);({admin,team,viewer,restricted}=await seed(mf));storage=await mf.unsafeGetDurableObjectStorage(site,'InventoryStore',{name:site});checks=(await request('/qa',undefined,team)).body.checklists;});
after(async()=>{await mf?.dispose();});
async function saveDocument(key,value){const raw=JSON.stringify(value);await storage.exec('DELETE FROM documents WHERE key=?',key);for(let index=0;index<raw.length;index+=100000)await storage.exec('INSERT INTO documents(key,part,value) VALUES(?,?,?)',key,index/100000,raw.slice(index,index+100000));return Buffer.byteLength(raw);}

test('QA response transport preserves authorization, validation, creation/deletion statuses and CORS/security headers',async()=>{
 assert.equal((await request('/qa',undefined,null)).status,401);assert.equal((await request('/qa',undefined,viewer)).status,403);
 const denied=await request('/qa/check',{id:'missing',kind:'metalwork'},viewer);assert.equal(denied.status,403);assert.equal(denied.body.code,'QA_ACCESS_REQUIRED');
 const appDenied=await request('/qa',undefined,restricted);assert.equal(appDenied.status,403);assert.equal(appDenied.body.code,'APP_ACCESS_DENIED');assert.equal((await request('/qa',undefined,restricted,{Origin:webOrigin})).status,200);
 assert.equal((await request('/qa',undefined,team,{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await request('/qa/unknown',undefined)).status,404);assert.equal((await request('/qa/settings',undefined,team)).status,403);assert.equal((await request('/qa/settings')).status,200);
 assert.equal((await request('/qa/gates/report',{},team)).status,400);assert.equal((await request('/qa/metalwork',{},team)).status,400);
 const created=await request('/qa/metalwork',{project:'Transport validation',orderNumber:'1',reference:'Manual bracket',quantity:1,fabricatedBy:'fabricator'},team);assert.equal(created.status,201);
 assert.equal((await request('/qa/metalwork/delete',{id:created.body.item.id},team)).status,403);
 const removed=await request('/qa/metalwork/delete',{id:created.body.item.id});assert.equal(removed.status,200);assert.equal(removed.body.deletedId,created.body.item.id);assert.equal(removed.body.items.length,0);
 for(const response of [denied,created,removed]){assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Vary'),'Origin');assert.match(response.headers.get('Content-Type'),/application\/json/);}
});

test('QA writes retain the existing maintenance guard while QA reads stay available',async()=>{
 const name='qa-response-read-only',paused=environment(name,true);
 try{
  const kv=await paused.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));
  const token=await login('admin','123456',{},paused);assert.ok(token);
  assert.equal((await request('/qa',undefined,token,{},paused)).status,200);
  const denied=await request('/qa/metalwork',{project:'Maintenance',orderNumber:'1',reference:'Bracket',quantity:1,fabricatedBy:'fabricator'},token,{},paused);assert.equal(denied.status,503);assert.match(denied.body.error,/paused for maintenance/);
  assert.equal((await request('/qa',undefined,token,{},paused)).body.items.length,0);
 }finally{await paused.dispose();}
});

// A real 256x200 RGB PNG with unpredictable pixels is about 200 KiB as a data URL.
function evidencePhoto(){
 const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;},chunk=(name,data)=>{const type=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc]);};
 const width=256,height=200,header=Buffer.alloc(13),pixels=Buffer.alloc(height*(1+width*3));header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 for(let y=0;y<height;y++)randomBytes(width*3).copy(pixels,y*(1+width*3)+1);
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}

test('a real QA feed larger than 32 MiB streams all inspection evidence, and saving once returns success with one immutable new attempt',async()=>{
 const photo=evidencePhoto(),results=Object.fromEntries(checks.metalwork.map(([key])=>[key,'pass'])),pending={id:'pending-transport-save',kind:'metalwork',project:'Large synthetic QA history',orderNumber:'1',reference:'Pending item',quantity:1,fabricatedBy:'fabricator',createdBy:'admin',createdAt:'2026-11-19T00:00:00Z',status:'awaiting',latest:null,history:[]};
 assert.ok(photo.length>200000&&photo.length<210000);
 const records=[pending,...Array.from({length:86},(_,index)=>{const attempt={id:'inspection-'+index,status:'approved',results,notes:'Saved inspection '+index,photo,checkedBy:'original-inspector',checkedAt:'2026-11-19T00:00:00Z'};return {...pending,id:'saved-'+index,reference:'Saved item '+index,status:'approved',latest:attempt,history:[attempt]};})];
 const older={...records[1].latest,id:'previous-inspection',status:'recut',results:{...results,[checks.metalwork[0][0]]:'fail'},notes:'Historical failure remains visible'};records[1].history.unshift(older);records[1].photoAdditions=[{id:'saved-supplement',attemptId:older.id,photos:[photo],addedBy:'photo-contributor',addedAt:'2026-11-19T00:00:00Z',mutationId:'saved-mutation'}];
 assert.ok(await saveDocument('qa-checks',records)>32*1024*1024);
 const read=await request('/qa',undefined,team);assert.equal(read.status,200);assert.ok(read.bytes>32*1024*1024);assert.equal(read.body.items.length,records.length);
 const preserved=items=>{for(const saved of records.slice(1)){const item=items.find(value=>value.id===saved.id);assert.ok(item);for(const key of ['status','latest','history','photoAdditions'])assert.deepEqual(item[key],saved[key],saved.id+': '+key);}};
 preserved(read.body.items);assert.equal(read.body.items.find(item=>item.id===pending.id).latest,null);
 assert.equal((await storage.exec("SELECT action FROM audit WHERE action='qa-approved'")).length,0);
 const saved=await request('/qa/check',{id:pending.id,kind:'metalwork',results,photo,notes:'One intentional inspection'},team);assert.equal(saved.status,200);assert.ok(saved.bytes>32*1024*1024);assert.equal(saved.body.item.status,'approved');assert.equal(saved.body.item.latest.checkedBy,'qa-team');assert.equal(saved.body.item.latest.photo,photo);assert.deepEqual(saved.body.item.history,[saved.body.item.latest]);preserved(saved.body.items);
 const reread=await request('/qa',undefined,team);assert.equal(reread.status,200);const current=reread.body.items.find(item=>item.id===pending.id);assert.deepEqual(current.latest,saved.body.item.latest);assert.deepEqual(current.history,saved.body.item.history);preserved(reread.body.items);
 assert.equal((await storage.exec("SELECT action FROM audit WHERE action='qa-approved'")).length,1);
 const repeated=await request('/qa/check',{id:pending.id,kind:'metalwork',results,photo},team);assert.equal(repeated.status,403);assert.equal(repeated.body.code,'QA_ALREADY_APPROVED');assert.equal((await storage.exec("SELECT action FROM audit WHERE action='qa-approved'")).length,1);
});


test('enabled private evidence storage keeps image bytes out of the saved inspection document',async()=>{
 const rows=[];for(let part=0;;part++){const chunk=await storage.exec("SELECT value FROM documents WHERE key='qa-checks' AND part=?",part);if(!chunk.length)break;rows.push(...chunk);}
 const saved=JSON.parse(rows.map(row=>row.value).join('')).find(item=>item.id==='pending-transport-save');
 assert.match(saved.latest.photo,/^qa-r2:v1:/);assert.equal(saved.history[0].photo,saved.latest.photo);
 const bucket=await mf.getR2Bucket('CAD_PROJECT_FILES'),objects=await bucket.list();assert.ok(objects.objects.length>0);
 const feed=await request('/qa',undefined,team);assert.match(feed.body.items.find(item=>item.id===saved.id).latest.photo,/^data:image\/png;base64,/);
 const denied=await request('/admin/reliability',undefined,team);assert.equal(denied.status,403);
 const report=await request('/admin/reliability');assert.equal(report.status,200);assert.equal(report.body.qaMediaEnabled,true);assert.ok(report.body.documents.some(row=>row.key==='qa-checks'&&row.bytes>0));
});
