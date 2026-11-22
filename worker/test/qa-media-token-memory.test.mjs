import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {compactQaEvidence,qaJsonResponse,qaMediaReference,readQaPhoto} from '../src/qa-media.js';
import {qaInspectionPhotoGallery} from '../src/qa-photos.js';
import {createQaReportPdf} from '../src/qa-report-pdf.js';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';

const small='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(){
 const db=new DatabaseSync(':memory:'),objects=new Map(),puts=[];let onPut;
 db.exec('CREATE TABLE documents(key TEXT,part INTEGER,value TEXT,PRIMARY KEY(key,part))');
 const sql={exec(query,...params){const statement=db.prepare(query),rows=statement.columns().length?statement.all(...params):(statement.run(...params),[]);return {toArray:()=>rows,[Symbol.iterator]:()=>rows[Symbol.iterator]()};}};
 const raw=key=>sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part',key).toArray().map(value=>value.value).join('');
 const seed=(key,value,size=100000)=>{sql.exec('DELETE FROM documents WHERE key=?',key);for(let at=0;at<value.length;at+=size)sql.exec('INSERT INTO documents VALUES(?,?,?)',key,at/size,value.slice(at,at+size));};
 const bucket={async head(key){const value=objects.get(key);return value?{size:value.data.length,customMetadata:value.metadata}:null;},async put(key,data,options){puts.push(key);objects.set(key,{data,metadata:options.customMetadata});await onPut?.();},async get(key){const value=objects.get(key);return value?{size:value.data.length,text:async()=>value.data,body:new Response(value.data).body}:null;}};
 const store={env:{QA_MEDIA_ENABLED:'true',SITE_ID:'synthetic-token-test',CAD_PROJECT_FILES:bucket},sql,ctx:{storage:{transactionSync(fn){db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}}},read(key,fallback=null){const value=raw(key);return value?JSON.parse(value):fallback;},write(key,value){seed(key,JSON.stringify(value));}};
 return {db,store,objects,puts,raw,seed,onPut:value=>onPut=value};
}
function maximumPng(label='maximum'){
 const prefix='data:image/png;base64,',base=Buffer.from(small.slice(prefix.length),'base64'),target=3*Math.floor((1500000-prefix.length)/4);
 const data=Buffer.alloc(target-base.length-12,65);data.write('Comment\0'+label);
 const type=Buffer.from('tEXt'),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);
 let checksum=0xffffffff;
 for(const byte of Buffer.concat([type,data])){checksum^=byte;for(let bit=0;bit<8;bit++)checksum=(checksum>>>1)^((checksum&1)?0xedb88320:0);}
 crc.writeUInt32BE((checksum^0xffffffff)>>>0);
 const png=Buffer.concat([base.subarray(0,-12),length,type,data,crc,base.subarray(-12)]);
 const value=prefix+png.toString('base64');assert.equal(value.length,1499998);return value;
}

