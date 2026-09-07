import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
let mf,admin,staff,sequence=0;
const packet=changes=>({mutationId:randomUUID(),restoreEpoch:0,changes});
async function request(route,body,token=admin){
 const response=await mf.dispatchFetch('http://localhost'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json()};
}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'pdf-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'test',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:'http://localhost:8080'}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV'),pinHash=user=>createHash('sha256').update('123456:'+user+':panelstock').digest('hex');
 await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:pinHash('admin')},staff:{isAdmin:false,pinHash:pinHash('staff')}}));
 for(const field of ['variants','offcuts','catalog','cncPanels','transactions','reasons'])await kv.put('app:'+field,'[]');
 await kv.put('app:photos','{}');
 admin=(await request('/login',{username:'admin',pin:'123456'},null)).body.token;
 staff=(await request('/login',{username:'staff',pin:'123456'},null)).body.token;
 assert.ok(admin);assert.ok(staff);
});
after(async()=>{await mf?.dispose();});
const change=(field,before,after)=>({field,id:after?.id||before.id,before,after});
async function seed(){
 const n=++sequence,stock={id:'stock-'+n,sku:'SKU-'+n,catalogId:'cat-'+n,color:'White',material:'ACM',thickness:4,width:4000,height:1500,qty:5};
 const panel={id:'panel-'+n,jobReference:'Project '+n,orderNumber:'01',sheetNumber:'1',panelNumber:'A',status:'pending',stockItemType:'variant',stockItemId:stock.id,stockSku:stock.sku,sheetWidth:4000,sheetHeight:1500,totalPanelArea:2,uploadedBy:'original',uploadedAt:'2026-09-01T00:00:00Z'};
 const sibling={...panel,id:panel.id+'-b',panelNumber:'B'},other={...panel,id:panel.id+'-other',jobReference:'Other '+n};
 const activity={id:randomUUID(),type:'cnc',desc:'Synthetic setup',qty:'',timestamp:new Date().toISOString()};
 const result=await request('/mutations',packet([change('catalog',null,{...stock,id:stock.catalogId}),change('variants',null,stock),...([panel,sibling,other].map(value=>change('cncPanels',null,value))),change('transactions',null,activity)]));
 assert.equal(result.status,200,JSON.stringify(result.body));
 const saved=(await request('/data')).body;
 return {stock,panel:saved.cncPanels.find(p=>p.id===panel.id),sibling:saved.cncPanels.find(p=>p.id===sibling.id),other:saved.cncPanels.find(p=>p.id===other.id)};
}
function pdfChanges(panels,patch={}){
 const changes=panels.map(before=>change('cncPanels',before,{...before,...patch,pdfPage:1,pdfRevision:(before.pdfRevision||0)+1,pdfUpdatedBy:'spoofed',pdfUpdatedAt:'2000-01-01T00:00:00Z'}));
 const activity={id:randomUUID(),type:'cnc',source:'cnc-pdf',desc:'Synthetic PDF update',qty:'',timestamp:new Date().toISOString(),panelRecordIds:panels.map(p=>p.id)};
 return [...changes,change('transactions',null,activity)];
}
function removalChanges(panels,kind='sheet') {
 const first=panels[0],scope={kind,jobReference:first.jobReference,orderNumber:first.orderNumber,...(kind!=='order'?{sheetNumber:first.sheetNumber}:{}),...(kind==='panel'?{panelRecordId:first.id}:{})};
 return [...panels.map(panel=>change('cncPanels',panel,null)),change('transactions',null,{id:randomUUID(),type:'cnc',source:'cnc-remove',removalScope:scope,panelRecordIds:panels.map(p=>p.id),desc:'Synthetic scheduled-work deletion',qty:'',user:'spoofed',timestamp:new Date().toISOString()})];
}

test('admin sheet and order deletion is atomic, audited and idempotent without changing stock or another project',async()=>{
 for(const kind of ['sheet','order']) {
  const {panel,sibling,other,stock}=await seed(),body=packet(removalChanges([panel,sibling],kind));
  const before=(await request('/data')).body;
  assert.equal((await request('/mutations',body)).status,200);
  const retry=await request('/mutations',body);assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);
  const data=(await request('/data')).body;
  assert.equal(data.cncPanels.some(p=>p.id===panel.id||p.id===sibling.id),false);assert.deepEqual(data.cncPanels.find(p=>p.id===other.id),other);
  assert.deepEqual(data.variants.find(p=>p.id===stock.id),stock);assert.deepEqual(data.offcuts,before.offcuts);
  assert.equal(data.transactions.length,before.transactions.length+1);const activity=data.transactions.find(t=>t.id===body.changes.at(-1).id);assert.equal(activity.user,'admin');assert.ok(activity.serverTimestamp);
  assert.ok(before.transactions.every(t=>data.transactions.some(after=>after.id===t.id)));
 }
});

