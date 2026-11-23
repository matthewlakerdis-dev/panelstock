import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../workshop-stock.js',import.meta.url),'utf8');
const api='https://api.example',small='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const item=(id,imageVersion=1)=>({id,hasImage:true,imageUrl:'/workshop-stock/images/'+encodeURIComponent(id),imageVersion});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const calls=[],timers=new Map(),cleared=[],events={};let timerId=0,publicFetches=0;
 const context={window:{addEventListener:(type,callback)=>events[type]=callback},AbortController,TextEncoder,Blob,atob,
  setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);cleared.push(id);},
  fetch(){publicFetches++;throw Error('Stock images must use the authenticated client.');},
  PanelStock:{username:'inspector',apiFetch(url,options){
   let resolve,reject,jsonResolve,jsonReject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
   const call={url,options,aborted:0,respond(value,ok=true){resolve({ok,json:async()=>value});},headers(){resolve({ok:true,json:()=>new Promise((yes,no)=>{jsonResolve=yes;jsonReject=no;})});},body(value){jsonResolve(value);},fail(error){reject(error);}};
   options?.signal?.addEventListener('abort',()=>{call.aborted++;if(call.ignoreAbort)return;const error=Object.assign(Error('The image transfer was aborted.'),{name:'AbortError'});reject(error);jsonReject?.(error);},{once:true});
   calls.push(call);return promise;
  }}
 };
 vm.runInNewContext(source,context);
 const queue=context.workshopImageQueue();
 const load=(value,workerUrl=api)=>{const request=queue.load(workerUrl,value);return {...request,result:request.promise.then(image=>({image}),error=>({error}))};};
 const response=(value,image=small)=>({ok:true,itemId:value.id,image,imageVersion:value.imageVersion});
 async function finish(request,value,image=small){const call=calls.at(-1);call.respond(response(value,image));const result=await request.result;await tick();return result;}
 return {context,queue,load,calls,timers,cleared,events,response,finish,get publicFetches(){return publicFetches;}};
}
function largePng(){
 const base=Buffer.from(small.split(',')[1],'base64'),data=Buffer.alloc(2359000,65),type=Buffer.from('tEXt'),length=Buffer.alloc(4),crc=Buffer.alloc(4);data.write('Comment\0Synthetic cache evidence');length.writeUInt32BE(data.length);
 let checksum=0xffffffff;for(const byte of Buffer.concat([type,data])){checksum^=byte;for(let bit=0;bit<8;bit++)checksum=(checksum>>>1)^((checksum&1)?0xedb88320:0);}crc.writeUInt32BE((checksum^0xffffffff)>>>0);
 return 'data:image/png;base64,'+Buffer.concat([base.subarray(0,-12),length,type,data,crc,base.subarray(-12)]).toString('base64');
}
function componentHarness({observer=true,...initialProps}={}){
 const h=harness(),observers=[];
 if(observer)h.context.IntersectionObserver=class {
  constructor(callback,options){this.callback=callback;this.options=options;this.disconnected=false;observers.push(this);}
  observe(target){this.target=target;}
  disconnect(){this.disconnected=true;}
  enter(visible){assert.equal(this.disconnected,false);this.callback([{target:this.target,isIntersecting:visible}]);}
 };
 // Keep stable state setters and effect dependency/cleanup behavior. Rendering
 // and committing effects repeat only when a setter actually changes state.
 const hooks=[],target={kind:'image-mount'};let cursor=0,dirty=false,mounted=true,tree,ref,lateStateUpdates=0,props={workerUrl:api,item:item('profile'),...initialProps};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState(initial){
   const index=cursor++;if(!hooks[index]){const hook={kind:'state',value:typeof initial==='function'?initial():initial};hook.set=value=>{if(!mounted){lateStateUpdates++;return;}const next=typeof value==='function'?value(hook.value):value;if(!Object.is(next,hook.value)){hook.value=next;dirty=true;}};hooks[index]=hook;}
   assert.equal(hooks[index].kind,'state');return [hooks[index].value,hooks[index].set];
  },
  useEffect(callback,deps){
   const index=cursor++,previous=hooks[index];if(previous)assert.equal(previous.kind,'effect');
   if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))||deps.length!==previous.deps?.length)hooks[index]={kind:'effect',deps,callback,pending:true,cleanup:previous?.cleanup};
  }
 };
 const Component=h.context.createWorkshopStockImage(React);
 function render(next){
  assert.equal(mounted,true);if(next)props={...props,...next};let passes=0;
  do{
   assert.ok(passes++<20,'Hook updates settle without an infinite render loop');dirty=false;cursor=0;tree=Component(props);
   if(ref!==tree.props.ref){ref?.(null);ref=tree.props.ref;ref?.(target);}
   const effects=hooks.filter(hook=>hook.kind==='effect'&&hook.pending);
   for(const hook of effects){hook.pending=false;hook.cleanup?.();hook.cleanup=undefined;}
   for(const hook of effects)hook.cleanup=hook.callback();
  }while(dirty);
  return tree;
 }
 const nodes=()=>{const walk=value=>!value||typeof value!=='object'?[]:[value,...(value.children||[]).flat(Infinity).flatMap(walk)];return walk(tree);};
 render();
 return {...h,observers,render,nodes,find:type=>nodes().find(node=>node.type===type),get tree(){return tree;},get lateStateUpdates(){return lateStateUpdates;},
  async flush(){await tick();if(mounted)render();},
  visibility(value){const latest=observers.findLast(value=>!value.disconnected);assert.ok(latest);latest.enter(value);return render();},
  unmount(){ref?.(null);ref=undefined;mounted=false;for(const hook of hooks)if(hook.kind==='effect')hook.cleanup?.();}
 };
}

