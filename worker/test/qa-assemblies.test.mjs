import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capReference,attestQaAssemblyPanels,qaAssemblyRelation,mainQaAssembly,mainAssemblyCoverage,assemblyCheckPlan,preserveQaAssemblyIdLinks,ASSEMBLY_LINK_PREFIX,ASSEMBLY_LINK_RECEIPT} from '../src/qa-assemblies.js';
import {panelQaResolution} from '../src/qa-resolution.js';
import {panelLoadView} from '../src/panel-dispatch.js';
import {qaProductionSignature} from '../src/qa-exemptions.js';
import {cncStickerPhysicalSignature} from '../src/cnc-sticker-review.js';
import {fabricationProductionReportRows} from '../src/fabrication-production-report.js';

const cut='2026-11-20T00:00:00Z',checked='2026-11-21T00:00:00Z';
const main=(extra={})=>({id:'main',panelNumber:'P-7',jobReference:'Tower',orderNumber:'007',sheetNumber:'1',status:'completed',completedAt:cut,completedBy:'Cutter',panelAreaScope:'sheet',totalPanelArea:2.75,...extra});
const cap=(id='left',extra={})=>({...main(),id,panelNumber:'P-7 EP-'+(id==='right'?'R':'L'),sheetNumber:id==='right'?'3':'2',...extra});
const approval=(id='main',extra={})=>({id,kind:'panel',status:'approved',latest:{id:'approval-'+id,status:'approved',checkedAt:checked,checkedBy:'Inspector',results:{finish:'pass'},photo:'PRIVATE PHOTO '+id},history:[{id:'old-'+id,status:'approved',checkedAt:checked,photo:'OLD PRIVATE PHOTO '+id}],...extra});
const failure=(id='left',extra={})=>({id,kind:'panel',status:'recut',latest:{id:'failure-'+id,status:'recut',checkedAt:checked,checkedBy:'Inspector',results:{finish:'fail'},photo:'PRIVATE FAILURE PHOTO'},history:[{id:'prior-failure',status:'recut',photo:'OLD FAILURE PHOTO'}],...extra});
const exemption=p=>({id:p.id,kind:'panel',status:'not_required',latest:null,history:[],qaExemption:{id:'grant-'+p.id,by:'admin',at:checked,reason:'Original QA requirement',cutAt:p.completedAt,productionSignature:qaProductionSignature(p)},qaExemptionHistory:[{id:'grant-event-'+p.id,action:'grant'}]});
const maps=(panels,records=[])=>[new Map(panels.map(panel=>[panel.id,panel])),new Map(records.map(record=>[record.id,record]))];
const resolve=(panel,panels,records=[],ids)=>panelQaResolution(panel,records.find(record=>record.id===panel.id),...maps(panels,records),ids?new Set(ids):undefined);
function memory(docs={}){return {docs,read:(key,fallback)=>Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback,write:()=>{throw Error('Assembly projection must be read-only');}};}
function link(store,component,parent,id='admin-link-0000000001'){
 const value={schemaVersion:1,id,panelId:component.id,mainPanelId:parent.id,side:'L',parentReference:parent.panelNumber};store.docs[ASSEMBLY_LINK_PREFIX+component.id]=value;store.docs[ASSEMBLY_LINK_RECEIPT+id]={link:structuredClone(value)};return value;
}
function freshApproval(panel,panels,records){const assembly=mainQaAssembly(panel,panels,records),snapshot=assemblyCheckPlan(panel,panels,records,{expectedAssemblySignature:assembly.signature});return approval(panel.id,{latest:{...approval(panel.id).latest,id:'fresh-main-approval',checkedAt:'2026-11-22T00:00:00Z',assemblyQa:snapshot}});}

test('only an anchored end-plate suffix classifies a component, including L, R, B and T',()=>{
 for(const side of ['L','R','B','T'])assert.deepEqual(capReference({panelNumber:'  P-7 ep-'+side.toLowerCase()+'  '}),{parentReference:'P-7',side});for(const name of ['P-7','P-7EP-L','EP-L','P-7 EP-LEFT','P-7 EP-L notes','CAP-1','CAP ROUTE'])assert.equal(capReference({panelNumber:name}),null,name);
});