test('CNC deletion rejects staff, missing audit, completed records, partial sheets and forged scope without partial writes',async()=>{
 const {panel,sibling,other}=await seed(),changes=removalChanges([panel,sibling]);
 assert.equal((await request('/mutations',packet(changes),staff)).status,403);
 assert.equal((await request('/mutations',packet(changes.slice(0,2)))).status,400);
 const forged=removalChanges([panel,sibling]);forged[2].after.removalScope.jobReference=other.jobReference;
 assert.equal((await request('/mutations',packet(forged))).status,409);
 assert.equal((await request('/mutations',packet(removalChanges([panel])))).status,409,'cannot claim an entire sheet while omitting a panel');
 assert.deepEqual((await request('/data')).body.cncPanels.find(p=>p.id===panel.id),panel);
 assert.equal((await request('/mutations',packet([change('cncPanels',panel,{...panel,status:'completed'})]))).status,200);
 const completed=(await request('/data')).body.cncPanels.find(p=>p.id===panel.id);
 assert.equal((await request('/mutations',packet(removalChanges([completed],'panel')))).status,409);
 const partial=packet(removalChanges([sibling],'panel'));assert.equal((await request('/mutations',partial)).status,409);
 const data=(await request('/data')).body;assert.deepEqual(data.cncPanels.find(p=>p.id===sibling.id),sibling);assert.equal(data.transactions.some(t=>t.id===partial.changes.at(-1).id),false);
});

