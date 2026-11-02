import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8'),start=source.indexOf('  let orderTypeEditor='),end=source.indexOf('  let deliveryEditor=',start);
function fixture(){
 const handlers={},calls=[],type={value:'Other'},other={value:'Safety equipment'},form={querySelector:selector=>selector==='[name=correctOrderType]'?type:other,addEventListener:(key,fn)=>handlers[key]=fn};let renders=0;
 const order={id:'order-one',orderType:'Panels',status:'submitted',updatedAt:'version-one',requestedBy:'leading-hand',items:[{quantity:2,description:'BOLTS'}]};
 const context={session:{username:'admin',isAdmin:true},sessionVersion:1,orders:[order],orderTypes:['Panels','Fixings','Other','Gate'],isPanelOrder:order=>order.orderType==='Panels',esc:value=>String(value||''),orderStatusLabel:value=>value,root:{querySelector:selector=>selector==='[data-order-type-correction]'?form:null,querySelectorAll:()=>[]},render:()=>{renders++;},view:'orders',selectedOrderId:'',productionState:{},message:'',api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return Response.json({ok:true,order:{...order,orderType:'Other',orderTypeOther:'Safety equipment',updatedAt:'version-two'}});}};
 vm.runInNewContext(source.slice(start,end)+`globalThis.editor={save:saveOrderTypeCorrection,wire:wireOrderTypeCorrection,html:orderTypeCorrectionView,allowed:canCorrectOrderType,draft:()=>orderTypeEditor,setDraft:()=>{orderTypeEditor={id:'order-one',owner:session.username,expectedUpdatedAt:'version-one',type:'Other',other:'',error:'',conflict:null};}};`,context);context.editor.setDraft();return {context,ui:context.editor,handlers,calls,type,other,form,order,renders:()=>renders};
}
test('changing the optional text captures it without rerendering away the pending save click',()=>{
 const f=fixture();f.ui.wire();f.handlers.change({target:{name:'correctOrderTypeOther'}});assert.equal(f.renders(),0);assert.equal(f.ui.draft().other,'Safety equipment');f.handlers.change({target:{name:'correctOrderType'}});assert.equal(f.renders(),1);
});
test('the Site correction submits only the selected type and revision, then refreshes the order',async()=>{
 const f=fixture();await f.ui.save({preventDefault(){}});assert.deepEqual(f.calls,[{path:'/orders/order-one/type',body:{orderType:'Other',orderTypeOther:'Safety equipment',expectedUpdatedAt:'version-one'}}]);assert.equal(f.ui.draft(),null);assert.equal(f.context.orders[0].orderType,'Other');assert.equal(f.context.orders[0].status,'submitted');assert.equal(f.context.orders[0].requestedBy,'leading-hand');
});
test('conflicts and network failures retain the selection and require explicit review',async()=>{
 const f=fixture();f.context.api=async()=>Response.json({ok:false,code:'ORDER_CONFLICT',order:{...f.order,updatedAt:'new'}},{status:409});await f.ui.save({preventDefault(){}});assert.equal(f.ui.draft().type,'Other');assert.equal(f.ui.draft().other,'Safety equipment');assert.equal(f.ui.draft().conflict.updatedAt,'new');assert.match(f.ui.html(f.order),/Reload latest order/);assert.equal(f.context.orders[0].orderType,'Panels');
 const g=fixture();g.context.api=async()=>{throw Error('Connection lost');};await g.ui.save({preventDefault(){}});assert.equal(g.ui.draft().other,'Safety equipment');assert.equal(g.ui.draft().error,'Connection lost');assert.equal(g.context.orders[0].orderType,'Panels');
});
test('a delayed response cannot change another account, and in-flight duplicate submits are ignored',async()=>{
 const f=fixture();let finish;f.context.api=async(path,options)=>{f.calls.push({path,body:JSON.parse(options.body)});return new Promise(resolve=>finish=resolve);};const pending=f.ui.save({preventDefault(){}});await f.ui.save({preventDefault(){}});assert.equal(f.calls.length,1);f.context.session={username:'other',isAdmin:true};f.context.sessionVersion++;f.ui.setDraft();finish(Response.json({ok:true,order:{...f.order,orderType:'Fixings'}}));await pending;assert.equal(f.ui.draft().owner,'other');assert.equal(f.context.orders[0].orderType,'Panels');assert.equal(f.context.message,'');
});
test('only administrators see correction controls for active saved Panel orders',()=>{
 const f=fixture();assert.equal(f.ui.allowed(f.order),true);for(const patch of [{status:'completed'},{status:'dispatched'},{status:'cancelled'},{orderType:'Gate'},{local:true}])assert.equal(f.ui.allowed({...f.order,...patch}),false);f.context.session.isAdmin=false;assert.equal(f.ui.allowed(f.order),false);assert.equal(f.ui.html(f.order),'');
});
