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
const stock={id:'v1',sku:'SKU1',catalogId:'c1',color:'White',material:'Aluminium',thickness:3,width:1200,height:2400,qty:10,reorderPoint:0};
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

test('staff may add missing catalog material with its receipt, but cannot edit or delete catalog',async()=>{
 const cat={id:'staff-cat',sku:'STAFF-NEW',color:'Blue',material:'ACP',thickness:4,width:1000,height:2000,reorderPoint:0};
 const variant={...cat,id:'staff-var',catalogId:cat.id,qty:3};
 const tx={...cat,id:'staff-receipt',type:'receipt',desc:'New material received',itemType:'variant',qty:3,timestamp:new Date().toISOString()};
 const changes=[{field:'catalog',id:cat.id,before:null,after:cat},{field:'variants',id:variant.id,before:null,after:variant},{field:'transactions',id:tx.id,before:null,after:tx}];
 const packet=items=>({mutationId:crypto.randomUUID(),restoreEpoch:0,changes:items});
 assert.equal((await request('/mutations',packet(changes.slice(0,2)),staff)).status,403);
 assert.equal((await request('/mutations',packet(changes.map(c=>c.field==='variants'?{...c,after:{...variant,qty:4}}:c)),staff)).status,403);
 const body=packet(changes);
 assert.equal((await request('/mutations',body,staff)).status,200);
 assert.equal((await request('/mutations',body,staff)).body.duplicate,true);
 const data=(await request('/data',undefined,staff)).body;
 assert.equal(data.variants.find(v=>v.id===variant.id).qty,3);
 assert.equal(data.transactions.find(t=>t.id===tx.id).user,'staff');
 for(const after of [null,{...cat,color:'Changed'}])assert.equal((await request('/mutations',packet([{field:'catalog',id:cat.id,before:cat,after}]),staff)).status,403);
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
test('registration does not inherit caller admin privileges',async()=>{
 const result=await request('/set-pin',{username:'newuser',oldPin:'987654',newPin:'123456'},admin);
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.isAdmin,false);
 assert.equal((await request('/admin/users',{},result.body.token)).status,403);
});
test('PIN reset revokes existing sessions immediately',async()=>{
 const token=(await request('/login',{username:'newuser',pin:'123456'})).body.token;
 assert.equal((await request('/admin/reset-pin',{targetUsername:'newuser'},admin)).status,200);
 assert.equal((await request('/data',undefined,token)).status,401);
 const login=await request('/login',{username:'newuser',pin:'987654'});
 assert.equal(login.body.mustChangePin,true);assert.equal(login.body.token,undefined);
});
test('backup restore uses reviewed revision and rejects pre-restore queued edits',async()=>{
 const backup=await request('/admin/backup-now',{},admin);assert.equal(backup.status,200);
 const data=(await request('/data',undefined,admin)).body;
 assert.equal((await request('/admin/restore-backup',{timestamp:backup.body.takenAt,expectedRevision:-1},admin)).status,409);
 assert.equal((await request('/admin/restore-backup',{timestamp:backup.body.takenAt,expectedRevision:data.revision},admin)).status,200);
 const stale={mutationId:crypto.randomUUID(),restoreEpoch:0,changes:[{field:'variants',id:'v1',before:data.variants[0],after:{...data.variants[0],reorderPoint:1}}]};
 assert.equal((await request('/mutations',stale,admin)).status,409);
 const next=(await request('/data',undefined,admin)).body;assert.equal(next.restoreEpoch,1);assert.ok(next.transactions.find(t=>t.id==='tx1'));
});
test('SQL profiles store user information and task access is enforced',async()=>{
 const created=await request('/set-pin',{username:'accessuser',oldPin:'987654',newPin:'456789'},admin);
 const token=created.body.token;
 const saved=await request('/profile',{displayName:'Alex Worker',email:'alex@example.com',phone:'0400 000 000'},token);
 assert.equal(saved.status,200);assert.equal(saved.body.profile.displayName,'Alex Worker');
 assert.equal((await request('/profile',undefined,token)).body.profile.email,'alex@example.com');
 const users=await request('/admin/users',{},admin);assert.ok(users.body.tasks.find(task=>task.code==='site.orders.create'));
 assert.equal((await request('/admin/set-task-access',{targetUsername:'accessuser',taskCode:'factory.stock',allowed:false},admin)).status,200);
 assert.equal((await request('/data',undefined,token)).status,401);
 const relogin=(await request('/login',{username:'accessuser',pin:'456789'})).body;
 assert.equal(relogin.taskAccess['factory.stock'],false);assert.equal((await request('/data',undefined,relogin.token)).status,403);
 const siteCnc=await request('/site/cnc',undefined,relogin.token);
 assert.equal(siteCnc.status,200);
 assert.equal(siteCnc.body.cncPanels.find(panel=>panel.id==='cnc-completed')?.status,'completed');
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
 const added=await request('/projects',{name:'Legacy Towers',address:'1 Test Street',notes:'Use Gate 2'},admin);assert.equal(added.status,201);assert.equal(added.body.project.address,'1 Test Street');
 assert.equal((await request('/projects',{name:' legacy towers '},admin)).status,409);
 const projects=await request('/orders',undefined,staff);assert.ok(projects.body.projects.includes('Legacy Towers'));assert.ok(projects.body.projects.includes('Sequence Alpha'));assert.equal(projects.body.projectRecords.find(value=>value.name==='Legacy Towers').notes,'Use Gate 2');
 const legacyOrder=await request('/orders',{idempotencyKey:'project-record-0001',order:{projectId:added.body.project.id,project:'Wrong old label',siteContact:'Site',phone:'0400 000 000',orderType:'Panels',requestedDeliveryDate:'2026-09-12',items:[{quantity:1,description:'Panel'}]}},staff);assert.equal(legacyOrder.body.order.project,'Legacy Towers');assert.equal(legacyOrder.body.order.projectId,added.body.project.id);
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
 const created=await request('/schedule',payload,admin);assert.equal(created.status,201);assert.equal(created.body.entry.project,'Schedule Project');
 assert.equal((await request('/projects/'+project.body.project.id,undefined,admin,'DELETE')).status,409);
 const listed=await request('/schedule',undefined,staff);assert.equal(listed.status,200);assert.equal(listed.body.viewer,'staff');assert.ok(listed.body.people.some(value=>value.username==='staff'));assert.equal(listed.body.entries.find(value=>value.id===created.body.entry.id).assignedUsername,'staff');
 assert.equal((await request('/schedule/'+created.body.entry.id,{...payload,status:'completed'},staff)).status,403);
 const updated=await request('/schedule/'+created.body.entry.id,{...payload,status:'in-progress'},admin);assert.equal(updated.status,200);assert.equal(updated.body.entry.status,'in-progress');
 assert.equal((await request('/schedule/'+created.body.entry.id,undefined,staff,'DELETE')).status,403);
 assert.equal((await request('/schedule/'+created.body.entry.id,undefined,admin,'DELETE')).status,200);
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
