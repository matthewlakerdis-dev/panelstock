import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewPanelAreaReset,resetPanelAreas,readPanelAreaResetBackup} from '../src/qa-panel-area-reset.js';
import {panelAreaFor,preparePanelArea,commitPanelArea,PANEL_AREA_RESET_GENERATION_KEY} from '../src/qa-panel-area.js';
import {importPanelAreas} from '../src/qa-panel-area-import.js';

const admin={username:'admin',isAdmin:true},staff={username:'qa',tasks:{'factory.qa':true}},cut='2026-11-20T00:00:00Z';
const panel=(id,extra={})=>({id,status:'completed',jobReference:'Tower',orderNumber:'25',sheetNumber:'1',panelNumber:id.toUpperCase(),completedAt:cut,panelAreaScope:'panel',totalPanelArea:3,panelWidth:1200,panelHeight:2400,...extra});
const inspection=id=>({id,kind:'panel',status:'approved',latest:{id:'check-'+id,status:'approved',checkedAt:'2026-11-21T00:00:00Z',checkedBy:'qa',panelArea:{method:'manual',areaM2:2},photo:'PRIVATE PHOTO',results:{finish:'pass'}},history:[{id:'first-'+id,status:'recut',notes:'PRIVATE NOTES',photo:'OTHER PRIVATE PHOTO'}]});
function fixture(panels=[panel('a'),panel('b',{jobReference:'Other tower',orderNumber:'26'})],records=[inspection('a')]){
  const docs={'app:cncPanels':structuredClone(panels),'qa-checks':structuredClone(records)},audits=[],writes=[];let transactions=0,beforeTransaction=null;
  const store={docs,audits,writes,get transactions(){return transactions;},read:(key,fallback)=>Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback,readQaForDispatch:()=>structuredClone(docs['qa-checks']),qaSettings:()=>({enabledFrom:cut}),write:(key,value)=>{writes.push(key);docs[key]=structuredClone(value);},audit:(by,event,detail)=>audits.push({by,event,detail}),setBeforeTransaction:callback=>{beforeTransaction=callback;},ctx:{storage:{transactionSync:callback=>{
    transactions++;if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;hook();}
    const before=structuredClone(docs),auditBefore=audits.length,writeBefore=writes.length;
    try{return callback();}catch(error){for(const key of Object.keys(docs))delete docs[key];Object.assign(docs,before);audits.splice(auditBefore);writes.splice(writeBefore);throw error;}
  }}}};return store;
}
const request=(store,extra={})=>({resetId:'qa-reset-operation-0001',expectedSnapshot:previewPanelAreaReset(store,admin).snapshot,reason:'Replace QA areas with sticker totals',...extra});
const areaInput=(id='a',extra={})=>({panelArea:{method:'manual',areaM2:1.234},cutAt:cut,expectedAttemptId:id==='a'?'check-a':null,expectedAreaRevision:0,...extra});
const pdfInput=(store,extra={})=>({importId:'pdf-area-import-0001',fileName:'stickers.pdf',project:'Tower',orderNumber:'25',rows:[{id:'a',reference:'A',page:1,...areaInput('a',{expectedAreaRevision:store.docs['qa-panel-area:a']?.revision||0})}],...extra});

