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
async function setupUser(username,newPin) {
 const link=await request('/admin/create-invite',{targetUsername:username},admin);assert.equal(link.status,200);
 const accepted=await request('/invite/accept',{token:link.body.token,action:'accept',newPin});assert.equal(accepted.status,200);
 return request('/login',{username,pin:newPin});
}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test-worker',modules:true,script:fs.readFileSync(built,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'test',CNC_PUBLIC_TOKEN:'synthetic-cnc-share',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:'http://localhost:8080'}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV');
 await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:pinHash('123456','admin')},staff:{isAdmin:false,pinHash:pinHash('654321','staff')}}));
 await kv.put('registration_code','987654');
 await kv.put('site-order-cover-template',await orderTemplateFixture());
 for(const [field,v]of Object.entries({variants:[stock],catalog:[{...stock,id:'c1'}],offcuts:[],transactions:[],reasons:[],photos:{},cncPanels:[{id:'cnc-completed',orderNumber:'001',jobReference:'Test job',sheetNumber:'1',panelNumber:'1',status:'completed',completedAt:'2026-09-01T00:00:00.000Z',completedBy:'admin'},{id:'qa-completed',orderNumber:'002',jobReference:'QA project',sheetNumber:'2',panelNumber:'P-2',status:'completed',completedAt:'2099-01-01T00:00:00.000Z',completedBy:'admin',stockColor:'Charcoal',stockMaterial:'Aluminium',stockThickness:3},{id:'qa-separate-recut',orderNumber:'004',jobReference:'QA project',sheetNumber:'5',panelNumber:'S-1',status:'completed',completedAt:'2099-03-01T00:00:00.000Z',completedBy:'admin'},{id:'qa-original-remake',orderNumber:'003',jobReference:'QA project',sheetNumber:'3',panelNumber:'R-1',status:'completed',completedAt:'2099-02-01T00:00:00.000Z',completedBy:'admin'},{id:'qa-remake',orderNumber:'003',jobReference:'QA project',sheetNumber:'4',panelNumber:'R-1',status:'completed',completedAt:'2099-02-02T00:00:00.000Z',completedBy:'admin',isRemake:true,remakeReason:'Failed QA finish check'}]}))await kv.put('app:'+field,JSON.stringify(v));
 admin=(await request('/login',{username:'admin',pin:'123456'})).body.token;
 staff=(await request('/login',{username:'staff',pin:'654321'})).body.token;
 assert.ok(admin);assert.ok(staff);
});
after(async()=>{await mf?.dispose();});

