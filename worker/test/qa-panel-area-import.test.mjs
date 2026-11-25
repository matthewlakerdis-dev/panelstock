import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importPanelAreas} from '../src/qa-panel-area-import.js';
import {fabricationProductionReportRows} from '../src/fabrication-production-report.js';
const cut='2026-11-20T00:00:00Z',checkedAt='2026-11-21T01:00:00Z';
const actor={username:'qa',tasks:{'factory.qa':true}},admin={username:'admin',isAdmin:true};
const panel=(id,extra={})=>({id,jobReference:'Test tower',orderNumber:'42',panelNumber:id.toUpperCase(),status:'completed',completedAt:cut,panelAreaScope:'sheet',totalPanelArea:10,...extra});
const record=id=>({id,kind:'panel',status:'approved',latest:{id:'inspection-'+id,status:'approved',checkedAt,photo:'PRIVATE PHOTO',notes:'QA notes'},history:[]});
function fixture(panels=[panel('a'),panel('b')],records=[record('a')]){
 const docs={'app:cncPanels':panels,'qa-checks':records},audits=[];let transactions=0,writes=0;
 return {docs,audits,get writes(){return writes;},get transactions(){return transactions;},read:(key,fallback)=>structuredClone(docs[key]??fallback),readQaForDispatch:()=>structuredClone(docs['qa-checks']),write:(key,value)=>{docs[key]=structuredClone(value);writes++;},audit:(by,event,detail)=>audits.push({by,event,detail}),ctx:{storage:{transactionSync:callback=>{transactions++;return callback();}}}};
}
const input=(extra={})=>({importId:'synthetic-import-0001',fileName:'stickers.pdf',project:'Test tower',orderNumber:'42',rows:[{id:'a',reference:'A',page:1,panelArea:{method:'manual',areaM2:.859},cutAt:cut,expectedAttemptId:'inspection-a',expectedAreaRevision:0},{id:'b',reference:'B',page:2,panelArea:{method:'manual',areaM2:1.212},cutAt:cut,expectedAttemptId:null,expectedAreaRevision:0}],...extra});
test('PDF batch saves only individual areas atomically and approved items retain their QA date and evidence',()=>{
 const store=fixture(),before=JSON.stringify(store.docs['qa-checks']),result=importPanelAreas(store,input(),actor);
 assert.equal(result.savedCount,2);assert.equal(store.transactions,1);assert.equal(JSON.stringify(store.docs['qa-checks']),before);
 assert.deepEqual(fabricationProductionReportRows(store.docs['app:cncPanels'],store.docs['qa-checks'],{a:store.docs['qa-panel-area:a'],b:store.docs['qa-panel-area:b']}),[{id:'a',areaM2:.859,completedAt:checkedAt}]);
 assert.equal(store.audits.at(-1).event,'qa-panel-area-pdf-imported');assert.equal(store.docs['qa-panel-area:b'].value.areaM2,1.212);
 // Lost-response retries are safe even after an inspection subsequently changes.
 store.docs['qa-checks'][0].latest.id='new-inspection';const writes=store.writes;
 assert.deepEqual(importPanelAreas(store,input(),actor),result);assert.equal(store.writes,writes);assert.equal(store.transactions,1);
 assert.throws(()=>importPanelAreas(store,input({fileName:'different.pdf'}),actor),e=>e.status===409);
 assert.throws(()=>importPanelAreas(store,input(),admin),e=>e.status===409);
});
test('every selected row is validated before any write, including stale area/cut/QA and invalid numbers',()=>{
 for(const patch of [{expectedAreaRevision:1},{cutAt:'old'},{expectedAttemptId:'old'},{panelArea:{method:'manual',areaM2:-1}},{panelArea:{method:'dimensions',lengthMm:1,widthMm:1}},{page:0}]){
  const store=fixture(),body=input();Object.assign(body.rows[1],patch);assert.throws(()=>importPanelAreas(store,body,actor));assert.equal(store.writes,0);assert.equal(store.transactions,0);assert.equal(store.audits.length,0);
 }
});
test('cross-project/order matches, reused panel IDs, duplicate selections and conflicting identities are blocked',()=>{
 for(const panels of [[panel('a'),panel('b',{jobReference:'Other tower'})],[panel('a'),panel('b',{orderNumber:'43'})],[panel('a'),panel('b'),panel('duplicate',{panelNumber:'B'})],[panel('a'),panel('b'),panel('b',{panelNumber:'OTHER'})]]){
  const store=fixture(panels);assert.throws(()=>importPanelAreas(store,input(),actor),e=>e.status===409);assert.equal(store.writes,0);
 }
 const duplicate=fixture(),body=input();body.rows[1]=body.rows[0];assert.throws(()=>importPanelAreas(duplicate,body,actor));assert.equal(duplicate.writes,0);
 const identity=fixture(undefined,[record('a'),record('a')]);assert.throws(()=>importPanelAreas(identity,input(),actor));assert.equal(identity.writes,0);
});
test('QA permissions and approved area corrections are enforced without changing QA results',()=>{
 const store=fixture();assert.throws(()=>importPanelAreas(store,input(),{username:'viewer',tasks:{}}),e=>e.status===403);assert.equal(store.writes,0);
 store.docs['qa-panel-area:a']={revision:1,cutAt:cut,value:{method:'manual',areaM2:2}};const body=input();body.rows[0].expectedAreaRevision=1;
 assert.throws(()=>importPanelAreas(store,body,actor),e=>e.status===403);assert.equal(store.writes,0);
 assert.equal(importPanelAreas(store,body,admin).savedCount,2);
 for(const status of ['recut','replaced','not_required']){const blocked=fixture(undefined,[{...record('a'),status}]);assert.throws(()=>importPanelAreas(blocked,input(),admin),e=>e.status===409);assert.equal(blocked.writes,0);}
});
