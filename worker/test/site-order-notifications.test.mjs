import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const id='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';
const order={id,orderNumber:'007',project:'Airport',orderType:'Panels',status:'submitted',items:[],requestedBy:'alice'};
const alert={id:'alert-one',orderId:id,kind:'orders',link:'orders',title:'Delivery delayed',message:'Airport',createdAt:'2026-10-11',read:false};
function harness(){
 const saved=new Map(),buttons=new Map(),loaders=[];
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 const node={innerHTML:'',appendChild(){},addEventListener(){},querySelector:selector=>buttons.get(selector)||null,querySelectorAll:()=>[]};
 const context={console,URL,Headers,Response,AbortSignal,Map,Set,Date,Promise,
  document:{getElementById:()=>node,createElement:()=>({textContent:''}),head:node,body:node,querySelectorAll:()=>[]},localStorage:storage,sessionStorage:storage,
  navigator:{onLine:false},window:{addEventListener(){}},MutationObserver:class{observe(){}},crypto:{randomUUID:()=>crypto.randomUUID()}};
 let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
 source=source.split("  window.addEventListener('online'")[0]+`
  let rendered='';render=()=>{rendered=view==='order'?orderDetails():view==='notifications'?orderAlertsView():'';};
  session={username:'alice',token:'synthetic',taskAccess:{'site.orders.view':true,'site.orders.receive':false}};
  view='notifications';
  globalThis.ui={openNotification,loadNotificationOrder,orderAlertsView,clearAccountState,wire,
   setLoaders(history,production){loadOrderHistory=history;loadProductionProgress=production;},
   setData(items,value=[]){orderAlerts=items;orders=value;},setApi(fn){api=fn;},setView(value){view=value;},
   allow(value){session.taskAccess['site.orders.view']=value;},select(value){selectedOrderId=value;},
   state:()=>({view,orders,selectedOrderId,orderReturnView,notificationOrderState,orderAlerts}),html:()=>rendered};
 })();`;
 vm.runInNewContext(source,context);
 const ui=context.ui;ui.setLoaders(value=>loaders.push(['history',value]),value=>loaders.push(['progress',value]));
 ui.setData([alert]);
 function button(selector){const value={handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},click(){return this.handlers.click?.();}};buttons.set(selector,value);return value;}
 return {...ui,loaders,button};
}

