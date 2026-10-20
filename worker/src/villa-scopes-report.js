import {requireCondition as check,digest,equal} from './security.js';
import {requireAppAccess} from './app-access.js';
import {villaScopeAccess,villaScopeBackup} from './villa-scopes.js';

const KEY='villa-scopes:report-link';
const credential=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const summary=state=>({enabled:!!state?.enabled,revision:state?.revision||0,updatedAt:state?.updatedAt||null});
const ok=body=>({status:200,body:{ok:true,...body}});

export async function manageVillaReportLink(store,method,body,actor){
 check(villaScopeAccess(actor).canManage,'Manage villa scopes access required',403);
 if(method==='GET')return ok(summary(store.read(KEY)));
 check(method==='POST','Method not allowed',405);
 check(['create','revoke'].includes(body.action),'Choose create or revoke');
 check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0,'A reviewed report-link revision is required');
 if(body.action==='create')check(credential(body.token),'A random private report credential is required');
 store.consumeLimit('villa-report-link:'+actor.username,15);
 const tokenHash=body.action==='create'?await digest(body.token):null;
 return store.ctx.storage.transactionSync(()=>{
  const current=store.read(KEY,{revision:0,enabled:false});
  // A lost response can be retried without rotating an already-created link.
  if(current.revision===body.expectedRevision+1&&current.updatedBy===actor.username&&current.enabled===(body.action==='create')&&current.tokenHash===tokenHash)return ok(summary(current));
  check(current.revision===body.expectedRevision,'The report link changed. Close and reopen this panel before trying again.',409);
  const state={revision:current.revision+1,enabled:body.action==='create',tokenHash,updatedAt:new Date().toISOString(),updatedBy:actor.username,app:actor.app||'web'};
  store.write(KEY,state);store.audit(actor.username,state.enabled?'villa-report-link-created':'villa-report-link-revoked',{revision:state.revision});
  return ok(summary(state));
 });
}

export async function readVillaReport(store,method,token,ip){
 check(method==='GET','Method not allowed',405);
 store.consumeLimit('villa-report-read:'+ip,240);
 check(credential(token),'Open the private report link supplied by your manager.',401);
 const hash=await digest(token),state=store.read(KEY);
 check(state?.enabled&&equal(state.tokenHash,hash),'This report link is unavailable. Ask your manager for a new link.',401);
 const user=store.read('users',{})[state.updatedBy];
 check(user&&user.active!==false&&!user.mustChangePin,'This report link is unavailable. Ask your manager for a new link.',401);
 try{requireAppAccess(user,state.app);}catch{check(false,'This report link is unavailable. Ask your manager for a new link.',401);}
 const access=villaScopeAccess({isAdmin:!!user.isAdmin,tasks:store.taskAccess(state.updatedBy,!!user.isAdmin)});
 check(access.canManage,'This report link is unavailable. Ask your manager for a new link.',401);
 // Only canonical report data is returned: no user identities or session metadata.
 return ok({records:villaScopeBackup(store)?.records||[],revision:store.read('villa-scopes:index',{revision:0}).revision,canManage:false,report:true});
}
