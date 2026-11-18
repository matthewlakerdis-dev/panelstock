import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as acorn from 'acorn';
import shipping from '../../order-dispatch-progress.js';
import {decorateDispatchProgress} from '../src/order-dispatch-progress.js';
import {buildSiteOrderRows} from '../src/site-orders-excel.js';
const base=()=>({id:'25',orderNumber:'25',project:'Notre Dame',projectId:'p1',orderType:'Consumables',status:'completed',updatedAt:'v1',items:[{quantity:1,description:'WHITE SILICON'},{quantity:3,description:'GRAY SIKAFLEX'},{quantity:4,description:'DRILL BITS'},{quantity:10,description:'TOP HAT'}],dispatches:[{mutationId:'first',lines:[{index:0,quantity:1},{index:1,quantity:2}]}]});
test('partial deliveries label exactly the shipped lines and keep original quantities and production status',()=>{
 const order=base(),before=JSON.stringify(order),result=shipping.progress(order);
 assert.equal(result.status,'part_dispatched');assert.equal(result.statusLabel,'Part dispatched');
 assert.deepEqual(result.items.map(i=>[i.quantity,i.dispatched,i.remaining,i.status]),[[1,1,0,'dispatched'],[3,2,1,'part_dispatched'],[4,0,4,'not_dispatched'],[10,0,10,'not_dispatched']]);
 assert.equal(shipping.itemText(result.items[0]),'Dispatched');assert.equal(shipping.itemText(result.items[1]),'2 dispatched · 1 remaining');assert.equal(JSON.stringify(order),before);
 const decorated=decorateDispatchProgress(order);assert.equal(decorated.status,'completed');assert.equal(decorated.dispatchProgress.statusLabel,'Part dispatched');assert.deepEqual(shipping.get(decorated),result);
 const changed={...decorated,status:'dispatched',updatedAt:'v2'};assert.equal(shipping.get({...decorated,dispatches:[]}).hasDispatched,false);assert.equal(shipping.get(changed).status,'dispatched');assert.ok(shipping.get(changed).items.every(i=>i.remaining===0));
 const excel=buildSiteOrderRows([order],[],[],[],[])[0];assert.equal(excel.Status,'Part dispatched');assert.ok(Object.keys(excel).indexOf('Status')<Object.keys(excel).indexOf('Drawn'));
});
test('line indices, mutation IDs, decimals and invalid quantities cannot overcount shipping',()=>{
 const order={...base(),items:[{quantity:.3,description:'SAME'},{quantity:2,description:'SAME'}],dispatches:[{mutationId:'one',lines:[{index:0,quantity:.1},{index:1,quantity:1}]},{mutationId:'two',lines:[{index:0,quantity:.2},{index:1,quantity:-5},{index:99,quantity:1},{index:'1',quantity:1}]},{mutationId:'one',lines:[{index:1,quantity:1}]}]};
 const result=shipping.progress(order);assert.deepEqual(result.items.map(i=>[i.dispatched,i.remaining]),[[.3,0],[1,1]]);assert.equal(result.status,'part_dispatched');
 order.dispatches.push({lines:[{index:1,quantity:100}]});assert.equal(shipping.progress(order).items[1].dispatched,2);
});
test('legacy full dispatch and reversed deliveries use current history only; cancellation wins',()=>{
 const order=base();delete order.dispatches;order.status='dispatched';assert.ok(shipping.progress(order).items.every(i=>i.status==='dispatched'&&i.remaining===0));
 order.status='completed';order.dispatchReversals=[{dispatches:base().dispatches}];assert.equal(shipping.progress(order).status,'completed');assert.ok(shipping.progress(order).items.every(i=>i.dispatched===0));
 order.status='cancelled';order.dispatches=base().dispatches;assert.equal(shipping.progress(order).statusLabel,'Cancelled');
});
test('gate component shipping shows actual units without guessing item quantities',()=>{
 const order={...base(),orderType:'Bin Gate',gateComponents:{components:[{id:'gate',set:1,label:'Gate'},{id:'post',set:1,label:'Post'}],shipments:[{id:'trip',componentIds:['gate']}]}},result=shipping.progress(order);
 assert.equal(result.statusLabel,'Part dispatched');assert.equal(result.dispatchedUnits,1);assert.equal(result.remainingUnits,1);assert.equal(result.items[0].dispatched,null);assert.equal(result.items[0].statusLabel,'See component dispatch');
 order.items=[order.items[0]];assert.equal(shipping.progress(order).items[0].statusLabel,'Part dispatched');order.status='dispatched';assert.equal(shipping.progress(order).items[0].remaining,0);
});
test('only site-bound panel loads count, with project-safe matching and no item-description inference',()=>{
 const order={...base(),orderType:'Panels'},panels=[{id:'a',orderNumber:'25',projectId:'p1'},{id:'b',orderNumber:'25',jobReference:'Notre Dame'},{id:'wrong',orderNumber:'25',projectId:'other'}],loads=[{orderNumber:'25',projectId:'p1',panelIds:['a'],status:'dispatched_to_site'},{orderNumber:'25',project:'Notre Dame',panelIds:['b'],status:'at_powder_coaters'},{orderNumber:'25',projectId:'other',panelIds:['wrong'],status:'dispatched_to_site'}];
 const result=shipping.progress(order,{panels,loads});assert.equal(result.status,'part_dispatched');assert.equal(result.totalUnits,2);assert.equal(result.dispatchedUnits,1);assert.equal(result.remainingUnits,1);assert.equal(result.items[0].dispatched,null);
 const enriched=decorateDispatchProgress(order,panels,loads);assert.equal(shipping.get({...enriched,updatedAt:'new',scheduledDeliveryDate:'2026-12-01'}).status,'part_dispatched');
 loads[0].status='waiting';assert.equal(shipping.progress(order,{panels,loads}).status,'completed');
});
test('Site modern and legacy clients run the same ES5 dispatch model',()=>{
 const helper=fs.readFileSync(new URL('../../order-dispatch-progress.js',import.meta.url),'utf8'),modern=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8'),legacy=fs.readFileSync(new URL('../../site/app.legacy.js',import.meta.url),'utf8');
 acorn.parse(helper,{ecmaVersion:5});acorn.parse(legacy,{ecmaVersion:5});assert.equal(modern.split('// BEGIN shared dispatch progress\n')[1].split('// END shared dispatch progress')[0],helper);
 for(const source of [helper,legacy.slice(legacy.indexOf('(function (root, factory)'),legacy.indexOf('// END shared dispatch progress'))]){const context={window:{},_typeof:value=>typeof value};vm.runInNewContext(source,context);assert.equal(context.window.PanelStockOrderDispatch.progress(base()).status,'part_dispatched');}
});
