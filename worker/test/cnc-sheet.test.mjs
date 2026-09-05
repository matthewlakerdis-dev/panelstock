import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
const handler=html.slice(html.indexOf('    function completeCncSheet('),html.indexOf('    function removeCncPanel('));
assert.ok(!handler.includes('window.confirm'));
test('CNC reservations count each pending sheet once and ignore completed sheets',()=>{
  const source=html.slice(html.indexOf('  function cncReservedSheets('),html.indexOf('  function StockTab('));
  const reserve=vm.runInNewContext(source+';cncReservedSheets');
  const base={jobReference:'Project',orderNumber:'3',stockItemType:'variant',stockItemId:'stock-1',status:'pending'};
  const counts=reserve([
    {...base,sheetNumber:'1',panelNumber:'A'},
    {...base,sheetNumber:'1',panelNumber:'B'},
    {...base,sheetNumber:'2',panelNumber:'C'},
    {...base,sheetNumber:'3',panelNumber:'D',status:'completed'},
    {...base,sheetNumber:'4',panelNumber:'E',stockItemType:'offcut',stockItemId:'offcut-1'}
  ]);
  assert.equal(counts.get('variant:stock-1'),2);
  assert.equal(counts.get('offcut:offcut-1'),1);
});
test('CNC scheduling cannot reserve more sheets than current stock',()=>{
  const duplicateSource=html.slice(html.indexOf('function normalizeCncInput('),html.indexOf('function compareCncOrders('));
  const reserveSource=html.slice(html.indexOf('  function cncReservedSheets('),html.indexOf('  function StockTab('));
  const validationSource=html.slice(html.indexOf('    function validateCncSchedule('),html.indexOf('    function addCncPanel('));
  const base={jobReference:'Project',orderNumber:'3',stockItemType:'variant',stockItemId:'stock-1',status:'pending'};
  const cncPanels=[{...base,sheetNumber:'1',panelNumber:'A'},{...base,sheetNumber:'1',panelNumber:'B'}];
  const context={cncPanels,variants:[{id:'stock-1',qty:1,color:'White',material:'ACM'}],offcuts:[]};
  const validate=vm.runInNewContext(duplicateSource+reserveSource+validationSource+';validateCncSchedule',context);
  assert.match(validate([{...base,sheetNumber:'2'}]),/0 unreserved sheets available/);
  assert.equal(validate([{...base,sheetNumber:'1',panelNumber:'C'}]),'');
  context.variants[0].qty=2;
  assert.equal(validate([{...base,sheetNumber:'2',panelNumber:'C'},{...base,sheetNumber:'2',panelNumber:'D'}]),'');
  assert.match(validate([{...base,sheetNumber:'2'},{...base,sheetNumber:'3'}]),/1 unreserved sheet available/);
});
function run(accept=true,panels,confirmedOffcut=null) {
  const base={orderNumber:'ORDER-A',sheetNumber:'1',status:'pending',stockVariantId:'stock-1',stockSku:'SKU-1'};
  const cncPanels=panels??[
    {...base,id:'a',panelNumber:'1'}, {...base,id:'b',panelNumber:'2'},
    {...base,id:'done',status:'completed',completedBy:'earlier-worker',completedAt:'2026-01-01'},
    {...base,id:'other-order',orderNumber:'ORDER-B'}, {...base,id:'other-sheet',sheetNumber:'2'},
    {...base,id:'leading-zero',sheetNumber:'01'}
  ];
  const variants=[{id:'stock-1',sku:'SKU-1',qty:3,color:'White',material:'ACM',thickness:4,width:4000,height:1500}],offcuts=[],transactions=[];
  const result={writes:[],logs:[],prompts:[],before:JSON.stringify(cncPanels)};let id=0;
  vm.runInNewContext(handler+';completeCncSheet("ORDER-A","1",'+JSON.stringify(confirmedOffcut)+');',{
    cncPanels,username:'worker',window:{confirm:message=>{result.prompts.push(message);return accept;}},
    variants,offcuts,transactions,uid:()=>`new-${++id}`,genSku:()=>`OFF-${id+1}`,fmtDim:(w,h)=>`${w} × ${h}`,setCncPanels:next=>result.next=next,setVariants:next=>result.nextVariants=next,setOffcuts:next=>result.nextOffcuts=next,setTransactions:next=>result.nextTransactions=next,persist:next=>result.writes.push(next),logTxn:tx=>result.logs.push(tx),showToast:()=>{}
  });
  assert.equal(JSON.stringify(cncPanels),result.before,'original snapshot remains unchanged');
  return result;
}
test('complete sheet updates all pending panels in exactly that order/sheet in one batch',()=>{
  const r=run();
  assert.equal(r.writes.length,1);
  assert.equal(r.logs.length,0);
  assert.equal(r.prompts.length,0);
  assert.equal(r.next[0].status,'completed');assert.equal(r.next[1].status,'completed');
  assert.equal(r.next[0].completedBy,'worker');assert.equal(r.next[0].completedAt,r.next[1].completedAt);
  assert.equal(r.next[2].completedBy,'earlier-worker');assert.equal(r.next[2].completedAt,'2026-01-01');
  for(const p of r.next.slice(3))assert.equal(p.status,'pending');
  assert.equal(r.nextVariants[0].qty,2);
  assert.equal(r.nextTransactions[0].type,'dispatch');assert.equal(r.nextTransactions[0].source,'cnc');assert.equal(r.nextTransactions[0].qty,1);
  assert.equal(r.nextTransactions[0].orderNumber,'ORDER-A');assert.deepEqual(Array.from(r.nextTransactions[0].panelIds),['1','2']);
  assert.match(r.nextTransactions[0].desc,/Order ORDER-A · Panel IDs 1, 2/);
  assert.match(r.nextTransactions[1].desc,/2 panels/);
  assert.deepEqual(Object.keys(r.writes[0]),['cncPanels','variants','offcuts','transactions']);
});
test('confirmed CNC off-cut is added to SOH with source traceability',()=>{
  const r=run(true,undefined,{confirmed:true,length:2065,width:1500,note:'Rack A'});
  assert.equal(r.nextOffcuts.length,1);assert.equal(r.nextOffcuts[0].width,2065);assert.equal(r.nextOffcuts[0].height,1500);
  assert.equal(r.nextOffcuts[0].sourceOrderNumber,'ORDER-A');assert.equal(r.nextOffcuts[0].sourceSheetNumber,'1');
  assert.equal(r.nextTransactions[0].type,'offcut_add');assert.equal(r.nextTransactions[1].type,'dispatch');
  assert.equal(r.next[0].offcutOutcome,'confirmed');
  assert.deepEqual(JSON.parse(JSON.stringify(r.next[0].offcutDetails)),{length:2065,width:1500,color:'White',material:'ACM',thickness:4});
});
test('an already completed sheet makes no changes',()=>{

  const r=run(true,[]);assert.equal(r.writes.length,0);assert.equal(r.prompts.length,0);
});

