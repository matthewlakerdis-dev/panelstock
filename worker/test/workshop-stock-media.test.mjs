import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readDeferredWorkshopState,readWorkshopItemImage,deferStockResponse} from '../src/workshop-stock-media.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE documents(key TEXT,part INTEGER,value TEXT NOT NULL,PRIMARY KEY(key,part))');
 const sql={exec(query,...parameters){const statement=db.prepare(query);return {toArray:()=>statement.all(...parameters),[Symbol.iterator]:()=>statement.iterate(...parameters)};}};
 const raw=key=>db.prepare('SELECT value FROM documents WHERE key=? ORDER BY part').all(key).map(row=>row.value).join('');
 const seedRaw=(key,value,size=100000)=>{db.prepare('DELETE FROM documents WHERE key=?').run(key);const insert=db.prepare('INSERT INTO documents VALUES(?,?,?)');let part=0;for(let index=0;index<value.length;){let end=Math.min(value.length,index+size);if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff&&value.charCodeAt(end)>=0xdc00&&value.charCodeAt(end)<=0xdfff)end--;if(end===index)end=index+2;insert.run(key,part++,value.slice(index,end));index=end;}};
 const seed=(key,value,size)=>seedRaw(key,JSON.stringify(value),size);
 return {db,sql,raw,seed,seedRaw};
}
function images(value,result=[]){
 if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(key==='image'&&typeof item==='string'&&item)result.push(item);images(item,result);}
 return result;
}
const endpoint=id=>'/workshop-stock/images/'+encodeURIComponent(id);

test('deferred reads filter every nonempty object image while preserving escaped JSON and unrelated values',()=>{
 const f=fixture();try{
  const raw=String.raw`{"revision":7,"items":[{"im\u0061ge":"data:image/png;base64,AA\"\\\n\u263a","nested":{"image":"private nested image"},"id":"月 \ud83d\ude00","name":"keep data:image/png;base64,TEXT"},{"id":"empty","image":""},{"id":"null","image":null},{"id":"number","image":42}],"metadata":{"variant:one":{"image":"private metadata image"}},"history":[{"image":"private history image"}],"outside":[true,false,null,-1.25e+3]}`;
  const original=JSON.parse(raw);
  for(const size of [1,2,3,7,13,29]){
   f.seedRaw('workshop-stock',raw,size);const lean=readDeferredWorkshopState(f.sql);
   assert.equal(lean.revision,7);assert.equal(lean.items[0].id,'月 😀');assert.equal(lean.items[0].name,original.items[0].name);assert.deepEqual(lean.outside,original.outside);
   assert.equal(lean.items[1].image,'');assert.equal(lean.items[2].image,null);assert.equal(lean.items[3].image,42);
   const deferred=images(lean);assert.equal(deferred.length,4);assert.ok(deferred.every(value=>typeof value==='string'&&value));
   for(const image of images(original))assert.equal(deferred.includes(image),false,'original image must not remain in the parsed graph');
   assert.deepEqual(readWorkshopItemImage(f.sql,'月 😀'),{itemId:'月 😀',image:original.items[0].image,imageVersion:7});
   assert.equal(f.raw('workshop-stock'),raw,'readers must not modify stored evidence');
  }
 }finally{f.db.close();}
});

test('missing workshop data uses the supplied fallback and malformed skipped image JSON fails closed',()=>{
 const f=fixture();try{
  assert.equal(readDeferredWorkshopState(f.sql),null);const fallback={revision:0,items:[]};assert.equal(readDeferredWorkshopState(f.sql,fallback),fallback);
  assert.equal(readWorkshopItemImage(f.sql,'missing'),null);
  for(const raw of ['{"items":[{"image":"bad\\q","id":"one"}]}','{"items":[{"image":"unfinished}]}','{"items":[{"image":"hidden","id":"one"}],"unknown":[1,]}','{"items":[]} trailing']){
   f.seedRaw('workshop-stock',raw,1);assert.throws(()=>readDeferredWorkshopState(f.sql));assert.throws(()=>readWorkshopItemImage(f.sql,'one'));
  }
 }finally{f.db.close();}
});

