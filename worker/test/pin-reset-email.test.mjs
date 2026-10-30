import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {requestEmailPinReset} from '../src/pin-reset-email.js';
import {acceptUserInvite} from '../src/user-invites.js';
import {digest,verifyPin} from '../src/security.js';
function fixture(user={}){
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE user_invites(token TEXT PRIMARY KEY,username TEXT UNIQUE,expires INTEGER,fingerprint TEXT,purpose TEXT);CREATE TABLE sessions(token TEXT,username TEXT);CREATE TABLE access_users(username TEXT,last_pin_change_at TEXT,failed_login_attempts INTEGER,locked_until INTEGER);INSERT INTO access_users(username) VALUES('sam');");
 let users={sam:{active:true,mustChangePin:false,email:'sam@example.test',...user}};const notices=[],audit=[],limits=[];
 const store={env:{EMAIL_ENABLED:'true',RESEND_API_KEY:'test-key',FROM_EMAIL:'PanelStock <support@example.test>',ALLOWED_ORIGINS:'https://app.panelstockhq.com'},read:()=>structuredClone(users),write:(_,value)=>users=value,sql:{exec(query,...args){const statement=db.prepare(query);if(!/^SELECT/i.test(query))statement.run(...args);return{toArray:()=>statement.all(...args)};}},ctx:{storage:{transactionSync:fn=>fn()}},consumeLimit:(...args)=>limits.push(args),notify:(...args)=>notices.push(args),adminUsernames:()=>['admin'],audit:(...args)=>audit.push(args),syncAccessUser(){}};
 return {store,db,notices,audit,limits,get users(){return users;}};
}
test('self-service reset emails only the account address and issues an expiring, hashed, single-use link',async()=>{
 const f=fixture();let email;try{
  const reply=await requestEmailPinReset(f.store,{username:'SAM',email:'attacker@example.test'},'ip',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');email=JSON.parse(options.body);return Response.json({id:'email-1'});});
  assert.equal(reply.ok,true);assert.deepEqual(email.to,['sam@example.test']);assert.equal(email.from,'PanelStock Support <support@panelstockhq.com>');assert.match(email.text,/one hour/);
  const token=email.text.match(/\/invite\/#([A-Za-z0-9_-]+)/)[1],ticket=f.db.prepare('SELECT * FROM user_invites').get();
  assert.equal(ticket.token,await digest(token));assert.notEqual(ticket.token,token);assert.equal(ticket.purpose,'reset');assert.ok(ticket.expires>Date.now()+3500000);
  assert.ok(!JSON.stringify(f.audit).includes(token));assert.equal(f.users.sam.password,undefined);
  await acceptUserInvite(f.store,{token,action:'accept',newPin:'654321'},'ip');assert.equal(await verifyPin('654321','sam',f.users.sam),true);
  await assert.rejects(acceptUserInvite(f.store,{token,action:'accept',newPin:'654321'},'ip'),error=>error.status===410);
  assert.ok(f.limits.some(args=>args[0]==='passcode-reset:ip'&&args[1]===5));assert.ok(f.limits.some(args=>args[0]==='passcode-reset-user:sam'&&args[1]===3));
 }finally{f.db.close();}
});
test('missing, inactive, or email-less accounts return the same public reply without sending mail',async()=>{
 let expected;
 for(const [user,name] of [[{},'missing'],[{active:false},'sam'],[{email:''},'sam']]){
  const f=fixture(user);try{const reply=await requestEmailPinReset(f.store,{username:name},'ip',()=>assert.fail('unexpected email'));expected??=reply;assert.deepEqual(reply,expected);assert.equal(f.db.prepare('SELECT count(*) AS n FROM user_invites').get().n,0);}finally{f.db.close();}
 }
});
test('email failures remove the undelivered ticket and notify administrators without exposing details',async()=>{
 const f=fixture();try{const reply=await requestEmailPinReset(f.store,{username:'sam'},'ip',async()=>{throw Error('provider failure');});assert.equal(reply.ok,true);assert.match(reply.message,/If your account/);assert.equal(f.notices.length,1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM user_invites').get().n,0);}finally{f.db.close();}
});
