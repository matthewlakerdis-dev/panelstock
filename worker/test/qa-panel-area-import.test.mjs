import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importPanelAreas} from '../src/qa-panel-area-import.js';
import {fabricationProductionReportRows} from '../src/fabrication-production-report.js';
const cut='2026-11-20T00:00:00Z',checkedAt='2026-11-21T01:00:00Z';
const actor={username:'qa',tasks:{'factory.qa':true}},admin={username:'admin',isAdmin:true};
const panel=(id,extra={})=>({id,jobReference:'Test tower',orderNumber:'42',panelNumber:id.toUpperCase(),status:'completed',completedAt:cut,panelAreaScope:'sheet',totalPanelArea:10,...extra});
const record=id=>({id,kind:'panel',status:'approved',latest:{id:'inspection-'+id,status:'approved',checkedAt,photo:'PRIVATE PHOTO',notes:'QA notes'},history:[]});
function fixture(panels=[panel('a'),panel('b')],records=[record('a')]){
 const docs={'app:cncPanels':structuredClone(panels),'qa-checks':structuredClone(records)},audits=[];let transactions=0,writes=0,beforeTransaction=null,failKey=null;
 return {docs,audits,get writes(){return writes;},get transactions(){return transactions;},read:(key,fallback)=>structuredClone(docs[key]??fallback),readQaForDispatch:()=>structuredClone(docs['qa-checks']),qaSettings:()=>({enabledFrom:'2026-11-01T00:00:00Z'}),write:(key,value)=>{docs[key]=structuredClone(value);writes++;if(key===failKey)throw Error('Simulated storage failure');},audit:(by,event,detail)=>audits.push({by,event,detail}),beforeTransaction:callback=>{beforeTransaction=callback;},failWrite:key=>{failKey=key;},ctx:{storage:{transactionSync:callback=>{transactions++;if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;hook();}const before=structuredClone(docs),writeCount=writes,auditCount=audits.length;try{return callback();}catch(error){for(const key of Object.keys(docs))delete docs[key];Object.assign(docs,before);writes=writeCount;audits.length=auditCount;throw error;}}}}};
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

function duplicateFixture(){
 const ids=['approved','awaiting','failed','replacement','replaced'],panels=ids.map((id,index)=>panel(id,{panelNumber:'P-7',sheetNumber:String(index+1),completedAt:id==='replacement'?'2026-11-22T00:00:00Z':cut,isRemake:id==='replacement'})),approved=record('approved'),awaiting={id:'awaiting',kind:'panel',status:'awaiting',latest:null,history:[]},failed={...record('failed'),status:'recut',latest:{...record('failed').latest,status:'recut',photo:'PRIVATE FAILURE PHOTO',results:{finish:'fail'}},replacementId:'replacement',history:[{id:'old-failure',status:'recut',photo:'OLD FAILURE PHOTO'}]},replacement={...record('replacement'),remakeOf:'failed',latest:{...record('replacement').latest,checkedAt:'2026-11-23T01:00:00Z'},photoAdditions:[{id:'supplement',attemptId:'inspection-replacement',photos:['PRIVATE SUPPLEMENT']} ]},replaced={...record('replaced'),status:'replaced',replacementId:'replacement',replacementStatus:'approved',resolvedSeparatelyReason:'Retain this old resolution'};
 return {store:fixture(panels,[approved,awaiting,failed,replacement,replaced]),candidateIds:ids.slice().sort()};
}
function selectedBody(store,id,candidateIds,extra={}){
 const target=store.docs['app:cncPanels'].find(panel=>panel.id===id),inspection=store.docs['qa-checks'].find(record=>record.id===id);
 return input({rows:[{id,reference:'P-7',page:3,panelArea:{method:'manual',areaM2:1.234},cutAt:target.completedAt,expectedAttemptId:inspection?.latest?.id||null,expectedAreaRevision:0,matchConfirmed:true,expectedCandidateIds:candidateIds.slice()}],...extra});
}

