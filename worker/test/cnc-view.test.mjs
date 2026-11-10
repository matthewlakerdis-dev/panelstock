import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildCncTrackerHtml} from '../src/cnc-tracker.js';
test('shared CNC view renders responsive controls and safely embeds its read-only token',()=>{
 const html=buildCncTrackerHtml('</script><script>bad()</script>');
 assert.ok(!html.includes('<script>bad()'));
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);new vm.Script(scripts[0][1]);
 assert.match(html,/name="viewport"/);assert.match(html,/@media\(max-width:480px\)/);
 assert.match(html,/Expand all/);assert.match(html,/Collapse all/);
 assert.match(html,/type="search"/);assert.match(html,/Read-only live view/);
 assert.doesNotMatch(html,/innerHTML|method:\s*['"]POST/);
});

function viewHarness(){
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.events={};this.value='';this.className='';this.open=false;this.isConnected=true;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,listener){this.events[name]=listener;}
  focus(){}
 }
 const nodes=new Map(),document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);},createElement:tag=>new Node(tag),createElementNS:(_,tag)=>new Node(tag),createDocumentFragment:()=>new Node('fragment')};
 const script=buildCncTrackerHtml('token & <test>').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/refresh\(\);setInterval\(refresh,8000\);/,'');
 const context=vm.createContext({document,URLSearchParams,Map,Set,Date});vm.runInContext(script,context);
 const walk=node=>[node,...node.children.flatMap(walk)];
 return {nodes,context,all:()=>walk(nodes.get('orders'))};
}

test('shared tracker prints full order and sheet scopes while search and status filters hide siblings',()=>{
 const view=viewHarness();
 const panels=[{id:'a',jobReference:'Job A',orderNumber:'0007',sheetNumber:'1',panelNumber:'A',status:'pending'},{id:'b',jobReference:'job A',orderNumber:'0007',sheetNumber:'1',panelNumber:'B-marker',status:'completed'},{id:'c',jobReference:'Job A',orderNumber:'0007',sheetNumber:'01',panelNumber:'C',status:'pending'},{id:'other',jobReference:'Job B',orderNumber:'0007',sheetNumber:'1',panelNumber:'A',status:'pending'}];
 const counts=[{jobReference:'Job A',orderNumber:'0007',sheetNumber:'1',count:2},{jobReference:'Job A',orderNumber:'0007',sheetNumber:'01',count:1}];
 vm.runInContext('panels='+JSON.stringify(panels)+';offcutLabelCounts='+JSON.stringify(counts)+';',view.context);
 view.nodes.get('search').value='B-marker';vm.runInContext('render()',view.context);
 let links=view.all().filter(node=>node.tag==='a');assert.equal(links.length,2);
 const order=links.find(link=>!new URL(link.href,'http://localhost').searchParams.has('sheet'));
 const sheet=links.find(link=>new URL(link.href,'http://localhost').searchParams.has('sheet'));
 assert.equal(order.textContent,'Print offcut labels (3)');assert.equal(sheet.textContent,'Print offcut labels (2)');
 const query=new URL(order.href,'http://localhost').searchParams;assert.equal(query.get('job'),'Job A');assert.equal(query.get('order'),'0007');assert.equal(query.get('token'),'token & <test>');
 assert.equal(sheet.target,'_blank');assert.equal(sheet.rel,'noopener');assert.match(order.title,/hidden by filters/);
 let stopped=0;order.events.click({stopPropagation(){stopped++;}});assert.equal(stopped,1);
 view.nodes.get('search').value='';vm.runInContext("status.value='pending';render()",view.context);
 links=view.all().filter(node=>node.tag==='a');assert.equal(links.length,3);
 assert.ok(links.some(link=>new URL(link.href,'http://localhost').searchParams.get('sheet')==='01'));
 assert.equal(links.filter(link=>link.textContent==='Print offcut labels (2)').length,1);
 assert.equal(view.all().filter(node=>node.className==='sheet-heading').length,3);
});