test('opening marks read, loads the exact latest order and retains a route back to notifications',async()=>{
 const h=harness(),calls=[];h.setData([alert],[{...order,project:'Stale project'},{...order,id:otherId}]);
 h.setApi(async(path,options)=>{
  calls.push(path);
  if(path==='/notifications/read'){assert.equal(JSON.parse(options.body).id,alert.id);assert.equal(h.state().view,'notifications');return Response.json({notifications:[{...alert,read:true}]});}
  assert.equal(path,'/orders/'+id);assert.equal(options,undefined);assert.equal(h.state().view,'order');assert.match(h.html(),/Loading the latest order/);
  return Response.json({order});
 });
 await h.openNotification(alert.id);
 assert.deepEqual(calls,['/notifications/read','/orders/'+id]);assert.equal(h.state().selectedOrderId,id);
 assert.equal(h.state().orders.length,2);assert.equal(h.state().orders[0].project,'Airport');
 assert.match(h.html(),/Order #007/);assert.match(h.html(),/Back to notifications/);assert.doesNotMatch(h.html(),/Stale project/);
 assert.deepEqual(h.loaders,[['history',id],['progress',id]]);assert.equal(h.state().orderAlerts[0].read,true);
 const back=h.button('[data-order-results]');h.wire();back.click();assert.equal(h.state().view,'notifications');
});

test('already read alerts skip read writes and old alerts still open the Orders list',async()=>{
 const h=harness(),calls=[];h.setData([{...alert,read:true}]);h.setApi(async path=>{calls.push(path);return Response.json({order});});
 await h.openNotification(alert.id);assert.deepEqual(calls,['/orders/'+id]);
 h.setView('notifications');h.setData([{...alert,read:true,orderId:undefined}]);await h.openNotification(alert.id);
 assert.equal(h.state().view,'orders');assert.equal(calls.length,1);
});

test('read failures do not navigate or load order data',async()=>{
 const h=harness(),calls=[];h.setApi(async path=>{calls.push(path);return Response.json({error:'Read failed'},{status:500});});
 await h.openNotification(alert.id);assert.equal(h.state().view,'notifications');assert.deepEqual(calls,['/notifications/read']);
 assert.equal(h.state().orderAlerts[0].read,false);assert.match(h.html(),/Read failed/);
});

test('missing orders, denied access and malformed responses show a retry instead of stale details',async()=>{
 for(const [response,error] of [[Response.json({error:'Gone'},{status:404}),/no longer available/],[Response.json({error:'Access denied'},{status:403}),/Access denied/],[Response.json({order:{...order,id:otherId}}),/could not be loaded/]]){
  const h=harness();h.setData([{...alert,read:true}],[{...order,project:'Private stale data'}]);h.setApi(async()=>response);
  await h.openNotification(alert.id);assert.match(h.html(),error);assert.match(h.html(),/data-retry-notification-order/);assert.match(h.html(),/Back to notifications/);
  assert.doesNotMatch(h.html(),/Private stale data/);assert.equal(h.loaders.length,0);
 }
});

test('offline failures keep the read state and the Retry control recovers',async()=>{
 const h=harness();h.setData([{...alert,read:true}]);h.setApi(async()=>{throw Error('Connection lost');});
 await h.openNotification(alert.id);assert.match(h.html(),/Connection lost/);assert.equal(h.state().orderAlerts[0].read,true);
 h.setApi(async()=>Response.json({order}));const retry=h.button('[data-retry-notification-order]');h.wire();retry.click();
 await new Promise(resolve=>setImmediate(resolve));assert.match(h.html(),/Order #007/);assert.doesNotMatch(h.html(),/Connection lost/);
});

test('late order responses cannot restore data after logout or replace another screen or order',async()=>{
 for(const action of ['logout','navigate','different-order']){
  const h=harness();h.setData([{...alert,read:true}]);let release;h.setApi(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.openNotification(alert.id);
  if(action==='logout')h.clearAccountState();else if(action==='navigate')h.setView('new');else h.select(otherId);
  release(Response.json({order}));await pending;assert.equal(h.state().orders.length,0);assert.equal(h.loaders.length,0);
 }
});

test('a newer refresh wins and a late read response cannot interrupt navigation',async()=>{
 const h=harness();h.setData([{...alert,read:true}]);let release;h.setApi(()=>new Promise(resolve=>{release=resolve;}));
 const old=h.openNotification(alert.id);h.setApi(async()=>Response.json({order:{...order,project:'Latest project'}}));
 await h.loadNotificationOrder(id);release(Response.json({order}));await old;assert.equal(h.state().orders[0].project,'Latest project');
 const second=harness();second.setApi(()=>new Promise(resolve=>{release=resolve;}));const read=second.openNotification(alert.id);second.setView('new');
 release(Response.json({notifications:[{...alert,read:true}]}));await read;assert.equal(second.state().view,'new');assert.equal(second.loaders.length,0);
});

test('unsafe metadata and disallowed order links never fetch or open an exact order',async()=>{
 const h=harness();h.setApi(()=>assert.fail('must not fetch'));
 for(const orderId of ['https://example.com','../private',{},id+'/history']){
  h.setView('notifications');h.setData([{...alert,read:true,orderId}]);await h.openNotification(alert.id);assert.equal(h.state().view,'orders');
 }
 h.setView('notifications');h.setData([{...alert,read:true}]);h.allow(false);await h.openNotification(alert.id);
 assert.equal(h.state().view,'notifications');assert.doesNotMatch(h.orderAlertsView(),/Open order details/);
});
