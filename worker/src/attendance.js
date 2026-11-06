import {ensureSchema} from './schema.js';
import {digest,equal,randomToken,requireCondition as check} from './security.js';

const TYPES=['visitor','contractor','employee'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SAFETY_FIELDS=['visitorSafetyAcknowledged','workshopAccess','ppeConfirmed'];
const SAFETY_COLUMNS=['visitor_safety_acknowledged','workshop_access','ppe_confirmed'];
const SELECT=`SELECT seq,id,type,name,company,contact,host,purpose,visitor_safety_acknowledged AS visitorSafetyAcknowledged,workshop_access AS workshopAccess,ppe_confirmed AS ppeConfirmed,signed_in_at AS signedInAt,signed_out_at AS signedOutAt,signed_out_by AS signedOutBy FROM attendance_entries`;
export const PUBLIC_ATTENDANCE_PATHS=['/attendance/check-in','/attendance/lookup','/attendance/check-out'];
const ok=body=>({status:200,body});
const key=value=>value.normalize('NFKC').toLocaleLowerCase('en-AU');

export function initializeAttendance(store){
  ensureSchema(store.sql,'CREATE TABLE IF NOT EXISTS attendance_settings (id INTEGER PRIMARY KEY CHECK(id=1),kiosk_hash TEXT NOT NULL,updated_at TEXT NOT NULL)');
  ensureSchema(store.sql,"CREATE TABLE IF NOT EXISTS attendance_entries (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,type TEXT NOT NULL CHECK(type IN ('visitor','contractor','employee')),name TEXT NOT NULL,name_key TEXT NOT NULL,company TEXT NOT NULL,company_key TEXT NOT NULL,contact TEXT NOT NULL,host TEXT NOT NULL,purpose TEXT NOT NULL,visitor_safety_acknowledged INTEGER CHECK(visitor_safety_acknowledged IN (0,1)),workshop_access INTEGER CHECK(workshop_access IN (0,1)),ppe_confirmed INTEGER CHECK(ppe_confirmed IN (0,1)),signed_in_at TEXT NOT NULL,signed_out_at TEXT,signed_out_by TEXT)");
  const columns=new Set(store.sql.exec('PRAGMA table_info(attendance_entries)').toArray().map(column=>column.name));
  for(const column of SAFETY_COLUMNS)if(!columns.has(column))store.sql.exec('ALTER TABLE attendance_entries ADD COLUMN '+column+' INTEGER CHECK('+column+' IN (0,1))');
  ensureSchema(store.sql,'CREATE UNIQUE INDEX IF NOT EXISTS attendance_active_identity ON attendance_entries(type,name_key,company_key) WHERE signed_out_at IS NULL');
  ensureSchema(store.sql,'CREATE INDEX IF NOT EXISTS attendance_active_name ON attendance_entries(name_key) WHERE signed_out_at IS NULL');
  ensureSchema(store.sql,'CREATE TABLE IF NOT EXISTS attendance_requests (request_id TEXT PRIMARY KEY,kiosk_hash TEXT NOT NULL,action TEXT NOT NULL,payload_hash TEXT NOT NULL,entry_id TEXT NOT NULL)');
}

function text(value,label,max,required=false){
  check(value===undefined||value===null||typeof value==='string',`${label} must be text`);
  const result=(value||'').trim().replace(/\s+/gu,' ');
  check(result.length<=max,`${label} must be ${max} characters or fewer`);
  check(!required||result.length>0,`${label} is required`);
  check(!/[\u0000-\u001f\u007f]/u.test(result),`${label} contains invalid characters`);
  return result;
}
function uuid(value,label){check(typeof value==='string'&&UUID.test(value),`${label} must be a UUID`);return value.toLowerCase();}
function visitSafety(body){
  const unknown={visitorSafetyAcknowledged:null,workshopAccess:null,ppeConfirmed:null};
  // Cached kiosk clients may omit the whole questionnaire during rollout.
  if(!['visitor','contractor'].includes(body.type)||!SAFETY_FIELDS.some(field=>Object.hasOwn(body,field)))return unknown;
  check(body.visitorSafetyAcknowledged===true,'Acknowledge the site safety information');
  check(typeof body.workshopAccess==='boolean','Choose whether you will enter the workshop or work areas');
  check(body.workshopAccess?typeof body.ppeConfirmed==='boolean':body.ppeConfirmed===null,body.workshopAccess?'Confirm whether you have the required PPE':'PPE confirmation must be empty when work area access is not required');
  return {visitorSafetyAcknowledged:true,workshopAccess:body.workshopAccess,ppeConfirmed:body.ppeConfirmed};
}
function visit(body){
  check(TYPES.includes(body.type),'Choose visitor, contractor or employee');
  return {
    type:body.type,name:text(body.name,'Full name',120,true),
    company:body.type==='employee'?'':text(body.company,'Company',160,true),
    contact:text(body.contact,'Contact',160),
    host:text(body.host,'Person you’re visiting',120,true),purpose:'',...visitSafety(body)
  };
}
function entryById(store,id){return store.sql.exec(SELECT+' WHERE id=?',id).toArray()[0];}
function fullEntry(row){const {seq,...entry}=row;for(const field of SAFETY_FIELDS)entry[field]=entry[field]===null?null:entry[field]===1;return entry;}
function publicEntry(row){return {id:row.id,type:row.type,name:row.name,company:row.company,signedInAt:row.signedInAt,signedOutAt:row.signedOutAt};}
function currentKioskHash(store){return store.sql.exec('SELECT kiosk_hash FROM attendance_settings WHERE id=1').toArray()[0]?.kiosk_hash||'';}
function authorizeKiosk(store,hash){check(equal(hash,currentKioskHash(store)),'Sign-in kiosk is not connected. Ask an administrator to reconnect it.',401);}
function replay(store,requestId,hash,action,payloadHash){
  const previous=store.sql.exec('SELECT * FROM attendance_requests WHERE request_id=?',requestId).toArray()[0];
  if(!previous)return null;
  check(previous.kiosk_hash===hash&&previous.action===action&&previous.payload_hash===payloadHash,'Request ID was reused with different details. Start a new sign-in or sign-out.',409);
  return ok({ok:true,entry:publicEntry(entryById(store,previous.entry_id)),duplicate:true});
}
function recordRequest(store,requestId,hash,action,payloadHash,entryId){
  store.sql.exec('INSERT INTO attendance_requests(request_id,kiosk_hash,action,payload_hash,entry_id) VALUES(?,?,?,?,?)',requestId,hash,action,payloadHash,entryId);
}

export async function handlePublicAttendance(store,path,body,ip){
  store.consumeLimit('attendance:ip:'+ip,120,60000);
  check(typeof body.kioskToken==='string'&&/^[a-f0-9]{64}$/.test(body.kioskToken),'Sign-in kiosk is not connected. Ask an administrator to reconnect it.',401);
  const hash=await digest(body.kioskToken);
  authorizeKiosk(store,hash);
  store.consumeLimit('attendance:kiosk:'+hash,1200,15*60000);
  if(path==='/attendance/lookup'){
    if(body.name===undefined){
      const entries=store.sql.exec(SELECT+' WHERE signed_out_at IS NULL ORDER BY name_key,company_key,type,id').toArray().map(publicEntry);
      return ok({ok:true,entries});
    }
    const name=text(body.name,'Full name',120,true);
    const entries=store.sql.exec(SELECT+' WHERE name_key=? AND signed_out_at IS NULL ORDER BY seq DESC LIMIT 50',key(name)).toArray().map(publicEntry);
    return ok({ok:true,entries});
  }
  const requestId=uuid(body.requestId,'Request ID');
  if(path==='/attendance/check-in'){
    const value=visit(body),{visitorSafetyAcknowledged,workshopAccess,ppeConfirmed,...legacyValue}=value;
    // Keep pre-questionnaire request hashes replayable for cached clients.
    const payloadHash=await digest(JSON.stringify(visitorSafetyAcknowledged===null?legacyValue:value));
    return store.ctx.storage.transactionSync(()=>{
      authorizeKiosk(store,hash);
      const previous=replay(store,requestId,hash,'check-in',payloadHash);if(previous)return previous;
      // Employee names here are self-reported attendance, never account identities.
      const existing=store.sql.exec(SELECT+' WHERE type=? AND name_key=? AND company_key=? AND signed_out_at IS NULL',value.type,key(value.name),key(value.company)).toArray()[0];
      if(existing){recordRequest(store,requestId,hash,'check-in',payloadHash,existing.id);return ok({ok:true,entry:publicEntry(existing),duplicate:true});}
      const id=crypto.randomUUID(),now=new Date().toISOString();
      store.sql.exec('INSERT INTO attendance_entries(id,type,name,name_key,company,company_key,contact,host,purpose,visitor_safety_acknowledged,workshop_access,ppe_confirmed,signed_in_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,value.type,value.name,key(value.name),value.company,key(value.company),value.contact,value.host,value.purpose,...SAFETY_FIELDS.map(field=>value[field]===null?null:Number(value[field])),now);
      recordRequest(store,requestId,hash,'check-in',payloadHash,id);
      store.audit('attendance-kiosk','attendance-check-in',{entryId:id,type:value.type});
      return ok({ok:true,entry:publicEntry(entryById(store,id))});
    });
  }
  if(path==='/attendance/check-out'){
    const id=uuid(body.id,'Attendance ID'),payloadHash=await digest(id);
    return store.ctx.storage.transactionSync(()=>{
      authorizeKiosk(store,hash);
      const previous=replay(store,requestId,hash,'check-out',payloadHash);if(previous)return previous;
      const entry=entryById(store,id);check(entry,'Sign-in record not found',404);
      if(!entry.signedOutAt){store.sql.exec('UPDATE attendance_entries SET signed_out_at=?,signed_out_by=? WHERE id=? AND signed_out_at IS NULL',new Date().toISOString(),'kiosk',id);store.audit('attendance-kiosk','attendance-check-out',{entryId:id});}
      recordRequest(store,requestId,hash,'check-out',payloadHash,id);
      return ok({ok:true,entry:publicEntry(entryById(store,id)),...(entry.signedOutAt?{duplicate:true}:{})});
    });
  }
  return {status:404,body:{ok:false,error:'Not found'}};
}

function register(store,body){
  const limit=body.limit===undefined?100:Number(body.limit);check(Number.isInteger(limit)&&limit>=1&&limit<=250,'Page size must be between 1 and 250');
  let before,max;
  if(body.cursor!==undefined&&body.cursor!==null&&body.cursor!==''){
    check(typeof body.cursor==='string'&&/^v1\.\d{1,16}\.\d{1,16}$/.test(body.cursor),'Invalid attendance cursor');
    const parts=body.cursor.split('.');before=Number(parts[1]);max=Number(parts[2]);
    check(Number.isSafeInteger(before)&&Number.isSafeInteger(max)&&before>0&&max>=before,'Invalid attendance cursor');
  }else{max=store.sql.exec('SELECT COALESCE(MAX(seq),0) AS n FROM attendance_entries').toArray()[0].n;before=max+1;}
  const rows=store.sql.exec(SELECT+' WHERE seq<? AND seq<=? ORDER BY seq DESC LIMIT ?',before,max,limit+1).toArray(),hasMore=rows.length>limit,page=rows.slice(0,limit);
  const activeEntries=store.sql.exec(SELECT+' WHERE signed_out_at IS NULL ORDER BY seq DESC').toArray().map(fullEntry);
  const counts={active:activeEntries.length,visitors:0,contractors:0,employees:0};
  for(const entry of activeEntries)counts[entry.type+'s']++;
  return ok({ok:true,entries:page.map(fullEntry),activeEntries,counts,kioskConfigured:!!currentKioskHash(store),nextCursor:hasMore?'v1.'+page[page.length-1].seq+'.'+max:null});
}

export async function handleAttendanceAdmin(store,path,method,body,actor,sessionToken,app=''){
  check(actor.isAdmin&&!actor.toolboxOnly&&!actor.safetySelfOnly,'Administrator access required',403);
  if(path==='/attendance/register'&&['GET','POST'].includes(method))return register(store,body);
  if(path==='/attendance/kiosk'&&method==='POST'){
    store.consumeLimit('attendance:setup:'+actor.username,20,60000);
    const kioskToken=randomToken(),hash=await digest(kioskToken);
    // Hashing yields; recheck the administrator session before rotating access.
    if(sessionToken){const current=await store.actor(sessionToken,app);check(current.isAdmin&&!current.toolboxOnly&&!current.safetySelfOnly,'Administrator access required',403);}
    store.ctx.storage.transactionSync(()=>{
      store.sql.exec('INSERT INTO attendance_settings(id,kiosk_hash,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET kiosk_hash=excluded.kiosk_hash,updated_at=excluded.updated_at',hash,new Date().toISOString());
      store.audit(actor.username,'attendance-kiosk-created');
    });
    return ok({ok:true,kioskToken});
  }
  if(path==='/attendance/kiosk/revoke'&&method==='POST'){
    store.ctx.storage.transactionSync(()=>{store.sql.exec('DELETE FROM attendance_settings WHERE id=1');store.audit(actor.username,'attendance-kiosk-revoked');});
    return ok({ok:true});
  }
  if(path==='/attendance/admin-check-out'&&method==='POST'){
    const id=uuid(body.id,'Attendance ID'),entry=entryById(store,id);check(entry,'Sign-in record not found',404);
    if(!entry.signedOutAt)store.ctx.storage.transactionSync(()=>{store.sql.exec('UPDATE attendance_entries SET signed_out_at=?,signed_out_by=? WHERE id=? AND signed_out_at IS NULL',new Date().toISOString(),actor.username,id);store.audit(actor.username,'attendance-admin-check-out',{entryId:id});});
    return ok({ok:true,entry:fullEntry(entryById(store,id)),...(entry.signedOutAt?{duplicate:true}:{})});
  }
  return {status:404,body:{ok:false,error:'Not found'}};
}

// Included in ordinary disaster-recovery snapshots; stock restore leaves this history intact.
export function attendanceBackup(store){return {entries:store.sql.exec(SELECT+' ORDER BY seq').toArray().map(fullEntry)};}
