import {digest,passwordRecord,normalizeUsername,requireCondition as check} from './security.js';
const lifetime=48*60*60*1000;
const invalid='This invite has expired or is no longer valid. Ask your administrator for a new invite.';
export async function createUserInvite(store,body,sessionToken){
 const actor=await store.actor(sessionToken);check(actor.isAdmin,'Admin access required',403);
 const username=normalizeUsername(body.targetUsername),user=store.read('users',{})[username];
 check(user&&user.active!==false,'Active user not found',404);
 check(user.mustChangePin,'This user has already set their PIN. Reset their PIN first if they need a new invite.',409);
 store.consumeLimit('create-invite:'+actor.username,30);
 const token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''),hash=await digest(token),fingerprint=await digest(JSON.stringify(user));
 const currentActor=await store.actor(sessionToken);check(currentActor.isAdmin,'Admin access required',403);
 check(JSON.stringify(store.read('users',{})[username])===JSON.stringify(user),'Account changed; please retry',409);
 const expiresAt=Date.now()+lifetime;
 store.ctx.storage.transactionSync(()=>{
  store.sql.exec('DELETE FROM user_invites WHERE expires<=? OR username=?',Date.now(),username);
  store.sql.exec('INSERT INTO user_invites(token,username,expires,fingerprint) VALUES(?,?,?,?)',hash,username,expiresAt,fingerprint);
  store.audit(actor.username,'admin/create-invite',{target:username,expiresAt});
 });
 return {ok:true,token,expiresAt,username,displayName:user.displayName||username,...((store.env?.ALLOWED_ORIGINS||'').split(',').includes('https://app.panelstockhq.com')?{url:'https://app.panelstockhq.com/invite/#'+token}:{})};
}
export async function acceptUserInvite(store,body,ip){
 store.consumeLimit('invite:'+ip,30);
 check(typeof body.token==='string'&&/^(?:[A-Za-z0-9_-]{22}|[a-f0-9]{64})$/.test(body.token),invalid,410);
 const hash=await digest(body.token),ticket=store.sql.exec('SELECT * FROM user_invites WHERE token=?',hash).toArray()[0];
 const user=ticket&&store.read('users',{})[ticket.username];
 check(ticket&&ticket.expires>Date.now()&&user&&user.active!==false&&user.mustChangePin,invalid,410);
 check(await digest(JSON.stringify(user))===ticket.fingerprint,invalid,410);
 if(body.action==='inspect')return {ok:true,username:ticket.username,displayName:user.displayName||ticket.username,expiresAt:ticket.expires};
 check(body.action==='accept','Invalid invite action');
 check(typeof body.newPin==='string'&&/^\d{6,12}$/.test(body.newPin),'PIN must contain 6–12 digits');
 const password=await passwordRecord(body.newPin),users=store.read('users',{});
 const live=store.sql.exec('SELECT * FROM user_invites WHERE token=?',hash).toArray()[0];
 check(live&&live.expires>Date.now()&&live.fingerprint===ticket.fingerprint&&JSON.stringify(users[ticket.username])===JSON.stringify(user),invalid,410);
 const updated={...user,password,mustChangePin:false,updatedAt:new Date().toISOString()};delete updated.pinHash;delete updated.legacyUsername;
 users[ticket.username]=updated;
 store.ctx.storage.transactionSync(()=>{
  store.sql.exec('DELETE FROM user_invites WHERE username=?',ticket.username);
  store.sql.exec('DELETE FROM sessions WHERE username=?',ticket.username);
  store.write('users',users);store.syncAccessUser(ticket.username,updated);
  store.sql.exec('UPDATE access_users SET last_pin_change_at=?,failed_login_attempts=0,locked_until=NULL WHERE username=?',updated.updatedAt,ticket.username);
  store.audit(ticket.username,'invite-accepted');
 });
 return {ok:true,username:ticket.username};
}
