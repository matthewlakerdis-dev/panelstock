import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const source=read('panelstock-app.modern.js');
const tabs=source.slice(source.indexOf('  var TABS = ['),source.indexOf('  // Compact router'));
const icons=Object.fromEntries([...tabs.matchAll(/icon:\s*(\w+)/g)].map(m=>[m[1],()=>{}]));
const start=source.indexOf('    const visibleTabs='),nav=source.slice(start,source.indexOf('\n\n',start));
function navigation(isAdmin,taskAccess){
 const context={...icons,isAdmin,taskAccess};
 vm.runInNewContext(tabs+nav+'globalThis.result={more:moreTabs,primary:primaryTabs};',context);
 return JSON.parse(JSON.stringify(context.result));
}
test('toolbox shortcut is restricted to administrators and explicitly permitted supervisors',()=>{
 assert.equal(navigation(false,{}).more.some(t=>t.id==='toolbox'),false);
 assert.equal(navigation(false,{'factory.toolbox':false,'factory.stock':true}).more.some(t=>t.id==='toolbox'),false);
 assert.equal(navigation(false,{'factory.toolbox':true}).more.filter(t=>t.id==='toolbox').length,1);
 assert.equal(navigation(true,{}).more.filter(t=>t.id==='toolbox').length,1);
 assert.equal(navigation(true,{}).primary.some(t=>t.id==='toolbox'),false);
});
test('the toolbox shortcut opens the existing Worker without carrying session credentials',()=>{
 const section=source.slice(source.indexOf('  function MoreTab('),source.indexOf('  function BottomNav('));
 const jsx=(type,props)=>({type,props}),selected=[],worker='https://panelstock-reports.matthewlakerdis.workers.dev';
 const context={BAKED_WORKER_URL:worker,Settings2:()=>{},SectionTitle:()=>{},ChevronRight:()=>{},import_jsx_runtime:{jsx,jsxs:jsx}};
 vm.runInNewContext(section+'globalThis.render=MoreTab;',context);
 const tree=context.render({tabs:[{id:'toolbox',label:'Toolbox Talks',icon:()=>{},external:true},{id:'profile',label:'Profile',icon:()=>{}}],onSelect:id=>selected.push(id)});
 const rows=tree.props.children[1].props.children;
 assert.equal(rows[0].type,'a');assert.equal(rows[0].props.href,worker+'/toolbox');assert.equal(rows[0].props.target,'_blank');assert.equal(rows[0].props.rel,'noopener noreferrer');assert.equal(rows[0].props.onClick,undefined);
 assert.equal(rows[1].type,'button');rows[1].props.onClick();assert.deepEqual(selected,['profile']);
});
test('both loader URLs change so installed clients fetch the updated More menu',()=>{
 assert.match(read('panelstock-app-loader.js'),/panelstock-app\.modern\.js\?v=20261013-toolbox/);
 assert.match(read('index.html'),/panelstock-app-loader\.js\?v=20261013-toolbox/);
});
