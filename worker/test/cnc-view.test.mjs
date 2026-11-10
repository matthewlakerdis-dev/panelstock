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
 assert.doesNotMatch(html,/innerHTML|method:\s*['"]POST|Print offcut labels|offcutLabelCounts|\/cnc-tracker\/offcut-labels/);
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

test('shared tracker preserves sheet groups and status filters without label printing',()=>{
 const view=viewHarness();
 const panels=[{id:'a',jobReference:'Job A',orderNumber:'0007',sheetNumber:'1',panelNumber:'A',status:'pending'},{id:'b',jobReference:'job A',orderNumber:'0007',sheetNumber:'1',panelNumber:'B-marker',status:'completed'},{id:'c',jobReference:'Job A',orderNumber:'0007',sheetNumber:'01',panelNumber:'C',status:'pending'},{id:'other',jobReference:'Job B',orderNumber:'0007',sheetNumber:'1',panelNumber:'A',status:'pending'}];
 vm.runInContext('panels='+JSON.stringify(panels)+';',view.context);
 view.nodes.get('search').value='B-marker';vm.runInContext('render()',view.context);
 assert.equal(view.all().filter(node=>node.tag==='a').length,0);
 assert.equal(view.all().filter(node=>node.className==='sheet-heading').length,1);
 assert.ok(view.all().some(node=>node.textContent==='Panel B-marker'));
 view.nodes.get('search').value='';vm.runInContext("status.value='pending';render()",view.context);
 assert.equal(view.all().filter(node=>node.tag==='a').length,0);
 assert.equal(view.all().filter(node=>node.className==='sheet-heading').length,3);
 assert.ok(view.all().some(node=>node.textContent==='Sheet 01'));
 assert.equal(view.all().some(node=>node.textContent==='Panel B-marker'),false);
});
