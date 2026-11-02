import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),workspaces=require('../../tab-workspace.js');
const app=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('  function startSiteEditor('),app.lastIndexOf('})();'));
const KEY='panelstock:site-orders:outbox:v1';
function storage(){const values=new Map();return {values,get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function lockService(){
 const held=new Set(),queues=new Map();
 return {request(name,options,callback){return new Promise((resolve,reject)=>{
  const start=()=>{held.add(name);const release=()=>{held.delete(name);queues.get(name)?.shift()?.();};Promise.resolve().then(()=>callback({name})).then(value=>{release();resolve(value);},error=>{release();reject(error);});};
  if(!held.has(name))start();else if(options.ifAvailable)Promise.resolve(callback(null)).then(resolve,reject);else{if(!queues.has(name))queues.set(name,[]);queues.get(name).push(start);}
 });}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function page(locks,localStorage,signedIn=true){
 const root={textContent:''};let renders=0,refreshes=0;
 const context={navigator:{locks},root,outbox:{owner:'stale',queue:[]},OUTBOX_KEY:KEY,session:signedIn?{username:'staff'}:null,sessionVersion:1,Promise,siteWorkspace:null,workspaceOwner:null,workspaceRequest:0,editorReady:false,localStorage,sessionStorage:storage(),deviceStorage:localStorage,
  workspacePrefixes:['panelstock:site-orders:draft:v1:','panelstock:site-orders:comment:v1:','panelstock:receipt:'],
  window:{PanelStockWorkspaces:workspaces},
  render:()=>renders++,refresh:()=>{refreshes++;return Promise.resolve();},flush:()=>{}};
 context.read=(key,fallback)=>JSON.parse(context.deviceStorage.getItem(key)||'null')||fallback;
 vm.runInNewContext(source,context);return {context,root,renders:()=>renders,refreshes:()=>refreshes};
}
test('Site pages edit separate queues and recover a closed page without taking another active page’s queue',async()=>{
 const locks=lockService(),saved=storage();saved.setItem(KEY,JSON.stringify({owner:'staff',queue:[{id:'first'}]}));
 const first=page(locks,saved);await tick();assert.ok(first.renders()>0);assert.equal(first.context.outbox.queue[0].id,'first');
 const second=page(locks,saved);await tick();assert.ok(second.renders()>0);assert.equal(second.context.outbox.queue.length,0);
 second.context.deviceStorage.setItem(KEY,JSON.stringify({owner:'staff',queue:[{id:'second'}]}));
 assert.equal(JSON.parse(saved.getItem(KEY)).queue[0].id,'first');
 await second.context.siteWorkspace.release();await tick();
 const reopened=page(locks,saved);await tick();assert.equal(reopened.context.outbox.queue[0].id,'second');assert.equal(first.context.outbox.queue[0].id,'first');
 await first.context.siteWorkspace.release();await reopened.context.siteWorkspace.release();
});
test('signed-out Site pages wait for authentication before claiming saved work',async()=>{
 const saved=storage(),locks=lockService();saved.setItem(KEY,JSON.stringify({owner:'staff',queue:[{id:'pending'}]}));
 const opened=page(locks,saved,false);assert.equal(opened.renders(),1);assert.equal(opened.context.siteWorkspace,null);
 opened.context.session={username:'staff'};await opened.context.openSiteWorkspace();assert.equal(opened.context.outbox.queue[0].id,'pending');await opened.context.siteWorkspace.release();
});
test('Site refuses editing when safe workspace coordination is unavailable or fails',async()=>{
 const saved=storage(),pending=JSON.stringify({owner:'staff',queue:[{id:'pending'}]});saved.setItem(KEY,pending);
 const unsupported=page(undefined,saved);await tick();assert.equal(unsupported.renders(),0);assert.match(unsupported.root.textContent,/up-to-date browser/);
 const denied=page({request:()=>Promise.reject(Error('SecurityError'))},saved);await tick();assert.equal(denied.renders(),0);assert.match(denied.root.textContent,/SecurityError/);assert.equal(saved.getItem(KEY),pending);
});
test('navigation cannot render editing controls before workspace access is ready',()=>{
 const render=app.split('\n').find(line=>line.startsWith('  function render(){'));
 const root={textContent:'Saved changes are not ready'};
 vm.runInNewContext(render+'\nrender();',{editorReady:false,root});
 assert.equal(root.textContent,'Saved changes are not ready');
});
