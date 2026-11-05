// Numeric handoff for the isolated iOS 10 test station only. Safari and a saved
// Home Screen app can have different storage and may not preserve a URL fragment.
import {ensureSchema} from './schema.js';
import {digest,equal,requireCondition as check} from './security.js';

const TTL=10*60000;
const INVALID='Setup code is invalid, expired or already used. Create a new code in Safari.';
export const INSTALL_PATHS=['/attendance/install-code','/attendance/install-pair'];
const currentHash=store=>store.sql.exec('SELECT kiosk_hash FROM attendance_settings WHERE id=1').toArray()[0]?.kiosk_hash||'';
const limitMessage='Too many setup attempts. Wait 10 minutes, then try again.';

export function initializeIos10Install(store){
  ensureSchema(store.sql,'CREATE TABLE IF NOT EXISTS attendance_ios10_install_codes (code_hash TEXT PRIMARY KEY,kiosk_hash TEXT NOT NULL,kiosk_token TEXT NOT NULL,expires INTEGER NOT NULL)');
}
export function clearIos10InstallCodes(store){
  store.sql.exec('DELETE FROM attendance_ios10_install_codes WHERE expires<=? OR kiosk_hash<>?',Date.now(),currentHash(store));
}
export async function expireIos10InstallCodes(store){
  clearIos10InstallCodes(store);
  const next=store.sql.exec('SELECT MIN(expires) AS expires FROM attendance_ios10_install_codes').toArray()[0]?.expires;
  if(next)await store.ctx.storage.setAlarm(next);
}
function randomCode(){
  const values=new Uint32Array(1);
  // Rejection sampling gives all 100,000,000 eight-digit values equal odds.
  do{crypto.getRandomValues(values);}while(values[0]>=4200000000);
  return String(values[0]%100000000).padStart(8,'0');
}
function failureAllowed(store,key,max){
  const row=store.sql.exec('SELECT count,expires FROM limits WHERE key=?',key).toArray()[0];
  check(!row||row.expires<=Date.now()||row.count<max,limitMessage,429);
}
export async function handleIos10Install(store,path,body,ip){
  const issuing=path==='/attendance/install-code',scope=issuing?'issue':'pair';
  const ipKey='ios10:install:'+scope+':ip:'+String(ip||'unknown').slice(0,64);
  // Consume the shared bucket first, bounding persisted IP buckets as well as
  // distributed guesses. Failed redemptions have a separate, lower ceiling.
  store.consumeLimit('ios10:install:'+scope+':site',issuing?30:60,TTL);
  store.consumeLimit(ipKey,10,TTL);
  if(issuing){
    check(typeof body.kioskToken==='string'&&/^[a-f0-9]{64}$/.test(body.kioskToken),'Sign-in kiosk is not connected. Ask an administrator to reconnect it.',401);
    const kioskHash=await digest(body.kioskToken),code=randomCode(),codeHash=await digest('ios10-install:'+code);
    const expires=Date.now()+TTL;
    store.ctx.storage.transactionSync(()=>{
      check(equal(kioskHash,currentHash(store)),'Sign-in kiosk is not connected. Ask an administrator to reconnect it.',401);
      store.consumeLimit('ios10:install:station:'+kioskHash,5,TTL);
      // This environment has one station: retain at most one short-lived code.
      store.sql.exec('DELETE FROM attendance_ios10_install_codes');
      store.sql.exec('INSERT INTO attendance_ios10_install_codes(code_hash,kiosk_hash,kiosk_token,expires) VALUES(?,?,?,?)',codeHash,kioskHash,body.kioskToken,expires);
    });
    await store.ctx.storage.setAlarm(expires);
    return {ok:true,code,expiresAt:new Date(expires).toISOString()};
  }
  const failureSite='ios10:install:failure:site',failureIp='ios10:install:failure:ip:'+String(ip||'unknown').slice(0,64);
  failureAllowed(store,failureSite,30);failureAllowed(store,failureIp,5);
  const validFormat=typeof body.code==='string'&&/^\d{8}$/.test(body.code);
  const codeHash=validFormat?await digest('ios10-install:'+body.code):'';
  const kioskToken=store.ctx.storage.transactionSync(()=>{
    failureAllowed(store,failureSite,30);failureAllowed(store,failureIp,5);
    clearIos10InstallCodes(store);
    const entry=store.sql.exec('SELECT kiosk_hash,kiosk_token,expires FROM attendance_ios10_install_codes WHERE code_hash=?',codeHash).toArray()[0];
    if(!entry||entry.expires<=Date.now()||!equal(entry.kiosk_hash,currentHash(store))){
      store.consumeLimit(failureSite,30,TTL);store.consumeLimit(failureIp,5,TTL);
      return null;
    }
    store.sql.exec('DELETE FROM attendance_ios10_install_codes WHERE code_hash=?',codeHash);
    return entry.kiosk_token;
  });
  check(kioskToken,validFormat?INVALID:'Enter the 8-digit setup code shown in Safari.',validFormat?401:400);
  return {ok:true,kioskToken};
}