test('reset suppresses all historical and production fallbacks without changing any inspection, CNC or other QA state',()=>{
  const store=fixture([panel('a'),panel('b',{jobReference:'Other tower',orderNumber:'26'}),panel('pending',{status:'pending'})],[inspection('a'),{id:'gate',kind:'metalwork',status:'approved',latest:{panelArea:{method:'manual',areaM2:4}}}]);
  store.docs['qa-panel-area:a']={value:{method:'manual',areaM2:1.5},revision:4,cutAt:cut,updatedBy:'old-admin'};
  store.docs['qa-area-import:unrelated']={untouched:true};
  const cnc=JSON.stringify(store.docs['app:cncPanels']),qa=JSON.stringify(store.docs['qa-checks']),preview=previewPanelAreaReset(store,admin);
  assert.equal(preview.panelCount,2);assert.equal(preview.knownAreaCount,2);assert.deepEqual(preview.statusCounts,{approved:1,awaiting:1});assert.equal(store.writes.length,0);
  const body=request(store),result=resetPanelAreas(store,body,admin);
  assert.equal(result.panelCount,2);assert.equal(result.backupId,'qa-panel-area-backup:'+body.resetId);assert.equal(result.generation,body.resetId);
  assert.equal(JSON.stringify(store.docs['app:cncPanels']),cnc);assert.equal(JSON.stringify(store.docs['qa-checks']),qa);
  assert.deepEqual(store.docs['qa-area-import:unrelated'],{untouched:true});assert.equal(store.docs['qa-panel-area:pending'],undefined);
  for(const id of ['a','b'])assert.equal(panelAreaFor(store.docs['app:cncPanels'].find(p=>p.id===id),store.docs['qa-checks'].find(r=>r.id===id),store.docs['qa-panel-area:'+id]),null);
  assert.equal(panelAreaFor(panel('a',{completedAt:'a-new-cut'}),inspection('a'),store.docs['qa-panel-area:a']),null);
  assert.equal(store.docs['qa-panel-area:a'].revision,5);assert.equal(store.docs['qa-panel-area:b'].revision,1);
  assert.equal(store.audits.length,1);assert.equal(store.audits[0].event,'qa-panel-areas-reset');
  const backup=store.docs[result.backupId];assert.deepEqual(backup.documents.find(d=>d.key==='qa-panel-area:a'),{key:'qa-panel-area:a',existed:true,value:{value:{method:'manual',areaM2:1.5},revision:4,cutAt:cut,updatedBy:'old-admin'}});
  assert.deepEqual(backup.documents.find(d=>d.key==='qa-panel-area:b'),{key:'qa-panel-area:b',existed:false});
  assert.deepEqual(backup.documents.find(d=>d.key===PANEL_AREA_RESET_GENERATION_KEY),{key:PANEL_AREA_RESET_GENERATION_KEY,existed:false});
  assert.equal(backup.targets.length,2);assert.equal(previewPanelAreaReset(store,admin).knownAreaCount,0);
});

test('all panel QA states are reset while status, failure history and exemption evidence remain intact',()=>{
  const statuses=['approved','awaiting','recut','replaced','not_required'],panels=statuses.map(status=>panel(status)),records=statuses.map(status=>({...inspection(status),status,...(status==='not_required'?{qaExemption:{id:'exemption',productionSignature:'unchanged'},qaExemptionHistory:[{action:'grant'}]}:{})})),store=fixture(panels,records),before=JSON.stringify(records);
  const result=resetPanelAreas(store,request(store),admin);assert.equal(result.panelCount,5);assert.deepEqual(result.statusCounts,Object.fromEntries(statuses.slice().sort().map(status=>[status,1])));assert.equal(JSON.stringify(store.docs['qa-checks']),before);
  for(const panel of panels)assert.equal(panelAreaFor(panel,records.find(record=>record.id===panel.id),store.docs['qa-panel-area:'+panel.id]),null);
});

test('a reset tombstone overrides each independent fallback and remains cleared until an explicit save',()=>{
  const targets=[panel('saved'),panel('inspection',{panelWidth:undefined,panelHeight:undefined}),panel('dimensions'),panel('cnc',{panelWidth:undefined,panelHeight:undefined})],records=[inspection('inspection')],store=fixture(targets,records);
  store.docs['qa-panel-area:saved']={value:{method:'manual',areaM2:1.5},revision:1,cutAt:cut};
  assert.equal(panelAreaFor(targets[0],null,store.docs['qa-panel-area:saved']).areaM2,1.5);assert.equal(panelAreaFor(targets[1],records[0],null).areaM2,2);assert.equal(panelAreaFor(targets[2],null,null).areaM2,2.88);assert.equal(panelAreaFor(targets[3],null,null).areaM2,3);
  resetPanelAreas(store,request(store),admin);
  for(const target of targets)assert.equal(panelAreaFor(target,records.find(record=>record.id===target.id),store.docs['qa-panel-area:'+target.id]),null);
});

test('admin-only preview/reset and invalid reset definitions reject without writes',()=>{
  const store=fixture();assert.throws(()=>previewPanelAreaReset(store,staff),error=>error.status===403);assert.throws(()=>resetPanelAreas(store,{},staff),error=>error.status===403);
  const good=request(store);for(const patch of [{resetId:'short'},{expectedSnapshot:'old'},{reason:''},{reason:'x'.repeat(1001)}])assert.throws(()=>resetPanelAreas(store,{...good,...patch},admin));
  assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);
});