test('maximum legal PNG tokens flatten safely, deduplicate aliases and preserve galleries and original PDF evidence',async()=>{
 const f=fixture();try{
  const photo=maximumPng(),attempt={id:'inspection',status:'approved',results:{finish:'pass'},photo,photos:[photo],checkedBy:'inspector',checkedAt:'2026-11-22T00:00:00Z'},record={id:'panel-1',kind:'panel',reference:'P1',status:'approved',latest:attempt,history:[attempt],photoAdditions:[{id:'addition',attemptId:attempt.id,photos:[photo],addedBy:'inspector',addedAt:'2026-11-22T00:00:00Z'}]};
  f.store.write('qa-checks',[record]);const result=await compactQaEvidence(f.store);assert.equal(result.state,'progress');assert.equal(result.objects,1);assert.equal(f.puts.length,1);
  const saved=f.store.read('qa-checks')[0],ref=saved.latest.photo;assert.ok(qaMediaReference(ref));assert.equal(saved.latest.photos[0],ref);assert.equal(saved.history[0].photo,ref);assert.equal(saved.photoAdditions[0].photos[0],ref);
  assert.deepEqual(await qaJsonResponse(f.store,[saved]).json(),[record]);assert.deepEqual(await Promise.all(qaInspectionPhotoGallery(saved,saved.latest).map(value=>readQaPhoto(f.store,value))),qaInspectionPhotoGallery(record,record.latest));
  const report={items:[saved],checklists:{panel:[['finish','Finish']]},project:'Synthetic',orderNumber:'1',generatedAt:'2026-11-22T00:00:00Z',generatedBy:'admin'},bytes=await createQaReportPdf(report,{readPhoto:value=>readQaPhoto(f.store,value)}),pdf=await PDFDocument.load(bytes),original=Buffer.from(photo.split(',')[1],'base64');
  assert.ok([...pdf.context.enumerateIndirectObjects()].some(([,object])=>object instanceof PDFRawStream&&object.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile'&&Buffer.from(decodePDFRawStream(object).decode()).equals(original)));
 }finally{f.db.close();}
});
test('escaped and Unicode strings spanning both input and token blocks retain their exact raw JSON',async()=>{
 const f=fixture();try{
  const notes=('A quote " followed by a slash \\ and newline\n🙂 ').repeat(180),source=[{id:'escaped',notes,latest:{photo:small}}];
  const encoded=JSON.stringify(source).replaceAll('🙂','\\ud83d\\ude42').replace('data:image/png;base64,i','data:image/png;base64,\\u0069').replace('A quote','\\u0041 quote');f.seed('qa-checks',encoded,7);
  const expected=JSON.parse(encoded),result=await compactQaEvidence(f.store);assert.equal(result.objects,1);const saved=f.store.read('qa-checks');assert.ok(qaMediaReference(saved[0].latest.photo));
  const oldToken='"'+small.replace('base64,i','base64,\\u0069')+'"';assert.equal(f.raw('qa-checks'),encoded.replace(oldToken,JSON.stringify(saved[0].latest.photo)));assert.deepEqual(await qaJsonResponse(f.store,saved).json(),expected);
 }finally{f.db.close();}
});
test('a maximum-sized token ignored after maxObjects is preserved while later duplicate evidence still reuses the saved object',async()=>{
 const f=fixture();try{
  const large=maximumPng('ignored'),records=[{id:'first',latest:{photo:small}},{id:'ignored',latest:{photo:large}},{id:'duplicate',latest:{photo:small}}];f.store.write('qa-checks',records);
  const result=await compactQaEvidence(f.store,{maxObjects:1});assert.equal(result.objects,1);assert.equal(f.puts.length,1);
  const saved=f.store.read('qa-checks');assert.equal(saved[1].latest.photo,large);assert.equal(saved[2].latest.photo,saved[0].latest.photo);assert.deepEqual(await qaJsonResponse(f.store,saved).json(),records);
  assert.equal((await compactQaEvidence(f.store,{maxObjects:1})).objects,1);assert.equal(f.objects.size,2);assert.deepEqual(await qaJsonResponse(f.store,f.store.read('qa-checks')).json(),records);
 }finally{f.db.close();}
});
test('chunk-builder processing never overwrites a concurrent QA edit',async()=>{
 const f=fixture();try{
  f.store.write('qa-checks',[{id:'original',latest:{photo:maximumPng()}}]);f.onPut(()=>{f.store.write('qa-checks',[{id:'newer',notes:'Concurrent edit stays saved'}]);f.onPut(null);});
  assert.deepEqual(await compactQaEvidence(f.store),{state:'deferred',changed:0});assert.deepEqual(f.store.read('qa-checks'),[{id:'newer',notes:'Concurrent edit stays saved'}]);assert.equal(f.store.sql.exec("SELECT key FROM documents WHERE key LIKE 'reliability:qa-stage:%'").toArray().length,0);
 }finally{f.db.close();}
});
test('near-limit saved and ignored tokens complete in an isolated bounded heap',()=>{
 const moduleUrl=new URL('../src/qa-media.js',import.meta.url).href;
 // Keep the child free of PDF/browser imports. Its input includes two different
 // near-limit evidence URLs plus a duplicate after the object limit is reached.
 const child=`import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {compactQaEvidence} from ${JSON.stringify(moduleUrl)};const fixture=${fixture.toString()};const f=fixture();try{const prefix='data:image/png;base64,',first=prefix+'A'.repeat(1499976),ignored=prefix+'B'.repeat(1499976);f.store.write('qa-checks',[{latest:{photo:first}},{latest:{photo:ignored}},{latest:{photo:first}}]);const result=await compactQaEvidence(f.store,{maxObjects:1});assert.equal(result.objects,1);assert.equal(f.puts.length,1);const saved=f.store.read('qa-checks');assert.equal(saved[1].latest.photo,ignored);assert.equal(saved[0].latest.photo,saved[2].latest.photo);console.log('bounded-token-complete');}finally{f.db.close();}`;
 const result=spawnSync(process.execPath,['--max-old-space-size=48','--input-type=module','-e',child],{encoding:'utf8',timeout:30000,maxBuffer:20000});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/bounded-token-complete/);
});

test('shortened private references cannot split a metadata emoji at a SQLite output boundary',async()=>{
 const f=fixture();try{
  const ref='qa-r2:v1:'+createHash('sha256').update(small).digest('hex')+':'+small.length;
  const shape=JSON.stringify([{id:'unicode-boundary',latest:{photo:ref},notes:''}]),start=shape.indexOf('"notes":"')+'"notes":"'.length;
  const metadata={caption:'Original evidence 🙂 — unchanged',nested:{text:'Keep every field 漢字',value:42}},record={id:'unicode-boundary',latest:{photo:small},notes:'A'.repeat(99999-start)+'🙂'+' after the boundary',metadata},records=[record];
  const before=JSON.stringify(records),expected=before.replace(JSON.stringify(small),JSON.stringify(ref));
  assert.equal(expected.charCodeAt(99999),0xd83d);assert.equal(expected.charCodeAt(100000),0xde42);assert.notEqual(before.charCodeAt(99999),0xd83d);
  f.store.write('qa-checks',records);assert.equal(f.raw('qa-checks'),before,'The original SQLite parts must preserve the starting input');
  const result=await compactQaEvidence(f.store);assert.equal(result.state,'progress');assert.equal(result.objects,1);
  const parts=f.store.sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part','qa-checks').toArray();assert.ok(parts.length>1);assert.equal(parts[0].value.length,99999);
  for(let index=0;index<parts.length;index++){
   const value=parts[index].value;assert.ok(value.length<=100000);
   if(index+1<parts.length){const last=value.charCodeAt(value.length-1),next=parts[index+1].value.charCodeAt(0);assert.ok(!(last>=0xd800&&last<=0xdbff));assert.ok(!(next>=0xdc00&&next<=0xdfff));}
  }
  assert.equal(f.raw('qa-checks'),expected);const saved=f.store.read('qa-checks');assert.equal(saved[0].latest.photo,ref);assert.deepEqual(saved[0].metadata,metadata);assert.equal(saved[0].notes,record.notes);assert.equal(await readQaPhoto(f.store,ref),small);assert.deepEqual(await qaJsonResponse(f.store,saved).json(),records);
 }finally{f.db.close();}
});
