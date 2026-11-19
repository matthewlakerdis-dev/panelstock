import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDispatchQa} from '../src/dispatch-read.js';
const photo='data:image/png;base64,'+'a'.repeat(300000),records=[{id:'gate-1',gateOrderId:'order-1',status:'approved',latest:{status:'approved',checkedBy:'inspector',photo},history:[{status:'recut',notes:'Escaped "quote" and \\ slash',photo},{status:'approved',photo}],photoAdditions:[{attemptId:'attempt',photos:[photo],addedBy:'person'}],notes:'Preserve ordinary text, including data:image/png in a sentence.'}];
function fixture(text,size){return {exec(query,key){assert.equal(key,'qa-checks');return (function*(){for(let i=0;i<text.length;i+=size)yield {value:text.slice(i,i+size)};})();}};}
test('dispatch metadata preserves statuses, history and provenance across every JSON boundary without retaining photo bytes',()=>{
 const raw=JSON.stringify(records),expected=JSON.parse(raw);expected[0].latest.photo='';expected[0].history.forEach(row=>row.photo='');expected[0].photoAdditions[0].photos=[''];
 for(const size of [1,2,7,11,17,99999,100000])assert.deepEqual(readDispatchQa(fixture(raw,size)),expected);
 assert.equal(JSON.stringify(records),raw);assert.ok(JSON.stringify(expected).length<1000);
});
test('dispatch projection handles absent documents, empty values, escapes, and non-image data without hiding metadata',()=>{
 assert.deepEqual(readDispatchQa(fixture('',10)),[]);
 const values=['','d','data:','data:imaginary','data:application/pdf;base64,abc','data:image/escaped\\"value','\\"data:image/png;not-a-photo'];
 const projected=readDispatchQa(fixture(JSON.stringify(values),1));assert.deepEqual(projected,values.map(value=>value.startsWith('data:image/')?'':value));
});