test('image queue runs at most two transfers, deduplicates subscribers and skips canceled queued images',async()=>{
 const h=harness(),a=item('a'),b=item('b'),c=item('c'),d=item('d'),first=h.load(a),duplicate=h.load(a),second=h.load(b),queued=h.load(c),last=h.load(d);
 assert.equal(h.calls.length,2);assert.equal(h.timers.size,2);assert.equal(h.calls[0].url,api+a.imageUrl);assert.equal(h.calls[1].url,api+b.imageUrl);
 queued.cancel();duplicate.cancel();assert.match((await queued.result).error.message,/canceled/);assert.match((await duplicate.result).error.message,/canceled/);assert.equal(h.calls[0].aborted,0,'Another subscriber still needs the shared transfer');
 h.calls[0].respond(h.response(a));assert.equal((await first.result).image,small);await tick();assert.equal(h.calls.length,3);assert.equal(h.calls[2].url,api+d.imageUrl);assert.equal(h.timers.size,2);
 h.calls[1].respond(h.response(b));h.calls[2].respond(h.response(d));assert.equal((await second.result).image,small);assert.equal((await last.result).image,small);await tick();assert.equal(h.timers.size,0);assert.equal(h.publicFetches,0);
});

test('canceling the last subscriber aborts an active source and frees its slot for the next queued image',async()=>{
 const h=harness(),a=item('a'),b=item('b'),c=item('c'),first=h.load(a),second=h.load(b),queued=h.load(c);
 first.cancel();assert.equal(h.calls[0].options.signal.aborted,true);assert.match((await first.result).error.message,/canceled/);await tick();assert.equal(h.calls.length,3);assert.equal(h.calls[2].url,api+c.imageUrl);assert.equal(h.timers.size,2);
 h.calls[1].respond(h.response(b));h.calls[2].respond(h.response(c));await Promise.all([second.result,queued.result]);await tick();assert.equal(h.timers.size,0);
});

test('account and API changes cannot reuse cached images or complete an earlier owner transfer',async()=>{
 const h=harness(),value=item('profile / 1');let request=h.load(value);assert.equal((await h.finish(request,value)).image,small);request=h.load(value);assert.equal((await request.result).image,small);assert.equal(h.calls.length,1);
 const pending=h.load(item('unfinished'));h.context.PanelStock.username='other-inspector';const switched=h.load(value);assert.match((await pending.result).error.message,/canceled/);assert.equal(h.calls[1].aborted,1);assert.equal(h.calls.length,3);assert.equal((await h.finish(switched,value)).image,small);
 const otherApi='https://other-api.example',isolated=h.load(value,otherApi);assert.equal(h.calls.length,4);assert.equal(h.calls[3].url,otherApi+value.imageUrl);assert.equal((await h.finish(isolated,value)).image,small);
 h.context.PanelStock.username='inspector';const returned=h.load(value);assert.equal(h.calls.length,5,'Returning to an account cannot recover its old cache');assert.equal((await h.finish(returned,value)).image,small);assert.equal(h.timers.size,0);
});

