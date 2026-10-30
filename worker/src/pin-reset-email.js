import {digest,normalizeUsername,requireCondition as check} from './security.js';
const message='If your account has an email address, a PIN reset link will be sent. Otherwise, contact your administrator.';
export async function requestEmailPinReset(store,body,ip,fetcher=fetch){
 store.consumeLimit('passcode-reset:'+ip,5);
 const username=normalizeUsername(body.username);
 // Apply the same account throttle before lookup to avoid revealing registered usernames.
 store.consumeLimit('passcode-reset-user:'+username,3);
 const users=store.read('users',{}),user=Object.hasOwn(users,username)?users[username]:null,reply={ok:true,message};
 if(!user||user.active===false)return reply;
 const notify=()=>{store.notify(store.adminUsernames().filter(admin=>admin!==username),{title:'Passcode reset requested',message:username+' has requested help resetting their passcode.',kind:'support',priority:'important',link:'access'});};
 const email=String(user.email||'').trim(),sender=store.env.SUPPORT_FROM_EMAIL||'PanelStock Support <support@panelstockhq.com>';
 if(!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)||email.length>254||store.env.EMAIL_ENABLED!=='true'||!store.env.RESEND_API_KEY||!sender){notify();store.audit(username,'passcode-reset-requested',{});return reply;}
 const token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''),hash=await digest(token),fingerprint=await digest(JSON.stringify(user)),expiresAt=Date.now()+3600000;
 if(JSON.stringify(store.read('users',{})[username])!==JSON.stringify(user))return reply;
 store.ctx.storage.transactionSync(()=>{store.sql.exec('DELETE FROM user_invites WHERE expires<=? OR username=?',Date.now(),username);store.sql.exec('INSERT INTO user_invites(token,username,expires,fingerprint,purpose) VALUES(?,?,?,?,?)',hash,username,expiresAt,fingerprint,'reset');});
 const origins=(store.env.ALLOWED_ORIGINS||'').split(','),url=origins.includes('https://app.panelstockhq.com')?'https://app.panelstockhq.com/invite/#'+token:'https://panelstock-reports.matthewlakerdis.workers.dev/invite#'+token;
 try{
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+store.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'pin-reset-'+hash},body:JSON.stringify({from:sender,to:[email],subject:'Reset your PanelStock PIN',text:'A PIN reset was requested for your PanelStock account.\n\nUsername: '+username+'\n\nChoose a new PIN: '+url+'\n\nThis link expires in one hour and can only be used once. Your current PIN remains valid until you complete the reset. If you did not request this, you can ignore this email.'}),signal:AbortSignal.timeout(10000)});
  const result=await response.json().catch(()=>({}));check(response.ok&&result.id,'Email delivery failed',503);
  store.audit(username,'pin-reset-email-sent',{});
 }catch{
  store.sql.exec('DELETE FROM user_invites WHERE token=?',hash);store.audit(username,'pin-reset-email-failed',{});notify();
 }
 return reply;
}
