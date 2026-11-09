import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {orderTemplateFixture} from './order-template-fixture.mjs';
import {qaInspectionPhotoGallery} from '../src/qa-photos.js';
const here=path.dirname(fileURLToPath(import.meta.url)),built=process.env.WORKER_BUNDLE||path.resolve(here,'../dist/index.js'),png='data:image/png;base64,aGVsbG8=',jpeg='data:image/jpeg;base64,d29ybGQ=',webp='data:image/webp;base64,dGhpcmQ=';
let mf,admin,team,viewer,checks,saved,failed,replacement;
async function request(route,body,token,method=body===undefined?'GET':'POST'){
 const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
const login=async(username,pin)=>(await request('/login',{username,pin})).body.token;
const photoPayload=(item,photos=[jpeg],mutationId=crypto.randomUUID())=>({id:item.id,kind:item.kind,attemptId:item.latest.id,photos,mutationId});
const panel=(id,orderNumber,panelNumber,extra={})=>({id,jobReference:'Photo Project',orderNumber,sheetNumber:'1',panelNumber,status:'completed',completedAt:'2099-01-01T00:00:00Z',completedBy:'admin',stockColor:'White',...extra});
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'qa-photo-append-test',modules:true,script:fs.readFileSync(built,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:'photo-test',CNC_PUBLIC_TOKEN:'photo-share',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:'http://localhost:8080,https://web.panelstockhq.com,https://app.panelstockhq.com,https://site.panelstockhq.com'}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV'),pinHash=(pin,user)=>createHash('sha256').update(`${pin}:${user}:panelstock`).digest('hex');
 await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:pinHash('123456','admin')},'qa-team':{isAdmin:false,pinHash:pinHash('654321','qa-team')},'no-qa':{isAdmin:false,pinHash:pinHash('456789','no-qa')}}));
 await kv.put('registration_code','987654');await kv.put('site-order-cover-template',await orderTemplateFixture());
 for(const [field,value] of Object.entries({variants:[],catalog:[],offcuts:[],transactions:[],reasons:[],photos:{},cncPanels:[panel('append-approved','001','P1'),panel('append-failed','002','F1'),panel('append-remake','002','F1',{sheetNumber:'2',completedAt:'2099-01-02T00:00:00Z',isRemake:true,remakeReason:'Replacement for QA failure'}),panel('append-exempt','003','E1'),panel('append-awaiting','004','A1')]}))await kv.put('app:'+field,JSON.stringify(value));
 admin=await login('admin','123456');team=await login('qa-team','654321');viewer=await login('no-qa','456789');assert.ok(admin&&team&&viewer);
 const tasks=(await request('/admin/users',{},admin)).body.tasks.map(task=>task.code);
 for(const targetUsername of ['qa-team','no-qa'])assert.equal((await request('/admin/set-task-access',{targetUsername,taskCodes:tasks,allowed:false},admin)).status,200);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'qa-team',taskCode:'factory.qa',allowed:true},admin)).status,200);
 team=await login('qa-team','654321');viewer=await login('no-qa','456789');checks=(await request('/qa',undefined,team)).body.checklists;
 const results=Object.fromEntries(checks.panel.map(([key])=>[key,'pass']));
 const approved=await request('/qa/check',{id:'append-approved',kind:'panel',results,photo:png,overrideReason:'Synthetic inspection by the qualified administrator'},admin);assert.equal(approved.status,200);saved=approved.body.item;
 const failResults={...results,[checks.panel[0][0]]:'fail'},failure=await request('/qa/check',{id:'append-failed',kind:'panel',results:failResults,notes:'Face needs a new CNC recut',photo:png},admin);assert.equal(failure.status,200);failed=failure.body.item;
 const remake=await request('/qa/check',{id:'append-remake',kind:'panel',results,photo:png,overrideReason:'Synthetic replacement inspected by administrator'},admin);assert.equal(remake.status,200);replacement=remake.body.item;
 const load=(await request('/dispatch/panels',undefined,admin)).body.loads.find(load=>load.panelIds.includes(saved.id));assert.ok(load.readyForSite);
 assert.equal((await request('/dispatch/panels',{id:load.id,action:'dispatch',destinationType:'site',destination:'Photo test site',transport:'Truck',driver:'Driver'},admin)).status,200);
});
after(async()=>{await mf?.dispose();});

