import {Buffer} from 'node:buffer';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {digest,randomToken,verifyPin,requireCondition as check,HttpError} from './security.js';
import {originApp,requireAppAccess} from './app-access.js';
const TTL=5*60000;
export function initializePasskeys(store){
 store.sql.exec('CREATE TABLE IF NOT EXISTS passkey_users(username TEXT PRIMARY KEY,handle TEXT UNIQUE NOT NULL)');
 store.sql.exec('CREATE TABLE IF NOT EXISTS passkeys(credential_id TEXT PRIMARY KEY,username TEXT NOT NULL,public_key TEXT NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,label TEXT NOT NULL,device_kind TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT,rp_id TEXT NOT NULL DEFAULT \'panelstockhq.com\')');
 if(!store.sql.exec('PRAGMA table_info(passkeys)').toArray().some(column=>column.name==='rp_id'))store.sql.exec("ALTER TABLE passkeys ADD COLUMN rp_id TEXT NOT NULL DEFAULT 'panelstockhq.com'");
 store.sql.exec('CREATE INDEX IF NOT EXISTS passkeys_username ON passkeys(username)');
 store.sql.exec('CREATE TABLE IF NOT EXISTS passkey_challenges(id TEXT PRIMARY KEY,purpose TEXT NOT NULL,origin TEXT NOT NULL,rp_id TEXT NOT NULL,challenge TEXT NOT NULL,username TEXT,session_token TEXT,state TEXT NOT NULL,expires INTEGER NOT NULL)');
}
export function revokeUserPasskeys(store,username){store.sql.exec('DELETE FROM passkeys WHERE username=?',username);store.sql.exec('DELETE FROM passkey_challenges WHERE username=?',username);}
export function renameUserPasskeys(store,previous,next){store.sql.exec('UPDATE passkeys SET username=? WHERE username=?',next,previous);store.sql.exec('UPDATE passkey_users SET username=? WHERE username=?',next,previous);store.sql.exec('DELETE FROM passkey_challenges WHERE username=?',previous);}
const userFor=(store,name)=>{const users=store.read('users',{});return Object.hasOwn(users,name)?users[name]:null;};
function relyingParty(store,origin,requestedApp){
 check(typeof origin==='string'&&(store.env.ALLOWED_ORIGINS||'').split(',').includes(origin),'Open passkey settings from a PanelStock app',403);
 const url=new URL(origin),app=originApp(origin);
 if(store.env.SITE_ID==='panelstock-staging-review'&&store.env.PASSKEY_STAGING_ORIGIN===origin&&origin==='https://panelstock-reports-staging.matthewlakerdis.workers.dev'){check(['web','app','site'].includes(requestedApp),'Choose a staging app');return {rpID:url.hostname,app:requestedApp};}
 check(app&&url.protocol==='https:'&&['app.panelstockhq.com','web.panelstockhq.com','site.panelstockhq.com'].includes(url.hostname),'Passkeys require a secure PanelStock app',403);
 return {rpID:'panelstockhq.com',app};
}
function saveChallenge(store,purpose,options,origin,rpID,actor,state={}){
 const now=Date.now(),requestId=randomToken();store.sql.exec('DELETE FROM passkey_challenges WHERE expires<=?',now);
 store.sql.exec('INSERT INTO passkey_challenges(id,purpose,origin,rp_id,challenge,username,session_token,state,expires) VALUES(?,?,?,?,?,?,?,?,?)',requestId,purpose,origin,rpID,options.challenge,actor?.username||null,actor?.tokenHash||null,JSON.stringify(state),now+TTL);
 return {ok:true,requestId,options};
}
function consumeChallenge(store,body,purpose,origin){
 check(typeof body.requestId==='string'&&/^[a-f0-9]{64}$/.test(body.requestId),'Passkey request expired. Please try again.',400);
 const challenge=store.sql.exec('DELETE FROM passkey_challenges WHERE id=? RETURNING *',body.requestId).toArray()[0];
 check(challenge&&challenge.purpose===purpose&&challenge.origin===origin&&challenge.expires>Date.now(),'Passkey request expired. Please try again.',400);
 return challenge;
}
async function fullActor(store,token,app){const actor=await store.actor(token,app);check(!actor.toolboxOnly&&!actor.safetySelfOnly,'Sign in to the main app to manage passkeys',403);return actor;}
function responseForSession(store,username,user,token,expiresAt){return {ok:true,username,isAdmin:!!user.isAdmin,taskAccess:store.taskAccess(username,!!user.isAdmin),mustChangePin:false,token,expiresAt};}
export async function handlePasskeys(store,path,method,body,token,ip,origin){
 const {rpID,app}=relyingParty(store,origin,body.app);
 check(method==='POST','Method not allowed',405);
 store.consumeLimit('passkey-ip:'+ip,40);
 if(path==='/passkeys/authenticate/options'){
  const options=await generateAuthenticationOptions({rpID,userVerification:'required',timeout:60000});
  return saveChallenge(store,'authenticate',options,origin,rpID,null);
 }
 if(path==='/passkeys/authenticate/verify'){
  const challenge=consumeChallenge(store,body,'authenticate',origin),response=body.response;
  check(response&&typeof response.id==='string'&&response.id.length<=1400,'Passkey sign-in failed. Use your PIN or try again.',401);
  const saved=store.sql.exec('SELECT * FROM passkeys WHERE credential_id=?',response.id).toArray()[0];
  check(saved&&saved.rp_id===challenge.rp_id,'Passkey sign-in failed. Use your PIN or try again.',401);
  store.consumeLimit('passkey-user:'+saved.username,15);
  const owner=store.sql.exec('SELECT handle FROM passkey_users WHERE username=?',saved.username).toArray()[0];
  check(owner&&(!response.response?.userHandle||response.response.userHandle===owner.handle),'Passkey sign-in failed',401);
  let verification;try{verification=await verifyAuthenticationResponse({response,expectedChallenge:challenge.challenge,expectedOrigin:challenge.origin,expectedRPID:challenge.rp_id,requireUserVerification:true,credential:{id:saved.credential_id,publicKey:new Uint8Array(JSON.parse(saved.public_key)),counter:saved.counter,transports:JSON.parse(saved.transports)}});}catch{throw new HttpError(401,'Passkey sign-in failed. Use your PIN or try again.');}
  check(verification.verified,'Passkey sign-in failed',401);
  // Finish all asynchronous work before re-reading permissions and issuing a session atomically.
  const sessionToken=randomToken(),hash=await digest(sessionToken),expiresAt=Date.now()+8*3600000;
  let user;
  store.ctx.storage.transactionSync(()=>{
   const current=store.sql.exec('SELECT * FROM passkeys WHERE credential_id=?',saved.credential_id).toArray()[0];user=userFor(store,saved.username);
   check(current&&current.username===saved.username&&current.counter===saved.counter&&user&&user.active!==false&&!user.mustChangePin,'Account or passkey changed. Sign in with your PIN.',401);
   requireAppAccess(user,app);
   const access=store.sql.exec('SELECT locked_until FROM access_users WHERE username=?',saved.username).toArray()[0];check(!access?.locked_until||access.locked_until<=Date.now(),'This account is temporarily locked. Try again later.',429);
   store.sql.exec('UPDATE passkeys SET counter=?,last_used_at=? WHERE credential_id=?',verification.authenticationInfo.newCounter,new Date().toISOString(),saved.credential_id);
   store.sql.exec('INSERT INTO sessions(token,username,expires,app) VALUES(?,?,?,?)',hash,saved.username,expiresAt,app);
   store.sql.exec('DELETE FROM sessions WHERE expires<=?',Date.now());
   store.sql.exec('UPDATE access_users SET failed_login_attempts=0,locked_until=NULL,last_login_at=?,last_activity_at=? WHERE username=?',new Date().toISOString(),new Date().toISOString(),saved.username);
   store.audit(saved.username,'passkey-login',{app});
  });
  return responseForSession(store,saved.username,user,sessionToken,expiresAt);
 }
 const actor=await fullActor(store,token,app);
 const admin=path.startsWith('/passkeys/admin/');if(admin)check(actor.isAdmin,'Admin access required',403);
 const username=admin?String(body.targetUsername||'').trim().toLowerCase():actor.username;
 check(userFor(store,username),'User not found',404);
 if(path==='/passkeys/list'||path==='/passkeys/admin/list')return {ok:true,passkeys:store.sql.exec('SELECT credential_id AS id,label,device_kind AS deviceKind,created_at AS createdAt,last_used_at AS lastUsedAt FROM passkeys WHERE username=? ORDER BY created_at',username).toArray()};
 if(path==='/passkeys/revoke'||path==='/passkeys/admin/revoke'){
  check(typeof body.id==='string'&&body.id.length<=1400,'Invalid passkey');
  check(store.sql.exec('SELECT credential_id FROM passkeys WHERE username=? AND credential_id=?',username,body.id).toArray()[0],'Passkey not found',404);
  store.ctx.storage.transactionSync(()=>{store.sql.exec('DELETE FROM passkeys WHERE username=? AND credential_id=?',username,body.id);store.sql.exec('DELETE FROM sessions WHERE username=?',username);store.audit(actor.username,'passkey-revoked',{target:username});});return {ok:true,signInAgain:username===actor.username};
 }
 if(path==='/passkeys/register/options'){
  store.consumeLimit('passkey-register:'+username,10);
  check(['personal','shared'].includes(body.deviceKind),'Choose personal or shared device');
  check(typeof body.pin==='string','Enter your current PIN');
  const user=userFor(store,username);check(await verifyPin(body.pin,user.legacyUsername||username,user,store.env.PIN_SALT),'Incorrect PIN. Please try again.',403);
  const fresh=await fullActor(store,token,app);check(fresh.username===username&&JSON.stringify(userFor(store,username))===JSON.stringify(user),'Account changed. Try again.',409);
  check(store.sql.exec('SELECT credential_id FROM passkeys WHERE username=?',username).toArray().length<10,'Remove an old passkey before adding another');
  let handle=store.sql.exec('SELECT handle FROM passkey_users WHERE username=?',username).toArray()[0]?.handle;
  if(!handle){handle=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');store.sql.exec('INSERT INTO passkey_users(username,handle) VALUES(?,?)',username,handle);}
  const existing=store.sql.exec('SELECT credential_id AS id,transports FROM passkeys WHERE username=?',username).toArray();
  const options=await generateRegistrationOptions({rpName:'PanelStock',rpID,userID:new Uint8Array(Buffer.from(handle,'base64url')),userName:username,userDisplayName:user.displayName||username,timeout:60000,attestationType:'none',excludeCredentials:existing.map(key=>({id:key.id,transports:JSON.parse(key.transports)})),authenticatorSelection:{residentKey:'required',userVerification:'required',...(body.deviceKind==='shared'?{authenticatorAttachment:'cross-platform'}:{})}});
  if(body.deviceKind==='shared')options.hints=['hybrid','security-key'];
  return saveChallenge(store,'register',options,origin,rpID,fresh,{fingerprint:await digest(JSON.stringify(user)),deviceKind:body.deviceKind,label:String(body.label||'Passkey').trim().slice(0,80)||'Passkey'});
 }
 if(path==='/passkeys/register/verify'){
  const challenge=consumeChallenge(store,body,'register',origin);check(challenge.username===username&&challenge.session_token===actor.tokenHash,'Sign in again to add a passkey',401);
  const state=JSON.parse(challenge.state),user=userFor(store,username);check(await digest(JSON.stringify(user))===state.fingerprint,'Account changed. Try again.',409);
  let verified;try{verified=await verifyRegistrationResponse({response:body.response,expectedChallenge:challenge.challenge,expectedOrigin:challenge.origin,expectedRPID:challenge.rp_id,requireUserVerification:true});}catch{throw new HttpError(400,'Passkey setup could not be verified. Please try again.');}
  check(verified.verified&&verified.registrationInfo,'Passkey setup could not be verified');
  const fresh=await fullActor(store,token,app);check(fresh.username===username&&JSON.stringify(userFor(store,username))===JSON.stringify(user),'Account changed. Try again.',409);
  const credential=verified.registrationInfo.credential,transports=(Array.isArray(credential.transports)?credential.transports:[]).filter(value=>['usb','nfc','ble','internal','hybrid','smart-card'].includes(value));
  store.ctx.storage.transactionSync(()=>{check(store.sql.exec('SELECT credential_id FROM passkeys WHERE username=?',username).toArray().length<10,'Too many passkeys');check(!store.sql.exec('SELECT credential_id FROM passkeys WHERE credential_id=?',credential.id).toArray()[0],'This passkey is already registered');store.sql.exec('INSERT INTO passkeys(credential_id,username,public_key,counter,transports,label,device_kind,created_at,rp_id) VALUES(?,?,?,?,?,?,?,?,?)',credential.id,username,JSON.stringify(Array.from(credential.publicKey)),credential.counter,JSON.stringify(transports),state.label,state.deviceKind,new Date().toISOString(),challenge.rp_id);store.audit(username,'passkey-added',{deviceKind:state.deviceKind});});
  return {ok:true};
 }
 throw new HttpError(404,'Not found');
}
