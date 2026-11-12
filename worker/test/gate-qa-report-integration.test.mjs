import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {orderTemplateFixture} from './order-template-fixture.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),built=process.env.WORKER_BUNDLE||path.resolve(here,'../dist/index.js'),png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let mf,admin,team,viewer;
const createEnvironment=enabled=>new Miniflare(convertV4MiniflareOptions({workers:[{name:'gate-qa-overview-'+enabled,modules:true,script:fs.readFileSync(built,'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:'gate-report-test',GATE_COMPONENTS_ENABLED:String(enabled),CNC_PUBLIC_TOKEN:'gate-report-share',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:'http://localhost:8080,https://web.panelstockhq.com,https://app.panelstockhq.com,https://site.panelstockhq.com'}}]}));
async function request(route,body,token=admin,environment=mf){const response=await environment.dispatchFetch('http://localhost'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
async function seed(environment){
 const kv=await environment.getKVNamespace('LEGACY_KV'),users={};for(const [username,pin,isAdmin]of [['admin','123456',true],['qa-team','654321',false],['viewer','456789',false]])users[username]={isAdmin,pinHash:createHash('sha256').update(`${pin}:${username}:panelstock`).digest('hex')};
 await kv.put('users',JSON.stringify(users));await kv.put('registration_code','987654');await kv.put('site-order-cover-template',await orderTemplateFixture());
 for(const [key,value]of Object.entries({variants:[],catalog:[],offcuts:[],transactions:[],reasons:[],photos:{},cncPanels:[]}))await kv.put('app:'+key,JSON.stringify(value));
 const login=async(username,pin)=>(await request('/login',{username,pin},null,environment)).body.token,a=await login('admin','123456');await login('qa-team','654321');await login('viewer','456789');
 const tasks=(await request('/admin/users',{},a,environment)).body.tasks.map(task=>task.code);
 for(const targetUsername of ['qa-team','viewer'])assert.equal((await request('/admin/set-task-access',{targetUsername,taskCodes:tasks,allowed:false},a,environment)).status,200);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'qa-team',taskCode:'factory.qa',allowed:true},a,environment)).status,200);
 return {admin:a,team:await login('qa-team','654321'),viewer:await login('viewer','456789')};
}
before(async()=>{mf=createEnvironment(true);({admin,team,viewer}=await seed(mf));});
after(async()=>{await mf?.dispose();});
const payload=(project,orderType='Bin Gate',quantity=1)=>({idempotencyKey:crypto.randomUUID(),order:{project,orderType,villa:'V135',colour:'Spruce',siteContact:'PRIVATE SITE CONTACT',phone:'PRIVATE SITE PHONE',requestedDeliveryDate:'2026-11-18',items:[{quantity,description:'Gate set'}]}});
const allPass=checklist=>Object.fromEntries(checklist.map(([key])=>[key,'pass']));
const getReport=async(orderId,extra={},user=team)=>request('/qa/gates/report',{orderId,...extra},user);
const currentOrder=async id=>(await request('/orders/'+id)).body.order;
const components=async id=>(await request('/gate-components')).body.orders.find(order=>order.id===id);

async function configured(project,spec={sets:[{gates:1,highlights:1,posts:1},{gates:1,highlights:1,posts:1}]}){
 const created=await request('/orders',payload(project));assert.equal(created.status,201);
 const order=created.body.order,saved=await request('/gate-components/orders/'+order.id+'/plan',{expectedUpdatedAt:order.updatedAt,spec,areaM2:12.5});assert.equal(saved.status,200);
 return saved.body.order;
}

test('factory QA team gets one complete Gate-order snapshot and PDF regardless of visible QA subset, with immutable saved evidence and safe metadata',async()=>{
 assert.equal((await request('/qa/gates/report',{orderId:'missing'},null)).status,401);assert.equal((await request('/qa/gates/report',{orderId:'missing'},viewer)).status,403);assert.equal((await request('/orders',undefined,team)).status,403);
 for(const body of [null,[],{}, {orderId:''},{orderId:' missing'},{orderId:'missing',includePdf:'yes'}])assert.equal((await request('/qa/gates/report',body,team)).status,400);
 assert.equal((await getReport('missing')).status,404);
 const plain=await request('/orders',{...payload('Non-Gate report boundary','Fixings'),order:{...payload('Non-Gate report boundary','Fixings').order,villa:'',colour:''}});assert.equal(plain.status,201);assert.equal((await getReport(plain.body.order.id)).status,404);
 let order=await configured('Complete Gate overview');assert.equal(order.components.length,6);
 let snapshot=await getReport(order.id);assert.equal(snapshot.status,200);assert.equal(snapshot.body.report.status,'awaiting');assert.equal(snapshot.body.report.items.length,6);assert.equal(snapshot.body.report.summary.awaiting,6);
 const qa=(await request('/qa',undefined,team)).body,checklist=qa.checklists.gate,results=allPass(checklist);
 assert.ok(qa.gateOrders.some(metadata=>metadata.orderId===order.id&&metadata.componentCount===6));
 const rows=qa.items.filter(item=>item.gateOrderId===order.id);assert.equal(rows.length,6);assert.ok(rows.every(item=>item.gateOrder?.orderId===order.id&&item.gateOrder?.villa==='V135'));assert.doesNotMatch(JSON.stringify(rows.map(item=>item.gateOrder)),/PRIVATE|phone|siteContact|attachments/);
 for(const component of order.components.slice(0,2))assert.equal((await request('/qa/check',{id:component.qaId,kind:'metalwork',results},team)).status,200);
 const failed=order.components[2],failure=await request('/qa/check',{id:failed.qaId,kind:'metalwork',results:{...results,[checklist[0][0]]:'fail'},notes:'Correct the Gate finish',photo:png},team);assert.equal(failure.status,200);
 const supplement=await request('/qa/photos',{id:failed.qaId,kind:'metalwork',attemptId:failure.body.item.latest.id,photos:[png],mutationId:crypto.randomUUID()},team);assert.equal(supplement.status,200);
 const metal=await request('/qa/metalwork',{project:order.project,orderNumber:order.orderNumber,reference:'UNRELATED ORDINARY METALWORK',quantity:9,fabricatedBy:'admin'},team);assert.equal(metal.status,201);
 const beforeOrder=await currentOrder(order.id),beforeQa=(await request('/qa',undefined,team)).body.items.filter(item=>item.gateOrderId===order.id),beforeNotifications=(await request('/notifications')).body.notifications;
 snapshot=await getReport(order.id,{includePdf:true,componentIds:[order.components[0].id],items:[order.components[0]],status:'approved'});assert.equal(snapshot.status,200);
 const report=snapshot.body.report;assert.equal(report.type,'gate-order');assert.equal(report.orderId,order.id);assert.equal(report.generatedBy,'qa-team');assert.equal(report.status,'recut');assert.equal(report.items.length,6);assert.equal(report.summary.approved,2);assert.equal(report.summary.recut,1);assert.equal(report.summary.awaiting,3);assert.equal(report.summary.missing,0);assert.equal(report.areaM2,12.5);assert.deepEqual(report.mappingIssues,[]);
 const failedRow=report.items.find(item=>item.qaId===failed.qaId);assert.deepEqual(failedRow.latest,failure.body.item.latest);assert.deepEqual(failedRow.history,failure.body.item.history);assert.deepEqual(failedRow.photoAdditions,supplement.body.item.photoAdditions);
 assert.doesNotMatch(JSON.stringify(report),/PRIVATE SITE|UNRELATED ORDINARY METALWORK|siteContact|attachments/);
 assert.equal(snapshot.body.pdf.mime,'application/pdf');assert.match(snapshot.body.pdf.fileName,/\.pdf$/);const bytes=Buffer.from(snapshot.body.pdf.data,'base64');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>=1);assert.match(pdf.getTitle(),/Gate|GATE/);assert.equal(pdf.getCreationDate().getTime(),Math.floor(Date.parse(report.generatedAt)/1000)*1000);
 assert.deepEqual(await currentOrder(order.id),beforeOrder);assert.deepEqual((await request('/qa',undefined,team)).body.items.filter(item=>item.gateOrderId===order.id),beforeQa);assert.deepEqual((await request('/notifications')).body.notifications,beforeNotifications);
 for(const component of order.components.slice(2))assert.equal((await request('/qa/check',{id:component.qaId,kind:'metalwork',results},team)).status,200);
 snapshot=await getReport(order.id);assert.equal(snapshot.body.report.status,'approved');assert.equal(snapshot.body.report.summary.approved,6);
 order=await components(order.id);const sent=await request('/gate-components/orders/'+order.id+'/dispatch',{expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),componentIds:[order.components[0].id],destination:'PRIVATE DISPATCH ADDRESS',transport:'PRIVATE VEHICLE',driver:'PRIVATE DRIVER',notes:'PRIVATE SHIPPING NOTES'});assert.equal(sent.status,200);order=sent.body.order;
 const delivered=await request('/gate-components/orders/'+order.id+'/delivery',{expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),componentIds:[order.components[0].id],receivedBy:'PRIVATE RECEIVER',notes:'PRIVATE DELIVERY NOTES'});assert.equal(delivered.status,200);order=delivered.body.order;
 snapshot=await getReport(order.id);assert.equal(snapshot.body.report.status,'approved');assert.equal(snapshot.body.report.summary.dispatched,1);assert.equal(snapshot.body.report.summary.delivered,1);assert.equal(snapshot.body.report.dispatchStatus,'partial');assert.equal(snapshot.body.report.deliveryStatus,'partial');assert.doesNotMatch(JSON.stringify(snapshot.body.report),/PRIVATE DISPATCH|PRIVATE VEHICLE|PRIVATE DRIVER|PRIVATE SHIPPING|PRIVATE RECEIVER|PRIVATE DELIVERY/);
 const extended=await request('/gate-components/orders/'+order.id+'/plan',{expectedUpdatedAt:order.updatedAt,spec:{sets:[{gates:1,highlights:1,posts:1},{gates:1,highlights:2,posts:1}]},areaM2:12.5});assert.equal(extended.status,200);
 snapshot=await getReport(order.id);assert.equal(snapshot.body.report.items.length,7);assert.equal(snapshot.body.report.summary.approved,6);assert.equal(snapshot.body.report.summary.awaiting,1);assert.equal(snapshot.body.report.status,'awaiting');assert.equal(snapshot.body.report.previousQa.length,0);
});

test('withdrawn and earlier QA retain their histories/photos in a separate section and do not approve redrawn components',async()=>{
 let order=await configured('Gate revisions in one report',{sets:[{gates:1,highlights:0,posts:1}]}),qa=(await request('/qa',undefined,team)).body,results=allPass(qa.checklists.gate);
 const first=await request('/qa/check',{id:order.components[0].qaId,kind:'metalwork',results,photos:[png]},team);assert.equal(first.status,200);
 const second=await request('/qa/check',{id:order.components[1].qaId,kind:'metalwork',results:{...results,[qa.checklists.gate[0][0]]:'fail'},notes:'Earlier component needs correction',photos:[png]},team);assert.equal(second.status,200);
 order=await components(order.id);const oldIds=order.components.map(component=>component.qaId),oldRevision=(await getReport(order.id)).body.report.currentRevision;
 const withdrawn=await request('/gate-components/orders/'+order.id+'/plan',{expectedUpdatedAt:order.updatedAt,drawn:false,spec:{sets:[{gates:1,highlights:0,posts:1}]},areaM2:12.5});assert.equal(withdrawn.status,200);order=withdrawn.body.order;
 let value=(await getReport(order.id)).body.report;assert.equal(value.status,'not_drawn');assert.equal(value.summary.approved,0);assert.equal(value.summary.awaiting,2);assert.equal(value.previousQa.length,2);assert.deepEqual(new Set(value.previousQa.map(item=>item.qaId)),new Set(oldIds));assert.ok(value.items.every(item=>item.latest===null));
 const redrawn=await request('/gate-components/orders/'+order.id+'/plan',{expectedUpdatedAt:order.updatedAt,drawn:true,spec:{sets:[{gates:1,highlights:0,posts:1}]},areaM2:12.5});assert.equal(redrawn.status,200);
 const response=await getReport(order.id,{includePdf:true});assert.equal(response.status,200);value=response.body.report;assert.notEqual(value.currentRevision,oldRevision);assert.equal(value.status,'awaiting');assert.equal(value.items.length,2);assert.ok(value.items.every(item=>!oldIds.includes(item.qaId)));assert.equal(value.previousQa.length,2);
 assert.deepEqual(value.previousQa.find(item=>item.qaId===first.body.item.id).history,first.body.item.history);assert.deepEqual(value.previousQa.find(item=>item.qaId===second.body.item.id).latest,second.body.item.latest);
});

test('legacy Gate line reports remain available without the component feature flag and preserve multi-piece quantities',async()=>{
 const legacy=createEnvironment(false);try{
  const users=await seed(legacy);assert.equal((await request('/order-types',{name:'Gate'},users.admin,legacy)).status,200);
  const created=await request('/orders',payload('Legacy Gate order report','Gate',3),users.admin,legacy);assert.equal(created.status,201);let order=created.body.order;
  let response=await request('/qa/gates/report',{orderId:order.id},users.team,legacy);assert.equal(response.status,200);assert.equal(response.body.report.status,'not_drawn');assert.equal(response.body.report.summary.totalQuantity,3);
  const drawn=await request('/orders/'+order.id+'/progress',{expectedUpdatedAt:order.updatedAt,areaM2:6,stages:{drawn:'complete'}},users.admin,legacy);assert.equal(drawn.status,200);
  const qa=(await request('/qa',undefined,users.team,legacy)).body,item=qa.items.find(item=>item.gateOrderId===order.id);assert.ok(item);const checked=await request('/qa/check',{id:item.id,kind:'metalwork',results:allPass(qa.checklists.gate),photos:[png]},users.team,legacy);assert.equal(checked.status,200);
  response=await request('/qa/gates/report',{orderId:order.id,includePdf:true},users.team,legacy);assert.equal(response.status,200);assert.equal(response.body.report.status,'approved');assert.equal(response.body.report.items.length,1);assert.equal(response.body.report.items[0].quantity,3);assert.equal(response.body.report.summary.totalQuantity,3);assert.equal(response.body.report.items[0].componentId,null);
  assert.equal((await request('/gate-components',undefined,users.admin,legacy)).status,404);
 }finally{await legacy.dispose();}
});
