import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {undoCncCompletion} from '../src/cnc-completion-undo.js';
let mf,admin,staff,seq=0;
const change=(field,before,after)=>({field,id:after?.id||before.id,before,after});
async function api(path,body,token=admin){const r=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};}
async function mutate(changes){const r=await api('/mutations',{mutationId:randomUUID(),restoreEpoch:0,changes});assert.equal(r.status,200,JSON.stringify(r.body));return r;}
const snapshot=async()=>(await api('/data')).body;
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'cnc-undo-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'undo-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify(Object.fromEntries(['admin','staff'].map(name=>[name,{isAdmin:name==='admin',pinHash:createHash('sha256').update('123456:'+name+':panelstock').digest('hex')}]))));
 admin=(await api('/login',{username:'admin',pin:'123456'},null)).body.token;staff=(await api('/login',{username:'staff',pin:'123456'},null)).body.token;assert.ok(admin&&staff);
});
after(async()=>{await mf?.dispose();});
async function seed({sheet=false,offcut=false,save=false,count=1}={}){
 const n=++seq,type=offcut?'offcut':'variant',field=offcut?'offcuts':'variants',stock={id:'stock-'+n,sku:'UNDO-'+n,color:'White',material:'ACM',thickness:4,width:4000,height:1500,qty:offcut?1:5,...(offcut?{note:'Test'}:{catalogId:'cat-'+n})};
 const panels=Array.from({length:count},(_,i)=>({id:'panel-'+n+'-'+i,jobReference:'Undo '+n,orderNumber:'001',sheetNumber:'1',panelNumber:String(i+1),status:'pending',stockItemType:type,stockItemId:stock.id,stockSku:stock.sku,sheetWidth:4000,sheetHeight:1500,totalPanelArea:1}));
 await mutate([...(offcut?[]:[change('catalog',null,{...stock,id:stock.catalogId})]),change(field,null,stock),...panels.map(p=>change('cncPanels',null,p)),change('transactions',null,{id:randomUUID(),type:'cnc',desc:'Scheduled',qty:'',timestamp:new Date().toISOString()})]);
 const data=await snapshot(),at=new Date().toISOString(),before=panels.map(p=>data.cncPanels.find(v=>v.id===p.id));
 const changes=before.map(p=>change('cncPanels',p,{...p,status:'completed',completedAt:at,completedBy:'spoofed',...(sheet?{offcutOutcome:save?'confirmed':'none',offcutDetails:save?{length:1000+n,width:500,color:'White',material:'ACM',thickness:4}:null,savedOffcuts:save?[{length:1000+n,width:500,color:'White',material:'ACM',thickness:4}]:[]}: {})}));
 let dispatch,addition,output;
 if(sheet){
  changes.push(change(field,stock,offcut?null:{...stock,qty:stock.qty-1}));
  dispatch={id:randomUUID(),type:'dispatch',source:'cnc',desc:'CNC stock dispatch',timestamp:at,qty:1,sku:stock.sku,itemType:type,orderNumber:'001',panelIds:before.map(p=>p.panelNumber),ref:before[0].jobReference,color:stock.color,material:stock.material,thickness:stock.thickness,width:stock.width,height:stock.height};changes.push(change('transactions',null,dispatch));
  if(save){output={id:'output-'+n,sku:'OUTPUT-'+n,color:'White',material:'ACM',thickness:4,width:1000+n,height:500,qty:1,note:'Saved offcut'};addition={id:randomUUID(),type:'offcut_add',desc:'Saved offcut',timestamp:at,itemType:'offcut',sku:output.sku,qty:1,orderNumber:'001',sheetNumber:'1'};changes.push(change('offcuts',null,output),change('transactions',null,addition));}
 }
 changes.push(change('transactions',null,{id:randomUUID(),type:'cnc',desc:'Completed cut',qty:'',timestamp:at}));await mutate(changes);
 return {panel:(await snapshot()).cncPanels.find(p=>p.id===panels[0].id),ids:panels.map(p=>p.id),stock,dispatch,addition,output,field};
}
async function preview(panel){const r=await api('/cnc/undo-completion',{action:'preview',panelId:panel.id,expectedCompletedAt:panel.completedAt});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.plan;}
const command=plan=>({action:'undo',panelId:plan.panelId,expectedCompletedAt:plan.expectedCompletedAt,revision:plan.revision,restoreEpoch:plan.restoreEpoch,reason:'Marked cut by mistake',mutationId:randomUUID()});
test('admin undo restores Pending, preserves other records and replays safely after a lost response',async()=>{
 const {panel}=await seed(),plan=await preview(panel),before=await snapshot(),body=command(plan);assert.equal(plan.panels.length,1);assert.deepEqual(plan.stockAdjustments,[]);
 assert.equal((await api('/cnc/undo-completion',body)).status,200);const data=await snapshot(),p=data.cncPanels.find(p=>p.id===panel.id);
 assert.equal(p.status,'pending');assert.equal(p.completedAt,null);assert.equal(p.completedBy,null);assert.equal(p.uploadedAt,panel.uploadedAt);assert.deepEqual(data.variants,before.variants);assert.deepEqual(data.offcuts,before.offcuts);
 assert.deepEqual(data.cncPanels.filter(p=>p.id!==panel.id),before.cncPanels.filter(p=>p.id!==panel.id));assert.equal(data.transactions.length,before.transactions.length+1);assert.equal(data.transactions[0].source,'cnc-undo');assert.equal(data.transactions[0].user,'admin');
 const retry=await api('/cnc/undo-completion',body);assert.equal(retry.status,200);assert.equal(retry.body.idempotent,true);assert.deepEqual(await snapshot(),data);assert.equal((await api('/cnc/undo-completion',{...body,reason:'Different reason'})).status,409);
});
test('sheet undo restores one SOH sheet, removes unused offcuts and resets its full batch',async()=>{
 const f=await seed({sheet:true,save:true,count:2}),p=await preview(f.panel),before=await snapshot();assert.equal(p.panels.length,2);assert.deepEqual(p.stockAdjustments.map(v=>v.delta),[1,-1]);
 const r=await api('/cnc/undo-completion',command(p));assert.equal(r.status,200,JSON.stringify(r.body));const data=await snapshot();assert.equal(data.variants.find(v=>v.id===f.stock.id).qty,5);assert.equal(data.offcuts.find(v=>v.id===f.output.id).qty,0);
 for(const v of data.cncPanels.filter(v=>f.ids.includes(v.id))){assert.equal(v.status,'pending');assert.equal(v.offcutOutcome,undefined);assert.equal(v.savedOffcuts,undefined);}
 for(const id of [f.dispatch.id,f.addition.id]){const t=data.transactions.find(v=>v.id===id);assert.equal(t.voided,true);assert.equal(t.voidedBy,'admin');}assert.ok(before.transactions.every(t=>data.transactions.some(v=>v.id===t.id)));
});
test('fully consumed input offcut is restored with its original identity',async()=>{
 const f=await seed({sheet:true,offcut:true}),p=await preview(f.panel);assert.equal((await snapshot()).offcuts.some(v=>v.id===f.stock.id),false);assert.equal((await api('/cnc/undo-completion',command(p))).status,200);assert.deepEqual((await snapshot()).offcuts.find(v=>v.id===f.stock.id),f.stock);
});
test('staff, generic reset bypasses, stale data and empty reasons cannot change records',async()=>{
 const f=await seed({sheet:true}),p=await preview(f.panel),body=command(p),before=await snapshot();
 assert.equal((await api('/cnc/undo-completion',{action:'preview',panelId:f.panel.id,expectedCompletedAt:f.panel.completedAt},staff)).status,403);assert.equal((await api('/cnc/undo-completion',body,staff)).status,403);assert.equal((await api('/cnc/undo-completion',body,null)).status,401);assert.equal((await api('/cnc/undo-completion',{...body,reason:''})).status,400);
 assert.equal((await api('/mutations',{mutationId:randomUUID(),restoreEpoch:0,changes:[change('cncPanels',f.panel,{...f.panel,status:'pending'})]})).status,409);
 assert.equal((await api('/cnc/undo-completion',{...body,revision:p.revision-1})).status,409);assert.equal((await api('/cnc/undo-completion',{...body,expectedCompletedAt:'old'})).status,409);assert.deepEqual(await snapshot(),before);
});
test('inspection evidence, QA exemptions and downstream deliveries block undo before any writes',()=>{
 const at='2026-11-19T00:00:00Z',p={id:'p',jobReference:'Project',orderNumber:'1',sheetNumber:'1',panelNumber:'1',status:'completed',completedAt:at};
 for(const extra of [{'qa-checks':[{id:'p',latest:{status:'approved'}}]},{'qa-checks':[{id:'p',qaExemptionHistory:[{}]}]},{'panel-dispatch-loads':[{panelIds:['p'],status:'at_powder_coaters',legs:[{}]}]},{'qa-dispatches':[{lines:[{kind:'panel',id:'p'}]}]},{orders:[{project:'Project',orderNumber:'1',status:'dispatched'}]}]){
  let writes=0;const docs={'app:cncPanels':[p],...extra},store={read:(key,fallback)=>structuredClone(docs[key]??fallback),write:()=>writes++,requireTask:()=>{},sql:{exec:()=>({toArray:()=>[{id:'origin',payload:JSON.stringify([change('cncPanels',{...p,status:'pending'},p)])}]})}};
  assert.throws(()=>undoCncCompletion(store,{action:'preview',panelId:'p',expectedCompletedAt:at},{isAdmin:true,username:'admin'}),e=>e.status===409);assert.equal(writes,0);
 }
});

