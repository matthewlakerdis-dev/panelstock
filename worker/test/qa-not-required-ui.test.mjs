import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const panel={id:'panel-one',kind:'panel',project:'Example',orderNumber:'12',sheetNumber:'1',reference:'A',quantity:1,status:'awaiting',cutBy:'operator',cutAt:'2026-10-30T00:00:00Z'};
const exempt={...panel,id:'exempt',reference:'B',status:'not_required',qaExemption:{id:'exemption-one',reason:'QA is outside this order scope',by:'admin',at:'2026-10-30T01:00:00Z'}};
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children),...nodes(tree.props?.action)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');return tree&&typeof tree==='object'?text(tree.children):tree==null||typeof tree==='boolean'?'':String(tree);}
function button(tree,label){return nodes(tree).find(node=>node.tag==='button'&&text(node).trim()===label);}
function harness(items=[panel,exempt],{isAdmin=true,fetcher=null}={}){
 const states=[items,[],{panel:[['material','Material check']],metalwork:[],gate:[]},0,{},false],refs=[],calls=[],effects=[];let cursor=0,refCursor=0;
 const context={Date,Math,import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useEffect(callback){effects.push(callback);},PanelQaRequirements:"requirements",PageHeading:'heading',ShieldCheck:'shield',ChevronRight:'chevron',Camera:'camera',Upload:'upload',Check:'check',BAKED_WORKER_URL:'https://example.test',PanelStock:{apiFetch:async(url,options)=>{calls.push({url,options});if(fetcher)return fetcher(url,options);return {ok:true,json:async()=>({items})};}}};
 const start=source.indexOf('  function QaCenter('),end=source.indexOf('  function AuditCenter(',start);vm.runInNewContext(source.slice(start,end)+'globalThis.Component=QaCenter;',context);
 const render=()=>{cursor=refCursor=0;return context.Component({username:'reviewer',isAdmin,canManage:isAdmin});};
 return {states,calls,render,effects};
}
function expand(h){let tree=h.render();nodes(tree).find(node=>node.props['aria-expanded']===false)?.props.onClick();return h.render();}

test('mobile QA not required has its own status and is not counted as Approved or Awaiting QA',()=>{
 const approved={...panel,id:'approved',status:'approved'},h=harness([panel,approved,exempt]);let tree=h.render();
 for(const [label,count] of [['Awaiting QA',1],['Approved',1],['QA not required',1]]){const card=nodes(tree).find(node=>node.tag==='button'&&node.children.some(child=>child?.tag==='span'&&text(child)===label));assert.ok(card);assert.equal(text(nodes(card).find(node=>node.tag==='strong')),String(count));}
 const statusCard=nodes(tree).find(node=>node.tag==='button'&&node.props.key==='not_required');statusCard.props.onClick();tree=expand(h);const row=nodes(tree).find(node=>node.tag==='article'&&node.props.key==='exempt');assert.match(text(row),/QA not required/);assert.equal(button(row,'QA not required').props.disabled,true);assert.ok(button(row,'View report'));assert.equal(button(row,'Open check'),undefined);
});

