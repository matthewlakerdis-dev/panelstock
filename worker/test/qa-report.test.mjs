import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {migrateQaRecords} from '../src/qa-status.js';
import {panelQaResolution} from '../src/qa-resolution.js';
import {requireCondition as check} from '../src/security.js';

const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const method=(name,next)=>source.slice(source.indexOf(`  ${name}(`),source.indexOf(`  ${next}(`));
const methods=[method('qaPanelItem','qaItemsFor'),method('qaOrderReport','createQaMetalwork'),method('requireTask','requireMutationTasks')].join(',');
const makeMethods=new Function('cleanText','check','ok','migrateQaRecords','panelQaResolution',`return ({${methods}});`);
const cleanText=(value,max=200)=>String(value||'').trim().slice(0,max);
const admin={username:'inspector',isAdmin:true};
const panel=(id,overrides={})=>({id,jobReference:'Tower',orderNumber:'007',sheetNumber:'2',panelNumber:'1',status:'completed',completedAt:'2026-10-15T00:00:00Z',completedBy:'operator',...overrides});
function store(panels,records=[]){
  const data={'app:cncPanels':panels,'qa-checks':records},settings={enabledFrom:'2026-10-01T00:00:00Z',panelChecks:[['finish','Finish'],['inactive','An inactive check']],activePanelChecks:['finish']};
  return Object.assign(makeMethods(cleanText,check,(body,status=200)=>({body,status}),migrateQaRecords,panelQaResolution),{read:(key,fallback)=>data[key]??fallback,qaSettings:()=>settings,data});
}

test('order reports include every panel phase, inspections and inactive check labels without altering QA records',()=>{
  const attempt={id:'inspection',status:'rework',results:{finish:'fail',removed:'na'},notes:'Scratch',photo:'data:image/png;base64,aGVsbG8=',checkedBy:'qa-person',checkedAt:'2026-10-16T00:00:00Z',overrideReason:'Reason'},
    records=[{id:'original',kind:'panel',status:'replaced',replacementId:'replacement',replacementStatus:'approved',latest:attempt,history:[attempt]},{id:'replacement',kind:'panel',status:'approved',remakeOf:'original',latest:{...attempt,status:'approved'},history:[{...attempt,status:'approved'}]}],
    panels=[panel('pending',{status:'pending',completedAt:null}),panel('legacy',{completedAt:'2026-09-30T23:59:59Z'}),panel('missing-time',{completedAt:null}),panel('awaiting'),panel('original'),panel('replacement',{isRemake:true}),panel('different-project',{jobReference:'Other'}),panel('different-order',{orderNumber:'008'})],
    reader=store(panels,records),before=JSON.stringify(reader.data),{status,body}=reader.qaOrderReport({project:' tower ',orderNumber:' 007 '},admin),report=body.report;
  assert.equal(status,200);
  assert.equal(report.items.length,6);
  const byId=new Map(report.items.map(item=>[item.id,item]));
  assert.equal(byId.get('pending').status,'awaiting_routing');
  assert.equal(byId.get('pending').qaResolved,false);
  assert.equal(byId.get('pending').qaBlocker,'Awaiting routing');
  assert.equal(byId.get('legacy').status,'pre_qa');
  assert.equal(byId.get('legacy').qaResolved,false);
  assert.equal(byId.get('legacy').qaBlocker,'Pre-QA');
  assert.equal(byId.get('missing-time').status,'pre_qa');
  assert.equal(byId.get('awaiting').status,'awaiting');
  assert.equal(byId.get('original').status,'replaced');
  assert.equal(byId.get('original').history[0].status,'recut');
  assert.deepEqual(byId.get('original').latest.results,attempt.results);
  assert.equal(byId.get('original').latest.photo,attempt.photo);
  assert.equal(byId.get('original').latest.overrideReason,'Reason');
  assert.equal(byId.get('original').replacementReference,'1');
  assert.equal(byId.get('replacement').remakeOfReference,'1');
  assert.equal(byId.get('replacement').cutBy,'operator');
  assert.deepEqual(report.checklists.panel,[['finish','Finish'],['inactive','An inactive check']]);
  assert.equal(report.project,'tower');
  assert.equal(report.orderNumber,'007');
  assert.equal(report.generatedBy,'inspector');
  assert.ok(Number.isFinite(Date.parse(report.generatedAt)));
  assert.equal(JSON.stringify(reader.data),before);
});

test('order reports naturally sort sheets and panel references and distinguish duplicate/remake rows',()=>{
  const reader=store([panel('sheet10',{sheetNumber:'10'}),panel('panel10',{panelNumber:'10'}),panel('b',{panelNumber:'2'}),panel('a',{panelNumber:'2',isRemake:true}),panel('sheet1',{sheetNumber:'1'})]);
  const report=reader.qaOrderReport({project:'Tower',orderNumber:'007'},admin).body.report;
  assert.deepEqual(report.items.map(item=>item.id),['sheet1','a','b','panel10','sheet10']);
});

test('order reports require an administrator and valid exact order identity',()=>{
  const reader=store([panel('panel')]);
  for(const actor of [{username:'blocked',tasks:{}},{username:'staff',tasks:{'factory.qa':true}}])assert.throws(()=>reader.qaOrderReport({project:'Tower',orderNumber:'007'},actor),error=>error.status===403);
  for(const body of [{},{project:'Tower'},{project:'',orderNumber:'007'},{project:'Tower',orderNumber:' '},{project:{},orderNumber:'007'},{project:'Tower',orderNumber:7},{project:'T'.repeat(121),orderNumber:'007'}])assert.throws(()=>reader.qaOrderReport(body,admin),error=>error.status===400);
  for(const body of [{project:'Other',orderNumber:'007'},{project:'Tower',orderNumber:'7'},{project:'Tower',orderNumber:'008'}])assert.throws(()=>reader.qaOrderReport(body,admin),error=>error.status===404);
});