test('snapshot rejects changes to target completion/identity, inspection attempts, exact area docs or generation',()=>{
  for(const mutate of [store=>{store.docs['app:cncPanels'][0].completedAt='changed';},store=>{store.docs['app:cncPanels'][0].panelNumber='CHANGED';},store=>{store.docs['qa-checks'][0].latest.id='changed';},store=>{store.docs['qa-checks'][0].status='recut';},store=>{store.docs['qa-panel-area:a']={value:{method:'manual',areaM2:8},revision:1,cutAt:cut};},store=>{store.docs[PANEL_AREA_RESET_GENERATION_KEY]={id:'another-reset'};}]){
    const store=fixture(),body=request(store);mutate(store);assert.throws(()=>resetPanelAreas(store,body,admin),error=>error.status===409);assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);
  }
  const store=fixture(),body=request(store);store.setBeforeTransaction(()=>{store.docs['qa-checks'][0].latest.checkedAt='new-inspection-time';});assert.throws(()=>resetPanelAreas(store,body,admin),error=>error.status===409);assert.equal(store.writes.length,0);
});

test('snapshot excludes large or cyclic embedded media while preserving dimensional and area staleness guards',()=>{
  const store=fixture(),preview=previewPanelAreaReset(store,admin),cycle={};cycle.self=cycle;
  Object.assign(store.docs['app:cncPanels'][0],{pdfPage:'data:application/pdf;base64,'+'A'.repeat(2000000),attachments:cycle});
  assert.equal(previewPanelAreaReset(store,admin).snapshot,preview.snapshot);
  store.docs['app:cncPanels'][0].pdfPage='different harmless media';assert.equal(previewPanelAreaReset(store,admin).snapshot,preview.snapshot);
  for(const patch of [{panelWidth:1201},{panelHeight:2401},{totalPanelArea:3.1},{panelAreaScope:'sheet'}]){
    const changed=fixture(),body=request(changed);Object.assign(changed.docs['app:cncPanels'][0],patch);assert.throws(()=>resetPanelAreas(changed,body,admin),error=>error.status===409);assert.equal(changed.writes.length,0);
  }
});

test('ambiguous saved identities reject before writes and preview is stable across record ordering',()=>{
  const store=fixture(),first=previewPanelAreaReset(store,admin);store.docs['app:cncPanels'].reverse();assert.equal(previewPanelAreaReset(store,admin).snapshot,first.snapshot);
  for(const makeStore of [()=>fixture([panel('a'),panel('a')]),()=>fixture([panel('a')],[inspection('a'),inspection('a')]),()=>fixture([panel('a')],[{id:'a',kind:'metalwork',status:'approved'}])]){const duplicate=makeStore();assert.throws(()=>previewPanelAreaReset(duplicate,admin),error=>error.status===409);assert.equal(duplicate.writes.length,0);}
});

test('reset retries return their original receipt without clearing later area saves; changed payload/actor reject',()=>{
  const store=fixture(),body=request(store),result=resetPanelAreas(store,body,admin),beforeWrites=store.writes.length;
  const change=preparePanelArea(store,areaInput('a',{expectedAreaRevision:1}),admin,panel('a'),inspection('a'));commitPanelArea(store,panel('a'),change,admin);assert.equal(store.docs['qa-panel-area:a'].value.areaM2,1.234);
  const afterSaveWrites=store.writes.length;assert.deepEqual(resetPanelAreas(store,body,admin),result);assert.equal(store.writes.length,afterSaveWrites);assert.ok(afterSaveWrites>beforeWrites);assert.equal(store.docs['qa-panel-area:a'].value.areaM2,1.234);
  assert.throws(()=>resetPanelAreas(store,{...body,reason:'Different reset'},admin),error=>error.status===409);assert.throws(()=>resetPanelAreas(store,body,{username:'other-admin',isAdmin:true}),error=>error.status===409);
  assert.equal(store.audits.filter(event=>event.event==='qa-panel-areas-reset').length,1);
});

