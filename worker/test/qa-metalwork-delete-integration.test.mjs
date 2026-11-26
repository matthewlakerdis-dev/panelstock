import {seedExistingMetalwork} from './qa-metalwork-fixture.mjs';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash} from 'node:crypto';
import fs from 'node:fs';

const site='qa-metalwork-delete-test',photo='data:image/png;base64,aGVsbG8=';
let mf,storage,admin,team,manager,manageOnly,viewer,checks;
async function request(route,body,token=admin){
 const response=await mf.dispatchFetch('http://localhost'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
const login=async(username,pin)=>(await request('/login',{username,pin},null)).body.token;
async function document(key,fallback=[]){const rows=await storage.exec('SELECT value FROM documents WHERE key=? ORDER BY part',key);return rows.length?JSON.parse(rows.map(row=>row.value).join('')):fallback;}
async function saveDocument(key,value){await storage.exec('DELETE FROM documents WHERE key=?',key);await storage.exec('INSERT INTO documents(key,part,value) VALUES(?,0,?)',key,JSON.stringify(value));}
const audit=()=>storage.exec('SELECT username,action,detail FROM audit ORDER BY id');
const manual=(id,extra={})=>({id,kind:'metalwork',project:'Duplicate metalwork project',orderNumber:'M1',sheetNumber:'',reference:'Identical bracket',quantity:2,fabricatedBy:'fabricator',createdBy:'qa-team',createdAt:'2026-11-19T01:00:00Z',status:'awaiting',latest:null,history:[],...extra});
const create=async(reference='Identical bracket')=>seedExistingMetalwork(mf,site,site,{project:'Duplicate metalwork project',orderNumber:'M1',reference,quantity:2,fabricatedBy:'fabricator',createdBy:'qa-team'});
const inspect=id=>request('/qa/check',{id,kind:'metalwork',results:Object.fromEntries(checks.metalwork.map(([key])=>[key,'pass'])),photo},team);
async function reset(records=[],extra={}){for(const [key,value]of Object.entries({'qa-checks':records,'qa-dispatches':[],'panel-dispatch-loads':[],'app:cncPanels':[],orders:[],...extra}))await saveDocument(key,value);}
async function snapshot(){return {documents:await Promise.all(['qa-checks','qa-dispatches','panel-dispatch-loads','app:cncPanels','orders'].map(async key=>[key,await document(key)])),audit:await audit()};}

before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name:site,modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:site,MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV'),users={};
 for(const [username,pin,isAdmin]of [['admin','123456',true],['qa-team','654321',false],['manager','456789',false],['manage-only','567890',false],['viewer','678901',false]])users[username]={isAdmin,pinHash:createHash('sha256').update(`${pin}:${username}:panelstock`).digest('hex')};
 await kv.put('users',JSON.stringify(users));
 for(const [key,value]of Object.entries({variants:[],catalog:[],offcuts:[],transactions:[],reasons:[],photos:{},cncPanels:[]}))await kv.put('app:'+key,JSON.stringify(value));
 admin=await login('admin','123456');assert.ok(admin);
 const tasks=(await request('/admin/users',{})).body.tasks.map(task=>task.code);
 for(const targetUsername of ['qa-team','manager','manage-only','viewer'])assert.equal((await request('/admin/set-task-access',{targetUsername,taskCodes:tasks,allowed:false})).status,200);
 for(const [targetUsername,taskCodes]of [['qa-team',['factory.qa']],['manager',['factory.qa','factory.qa.manage']],['manage-only',['factory.qa.manage']]])assert.equal((await request('/admin/set-task-access',{targetUsername,taskCodes,allowed:true})).status,200);
 team=await login('qa-team','654321');manager=await login('manager','456789');manageOnly=await login('manage-only','567890');viewer=await login('viewer','678901');assert.ok(team&&manager&&manageOnly&&viewer);
 checks=(await request('/qa',undefined,team)).body.checklists;
 storage=await mf.unsafeGetDurableObjectStorage(site,'InventoryStore',{name:site});
});
after(async()=>{await mf?.dispose();});

