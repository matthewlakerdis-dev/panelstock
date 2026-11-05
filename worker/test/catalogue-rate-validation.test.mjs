import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord,validateChanges,normalizeChanges} from '../src/inventory.js';

const admin={username:'admin',isAdmin:true},worker={username:'worker',isAdmin:false};
const now='2026-11-05T00:00:00.000Z';
const catalogue=patch=>({id:'catalogue',sku:'WHITE-ACP',color:'White',material:'ACP',thickness:3,width:0,height:0,...patch});
const change=(field,before,after)=>({field,id:after?.id||before.id,before,after});
const catalogueChange=(rate,before=null)=>change('catalog',before,catalogue({unitCostPerM2:rate}));
const normalize=changes=>normalizeChanges(changes,admin,now);
function transferChanges(cataloguePatch={}){
 const common={color:'Milled',material:'Raw Aluminium',thickness:3};
 const source={id:'source',catalogId:'source-catalogue',sku:'RAW-6000',width:6000,height:1500,qty:2,...common};
 const targetCatalogue={id:'target-catalogue',sku:'RAW-1000',width:1000,height:1500,...common,...cataloguePatch};
 const target={id:'target',catalogId:targetCatalogue.id,sku:targetCatalogue.sku,width:1000,height:1500,qty:1,...common};
 const transaction={id:'conversion',type:'transfer',desc:'Convert one full sheet into a smaller size',qty:1,itemType:'variant',sku:source.sku,sourceSku:source.sku,outputs:[{sku:target.sku,qty:1}],timestamp:now};
 return [change('catalog',null,targetCatalogue),change('variants',source,{...source,qty:1}),change('variants',null,target),change('transactions',null,transaction)];
}

test('catalogue rates are optional and accept valid numeric values including zero and floating cents',()=>{
 const omitted=catalogue();assert.doesNotThrow(()=>validateRecord('catalog',omitted,omitted.id));
 const normalized=normalize([change('catalog',null,omitted)])[0].after;
 assert.equal(Object.hasOwn(normalized,'unitCostPerM2'),false);assert.deepEqual(normalized,omitted);
 for(const [rate,stored] of [[0,0],[0.01,0.01],[0.1+0.2,0.3],[1.15,1.15],[12.34,12.34],[999999999.99,999999999.99],[1e9,1e9]]){
  const input=catalogueChange(rate),before=structuredClone(input);
  assert.doesNotThrow(()=>validateRecord('catalog',input.after,input.id));
  assert.doesNotThrow(()=>validateChanges([input],admin));
  assert.equal(normalize([input])[0].after.unitCostPerM2,stored);assert.deepEqual(input,before);
 }
});

test('blank and null catalogue rates normalize to an explicit clear without mutating input',()=>{
 for(const rate of [null,'','   ','\t\r\n']){
  const input=catalogueChange(rate,catalogue({unitCostPerM2:25})),before=structuredClone(input);
  assert.doesNotThrow(()=>validateRecord('catalog',input.after,input.id));assert.doesNotThrow(()=>validateChanges([input],admin));
  const result=normalize([input])[0];assert.equal(result.after.unitCostPerM2,null);assert.equal(result.before.unitCostPerM2,25);
  assert.deepEqual(input,before);
 }
});

test('catalogue rates reject negative, non-finite, oversized, sub-cent and nonnumeric inputs',()=>{
 for(const rate of [-1,-0.01,1e9+0.01,Infinity,-Infinity,NaN,1.234,0.0000001,1e-20,'0','1.15',' 12.34 ','NaN',true,false,{},[],new Number(1),undefined]){
  const input=catalogueChange(rate),before=structuredClone(input);
  assert.throws(()=>validateRecord('catalog',input.after,input.id),error=>error.status===400);
  assert.throws(()=>validateChanges([input],admin),error=>error.status===400);
  assert.deepEqual(input,before);
 }
});

test('admin catalogue rate creation and edits leave panel quantities and material details unchanged',()=>{
 const panel={id:'panel',catalogId:'catalogue',sku:'SHEET',color:'White',material:'ACP',thickness:3,width:2400,height:1200,qty:7};
 for(const previous of [null,catalogue({unitCostPerM2:10})]){
  const changes=[catalogueChange(45.67,previous),change('variants',panel,{...panel})],before=structuredClone(changes);
  assert.doesNotThrow(()=>validateChanges(changes,admin));
  const result=normalize(changes);assert.equal(result[0].after.unitCostPerM2,45.67);assert.deepEqual(result[1].after,panel);
  const {unitCostPerM2,...details}=result[0].after;assert.deepEqual(details,catalogue());assert.deepEqual(changes,before);
 }
});

test('worker transfer catalogue creation remains available when the optional rate is omitted',()=>{
 const changes=transferChanges(),before=structuredClone(changes);
 assert.equal(Object.hasOwn(changes[0].after,'unitCostPerM2'),false);
 assert.doesNotThrow(()=>validateChanges(changes,worker));
 const normalized=normalizeChanges(changes,worker,now);
 assert.equal(Object.hasOwn(normalized[0].after,'unitCostPerM2'),false);
 assert.deepEqual(normalized[1].after,changes[1].after);assert.deepEqual(normalized[2].after,changes[2].after);
 assert.deepEqual(changes,before);
});

test('worker transfer exception cannot create or clear a catalogue rate, including zero',()=>{
 for(const rate of [0,12.34,1e9,null,'','   ','\t']){
  const changes=transferChanges({unitCostPerM2:rate}),before=structuredClone(changes);
  assert.throws(()=>validateChanges(changes,worker),error=>error.status===403);
  assert.deepEqual(changes,before);
  assert.doesNotThrow(()=>validateChanges(changes,admin));
 }
});

test('ordinary catalogue rate changes and clears require admin access',()=>{
 for(const rate of [0,12.34,null,'','   '])for(const previous of [null,catalogue({unitCostPerM2:10})]){
  const input=catalogueChange(rate,previous),before=structuredClone(input);
  assert.throws(()=>validateChanges([input],worker),error=>error.status===403);
  assert.deepEqual(input,before);assert.doesNotThrow(()=>validateChanges([input],admin));
 }
});
