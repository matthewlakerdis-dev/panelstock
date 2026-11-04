import test from 'node:test';
import assert from 'node:assert/strict';
import {orderSharingSettings,importSharedOrder} from '../src/order-sharing.js';
import {handleOrderDrafts} from '../src/order-drafts.js';
import {requireCondition as check} from '../src/security.js';
const alice={username:'alice',tasks:{'site.orders.create':true}},bob={username:'bob',tasks:{'site.orders.create':true}};
const pdf=(id=crypto.randomUUID())=>({id,name:'Gate sketch.pdf',data:btoa('%PDF-1.7\nSynthetic sketch\n%%EOF')});
function fixture(){
 const docs=new Map([['users',{alice:{active:true,displayName:'Alice Site',phone:'0400000000',pinHash:'old'},bob:{active:true,pinHash:'bob'}}]]),files=new Map(),limits=new Map(),audit=[];
 const store={read:(key,fallback=null)=>docs.has(key)?structuredClone(docs.get(key)):structuredClone(fallback),write:(key,value)=>docs.set(key,structuredClone(value)),audit:(...args)=>audit.push(args),taskAccess:()=>({'site.orders.create':true}),requireTask:(actor,task)=>check(actor.isAdmin||actor.tasks?.[task],'Task access denied',403),consumeLimit:(key,max)=>{const count=limits.get(key)||0;check(count<max,'Too many attempts',429);limits.set(key,count+1);},ctx:{storage:{transactionSync:fn=>fn()},waitUntil:promise=>promise.catch(()=>{})},env:{CAD_PROJECT_FILES:{put:async(key,bytes)=>files.set(key,bytes.slice()),get:async key=>{const bytes=files.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;},delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])files.delete(key);}}}};
 const setup=(body,actor=alice)=>orderSharingSettings(store,'POST',body,actor),key=async(actor=alice)=>(await setup({action:'create',label:actor.username+' iPad'},actor)).key;
 const send=(body,token)=>importSharedOrder(store,body,token,'192.0.2.15');
 const drafts=(path='',method='GET',body={},actor=alice)=>handleOrderDrafts(store,'/order-drafts'+path,method,body,actor);
 return {store,docs,files,limits,audit,setup,key,send,drafts};
}

test('sharing credentials are hashed, shown once, owned and individually revocable',async()=>{
 const f=fixture(),secret=await f.key(),id=secret.split('.')[1];
 assert.match(secret,/^ps-share\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify([...f.docs]).includes(secret.split('.')[2]));
 const listed=await orderSharingSettings(f.store,'GET',{},alice);
 assert.equal(listed.keys.length,1);assert.equal(listed.keys[0].label,'alice iPad');assert.equal(listed.keys[0].hash,undefined);
 assert.deepEqual((await orderSharingSettings(f.store,'GET',{},bob)).keys,[]);
 await assert.rejects(()=>f.setup({action:'revoke',id},bob),/not found/);
 const other=await f.key();await f.setup({action:'revoke',id});
 await assert.rejects(()=>f.send(pdf(),secret),/removed/);
 assert.equal((await f.send(pdf(),other)).ok,true);
});

test('a Goodnotes upload creates one private account draft with defaults, never an order or email',async()=>{
 const f=fixture(),secret=await f.key(),body=pdf(),result=await f.send(body,secret);
 assert.equal(result.openUrl,'https://site.panelstockhq.com/#shared-draft='+body.id+'&owner=alice');
 assert.equal(result.key,undefined);assert.equal(result.file,undefined);
 const {draft}=await f.drafts('/'+body.id);
 assert.equal(draft.attachments.length,1);assert.equal(draft.attachments[0].name,body.name);
 assert.equal(draft.order.siteContact,'Alice Site');assert.equal(draft.order.phone,'0400000000');
 assert.equal(draft.order.requestedDeliveryDate,'');assert.equal(draft.order.projectId,'');assert.equal(draft.order.orderType,'');
 assert.deepEqual(draft.order.items,[]);
 assert.equal((await f.drafts('/'+body.id+'/files/'+body.id)).file.data,body.data);
 await assert.rejects(()=>f.drafts('/'+body.id,'GET',{},bob),/not found/);
 assert.equal(f.docs.has('orders'),false);assert.equal(f.docs.has('order-email-jobs'),false);
 assert.equal(f.files.size,1);
});

test('lost-response and concurrent retries preserve the original draft and exactly one private file',async()=>{
 const f=fixture(),secret=await f.key(),body=pdf();
 const results=await Promise.all([f.send(body,secret),f.send(body,secret),f.send(body,secret)]);
 assert.ok(results.every(result=>result.draftId===body.id));
 assert.equal((await f.drafts()).drafts.length,1);assert.equal(f.files.size,1);
 assert.equal(f.audit.filter(event=>event[1]==='order-draft-shared').length,1);
 const draft=(await f.drafts('/'+body.id)).draft;
 await f.drafts('/'+body.id,'POST',{order:{...draft.order,project:'USER EDIT'},attachmentIds:[body.id],expectedUpdatedAt:draft.updatedAt});
 await f.send(body,secret);assert.equal((await f.drafts('/'+body.id)).draft.order.project,'USER EDIT');
 await assert.rejects(()=>f.send({...body,data:btoa('%PDF-other')},secret),/different file/);
});

