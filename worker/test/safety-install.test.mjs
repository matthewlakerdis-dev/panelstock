import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildSafetyManifest,buildSafetyServiceWorker} from '../src/safety-install.js';
import {cncInstallIcon} from '../src/cnc-install.js';
import {buildToolboxPage} from '../src/toolbox-page.js';

test('Safety installs at the portal root without credentials in its manifest',()=>{
 const manifest=buildSafetyManifest();
 assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');
 assert.equal(manifest.id,'/safety-app');assert.doesNotMatch(JSON.stringify(manifest),/token|ticket|username/);
 for(const size of [192,512]){
  assert.ok(manifest.icons.some(i=>i.sizes===`${size}x${size}`&&i.purpose==='maskable'));
  const bytes=cncInstallIcon(size);assert.equal(new DataView(bytes.buffer).getUint32(16),size);
 }
});

test('Safety service worker never handles API calls, PDFs or foreign pages',async()=>{
 const handlers={};let claims=0,skips=0,fetches=0;
 vm.runInNewContext(buildSafetyServiceWorker(),{URL,Response,self:{location:{origin:'https://safety.panelstockhq.com'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>skips++,clients:{claim:()=>{claims++;return Promise.resolve()}}},fetch:async()=>{fetches++;throw new Error('offline')}});
 handlers.install();await new Promise(resolve=>handlers.activate({waitUntil:p=>p.then(resolve)}));assert.equal(skips,1);assert.equal(claims,1);
 for(const [path,mode] of [['/toolbox/list','cors'],['/toolbox/safety/file','navigate'],['/login','cors'],['https://other.test/','navigate']]){
  let handled=false;handlers.fetch({request:{url:new URL(path,'https://safety.panelstockhq.com').href,mode},respondWith:()=>handled=true});assert.equal(handled,false,path);
 }
 assert.equal(fetches,0);
 for(const path of ['/','/toolbox','/swms','/sds']){
  let response;handlers.fetch({request:{url:'https://safety.panelstockhq.com'+path,mode:'navigate'},respondWith:p=>response=p});
  const result=await response;assert.equal(result.status,503);assert.equal(result.headers.get('cache-control'),'no-store');assert.match(await result.text(),/You are offline/);
 }
});

test('Safety install prompt works, supports browser instructions and hides after installation',async()=>{
 const html=buildToolboxPage(),script=html.split('<script>')[1].split('</script>')[0];
 const start=script.indexOf('let safetyInstallPrompt=null;'),end=script.indexOf('receivePanelstockSession();',start);
 assert.ok(start>0&&end>start);
 const elements=new Map(),links=[],events={},registrations=[];
 const context=vm.createContext({location:{hostname:'safety.panelstockhq.com'},navigator:{userAgent:'iPhone',serviceWorker:{register:(path,options)=>{registrations.push([path,options.scope]);return Promise.resolve()}}},window:{matchMedia:()=>({matches:false}),addEventListener:(name,fn)=>events[name]=fn},document:{head:{append:el=>links.push(el)},createElement:()=>({}),getElementById:id=>{if(!elements.has(id))elements.set(id,{hidden:true,showModal(){this.open=true}});return elements.get(id)}}});
 vm.runInContext(script.slice(start,end),context);
 assert.deepEqual(registrations,[['/safety/sw.js','/']]);assert.equal(links[0].href,'/safety/manifest.webmanifest');assert.equal(elements.get('install-safety').hidden,false);
 await vm.runInContext('installSafety()',context);assert.match(elements.get('install-instructions').innerHTML,/Add to Home Screen/);
 let prompted=0,prevented=0;events.beforeinstallprompt({preventDefault:()=>prevented++,prompt:async()=>prompted++,userChoice:Promise.resolve({outcome:'accepted'})});await vm.runInContext('installSafety()',context);
 assert.equal(prompted,1);assert.equal(prevented,1);assert.equal(elements.get('install-safety').hidden,true);
 elements.get('install-safety').hidden=false;events.appinstalled();assert.equal(elements.get('install-safety').hidden,true);
});
