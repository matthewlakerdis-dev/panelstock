import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const manual=(id='manual-one',extra={})=>({id,kind:'metalwork',project:'Manual project',orderNumber:'012',reference:'Bracket A',quantity:4,fabricatedBy:'Fabricator',createdAt:'2026-11-19T01:00:00Z',status:'awaiting',latest:null,history:[],photoAdditions:[],dispatchedQuantity:0,dispatchStatus:'ready',...extra});
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children),...nodes(tree.props?.action)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');return tree&&typeof tree==='object'?text(tree.children):tree==null||typeof tree==='boolean'?'':String(tree);}
function button(tree,label){return nodes(tree).find(node=>node.tag==='button'&&text(node).trim()===label);}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness({items=[manual()],dispatches=[],isAdmin=false,canManage=true,fetcher=null,initialReport=null}={}){
 const states=[items,dispatches,{panel:[],metalwork:[['finish','Finish check']],gate:[]},0,{},false],refs=[],effects=[],calls=[];let cursor=0,refCursor=0;
 const context={AbortController,setTimeout,clearTimeout,Date,Math,import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useEffect(callback){effects.push(callback);},PageHeading:'heading',ShieldCheck:'shield',ChevronRight:'chevron',Camera:'camera',Upload:'upload',Check:'check',BAKED_WORKER_URL:'https://example.test',PanelStock:{username:'manager',apiFetch:async(url,options)=>{const request={url,options,body:options?JSON.parse(options.body):undefined};calls.push(request);return fetcher?fetcher(request):{ok:true,json:async()=>({ok:true,items,dispatches})};}}};
 const start=source.indexOf('  function QaCenter('),end=source.indexOf('  function AuditCenter(',start);vm.runInNewContext(source.slice(source.indexOf("  async function qaRequestJson("),source.indexOf("  function QaCenter("))+source.slice(start,end)+'globalThis.Component=QaCenter;',context);
 const render=()=>{cursor=refCursor=0;return context.Component({username:'manager',isAdmin,canManage,initialReport});};
 return {states,calls,effects,context,render};
}
function expanded(h){let tree=h.render();for(const toggle of nodes(tree).filter(node=>node.props['aria-expanded']===false))toggle.props.onClick();return h.render();}
function row(tree,id='manual-one'){return nodes(tree).find(node=>node.tag==='article'&&node.props.key===id);}
function openDelete(h,id='manual-one'){let tree=expanded(h);const action=button(row(tree,id),'Delete');assert.ok(action,'Delete action');action.props.onClick();return h.render();}
function confirm(tree){return nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});}
function count(tree,label){const card=nodes(tree).find(node=>node.tag==='button'&&node.children.some(child=>child?.tag==='span'&&text(child)===label));return Number(text(nodes(card).find(node=>node.tag==='strong')));}

test('mobile offers Delete only to QA managers or admins for uninspected ordinary manual entries',()=>{
 const blocked=[manual('panel',{kind:'panel'}),manual('gate',{gateOrderId:'gate-order'}),manual('component',{gateComponentId:'gate-component'}),manual('gate-revision',{gateRevision:'revision'}),manual('gate-set',{gateSet:1}),manual('gate-index-zero',{gateItemIndex:0}),manual('gate-empty-marker',{gateOrderId:''}),manual('drawn-marker',{drawnBy:undefined}),manual('gate-checklist',{checklistKind:'gate'}),manual('replacement',{replacementId:'original'}),manual('remake',{remakeOf:'original'}),manual('replacement-status',{replacementStatus:'pending'}),manual('separate-recut',{resolvedSeparatelyReason:'Resolved'}),manual('legacy-photo',{photo:'photo'}),manual('legacy-results',{results:{}}),manual('legacy-notes',{notes:'Evidence'}),manual('legacy-inspector',{checkedBy:'inspector'}),manual('legacy-date',{checkedAt:'2026-11-19'}),manual('exemption',{qaExemption:{}}),manual('legacy-photos',{photos:['photo']}),manual('exemption-history',{qaExemptionHistory:[{}]}),manual('null-history',{history:null}),manual('null-additions',{photoAdditions:null}),manual('null-photos',{photos:null}),manual('null-exemptions',{qaExemptionHistory:null}),manual('approved',{status:'approved'}),manual('recut',{status:'recut'}),manual('replaced',{status:'replaced'}),manual('checked',{latest:{id:'qa'}}),manual('history',{history:[{id:'old-check'}]}),manual('photos',{photoAdditions:[{id:'photo-event'}]}),manual('dispatched',{dispatchedQuantity:1}),manual('partial',{dispatchStatus:'partial'}),manual('manifest'),manual('malformed-history',{history:{id:'check'}})];
 const h=harness({items:[manual(),manual('blank',{status:''}),...blocked],dispatches:[{lines:[{id:'manifest',quantity:1}]}]});h.states[8]='all';const tree=expanded(h);for(const id of ['manual-one','blank'])assert.ok(button(row(tree,id),'Delete'));for(const item of blocked)assert.equal(button(row(tree,item.id),'Delete'),undefined,item.id);
 assert.equal(button(expanded(harness({canManage:false})),'Delete'),undefined);assert.ok(button(expanded(harness({isAdmin:true,canManage:false})),'Delete'));assert.equal(button(tree,'Gate QA overview'),undefined);
});

