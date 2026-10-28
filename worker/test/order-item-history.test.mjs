import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('capitalisation leaves historical receipted descriptions intact and still rejects changed items',()=>{
 const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8'),start=source.indexOf('  updateOrder(id,body,actor) {'),end=source.indexOf('  readPublicCnc()',start);
 const order={id:'legacy',project:'Test',siteContact:'Taylor',phone:'123',requestedDeliveryDate:'2026-10-28',orderType:'Fixings',status:'ordered',updatedAt:'original',items:[{quantity:2,description:'Aluminium angle'}],receipts:[{id:'received'}]};
 let saved=structuredClone(order),writes=0;
 const context={check:(condition,message)=>{if(!condition)throw Error(message);},isPanelOrder:()=>false,checkGateOrderEdit(){},orderConflict:()=>null,selectOrderType:()=> 'Fixings',otherOrderType:()=>'',nextOrderStamp:()=> 'next',orderCompletionStamp:()=>null,notifyOrderChange(){},ok:value=>value};
 vm.runInNewContext('globalThis.update=({'+source.slice(start,end)+'}).updateOrder;',context);
 const store={ensureProjectRecords:()=>[],orderProjectKey:value=>value.toLowerCase(),read:()=>[structuredClone(saved)],write:(key,orders)=>{writes++;saved=orders[0];},audit(){},ctx:{storage:{transactionSync:fn=>fn()}}};
 const result=context.update.call(store,'legacy',{order:{...order,locationNotes:'New delivery note',items:[{quantity:2,description:'ALUMINIUM ANGLE'}]}},{username:'manager'});
 assert.equal(result.order.items[0].description,'Aluminium angle');assert.equal(result.order.locationNotes,'New delivery note');assert.equal(writes,1);
 assert.throws(()=>context.update.call(store,'legacy',{order:{...saved,items:[{quantity:3,description:'ALUMINIUM ANGLE'}]}},{username:'manager'}),/cannot change after a delivery receipt/);
 assert.equal(writes,1);
});
