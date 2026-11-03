import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const start=source.indexOf('  function PanelDispatchLoads()'),end=source.indexOf('  function DispatchTab(',start);
function view(loads,selected=null,filter="active",response={}){
 let index=0;const values=[loads,false,'',selected,{destinationType:'site'},'',filter],effects=[];
 const context={import_react:{createElement:(tag,props,...children)=>({tag,props,children})},useState:initial=>{const i=index++;if(!(i in values))values[i]=initial;return [values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];},useEffect:effect=>effects.push(effect),window:{},PageHeading:'heading',Truck:'truck',EmptyState:'empty',PanelStock:{apiFetch:async()=>({ok:true,json:async()=>response})},BAKED_WORKER_URL:''};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {render(){index=0;return context.PanelDispatchLoads();},async load(){effects[1]();await new Promise(resolve=>setImmediate(resolve));}};
}
function render(loads,selected=null,filter="active"){return view(loads,selected,filter).render();}

function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.children)];}
const base={id:'load',project:'Job',orderNumber:'001',status:'waiting',items:[{id:'p',reference:'1'}],legs:[],routing:false,fabricationComplete:false,qaComplete:false,ready:false};
test('dispatch screen renders disabled dispatch while production is pending',()=>{const buttons=nodes(render([base])).filter(n=>n.tag==='button');assert.equal(buttons.find(n=>n.children.includes('Dispatch load')).props.disabled,true);assert.equal(buttons.some(n=>n.children.includes('Complete fabrication')),false);});
test('powder coating load displays completion action, not another dispatch',()=>{const buttons=nodes(render([{...base,status:'at_powder_coaters'}])).filter(n=>n.tag==='button');assert.ok(buttons.find(n=>n.children.includes('Mark coating complete')));assert.equal(buttons.some(n=>n.children.includes('Dispatch load')),false);});
test('second-leg form only offers site',()=>{const options=nodes(render([],{...base,status:'ready_for_site'})).find(n=>n.tag==='select').children.flat(Infinity).filter(n=>n&&n.tag==='option');assert.deepEqual(options.map(n=>n.props.value),['site']);});
test('coated loads awaiting final QA stay active with no dispatch action',()=>{const tree=nodes(render([{...base,status:'awaiting_final_qa',routing:true,qaComplete:true}])),buttons=tree.filter(n=>n.tag==='button');assert.ok(buttons.find(n=>n.children.includes('Approve final QA')));assert.equal(buttons.some(n=>n.children.includes('Dispatch to site')),false);assert.ok(tree.some(n=>n.children?.includes('Awaiting final QA')));});
test('QA no longer includes a dispatch form or dispatch button',()=>{const qa=source.slice(source.indexOf('  function QaCenter('),source.indexOf('  function AuditCenter('));assert.equal(qa.includes('/qa/dispatch'),false);assert.equal(qa.includes('Dispatch load'),false);});

test('active view hides dispatched loads and places ready loads first',()=>{const pending={...base,id:'pending',project:'Pending project'},ready={...base,id:'ready',project:'Ready project',ready:true,routing:true,fabricationComplete:true,qaComplete:true},sent={...ready,id:'sent',project:'Sent project',status:'dispatched_to_site'};const headings=nodes(render([pending,sent,ready])).filter(n=>n.tag==='h3').map(n=>n.children[0]);assert.deepEqual(headings,['Ready project','Pending project']);assert.deepEqual(nodes(render([pending,sent,ready],null,'dispatched')).filter(n=>n.tag==='h3').map(n=>n.children[0]),['Sent project']);});

test('mobile dispatch uses shared vehicle and driver defaults and the project address',async()=>{
 const load={...base,ready:true,routing:true,fabricationComplete:true,qaComplete:true,siteAddress:'141 Queen Street Mall'};
 const ui=view([],null,'active',{loads:[load],dispatchVehicles:['Lennox Ute','Lennox Truck'],dispatchDrivers:[{username:'alex',displayName:'Alex'}],dispatchDefaultDriver:'alex'});
 ui.render();await ui.load();nodes(ui.render()).find(n=>n.tag==='button'&&n.children.includes('Dispatch load')).props.onClick();
 const tree=nodes(ui.render()),selects=tree.filter(n=>n.tag==='select');
 assert.equal(tree.find(n=>n.tag==='input').props.value,'141 Queen Street Mall');
 assert.equal(selects[1].props.value,'Lennox Ute');assert.equal(selects[2].props.value,'alex');
 assert.deepEqual(nodes(selects[1]).filter(n=>n.tag==='option').map(n=>n.props.value),['Lennox Ute','Lennox Truck']);
 selects[0].props.onChange({target:{value:'powder_coaters'}});assert.equal(nodes(ui.render()).find(n=>n.tag==='input').props.value,'');
 nodes(ui.render()).find(n=>n.tag==='select').props.onChange({target:{value:'site'}});assert.equal(nodes(ui.render()).find(n=>n.tag==='input').props.value,'141 Queen Street Mall');
});
test('mobile dispatch leaves driver blank when the configured default is ineligible',async()=>{
 const load={...base,ready:true};const ui=view([],null,'active',{loads:[load],dispatchVehicles:['Lennox Truck'],dispatchDrivers:[],dispatchDefaultDriver:'inactive'});
 ui.render();await ui.load();nodes(ui.render()).find(n=>n.tag==='button'&&n.children.includes('Dispatch load')).props.onClick();
 assert.equal(nodes(ui.render()).filter(n=>n.tag==='select')[2].props.value,'');
});