test('factory QA team appends photos to a dispatched approval without reopening QA; concurrent uploads and retries retain every photo exactly once',async()=>{
 const body=photoPayload(saved),beforeItem=(await request('/qa',undefined,team)).body.items.find(item=>item.id===saved.id),beforeLoads=(await request('/dispatch/panels',undefined,admin)).body.loads,beforeNotifications=(await request('/notifications',undefined,admin)).body.notifications;
 assert.equal((await request('/qa/photos',body)).status,401);assert.equal((await request('/qa/photos',body,viewer)).status,403);
 assert.equal((await request('/qa/check',{id:saved.id,kind:'panel',results:saved.latest.results,photo:png},team)).status,403);
 assert.equal((await request('/qa/report',{project:saved.project,orderNumber:saved.orderNumber},team)).status,403);
 const first=await request('/qa/photos',body,team);assert.equal(first.status,200);assert.equal(first.body.idempotent,false);assert.equal(first.body.addition.addedBy,'qa-team');assert.ok(first.body.addition.addedAt);
 assert.deepEqual(first.body.item.latest,beforeItem.latest);assert.deepEqual(first.body.item.history,beforeItem.history);assert.equal(first.body.item.status,'approved');assert.equal(first.body.item.latest.photo,png);assert.deepEqual(qaInspectionPhotoGallery(first.body.item,first.body.item.latest),[png,jpeg]);
 const concurrent=await Promise.all([request('/qa/photos',photoPayload(saved,[webp]),team),request('/qa/photos',photoPayload(saved,[jpeg]),team)]);assert.ok(concurrent.every(result=>result.status===200));
 let current=(await request('/qa',undefined,team)).body.items.find(item=>item.id===saved.id);assert.equal(current.photoAdditions.length,3);assert.equal(qaInspectionPhotoGallery(current,current.latest).length,4);
 const fill=photoPayload(saved,Array(6).fill(jpeg)),filled=await request('/qa/photos',fill,team);assert.equal(filled.status,200);assert.equal(qaInspectionPhotoGallery(filled.body.item,filled.body.item.latest).length,10);
 const retry=await request('/qa/photos',body,team);assert.equal(retry.status,200);assert.equal(retry.body.idempotent,true);assert.deepEqual(retry.body.addition,first.body.addition);assert.equal(retry.body.item.photoAdditions.length,4);
 assert.equal((await request('/qa/photos',photoPayload(saved),team)).status,409);
 for(const changed of [{photos:[webp]},{id:failed.id,attemptId:failed.latest.id},{kind:'metalwork'}])assert.equal((await request('/qa/photos',{...body,...changed},team)).status,409);
 assert.equal((await request('/qa/photos',body,admin)).status,409);
 current=(await request('/qa',undefined,team)).body.items.find(item=>item.id===saved.id);assert.deepEqual(current.latest,beforeItem.latest);assert.deepEqual(current.history,beforeItem.history);
 assert.deepEqual((await request('/dispatch/panels',undefined,admin)).body.loads,beforeLoads);assert.deepEqual((await request('/notifications',undefined,admin)).body.notifications,beforeNotifications);
 const report=await request('/qa/report',{project:saved.project,orderNumber:saved.orderNumber},admin);assert.equal(report.status,200);assert.deepEqual(report.body.report.items.find(item=>item.id===saved.id).photoAdditions,current.photoAdditions);
 // A later real reinspection remains an explicit administrator action and keeps all supplements tied to the old attempt.
 const checked=await request('/qa/check',{id:saved.id,kind:'panel',results:saved.latest.results,photo:webp,overrideReason:'Synthetic later inspection'},admin);assert.equal(checked.status,200);assert.notEqual(checked.body.item.latest.id,saved.latest.id);assert.deepEqual(checked.body.item.photoAdditions,current.photoAdditions);assert.deepEqual(checked.body.item.history[0],beforeItem.history[0]);assert.deepEqual(qaInspectionPhotoGallery(checked.body.item,checked.body.item.latest),[webp]);
});