test('CNC share links require live CNC permissions and reject logged-out sessions',async()=>{
 assert.equal((await request('/cnc-share')).status,401);
 const adminShare=await request('/cnc-share',undefined,admin);assert.equal(adminShare.status,200);assert.equal(adminShare.body.token,'synthetic-cnc-share');
 assert.equal((await request('/admin/create-user',{targetUsername:'sharecheck',displayName:'Share Check'},admin)).status,201);
 await setupUser('sharecheck','456789');
 const tasks=(await request('/admin/users',{},admin)).body.tasks.map(task=>task.code);
 await request('/admin/set-task-access',{targetUsername:'sharecheck',taskCodes:tasks,allowed:false},admin);
 let token=(await request('/login',{username:'sharecheck',pin:'456789'})).body.token;
 assert.equal((await request('/site/cnc',undefined,token)).status,403);
 const denied=await request('/cnc-share',undefined,token);assert.equal(denied.status,403);assert.equal(Object.hasOwn(denied.body,'token'),false);
 for(const task of ['factory.cnc','site.cnc.view']){
   await request('/admin/set-task-access',{targetUsername:'sharecheck',taskCodes:['factory.cnc','site.cnc.view'],allowed:false},admin);
   await request('/admin/set-task-access',{targetUsername:'sharecheck',taskCode:task,allowed:true},admin);
   token=(await request('/login',{username:'sharecheck',pin:'456789'})).body.token;
   const allowed=await request('/cnc-share',undefined,token);assert.equal(allowed.status,200);assert.equal(allowed.body.token,'synthetic-cnc-share');
 }
 assert.equal((await request('/logout',{},token)).status,200);
 assert.equal((await request('/cnc-share',undefined,token)).status,401);
});

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
 const live=(await request('/live-ticket',undefined,staff));assert.equal(live.status,200);assert.match(live.body.ticket,/^[a-f0-9-]{36}$/);assert.ok(live.body.expiresAt>Date.now());
 assert.equal((await request('/debug-auth')).status,404);
 assert.equal((await request('/debug-schedule')).status,404);
 assert.equal((await request('/data',{variants:[]},admin)).status,426);
});
test('CNC settings are admin-only, validated and persisted',async()=>{
 assert.equal((await request('/cnc-settings',undefined,staff)).status,403);
 const defaults=await request('/cnc-settings',undefined,admin);assert.equal(defaults.status,200);assert.deepEqual(defaults.body.settings,{minimumOffcutSizeMm:1,wasteGreenMax:5,wasteYellowMax:10,cutEdgeAllowanceMm:10});
 const value={minimumOffcutSizeMm:250,wasteGreenMax:4,wasteYellowMax:9,cutEdgeAllowanceMm:12};
 const saved=await request('/cnc-settings',value,admin);assert.equal(saved.status,200);assert.deepEqual(saved.body.settings,value);
 assert.deepEqual((await request('/cnc-settings',undefined,admin)).body.settings,value);
 assert.equal((await request('/cnc-settings',{...value,wasteYellowMax:3},admin)).status,400);
});
test('QA settings are admin-only, validated and drive the active checklists',async()=>{
 assert.equal((await request('/qa/settings',undefined,staff)).status,403);
 const defaults=(await request('/qa/settings',undefined,admin)).body.settings;
 assert.equal(defaults.requireQaPhoto,false);assert.equal(defaults.requireFailurePhoto,true);assert.equal(defaults.preventSelfApproval,true);assert.equal(defaults.requireResolvedOrderForDispatch,true);assert.equal(defaults.requireDispatchPhoto,false);assert.equal(defaults.panelChecks.length,8);assert.equal(defaults.metalworkChecks.length,7);assert.equal(defaults.activePanelChecks.length,8);assert.equal(defaults.activeMetalworkChecks.length,7);
 const panelChecks=[...defaults.panelChecks.map(([key,label])=>[key,key==='material'?'Material, colour and finish match the job':label]),['custom-edge','Edges are protected for transport']];
 const changed={...defaults,requireQaPhoto:true,requireFailurePhoto:false,requireDispatchPhoto:true,panelChecks,activePanelChecks:[...defaults.activePanelChecks.filter(key=>key!=='film'),'custom-edge']};
 const saved=await request('/qa/settings',changed,admin);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.settings.requireQaPhoto,true);assert.equal(saved.body.settings.requireDispatchPhoto,true);assert.equal(saved.body.settings.activePanelChecks.includes('film'),false);
 const view=await request('/qa',undefined,staff);assert.equal(view.body.checklists.panel.some(([key])=>key==='film'),false);assert.equal(view.body.checklists.panel.some(([key,label])=>key==='material'&&label==='Material, colour and finish match the job'),true);assert.equal(view.body.checklists.panel.some(([key,label])=>key==='custom-edge'&&label==='Edges are protected for transport'),true);
 const photoItem=await request('/qa/metalwork',{project:'Photo proof',orderNumber:'900',reference:'Photo test',quantity:1,fabricatedBy:'admin'},staff);assert.equal(photoItem.status,201);
 const photoResults=Object.fromEntries(photoItem.body.checklists.metalwork.map(([key])=>[key,'pass']));
 const missingPhoto=await request('/qa/check',{id:photoItem.body.item.id,kind:'metalwork',results:photoResults},staff);assert.equal(missingPhoto.status,400);assert.match(missingPhoto.body.error,/QA photo/i);
 assert.equal((await request('/qa/check',{id:photoItem.body.item.id,kind:'metalwork',results:photoResults,photo:'data:image/png;base64,aGVsbG8='},staff)).status,200);
 const removed={...changed,panelChecks:changed.panelChecks.filter(([key])=>key!=='custom-edge'),activePanelChecks:changed.activePanelChecks.filter(key=>key!=='custom-edge')};
 assert.equal((await request('/qa/settings',removed,admin)).status,200);
 assert.equal((await request('/qa',undefined,staff)).body.checklists.panel.some(([key])=>key==='custom-edge'),false);
 assert.equal((await request('/qa/settings',{...changed,activePanelChecks:[]},admin)).status,400);
 assert.equal((await request('/qa/settings',{...changed,panelChecks:[['duplicate','First'],['duplicate','Second']]},admin)).status,400);
 assert.equal((await request('/qa/settings',{...changed,panelChecks:[['blank','']]},admin)).status,400);
 assert.equal((await request('/qa/settings',defaults,admin)).status,200);
});
test('QA checks preserve CNC operator details, require failure evidence and prevent self-approval',async()=>{
 const list=await request('/qa',undefined,staff);assert.equal(list.status,200,JSON.stringify(list));assert.equal(list.body.preQaCount,1);
 const panel=list.body.items.find(item=>item.id==='qa-completed');assert.equal(panel.status,'awaiting');assert.equal(panel.cutBy,'admin');assert.equal(panel.cutAt,'2099-01-01T00:00:00.000Z');
 const passResults=Object.fromEntries(list.body.checklists.panel.map(([key])=>[key,'pass']));
 assert.equal((await request('/qa/check',{id:panel.id,kind:'panel',results:{}},staff)).status,400);
 assert.equal((await request('/qa/check',{id:panel.id,kind:'panel',results:{...passResults,finish:'fail'}},staff)).status,400);
 const failed=await request('/qa/check',{id:panel.id,kind:'panel',results:{...passResults,finish:'fail'},notes:'Scratch on face',photo:'data:image/png;base64,aGVsbG8='},staff);assert.equal(failed.status,200,JSON.stringify(failed));assert.equal(failed.body.item.status,'recut');assert.equal(failed.body.item.latest.checkedBy,'staff');
 const cannotReuse=await request('/qa/check',{id:panel.id,kind:'panel',results:passResults,notes:'Rechecked'},staff);assert.equal(cannotReuse.status,409);assert.match(cannotReuse.body.error,/new CNC recut/i);
 const metal=await request('/qa/metalwork',{project:'QA project',orderNumber:'002',reference:'Bracket A',quantity:4,fabricatedBy:'staff'},staff);assert.equal(metal.status,201,JSON.stringify(metal));
 const metalResults=Object.fromEntries(metal.body.checklists.metalwork.map(([key])=>[key,'pass']));
 const metalFailed=await request('/qa/check',{id:metal.body.item.id,kind:'metalwork',results:{...metalResults,welds:'fail'},notes:'Weld needs dressing',photo:'data:image/png;base64,aGVsbG8='},staff);assert.equal(metalFailed.status,200,JSON.stringify(metalFailed));assert.equal(metalFailed.body.item.status,'recut');
 const self=await request('/qa/check',{id:metal.body.item.id,kind:'metalwork',results:metalResults},staff);assert.equal(self.status,403);assert.match(self.body.error,/cannot approve work you produced/i);
 const adminMetal=await request('/qa/metalwork',{project:'QA project',orderNumber:'002',reference:'Bracket B',quantity:2,fabricatedBy:'admin'},admin);assert.equal(adminMetal.status,201);
 assert.equal((await request('/qa/check',{id:adminMetal.body.item.id,kind:'metalwork',results:metalResults},admin)).status,403);
 const override=await request('/qa/check',{id:adminMetal.body.item.id,kind:'metalwork',results:metalResults,overrideReason:'Only qualified inspector available'},admin);assert.equal(override.status,200,JSON.stringify(override));assert.equal(override.body.item.latest.overrideReason,'Only qualified inspector available');
});
test('a completed CNC remake resolves and remains linked to its failed original panel',async()=>{
 const list=await request('/qa',undefined,staff),results=Object.fromEntries(list.body.checklists.panel.map(([key])=>[key,'pass']));
 const failed=await request('/qa/check',{id:'qa-original-remake',kind:'panel',results:{...results,finish:'fail'},notes:'Surface finish failed',photo:'data:image/png;base64,aGVsbG8='},staff);assert.equal(failed.status,200,JSON.stringify(failed));
 assert.equal(failed.body.item.status,'recut');
 const remake=await request('/qa/check',{id:'qa-remake',kind:'panel',results,notes:'Replacement checked'},staff);assert.equal(remake.status,200,JSON.stringify(remake));assert.equal(remake.body.item.remakeOf,'qa-original-remake');assert.equal(remake.body.item.remakeOfReference,'R-1');
 const original=remake.body.items.find(item=>item.id==='qa-original-remake');assert.equal(original.status,'replaced');assert.equal(original.replacementId,'qa-remake');assert.equal(original.replacementReference,'R-1');assert.equal(original.replacementStatus,'approved');
});
test('an administrator can resolve a recut completed and scheduled separately',async()=>{
 const list=await request('/qa',undefined,staff),results=Object.fromEntries(list.body.checklists.panel.map(([key])=>[key,'pass']));
 const failed=await request('/qa/check',{id:'qa-separate-recut',kind:'panel',results:{...results,finish:'fail'},notes:'Recut outside PanelStock schedule',photo:'data:image/png;base64,aGVsbG8='},staff);assert.equal(failed.status,200,JSON.stringify(failed));assert.equal(failed.body.item.status,'recut');
 assert.equal((await request('/qa/recut/resolve',{id:'qa-separate-recut',reason:'Recut completed and scheduled separately'},staff)).status,403);
 assert.equal((await request('/qa/recut/resolve',{id:'qa-separate-recut'},admin)).status,400);
 const resolved=await request('/qa/recut/resolve',{id:'qa-separate-recut',reason:'Recut completed and scheduled separately'},admin);assert.equal(resolved.status,200,JSON.stringify(resolved));assert.equal(resolved.body.item.status,'replaced');assert.equal(resolved.body.item.replacementStatus,'resolved-separately');assert.equal(resolved.body.item.resolvedSeparatelyBy,'admin');assert.equal(resolved.body.item.resolvedSeparatelyReason,'Recut completed and scheduled separately');assert.ok(resolved.body.item.resolvedSeparatelyAt);
 assert.equal((await request('/qa/recut/resolve',{id:'qa-separate-recut',reason:'Again'},admin)).status,404);
});
test('QA dispatch loads require resolved orders, preserve transport details and prevent double dispatch',async()=>{
 assert.equal((await request('/qa/dispatch',{project:'QA project',orderNumber:'003',lines:[{id:'qa-remake',quantity:1}],destination:'Site',transport:'Truck 1',driver:'Driver'},staff)).status,403);
 assert.equal((await request('/qa/dispatch',{project:'QA project',orderNumber:'003',lines:[{id:'qa-remake',quantity:1}]},admin)).status,400);
 const oldRoute=await request('/qa/dispatch',{project:'QA project',orderNumber:'003',lines:[{id:'qa-remake',quantity:1}],destination:'Site',transport:'Truck',driver:'Driver'},admin);
 assert.equal(oldRoute.status,409);assert.match(oldRoute.body.error,/Dispatch panels from Dispatch loads/);
 const initial=await request('/dispatch/panels',undefined,admin);assert.equal(initial.status,200);
 const load=initial.body.loads.find(load=>load.orderNumber==='003');assert.ok(load);assert.equal(load.ready,true);assert.equal(load.fabricationComplete,true);assert.equal(load.fabrication.source,'qa');assert.equal(load.routing,true);assert.equal(load.qaComplete,true);
 const payload={id:load.id,action:'dispatch',destinationType:'powder_coaters',destination:'Coater',transport:'Truck',driver:'Alex'};
 assert.equal((await request('/dispatch/panels',{id:load.id,action:'fabricate'},admin)).status,400);
 const sent=await request('/dispatch/panels',payload,admin);assert.equal(sent.status,200);assert.equal(sent.body.loads.find(l=>l.id===load.id).status,'at_powder_coaters');
 assert.equal((await request('/dispatch/panels',{...payload,destinationType:'site'},admin)).status,409);
 assert.equal((await request('/dispatch/panels',{id:load.id,action:'coating-complete'},admin)).status,200);
 assert.equal((await request('/dispatch/panels',{...payload,destinationType:'site'},admin)).status,409);
 await request('/admin/set-task-access',{targetUsername:'staff',taskCode:'factory.qa',allowed:false},admin);
 staff=(await request('/login',{username:'staff',pin:'654321'})).body.token;
 assert.equal((await request('/dispatch/panels',{id:load.id,action:'final-qa',confirmed:true},staff)).status,403);
 await request('/admin/set-task-access',{targetUsername:'staff',taskCode:'factory.qa',allowed:true},admin);
 staff=(await request('/login',{username:'staff',pin:'654321'})).body.token;
 const checked=await request('/dispatch/panels',{id:load.id,action:'final-qa',confirmed:true},admin);assert.equal(checked.status,200);assert.equal(checked.body.loads.find(l=>l.id===load.id).finalQa.by,'admin');
 const site=await request('/dispatch/panels',{...payload,destinationType:'site',destination:'Site address'},admin);assert.equal(site.status,200);assert.equal(site.body.loads.find(l=>l.id===load.id).legs.length,2);
 assert.equal((await request('/dispatch/panels',payload,admin)).status,409);
 const blocked=await request('/qa/dispatch',{project:'QA project',orderNumber:'002',lines:[{id:'qa-completed',quantity:1}],destination:'Site',transport:'Truck 2',driver:'Driver'},admin);assert.equal(blocked.status,409);assert.match(blocked.body.error,/administrator override requires a reason/i);
 const rejectedRecut=await request('/qa/dispatch',{project:'QA project',orderNumber:'002',lines:[{id:'qa-completed',quantity:1}],destination:'Site',transport:'Truck 2',driver:'Driver',overrideReason:'Attempted override'},admin);assert.equal(rejectedRecut.status,409);assert.match(rejectedRecut.body.error,/must be recut/i);
 const orderTwo=(await request('/qa',undefined,admin)).body.items,approvedMetal=orderTwo.find(item=>item.reference==='Bracket B');assert.equal(approvedMetal.status,'approved');
 const override=await request('/qa/dispatch',{project:'QA project',orderNumber:'002',lines:[{id:approvedMetal.id,quantity:1}],destination:'Site',transport:'Truck 2',driver:'Driver',overrideReason:'Other unresolved work is shipping separately'},admin);assert.equal(override.status,201,JSON.stringify(override));assert.equal(override.body.dispatch.overrideReason,'Other unresolved work is shipping separately');
});
test('live sync tickets establish one-use authenticated WebSockets',async()=>{
 const issued=await request('/live-ticket',undefined,admin);
 const response=await mf.dispatchFetch('http://localhost/live?ticket='+encodeURIComponent(issued.body.ticket),{headers:{Upgrade:'websocket'}});
 assert.equal(response.status,101);const socket=response.webSocket;assert.ok(socket);socket.accept();
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Live sync did not become ready')),1000);socket.addEventListener('message',event=>{clearTimeout(timer);resolve(JSON.parse(event.data));},{once:true});});
 assert.equal(ready.type,'ready');assert.equal(typeof ready.revision,'number');socket.close(1000,'test complete');
 const reused=await mf.dispatchFetch('http://localhost/live?ticket='+encodeURIComponent(issued.body.ticket),{headers:{Upgrade:'websocket'}});assert.equal(reused.status,401);
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
 assert.equal((await request('/admin/create-user',{targetUsername:'newuser',displayName:'New User'},staff)).status,403);
 const employeeProfile={employeeNumber:'LF-104',employmentType:'employee',department:'Installation',supervisorUsername:'admin',workLocations:['Brisbane','Factory'],startDate:'2026-09-01',finishDate:'',emergencyContact:{name:'Jordan User',relationship:'Partner',phone:'0400 111 222'},licenses:[{type:'White Card',number:'WC-123',expiryDate:'2028-01-01',notes:'QLD'}],inductions:[{type:'Pinnacle Studios',status:'current',expiryDate:'2027-01-01',notes:''}],profilePhoto:'',notes:'Private employment note'};
 const created=await request('/admin/create-user',{targetUsername:'newuser',displayName:'New User',title:'Installer',location:'Brisbane',email:'new.user@example.com',phone:'0400 000 000',employeeProfile},admin);assert.equal(created.status,201);assert.equal(created.body.user.isAdmin,false);assert.equal(created.body.user.title,'Installer');assert.equal(created.body.user.location,'Brisbane');assert.equal(created.body.user.email,'new.user@example.com');assert.equal(created.body.user.phone,'0400 000 000');assert.equal(created.body.user.employeeProfile.employeeNumber,'LF-104');
 assert.equal((await request('/login',{username:'newuser',pin:'987654'})).status,401);
 assert.equal((await request('/set-pin',{username:'newuser',oldPin:'987654',newPin:'123456'})).status,401);
 const result=await setupUser('newuser','123456');
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
 const defaultPreferences=await request('/notification-preferences',undefined,staff);assert.deepEqual(defaultPreferences.body.preferences,{schedule:true,support:true,cnc:true,orders:true,push:true});
 const muted=await request('/notification-preferences',{schedule:true,support:false,cnc:true,push:false},staff);assert.equal(muted.status,200);assert.deepEqual(muted.body.preferences,{schedule:true,support:false,cnc:true,orders:true,push:false});
 const own=await request('/support',undefined,staff);assert.equal(own.body.tickets.length,1);
 const adminList=await request('/support',undefined,admin);assert.ok(adminList.body.tickets.some(value=>value.id===ticket.id));
 const replied=await request(`/support/${ticket.id}/reply`,{message:'Please refresh and try again.'},admin);assert.equal(replied.status,200);assert.equal(replied.body.ticket.messages[0].isAdmin,true);
 let staffNotifications=await request('/notifications',undefined,staff);assert.equal(staffNotifications.body.notifications.some(value=>value.title==='Support ticket reply'),false);
 await request('/notification-preferences',{schedule:true,support:true,cnc:true,push:true},staff);
 await request(`/support/${ticket.id}/reply`,{message:'Notifications are enabled again.'},admin);
 staffNotifications=await request('/notifications',undefined,staff);const replyNotice=staffNotifications.body.notifications.find(value=>value.title==='Support ticket reply');assert.ok(replyNotice&&!replyNotice.read);
 const read=await request('/notifications/read',{id:replyNotice.id},staff);assert.equal(read.status,200);assert.equal(read.body.notifications.find(value=>value.id===replyNotice.id).read,true);
 const cleared=await request('/notifications/clear',{},staff);assert.equal(cleared.status,200);assert.deepEqual(cleared.body.notifications,[]);assert.equal((await request('/notifications',undefined,staff)).body.notifications.length,0);assert.ok((await request('/notifications',undefined,admin)).body.notifications.length>0);
 const pushConfig=await request('/push/config',undefined,staff);assert.equal(pushConfig.status,200);assert.equal(pushConfig.body.enabled,false);
 const subscription={endpoint:'https://push.example.test/device-1',keys:{p256dh:'abcdefghijklmnopqrstuvwxyz123456',auth:'abcdefgh1234'}};assert.equal((await request('/push/subscribe',{subscription},staff)).status,200);assert.equal((await request('/push/unsubscribe',{endpoint:subscription.endpoint},staff)).status,200);
 const resolved=await request(`/support/${ticket.id}/status`,{status:'Resolved'},admin);assert.equal(resolved.status,200);assert.equal(resolved.body.ticket.status,'Resolved');
 assert.equal((await request(`/support/${ticket.id}/status`,{status:'Open'},staff)).status,403);
});

