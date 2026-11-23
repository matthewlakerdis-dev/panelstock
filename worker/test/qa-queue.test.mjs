import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qaQueueItem,qaQueueView,qaQueueMutationResponse} from '../src/qa-queue.js';

const original='data:image/png;base64,aGVsbG8=',second='data:image/jpeg;base64,d29ybGQ=',reference='qa-r2:v1:'+'a'.repeat(64)+':128';
const additions=[
 {id:'add-current',attemptId:'current',photos:[second],addedBy:'photo-team',addedAt:'2026-11-23T02:00:00Z',mutationId:'current-upload-0001'},
 {id:'add-old',attemptId:'old',photos:[original],addedBy:'earlier-team',addedAt:'2026-11-23T03:00:00Z',mutationId:'earlier-upload-0001'},
 {id:'orphan',attemptId:'missing',photos:[reference],addedBy:'another-team',addedAt:'2026-11-23T04:00:00Z',mutationId:'orphan-upload-0001'}
];
function fixture(){
 const latest={id:'current',status:'approved',results:{dimensions:'pass',hinges:'na'},notes:'Current inspection notes',checklistKind:'gate',checklist:[['dimensions','Correct dimensions'],['hinges','Hinges are secure']],photos:[original,reference],photo:original,checkedBy:'inspector',checkedAt:'2026-11-23T01:00:00Z'},old={id:'old',status:'recut',results:{dimensions:'fail'},notes:'Earlier corrective work',photo:second,checkedBy:'earlier-inspector',checkedAt:'2026-11-22T01:00:00Z'};
 return {id:'gate-piece',kind:'metalwork',project:'Sample project',orderNumber:'001',reference:'Gate A',quantity:2,status:'approved',latest,history:[old,latest],photoAdditions:structuredClone(additions),qaExemptionHistory:[{action:'grant',by:'manager',at:'2026-11-20T01:00:00Z',reason:'Recorded requirement history'}]};
}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}
function assertNoEvidence(value){
 if(typeof value==='string'){assert.ok(!value.startsWith('data:image/'));assert.ok(!/^qa-r2:v1:/.test(value));}
 else if(Array.isArray(value))for(const item of value)assertNoEvidence(item);
 else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){assert.notEqual(key,'photo');assert.notEqual(key,'photos');assertNoEvidence(item);}
}

test('queue items retain complete inspection metadata and provenance while removing all photo bodies and references',()=>{
 const item=freeze(fixture()),before=structuredClone(item),queued=qaQueueItem(item);
 assertNoEvidence(queued);assert.equal(queued.evidenceLoaded,false);assert.equal(queued.hasPhotoEvidence,true);
 for(const key of ['id','kind','project','orderNumber','reference','quantity','status','qaExemptionHistory'])assert.deepEqual(queued[key],item[key]);
 assert.deepEqual(queued.history.map(attempt=>attempt.id),['old','current']);
 for(const [actual,source]of [[queued.latest,item.latest],...queued.history.map((attempt,index)=>[attempt,item.history[index]])])for(const key of ['id','status','results','notes','checkedBy','checkedAt','checklistKind','checklist'])assert.deepEqual(actual[key],source[key]);
 assert.notEqual(queued.latest,item.latest);assert.notEqual(queued.history,item.history);
 for(const [index,addition]of queued.photoAdditions.entries()){
  assert.equal(addition.photoCount,1);for(const key of ['id','attemptId','addedBy','addedAt','mutationId'])assert.equal(addition[key],item.photoAdditions[index][key]);
 }
 assert.deepEqual(item,before);
});

test('photoCount includes exact-attempt supplements and counts the legacy photo alias only once',()=>{
 const queued=qaQueueItem(fixture());
 assert.equal(queued.latest.photoCount,3);assert.equal(queued.history[0].photoCount,2);assert.equal(queued.history[1].photoCount,3);
 const distinct=qaQueueItem({id:'legacy',latest:{id:'legacy-attempt',status:'approved',photos:[original],photo:second},history:[],photoAdditions:[{attemptId:'some-other-attempt',photos:[reference]}]});
 assert.equal(distinct.latest.photoCount,2);
 const aliased=qaQueueItem({id:'alias',latest:{id:'alias-attempt',photo:original,photos:[original]},photoAdditions:[{attemptId:'alias-attempt',photos:[reference,second]}]});
 assert.equal(aliased.latest.photoCount,3);assert.equal(aliased.hasPhotoEvidence,true);
});

test('legacy inspections without IDs never receive supplements belonging to an unrelated or missing attempt ID',()=>{
 const item={id:'legacy',latest:{status:'approved',photo:original,results:{fit:'pass'}},history:[{status:'recut',photo:second}],photoAdditions:[{photos:[reference],addedBy:'team'},{attemptId:'unrelated',photos:[original]}]},before=structuredClone(item),queued=qaQueueItem(item);
 assert.equal(queued.latest.photoCount,1);assert.equal(queued.history[0].photoCount,1);assert.equal(queued.hasPhotoEvidence,true);assert.equal(queued.latest.id,undefined);assert.deepEqual(item,before);assertNoEvidence(queued);
});

