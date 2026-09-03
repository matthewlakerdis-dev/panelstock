import { DurableObject } from 'cloudflare:workers';
import {digest,randomToken,passwordRecord,verifyPin,normalizeUsername,validUsername,HttpError,requireCondition as check} from './security.js';
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
  ['schedule.view','View schedule','factory',1],
  ['schedule.manage','Manage schedule','web',0],
  ['site.orders.view','View site orders','site',1],
  ['site.orders.create','Create site orders','site',1],
  ['site.orders.manage','Manage site orders','site',0],
  ['site.cnc.view','View CNC tracker','site',1]
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
    this.sql.exec('CREATE TABLE IF NOT EXISTS order_pdf_tickets (token TEXT PRIMARY KEY, username TEXT NOT NULL, order_id TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS access_users (username TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT \'\', email TEXT NOT NULL DEFAULT \'\', phone TEXT NOT NULL DEFAULT \'\', active INTEGER NOT NULL DEFAULT 1, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const accessColumns=new Set(this.sql.exec('PRAGMA table_info(access_users)').toArray().map(column=>column.name));
    if(!accessColumns.has('title'))this.sql.exec("ALTER TABLE access_users ADD COLUMN title TEXT NOT NULL DEFAULT ''");
    if(!accessColumns.has('location'))this.sql.exec("ALTER TABLE access_users ADD COLUMN location TEXT NOT NULL DEFAULT ''");
    if(!accessColumns.has('role_id'))this.sql.exec("ALTER TABLE access_users ADD COLUMN role_id TEXT DEFAULT NULL");
    this.sql.exec('CREATE TABLE IF NOT EXISTS access_tasks (code TEXT PRIMARY KEY, label TEXT NOT NULL, app TEXT NOT NULL, default_worker INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS user_task_access (username TEXT NOT NULL, task_code TEXT NOT NULL, allowed INTEGER NOT NULL, assigned_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(username,task_code), FOREIGN KEY(username) REFERENCES access_users(username) ON DELETE CASCADE, FOREIGN KEY(task_code) REFERENCES access_tasks(code) ON DELETE CASCADE)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS access_roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS role_task_access (role_id TEXT NOT NULL, task_code TEXT NOT NULL, allowed INTEGER NOT NULL, PRIMARY KEY(role_id,task_code), FOREIGN KEY(role_id) REFERENCES access_roles(id) ON DELETE CASCADE, FOREIGN KEY(task_code) REFERENCES access_tasks(code) ON DELETE CASCADE)');
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
    this.sql.exec('INSERT INTO access_users(username,display_name,email,phone,active,is_admin,created_at,updated_at,title,location) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET title=excluded.title,location=excluded.location,active=excluded.active,is_admin=excluded.is_admin,updated_at=excluded.updated_at',username,user.displayName||username,user.email||'',user.phone||'',user.active===false?0:1,user.isAdmin?1:0,now,now,user.title||'',user.location||'');
  }
  taskAccess(username,isAdmin=false) {
    if(isAdmin)return Object.fromEntries(this.sql.exec('SELECT code FROM access_tasks ORDER BY code').toArray().map(task=>[task.code,true]));
    const profile=this.sql.exec('SELECT role_id AS roleId FROM access_users WHERE username=?',username).toArray()[0];
    if(profile?.roleId){const allowed=new Set(this.sql.exec('SELECT task_code FROM role_task_access WHERE role_id=? AND allowed=1',profile.roleId).toArray().map(row=>row.task_code));return Object.fromEntries(this.sql.exec('SELECT code FROM access_tasks ORDER BY code').toArray().map(task=>[task.code,allowed.has(task.code)]));}
    const overrides=new Map(this.sql.exec('SELECT task_code,allowed FROM user_task_access WHERE username=?',username).toArray().map(row=>[row.task_code,!!row.allowed]));
    return Object.fromEntries(this.sql.exec('SELECT code,default_worker FROM access_tasks ORDER BY code').toArray().map(task=>[task.code,overrides.has(task.code)?overrides.get(task.code):!!task.default_worker]));
  }
  roles(){return this.sql.exec('SELECT id,name FROM access_roles ORDER BY name').toArray().map(role=>({...role,taskAccess:Object.fromEntries(this.sql.exec('SELECT code FROM access_tasks ORDER BY code').toArray().map(task=>[task.code,!!this.sql.exec('SELECT allowed FROM role_task_access WHERE role_id=? AND task_code=?',role.id,task.code).toArray()[0]?.allowed]))}));}
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
    check(s && s.expires>Date.now() && user && user.active!==false && !user.mustChangePin,'Session expired. Please log in again.',401);
    return {username:s.username,isAdmin:!!user.isAdmin,tasks:this.taskAccess(s.username,!!user.isAdmin),tokenHash:hash};
  }
  async redeemOrderPdfTicket(orderId,token) {
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return ok({error:'PDF link expired'},404);
    const hash=await digest(token),now=Date.now();
    this.sql.exec('DELETE FROM order_pdf_tickets WHERE expires<=?',now);
    const ticket=this.sql.exec('SELECT username,order_id AS orderId,expires FROM order_pdf_tickets WHERE token=?',hash).toArray()[0];
    if(!ticket||ticket.orderId!==orderId||ticket.expires<=now)return ok({error:'PDF link expired'},404);
    this.sql.exec('DELETE FROM order_pdf_tickets WHERE token=?',hash);
    const order=this.read('orders',[]).find(value=>value.id===orderId);
    return order?ok({ok:true,order}):ok({error:'Order request not found'},404);
  }
  async authenticate(path,body,ip) {
    const uname=normalizeUsername(body.username);
    check(validUsername(uname),'Invalid username');
    this.consumeLimit('ip:'+ip,50);this.consumeLimit('user:'+uname,15);
    const original=this.read('users',{});
    const user=Object.hasOwn(original,uname)?original[uname]:null;
    if(path==='/login') {
      check(user&&user.active!==false,'Invalid username or PIN',401);
      check(await verifyPin(body.pin,uname,user,this.env.PIN_SALT),'Invalid username or PIN',401);
      // Password hashing yields; reject if another request changed/deleted this user meanwhile.
      check(JSON.stringify(this.read('users',{})[uname])===JSON.stringify(user),'Account changed; please retry',409);
      if(user.mustChangePin) return ok({ok:true,isNewUser:false,mustChangePin:true});
      const session=await this.issueSession(uname);
      check(JSON.stringify(this.read('users',{})[uname])===JSON.stringify(user),'Account changed; please retry',409);
      this.syncAccessUser(uname,user);
      return ok({ok:true,isNewUser:false,mustChangePin:false,isAdmin:!!user.isAdmin,taskAccess:this.taskAccess(uname,!!user.isAdmin),username:uname,...session});
    }
    check(user,'Account must be created by an administrator',401);
    check(typeof body.newPin==='string' && /^\d{6,12}$/.test(body.newPin),'New PIN must contain 6–12 digits');
    check(await verifyPin(body.oldPin,uname,user,this.env.PIN_SALT),'Invalid current PIN',401);
    const password=await passwordRecord(body.newPin);
    const latest=this.read('users',{});
    check(JSON.stringify(latest[uname]||null)===JSON.stringify(user),'Account changed; please retry',409);
    latest[uname]={...user,password,isAdmin:!!user.isAdmin,mustChangePin:false,updatedAt:new Date().toISOString()};
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
      if(path==='/orders' && method==='GET') {this.requireTask(actor,'site.orders.view');const projectRecords=this.ensureProjectRecords();return ok({ok:true,orders:this.read('orders',[]),projects:projectRecords.map(value=>value.name),projectRecords,projectSequences:this.orderProjectSequences()});}
      if(path==='/orders' && method==='POST') {this.requireTask(actor,'site.orders.create');return this.createOrder(body,actor);}
      if(path==='/order-sequences' && method==='POST') {this.requireTask(actor,'site.orders.manage');return this.setOrderProjectSequence(body,actor);}
      if(path==='/projects' && method==='GET') return ok({ok:true,projects:this.ensureProjectRecords()});
      if(['/projects','/order-projects'].includes(path) && method==='POST') {check(actor.isAdmin,'Admin access required',403);return this.addOrderProject(body,actor);}
      const projectPath=path.match(/^\/projects\/([a-zA-Z0-9-]{16,100})$/);
      if(projectPath && method==='POST') {check(actor.isAdmin,'Admin access required',403);return this.updateProject(projectPath[1],body,actor);}
      if(projectPath && method==='DELETE') {check(actor.isAdmin,'Admin access required',403);return this.deleteProject(projectPath[1],actor);}
      if(path==='/schedule' && method==='GET') {this.requireTask(actor,'schedule.view');const settings=this.scheduleSettings();return ok({ok:true,entries:this.scheduleEntries(),projects:this.ensureProjectRecords(),people:this.schedulePeople(settings),settings,viewer:actor.username});}
      if(path==='/schedule' && method==='POST') {this.requireTask(actor,'schedule.manage');return this.createScheduleEntry(body,actor);}
      if(path==='/schedule/settings' && method==='GET') {this.requireTask(actor,'schedule.manage');return ok({ok:true,settings:this.scheduleSettings(),people:this.scheduleAllPeople()});}
      if(path==='/schedule/settings' && method==='POST') {this.requireTask(actor,'schedule.manage');return this.updateScheduleSettings(body,actor);}
      const schedulePath=path.match(/^\/schedule\/([a-zA-Z0-9-]{16,100})$/);
      if(schedulePath && method==='POST') {this.requireTask(actor,'schedule.manage');return this.updateScheduleEntry(schedulePath[1],body,actor);}
      if(schedulePath && method==='DELETE') {this.requireTask(actor,'schedule.manage');return this.deleteScheduleEntry(schedulePath[1],actor);}
      if(path==='/site/cnc' && method==='GET') {this.requireTask(actor,'site.cnc.view');return ok({ok:true,cncPanels:this.read('app:cncPanels',[])});}
      const orderPath=path.match(/^\/orders\/([a-zA-Z0-9-]{16,100})$/);
      if(orderPath && method==='GET') {
        this.requireTask(actor,'site.orders.view');
        const order=this.read('orders',[]).find(value=>value.id===orderPath[1]);
        check(order,'Order request not found',404);return ok({ok:true,order});
      }
      if(orderPath && method==='POST') {
        this.requireTask(actor,'site.orders.manage');
        return this.updateOrder(orderPath[1],body,actor);
      }
      if(orderPath && method==='DELETE') {check(actor.isAdmin,'Admin access required',403);return this.deleteOrder(orderPath[1],actor);}
      const pdfLinkPath=path.match(/^\/orders\/([a-zA-Z0-9-]{16,100})\/pdf-link$/);
      if(pdfLinkPath && method==='POST') {
        this.requireTask(actor,'site.orders.view');
        check(this.read('orders',[]).some(value=>value.id===pdfLinkPath[1]),'Order request not found',404);
        const pdfToken=randomToken(),hash=await digest(pdfToken),expiresAt=Date.now()+2*60000;
        this.sql.exec('DELETE FROM order_pdf_tickets WHERE expires<=?',Date.now());
        this.sql.exec('INSERT INTO order_pdf_tickets(token,username,order_id,expires) VALUES(?,?,?,?)',hash,actor.username,pdfLinkPath[1],expiresAt);
        return ok({ok:true,pdfToken,expiresAt});
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
      if(path==='/admin/users') {const profiles=new Map(this.sql.exec('SELECT username,display_name AS displayName,title,location,active,role_id AS roleId FROM access_users').toArray().map(value=>[value.username,value]));return ok({ok:true,users:Object.keys(users).sort().map(username=>{const profile=profiles.get(username)||{};return {username,displayName:profile.displayName||users[username].displayName||username,title:profile.title||users[username].title||'',location:profile.location||users[username].location||'',active:profile.active===undefined?users[username].active!==false:!!profile.active,isAdmin:!!users[username].isAdmin,roleId:profile.roleId||null,taskAccess:this.taskAccess(username,!!users[username].isAdmin)};}),roles:this.roles(),tasks:this.sql.exec('SELECT code,label,app,default_worker AS defaultWorker FROM access_tasks ORDER BY app,label').toArray(),registrationCode:this.read('registration_code',this.env.DEFAULT_PIN||'')});}
      if(path==='/admin/roles') {
        const name=String(body.name||'').trim().replace(/\s+/g,' ').slice(0,80);check(name,'Role name is required');const id=crypto.randomUUID(),now=new Date().toISOString();check(!this.sql.exec('SELECT id FROM access_roles WHERE name=? COLLATE NOCASE',name).toArray()[0],'Role name is already in use',409);
        this.ctx.storage.transactionSync(()=>{this.sql.exec('INSERT INTO access_roles(id,name,created_at,updated_at) VALUES(?,?,?,?)',id,name,now,now);for(const task of TASKS)if(body.taskAccess?.[task[0]]===true)this.sql.exec('INSERT INTO role_task_access(role_id,task_code,allowed) VALUES(?,?,1)',id,task[0]);this.audit(actor.username,'admin/create-role',{id,name});});return ok({ok:true,role:this.roles().find(role=>role.id===id)},201);
      }
      const rolePath=path.match(/^\/admin\/roles\/([a-zA-Z0-9-]{16,100})$/);
      if(rolePath) {
        const id=rolePath[1],existing=this.sql.exec('SELECT id,name FROM access_roles WHERE id=?',id).toArray()[0];check(existing,'Role not found',404);
        if(body.delete===true){check(!this.sql.exec('SELECT username FROM access_users WHERE role_id=? LIMIT 1',id).toArray()[0],'Remove this role from all users before deleting it',409);this.ctx.storage.transactionSync(()=>{this.sql.exec('DELETE FROM role_task_access WHERE role_id=?',id);this.sql.exec('DELETE FROM access_roles WHERE id=?',id);this.audit(actor.username,'admin/delete-role',{id,name:existing.name});});return ok({ok:true});}
        const name=String(body.name||'').trim().replace(/\s+/g,' ').slice(0,80);check(name,'Role name is required');check(!this.sql.exec('SELECT id FROM access_roles WHERE name=? COLLATE NOCASE AND id<>?',name,id).toArray()[0],'Role name is already in use',409);
        this.ctx.storage.transactionSync(()=>{this.sql.exec('UPDATE access_roles SET name=?,updated_at=? WHERE id=?',name,new Date().toISOString(),id);this.sql.exec('DELETE FROM role_task_access WHERE role_id=?',id);for(const task of TASKS)if(body.taskAccess?.[task[0]]===true)this.sql.exec('INSERT INTO role_task_access(role_id,task_code,allowed) VALUES(?,?,1)',id,task[0]);this.sql.exec('DELETE FROM sessions WHERE username IN (SELECT username FROM access_users WHERE role_id=?)',id);this.audit(actor.username,'admin/update-role',{id,name});});return ok({ok:true,role:this.roles().find(role=>role.id===id)});
      }
      if(path==='/admin/create-user') {
        const target=normalizeUsername(body.targetUsername),displayName=String(body.displayName||'').trim().replace(/\s+/g,' ').slice(0,100),temporaryPin=String(body.temporaryPin||''),makeAdmin=body.makeAdmin===true,roleId=body.roleId||null;
        check(validUsername(target),'Username must contain 2–40 letters, numbers, dots, dashes or underscores');check(displayName,'Display name is required');check(/^\d{6,12}$/.test(temporaryPin),'Temporary PIN must contain 6–12 digits');check(!Object.hasOwn(users,target),'Username is already in use',409);
        if(roleId)check(this.sql.exec('SELECT id FROM access_roles WHERE id=?',roleId).toArray()[0],'Role not found',404);
        const password=await passwordRecord(temporaryPin),currentActor=await this.actor(token),current=this.read('users',{});check(currentActor.isAdmin,'Admin access required',403);check(!Object.hasOwn(current,target),'Username is already in use',409);
        current[target]={password,displayName,title:'',location:'',active:true,isAdmin:makeAdmin,mustChangePin:true,updatedAt:new Date().toISOString()};this.ctx.storage.transactionSync(()=>{this.write('users',current);this.syncAccessUser(target,current[target]);if(roleId)this.sql.exec('UPDATE access_users SET role_id=? WHERE username=?',roleId,target);this.audit(actor.username,'admin/create-user',{target,isAdmin:makeAdmin,roleId});});return ok({ok:true,user:{username:target,displayName,title:'',location:'',active:true,isAdmin:makeAdmin,roleId,taskAccess:this.taskAccess(target,makeAdmin)}},201);
      }
      if(path==='/admin/update-user') {
        const target=normalizeUsername(body.targetUsername),displayName=String(body.displayName||'').trim().replace(/\s+/g,' ').slice(0,100),title=String(body.title||'').trim().slice(0,100),location=String(body.location||'').trim().slice(0,160),active=body.active===true,isAdmin=body.isAdmin===true,roleId=body.roleId||null;check(Object.hasOwn(users,target),'User not found',404);check(displayName,'Display name is required');if(roleId)check(this.sql.exec('SELECT id FROM access_roles WHERE id=?',roleId).toArray()[0],'Role not found',404);check(active||target!==actor.username,'You cannot deactivate your own account');if(users[target].isAdmin&&(!isAdmin||!active))check(Object.values(users).filter(user=>user.isAdmin&&user.active!==false).length>1,'Cannot deactivate or demote the last active admin');
        const previous=users[target],previousRole=this.sql.exec('SELECT role_id AS roleId FROM access_users WHERE username=?',target).toArray()[0]?.roleId||null,revoke=previous.active!==active||!!previous.isAdmin!==isAdmin||previousRole!==roleId;users[target]={...previous,displayName,title,location,active,isAdmin,updatedAt:new Date().toISOString()};this.ctx.storage.transactionSync(()=>{this.write('users',users);this.sql.exec('UPDATE access_users SET display_name=?,title=?,location=?,active=?,is_admin=?,role_id=?,updated_at=? WHERE username=?',displayName,title,location,active?1:0,isAdmin?1:0,roleId,new Date().toISOString(),target);if(revoke)this.sql.exec('DELETE FROM sessions WHERE username=?',target);this.audit(actor.username,'admin/update-user',{target,active,isAdmin,roleId});});return ok({ok:true,user:{username:target,displayName,title,location,active,isAdmin,roleId,taskAccess:this.taskAccess(target,isAdmin)}});
      }
      if(path==='/admin/set-task-access') {
        const target=normalizeUsername(body.targetUsername);check(Object.hasOwn(users,target),'User not found',404);
        check(!this.sql.exec('SELECT role_id FROM access_users WHERE username=?',target).toArray()[0]?.role_id,'Task access is controlled by this user’s role');
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
    const records=this.ensureProjectRecords(),selected=records.find(value=>value.id===input.projectId)||records.find(value=>this.orderProjectKey(value.name)===this.orderProjectKey(input.project)),orders=this.read('orders',[]),project=(selected?.name||clean(input.project)).slice(0,120),key=this.orderProjectKey(project),sequences=this.read('order-project-sequences',{}),used=this.projectOrderMax(orders,key),configured=Number(sequences[key]?.nextNumber),sequence=Math.max(used+1,Number.isSafeInteger(configured)&&configured>0?configured:1),now=new Date().toISOString();
    const order={id:crypto.randomUUID(),orderNumber:String(sequence),projectId:selected?.id||null,project,dateOrdered:now,requestedDeliveryDate:clean(input.requestedDeliveryDate),requestedDeliveryTime:clean(input.requestedDeliveryTime).slice(0,20),scheduledDeliveryDate:'',scheduledDeliveryTime:'',siteContact:clean(input.siteContact).slice(0,100),phone:clean(input.phone).slice(0,40),orderType:clean(input.orderType||'Other').slice(0,80),locationNotes:clean(input.locationNotes).slice(0,300),items,status:'submitted',requestedBy:actor.username,createdAt:now,updatedAt:now};
    orders.unshift(order);
    sequences[key]={project:sequences[key]?.project||project,nextNumber:sequence+1};
    this.ctx.storage.transactionSync(()=>{this.write('orders',orders);this.write('order-project-sequences',sequences);this.sql.exec('INSERT INTO order_mutations(id,username,order_id) VALUES(?,?,?)',body.idempotencyKey,actor.username,order.id);this.audit(actor.username,'order-created',{orderId:order.id,orderNumber:order.orderNumber,project,itemCount:items.length});});
    return ok({ok:true,order},201);
  }
  orderProjectKey(project) {return String(project||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-AU');}
  ensureProjectRecords() {
    const records=this.read('projects',[]),byName=new Map(records.map(value=>[this.orderProjectKey(value.name),value])),now=new Date().toISOString(),legacy=[...this.read('order-projects',[]),...Object.values(this.read('order-project-sequences',{})).map(value=>value?.project),...this.read('orders',[]).map(value=>value.project)];let changed=false;
    for(const value of legacy){const name=String(value||'').trim().replace(/\s+/g,' '),key=this.orderProjectKey(name);if(key&&!byName.has(key)){const record={id:crypto.randomUUID(),name,address:'',notes:'',details:{},createdAt:now,updatedAt:now};records.push(record);byName.set(key,record);changed=true;}}
    if(changed)this.write('projects',records);
    return records.slice().sort((a,b)=>a.name.localeCompare(b.name));
  }
  orderProjects() {
    return this.ensureProjectRecords().map(value=>value.name);
  }
  addOrderProject(body,actor) {
    const name=String(body.name||body.project||'').trim().replace(/\s+/g,' ').slice(0,120),address=String(body.address||'').trim().slice(0,300),notes=String(body.notes||'').trim().slice(0,1000);check(name,'Project name is required');
    const records=this.ensureProjectRecords(),key=this.orderProjectKey(name);check(!records.some(value=>this.orderProjectKey(value.name)===key),'Project already exists',409);const now=new Date().toISOString(),project={id:crypto.randomUUID(),name,address,notes,details:{},createdAt:now,updatedAt:now};records.push(project);
    this.ctx.storage.transactionSync(()=>{this.write('projects',records);this.audit(actor.username,'project-added',{projectId:project.id,name});});
    return ok({ok:true,project,projects:this.ensureProjectRecords()},201);
  }
  updateProject(id,body,actor) {
    const records=this.ensureProjectRecords(),index=records.findIndex(value=>value.id===id);check(index>=0,'Project not found',404);const previous=records[index],name=String(body.name||'').trim().replace(/\s+/g,' ').slice(0,120),address=String(body.address||'').trim().slice(0,300),notes=String(body.notes||'').trim().slice(0,1000);check(name,'Project name is required');
    const oldKey=this.orderProjectKey(previous.name),newKey=this.orderProjectKey(name);check(!records.some((value,i)=>i!==index&&this.orderProjectKey(value.name)===newKey),'Project already exists',409);records[index]={...previous,name,address,notes,updatedAt:new Date().toISOString(),updatedBy:actor.username};
    const orders=this.read('orders',[]).map(order=>(order.projectId===id||this.orderProjectKey(order.project)===oldKey)?{...order,projectId:id,project:name,updatedAt:new Date().toISOString(),updatedBy:actor.username}:order),schedule=this.read('schedule',[]).map(entry=>(entry.projectId===id||this.orderProjectKey(entry.project)===oldKey)?{...entry,projectId:id,project:name,updatedAt:new Date().toISOString(),updatedBy:actor.username}:entry),sequences=this.read('order-project-sequences',{});
    if(oldKey!==newKey&&sequences[oldKey]){const moved=sequences[oldKey],existing=sequences[newKey];sequences[newKey]={project:name,nextNumber:Math.max(Number(moved.nextNumber)||1,Number(existing?.nextNumber)||1)};delete sequences[oldKey];}else if(sequences[newKey])sequences[newKey]={...sequences[newKey],project:name};
    this.ctx.storage.transactionSync(()=>{this.write('projects',records);this.write('orders',orders);this.write('schedule',schedule);this.write('order-project-sequences',sequences);this.audit(actor.username,'project-updated',{projectId:id,previousName:previous.name,name});});
    return ok({ok:true,project:records[index],projects:this.ensureProjectRecords()});
  }
  deleteProject(id,actor) {
    const records=this.ensureProjectRecords(),index=records.findIndex(value=>value.id===id);check(index>=0,'Project not found',404);const project=records[index],key=this.orderProjectKey(project.name);
    check(!this.read('orders',[]).some(order=>order.projectId===id||this.orderProjectKey(order.project)===key),'This project has orders and cannot be deleted. Keep it for order history.',409);check(!this.read('schedule',[]).some(entry=>entry.projectId===id||this.orderProjectKey(entry.project)===key),'This project has scheduled work and cannot be deleted.',409);
    records.splice(index,1);const legacy=this.read('order-projects',[]).filter(value=>this.orderProjectKey(value)!==key),sequences=this.read('order-project-sequences',{});delete sequences[key];
    this.ctx.storage.transactionSync(()=>{this.write('projects',records);this.write('order-projects',legacy);this.write('order-project-sequences',sequences);this.audit(actor.username,'project-deleted',{projectId:id,name:project.name});});
    return ok({ok:true,projects:this.ensureProjectRecords()});
  }
  scheduleEntries() {return this.read('schedule',[]).slice().sort((a,b)=>`${a.date} ${a.startTime||''} ${a.project} ${a.title}`.localeCompare(`${b.date} ${b.startTime||''} ${b.project} ${b.title}`));}
  scheduleAllPeople() {return this.sql.exec('SELECT username,display_name AS displayName FROM access_users WHERE active=1 ORDER BY display_name,username').toArray().map(value=>({username:value.username,displayName:value.displayName||value.username}));}
  scheduleSettings() {const saved=this.read('schedule-settings',{}),startHour=Number(saved.startHour),endHour=Number(saved.endHour),all=this.scheduleAllPeople(),valid=new Set(all.map(value=>value.username)),visible=Array.isArray(saved.visibleUsernames)?saved.visibleUsernames.filter(value=>valid.has(value)):all.map(value=>value.username);return {startHour:Number.isInteger(startHour)&&startHour>=0&&startHour<=22?startHour:6,endHour:Number.isInteger(endHour)&&endHour>=1&&endHour<=23?endHour:18,visibleUsernames:visible};}
  schedulePeople(settings=this.scheduleSettings()) {const visible=new Set(settings.visibleUsernames);return this.scheduleAllPeople().filter(value=>visible.has(value.username));}
  updateScheduleSettings(body,actor) {const startHour=Number(body.startHour),endHour=Number(body.endHour),people=this.scheduleAllPeople(),valid=new Set(people.map(value=>value.username)),visibleUsernames=Array.isArray(body.visibleUsernames)?[...new Set(body.visibleUsernames.map(normalizeUsername).filter(value=>valid.has(value)))]:[];check(Number.isInteger(startHour)&&startHour>=0&&startHour<=22,'Start of day must be a whole hour between 12 AM and 10 PM');check(Number.isInteger(endHour)&&endHour>=1&&endHour<=23,'End of day must be a whole hour between 1 AM and 11 PM');check(startHour<endHour,'End of day must be after start of day');const settings={startHour,endHour,visibleUsernames};this.ctx.storage.transactionSync(()=>{this.write('schedule-settings',settings);this.audit(actor.username,'schedule-settings',settings);});return ok({ok:true,settings,people:this.schedulePeople(settings)});}
  scheduleValue(input,existing={}) {
    const clean=value=>String(value??'').trim(),projects=this.ensureProjectRecords(),selected=projects.find(value=>value.id===input.projectId)||projects.find(value=>this.orderProjectKey(value.name)===this.orderProjectKey(input.project)),people=this.scheduleAllPeople(),assignedUsername=normalizeUsername(input.assignedUsername||existing.assignedUsername||''),person=people.find(value=>value.username===assignedUsername),date=clean(input.date),startTime=clean(input.startTime),endTime=clean(input.endTime),status=clean(existing.status||'planned');
    check(selected,'Select an active project');check(clean(input.title),'Activity is required');check(/^\d{4}-\d{2}-\d{2}$/.test(date),'Date is required');check(!startTime||/^\d{2}:\d{2}$/.test(startTime),'Invalid start time');check(!endTime||/^\d{2}:\d{2}$/.test(endTime),'Invalid end time');check(['planned','in-progress','completed','cancelled'].includes(status),'Invalid schedule status');
    check(person||(!assignedUsername&&clean(input.assignedTo||existing.assignedTo)),'Select a person');
    return {...existing,projectId:selected.id,project:selected.name,title:clean(input.title).slice(0,160),date,startTime,endTime,assignedUsername:person?.username||'',assignedTo:(person?.displayName||clean(input.assignedTo||existing.assignedTo)).slice(0,120),status,notes:clean(input.notes).slice(0,1000)};
  }
  createScheduleEntry(body,actor) {const now=new Date().toISOString(),entry={id:crypto.randomUUID(),...this.scheduleValue(body.entry||body),createdAt:now,createdBy:actor.username,updatedAt:now,updatedBy:actor.username},entries=this.read('schedule',[]);entries.push(entry);this.ctx.storage.transactionSync(()=>{this.write('schedule',entries);this.audit(actor.username,'schedule-created',{scheduleId:entry.id,project:entry.project,date:entry.date});});return ok({ok:true,entry,entries:this.scheduleEntries()},201);}
  updateScheduleEntry(id,body,actor) {const entries=this.read('schedule',[]),index=entries.findIndex(value=>value.id===id);check(index>=0,'Schedule entry not found',404);entries[index]={...this.scheduleValue(body.entry||body,entries[index]),updatedAt:new Date().toISOString(),updatedBy:actor.username};this.ctx.storage.transactionSync(()=>{this.write('schedule',entries);this.audit(actor.username,'schedule-updated',{scheduleId:id});});return ok({ok:true,entry:entries[index],entries:this.scheduleEntries()});}
  deleteScheduleEntry(id,actor) {const entries=this.read('schedule',[]),index=entries.findIndex(value=>value.id===id);check(index>=0,'Schedule entry not found',404);const [entry]=entries.splice(index,1);this.ctx.storage.transactionSync(()=>{this.write('schedule',entries);this.audit(actor.username,'schedule-deleted',{scheduleId:id,project:entry.project,date:entry.date});});return ok({ok:true,entries:this.scheduleEntries()});}
  projectOrderMax(orders,key) {return orders.reduce((max,order)=>this.orderProjectKey(order.project)===key&&/^\d+$/.test(String(order.orderNumber||''))?Math.max(max,Number(order.orderNumber)):max,0);}
  orderProjectSequences() {
    const orders=this.read('orders',[]),saved=this.read('order-project-sequences',{}),projects=new Map();
    for(const order of orders){const project=String(order.project||'').trim(),key=this.orderProjectKey(project);if(key&&!projects.has(key))projects.set(key,project);}
    for(const [key,value] of Object.entries(saved)){const project=String(value?.project||'').trim();if(key&&project)projects.set(key,project);}
    return [...projects.entries()].map(([key,project])=>{const used=this.projectOrderMax(orders,key),configured=Number(saved[key]?.nextNumber);return {project,nextNumber:Math.max(used+1,Number.isSafeInteger(configured)&&configured>0?configured:1),lastUsed:used};}).sort((a,b)=>a.project.localeCompare(b.project));
  }
  setOrderProjectSequence(body,actor) {
    const project=String(body.project||'').trim().replace(/\s+/g,' ').slice(0,120),nextNumber=Number(body.nextNumber),key=this.orderProjectKey(project),orders=this.read('orders',[]),lastUsed=this.projectOrderMax(orders,key);
    check(project,'Project is required');check(Number.isSafeInteger(nextNumber)&&nextNumber>=1&&nextNumber<=999999,'Next order number must be between 1 and 999999');check(nextNumber>lastUsed,`Next order number must be greater than the highest existing order (${lastUsed}) for this project`);
    const sequences=this.read('order-project-sequences',{});sequences[key]={project,nextNumber};
    this.ctx.storage.transactionSync(()=>{this.write('order-project-sequences',sequences);this.audit(actor.username,'order-sequence-set',{project,nextNumber,lastUsed});});
    return ok({ok:true,projectSequences:this.orderProjectSequences()});
  }
  deleteOrder(id,actor) {
    const orders=this.read('orders',[]),index=orders.findIndex(value=>value.id===id);check(index>=0,'Order request not found',404);
    const [order]=orders.splice(index,1);
    this.ctx.storage.transactionSync(()=>{this.write('orders',orders);this.sql.exec('DELETE FROM order_mutations WHERE order_id=?',id);this.sql.exec('DELETE FROM order_pdf_tickets WHERE order_id=?',id);this.audit(actor.username,'order-deleted',{orderId:id,orderNumber:order.orderNumber,project:order.project});});
    return ok({ok:true});
  }
  updateOrderStatus(id,body,actor) {
    const allowed=['submitted','approved','ordered','completed','cancelled'];check(allowed.includes(body.status),'Invalid order status');
    const orders=this.read('orders',[]),index=orders.findIndex(value=>value.id===id);check(index>=0,'Order request not found',404);
    orders[index]={...orders[index],status:body.status,scheduledDeliveryDate:String(body.scheduledDeliveryDate||orders[index].scheduledDeliveryDate||'').slice(0,10),scheduledDeliveryTime:String(body.scheduledDeliveryTime||orders[index].scheduledDeliveryTime||'').slice(0,20),updatedAt:new Date().toISOString(),updatedBy:actor.username};
    this.ctx.storage.transactionSync(()=>{this.write('orders',orders);this.audit(actor.username,'order-status',{orderId:id,status:body.status});});
    return ok({ok:true,order:orders[index]});
  }
  updateOrder(id,body,actor) {
    const input=body.order||body,clean=value=>String(value??'').trim();
    const items=Array.isArray(input.items)?input.items.map(item=>({quantity:Number(item.quantity),description:clean(item.description)})).filter(item=>item.quantity>0&&item.description):[];
    const records=this.ensureProjectRecords(),selected=records.find(value=>value.id===input.projectId)||records.find(value=>this.orderProjectKey(value.name)===this.orderProjectKey(input.project)),project=(selected?.name||clean(input.project)).slice(0,120);
    check(project && clean(input.siteContact) && clean(input.phone),'Project, site contact and phone are required');
    check(/^\d{4}-\d{2}-\d{2}$/.test(clean(input.requestedDeliveryDate)),'Requested delivery date is required');
    check(items.length>0 && items.length<=300,'Add between 1 and 300 order items');
    check(items.every(item=>Number.isFinite(item.quantity)&&item.quantity>0&&item.quantity<=99999&&item.description.length<=180),'Invalid order item');
    const allowed=['submitted','approved','ordered','completed','cancelled'],status=clean(input.status||'submitted');
    check(allowed.includes(status),'Invalid order status');
    const orders=this.read('orders',[]),index=orders.findIndex(value=>value.id===id);check(index>=0,'Order request not found',404);
    orders[index]={...orders[index],projectId:selected?.id||orders[index].projectId||null,project,requestedDeliveryDate:clean(input.requestedDeliveryDate),requestedDeliveryTime:clean(input.requestedDeliveryTime).slice(0,20),scheduledDeliveryDate:clean(input.scheduledDeliveryDate).slice(0,10),scheduledDeliveryTime:clean(input.scheduledDeliveryTime).slice(0,20),siteContact:clean(input.siteContact).slice(0,100),phone:clean(input.phone).slice(0,40),orderType:clean(input.orderType||'Other').slice(0,80),locationNotes:clean(input.locationNotes).slice(0,300),items,status,updatedAt:new Date().toISOString(),updatedBy:actor.username};
    this.ctx.storage.transactionSync(()=>{this.write('orders',orders);this.audit(actor.username,'order-updated',{orderId:id,orderNumber:orders[index].orderNumber,status,itemCount:items.length});});
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
