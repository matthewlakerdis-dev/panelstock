import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const original={id:'inspection-original',status:'approved',results:{finish:'pass'},checkedBy:'Inspector',checkedAt:'2026-11-23T00:00:00Z',photo:'data:image/png;base64,b3JpZ2luYWw='};
const item=(extra={})=>({id:'qa /piece?',kind:'metalwork',project:'Example',orderNumber:'12',reference:'Bracket',quantity:1,fabricatedBy:'Maker',status:'approved',evidenceLoaded:false,hasPhotoEvidence:true,latest:{id:original.id,status:'approved',results:original.results,checkedBy:original.checkedBy,photoCount:1},history:[{id:original.id,status:'approved',photoCount:1}],photoAdditions:[],...extra});
const full=(extra={})=>({...item(),evidenceLoaded:true,latest:original,history:[original],...extra});
const queue=(items=[])=>({ok:true,items,dispatches:[],checklists:{panel:[],metalwork:[['finish','Finish']],gate:[]},settings:{},preQaCount:0});
const response=body=>({ok:true,status:200,json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children),...nodes(tree.props?.action)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');return tree&&typeof tree==='object'?text(tree.children):tree==null||typeof tree==='boolean'?'':String(tree);}
function button(tree,label){return nodes(tree).find(node=>node.tag==='button'&&text(node).trim()===label);}
function card(tree,label){return nodes(tree).find(node=>node.tag==='button'&&node.children.some(child=>child?.tag==='span'&&text(child)===label));}
function count(tree,label){return text(nodes(card(tree,label)).find(node=>node.tag==='strong'));}
function harness({fetcher=async()=>response(queue()),initialReport=null,canManage=true}={}){
 const states=[],refs=[],effects=[],pendingEffects=[],calls=[],timers=new Map();let stateIndex=0,refIndex=0,effectIndex=0,timerId=0,silent=null;
 const context={AbortController,Date,Math,setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),window:{PanelStockPullRefresh:{subscribe(fn){silent=fn;return()=>{silent=null;};}}},import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState(initial){const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refIndex++;return refs[i]||(refs[i]={current:initial});},useEffect(callback,deps){const i=effectIndex++,old=effects[i];if(!old||!deps||deps.some((value,j)=>value!==old.deps?.[j])){effects[i]={deps,cleanup:old?.cleanup};pendingEffects.push(()=>{effects[i].cleanup?.();effects[i].cleanup=callback();});}},QaPhotoAppend:'append',QaGateOverview:'gate-overview',PageHeading:'heading',ShieldCheck:'shield',ChevronRight:'chevron',Camera:'camera',Upload:'upload',Check:'check',BAKED_WORKER_URL:'https://example.test',PanelStock:{username:'manager',apiFetch:async(url,options={})=>{const call={url,options,body:options.body?JSON.parse(options.body):undefined};calls.push(call);return fetcher(call,calls.length);}}};
 const helper=source.slice(source.indexOf('  async function qaRequestJson('),source.indexOf('  function QaCenter(')),start=source.indexOf('  function QaCenter('),end=source.indexOf('  function AuditCenter(',start);vm.runInNewContext(helper+source.slice(start,end)+'globalThis.Component=QaCenter;',context);
 const render=()=>{stateIndex=refIndex=effectIndex=0;return context.Component({username:'manager',isAdmin:false,canManage,initialReport});};
 const mount=async()=>{render();while(pendingEffects.length)pendingEffects.shift()();await settle();};
 const unmount=()=>{for(const effect of effects)effect.cleanup?.();};
 const timeout=async()=>{for(const [id,timer]of [...timers])if(timer.delay===20000){timers.delete(id);timer.callback();}await settle();};
 return {states,refs,calls,context,timers,render,mount,unmount,timeout,silent:()=>silent?.()};
}
function expanded(h){let tree=h.render();for(const toggle of nodes(tree).filter(node=>node.props['aria-expanded']===false))toggle.props.onClick();return h.render();}

 test('mobile queue starts with unknown counts and treats a valid empty queue as confirmed zero',async()=>{
 const pending=deferred(),h=harness({fetcher:()=>pending.promise});await h.mount();let tree=h.render();assert.equal(count(tree,'Awaiting QA'),'—');assert.equal(button(tree,'Restart refresh').props.disabled,undefined);assert.equal(h.calls[0].url,'https://example.test/qa/queue');pending.resolve(response(queue()));await settle();tree=h.render();assert.equal(count(tree,'Awaiting QA'),'0');assert.equal(count(tree,'Approved'),'0');assert.ok(button(tree,'Refresh'));assert.match(text(tree),/No QA items match/);assert.equal(h.timers.size,0);
});

