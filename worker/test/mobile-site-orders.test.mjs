import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const app=read('site/app.js'),mobile=read('panelstock-app.modern.js');
const user={username:'alice',isAdmin:false,taskAccess:{'site.orders.view':true,'site.orders.create':true}};
const host=()=>({session:user,isCurrent:()=>true,apiFetch:async()=>Response.json({ok:true,...user})});
function storage(){const entries=new Map();return {getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};}
function siteHarness(adapter){
  const localStorage=storage(),sessionStorage=storage();
  sessionStorage.setItem('panelstock:site-orders:session:v1',JSON.stringify({username:'other',token:'must-not-be-used'}));
  localStorage.setItem('panelstock:site-orders:outbox:v1',JSON.stringify({owner:'other',queue:[{localId:'queued'}]}));
  const node={querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},prepend(){},appendChild(){}};
  const context={window:{PanelStockSiteHost:adapter,addEventListener(){}},document:{getElementById:()=>node,querySelectorAll:()=>[],createElement:()=>({...node}),head:node,body:node},localStorage,sessionStorage,
    navigator:{onLine:true},MutationObserver:class{observe(){}},Headers,Response,AbortSignal,URL,console,
    fetch:()=>{throw Error('The embedded client must use the mobile API client');}};
  const source=app.slice(0,app.indexOf("  window.addEventListener('online'")).replace(/^import .*?;\s*/,'')+`
    globalThis.ui={api,refresh,can,shell,clearAccountState,state:()=>({session,outbox})};
  })();`;
  vm.runInNewContext(source,context);return {...context.ui,sessionStorage,localStorage};
}
test('embedded orders use mobile identity and API without copying or reading a second login',async()=>{
  const calls=[],adapter=host();adapter.apiFetch=async(url,options)=>{calls.push({url,options});return Response.json({ok:true,...user});};
  const h=siteHarness(adapter);
  assert.equal(h.state().session.username,'alice');assert.equal(h.state().session.token,undefined);
  await h.api('/orders');assert.match(calls[0].url,/\/orders$/);assert.equal(calls[0].options.headers.has('Authorization'),false);
  await h.refresh();assert.equal(JSON.parse(h.sessionStorage.getItem('panelstock:site-orders:session:v1')).username,'other');
  assert.equal(h.can('site.orders.create'),true);assert.equal(h.can('site.orders.manage'),false);
  const html=h.shell('order content');assert.match(html,/order content/);assert.doesNotMatch(html,/bottom-nav|data-settings|data-support/);
  h.clearAccountState();assert.equal(h.state().outbox.owner,'other');assert.equal(h.state().outbox.queue.length,1);
});
test('switching mobile accounts rejects late responses and delayed JSON while keeping saved requests',async()=>{
  let current=true,finish;const adapter=host();adapter.isCurrent=()=>current;
  adapter.apiFetch=()=>new Promise(resolve=>finish=resolve);
  const h=siteHarness(adapter),request=h.api('/orders');current=false;finish(Response.json({orders:[{id:'private'}]}));
  await assert.rejects(request,/Session changed/);
  current=true;let finishJson;adapter.apiFetch=async()=>({status:200,json:()=>new Promise(resolve=>finishJson=resolve)});
  const response=await h.api('/orders'),json=response.json();current=false;finishJson({orders:[{id:'private'}]});
  await assert.rejects(json,/Session changed/);assert.equal(h.state().outbox.queue.length,1);
});
test('mobile navigation exposes Site Orders only to order viewers and keeps factory landing tabs unchanged',()=>{
  const source=mobile.slice(mobile.indexOf('  var TABS = ['),mobile.indexOf('  // Compact router'));
  const icons=Object.fromEntries([...source.matchAll(/icon:\s*(\w+)/g)].map(match=>[match[1],()=>{}]));
  function visible(isAdmin,taskAccess){const context={...icons,isAdmin,taskAccess};vm.runInNewContext(source+'globalThis.ids=TABS.filter(item=>(!item.adminOnly||isAdmin)&&(item.tasks.length===0||isAdmin||item.tasks.some(task=>taskAccess[task]))).map(item=>item.id);',context);return Array.from(context.ids);}
  assert.ok(visible(false,{'site.orders.view':true}).includes('orders'));
  assert.ok(!visible(false,{'site.orders.create':true}).includes('orders'));
  assert.ok(visible(true,{}).includes('orders'));
  assert.equal(visible(false,{'factory.stock':true,'site.orders.view':true})[0],'workshop');
  const start=mobile.indexOf('    const visibleTabs='),end=mobile.indexOf('\n\n',start);
  function navigation(isAdmin,taskAccess){
    const context={...icons,isAdmin,taskAccess};
    vm.runInNewContext(source+mobile.slice(start,end)+'globalThis.nav={primary:primaryTabs.map(item=>item.id),more:moreTabs.map(item=>item.id),bar:navigationTabs.map(item=>item.id)};',context);
    return JSON.parse(JSON.stringify(context.nav));
  }
  const viewer=navigation(false,{'site.orders.view':true});
  assert.ok(viewer.primary.includes('orders'));assert.ok(viewer.bar.includes('orders'));assert.ok(!viewer.more.includes('orders'));
  assert.ok(!navigation(false,{}).bar.includes('orders'));
  const admin=navigation(true,{});
  assert.deepEqual(admin.bar,['workshop','receive','cnc','dispatch','qa','orders','more']);
  assert.ok(admin.more.includes('damage'));assert.ok(!admin.more.includes('dispatch'));
  const dispatcher=navigation(false,{'factory.dispatch':true});
  assert.ok(dispatcher.bar.includes('dispatch'));assert.ok(!dispatcher.more.includes('damage'));
  const damageUser=navigation(false,{'factory.damage':true});
  assert.ok(damageUser.more.includes('damage'));assert.ok(!damageUser.bar.includes('damage'));assert.ok(!damageUser.bar.includes('dispatch'));
  assert.match(mobile,/hidden:!active/);assert.match(mobile,/PanelStockMobileOrdersCapture/);
});
test('mobile host rejects direct and cross-origin entry and selects the current modern or legacy order client',()=>{
  function boot(parent,ua=''){const appended=[],root={};const window={location:{origin:'https://app.example'},parent};
    const document={getElementById:()=>root,createElement:()=>({}),body:{appendChild:node=>appended.push(node)}};
    vm.runInNewContext(read('mobile-orders/host.js'),{window,document,navigator:{userAgent:ua}});return {appended,root,window};}
  const adapter=host(),parent={location:{origin:'https://app.example'},PanelStockMobileOrders:adapter};
  const modern=boot(parent);assert.equal(modern.appended[0].type,'module');assert.equal(modern.appended[0].src,'../site/app.js');
  const legacy=boot(parent,'iPhone OS 10_3');assert.equal(legacy.appended[0].src,'../site/app.legacy.js');
  assert.equal(legacy.window.require('../worker/src/brand-logo.js').brandLogo,adapter.logo);
  assert.equal(boot({...parent,location:{origin:'https://other.example'}}).appended.length,0);
  assert.equal(boot({...parent,PanelStockMobileOrders:null}).appended.length,0);
  assert.equal(boot({...parent,PanelStockMobileOrders:{...adapter,session:{username:'no-access',taskAccess:{}}}}).appended.length,0);
  assert.match(app,/if\(!mobileHost&&'serviceWorker'in navigator\)/);
  assert.match(read('push-sw.js'),/\.\/mobile-orders\//);
});
