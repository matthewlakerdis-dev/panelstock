import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/gate-progress-stages.js',import.meta.url),'utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync(new URL('../src/gate-progress-client.js',import.meta.url),'utf8').replace(/^import .*?;\s*/,'').replace(/^export /gm,'');
const pdfBytes=Buffer.from('%PDF-1.4\nsaved order snapshot\n%%EOF');
const order={id:'stable-gate-order',project:'Project',orderNumber:'007',orderType:'Gate',villa:'11',colour:'White',areaM2:4,status:'approved',components:[{id:'visible-only',set:1,label:'Gate A',qaStatus:'approved'}]};
const unstarted={...order,id:'unstarted-order',components:[]};
function report(id=order.id){return {orderId:id,project:'Project <script>bad()</script>',orderNumber:'007',orderType:'Gate',villa:'11',colour:'White',areaM2:4,status:'missing',summary:{total:3,approved:1,recut:0,awaiting:1,missing:1},mappingIssues:['Link review <img src=x onerror=bad()>'],items:[{id:'a',componentId:'a',set:1,label:'Gate A',quantity:1,status:'approved',latest:{checkedBy:'Inspector',checkedAt:'2026-11-11T23:00:00Z'}},{id:'b',componentId:'b',set:1,label:'Post <B>',quantity:1,status:'missing'},{id:'c',componentId:'c',set:2,label:'Gate C',quantity:1,status:'awaiting'}],previousQa:[{id:'old',reference:'Earlier piece',history:[{status:'approved',notes:'Historical notes <b>retained</b>',results:{finish:'pass'}}]}]};}
function result(id=order.id,pdf={fileName:'Gate_007.pdf',mime:'application/pdf',data:pdfBytes.toString('base64')}){return {ok:true,report:report(id),pdf};}
const response=(body,status=200)=>({ok:status<400,json:async()=>body});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness({canQa=true,orders=[order,unstarted],reportFetch=async body=>response(result(body.orderId))}={}){
 const listeners={},requests=[],downloads=[],blobs=[],revoked=[],timers=[];
 const element=()=>({innerHTML:'',textContent:'',hidden:false,disabled:false,focus(){},querySelectorAll:()=>[]});
 const elements=Object.fromEntries(['#notice','#dialogNotice','#content','#mode','#expandAll','#dialogBody'].map(key=>[key,element()]));
 elements['#editor']={...element(),open:false,showModal(){this.open=true;},close(){this.open=false;}};
 const root={innerHTML:'',querySelector:selector=>elements[selector]||null,querySelectorAll:()=>[],addEventListener:(type,callback)=>listeners[type]=callback};
 const context={console,AbortController,Map,Set,Date,Promise,Uint8Array,Blob,atob,CSS:{escape:value=>value},document:{hidden:false,addEventListener(){},createElement(){const link={remove(){},click(){downloads.push({href:this.href,fileName:this.download});}};return link;},body:{appendChild(){}}},window:{addEventListener(){},getSelection:()=>({toString:()=>''})},setInterval:()=>1,clearInterval(){},setTimeout:callback=>timers.push(callback),URL:{createObjectURL(blob){blobs.push(blob);return 'blob:qa-overview';},revokeObjectURL(url){revoked.push(url);}}};
 vm.createContext(context);vm.runInContext(source,context);
 const app=context.gateProgressApp({root,workerUrl:'https://fixture.example',apiFetch:async(url,options)=>{const body=options.body?JSON.parse(options.body):undefined;requests.push({url,options,body});return url.endsWith('/gate-components')?response({canQa,canManage:false,orders,checklist:[]}):reportFetch(body);}});
 const click=(action,orderId=order.id)=>{const button={dataset:{action,order:orderId},disabled:false},target={matches:()=>false,closest:selector=>selector==='[data-action]'?button:null};return listeners.click({target});};
 return {root,elements,requests,downloads,blobs,revoked,timers,app,click};
}

