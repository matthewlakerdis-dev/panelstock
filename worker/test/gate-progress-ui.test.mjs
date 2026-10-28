import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const order={id:'gate-order',orderType:'Gate',status:'approved',updatedAt:'v1',items:[]};
function harness(){
 const node={innerHTML:'',appendChild(){},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]},storage={getItem:()=>null,setItem(){},removeItem(){}};
 const context={console,URL,Headers,Response,AbortSignal,Map,Set,Date,Promise,document:{getElementById:()=>node,createElement:()=>({textContent:''}),head:node,body:node,querySelectorAll:()=>[]},localStorage:storage,sessionStorage:storage,navigator:{onLine:true},window:{addEventListener(){}},MutationObserver:class{observe(){}},crypto:{randomUUID:()=>crypto.randomUUID()}};
 let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
 source=source.split("  window.addEventListener('online'")[0]+`
 render=()=>{};loadProductionProgress=()=>{};loadOrderHistory=()=>{};
 session={username:'manager',isAdmin:false,taskAccess:{'site.orders.manage':true}};
 globalThis.ui={gateProductionEditorView,saveGateProgress,clearAccountState,state:()=>gateEditor,setApi(fn){api=fn;},setOrder(value){orders=[value];selectedOrderId=value.id;view='order';},setManager(value){session.taskAccess['site.orders.manage']=value;},orders:()=>orders};
 })();`;
 vm.runInNewContext(source,context);return context.ui;
}
test('Gate managers edit Drawn while QA and readiness are read-only; viewers and terminal orders cannot edit',()=>{
 const h=harness();const html=h.gateProductionEditorView(order);for(const name of ['drawn','fabricatedQa','readyForDispatch'])assert.match(html,new RegExp('name="'+name+'"'));assert.equal((html.match(/<select/g)||[]).length,3);assert.match(html,/Other tracker stages show N\/A/);assert.match(html,/<select name="fabricatedQa"[^>]*disabled/);assert.match(html,/<select name="readyForDispatch"[^>]*disabled/);
 for(const next of [{...order,local:true},{...order,orderType:'Panels'},{...order,status:'dispatched'},{...order,status:'cancelled'}])assert.equal(h.gateProductionEditorView(next),'');
 h.setManager(false);assert.equal(h.gateProductionEditorView(order),'');
});
test('Site saves only Drawn with a version, preserves entries after conflicts and avoids duplicate saves',async()=>{
 const h=harness();h.setOrder(order);h.gateProductionEditorView(order);h.state().stages={drawn:'complete',fabricatedQa:'complete',readyForDispatch:'pending'};let calls=0,payload;
 h.setApi(async(path,options)=>{calls++;assert.equal(path,'/orders/gate-order/progress');payload=JSON.parse(options.body);return Response.json({code:'ORDER_CONFLICT',order:{...order,updatedAt:'latest'}},{status:409});});
 await h.saveGateProgress({preventDefault(){}});assert.deepEqual(payload,{expectedUpdatedAt:'v1',stages:{drawn:'complete'}});assert.equal(h.state().stages.fabricatedQa,'complete');assert.equal(h.state().conflict.updatedAt,'latest');assert.match(h.gateProductionEditorView(order),/Use latest progress/);
 await h.saveGateProgress({preventDefault(){}});assert.equal(calls,1);
 h.state().conflict=null;h.state().expectedUpdatedAt='latest';let finish;
 h.setApi(()=>{calls++;return new Promise(resolve=>finish=resolve);});const first=h.saveGateProgress({preventDefault(){}});await h.saveGateProgress({preventDefault(){}});assert.equal(calls,2);
 finish(Response.json({ok:true,order:{...order,updatedAt:'v2',manualProduction:{stages:payload.stages}}}));await first;assert.equal(h.state().expectedUpdatedAt,'v2');
});
test('a save response cannot restore Gate progress after logout',async()=>{
 const h=harness();h.setOrder(order);h.gateProductionEditorView(order);let finish;h.setApi(()=>new Promise(resolve=>finish=resolve));const saving=h.saveGateProgress({preventDefault(){}});h.clearAccountState();finish(Response.json({ok:true,order:{...order,updatedAt:'private'}}));await saving;assert.equal(h.state(),null);assert.equal(h.orders().length,0);
});
