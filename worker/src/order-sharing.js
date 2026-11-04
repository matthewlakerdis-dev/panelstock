import {digest,equal,randomToken,requireCondition as check} from './security.js';
import {requireAppAccess} from './app-access.js';
import {importSharedDraft} from './order-drafts.js';

const DAY=86400000;
const keyName=id=>'order-share-key:'+id;
const ownerKeys=owner=>'order-share-keys:'+encodeURIComponent(owner);
const publicKey=({id,label,createdAt,expiresAt})=>({id,label,createdAt,expiresAt});
const pinVersion=user=>digest(JSON.stringify(user.password||user.pinHash||''));

// These credentials are deliberately separate from login sessions. Only the
// import endpoint accepts them; neither order reads nor submission accepts them.
export async function orderSharingSettings(store,method,body,actor){
 store.requireTask(actor,'site.orders.create');
 requireAppAccess(store.read('users',{})[actor.username], 'site');
 const now=Date.now(),list=store.read(ownerKeys(actor.username),[]).filter(key=>key.expiresAt>now);
 if(method==='GET')return {ok:true,keys:list.map(publicKey)};
 check(method==='POST','Method not allowed',405);
 if(body.action==='revoke'){
  check(list.some(key=>key.id===body.id),'Sharing key not found',404);
  store.ctx.storage.transactionSync(()=>{
   store.write(keyName(body.id),null);
   store.write(ownerKeys(actor.username),list.filter(key=>key.id!==body.id));
   store.audit(actor.username,'order-share-key-revoked',{id:body.id});
  });
  return {ok:true,keys:list.filter(key=>key.id!==body.id).map(publicKey)};
 }
 check(body.action==='create','Invalid sharing action');
 check(typeof body.label==='string'&&body.label.trim().length>0&&body.label.trim().length<=60,'Name this iPad (up to 60 characters)');
 check(list.length<5,'Remove an old sharing key first (maximum 5)');
 const id=randomToken().slice(0,32),secret=randomToken(),user=store.read('users',{})[actor.username];
 const record={id,label:body.label.trim(),owner:actor.username,hash:await digest(secret),pinVersion:await pinVersion(user),createdAt:new Date(now).toISOString(),expiresAt:now+90*DAY};
 store.ctx.storage.transactionSync(()=>{
  // Recheck after hashing: concurrent setup requests must not lose keys.
  const current=store.read(ownerKeys(actor.username),[]).filter(key=>key.expiresAt>Date.now());
  check(current.length<5,'Remove an old sharing key first (maximum 5)');
  store.write(keyName(id),record);
  store.write(ownerKeys(actor.username),[...current,publicKey(record)]);
  store.audit(actor.username,'order-share-key-created',{id,label:record.label});
 });
 return {ok:true,key:'ps-share.'+id+'.'+secret,keys:store.read(ownerKeys(actor.username),[]).map(publicKey)};
}

export async function importSharedOrder(store,body,token,ip){
 store.consumeLimit('order-share-ip:'+ip,60,15*60000);
 const match=typeof token==='string'&&token.match(/^ps-share\.([a-f0-9]{32})\.([a-f0-9]{64})$/);
 check(match,'Set up Goodnotes sharing again in Site Orders Settings.',401);
 const record=store.read(keyName(match[1]));
 check(record&&record.expiresAt>Date.now()&&equal(record.hash,await digest(match[2])),'Sharing key expired or removed. Set up Goodnotes sharing again.',401);
 const credential=JSON.stringify((store.read('users',{})[record.owner]||{}).password||(store.read('users',{})[record.owner]||{}).pinHash||'');
 const version=await digest(credential);
 const assertAccess=()=>{
  const current=store.read(keyName(record.id)),user=store.read('users',{})[record.owner];
  check(current&&current.hash===record.hash&&current.expiresAt>Date.now()&&user&&user.active!==false&&!user.mustChangePin&&current.pinVersion===version&&JSON.stringify(user.password||user.pinHash||'')===credential,'Sharing access changed. Set up Goodnotes sharing again.',401);
  requireAppAccess(user,'site');
  const actor={username:record.owner,isAdmin:!!user.isAdmin,tasks:store.taskAccess(record.owner,!!user.isAdmin)};
  store.requireTask(actor,'site.orders.create');return actor;
 };
 const actor=assertAccess();
 const result=await importSharedDraft(store,actor,body,assertAccess);
 return {ok:true,draftId:result.id,openUrl:'https://site.panelstockhq.com/#shared-draft='+result.id+'&owner='+encodeURIComponent(actor.username)};
}
