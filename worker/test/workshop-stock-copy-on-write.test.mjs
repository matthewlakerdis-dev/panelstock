import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applyWorkshop} from '../src/workshop-stock.js';

const actor={username:'admin',isAdmin:true};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function fixture(image=png){
 const item=(id,colour,sku='ANGLE')=>({id,sku,name:'Angle',category:'extrusions',unit:'lengths',qty:20,reservations:{Existing:3},unitCost:5,costBasis:'unit',packSize:1,dimensions:'30 x 30 x 3',colour,location:'Rack A',supplier:'Original supplier',reorderLevel:2,image});
 return {revision:7,items:[item('black','Black'),item('white','White'),item('other','Black','OTHER')],metadata:{'variant:sheet':{image,unitCost:99,location:'Panel rack',privateDetails:{preserved:true}}},movements:[{id:'original',action:'receive',quantity:20,detail:{preserved:['history']}}],purchaseOrders:[{id:'po',status:'open',lines:[{itemId:'black',ordered:5,received:1}],attachments:[{id:'original-file'}]}],stocktakes:[{id:'complete',status:'completed',itemIds:['black'],counts:{black:{quantity:20,item:{name:'Historical angle'}}},report:{rows:[{itemId:'black',quantity:20,unitCost:3}]}},{id:'open',status:'open',itemIds:['white'],counts:{}}],poStockReferences:[{key:'supplier',itemId:'black',source:{sku:'ORIGINAL'}}]};
}
function forbidDeepClone(t){t.mock.method(globalThis,'structuredClone',()=>{assert.fail('An ordinary stock edit must not deep-clone the complete image-bearing document');});}
function preserveHistory(next,original){for(const key of ['purchaseOrders','stocktakes','poStockReferences'])assert.equal(next[key],original[key]);assert.equal(next.movements[1],original.movements[0]);}

test('a price edit avoids cloning a production-sized image library and preserves every original field and image',t=>{
 const bytes=Buffer.alloc(4*1024*1024,1);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);const image='data:image/png;base64,'+bytes.toString('base64'),state=fixture(image);
 state.items.push(...state.items.map(row=>({...row,id:row.id+'-second',sku:row.sku+'-second'})));freeze(state);
 const original=JSON.stringify(state);assert.ok(Buffer.byteLength(original)>33*1000*1000);const digest=createHash('sha256').update(original).digest('hex');forbidDeepClone(t);
 const {next}=applyWorkshop(state,{action:'metadata',itemId:'black',unitCost:12.34,location:'Rack B'},actor);
 assert.equal(next.revision,8);assert.equal(next.items[0].unitCost,12.34);assert.equal(next.items[0].location,'Rack B');assert.equal(state.items[0].unitCost,5);assert.equal(state.items[0].location,'Rack A');assert.notEqual(next.items,state.items);assert.notEqual(next.items[0],state.items[0]);assert.notEqual(next.items[0].reservations,state.items[0].reservations);assert.notEqual(next.metadata,state.metadata);assert.notEqual(next.movements,state.movements);preserveHistory(next,state);
 for(let index=0;index<state.items.length;index++)assert.equal(next.items[index].image,state.items[index].image);assert.equal(next.metadata['variant:sheet'].image,image);assert.equal(createHash('sha256').update(JSON.stringify(state)).digest('hex'),digest);
});

test('ordinary stock movements isolate quantities and reservation dictionaries without copying reports or supplier data',t=>{
 forbidDeepClone(t);
 for(const [action,quantity,qty,reservation]of [['receive',2,22,3],['return',2,22,3],['reserve',4,20,7],['release',2,20,1],['use',4,16,0],['damage',2,18,3],['stocktake',15,15,3]]){
  const state=freeze(fixture()),{next}=applyWorkshop(state,{action,itemId:'black',quantity,job:'Existing',reason:'Synthetic count or damage check'},actor);
  assert.equal(next.items[0].qty,qty,action);assert.equal(next.items[0].reservations.Existing,reservation,action);assert.equal(state.items[0].qty,20,action);assert.equal(state.items[0].reservations.Existing,3,action);assert.equal(next.items[1].qty,20,action);assert.equal(next.items[1].reservations.Existing,3,action);assert.notEqual(next.items[0].reservations,state.items[0].reservations);assert.equal(next.items[0].image,png);preserveHistory(next,state);
 }
});

test('shared profile and legacy metadata changes isolate every affected item and replace metadata entries',t=>{
 forbidDeepClone(t);const state=freeze(fixture());
 const changed=applyWorkshop(state,{action:'metadata',itemId:'black',dimensions:'40 x 40 x 3',image:'',location:'New location'},actor).next;
 assert.equal(changed.items[0].dimensions,'40 x 40 x 3');assert.equal(changed.items[1].dimensions,'40 x 40 x 3');assert.equal(changed.items[0].image,'');assert.equal(changed.items[1].image,'');assert.equal(changed.items[1].location,'Rack A');assert.equal(changed.items[2].dimensions,'30 x 30 x 3');assert.equal(changed.items[2].image,png);assert.ok(state.items.every(row=>row.dimensions==='30 x 30 x 3'&&row.image===png));
 const legacy=applyWorkshop(state,{action:'metadata',itemId:'variant:sheet',unitCost:27.5,location:'New panel rack'},actor).next;
 assert.notEqual(legacy.metadata['variant:sheet'],state.metadata['variant:sheet']);assert.equal(legacy.metadata['variant:sheet'].unitCost,27.5);assert.equal(state.metadata['variant:sheet'].unitCost,99);assert.equal(legacy.metadata['variant:sheet'].image,png);assert.equal(legacy.metadata['variant:sheet'].privateDetails,state.metadata['variant:sheet'].privateDetails);preserveHistory(legacy,state);
});

test('a later rejected bulk row or post-change quantity limit cannot mutate any original nested state',t=>{
 forbidDeepClone(t);const state=freeze(fixture()),before=JSON.stringify(state);
 assert.throws(()=>applyWorkshop(state,{action:'bulk_metadata',itemIds:['black','missing'],changes:{unitCost:7.5}},actor),/Stock item not found/);assert.equal(JSON.stringify(state),before);
 const high=fixture();high.items[0].qty=1e9;freeze(high);const original=JSON.stringify(high);
 assert.throws(()=>applyWorkshop(high,{action:'receive',itemId:'black',quantity:1},actor),/quantity is too large/);assert.equal(JSON.stringify(high),original);
 const success=applyWorkshop(state,{action:'bulk_metadata',itemIds:['black','white','variant:sheet'],changes:{unitCost:7.5}},actor).next;assert.equal(success.items[0].unitCost,7.5);assert.equal(success.items[1].unitCost,7.5);assert.equal(success.metadata['variant:sheet'].unitCost,7.5);assert.equal(success.items[2].unitCost,5);assert.equal(JSON.stringify(state),before);
});

test('complex stocktake creation retains its deep-clone isolation',t=>{
 const clone=globalThis.structuredClone;let calls=0;t.mock.method(globalThis,'structuredClone',value=>{calls++;return clone(value);});
 const state=freeze(fixture()),{next}=applyWorkshop(state,{action:'stocktake_create',name:'Synthetic independent count',categories:['extrusions']},actor);assert.equal(calls,1);assert.equal(next.stocktakes.length,3);assert.equal(state.stocktakes.length,2);assert.notEqual(next.stocktakes[1],state.stocktakes[0]);assert.notEqual(next.purchaseOrders,state.purchaseOrders);assert.notEqual(next.items[0].reservations,state.items[0].reservations);assert.equal(next.items[0].image,png);
});