test('legacy relationships use one unique main in the same project and literal order across sheets, preserving ambiguity and orphans',()=>{
 const p=main(),c=cap(),otherProject=main({id:'foreign',jobReference:'Other Tower'}),otherOrder=main({id:'different-order',orderNumber:'7'});assert.equal(qaAssemblyRelation(c,[p,c,otherProject,otherOrder]).mainPanelId,'main');assert.equal(qaAssemblyRelation(c,[p,c]).source,'ep_suffix');assert.equal(qaAssemblyRelation(c,[c]).linkState,'orphan');assert.equal(qaAssemblyRelation(c,[p,c,main({id:'old-failed-main'})]).linkState,'ambiguous');assert.equal(qaAssemblyRelation(c,[p,c,{...p}]).linkState,'ambiguous');assert.equal(qaAssemblyRelation(c,[p,c,{...c}]).linkState,'ambiguous');assert.equal(qaAssemblyRelation(cap('nested',{panelNumber:'P-7 EP-L EP-R'}),[p,c,cap('nested',{panelNumber:'P-7 EP-L EP-R'})]).mainPanelId,null);
 for(const duplicate of [{...p},{...c}])assert.equal(panelLoadView({id:'ambiguous-load',status:'waiting',panelIds:['left']},[p,c,duplicate],[approval()]).qaComplete,false);
});

test('browser metadata cannot mint an opaque component relationship, while immutable reviewed receipts and admin links can attest stable parents',()=>{
 const reviewId='source-review-00000001',p=main({sticker:{reviewId,labelId:'main-label',role:'main',mainPanelId:'main',areaM2:1.234}}),c=cap('left',{panelNumber:'Corrected component label',sticker:{reviewId,labelId:'cap-label',role:'cap',mainPanelId:'main'}}),panels=[p,c],forged=memory();attestQaAssemblyPanels(forged,panels);assert.equal(qaAssemblyRelation(c,panels),null);
 const receipt={schemaVersion:1,reviewId,by:'admin',bindings:{main:{role:'main',labelId:'main-label',mainPanelId:'main',areaM2:1.234,physicalSignature:cncStickerPhysicalSignature(p)},left:{role:'cap',labelId:'cap-label',mainPanelId:'main',physicalSignature:cncStickerPhysicalSignature(c)}}},store=memory({['cnc-sticker-review:'+reviewId]:receipt}),before=JSON.stringify(panels);attestQaAssemblyPanels(store,panels);assert.equal(qaAssemblyRelation(c,panels).mainPanelId,'main');assert.equal(qaAssemblyRelation(c,panels).source,'reviewed_sticker');assert.equal(JSON.stringify(panels),before);const cloned=JSON.parse(JSON.stringify(panels));assert.equal(qaAssemblyRelation(cloned[1],cloned),null);
 const duplicate=main({id:'replacement'}),linked=[main(),cap(),duplicate],manual=memory();link(manual,linked[1],duplicate);attestQaAssemblyPanels(manual,linked);assert.equal(qaAssemblyRelation(linked[1],linked).mainPanelId,'replacement');assert.equal(qaAssemblyRelation(linked[1],linked).source,'admin_link');
});

test('fresh attestation removes an old private association after its supporting link or receipt is revoked',()=>{
 const panels=[main(),cap('left',{panelNumber:'Opaque corrected component'})],store=memory(),saved=link(store,panels[1],panels[0]);attestQaAssemblyPanels(store,panels);assert.equal(qaAssemblyRelation(panels[1],panels).mainPanelId,'main');delete store.docs[ASSEMBLY_LINK_RECEIPT+saved.id];attestQaAssemblyPanels(store,panels);assert.equal(qaAssemblyRelation(panels[1],panels),null);
});

test('legacy approved main QA covers already-cut benign components without creating or changing any inspection history',()=>{
 const panels=[main(),cap(),cap('right')],records=[approval()],before=structuredClone({panels,records}),assembly=mainQaAssembly(panels[0],panels,records);assert.deepEqual(mainAssemblyCoverage(panels[0],records[0],assembly),{covered:true,issues:[]});for(const component of panels.slice(1)){const value=resolve(component,panels,records);assert.equal(value.qaStandaloneRequired,false);assert.equal(value.qaStatus,'included_with_main');assert.equal(value.qaResolved,true);}assert.equal(resolve(panels[0],panels,records).qaResolved,true);assert.deepEqual({panels,records},before);
});

