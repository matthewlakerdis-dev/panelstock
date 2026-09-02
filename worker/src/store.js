import { DurableObject } from 'cloudflare:workers';
import {digest,randomToken,equal,passwordRecord,verifyPin,normalizeUsername,validUsername,HttpError,requireCondition as check} from './security.js';
import {FIELDS,validateChanges,normalizeChanges,validateConfig} from './inventory.js';

const HOUR=3600000;
const TASKS=[
  ['factory.stock','Stock','factory',1],
  ['factory.receive','Receive stock','factory',1],
  ['factory.dispatch','Dispatch stock','factory',1],
  ['factory.damage','Record damage','factory',1],
  ['factory.cnc','CNC tracker','factory',1],
  ['factory.jobs','Jobs','factory',1],
  ['factory.settings','Settings','factory',0],
  ['site.orders.view','View site orders','site',1],
  ['site.orders.create','Create site orders','site',1],
  ['site.orders.manage','Manage site orders','site',0]
];
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
    this.sql.exec('CREATE TABLE IF NOT EXISTS order_mutations (id TEXT PRIMARY KEY, username TEXT NOT NULL, order_id TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS access_users (username TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT \'\', email TEXT NOT NULL DEFAULT \'\', phone TEXT NOT NULL DEFAULT \'\', active INTEGER NOT NULL DEFAULT 1, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS access_tasks (code TEXT PRIMARY KEY, label TEXT NOT NULL, app TEXT NOT NULL, default_worker INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS user_task_access (username TEXT NOT NULL, task_code TEXT NOT NULL, allowed INTEGER NOT NULL, assigned_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(username,task_code), FOREIGN KEY(username) REFERENCES access_users(username) ON DELETE CASCADE, FOREIGN KEY(task_code) REFERENCES access_tasks(code) ON DELETE CASCADE)');
    for(const task of TASKS)this.sql.exec('INSERT INTO access_tasks(code,label,app,default_worker) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET label=excluded.label,app=excluded.app,default_worker=excluded.default_worker',...task);
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
      for(const [username,user] of Object.entries(imported.users))this.syncAccessUser(username,user);
    });
    const existingUsers=this.read('users',{});
    for(const [username,user] of Object.entries(existingUsers))this.syncAccessUser(username,user);
  }
  syncAccessUser(username,user) {
    const now=new Date().toISOString();
    this.sql.exec('INSERT INTO access_users(username,display_name,email,phone,active,is_admin,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(username) DO UPDATE SET is_admin=excluded.is_admin,updated_at=excluded.updated_at',username,user.displayName||username,user.email||'',user.phone||'',user.isAdmin?1:0,now,now);
  }
  taskAccess(username,isAdmin=false) {
    const overrides=new Map(this.sql.exec('SELECT task_code,allowed FROM user_task_access WHERE username=?',username).toArray().map(row=>[row.task_code,!!row.allowed]));
    return Object.fromEntries(this.sql.exec('SELECT code,default_worker FROM access_tasks ORDER BY code').toArray().map(task=>[task.code,isAdmin || (overrides.has(task.code)?overrides.get(task.code):!!task.default_worker)]));
  }
  requireTask(actor,task) {check(actor.isAdmin || actor.tasks?.[task], 'You do not have access to this task',403);}
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
    return {username:s.username,isAdmin:!!user.isAdmin,tasks:this.taskAccess(s.username,!!user.isAdmin),tokenHash:hash};
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
      this.syncAccessUser(uname,user);
      return ok({ok:true,isNewUser:false,mustChangePin:false,isAdmin:!!user.isAdmin,taskAccess:this.taskAccess(uname,!!user.isAdmin),username:uname,...session});
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
    this.syncAccessUser(uname,latest[uname]);
    const session=await this.issueSession(uname);
    return ok({ok:true,username:uname,isAdmin:!!latest[uname].isAdmin,taskAccess:this.taskAccess(uname,!!latest[uname].isAdmin),...session});
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
          check(c.after.reasonCode==='007'||(Array.isArray(c.after.photoIds)&&c.after.photoIds.length>0&&c.after.photoIds.every(id=>photos.has(id))),'Damage requires saved photos');
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
      if(path==='/session' && method==='GET') return ok({ok:true,username:actor.username,isAdmin:actor.isAdmin,taskAccess:actor.tasks});
      if(path==='/logout' && method==='POST') {this.sql.exec('DELETE FROM sessions WHERE token=?',actor.tokenHash);return ok({ok:true});}
      if(path==='/profile' && method==='GET') {
        const profile=this.sql.exec('SELECT username,display_name AS displayName,email,phone,active,created_at AS createdAt,updated_at AS updatedAt FROM access_users WHERE username=?',actor.username).toArray()[0];
        return ok({ok:true,profile});
      }
      if(path==='/profile' && method==='POST') {
        const displayName=String(body.displayName||'').trim(),email=String(body.email||'').trim().toLowerCase(),phone=String(body.phone||'').trim();
        check(displayName.length>=1&&displayName.length<=100,'Display name must be 1–100 characters');
        check(email.length<=160&&(!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),'Invalid email address');check(phone.length<=40,'Phone number is too long');
        this.sql.exec('UPDATE access_users SET display_name=?,email=?,phone=?,updated_at=? WHERE username=?',displayName,email,phone,new Date().toISOString(),actor.username);
        this.audit(actor.username,'profile-updated');
        return ok({ok:true,profile:this.sql.exec('SELECT username,display_name AS displayName,email,phone,active,created_at AS createdAt,updated_at AS updatedAt FROM access_users WHERE username=?',actor.username).toArray()[0]});
      }
      if(path==='/data' && method==='GET') {this.requireTask(actor,'factory.stock');return ok(this.snapshot());}
      if(path==='/mutations' && method==='POST') {this.requireTask(actor,'factory.stock');return this.mutate(body,actor);}
      if(path==='/orders' && method==='GET') {this.requireTask(actor,'site.orders.view');return ok({ok:true,orders:this.read('orders',[])});}
      if(path==='/orders' && method==='POST') {this.requireTask(actor,'site.orders.create');return this.createOrder(body,actor);}
      const orderPath=path.match(/^\/orders\/([a-zA-Z0-9-]{16,100})$/);
      if(orderPath && method==='GET') {
        this.requireTask(actor,'site.orders.view');
        const order=this.read('orders',[]).find(value=>value.id===orderPath[1]);
        check(order,'Order request not found',404);return ok({ok:true,order});
      }
      const statusPath=path.match(/^\/orders\/([a-zA-Z0-9-]{16,100})\/status$/);
      if(statusPath && method==='POST') {this.requireTask(actor,'site.orders.manage');return this.updateOrderStatus(statusPath[1],body,actor);}
      if(['/data','/sync'].includes(path) && method==='POST') return ok({ok:false,error:'This app version is out of date. Refresh before editing.'},426);
      check(actor.isAdmin,'Admin access required',403);
      if(path==='/report-data' && method==='POST') {this.consumeLimit('email:'+actor.username,3,60000);return ok({data:this.snapshot(),config:this.read('config')});}
      if(path==='/config' && method==='GET') return ok(this.read('config'));
      if(path==='/config' && method==='POST') {this.ctx.storage.transactionSync(()=>{this.write('config',validateConfig(body));this.audit(actor.username,'report-settings');});return ok({ok:true});}
      if(method!=='POST') return ok({error:'Not found'},404);
      const users=this.read('users',{});
      if(path==='/admin/users') return ok({ok:true,users:Object.keys(users).sort().map(username=>({username,isAdmin:!!users[username].isAdmin,taskAccess:this.taskAccess(username,!!users[username].isAdmin)})),tasks:this.sql.exec('SELECT code,label,app,default_worker AS defaultWorker FROM access_tasks ORDER BY app,label').toArray(),registrationCode:this.read('registration_code',this.env.DEFAULT_PIN||'')});
      if(path==='/admin/set-task-access') {
        const target=normalizeUsername(body.targetUsername);check(Object.hasOwn(users,target),'User not found',404);
        check(TASKS.some(task=>task[0]===body.taskCode),'Unknown task');check(body.allowed===true||body.allowed===false||body.allowed===null,'Invalid task access');
        this.syncAccessUser(target,users[target]);
        if(body.allowed===null)this.sql.exec('DELETE FROM user_task_access WHERE username=? AND task_code=?',target,body.taskCode);
        else this.sql.exec('INSERT INTO user_task_access(username,task_code,allowed,assigned_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(username,task_code) DO UPDATE SET allowed=excluded.allowed,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at',target,body.taskCode,body.allowed?1:0,actor.username,new Date().toISOString());
        this.sql.exec('DELETE FROM sessions WHERE username=?',target);this.audit(actor.username,'task-access',{target,task:body.taskCode,allowed:body.allowed});
        return ok({ok:true,taskAccess:this.taskAccess(target,!!users[target].isAdmin)});
      }
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
        if(path==='/admin/remove-user') {delete users[target];this.sql.exec('DELETE FROM user_task_access WHERE username=?',target);this.sql.exec('DELETE FROM access_users WHERE username=?',target);} else {users[target].isAdmin=body.makeAdmin;this.syncAccessUser(target,users[target]);}
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
          for(const f of FIELDS.filter(f=>f!=='transactions')) if(snapshot[f]!==undefined)this.write('app:'+f,f==='photos'?{...snapshot.photos,...this.read('app:photos',{})}:snapshot[f]);
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
  createOrder(body,actor) {
    check(typeof body.idempotencyKey==='string' && /^[a-zA-Z0-9-]{16,100}$/.test(body.idempotencyKey),'Idempotency key required');
    const duplicate=this.sql.exec('SELECT order_id FROM order_mutations WHERE id=?',body.idempotencyKey).toArray()[0];
    if(duplicate){const order=this.read('orders',[]).find(value=>value.id===duplicate.order_id);return ok({ok:true,order,duplicate:true});}
    const input=body.order||{},clean=value=>String(value??'').trim();
    const items=Array.isArray(input.items)?input.items.map(item=>({quantity:Number(item.quantity),description:clean(item.description)})).filter(item=>item.quantity>0&&item.description):[];
    check(clean(input.project) && clean(input.siteContact) && clean(input.phone),'Project, site contact and phone are required');
    check(/^\d{4}-\d{2}-\d{2}$/.test(clean(input.requestedDeliveryDate)),'Requested delivery date is required');
    check(items.length>0 && items.length<=300,'Add between 1 and 300 order items');
    check(items.every(item=>Number.isFinite(item.quantity)&&item.quantity>0&&item.quantity<=99999&&item.description.length<=180),'Invalid order item');
    const orders=this.read('orders',[]),sequence=this.read('order-sequence',0)+1,now=new Date().toISOString();
    const order={id:crypto.randomUUID(),orderNumber:String(sequence),project:clean(input.project).slice(0,120),dateOrdered:now,requestedDeliveryDate:clean(input.requestedDeliveryDate),requestedDeliveryTime:clean(input.requestedDeliveryTime).slice(0,20),scheduledDeliveryDate:'',scheduledDeliveryTime:'',siteContact:clean(input.siteContact).slice(0,100),phone:clean(input.phone).slice(0,40),orderType:clean(input.orderType||'Other').slice(0,80),locationNotes:clean(input.locationNotes).slice(0,300),items,status:'submitted',requestedBy:actor.username,createdAt:now,updatedAt:now};
    orders.unshift(order);
    this.ctx.storage.transactionSync(()=>{this.write('orders',orders);this.write('order-sequence',sequence);this.sql.exec('INSERT INTO order_mutations(id,username,order_id) VALUES(?,?,?)',body.idempotencyKey,actor.username,order.id);this.audit(actor.username,'order-created',{orderId:order.id,orderNumber:order.orderNumber,itemCount:items.length});});
    return ok({ok:true,order},201);
  }
  updateOrderStatus(id,body,actor) {
    check(actor.isAdmin,'Admin access required',403);
    const allowed=['submitted','approved','ordered','completed','cancelled'];check(allowed.includes(body.status),'Invalid order status');
    const orders=this.read('orders',[]),index=orders.findIndex(value=>value.id===id);check(index>=0,'Order request not found',404);
    orders[index]={...orders[index],status:body.status,scheduledDeliveryDate:String(body.scheduledDeliveryDate||orders[index].scheduledDeliveryDate||'').slice(0,10),scheduledDeliveryTime:String(body.scheduledDeliveryTime||orders[index].scheduledDeliveryTime||'').slice(0,20),updatedAt:new Date().toISOString(),updatedBy:actor.username};
    this.ctx.storage.transactionSync(()=>{this.write('orders',orders);this.audit(actor.username,'order-status',{orderId:id,status:body.status});});
    return ok({ok:true,order:orders[index]});
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