test('new members and completion racing a reviewed CNC deletion reject the whole batch',async()=>{
 for(const kind of ['sheet','order']) {
  const {panel,sibling}=await seed(),stale=packet(removalChanges([panel,sibling],kind));
  const added={...panel,id:panel.id+'-late',sheetNumber:kind==='sheet'?panel.sheetNumber:'02',panelNumber:'NEW'};
  assert.equal((await request('/mutations',packet([change('cncPanels',null,added)]))).status,200);
  assert.equal((await request('/mutations',stale)).status,409);
  const data=(await request('/data')).body;for(const id of [panel.id,sibling.id,added.id])assert.ok(data.cncPanels.some(p=>p.id===id));assert.equal(data.transactions.some(t=>t.id===stale.changes.at(-1).id),false);
 }
 const {panel,sibling}=await seed(),stale=packet(removalChanges([panel,sibling]));
 assert.equal((await request('/mutations',packet([change('cncPanels',panel,{...panel,status:'completed'})]))).status,200);
 assert.equal((await request('/mutations',stale)).status,409);
 const data=(await request('/data')).body;assert.equal(data.cncPanels.find(p=>p.id===panel.id).status,'completed');assert.deepEqual(data.cncPanels.find(p=>p.id===sibling.id),sibling);assert.equal(data.transactions.some(t=>t.id===stale.changes.at(-1).id),false);
});
test('PDF overwrite is atomic, retains identity and original provenance, stamps the actor, and retries idempotently',async()=>{
 const {panel,sibling,other}=await seed(),changes=pdfChanges([panel],{totalPanelArea:3,panelAreaScope:'sheet',isTemplate:true}),body=packet(changes);
 assert.equal((await request('/mutations',body)).status,200);
 const retry=await request('/mutations',body);assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);
 const data=(await request('/data')).body,updated=data.cncPanels.find(p=>p.id===panel.id);
 assert.equal(updated.pdfRevision,1);assert.equal(updated.totalPanelArea,3);assert.equal(updated.pdfUpdatedBy,'admin');assert.notEqual(updated.pdfUpdatedAt,'2000-01-01T00:00:00Z');
 assert.equal(updated.uploadedBy,panel.uploadedBy);assert.equal(updated.uploadedAt,panel.uploadedAt);
 assert.deepEqual(data.cncPanels.find(p=>p.id===sibling.id),sibling);assert.deepEqual(data.cncPanels.find(p=>p.id===other.id),other);
 assert.equal(data.transactions.filter(t=>t.id===changes.at(-1).id).length,1);
 const stale=packet(pdfChanges([panel],{totalPanelArea:4}));
 assert.equal((await request('/mutations',stale)).status,409);
 const afterStale=(await request('/data')).body;
 assert.equal(afterStale.cncPanels.find(p=>p.id===panel.id).totalPanelArea,3);
 assert.equal(afterStale.transactions.some(t=>t.id===stale.changes.at(-1).id),false);
});
test('staff, unlogged replacements, changed identities and invalid revisions are rejected without partial writes',async()=>{
 const {panel}=await seed(),changes=pdfChanges([panel],{totalPanelArea:3});
 assert.equal((await request('/mutations',packet(changes),staff)).status,403);
 assert.equal((await request('/mutations',packet(changes.slice(0,1)))).status,400);
 assert.equal((await request('/mutations',packet(pdfChanges([panel],{panelNumber:'NEW'})))).status,409);
 const invalid=pdfChanges([panel]);invalid[0].after.pdfRevision=7;
 assert.equal((await request('/mutations',packet(invalid))).status,400);
 assert.deepEqual((await request('/data')).body.cncPanels.find(p=>p.id===panel.id),panel);
});
test('completion racing a reupload rejects the entire stale update and keeps completion history',async()=>{
 const {panel,sibling}=await seed(),stale=packet(pdfChanges([panel,sibling],{totalPanelArea:3}));
 assert.equal((await request('/mutations',packet([change('cncPanels',panel,{...panel,status:'completed'})]))).status,200);
 const completed=(await request('/data')).body.cncPanels.find(p=>p.id===panel.id);
 assert.equal((await request('/mutations',stale)).status,409);
 assert.equal((await request('/mutations',packet(pdfChanges([completed],{status:'pending'})))).status,409);
 assert.equal((await request('/mutations',packet(pdfChanges([sibling])))).status,409,'cannot extend a partly completed physical sheet');
 const data=(await request('/data')).body;
 assert.deepEqual(data.cncPanels.find(p=>p.id===panel.id),completed);assert.deepEqual(data.cncPanels.find(p=>p.id===sibling.id),sibling);
 assert.equal(data.transactions.some(t=>t.id===stale.changes.at(-1).id),false);
});
test('changing stock requires all pending siblings to agree and enough available stock after reservations',async()=>{
 const {stock,panel,sibling}=await seed(),target={...stock,id:stock.id+'-new',sku:stock.sku+'-NEW',qty:1};
 const activity={id:randomUUID(),type:'cnc',desc:'Synthetic new stock',qty:'',timestamp:new Date().toISOString()};
 assert.equal((await request('/mutations',packet([change('variants',null,target),change('transactions',null,activity)]))).status,200);
 const patch={stockItemId:target.id,stockSku:target.sku};
 assert.equal((await request('/mutations',packet(pdfChanges([panel],patch)))).status,409);
 assert.equal((await request('/mutations',packet(pdfChanges([panel,sibling],patch)))).status,200);
 const other={...panel,id:panel.id+'-reserved',sheetNumber:'2'};
 assert.equal((await request('/mutations',packet([change('cncPanels',null,other)]))).status,200);
 const savedOther=(await request('/data')).body.cncPanels.find(p=>p.id===other.id);
 assert.equal((await request('/mutations',packet(pdfChanges([savedOther],patch)))).status,409);
 assert.deepEqual((await request('/data')).body.cncPanels.find(p=>p.id===other.id),savedOther);
});
test('one PDF batch can replace a pending panel and append a new panel without deleting omitted siblings',async()=>{
 const {panel,sibling}=await seed(),changes=pdfChanges([panel],{totalPanelArea:3});
 const added={...changes[0].after,id:panel.id+'-new',panelNumber:'C'};
 changes.splice(1,0,change('cncPanels',null,added));changes.at(-1).after.panelRecordIds.push(added.id);
 assert.equal((await request('/mutations',packet(changes))).status,200);
 const data=(await request('/data')).body;
 assert.equal(data.cncPanels.filter(p=>p.jobReference===panel.jobReference).length,3);
 assert.deepEqual(data.cncPanels.find(p=>p.id===sibling.id),sibling);
 assert.equal(data.cncPanels.find(p=>p.id===added.id).pdfRevision,1);
});
