import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash} from 'node:crypto';
import {orderTemplateFixture} from './order-template-fixture.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const built=process.env.WORKER_BUNDLE||path.resolve(here,'../dist/index.js');
let mf,admin,staff;
const stock={id:'v1',sku:'SKU1',catalogId:'c1',color:'White',material:'Aluminium',thickness:3,width:1200,height:2400,qty:10};
const pinHash=(pin,user)=>createHash('sha256').update(`${pin}:${user}:panelstock`).digest('hex');
async function request(route,body,token,method=body===undefined?'GET':'POST') {
  const r=await mf.dispatchFetch('http://localhost'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test-worker',modules:true,script:fs.readFileSync(built,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'test',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:'http://localhost:8080'}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV');
 await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:pinHash('123456','admin')},staff:{isAdmin:false,pinHash:pinHash('654321','staff')}}));
 await kv.put('registration_code','987654');
 await kv.put('site-order-cover-template',await orderTemplateFixture());
 for(const [field,v]of Object.entries({variants:[stock],catalog:[{...stock,id:'c1'}],offcuts:[],transactions:[],reasons:[],photos:{},cncPanels:[{id:'cnc-completed',orderNumber:'001',jobReference:'Test job',sheetNumber:'1',panelNumber:'1',status:'completed',completedAt:'2026-09-01T00:00:00.000Z',completedBy:'admin'}]}))await kv.put('app:'+field,JSON.stringify(v));
 admin=(await request('/login',{username:'admin',pin:'123456'})).body.token;
 staff=(await request('/login',{username:'staff',pin:'654321'})).body.token;
 assert.ok(admin);assert.ok(staff);
});
after(async()=>{await mf?.dispose();});

