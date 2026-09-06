import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function workerHarness(source,scope){
  const handlers={},buckets=new Map(),base=new URL(scope);
  let offline=false;
  const key=value=>new URL(typeof value==='string'?value:value.url,base).href;
  const caches={
    keys:async()=>[...buckets.keys()],
    delete:async name=>buckets.delete(name),
    open:async name=>{
      if(!buckets.has(name))buckets.set(name,new Map());
      const entries=buckets.get(name);
      return {
        addAll:async assets=>{for(const asset of assets)entries.set(key(asset),new Response('static asset'));},
        put:async(req,response)=>entries.set(key(req),response.clone()),
        match:async req=>entries.get(key(req))?.clone()
      };
    }
  };
  const clients={claim:async()=>{}};
  const context={URL,Request,Response,Headers,caches,clients,console,
    fetch:async()=>{if(offline)throw Error('Offline');return new Response('online asset');},
    self:{location:base,registration:{scope},clients,skipWaiting:async()=>{},addEventListener:(name,fn)=>handlers[name]=fn}};
  vm.runInNewContext(source,context);
  async function dispatch(name,request){
    let response;const pending=[];
    handlers[name]({request,waitUntil:promise=>pending.push(promise),respondWith:promise=>{response=promise;}});
    const result=await response;await Promise.all(pending);return result;
  }
  return {caches,buckets,dispatch,offline:()=>{offline=true;}};
}

const site=()=>workerHarness(fs.readFileSync(new URL('../../site/sw.js',import.meta.url),'utf8'),'https://app.example/site/');
test('site activation removes contaminated site caches but preserves other apps and queues',async()=>{
 const h=site();
 await h.caches.open('panelstock-site-v32');await h.caches.open('panelstock-shell-v2');await h.caches.open('unrelated-cache');
 await h.dispatch('install');await h.dispatch('activate');
 assert.deepEqual(await h.caches.keys(),['panelstock-shell-v2','unrelated-cache','panelstock-site-v33']);
});
test('site worker never intercepts private APIs, authenticated assets or token exports',async()=>{
 const h=site();await h.dispatch('install');
 for(const url of ['https://api.example/support','https://app.example/session','https://app.example/site/orders','https://app.example/site/?token=private','https://app.example/site/app.js?v=security-2&token=private']){
   assert.equal(await h.dispatch('fetch',new Request(url,{headers:{Authorization:'Bearer user-a'}})),undefined);
   h.offline();
   assert.equal(await h.dispatch('fetch',new Request(url,{headers:{Authorization:'Bearer user-b'}})),undefined);
   assert.equal(await h.dispatch('fetch',new Request(url)),undefined);
 }
 assert.equal(await h.dispatch('fetch',new Request('https://app.example/site/app.js?v=security-2',{headers:{Authorization:'Bearer user-a'}})),undefined);
 for(const entries of h.buckets.values())for(const url of entries.keys())assert.ok(!url.includes('token=')&&!url.endsWith('/support'));
});
test('site shell and versioned static assets remain available offline without API HTML fallback',async()=>{
 const h=site();await h.dispatch('install');h.offline();
 for(const url of ['https://app.example/site/','https://app.example/site/app.js?v=security-2']){
   const response=await h.dispatch('fetch',new Request(url));assert.equal(response.status,200);assert.equal(await response.text(),'static asset');
 }
 assert.equal(await h.dispatch('fetch',new Request('https://app.example/site/support')),undefined);
});
test('mobile first install precaches local CSS and keeps Site Orders cache',async()=>{
 const h=workerHarness(fs.readFileSync(new URL('../../push-sw.js',import.meta.url),'utf8'),'https://app.example/');
 await h.caches.open('panelstock-shell-v1');await h.caches.open('panelstock-site-v33');
 await h.dispatch('install');await h.dispatch('activate');h.offline();
 const response=await h.dispatch('fetch',new Request('https://app.example/tailwind.css'));
 assert.equal(response.status,200);assert.ok((await h.caches.keys()).includes('panelstock-site-v33'));
 assert.equal((await h.dispatch('fetch',{url:'https://app.example/index.html?open=notifications',method:'GET',mode:'navigate',headers:new Headers()})).status,200);
 assert.ok(!(await h.caches.keys()).includes('panelstock-shell-v1'));
 assert.equal(await h.dispatch('fetch',new Request('https://app.example/site/?token=private')),undefined);
});
