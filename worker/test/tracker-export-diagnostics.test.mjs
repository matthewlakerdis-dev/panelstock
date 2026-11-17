import test from 'node:test';
import assert from 'node:assert/strict';
import {trackerExportFailure} from '../src/tracker-export-diagnostics.js';
test('tracker failure logs keep only a controlled stage and redacted error details',()=>{
 const secret='synthetic-secret',id='11111111-1111-4111-8111-111111111111',token='a'.repeat(64);
 const error=Object.assign(new TypeError('Failed https://example.test/path?token='+secret+' token='+secret+' '+secret+' '+id+' '+token+' contact@example.test "PRIVATE ORDER CONTENT"'),{retryable:true,cause:Error('Cannot read properties of null (reading \'PRIVATE FIELD\')')});
 const result=trackerExportFailure(error,'workbook-build',secret),text=JSON.stringify(result);
 assert.equal(result.stage,'workbook-build');assert.equal(result.name,'TypeError');assert.equal(result.retryable,true);assert.equal(result.overloaded,false);assert.match(result.cause,/Cannot read properties of null/);
 for(const value of [secret,id,token,'example.test','PRIVATE ORDER CONTENT','PRIVATE FIELD','contact@'])assert.ok(!text.includes(value),value);
 assert.equal(trackerExportFailure(error,'UNTRUSTED STAGE').stage,'unknown');
});
test('safe runtime error messages remain useful, bounded and on one line',()=>{
 const result=trackerExportFailure(Object.assign(Error('Compression failed\n'+'.'.repeat(500)),{overloaded:true}),'workbook-build');
 assert.match(result.detail,/^Compression failed /);assert.equal(result.detail.length,400);assert.doesNotMatch(result.detail,/\n/);assert.equal(result.overloaded,true);
 assert.deepEqual(trackerExportFailure(null,'workbook-data'),{stage:'workbook-data',name:'Error',detail:'',retryable:false,overloaded:false});
});