test('manual QA metalwork creation is denied for every role and leaves existing data and audit unchanged',async()=>{
 await reset([manual('existing-entry')]);
 const state=async()=>({documents:await storage.exec('SELECT key,part,value FROM documents ORDER BY key,part'),audit:await audit()});
 const before=await state(),payload={project:'Disabled creation',orderNumber:'NEW',reference:'Bracket',quantity:1,fabricatedBy:'fabricator'};
 assert.equal((await request('/qa/metalwork',payload,null)).status,401);
 assert.deepEqual(await state(),before);
 for(const user of [admin,team,manager,manageOnly,viewer]){
  for(const route of ['/qa/metalwork','/qa/metalwork?view=queue']){
   const denied=await request(route,payload,user);
   assert.equal(denied.status,403);
   if([admin,team,manager].includes(user))assert.equal(denied.body.error,'Manual metalwork QA entries are disabled.');
   assert.deepEqual(await state(),before);
  }
 }
});

test('only QA managers delete pending manual entries by exact ID, including duplicates created by another worker; counts and audit preserve identity',async()=>{
 await reset();const first=await create(),second=await create();assert.notEqual(first.id,second.id);
 const before=await snapshot();
 assert.equal((await request('/qa/metalwork/delete',{id:first.id},null)).status,401);
 for(const user of [team,manageOnly,viewer])assert.equal((await request('/qa/metalwork/delete',{id:first.id},user)).status,403);
 assert.deepEqual(await snapshot(),before);
 const deleted=await request('/qa/metalwork/delete',{id:first.id},manager);assert.equal(deleted.status,200);assert.equal(deleted.body.deletedId,first.id);assert.equal(deleted.body.items.length,1);assert.equal(deleted.body.items[0].id,second.id);assert.equal(deleted.body.items.filter(item=>item.status==='awaiting').length,1);assert.ok(deleted.body.checklists.metalwork.length);
 assert.deepEqual(await document('qa-checks'),[second]);
 const events=(await audit()).filter(event=>event.action==='qa-metalwork-deleted');assert.equal(events.length,1);assert.equal(events[0].username,'manager');assert.deepEqual(JSON.parse(events[0].detail),{qaId:first.id,kind:first.kind,project:first.project,orderNumber:first.orderNumber,sheetNumber:first.sheetNumber,reference:first.reference,quantity:first.quantity,fabricatedBy:first.fabricatedBy,createdBy:'qa-team',createdAt:first.createdAt,status:'awaiting'});
 const after=await snapshot();assert.equal((await request('/qa/metalwork/delete',{id:first.id},manager)).status,404);assert.deepEqual(await snapshot(),after);
 assert.equal((await request('/qa/metalwork/delete',{id:second.id})).status,200);assert.deepEqual(await document('qa-checks'),[]);
 await reset([manual('legacy-blank',{status:''}),manual('legacy-missing')]);const legacy=await document('qa-checks');delete legacy[1].status;await saveDocument('qa-checks',legacy);
 assert.equal((await request('/qa/metalwork/delete',{id:'legacy-blank'},manager)).status,200);assert.equal((await request('/qa/metalwork/delete',{id:'legacy-missing'},manager)).status,200);
 const attempt={id:'legacy-attempt',status:'rework',results:{fit:'fail'},photo,checkedBy:'original-inspector',checkedAt:'2026-11-18T01:00:00Z'},unrelated=manual('legacy-failed',{status:'rework',latest:attempt,history:[attempt]});
 await reset([manual('pending-delete'),unrelated]);const prior=await audit(),result=await request('/qa/metalwork/delete',{id:'pending-delete'},manager);assert.equal(result.status,200);assert.equal(result.body.items[0].status,'recut');assert.deepEqual(await document('qa-checks'),[unrelated]);assert.equal((await audit()).slice(prior.length).some(event=>event.action==='qa-rework-migrated'),false);
});