test('new CNC scheduling mutations notify administrators once per scheduling action',async()=>{
 const now=new Date().toISOString(),mutationId='cnc-notification-test-0001';
 const panels=['41','42'].map(panelNumber=>({id:`cnc-notification-${panelNumber}`,orderNumber:'900',jobReference:'Riverside House',sheetNumber:'7',panelNumber,stockItemType:'variant',stockItemId:'v1',stockSku:'SKU1',sheetWidth:2400,sheetHeight:1200,totalPanelArea:1.2,status:'pending',uploadedBy:'admin',uploadedAt:now,completedBy:null,completedAt:null}));
 const body={mutationId,restoreEpoch:0,changes:panels.map(panel=>({field:'cncPanels',id:panel.id,before:null,after:panel}))};
 assert.equal((await request('/mutations',body,admin)).status,200);
 let notifications=(await request('/notifications',undefined,admin)).body.notifications.filter(value=>value.title==='CNC sheets scheduled');
 assert.equal(notifications.length,1);assert.equal(notifications[0].kind,'cnc');assert.equal(notifications[0].link,'cnc');assert.match(notifications[0].message,/1 sheet \(2 panels\).*Order 900.*Riverside House/);
 assert.equal((await request('/mutations',body,admin)).body.duplicate,true);
 notifications=(await request('/notifications',undefined,admin)).body.notifications.filter(value=>value.title==='CNC sheets scheduled');assert.equal(notifications.length,1);
 const duplicatePanel={...panels[0],id:'cnc-notification-duplicate'};
 const savedPanel=(await request('/data',undefined,admin)).body.cncPanels.find(value=>value.id===panels[0].id);assert.ok(savedPanel);
 const duplicateResponse=await request('/mutations',{mutationId:'cnc-duplicate-panel-test-01',restoreEpoch:0,changes:[{field:'cncPanels',id:duplicatePanel.id,before:null,after:duplicatePanel}]},admin);
 assert.equal(duplicateResponse.status,409,JSON.stringify(duplicateResponse.body));assert.match(duplicateResponse.body.error,/Order 900 · Sheet 7 · Panel 41 is already/);
});