test('explicit duplicate-reference review selects the exact approved, awaiting or replacement record without touching the other candidates or evidence',()=>{
 for(const selected of ['approved','awaiting','replacement']){
  const {store,candidateIds}=duplicateFixture(),body=selectedBody(store,selected,candidateIds),before=structuredClone(store.docs),result=importPanelAreas(store,body,actor);assert.equal(result.savedCount,1);assert.deepEqual(result.items.map(item=>item.id),[selected]);assert.equal(store.docs['qa-panel-area:'+selected].value.areaM2,1.234);assert.equal(store.docs['qa-panel-area:'+selected].cutAt,body.rows[0].cutAt);assert.deepEqual(store.docs['qa-checks'],before['qa-checks']);assert.deepEqual(store.docs['app:cncPanels'],before['app:cncPanels']);for(const other of candidateIds.filter(id=>id!==selected))assert.equal(store.docs['qa-panel-area:'+other],undefined);
  const audit=store.audits.find(event=>event.event==='qa-panel-area-pdf-imported').detail;assert.equal(audit.panels[0].id,selected);assert.equal(audit.panels[0].matchConfirmed,true);assert.deepEqual(audit.panels[0].candidateIds,candidateIds);const receipt=store.docs['qa-area-import:'+body.importId],saved=JSON.parse(receipt.fingerprint).rows[0];assert.equal(saved.id,selected);assert.equal(saved.matchConfirmed,true);assert.deepEqual(saved.expectedCandidateIds,candidateIds);
 }
});

test('failed and replaced candidates remain visible in the reviewed set but cannot receive an imported area',()=>{
 for(const id of ['failed','replaced']){const {store,candidateIds}=duplicateFixture(),before=structuredClone(store.docs);assert.throws(()=>importPanelAreas(store,selectedBody(store,id,candidateIds),admin),error=>error.status===409);assert.deepEqual(store.docs,before);assert.equal(store.writes,0);assert.equal(store.audits.length,0);}
 const {store,candidateIds}=duplicateFixture();assert.throws(()=>importPanelAreas(store,selectedBody(store,'awaiting',candidateIds.filter(id=>!['failed','replaced'].includes(id))),actor),error=>error.status===409);assert.equal(store.writes,0);
});

test('ambiguity requires explicit confirmation and the complete current candidate snapshot; malformed or partial sets never write',()=>{
 const mutations=[row=>{delete row.matchConfirmed;},row=>{row.matchConfirmed=false;},row=>{row.matchConfirmed='true';},row=>{delete row.expectedCandidateIds;},row=>{row.expectedCandidateIds=[];},row=>{row.expectedCandidateIds=['awaiting'];},row=>{row.expectedCandidateIds.push(row.expectedCandidateIds[0]);},row=>{row.expectedCandidateIds.reverse();},row=>{row.expectedCandidateIds=[...row.expectedCandidateIds.slice(0,-1),42];},row=>{row.expectedCandidateIds=[...row.expectedCandidateIds.slice(0,-1),' '];},row=>{row.expectedCandidateIds='approved,awaiting';}];
 for(const mutate of mutations){const {store,candidateIds}=duplicateFixture(),body=selectedBody(store,'awaiting',candidateIds);mutate(body.rows[0]);const before=structuredClone(store.docs);assert.throws(()=>importPanelAreas(store,body,actor));assert.deepEqual(store.docs,before);assert.equal(store.writes,0);assert.equal(store.transactions,0);assert.equal(store.audits.length,0);}
 const unique=fixture(),body=input({rows:[{...input().rows[0],matchConfirmed:true}]});assert.throws(()=>importPanelAreas(unique,body,actor),error=>error.status===400);assert.equal(unique.writes,0);const orphan=input({rows:[{...input().rows[0],expectedCandidateIds:['a']}]});assert.throws(()=>importPanelAreas(unique,orphan,actor),error=>error.status===400);assert.equal(unique.writes,0);
});

test('adding, removing or changing a completed matching candidate invalidates an old explicit review even when its selected record remains valid',()=>{
 const mutations=[store=>store.docs['app:cncPanels'].push(panel('new-match',{panelNumber:'P-7'})),store=>{store.docs['app:cncPanels']=store.docs['app:cncPanels'].filter(panel=>panel.id!=='failed');},store=>{store.docs['app:cncPanels'].find(panel=>panel.id==='failed').panelNumber='Different reference';},store=>{store.docs['app:cncPanels'].find(panel=>panel.id==='failed').status='pending';}];
 for(const mutate of mutations){const {store,candidateIds}=duplicateFixture(),body=selectedBody(store,'awaiting',candidateIds);mutate(store);const before=structuredClone(store.docs);assert.throws(()=>importPanelAreas(store,body,actor),error=>error.status===409);assert.deepEqual(store.docs,before);assert.equal(store.writes,0);assert.equal(store.audits.length,0);}
});