test('a later cap cut, recut or pending status invalidates old coverage until a new matching whole-panel snapshot is approved',()=>{
 const panels=[main(),cap('left',{completedAt:'2026-11-21T12:00:00Z'})],old=approval(),records=[old];assert.equal(resolve(panels[1],panels,records).qaResolved,false);const fresh=freshApproval(panels[0],panels,records);assert.equal(resolve(panels[1],panels,[fresh]).qaResolved,true);const signature=mainQaAssembly(panels[0],panels,[fresh]).signature;panels[1].completedAt='2026-11-23T00:00:00Z';assert.notEqual(mainQaAssembly(panels[0],panels,[fresh]).signature,signature);assert.equal(resolve(panels[1],panels,[fresh]).qaResolved,false);panels[1].status='pending';assert.equal(resolve(panels[1],panels,[fresh]).qaResolved,false);assert.throws(()=>assemblyCheckPlan(panels[0],panels,[fresh],{expectedAssemblySignature:mainQaAssembly(panels[0],panels,[fresh]).signature}),error=>error.status===409);
 const recutMain=[main({completedAt:'2026-11-22T00:00:00Z'}),cap()];assert.equal(resolve(recutMain[1],recutMain,[old]).qaResolved,false);
});

test('a known cap failure needs a fresh exact main snapshot, retains its failed evidence, and a later failure invalidates that coverage again',()=>{
 const panels=[main(),cap()],failed=failure(),old=approval(),records=[old,failed],before=structuredClone(failed);assert.equal(resolve(panels[1],panels,records).qaResolved,false);const fresh=freshApproval(panels[0],panels,records);assert.equal(resolve(panels[1],panels,[fresh,failed]).qaResolved,true);assert.equal(resolve(panels[0],panels,[fresh,failed]).qaResolved,true);assert.deepEqual(failed,before);const later={...failed,latest:{...failed.latest,id:'new-failed-attempt',checkedAt:'2026-11-23T00:00:00Z'}};assert.equal(resolve(panels[1],panels,[fresh,later]).qaResolved,false);assert.equal(failed.status,'recut');
});

test('components never open a standalone check, including orphan or ambiguous labels, and main forms must provide the exact current signature',()=>{
 const panels=[main(),cap()],records=[approval()],assembly=mainQaAssembly(panels[0],panels,records);assert.throws(()=>assemblyCheckPlan(panels[0],panels,records,{}),error=>error.status===409);assert.throws(()=>assemblyCheckPlan(panels[0],panels,records,{expectedAssemblySignature:'old'}),error=>error.status===409);assert.deepEqual(assemblyCheckPlan(panels[0],panels,records,{expectedAssemblySignature:assembly.signature}),assembly.snapshot);
 for(const ps of [[panels[1]],panels,[...panels,main({id:'duplicate-main'})]]){assert.equal(resolve(panels[1],ps,records).qaStandaloneRequired,false);assert.throws(()=>assemblyCheckPlan(panels[1],ps,records,{}),error=>error.status===409);}
});

test('cap exemptions or old standalone cap passes cannot bypass an awaiting, failed, reset or not-yet-cut main panel',()=>{
 const panels=[main(),cap()],capGrant=exemption(panels[1]);for(const parent of [{id:'main',kind:'panel',status:'awaiting'},failure('main'),{...approval(),status:'awaiting',qaReset:{pending:true}}]){const value=resolve(panels[1],panels,[parent,capGrant]);assert.equal(value.qaResolved,false);assert.equal(value.qaStandaloneRequired,false);assert.equal(value.qaExemptionEligible,false);assert.equal(value.qaExemptionRevocable,false);}
 panels[0].status='pending';assert.equal(resolve(panels[1],panels,[approval(),approval('left')]).qaResolved,false);
});