test('mobile exemption report preserves the recorded reason and actor without inventing an inspection',()=>{
 const h=harness([exempt]);h.states[19]=exempt;const tree=h.render();assert.match(text(tree),/QA not required/);assert.match(text(tree),/QA is outside this order scope/);assert.match(text(tree),/Recorded by admin/);assert.match(text(tree),/No QA inspection was required/);assert.doesNotMatch(text(tree),/Approved|Inspection 1/);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const eligible={...panel,qaExemptionEligible:true,qaExemptionRevocable:false,qaProductionSignature:'production-one'},preQa={...eligible,id:'pre-qa',project:'Old project',reference:'OLD',cutAt:null,status:'pre_qa',qaProductionSignature:'production-old'},revocable={...exempt,qaExemptionEligible:false,qaExemptionRevocable:true,qaProductionSignature:'production-exempt'};
function manager({items=[eligible,preQa,revocable],send=null,get=null}={}){
 const states=[],refs=[],effects=[],calls=[],saved=[];let cursor=0,refCursor=0,closed=0;
 const context={Date,Math,import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useEffect(callback){if(!effects.length)effects.push(callback);},BAKED_WORKER_URL:'https://example.test',PanelStock:{username:'reviewer',apiFetch:async(url,options)=>{calls.push({url,options,body:options?JSON.parse(options.body):undefined});return options?(send?send(calls.at(-1)):{ok:true,json:async()=>({ok:true,items})}):(get?get():{ok:true,json:async()=>({ok:true,items})});}}};
 const start=source.indexOf('  function PanelQaRequirements('),end=source.indexOf('  function QaCenter(',start);vm.runInNewContext(source.slice(start,end)+'globalThis.Component=PanelQaRequirements;',context);
 const render=()=>{cursor=refCursor=0;return context.Component({username:'reviewer',onClose:()=>{closed++;},onSaved:value=>saved.push(value)});};
 const mount=async()=>{render();const cleanup=effects[0]();await settle();return cleanup;};
 return {states,refs,calls,saved,context,render,mount,closed:()=>closed};
}
function input(tree,type){return nodes(tree).find(node=>node.tag==='input'&&(!type||node.props.type===type));}
function checks(tree){return nodes(tree).filter(node=>node.tag==='input'&&node.props.type==='checkbox');}
function reason(tree,value){nodes(tree).find(node=>node.tag==='textarea').props.onChange({target:{value}});}
function post(tree){return nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});}

test('mobile requirement manager includes Pre-QA but sends only explicit filtered selections with production and exemption snapshots',async()=>{
 const h=manager();await h.mount();let tree=h.render();assert.match(text(tree),/Pre-QA/);assert.equal(checks(tree).length,2);assert.ok(checks(tree).every(node=>!node.props.checked));assert.equal(button(tree,'Mark QA not required').props.disabled,true);
 input(tree).props.onChange({target:{value:'Old project'}});tree=h.render();assert.equal(checks(tree).length,1);button(tree,'Select all filtered').props.onClick();tree=h.render();assert.equal(button(tree,'Mark QA not required').props.disabled,true);reason(tree,'No inspection required for this legacy order');tree=h.render();assert.equal(button(tree,'Mark QA not required').props.disabled,false);await post(tree);
 assert.equal(h.calls[0].url,'https://example.test/qa/panels/exemptions');assert.deepEqual(h.calls[1].body,{action:'grant',reason:'No inspection required for this legacy order',panels:[{id:'pre-qa',cutAt:null,productionSignature:'production-old',expectedExemptionId:null}]});assert.equal(h.saved.length,1);
});

test('mobile requires a reason and preserves selection and form values after a rejected requirement update',async()=>{
 const h=manager({send:async()=>({ok:false,json:async()=>({error:'Panel changed; refresh and review'})})});await h.mount();let tree=h.render();checks(tree)[0].props.onChange();await post(h.render());assert.equal(h.calls.length,1);assert.match(text(h.render()),/record a reason/);
 reason(h.render(),'Inspection is outside the scope');await post(h.render());tree=h.render();assert.match(text(tree),/Panel changed; refresh and review/);assert.equal(checks(tree)[0].props.checked,true);assert.equal(nodes(tree).find(node=>node.tag==='textarea').props.value,'Inspection is outside the scope');assert.equal(h.saved.length,0);assert.equal(h.closed(),0);
});

test('mobile Require QA again uses the current exemption ID and records the undo reason',async()=>{
 const h=manager();await h.mount();let tree=h.render();button(tree,'Require QA again').props.onClick();tree=h.render();assert.equal(checks(tree).length,1);assert.match(text(tree),/QA is outside this order scope/);assert.ok(checks(tree).every(node=>!node.props.checked));checks(tree)[0].props.onChange();reason(h.render(),'Inspection is now requested');await post(h.render());assert.deepEqual(h.calls[1].body,{action:'revoke',reason:'Inspection is now requested',panels:[{id:'exempt',cutAt:exempt.cutAt,productionSignature:'production-exempt',expectedExemptionId:'exemption-one'}]});
});