test('hasPhotoEvidence includes orphan supplements and top-level legacy evidence without inventing inspections',()=>{
 for(const extra of [{photo:original},{photos:[reference]},{photoAdditions:[{id:'orphan',attemptId:'unknown',photos:[second]}]}]){
  const item={id:'uninspected',kind:'metalwork',status:'awaiting',latest:null,history:[],...extra},before=structuredClone(item),queued=qaQueueItem(item);
  assert.equal(queued.hasPhotoEvidence,true);assert.equal(queued.latest,null);assert.deepEqual(queued.history,[]);assert.equal(queued.status,'awaiting');assertNoEvidence(queued);assert.deepEqual(item,before);
 }
 for(const item of [{id:'empty'}, {id:'empty-lists',latest:null,history:[],photos:[],photoAdditions:[]}]){
  const queued=qaQueueItem(item);assert.equal(queued.hasPhotoEvidence,false);assert.equal(queued.evidenceLoaded,false);assert.equal(Object.hasOwn(queued,'latest'),Object.hasOwn(item,'latest'));
 }
});

test('queue projection strips inline images and private references even from nested non-photo fields',()=>{
 const item=fixture();item.extra={url:original,reference,values:[reference,original,{photo:second,photos:[original],other:reference,keep:'Useful metadata'}]};item.latest.photoDescription=reference;
 const before=structuredClone(item),queued=qaQueueItem(item);assertNoEvidence(queued);assert.equal(queued.extra.url,'');assert.equal(queued.extra.reference,'');assert.equal(queued.extra.values[2].keep,'Useful metadata');assert.equal(queued.latest.photoDescription,'');assert.equal(queued.latest.notes,item.latest.notes);assert.deepEqual(item,before);
});

test('full queue views strip dispatch and settings evidence while preserving counts, order fields and checklists',()=>{
 const view=freeze({ok:true,items:[fixture()],settings:{requireQaPhoto:true,metadata:{preview:original}},checklists:{gate:[['hinges','Check hinges']]},preQaCount:7,gateOrders:[{id:'order',project:'Sample project',colour:'White'}],dispatches:[{id:'dispatch',destination:'Site',photo:reference,driver:'Driver',lines:[{id:'gate-piece',quantity:2,nested:{url:original}}]}]}),before=structuredClone(view),queued=qaQueueView(view);
 assertNoEvidence(queued);assert.equal(queued.items[0].latest.photoCount,3);assert.equal(queued.items[0].evidenceLoaded,false);assert.equal(queued.preQaCount,7);assert.deepEqual(queued.checklists,view.checklists);assert.deepEqual(queued.gateOrders,view.gateOrders);assert.equal(queued.dispatches[0].destination,'Site');assert.equal(queued.dispatches[0].lines[0].quantity,2);assert.equal(queued.settings.requireQaPhoto,true);assert.deepEqual(view,before);
});

test('mutation queue responses redact broad collections but preserve the explicit saved item, addition and report snapshots',()=>{
 const item=fixture(),addition=structuredClone(additions[0]),report={items:[fixture()],pdf:{data:'unchanged-pdf-bytes'}},body=freeze({ok:true,item,addition,report,items:[fixture()],dispatches:[{id:'shipment',photo:reference,notes:'Preserve dispatch notes'}],settings:{requireQaPhoto:true}}),before=structuredClone(body),queued=qaQueueMutationResponse(body);
 assert.equal(queued.item,item);assert.equal(queued.addition,addition);assert.equal(queued.report,report);assert.deepEqual(queued.item.latest.photos,[original,reference]);assert.deepEqual(queued.addition.photos,[second]);assert.equal(queued.report.items[0].latest.photo,original);
 assertNoEvidence(queued.items);assertNoEvidence(queued.dispatches);assert.equal(queued.items[0].latest.photoCount,3);assert.equal(queued.dispatches[0].notes,'Preserve dispatch notes');assert.deepEqual(body,before);
});

test('mutations without queue collections keep success and structured failure bodies intact',()=>{
 for(const body of [{ok:true,deletedId:'deleted-item'},{ok:false,error:'Original denial',code:'QA_ACCESS_REQUIRED'},{ok:true,item:fixture(),addition:structuredClone(additions[0])}]){
  const before=structuredClone(body),queued=qaQueueMutationResponse(body);assert.deepEqual(queued,before);assert.equal(Object.hasOwn(queued,'items'),false);assert.equal(Object.hasOwn(queued,'dispatches'),false);assert.deepEqual(body,before);
 }
});
