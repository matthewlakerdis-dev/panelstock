import test from 'node:test';import assert from 'node:assert/strict';
import {saveOrderEmailConfig,orderEmailAdmin,enqueueOrderEmail,buildOrderEmail,processOrderEmails,retryOrderEmail} from '../src/order-email.js';
const order={id:'order-one',orderNumber:'1',project:'Hotel <script>',requestedBy:'site',siteContact:'Contact',phone:'0400000000',orderType:'Panels',requestedDeliveryDate:'2026-10-15',locationNotes:'Keep dry',items:[{quantity:2,description:'Panel & brackets'}]};
function fixture(){const docs=new Map([['users',{site:{displayName:'Taylor Smith',email:'creator@example.com'}}]]),audit=[];const store={env:{EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic-secret',FROM_EMAIL:'orders@example.com'},read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>docs.set(key,structuredClone(value)),audit:(...args)=>audit.push(args),ctx:{storage:{transactionSync:fn=>fn()}}};return {store,docs,audit};}
const admin={username:'admin',isAdmin:true};
test('only admins configure recipients, defaults are off and duplicate order queueing is harmless',()=>{const {store,docs}=fixture();assert.equal(orderEmailAdmin(store,admin).config.enabled,false);enqueueOrderEmail(store,order);assert.equal(docs.has('order-email-jobs'),false);assert.throws(()=>saveOrderEmailConfig(store,{enabled:true,recipients:['a@example.com']},{}),/Admin/);assert.throws(()=>orderEmailAdmin(store,{}),/Admin/);assert.throws(()=>saveOrderEmailConfig(store,{enabled:true,recipients:[]},admin),/recipient/);assert.throws(()=>saveOrderEmailConfig(store,{enabled:true,recipients:['bad\naddress']},admin),/valid/);saveOrderEmailConfig(store,{enabled:true,recipients:['Office@Example.com','office@example.com']},admin);enqueueOrderEmail(store,order);enqueueOrderEmail(store,order);assert.equal(docs.get('order-email-jobs').length,1);assert.deepEqual(docs.get('order-email:order-one').recipients,['office@example.com']);assert.equal(docs.get('order-email:order-one').orderedBy,'Taylor Smith (site)');});
test('email includes escaped order details, requester identity and a PDF copy',()=>{const payload=buildOrderEmail({order,orderedBy:'Taylor Smith (site)',recipients:['office@example.com']},'orders@example.com');assert.match(payload.html,/Taylor Smith \(site\)/);assert.match(payload.html,/Hotel &lt;script&gt;/);assert.doesNotMatch(payload.html,/<script>/);assert.match(payload.html,/Panel &amp; brackets/);assert.equal(payload.attachments[0].filename,'Order_1_Hotel_script.pdf');const pdf=atob(payload.attachments[0].content);assert.match(pdf,/%PDF/);assert.doesNotMatch(pdf,/ORDERED BY:/);assert.doesNotMatch(pdf,/Taylor Smith/);assert.match(pdf,/\/Subtype \/Image/);assert.match(pdf,/\/Logo Do/);});
test('paused email does not send, retries keep the original payload and accepted emails cannot resend',async()=>{const {store,docs}=fixture();saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);enqueueOrderEmail(store,order);saveOrderEmailConfig(store,{enabled:false,recipients:['new@example.com']},admin);await processOrderEmails(store,()=>{throw Error('must not send')});saveOrderEmailConfig(store,{enabled:true,recipients:['new@example.com']},admin);const bodies=[],headers=[],now=Date.now();await processOrderEmails(store,async(url,options)=>{bodies.push(options.body);headers.push(options.headers);throw Error('timeout')},now);assert.equal(docs.get('order-email:order-one').status,'retrying');store.env.FROM_EMAIL='changed@example.com';docs.set('users',{site:{email:'changed@example.com'}});await processOrderEmails(store,async(url,options)=>{bodies.push(options.body);headers.push(options.headers);return Response.json({id:'provider-id'});},now+16*60000);assert.equal(bodies[0],bodies[1]);assert.equal(headers[0]['Idempotency-Key'],headers[1]['Idempotency-Key']);assert.deepEqual(JSON.parse(bodies[1]).to,['office@example.com']);assert.deepEqual(JSON.parse(bodies[1]).cc,['creator@example.com']);assert.equal(docs.get('order-email:order-one').status,'sent');assert.throws(()=>retryOrderEmail(store,{id:order.id},admin),/cannot be retried/);await processOrderEmails(store,()=>{throw Error('must not resend')},now+20*60000);});
test('leases prevent overlapping sends and the safety window stops ambiguous late retries',async()=>{const {store,docs}=fixture();saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);enqueueOrderEmail(store,order);let finish,calls=0;const now=Date.now(),running=processOrderEmails(store,()=>{calls++;return new Promise(resolve=>finish=resolve);},now);await processOrderEmails(store,()=>{calls++;throw Error('overlap')},now);assert.equal(calls,1);finish(Response.json({error:'busy'},{status:503}));await running;await processOrderEmails(store,()=>{throw Error('expired retry must not send')},now+24*3600000);assert.equal(docs.get('order-email:order-one').status,'needs_review');});

test('site orders use their dedicated sender without changing the reports sender',async()=>{
 const {store}=fixture();store.env.ORDER_FROM_EMAIL='PanelStock Orders <orders@panelstockhq.com>';
 saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);enqueueOrderEmail(store,order);
 let payload;await processOrderEmails(store,async(url,options)=>{payload=JSON.parse(options.body);return Response.json({id:'sender-check'});});
 assert.equal(payload.from,'PanelStock Orders <orders@panelstockhq.com>');assert.equal(store.env.FROM_EMAIL,'orders@example.com');
 delete store.env.FROM_EMAIL;assert.equal(orderEmailAdmin(store,admin).providerReady,true);
});

