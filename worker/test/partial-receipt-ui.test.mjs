import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  function receiptTotals('),source.indexOf('  function receiptBodyLines('));
function view(order){return vm.runInNewContext(code+';({totals:receiptTotals(order),canReceive:canReceiveOrder(order)})',{order,receiptAllowed:()=>true});}
test('the Site receipt checklist is limited to shipped quantities and opens for a partial trip',()=>{
 const order={status:'completed',items:[{quantity:10,description:'Fixings'}],dispatches:[{lines:[{index:0,quantity:4}]}],receipts:[]};
 let result=view(order);assert.equal(result.totals[0].outstanding,4);assert.equal(result.canReceive,true);
 order.receipts=[{lines:[{index:0,accepted:4}]}];result=view(order);assert.equal(result.totals[0].outstanding,0);assert.equal(result.canReceive,false);
 order.dispatches.push({lines:[{index:0,quantity:6}]});result=view(order);assert.equal(result.totals[0].outstanding,6);assert.equal(result.canReceive,true);
});

test('fractional delivery trips do not leave a phantom receipt balance',()=>{
 const order={status:'dispatched',items:[{quantity:0.3}],dispatches:[{lines:[{index:0,quantity:0.1}]},{lines:[{index:0,quantity:0.2}]}],receipts:[{lines:[{index:0,accepted:0.3}]}]};
 const result=view(order);assert.equal(result.totals[0].outstanding,0);assert.equal(result.canReceive,false);
});
