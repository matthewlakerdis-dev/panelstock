import test from 'node:test';
import assert from 'node:assert/strict';
import {operationCode,traceOperation} from '../src/operation-diagnostics.js';
test('operation diagnostics expose only fixed classes and numeric phases, never private request details',()=>{
 const events=[],store={env:{RELIABILITY_DIAGNOSTICS:'true'}},now=()=>1234567890;
 const trace=traceOperation(store,'/purchase-orders/private-customer-secret','POST',{logger:value=>events.push(value),now});
 for(const phase of [1,2,3,4,5,6])trace.mark(phase,phase===6?500:200);
 assert.equal(events.length,7);assert.ok(events.every(value=>value.operation===2&&value.write===1));
 assert.ok(events.every(value=>Object.entries(value).every(([key,item])=>key==='event'?item==='inventory_operation':Number.isSafeInteger(item))));
 assert.equal(JSON.stringify(events).includes('private-customer-secret'),false);
 const second=traceOperation(store,'/qa/private-photo-id','GET',{logger:value=>events.push(value),now});second.mark(3,403);assert.equal(events.at(-1).ordinal,2);assert.equal(events.at(-1).write,0);
 trace.mark(99);trace.mark('private-error');assert.equal(events.length,9);
});
test('disabled, unknown and failed logging diagnostics have no business or storage side effects',()=>{
 assert.equal(traceOperation({env:{}},'/workshop-stock','GET'),null);
 assert.equal(operationCode({toString(){assert.fail('No user-controlled coercion');}}),0);
 assert.equal(traceOperation({env:{RELIABILITY_DIAGNOSTICS:'true'}},'/private-other','GET'),null);
 const store={env:{RELIABILITY_DIAGNOSTICS:'true'}};assert.doesNotThrow(()=>traceOperation(store,'/admin/backups','GET',{logger:()=>{throw Error('Log unavailable');}}).mark(3,200));
});