test('site order subject includes number, project, type and the snapshotted requester name',()=>{
 const {store,docs}=fixture();saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);
 enqueueOrderEmail(store,{...order,project:'Bne Airport'});const job=docs.get('order-email:order-one');
 docs.set('users',{site:{displayName:'Changed later'}});
 assert.equal(buildOrderEmail(job,'orders@example.com').subject,'Site Order #1 | Bne Airport | Panels | Taylor Smith');
 assert.equal(job.orderedBy,'Taylor Smith (site)');
});
test('subject handles Other details, missing display names and legacy queued jobs',()=>{
 const {store,docs}=fixture();docs.set('users',{});saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);
 enqueueOrderEmail(store,{...order,project:'Bne Airport',orderType:'Other',orderTypeOther:'Safety signage'});
 const payload=buildOrderEmail(docs.get('order-email:order-one'),'orders@example.com');
 assert.match(payload.subject,/Safety signage/);assert.ok(payload.subject.endsWith(' | site'));
 assert.ok(buildOrderEmail({order,orderedBy:'Taylor Smith (site)',recipients:[]},'orders@example.com').subject.endsWith(' | Taylor Smith (site)'));
});
test('email subject flattens line breaks in all user supplied fields',()=>{
 const payload=buildOrderEmail({order:{...order,project:'Bne\r\nAirport'},requesterName:'Taylor\nSmith',orderedBy:'site',recipients:[]},'orders@example.com');
 assert.doesNotMatch(payload.subject,/[\r\n\t]/);assert.equal(payload.subject,'Site Order #1 | Bne Airport | Panels | Taylor Smith');
});

test('order creator is CCed from the current account profile and captured when queued',async()=>{
 const {store,docs}=fixture();store.sql={exec:(query,username)=>{assert.equal(query,'SELECT email FROM access_users WHERE username=?');assert.equal(username,'site');return {toArray:()=>[{email:' Current.Creator@Example.com '}]};}};
 saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);enqueueOrderEmail(store,order);
 const job=docs.get('order-email:order-one');assert.deepEqual(job.cc,['current.creator@example.com']);
 assert.deepEqual(orderEmailAdmin(store,admin).jobs[0].cc,job.cc);
 store.sql={exec:()=>({toArray:()=>[{email:'changed@example.com'}]})};
 let payload;await processOrderEmails(store,async(url,options)=>{payload=JSON.parse(options.body);return Response.json({id:'cc-check'});});
 assert.deepEqual(payload.to,['office@example.com']);assert.deepEqual(payload.cc,['current.creator@example.com']);
});
test('missing, invalid or already included creator emails do not add CC or stop the order email',async()=>{
 for(const email of ['', 'invalid', 'bad\naddress@example.com', 'Office@Example.com']){
  const {store,docs}=fixture();store.sql={exec:()=>({toArray:()=>[{email}]})};
  saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);enqueueOrderEmail(store,order);
  assert.deepEqual(docs.get('order-email:order-one').cc,[]);
  let payload;await processOrderEmails(store,async(url,options)=>{payload=JSON.parse(options.body);return Response.json({id:'no-cc'});});
  assert.equal(Object.hasOwn(payload,'cc'),false);assert.deepEqual(payload.to,['office@example.com']);assert.equal(docs.get('order-email:order-one').status,'sent');
 }
 const {store,docs}=fixture();docs.set('users',{});saveOrderEmailConfig(store,{enabled:true,recipients:['office@example.com']},admin);enqueueOrderEmail(store,order);
 assert.deepEqual(docs.get('order-email:order-one').cc,[]);
 assert.equal(Object.hasOwn(buildOrderEmail({order,orderedBy:'site',recipients:['office@example.com']},'orders@example.com'),'cc'),false);
});