test('replaced failures retain the failed result and legacy single photo; malformed evidence, absent inspections and encoded limits cause no changes',async()=>{
 const before=(await request('/qa',undefined,team)).body.items.find(item=>item.id===failed.id);assert.equal(before.status,'replaced');const body=photoPayload(before,[jpeg,webp]);
 for(const invalid of [null,[],{}, {...body,attemptId:'not-saved'}, {...body,photos:[]}, {...body,photos:[null]}, {...body,photos:['']}, {...body,photos:['data:image/gif;base64,aGVsbG8=']}, {...body,photos:Array(11).fill(jpeg)}]){
  const result=await request('/qa/photos',invalid,team);assert.ok([400,404].includes(result.status));
 }
 const sizedPhoto=size=>'data:image/png;base64,'+'A'.repeat(size-'data:image/png;base64,'.length);
 assert.equal((await request('/qa/photos',{...body,photos:[sizedPhoto(1500001)]},team)).status,400);
 assert.equal((await request('/qa/photos',{...body,photos:Array(5).fill(sizedPhoto(1300000))},team)).status,409);
 assert.deepEqual((await request('/qa',undefined,team)).body.items.find(item=>item.id===failed.id),before);
 const appended=await request('/qa/photos',body,team);assert.equal(appended.status,200);assert.equal(appended.body.item.status,'replaced');assert.deepEqual(appended.body.item.latest,before.latest);assert.deepEqual(appended.body.item.history,before.history);assert.deepEqual(qaInspectionPhotoGallery(appended.body.item,appended.body.item.latest),[png,jpeg,webp]);assert.equal(appended.body.item.replacementId,replacement.id);
 const metal=await request('/qa/metalwork',{project:'Metalwork photo supplements',orderNumber:'M1',reference:'Bracket',quantity:1,fabricatedBy:'admin'},team);assert.equal(metal.status,201);
 const metalCheck=await request('/qa/check',{id:metal.body.item.id,kind:'metalwork',results:Object.fromEntries(checks.metalwork.map(([key])=>[key,'pass'])),photo:png},team);assert.equal(metalCheck.status,200);
 const metalUpload=await request('/qa/photos',photoPayload(metalCheck.body.item,[jpeg,webp]),team);assert.equal(metalUpload.status,200);assert.deepEqual(metalUpload.body.item.latest,metalCheck.body.item.latest);assert.deepEqual(qaInspectionPhotoGallery(metalUpload.body.item,metalUpload.body.item.latest),[png,jpeg,webp]);
 const candidate=(await request('/qa/panels/exemptions',undefined,admin)).body.items.find(item=>item.id==='append-exempt');assert.ok(candidate);
 const exempt=await request('/qa/panels/exemptions',{action:'grant',reason:'No QA needed for this sample',panels:[{id:candidate.id,cutAt:candidate.cutAt,productionSignature:candidate.qaProductionSignature,expectedExemptionId:null}]},admin);assert.equal(exempt.status,200);
 assert.equal((await request('/qa/photos',{...body,id:candidate.id,attemptId:'invented',mutationId:crypto.randomUUID()},team)).status,404);
 assert.equal((await request('/qa/photos',{...body,id:'append-awaiting',attemptId:'invented',mutationId:crypto.randomUUID()},team)).status,404);
});

test('QA team can supplement saved Gate inspections after dispatch and after their production revision is withdrawn, without changing orders',async()=>{
 assert.equal((await request('/order-types',{name:'Gate'},admin)).status,200);
 const makeGate=async(project)=>{
  const created=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project,siteContact:'Gate contact',phone:'PRIVATE-GATE-PHOTO-PHONE',orderType:'Gate',villa:'Villa 12',colour:'Spruce',requestedDeliveryDate:'2026-11-12',items:[{quantity:1,description:'GATE A'}]}},admin);assert.equal(created.status,201);
  let order=created.body.order;const drawn=await request('/orders/'+order.id+'/progress',{expectedUpdatedAt:order.updatedAt,areaM2:12.5,stages:{drawn:'complete'}},admin);assert.equal(drawn.status,200);order=drawn.body.order;
  const qa=(await request('/qa',undefined,team)).body,item=qa.items.find(item=>item.gateOrderId===order.id),results=Object.fromEntries(qa.checklists.gate.map(([key])=>[key,'pass']));
  const inspected=await request('/qa/check',{id:item.id,kind:'metalwork',results,photos:[png,jpeg]},team);assert.equal(inspected.status,200);
  order=(await request('/orders/'+order.id,undefined,admin)).body.order;return {order,item:inspected.body.item};
 };
 const dispatched=await makeGate('Dispatched Gate photo supplements');let sent=await request('/dispatch/orders',{id:dispatched.order.id,expectedUpdatedAt:dispatched.order.updatedAt,mutationId:crypto.randomUUID(),destination:'Gate site',transport:'Truck',driver:'Driver'},admin);assert.equal(sent.status,200);
 let before=(await request('/orders/'+dispatched.order.id,undefined,admin)).body.order;
 const upload=await request('/qa/photos',photoPayload(dispatched.item,[webp]),team);assert.equal(upload.status,200);assert.deepEqual(upload.body.item.latest,dispatched.item.latest);assert.deepEqual(qaInspectionPhotoGallery(upload.body.item,upload.body.item.latest),[png,jpeg,webp]);assert.deepEqual((await request('/orders/'+before.id,undefined,admin)).body.order,before);
 const withdrawn=await makeGate('Withdrawn Gate photo supplements');const reset=await request('/orders/'+withdrawn.order.id+'/progress',{expectedUpdatedAt:withdrawn.order.updatedAt,stages:{drawn:'pending'}},admin);assert.equal(reset.status,200);before=(await request('/orders/'+withdrawn.order.id,undefined,admin)).body.order;
 assert.equal((await request('/qa',undefined,team)).body.items.some(item=>item.id===withdrawn.item.id),false);
 const historical=await request('/qa/photos',photoPayload(withdrawn.item,[webp]),team);assert.equal(historical.status,200);assert.equal(historical.body.item.gateRevision,withdrawn.item.gateRevision);assert.deepEqual(historical.body.item.latest,withdrawn.item.latest);assert.deepEqual((await request('/orders/'+before.id,undefined,admin)).body.order,before);
});
