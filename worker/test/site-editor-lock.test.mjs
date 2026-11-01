import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('  function startSiteEditor()'),app.lastIndexOf('})();'));
function page(locks,saved){
 const events=[],root={textContent:''};let renders=0,refreshes=0;
 const context={navigator:{locks},root,outbox:{owner:'stale',queue:[]},OUTBOX_KEY:'outbox',read:()=>JSON.parse(JSON.stringify(saved.value)),mobileHost:null,session:null,Promise,
  window:{addEventListener:(name,fn)=>events.push([name,fn]),setInterval:()=>{}},document:{addEventListener:()=>{},hidden:false},
  render:()=>renders++,refresh:()=>{refreshes++;return Promise.resolve();},flush:()=>{},pollOrderAlerts:()=>{},captureDraft:()=>{},captureComment:()=>{}};
 vm.runInNewContext(source,context);return {context,root,events,renders:()=>renders,refreshes:()=>refreshes};
}
test('Site editor excludes a second tab and reloads the latest queue when the previous document releases its lock',async()=>{
 let held=false;const locks={request(name,options,callback){assert.equal(name,'panelstock-site-orders-editor-v1');assert.equal(options.ifAvailable,true);if(held)return Promise.resolve(callback(null));held=true;return Promise.resolve(callback({name}));}};
 const saved={value:{owner:'staff',queue:[{id:'first'}]}};
 const first=page(locks,saved);assert.equal(first.renders(),1);
 saved.value.queue.push({id:'second'});
 const second=page(locks,saved);assert.equal(second.renders(),0);assert.equal(second.events.length,0);assert.match(second.root.textContent,/already open/);
 assert.equal(saved.value.queue.length,2);
 held=false;const reopened=page(locks,saved);assert.equal(reopened.renders(),1);assert.equal(reopened.context.outbox.queue.length,2);
});
test('Site refuses editing when safe locking is unavailable or fails',async()=>{
 const saved={value:{owner:'staff',queue:[{id:'pending'}]}};
 const unsupported=page(undefined,saved);assert.equal(unsupported.renders(),0);assert.match(unsupported.root.textContent,/up-to-date browser/);
 const denied=page({request:()=>Promise.reject(Error('SecurityError'))},saved);await new Promise(resolve=>setImmediate(resolve));assert.equal(denied.renders(),0);assert.match(denied.root.textContent,/could not secure/);assert.equal(saved.value.queue.length,1);
});
test('navigation cannot render editing controls after editor access is denied',()=>{
 const render=app.split('\n').find(line=>line.startsWith('  function render(){'));
 const root={textContent:'Use the existing tab'};
 const context={editorReady:false,root};
 vm.runInNewContext(render+'\nrender();',context);
 assert.equal(root.textContent,'Use the existing tab');
});
