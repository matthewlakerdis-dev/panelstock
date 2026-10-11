import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(){
  const saved=new Map(),storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  const node={innerHTML:'',appendChild(){},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]};
  const context={console,URL,Headers,Response,AbortSignal,Map,Set,Date,Promise,
    document:{getElementById:()=>node,createElement:()=>({textContent:''}),head:node,body:node,querySelectorAll:()=>[]},localStorage:storage,sessionStorage:storage,
    navigator:{onLine:false},window:{addEventListener(){}},MutationObserver:class{observe(){}},crypto:{randomUUID:()=>crypto.randomUUID()}};
  let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
  source=source.split("  window.addEventListener('online'")[0]+`
    render=()=>{};
    session={username:'viewer',token:'synthetic',isAdmin:false};
    globalThis.ui={loadProductionProgress,orderProductionView,clearAccountState,
      state:()=>productionState,setApi(fn){api=fn;},select(id){selectedOrderId=id;view='order';},
      detail(order){orders=[order];selectedOrderId=order.id;return orderDetails();}};
  })();`;
  vm.runInNewContext(source,context);return context.ui;
}

test('details show accessible production states and escape summary text',async()=>{
  const h=harness(),order={id:'production-one',status:'submitted',orderType:'Panels',items:[]};h.select(order.id);
  h.setApi(async path=>{assert.equal(path,'/orders/production-one/progress');return Response.json({progress:{orderId:order.id,cancelled:false,stages:[{label:'Drawn',state:'complete'},{label:'Toolpathed',state:'pending'},{label:'Final QA',state:'not_applicable'},{label:'<script>Bad label</script>',state:'forged'}],notes:'<img src=x onerror=bad()>'}});});
  await h.loadProductionProgress(order.id);
  const html=h.detail(order);
  assert.match(html,/Production progress/);assert.match(html,/is-complete/);assert.match(html,/is-pending/);assert.match(html,/Not applicable/);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img src=x|is-forged/);
  assert.doesNotMatch(h.detail({...order,local:true}),/Production progress/);
});

test('refresh failures remain retryable and a subsequent retry recovers',async()=>{
  const h=harness(),order={id:'production-one',items:[]};h.select(order.id);
  h.setApi(async()=>{throw Error('Connection lost');});await h.loadProductionProgress(order.id);
  assert.match(h.orderProductionView(order),/role="alert"[^>]*>Connection lost/);
  assert.match(h.orderProductionView(order),/data-refresh-production/);
  h.setApi(async()=>Response.json({progress:{orderId:order.id,cancelled:true,stages:[],notes:'Order cancelled'}}));
  await h.loadProductionProgress(order.id);
  assert.match(h.orderProductionView(order),/This order is cancelled/);
  assert.doesNotMatch(h.orderProductionView(order),/Connection lost/);
});

test('older refreshes cannot replace a newer response',async()=>{
  const h=harness(),id='production-one';h.select(id);let resolve;
  h.setApi(()=>new Promise(done=>{resolve=done;}));const old=h.loadProductionProgress(id);
  assert.match(h.orderProductionView({id}),/Loading production progress/);
  h.setApi(async()=>Response.json({progress:{orderId:id,stages:[],notes:'Latest'}}));await h.loadProductionProgress(id);
  resolve(Response.json({progress:{orderId:id,stages:[],notes:'Old'}}));await old;
  assert.equal(h.state().progress.notes,'Latest');
});

test('responses cannot restore data after logout or affect a different selected order',async()=>{
  for(const logout of [false,true]){
    const h=harness(),id='production-one';h.select(id);let resolve;
    h.setApi(()=>new Promise(done=>{resolve=done;}));const pending=h.loadProductionProgress(id);
    if(logout)h.clearAccountState();else h.select('production-two');
    resolve(Response.json({progress:{orderId:id,stages:[],notes:'Private old account'}}));await pending;
    assert.equal(h.state().progress,undefined);
    assert.doesNotMatch(h.orderProductionView({id:'production-two'}),/Private old account/);
  }
});

test('progress belonging to a different order is rejected',async()=>{
  const h=harness();h.select('production-one');
  h.setApi(async()=>Response.json({progress:{orderId:'production-two',stages:[],notes:'Wrong order'}}));await h.loadProductionProgress('production-one');
  assert.match(h.orderProductionView({id:'production-one'}),/unavailable/);
  assert.doesNotMatch(h.orderProductionView({id:'production-one'}),/Wrong order/);
});
