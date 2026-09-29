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
  const rows=[],requests=[],saved=new Map();let focused=null,id=0;
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
  const node={innerHTML:'',appendChild(){},prepend(){},addEventListener(){},querySelector:selector=>selector==='.items'?{appendChild:r=>rows.push(r)}:null,
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
    render=()=>{};
    globalThis.entry={addItem,updateItemRequirements,newOrder,settingsView,saveProfile,submitOrder,clearAccountState,
      seed(value){session={username:'user-a',token:'test',isAdmin:false};profile=value;projects=[{id:'p1',name:'Project'}];},
      state:()=>({profile,outbox,message})};
  })();`;
  vm.runInNewContext(source,context);
  const api=context.entry;api.seed({displayName:'User A',siteOrderDefaults:{siteContact:'Taylor & Crew',phone:'+61 0400 000 000'}});
  return {...api,rows,requests,saved,focused:()=>focused,
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
  assert.equal(h.rows[1].querySelector('[name=description]').required,true);
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
