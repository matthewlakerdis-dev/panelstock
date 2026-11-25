import {qaWriteGuard,assertQaWriteGuard} from '../src/qa-media.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePanelArea,panelAreaFor,preparePanelArea,commitPanelArea,readPanelAreas} from '../src/qa-panel-area.js';
const panel={id:'a',status:'completed',completedAt:'2026-11-20T00:00:00Z',panelAreaScope:'sheet',totalPanelArea:8.76};
const admin={username:'admin',isAdmin:true},worker={username:'qa',tasks:{'factory.qa':true}},approved={id:'a',kind:'panel',status:'approved',latest:{id:'check',status:'approved',checkedAt:'2026-11-21T00:00:00Z'}};
const body=(extra={})=>({panelArea:{method:'dimensions',lengthMm:2400,widthMm:1200,areaM2:500},cutAt:panel.completedAt,expectedAttemptId:null,expectedAreaRevision:0,...extra});
function fixture(){const docs={},audits=[];let writes=0;return {docs,audits,get writes(){return writes;},read:(key,fallback)=>docs[key]??fallback,write:(key,value)=>{docs[key]=structuredClone(value);writes++;},audit:(by,event,detail)=>audits.push({by,event,detail})};}
test('rectangles are calculated server-side in m²; shaped manual area is retained and invalid numbers rejected',()=>{
 assert.deepEqual(normalizePanelArea(body().panelArea),{method:'dimensions',lengthMm:2400,widthMm:1200,areaM2:2.88});
 assert.deepEqual(normalizePanelArea({method:'manual',areaM2:'1.234567'}),{method:'manual',areaM2:1.234567});
 for(const input of [null,{},[],{method:'unknown'},{method:'dimensions',lengthMm:0,widthMm:1},{method:'dimensions',lengthMm:true,widthMm:1},{method:'dimensions',lengthMm:Infinity,widthMm:1},{method:'dimensions',lengthMm:1000000,widthMm:1000000},...['',0,-1,NaN,Infinity,true,100000].map(areaM2=>({method:'manual',areaM2}))])assert.throws(()=>normalizePanelArea(input),error=>error.status===400);
 assert.equal(panelAreaFor(panel,null,null),null);assert.equal(panelAreaFor({...panel,panelAreaScope:'panel'},null,null).areaM2,8.76);
 assert.equal(panelAreaFor({...panel,panelWidth:1200,panelHeight:2400},null,null).areaM2,2.88);
});
test('area saves use one small item record, preserve inspections and are safe to retry after a lost response',()=>{
 const store=fixture(),before=structuredClone(approved),input=body({expectedAttemptId:'check'}),first=preparePanelArea(store,input,worker,panel,approved);
 commitPanelArea(store,panel,first,worker);assert.equal(store.writes,1);assert.equal(store.docs['qa-panel-area:a'].value.areaM2,2.88);assert.deepEqual(approved,before);assert.equal(store.audits[0].event,'qa-panel-area-saved');
 const repeat=preparePanelArea(store,input,worker,panel,approved);commitPanelArea(store,panel,repeat,worker);assert.equal(store.writes,1);assert.equal(store.audits.length,1);
 const corrected=preparePanelArea(store,body({panelArea:{method:'manual',areaM2:2.5},expectedAttemptId:'check',expectedAreaRevision:1}),admin,panel,approved);commitPanelArea(store,panel,corrected,admin);assert.equal(store.docs['qa-panel-area:a'].revision,2);
});
test('permissions, stale area/inspection/cut guards and failed originals reject before writes',()=>{
 const store=fixture();
 assert.throws(()=>preparePanelArea(store,body(),{username:'viewer',tasks:{}},panel,null),e=>e.status===403);
 for(const override of [{cutAt:'old'},{expectedAttemptId:'old'},{expectedAreaRevision:1}])assert.throws(()=>preparePanelArea(store,body(override),admin,panel,null),e=>e.status===409);
 for(const status of ['recut','replaced','not_required'])assert.throws(()=>preparePanelArea(store,body({expectedAttemptId:'check'}),admin,panel,{...approved,status}),e=>e.status===409);
 assert.equal(store.writes,0);
 const known={...panel,panelAreaScope:'panel'};assert.throws(()=>preparePanelArea(store,body({expectedAttemptId:'check'}),worker,known,approved),e=>e.status===403);
});
test('the report/queue area index only reads small area records, without touching QA photo evidence',()=>{
 const sql={exec(query){assert.match(query,/key GLOB 'qa-panel-area:\*' AND part=0/);return {toArray:()=>[{key:'qa-panel-area:a',value:JSON.stringify({value:{method:'manual',areaM2:2.5},cutAt:panel.completedAt,revision:1})}]};}};
 assert.equal(readPanelAreas({sql}).a.value.areaM2,2.5);
});

test('a panel area change during evidence upload rejects the stale approval, while unrelated area edits do not',()=>{
 const documents=new Map(),store={sql:{exec(query,key){return query.startsWith('SELECT value FROM documents')?(documents.get(key)||[]).map(value=>({value})):[];}}};
 const guard=qaWriteGuard(store,['qa-panel-area:a']);documents.set('qa-panel-area:other',['changed']);assert.doesNotThrow(()=>assertQaWriteGuard(store,guard,{}));
 documents.set('qa-panel-area:a',['changed']);assert.throws(()=>assertQaWriteGuard(store,guard,{}),e=>e.status===409);
});