test('mobile manager blocks duplicate saves and ignores responses after closing or account changes',async()=>{
 for(const cancel of [true,false,null]){
  const pending=defer(),h=manager({send:()=>pending.promise});await h.mount();let tree=h.render();checks(tree)[0].props.onChange();reason(h.render(),'No QA required');tree=h.render();const saving=post(tree);await post(tree);assert.equal(h.calls.filter(call=>call.options).length,1);
  if(cancel)button(h.render(),'Cancel').props.onClick();else h.context.PanelStock.username=cancel===null?null:'another-user';pending.resolve({ok:true,json:async()=>({ok:true,items:[]})});await saving;assert.equal(h.saved.length,0);assert.equal(h.closed(),cancel?1:0);
 }
 const pending=defer(),j=manager({get:()=>pending.promise});j.render();const mounting=j.mount();button(j.render(),'Cancel').props.onClick();pending.resolve({ok:true,json:async()=>({items:[eligible]})});await mounting;assert.equal(j.states[0].length,0);
});

test('mobile report keeps QA requirement event history separate from inspection history',()=>{
 const h=harness([{...panel,qaExemptionHistory:[{id:'event-one',action:'grant',reason:'Original scope',by:'first admin',at:'2026-10-30T00:00:00Z'},{id:'event-two',action:'revoke',reason:'Inspection requested later',by:'second admin',at:'2026-10-30T01:00:00Z'}]}]);h.states[19]={...panel,qaExemptionHistory:h.states[0][0].qaExemptionHistory};const tree=h.render();assert.match(text(tree),/QA requirement history/);assert.match(text(tree),/Original scope/);assert.match(text(tree),/QA required again/);assert.match(text(tree),/second admin/);assert.doesNotMatch(text(tree),/Inspection 1/);
});


test('mobile QA requirement management is admin-only and candidate save refreshes normal QA without stale overwrite',async()=>{
 const regular=harness([panel],{isAdmin:false});assert.equal(button(regular.render(),'QA requirements'),undefined);
 const old=defer(),fresh=defer();let requests=0;const h=harness([panel],{fetcher:()=>++requests===1?old.promise:fresh.promise});let tree=h.render();assert.ok(button(tree,'QA requirements'));h.effects[0]();
 button(h.render(),'QA requirements').props.onClick();tree=h.render();assert.equal(tree.tag,'requirements');tree.props.onSaved({items:[preQa]});assert.equal(requests,2);
 fresh.resolve({ok:true,json:async()=>({items:[exempt],dispatches:[],checklists:listsForTest(),settings:{}})});await settle();assert.deepEqual(h.states[0].map(item=>item.id),['exempt']);
 old.resolve({ok:true,json:async()=>({items:[panel],dispatches:[],settings:{}})});await settle();assert.deepEqual(h.states[0].map(item=>item.id),['exempt']);assert.equal(h.states[0].some(item=>item.id==='pre-qa'),false);
});
function listsForTest(){return {panel:[['material','Material check']],metalwork:[],gate:[]};}

test('mobile Dispatch distinguishes QA exemptions from approvals and keeps backend readiness blocking final QA',()=>{
 const start=source.indexOf('  function PanelDispatchLoads()'),end=source.indexOf('  function DispatchTab(',start),load={id:'load',project:'Example',orderNumber:'12',status:'awaiting_final_qa',routing:true,fabricationComplete:true,qaComplete:true,ready:false,legs:[],items:[{id:'exempt',sheetNumber:'1',reference:'B',routing:true,qa:true,qaStatus:'not_required',qaExemption:exempt.qaExemption}]};let index=0;const values=[[load],false,'',null,{},'','active'],context={Date,import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState:()=>[values[index++],()=>{}],useEffect(){},PageHeading:'heading',Truck:'truck',PanelStock:{},BAKED_WORKER_URL:''};vm.runInNewContext(source.slice(start,end)+'globalThis.tree=PanelDispatchLoads();',context);assert.match(text(context.tree),/QA not required/);assert.match(text(context.tree),/QA is outside this order scope/);assert.match(text(context.tree),/admin/);assert.doesNotMatch(text(context.tree),/QA approved/);assert.ok(button(context.tree,'Approve final QA'));assert.equal(button(context.tree,'Dispatch to site'),undefined);
});

test('mobile expired exemptions are shown as previous history rather than current QA not required',()=>{
 const h=harness([panel]);h.states[19]={...panel,qaExemption:{...exempt.qaExemption,active:false}};const tree=h.render();assert.match(text(tree),/Previous QA exemption/);assert.doesNotMatch(text(tree),/No QA inspection was required/);
});
