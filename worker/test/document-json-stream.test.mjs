import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {writeJsonDocument,writeBackupDocument,readBackupTakenBy} from '../src/document-json-stream.js';

const fields=['variants','offcuts','catalog','reasons','transactions','photos','cncPanels'];
const timestamp='2026-11-23T00:15:00.000Z',username='synthetic-counter';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE documents(key TEXT,part INTEGER,value TEXT NOT NULL,PRIMARY KEY(key,part))');
 const reads=[],queries=[];
 const sql={exec(query,...parameters){
  queries.push(query);const statement=db.prepare(query);
  if(statement.columns().length)return {toArray:()=>statement.all(...parameters),[Symbol.iterator]:()=>statement.iterate(...parameters)};
  statement.run(...parameters);return {toArray:()=>[],[Symbol.iterator]:function*(){}};
 }};
 const raw=key=>db.prepare('SELECT value FROM documents WHERE key=? ORDER BY part').all(key).map(row=>row.value).join('');
 const parts=key=>db.prepare('SELECT part,value FROM documents WHERE key=? ORDER BY part').all(key);
 const seed=(key,value)=>{db.prepare('DELETE FROM documents WHERE key=?').run(key);const source=JSON.stringify(value),insert=db.prepare('INSERT INTO documents VALUES(?,?,?)');for(let index=0;index<source.length;index+=100000)insert.run(key,index/100000,source.slice(index,index+100000));};
 const store={sql,read(key,fallback=null){reads.push(key);const value=raw(key);return value?JSON.parse(value):fallback;}};
 const transaction=fn=>{db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 return {db,sql,store,reads,queries,raw,parts,seed,transaction};
}

test('incremental document serialization matches native JSON semantics and preserves property order',()=>{
 const f=fixture();try{
  const sparse=[];sparse[3]='tail';
  const inherited=Object.assign(Object.create({ignored:'prototype'}),{visible:true});
  Object.defineProperty(inherited,'hidden',{enumerable:false,value:1});
  const shared={id:'shared',nested:{retained:true}};
  const values=[
   null,true,false,0,-0,1.25,1e21,NaN,Infinity,-Infinity,'quote " slash \\ controls\b\f\n\r\t\u0000 / 月 😀 \u2028 \u2029 \ud800 \udfff',
   {z:1,2:'two',1:'one',a:undefined,b:()=>{},c:Symbol('hidden'),d:null,[Symbol('key')]:'ignored'},
   [undefined,()=>{},Symbol('hidden'),NaN,sparse,{nested:inherited}],
   {date:new Date('2026-11-23T00:00:00Z'),number:new Number(3),string:new String('boxed'),boolean:new Boolean(false)},
   {a:{toJSON(key){return {receivedKey:key,value:undefined};}},list:[{toJSON(key){return key;}}]},
   {keep:3,skip:{toJSON(){return undefined;}},array:[{toJSON(){return undefined;}}]},
   {first:shared,second:shared},
  ];
  for(let index=0;index<values.length;index++){
   const expected=JSON.stringify(values[index]);f.transaction(()=>writeJsonDocument(f.sql,'case-'+index,values[index]));
   assert.equal(f.raw('case-'+index),expected,'case '+index);
   assert.ok(f.parts('case-'+index).every(({value})=>value.length<=100000));
  }
  let calls=0;const value={get once(){calls++;return {toJSON(key){return key;}};}};
  f.transaction(()=>writeJsonDocument(f.sql,'getter',value));assert.equal(calls,1);assert.equal(f.raw('getter'),'{"once":"once"}');
 }finally{f.db.close();}
});