test('staff may receive a new sheet size for an existing material but cannot create catalogue materials',async()=>{
 const cat={id:'staff-cat',sku:'STAFF-NEW',color:'Blue',material:'ACP',thickness:4,width:0,height:0};
 const variant={id:'staff-var',catalogId:'c1',sku:'STAFF-SIZE',color:'White',material:'Aluminium',thickness:3,width:1000,height:2000,qty:3};
 const tx={...variant,id:'staff-receipt',type:'receipt',desc:'New sheet size received',itemType:'variant',qty:3,timestamp:new Date().toISOString()};
 const changes=[{field:'variants',id:variant.id,before:null,after:variant},{field:'transactions',id:tx.id,before:null,after:tx}];
 const packet=items=>({mutationId:crypto.randomUUID(),restoreEpoch:0,changes:items});
 assert.equal((await request('/mutations',packet([{field:'catalog',id:cat.id,before:null,after:cat}]),staff)).status,403);
 assert.equal((await request('/mutations',packet([changes[0]]),staff)).status,403);
 assert.equal((await request('/mutations',packet(changes.map(c=>c.field==='variants'?{...c,after:{...variant,qty:4}}:c)),staff)).status,403);
 const body=packet(changes);
 assert.equal((await request('/mutations',body,staff)).status,200);
 assert.equal((await request('/mutations',body,staff)).body.duplicate,true);
 const data=(await request('/data',undefined,staff)).body;
 assert.equal(data.variants.find(v=>v.id===variant.id).qty,3);
 assert.equal(data.transactions.find(t=>t.id===tx.id).user,'staff');
 assert.equal((await request('/mutations',packet([{field:'variants',id:variant.id,before:variant,after:{...variant,width:1200}}]),staff)).status,403);
});
test('shared credentials and claimed usernames cannot authorize access',async()=>{
 assert.equal((await request('/data',undefined,'old-shared-secret')).status,401);
 assert.equal((await request('/admin/set-admin',{username:'admin',targetUsername:'staff',makeAdmin:true},staff)).status,403);
 assert.equal((await request('/admin/users',{username:'admin'},staff)).status,403);
 assert.equal((await request('/config',{},staff)).status,403);
});
test('sessions identify the actual user; public debug routes are gone',async()=>{
 const session=(await request('/session',undefined,staff)).body;
 assert.equal(session.username,'staff');assert.equal(session.taskAccess['factory.stock'],true);assert.equal(session.taskAccess['factory.settings'],false);
 assert.equal((await request('/debug-auth')).status,404);
 assert.equal((await request('/debug-schedule')).status,404);
 assert.equal((await request('/data',{variants:[]},admin)).status,426);
});
test('stock and activity are atomic, retry-safe and conflict checked',async()=>{
 const tx={id:'tx1',type:'dispatch',desc:'Test dispatch',qty:2,itemType:'variant',sku:'SKU1',timestamp:new Date().toISOString(),user:'forged'};
 const change={field:'variants',id:'v1',before:stock,after:{...stock,qty:8}};
 const packet={mutationId:'test-mutation-0001',restoreEpoch:0,changes:[change,{field:'transactions',id:'tx1',before:null,after:tx}]};
 const first=await request('/mutations',packet,staff);assert.equal(first.status,200,JSON.stringify(first));
 assert.equal((await request('/mutations',packet,staff)).body.duplicate,true);
 const stale=await request('/mutations',{...packet,mutationId:'test-mutation-0002'},staff);assert.equal(stale.status,409);
 const data=(await request('/data',undefined,admin)).body;
 assert.equal(data.variants[0].qty,8);assert.equal(data.transactions.filter(t=>t.id===tx.id).length,1);assert.equal(data.transactions[0].user,'staff');
});
test('invalid quantities, missing activity and history deletion are rejected',async()=>{
 const data=(await request('/data',undefined,admin)).body,v=data.variants[0],tx=data.transactions[0];
 for(const changes of [
  [{field:'variants',id:'v1',before:v,after:{...v,qty:-1}}],
  [{field:'variants',id:'v1',before:v,after:{...v,qty:7}}],
  [{field:'transactions',id:tx.id,before:tx,after:null}]
 ])assert.equal((await request('/mutations',{mutationId:crypto.randomUUID(),restoreEpoch:0,changes},admin)).status,400);
 assert.equal((await request('/data',undefined,admin)).body.variants[0].qty,8);
});
test('logout revokes a session',async()=>{
 const token=(await request('/login',{username:'staff',pin:'654321'})).body.token;
 assert.equal((await request('/logout',{},token)).status,200);
 assert.equal((await request('/data',undefined,token)).status,401);
});
test('admin can void a dispatch atomically and cannot rewrite its history',async()=>{
 const data=(await request('/data',undefined,admin)).body;
 const txn=data.transactions.find(t=>t.id==='tx1'),v=data.variants[0];
 const changes=[{field:'transactions',id:txn.id,before:txn,after:{...txn,voided:true,voidedBy:'forged',voidedAt:new Date().toISOString()}},{field:'variants',id:v.id,before:v,after:{...v,qty:v.qty+txn.qty}}];
 const result=await request('/mutations',{mutationId:crypto.randomUUID(),restoreEpoch:0,changes},admin);
 assert.equal(result.status,200,JSON.stringify(result));
 const next=(await request('/data',undefined,admin)).body;
 assert.equal(next.variants[0].qty,10);assert.equal(next.transactions[0].voidedBy,'admin');
});
test('only administrators create users and self-registration is disabled',async()=>{
 assert.equal((await request('/login',{username:'unknownuser',pin:'987654'})).status,401);
 assert.equal((await request('/set-pin',{username:'unknownuser',oldPin:'987654',newPin:'123456'})).status,401);
 assert.equal((await request('/admin/create-user',{targetUsername:'newuser',displayName:'New User',temporaryPin:'987654'},staff)).status,403);
 const employeeProfile={employeeNumber:'LF-104',employmentType:'employee',department:'Installation',supervisorUsername:'admin',workLocations:['Brisbane','Factory'],startDate:'2026-09-01',finishDate:'',emergencyContact:{name:'Jordan User',relationship:'Partner',phone:'0400 111 222'},licenses:[{type:'White Card',number:'WC-123',expiryDate:'2028-01-01',notes:'QLD'}],inductions:[{type:'Pinnacle Studios',status:'current',expiryDate:'2027-01-01',notes:''}],profilePhoto:'',notes:'Private employment note'};
 const created=await request('/admin/create-user',{targetUsername:'newuser',displayName:'New User',title:'Installer',location:'Brisbane',email:'new.user@example.com',phone:'0400 000 000',employeeProfile,temporaryPin:'987654'},admin);assert.equal(created.status,201);assert.equal(created.body.user.isAdmin,false);assert.equal(created.body.user.title,'Installer');assert.equal(created.body.user.location,'Brisbane');assert.equal(created.body.user.email,'new.user@example.com');assert.equal(created.body.user.phone,'0400 000 000');assert.equal(created.body.user.employeeProfile.employeeNumber,'LF-104');
 const result=await request('/set-pin',{username:'newuser',oldPin:'987654',newPin:'123456'});
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.isAdmin,false);
 assert.equal((await request('/admin/users',{},result.body.token)).status,403);
 const deactivated=await request('/admin/update-user',{targetUsername:'newuser',displayName:'New User',title:'Installer',location:'Brisbane',active:false,isAdmin:false},admin);assert.equal(deactivated.status,200);assert.equal(deactivated.body.user.active,false);assert.equal(deactivated.body.user.title,'Installer');assert.equal(deactivated.body.user.phone,'0400 000 000');assert.equal(deactivated.body.user.employeeProfile.notes,'Private employment note');
 assert.equal((await request('/session',undefined,result.body.token)).status,401);assert.equal((await request('/login',{username:'newuser',pin:'123456'})).status,401);
 const activated=await request('/admin/update-user',{targetUsername:'newuser',displayName:'New User',title:'Installer',location:'Brisbane',email:'updated@example.com',phone:'0400 999 999',employeeProfile:{...employeeProfile,department:'Site Operations'},active:true,isAdmin:false},admin);assert.equal(activated.status,200);assert.equal(activated.body.user.email,'updated@example.com');assert.equal(activated.body.user.phone,'0400 999 999');assert.equal(activated.body.user.employeeProfile.department,'Site Operations');assert.equal((await request('/login',{username:'newuser',pin:'123456'})).status,200);
 const account=(await request('/admin/users',{},admin)).body.users.find(user=>user.username==='newuser');assert.equal(account.employeeProfile.emergencyContact.name,'Jordan User');assert.ok(account.createdAt);assert.ok(account.lastLoginAt);assert.ok(account.lastActivityAt);assert.ok(account.lastPinChangeAt);assert.equal(account.failedLoginAttempts,0);
 assert.equal((await request('/admin/update-user',{targetUsername:'admin',displayName:'Admin',title:'',location:'',active:false,isAdmin:true},admin)).status,400);
});
test('support tickets are private to their creator and manageable by admins',async()=>{
 const created=await request('/support',{subject:'Cannot open schedule',category:'Technical issue',priority:'High',description:'The schedule screen stays blank.',photo:'data:image/png;base64,aGVsbG8='},staff);
 assert.equal(created.status,201,JSON.stringify(created));const ticket=created.body.ticket;assert.equal(ticket.status,'Open');assert.equal(ticket.createdBy,'staff');
 const adminNotifications=await request('/notifications',undefined,admin);assert.ok(adminNotifications.body.notifications.some(value=>value.title==='New support ticket'&&!value.read&&value.link==='support'));
 const own=await request('/support',undefined,staff);assert.equal(own.body.tickets.length,1);
 const adminList=await request('/support',undefined,admin);assert.ok(adminList.body.tickets.some(value=>value.id===ticket.id));
 const replied=await request(`/support/${ticket.id}/reply`,{message:'Please refresh and try again.'},admin);assert.equal(replied.status,200);assert.equal(replied.body.ticket.messages[0].isAdmin,true);
 const staffNotifications=await request('/notifications',undefined,staff);const replyNotice=staffNotifications.body.notifications.find(value=>value.title==='Support ticket reply');assert.ok(replyNotice&&!replyNotice.read);
 const read=await request('/notifications/read',{id:replyNotice.id},staff);assert.equal(read.status,200);assert.equal(read.body.notifications.find(value=>value.id===replyNotice.id).read,true);
 const pushConfig=await request('/push/config',undefined,staff);assert.equal(pushConfig.status,200);assert.equal(pushConfig.body.enabled,false);
 const subscription={endpoint:'https://push.example.test/device-1',keys:{p256dh:'abcdefghijklmnopqrstuvwxyz123456',auth:'abcdefgh1234'}};assert.equal((await request('/push/subscribe',{subscription},staff)).status,200);assert.equal((await request('/push/unsubscribe',{endpoint:subscription.endpoint},staff)).status,200);
 const resolved=await request(`/support/${ticket.id}/status`,{status:'Resolved'},admin);assert.equal(resolved.status,200);assert.equal(resolved.body.ticket.status,'Resolved');
 assert.equal((await request(`/support/${ticket.id}/status`,{status:'Open'},staff)).status,403);
});

