import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {Outbox}=createRequire(import.meta.url)('../../panelstock-client.js');
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
const stock={id:'v1',qty:10};
const snapshot={variants:[stock],transactions:[],revision:0,restoreEpoch:0};
const success=()=>new Response(JSON.stringify({revision:1}),{status:200});
test('stock and activity stage durably before network and form one packet',async()=>{
 const saved=storage();let sent;const box=new Outbox(saved,async packet=>{sent=packet;return success();});
 box.snapshot(snapshot,'staff');box.stage({variants:[{...stock,qty:9}]},'staff');
 assert.ok(JSON.parse(saved.getItem('panelstock:outbox:v2')).draft);assert.equal(sent,undefined);
 box.stage({transactions:[{id:'t1',qty:1}]},'staff');
 await new Promise(r=>setImmediate(r));assert.equal(sent.changes.length,2);assert.equal(box.pending(),false);
});
test('acknowledging an in-flight packet preserves a later change',async()=>{
 let finish;const sent=[];const box=new Outbox(storage(),packet=>{sent.push(packet);return sent.length===1?new Promise(r=>finish=r):Promise.resolve(new Response('{}',{status:503}));});
 box.snapshot(snapshot,'staff');box.stage({variants:[{...stock,qty:9}]},'staff');await new Promise(r=>setImmediate(r));
 box.stage({variants:[{...stock,qty:8}]},'staff');await new Promise(r=>setImmediate(r));
 finish(success());await box.running;
 assert.equal(box.state.queue.length,1);assert.equal(box.state.queue[0].changes[0].after.qty,8);
});
test('reload retains a draft and conflict never clears queued work',async()=>{
 const saved=storage();const box=new Outbox(saved,async()=>new Response('{"error":"Stock changed"}',{status:409}));
 box.snapshot(snapshot,'staff');box.stage({variants:[{...stock,qty:9}]},'staff');
 const restored=new Outbox(saved,async()=>new Response('{"error":"Stock changed"}',{status:409}));
 assert.ok(restored.state.draft);await restored.flush('staff');
 assert.equal(restored.state.queue.length,1);assert.equal(restored.state.blocked,'Stock changed');
 assert.equal(restored.snapshot({...snapshot,variants:[{...stock,qty:100}]},'staff').variants[0].qty,9);
 await new Promise(r=>setImmediate(r));
});
test('pending work cannot be submitted by a different user',async()=>{
 let sent=0;const box=new Outbox(storage(),async()=>{sent++;return success();});
 box.snapshot(snapshot,'staff');box.stage({variants:[{...stock,qty:9}]},'staff');box.finalize();
 await box.flush('admin');assert.equal(sent,0);
 await new Promise(r=>setImmediate(r));
});
test('an older rendered screen keeps its own expectation even after polling',async()=>{
 const box=new Outbox(storage(),async()=>new Response('{}',{status:503}));
 box.snapshot({...snapshot,variants:[{...stock,qty:20}]},'staff');
 box.stage({variants:[{...stock,qty:9}]},'staff',snapshot);box.finalize();
 assert.equal(box.state.queue[0].changes[0].before.qty,10);
 await new Promise(r=>setImmediate(r));
});
