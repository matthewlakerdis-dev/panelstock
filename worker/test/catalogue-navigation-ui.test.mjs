import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const name='SettingsTab',start=source.indexOf('  function '+name+'('),end=source.indexOf('  var container',start);
const componentSource=source.slice(start,end);
const flatten=node=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.children),...flatten(node.action)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.children):node==null||node===false?'':String(node);
function harness(props={}){
 let states=[],cursor=0,nodes,properties={isAdmin:true,reasons:[],catalog:[],username:'admin',workerUrl:'https://configured.example',...props};
 const jsx=(tag,properties,key)=>({tag,...properties,key}),context={import_jsx_runtime:{jsx,jsxs:jsx},BAKED_WORKER_URL:'https://baked.example',PanelStock:{revision:17},
  useState:initial=>{const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useEffect(){},
  WorkshopStock:'material-catalogue',StocktakeSettings:'stocktake-settings',PageHeading:'page-heading',SectionTitle:'section-title',Settings2:'settings-icon',NotificationPreferences:'notifications',PushNotificationControl:'push',EmailReportsAdmin:'email-reports',CatalogAdmin:'panel-catalogue',FileSpreadsheet:'excel',Printer:'printer',AlertTriangle:'warning',ChevronRight:'chevron',ClipboardList:'clipboard',CapitalizedInput:'capitalized',Trash2:'trash',Plus:'plus',BackupRestore:'backup',StocktakeReset:'reset',FullReset:'full-reset',QaSettingsPage:'qa-settings',ScheduleSettingsPanel:'schedule-settings',Mail:'mail',Save:'save'};
 vm.runInNewContext(componentSource,context);
 const render=next=>{properties={...properties,...next};cursor=0;nodes=flatten(context[name](properties));return nodes;};
 const button=label=>nodes.find(node=>node.tag==='button'&&text(node).trim().startsWith(label));
 render();return {render,button,nodes:()=>nodes,catalogue:()=>nodes.find(node=>node.tag==='material-catalogue')};
}
test('mobile Settings opens a separate material catalogue and returns without replacing panel definitions',()=>{
 const h=harness();assert.ok(h.nodes().some(n=>n.tag==='panel-catalogue'));assert.ok(h.button('Material Catalogue'));
 h.button('Material Catalogue').onClick();h.render();
 assert.equal(h.catalogue().catalogueOnly,true);assert.equal(h.catalogue().workerUrl,'https://configured.example');assert.equal(h.catalogue().isAdmin,true);assert.equal(h.catalogue().stockRevision,17);
 assert.ok(!h.nodes().some(n=>n.tag==='panel-catalogue'));
 h.button('Back to settings').onClick();h.render();assert.equal(h.catalogue(),undefined);assert.ok(h.nodes().some(n=>n.tag==='panel-catalogue'));
});
test('mobile material catalogue stays unavailable after administrator access is removed',()=>{
 const h=harness();h.button('Material Catalogue').onClick();h.render();assert.ok(h.catalogue());
 h.render({isAdmin:false});assert.equal(h.catalogue(),undefined);assert.equal(h.button('Material Catalogue'),undefined);
});
test('mobile material catalogue falls back to the baked API while preserving the panel catalogue store',()=>{
 const h=harness({workerUrl:''});h.button('Material Catalogue').onClick();h.render();assert.equal(h.catalogue().workerUrl,'https://baked.example');
 assert.match(source,/children: "Panel Catalogue"/);assert.match(source,/PanelStock \\u2014 Panel Catalogue/);assert.match(source,/catalog: "panelstock:catalog"/);
});