test('incremental strings preserve Unicode and escaping across SQLite chunk boundaries',()=>{
 const f=fixture();try{
  for(const value of ['x'.repeat(99998)+'😀 tail','a'.repeat(99996)+'\ud800"\\\n'+'月'.repeat(100100),{['key "\\\u0000 😀']:'x'.repeat(99990)+'😀'+'y'.repeat(100100)}]){
   const expected=JSON.stringify(value);f.transaction(()=>writeJsonDocument(f.sql,'unicode',value));
   assert.equal(f.raw('unicode'),expected);assert.ok(f.parts('unicode').length>1);
   assert.ok(f.parts('unicode').every(({value})=>value.length<=100000));
  }
 }finally{f.db.close();}
});

test('caller transaction rolls back late cyclic or BigInt failure and preserves the previous document and daily marker',()=>{
 const f=fixture();try{
  f.seed('workshop-stock',{revision:4,items:[{id:'original',image:'evidence'}]});f.seed('last-backup-date','2026-11-22');
  const before=f.raw('workshop-stock'),cyclic={largePrefix:'A'.repeat(250000)};cyclic.loop=cyclic;
  for(const invalid of [cyclic,{largePrefix:'A'.repeat(250000),invalid:1n}]){
   assert.throws(()=>f.transaction(()=>{writeJsonDocument(f.sql,'workshop-stock',invalid);writeJsonDocument(f.sql,'last-backup-date','2026-11-23');}),TypeError);
   assert.equal(f.raw('workshop-stock'),before);assert.equal(f.raw('last-backup-date'),'"2026-11-22"');
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE key LIKE '%stage%' OR key LIKE '%temp%'").get().count,0);
 }finally{f.db.close();}
});

test('production-sized workshop edits retain unchanged image chunks and serialize in bounded pieces',t=>{
 const f=fixture();try{
  const image='data:image/png;base64,'+'A'.repeat(4800000),value={revision:9,items:Array.from({length:6},(_,index)=>({id:'image-'+index,unitCost:12.34,image})),metadata:{proof:'qa-r2:v1:'+'f'.repeat(64)+':1400000'}};
  const originalStringify=JSON.stringify,expectedHash=hash(originalStringify(value));let largestSerialized=0;
  t.mock.method(JSON,'stringify',(...args)=>{const serialized=originalStringify(...args);if(serialized!==undefined)largestSerialized=Math.max(largestSerialized,serialized.length);return serialized;});
  f.transaction(()=>writeJsonDocument(f.sql,'workshop-stock',value));
  assert.equal(hash(f.raw('workshop-stock')),expectedHash);
  const saved=f.parts('workshop-stock'),changes=()=>f.db.prepare('SELECT total_changes() AS count').get().count;
  assert.ok(saved.length>280);assert.ok(saved.every(({value})=>value.length<=100000));
  let before=changes();f.transaction(()=>writeJsonDocument(f.sql,'workshop-stock',value));
  assert.equal(changes()-before,0,'an identical rewrite must not change any SQLite row');
  value.items[0].unitCost=56.78;before=changes();f.transaction(()=>writeJsonDocument(f.sql,'workshop-stock',value));
  assert.equal(changes()-before,1,'same-length pricing edit changes only the first document part');
  const edited=f.parts('workshop-stock');assert.equal(edited.length,saved.length);
  for(let index=1;index<saved.length;index++)assert.equal(edited[index].value,saved[index].value,'unchanged image part '+index);
  assert.equal(hash(f.raw('workshop-stock')),hash(originalStringify(value)),'all image and R2 evidence bytes remain exact after the price change');
  const smaller={revision:10,items:[],metadata:{}};before=changes();f.transaction(()=>writeJsonDocument(f.sql,'workshop-stock',smaller));
  assert.equal(f.raw('workshop-stock'),originalStringify(smaller));assert.equal(f.parts('workshop-stock').length,1);
  assert.equal(changes()-before,saved.length,'the replacement changes one row and removes every stale tail row');
  assert.ok(largestSerialized<=100000,'no stringify call may materialize a full image or workshop document');
 }finally{f.db.close();}
});

test('backup document preserves the complete existing snapshot schema, fallback values and restoration payload',()=>{
 const f=fixture();try{
  const photos={proof:{data:'data:image/jpeg;base64,AAAA',width:10,height:20}},workshop={revision:5,items:[{id:'item',image:'data:image/png;base64,BBBB'}],metadata:{evidence:'qa-r2:v1:'+'a'.repeat(64)+':64'},stocktakes:[]};
  f.seed('app:variants',[{id:'sheet',qty:7}]);f.seed('app:photos',photos);f.seed('app:transactions',[{id:'activity',qty:7}]);f.seed('revision',8);f.seed('restoreEpoch',2);f.seed('workshop-stock',workshop);f.seed('users',{operator:{isAdmin:false}});f.seed('config',{enabled:false});f.seed('registration_code','123456');
  const attendance={entries:[{id:'visit',name:'Synthetic person',visitorSafetyAcknowledged:true,signedInAt:timestamp,signedOutAt:null}]};
  const expected={...Object.fromEntries(fields.map(field=>[field,f.store.read('app:'+field,field==='photos'?{}:[])])),revision:8,restoreEpoch:2,attendance,workshopStock:workshop,users:{operator:{isAdmin:false}},config:{enabled:false},registration_code:'123456',takenAt:timestamp,takenBy:username};
  f.reads.length=0;f.transaction(()=>writeBackupDocument(f.store,'backup:'+timestamp,{timestamp,username,fields,attendance}));
  assert.equal(f.raw('backup:'+timestamp),JSON.stringify(expected));
  assert.equal(readBackupTakenBy(f.sql,'backup:'+timestamp),username);
  assert.ok(!f.reads.includes('workshop-stock'));assert.ok(!f.reads.some(key=>key.startsWith('app:')),'raw application documents must not be parsed into the backup graph');
  const restored=JSON.parse(f.raw('backup:'+timestamp));assert.deepEqual(restored.photos,photos);assert.deepEqual(restored.workshopStock,workshop);
  const empty=fixture();try{
   empty.transaction(()=>writeBackupDocument(empty.store,'backup:empty',{timestamp,username,fields,attendance:{entries:[]}}));
   assert.deepEqual(JSON.parse(empty.raw('backup:empty')),{...Object.fromEntries(fields.map(field=>[field,field==='photos'?{}:[]])),revision:0,restoreEpoch:0,attendance:{entries:[]},workshopStock:null,users:{},config:null,registration_code:null,takenAt:timestamp,takenBy:username});
  }finally{empty.db.close();}
 }finally{f.db.close();}
});

test('a late backup serialization error rolls back the backup and daily marker together',()=>{
 const f=fixture();try{
  f.seed('app:variants',[{id:'sheet',qty:7}]);f.seed('app:photos',{data:'A'.repeat(250000)});f.seed('backup:existing',{takenBy:'previous',original:true});f.seed('last-backup-date','2026-11-22');
  const before=f.raw('backup:existing'),attendance={entries:[]};attendance.self=attendance;
  assert.throws(()=>f.transaction(()=>{writeBackupDocument(f.store,'backup:existing',{timestamp,username,fields,attendance});writeJsonDocument(f.sql,'last-backup-date','2026-11-23');}),TypeError);
  assert.equal(f.raw('backup:existing'),before);assert.equal(f.raw('last-backup-date'),'"2026-11-22"');
 }finally{f.db.close();}
});

test('malformed raw source JSON cannot commit an unusable backup or advance the daily marker',()=>{
 const f=fixture();try{
  f.seed('app:variants',[{id:'sheet',qty:7}]);f.seed('backup:existing',{takenBy:'previous',original:true});f.seed('last-backup-date','2026-11-22');
  const before=f.raw('backup:existing'),insert=f.db.prepare('INSERT INTO documents VALUES(?,?,?)');
  for(const malformed of ['{"items":[1,]}','{"items":"bad\\q"}','{"items":1e+}','{"items":true} trailing']){
   f.db.prepare('DELETE FROM documents WHERE key=?').run('workshop-stock');for(let index=0;index<malformed.length;index++)insert.run('workshop-stock',index,malformed[index]);
   assert.throws(()=>f.transaction(()=>{writeBackupDocument(f.store,'backup:existing',{timestamp,username,fields,attendance:{entries:[]}});writeJsonDocument(f.sql,'last-backup-date','2026-11-23');}));
   assert.equal(f.raw('backup:existing'),before);assert.equal(f.raw('last-backup-date'),'"2026-11-22"');
  }
 }finally{f.db.close();}
});

test('production-sized raw backup and list projection preserve image and R2 evidence without parsing source payloads',t=>{
 const f=fixture();try{
  const insert=f.db.prepare('INSERT INTO documents VALUES(?,?,?)'),writeChunks=(key,chunks)=>{let part=0;for(const value of chunks)insert.run(key,part++,value);};
  function* workshopChunks(){
   yield '{"revision":9,"items":[';
   for(let index=0;index<6;index++){
    yield (index?',':'')+'{"id":"image-'+index+'","image":"data:image/png;base64,';
    for(let part=0;part<48;part++)yield 'A'.repeat(100000);
    yield '"}';
   }
   yield '],"stocktakes":[],"reference":"qa-r2:v1:'+'a'.repeat(64)+':1400000"}';
  }
  writeChunks('workshop-stock',workshopChunks());
  writeChunks('app:photos',['{"evidence":{"data":"data:image/jpeg;base64,','B'.repeat(100000),'/+==","width":10,"height":20}}']);
  const workshopHash=hash(f.raw('workshop-stock')),photoHash=hash(f.raw('app:photos'));
  const originalParse=JSON.parse;let largestParse=0;
  t.mock.method(JSON,'parse',raw=>{largestParse=Math.max(largestParse,raw.length);return originalParse(raw);});
  f.store.read=(key,fallback=null)=>{assert.ok(!key.startsWith('app:')&&key!=='workshop-stock'&&!key.startsWith('backup:'),'full source read attempted: '+key);const raw=f.raw(key);return raw?JSON.parse(raw):fallback;};
  f.transaction(()=>writeBackupDocument(f.store,'backup:large',{timestamp,username,fields,attendance:{entries:[]}}));
  assert.equal(readBackupTakenBy(f.sql,'backup:large'),username);
  assert.ok(largestParse<100000,'only bounded metadata/projection may be parsed');
  const chunks=f.parts('backup:large');assert.ok(chunks.length>280);assert.ok(chunks.every(({value})=>value.length<=100000));
  const restored=originalParse(chunks.map(row=>row.value).join(''));assert.equal(hash(JSON.stringify(restored.workshopStock)),workshopHash);assert.equal(hash(JSON.stringify(restored.photos)),photoHash);
  assert.equal(restored.workshopStock.items[5].image.length,4800022);assert.equal(restored.workshopStock.reference,'qa-r2:v1:'+'a'.repeat(64)+':1400000');
  assert.equal(f.raw('workshop-stock').length>28000000,true);assert.equal(hash(f.raw('workshop-stock')),workshopHash);assert.equal(hash(f.raw('app:photos')),photoHash);
 }finally{f.db.close();}
});

test('backup takenBy projection accepts escaped keys and validates discarded malformed JSON',()=>{
 const f=fixture();try{
  const insert=f.db.prepare('INSERT INTO documents VALUES(?,?,?)');
  const raw=String.raw`{"unknown":{"nested":"quoted \" } \\ \u263a"},"taken\u0042y":"月 😀","takenBy":"last value"}`;
  for(let index=0;index<raw.length;index++)insert.run('backup:escaped',index,raw[index]);
  assert.equal(readBackupTakenBy(f.sql,'backup:escaped'),'last value');
  insert.run('backup:invalid',0,'{"takenBy":"counter","unknown":[1,]}');assert.throws(()=>readBackupTakenBy(f.sql,'backup:invalid'));
  assert.equal(readBackupTakenBy(f.sql,'missing'),undefined);
 }finally{f.db.close();}
});
