import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeCncInput,compareCncOrders} from '../src/cnc-input.js';
import {normalizeChanges} from '../src/inventory.js';
test('CNC imports title-case words and strip order labels without losing leading zeros',()=>{
 for(const value of ['Order #001234','ORDER: 001234','order001234','001234 order'])assert.equal(normalizeCncInput({orderNumber:value}).orderNumber,'001234');
 assert.equal(normalizeCncInput({orderNumber:' WO-1042 '}).orderNumber,'WO-1042');
 assert.equal(normalizeCncInput({orderNumber:'reorder-12'}).orderNumber,'reorder-12');
 assert.equal(normalizeCncInput({jobReference:'  mERIDIAN   CONSTRUCTIONS north-EAST '}).jobReference,'Meridian Constructions North-East');
 assert.equal(normalizeCncInput({jobReference:'ÉCOLE façade'}).jobReference,'École Façade');
 const once=normalizeCncInput({orderNumber:'Order 0001',jobReference:'A JOB'});assert.deepEqual(normalizeCncInput(once),once);
});
test('server normalizes new panels and rejects order labels with no numbers',()=>{
 const after={id:'cnc1',orderNumber:'ORDER 0012',jobReference:'UPPER CASE',sheetNumber:'1',panelNumber:'1',status:'pending'};
 const change={field:'cncPanels',id:'cnc1',before:null,after};
 const normalized=normalizeChanges([change],{username:'admin',isAdmin:true},'2026-08-31T00:00:00Z')[0].after;
 assert.equal(normalized.orderNumber,'0012');assert.equal(normalized.jobReference,'Upper Case');
 assert.equal(after.orderNumber,'ORDER 0012');
 assert.throws(()=>normalizeChanges([{...change,after:{...after,orderNumber:'Order'}}],{username:'admin'},'now'),/CNC reference required/);
 const existing=normalizeChanges([{...change,before:after,after:{...after,status:'completed'}}],{username:'staff'},'now')[0].after;
 assert.equal(existing.orderNumber,'ORDER 0012');assert.equal(existing.jobReference,'UPPER CASE');
});
test('mobile upload cleanup uses the same normalization as the server',()=>{
 const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
 assert.ok(html.includes(normalizeCncInput.toString()));
 assert.ok(html.includes('rows = rows.map(normalizeCncInput)'));
 assert.ok(html.includes('const cleaned = normalizeCncInput(form)'));
});

test('panel identifiers capitalize only a leading letter and preserve numeric IDs',()=>{
 for(const [input,expected] of [['a73-219','A73-219'],['bAb12','BAb12'],['0073-219','0073-219'],[' é007 ','É007'],['A12','A12']])assert.equal(normalizeCncInput({panelNumber:input}).panelNumber,expected);
});
test('orders sort numerically descending, including prefixes and large identifiers',()=>{
 assert.deepEqual(['9','100','20','0007'].sort(compareCncOrders),['100','20','9','0007']);
 assert.deepEqual(['WO-9','WO-100','WO-20'].sort(compareCncOrders),['WO-100','WO-20','WO-9']);
 assert.deepEqual(['9007199254740992','9007199254740993'].sort(compareCncOrders),['9007199254740993','9007199254740992']);
 assert.deepEqual(['ABC','2','10'].sort(compareCncOrders),['10','2','ABC']);
});