test('manual image lookup matches image-before-id ordering and excludes archived, absent or empty images',()=>{
 const f=fixture();try{
  const first='data:image/png;base64,AAAA',second='data:image/jpeg;base64,BBBB';
  f.seed('workshop-stock',{revision:4,items:[{image:'private archived image',id:'archived',archivedAt:'2026-11-01'},{image:first,nested:{image:'unrelated nested'},id:'one'},{nested:{image:'before top image'},image:second,id:'two'},{id:'empty',image:''},{id:'missing-image'},{id:'null-image',image:null}],metadata:{'variant:orphan':{image:'private orphan metadata'}}},11);
  assert.deepEqual(readWorkshopItemImage(f.sql,'one'),{itemId:'one',image:first,imageVersion:4});assert.deepEqual(readWorkshopItemImage(f.sql,'two'),{itemId:'two',image:second,imageVersion:4});
  for(const id of ['archived','empty','missing-image','null-image','missing','variant:orphan'])assert.equal(readWorkshopItemImage(f.sql,id),null,id);
 }finally{f.db.close();}
});

test('legacy variants and offcuts use own metadata image overrides including an explicit empty image',()=>{
 const f=fixture();try{
  const variants=[{image:'data:image/png;base64,BASE',id:'base'},{id:'override',image:'data:image/png;base64,OLD'},{id:'empty',image:'data:image/png;base64,HIDDEN'},{id:'archived',image:'private archived variant',archivedAt:'2026-11-01'}],offcuts=[{image:'data:image/jpeg;base64,OFFCUT',id:'piece'},{id:'archived',image:'private archived offcut',archivedAt:'2026-11-01'}];
  f.seed('app:variants',variants,5);f.seed('app:offcuts',offcuts,7);f.seed('workshop-stock',{revision:12,items:[],metadata:{'variant:override':{image:'data:image/png;base64,NEW'},'variant:empty':{image:''},'variant:missing':{image:'private missing variant'},'offcut:missing':{image:'private missing offcut'}}},9);
  assert.deepEqual(readWorkshopItemImage(f.sql,'variant:base'),{itemId:'variant:base',image:variants[0].image,imageVersion:12});
  assert.deepEqual(readWorkshopItemImage(f.sql,'variant:override'),{itemId:'variant:override',image:'data:image/png;base64,NEW',imageVersion:12});
  assert.deepEqual(readWorkshopItemImage(f.sql,'offcut:piece'),{itemId:'offcut:piece',image:offcuts[0].image,imageVersion:12});
  for(const id of ['variant:empty','variant:archived','offcut:archived','variant:missing','offcut:missing'])assert.equal(readWorkshopItemImage(f.sql,id),null,id);
 }finally{f.db.close();}
});

test('image version is included only for a valid nonnegative integer workshop revision',()=>{
 const f=fixture();try{
  for(const revision of [0,5,'5',null,-1,1.5]){
   f.seed('workshop-stock',{revision,items:[{id:'one',image:'data:image/png;base64,AAAA'}],metadata:{}});
   const result=readWorkshopItemImage(f.sql,'one');assert.equal(result.image,'data:image/png;base64,AAAA');
   if(Number.isSafeInteger(revision)&&revision>=0)assert.equal(result.imageVersion,revision);else assert.equal(Object.hasOwn(result,'imageVersion'),false);
  }
 }finally{f.db.close();}
});

test('response projection is pure, removes all nested image evidence and exposes relative item URLs only',()=>{
 const f=fixture();try{
  f.seed('workshop-stock',{revision:8,items:[{id:'manual / 月',image:'data:image/png;base64,MANUAL',history:[{image:'private old item image'}]},{id:'empty',image:''}],metadata:{'variant:sheet / one':{image:'data:image/png;base64,META',history:[{image:'private metadata history'}]},'offcut:empty':{image:''}},stocktakes:[{counts:{one:{item:{image:'private counted image'}}}}]});
  const body={ok:true,...readDeferredWorkshopState(f.sql),history:[{image:'data:image/png;base64,INLINE'}]},before=JSON.stringify(body),markers=images(body),projected=deferStockResponse(body);
  assert.equal(JSON.stringify(body),before,'deferred response must not mutate its input');assert.notEqual(projected,body);assert.equal(projected.ok,true);
  assert.equal(projected.items[0].hasImage,true);assert.equal(projected.items[0].imageUrl,endpoint('manual / 月'));assert.equal(projected.items[1].hasImage,false);
  assert.equal(projected.metadata['variant:sheet / one'].hasImage,true);assert.equal(projected.metadata['variant:sheet / one'].imageUrl,endpoint('variant:sheet / one'));assert.equal(projected.metadata['offcut:empty'].hasImage,false);
  assert.equal(images(projected).length,0);const wire=JSON.stringify(projected);for(const marker of markers)assert.equal(wire.includes(marker),false,'internal marker or inline image must not reach the wire');
  for(const privateText of ['private old item image','private metadata history','private counted image','data:image/'])assert.equal(wire.includes(privateText),false);
 }finally{f.db.close();}
});