test('a retry after deletion does not recreate a discarded or submitted draft',async()=>{
 const f=fixture(),secret=await f.key(),body=pdf();await f.send(body,secret);
 const {draft}=await f.drafts('/'+body.id);await f.drafts('/'+body.id+'/discard','POST',{expectedUpdatedAt:draft.updatedAt});
 assert.equal(f.files.size,0);await f.send(body,secret);
 assert.equal((await f.drafts()).drafts.length,0);assert.equal(f.files.size,0);
});

test('sharing never replaces existing account drafts or overwrites a caller-selected draft ID',async()=>{
 const f=fixture(),secret=await f.key(),existing=pdf();
 const saved=await f.drafts('/'+existing.id,'POST',{order:{items:[],project:'Unfinished order'},attachmentIds:[]});
 await assert.rejects(()=>f.send(existing,secret),/already in use/);
 await f.send(pdf(),secret);assert.equal((await f.drafts()).drafts.length,2);
 assert.deepEqual((await f.drafts('/'+existing.id)).draft,saved.draft);
});

for(const [label,change]of [
 ['disabled user',f=>{const users=f.store.read('users');users.alice.active=false;f.store.write('users',users);}],
 ['PIN reset',f=>{const users=f.store.read('users');users.alice.pinHash='new';f.store.write('users',users);}],
 ['forced PIN change',f=>{const users=f.store.read('users');users.alice.mustChangePin=true;f.store.write('users',users);}],
 ['Site app access removed',f=>{const users=f.store.read('users');users.alice.appAccess={site:false};f.store.write('users',users);}],
 ['order creation permission removed',f=>{f.store.taskAccess=()=>({'site.orders.create':false});}],
 ['expired key',f=>{for(const [id,record]of f.docs)if(id.startsWith('order-share-key:'))f.store.write(id,{...record,expiresAt:0});}]
])test('sharing respects '+label,async()=>{
 const f=fixture(),secret=await f.key();change(f);
 await assert.rejects(()=>f.send(pdf(),secret));assert.equal(f.files.size,0);assert.equal((f.store.read('order-drafts:alice',[])).length,0);
});

for(const change of ['revoke','pin','tasks'])test('a '+change+' change during upload prevents commit and cleans its private object',async()=>{
 const f=fixture(),secret=await f.key(),put=f.store.env.CAD_PROJECT_FILES.put;
 f.store.env.CAD_PROJECT_FILES.put=async(...args)=>{await put(...args);if(change==='revoke')await f.setup({action:'revoke',id:secret.split('.')[1]});else if(change==='pin'){const users=f.store.read('users');users.alice.pinHash='changed during upload';f.store.write('users',users);}else f.store.taskAccess=()=>({});};
 await assert.rejects(()=>f.send(pdf(),secret));assert.equal(f.files.size,0);assert.equal((f.store.read('order-drafts:alice',[])).length,0);
});

test('only PDF files within the existing 5 MB attachment limit are accepted',async()=>{
 const f=fixture(),secret=await f.key();
 for(const body of [{...pdf(),name:'note.goodnotes'},{...pdf(),name:'bad\n.pdf'},{...pdf(),data:btoa('<html>Bad</html>')},{...pdf(),data:'not base64'},{...pdf(),data:btoa('')},{...pdf(),data:'A'.repeat(4*Math.ceil(5*1024*1024/3)+4)}])await assert.rejects(()=>f.send(body,secret));
 assert.equal(f.files.size,0);assert.equal((await f.drafts()).drafts.length,0);
});

test('five-device and twenty-draft limits do not block successful retry lookup',async()=>{
 const f=fixture(),secret=await f.key();for(let i=1;i<5;i++)await f.key();await assert.rejects(()=>f.key(),/maximum 5/);
 const first=pdf();await f.send(first,secret);for(let i=1;i<20;i++)await f.send(pdf(),secret);
 await assert.rejects(()=>f.send(pdf(),secret),/20 drafts/);
 assert.equal((await f.send(first,secret)).draftId,first.id);
 assert.equal((await f.drafts()).drafts.length,20);assert.equal(f.files.size,20);
});

test('an uncertain private upload failure leaves no partial draft and can retry the same request',async()=>{
 const f=fixture(),secret=await f.key(),body=pdf(),put=f.store.env.CAD_PROJECT_FILES.put;
 f.store.env.CAD_PROJECT_FILES.put=async(...args)=>{await put(...args);throw Error('Upload response lost');};
 await assert.rejects(()=>f.send(body,secret),/response lost/);assert.equal(f.files.size,0);assert.equal((await f.drafts()).drafts.length,0);
 f.store.env.CAD_PROJECT_FILES.put=put;assert.equal((await f.send(body,secret)).draftId,body.id);assert.equal(f.files.size,1);
});

test('native date-and-random Shortcut retry keys become stable owner-scoped draft IDs',async()=>{
 const f=fixture(),key=await f.key(),body=pdf('20261104123000123-123456789'),first=await f.send(body,key),again=await f.send(body,key);
 assert.match(first.draftId,/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(first.draftId,again.draftId);assert.equal(body.id,'20261104123000123-123456789');
 const bobKey=await f.key(bob),other=await f.send(body,bobKey);assert.notEqual(other.draftId,first.draftId);
 assert.equal((await f.drafts('/'+first.draftId+'/files/'+first.draftId)).file.data,body.data);
 await assert.rejects(()=>f.send({...body,id:'x'.repeat(201)},key),/identifier/);
 await assert.rejects(()=>f.send({...body,id:'bad\nidentifier'},key),/identifier/);
});
