import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateChanges,validateOffcutCreations,normalizeChanges} from '../src/inventory.js';
import {requireCondition as check} from '../src/security.js';
import {cncDuplicateKey} from '../src/cnc-input.js';

const clone=value=>structuredClone(value);
const actor={username:'operator',isAdmin:false};
const stock=(id,patch={})=>({id,sku:'SKU-'+id,color:'Milled',material:'Solid Aluminium',thickness:3,width:480,height:1200,dimensionOrder:'sheet',qty:1,...patch});
const change=(after,before=null)=>({field:'offcuts',id:(after||before).id,before,after});
const isConflict=error=>error.status===409&&/matching offcut|Stock changed/.test(error.message);

// Exercise the production mutation method without importing its unrelated
// web routes or Cloudflare runtime. The method and its equality helpers come
// directly from store.js, including the real guard placement before writes.
const storeSource=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const start=storeSource.indexOf('  mutate(body,actor) {');
assert.ok(start>=0);
const end=storeSource.indexOf('\n  }',start)+4;
const helpers=storeSource.slice(storeSource.indexOf('const ok='),storeSource.indexOf('const cleanText='));
const mutate=vm.runInNewContext(helpers+'\n({'+storeSource.slice(start,end)+'}).mutate',{
  check,validateChanges,validateOffcutCreations,normalizeChanges,cncDuplicateKey
});
function memoryStore(offcuts=[]) {
  const values=new Map([['app:offcuts',clone(offcuts)],['app:transactions',[]],['revision',0],['restoreEpoch',0]]),mutations=new Map();
  const store={
    read:(key,fallback)=>clone(values.has(key)?values.get(key):fallback),
    write:(key,value)=>values.set(key,clone(value)),
    ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){},
    sql:{exec(statement,...args){
      if(statement.startsWith('SELECT username,payload,revision FROM mutations'))return{toArray:()=>mutations.has(args[0])?[clone(mutations.get(args[0]))]:[]};
      if(statement.startsWith('INSERT INTO mutations')){mutations.set(args[0],{username:args[1],payload:args[2],revision:args[3]});return;}
      throw Error('Unexpected SQL in test: '+statement);
    }}
  };
  return{store,values,mutations,apply:(body,who=actor)=>mutate.call(store,body,who)};
}
function packet(row,mutationId,before=null) {
  const qty=row.qty-(before?.qty||0);
  return{mutationId,restoreEpoch:0,changes:[change(row,before),{field:'transactions',id:mutationId+'-activity',before:null,after:{id:mutationId+'-activity',type:'offcut_add',itemType:'offcut',sku:row.sku,desc:'Saved offcut',qty,timestamp:'2026-11-04T10:00:00Z'}}]};
}

test('a second creator with a stale empty view cannot create a duplicate stock line',()=>{
  const env=memoryStore(),first=packet(stock('first'),'mutation-first-0001'),second=packet(stock('second'),'mutation-second-0002');
  assert.equal(env.apply(first).status,200);
  const snapshot=clone([...env.values]);
  assert.throws(()=>env.apply(second),isConflict);
  assert.deepEqual([...env.values],snapshot,'a rejected creator cannot partially save its stock, activity or revision');
  assert.equal(env.mutations.has(second.mutationId),false);
  assert.equal(env.apply(first).body.duplicate,true,'retrying the accepted mutation stays idempotent');
  assert.equal(env.store.read('app:offcuts',[]).length,1);
});

test('staff quantity-only merges preserve the target metadata and existing duplicate rows',()=>{
  const first=stock('first',{qty:3,note:'Existing location note',catalogId:'catalogue',sourceOrderNumber:'21'}),second=stock('historical',{qty:2});
  const env=memoryStore([first,second]),next={...first,qty:5};
  assert.equal(env.apply(packet(next,'mutation-merge-0003',first)).status,200);
  assert.deepEqual(env.store.read('app:offcuts',[]),[next,second]);
  const conflict=packet({...next,qty:6},'mutation-stale-0004',first);
  assert.throws(()=>env.apply(conflict),isConflict,'a concurrent stale quantity update still uses the existing conflict check');
});

test('same-batch duplicate creators are rejected before either stock record is written',()=>{
  const one=stock('one'),two=stock('two'),body=packet(one,'mutation-batch-0005');
  body.changes.push(change(two));
  const env=memoryStore();
  assert.throws(()=>env.apply(body),isConflict);
  assert.deepEqual(env.store.read('app:offcuts',[]),[]);
  assert.deepEqual(env.store.read('app:transactions',[]),[]);
});

test('the final batch removes a consumed source before testing a replacement identity',()=>{
  const source=stock('source'),replacement=stock('replacement');
  assert.doesNotThrow(()=>validateOffcutCreations([change(null,source),change(replacement)],[source]));
  assert.throws(()=>validateOffcutCreations([change(replacement)],[source]),isConflict);
  assert.doesNotThrow(()=>validateOffcutCreations([change({...source,qty:2},source)],[source]),'an update of an existing ID is not a creation');
  const env=memoryStore([source]),body=packet(replacement,'mutation-replace-0006');body.changes.unshift(change(null,source));
  assert.equal(env.apply(body,{...actor,isAdmin:true}).status,200);
  assert.deepEqual(env.store.read('app:offcuts',[]),[replacement],'the production mutation uses final stock after deleting its consumed source');
});

test('material, finish, thickness and ordered dimensions decide whether new offcuts match',()=>{
  const existing=stock('existing');
  assert.throws(()=>validateOffcutCreations([change(stock('new',{color:'  MILLED ',material:' solid   aluminium '}))],[existing]),isConflict);
  for(const patch of [{color:'White'},{material:'ALPOLIC'},{thickness:4},{width:481},{width:1200,height:480}]){
    assert.doesNotThrow(()=>validateOffcutCreations([change(stock('new',patch))],[existing]),JSON.stringify(patch));
  }
  const legacy=stock('legacy',{width:1200,height:480});delete legacy.dimensionOrder;
  assert.throws(()=>validateOffcutCreations([change(stock('same',{width:1200,height:480}))],[legacy]),isConflict);
  assert.doesNotThrow(()=>validateOffcutCreations([change(stock('reversed'))],[legacy]));
});

test('backend creation matching agrees with the frontend offcut stock key',()=>{
  const app=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
  const a=app.indexOf('function offcutStockKey(item)');assert.ok(a>=0);
  const b=app.indexOf('\nfunction ',a+1),key=vm.runInNewContext(app.slice(a,b)+';offcutStockKey');
  const existing=stock('existing'),samples=[stock('same'),stock('case',{material:'solid  aluminium',color:'MILLED'}),stock('rotated',{width:1200,height:480}),stock('thick',{thickness:4}),stock('finish',{color:'White'})];
  const legacy=stock('legacy',{width:1200,height:480});delete legacy.dimensionOrder;samples.push(legacy);
  for(const sample of samples){
    if(key(existing)===key(sample))assert.throws(()=>validateOffcutCreations([change(sample)],[existing]),isConflict);
    else assert.doesNotThrow(()=>validateOffcutCreations([change(sample)],[existing]));
  }
});
