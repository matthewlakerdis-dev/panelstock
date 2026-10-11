import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {orderComments} from '../src/order-comments.js';
const order={id:randomUUID(),orderNumber:'42',requestedBy:'alice',project:'Airport',orderType:'Panels',updatedAt:'original',items:[{quantity:2,description:'Panels'}]};
const tasks={'site.orders.view':true,'site.orders.create':true};
const alice={username:'alice',tasks},manager={username:'office',tasks:{'site.orders.view':true,'site.orders.manage':true}},viewer={username:'viewer',tasks:{'site.orders.view':true}};
function fixture(){
 const docs=new Map([['orders',[structuredClone(order)]],['users',{alice:{},office:{},admin:{isAdmin:true},viewer:{},disabled:{active:false},revoked:{}}]]),audits=[],alerts=[];
 const access={alice:tasks,office:manager.tasks,admin:{'site.orders.view':true},viewer:viewer.tasks,disabled:manager.tasks,revoked:{}};
 const store={read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),requireTask(actor,task){if(!actor.isAdmin&&actor.tasks?.[task]!==true)throw Object.assign(Error('Denied'),{status:403});},taskAccess:username=>access[username]||{},audit:(...args)=>audits.push(args),notify:(...args)=>alerts.push(args),ctx:{storage:{transactionSync:fn=>{const before=new Map(structuredClone([...docs]));try{return fn();}catch(error){docs.clear();for(const [k,v] of before)docs.set(k,v);throw error;}}}}};
 const call=(method='GET',body={},actor=alice,id=order.id)=>orderComments(store,id,method,body,actor);
 return {call,docs,audits,alerts,store};
}
const message=(text='Can you confirm the finish?',kind='clarification',replyTo='')=>({id:randomUUID(),text,kind,replyTo});
test('discussion is scoped, server-authored and separate from panel order definitions',()=>{
 const f=fixture(),body={...message(),author:'impersonated',createdAt:'fake',status:'completed'};
 const result=f.call('POST',body);assert.equal(result.orderId,order.id);assert.equal(result.canComment,true);
 assert.deepEqual(Object.keys(result.comments[0]),['id','text','kind','replyTo','author','createdAt']);assert.equal(result.comments[0].author,'alice');assert.notEqual(result.comments[0].createdAt,'fake');
 assert.deepEqual(f.docs.get('orders'),[order]);assert.deepEqual(f.call('GET',{},viewer).comments,result.comments);assert.equal(f.call('GET',{},viewer).canComment,false);
 assert.throws(()=>f.call('GET',{},alice,randomUUID()),/not found/);assert.throws(()=>f.call('GET',{}, {username:'denied',tasks:{}}),/Denied/);
});
test('posting requires a requester with create access or an order manager; viewing is separate',()=>{
 const f=fixture();for(const actor of [viewer,{username:'other',tasks},{...alice,tasks:{'site.orders.view':true}}])assert.throws(()=>f.call('POST',message(),actor),/Only the requester/);
 assert.equal(f.call('POST',message(),manager).comments[0].author,'office');assert.equal(f.call('POST',message(),{username:'admin',isAdmin:true}).comments.length,2);
 assert.throws(()=>f.call('DELETE'),/Method not allowed/);
});
test('lost-response retries create one comment, audit and alert; changed payload cannot reuse an ID',()=>{
 const f=fixture(),body=message();const first=f.call('POST',body);assert.deepEqual(f.call('POST',body),first);assert.equal(f.audits.length,1);assert.equal(f.alerts.length,1);
 for(const changed of [{text:'changed'},{kind:'comment'},{replyTo:randomUUID(),kind:'comment'}])assert.throws(()=>f.call('POST',{...body,...changed}),/already in use/);
 assert.throws(()=>f.call('POST',body,manager),/already in use/);assert.equal(f.call().comments.length,1);
});
test('replies reference a top-level message in this order and notify only eligible participants and managers',()=>{
 const f=fixture(),question=message();f.call('POST',question);
 assert.deepEqual(f.alerts[0][0],['office','admin']);assert.equal(f.alerts[0][1].priority,'important');assert.equal(f.alerts[0][1].orderId,order.id);
 const answer=message('Use satin white.','comment',question.id);f.call('POST',answer,manager);
 assert.deepEqual(f.alerts[1][0],['alice','admin']);assert.match(f.alerts[1][1].title,/new reply/);
 assert.throws(()=>f.call('POST',message('Nested','comment',answer.id)),/original comment/);
 assert.throws(()=>f.call('POST',message('Other order','comment',randomUUID())),/original comment/);
 assert.throws(()=>f.call('POST',message('Question','clarification',question.id)),/reply must be/);
});
test('validation rejects invalid or oversized messages without writes; plain multiline text is retained',()=>{
 const f=fixture();for(const body of [{...message(),id:'bad'},message(''),message(' '.repeat(10)),message('x'.repeat(2001)),message('bad\u0000text'),{...message(),kind:'unknown'},{...message(),replyTo:{}}])assert.throws(()=>f.call('POST',body));
 assert.equal(f.audits.length,0);const body=message('  <script>plain text</script>\nLine two\tvalue  ','comment');assert.equal(f.call('POST',body).comments[0].text,body.text.trim());
});
test('bounded discussions still acknowledge a prior successful post; atomic failure preserves the thread',()=>{
 const f=fixture(),first=message();f.call('POST',first);const key='order-comments:'+order.id;
 const comments=f.docs.get(key);while(comments.length<500)comments.push({...comments[0],id:randomUUID()});f.docs.set(key,comments);
 assert.equal(f.call('POST',first).comments.length,500);assert.throws(()=>f.call('POST',message()),/500 comment limit/);
 const g=fixture();g.store.notify=()=>{throw Error('Persistence failed');};assert.throws(()=>g.call('POST',message()),/Persistence failed/);assert.equal(g.call().comments.length,0);
});
