import test from 'node:test';
import assert from 'node:assert/strict';
import {handleOrderDrafts} from '../src/order-drafts.js';
const id='11111111-1111-4111-8111-111111111111',fid='22222222-2222-4222-8222-222222222222';
const alice={username:'alice',allowed:true},bob={username:'bob',allowed:true};
function fixture(){
 const docs=new Map(),files=new Map();
 const bucket={put:async(key,bytes)=>files.set(key,bytes),get:async key=>{const bytes=files.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;},delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])files.delete(key);}};
 const store={read:(key,fallback)=>docs.has(key)?structuredClone(docs.get(key)):fallback,write:(key,value)=>docs.set(key,structuredClone(value)),requireTask:(actor,task)=>{assert.equal(task,'site.orders.create');if(!actor.allowed)throw Error('Denied');},env:{CAD_PROJECT_FILES:bucket},ctx:{storage:{transactionSync:fn=>fn()},waitUntil:promise=>promise.catch(()=>{})}};
 return {store,docs,files,call:(path,method='GET',body={},actor=alice)=>handleOrderDrafts(store,path,method,body,actor)};
}
const input=()=>({order:{project:'',siteContact:'',phone:'',requestedDeliveryDate:'',orderType:'Panels',status:'completed',orderNumber:'99',items:[{quantity:'',description:''}]},attachmentIds:[],expectedUpdatedAt:''});
test('incomplete drafts round trip privately without orders, numbers or notifications',async()=>{
 const {call,docs}=fixture();
 await assert.rejects(()=>call('/order-drafts','GET',{},{}),/Denied/);
 const {draft}=await call('/order-drafts/'+id,'POST',input());
 assert.equal(draft.order.status,'submitted');assert.equal(draft.order.orderNumber,undefined);assert.equal(draft.order.items[0].quantity,'');
 assert.equal((await call('/order-drafts')).drafts.length,1);
 assert.equal((await call('/order-drafts','GET',{},bob)).drafts.length,0);
 await assert.rejects(()=>call('/order-drafts/'+id,'GET',{},bob),/not found/);
 assert.equal([...docs.keys()].some(key=>key==='orders'||key.includes('email')),false);
});
test('draft overwrites and deletion require the current version',async()=>{
 const {call}=fixture();const {draft}=await call('/order-drafts/'+id,'POST',input());
 await assert.rejects(()=>call('/order-drafts/'+id,'POST',input()),/changed/);
 const next=await call('/order-drafts/'+id,'POST',{...input(),expectedUpdatedAt:draft.updatedAt,order:{...input().order,project:'Airport'}});
 assert.ok(next.draft.updatedAt>draft.updatedAt);
 await assert.rejects(()=>call('/order-drafts/'+id+'/discard','POST',{expectedUpdatedAt:draft.updatedAt}),/changed/);
 await assert.rejects(()=>call('/order-drafts/'+id+'/discard','POST',{expectedUpdatedAt:next.draft.updatedAt},bob),/not found/);
 await call('/order-drafts/'+id+'/discard','POST',{expectedUpdatedAt:next.draft.updatedAt});
 assert.equal((await call('/order-drafts')).drafts.length,0);
 await assert.rejects(()=>call('/order-drafts/'+id),/not found/);
});
test('draft files persist, retry safely, remain private and are cleaned up',async()=>{
 const {call,files}=fixture();const {draft}=await call('/order-drafts/'+id,'POST',input());
 const body={id:fid,name:'photo.jpg',data:btoa('photo bytes'),expectedUpdatedAt:draft.updatedAt};
 const uploaded=await call('/order-drafts/'+id+'/files','POST',body);assert.equal(uploaded.draft.attachments.length,1);
 assert.equal((await call('/order-drafts/'+id+'/files','POST',body)).draft.attachments.length,1);
 assert.equal((await call('/order-drafts/'+id+'/files/'+fid)).file.data,body.data);
 await assert.rejects(()=>call('/order-drafts/'+id+'/files/'+fid,'GET',{},bob),/not found/);
 await assert.rejects(()=>call('/order-drafts/'+id+'/files','POST',{...body,data:btoa('changed')}),/identifier/);
 await call('/order-drafts/'+id,'POST',{...input(),expectedUpdatedAt:uploaded.draft.updatedAt});
 assert.equal(files.size,0);
 const again=await call('/order-drafts/'+id);
 const added=await call('/order-drafts/'+id+'/files','POST',{...body,expectedUpdatedAt:again.draft.updatedAt});
 await call('/order-drafts/'+id+'/discard','POST',{expectedUpdatedAt:added.draft.updatedAt});
 assert.equal(files.size,0);
});
test('drafts reject oversized fields and forged files and enforce a per-user limit',async()=>{
 const {call}=fixture();
 await assert.rejects(()=>call('/order-drafts/'+id,'POST',{...input(),order:{...input().order,items:[{quantity:1,description:'x'.repeat(181)}]}}),/description/);
 for(let i=0;i<20;i++){const uid=String(i).padStart(8,'0')+'-1111-4111-8111-111111111111';await call('/order-drafts/'+uid,'POST',input());}
 await assert.rejects(()=>call('/order-drafts/'+id,'POST',input()),/20 drafts/);
 // Limits are per user.
 const {draft}=await call('/order-drafts/'+id,'POST',input(),bob);
 await assert.rejects(()=>call('/order-drafts/'+id+'/files','POST',{id:fid,name:'big.bin',data:'a'.repeat(4*Math.ceil(5*1024*1024/3)+4),expectedUpdatedAt:draft.updatedAt},bob),/5 MB/);
});
