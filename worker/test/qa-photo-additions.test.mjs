import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {requireCondition as check} from '../src/security.js';
import {prepareQaPhotoAddition} from '../src/qa-photo-additions.js';
import {qaAttemptPhotos,qaInspectionPhotoGallery} from '../src/qa-photos.js';
import {panelQaResolution} from '../src/qa-resolution.js';
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8'),declaration=source.slice(source.indexOf('const supportPhoto='),source.indexOf('function normalizeEmployeeProfile'));
const validatePhoto=new Function('check',`${declaration}return supportPhoto;`)(check),png='data:image/png;base64,aGVsbG8=',jpeg='data:image/jpeg;base64,d29ybGQ=',webp='data:image/webp;base64,dGhpcmQ=',actor={username:'qa-team',tasks:{'factory.qa':true}},at='2026-11-09T01:00:00Z';
const attempt=(extra={})=>({id:'saved-attempt',status:'approved',results:{finish:'pass'},notes:'Original inspection note',photo:png,checkedBy:'original-inspector',checkedAt:'2026-11-08T01:00:00Z',...extra});
const record=(extra={})=>{const saved=attempt();return {id:'panel-1',kind:'panel',status:'approved',latest:structuredClone(saved),history:[structuredClone(saved)],qaExemptionHistory:[{action:'revoke',reason:'Keep this audit'}],...extra};};
const payload=(extra={})=>({id:'panel-1',kind:'panel',attemptId:'saved-attempt',photos:[jpeg],mutationId:crypto.randomUUID(),...extra});
const append=(records,body=payload(),user=actor)=>prepareQaPhotoAddition(records,body,user,validatePhoto,at);
const sizedPhoto=size=>'data:image/png;base64,'+'A'.repeat(size-'data:image/png;base64,'.length);

test('QA team members append separately attributed evidence without changing the saved inspection or record state',()=>{
 const records=[record(),{id:'other',kind:'metalwork',status:'awaiting'}],before=structuredClone(records),body=payload({results:{finish:'fail'},status:'recut',checkedBy:'forged'}),result=append(records,body);
 assert.deepEqual(records,before);assert.equal(result.idempotent,false);assert.equal(result.addition.addedBy,actor.username);assert.equal(result.addition.addedAt,at);assert.equal(result.addition.attemptId,'saved-attempt');assert.deepEqual(result.addition.photos,[jpeg]);
 const {photoAdditions,...otherwiseUnchanged}=result.record;assert.deepEqual(otherwiseUnchanged,before[0]);assert.equal(photoAdditions.length,1);assert.deepEqual(result.records[1],before[1]);
 assert.deepEqual(qaInspectionPhotoGallery(result.record,result.record.latest),[png,jpeg]);assert.deepEqual(result.record.latest,records[0].latest);assert.deepEqual(result.record.history,records[0].history);
});

test('gallery joins preserve original photos and legacy aliases, and supplements match only their exact inspection',()=>{
 assert.deepEqual(qaAttemptPhotos({photo:png,photos:[png,jpeg]}),[png,jpeg]);assert.deepEqual(qaAttemptPhotos({photo:png,photos:[]}),[png]);assert.deepEqual(qaAttemptPhotos({photo:png,photos:[jpeg]}),[png,jpeg]);
 const current=record({photoAdditions:[{attemptId:'saved-attempt',photos:[jpeg,webp]},{attemptId:'older',photos:[webp]}]});
 assert.deepEqual(qaInspectionPhotoGallery(current,current.latest),[png,jpeg,webp]);assert.deepEqual(qaInspectionPhotoGallery(current,attempt({id:'older'})),[png,webp]);assert.deepEqual(qaInspectionPhotoGallery(current,attempt({id:undefined})),[png]);
});

