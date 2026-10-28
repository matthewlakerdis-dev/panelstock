import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const gate={id:'gate-qa',kind:'metalwork',checklistKind:'gate',gateOrderId:'gate-order',reference:'Gate: A',project:'Example',orderNumber:'12',quantity:1,status:'awaiting',drawnBy:'drafter'};
const lists={panel:[['panel','Panel check']],metalwork:[['material','Metal material check']],gate:[['hinges','Gate hinges check'],['latch','Gate latch check']]};
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');return tree&&typeof tree==='object'?text(tree.children):tree==null||typeof tree==='boolean'?'':String(tree);}
function button(tree,label){return nodes(tree).find(node=>node.tag==='button'&&text(node).trim()===label);}
function harness(kind='qa',overrides={}){
 const states=kind==='qa'?[[gate],[],structuredClone(lists),0,{},false]:[
  {panelChecks:lists.panel,metalworkChecks:lists.metalwork,gateChecks:lists.gate,activePanelChecks:['panel'],activeMetalworkChecks:['material'],activeGateChecks:['hinges','latch']},structuredClone(lists),false,''];
 Object.assign(states,overrides);let cursor=0,refCursor=0;const calls=[],refs=[];
 const context={Date,Math,import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState(initial){const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef(initial){const index=refCursor++;return refs[index]||(refs[index]={current:initial});},useEffect(){},PageHeading:'heading',ShieldCheck:'shield',ChevronRight:'chevron',Camera:'camera',Upload:'upload',Check:'check',Plus:'plus',Trash2:'trash',BAKED_WORKER_URL:'https://example.test',PanelStock:{apiFetch:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  return {ok:true,json:async()=>kind==='qa'?{items:[],dispatches:[],item:{status:'approved'}}:{settings:body,availableChecklists:{panel:body.panelChecks,metalwork:body.metalworkChecks,gate:body.gateChecks}}};
 }}};
 const start=source.indexOf(kind==='qa'?'  function QaCenter(':'  function QaSettingsPage('),end=source.indexOf(kind==='qa'?'  function AuditCenter(':'  function CncTab(',start);
 vm.runInNewContext(source.slice(start,end)+'globalThis.Component='+(kind==='qa'?'QaCenter':'QaSettingsPage')+';',context);
 const render=()=>{cursor=0;refCursor=0;return context.Component({username:'inspector',isAdmin:true,canManage:true});};
 return {states,calls,render};
}
function open(view){let tree=view.render();nodes(tree).find(node=>node.props['aria-expanded']===false).props.onClick();tree=view.render();button(tree,'Open check').props.onClick();return view.render();}

test('mobile Gate checks are independently editable and saved with their active selection',async()=>{
 const h=harness('settings');let tree=h.render();assert.ok(nodes(tree).find(node=>node.tag==='legend'&&text(node)==='Gate checks'));
 const input=nodes(tree).find(node=>node.props['aria-label']==='Edit gate check 1');input.props.onChange({target:{value:'Check every gate hinge fixing'}});
 tree=h.render();nodes(tree).find(node=>node.props['aria-label']==='Disable Gate latch check').props.onClick();
 tree=h.render();button(tree,'Add gate check').props.onClick();tree=h.render();
 const newInput=nodes(tree).find(node=>node.props['aria-label']==='Edit gate check 3');newInput.props.onChange({target:{value:'Check gate opening direction'}});tree=h.render();
 await nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});
 const payload=h.calls[0].body;assert.deepEqual(payload.panelChecks,lists.panel);assert.deepEqual(payload.metalworkChecks,lists.metalwork);assert.equal(payload.gateChecks[0][1],'Check every gate hinge fixing');assert.equal(payload.gateChecks[2][1],'Check gate opening direction');assert.equal(payload.activeGateChecks.includes('latch'),false);assert.equal(payload.activeGateChecks.includes(payload.gateChecks[2][0]),true);
 tree=h.render();assert.match(text(tree),/QA settings saved/);assert.equal(nodes(tree).find(node=>node.props['aria-label']==='Edit gate check 3').props.value,'Check gate opening direction');
 nodes(tree).find(node=>node.props['aria-label']==='Delete Check gate opening direction').props.onClick();tree=h.render();assert.equal(nodes(tree).some(node=>node.props['aria-label']==='Edit gate check 3'),false);
});

test('mobile Gate inspections use only Gate checks and preserve the metalwork API kind',async()=>{
 const h=harness();let tree=open(h);assert.match(text(tree),/Gate inspection/);assert.match(text(tree),/Gate hinges check/);assert.doesNotMatch(text(tree),/Metal material check/);assert.equal(button(tree,'Approve QA').props.disabled,true);
 button(tree,'Complete all').props.onClick();tree=h.render();assert.equal(button(tree,'Approve QA').props.disabled,false);await nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});
 assert.equal(h.calls[0].body.kind,'metalwork');assert.equal(h.calls[0].body.id,'gate-qa');assert.deepEqual(h.calls[0].body.results,{hinges:'pass',latch:'pass'});
 const normal=harness('qa',{0:[{...gate,id:'normal',checklistKind:undefined,gateOrderId:undefined,fabricatedBy:'maker'}]});const normalTree=open(normal);assert.match(text(normalTree),/Metal material check/);assert.doesNotMatch(text(normalTree),/Gate hinges check/);
 const legacyView=harness('qa',{0:[{...gate,checklistKind:undefined}]});assert.match(text(open(legacyView)),/Gate hinges check/);
});

test('mobile refuses Gate inspections when the dedicated checklist is unavailable',async()=>{
 const h=harness('qa',{2:{...lists,gate:[]}});let tree=open(h);assert.match(text(tree),/inspection checklist is unavailable/);assert.equal(nodes(tree).some(node=>node.tag==='form'),false);
 h.states[11]=gate;tree=h.render();assert.equal(button(tree,'Approve QA').props.disabled,true);await nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,0);
});

test('mobile Gate reports preserve snapshot wording and older metalwork inspection labels',()=>{
 const report={...gate,status:'approved',history:[{id:'old',status:'approved',results:{material:'pass'},checkedBy:'old reviewer'},{id:'new',status:'approved',checklistKind:'gate',checklist:[['hinges','Gate hinges wording at inspection']],results:{hinges:'pass'},checkedBy:'new reviewer'}]};
 const h=harness('qa',{19:report}),tree=h.render();assert.match(text(tree),/Gate hinges wording at inspection/);assert.match(text(tree),/Metal material check/);assert.doesNotMatch(text(tree),/Gate hinges check/);
});
