import { DurableObject } from 'cloudflare:workers';
import {digest,equal,randomToken,passwordRecord,verifyPin,normalizeUsername,validUsername,HttpError,requireCondition as check} from './security.js';
import {FIELDS,validateChanges,normalizeChanges,validateConfig} from './inventory.js';

const HOUR=3600000;
const TASKS=[
  ['factory.stock','View stock','factory',1],
  ['factory.receive','Receive stock','factory',1],
  ['factory.dispatch','Dispatch stock','factory',1],
  ['factory.transfer','Convert sheet sizes','web',1],
  ['factory.damage','Record damage','factory',1],
  ['factory.cnc','Use CNC tracker','factory',1],
  ['factory.jobs','Jobs','factory',1],
  ['factory.settings','Manage factory settings','factory',0],
  ['schedule.view','View schedule','factory',1],
  ['schedule.manage','Manage schedule','web',0],
  ['schedule.cnc.view','View CNC schedule','factory',1],
  ['schedule.cnc.manage','Manage CNC schedule','web',0],
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
const cleanText=(value,max=200)=>String(value||'').trim().slice(0,max);
const cleanDate=value=>{value=cleanText(value,10);check(!value||/^\d{4}-\d{2}-\d{2}$/.test(value),'Invalid date');return value;};
function normalizeEmployeeProfile(value={}) {
  const employmentTypes=['','employee','subcontractor','labour_hire','visitor'];
  const employmentType=cleanText(value.employmentType,30);check(employmentTypes.includes(employmentType),'Invalid employment type');
  const workLocations=Array.isArray(value.workLocations)?[...new Set(value.workLocations.map(item=>cleanText(item,100)).filter(Boolean))].slice(0,20):[];
  const emergency=value.emergencyContact||{};
  const rows=(items,kind)=>{check(!items||Array.isArray(items),`Invalid ${kind}`);return (items||[]).slice(0,50).map(item=>{check(item&&typeof item==='object',`Invalid ${kind}`);return {id:cleanText(item.id,100)||crypto.randomUUID(),type:cleanText(item.type||item.site,120),number:cleanText(item.number,100),status:cleanText(item.status,30),expiryDate:cleanDate(item.expiryDate),notes:cleanText(item.notes,500)};});};
  const profilePhoto=String(value.profilePhoto||'');check(!profilePhoto||(/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(profilePhoto)&&profilePhoto.length<=1500000),'Profile photo must be a JPEG, PNG or WebP under 1 MB');
  return {employeeNumber:cleanText(value.employeeNumber,50),employmentType,department:cleanText(value.department,100),supervisorUsername:normalizeUsername(value.supervisorUsername),workLocations,startDate:cleanDate(value.startDate),finishDate:cleanDate(value.finishDate),emergencyContact:{name:cleanText(emergency.name,120),relationship:cleanText(emergency.relationship,80),phone:cleanText(emergency.phone,40)},licenses:rows(value.licenses,'licences').map(({status,...row})=>row),inductions:rows(value.inductions,'inductions').map(row=>({...row,number:''})),profilePhoto,notes:cleanText(value.notes,5000)};
}

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
    if(!accessColumns.has('last_login_at'))this.sql.exec("ALTER TABLE access_users ADD COLUMN last_login_at TEXT DEFAULT NULL");
    if(!accessColumns.has('last_activity_at'))this.sql.exec("ALTER TABLE access_users ADD COLUMN last_activity_at TEXT DEFAULT NULL");
    if(!accessColumns.has('last_pin_change_at'))this.sql.exec("ALTER TABLE access_users ADD COLUMN last_pin_change_at TEXT DEFAULT NULL");
    if(!accessColumns.has('failed_login_attempts'))this.sql.exec("ALTER TABLE access_users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0");
    if(!accessColumns.has('locked_until'))this.sql.exec("ALTER TABLE access_users ADD COLUMN locked_until INTEGER DEFAULT NULL");
    this.sql.exec('CREATE TABLE IF NOT EXISTS access_tasks (code TEXT PRIMARY KEY, label TEXT NOT NULL, app TEXT NOT NULL, default_worker INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS user_task_access (username TEXT NOT NULL, task_code TEXT NOT NULL, allowed INTEGER NOT NULL, assigned_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(username,task_code), FOREIGN KEY(username) REFERENCES access_users(username) ON DELETE CASCADE, FOREIGN KEY(task_code) REFERENCES access_tasks(code) ON DELETE CASCADE)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS access_roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS role_task_access (role_id TEXT NOT NULL, task_code TEXT NOT NULL, allowed INTEGER NOT NULL, PRIMARY KEY(role_id,task_code), FOREIGN KEY(role_id) REFERENCES access_roles(id) ON DELETE CASCADE, FOREIGN KEY(task_code) REFERENCES access_tasks(code) ON DELETE CASCADE)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS user_roles (username TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY(username,role_id), FOREIGN KEY(username) REFERENCES access_users(username) ON DELETE CASCADE, FOREIGN KEY(role_id) REFERENCES access_roles(id) ON DELETE CASCADE)');
    this.sql.exec('INSERT OR IGNORE INTO user_roles(username,role_id) SELECT username,role_id FROM access_users WHERE role_id IS NOT NULL');
    this.sql.exec('CREATE TABLE IF NOT EXISTS username_aliases (alias TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS employee_profiles (username TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)');
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
    const roleIds=this.userRoleIds(username);
    if(roleIds.length){const allowed=new Set(this.sql.exec('SELECT DISTINCT rta.task_code FROM role_task_access rta JOIN user_roles ur ON ur.role_id=rta.role_id WHERE ur.username=? AND rta.allowed=1',username).toArray().map(row=>row.task_code));return Object.fromEntries(this.sql.exec('SELECT code FROM access_tasks ORDER BY code').toArray().map(task=>[task.code,allowed.has(task.code)]));}
    const overrides=new Map(this.sql.exec('SELECT task_code,allowed FROM user_task_access WHERE username=?',username).toArray().map(row=>[row.task_code,!!row.allowed]));
    return Object.fromEntries(this.sql.exec('SELECT code,default_worker FROM access_tasks ORDER BY code').toArray().map(task=>[task.code,overrides.has(task.code)?overrides.get(task.code):!!task.default_worker]));
  }
  userRoleIds(username){return this.sql.exec('SELECT role_id AS roleId FROM user_roles WHERE username=? ORDER BY role_id',username).toArray().map(row=>row.roleId);}
  employeeProfile(username){const row=this.sql.exec('SELECT data FROM employee_profiles WHERE username=?',username).toArray()[0];if(!row)return normalizeEmployeeProfile({});try{return normalizeEmployeeProfile(JSON.parse(row.data));}catch{return normalizeEmployeeProfile({});}}
  writeEmployeeProfile(username,profile){this.sql.exec('INSERT INTO employee_profiles(username,data,updated_at) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at',username,JSON.stringify(profile),new Date().toISOString());}
  replaceSupervisor(from,to=''){for(const {username} of this.sql.exec('SELECT username FROM employee_profiles').toArray()){const profile=this.employeeProfile(username);if(profile.supervisorUsername===from)this.writeEmployeeProfile(username,{...profile,supervisorUsername:to});}}
  roles(){return this.sql.exec('SELECT id,name FROM access_roles ORDER BY name').toArray().map(role=>({...role,taskAccess:Object.fromEntries(this.sql.exec('SELECT code FROM access_tasks ORDER BY code').toArray().map(task=>[task.code,!!this.sql.exec('SELECT allowed FROM role_task_access WHERE role_id=? AND task_code=?',role.id,task.code).toArray()[0]?.allowed]))}));}
  requireTask(actor,task) {check(actor.isAdmin || actor.tasks?.[task], 'You do not have access to this task',403);}
  requireMutationTasks(actor,changes) {
    if(actor.isAdmin)return;
    check(Array.isArray(changes),'Invalid change batch');
    const required=new Set();
    const cncCompletion=changes.some(change=>change?.field==='cncPanels'&&change.before?.status==='pending'&&change.after?.status==='completed');
    const linkedCncDispatch=changes.some(change=>change?.field==='transactions'&&change.before===null&&change.after?.type==='dispatch'&&change.after?.source==='cnc');
    if(linkedCncDispatch&&!actor.tasks?.['factory.dispatch']) {
      const completed=changes.filter(change=>change?.field==='cncPanels'&&change.before?.status==='pending'&&change.after?.status==='completed');
      const dispatches=changes.filter(change=>change?.field==='transactions'&&change.before===null&&change.after?.type==='dispatch'&&change.after?.source==='cnc');
      const first=completed[0]?.before,dispatch=dispatches[0]?.after;
      check(completed.length>0&&dispatches.length===1&&dispatch.qty===1&&['variant','offcut'].includes(dispatch.itemType)&&first?.stockSku===dispatch.sku&&(first.stockItemType||'variant')===dispatch.itemType&&completed.every(change=>change.before.orderNumber===first.orderNumber&&change.before.sheetNumber===first.sheetNumber&&change.before.stockSku===first.stockSku&&(change.before.stockItemType||'variant')===(first.stockItemType||'variant')),'CNC stock dispatch must match the completed sheet',403);
    }
    for(const change of changes) {
      if(change?.field==='cncPanels')required.add('factory.cnc');
      if(change?.field!=='transactions'||change.before!==null||!change.after)continue;
      const task={receipt:'factory.receive',dispatch:'factory.dispatch',damage:'factory.damage',offcut_add:'factory.stock',transfer:'factory.transfer',cnc:'factory.cnc'}[change.after.type];
      if(task&&!(task==='factory.dispatch'&&cncCompletion&&linkedCncDispatch))required.add(task);
    }
    check(required.size>0,'This change is not available to your account',403);
    for(const task of required)this.requireTask(actor,task);
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
    check(s && s.expires>Date.now() && user && user.active!==false && !user.mustChangePin,'Session expired. Please log in again.',401);
    const activity=this.sql.exec('SELECT last_activity_at AS lastActivityAt FROM access_users WHERE username=?',s.username).toArray()[0]?.lastActivityAt;
    if(!activity||Date.now()-Date.parse(activity)>5*60000)this.sql.exec('UPDATE access_users SET last_activity_at=? WHERE username=?',new Date().toISOString(),s.username);
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
    const entered=normalizeUsername(body.username);
    check(validUsername(entered),'Invalid username');
    this.sql.exec('DELETE FROM username_aliases WHERE expires<=?',Date.now());
    const uname=this.sql.exec('SELECT username FROM username_aliases WHERE alias=? AND expires>?',entered,Date.now()).toArray()[0]?.username||entered;
    this.consumeLimit('ip:'+ip,50);this.consumeLimit('user:'+uname,15);
    const original=this.read('users',{});
    const user=Object.hasOwn(original,uname)?original[uname]:null;
    if(path==='/login') {
      const access=user&&this.sql.exec('SELECT failed_login_attempts AS failedLoginAttempts,locked_until AS lockedUntil FROM access_users WHERE username=?',uname).toArray()[0];
      check(!access?.lockedUntil||access.lockedUntil<=Date.now(),'This account is temporarily locked. Try again later.',429);
      const valid=user&&user.active!==false&&await verifyPin(body.pin,user.legacyUsername||uname,user,this.env.PIN_SALT);
      if(!valid){if(access){const failures=(access.failedLoginAttempts||0)+1,lockedUntil=failures>=5?Date.now()+15*60000:null;this.sql.exec('UPDATE access_users SET failed_login_attempts=?,locked_until=? WHERE username=?',failures,lockedUntil,uname);}check(false,'Invalid username or PIN',401);}
      // Password hashing yields; reject if another request changed/deleted this user meanwhile.
      check(JSON.stringify(this.read('users',{})[uname])===JSON.stringify(user),'Account changed; please retry',409);
      if(user.mustChangePin) return ok({ok:true,isNewUser:false,mustChangePin:true});
      const session=await this.issueSession(uname);
      check(JSON.stringify(this.read('users',{})[uname])===JSON.stringify(user),'Account changed; please retry',409);
      this.syncAccessUser(uname,user);this.sql.exec('UPDATE access_users SET failed_login_attempts=0,locked_until=NULL,last_login_at=?,last_activity_at=? WHERE username=?',new Date().toISOString(),new Date().toISOString(),uname);
      return ok({ok:true,isNewUser:false,mustChangePin:false,isAdmin:!!user.isAdmin,taskAccess:this.taskAccess(uname,!!user.isAdmin),username:uname,...session});
    }
    check(user,'Account must be created by an administrator',401);
    check(typeof body.newPin==='string' && /^\d{6,12}$/.test(body.newPin),'New PIN must contain 6–12 digits');
    check(await verifyPin(body.oldPin,user.legacyUsername||uname,user,this.env.PIN_SALT),'Invalid current PIN',401);
    const password=await passwordRecord(body.newPin);
    const latest=this.read('users',{});
    check(JSON.stringify(latest[uname]||null)===JSON.stringify(user),'Account changed; please retry',409);
    latest[uname]={...user,password,isAdmin:!!user.isAdmin,mustChangePin:false,updatedAt:new Date().toISOString()};delete latest[uname].pinHash;delete latest[uname].legacyUsername;
    this.ctx.storage.transactionSync(()=>{
      this.write('users',latest);this.sql.exec('DELETE FROM sessions WHERE username=?',uname);this.sql.exec('UPDATE access_users SET last_pin_change_at=? WHERE username=?',new Date().toISOString(),uname);this.audit(uname,'set-pin');
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
      const cncCompletion=body.changes.some(change=>change?.field==='cncPanels'&&change.before?.status==='pending'&&change.after?.status==='completed');
      const linkedCncDispatch=body.changes.some(change=>change?.field==='transactions'&&change.before===null&&change.after?.type==='dispatch'&&change.after?.source==='cnc');
      const deltas=new Map();
      for(const c of body.changes.filter(c=>['variants','offcuts'].includes(c.field))) {
        const key=c.field+':'+(c.after?.sku||c.before?.sku);
        deltas.set(key,(deltas.get(key)||0)+(c.after?.qty||0)-(c.before?.qty||0));
      }
      for(const c of body.changes.filter(c=>c.field==='transactions' && !c.before)) {
        const t=c.after;
        if(t.type==='cnc') {
          check(cncCompletion&&linkedCncDispatch,'CNC activity must accompany a completed sheet',403);
          continue;
        }
        if(t.type==='transfer') {
          const movements=body.changes.filter(change=>change?.field==='variants'&&change.after&&(change.before?.qty||0)!==change.after.qty);
          const source=movements.find(change=>change.before?.sku===t.sourceSku&&change.after.qty-change.before.qty===-t.qty);
          const outputs=movements.filter(change=>change!==source&&change.after.qty>(change.before?.qty||0));
          check(source&&movements.length===outputs.length+1&&Array.isArray(t.outputs)&&t.outputs.length===outputs.length&&body.changes.filter(change=>change?.field==='transactions'&&change.before===null).length===1,'Invalid stock transfer',403);
          check(outputs.every(change=>change.after.color===source.before.color&&change.after.material===source.before.material&&change.after.thickness===source.before.thickness),'Transferred sheets must use the same material, colour and thickness',403);
          check(outputs.every(change=>t.outputs.some(output=>output.sku===change.after.sku&&output.qty===change.after.qty-(change.before?.qty||0))),'Stock transfer outputs do not match',403);
          const sourceLength=Math.max(source.before.width,source.before.height),sourceWidth=Math.min(source.before.width,source.before.height);
          check(outputs.every(change=>Math.max(change.after.width,change.after.height)<=sourceLength&&Math.min(change.after.width,change.after.height)<=sourceWidth&&(Math.max(change.after.width,change.after.height)<sourceLength||Math.min(change.after.width,change.after.height)<sourceWidth)),'Transferred sheets must be smaller than the source sheet',403);
          const sourceArea=source.before.width*source.before.height*t.qty,outputArea=outputs.reduce((sum,change)=>sum+(change.after.width*change.after.height*(change.after.qty-(change.before?.qty||0))),0);
          check(outputArea<=sourceArea,'Transferred sheet area exceeds the source sheets',403);
          for(const change of movements)deltas.set('variants:'+(change.after?.sku||change.before?.sku),0);
          continue;
        }
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
      if(c.field==='variants' && c.after && (!c.before || c.after.catalogId!==c.before.catalogId))check(currentMap('catalog').has(c.after.catalogId),'Unknown catalogue item');
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
        const profile=this.sql.exec('SELECT username,display_name AS displayName,email,active,created_at AS createdAt,updated_at AS updatedAt FROM access_users WHERE username=?',actor.username).toArray()[0];
        return ok({ok:true,profile:{...profile,profilePhoto:this.employeeProfile(actor.username).profilePhoto}});
      }
      if(path==='/profile' && method==='POST') {
        const displayName=String(body.displayName||'').trim(),email=String(body.email||'').trim().toLowerCase();
        check(displayName.length>=1&&displayName.length<=100,'Display name must be 1–100 characters');
        check(email.length<=160&&(!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),'Invalid email address');
        const employee=this.employeeProfile(actor.username);
        const nextEmployee=Object.hasOwn(body,'profilePhoto')?normalizeEmployeeProfile({...employee,profilePhoto:body.profilePhoto}):employee;
        this.ctx.storage.transactionSync(()=>{this.sql.exec('UPDATE access_users SET display_name=?,email=?,updated_at=? WHERE username=?',displayName,email,new Date().toISOString(),actor.username);if(Object.hasOwn(body,'profilePhoto'))this.writeEmployeeProfile(actor.username,nextEmployee);this.audit(actor.username,'profile-updated',{photoChanged:Object.hasOwn(body,'profilePhoto')});});
        const profile=this.sql.exec('SELECT username,display_name AS displayName,email,active,created_at AS createdAt,updated_at AS updatedAt FROM access_users WHERE username=?',actor.username).toArray()[0];
        return ok({ok:true,profile:{...profile,profilePhoto:nextEmployee.profilePhoto}});
      }
      if(path==='/data' && method==='GET') {check(actor.isAdmin||['factory.stock','factory.receive','factory.dispatch','factory.transfer','factory.damage','factory.cnc','factory.jobs','factory.settings'].some(task=>actor.tasks?.[task]),'You do not have access to this task',403);return ok(this.snapshot());}
      if(path==='/mutations' && method==='POST') {this.requireMutationTasks(actor,body.changes);return this.mutate(body,actor);}
      if(path==='/orders' && method==='GET') {this.requireTask(actor,'site.orders.view');const projectRecords=this.ensureProjectRecords(),activeProjects=projectRecords.filter(value=>value.active!==false);return ok({ok:true,orders:this.read('orders',[]),projects:activeProjects.map(value=>value.name),projectRecords,projectSequences:this.orderProjectSequences()});}
      if(path==='/orders' && method==='POST') {this.requireTask(actor,'site.orders.create');return this.createOrder(body,actor);}
      if(path==='/order-sequences' && method==='POST') {this.requireTask(actor,'site.orders.manage');return this.setOrderProjectSequence(body,actor);}
      if(path==='/projects' && method==='GET') return ok({ok:true,projects:this.ensureProjectRecords()});
      if(['/projects','/order-projects'].includes(path) && method==='POST') {check(actor.isAdmin,'Admin access required',403);return this.addOrderProject(body,actor);}
      const projectPath=path.match(/^\/projects\/([a-zA-Z0-9-]{16,100})$/);
      if(projectPath && method==='POST') {check(actor.isAdmin,'Admin access required',403);return this.updateProject(projectPath[1],body,actor);}
      if(projectPath && method==='DELETE') {check(actor.isAdmin,'Admin access required',403);return this.deleteProject(projectPath[1],actor);}
      if(path==='/schedule' && method==='GET') {check(actor.isAdmin||actor.tasks?.['schedule.view']||actor.tasks?.['schedule.cnc.view'],'You do not have access to this task',403);const settings=this.scheduleSettings();return ok({ok:true,entries:this.scheduleEntriesFor(actor),projects:this.scheduleProjects(),people:this.schedulePeople(settings),settings,viewer:actor.username});}
      if(path==='/schedule' && method==='POST') {const type=String((body.entry||body).scheduleType||'general');this.requireTask(actor,type==='cnc'?'schedule.cnc.manage':'schedule.manage');return this.createScheduleEntry(body,actor);}
      if(path==='/schedule/settings' && method==='GET') {this.requireTask(actor,'schedule.manage');return ok({ok:true,settings:this.scheduleSettings(),people:this.scheduleAllPeople()});}
      if(path==='/schedule/settings' && method==='POST') {this.requireTask(actor,'schedule.manage');return this.updateScheduleSettings(body,actor);}
      if(path==='/schedule/share' && method==='GET') {this.requireTask(actor,'schedule.manage');let shareToken=this.read('schedule-display-token','');if(!shareToken){shareToken=randomToken();this.ctx.storage.transactionSync(()=>{this.write('schedule-display-token',shareToken);this.audit(actor.username,'schedule-display-created');});}return ok({ok:true,token:shareToken,code:shareToken.slice(0,6).toUpperCase()});}
      const schedulePath=path.match(/^\/schedule\/([a-zA-Z0-9-]{16,100})$/);
      if(schedulePath && method==='POST') {const existing=this.scheduleEntries().find(entry=>entry.id===schedulePath[1]);check(existing,'Schedule entry not found',404);this.requireTask(actor,(existing.scheduleType||'general')==='cnc'?'schedule.cnc.manage':'schedule.manage');const nextType=String((body.entry||body).scheduleType||existing.scheduleType||'general');this.requireTask(actor,nextType==='cnc'?'schedule.cnc.manage':'schedule.manage');return this.updateScheduleEntry(schedulePath[1],body,actor);}
      if(schedulePath && method==='DELETE') {const existing=this.scheduleEntries().find(entry=>entry.id===schedulePath[1]);check(existing,'Schedule entry not found',404);this.requireTask(actor,(existing.scheduleType||'general')==='cnc'?'schedule.cnc.manage':'schedule.manage');return this.deleteScheduleEntry(schedulePath[1],actor);}
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
      if(path==='/admin/users') {const profiles=new Map(this.sql.exec('SELECT username,display_name AS displayName,title,location,email,phone,active,created_at AS createdAt,updated_at AS updatedAt,last_login_at AS lastLoginAt,last_activity_at AS lastActivityAt,last_pin_change_at AS lastPinChangeAt,failed_login_attempts AS failedLoginAttempts,locked_until AS lockedUntil FROM access_users').toArray().map(value=>[value.username,value]));return ok({ok:true,users:Object.keys(users).sort().map(username=>{const profile=profiles.get(username)||{},roleIds=this.userRoleIds(username);return {username,displayName:profile.displayName||users[username].displayName||username,title:profile.title||users[username].title||'',location:profile.location||users[username].location||'',email:profile.email||users[username].email||'',phone:profile.phone||users[username].phone||'',active:profile.active===undefined?users[username].active!==false:!!profile.active,isAdmin:!!users[username].isAdmin,mustChangePin:!!users[username].mustChangePin,employeeProfile:this.employeeProfile(username),createdAt:profile.createdAt||null,updatedAt:profile.updatedAt||users[username].updatedAt||null,lastLoginAt:profile.lastLoginAt||null,lastActivityAt:profile.lastActivityAt||null,lastPinChangeAt:profile.lastPinChangeAt||null,failedLoginAttempts:profile.failedLoginAttempts||0,lockedUntil:profile.lockedUntil||null,roleIds,roleId:roleIds[0]||null,taskAccess:this.taskAccess(username,!!users[username].isAdmin)};}),roles:this.roles(),tasks:this.sql.exec('SELECT code,label,app,default_worker AS defaultWorker FROM access_tasks ORDER BY app,label').toArray(),registrationCode:this.read('registration_code',this.env.DEFAULT_PIN||'')});}
      if(path==='/admin/roles') {
        const name=String(body.name||'').trim().replace(/\s+/g,' ').slice(0,80);check(name,'Role name is required');const id=crypto.randomUUID(),now=new Date().toISOString();check(!this.sql.exec('SELECT id FROM access_roles WHERE name=? COLLATE NOCASE',name).toArray()[0],'Role name is already in use',409);
        this.ctx.storage.transactionSync(()=>{this.sql.exec('INSERT INTO access_roles(id,name,created_at,updated_at) VALUES(?,?,?,?)',id,name,now,now);for(const task of TASKS)if(body.taskAccess?.[task[0]]===true)this.sql.exec('INSERT INTO role_task_access(role_id,task_code,allowed) VALUES(?,?,1)',id,task[0]);this.audit(actor.username,'admin/create-role',{id,name});});return ok({ok:true,role:this.roles().find(role=>role.id===id)},201);
      }
      const rolePath=path.match(/^\/admin\/roles\/([a-zA-Z0-9-]{16,100})$/);
      if(rolePath) {
        const id=rolePath[1],existing=this.sql.exec('SELECT id,name FROM access_roles WHERE id=?',id).toArray()[0];check(existing,'Role not found',404);
        if(body.delete===true){check(!this.sql.exec('SELECT username FROM user_roles WHERE role_id=? LIMIT 1',id).toArray()[0],'Remove this role from all users before deleting it',409);this.ctx.storage.transactionSync(()=>{this.sql.exec('DELETE FROM role_task_access WHERE role_id=?',id);this.sql.exec('DELETE FROM access_roles WHERE id=?',id);this.audit(actor.username,'admin/delete-role',{id,name:existing.name});});return ok({ok:true});}
        const name=String(body.name||'').trim().replace(/\s+/g,' ').slice(0,80);check(name,'Role name is required');check(!this.sql.exec('SELECT id FROM access_roles WHERE name=? COLLATE NOCASE AND id<>?',name,id).toArray()[0],'Role name is already in use',409);
        this.ctx.storage.transactionSync(()=>{this.sql.exec('UPDATE access_roles SET name=?,updated_at=? WHERE id=?',name,new Date().toISOString(),id);this.sql.exec('DELETE FROM role_task_access WHERE role_id=?',id);for(const task of TASKS)if(body.taskAccess?.[task[0]]===true)this.sql.exec('INSERT INTO role_task_access(role_id,task_code,allowed) VALUES(?,?,1)',id,task[0]);this.sql.exec('DELETE FROM sessions WHERE username IN (SELECT username FROM user_roles WHERE role_id=?)',id);this.audit(actor.username,'admin/update-role',{id,name});});return ok({ok:true,role:this.roles().find(role=>role.id===id)});
      }
      if(path==='/admin/create-user') {
        const target=normalizeUsername(body.targetUsername),displayName=String(body.displayName||'').trim().replace(/\s+/g,' ').slice(0,100),title=String(body.title||'').trim().slice(0,100),location=String(body.location||'').trim().slice(0,160),email=String(body.email||'').trim().toLowerCase(),phone=cleanText(body.phone,40),temporaryPin=String(body.temporaryPin||''),makeAdmin=body.makeAdmin===true,roleIds=[...new Set(Array.isArray(body.roleIds)?body.roleIds:(body.roleId?[body.roleId]:[]))].filter(Boolean),employee=normalizeEmployeeProfile(body.employeeProfile||{});
        check(validUsername(target),'Username must contain 2–40 letters, numbers, dots, dashes or underscores');check(displayName,'Display name is required');check(email.length<=160&&(!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),'Invalid email address');check(/^\d{6,12}$/.test(temporaryPin),'Temporary PIN must contain 6–12 digits');check(!Object.hasOwn(users,target),'Username is already in use',409);
        check(roleIds.length<=20&&roleIds.every(roleId=>this.sql.exec('SELECT id FROM access_roles WHERE id=?',roleId).toArray()[0]),'Role not found',404);check(!employee.supervisorUsername||employee.supervisorUsername!==target&&Object.hasOwn(users,employee.supervisorUsername),'Supervisor not found',404);
        const password=await passwordRecord(temporaryPin),currentActor=await this.actor(token),current=this.read('users',{});check(currentActor.isAdmin,'Admin access required',403);check(!Object.hasOwn(current,target),'Username is already in use',409);
        current[target]={password,displayName,title,location,email,phone,active:true,isAdmin:makeAdmin,mustChangePin:true,updatedAt:new Date().toISOString()};this.ctx.storage.transactionSync(()=>{this.write('users',current);this.syncAccessUser(target,current[target]);this.writeEmployeeProfile(target,employee);this.sql.exec('UPDATE access_users SET role_id=? WHERE username=?',roleIds[0]||null,target);for(const roleId of roleIds)this.sql.exec('INSERT INTO user_roles(username,role_id) VALUES(?,?)',target,roleId);this.audit(actor.username,'admin/create-user',{target,isAdmin:makeAdmin,roleIds});});return ok({ok:true,user:{username:target,displayName,title,location,email,phone,employeeProfile:employee,active:true,isAdmin:makeAdmin,mustChangePin:true,roleIds,roleId:roleIds[0]||null,taskAccess:this.taskAccess(target,makeAdmin)}},201);
      }
      if(path==='/admin/update-user') {
        const target=normalizeUsername(body.targetUsername),displayName=String(body.displayName||'').trim().replace(/\s+/g,' ').slice(0,100),title=String(body.title||'').trim().slice(0,100),location=String(body.location||'').trim().slice(0,160),email=String(body.email||'').trim().toLowerCase(),phone=Object.hasOwn(body,'phone')?cleanText(body.phone,40):cleanText(users[normalizeUsername(body.targetUsername)]?.phone,40),active=body.active===true,isAdmin=body.isAdmin===true,roleIds=[...new Set(Array.isArray(body.roleIds)?body.roleIds:(body.roleId?[body.roleId]:[]))].filter(Boolean),employee=Object.hasOwn(body,'employeeProfile')?normalizeEmployeeProfile(body.employeeProfile||{}):this.employeeProfile(target);check(Object.hasOwn(users,target),'User not found',404);check(displayName,'Display name is required');check(email.length<=160&&(!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),'Invalid email address');check(roleIds.length<=20&&roleIds.every(roleId=>this.sql.exec('SELECT id FROM access_roles WHERE id=?',roleId).toArray()[0]),'Role not found',404);check(!employee.supervisorUsername||employee.supervisorUsername!==target&&Object.hasOwn(users,employee.supervisorUsername),'Supervisor not found',404);check(active||target!==actor.username,'You cannot deactivate your own account');if(users[target].isAdmin&&(!isAdmin||!active))check(Object.values(users).filter(user=>user.isAdmin&&user.active!==false).length>1,'Cannot deactivate or demote the last active admin');
        const previous=users[target],previousRoles=this.userRoleIds(target),revoke=previous.active!==active||!!previous.isAdmin!==isAdmin||JSON.stringify(previousRoles)!==JSON.stringify([...roleIds].sort());users[target]={...previous,displayName,title,location,email,phone,active,isAdmin,updatedAt:new Date().toISOString()};this.ctx.storage.transactionSync(()=>{this.write('users',users);this.sql.exec('UPDATE access_users SET display_name=?,title=?,location=?,email=?,phone=?,active=?,is_admin=?,role_id=?,updated_at=? WHERE username=?',displayName,title,location,email,phone,active?1:0,isAdmin?1:0,roleIds[0]||null,new Date().toISOString(),target);this.writeEmployeeProfile(target,employee);this.sql.exec('DELETE FROM user_roles WHERE username=?',target);for(const roleId of roleIds)this.sql.exec('INSERT INTO user_roles(username,role_id) VALUES(?,?)',target,roleId);if(revoke)this.sql.exec('DELETE FROM sessions WHERE username=?',target);this.audit(actor.username,'admin/update-user',{target,active,isAdmin,roleIds});});return ok({ok:true,user:{...previous,username:target,displayName,title,location,email,phone,employeeProfile:employee,active,isAdmin,roleIds,roleId:roleIds[0]||null,taskAccess:this.taskAccess(target,isAdmin)}});
      }
      if(path==='/admin/rename-user') {
        const target=normalizeUsername(body.targetUsername),next=normalizeUsername(body.newUsername);
        check(body.confirmedSynced===true,'Confirm that this user has synced all pending work');
        check(Object.hasOwn(users,target),'User not found',404);check(validUsername(next),'Invalid new login name');check(target!==next,'This account already uses that login name');
        check(!Object.hasOwn(users,next)&&!this.sql.exec('SELECT alias FROM username_aliases WHERE alias=?',next).toArray()[0],'Login name is already in use',409);
        const current=users[target],renamed={...current,...(current.pinHash&&!current.password?{legacyUsername:current.legacyUsername||target}:{}),updatedAt:new Date().toISOString()},aliasExpiresAt=Date.now()+14*24*HOUR;
        const schedule=this.read('schedule',[]).map(entry=>entry.assignedUsername===target?{...entry,assignedUsername:next}:entry);
        const scheduleSettings=this.scheduleSettings();if(Array.isArray(scheduleSettings.visibleUsernames))scheduleSettings.visibleUsernames=scheduleSettings.visibleUsernames.map(username=>username===target?next:username);
        users[next]=renamed;delete users[target];
        this.ctx.storage.transactionSync(()=>{
          this.sql.exec('INSERT INTO access_users(username,display_name,email,phone,active,is_admin,created_at,updated_at,title,location,role_id) SELECT ?,display_name,email,phone,active,is_admin,created_at,?,title,location,role_id FROM access_users WHERE username=?',next,new Date().toISOString(),target);
          this.sql.exec('INSERT INTO user_task_access(username,task_code,allowed,assigned_by,updated_at) SELECT ?,task_code,allowed,assigned_by,updated_at FROM user_task_access WHERE username=?',next,target);
          this.sql.exec('INSERT INTO user_roles(username,role_id) SELECT ?,role_id FROM user_roles WHERE username=?',next,target);
          this.sql.exec('INSERT INTO employee_profiles(username,data,updated_at) SELECT ?,data,? FROM employee_profiles WHERE username=?',next,new Date().toISOString(),target);
          this.sql.exec('DELETE FROM employee_profiles WHERE username=?',target);
          this.replaceSupervisor(target,next);
          this.sql.exec('DELETE FROM user_roles WHERE username=?',target);
          this.sql.exec('DELETE FROM user_task_access WHERE username=?',target);this.sql.exec('DELETE FROM access_users WHERE username=?',target);
          this.sql.exec('INSERT INTO username_aliases(alias,username,expires) VALUES(?,?,?) ON CONFLICT(alias) DO UPDATE SET username=excluded.username,expires=excluded.expires',target,next,aliasExpiresAt);
          this.sql.exec('UPDATE username_aliases SET username=? WHERE username=?',next,target);
          this.sql.exec('DELETE FROM sessions WHERE username=?',target);this.write('users',users);this.write('schedule',schedule);this.write('schedule-settings',scheduleSettings);this.audit(actor.username,'admin/rename-user',{from:target,to:next});
        });
        const roleIds=this.userRoleIds(next);return ok({ok:true,user:{username:next,displayName:renamed.displayName||next,title:renamed.title||'',location:renamed.location||'',email:renamed.email||'',phone:renamed.phone||'',employeeProfile:this.employeeProfile(next),active:renamed.active!==false,isAdmin:!!renamed.isAdmin,roleIds,roleId:roleIds[0]||null,taskAccess:this.taskAccess(next,!!renamed.isAdmin)},aliasExpiresAt});
      }
      if(path==='/admin/set-task-access') {
        const target=normalizeUsername(body.targetUsername);check(Object.hasOwn(users,target),'User not found',404);
        check(this.userRoleIds(target).length===0,'Task access is controlled by this user’s roles');
        const taskCodes=Array.isArray(body.taskCodes)?[...new Set(body.taskCodes)]:[body.taskCode];check(taskCodes.length>0&&taskCodes.every(code=>TASKS.some(task=>task[0]===code)),'Unknown task');check(body.allowed===true||body.allowed===false||body.allowed===null,'Invalid task access');
        this.syncAccessUser(target,users[target]);
        this.ctx.storage.transactionSync(()=>{for(const taskCode of taskCodes){if(body.allowed===null)this.sql.exec('DELETE FROM user_task_access WHERE username=? AND task_code=?',target,taskCode);else this.sql.exec('INSERT INTO user_task_access(username,task_code,allowed,assigned_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(username,task_code) DO UPDATE SET allowed=excluded.allowed,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at',target,taskCode,body.allowed?1:0,actor.username,new Date().toISOString());}this.sql.exec('DELETE FROM sessions WHERE username=?',target);this.audit(actor.username,'task-access',{target,tasks:taskCodes,allowed:body.allowed});});
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
          const temporaryPin=String(body.temporaryPin||this.read('registration_code',this.env.DEFAULT_PIN||''));check(/^\d{6,12}$/.test(temporaryPin),'Temporary PIN must contain 6–12 digits');
          const password=await passwordRecord(temporaryPin);
          // Re-check actor and target after asynchronous hashing.
          const currentActor=await this.actor(token);check(currentActor.isAdmin,'Admin access required',403);
          const current=this.read('users',{});check(Object.hasOwn(current,target),'User not found',404);
          current[target]={...current[target],password,mustChangePin:true};delete current[target].pinHash;
          this.ctx.storage.transactionSync(()=>{this.write('users',current);this.sql.exec('DELETE FROM sessions WHERE username=?',target);this.audit(actor.username,path,{target});});
          return ok({ok:true});
        }
        if(path==='/admin/remove-user') {delete users[target];this.sql.exec('DELETE FROM user_task_access WHERE username=?',target);this.sql.exec('DELETE FROM user_roles WHERE username=?',target);this.sql.exec('DELETE FROM employee_profiles WHERE username=?',target);this.replaceSupervisor(target);this.sql.exec('DELETE FROM access_users WHERE username=?',target);} else {users[target].isAdmin=body.makeAdmin;this.syncAccessUser(target,users[target]);}
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
    const records=this.ensureProjectRecords(),selected=records.find(value=>value.id===input.projectId)||records.find(value=>this.orderProjectKey(value.name)===this.orderProjectKey(input.project));check(!selected||selected.active!==false,'Select an active project');const orders=this.read('orders',[]),project=(selected?.name||clean(input.project)).slice(0,120),key=this.orderProjectKey(project),sequences=this.read('order-project-sequences',{}),used=this.projectOrderMax(orders,key),configured=Number(sequences[key]?.nextNumber),sequence=Math.max(used+1,Number.isSafeInteger(configured)&&configured>0?configured:1),now=new Date().toISOString();
    const order={id:crypto.randomUUID(),orderNumber:String(sequence),projectId:selected?.id||null,project,dateOrdered:now,requestedDeliveryDate:clean(input.requestedDeliveryDate),requestedDeliveryTime:clean(input.requestedDeliveryTime).slice(0,20),scheduledDeliveryDate:'',scheduledDeliveryTime:'',siteContact:clean(input.siteContact).slice(0,100),phone:clean(input.phone).slice(0,40),orderType:clean(input.orderType||'Other').slice(0,80),locationNotes:clean(input.locationNotes).slice(0,300),items,status:'submitted',requestedBy:actor.username,createdAt:now,updatedAt:now};
    orders.unshift(order);
    sequences[key]={project:sequences[key]?.project||project,nextNumber:sequence+1};
    this.ctx.storage.transactionSync(()=>{this.write('orders',orders);this.write('order-project-sequences',sequences);this.sql.exec('INSERT INTO order_mutations(id,username,order_id) VALUES(?,?,?)',body.idempotencyKey,actor.username,order.id);this.audit(actor.username,'order-created',{orderId:order.id,orderNumber:order.orderNumber,project,itemCount:items.length});});
    return ok({ok:true,order},201);
  }
  orderProjectKey(project) {return String(project||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-AU');}
  ensureProjectRecords() {
    const records=this.read('projects',[]),byName=new Map(records.map(value=>[this.orderProjectKey(value.name),value])),now=new Date().toISOString(),legacy=[...this.read('order-projects',[]),...Object.values(this.read('order-project-sequences',{})).map(value=>value?.project),...this.read('orders',[]).map(value=>value.project)];let changed=false;
    for(const record of records){if(typeof record.active!=='boolean'){record.active=true;changed=true;}}
    for(const value of legacy){const name=String(value||'').trim().replace(/\s+/g,' '),key=this.orderProjectKey(name);if(key&&!byName.has(key)){const record={id:crypto.randomUUID(),name,address:'',notes:'',details:{},active:true,createdAt:now,updatedAt:now};records.push(record);byName.set(key,record);changed=true;}}
    if(changed)this.write('projects',records);
    return records.slice().sort((a,b)=>a.name.localeCompare(b.name));
  }
  orderProjects() {
    return this.ensureProjectRecords().filter(value=>value.active!==false).map(value=>value.name);
  }
  addOrderProject(body,actor) {
    const name=String(body.name||body.project||'').trim().replace(/\s+/g,' ').slice(0,120),address=String(body.address||'').trim().slice(0,300),notes=String(body.notes||'').trim().slice(0,1000);check(name,'Project name is required');
    const records=this.ensureProjectRecords(),key=this.orderProjectKey(name);check(!records.some(value=>this.orderProjectKey(value.name)===key),'Project already exists',409);const now=new Date().toISOString(),project={id:crypto.randomUUID(),name,address,notes,details:{},active:true,createdAt:now,updatedAt:now};records.push(project);
    this.ctx.storage.transactionSync(()=>{this.write('projects',records);this.audit(actor.username,'project-added',{projectId:project.id,name});});
    return ok({ok:true,project,projects:this.ensureProjectRecords()},201);
  }
  updateProject(id,body,actor) {
    const records=this.ensureProjectRecords(),index=records.findIndex(value=>value.id===id);check(index>=0,'Project not found',404);const previous=records[index],name=String(body.name||'').trim().replace(/\s+/g,' ').slice(0,120),address=String(body.address||'').trim().slice(0,300),notes=String(body.notes||'').trim().slice(0,1000),active=Object.hasOwn(body,'active')?body.active===true:previous.active!==false;check(name,'Project name is required');
    const oldKey=this.orderProjectKey(previous.name),newKey=this.orderProjectKey(name);check(!records.some((value,i)=>i!==index&&this.orderProjectKey(value.name)===newKey),'Project already exists',409);records[index]={...previous,name,address,notes,active,updatedAt:new Date().toISOString(),updatedBy:actor.username};
    const orders=this.read('orders',[]).map(order=>(order.projectId===id||this.orderProjectKey(order.project)===oldKey)?{...order,projectId:id,project:name,updatedAt:new Date().toISOString(),updatedBy:actor.username}:order),schedule=this.read('schedule',[]).map(entry=>(entry.projectId===id||this.orderProjectKey(entry.project)===oldKey)?{...entry,projectId:id,project:name,updatedAt:new Date().toISOString(),updatedBy:actor.username}:entry),sequences=this.read('order-project-sequences',{});
    if(oldKey!==newKey&&sequences[oldKey]){const moved=sequences[oldKey],existing=sequences[newKey];sequences[newKey]={project:name,nextNumber:Math.max(Number(moved.nextNumber)||1,Number(existing?.nextNumber)||1)};delete sequences[oldKey];}else if(sequences[newKey])sequences[newKey]={...sequences[newKey],project:name};
    this.ctx.storage.transactionSync(()=>{this.write('projects',records);this.write('orders',orders);this.write('schedule',schedule);this.write('order-project-sequences',sequences);this.audit(actor.username,'project-updated',{projectId:id,previousName:previous.name,name,active});});
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
  scheduleProjects() {return [{id:'schedule-factory-production',name:'Factory/Production',address:'',notes:'',active:true,scheduleOnly:true},...this.ensureProjectRecords().filter(value=>value.id!=='schedule-factory-production'&&value.active!==false)];}
  scheduleEntriesFor(actor){return this.scheduleEntries().filter(entry=>(entry.scheduleType||'general')==='cnc'?(actor.isAdmin||actor.tasks?.['schedule.cnc.view']):(actor.isAdmin||actor.tasks?.['schedule.view']));}
  scheduleAllPeople() {return this.sql.exec('SELECT username,display_name AS displayName FROM access_users WHERE active=1 ORDER BY display_name,username').toArray().map(value=>({username:value.username,displayName:value.displayName||value.username,profilePhoto:this.employeeProfile(value.username).profilePhoto||''}));}
  scheduleSettings() {const saved=this.read('schedule-settings',{}),startHour=Number(saved.startHour),endHour=Number(saved.endHour),all=this.scheduleAllPeople(),valid=new Set(all.map(value=>value.username)),visible=Array.isArray(saved.visibleUsernames)?saved.visibleUsernames.filter(value=>valid.has(value)):all.map(value=>value.username);return {startHour:Number.isInteger(startHour)&&startHour>=0&&startHour<=22?startHour:6,endHour:Number.isInteger(endHour)&&endHour>=1&&endHour<=23?endHour:18,visibleUsernames:visible};}
  schedulePeople(settings=this.scheduleSettings()) {const visible=new Set(settings.visibleUsernames);return this.scheduleAllPeople().filter(value=>visible.has(value.username));}
  updateScheduleSettings(body,actor) {const startHour=Number(body.startHour),endHour=Number(body.endHour),people=this.scheduleAllPeople(),valid=new Set(people.map(value=>value.username)),visibleUsernames=Array.isArray(body.visibleUsernames)?[...new Set(body.visibleUsernames.map(normalizeUsername).filter(value=>valid.has(value)))]:[];check(Number.isInteger(startHour)&&startHour>=0&&startHour<=22,'Start of day must be a whole hour between 12 AM and 10 PM');check(Number.isInteger(endHour)&&endHour>=1&&endHour<=23,'End of day must be a whole hour between 1 AM and 11 PM');check(startHour<endHour,'End of day must be after start of day');const settings={startHour,endHour,visibleUsernames};this.ctx.storage.transactionSync(()=>{this.write('schedule-settings',settings);this.audit(actor.username,'schedule-settings',settings);});return ok({ok:true,settings,people:this.schedulePeople(settings)});}
  scheduleValue(input,existing={}) {
    const clean=value=>String(value??'').trim(),projects=this.scheduleProjects(),selected=projects.find(value=>value.id===input.projectId)||projects.find(value=>this.orderProjectKey(value.name)===this.orderProjectKey(input.project)),people=this.scheduleAllPeople(),assignedUsername=normalizeUsername(input.assignedUsername||existing.assignedUsername||''),person=people.find(value=>value.username===assignedUsername),date=clean(input.date),startTime=clean(input.startTime),endTime=clean(input.endTime),status=clean(existing.status||'planned'),scheduleType=clean(input.scheduleType||existing.scheduleType||'general');
    check(selected,'Select an active project');check(clean(input.title),'Activity is required');check(/^\d{4}-\d{2}-\d{2}$/.test(date),'Date is required');check(!startTime||/^\d{2}:\d{2}$/.test(startTime),'Invalid start time');check(!endTime||/^\d{2}:\d{2}$/.test(endTime),'Invalid end time');check(['planned','in-progress','completed','cancelled'].includes(status),'Invalid schedule status');
    check(person||(!assignedUsername&&clean(input.assignedTo||existing.assignedTo)),'Select a person');check(['general','cnc','delivery'].includes(scheduleType),'Invalid schedule type');
    return {...existing,projectId:selected.id,project:selected.name,title:clean(input.title).slice(0,160),date,startTime,endTime,assignedUsername:person?.username||'',assignedTo:(person?.displayName||clean(input.assignedTo||existing.assignedTo)).slice(0,120),status,scheduleType,notes:clean(input.notes).slice(0,1000)};
  }
  createScheduleEntry(body,actor) {const now=new Date().toISOString(),entry={id:crypto.randomUUID(),...this.scheduleValue(body.entry||body),createdAt:now,createdBy:actor.username,updatedAt:now,updatedBy:actor.username},entries=this.read('schedule',[]);entries.push(entry);this.ctx.storage.transactionSync(()=>{this.write('schedule',entries);this.audit(actor.username,'schedule-created',{scheduleId:entry.id,project:entry.project,date:entry.date,type:entry.scheduleType});});return ok({ok:true,entry,entries:this.scheduleEntriesFor(actor)},201);}
  updateScheduleEntry(id,body,actor) {const entries=this.read('schedule',[]),index=entries.findIndex(value=>value.id===id);check(index>=0,'Schedule entry not found',404);entries[index]={...this.scheduleValue(body.entry||body,entries[index]),updatedAt:new Date().toISOString(),updatedBy:actor.username};this.ctx.storage.transactionSync(()=>{this.write('schedule',entries);this.audit(actor.username,'schedule-updated',{scheduleId:id});});return ok({ok:true,entry:entries[index],entries:this.scheduleEntriesFor(actor)});}
  deleteScheduleEntry(id,actor) {const entries=this.read('schedule',[]),index=entries.findIndex(value=>value.id===id);check(index>=0,'Schedule entry not found',404);const [entry]=entries.splice(index,1);this.ctx.storage.transactionSync(()=>{this.write('schedule',entries);this.audit(actor.username,'schedule-deleted',{scheduleId:id,project:entry.project,date:entry.date});});return ok({ok:true,entries:this.scheduleEntriesFor(actor)});}
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
  async readPublicSchedule(credential) {const expected=this.read('schedule-display-token',''),provided=String(credential||'').trim();if(!expected||(!equal(await digest(expected),await digest(provided))&&!equal(await digest(expected.slice(0,6)),await digest(provided.toLowerCase()))))return null;const settings=this.scheduleSettings(),visible=new Set(settings.visibleUsernames),people=this.schedulePeople(settings);return {entries:this.scheduleEntries().filter(entry=>visible.has(entry.assignedUsername)).map(({id,date,startTime,endTime,title,project,projectId,assignedUsername,assignedTo,scheduleType})=>({id,date,startTime,endTime,title,project,projectId,assignedUsername,assignedTo,scheduleType})),people,settings};}
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
