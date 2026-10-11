import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const today='2026-10-11';
const order=(id,extra={})=>({id,project:'Airport',orderNumber:id,requestedBy:'alice',orderType:'Panels',status:'submitted',createdAt:'2026-10-01',requestedDeliveryDate:'2026-10-15',scheduledDeliveryDate:'2026-10-15',items:[],...extra});
const packet=(id,extra={})=>({localId:id,createdAt:'2026-10-01',order:order(id),attachments:[],idempotencyKey:'key-'+id,...extra});

function harness(){
  const saved=new Map(),controls=new Map(),lists=new Map(),requests=[],storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  const node={innerHTML:'',appendChild(){},addEventListener(){},querySelector:selector=>controls.get(selector)||null,querySelectorAll:selector=>lists.get(selector)||[]};
  const context={console,URL,Headers,Response,AbortSignal,Map,Set,Date,Promise,
    document:{getElementById:()=>node,createElement:()=>({textContent:''}),head:node,body:node,querySelectorAll:()=>[]},localStorage:storage,sessionStorage:storage,
    navigator:{onLine:false},window:{addEventListener(){}},MutationObserver:class{observe(){}},crypto:{randomUUID:()=>crypto.randomUUID()}};
  let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
  source=source.split("  window.addEventListener('online'")[0]+`
    const realRender=render;let rendered='';
    render=()=>{rendered=view==='order-attention'?orderAttentionView():view==='order'?orderDetails():orderList();};
    session={username:'alice',token:'synthetic',isAdmin:false};
    globalThis.ui={orderAttentionEntries,orderAttentionView,orderList,refreshAttention,clearAccountState,wire,realRender,
      setData(value,queue=[],owner='alice'){orders=value;outbox={owner,queue};},setApi(fn){api=fn;},
      setFilter(value){attentionFilter=value;},setView(value){view=value;},setPermission(value){session.taskAccess={'site.orders.view':value,'site.cnc.view':false};},
      setLoaders(history,production){loadOrderHistory=history;loadProductionProgress=production;},setFlush(fn){flush=fn;},
      state:()=>({orders,outbox,view,attentionFilter,attentionRefreshing,attentionError,selectedOrderId}),html:()=>rendered};
  })();`;
  vm.runInNewContext(source,context);
  function button(selector,dataset={},multiple=false){
    const value={dataset,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},click(){return this.onclick?this.onclick():this.handlers.click?.();}};
    if(multiple){const values=lists.get(selector)||[];values.push(value);lists.set(selector,values);}else controls.set(selector,value);
    return value;
  }
  return {...context.ui,button,node,requests};
}

test('attention respects confirmed dates, Brisbane boundaries and active-order status',()=>{
  const h=harness();h.setData([
    order('future'),order('confirmed-late',{requestedDeliveryDate:'2026-10-20',scheduledDeliveryDate:'2026-10-10'}),
    order('requested-late',{requestedDeliveryDate:'2026-10-10',scheduledDeliveryDate:''}),
    order('due-today',{requestedDeliveryDate:today,scheduledDeliveryDate:today}),
    order('completed',{status:'completed',requestedDeliveryDate:'2026-09-01',scheduledDeliveryDate:''}),
    order('cancelled',{status:'cancelled',requestedDeliveryDate:'2026-09-01',scheduledDeliveryDate:''})]);
  const entries=h.orderAttentionEntries(today);
  assert.deepEqual(Array.from(entries,entry=>entry.order.id),['confirmed-late','requested-late']);
  assert.equal(entries[0].reasons[0].label,'Confirmed delivery overdue');
  assert.deepEqual(Array.from(entries[1].reasons,reason=>reason.kind),['overdue','unconfirmed']);
  assert.equal(h.orderAttentionEntries('2026-10-10').some(entry=>entry.order.id==='confirmed-late'),false);
});

test('completed and cancelled orders retain unresolved delivery issues without date warnings',()=>{
  const h=harness();h.setData([
    order('complete',{status:'completed',scheduledDeliveryDate:'',deliveryIssues:[{status:'open'},{status:'in_progress'},{status:'resolved'}]}),
    order('cancelled',{status:'cancelled',scheduledDeliveryDate:'',deliveryIssues:[{status:'open'}]}),
    order('resolved',{status:'completed',deliveryIssues:[{status:'resolved'}]})]);
  const entries=h.orderAttentionEntries(today);
  assert.equal(entries.length,2);assert.ok(entries.every(entry=>entry.reasons.length===1&&entry.reasons[0].kind==='issues'));
  assert.equal(entries.find(entry=>entry.order.id==='complete').reasons[0].label,'2 unresolved delivery issues');
});

test('uploads join their saved order once and unsent requests stay local without mutations',()=>{
  const h=harness(),cloud=order('saved',{scheduledDeliveryDate:'',requestedDeliveryDate:'2026-10-10'});
  const queued=[packet('device-one',{orderId:'saved',attachments:[{id:'file-one',name:'photo.jpg'}]}),packet('device-two')];
  h.setData([cloud],queued);const before=JSON.stringify(h.state());
  const entries=h.orderAttentionEntries(today);
  assert.equal(entries.length,2);
  const joined=entries.find(entry=>entry.order.id==='saved');assert.equal(joined.order.local,undefined);
  assert.deepEqual(Array.from(joined.reasons,reason=>reason.kind),['sync','overdue','unconfirmed']);
  const local=entries.find(entry=>entry.order.id==='device-two');assert.equal(local.order.local,true);assert.equal(local.order.orderNumber,'Pending');
  assert.equal(local.reasons.length,1);assert.equal(local.reasons[0].label,'Waiting to submit');
  assert.equal(JSON.stringify(h.state()),before);
  assert.match(h.orderAttentionView(),/Connect to finish syncing/);
});

