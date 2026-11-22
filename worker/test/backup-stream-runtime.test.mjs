import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('production-sized raw backups roll back failed parts and the daily marker, then preserve the original format and become a same-day write no-op',async()=>{
 let bundle=fs.readFileSync(process.env.WORKER_BUNDLE||new URL('../dist/index.js',import.meta.url),'utf8');
 const defaultName=bundle.match(/(\w+) as default\s*\n?\}/)?.[1];assert.ok(defaultName,'Find the built Worker export for the local-only test controller');
 bundle+=`
 // This controller exists only in this local test bundle. Never deploy it.
 import {createHash as localBackupTestHash} from 'node:crypto';
 InventoryStore.prototype.backupRuntimeControl=function(operation,key,offset=0){
  if(operation==='fail'){this.sql.exec("CREATE TRIGGER fail_backup_part BEFORE INSERT ON documents WHEN NEW.key LIKE 'backup:%' AND NEW.part=1 BEGIN SELECT RAISE(ABORT,'synthetic failed backup part'); END");return true;}
  if(operation==='recover'){this.sql.exec('DROP TRIGGER fail_backup_part');return true;}
  if(operation==='changes')return this.sql.exec('SELECT total_changes() AS count').toArray()[0].count;
  if(operation==='source-hash'){const hash=localBackupTestHash('sha256');for(const row of this.sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part','workshop-stock'))hash.update(row.value);return hash.digest('hex');}
  if(operation==='keys')return this.sql.exec("SELECT DISTINCT key FROM documents WHERE key LIKE 'backup:%' ORDER BY key").toArray().map(row=>row.key);
  if(operation==='parts'){
   if(!(key==='workshop-stock'||/^backup:[0-9T:.Z-]+$/.test(key))||!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid local test read');
   return this.sql.exec('SELECT part,value FROM documents WHERE key=? AND part>=? ORDER BY part LIMIT 16',key,offset).toArray();
  }
  throw Error('Unknown local test operation');
 };
 const backupRuntimeFetch=${defaultName}.fetch;
 ${defaultName}.fetch=async function(request,env,ctx){
  if(new URL(request.url).pathname!=='/__local_backup_test')return backupRuntimeFetch.call(this,request,env,ctx);
  const input=await request.json(),store=env.INVENTORY.getByName(env.SITE_ID);
  try{
   if(input.action==='seed'){
    await store.write('initialized',true);await store.write('workshop-stock',input.workshop);await store.write('app:photos',input.photos);
    await store.write('users',input.users);await store.syncAccessUser('admin',input.users.admin);
    await store.write('last-backup-date','2000-01-01');await store.write('backup:2000-01-01T00:00:00.000Z',{takenBy:'old-synthetic-user'});
    return Response.json({ok:true});
   }
   if(input.action==='schedule')return Response.json(await store.scheduledData(false));
   if(input.action==='marker')return Response.json(await store.read('last-backup-date'));
   return Response.json(await store.backupRuntimeControl(input.action,input.key,input.offset));
  }catch(error){return Response.json({error:error.name},{status:500});}
 };
 `;
 const name='backup-stream-runtime',mf=new Miniflare(convertV4MiniflareOptions({workers:[{name,modules:true,script:bundle,compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},bindings:{SITE_ID:name,MIGRATION_READY:'false',EMAIL_ENABLED:'false'}}]}));
 const post=async(path,body,token)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const control=async(action,extra={})=>{const result=await post('/__local_backup_test',{action,...extra});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
 const readDocument=async key=>{const chunks=[];for(let offset=0;;offset+=16){const rows=await control('parts',{key,offset});if(!rows.length)break;assert.ok(rows.length<=16);for(const row of rows){assert.ok(row.value.length<=100000);chunks.push(row.value);}}return chunks.join('');};
 const hash=value=>createHash('sha256').update(value).digest('hex');
 try{
  const metadata={},images=new Map();for(let index=0;index<5;index++){const bytes=Buffer.alloc(4*1024*1024,index+1);bytes.set([137,80,78,71,13,10,26,10]);const image='data:image/png;base64,'+bytes.toString('base64');metadata['variant:sheet-'+index]={image,name:'Original sheet '+index};images.set('variant:sheet-'+index,hash(image));}
  const reference='qa-r2:v1:'+'a'.repeat(64)+':1234',photos={retainedReference:reference},workshop={revision:7,items:[],metadata,movements:[],purchaseOrders:[{id:'private-po',attachments:[{storage:'r2',key:'private/original.pdf',sha256:'b'.repeat(64)}]}],stocktakes:[],notes:'Original Unicode 🧰 and escaped "quotes" retained'};
  const users={admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')}};
  await control('seed',{workshop,photos,users});const originalSource=await control('source-hash');assert.equal(originalSource,hash(JSON.stringify(workshop)));assert.ok(JSON.stringify(workshop).length>27000000);
  await control('fail');const failed=await post('/__local_backup_test',{action:'schedule'});assert.equal(failed.status,500);assert.equal(await control('marker'),'2000-01-01');assert.deepEqual(await control('keys'),['backup:2000-01-01T00:00:00.000Z']);assert.equal(await control('source-hash'),originalSource);
  await control('recover');const scheduled=await control('schedule');assert.equal(scheduled.data,undefined);const keys=await control('keys');assert.equal(keys.length,1,'The successful backup must prune the old backup');assert.ok(!keys[0].includes('2000-01-01'));assert.equal(await control('marker'),keys[0].slice(7,17));
  const snapshot=JSON.parse(await readDocument(keys[0]));assert.deepEqual(Object.keys(snapshot),['variants','offcuts','catalog','reasons','transactions','photos','cncPanels','revision','restoreEpoch','attendance','workshopStock','users','config','registration_code','takenAt','takenBy']);assert.equal(snapshot.takenBy,'scheduled');assert.equal(snapshot.takenAt,keys[0].slice(7));assert.equal(snapshot.revision,0);assert.equal(snapshot.restoreEpoch,0);assert.equal(snapshot.config,null);assert.equal(snapshot.registration_code,null);assert.deepEqual(snapshot.attendance,{entries:[]});assert.deepEqual(snapshot.users,users);assert.deepEqual(snapshot.photos,photos);for(const field of ['variants','offcuts','catalog','reasons','transactions','cncPanels'])assert.deepEqual(snapshot[field],[]);
  assert.deepEqual(snapshot.workshopStock,workshop);for(const [id,digest]of images)assert.equal(hash(snapshot.workshopStock.metadata[id].image),digest);assert.equal(await control('source-hash'),originalSource);
  const before=await control('changes');await control('schedule');assert.equal(await control('changes'),before,'A same-day scheduling check must not write any rows');assert.deepEqual(await control('keys'),keys);
  const login=await post('/login',{username:'admin',pin:'123456'});assert.equal(login.status,200);const listing=await post('/admin/backups',{},login.body.token);assert.equal(listing.status,200);assert.deepEqual(listing.body.backups,[{timestamp:keys[0].slice(7),takenBy:'scheduled'}]);assert.ok(JSON.stringify(listing.body).length<500);assert.equal(JSON.stringify(listing.body).includes('data:image/'),false);
 }finally{await mf.dispose();}
});