test('mobile queue deadline settles a hung fetch or JSON body even if abort is ignored',async()=>{
 for(const phase of ['fetch','body']){const h=harness({fetcher:async()=>phase==='fetch'?new Promise(()=>{}):{ok:true,status:200,json:()=>new Promise(()=>{})}});await h.mount();await h.timeout();const tree=h.render();assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(count(tree,'Approved'),'—');assert.match(text(tree),/took too long/);assert.doesNotMatch(text(tree),/No QA items match/);assert.ok(button(tree,'Refresh'));assert.equal(h.states[5],false);}
});

test('mobile queue rejects unreadable or incomplete responses and keeps the last valid items and counts',async()=>{
 for(const bad of [{ok:true,status:200,json:async()=>{throw new SyntaxError('PRIVATE BROKEN TOKEN');}},response({ok:true}),{ok:false,status:503,json:async()=>({error:'QA is temporarily unavailable'})}]){let calls=0;const h=harness({fetcher:async()=>++calls===1?response(queue([item({status:'awaiting',latest:null,history:[],hasPhotoEvidence:false})])):bad});await h.mount();button(h.render(),'Refresh').props.onClick();await settle();const tree=h.render();assert.equal(count(tree,'Awaiting QA'),'1');assert.equal(h.states[0].length,1);assert.equal(h.states[5],false);assert.ok(button(tree,'Refresh'));assert.doesNotMatch(text(tree),/PRIVATE BROKEN TOKEN/);assert.ok(nodes(tree).find(node=>node.props.role==='alert'));}
});

test('mobile silent refreshes coalesce and explicit refresh aborts and replaces a pending request',async()=>{
 const old=deferred(),latest=deferred();const h=harness({fetcher:async(_call,n)=>n===1?response(queue([item({status:'awaiting',latest:null,history:[]})])):n===2?old.promise:latest.promise});await h.mount();h.silent();h.silent();h.silent();assert.equal(h.calls.length,2);const oldSignal=h.calls[1].options.signal;button(h.render(),'Restart refresh').props.onClick();assert.equal(oldSignal.aborted,true);assert.equal(h.calls.length,3);latest.resolve(response(queue([item({id:'latest',status:'awaiting',latest:null,history:[]})])));await settle();old.resolve(response(queue([item({id:'old'})])));await settle();assert.deepEqual(h.states[0].map(value=>value.id),['latest']);assert.equal(h.states[5],false);assert.equal(h.timers.size,0);
});

test('mobile lazily hydrates reports and keeps a saved full report intact during later summary refreshes',async()=>{
 const summary=item(),detail=full();let reads=0;const h=harness({fetcher:async call=>call.url.includes('/qa/items/')?response({ok:true,item:detail,evidenceLoaded:true}):response(queue([summary]))});await h.mount();h.states[8]='approved';let tree=expanded(h);button(tree,'View report').props.onClick();await settle();tree=h.render();assert.equal(h.calls[1].url,'https://example.test/qa/items/'+encodeURIComponent(summary.id));assert.equal(nodes(tree).find(node=>node.tag==='img').props.src,original.photo);assert.equal(h.states[19].evidenceLoaded,true);h.silent();await settle();assert.equal(h.states[19].latest.photo,original.photo);assert.equal(h.states[19].evidenceLoaded,true);assert.equal(h.calls.filter(call=>call.url.includes('/qa/items/')).length,1);
 const legacy=harness({initialReport:detail});await legacy.mount();assert.equal(legacy.calls.length,1);assert.equal(legacy.states[19].latest.photo,original.photo);
});

test('mobile photo actions retain the queued inspection ID if a newer latest inspection arrives during hydration',async()=>{
 const newer={...original,id:'new-latest',photo:'data:image/png;base64,bmV3'},summary=item(),detail=full({latest:newer,history:[original,newer]});const h=harness({fetcher:async call=>call.url.includes('/qa/items/')?response({ok:true,item:detail,evidenceLoaded:true}):response(queue([summary]))});await h.mount();h.states[8]='approved';button(expanded(h),'Add photos').props.onClick();await settle();const tree=h.render();assert.equal(tree.tag,'append');assert.equal(tree.props.attempt.id,original.id);assert.equal(tree.props.item.latest.id,newer.id);assert.equal(tree.props.attempt.photo,original.photo);
});