test('cache keys include the image version and stale, missing or invalid response versions fail closed',async()=>{
 const h=harness(),old=item('profile',1),current=item('profile',2),first=h.load(old);await h.finish(first,old);
 for(const imageVersion of [1,undefined,'2',NaN]){
  const request=h.load(current),call=h.calls.at(-1);call.respond({...h.response(current),imageVersion});assert.match((await request.result).error.message,/Stock changed|current image/);await tick();
 }
 assert.equal(h.calls.length,5,'Rejected versions are not cached');const latest=h.load(current);assert.equal((await h.finish(latest,current)).image,small);const cached=h.load(current);assert.equal((await cached.result).image,small);assert.equal(h.calls.length,6);assert.equal(h.timers.size,0);
});

test('the 20-second deadline covers source-body reading and all exit paths clear their timers',async()=>{
 const h=harness(),value=item('slow'),request=h.load(value);h.calls[0].headers();await tick();assert.equal(h.timers.size,1);const timer=[...h.timers.values()][0];assert.equal(timer.delay,20000);
 timer.callback();assert.equal(h.calls[0].options.signal.aborted,true);assert.equal((await request.result).error.name,'AbortError');await tick();assert.equal(h.timers.size,0);assert.equal(h.cleared.length,1);
 const failed=h.load(item('failed'));h.calls[1].fail(Error('Offline'));assert.match((await failed.result).error.message,/Offline/);await tick();assert.equal(h.timers.size,0);
 const canceled=h.load(item('canceled'));h.queue.clear();assert.match((await canceled.result).error.message,/canceled/);await tick();assert.equal(h.timers.size,0);
});

test('the cache retains at most eight recently used entries',async()=>{
 const h=harness();for(let index=0;index<9;index++){const value=item('profile-'+index),request=h.load(value);await h.finish(request,value);}
 assert.equal(h.calls.length,9);assert.equal((await h.load(item('profile-1')).result).image,small);assert.equal(h.calls.length,9,'The second-oldest entry remains cached');
 const evicted=h.load(item('profile-0'));assert.equal(h.calls.length,10);await h.finish(evicted,item('profile-0'));assert.equal(h.timers.size,0);
});

test('the character budget evicts old images before eight entries are reached',async()=>{
 const h=harness(),image=largePng();assert.ok(image.length<5592431&&image.length*3>8*1024*1024);
 for(let index=0;index<3;index++){const value=item('large-'+index),request=h.load(value);await h.finish(request,value,image);}
 assert.equal((await h.load(item('large-1')).result).image,image);assert.equal(h.calls.length,3);const oldest=h.load(item('large-0'));assert.equal(h.calls.length,4);await h.finish(oldest,item('large-0'),image);assert.equal(h.timers.size,0);
});

test('only exact authenticated image paths and matching inline image responses are accepted',async()=>{
 const h=harness();for(const value of [{...item('a'),imageUrl:'/metadata'}, {...item('a'),imageUrl:'https://public.example/image.png'}, {...item('a'),image:''}, {...item('a'),hasImage:false}])assert.match((await h.load(value).result).error.message,/unavailable/);
 assert.equal(h.calls.length,0);h.context.PanelStock.username='';assert.match((await h.load(item('a')).result).error.message,/unavailable/);assert.equal(h.calls.length,0);h.context.PanelStock.username='inspector';
 for(const patch of [{itemId:'another-profile'},{image:'https://public.example/image.png'},{image:'data:text/plain;base64,SGVsbG8='},{image:small+'!'}, {ok:false}]){
  const value=item('a'),request=h.load(value),call=h.calls.at(-1);assert.deepEqual(Object.keys(call.options),['signal']);assert.ok(call.options.signal instanceof AbortSignal);call.respond({...h.response(value),...patch});assert.match((await request.result).error.message,/could not be loaded/);await tick();
 }
 assert.ok(h.calls.every(call=>call.url===api+'/workshop-stock/images/a'));assert.equal(h.publicFetches,0);assert.equal(h.timers.size,0);
});