test('explicit selection cannot cross project, order or human reference boundaries or conceal duplicate stable identities',()=>{
 const mutations=[(store,body)=>{store.docs['app:cncPanels'].find(panel=>panel.id==='awaiting').jobReference='Other tower';},(store,body)=>{store.docs['app:cncPanels'].find(panel=>panel.id==='awaiting').orderNumber='043';},(store,body)=>{body.rows[0].reference='Other reference';},(store,body)=>{store.docs['app:cncPanels'].push(panel('awaiting',{jobReference:'Other tower',panelNumber:'Other reference'}));},(store,body)=>{store.docs['qa-checks'].push({...store.docs['qa-checks'].find(record=>record.id==='awaiting')});},(store,body)=>{store.docs['qa-checks'].find(record=>record.id==='awaiting').kind='metalwork';}];
 for(const mutate of mutations){const {store,candidateIds}=duplicateFixture(),body=selectedBody(store,'awaiting',candidateIds);mutate(store,body);const before=structuredClone(store.docs);assert.throws(()=>importPanelAreas(store,body,actor),error=>error.status===409);assert.deepEqual(store.docs,before);assert.equal(store.writes,0);}
 const {store,candidateIds}=duplicateFixture(),body=selectedBody(store,'awaiting',candidateIds);body.rows.push({...structuredClone(body.rows[0]),page:4});assert.throws(()=>importPanelAreas(store,body,actor));assert.equal(store.writes,0);assert.equal(store.transactions,0);
});

test('confirmed candidate selection keeps CNC cut, QA attempt, area revision and manager permission guards intact',()=>{
 for(const patch of [{cutAt:'old-cut'},{expectedAttemptId:'old-inspection'},{expectedAreaRevision:99}]){const {store,candidateIds}=duplicateFixture(),body=selectedBody(store,'approved',candidateIds);Object.assign(body.rows[0],patch);assert.throws(()=>importPanelAreas(store,body,actor),error=>error.status===409);assert.equal(store.writes,0);}
 const {store,candidateIds}=duplicateFixture();store.docs['qa-panel-area:approved']={revision:1,cutAt:cut,value:{method:'manual',areaM2:2.5}};const body=selectedBody(store,'approved',candidateIds);body.rows[0].expectedAreaRevision=1;assert.throws(()=>importPanelAreas(store,body,actor),error=>error.status===403);assert.equal(store.writes,0);assert.equal(importPanelAreas(store,body,admin).savedCount,1);assert.equal(store.docs['qa-panel-area:approved'].value.areaM2,1.234);
 const denied=duplicateFixture();assert.throws(()=>importPanelAreas(denied.store,selectedBody(denied.store,'awaiting',denied.candidateIds),{username:'viewer',tasks:{}}),error=>error.status===403);assert.equal(denied.store.writes,0);
});

test('an exact lost-response retry retains its chosen record and reviewed candidates without overwriting a later correction',()=>{
 const {store,candidateIds}=duplicateFixture(),body=selectedBody(store,'awaiting',candidateIds),result=importPanelAreas(store,body,actor);store.docs['app:cncPanels'].push(panel('later-candidate',{panelNumber:'P-7'}));store.docs['qa-panel-area:awaiting']={revision:2,cutAt:cut,value:{method:'manual',areaM2:9.87}};const before=structuredClone(store.docs),counts=[store.writes,store.transactions,store.audits.length];assert.deepEqual(importPanelAreas(store,body,actor),result);assert.deepEqual(store.docs,before);assert.deepEqual([store.writes,store.transactions,store.audits.length],counts);
 const changed=structuredClone(body);changed.rows[0].expectedCandidateIds.push('later-candidate');assert.throws(()=>importPanelAreas(store,changed,actor),error=>error.status===409);const otherChoice=structuredClone(body);otherChoice.rows[0].id='approved';otherChoice.rows[0].expectedAttemptId='inspection-approved';assert.throws(()=>importPanelAreas(store,otherChoice,actor),error=>error.status===409);assert.throws(()=>importPanelAreas(store,body,admin),error=>error.status===409);
 store.docs['qa-panel-area-reset-generation']='new-generation';assert.throws(()=>importPanelAreas(store,body,actor),error=>error.status===409);assert.equal(store.docs['qa-panel-area:awaiting'].value.areaM2,9.87);
});