test('retries are idempotent before quota checks, and mutation reuse across item, kind, attempt, actor or bytes conflicts',()=>{
 const original=record({latest:attempt({photos:Array(9).fill(png)}),history:[attempt({photos:Array(9).fill(png)})]}),body=payload(),first=append([original],body),retry=append(first.records,body);
 assert.equal(retry.idempotent,true);assert.deepEqual(retry.addition,first.addition);assert.deepEqual(retry.records,first.records);assert.equal(qaInspectionPhotoGallery(retry.record,retry.record.latest).length,10);
 for(const changed of [{id:'another'},{kind:'metalwork'},{attemptId:'another'},{photos:[webp]},{photos:[]},{photos:null}])assert.throws(()=>append(first.records,{...body,...changed}),error=>error.status===409);
 assert.throws(()=>append(first.records,body,{username:'other-team',tasks:{'factory.qa':true}}),error=>error.status===409);
 assert.throws(()=>append(first.records,payload()),/no more than 10/);
});

test('different upload requests preserve each other and original history across later inspections',()=>{
 const first=append([record()],payload({photos:[jpeg]})),next=append(first.records,payload({photos:[webp]}));
 assert.deepEqual(next.record.photoAdditions.map(addition=>addition.photos),[[jpeg],[webp]]);assert.deepEqual(qaInspectionPhotoGallery(next.record,next.record.latest),[png,jpeg,webp]);
 const rechecked={...next.record,status:'approved',latest:attempt({id:'new-inspection'}),history:[...next.record.history,attempt({id:'new-inspection'})]};
 const historical=append([rechecked],payload({photos:[jpeg]}));assert.equal(historical.record.latest.id,'new-inspection');assert.equal(historical.record.history.length,2);assert.deepEqual(qaInspectionPhotoGallery(historical.record,historical.record.latest),[png]);assert.equal(qaInspectionPhotoGallery(historical.record,historical.record.history[0]).length,4);
});

test('supported saved attempts remain appendable after replacement, dispatch and withdrawal of a Gate revision',()=>{
 for(const status of ['approved','recut','rework']){
  const saved=attempt({status}),stored=record({kind:'metalwork',gateOrderId:'old-gate',gateRevision:'old-revision',status:'replaced',latest:saved,history:[saved],dispatchStatus:'dispatched'}),result=append([stored],payload({kind:'metalwork'}));
  assert.equal(result.record.status,'replaced');assert.deepEqual(result.record.latest,saved);assert.equal(result.record.gateRevision,'old-revision');
 }
});

test('only an actual saved inspection can receive evidence; missing or conflicting attempt identities fail closed',()=>{
 assert.throws(()=>append([],payload()),error=>error.status===404);
 assert.throws(()=>append([record()],payload({kind:'metalwork'})),error=>error.status===404);
 assert.throws(()=>append([record()],payload({attemptId:'not-saved'})),error=>error.status===404);
 assert.throws(()=>append([record({status:'not_required',latest:null,history:[]})]),error=>error.status===404);
 assert.throws(()=>append([record({latest:attempt({checkedBy:'conflicting'})})]),error=>error.status===409);
 const reversed=Object.fromEntries(Object.entries(attempt()).reverse());assert.equal(append([record({latest:reversed})]).idempotent,false);
 assert.throws(()=>append([record({latest:attempt({id:undefined}),history:[attempt({id:undefined})]})]),error=>error.status===404);
 assert.throws(()=>append([record({latest:attempt({status:'awaiting'}),history:[attempt({status:'awaiting'})]})]),error=>error.status===409);
});

test('malformed selectors, unsupported photos and oversized selections reject without modifying any record',()=>{
 const records=[record()],before=structuredClone(records);
 const invalid=[null,[],{},payload({id:''}),payload({kind:'gate'}),payload({attemptId:''}),payload({mutationId:'short'}),payload({photos:null}),payload({photos:[]}),payload({photos:['']}),payload({photos:[null]}),payload({photos:['https://example.com/photo.jpg']}),payload({photos:['data:image/gif;base64,aGVsbG8=']}),payload({photos:Array(11).fill(jpeg)}),payload({photos:[sizedPhoto(1500001)]})];
 for(const body of invalid){assert.throws(()=>append(records,body));assert.deepEqual(records,before);}
 assert.throws(()=>append(records,payload(),{username:'viewer',tasks:{}}),error=>error.status===403);
});

