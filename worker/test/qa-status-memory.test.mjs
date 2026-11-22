import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateQaRecord,migrateQaRecords} from '../src/qa-status.js';

const current=()=>({id:'qa-1',status:'approved',replacementStatus:'approved',latest:{id:'attempt-2',status:'approved'},history:[{id:'attempt-1',status:'recut'},{id:'attempt-2',status:'approved'}]});
test('every supported legacy status position counts its record exactly once',()=>{
 const cases=[
  value=>value.status='rework',
  value=>value.replacementStatus='rework',
  value=>value.latest.status='rework',
  value=>value.history[0].status='rework',
  value=>value.history[1].status='rework',
 ];
 for(const change of cases){const input=current();change(input);const {records,count}=migrateQaRecords([input]);assert.equal(count,1);assert.deepEqual(records[0],migrateQaRecord(input));assert.equal(migrateQaRecords(records).count,0);}
 const input=current();for(const change of cases)change(input);assert.equal(migrateQaRecords([input]).count,1);
 const {records,count}=migrateQaRecords(cases.map(change=>{const value=current();change(value);return value;}));assert.equal(count,cases.length);assert.ok(records.every(record=>[record.status,record.replacementStatus,record.latest.status,...record.history.map(attempt=>attempt.status)].every(status=>status!=='rework')));
});
test('unchanged photo-bearing records are never serialized to count migrations',()=>{
 let serialized=0;
 const metadata={caption:'Evidence remains intact',toJSON(){serialized++;throw Error('Photo-bearing records must not be serialized for migration counting');}};
 const input={...current(),photo:'data:image/jpeg;base64,'+'A'.repeat(6*1024*1024),metadata,notes:'A note mentions rework without changing any QA status',toJSON(){serialized++;throw Error('The complete record must not be serialized');}};
 const {records,count}=migrateQaRecords([input]);assert.equal(count,0);assert.equal(serialized,0);assert.equal(records[0].photo,input.photo);assert.equal(records[0].metadata,metadata);assert.equal(records[0].notes,input.notes);
});
test('large inline evidence, private references, metadata and immutable attempt order survive migration',()=>{
 const photo='data:image/png;base64,'+'B'.repeat(8*1024*1024),reference='qa-r2:v1:'+'a'.repeat(64)+':123456';
 const metadata=Object.freeze({source:'Original inspection',dimensions:Object.freeze({width:2048,height:1536})});
 const earlier=Object.freeze({id:'first',status:'approved',photo,photos:Object.freeze([photo,reference]),metadata});
 const later=Object.freeze({id:'second',status:'rework',photo:reference,notes:'Original finding',metadata});
 const additions=Object.freeze([{id:'addition',attemptId:'first',photos:Object.freeze([photo,reference])}]);
 const history=Object.freeze([earlier,later]),input=Object.freeze({id:'qa-1',status:'rework',latest:later,history,photoAdditions:additions,metadata});
 const {records,count}=migrateQaRecords([input]),saved=records[0];assert.equal(count,1);assert.equal(saved.status,'recut');assert.equal(saved.latest.status,'recut');assert.deepEqual(saved.history.map(attempt=>attempt.id),['first','second']);assert.deepEqual(saved.history.map(attempt=>attempt.status),['approved','recut']);
 assert.equal(saved.history[0].photo,photo);assert.equal(saved.history[0].photos,earlier.photos);assert.equal(saved.history[1].photo,reference);assert.equal(saved.photoAdditions,additions);assert.equal(saved.metadata,metadata);assert.equal(saved.latest.metadata,metadata);assert.equal(saved.history[1].notes,later.notes);
 assert.equal(input.status,'rework');assert.equal(input.latest.status,'rework');assert.equal(input.history,history);assert.equal(input.history[1],later);
});
test('ordinary missing, undefined, null or non-array optional fields retain existing migration behavior',()=>{
 const inputs=[{id:'missing'}, {id:'undefined',status:undefined,replacementStatus:undefined,latest:undefined,history:undefined}, {id:'null',status:null,replacementStatus:null,latest:null,history:null}, {id:'metadata',status:'approved',latest:{id:'attempt'},history:{note:'not an attempt list'}}, {id:'empty',status:'approved',history:[]}];
 const {records,count}=migrateQaRecords(inputs);assert.equal(count,0);
 for(let i=0;i<inputs.length;i++){assert.deepEqual(records[i],migrateQaRecord(inputs[i]));assert.ok(Object.hasOwn(records[i],'status'));assert.ok(Object.hasOwn(records[i],'replacementStatus'));}
 assert.deepEqual(migrateQaRecords([]),{records:[],count:0});
});
