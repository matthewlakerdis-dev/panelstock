import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop} from '../src/workshop-stock.js';
const actor={username:'admin',isAdmin:true},empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const create=(s,name,sku)=>applyWorkshop(s,{action:'create',item:{name,sku,category:'fixings',unit:'each',qty:5,dimensions:name}},actor).next;
test('missing and whitespace codes are optional and never merge independent items',()=>{
 let s=create(empty(),'First');s=create(s,'Second','  ');s=create(s,'Third','');
 assert.equal(s.items.length,3);assert.ok(s.items.every(i=>i.sku===''));assert.deepEqual(s.items.map(i=>i.name),['First','Second','Third']);
 assert.equal(s.movements[0].sku,'Third');
 s=applyWorkshop(s,{action:'metadata',itemId:s.items[0].id,dimensions:'Updated'},actor).next;
 assert.deepEqual(s.items.map(i=>i.dimensions),['Updated','Second','Third']);
 s=applyWorkshop(s,{action:'bulk_metadata',itemIds:[s.items[0].id],changes:{category:'steel'}},actor).next;assert.equal(s.items[0].category,'steel');assert.equal(s.items[1].category,'fixings');
 assert.throws(()=>create(s,'  ',''),/Name is required/);
});
test('coded items retain duplicate validation and shared profile behaviour',()=>{
 let s=create(empty(),'Profile','CODE');assert.throws(()=>create(s,'Duplicate',' code '),/already exists/);
 s=applyWorkshop(s,{action:'create',item:{name:'Variant',sku:'code',colour:'Black',category:'fixings',unit:'each',qty:0}},actor).next;
 assert.equal(s.items[1].name,'Profile');
});
