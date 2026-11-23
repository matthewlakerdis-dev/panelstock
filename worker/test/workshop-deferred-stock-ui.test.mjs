import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../workshop-stock.js',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../../workshop-stock.css',import.meta.url),'utf8');
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const walk=node=>!node||typeof node!=='object'?[]:[node,...(node.children||[]).flat(Infinity).flatMap(walk)];
const text=node=>[...(node?.children||[])].flat(Infinity).map(value=>typeof value==='string'?value:typeof value==='object'?text(value):'').join(' ');
const stockItem=(id='angle',name='Angle')=>({id,name,sku:id.toUpperCase(),category:'extrusions',unit:'lengths',qty:5,reserved:0,available:5,hasImage:true,imageUrl:'/workshop-stock/images/'+encodeURIComponent(id),imageVersion:7});
const stockView=()=>({revision:7,restoreEpoch:2,stockProfileReferenceVersion:1,movements:[],items:[stockItem(),stockItem('channel','Channel')]});
const reply=body=>({ok:true,status:200,json:async()=>body});
function harness(factory='createWorkshopStock',props={}){
 const hooks=[],calls=[],storage=new Map(),events={},exports=[],decoded=[];let cursor=0,dirty=false,tree,handler=async()=>reply(stockView()),mounted=true;
 const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState(initial){const i=cursor++;if(!hooks[i]){const hook={kind:'state',value:typeof initial==='function'?initial():initial};hook.set=value=>{if(!mounted)return;const next=typeof value==='function'?value(hook.value):value;if(!Object.is(next,hook.value)){hook.value=next;dirty=true;}};hooks[i]=hook;}return [hooks[i].value,hooks[i].set];},
  useEffect(callback,deps){const i=cursor++,old=hooks[i];if(!old||!deps||deps.length!==old.deps?.length||deps.some((value,index)=>!Object.is(value,old.deps[index])))hooks[i]={kind:'effect',callback,deps,pending:true,cleanup:old?.cleanup};}
 };
 const context={window:{addEventListener(type,callback){(events[type]||=[]).push(callback);},removeEventListener(type,callback){events[type]=(events[type]||[]).filter(value=>value!==callback);}},TextEncoder,Blob,atob,AbortController,
  crypto:{randomUUID:()=> 'stock-ui-mutation'},PanelStock:{username:'inspector',apiFetch:async(url,options)=>{const parsed=new URL(url);if(parsed.pathname==='/workshop-stock'||parsed.pathname.startsWith('/purchase-orders'))assert.equal(parsed.searchParams.get('images'),'deferred');calls.push({url,options});return handler(url,options);}},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  document:{addEventListener(){},removeEventListener(){},body:{appendChild(){}},createElement(type){return type==='canvas'?{getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,/9j/AA=='}:{click(){},remove(){}};}},
  Image:class{constructor(){this.naturalWidth=300;this.naturalHeight=150;}set src(value){decoded.push(value);queueMicrotask(()=>this.onload());}},URL:{createObjectURL:()=> 'blob:stock-export',revokeObjectURL(){}},
  setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},console
 };
 vm.runInNewContext(source,context);const Component=context.window[factory](React);
 const base={workerUrl:'https://api.test',isAdmin:true,taskAccess:{'factory.stock':true,'factory.receive':true},...props};
 function render(){let passes=0;do{assert.ok(passes++<25);dirty=false;cursor=0;tree=Component(base);const effects=hooks.filter(hook=>hook.kind==='effect'&&hook.pending);for(const hook of effects){hook.pending=false;hook.cleanup?.();}for(const hook of effects)hook.cleanup=hook.callback();}while(dirty);return walk(tree);}
 const node=label=>render().find(value=>value.props['aria-label']===label),button=label=>render().find(value=>value.type==='button'&&value.children.includes(label));
 return {context,calls,storage,exports,decoded,render,node,button,setHandler:value=>handler=value,get text(){render();return text(tree);},async settle(){await tick();render();},unmount(){mounted=false;for(const hook of hooks)if(hook.kind==='effect')hook.cleanup?.();},stubExports(){const old=context.window.PanelStockStocktakeReport.soh;context.window.PanelStockStocktakeReport.soh={...old,pdf:value=>{exports.push(value);return new Blob(['PDF']);},xlsx:value=>{exports.push(value);return new Blob(['XLSX']);}};}};
}

test('all stock and purchase-order response routes negotiate deferred images without changing request bodies',()=>{
 const context={window:{},TextEncoder,Blob,atob};vm.runInNewContext(source,context);
 for(const path of ['/workshop-stock','/purchase-orders','/purchase-orders/analyse','/purchase-orders/po/files','/purchase-orders/po/files/file'])assert.equal(context.workshopDeferredPath(path),path+'?images=deferred');
 for(const path of ['/workshop-stock/images/angle','/stock-images/capral/image','/stocktake/settings','/data'])assert.equal(context.workshopDeferredPath(path),path);
});

test('large preview size limits and outline controls apply through the authenticated image wrapper',()=>{
 const rules=[...styles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(match=>({selector:match[1].trim(),declarations:match[2]}));
 const preview=rules.filter(rule=>rule.selector==='.ws-image-viewer img'),outline=rules.find(rule=>rule.selector==='.ws-image-viewer img.ws-outline-enhanced');
 assert.ok(preview.some(rule=>/max-height:\s*65vh/.test(rule.declarations)));assert.ok(preview.some(rule=>/object-fit:\s*contain/.test(rule.declarations)));assert.match(outline?.declarations||'',/filter:\s*grayscale\(1\) brightness\(\.65\) contrast\(2\)/);
 assert.ok(!rules.some(rule=>/\.ws-image-viewer\s*>\s*img/.test(rule.selector)),'A direct-child selector would skip the image inside the authenticated wrapper');
});

test('Stock load timeouts stop Loading, coalesce refreshes and retry without requesting any images',async()=>{
 const x=harness();let reject;x.setHandler(()=>new Promise((resolve,no)=>reject=no));x.render();assert.equal(x.calls.length,1);assert.match(x.text,/Loading workshop stock/);
 const refreshing=x.render().find(node=>node.props.className==='ws-refresh');assert.equal(refreshing.props.disabled,true);const again=refreshing.props.onClick();assert.equal(x.calls.length,1);
 reject(Object.assign(Error('signal timed out'),{name:'TimeoutError'}));await again;await x.settle();assert.doesNotMatch(x.text,/Loading workshop stock/);assert.match(x.text,/took too long.*Retry/);assert.ok(x.button('Retry'));assert.equal(x.render().find(node=>node.props.className==='ws-refresh').props.disabled,false);
 x.setHandler(async()=>reply(stockView()));await x.button('Retry').props.onClick();await x.settle();assert.match(x.text,/Angle/);assert.equal(x.calls.length,2);assert.ok(x.calls.every(call=>new URL(call.url).pathname==='/workshop-stock'));x.unmount();
});

test('a failed refresh retains the last stock rows and a late old account load cannot render',async()=>{
 const x=harness();x.render();await x.settle();assert.match(x.text,/Angle/);x.setHandler(async()=>{throw Error('Failed to fetch');});await x.button('Refresh').props.onClick();await x.settle();assert.match(x.text,/Angle/);assert.match(x.text,/could not be reached/);
 let resolve;x.setHandler(()=>new Promise(done=>resolve=done));const pending=x.button('Refresh').props.onClick();x.context.PanelStock.username='another-inspector';resolve(reply({...stockView(),items:[stockItem('secret','Previous account image')]}));await pending;await x.settle();assert.doesNotMatch(x.text,/Previous account image/);x.unmount();
});

test('Receive coalesces timed-out initial loads and offers Retry with an accurate failure state',async()=>{
 const x=harness('createPurchaseOrderReceiving',{launcher:true});let reject;x.setHandler(()=>new Promise((resolve,no)=>reject=no));x.render();assert.equal(x.calls.length,1);const again=x.button('Refreshing…').props.onClick();assert.equal(x.calls.length,1);
 reject(Object.assign(Error('signal timed out'),{name:'TimeoutError'}));await again;await x.settle();assert.match(x.text,/Purchase orders took too long/);assert.doesNotMatch(x.text,/Loading purchase orders|Checking deliveries ready/);assert.ok(x.button('Retry'));
 x.setHandler(async()=>reply({orders:[],items:[],restoreEpoch:2,stockImageRevision:7}));await x.button('Retry').props.onClick();await x.settle();assert.match(x.text,/No deliveries waiting here/);assert.equal(x.calls.length,2);x.unmount();
});

test('editing deferred stock preserves unchanged images, while explicit removal and replacement stay intentional',async()=>{
 for(const change of ['unchanged','remove','diagram','replace']){
  const x=harness();x.render();await x.settle();x.node('Stock action for Angle').props.onChange({target:{value:'metadata'}});x.render();
  assert.ok(x.button('Remove image'));assert.doesNotMatch(x.text,/Reference profile diagram/);
  if(change==='remove')x.button('Remove image').props.onClick();
  if(change==='diagram'){
   // Exercise the normal reference-image draft path: choosing a named diagram
   // explicitly replaces a saved photo with the existing empty-image sentinel.
   x.node('Reference profile').props.onChange({target:{value:'shs'}});
  }
  if(change==='replace')await x.node('Profile or item image').props.onChange({target:{files:[{type:'image/png',size:100}],value:'selected'}});
  const form=x.render().find(node=>node.type==='form');await form.props.onSubmit({preventDefault(){}});await x.settle();
  const call=x.calls.find(call=>call.options?.method==='POST'),body=JSON.parse(call.options.body);assert.equal(body.mutationId,'stock-ui-mutation');assert.equal(body.itemId,'angle');
  assert.equal(Object.hasOwn(body,'image'),change!=='unchanged');if(change==='remove'||change==='diagram')assert.equal(body.image,'');if(change==='diagram')assert.equal(body.referenceProfile,'shs');if(change==='replace')assert.equal(body.image,'data:image/jpeg;base64,/9j/AA==');
  assert.ok(!Object.hasOwn(body,'imageUrl'));assert.ok(!Object.hasOwn(body,'hasImage'));assert.ok(!Object.hasOwn(body,'imageVersion'));assert.equal(x.calls.some(call=>new URL(call.url).pathname.includes('/images/')),false);x.unmount();
 }
});

test('SOH PDF hydrates only selected images and leaves the compact stock view unchanged',async()=>{
 const x=harness();x.render();await x.settle();x.stubExports();const view=stockView(),before=JSON.stringify(view);
 x.setHandler(async url=>{const path=new URL(url).pathname;assert.equal(path,'/workshop-stock/images/angle');return reply({ok:true,itemId:'angle',image:photo,imageVersion:7});});
 x.node('Export SOH').props.onClick();x.node('Export search').props.onChange({target:{value:'Angle'}});await x.button('Download PDF').props.onClick();await x.settle();
 assert.equal(x.calls.length,2);assert.equal(x.exports.length,1);assert.deepEqual(Array.from(x.exports[0].rows,row=>row.itemId),['angle']);assert.ok(x.exports[0].rows[0].thumbnail);assert.deepEqual(x.decoded,[photo]);assert.equal(JSON.stringify(view),before);assert.ok(!Object.hasOwn(view.items[0],'image'));x.unmount();
});

test('a failed shared reference thumbnail still preserves each row’s individual colour swatch',async()=>{
 const x=harness(),view=stockView();let attempts=0;
 view.items=[{...stockItem('first','Angle 1')},{...stockItem('second','Angle 2'),colorHex:'#24546b'}];for(const item of view.items){delete item.hasImage;delete item.imageUrl;delete item.imageVersion;}
 x.setHandler(async()=>reply(view));x.context.Image=class{set src(value){attempts++;queueMicrotask(()=>this.onerror());}};x.render();await x.settle();x.stubExports();x.node('Export SOH').props.onClick();await x.button('Download PDF').props.onClick();await x.settle();
 assert.equal(attempts,1);assert.equal(x.exports[0].rows[1].swatch,'#24546b');assert.equal(x.calls.length,1);x.unmount();
});