test('admin may add a material-only catalog definition without creating stock',async()=>{
 const material={id:'material-only',sku:'AL-MATERIAL',color:'Carbon',material:'Solid Aluminium',thickness:3,width:0,height:0};
 const change={field:'catalog',id:material.id,before:null,after:material};
 const response=await request('/mutations',{mutationId:crypto.randomUUID(),restoreEpoch:0,changes:[change]},admin);
 assert.equal(response.status,200);
 const saved=(await request('/data',undefined,admin)).body.catalog;
 assert.ok(saved.some(item=>item.id===material.id&&item.width===0&&item.height===0));
});
test('PIN reset links require admin and revoke sessions only after redemption',async()=>{
 const token=(await request('/login',{username:'newuser',pin:'123456'})).body.token;
 assert.equal((await request('/admin/reset-pin',{targetUsername:'newuser'},staff)).status,403);
 const reset=await request('/admin/reset-pin',{targetUsername:'newuser'},admin);assert.equal(reset.status,200);assert.equal(reset.body.purpose,'reset');
 assert.equal((await request('/data',undefined,token)).status,200);
 assert.equal((await request('/invite/accept',{token:reset.body.token,action:'accept',newPin:'246810'})).status,200);
 assert.equal((await request('/data',undefined,token)).status,401);
 assert.equal((await request('/login',{username:'newuser',pin:'123456'})).status,401);
 assert.ok((await request('/login',{username:'newuser',pin:'246810'})).body.token);
 assert.equal((await request('/invite/accept',{token:reset.body.token,action:'accept',newPin:'111111'})).status,410);
});
test('administrators can unlock a locked account without changing its PIN',async()=>{
 for(let attempt=0;attempt<5;attempt++)await request('/login',{username:'staff',pin:'000000'});
 assert.equal((await request('/login',{username:'staff',pin:'654321'})).status,429);
 assert.equal((await request('/admin/unlock-user',{targetUsername:'staff'},staff)).status,403);
 const unlocked=await request('/admin/unlock-user',{targetUsername:'staff'},admin);assert.equal(unlocked.status,200);assert.equal(unlocked.body.lockedUntil,null);assert.equal(unlocked.body.failedLoginAttempts,0);
 assert.equal((await request('/login',{username:'staff',pin:'654321'})).status,200);
});
test('passcode reset requests notify admins without revealing account existence',async()=>{
 const known=await request('/passcode-reset-request',{username:'staff'});assert.equal(known.status,200);assert.match(known.body.message,/If the account exists/);
 const notices=(await request('/notifications',undefined,admin)).body.notifications;assert.ok(notices.some(item=>item.title==='Passcode reset requested'&&/staff/.test(item.message)&&item.link==='access'));
 const unknown=await request('/passcode-reset-request',{username:'not-a-user'});assert.equal(unknown.status,200);assert.equal(unknown.body.message,known.body.message);
});
test('admins can standardise an existing login while preserving access and a temporary alias',async()=>{
 assert.equal((await request('/admin/create-user',{targetUsername:'old.login',displayName:'Matthew Smith'},admin)).status,201);
 const setup=await setupUser('old.login','246810');assert.equal(setup.status,200);
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
test('personal site order defaults persist, validate and stay isolated from other users and orders',async()=>{
 assert.equal((await request('/profile')).status,401);
 assert.equal((await request('/admin/create-user',{targetUsername:'orderdefaults',displayName:'Defaults User',phone:'staff-only'},admin)).status,201);
 const token=(await setupUser('orderdefaults','456789')).body.token;
 const initial=(await request('/profile',undefined,token)).body.profile;
 assert.deepEqual(initial.siteOrderDefaults,{siteContact:'',phone:''});
 const otherBefore=(await request('/profile',undefined,admin)).body.profile;
 const ordersBefore=(await request('/orders',undefined,admin)).body.orders;
 const payload={displayName:'Defaults User',email:'',siteOrderDefaults:{siteContact:'  Taylor Site  ',phone:'  +61 (0) 400 000 000  '}};
 const saved=await request('/profile',{...payload,username:'admin',targetUsername:'admin',isAdmin:true},token);
 assert.equal(saved.status,200);
 assert.deepEqual(saved.body.profile.siteOrderDefaults,{siteContact:'Taylor Site',phone:'+61 (0) 400 000 000'});
 assert.deepEqual((await request('/profile',undefined,admin)).body.profile,otherBefore);
 const freshToken=(await request('/login',{username:'orderdefaults',pin:'456789'})).body.token;
 assert.deepEqual((await request('/profile',undefined,freshToken)).body.profile.siteOrderDefaults,saved.body.profile.siteOrderDefaults);
 // Older clients and photo-only changes must not wipe the new preferences.
 assert.equal((await request('/profile',{displayName:'Updated Name',email:'',profilePhoto:''},token)).status,200);
 assert.deepEqual((await request('/profile',undefined,token)).body.profile.siteOrderDefaults,saved.body.profile.siteOrderDefaults);
 const account=(await request('/admin/users',{},admin)).body.users.find(user=>user.username==='orderdefaults');
 assert.equal(account.phone,'staff-only');assert.equal(account.isAdmin,false);
 for(const value of [null,[],{siteContact:5,phone:''},{siteContact:'A'.repeat(101),phone:''},{siteContact:'A',phone:'0'.repeat(41)}]){
   assert.equal((await request('/profile',{...payload,displayName:'Must not save',siteOrderDefaults:value},token)).status,400);
 }
 assert.equal((await request('/profile',undefined,token)).body.profile.displayName,'Updated Name');
 assert.deepEqual((await request('/orders',undefined,admin)).body.orders,ordersBefore);
 const cleared=await request('/profile',{displayName:'Updated Name',email:'',siteOrderDefaults:{siteContact:'',phone:''}},token);
 assert.equal(cleared.status,200);assert.deepEqual(cleared.body.profile.siteOrderDefaults,{siteContact:'',phone:''});
});

test('SQL profiles store user information and task access is enforced',async()=>{
 assert.equal((await request('/admin/create-user',{targetUsername:'accessuser',displayName:'Access User'},admin)).status,201);
 const created=await setupUser('accessuser','456789');
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
 const payload={idempotencyKey:key,order:{project:'Harbour Tower',siteContact:'Michael',phone:'0434 578 760',orderType:'Fixings',requestedDeliveryDate:'2026-09-10',requestedDeliveryTime:'06:30',locationNotes:'Level 4',items:[{quantity:2,description:'L4 fascia panel'}]}};
 const first=await request('/orders',payload,staff);assert.equal(first.status,201,JSON.stringify(first));assert.equal(first.body.order.requestedBy,'staff');
 const again=await request('/orders',payload,staff);assert.equal(again.status,200);assert.equal(again.body.duplicate,true);assert.equal(again.body.order.id,first.body.order.id);
 const listed=await request('/orders',undefined,staff);assert.equal(listed.body.orders.filter(order=>order.id===first.body.order.id).length,1);
 const progressUrl='/orders/'+first.body.order.id+'/progress';
 assert.equal((await request(progressUrl)).status,401);
 const production=await request(progressUrl,undefined,staff);assert.equal(production.status,200);
 assert.equal(production.body.progress.orderId,first.body.order.id);assert.equal(production.body.progress.stages.length,7);
 assert.ok(production.body.progress.stages.slice(0,-1).every(stage=>stage.state==='not_applicable'));
 assert.equal(production.body.progress.stages.at(-1).state,'pending');
 assert.equal((await request('/orders/11111111-1111-4111-8111-111111111111/progress',undefined,staff)).status,404);
 assert.equal((await request('/data',undefined,staff)).body.revision,before.revision);

 const sharedOrders=async()=>{const response=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-cnc-share&report=site-orders');assert.equal(response.status,200);return response.text();};
 const initialFeed=await sharedOrders();assert.match(initialFeed,/Harbour Tower/);assert.match(initialFeed,/Level 4/);assert.doesNotMatch(initialFeed,/0434 578 760|Michael|L4 fascia panel/);
 assert.equal((await request('/orders/'+first.body.order.id+'/status',{status:'approved'},staff)).status,403);
 const approved=await request('/orders/'+first.body.order.id+'/status',{status:'approved',expectedUpdatedAt:first.body.order.updatedAt},admin);assert.equal(approved.body.order.status,'approved');
 const stale=await request('/orders/'+first.body.order.id+'/status',{status:'cancelled',expectedUpdatedAt:first.body.order.updatedAt},admin);assert.equal(stale.status,409);assert.equal(stale.body.code,'ORDER_CONFLICT');assert.equal(stale.body.order.status,'approved');
 assert.equal((await request('/orders/'+first.body.order.id+'/status',{status:'cancelled'},admin)).status,409);
 assert.equal((await request('/orders/'+first.body.order.id,{order:{...first.body.order,project:'Blocked edit'}},staff)).status,403);
 const edited=await request('/orders/'+first.body.order.id,{expectedUpdatedAt:approved.body.order.updatedAt,order:{...first.body.order,project:'Updated project',status:'ordered',scheduledDeliveryDate:'2026-09-10',scheduledDeliveryTime:'09:30',items:[{quantity:3,description:'Updated panel'}]}},admin);
 assert.equal(edited.status,200,JSON.stringify(edited));assert.equal(edited.body.order.project,'Updated project');assert.equal(edited.body.order.status,'ordered');assert.equal(edited.body.order.orderNumber,first.body.order.orderNumber);assert.equal(edited.body.order.requestedBy,'staff');
 const staleEdit=await request('/orders/'+first.body.order.id,{expectedUpdatedAt:approved.body.order.updatedAt,order:{...edited.body.order,locationNotes:'Stale overwrite'}},admin);assert.equal(staleEdit.status,409);assert.equal(staleEdit.body.order.locationNotes,'Level 4');
 const alerts=(await request('/notifications',undefined,staff)).body.notifications.filter(item=>item.kind==='orders'&&item.message.includes('Updated project'));assert.equal(alerts.length,1);assert.match(alerts[0].message,/Confirmed delivery date: 2026-09-10/);
 const noChange=await request('/orders/'+first.body.order.id+'/status',{status:'ordered',expectedUpdatedAt:edited.body.order.updatedAt},admin);assert.equal(noChange.status,200);
 assert.equal((await request('/notifications',undefined,staff)).body.notifications.filter(item=>item.kind==='orders'&&item.message.includes('Updated project')).length,1);
 const updatedFeed=await sharedOrders();assert.match(updatedFeed,/Updated project/);assert.doesNotMatch(updatedFeed,/Harbour Tower/);
 const after=(await request('/data',undefined,staff)).body;assert.equal(after.revision,before.revision);assert.deepEqual(after.variants,before.variants);
 const pdf=await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/pdf',{headers:{Authorization:'Bearer '+staff}});
 assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(pdf.headers.get('x-panelstock-pdf-renderer'),'fallback');assert.equal(new TextDecoder().decode(await pdf.arrayBuffer()).startsWith('%PDF-1.4'),true);
 const link=await request('/orders/'+first.body.order.id+'/pdf-link',{},staff);assert.equal(link.status,200);assert.match(link.body.pdfToken,/^[a-f0-9]{64}$/);
 const linkedPdf=await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/pdf?ticket='+link.body.pdfToken);
 assert.equal(linkedPdf.status,200);assert.match(linkedPdf.headers.get('content-disposition'),/^inline; filename="Order_1_Updated_project\.pdf";/);assert.equal(new TextDecoder().decode(await linkedPdf.arrayBuffer()).startsWith('%PDF-1.4'),true);
 assert.equal((await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/pdf?ticket='+link.body.pdfToken)).status,404);
 const downloadLink=await request('/orders/'+first.body.order.id+'/pdf-link',{},staff);
 const downloadedPdf=await mf.dispatchFetch('http://localhost/orders/'+first.body.order.id+'/pdf?download=1&ticket='+downloadLink.body.pdfToken);
 assert.equal(downloadedPdf.status,200);assert.match(downloadedPdf.headers.get('content-disposition'),/^attachment; filename="Order_1_Updated_project\.pdf";/);
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
test('damage reasons can explicitly make photo evidence optional',async()=>{
 const optional={id:'reason-photo-optional',label:'Test optional photo',code:'098',photoOptional:true};
 const required={id:'reason-photo-required',label:'Test required photo',code:'099',photoOptional:false};
 let data=(await request('/data',undefined,admin)).body;
 assert.equal((await request('/mutations',{mutationId:crypto.randomUUID(),restoreEpoch:data.restoreEpoch,changes:[{field:'reasons',id:optional.id,before:null,after:optional},{field:'reasons',id:required.id,before:null,after:required}]},admin)).status,200);
 data=(await request('/data',undefined,staff)).body;let variant=data.variants.find(value=>value.qty>0);assert.ok(variant);
 const optionalTx={id:'damage-photo-optional',type:'damage',desc:'Optional evidence damage',qty:1,itemType:'variant',sku:variant.sku,reason:optional.label,reasonCode:optional.code,photoIds:[],timestamp:new Date().toISOString()};
 assert.equal((await request('/mutations',{mutationId:crypto.randomUUID(),restoreEpoch:data.restoreEpoch,changes:[{field:'variants',id:variant.id,before:variant,after:{...variant,qty:variant.qty-1}},{field:'transactions',id:optionalTx.id,before:null,after:optionalTx}]},staff)).status,200);
 data=(await request('/data',undefined,staff)).body;variant=data.variants.find(value=>value.id===variant.id);
 const requiredTx={...optionalTx,id:'damage-photo-required',reason:required.label,reasonCode:required.code};
 assert.equal((await request('/mutations',{mutationId:crypto.randomUUID(),restoreEpoch:data.restoreEpoch,changes:[{field:'variants',id:variant.id,before:variant,after:{...variant,qty:variant.qty-1}},{field:'transactions',id:requiredTx.id,before:null,after:requiredTx}]},staff)).status,400);
});

test('workshop stock is authenticated, durable, idempotent and included in stock backups',async()=>{
 assert.equal((await request('/workshop-stock')).status,401);
 const initial=await request('/workshop-stock',undefined,admin);assert.equal(initial.status,200);
 const body={action:'create',mutationId:crypto.randomUUID(),expectedRevision:initial.body.revision,item:{category:'consumables',name:'Sealant',sku:'WS-SEALANT',unit:'tubes',qty:10,reorderLevel:3}};
 assert.equal((await request('/workshop-stock',body,staff)).status,403);
 const made=await request('/workshop-stock',body,admin);assert.equal(made.status,200);const item=made.body.items.find(i=>i.sku==='WS-SEALANT');assert.equal(item.qty,10);
 assert.equal((await request('/workshop-stock',body,admin)).body.duplicate,true);
 const reserve={action:'reserve',itemId:item.id,quantity:4,job:'Workshop test',expectedRevision:made.body.revision,mutationId:crypto.randomUUID()};
 const allocated=await request('/workshop-stock',reserve,admin);assert.equal(allocated.status,200);assert.equal(allocated.body.items.find(i=>i.id===item.id).available,6);
 const backup=await request('/admin/backup-now',{},admin);assert.equal(backup.status,200);
 const use={...reserve,action:'use',expectedRevision:allocated.body.revision,mutationId:crypto.randomUUID(),quantity:2};assert.equal((await request('/workshop-stock',use,admin)).status,200);
 const revision=(await request('/data',undefined,admin)).body.revision;
 assert.equal((await request('/admin/restore-backup',{timestamp:backup.body.takenAt,expectedRevision:revision},admin)).status,200);
 const restored=(await request('/workshop-stock',undefined,admin)).body;
 assert.equal(restored.items.find(i=>i.id===item.id).qty,10);assert.equal(restored.items.find(i=>i.id===item.id).reserved,4);assert.ok(restored.movements.some(m=>m.action==='use'&&m.itemId===item.id));
 assert.equal((await request('/workshop-stock',{...use,mutationId:crypto.randomUUID()},admin)).status,409);
});

test('delivery receipts are protected, retry-safe, visible in history and lock item definitions',async()=>{
 const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Delivery receipt test',siteContact:'Site',phone:'0400000000',orderType:'Fixings',requestedDeliveryDate:'2026-10-10',items:[{quantity:5,description:'Receipt panel'}]}},staff);assert.equal(created.status,201);const order=created.body.order;
 const body={id:crypto.randomUUID(),expectedUpdatedAt:order.updatedAt,lines:[{index:0,accepted:2,damaged:1,missing:2}],notes:'Partial delivery'};
 const saved=await request('/orders/'+order.id+'/receipts',body,staff);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.order.receipts.length,1);
 const duplicate=await request('/orders/'+order.id+'/receipts',body,staff);assert.equal(duplicate.body.duplicate,true);
 const stale=await request('/orders/'+order.id+'/receipts',{...body,id:crypto.randomUUID()},staff);assert.equal(stale.status,409);assert.equal(stale.body.code,'ORDER_CONFLICT');
 const history=await request('/orders/'+order.id+'/history',undefined,staff);assert.ok(history.body.events.some(event=>event.label==='Delivery receipt recorded'));
 const changed=await request('/orders/'+order.id,{expectedUpdatedAt:saved.body.order.updatedAt,order:{...saved.body.order,items:[{quantity:8,description:'Changed'}]}},admin);assert.equal(changed.status,409);assert.match(changed.body.error,/cannot change/);
 const alerts=(await request('/notifications',undefined,admin)).body.notifications.filter(item=>item.message.includes('Delivery receipt test'));assert.equal(alerts.length,1);assert.match(alerts[0].message,/3 outstanding/);
});

test('delivery issues support manager assignment, audited corrections and replacement resolution through the API',async()=>{
 const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Issue workflow',siteContact:'Site',phone:'0400000000',orderType:'Panels',requestedDeliveryDate:'2026-10-15',items:[{quantity:4,description:'Replacement panel'}]}},staff);assert.equal(created.status,201);let order=created.body.order;
 const receipt=await request('/orders/'+order.id+'/receipts',{id:crypto.randomUUID(),expectedUpdatedAt:order.updatedAt,lines:[{index:0,accepted:1,damaged:2,missing:1}]},staff);assert.equal(receipt.status,200);order=receipt.body.order;const issue=order.deliveryIssues[0];assert.equal(issue.quantity,3);
 assert.equal((await request('/delivery-issues',undefined,staff)).status,403);const queue=await request('/delivery-issues',undefined,admin);assert.ok(queue.body.issues.some(item=>item.id===issue.id));
 const assigned=await request('/orders/'+order.id+'/delivery-issues',{issueId:issue.id,expectedUpdatedAt:order.updatedAt,assignedTo:'admin',replacementDate:'2026-10-16',status:'in_progress'},admin);assert.equal(assigned.status,200);order=assigned.body.order;
 const fixed=await request('/orders/'+order.id+'/receipt-amendments',{mutationId:crypto.randomUUID(),receiptId:receipt.body.receipt.id,expectedUpdatedAt:order.updatedAt,reason:'One item marked damaged was missing',lines:[{index:0,accepted:1,damaged:1,missing:2}]},admin);assert.equal(fixed.status,200);order=fixed.body.order;assert.equal(order.receipts[0].amendments.length,1);
 const replacement=await request('/orders/'+order.id+'/receipts',{id:crypto.randomUUID(),expectedUpdatedAt:order.updatedAt,lines:[{index:0,accepted:3,replacementIssueId:issue.id}]},admin);assert.equal(replacement.status,200);assert.equal(replacement.body.order.deliveryIssues[0].status,'resolved');
 const alerts=await request('/notifications',undefined,staff);assert.ok(alerts.body.notifications.some(item=>item.title.includes('issue resolved')&&item.message.includes('Issue workflow')));
 const history=await request('/orders/'+order.id+'/history',undefined,staff);assert.ok(history.body.events.some(event=>event.label==='Delivery receipt corrected'));
});

test('admins configure creation emails and idempotent orders queue one recipient snapshot without network sending in staging',async()=>{
 assert.equal((await request('/order-email-settings',undefined,staff)).status,403);
 const config=await request('/order-email-settings',{enabled:true,recipients:['office@example.com']},admin);assert.equal(config.status,200);assert.equal(config.body.providerReady,false);
 const body={idempotencyKey:crypto.randomUUID(),order:{project:'Email test',siteContact:'Site',phone:'0400000000',orderType:'Panels',requestedDeliveryDate:'2026-10-15',items:[{quantity:2,description:'Email panel'}]}};
 const created=await request('/orders',body,staff);assert.equal(created.status,201);await request('/orders',body,staff);
 const settings=await request('/order-email-settings',undefined,admin),jobs=settings.body.jobs.filter(job=>job.id===created.body.order.id);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'queued');assert.deepEqual(jobs[0].recipients,['office@example.com']);assert.ok(jobs[0].orderedBy.includes('staff'));
 await request('/order-email-settings',{enabled:false,recipients:[]},admin);
});

test('Other type descriptions persist with orders, survive legacy edits and clear on a different type',async()=>{
 const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Other type test',siteContact:'Site',phone:'0400000000',orderType:'Other',orderTypeOther:'Safety signage',requestedDeliveryDate:'2026-10-15',items:[{quantity:1,description:'Sign'}]}},staff);assert.equal(created.status,201);assert.equal(created.body.order.orderTypeOther,'Safety signage');
 const legacy={...created.body.order};delete legacy.orderTypeOther;
 const edited=await request('/orders/'+legacy.id,{expectedUpdatedAt:legacy.updatedAt,order:legacy},admin);assert.equal(edited.status,200);assert.equal(edited.body.order.orderTypeOther,'Safety signage');
 const changed=await request('/orders/'+legacy.id,{expectedUpdatedAt:edited.body.order.updatedAt,order:{...edited.body.order,orderType:'Panels'}},admin);assert.equal(changed.status,200);assert.equal(changed.body.order.orderTypeOther,'');
});

test('empty report test requests behave like an empty object while malformed JSON is rejected',async()=>{
 const send=body=>mf.dispatchFetch('http://localhost/send-now',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+admin},body});
 const expected=await send('{}'),empty=await send('');
 assert.equal(expected.status,503);
 assert.equal(empty.status,expected.status);
 assert.deepEqual(await empty.json(),await expected.json());
 for(const body of ['{','null','[]']){
  const response=await send(body);assert.equal(response.status,400);
  assert.equal((await response.json()).error,'Invalid JSON object');
 }
});


test('panel orders reject manual edits and status changes even for admins',async()=>{
 const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Panel lock test',siteContact:'Test',phone:'123',orderType:'Panels',requestedDeliveryDate:'2026-10-15',items:[{quantity:1,description:'Panel'}]}},staff);
 assert.equal(created.status,201);const order=created.body.order;
 for(const status of ['ordered','in_stock','completed','cancelled']){
  const response=await request('/orders/'+order.id+'/status',{status,expectedUpdatedAt:order.updatedAt},admin);
  assert.equal(response.status,403);assert.match(response.body.error,/Panel orders are read-only/);
 }
 const edited=await request('/orders/'+order.id,{expectedUpdatedAt:order.updatedAt,order:{...order,orderType:'Other',status:'completed'}},admin);
 assert.equal(edited.status,403);
 const saved=(await request('/orders',undefined,admin)).body.orders.find(value=>value.id===order.id);
 assert.equal(saved.orderType,'Panels');assert.equal(saved.status,'submitted');assert.equal(saved.updatedAt,order.updatedAt);
});
test('other orders can move through in stock to dispatch readiness with conflict protection',async()=>{
 const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Stock readiness test',siteContact:'Test',phone:'123',orderType:'Fixings',requestedDeliveryDate:'2026-10-15',items:[{quantity:5,description:'Bolts'}]}},staff);
 assert.equal(created.status,201);let order=created.body.order;
 const stocked=await request('/orders/'+order.id+'/status',{status:'in_stock',expectedUpdatedAt:order.updatedAt},admin);
 assert.equal(stocked.status,200);assert.equal(stocked.body.order.status,'in_stock');
 const stale=await request('/orders/'+order.id+'/status',{status:'completed',expectedUpdatedAt:order.updatedAt},admin);
 assert.equal(stale.status,409);assert.equal(stale.body.order.status,'in_stock');order=stocked.body.order;
 const complete=await request('/orders/'+order.id,{expectedUpdatedAt:order.updatedAt,order:{...order,status:'completed'}},admin);
 assert.equal(complete.status,200);assert.equal(complete.body.order.status,'completed');
 const data=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-cnc-share&report=site-orders');
 assert.equal(data.status,200);const html=await data.text(),row=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].find(match=>match[1].includes(order.id));assert.ok(row,'Completed order appears in the shared feed');const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1]);assert.equal(cells[7],'Ready for dispatch');assert.equal(cells[8],'N/A');assert.equal(cells[14],'✓');
});