test('generated, inspected, dispatched, replacement-linked and malformed records remain byte-for-byte unchanged on denied deletion',async()=>{
 const attempt={id:'saved-inspection',status:'approved',results:{fit:'pass'},photo,checkedBy:'inspector',checkedAt:'2026-11-19T02:00:00Z'},id='protected';
 const cases=[
  {name:'CNC QA record',records:[manual(id,{kind:'panel'})]},
  {name:'CNC identity despite wrong stored kind',records:[manual(id)],extra:{'app:cncPanels':[{id,status:'completed'}]}},
  ...[{gateOrderId:'gate-order'},{gateItemIndex:0},{gateRevision:null},{gateComponentId:'component'},{drawnBy:''},{checklistKind:'gate'}].map(patch=>({name:'production marker '+Object.keys(patch)[0],records:[manual(id,patch)]})),
  {name:'current Gate order link',records:[manual(id)],extra:{orders:[{id:'gate',manualProduction:{qaItemIds:[id]}}]}},
  {name:'historical Gate order link',records:[manual(id)],extra:{orders:[{id:'gate',gateComponents:{previousQaItemIds:[id]}}]}},
  {name:'shipment approval link',records:[manual(id)],extra:{orders:[{id:'gate',gateComponents:{shipments:[{qaApprovals:[{qaId:id}]}]}}]}},
  {name:'panel load reference',records:[manual(id)],extra:{'panel-dispatch-loads':[{panelIds:[id],status:'waiting'}]}},
  ...['approved','recut','replaced','completed','dispatched'].map(status=>({name:status,records:[manual(id,{status})]})),
  {name:'actual saved approval',records:[manual(id,{status:'approved',latest:attempt,history:[attempt]})]},
  ...[{latest:{}},{latest:false},{history:[attempt]},{history:{}},{history:null},{photoAdditions:[{attemptId:attempt.id,photos:[photo]}]},{photoAdditions:{}},{photo},{photos:[photo]},{results:{}},{checkedAt:attempt.checkedAt}].map(patch=>({name:'saved or malformed evidence '+Object.keys(patch)[0],records:[manual(id,patch)]})),
  ...[{replacementId:'replacement'},{remakeOf:'original'},{resolvedSeparatelyAt:attempt.checkedAt}].map(patch=>({name:'replacement metadata '+Object.keys(patch)[0],records:[manual(id,patch)]})),
  ...['remakeOf','replacementId'].map(key=>({name:'reverse '+key,records:[manual(id),manual('linked',{[key]:id})]})),
  ...[0,1].map(quantity=>({name:'dispatch reference quantity '+quantity,records:[manual(id)],extra:{'qa-dispatches':[{lines:[{id,quantity}]}]}})),
  {name:'duplicate saved identity',records:[manual(id),manual(id,{kind:'panel'})]},
 ];
 for(const scenario of cases){await reset(scenario.records,scenario.extra);const before=await snapshot(),denied=await request('/qa/metalwork/delete',{id},manager);assert.equal(denied.status,409,scenario.name+': '+JSON.stringify(denied.body));assert.deepEqual(await snapshot(),before,scenario.name);}
 for(const body of [null,[],{}, {id:''},{id:' protected'},{id:123},{id:'x'.repeat(101)}]){const before=await snapshot();assert.equal((await request('/qa/metalwork/delete',body,manager)).status,400);assert.deepEqual(await snapshot(),before);}
 const before=await snapshot();assert.equal((await request('/qa/metalwork/delete',{id:'missing'},manager)).status,404);assert.deepEqual(await snapshot(),before);
});

