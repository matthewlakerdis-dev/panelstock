import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const order={id:'gate-order',orderType:'Panels',status:'approved',updatedAt:'v1',items:[]};
function harness(){
 const node={innerHTML:'',appendChild(){},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]},storage={getItem:()=>null,setItem(){},removeItem(){}};
 const context={console,URL,Headers,Response,AbortSignal,Map,Set,Date,Promise,document:{getElementById:()=>node,createElement:()=>({textContent:''}),head:node,body:node,querySelectorAll:()=>[]},localStorage:storage,sessionStorage:storage,navigator:{onLine:true},window:{addEventListener(){}},MutationObserver:class{observe(){}},crypto:{randomUUID:()=>crypto.randomUUID()}};
 let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
 source=source.split("  window.addEventListener('online'")[0]+`
 render=()=>{};loadProductionProgress=()=>{};loadOrderHistory=()=>{};
 session={username:'manager',isAdmin:false,taskAccess:{'site.orders.manage':true}};
 globalThis.ui={panelDrawingEditorView,savePanelDrawing,clearAccountState,state:()=>panelDrawingEditor,setApi(fn){api=fn;},setOrder(value){orders=[value];selectedOrderId=value.id;view='order';},setManager(value){session.taskAccess['site.orders.manage']=value;},orders:()=>orders};
 })();`;
 vm.runInNewContext(source,context);return context.ui;
}

test('panel managers can edit Drawn, while viewers and terminal orders cannot',()=>{
 const h=harness();const html=h.panelDrawingEditorView(order);assert.match(html,/Update panel drawing status/);assert.equal((html.match(/<select/g)||[]).length,1);assert.match(html,/name="drawn"/);assert.match(html,/Save drawing status/);
 for(const next of [{...order,local:true},{...order,orderType:'Gate'},{...order,status:'dispatched'},{...order,status:'cancelled'}])assert.equal(h.panelDrawingEditorView(next),'');
 h.setManager(false);assert.equal(h.panelDrawingEditorView(order),'');
});
test('panel Drawn retains drafts on conflicts and prevents duplicate requests',async()=>{
 const h=harness();h.setOrder(order);h.panelDrawingEditorView(order);h.state().stages.drawn='complete';let calls=0,payload;
 h.setApi(async(path,options)=>{calls++;assert.equal(path,'/orders/gate-order/drawing');payload=JSON.parse(options.body);return Response.json({code:'ORDER_CONFLICT',order:{...order,updatedAt:'latest'}},{status:409});});
 await h.savePanelDrawing({preventDefault(){}});assert.deepEqual(payload,{expectedUpdatedAt:'v1',drawn:true});assert.equal(h.state().stages.drawn,'complete');assert.equal(h.state().conflict.updatedAt,'latest');assert.match(h.panelDrawingEditorView(order),/Use latest progress/);
 await h.savePanelDrawing({preventDefault(){}});assert.equal(calls,1);
 h.state().conflict=null;h.state().expectedUpdatedAt='latest';let finish;h.setApi(()=>{calls++;return new Promise(resolve=>finish=resolve);});const saving=h.savePanelDrawing({preventDefault(){}});await h.savePanelDrawing({preventDefault(){}});assert.equal(calls,2);finish(Response.json({ok:true,order:{...order,updatedAt:'v2',manualDrawing:{drawn:true}}}));await saving;assert.equal(h.state().expectedUpdatedAt,'v2');
});
test('a late panel Drawn response cannot restore data after logout',async()=>{
 const h=harness();h.setOrder(order);h.panelDrawingEditorView(order);let finish;h.setApi(()=>new Promise(resolve=>finish=resolve));const saving=h.savePanelDrawing({preventDefault(){}});h.clearAccountState();finish(Response.json({ok:true,order:{...order,updatedAt:'private'}}));await saving;assert.equal(h.state(),null);assert.equal(h.orders().length,0);
});
