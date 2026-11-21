import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {externalizeQaValue,qaJsonResponse,readQaPhoto,compactQaEvidence,qaMediaReference,qaWriteGuard,assertQaWriteGuard} from '../src/qa-media.js';
import {storeAuditEvidence,readAuditEvidence,compactAuditEvidence} from '../src/audit-evidence-storage.js';
import {createQaReportPdf} from '../src/qa-report-pdf.js';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(){
 const db=new DatabaseSync(':memory:'),objects=new Map();db.exec('CREATE TABLE documents(key TEXT,part INTEGER,value TEXT,PRIMARY KEY(key,part))');let onPut,failed=false;
 const sql={exec(query,...params){const st=db.prepare(query),rows=st.columns().length?st.all(...params):(st.run(...params),[]);return {toArray:()=>rows,[Symbol.iterator]:()=>rows[Symbol.iterator]()};}};
 const bucket={async head(key){const item=objects.get(key);return item?{size:Buffer.byteLength(item.data),customMetadata:item.metadata}:null;},async put(key,data,options){if(failed)throw Error('Storage unavailable');objects.set(key,{data,metadata:options.customMetadata});await onPut?.();},async get(key){const item=objects.get(key);return item?{size:Buffer.byteLength(item.data),body:new Response(item.data).body,text:async()=>item.data}:null;}};
 const store={env:{QA_MEDIA_ENABLED:'true',SAFETY_MEDIA_ENABLED:'true',SITE_ID:'test',CAD_PROJECT_FILES:bucket},sql,ctx:{storage:{transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}}},read(key,fallback=null){const rows=sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part',key).toArray();return rows.length?JSON.parse(rows.map(x=>x.value).join('')):fallback;},write(key,value){sql.exec('DELETE FROM documents WHERE key=?',key);const raw=JSON.stringify(value);for(let i=0;i<raw.length;i+=100000)sql.exec('INSERT INTO documents VALUES(?,?,?)',key,i/100000,raw.slice(i,i+100000));}};
 return {store,db,objects,fail:()=>{failed=true;},onPut:fn=>{onPut=fn;}};
}
test('QA evidence moves to private storage with byte-exact legacy JSON, safe field resolution and original PDF attachments',async()=>{
 const f=fixture();try{
  const original={items:[{id:'p1',kind:'panel',reference:'P1',status:'approved',latest:{id:'inspection',status:'approved',checkedBy:'inspector',checkedAt:'2026-11-20T00:00:00Z',results:{finish:'pass'},photo},history:[]}],checklists:{panel:[['finish','Finish']]},project:'Synthetic project',orderNumber:'1',generatedAt:'2026-11-20T00:00:00Z',generatedBy:'admin'};
  const stored=await externalizeQaValue(f.store,original);assert.ok(qaMediaReference(stored.items[0].latest.photo));assert.equal(f.objects.size,1);assert.equal(JSON.stringify(original).includes(photo),true);assert.deepEqual(await qaJsonResponse(f.store,stored).json(),original);
  const ref=stored.items[0].latest.photo;assert.deepEqual(await qaJsonResponse(f.store,{notes:ref}).json(),{notes:ref});assert.equal(await readQaPhoto(f.store,ref),photo);
  const bytes=await createQaReportPdf(stored,{readPhoto:value=>readQaPhoto(f.store,value)}),pdf=await PDFDocument.load(bytes),attachments=[];
  for(const [,obj]of pdf.context.enumerateIndirectObjects())if(obj instanceof PDFRawStream&&obj.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile')attachments.push(Buffer.from(decodePDFRawStream(obj).decode()));
  assert.ok(attachments.some(value=>value.equals(Buffer.from(photo.split(',')[1],'base64'))));
  f.objects.clear();await assert.rejects(qaJsonResponse(f.store,stored).json());
 }finally{f.db.close();}
});
test('bounded QA backfill preserves all history bytes, stops no-op writes, and cannot overwrite concurrent edits',async()=>{
 const f=fixture();try{
  const records=Array.from({length:12},(_,n)=>({id:'qa-'+n,status:'approved',latest:{photo:photo+'A'.repeat(n*4)},history:[{photo:photo+'A'.repeat(n*4)}],notes:'Quote " and \\ slash'}));f.store.write('qa-checks',records);
  let result=await compactQaEvidence(f.store,{maxObjects:3});assert.equal(result.state,'progress');assert.equal(result.objects,3);assert.deepEqual(await qaJsonResponse(f.store,f.store.read('qa-checks')).json(),records);
  for(let n=0;n<6;n++)await compactQaEvidence(f.store,{maxObjects:3});assert.ok(JSON.stringify(f.store.read('qa-checks')).length<JSON.stringify(records).length);
  const before=f.db.prepare('SELECT total_changes() AS n').get().n;assert.equal((await compactQaEvidence(f.store)).state,'complete');assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,before);
  f.store.write('qa-checks',[{id:'old',photo}]);f.objects.clear();f.onPut(()=>{f.store.write('qa-checks',[{id:'new',photo:'unchanged'}]);f.onPut(null);});
  const race=await compactQaEvidence(f.store);assert.equal(race.state,'deferred');assert.deepEqual(f.store.read('qa-checks'),[{id:'new',photo:'unchanged'}]);
 }finally{f.db.close();}
});
test('Safety file storage and backfill retain the original base64 and fail closed on missing or corrupt objects',async()=>{
 const f=fixture();try{
  const data=photo.split(',')[1],file={id:crypto.randomUUID()};f.store.write('safety:walk-file:'+file.id,{data});assert.deepEqual(await readAuditEvidence(f.store,file.id),{data});
  assert.equal((await compactAuditEvidence(f.store)).state,'progress');assert.equal(f.store.read('safety:walk-file:'+file.id).data,undefined);assert.deepEqual(await readAuditEvidence(f.store,file.id),{data});
  const ref=await storeAuditEvidence(f.store,file,data);f.store.write('safety:walk-file:'+file.id,ref);f.objects.get(ref.key).data='corrupt';await assert.rejects(readAuditEvidence(f.store,file.id),/unavailable|integrity/);
  f.fail();await assert.rejects(storeAuditEvidence(f.store,{id:'failed'},data));
 }finally{f.db.close();}
});

test('asynchronous QA evidence cannot commit over concurrent data, permission or session changes',async()=>{
 for(const change of ['record','permission','session']){
  const f=fixture();try{
   f.db.exec('CREATE TABLE access_users(username TEXT,active INTEGER,is_admin INTEGER,role_id TEXT);CREATE TABLE user_task_access(username TEXT,task TEXT);CREATE TABLE role_task_access(role TEXT,task TEXT);CREATE TABLE user_roles(username TEXT,role TEXT);CREATE TABLE sessions(token TEXT,expires INTEGER)');
   f.db.prepare('INSERT INTO sessions VALUES(?,?)').run('synthetic',Date.now()+60000);f.store.write('qa-checks',[{id:'original'}]);
   const guard=qaWriteGuard(f.store);
   f.onPut(()=>{if(change==='record')f.store.write('qa-checks',[{id:'newer'}]);if(change==='permission')f.db.exec("INSERT INTO user_task_access VALUES('inspector','changed')");if(change==='session')f.db.exec('DELETE FROM sessions');});
   await externalizeQaValue(f.store,{photo});assert.throws(()=>assertQaWriteGuard(f.store,guard,{tokenHash:'synthetic'}),error=>[401,409].includes(error.status));
  }finally{f.db.close();}
 }
 const f=fixture();try{f.store.write('qa-checks',[{id:'unchanged'}]);f.fail();await assert.rejects(externalizeQaValue(f.store,{photo}));assert.deepEqual(f.store.read('qa-checks'),[{id:'unchanged'}]);}finally{f.db.close();}
});