test('a genuine original main exemption covers benign caps without inventing inspection evidence, but expired grants or known cap failures remain blocked',()=>{
 const panels=[main(),cap()],grant=exemption(panels[0]),before=structuredClone(grant);assert.equal(resolve(panels[1],panels,[grant]).qaResolved,true);assert.deepEqual(grant,before);assert.equal(grant.latest,null);assert.equal(resolve(panels[1],panels,[{...grant,qaExemption:{...grant.qaExemption,productionSignature:'expired'}}]).qaResolved,false);assert.equal(resolve(panels[1],panels,[grant,failure()]).qaResolved,false);
});

test('dispatch honors approved main coverage across loads and keeps existing replacement-outside-load protection',()=>{
 const panels=[main(),cap()],records=[approval()],load={id:'cap-only',status:'waiting',panelIds:['left'],legs:[]},before=structuredClone(load);assert.equal(panelLoadView(load,panels,records).qaComplete,true);assert.equal(panelLoadView(load,panels,[{...records[0],status:'awaiting'}]).qaComplete,false);assert.equal(panelLoadView(load,panels,records).items[0].qaStatus,'included_with_main');assert.deepEqual(load,before);
 const original=main({id:'original',panelNumber:'Different main'}),replacement=main({id:'replacement',panelNumber:'Different main'}),qa=[{...failure('original'),status:'replaced',replacementId:'replacement'},approval('replacement')],outside=panelLoadView({id:'old-load',status:'waiting',panelIds:['original']},[original,replacement],qa);assert.equal(outside.qaComplete,false);assert.match(outside.items[0].qaBlocker,/outside this load/);assert.equal(panelLoadView({id:'full-load',status:'waiting',panelIds:['original','replacement']},[original,replacement],qa).qaComplete,true);
});

test('historically approved caps contribute no extra fabrication area while the main combined sticker area remains counted once',()=>{
 const panels=[main(),cap('left',{panelAreaScope:'panel',totalPanelArea:.5})],records=[approval(),approval('left')],areas={main:{cutAt:cut,value:{method:'manual',areaM2:1.234}},left:{cutAt:cut,value:{method:'manual',areaM2:.5}}},before=structuredClone({panels,records,areas}),rows=fabricationProductionReportRows(panels,records,areas);assert.deepEqual(rows,[{id:'main',areaM2:1.234,completedAt:checked}]);assert.deepEqual({panels,records,areas},before);assert.deepEqual(fabricationProductionReportRows([cap('orphan',{panelAreaScope:'panel',totalPanelArea:.5})],[approval('orphan')]),[]);
});

test('human labels can be corrected without invalidating coverage held by a trusted stable parent link',()=>{
 const panels=[main(),cap()],store=memory();link(store,panels[1],panels[0]);attestQaAssemblyPanels(store,panels);const records=[freshApproval(panels[0],panels,[])],signature=mainQaAssembly(panels[0],panels,records).signature;panels[0].panelNumber='Corrected main ID';panels[1].panelNumber='Corrected component ID';assert.equal(mainQaAssembly(panels[0],panels,records).signature,signature);assert.equal(resolve(panels[1],panels,records).qaResolved,true);
 const before=[main(),cap()],approved=[freshApproval(before[0],before,[])],oldSignature=mainQaAssembly(before[0],before,approved).signature,after=before.map(panel=>({...panel,panelNumber:'Corrected '+panel.id})),saved=memory();saved.write=(key,value)=>{saved.docs[key]=structuredClone(value);};preserveQaAssemblyIdLinks(saved,before,after);assert.equal(saved.docs[ASSEMBLY_LINK_PREFIX+'left'].source,'preserved_id_correction');attestQaAssemblyPanels(saved,after);assert.equal(mainQaAssembly(after[0],after,approved).signature,oldSignature);assert.equal(resolve(after[1],after,approved).qaResolved,true);
});

test('legacy coverage cannot reinterpret a currently failed latest inspection as an approval based only on the top-level approved status',()=>{
 const panels=[main(),cap()],inconsistent=approval('main',{latest:{...failure('main').latest,checkedAt:checked}});assert.equal(resolve(panels[1],panels,[inconsistent]).qaResolved,false);
});