test('generation races and persistence failures cannot leave a partial candidate-matched area import or receipt',()=>{
 const racing=duplicateFixture(),body=selectedBody(racing.store,'awaiting',racing.candidateIds);racing.store.beforeTransaction(()=>{racing.store.docs['qa-panel-area-reset-generation']='concurrent-reset';});assert.throws(()=>importPanelAreas(racing.store,body,actor),error=>error.status===409);assert.equal(racing.store.writes,0);assert.equal(racing.store.audits.length,0);assert.equal(racing.store.docs['qa-panel-area:awaiting'],undefined);
 const failed=duplicateFixture(),batch=selectedBody(failed.store,'awaiting',failed.candidateIds);batch.rows.push({...selectedBody(failed.store,'approved',failed.candidateIds).rows[0],page:4});const before=structuredClone(failed.store.docs);failed.store.failWrite('qa-area-import:'+batch.importId);assert.throws(()=>importPanelAreas(failed.store,batch,actor),/Simulated storage failure/);assert.deepEqual(failed.store.docs,before);assert.equal(failed.store.writes,0);assert.equal(failed.store.audits.length,0);
});

test('hidden pre-QA duplicates do not make a visible unique reference ambiguous and never receive its area',()=>{
 const oldCut='2026-10-01T00:00:00Z',store=fixture([panel('a'),panel('hidden',{panelNumber:'A',completedAt:oldCut})],[record('a'),record('hidden')]),body=input({rows:[input().rows[0]]}),before=structuredClone(store.docs),result=importPanelAreas(store,body,actor);assert.equal(result.savedCount,1);assert.deepEqual(result.items.map(item=>item.id),['a']);assert.equal(store.docs['qa-panel-area:a'].value.areaM2,.859);assert.equal(store.docs['qa-panel-area:hidden'],undefined);assert.deepEqual(store.docs['qa-checks'],before['qa-checks']);assert.deepEqual(store.docs['app:cncPanels'],before['app:cncPanels']);assert.deepEqual(store.audits.find(event=>event.event==='qa-panel-area-pdf-imported').detail.panels[0].candidateIds,['a']);
});

test('an explicit review snapshots only visible QA candidates; enrolling a formerly hidden legacy duplicate invalidates it',()=>{
 const oldCut='2026-10-01T00:00:00Z',initial=duplicateFixture();initial.store.docs['app:cncPanels'].push(panel('hidden',{panelNumber:'P-7',completedAt:oldCut}));initial.store.docs['qa-checks'].push(record('hidden'));const body=selectedBody(initial.store,'awaiting',initial.candidateIds);assert.equal(importPanelAreas(initial.store,body,actor).savedCount,1);assert.deepEqual(initial.store.audits.find(event=>event.event==='qa-panel-area-pdf-imported').detail.panels[0].candidateIds,initial.candidateIds);
 const stale=duplicateFixture();stale.store.docs['app:cncPanels'].push(panel('hidden',{panelNumber:'P-7',completedAt:oldCut}));stale.store.docs['qa-checks'].push(record('hidden'));const oldReview=selectedBody(stale.store,'awaiting',stale.candidateIds);stale.store.docs['qa-checks'].find(record=>record.id==='hidden').qaReset={schemaVersion:1,id:'qa-reset-enrolled-legacy-0001',cutAt:oldCut,by:'admin',at:'2026-11-26T00:00:00Z',pending:true};const before=structuredClone(stale.store.docs);assert.throws(()=>importPanelAreas(stale.store,oldReview,actor),error=>error.status===409);assert.deepEqual(stale.store.docs,before);assert.equal(stale.store.writes,0);
});

test('hidden pre-QA rows cannot be selected directly and cannot conceal a globally duplicated stable ID',()=>{
 const oldCut='2026-10-01T00:00:00Z',hidden=duplicateFixture();hidden.store.docs['app:cncPanels'].push(panel('hidden',{panelNumber:'P-7',completedAt:oldCut}));hidden.store.docs['qa-checks'].push(record('hidden'));const body=selectedBody(hidden.store,'hidden',hidden.candidateIds);assert.throws(()=>importPanelAreas(hidden.store,body,actor),error=>error.status===409);assert.equal(hidden.store.writes,0);
 const global=fixture([panel('a'),panel('a',{panelNumber:'Other reference',jobReference:'Other tower',completedAt:oldCut})],[record('a')]);assert.throws(()=>importPanelAreas(global,input({rows:[input().rows[0]]}),actor),error=>error.status===409);assert.equal(global.writes,0);assert.equal(global.audits.length,0);
});