test('a stale deletion after approval fails, and concurrent approval/deletion cannot erase a saved inspection or recreate a deleted entry',async()=>{
 await reset();const stale=await create('Inspected while delete dialog is open'),approved=await inspect(stale.id);assert.equal(approved.status,200);const before=await snapshot();
 const denied=await request('/qa/metalwork/delete',{id:stale.id},manager);assert.equal(denied.status,409);assert.deepEqual(await snapshot(),before);assert.deepEqual((await document('qa-checks')).find(record=>record.id===stale.id).history,[approved.body.item.latest]);
 for(let index=0;index<4;index++){
  const item=await create('Concurrent '+index),beforeAudit=await audit(),deletion=()=>request('/qa/metalwork/delete',{id:item.id},manager),approval=()=>inspect(item.id),result=await Promise.all(index%2?[deletion(),approval()]:[approval(),deletion()]),deleted=result.find(value=>value.body.deletedId===item.id),record=(await document('qa-checks')).find(value=>value.id===item.id),events=(await audit()).slice(beforeAudit.length);
  assert.equal(result.filter(value=>value.status===200).length,1);
  if(deleted){assert.equal(record,undefined);assert.ok(result.some(value=>value.status===404));assert.equal(events.filter(event=>event.action==='qa-metalwork-deleted').length,1);assert.equal(events.filter(event=>event.action==='qa-approved').length,0);}
  else{assert.equal(record.status,'approved');assert.equal(record.history.length,1);assert.ok(result.some(value=>value.status===409));assert.equal(events.filter(event=>event.action==='qa-metalwork-deleted').length,0);assert.equal(events.filter(event=>event.action==='qa-approved').length,1);}
 }
});

test('removing an untouched duplicate updates derived order readiness and notifies once without inventing an inspection or approving an empty order',async()=>{
 const order={id:crypto.randomUUID(),project:'Duplicate metalwork project',orderNumber:'M1',orderType:'Panels',status:'approved',requestedBy:'qa-team',items:[{quantity:1,description:'Panel'}]},emptyOrder={...order,id:crypto.randomUUID(),orderNumber:'M2'},pending=manual('duplicate-blocker'),sole=manual('only-manual-entry',{orderNumber:'M2'}),panel={id:'ready-panel',jobReference:order.project,orderNumber:order.orderNumber,status:'completed',completedAt:'2099-01-01T00:00:00Z',completedBy:'fabricator',stockSku:'WHITE',stockColor:'White'},attempt={id:'real-panel-inspection',status:'approved',results:{fit:'pass'},checkedBy:'inspector',checkedAt:'2026-11-19T01:00:00Z'},panelQa={id:panel.id,kind:'panel',status:'approved',latest:attempt,history:[attempt]};
 await reset([pending,sole,panelQa],{orders:[order,emptyOrder],'app:cncPanels':[panel]});
 const progress=async id=>(await request('/orders/'+id+'/progress')).body.progress,stage=(value,label)=>value.stages.find(item=>item.label===label).state;
 assert.equal(stage(await progress(order.id),'Ready for dispatch'),'pending');
 const alertsBefore=await document('notifications'),removed=await request('/qa/metalwork/delete',{id:pending.id},manager);assert.equal(removed.status,200);assert.equal(stage(await progress(order.id),'QA'),'complete');assert.equal(stage(await progress(order.id),'Ready for dispatch'),'complete');
 const alerts=await document('notifications'),newAlerts=alerts.filter(item=>!alertsBefore.some(previous=>previous.id===item.id));assert.equal(newAlerts.length,1);assert.equal(newAlerts[0].recipient,'qa-team');assert.equal(newAlerts[0].orderId,order.id);assert.match(newAlerts[0].title,/ready for dispatch/);
 assert.deepEqual(await document('orders'),[order,emptyOrder]);assert.deepEqual((await document('qa-checks')).find(item=>item.id===panel.id),panelQa);
 assert.equal((await request('/qa/metalwork/delete',{id:pending.id},manager)).status,404);assert.deepEqual(await document('notifications'),alerts);
 assert.equal((await request('/qa/metalwork/delete',{id:sole.id},manager)).status,200);assert.equal(stage(await progress(emptyOrder.id),'QA'),'pending');assert.equal(stage(await progress(emptyOrder.id),'Ready for dispatch'),'pending');assert.deepEqual(await document('notifications'),alerts);assert.deepEqual(await document('qa-checks'),[panelQa]);
});