test('sheet dialog cancels without completing and requires its confirm button',()=>{
  const source=html.slice(html.indexOf('  function CncSheetDialog('),html.indexOf('  function Cnc',html.indexOf('  function CncSheetDialog(')+10));
  let closed=0,confirmed=0;
  const context={useRef:()=>({current:null}),useEffect:()=>{},import_react:{useState:value=>[value,()=>{}]},import_jsx_runtime:{jsx:(type,props)=>({type,...props})}};
  const render=vm.runInNewContext(source+';CncSheetDialog',context);
  const tree=render({sheet:{orderNumber:'ORDER-A',sheetNumber:'1'},affectedPanels:[{id:'a',panelNumber:'a73-219'},{id:'b',panelNumber:'B73-220'}],onClose:()=>closed++,onConfirm:()=>confirmed++});
  function flatten(node){return node && typeof node==='object'?[node,...[node.children].flat().flatMap(flatten)]:[];}
  const nodes=flatten(tree),dialog=nodes.find(n=>n.role==='dialog');
  assert.equal(dialog['aria-modal'],true);
  assert.deepEqual(nodes.filter(n=>n.type==='li').map(n=>n.children),['A73-219','B73-220']);
  const cancel=nodes.find(n=>n.type==='button' && n.children==='Cancel');
  const confirm=nodes.find(n=>n.type==='button' && n.children==='Complete sheet');
  cancel.onClick();assert.equal(closed,1);assert.equal(confirmed,0);
  dialog.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(closed,2);assert.equal(confirmed,0);
  confirm.onClick();assert.equal(confirmed,1);
  assert.ok(nodes.some(n=>typeof n.children==='string' && n.children.includes('all 2 pending panels')));
  const empty=flatten(render({sheet:{orderNumber:'ORDER-A',sheetNumber:'1'},affectedPanels:[],onClose(){},onConfirm(){}}));
  assert.equal(empty.find(n=>n.type==='button' && n.children==='Complete sheet').disabled,true);
});
test('orders group exactly and retain their expansion state across refreshed data',()=>{
 const start=html.indexOf('  function CncOrderGroups('),end=html.indexOf('\n  function ',start+5);
 let state=new Map();
 const context={useState:()=>[state,fn=>state=fn(state)],CncSheetGroups:({panels,renderGroup})=>renderGroup(panels),import_jsx_runtime:{jsx:(type,props,key)=>({type,...props,key})}};
 const render=vm.runInNewContext(html.slice(html.indexOf('function compareCncOrders('),html.indexOf('  function CncJobGroups('))+html.slice(start,end)+';CncOrderGroups',context);
 const rows=[{id:'1',orderNumber:'20',status:'pending'},{id:'2',orderNumber:'20',status:'completed'},{id:'3',orderNumber:'10',status:'pending'}];
 const props={panels:rows,allPanels:rows,query:'',renderGroup:group=>group};
 let tree=render(props);assert.equal(tree.children.length,2);assert.equal(tree.children[0].children[0]['aria-expanded'],false);
 tree.children[0].children[0].onClick();tree=render({...props,panels:rows.map(p=>({...p}))});
 assert.equal(tree.children[0].children[0]['aria-expanded'],true);assert.equal(tree.children[0].children[1].children.panels.length,2);
 assert.equal(tree.children[1].children[0]['aria-expanded'],false);
 tree=render({...props,query:'A',panels:rows.slice(0,2)});assert.equal(tree.children.length,1);assert.equal(tree.children[0].children[0]['aria-expanded'],true);
});
test('job references are collapsible and separate the same order across different jobs',()=>{
 const start=html.indexOf('  function CncJobGroups('),end=html.indexOf('\n  function ',start+5);
 const normStart=html.indexOf('function normalizeCncInput('),normEnd=html.indexOf('  function CncJobGroups(',normStart);
 let state=new Map();
 const context={useState:()=>[state,fn=>state=fn(state)],CncOrderGroups:()=>{},import_jsx_runtime:{jsx:(type,props,key)=>({type,...props,key})}};
 const render=vm.runInNewContext(html.slice(normStart,normEnd)+html.slice(start,end)+';CncJobGroups',context);
 const panels=[{orderNumber:'1',jobReference:'JOB a',status:'pending'},{orderNumber:'1',jobReference:'job A',status:'completed'},{orderNumber:'1',jobReference:'JOB B',status:'pending'},{orderNumber:'2',jobReference:'',status:'pending'}];
 const props={panels,allPanels:panels,query:'',renderGroup:rows=>rows};
 let tree=render(props);assert.equal(tree.children.length,3);assert.equal(tree.children[0].children[0].children[0].children,'Job A');
 assert.equal(tree.children[2].children[0].children[0].children,'No job reference');
 assert.equal(tree.children[0].children[1].hidden,true);
 tree.children[0].children[0].onClick();tree=render(props);assert.equal(tree.children[0].children[1].hidden,false);
 assert.equal(tree.children[0].children[1].children.allPanels.length,2);
 assert.equal(tree.children[1].children[1].hidden,true);
});
test('single panel dialog requires confirmation and disables it when no longer pending',()=>{
 const start=html.indexOf('  function CncSheetDialog(');
 const source=html.slice(start,html.indexOf('  function Cnc',start+10));
 const render=vm.runInNewContext(source+';CncSheetDialog',{useRef:()=>({current:null}),useEffect:()=>{},import_react:{useState:value=>[value,()=>{}]},import_jsx_runtime:{jsx:(type,props)=>({type,...props})}});
 let cancelled=0,confirmed=0;
 const props={sheet:{orderNumber:'0007',sheetNumber:'1',panelId:'a'},affectedPanels:[{id:'a',panelNumber:'a73-219'}],onClose:()=>cancelled++,onConfirm:()=>confirmed++};
 const flatten=node=>node&&typeof node==='object'?[node,...[node.children].flat().flatMap(flatten)]:[];
 const nodes=flatten(render(props));
 assert.ok(nodes.some(n=>n.children==='Complete CNC panel?'));
 assert.ok(nodes.some(n=>n.children==='Order 0007'));
 assert.deepEqual(nodes.filter(n=>n.type==='li').map(n=>n.children),['A73-219']);
 assert.equal(confirmed,0);
 nodes.find(n=>n.type==='button'&&n.children==='Cancel').onClick();
 assert.equal(cancelled,1);assert.equal(confirmed,0);
 nodes.find(n=>n.role==='dialog').onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});
 assert.equal(cancelled,2);assert.equal(confirmed,0);
 nodes.find(n=>n.type==='button'&&n.children==='Complete panel').onClick();assert.equal(confirmed,1);
 const stale=flatten(render({...props,affectedPanels:[]}));
 assert.equal(stale.find(n=>n.type==='button'&&n.children==='Complete panel').disabled,true);
});
test('single completion changes only selected pending panel and ignores stale completion',()=>{
 const source=html.slice(html.indexOf('    function completeCncPanel('),html.indexOf('    function completeCncSheet('));
 const panels=[{id:'a',status:'pending',orderNumber:'7',sheetNumber:'1',panelNumber:'A1'},{id:'b',status:'pending',orderNumber:'7',sheetNumber:'1',panelNumber:'A2'}];
 let current=panels,writes=0,logs=0;
 const run=id=>vm.runInNewContext(source+';completeCncPanel('+JSON.stringify(id)+');',{cncPanels:current,username:'worker',setCncPanels:next=>current=next,persist:()=>writes++,logTxn:()=>logs++,showToast(){}});
 run('a');assert.equal(current[0].status,'completed');assert.equal(current[1],panels[1]);assert.equal(writes,1);assert.equal(logs,1);
 const stamp=current[0].completedAt;
 run('a');run('missing');assert.equal(writes,1);assert.equal(logs,1);assert.equal(current[0].completedAt,stamp);
});