test('stale area saves cannot resurrect reset values and fresh sticker imports count combined assembly area once',()=>{
  const store=fixture(),oldInput=areaInput();resetPanelAreas(store,request(store),admin);
  assert.throws(()=>preparePanelArea(store,oldInput,admin,panel('a'),inspection('a')),error=>error.status===409);
  const beforeQa=JSON.stringify(store.docs['qa-checks']),beforeCnc=JSON.stringify(store.docs['app:cncPanels']),body=pdfInput(store),result=importPanelAreas(store,body,admin);
  assert.equal(result.savedCount,1);assert.equal(result.items[0].panelArea.areaM2,1.234);assert.equal(store.docs['qa-panel-area:a'].revision,2);assert.equal(store.docs['qa-panel-area:a'].resetId,undefined);
  assert.equal(panelAreaFor(panel('a'),inspection('a'),store.docs['qa-panel-area:a']).areaM2,1.234);assert.equal(JSON.stringify(store.docs['qa-checks']),beforeQa);assert.equal(JSON.stringify(store.docs['app:cncPanels']),beforeCnc);
});

test('old import receipts reject after a reset; a fresh import and its retry work within the new generation',()=>{
  const store=fixture(),old=pdfInput(store);importPanelAreas(store,old,admin);resetPanelAreas(store,request(store),admin);
  const writes=store.writes.length;assert.throws(()=>importPanelAreas(store,old,admin),error=>error.status===409);assert.equal(store.writes.length,writes);
  const fresh=pdfInput(store,{importId:'pdf-area-import-0002'}),result=importPanelAreas(store,fresh,admin),after=store.writes.length;assert.deepEqual(importPanelAreas(store,fresh,admin),result);assert.equal(store.writes.length,after);
  assert.equal(store.docs['qa-area-import:'+fresh.importId].generation,'qa-reset-operation-0001');
});

test('legacy import receipts without a generation still retry before any reset but cannot cross a reset',()=>{
  const store=fixture(),body=pdfInput(store),result=importPanelAreas(store,body,admin);delete store.docs['qa-area-import:'+body.importId].generation;
  assert.deepEqual(importPanelAreas(store,body,admin),result);resetPanelAreas(store,request(store),admin);assert.throws(()=>importPanelAreas(store,body,admin),error=>error.status===409);
});

test('a reset generation changed at import commit rejects the batch atomically',()=>{
  const store=fixture(),body=pdfInput(store);store.setBeforeTransaction(()=>{store.docs[PANEL_AREA_RESET_GENERATION_KEY]={id:'concurrent-reset'};});
  assert.throws(()=>importPanelAreas(store,body,admin),error=>error.status===409);assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);assert.equal(store.docs['qa-panel-area:a'],undefined);
});

test('failure partway through reset rolls back backup, generation, area docs, receipt and audit',()=>{
  const store=fixture(),body=request(store),before=structuredClone(store.docs),write=store.write;store.write=(key,value)=>{if(key==='qa-panel-area:b')throw Error('Storage unavailable');write(key,value);};
  assert.throws(()=>resetPanelAreas(store,body,admin),/Storage unavailable/);assert.deepEqual(store.docs,before);assert.equal(store.audits.length,0);assert.equal(store.writes.length,0);
});

test('protected backup read round-trips exact previous values and rejects non-admin, arbitrary document paths and missing resets',()=>{
  const store=fixture();store.docs['qa-panel-area:a']={value:{method:'manual',areaM2:1.987654},revision:8,cutAt:cut,updatedBy:'old-admin'};
  const body=request(store),result=resetPanelAreas(store,body,admin),reads=store.writes.length,backup=readPanelAreaResetBackup(store,{resetId:body.resetId},admin);
  assert.equal(backup.ok,true);assert.deepEqual(backup.backup,store.docs[result.backupId]);assert.equal(backup.backup.documents.find(doc=>doc.key==='qa-panel-area:a').value.value.areaM2,1.987654);assert.equal(store.writes.length,reads);
  assert.throws(()=>readPanelAreaResetBackup(store,{resetId:body.resetId},staff),error=>error.status===403);
  for(const resetId of ['backup:full-app','../app:cncPanels','qa-panel-area:a','short','a'.repeat(81)])assert.throws(()=>readPanelAreaResetBackup(store,{resetId},admin),error=>error.status===400);
  assert.throws(()=>readPanelAreaResetBackup(store,{resetId:'qa-reset-operation-missing'},admin),error=>error.status===404);
  assert.equal(store.writes.length,reads);
});