test('lazy image component starts offscreen, cancels hidden transfers and clears a previously displayed original',async()=>{
 const value=item('lazy profile'),h=componentHarness({item:value,lazy:true,alt:'Profile image'});assert.equal(h.calls.length,0);assert.equal(h.find('img'),undefined);assert.equal(h.observers.length,1);assert.equal(h.observers[0].options.rootMargin,'100px');
 h.visibility(true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,api+value.imageUrl);assert.equal(h.find('button').children.join(''),'Loading image…');
 h.visibility(false);assert.equal(h.calls[0].aborted,1);await h.flush();assert.equal(h.find('img'),undefined);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 h.visibility(true);assert.equal(h.calls.length,2);h.calls[1].respond(h.response(value));await h.flush();assert.equal(h.find('img').props.src,small);assert.equal(h.find('img').props.alt,'Profile image');
 h.visibility(false);assert.equal(h.find('img'),undefined,'Moving out of view removes the original image from the DOM');assert.equal(h.calls.length,2);h.unmount();assert.equal(h.observers[0].disconnected,true);await tick();assert.equal(h.lateStateUpdates,0);
});

test('a legacy browser without IntersectionObserver waits for the explicit Load image button',async()=>{
 const value=item('manual'),h=componentHarness({observer:false,item:value,lazy:true,interactive:true});assert.equal(h.calls.length,0);assert.equal(h.find('img'),undefined);const button=h.find('button');assert.equal(button.children.join(''),'Load image');
 button.props.onClick();h.render();assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,api+value.imageUrl);h.calls[0].respond(h.response(value));await h.flush();assert.equal(h.find('img').props.src,small);assert.equal(h.find('button'),undefined);h.unmount();
});

test('a non-lazy preview immediately fetches only its selected image and unmount cancels it',async()=>{
 const value=item('selected preview'),h=componentHarness({item:value,lazy:false,alt:'Selected original'});assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,api+value.imageUrl);assert.equal(h.find('img'),undefined);assert.equal(h.observers.length,0);
 h.render();assert.equal(h.calls.length,1,'A render with unchanged props does not restart the selected preview');h.unmount();assert.equal(h.calls[0].aborted,1);await tick();assert.equal(h.timers.size,0);assert.equal(h.lateStateUpdates,0);
});

test('a version change cancels its old component request and a late old response cannot replace the new image',async()=>{
 const first=item('versioned',1),current=item('versioned',2),h=componentHarness({item:first,lazy:false});h.calls[0].ignoreAbort=true;
 h.render({item:current});assert.equal(h.calls[0].aborted,1);assert.equal(h.calls.length,2);assert.equal(h.find('img'),undefined);
 // Model a response already beyond the transport's cancellation boundary.
 h.calls[0].respond(h.response(first));await h.flush();assert.equal(h.find('img'),undefined,'Old original is hidden while the new version loads');assert.equal(h.find('button').children.join(''),'Loading image…');
 h.calls[1].respond(h.response(current));await h.flush();assert.equal(h.find('img').props.src,small);assert.equal(h.calls.length,2);h.unmount();assert.equal(h.lateStateUpdates,0);
});

test('a username change cannot display a late original from the prior account',async()=>{
 const value=item('account scoped'),h=componentHarness({item:value,lazy:false});h.calls[0].ignoreAbort=true;h.context.PanelStock.username='new-inspector';
 h.calls[0].respond(h.response(value));await h.flush();assert.equal(h.find('img'),undefined);assert.equal(h.calls.length,2,'The current owner must fetch an independently authorized image');assert.equal(h.find('button').children.join(''),'Loading image…');
 h.calls[1].respond(h.response(value));await h.flush();assert.equal(h.find('img').props.src,small);h.unmount();await tick();assert.equal(h.timers.size,0);assert.equal(h.lateStateUpdates,0);
});