test('QA users receive a stable order overview action even before components are configured',async()=>{
 const h=harness();await settle();await h.click('expand-all');const html=h.elements['#content'].innerHTML;
 assert.equal((html.match(/data-action="gate-qa-report"/g)||[]).length,2);assert.match(html,/data-order="unstarted-order"/);
 await h.click('gate-qa-report',unstarted.id);assert.deepEqual(h.requests.at(-1).body,{orderId:unstarted.id,includePdf:true});
 h.app.destroy();const denied=harness({canQa:false});await settle();await denied.click('expand-all');assert.doesNotMatch(denied.elements['#content'].innerHTML,/gate-qa-report/);await denied.click('gate-qa-report');assert.equal(denied.requests.length,1);denied.app.destroy();
});

test('preview includes all server snapshot pieces, mapping review and separate history with escaped content',async()=>{
 const h=harness();await settle();await h.click('gate-qa-report');const html=h.elements['#dialogBody'].innerHTML;
 assert.deepEqual(h.requests.at(-1).body,{orderId:order.id,includePdf:true});assert.equal(h.elements['#editor'].open,true);
 for(const value of ['Gate A','Post &lt;B&gt;','Gate C','Pieces: 3','Approved: 1','Previous QA records (1)','Earlier piece','Historical notes &lt;b&gt;retained&lt;/b&gt;','QA link review required','Link review &lt;img'])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/<script>|<img src=x|<b>retained/);h.app.destroy();
});

test('download uses exactly the cached PDF without another fetch and sanitizes the filename',async()=>{
 const h=harness({reportFetch:async body=>response(result(body.orderId,{fileName:'../Gate\\QA\r\n007.pdf',mime:'application/pdf',data:pdfBytes.toString('base64')}))});await settle();await h.click('gate-qa-report');const before=h.requests.length;await h.click('gate-qa-download');
 assert.equal(h.requests.length,before);assert.equal(h.downloads.length,1);assert.match(h.downloads[0].fileName,/^[^/\\\r\n\0]+\.pdf$/);assert.equal(h.blobs[0].type,'application/pdf');assert.deepEqual(Buffer.from(await h.blobs[0].arrayBuffer()),pdfBytes);
 for(const callback of h.timers)callback();assert.deepEqual(h.revoked,['blob:qa-overview']);h.app.destroy();
});

test('invalid PDF payloads and mismatched order snapshots show an error without downloads',async()=>{
 for(const pdf of [{mime:'text/html',data:pdfBytes.toString('base64')},{mime:'application/pdf',data:'%%%invalid'},{mime:'application/pdf',data:Buffer.from('not a PDF').toString('base64')},undefined]){
  const h=harness({reportFetch:async body=>response({...result(body.orderId),pdf})});await settle();await h.click('gate-qa-report');assert.equal(h.elements['#editor'].open,false);assert.match(h.elements['#notice'].textContent,/PDF.*read/);assert.equal(h.downloads.length,0);h.app.destroy();
 }
 const h=harness({reportFetch:async()=>response(result('other-order'))});await settle();await h.click('gate-qa-report');assert.equal(h.elements['#editor'].open,false);assert.match(h.elements['#notice'].textContent,/overview could not be loaded/);h.app.destroy();
});

test('a read error can be retried and duplicate clicks do not create concurrent report requests',async()=>{
 let calls=0,finish;
 const h=harness({reportFetch:body=>{calls++;return calls===1?response({error:'Please retry the overview'},503):new Promise(resolve=>finish=()=>resolve(response(result(body.orderId))));}});await settle();await h.click('gate-qa-report');assert.match(h.elements['#notice'].textContent,/Please retry/);
 const opening=h.click('gate-qa-report');await h.click('gate-qa-report');assert.equal(calls,2);finish();await opening;assert.equal(h.elements['#editor'].open,true);h.app.destroy();
});

test('destroying the Gate Progress view discards a pending private report response',async()=>{
 let finish;const h=harness({reportFetch:body=>new Promise(resolve=>finish=()=>resolve(response(result(body.orderId))))});await settle();const opening=h.click('gate-qa-report');h.app.destroy();finish();await opening;assert.equal(h.elements['#editor'].open,false);assert.equal(h.root.innerHTML,'');assert.equal(h.downloads.length,0);
});