test('mobile uses queue photo counts to block full galleries and photo evidence to hide Delete',async()=>{
 const complete=item({latest:{...item().latest,photoCount:10}}),pending=item({id:'pending',status:'awaiting',latest:null,history:[],photoAdditions:[],hasPhotoEvidence:true});const h=harness({fetcher:async()=>response(queue([complete,pending]))});await h.mount();h.states[8]='all';const tree=expanded(h),rows=nodes(tree).filter(node=>node.tag==='article');assert.equal(button(rows.find(value=>value.props.key===complete.id),'Add photos').props.disabled,true);assert.equal(button(rows.find(value=>value.props.key==='pending'),'Delete'),undefined);
});

test('mobile does not reopen a different latest inspection and cancels queue/detail reads on unmount',async()=>{
 const newer={...original,id:'new-latest'},h=harness({fetcher:async call=>call.url.includes('/qa/items/')?response({ok:true,item:full({latest:newer,history:[original,newer]}),evidenceLoaded:true}):response(queue([item()]))});await h.mount();h.states[8]='approved';button(expanded(h),'Reopen').props.onClick();await settle();assert.equal(h.states[11],null);assert.match(text(h.render()),/item changed/);
 const pending=deferred(),j=harness({fetcher:async call=>call.url.includes('/qa/items/')?pending.promise:response(queue([item()]))});await j.mount();j.states[8]='approved';button(expanded(j),'View report').props.onClick();const signal=j.calls[1].options.signal;j.unmount();assert.equal(signal.aborted,true);pending.resolve(response({ok:true,item:full(),evidenceLoaded:true}));await settle();assert.equal(j.states[19],null);assert.equal(j.timers.size,0);
});


test('mobile photo-save refresh replaces an older queue request and later silent refreshes remain usable',async()=>{
 const old=deferred(),fresh=deferred();let queueReads=0;const updated=full({photoAdditions:[{id:'added',attemptId:original.id,photos:['data:image/png;base64,YWRkZWQ='],addedBy:'Manager'}]}),summary=item({latest:{...item().latest,photoCount:2}});const h=harness({fetcher:async call=>call.url.includes('/qa/items/')?response({ok:true,item:full(),evidenceLoaded:true}):++queueReads===1?response(queue([item()])):queueReads===2?old.promise:queueReads===3?fresh.promise:response(queue([summary]))});await h.mount();h.states[8]='approved';h.silent();const oldSignal=h.calls[1].options.signal;button(expanded(h),'Add photos').props.onClick();await settle();const append=h.render();assert.equal(append.tag,'append');append.props.onSaved({item:updated});assert.equal(oldSignal.aborted,true);assert.equal(queueReads,3);h.silent();assert.equal(queueReads,3);fresh.resolve(response(queue([summary])));await settle();old.resolve(response(queue([item({id:'stale-item'})])));await settle();assert.equal(h.states[0][0].id,summary.id);assert.equal(h.states[5],false);assert.equal(h.states[19].photoAdditions[0].id,'added');h.silent();await settle();assert.equal(queueReads,4);assert.equal(h.states[5],false);assert.equal(h.timers.size,0);
});

test('mobile Gate overview inspection callback keeps its synchronous result while lazily hydrating the report',async()=>{
 const pending=deferred(),summary=item({gateOrderId:'gate-one'}),detail=full({gateOrderId:'gate-one'}),h=harness({fetcher:async call=>call.url.includes('/qa/items/')?pending.promise:response(queue([summary]))});await h.mount();h.states[25]='gate-one';const overview=h.render();assert.equal(overview.tag,'gate-overview');assert.equal(overview.props.onInspection('missing','gate-one'),false);assert.equal(h.calls.length,1);assert.equal(overview.props.onInspection(summary.id,'gate-one'),true);assert.equal(h.states[25],null);assert.equal(h.states[19],null);assert.equal(h.calls[1].url,'https://example.test/qa/items/'+encodeURIComponent(summary.id));pending.resolve(response({ok:true,item:detail,evidenceLoaded:true}));await settle();assert.equal(h.states[19].evidenceLoaded,true);assert.equal(h.states[19].latest.photo,original.photo);
});