test('another account cannot see the device queue and logout preserves its contents',()=>{
  const h=harness(),queue=[packet('private')];h.setData([],queue,'bob');
  assert.equal(h.orderAttentionEntries(today).length,0);
  h.setData([],queue);h.setFilter('issues');h.clearAccountState();
  assert.equal(h.orderAttentionEntries(today).length,0);assert.equal(h.state().attentionFilter,'all');
  assert.equal(JSON.stringify(h.state().outbox.queue),JSON.stringify(queue));
});

test('attention counts are per order while category counts can overlap',()=>{
  const h=harness();h.setData([order('one',{scheduledDeliveryDate:'',requestedDeliveryDate:'2000-01-01',deliveryIssues:[{status:'open'}]}),order('two',{scheduledDeliveryDate:''}),order('clear')]);
  const html=h.orderAttentionView();
  assert.match(html,/2 orders need attention/);
  assert.match(html,/data-attention-filter="all"[^>]*><span>All attention<\/span><b>2/);
  assert.match(html,/data-attention-filter="unconfirmed"[^>]*><span>Unconfirmed<\/span><b>2/);
  h.setFilter('issues');const filtered=h.orderAttentionView();assert.match(filtered,/1 matching order/);
  assert.match(filtered,/data-order-details="one"/);assert.doesNotMatch(filtered,/data-order-details="two"/);
});

test('pending submissions and issues precede overdue orders with stable date ordering',()=>{
  const h=harness();h.setData([order('later',{scheduledDeliveryDate:'2026-10-10'}),order('earlier',{scheduledDeliveryDate:'2026-10-09'}),order('issue',{deliveryIssues:[{status:'open'}]})],[packet('unsent')]);
  assert.deepEqual(Array.from(h.orderAttentionEntries(today),entry=>entry.order.id),['unsent','issue','earlier','later']);
});

test('reason filtering, order details and back navigation preserve the selected category',()=>{
  const h=harness();h.setData([order('one',{deliveryIssues:[{status:'open'}]})]);let loaded=[];
  const open=h.button('[data-open-attention]'),filter=h.button('[data-attention-filter]',{attentionFilter:'issues'},true),details=h.button('[data-order-details]',{orderDetails:'one'},true),back=h.button('[data-order-results]');
  h.setLoaders(id=>loaded.push('history:'+id),id=>loaded.push('progress:'+id));h.wire();
  open.click();assert.equal(h.state().view,'order-attention');filter.click();assert.equal(h.state().attentionFilter,'issues');
  details.click();assert.equal(h.state().selectedOrderId,'one');assert.match(h.html(),/Back to needs attention/);
  assert.deepEqual(loaded,['history:one','progress:one']);back.click();assert.equal(h.state().view,'order-attention');assert.equal(h.state().attentionFilter,'issues');
});

test('the attention screen escapes order text and respects order-view permissions',()=>{
  const h=harness();h.setData([order('one',{project:'<script>bad()</script>',requestedBy:'<img src=x>',scheduledDeliveryDate:''})]);
  const html=h.orderAttentionView();assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img src=x/);
  h.setView('order-attention');h.setPermission(false);h.realRender();assert.equal(h.state().view,'settings');assert.doesNotMatch(h.node.innerHTML,/Needs attention/);
});

test('refresh uses the existing read-only orders endpoint and retains information on failure',async()=>{
  const h=harness();h.setView('order-attention');h.setData([order('old',{scheduledDeliveryDate:''})]);
  h.setApi(async path=>{assert.equal(path,'/orders');return Response.json({error:'Connection failed'},{status:503});});
  await h.refreshAttention();assert.equal(h.state().orders[0].id,'old');assert.match(h.orderAttentionView(),/role="alert"[^>]*>Connection failed/);
  h.setApi(async()=>Response.json({orders:[order('new')]}));await h.refreshAttention();
  assert.equal(h.state().orders[0].id,'new');assert.equal(h.state().attentionError,'');assert.match(h.orderAttentionView(),/No orders need attention/);
});

test('a late refresh cannot restore another account or replace an active form',async()=>{
  for(const logout of [false,true]){
    const h=harness();h.setView('order-attention');let resolve,calls=0;
    h.setApi(()=>{calls++;return new Promise(done=>{resolve=done;});});const pending=h.refreshAttention();
    await h.refreshAttention();assert.equal(calls,1);
    if(logout)h.clearAccountState();else h.setView('new');const rendered=h.html();
    resolve(Response.json({orders:[order('new')]}));await pending;
    assert.equal(h.html(),rendered);assert.equal(h.state().attentionRefreshing,false);
    if(logout)assert.equal(h.state().orders.length,0);
  }
});

test('retry controls reuse existing sync without triggering automatic submissions',()=>{
  const h=harness();let calls=0;h.setData([],[packet('waiting')]);h.setFlush(()=>{calls++;});
  const retry=h.button('[data-attention-sync]',{},true);h.wire();h.orderAttentionView();assert.equal(calls,0);
  retry.click();assert.equal(calls,1);
});