test('effective encoded-size limits include every original photo and supplement and never truncate evidence',()=>{
 const base=sizedPhoto(1500000),saved=attempt({photo:base}),stored=record({latest:saved,history:[saved]}),first=append([stored],payload({photos:Array(3).fill(base)}));
 assert.equal(qaInspectionPhotoGallery(first.record,first.record.latest).reduce((total,photo)=>total+photo.length,0),6000000);
 assert.throws(()=>append(first.records,payload({photos:[jpeg]})),/total no more than/);
 assert.throws(()=>append([stored],payload({photos:Array(4).fill(base)})),/total no more than/);
 assert.equal(first.record.photoAdditions[0].photos.length,3);
});

const method=(name,next)=>source.slice(source.indexOf(`  ${name}(`),source.indexOf(`  ${next}(`));
const methods=[method('addQaInspectionPhotos','qaPanelExemptionsFor'),method('qaPanelItem','qaItemsFor')].join(',');
const makeStore=new Function('prepareQaPhotoAddition','supportPhoto','check','ok','panelQaResolution','cleanText',`return ({${methods}});`);
function storeFixture(records=[record()],panels=[{id:'panel-1',jobReference:'Project',orderNumber:'001',panelNumber:'P1',status:'completed',completedAt:'2026-11-08T00:00:00Z'}]){
 const docs=new Map([['qa-checks',structuredClone(records)],['app:cncPanels',structuredClone(panels)],['orders',[{status:'dispatched'}]],['panel-dispatch-loads',[{id:'sent',status:'dispatched_to_site',panelIds:['panel-1']}]]]),writes=[],audits=[];
 const store=Object.assign(makeStore(prepareQaPhotoAddition,validatePhoto,check,(body,status=200)=>({body,status}),panelQaResolution,(value,max=200)=>String(value||'').trim().slice(0,max)),{
  read:(key,fallback)=>structuredClone(docs.get(key)??fallback),write:(key,value)=>{writes.push(key);docs.set(key,structuredClone(value));},audit:(...args)=>audits.push(args),ctx:{storage:{transactionSync:fn=>fn()}},qaChecklists:()=>({panel:[['finish','Finish']]}),
  requireTask:(user,key)=>check(user.isAdmin||user.tasks?.[key],'Task denied',403),qaItemsFor(){throw Error('Must not migrate inspection history');},syncPanelLoads(){throw Error('Must not change dispatch');},notify(){throw Error('Must not notify');}
 });
 return {store,docs,writes,audits};
}

test('the endpoint writes only evidence plus one audit and idempotent retries do not repeat either write',()=>{
 const f=storeFixture(),before=structuredClone([...f.docs]),body=payload(),first=f.store.addQaInspectionPhotos(body,actor).body;
 assert.equal(first.ok,true);assert.equal(first.idempotent,false);assert.deepEqual(first.item.photoAdditions,[first.addition]);assert.deepEqual(first.item.latest,record().latest);assert.deepEqual(first.item.history,record().history);assert.deepEqual(f.writes,['qa-checks']);assert.equal(f.audits.length,1);
 for(const [key,value] of before)if(key!=='qa-checks')assert.deepEqual(f.docs.get(key),value);
 const retry=f.store.addQaInspectionPhotos(body,actor).body;assert.equal(retry.idempotent,true);assert.deepEqual(retry.addition,first.addition);assert.deepEqual(f.writes,['qa-checks']);assert.equal(f.audits.length,1);
});

test('deleted CNC panels fail before writes and saved withdrawn Gate records return directly without currentness checks',()=>{
 const deleted=storeFixture([record()],[]);assert.throws(()=>deleted.store.addQaInspectionPhotos(payload(),actor),error=>error.status===404);assert.equal(deleted.writes.length,0);
 const saved=attempt({status:'rework'}),gate=record({kind:'metalwork',gateOrderId:'old-gate',gateRevision:'withdrawn',latest:saved,history:[saved]}),f=storeFixture([gate],[]),result=f.store.addQaInspectionPhotos(payload({kind:'metalwork'}),actor).body;
 assert.equal(result.item.gateRevision,'withdrawn');assert.equal(result.item.latest.status,'rework');assert.equal(f.docs.get('qa-checks')[0].latest.status,'rework');assert.equal(result.item.checklistKind,'gate');
});