test('completion locks all status writes and editor status changes while permitting other edits',async()=>{
 const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Completed lock test',siteContact:'Test',phone:'123',orderType:'Fixings',requestedDeliveryDate:'2026-10-15',items:[{quantity:2,description:'Bolts'}]}},staff);
 assert.equal(created.status,201);const initial=created.body.order;
 const complete=await request('/orders/'+initial.id+'/status',{status:'completed',expectedUpdatedAt:initial.updatedAt},admin);
 assert.equal(complete.status,200);const order=complete.body.order;
 for(const status of ['submitted','approved','ordered','in_stock','cancelled','completed']){
  const response=await request('/orders/'+order.id+'/status',{status,expectedUpdatedAt:order.updatedAt},admin);
  assert.equal(response.status,409);assert.match(response.body.error,/Completed order status is locked/);
 }
 for(const status of ['submitted','approved','ordered','in_stock','cancelled']){
  const response=await request('/orders/'+order.id,{expectedUpdatedAt:order.updatedAt,order:{...order,status}},admin);
  assert.equal(response.status,409);assert.match(response.body.error,/Completed order status is locked/);
 }
 const saved=(await request('/orders',undefined,admin)).body.orders.find(value=>value.id===order.id);
 assert.equal(saved.status,'completed');assert.equal(saved.updatedAt,order.updatedAt);
 const edited=await request('/orders/'+order.id,{expectedUpdatedAt:order.updatedAt,order:{...order,locationNotes:'Updated delivery note'}},admin);
 assert.equal(edited.status,200);assert.equal(edited.body.order.status,'completed');
 assert.equal(edited.body.order.locationNotes,'Updated delivery note');
 const noStatus={...edited.body.order,locationNotes:'Status remains completed'};delete noStatus.status;
 const preserved=await request('/orders/'+order.id,{expectedUpdatedAt:edited.body.order.updatedAt,order:noStatus},admin);
 assert.equal(preserved.status,200);assert.equal(preserved.body.order.status,'completed');
 const stale=await request('/orders/'+order.id+'/status',{status:'ordered',expectedUpdatedAt:initial.updatedAt},admin);
 assert.equal(stale.status,409);assert.equal(stale.body.code,'ORDER_CONFLICT');assert.equal(stale.body.order.status,'completed');
});


