import { DurableObject } from 'cloudflare:workers';
import {digest,randomToken,equal,passwordRecord,verifyPin,normalizeUsername,validUsername,HttpError,requireCondition as check} from './security.js';
import {FIELDS,validateChanges,normalizeChanges,validateConfig} from './inventory.js';

const HOUR=3600000;
const ok=(body,status=200)=>({status,body});
const withoutServerFields = value => {
  if(!value) return value;
  const {serverTimestamp,uploadedAt,uploadedBy,completedAt,completedBy,voidedAt,voidedBy,...rest}=value;
  return rest;
};
const same=(a,b)=>JSON.stringify(withoutServerFields(a))===JSON.stringify(withoutServerFields(b));

// A coordination object per inventory/site, shared by that site's mobile and desktop clients.
export class InventoryStore extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS documents (key TEXT, part INTEGER, value TEXT NOT NULL, PRIMARY KEY(key,part))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS mutations (id TEXT PRIMARY KEY, username TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL)');
    ctx.blockConcurrencyWhile(async()=>{
      if(this.read('initialized',false) || env.MIGRATION_READY!=='true') return;
      // Read legacy data only once, after operators have paused legacy writers.
      const keys=[...FIELDS.map(f=>'app:'+f),'users','config','registration_code','last-sent'];
      const values=await Promise.all(keys.map(k=>env.LEGACY_KV.get(k)));
      check(values[keys.indexOf('users')], 'Existing user database required for migration',503);
      const imported={};
      keys.forEach((k,i)=>{if(values[i]!==null) imported[k]=['registration_code','last-sent'].includes(k)?values[i]:JSON.parse(values[i]);});
      check(Object.values(imported.users).some(u=>u.isAdmin),'Migration requires an existing admin',503);
      const backups=[];let cursor;
      do {
        const page=await env.LEGACY_KV.list({prefix:'backup:',cursor});
        for(const key of page.keys){const raw=await env.LEGACY_KV.get(key.name);if(raw)backups.push([key.name,JSON.parse(raw)]);}
        cursor=page.list_complete?undefined:page.cursor;
      }while(cursor);
      this.ctx.storage.transactionSync(()=>{
        Object.entries(imported).forEach(([k,v])=>this.write(k,v));
        backups.forEach(([k,v])=>this.write(k,v));
        this.write('revision',0); this.write('initialized',true);
        this.backup('migration',false);
      });
    });
  }
  read(key,fallback=null) {
    const rows=this.sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part',key).toArray();
    return rows.length?JSON.parse(rows.map(r=>r.value).join('')):fallback;
  }
  write(key,value) {
    const raw=JSON.stringify(value);
    this.sql.exec('DELETE FROM documents WHERE key=?',key);
    // Chunk large photo collections and histories below SQLite row limits.
    for(let i=0;i<raw.length;i+=100000) this.sql.exec('INSERT INTO documents(key,part,value) VALUES(?,?,?)',key,i/100000,raw.slice(i,i+100000));
  }
  audit(username,action,detail={}) {
    this.sql.exec('INSERT INTO audit(username,action,at,detail) VALUES(?,?,?,?)',username,action,new Date().toISOString(),JSON.stringify(detail));
  }
  consumeLimit(key,max=10,window=15*60000) {
    const now=Date.now();
    this.sql.exec('DELETE FROM limits WHERE expires<=?',now);
    const row=this.sql.exec('SELECT count FROM limits WHERE key=?',key).toArray()[0];
    check(!row || row.count<max,'Too many attempts. Try again later.',429);
    this.sql.exec('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,now+window);
  }
  async issueSession(username) {
    const token=randomToken();const hash=await digest(token);
    const expires=Date.now()+8*HOUR;
    this.sql.exec('DELETE FROM sessions WHERE expires<=?',Date.now());
    this.sql.exec('INSERT INTO sessions(token,username,expires) VALUES(?,?,?)',hash,username,expires);
    return {token,expiresAt:expires};
  }
  async actor(token) {
    check(typeof token==='string' && /^[a-f0-9]{64}$/.test(token),'Please log in',401);
    const hash=await digest(token);
    const s=this.sql.exec('SELECT username,expires FROM sessions WHERE token=?',hash).toArray()[0];
    const user=s && this.read('users',{})[s.username];
    check(s && s.expires>Date.now() && user && !user.mustChangePin,'Session expired. Please log in again.',401);
    return {username:s.username,isAdmin:!!user.isAdmin,tokenHash:hash};
  }
  async authenticate(path,body,ip) {
    const uname=normalizeUsername(body.username);
    check(validUsername(uname),'Invalid username');
    this.consumeLimit('ip:'+ip,50);this.consumeLimit('user:'+uname,15);
    const original=this.read('users',{});
    const user=Object.hasOwn(original,uname)?original[uname]:null;
    const registration=this.read('registration_code',this.env.DEFAULT_PIN || null);
    if(path==='/login') {
      if(!user) {
        check(registration && equal(body.pin,registration),'Invalid username or PIN',401);
        return ok({ok:true,isNewUser:true,mustChangePin:true});
      }
      check(await verifyPin(body.pin,uname,user,this.env.PIN_SALT),'Invalid username or PIN',401);
      // Password hashing yields; reject if another request changed/deleted this user meanwhile.
      check(JSON.stringify(this.read('users',{})[uname])===JSON.stringify(user),'Account changed; please retry',409);
      if(user.mustChangePin) return ok({ok:true,isNewUser:false,mustChangePin:true});
      const session=await this.issueSession(uname);
      check(JSON.stringify(this.read('users',{})[uname])===JSON.stringify(user),'Account changed; please retry',409);
      return ok({ok:true,isNewUser:false,mustChangePin:false,isAdmin:!!user.isAdmin,username:uname,...session});
    }
    check(typeof body.newPin==='string' && /^\d{6,12}$/.test(body.newPin),'New PIN must contain 6–12 digits');
    check(user ? await verifyPin(body.oldPin,uname,user,this.env.PIN_SALT) : registration && equal(body.oldPin,registration),'Invalid current PIN or registration code',401);
    const password=await passwordRecord(body.newPin);
    const latest=this.read('users',{});
    check(JSON.stringify(latest[uname]||null)===JSON.stringify(user),'Account changed; please retry',409);
    if(!user) check(registration===this.read('registration_code',this.env.DEFAULT_PIN || null),'Registration code changed',409);
    check(user || Object.values(latest).some(u=>u.isAdmin),'Initial admin must be provisioned during migration',403);
    latest[uname]={password,isAdmin:!!user?.isAdmin,mustChangePin:false,updatedAt:new Date().toISOString()};
    this.ctx.storage.transactionSync(()=>{
      this.write('users',latest);this.sql.exec('DELETE FROM sessions WHERE username=?',uname);this.audit(uname,'set-pin');
    });
    const session=await this.issueSession(uname);
    return ok({ok:true,username:uname,isAdmin:!!latest[uname].isAdmin,...session});
  }
  snapshot() {
    return {...Object.fromEntries(FIELDS.map(f=>[f,this.read('app:'+f,f==='photos'?{}:[])])),revision:this.read('revision',0),restoreEpoch:this.read('restoreEpoch',0)};
  }
  backup(username,prune=true) {
    const timestamp=new Date().toISOString();
    const snapshot={...this.snapshot(),users:this.read('users',{}),config:this.read('config'),registration_code:this.read('registration_code'),takenAt:timestamp,takenBy:username};
    this.write('backup:'+timestamp,snapshot);
    if(prune) {
      const cutoff=Date.now()-14*24*HOUR;
      for(const {key} of this.sql.exec("SELECT DISTINCT key FROM documents WHERE key LIKE 'backup:%'").toArray())
        if(Date.parse(key.slice(7))<cutoff) this.sql.exec('DELETE FROM documents WHERE key=?',key);
    }
    return timestamp;
  }
  mutate(body,actor) {
    check(typeof body.mutationId==='string' && /^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Mutation ID required');
    const payload=JSON.stringify(body.changes);
    const old=this.sql.exec('SELECT username,payload,revision FROM mutations WHERE id=?',body.mutationId).toArray()[0];
    if(old) {check(old.username===actor.username && old.payload===payload,'Mutation ID reused with different data',409);return ok({ok:true,revision:old.revision,duplicate:true});}
    check(body.restoreEpoch===this.read('restoreEpoch',0),'A backup was restored. Review pending changes before retrying.',409);
    validateChanges(body.changes,actor);
    const now=new Date().toISOString();
    const normalized=normalizeChanges(body.changes,actor,now);
    const collections={};
    for(const c of body.changes) {
      if(!collections[c.field]) {
        const value=this.read('app:'+c.field,c.field==='photos'?{}:[]);
        collections[c.field]=c.field==='photos'?new Map(Object.entries(value)):new Map(value.map(v=>[v.id,v]));
      }
      check(same(collections[c.field].get(c.id)||null,c.before),'Stock changed on another device. Review pending changes before retrying.',409);
    }
    // Stock, photos, and their activity are committed as one immutable batch.
    const stockChanged=body.changes.some(c=>['variants','offcuts'].includes(c.field) && (c.before?.qty||0)!==(c.after?.qty||0));
    check(!stockChanged || body.changes.some(c=>c.field==='transactions'),'Stock changes require an activity record');
    if(!actor.isAdmin && stockChanged) {
      const deltas=new Map();
      for(const c of body.changes.filter(c=>['variants','offcuts'].includes(c.field))) {
        const key=c.field+':'+(c.after?.sku||c.before?.sku);
        deltas.set(key,(deltas.get(key)||0)+(c.after?.qty||0)-(c.before?.qty||0));
      }
      for(const c of body.changes.filter(c=>c.field==='transactions' && !c.before)) {
        const t=c.after;
        check(['receipt','dispatch','damage','offcut_add'].includes(t.type),'Invalid stock activity',403);
        check(t.qty>0,'Stock movement quantity must be positive');
        const key=(t.itemType==='variant'?'variants':'offcuts')+':'+t.sku;
        const delta=['receipt','offcut_add'].includes(t.type)?t.qty:-t.qty;
        deltas.set(key,(deltas.get(key)||0)-delta);
      }
      check([...deltas.values()].every(v=>v===0),'Stock quantities do not match their activity records');
    }
    for(const c of normalized) {if(c.after===null)collections[c.field].delete(c.id);else collections[c.field].set(c.id,c.after);}
    const currentMap=field=>collections[field] || new Map((this.read('app:'+field,[])).map(v=>[v.id,v]));
    for(const c of normalized) {
      if(c.field==='variants' && c.after && (!c.before || c.after.catalogId!==c.before.catalogId))check(currentMap('catalog').has(c.after.catalogId),'Unknown catalog item');
      if(c.field==='transactions' && !c.before && ['receipt','dispatch','damage'].includes(c.after.type)) {
        const field=c.after.itemType==='variant'?'variants':c.after.itemType==='offcut'?'offcuts':null;
        check(field,'Stock activity requires an item type');
        check(body.changes.some(change=>change.field===field && (change.after?.sku||change.before?.sku)===c.after.sku),'Stock activity must include the affected item');
        if(c.after.type==='damage') {
          const photos=collections.photos || new Map(Object.entries(this.read('app:photos',{})));
          check(Array.isArray(c.after.photoIds)&&c.after.photoIds.length>0&&c.after.photoIds.every(id=>photos.has(id)),'Damage requires saved photos');
        }
      }
    }
    const revision=this.read('revision',0)+1;
    this.ctx.storage.transactionSync(()=>{
      for(const [field,records] of Object.entries(collections)) {
        let value=field==='photos'?Object.fromEntries(records):[...records.values()];
        if(field==='transactions') value.sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
        this.write('app:'+field,value);
      }
      this.write('revision',revision);
      this.sql.exec('INSERT INTO mutations(id,username,payload,revision) VALUES(?,?,?,?)',body.mutationId,actor.username,payload,revision);
      this.audit(actor.username,'mutation',{id:body.mutationId,revision,changes:body.changes.length});
    });
    return ok({ok:true,revision});
  }
  async handle(path,method,body,token,ip) {
    try {
      check(this.read('initialized',false),'Service awaiting controlled migration',503);
      if(['/login','/set-pin'].includes(path) && method==='POST') return await this.authenticate(path,body,ip);
      const actor=await this.actor(token);
      // Everything below this point uses freshly read roles, never browser-supplied usernames.
      if(path==='/session' && method==='GET') return ok({ok:true,username:actor.username,isAdmin:actor.isAdmin});
      if(path==='/logout' && method==='POST') {this.sql.exec('DELETE FROM sessions WHERE token=?',actor.tokenHash);return ok({ok:true});}
      if(path==='/data' && method==='GET') return ok(this.snapshot());
      if(path==='/mutations' && method==='POST') return this.mutate(body,actor);
      if(['/data','/sync'].includes(path) && method==='POST') return ok({ok:false,error:'This app version is out of date. Refresh before editing.'},426);
      check(actor.isAdmin,'Admin access required',403);
      if(path==='/report-data' && method==='POST') {this.consumeLimit('email:'+actor.username,3,60000);return ok({data:this.snapshot(),config:this.read('config')});}
      if(path==='/config' && method==='GET') return ok(this.read('config'));
      if(path==='/config' && method==='POST') {this.ctx.storage.transactionSync(()=>{this.write('config',validateConfig(body));this.audit(actor.username,'report-settings');});return ok({ok:true});}
      if(method!=='POST') return ok({error:'Not found'},404);
      const users=this.read('users',{});
      if(path==='/admin/users') return ok({ok:true,users:Object.keys(users).sort().map(username=>({username,isAdmin:!!users[username].isAdmin})),registrationCode:this.read('registration_code',this.env.DEFAULT_PIN||'')});
      if(path==='/admin/set-registration-code') {
        check(typeof body.newCode==='string' && /^\d{6}$/.test(body.newCode),'Code must be exactly 6 digits');
        this.write('registration_code',body.newCode);this.audit(actor.username,'registration-code');return ok({ok:true});
      }
      if(['/admin/set-admin','/admin/reset-pin','/admin/remove-user'].includes(path)) {
        const target=normalizeUsername(body.targetUsername);check(Object.hasOwn(users,target),'User not found',404);
        if(path==='/admin/set-admin') check(typeof body.makeAdmin==='boolean','Invalid admin flag');
        if(path==='/admin/remove-user' || (path==='/admin/set-admin' && !body.makeAdmin)) check(!users[target].isAdmin || Object.values(users).filter(u=>u.isAdmin).length>1,'Cannot remove the last admin');
        if(path==='/admin/reset-pin') {
          const registration=this.read('registration_code',this.env.DEFAULT_PIN||null);check(registration,'Set a registration code first');
          const password=await passwordRecord(registration);
          // Re-check actor, target and registration after asynchronous hashing.
          const currentActor=await this.actor(token);check(currentActor.isAdmin,'Admin access required',403);
          const current=this.read('users',{});check(Object.hasOwn(current,target),'User not found',404);
          check(registration===this.read('registration_code',this.env.DEFAULT_PIN||null),'Registration code changed; retry',409);
          current[target]={...current[target],password,mustChangePin:true};delete current[target].pinHash;
          this.ctx.storage.transactionSync(()=>{this.write('users',current);this.sql.exec('DELETE FROM sessions WHERE username=?',target);this.audit(actor.username,path,{target});});
          return ok({ok:true});
        }
        if(path==='/admin/remove-user') delete users[target];else users[target].isAdmin=body.makeAdmin;
        this.ctx.storage.transactionSync(()=>{this.write('users',users);this.sql.exec('DELETE FROM sessions WHERE username=?',target);this.audit(actor.username,path,{target});});
        return ok({ok:true});
      }
      if(path==='/admin/backups') return ok({ok:true,backups:this.sql.exec("SELECT DISTINCT key FROM documents WHERE key LIKE 'backup:%' ORDER BY key DESC").toArray().map(({key})=>({timestamp:key.slice(7),takenBy:this.read(key).takenBy}))});
      if(path==='/admin/backup-now') {let timestamp;this.ctx.storage.transactionSync(()=>{timestamp=this.backup(actor.username);this.audit(actor.username,'backup');});return ok({ok:true,takenAt:timestamp});}
      if(path==='/admin/restore-backup') {
        const snapshot=this.read('backup:'+body.timestamp);check(snapshot,'Backup not found',404);
        check(body.expectedRevision===this.read('revision',0),'Stock changed. Refresh before restoring.',409);
        this.ctx.storage.transactionSync(()=>{
          this.backup(actor.username,false);
          // Restore stock, not users/credentials. Preserve full history and document the restore.
          for(const f of FIELDS.filter(f=>f!=='transactions')) if(snapshot[f]!==undefined)this.write('app:'+f,snapshot[f]);
          const history=this.read('app:transactions',[]);
          history.unshift({id:crypto.randomUUID(),type:'reset',desc:'Restored stock backup '+body.timestamp,qty:0,user:actor.username,timestamp:new Date().toISOString()});
          this.write('app:transactions',history);this.write('revision',this.read('revision',0)+1);
          this.write('restoreEpoch',this.read('restoreEpoch',0)+1);
          this.audit(actor.username,'restore',{timestamp:body.timestamp});
        });return ok({ok:true});
      }
      return ok({error:'Not found'},404);
    }catch(error){if(error instanceof HttpError)return ok({ok:false,error:error.message},error.status);console.error('inventory_request_failed',{path,name:error.name});return ok({ok:false,error:'Request failed; no successful save was confirmed.'},500);}
  }
  readPublicCnc() {return this.read('app:cncPanels',[]);}
  scheduledData() {
    check(this.read('initialized',false),'Not initialized',503);
    const date=new Date().toISOString().slice(0,10);
    if(this.read('last-backup-date')!==date)this.ctx.storage.transactionSync(()=>{this.backup('scheduled');this.write('last-backup-date',date);});
    return {data:this.snapshot(),config:this.read('config'),lastSent:this.read('last-sent')};
  }
  claimReport(period) {
    if(this.read('last-sent')===period || this.read('report-lease',0)>Date.now())return false;
    this.write('report-lease',Date.now()+5*60000);return true;
  }
  finishReport(period,success) {this.ctx.storage.transactionSync(()=>{if(success)this.write('last-sent',period);this.write('report-lease',0);});}
}
