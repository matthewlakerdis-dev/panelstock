import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('profile photo offers separate camera and library controls with accessible labels',()=>{
  const source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');
  assert.match(source,/capture="user" aria-label="Take profile photo"/);
  assert.match(source,/accept="image\/\*" aria-label="Choose profile photo"/);
  assert.match(source,/\.photo-camera\{background:#155e75;color:#fff\}/);
  assert.match(source,/\.photo-library\{background:#fff;color:#155e75\}/);
  assert.match(source,/\.profile-photo-choose:focus-within/);
});

function harness(){
  const rows=[],requests=[],saved=new Map();let focused=null,id=0,draftForm=null;
  const input=(name,value)=>({name,value,required:name==='quantity',focus(){focused=this;},
    matches:selector=>selector==='input',
    reportValidity(){return name==='quantity'?Number.isInteger(Number(this.value))&&Number(this.value)>=1:!this.required||!!this.value;}});
  function row(){
    const quantity=input('quantity','1'),description=input('description',''),button={};
    const value={className:'',innerHTML:'',classList:{contains:name=>name==='item'},handlers:{},
      querySelector:selector=>selector==='[name=quantity]'?quantity:selector==='[name=description]'?description:button,
      addEventListener:(event,handler)=>value.handlers[event]=handler,
      remove:()=>rows.splice(rows.indexOf(value),1)};
    Object.defineProperty(value,'nextElementSibling',{get:()=>rows[rows.indexOf(value)+1]});
    return value;
  }
  const node={innerHTML:'',appendChild(){},prepend(){},addEventListener(){},querySelector:selector=>selector==='[data-order]'?draftForm:selector==='.items'?{appendChild:r=>rows.push(r)}:null,
    querySelectorAll:selector=>selector==='.item'?rows:[]};
  const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  const context={console,URL,Headers,Response,AbortSignal,Map,Set,Date,Promise,
    document:{getElementById:()=>node,createElement:tag=>tag==='div'?row():{textContent:''},head:node,body:node,querySelectorAll:()=>[]},
    localStorage:storage,sessionStorage:storage,navigator:{onLine:false},window:{addEventListener(){}},
    crypto:{randomUUID:()=>String(++id)},MutationObserver:class{observe(){}},
    FormData:class{constructor(values){this.values=values;}get(key){return this.values[key]??null;}},
    fetch:async(url,options)=>{requests.push({url,options});const body=JSON.parse(options.body);return Response.json({profile:{...body}});}
  };
  let source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'');
  source=source.split("  window.addEventListener('online'")[0]+`
    let renderedForm='';render=()=>{if(view==='new')renderedForm=newOrder();};
    globalThis.entry={openCloudDraft,deleteDeviceDraft,listedDeviceDraft,notificationBell,orderAlertsView,pollOrderAlerts,markNotifications,openNotification,clearNotifications,notificationTarget,
      setAlerts(value){orderAlerts=value;notificationLoaded=true;},setApi(fn){api=fn;},setView(value){view=value;},
      notificationState:()=>({items:orderAlerts,error:notificationError,busy:notificationBusy}),
      renderedForm:()=>renderedForm,draftCount,setCloudDrafts(value){cloudDrafts=value;},startNewSiteDraft,setDraftApi(fn){draftApi=fn;},orderDates,orderList,persistCloudDraft,saveCloudDraft,cloudDraftView,matchesOrder,deliveryInfo,orderDay,orderTimeline,setFilters(query,project,requester,delivery){orderQuery=query;orderProject=project;orderRequester=requester;orderDelivery=delivery;},setHistory(value){historyState=value;},openDraft,captureDraft,savedDraft,discardDraft,orderDetails,addItem,updateItemRequirements,newOrder,settingsView,saveProfile,submitOrder,clearAccountState,
      seed(value){session={username:'user-a',token:'test',isAdmin:false};profile=value;projects=[{id:'p1',name:'Project'}];},
      state:()=>({profile,outbox,message,orderDraft,view,busy}),setOnline(value){navigator.onLine=value;},failStorage(){localStorage.setItem=()=>{throw Error('Storage full');};},switchAccount(owner){session={username:owner,token:'test'};},detail(order){orders=[order];selectedOrderId=order.id;return orderDetails();}};
  })();`;
  vm.runInNewContext(source,context);
  const api=context.entry;api.seed({displayName:'User A',siteOrderDefaults:{siteContact:'Taylor & Crew',phone:'+61 0400 000 000'}});
  return {...api,rows,requests,saved,setForm(values){draftForm={querySelector:selector=>{const name=selector.match(/name="([^"]+)"/)[1];return {value:values[name]||''};},querySelectorAll:()=>rows};},focused:()=>focused,
    enter:(r,overrides={})=>{let prevented=false;r.handlers.keydown({key:'Enter',target:r.querySelector('[name=description]'),preventDefault:()=>prevented=true,...overrides});return prevented;}};
}

test('settings collect personal defaults and new orders escape them without making fields read-only',()=>{
  const h=harness(),settings=h.settingsView(),order=h.newOrder();
  assert.match(settings,/Site order defaults/);assert.match(settings,/name="defaultSiteContact"/);assert.match(settings,/type="tel"/);
  assert.match(order,/name="siteContact"[^>]*value="Taylor &amp; Crew"/);
  assert.match(order,/name="phone"[^>]*value="\+61 0400 000 000"/);
  assert.doesNotMatch(order,/readonly/);
  h.clearAccountState();h.seed({displayName:'Other User'});
  assert.doesNotMatch(h.newOrder(),/Taylor|0400/);
});

test('saving settings sends defaults and uses the saved profile on the next order',async()=>{
  const h=harness();
  await h.saveProfile({preventDefault(){},currentTarget:{displayName:'User A',email:'',defaultSiteContact:'New Contact',defaultSitePhone:'0123 456 789'}});
  assert.deepEqual(JSON.parse(h.requests[0].options.body).siteOrderDefaults,{siteContact:'New Contact',phone:'0123 456 789'});
  assert.match(h.newOrder(),/value="New Contact"/);assert.match(h.newOrder(),/value="0123 456 789"/);
});

test('Enter keeps a valid item, adds a focused optional row and never submits the order',()=>{
  const h=harness(),first=h.addItem();
  first.querySelector('[name=description]').value='Panel A';h.updateItemRequirements();
  assert.equal(h.enter(first),true);assert.equal(h.rows.length,2);
  assert.equal(first.querySelector('[name=description]').value,'Panel A');
  assert.equal(h.focused(),h.rows[1].querySelector('[name=description]'));
  assert.equal(h.rows[1].querySelector('[name=description]').required,false);
  assert.match(first.innerHTML,/enterkeyhint="next"/);
  assert.match(first.innerHTML,/name="description"[^>]*enterkeyhint="enter"/);
  assert.equal(h.requests.length,0);assert.equal(h.state().outbox.queue.length,0);
  h.enter(first);assert.equal(h.rows.length,2);
  h.enter(h.rows[1]);assert.equal(h.rows.length,2);
  h.rows[1].querySelector('[name=quantity]').value='4';h.updateItemRequirements();
  assert.equal(h.rows[1].querySelector('[name=description]').required,false);
  assert.equal(h.rows[1].querySelector('[name=quantity]').required,false);
});

test('invalid quantities, key repeats and composition do not add rows',()=>{
  const h=harness(),r=h.addItem();r.querySelector('[name=description]').value='Panel';
  for(const quantity of ['','0','-1','1.5']){
    r.querySelector('[name=quantity]').value=quantity;h.enter(r);assert.equal(h.rows.length,1);
  }
  r.querySelector('[name=quantity]').value='1';
  for(const event of [{repeat:true},{isComposing:true},{keyCode:229},{key:'Tab'}]){h.enter(r,event);assert.equal(h.rows.length,1);}
  assert.equal(h.enter(r,{target:r.querySelector('[name=quantity]')}),true);assert.equal(h.rows.length,2);
});

test('submitted offline order uses per-order overrides and omits the untouched extra row',async()=>{
  const h=harness(),r=h.addItem();r.querySelector('[name=description]').value='Panel A';h.enter(r);
  await h.submitOrder({preventDefault(){},currentTarget:{projectId:'p1',orderType:'Panels',siteContact:'Order Contact',phone:'0000',requestedDeliveryDate:'2026-10-01'}});
  const order=JSON.parse(JSON.stringify(h.state().outbox.queue[0].order));
  assert.equal(order.siteContact,'Order Contact');assert.equal(order.phone,'0000');
  assert.deepEqual(order.items,[{quantity:1,description:'Panel A'}]);
  assert.equal(h.state().profile.siteOrderDefaults.siteContact,'Taylor & Crew');
  assert.equal(h.requests.length,0);
});


test('unfinished order fields and item rows survive reopening a saved draft',async()=>{
 const h=harness();await h.openDraft();const row=h.addItem();row.querySelector('[name=description]').value='Panel A';row.querySelector('[name=quantity]').value='4';
 h.setForm({projectId:'p1',siteContact:'Draft contact',phone:'0400',locationNotes:'Keep dry'});h.captureDraft();
 assert.equal(h.savedDraft().fields.locationNotes,'Keep dry');assert.equal(h.savedDraft().items[0].quantity,'4');
 h.clearAccountState();h.seed({});await h.openDraft();assert.equal(h.state().orderDraft.fields.siteContact,'Draft contact');assert.equal(h.state().orderDraft.items[0].description,'Panel A');
});

test('drafts belong to their account and discarding requires confirmation',async()=>{
 const h=harness();await h.openDraft();h.setForm({projectId:'p1',siteContact:'Private contact'});h.captureDraft();
 h.clearAccountState();h.switchAccount('other-user');assert.equal(h.savedDraft(),null);
 h.clearAccountState();h.seed({});await h.openDraft();await h.discardDraft();assert.ok(h.savedDraft());await h.discardDraft();assert.equal(h.savedDraft(),null);
});

test('an order transferred to the offline queue cannot be restored as a second draft',async()=>{
 const h=harness();await h.openDraft();h.setForm({projectId:'p1'});h.captureDraft();const draft=h.savedDraft();
 h.state().outbox.owner='user-a';h.state().outbox.queue.push({idempotencyKey:draft.id,order:{items:[]}});
 assert.equal(h.savedDraft(),null);
});

test('order details show escaped items, notes and both delivery dates',()=>{
 const h=harness();const html=h.detail({id:'o1',orderNumber:'7',project:'Project',status:'submitted',requestedBy:'user-a',requestedDeliveryDate:'2026-10-10',scheduledDeliveryDate:'2026-10-12',siteContact:'Contact',phone:'0400',items:[{quantity:3,description:'<script>bad</script>'}],locationNotes:'Keep dry'});
 assert.match(html,/Requested delivery/);assert.match(html,/Confirmed delivery/);assert.match(html,/Keep dry/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-export="pdf"/);
});


test('search combines project, requester and delivery filters without treating completed or queued orders as overdue',()=>{
 const entry=harness();entry.seed({});
 const order={id:'one',orderNumber:'105',projectId:'p1',project:'Milton',requestedBy:'user-a',status:'ordered',requestedDeliveryDate:'2026-10-08',scheduledDeliveryDate:'2026-10-12',items:[{description:'Grey panel'}]};
 assert.equal(entry.deliveryInfo(order,'2026-10-09').overdue,false);
 entry.setFilters('grey','p1','user-a','week');assert.equal(entry.matchesOrder(order,'2026-10-09'),false);
 order.scheduledDeliveryDate='2026-10-11';assert.equal(entry.matchesOrder(order,'2026-10-09'),true);
 entry.setFilters('GREY','p1','user-a','overdue');order.scheduledDeliveryDate='';assert.equal(entry.matchesOrder(order,'2026-10-09'),true);
 entry.setFilters('grey','p2','user-a','overdue');assert.equal(entry.matchesOrder(order,'2026-10-09'),false);
 entry.setFilters('grey','p1','other','overdue');assert.equal(entry.matchesOrder(order,'2026-10-09'),false);
 entry.setFilters('grey','p1','user-a','overdue');for(const status of ['completed','cancelled'])assert.equal(entry.matchesOrder({...order,status},'2026-10-09'),false);
 assert.equal(entry.matchesOrder({...order,local:true},'2026-10-09'),false);
 assert.equal(entry.deliveryInfo({...order,requestedDeliveryDate:'2026-10-09'},'2026-10-09').overdue,false);
 assert.equal(entry.orderDay(new Date('2026-10-09T15:00:00Z')),'2026-10-10');
});
test('history escapes actors and file names and provides retry on failure',()=>{
 const entry=harness();entry.seed({});entry.setHistory({id:'one',events:[{label:'File added',actor:'<script>x</script>',fileName:'<img src=x>',at:'2026-10-09T00:00:00Z'}]});
 const html=entry.orderTimeline({id:'one'});assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;img/);
 entry.setHistory({id:'one',error:'Offline'});assert.match(entry.orderTimeline({id:'one'}),/Retry history/);
 entry.clearAccountState();assert.doesNotMatch(entry.orderTimeline({id:'one'}),/Offline/);
});

test('site form groups fields, keeps dates together and puts items before uploads',()=>{
 const h=harness(),html=h.newOrder();
 for(const label of ['Order details','Site contact','Requested delivery','Notes'])assert.ok(html.includes('<h3>'+label+'</h3>'));
 assert.ok(html.indexOf('class="items"')<html.indexOf('class="order-attachments"'));
 assert.match(html,/data-save-cloud-draft/);assert.doesNotMatch(html,/name="scheduledDelivery|name="status"/);
});
test('site order rows align requested and completed dates and omit CNC progress text',()=>{
 const h=harness();h.detail({id:'one',orderNumber:'7',project:'Test',orderType:'Panels',status:'completed',createdAt:'2026-10-01',requestedDeliveryDate:'2026-10-05',completedAt:'2026-10-08T15:00:00Z',items:[]});
 const dates=h.orderDates({status:'completed',requestedDeliveryDate:'2026-10-05',completedAt:'2026-10-08T15:00:00Z'});
 assert.match(dates,/site-order-dates/);assert.match(dates,/5 Oct 2026/);assert.match(dates,/9 Oct 2026/);
 assert.doesNotMatch(h.orderList(),/Progress managed in CNC/);
});
test('offline Save draft keeps the local draft without sending a request',async()=>{
 const h=harness();await h.openDraft();h.setForm({projectId:'p1',siteContact:'Offline draft'});h.captureDraft();await h.saveCloudDraft();
 assert.equal(h.savedDraft().fields.siteContact,'Offline draft');assert.equal(h.requests.length,0);assert.match(h.state().message,/this device/);
});

test('saving a device draft to the account preserves its identity and version for later saves',async()=>{
 const h=harness();await h.openDraft();h.setForm({projectId:'p1',orderType:'Other',siteContact:'Draft contact'});h.captureDraft();
 const originalId=h.savedDraft().id,calls=[];
 h.setDraftApi(async(path,body)=>{calls.push({path,body});return path?{draft:{id:originalId,updatedAt:'version-'+calls.length,attachments:[]}}:{drafts:[]};});
 await h.persistCloudDraft();
 assert.equal(calls[0].path,'/'+originalId);assert.equal(calls[0].body.order.project,'Project');assert.equal(calls[0].body.order.siteContact,'Draft contact');assert.equal(h.savedDraft().cloudUpdatedAt,'version-1');
 calls.length=0;await h.persistCloudDraft();assert.equal(calls[0].body.expectedUpdatedAt,'version-1');
});
test('a cloud draft conflict leaves the local fields available to the user',async()=>{
 const h=harness();await h.openDraft();h.setForm({projectId:'p1',siteContact:'Keep this edit'});h.captureDraft();
 h.setDraftApi(async()=>{throw Error('This draft changed. Reopen it before saving.');});
 await assert.rejects(()=>h.persistCloudDraft(),/draft changed/);assert.equal(h.savedDraft().fields.siteContact,'Keep this edit');
});

test('main order action always starts a new order while device drafts remain separate',()=>{
 const h=harness(),html=h.orderList();
 assert.match(html,/class="primary" data-new-empty>\+ New order/);
 assert.doesNotMatch(html,/class="primary" data-new>/);
 assert.match(html,/data-open-drafts/);
});
test('starting a new order offline preserves the existing unfinished draft',async()=>{
 const h=harness();await h.openDraft();h.setForm({projectId:'p1',siteContact:'Keep my draft'});h.captureDraft();
 const id=h.savedDraft().id;await h.startNewSiteDraft();
 assert.equal(h.savedDraft().id,id);assert.equal(h.savedDraft().fields.siteContact,'Keep my draft');assert.match(h.state().message,/current device draft/);
});

test('blank descriptions are skipped anywhere regardless of quantity, while described items require valid quantities',async()=>{
  const h=harness();
  for(const [quantity,description] of [['4',''],['2','Panel A'],['0','   '],['3','Panel B'],['','']]){
    const r=h.addItem();r.querySelector('[name=quantity]').value=quantity;r.querySelector('[name=description]').value=description;
  }
  h.updateItemRequirements();
  for(const index of [0,2,4]){
    const q=h.rows[index].querySelector('[name=quantity]');
    assert.equal(q.required,false);assert.equal(q.min,'');assert.equal(q.step,'any');
    assert.equal(h.rows[index].querySelector('[name=description]').required,false);
  }
  for(const index of [1,3]){
    const q=h.rows[index].querySelector('[name=quantity]');
    assert.equal(q.required,true);assert.equal(q.min,'1');assert.equal(q.step,'1');
  }
  await h.submitOrder({preventDefault(){},currentTarget:{projectId:'p1',orderType:'Panels',siteContact:'Contact',phone:'0000',requestedDeliveryDate:'2026-10-09'}});
  assert.deepEqual(JSON.parse(JSON.stringify(h.state().outbox.queue[0].order.items)),[{quantity:2,description:'Panel A'},{quantity:3,description:'Panel B'}]);
});

test('Save draft closes the form after an account save and keeps the draft resumable',async()=>{
 const h=harness();await h.openDraft();h.setForm({projectId:'p1',siteContact:'Saved contact'});h.setOnline(true);
 h.setDraftApi(async(path)=>path?{draft:{updatedAt:'saved-version',attachments:[]}}:{drafts:[]});
 await h.saveCloudDraft();
 assert.equal(h.state().view,'orders');assert.equal(h.state().busy,false);
 assert.equal(h.savedDraft().fields.siteContact,'Saved contact');assert.equal(h.savedDraft().cloudUpdatedAt,'saved-version');
 await h.openDraft();assert.equal(h.state().view,'new');assert.equal(h.state().orderDraft.fields.siteContact,'Saved contact');
});

test('Save draft keeps the form open when the account save fails',async()=>{
 const h=harness();await h.openDraft();h.setForm({siteContact:'Keep editing'});h.setOnline(true);
 h.setDraftApi(async()=>{throw Error('Save failed');});await h.saveCloudDraft();
 assert.equal(h.state().view,'new');assert.equal(h.state().busy,false);assert.equal(h.state().message,'Save failed');
 assert.equal(h.savedDraft().fields.siteContact,'Keep editing');
});

test('offline Save draft closes only after successful device storage',async()=>{
 const h=harness();await h.openDraft();h.setForm({siteContact:'Offline contact'});await h.saveCloudDraft();
 assert.equal(h.state().view,'orders');assert.equal(h.savedDraft().fields.siteContact,'Offline contact');
 await h.openDraft();h.failStorage();await h.saveCloudDraft();
 assert.equal(h.state().view,'new');assert.match(h.state().message,/could not be saved/);
});

test('opening and reopening a device draft renders an enabled Save draft button',async()=>{
 const h=harness();await h.openDraft();
 assert.match(h.renderedForm(),/data-save-cloud-draft/);
 assert.doesNotMatch(h.renderedForm(),/data-save-cloud-draft\s+disabled/);
 h.setForm({siteContact:'Keep this draft'});h.captureDraft();await h.openDraft();
 assert.doesNotMatch(h.renderedForm(),/data-save-cloud-draft\s+disabled/);
 assert.equal(h.state().busy,false);
});

test('draft badge includes device drafts and deduplicates account copies',async()=>{
 const h=harness();assert.equal(h.draftCount(),0);await h.openDraft();h.setForm({siteContact:'Device draft'});h.captureDraft();
 const id=h.savedDraft().id;assert.equal(h.draftCount(),1);assert.match(h.orderList(),/Drafts \(1\)/);
 h.setCloudDrafts([{id}]);assert.equal(h.draftCount(),1);
 h.setCloudDrafts([{id},{id:'another'}]);assert.equal(h.draftCount(),2);
 h.switchAccount('other-user');h.setCloudDrafts([]);assert.equal(h.draftCount(),0);
});

test('mobile drafts show one card for a synced device copy and keep other device drafts accessible',async()=>{
 const h=harness();await h.openDraft();h.setForm({orderType:'Panels',siteContact:'Draft contact'});h.captureDraft();
 const id=h.savedDraft().id;h.setCloudDrafts([{id,project:'Project',orderType:'Panels',itemCount:1,fileCount:0,updatedAt:'2026-10-09T18:00:00Z'}]);
 const html=h.cloudDraftView();assert.equal((html.match(/<article/g)||[]).length,1);
 assert.match(html,/data-cloud-draft=/);assert.match(html,/1 item · 0 files/);assert.doesNotMatch(html,/Continue draft on this device/);
 h.setCloudDrafts([]);assert.match(h.cloudDraftView(),/On this device/);assert.match(h.cloudDraftView(),/data-new>Continue draft/);
});

test('site notification bell counts all account alerts and the order list no longer embeds the feed',()=>{
 const h=harness();h.setAlerts([{id:'a',kind:'orders',read:false},{id:'b',kind:'support',read:false},{id:'c',read:true}]);
 assert.match(h.notificationBell(),/2 unread notifications/);assert.match(h.notificationBell(),/site-bell-count/);
 assert.doesNotMatch(h.orderList(),/data-order-alerts|site-order-notifications/);
 h.clearAccountState();assert.doesNotMatch(h.notificationBell(),/site-bell-count/);
});

test('notification centre escapes content and uses app-style read and priority indicators',()=>{
 const h=harness();h.setAlerts([{id:'"><script>',title:'<script>x</script>',message:'<img src=x>',createdAt:'2026-10-09T00:00:00Z',priority:'urgent',read:false}]);
 const html=h.orderAlertsView();assert.match(html,/Mark all as read/);assert.match(html,/is-urgent/);assert.match(html,/aria-label="Unread"/);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img/);
 h.setAlerts([]);assert.match(h.orderAlertsView(),/No notifications yet/);
});

test('notification polling works away from orders without replacing an unfinished form',async()=>{
 const h=harness();await h.openDraft();h.setForm({siteContact:'Keep editing'});
 h.setApi(async()=>Response.json({notifications:[{id:'support',kind:'support',read:false}]}));
 const form=h.renderedForm();await h.pollOrderAlerts();
 assert.equal(h.notificationState().items[0].id,'support');assert.equal(h.renderedForm(),form);assert.equal(h.state().view,'new');
});

test('opening an unread notification marks it read before navigating and reports failures',async()=>{
 const h=harness(),calls=[];h.setView('notifications');h.setAlerts([{id:'a',kind:'support',link:'support',read:false}]);
 h.setApi(async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return Response.json({notifications:[{id:'a',kind:'support',read:true}]});});
 await h.openNotification('a');assert.equal(calls[0].path,'/notifications/read');assert.equal(calls[0].body.id,'a');
 assert.equal(h.state().view,'support');assert.doesNotMatch(h.notificationBell(),/site-bell-count/);
 h.setView('notifications');h.setAlerts([{id:'b',kind:'orders',read:false}]);h.setApi(async()=>Response.json({error:'Try again'},{status:500}));
 await h.openNotification('b');assert.equal(h.state().view,'notifications');assert.equal(h.notificationState().items[0].read,false);assert.equal(h.notificationState().error,'Try again');
});

test('mark all and clearing notifications use the shared account endpoints with clear confirmation',async()=>{
 const h=harness(),calls=[];h.setView('notifications');h.setAlerts([{id:'a',read:false}]);
 h.setApi(async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return Response.json({notifications:path.endsWith('/clear')?[]:[{id:'a',read:true}]});});
 await h.markNotifications();assert.deepEqual(calls[0],{path:'/notifications/read',body:{}});
 await h.clearNotifications();assert.equal(calls.length,1);assert.match(h.orderAlertsView(),/This cannot be undone/);
 await h.clearNotifications();assert.equal(calls[1].path,'/notifications/clear');assert.equal(h.notificationState().items.length,0);
});

test('an old poll cannot undo read changes or restore notifications after logout',async()=>{
 const h=harness();let release;h.setApi(async(path)=>path==='/notifications'?new Promise(resolve=>{release=resolve;}):Response.json({notifications:[{id:'a',read:true}]}));
 const poll=h.pollOrderAlerts();await h.markNotifications('a');release(Response.json({notifications:[{id:'a',read:false}]}));await poll;
 assert.equal(h.notificationState().items[0].read,true);
 const next=h.pollOrderAlerts();h.clearAccountState();release(Response.json({notifications:[{id:'private',read:false}]}));await next;
 assert.equal(h.notificationState().items.length,0);
});

test('notification links only navigate to supported and permitted site screens',()=>{
 const h=harness();assert.equal(h.notificationTarget({link:'https://example.com'}),'');assert.equal(h.notificationTarget({link:'schedule'}),'');
 assert.equal(h.notificationTarget({kind:'cnc'}),'cnc');assert.equal(h.notificationTarget({kind:'orders'}),'orders');
});

test('new orders require an explicit order type and identify Other details as required',()=>{
 const h=harness(),html=h.newOrder();
 assert.match(html,/name="orderType" required><option value="">Select an order type/);
 assert.doesNotMatch(html,/<option[^>]*selected|Please specify \(optional\)/);
 assert.match(html,/Please specify <span class="site-required"/);
});

test('missing order type and blank Other details cannot enter the offline queue',async()=>{
 for(const values of [{orderType:''},{orderType:'Other',orderTypeOther:''},{orderType:'Other',orderTypeOther:'   '}]){
  const h=harness();await h.openDraft();h.setForm({projectId:'p1',...values});const row=h.addItem();row.querySelector('[name=description]').value='Panel A';
  await h.submitOrder({preventDefault(){},currentTarget:{projectId:'p1',...values}});
  assert.equal(h.state().outbox.queue.length,0);assert.equal(h.requests.length,0);assert.equal(h.state().view,'new');assert.ok(h.savedDraft());
  assert.match(h.state().message,values.orderType==='Other'?/Please specify/:/Choose an order type/);
 }
});

test('Other submits with trimmed details while regular types omit stale Other details',async()=>{
 for(const values of [{orderType:'Other',orderTypeOther:'  Safety signage  '},{orderType:'Panels',orderTypeOther:'Old value'}]){
  const h=harness(),row=h.addItem();row.querySelector('[name=description]').value='Item';
  await h.submitOrder({preventDefault(){},currentTarget:{projectId:'p1',...values}});
  const order=h.state().outbox.queue[0].order;assert.equal(order.orderType,values.orderType);
  assert.equal(order.orderTypeOther,values.orderType==='Other'?'Safety signage':'');
 }
});

test('incomplete type fields remain saveable as a draft',async()=>{
 const h=harness();await h.openDraft();h.setForm({projectId:'p1',orderType:'Other',orderTypeOther:''});await h.saveCloudDraft();
 assert.equal(h.state().view,'orders');assert.equal(h.savedDraft().fields.orderType,'Other');assert.equal(h.savedDraft().fields.orderTypeOther,'');
});

test('opening an untouched form does not add a second device draft card beside an account draft',async()=>{
 const h=harness();h.setCloudDrafts([{id:'saved',project:'Project',itemCount:1,fileCount:0,updatedAt:'2026-10-09T19:00:00Z'}]);
 await h.openDraft();h.setForm({orderType:'Panels',siteContact:'Taylor & Crew',phone:'+61 0400 000 000',requestedDeliveryDate:'2026-10-10'});h.captureDraft();
 assert.equal(h.draftCount(),1);assert.equal((h.cloudDraftView().match(/<article/g)||[]).length,1);
 h.setForm({siteContact:'Changed contact'});h.captureDraft();assert.equal(h.draftCount(),2);
});
test('draft cards use accessible trash icons and device deletion requires confirmation',async()=>{
 const h=harness();await h.openDraft();h.setForm({siteContact:'Device edit'});h.captureDraft();const id=h.savedDraft().id;
 const html=h.cloudDraftView();assert.match(html,/aria-label="Delete device draft"/);assert.match(html,/data-delete-device-draft/);
 await h.deleteDeviceDraft(id);assert.ok(h.savedDraft());assert.match(h.cloudDraftView(),/Yes, delete/);
 await h.deleteDeviceDraft(id);assert.equal(h.savedDraft(),null);assert.equal(h.draftCount(),0);
 h.setCloudDrafts([{id:'account',project:'Project',itemCount:0,fileCount:0,updatedAt:'2026-10-09T19:00:00Z'}]);
 assert.match(h.cloudDraftView(),/aria-label="Delete account draft"/);assert.doesNotMatch(h.cloudDraftView(),/>Delete<\/button>/);
});
test('an explicitly saved blank draft stays visible',async()=>{
 const h=harness();await h.openDraft();h.setForm({orderType:'Other'});await h.saveCloudDraft();
 assert.equal(h.draftCount(),1);assert.match(h.cloudDraftView(),/On this device/);
});

test('opening an account draft never uploads an untouched device placeholder',async()=>{
 const h=harness(),calls=[];await h.openDraft();
 h.setForm({orderType:'Panels',siteContact:'Taylor & Crew',phone:'+61 0400 000 000',requestedDeliveryDate:'2026-10-10'});h.captureDraft();
 h.setOnline(true);h.setCloudDrafts([{id:'account',project:'Project',itemCount:1,fileCount:0,updatedAt:'version'}]);
 h.setDraftApi(async(path,body)=>{calls.push({path,body});assert.equal(body,undefined);return {draft:{id:'account',updatedAt:'version',order:{project:'Project',orderType:'Panels',items:[{quantity:1,description:'Panel A'}]},attachments:[]}};});
 await h.openCloudDraft('account');
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/account');assert.equal(h.savedDraft().id,'account');
 assert.equal(h.draftCount(),1);assert.equal((h.cloudDraftView().match(/<article/g)||[]).length,1);
});

test('repeated account draft saves and reopens retain one identifier and one card',async()=>{
 const h=harness(),calls=[];let version=0;await h.openDraft();h.setForm({projectId:'p1',orderType:'Panels'});const row=h.addItem();row.querySelector('[name=description]').value='Panel A';h.captureDraft();
 const id=h.savedDraft().id;h.setOnline(true);
 h.setDraftApi(async(path,body)=>{calls.push({path,body});if(!path)return {drafts:[{id,project:'Project',orderType:'Panels',itemCount:1,fileCount:0,updatedAt:'v'+version}]};assert.equal(path,'/'+id);return {draft:{id,updatedAt:'v'+(++version),attachments:[]}};});
 for(let count=0;count<3;count++){
  await h.saveCloudDraft();await h.openCloudDraft(id);
  assert.equal(h.savedDraft().id,id);assert.equal(h.draftCount(),1);
  assert.equal((h.cloudDraftView().match(/<article/g)||[]).length,1);
 }
 assert.equal(new Set(calls.filter(call=>call.body).map(call=>call.path)).size,1);
});

test('switching account drafts still saves genuine unfinished device edits',async()=>{
 const h=harness(),calls=[];await h.openDraft();h.setForm({projectId:'p1',siteContact:'Do not lose this edit'});h.captureDraft();
 const localId=h.savedDraft().id;h.setOnline(true);
 h.setDraftApi(async(path,body)=>{calls.push({path,body});if(!path)return {drafts:[{id:localId}]};if(body)return {draft:{id:localId,updatedAt:'saved',attachments:[]}};return {draft:{id:'other',updatedAt:'version',order:{items:[]},attachments:[]}};});
 await h.openCloudDraft('other');
 assert.equal(calls[0].path,'/'+localId);assert.equal(calls[0].body.order.siteContact,'Do not lose this edit');
 assert.equal(h.savedDraft().id,'other');
});