test('production summaries require order-view permission without exposing CNC or QA records',async()=>{
 const username='progressviewer';
 assert.equal((await request('/admin/create-user',{targetUsername:username,displayName:'Progress Viewer'},admin)).status,201);
 await setupUser(username,'456789');
 const tasks=(await request('/admin/users',{},admin)).body.tasks.map(task=>task.code);
 await request('/admin/set-task-access',{targetUsername:username,taskCodes:tasks,allowed:false},admin);
 const login=async()=>{
   const response=await mf.dispatchFetch('http://localhost/login',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.50'},body:JSON.stringify({username,pin:'456789'})});
   assert.equal(response.status,200);return (await response.json()).token;
 };
 let token=await login();
 const order=(await request('/orders',undefined,admin)).body.orders[0];assert.ok(order);
 const url='/orders/'+order.id+'/progress';assert.equal((await request(url,undefined,token)).status,403);
 await request('/admin/set-task-access',{targetUsername:username,taskCode:'site.orders.view',allowed:true},admin);
 token=await login();
 assert.equal((await request('/site/cnc',undefined,token)).status,403);assert.equal((await request('/qa',undefined,token)).status,403);
 const result=await request(url,undefined,token);assert.equal(result.status,200);
 assert.deepEqual(Object.keys(result.body.progress),['orderId','cancelled','stages','notes']);
 assert.ok(result.body.progress.stages.every(stage=>Object.keys(stage).join(',')==='label,state'));
});