test('response image versions use the explicit stock version and never expose persisted internal markers',()=>{
 for(const [stockImageRevision,expected]of [[0,0],['profile:23.sha-abc','profile:23.sha-abc'],[null,8],[-1,undefined],[1.5,undefined],['private version with spaces',undefined],['x'.repeat(101),undefined]]){
  const result=deferStockResponse({revision:8,stockImageRevision,items:[{id:'one',image:'data:image/png;base64,AAAA'}],metadata:{}});
  assert.equal(result.items[0].imageUrl,endpoint('one'));
  if(expected===undefined)assert.equal(Object.hasOwn(result.items[0],'imageVersion'),false);else assert.equal(result.items[0].imageVersion,expected);
 }
 const f=fixture();try{
  f.seed('workshop-stock',{revision:8,items:[{id:'one',image:'data:image/png;base64,AAAA'}],metadata:{}});const marker=readDeferredWorkshopState(f.sql).items[0].image;
  f.seed('workshop-stock',{revision:8,items:[{id:'one',image:marker}],metadata:{}});
  assert.equal(readWorkshopItemImage(f.sql,'one'),null,'an internal marker is never an original downloadable image');
  const projected=deferStockResponse({items:[{id:'one',image:marker}],metadata:{},nested:{privateMarker:marker}});
  assert.equal(JSON.stringify(projected).includes(marker),false);
 }finally{f.db.close();}
});

test('production-sized SQLite images are deferred before parsing and only the selected image is reconstructed',t=>{
 const f=fixture();try{
  const insert=f.db.prepare('INSERT INTO documents VALUES(?,?,?)');let part=0;
  const emit=value=>insert.run('workshop-stock',part++,value);
  emit('{"revision":23,"items":[');
  for(let index=0;index<6;index++){
   emit((index?',':'')+'{"image":"data:image/png;base64,');for(let block=0;block<48;block++)emit(String.fromCharCode(65+index).repeat(100000));emit('","id":"item-'+index+'","name":"Synthetic stock"}');
  }
  emit('],"metadata":{"variant:one":{"image":"private metadata image"}},"history":[{"image":"private history image"}]}');
  const beforeHash=hash(f.raw('workshop-stock')),changes=f.db.prepare('SELECT total_changes() AS count').get().count,nativeParse=JSON.parse;let largestParse=0;
  t.mock.method(JSON,'parse',raw=>{largestParse=Math.max(largestParse,raw.length);return nativeParse(raw);});
  const lean=readDeferredWorkshopState(f.sql);assert.ok(JSON.stringify(lean).length<10000);assert.ok(largestParse<100000,'full image library must never be parsed into the lean graph');
  largestParse=0;const selected=readWorkshopItemImage(f.sql,'item-4'),expected='data:image/png;base64,'+'E'.repeat(4800000);
  assert.equal(selected.itemId,'item-4');assert.equal(selected.imageVersion,23);assert.equal(hash(selected.image),hash(expected));assert.ok(largestParse<6000000,'only one image may be reconstructed, not the complete library');
  assert.equal(images(deferStockResponse({ok:true,...lean})).length,0);assert.equal(hash(f.raw('workshop-stock')),beforeHash);assert.equal(f.db.prepare('SELECT total_changes() AS count').get().count,changes,'image reads and response projection must be read-only');
 }finally{f.db.close();}
});