test('admin may add a material-only catalog definition without creating stock',async()=>{
 const material={id:'material-only',sku:'AL-MATERIAL',color:'Carbon',material:'Solid Aluminium',thickness:3,width:0,height:0};
 const change={field:'catalog',id:material.id,before:null,after:material};
 const response=await request('/mutations',{mutationId:crypto.randomUUID(),restoreEpoch:0,changes:[change]},admin);
 assert.equal(response.status,200);
 const saved=(await request('/data',undefined,admin)).body.catalog;
 assert.ok(saved.some(item=>item.id===material.id&&item.width===0&&item.height===0));
});
test('PIN reset revokes existing sessions immediately',async()=>{
 const token=(await request('/login',{username:'newuser',pin:'123456'})).body.token;
 assert.equal((await request('/admin/reset-pin',{targetUsername:'newuser',temporaryPin:'987654'},admin)).status,200);
 assert.equal((await request('/data',undefined,token)).status,401);
 const login=await request('/login',{username:'newuser',pin:'987654'});
 assert.equal(login.body.mustChangePin,true);assert.equal(login.body.token,undefined);
});
test('admins can standardise an existing login while preserving access and a temporary alias',async()=>{
 assert.equal((await request('/admin/create-user',{targetUsername:'old.login',displayName:'Matthew Smith',temporaryPin:'987654'},admin)).status,201);
 const setup=await request('/set-pin',{username:'old.login',oldPin:'987654',newPin:'246810'});assert.equal(setup.status,200);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'old.login',taskCode:'factory.receive',allowed:false},admin)).status,200);
 const active=(await request('/login',{username:'old.login',pin:'246810'})).body.token;
 assert.equal((await request('/admin/rename-user',{targetUsername:'old.login',newUsername:'msmith',confirmedSynced:false},admin)).status,400);
 const renamed=await request('/admin/rename-user',{targetUsername:'old.login',newUsername:'msmith',confirmedSynced:true},admin);
 assert.equal(renamed.status,200,JSON.stringify(renamed));assert.equal(renamed.body.user.username,'msmith');assert.equal(renamed.body.user.taskAccess['factory.receive'],false);
 assert.equal((await request('/session',undefined,active)).status,401);
 const aliasLogin=await request('/login',{username:'old.login',pin:'246810'});assert.equal(aliasLogin.status,200);assert.equal(aliasLogin.body.username,'msmith');
 const canonicalLogin=await request('/login',{username:'msmith',pin:'246810'});assert.equal(canonicalLogin.status,200);assert.equal(canonicalLogin.body.username,'msmith');
});
test('backup restore uses reviewed revision and rejects pre-restore queued edits',async()=>{
 const backup=await request('/admin/backup-now',{},admin);assert.equal(backup.status,200);
 const data=(await request('/data',undefined,admin)).body;
 assert.equal((await request('/admin/restore-backup',{timestamp:backup.body.takenAt,expectedRevision:-1},admin)).status,409);
 assert.equal((await request('/admin/restore-backup',{timestamp:backup.body.takenAt,expectedRevision:data.revision},admin)).status,200);
 const stale={mutationId:crypto.randomUUID(),restoreEpoch:0,changes:[{field:'variants',id:'v1',before:data.variants[0],after:{...data.variants[0],qty:1}}]};
 assert.equal((await request('/mutations',stale,admin)).status,409);
 const next=(await request('/data',undefined,admin)).body;assert.equal(next.restoreEpoch,1);assert.ok(next.transactions.find(t=>t.id==='tx1'));
});
test('SQL profiles store user information and task access is enforced',async()=>{
 assert.equal((await request('/admin/create-user',{targetUsername:'accessuser',displayName:'Access User',temporaryPin:'987654'},admin)).status,201);
 const created=await request('/set-pin',{username:'accessuser',oldPin:'987654',newPin:'456789'});
 const token=created.body.token;
 const photo='data:image/png;base64,aGVsbG8=';
 const saved=await request('/profile',{displayName:'Alex Worker',email:'alex@example.com',profilePhoto:photo},token);
 assert.equal(saved.status,200);assert.equal(saved.body.profile.displayName,'Alex Worker');
 const ownProfile=(await request('/profile',undefined,token)).body.profile;assert.equal(ownProfile.email,'alex@example.com');assert.equal(ownProfile.profilePhoto,photo);assert.equal(Object.hasOwn(ownProfile,'phone'),false);
 const ownAccount=(await request('/admin/users',{},admin)).body.users.find(user=>user.username==='accessuser');assert.equal(ownAccount.employeeProfile.profilePhoto,photo);
 const users=await request('/admin/users',{},admin);assert.ok(users.body.tasks.find(task=>task.code==='site.orders.create'));
 assert.equal((await request('/admin/set-task-access',{targetUsername:'accessuser',taskCode:'factory.stock',allowed:false},admin)).status,200);
 assert.equal((await request('/data',undefined,token)).status,401);
 const relogin=(await request('/login',{username:'accessuser',pin:'456789'})).body;
 assert.equal(relogin.taskAccess['factory.stock'],false);assert.equal((await request('/data',undefined,relogin.token)).status,200);
 const siteCnc=await request('/site/cnc',undefined,relogin.token);
 assert.equal(siteCnc.status,200);
 assert.equal(siteCnc.body.cncPanels.find(panel=>panel.id==='cnc-completed')?.status,'completed');
 const groupedAccess=await request('/admin/set-task-access',{targetUsername:'accessuser',taskCodes:['factory.cnc','site.cnc.view'],allowed:false},admin);assert.equal(groupedAccess.status,200);assert.equal(groupedAccess.body.taskAccess['factory.cnc'],false);assert.equal(groupedAccess.body.taskAccess['site.cnc.view'],false);
 const roleCreated=await request('/admin/roles',{name:'Factory Operator',taskAccess:{'factory.stock':true}},admin);assert.equal(roleCreated.status,201,JSON.stringify(roleCreated));const roleId=roleCreated.body.role.id;
 const secondRole=await request('/admin/roles',{name:'Receiver',taskAccess:{'factory.receive':true}},admin);assert.equal(secondRole.status,201);const receiverRoleId=secondRole.body.role.id;
 const assigned=await request('/admin/update-user',{targetUsername:'accessuser',displayName:'Access User',title:'',location:'',active:true,isAdmin:false,roleIds:[roleId,receiverRoleId]},admin);assert.equal(assigned.status,200);assert.deepEqual(new Set(assigned.body.user.roleIds),new Set([roleId,receiverRoleId]));assert.equal(assigned.body.user.taskAccess['factory.stock'],true);assert.equal(assigned.body.user.taskAccess['factory.receive'],true);assert.equal(assigned.body.user.taskAccess['site.cnc.view'],false);
 const roleLogin=(await request('/login',{username:'accessuser',pin:'456789'})).body;assert.equal((await request('/site/cnc',undefined,roleLogin.token)).status,403);
 const roleUpdated=await request(`/admin/roles/${roleId}`,{name:'Site Viewer',taskAccess:{'site.cnc.view':true}},admin);assert.equal(roleUpdated.status,200);assert.equal((await request('/session',undefined,roleLogin.token)).status,401);
 const changedLogin=(await request('/login',{username:'accessuser',pin:'456789'})).body;assert.equal(changedLogin.taskAccess['factory.stock'],false);assert.equal(changedLogin.taskAccess['factory.receive'],true);assert.equal(changedLogin.taskAccess['site.cnc.view'],true);
 assert.equal((await request(`/admin/roles/${roleId}`,{delete:true},admin)).status,409);
 assert.equal((await request('/admin/update-user',{targetUsername:'accessuser',displayName:'Access User',title:'',location:'',active:true,isAdmin:false,roleIds:[]},admin)).status,200);
 assert.equal((await request(`/admin/roles/${roleId}`,{delete:true},admin)).status,200);
 assert.equal((await request(`/admin/roles/${receiverRoleId}`,{delete:true},admin)).status,200);
});
test('disabled factory task permissions reject their matching mutations',async()=>{
 const disabled=['factory.stock','factory.receive','factory.dispatch','factory.transfer','factory.damage','factory.cnc'];
 assert.equal((await request('/admin/set-task-access',{targetUsername:'accessuser',taskCodes:disabled,allowed:false},admin)).status,200);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'accessuser',taskCode:'factory.jobs',allowed:true},admin)).status,200);
 const token=(await request('/login',{username:'accessuser',pin:'456789'})).body.token;
 assert.ok(token);assert.equal((await request('/data',undefined,token)).status,200);
 const packet=changes=>({mutationId:crypto.randomUUID(),restoreEpoch:1,changes});
 for(const type of ['receipt','dispatch','damage','offcut_add']) {
   const tx={id:crypto.randomUUID(),type,desc:'Permission test',qty:1,itemType:type==='offcut_add'?'offcut':'variant',sku:'SKU1',timestamp:new Date().toISOString()};
   assert.equal((await request('/mutations',packet([{field:'transactions',id:tx.id,before:null,after:tx}]),token)).status,403,type);
 }
 const panel={id:crypto.randomUUID(),orderNumber:'100',sheetNumber:'1',panelNumber:'1',status:'pending'};
 assert.equal((await request('/mutations',packet([{field:'cncPanels',id:panel.id,before:null,after:panel}]),token)).status,403);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'accessuser',taskCode:'site.orders.create',allowed:false},admin)).status,200);
 const relogin=(await request('/login',{username:'accessuser',pin:'456789'})).body.token;
 assert.equal((await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{}},relogin)).status,403);
});
test('order requests are idempotent, separate from stock revisions and export as PDF',async()=>{
 const before=(await request('/data',undefined,staff)).body;
 const key='order-request-test-0001';
 const payload={idempotencyKey:key,order:{project:'Harbour Tower',siteContact:'Michael',phone:'0434 578 760',orderType:'Panels',requestedDeliveryDate:'2026-09-10',requestedDeliveryTime:'06:30',locationNotes:'Level 4',items:[{quantity:2,description:'L4 fascia panel'}]}};
 const first=await request('/orders',payload,staff);assert.equal(first.status,201,JSON.stringify(first));assert.equal(first.body.order.requestedBy,'staff');
 const again=await request('/orders',payload,staff);assert.equal(again.status,200);assert.equal(again.body.duplicate,true);assert.equal(again.body.order.id,first.body.order.id);
 const listed=await request('/orders',undefined,staff);assert.equal(listed.body.orders.filter(order=>order.id===first.body.order.id).length,1);
 assert.equal((await request('/orders/'+first.body.order.id+'/status',{status:'approved'},staff)).status,403);
 assert.equal((await request('/orders/'+first.body.order.id+'/status',{status:'approved'},admin)).body.order.status,'approved');
 assert.equal((await request('/orders/'+first.body.order.id,{order:{...first.body.order,project:'Blocked edit'}},staff)).status,403);
 const edited=await request('/orders/'+first.body.order.id,{order:{...first.body.order,project:'Updated project',status:'ordered',scheduledDeliveryDate:'2026-09-10',scheduledDeliveryTime:'09:30',items:[{quantity:3,description:'Updated panel'}]}},admin);
 assert.equal(edited.status,200,JSON.stringify(edited));assert.equal(edited.body.order.project,'Updated project');assert.equal(edited.body.order.status,'ordered');assert.equal(edited.body.order.orderNumber,first.body.order.orderNumber);assert.equal(edited.body.order.requestedBy,'staff');
 const after=(await request('/data',undefined,staff)).body;assert.equal(after.revision,before.revision);assert.deepEqual(after.variants,before.variants);
 const pdf=await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/pdf',{headers:{Authorization:'Bearer '+staff}});
 assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(pdf.headers.get('x-panelstock-pdf-renderer'),'fallback');assert.equal(new TextDecoder().decode(await pdf.arrayBuffer()).startsWith('%PDF-1.4'),true);
 const link=await request('/orders/'+first.body.order.id+'/pdf-link',{},staff);assert.equal(link.status,200);assert.match(link.body.pdfToken,/^[a-f0-9]{64}$/);
 const linkedPdf=await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/pdf?ticket='+link.body.pdfToken);
 assert.equal(linkedPdf.status,200);assert.match(linkedPdf.headers.get('content-disposition'),/^inline; filename="Updated project - Order .+\.pdf";/);assert.equal(new TextDecoder().decode(await linkedPdf.arrayBuffer()).startsWith('%PDF-1.4'),true);
 assert.equal((await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/pdf?ticket='+link.body.pdfToken)).status,404);
 const downloadLink=await request('/orders/'+first.body.order.id+'/pdf-link',{},staff);
 const downloadedPdf=await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/pdf?download=1&ticket='+downloadLink.body.pdfToken);
 assert.equal(downloadedPdf.status,200);assert.match(downloadedPdf.headers.get('content-disposition'),/^attachment; filename="Updated project - Order .+\.pdf";/);
 const excelLink=await request('/orders/'+first.body.order.id+'/pdf-link',{},staff);
 const linkedExcel=await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/xlsx?ticket='+excelLink.body.pdfToken);
 assert.equal(linkedExcel.status,200);assert.match(linkedExcel.headers.get('content-type'),/spreadsheetml/);assert.equal(new TextDecoder().decode((await linkedExcel.arrayBuffer()).slice(0,2)),'PK');
});
test('order numbering is per project and administrators can set the next unused number',async()=>{
 const make=(key,project)=>request('/orders',{idempotencyKey:key,order:{project,siteContact:'Site',phone:'0400 000 000',orderType:'Panels',requestedDeliveryDate:'2026-09-12',items:[{quantity:1,description:'Panel'}]}},staff);
 const alpha1=await make('project-sequence-0001','Sequence Alpha');assert.equal(alpha1.body.order.orderNumber,'1');
 const alpha2=await make('project-sequence-0002',' sequence   alpha ');assert.equal(alpha2.body.order.orderNumber,'2');
 const beta1=await make('project-sequence-0003','Sequence Beta');assert.equal(beta1.body.order.orderNumber,'1');
 assert.equal((await request('/order-sequences',{project:'Sequence Alpha',nextNumber:10},staff)).status,403);
 const configured=await request('/order-sequences',{project:'Sequence Alpha',nextNumber:10},admin);assert.equal(configured.status,200);assert.equal(configured.body.projectSequences.find(value=>value.project==='Sequence Alpha').nextNumber,10);
 const alpha10=await make('project-sequence-0004','SEQUENCE ALPHA');assert.equal(alpha10.body.order.orderNumber,'10');
 const tooLow=await request('/order-sequences',{project:'Sequence Alpha',nextNumber:5},admin);assert.equal(tooLow.status,400);assert.match(tooLow.body.error,/highest existing order \(10\)/);
 assert.equal((await request('/projects',{name:'Legacy Towers'},staff)).status,403);
 const added=await request('/projects',{name:'LEGACY TOWERS',address:'1 Test Street',notes:'Use Gate 2'},admin);assert.equal(added.status,201);assert.equal(added.body.project.name,'Legacy Towers');assert.equal(added.body.project.address,'1 Test Street');
 assert.equal((await request('/projects',{name:' legacy towers '},admin)).status,409);
 const projects=await request('/orders',undefined,staff);assert.ok(projects.body.projects.includes('Legacy Towers'));assert.ok(projects.body.projects.includes('Sequence Alpha'));assert.equal(projects.body.projectRecords.find(value=>value.name==='Legacy Towers').notes,'Use Gate 2');
 const legacyOrder=await request('/orders',{idempotencyKey:'project-record-0001',order:{projectId:added.body.project.id,project:'Wrong old label',siteContact:'Site',phone:'0400 000 000',orderType:'Panels',requestedDeliveryDate:'2026-09-12',items:[{quantity:1,description:'Panel'}]}},staff);assert.equal(legacyOrder.body.order.project,'Legacy Towers');assert.equal(legacyOrder.body.order.projectId,added.body.project.id);
 const deactivated=await request('/projects/'+added.body.project.id,{name:'Legacy Towers',address:'1 Test Street',notes:'Use Gate 2',active:false},admin);assert.equal(deactivated.status,200);assert.equal(deactivated.body.project.active,false);
 const inactiveProjects=await request('/orders',undefined,staff);assert.equal(inactiveProjects.body.projects.includes('Legacy Towers'),false);assert.equal(inactiveProjects.body.projectRecords.find(value=>value.id===added.body.project.id).active,false);
 const blockedInactive=await request('/orders',{idempotencyKey:'project-record-inactive',order:{projectId:added.body.project.id,project:'Legacy Towers',siteContact:'Site',phone:'0400 000 000',orderType:'Panels',requestedDeliveryDate:'2026-09-12',items:[{quantity:1,description:'Panel'}]}},staff);assert.equal(blockedInactive.status,400);assert.match(blockedInactive.body.error,/active project/);
 const reactivated=await request('/projects/'+added.body.project.id,{name:'Legacy Towers',address:'1 Test Street',notes:'Use Gate 2',active:true},admin);assert.equal(reactivated.status,200);assert.equal(reactivated.body.project.active,true);
 const renamed=await request('/projects/'+added.body.project.id,{name:'Legacy Towers Updated',address:'2 New Street',notes:'Main entry'},admin);assert.equal(renamed.status,200);assert.equal(renamed.body.project.address,'2 New Street');
 const renamedOrders=await request('/orders',undefined,staff);assert.equal(renamedOrders.body.orders.find(value=>value.id===legacyOrder.body.order.id).project,'Legacy Towers Updated');
 assert.equal((await request('/projects/'+added.body.project.id,undefined,admin,'DELETE')).status,409);
 const unused=await request('/projects',{name:'Unused Project'},admin);assert.equal(unused.status,201);
 assert.equal((await request('/projects/'+unused.body.project.id,undefined,staff,'DELETE')).status,403);
 const removed=await request('/projects/'+unused.body.project.id,undefined,admin,'DELETE');assert.equal(removed.status,200);assert.equal(removed.body.projects.some(value=>value.id===unused.body.project.id),false);
 assert.equal((await request('/orders/'+alpha10.body.order.id,undefined,staff,'DELETE')).status,403);
 assert.equal((await request('/orders/'+alpha10.body.order.id,undefined,admin,'DELETE')).status,200);
 assert.equal((await request('/orders/'+alpha10.body.order.id,undefined,admin)).status,404);
 const alpha11=await make('project-sequence-0005','Sequence Alpha');assert.equal(alpha11.body.order.orderNumber,'11');
});
test('web manages a shared schedule while factory users receive read-only access',async()=>{
 const project=await request('/projects',{name:'Schedule Project',address:'10 Site Road'},admin);assert.equal(project.status,201);
 const payload={projectId:project.body.project.id,title:'Install level 2 panels',date:'2026-09-20',startTime:'07:00',endTime:'15:00',assignedUsername:'staff',status:'planned',notes:'Meet at loading bay'};
 assert.equal((await request('/schedule',payload,staff)).status,403);
 const schedule=await request('/schedule',undefined,admin);assert.equal(schedule.status,200);assert.equal(schedule.body.projects[0].id,'schedule-factory-production');assert.equal(schedule.body.projects[0].name,'Factory/Production');assert.equal(schedule.body.projects[0].scheduleOnly,true);
 const factoryPayload={...payload,projectId:'schedule-factory-production'};const factoryCreated=await request('/schedule',factoryPayload,admin);assert.equal(factoryCreated.status,201);assert.equal(factoryCreated.body.entry.project,'Factory/Production');
 const created=await request('/schedule',payload,admin);assert.equal(created.status,201);assert.equal(created.body.entry.project,'Schedule Project');
 const cncCreated=await request('/schedule',{...payload,title:'Cut CNC panels',scheduleType:'cnc'},admin);assert.equal(cncCreated.status,201);assert.equal(cncCreated.body.entry.scheduleType,'cnc');
 const deliveryCreated=await request('/schedule',{...payload,title:'Deliver panels',scheduleType:'delivery'},admin);assert.equal(deliveryCreated.status,201);assert.equal(deliveryCreated.body.entry.scheduleType,'delivery');
 assert.equal((await request('/projects/'+project.body.project.id,undefined,admin,'DELETE')).status,409);
 const listed=await request('/schedule',undefined,staff);assert.equal(listed.status,200);assert.equal(listed.body.viewer,'staff');assert.ok(listed.body.people.some(value=>value.username==='staff'));assert.equal(listed.body.entries.find(value=>value.id===created.body.entry.id).assignedUsername,'staff');
 assert.ok(listed.body.entries.some(value=>value.id===cncCreated.body.entry.id));
 await request('/admin/set-task-access',{targetUsername:'accessuser',taskCodes:['schedule.view','schedule.manage'],allowed:false},admin);await request('/admin/set-task-access',{targetUsername:'accessuser',taskCodes:['schedule.cnc.view'],allowed:true},admin);const cncViewer=(await request('/login',{username:'accessuser',pin:'456789'})).body;
 const cncOnly=await request('/schedule',undefined,cncViewer.token);assert.equal(cncOnly.status,200);assert.deepEqual(cncOnly.body.entries.map(value=>value.scheduleType),['cnc']);assert.equal((await request('/schedule',{...payload,title:'Another CNC task',scheduleType:'cnc'},cncViewer.token)).status,403);
 assert.equal(listed.body.settings.startHour,6);assert.equal(listed.body.settings.endHour,18);assert.ok(listed.body.settings.visibleUsernames.includes('admin'));assert.ok(listed.body.settings.visibleUsernames.includes('staff'));
 assert.equal((await request('/schedule/settings',{startHour:7,endHour:17,visibleUsernames:['staff']},staff)).status,403);
 const settings=await request('/schedule/settings',{startHour:7,endHour:17,visibleUsernames:['staff']},admin);assert.equal(settings.status,200);assert.deepEqual(settings.body.settings,{startHour:7,endHour:17,visibleUsernames:['staff']});
 const filtered=await request('/schedule',undefined,staff);assert.deepEqual(filtered.body.people.map(value=>value.username),['staff']);assert.equal(filtered.body.settings.startHour,7);assert.equal(filtered.body.settings.endHour,17);
 assert.equal((await request('/schedule/share',undefined,staff)).status,403);
 const share=await request('/schedule/share',undefined,admin);assert.equal(share.status,200);assert.match(share.body.token,/^[a-f0-9]{64}$/);assert.match(share.body.code,/^[A-F0-9]{6}$/);
 const publicResponse=await mf.dispatchFetch('http://localhost/schedule-display/data?token='+share.body.token);assert.equal(publicResponse.status,200);const publicSchedule=await publicResponse.json();assert.deepEqual(publicSchedule.people.map(value=>value.username),['staff']);assert.ok(publicSchedule.entries.some(value=>value.title==='Install level 2 panels'));assert.equal(Object.hasOwn(publicSchedule.entries[0],'notes'),false);
 assert.equal((await mf.dispatchFetch('http://localhost/schedule-display/data?token=wrong')).status,404);
 const display=await mf.dispatchFetch('http://localhost/schedule-display/view?token='+share.body.token);assert.equal(display.status,200);assert.match(await display.text(),/Daily Schedule/);
 const shortDisplay=await mf.dispatchFetch('https://tv.panelstockhq.com/'+share.body.code);assert.equal(shortDisplay.status,200);assert.match(await shortDisplay.text(),/Daily Schedule/);
 const shortData=await mf.dispatchFetch('https://tv.panelstockhq.com/data?code='+share.body.code);assert.equal(shortData.status,200);
 const reliableDisplay=await mf.dispatchFetch('http://localhost/tv/'+share.body.code);assert.equal(reliableDisplay.status,200);assert.match(await reliableDisplay.text(),/Daily Schedule/);
 const reliableData=await mf.dispatchFetch('http://localhost/tv/data?code='+share.body.code);assert.equal(reliableData.status,200);
 assert.equal((await request('/schedule/settings',{startHour:18,endHour:7,visibleUsernames:['staff']},admin)).status,400);
 assert.equal((await request('/schedule/'+created.body.entry.id,{...payload,status:'completed'},staff)).status,403);
 const updated=await request('/schedule/'+created.body.entry.id,{...payload,status:'in-progress'},admin);assert.equal(updated.status,200);assert.equal(updated.body.entry.status,'planned');
 assert.equal((await request('/schedule/'+created.body.entry.id,undefined,staff,'DELETE')).status,403);
 assert.equal((await request('/schedule/'+created.body.entry.id,undefined,admin,'DELETE')).status,200);
 assert.equal((await request('/schedule/'+cncCreated.body.entry.id,undefined,admin,'DELETE')).status,200);
 assert.equal((await request('/schedule/'+deliveryCreated.body.entry.id,undefined,admin,'DELETE')).status,200);
 assert.equal((await request('/projects/'+project.body.project.id,undefined,admin,'DELETE')).status,200);
});
test('repeated bad login attempts are rate limited',async()=>{
 let last;for(let i=0;i<16;i++)last=await request('/login',{username:'unknown',pin:'bad'});
 assert.equal(last.status,429);
});
test('concurrent clients cannot both consume the same stock snapshot',async()=>{
 const data=(await request('/data',undefined,admin)).body,v=data.variants[0];
 const packet=qty=>({mutationId:crypto.randomUUID(),restoreEpoch:data.restoreEpoch,changes:[{field:'variants',id:v.id,before:v,after:{...v,qty:v.qty-qty}},{field:'transactions',id:'parallel-'+qty,before:null,after:{id:'parallel-'+qty,type:'dispatch',desc:'Concurrent dispatch',qty,itemType:'variant',sku:v.sku,timestamp:new Date().toISOString()}}]});
 const results=await Promise.all([request('/mutations',packet(1),staff),request('/mutations',packet(2),staff)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const after=(await request('/data',undefined,admin)).body;
 assert.equal(after.transactions.filter(t=>t.id.startsWith('parallel-')).length,1);
});
test('history survives beyond 800 entries and rejects truncation',async()=>{
 const data=(await request('/data',undefined,admin)).body;
 const changes=Array.from({length:805},(_,i)=>({field:'transactions',id:'history-'+i,before:null,after:{id:'history-'+i,type:'user',desc:'History retention fixture',qty:'',timestamp:new Date().toISOString()}}));
 assert.equal((await request('/mutations',{mutationId:crypto.randomUUID(),restoreEpoch:data.restoreEpoch,changes},admin)).status,200);
 const after=(await request('/data',undefined,admin)).body;
 assert.ok(after.transactions.length>800);assert.ok(after.transactions.find(t=>t.id==='tx1'));
});