test('an already voided stock dispatch is not restored twice',async()=>{
 const f=await seed({sheet:true}),data=await snapshot(),txn=data.transactions.find(v=>v.id===f.dispatch.id),stock=data.variants.find(v=>v.id===f.stock.id);
 await mutate([change('variants',stock,{...stock,qty:stock.qty+1}),change('transactions',txn,{...txn,voided:true})]);
 const p=await preview(f.panel);assert.deepEqual(p.stockAdjustments,[]);assert.equal((await api('/cnc/undo-completion',command(p))).status,200);assert.equal((await snapshot()).variants.find(v=>v.id===f.stock.id).qty,5);
});
test('used or reserved generated offcuts block undo without changing stock or completion',async()=>{
 for(const reserve of [false,true]){
  const f=await seed({sheet:true,save:true}),data=await snapshot(),output=data.offcuts.find(v=>v.id===f.output.id);
  if(reserve){const panel={...f.panel,id:randomUUID(),jobReference:'Other project',status:'pending',completedAt:null,completedBy:null,stockItemType:'offcut',stockItemId:output.id,stockSku:output.sku,sheetWidth:output.width,sheetHeight:output.height,totalPanelArea:0.1,offcutOutcome:undefined,savedOffcuts:undefined,offcutDetails:undefined};await mutate([change('cncPanels',null,panel),change('transactions',null,{id:randomUUID(),type:'cnc',desc:'Reserve an output offcut',qty:'',timestamp:new Date().toISOString()})]);}
  else await mutate([change('offcuts',output,{...output,qty:0}),change('transactions',null,{id:randomUUID(),type:'dispatch',itemType:'offcut',sku:output.sku,desc:'Use generated offcut',qty:1,timestamp:new Date().toISOString()})]);
  const before=await snapshot(),r=await api('/cnc/undo-completion',{action:'preview',panelId:f.panel.id,expectedCompletedAt:f.panel.completedAt});assert.equal(r.status,409,JSON.stringify(r.body));assert.deepEqual(await snapshot(),before);
 }
});
