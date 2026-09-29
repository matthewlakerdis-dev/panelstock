import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {projectIndex} from '../src/cad-history.js';
import {cadDrawingSummary,orderDrawingProgress} from '../src/order-drawing-progress.js';
const panel=()=>({spec:{panelId:'P1',width:100},generatedSpec:JSON.stringify({panelId:'P1',width:100}),result:{size:12,chunks:[]},reviewed:true,drawingReadiness:{version:1,ready:true}});
const project=(panels=[panel()])=>({projectDetails:{projectId:'project-a',projectName:'Project A',orderNumber:'7'},panels});
const indexed=data=>({revision:1,drawingProgress:cadDrawingSummary(data)});
const order={projectId:'project-a',project:'Project A',orderNumber:'7'};
test('all highlighted panels must be ready, with at least one panel',()=>{
 assert.equal(cadDrawingSummary(project()).drawn,true);
 assert.equal(cadDrawingSummary(project([])).drawn,false);
 assert.equal(cadDrawingSummary(project([panel(),{}])).drawn,false);
 assert.equal(cadDrawingSummary(project([panel(),panel()])).ready,2);
});
test('changed, failed, unreviewed, recovered and old drawings are not complete',()=>{
 for(const change of [p=>p.spec.width++,p=>p.result=null,p=>p.reviewed=false,p=>p.correctionRecovery={},p=>delete p.drawingReadiness,p=>p.drawingReadiness.ready=false,p=>delete p.generatedSpec]){
  const p=panel();change(p);assert.equal(cadDrawingSummary(project([p])).drawn,false);
 }
});
test('order matching uses structured project and order identities, not drawing names',()=>{
 assert.equal(orderDrawingProgress(order,[indexed(project())]).drawn,true);
 assert.equal(orderDrawingProgress({...order,projectId:'other'},[indexed(project())]).drawn,false);
 assert.equal(orderDrawingProgress({...order,orderNumber:'8'},[indexed(project())]).drawn,false);
 assert.equal(orderDrawingProgress({...order,project:'Renamed'},[indexed(project())]).drawn,true);
 const legacy=project();delete legacy.projectDetails.projectId;legacy.projectDetails.projectName=' PROJECT   A ';
 assert.equal(orderDrawingProgress(order,[indexed(legacy)]).drawn,true);
 delete legacy.projectDetails;legacy.name='Project A - Order 7';
 assert.equal(orderDrawingProgress(order,[indexed(legacy)]).drawn,false);
});
test('uncommitted projects never count and all active matching copies must be ready',()=>{
 assert.equal(orderDrawingProgress(order,[{...indexed(project()),revision:0}]).drawn,false);
 assert.equal(orderDrawingProgress(order,[indexed(project()),indexed(project([{}]))]).drawn,false);
 assert.equal(orderDrawingProgress(order,[]).drawn,false);
 assert.deepEqual(Object.keys(orderDrawingProgress(order,[indexed(project())])).sort(),['drawn','ready','total']);
});
test('order responses include older matching drafts without exposing private CAD data',()=>{
 const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
 const method=source.slice(source.indexOf('  ordersWithDrawingProgress() {'),source.indexOf('  readPublicCncSettings()'));
 const context={orderDrawingProgress,projectIndex};vm.runInNewContext('reader={'+method+'}',context);
 const draft=project([{}]),ready=indexed(project());
 const docs=new Map([['orders',[order]],['cad-projects:a:index',[{...ready,projectId:'ready'}, {projectId:'old',revision:1}]],['cad-projects:a:old',{revision:1,manifest:{project:draft}}]]);
 const store={read:(key,fallback)=>docs.get(key)||fallback,sql:{exec:()=>({toArray:()=>[{key:'cad-projects:a:index'}]})}};
 const [result]=context.reader.ordersWithDrawingProgress.call(store);
 assert.equal(result.drawingProgress.drawn,false);assert.equal(result.drawingProgress.total,2);
 assert.equal(result.panels,undefined);assert.equal(result.manifest,undefined);assert.equal(order.drawingProgress,undefined);
 docs.get('cad-projects:a:old').deleted=true;
 assert.equal(context.reader.ordersWithDrawingProgress.call(store)[0].drawingProgress.drawn,true);
});