test('overview history uses saved labels, explicit attempt kind and legacy metalwork wording in that order',async()=>{
 const snapshot=report();snapshot.checklists={gate:[['finish','Current Gate finish'],['oldOnly','Current Gate-only label']],metalwork:[['finish','Legacy metalwork finish']]};snapshot.previousQa=[{id:'earlier',reference:'Earlier piece',history:[
  {id:'legacy',status:'approved',results:{finish:'pass'}},
  {id:'gate-kind',status:'approved',checklistKind:'gate',results:{finish:'pass'}},
  {id:'snapshot',status:'approved',checklistKind:'gate',checklist:[['finish','Saved <inspection> wording']],results:{finish:'pass'}},
  {id:'unknown-legacy-key',status:'approved',results:{oldOnly:'pass'}}
 ]}];
 const h=harness({reportFetch:async()=>response({ok:true,report:snapshot,pdf:result().pdf})});await settle();await h.click('gate-qa-report');
 const articles=[...h.elements['#dialogBody'].innerHTML.matchAll(/<article>([\s\S]*?)<\/article>/g)].map(match=>match[1]);assert.equal(articles.length,4);
 assert.match(articles[0],/Legacy metalwork finish: pass/);assert.doesNotMatch(articles[0],/Current Gate finish/);
 assert.match(articles[1],/Current Gate finish: pass/);assert.doesNotMatch(articles[1],/Legacy metalwork finish/);
 assert.match(articles[2],/Saved &lt;inspection&gt; wording: pass/);assert.doesNotMatch(articles[2],/Current Gate finish|Legacy metalwork finish/);
 assert.match(articles[3],/oldOnly: pass/);assert.doesNotMatch(articles[3],/Current Gate-only label/);h.app.destroy();
});

test('overview identifies the last saved historical inspection when a current item has no latest pointer',async()=>{
 const snapshot=report();snapshot.items[0].latest=null;snapshot.items[0].history=[{status:'recut',checkedBy:'Earlier reviewer',checkedAt:'2026-11-10T00:00:00Z'},{status:'approved',checkedBy:'Historical approver',checkedAt:'2026-11-11T23:00:00Z'}];const before=JSON.stringify(snapshot);
 const h=harness({reportFetch:async()=>response({ok:true,report:snapshot,pdf:result().pdf})});await settle();await h.click('gate-qa-report');const html=h.elements['#dialogBody'].innerHTML;
 assert.match(html,/Historical approver/);assert.doesNotMatch(html,/Earlier reviewer/);assert.equal(JSON.stringify(snapshot),before);h.app.destroy();
});

test('overview previous QA retains a distinct latest snapshot even when it shares a history ID',async()=>{
 const earlier={id:'shared-inspection',status:'approved',checkedBy:'Inspector',results:{finish:'pass'},notes:'Earlier saved inspection note.'},latest={...earlier,notes:'Distinct latest inspection evidence.'};
 const matching={id:'matching-inspection',status:'approved',results:{finish:'pass',dimension:'na'},notes:'Exact saved snapshot appears once.'};
 const snapshot=report();snapshot.previousQa=[{id:'changed',reference:'Changed snapshot',history:[earlier],latest},{id:'matching',reference:'Matching snapshot',history:[matching],latest:{notes:matching.notes,results:{dimension:'na',finish:'pass'},status:matching.status,id:matching.id}}];const before=JSON.stringify(snapshot);
 const h=harness({reportFetch:async()=>response({ok:true,report:snapshot,pdf:result().pdf})});await settle();await h.click('gate-qa-report');const html=h.elements['#dialogBody'].innerHTML;
 assert.match(html,/Earlier saved inspection note\./);assert.match(html,/Distinct latest inspection evidence\./);assert.equal((html.match(/Exact saved snapshot appears once\./g)||[]).length,1);assert.equal((html.match(/<article>/g)||[]).length,3);assert.equal(JSON.stringify(snapshot),before);h.app.destroy();
});