test('mobile delete confirmation identifies exactly one manual entry and Cancel makes no API call',()=>{
 const h=harness(),tree=openDelete(h);for(const value of ['Delete pending QA entry?','Manual project','012','Bracket A','4','Fabricator','2026'])assert.ok(text(tree).includes(value),value);assert.equal(h.calls.length,0);button(tree,'Cancel').props.onClick();assert.equal(h.calls.length,0);assert.ok(row(expanded(h)));assert.equal(h.states[0].length,1);
});

test('mobile deletes only after confirmed server success and applies the returned QA view without changing filters',async()=>{
 const pending=deferred(),remaining=[manual('remaining',{project:'Another project',reference:'Washer B'}),manual('approved',{status:'approved',latest:{id:'qa'}})],h=harness({fetcher:()=>pending.promise});h.states[9]='metalwork';h.states[10]='Bracket';const tree=openDelete(h);const request=confirm(tree);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,{id:'manual-one'});assert.equal(h.calls[0].url,'https://example.test/qa/metalwork/delete?view=queue');assert.equal(h.calls[0].options.method,'POST');assert.equal(h.states[0][0].id,'manual-one');assert.equal(button(h.render(),'Deleting…').props.disabled,true);
 pending.resolve({ok:true,json:async()=>({ok:true,deletedId:'manual-one',items:remaining,dispatches:[],preQaCount:3,settings:{requireQaPhoto:true},checklists:{metalwork:[['finish','New finish']]}})});await request;const result=h.render();assert.deepEqual(h.states[0].map(item=>item.id),['remaining','approved']);assert.equal(h.states[8],'awaiting');assert.equal(h.states[9],'metalwork');assert.equal(h.states[10],'Bracket');assert.equal(count(result,'Awaiting QA'),1);assert.equal(count(result,'Approved'),1);assert.equal(h.states[3],3);assert.equal(h.states[4].requireQaPhoto,true);assert.equal(nodes(result).some(node=>node.tag==='section'&&node.props.key==='Manual project\u0000012'),false);assert.match(text(result),/No QA items match these filters/);assert.match(text(result),/Pending QA entry deleted/);
});

test('mobile preserves the entry and confirmation on denied, stale or unconfirmed delete responses',async()=>{
 for(const response of [{ok:false,json:async()=>({error:'This entry has already been inspected'})},{ok:false,json:async()=>({error:'You do not have access to this task'})},{ok:true,json:async()=>({ok:true,deletedId:'another-entry',items:[]})}]){const h=harness({fetcher:async()=>response});await confirm(openDelete(h));const tree=h.render();assert.equal(h.states[0][0].id,'manual-one');assert.ok(button(tree,'Delete entry'));assert.ok(nodes(tree).find(node=>node.props.role==='alert'));assert.equal(button(tree,'Delete entry').props.disabled,false);assert.equal(h.calls.length,1);}
});

test('mobile prevents double confirmation and ignores deleted-entry responses after close, logout or unmount',async()=>{
 for(const action of ['close','logout','unmount']){const pending=deferred(),h=harness({items:[manual(),manual('second',{reference:'Other entry'})],fetcher:()=>pending.promise});const tree=openDelete(h),staleCancel=button(tree,'Cancel');const request=confirm(tree);await confirm(tree);assert.equal(h.calls.length,1);assert.equal(button(h.render(),'Cancel').props.disabled,true);
  if(action==='close'){staleCancel.props.onClick();openDelete(h,'second');}else if(action==='logout')h.context.PanelStock.username=null;else {const cleanup=h.effects[0]();cleanup();}
  pending.resolve({ok:true,json:async()=>({ok:true,deletedId:'manual-one',items:[],dispatches:[]})});await request;assert.equal(h.states[0].length,2);if(action==='close'){assert.match(text(h.render()),/Other entry/);assert.ok(button(h.render(),'Delete entry'));}
 }
});

test('mobile invalidates an older QA refresh so it cannot restore a successfully deleted entry',async()=>{
 const pending=deferred(),h=harness({fetcher:async request=>request.options?{ok:true,json:async()=>({ok:true,deletedId:'manual-one',items:[],dispatches:[]})}:pending.promise});const tree=openDelete(h);h.effects[0]();await confirm(tree);assert.equal(h.states[0].length,0);pending.resolve({ok:true,json:async()=>({items:[manual()],dispatches:[]})});await settle();assert.equal(h.states[0].length,0);assert.match(text(h.render()),/No QA items match these filters/);
});

test('mobile rechecks a pending confirmation when the entry gains inspection history before submission',async()=>{
 const h=harness(),tree=openDelete(h);h.states[0]=[manual('manual-one',{history:[{id:'checked'}]})];await confirm(h.render());assert.equal(h.calls.length,0);assert.match(text(h.render()),/entry has changed and cannot be deleted/);assert.equal(h.states[0].length,1);
});


test('mobile ignores an old confirmation callback after cancellation or a completed deletion',async()=>{
 const h=harness({items:[manual(),manual('second',{reference:'Other entry'})],fetcher:async()=>({ok:true,json:async()=>({ok:true,deletedId:'second',items:[manual()],dispatches:[]})})});const old=openDelete(h);button(old,'Cancel').props.onClick();const current=openDelete(h,'second');await confirm(old);assert.equal(h.calls.length,0);assert.match(text(h.render()),/Other entry/);await confirm(current);assert.equal(h.calls.length,1);await confirm(current);assert.equal(h.calls.length,1);
});
