import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('  async function qaRequestJson('),source.indexOf('  function qaInspectionDraft('));
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
function clock(){
 let now=0,id=0;const tasks=new Map();
 return {setTimeout(callback,delay){tasks.set(++id,{callback,at:now+delay});return id;},clearTimeout(key){tasks.delete(key);},tick(delay){now+=delay;for(const [key,task]of tasks)if(task.at<=now){tasks.delete(key);task.callback();}},count:()=>tasks.size};
}
const response=value=>({ok:true,json:async()=>value});
function requestHarness(fetcher){
 const timers=clock(),calls=[],context={AbortController,...timers,PanelStock:{username:'team',apiFetch:(url,options)=>{calls.push({url,options});return fetcher(url,options);}}};
 vm.createContext(context);vm.runInContext(helper+'globalThis.request=qaRequestJson;',context);
 return {timers,calls,context};
}
test('mobile report requests can finish after twenty seconds while queue requests retain their short deadline',async()=>{
 const pending=deferred(),h=requestHarness(()=>pending.promise),controller=new AbortController();
 const report=h.context.request('/qa/report',{},controller,{report:true});
 h.timers.tick(20000);await settle();assert.equal(controller.signal.aborted,false);
 pending.resolve(response({ok:true,pdf:{data:'saved'}}));assert.equal((await report).result.pdf.data,'saved');assert.equal(h.timers.count(),0);
 const queueController=new AbortController(),queue=h.context.request('/qa/queue',{},queueController);const failure=assert.rejects(queue,/QA took too long/);
 h.timers.tick(20000);await failure;assert.equal(queueController.signal.aborted,true);assert.equal(h.timers.count(),0);
});
test('mobile report deadline bounds a stalled response body and aborts with a report error',async()=>{
 const body=deferred(),h=requestHarness(()=>({ok:true,json:()=>body.promise})),controller=new AbortController();
 const request=h.context.request('/qa/report',{},controller,{report:true}),failure=assert.rejects(request,/QA report is taking too long to generate/);
 await settle();h.timers.tick(119999);assert.equal(controller.signal.aborted,false);h.timers.tick(1);await failure;
 assert.equal(controller.signal.aborted,true);assert.equal(h.timers.count(),0);body.resolve({ok:true});await settle();
});
function nodes(tree){return Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];}
function text(tree){return Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.children):tree==null||typeof tree==='boolean'?'':String(tree);}
const button=(tree,label)=>nodes(tree).find(node=>node.tag==='button'&&text(node).trim()===label);
const gateSnapshot={report:{type:'gate-order',orderId:'gate',items:[],previousQa:[],summary:{}},pdf:{fileName:'Gate.pdf',mime:'application/pdf',data:btoa('%PDF-1.7\nreport')}};
function overviewHarness(fetcher){
 const h=requestHarness(fetcher),states=[],refs=[],effects=[];let cursor=0,refCursor=0;
 Object.assign(h.context,{Blob,Uint8Array,atob,Date,Math,BAKED_WORKER_URL:'https://worker.test',import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useRef(initial){const key=refCursor++;return refs[key]||(refs[key]={current:initial});},useState(initial){const key=cursor++;if(!(key in states))states[key]=initial;return [states[key],value=>{states[key]=typeof value==='function'?value(states[key]):value;}];},useEffect(callback){effects.push(callback);}});
 vm.runInContext(source.slice(source.indexOf('  function gateQaPdfArtifact('),source.indexOf('  async function loadQaReports('))+'globalThis.View=QaGateOverview;',h.context);
 const render=()=>{cursor=refCursor=0;return h.context.View({orderId:'gate',username:'team',onClose(){},onInspection(){}});};
 render();const cleanup=effects[0]();return {...h,states,render,cleanup};
}
test('mobile Gate overview survives twenty seconds, times out at its report deadline, and retries successfully',async()=>{
 const pending=deferred();let calls=0;const h=overviewHarness(()=>++calls===1?pending.promise:response(gateSnapshot));
 h.timers.tick(20000);await settle();assert.equal(h.calls[0].options.signal.aborted,false);assert.match(text(h.render()),/Generating the whole-order/);
 h.timers.tick(100000);await settle();assert.match(text(h.render()),/QA report is taking too long/);assert.equal(h.calls[0].options.signal.aborted,true);
 button(h.render(),'Try again').props.onClick();await settle();assert.ok(button(h.render(),'Download Gate QA PDF'));assert.equal(calls,2);h.cleanup();
});
test('mobile Gate overview aborts on close or unmount and suppresses late reports after account changes',async()=>{
 for(const action of ['close','unmount','account']){
  const pending=deferred(),h=overviewHarness(()=>pending.promise);
  if(action==='close')button(h.render(),'← Back to QA Centre').props.onClick();else if(action==='unmount')h.cleanup();else h.context.PanelStock.username='other';
  if(action!=='account')assert.equal(h.calls[0].options.signal.aborted,true);
  pending.resolve(response(gateSnapshot));await settle();assert.equal(h.states[0],null);h.cleanup();assert.equal(h.timers.count(),0);
 }
});
function hubHarness(fetcher){
 const h=requestHarness(fetcher),effects=[],downloads=[];
 Object.assign(h.context,{Blob,Uint8Array,atob,username:'team',tab:'reports',BAKED_WORKER_URL:'https://worker.test',useRef:initial=>({current:initial}),useEffect:callback=>effects.push(callback),prepareExport:(blob,fileName)=>downloads.push({blob,fileName})});
 const start=source.indexOf('    const qaOverviewRequest='),end=source.indexOf('    },[username,tab]);',start)+'    },[username,tab]);'.length;
 const actionStart=source.indexOf('    function downloadQaOverview('),actionEnd=source.indexOf('    async function downloadReport(',actionStart);
 vm.runInContext(source.slice(start,end)+source.slice(actionStart,actionEnd)+'globalThis.download=downloadQaOverview;',h.context);
 const cleanup=effects[0]();return {...h,downloads,cleanup};
}
test('mobile Reports Hub requests compact panel reports once and lets PDF downloads exceed twenty seconds',async()=>{
 const pending=deferred(),h=hubHarness(()=>pending.promise),selection={project:'Facade',orderNumber:'1'};
 const first=h.context.download(selection),duplicate=h.context.download(selection);assert.equal(first,duplicate);assert.equal(h.calls.length,1);
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{...selection,includePdf:true,responseView:'summary'});
 h.timers.tick(20000);assert.equal(h.calls[0].options.signal.aborted,false);
 pending.resolve(response({pdf:{...gateSnapshot.pdf,fileName:'Panel.pdf'}}));await first;assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].fileName,'Panel.pdf');assert.match(await h.downloads[0].blob.text(),/^%PDF-/);h.cleanup();
});
test('mobile Reports Hub keeps Gate evidence response full and aborts replaced or unmounted downloads',async()=>{
 const pending=deferred(),h=hubHarness(()=>pending.promise);
 const old=h.context.download({project:'Facade',orderNumber:'1'}),newer=h.context.download({orderId:'gate'});assert.equal(h.calls[0].options.signal.aborted,true);
 assert.deepEqual(JSON.parse(h.calls[1].options.body),{orderId:'gate',includePdf:true});h.cleanup();assert.equal(h.calls[1].options.signal.aborted,true);
 pending.resolve(response(gateSnapshot));await Promise.all([old,newer]);assert.equal(h.downloads.length,0);assert.equal(h.timers.count(),0);
});
test('mobile Reports Hub rejects report timeouts with a retryable report error and blocks late account results',async()=>{
 const pending=deferred(),h=hubHarness(()=>pending.promise),request=h.context.download({orderId:'gate'}),failure=assert.rejects(request,/QA report is taking too long/);
 h.timers.tick(120000);await failure;assert.equal(h.calls[0].options.signal.aborted,true);h.cleanup();
 const late=deferred(),j=hubHarness(()=>late.promise),work=j.context.download({orderId:'gate'});j.context.PanelStock.username='other';late.resolve(response(gateSnapshot));await work;assert.equal(j.downloads.length,0);j.cleanup();
});
