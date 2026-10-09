import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createUserInvite,acceptUserInvite} from '../src/user-invites.js';
import {digest,verifyPin} from '../src/security.js';
import {buildUserInvitePage} from '../src/user-invite-page.js';
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE user_invites(token TEXT PRIMARY KEY,username TEXT UNIQUE,expires INTEGER,fingerprint TEXT,purpose TEXT);CREATE TABLE sessions(token TEXT,username TEXT);CREATE TABLE access_users(username TEXT,last_pin_change_at TEXT,failed_login_attempts INTEGER,locked_until INTEGER);INSERT INTO access_users(username) VALUES (\'newperson\');');
 let users={newperson:{displayName:'New Person',active:true,mustChangePin:true,pinHash:'old-hash'}};
 const events=[],limits=[];
 const store={env:{ALLOWED_ORIGINS:'https://app.panelstockhq.com'},sql:{exec(query,...args){const statement=db.prepare(query);return{toArray:()=>statement.all(...args),...(!/^SELECT/i.test(query)?(statement.run(...args),{}):{})};}},ctx:{storage:{transactionSync(fn){db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}}},actor:async token=>({username:'admin',isAdmin:token==='admin-session'}),read:()=>structuredClone(users),write:(_,value)=>{users=structuredClone(value)},consumeLimit:(...args)=>limits.push(args),audit:(...args)=>events.push(args),syncAccessUser(){}};
 const create=()=>createUserInvite(store,{targetUsername:'newperson'},'admin-session');
 const accept=(token,action='accept',newPin='654321')=>acceptUserInvite(store,{token,action,newPin},'test-ip');
 return {store,db,events,limits,create,accept,get users(){return users;}};
}
test('only an admin can create an invite for an active pending account',async()=>{
 const f=fixture();await assert.rejects(createUserInvite(f.store,{targetUsername:'newperson'},'staff-session'),e=>e.status===403);
 f.users.newperson.active=false;await assert.rejects(f.create(),e=>e.status===404);
 f.users.newperson.active=true;f.users.newperson.mustChangePin=false;await assert.rejects(f.create(),e=>e.status===409);
});
test('invite is hashed, inspect is non-consuming, acceptance sets PIN and is single use',async()=>{
 const f=fixture(),i=await f.create();assert.match(i.token,/^[A-Za-z0-9_-]{22}$/);assert.equal(i.url,'https://app.panelstockhq.com/invite/#'+i.token);assert.ok(Math.abs(i.expiresAt-Date.now()-48*3600000)<2000);
 const row=f.db.prepare('SELECT * FROM user_invites').get();assert.notEqual(row.token,i.token);assert.equal(row.token,await digest(i.token));
 assert.equal((await f.accept(i.token,'inspect')).username,'newperson');assert.equal((await f.accept(i.token,'inspect')).username,'newperson');
 f.db.prepare('INSERT INTO sessions VALUES (?,?)').run('old-session','newperson');
 assert.equal((await f.accept(i.token)).ok,true);assert.equal(f.users.newperson.mustChangePin,false);assert.equal(await verifyPin('654321','newperson',f.users.newperson),true);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
 await assert.rejects(f.accept(i.token),e=>e.status===410);assert.ok(f.limits.some(v=>v[0]==='invite:test-ip'));assert.ok(!JSON.stringify(f.events).includes(i.token));
});
test('replacement, expiration, invalid token and invalid PIN are rejected',async()=>{
 const f=fixture(),first=await f.create(),second=await f.create();await assert.rejects(f.accept(first.token),e=>e.status===410);
 await assert.rejects(f.accept('invalid'),e=>e.status===410);await assert.rejects(f.accept(second.token,'accept','123'),e=>e.status===400);
 f.db.prepare('UPDATE user_invites SET expires=?').run(Date.now()-1);await assert.rejects(f.accept(second.token),e=>e.status===410);
});
test('account changes invalidate invites and simultaneous acceptance succeeds only once',async()=>{
 const f=fixture(),i=await f.create();f.users.newperson.active=false;await assert.rejects(f.accept(i.token),e=>e.status===410);
 f.users.newperson.active=true;f.users.newperson.pinHash='reset-hash';await assert.rejects(f.accept(i.token),e=>e.status===410);
 const replacement=await f.create(),results=await Promise.allSettled([f.accept(replacement.token),f.accept(replacement.token)]);assert.equal(results.filter(v=>v.status==='fulfilled').length,1);
});
test('invite page uses fragment token, text-only account output, and an explicit POST to set PIN',()=>{
 const html=buildUserInvitePage('test-nonce','https://app.panelstockhq.com,https://web.panelstockhq.com');
 assert.match(html,/location.hash.slice\(1\)/);assert.match(html,/action:'inspect'/);assert.match(html,/action:'accept',newPin:pin.value/);assert.match(html,/nonce="test-nonce"/);assert.match(html,/history.replaceState/);assert.doesNotMatch(html,/innerHTML|https?:\/\/[^"']+\.js/);
});

test('previously issued 64-character invites remain valid',async()=>{
 const f=fixture(),i=await f.create(),legacy='a'.repeat(64);
 f.db.prepare('UPDATE user_invites SET token=?').run(await digest(legacy));
 assert.equal((await f.accept(legacy)).ok,true);
});

test('branded invite page matches generator and allows only the production API',async()=>{
 const {brandedInvitePage}=await import('../scripts/build-invite.mjs');
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../../invite/index.html',import.meta.url),'utf8');
 assert.equal(html,brandedInvitePage());assert.match(html,/connect-src https:\/\/panelstock-reports.matthewlakerdis.workers.dev/);
 assert.match(html,/fetch\("https:\/\/panelstock-reports.matthewlakerdis.workers.dev\/invite\/accept"/);
 assert.match(html,/script-src 'sha256-/);assert.match(html,/og:title/);
});

 test('reset links keep the current PIN until redemption, expire in one hour and revoke sessions on use',async()=>{
 const f=fixture();f.users.newperson.mustChangePin=false;
 await assert.rejects(createUserInvite(f.store,{targetUsername:'newperson',purpose:'reset'},'staff-session'),e=>e.status===403);
 const before=JSON.stringify(f.users),link=await createUserInvite(f.store,{targetUsername:'newperson',purpose:'reset'},'admin-session');
 assert.equal(JSON.stringify(f.users),before);assert.equal(link.purpose,'reset');assert.ok(Math.abs(link.expiresAt-Date.now()-3600000)<2000);
 assert.equal((await f.accept(link.token,'inspect')).purpose,'reset');f.db.prepare('INSERT INTO sessions VALUES (?,?)').run('existing','newperson');
 await f.accept(link.token);assert.equal(await verifyPin('654321','newperson',f.users.newperson),true);assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);await assert.rejects(f.accept(link.token),e=>e.status===410);
 });
 test('reset replacement and expiry invalidate links without changing credentials',async()=>{
 const f=fixture();f.users.newperson.mustChangePin=false;const body={targetUsername:'newperson',purpose:'reset'},a=await createUserInvite(f.store,body,'admin-session'),b=await createUserInvite(f.store,body,'admin-session');await assert.rejects(f.accept(a.token),e=>e.status===410);f.db.prepare('UPDATE user_invites SET expires=?').run(Date.now()-1);await assert.rejects(f.accept(b.token),e=>e.status===410);assert.equal(f.users.newperson.pinHash,'old-hash');
 });
