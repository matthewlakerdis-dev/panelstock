import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capReference,attestQaAssemblyPanels,qaAssemblyRelation,qaPanelsById,mainQaAssembly,mainAssemblyCoverage,assemblyCheckPlan,preserveQaAssemblyIdLinks,ASSEMBLY_LINK_PREFIX,ASSEMBLY_LINK_RECEIPT} from '../src/qa-assemblies.js';
import {panelQaResolution} from '../src/qa-resolution.js';
import {panelAreaFor} from '../src/qa-panel-area.js';
import {cncStickerPhysicalSignature} from '../src/cnc-sticker-review.js';

const cut='2026-11-20T00:00:00Z',checked='2026-11-21T00:00:00Z';
const main=(extra={})=>({id:'main',panelNumber:'P-7',jobReference:'Tower',orderNumber:'007',sheetNumber:'1',status:'completed',completedAt:cut,panelAreaScope:'panel',totalPanelArea:2.75,...extra});
const group=(extra={})=>main({id:'caps',panelNumber:'P-7 EP-L, P-7 EP-R',sheetNumber:'2',totalPanelArea:.25,...extra});
const approval=(extra={})=>({id:'main',kind:'panel',status:'approved',latest:{id:'approved-main',status:'approved',checkedAt:checked,results:{finish:'pass'},photo:'MAIN PHOTO'},history:[{id:'old-main',photo:'OLD MAIN PHOTO'}],...extra});
function memory(rows,extra={}){
  const docs={'app:cncPanels':structuredClone(rows),'qa-checks':[],...structuredClone(extra)},reads=[];
  return {docs,reads,read(key,fallback=null){reads.push(key);return Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback;},write(){throw Error('Automatic cap matching must not write production history');}};
}
const resolve=(panel,panels,records=[])=>panelQaResolution(panel,records.find(record=>record.id===panel.id),qaPanelsById(panels),new Map(records.map(record=>[record.id,record])));
function link(store,component,parent,id='reviewed-link-0000001'){
  const value={schemaVersion:1,id,panelId:component.id,mainPanelId:parent.id,parentReference:parent.panelNumber,side:null};
  store.docs[ASSEMBLY_LINK_PREFIX+component.id]=value;store.docs[ASSEMBLY_LINK_RECEIPT+id]={link:structuredClone(value)};
}

test('single cap suffixes remain unchanged and comma-separated LRBT caps use their one common parent',()=>{
  for(const side of ['L','R','B','T'])assert.deepEqual(capReference({panelNumber:'  P-7 ep-'+side.toLowerCase()+'  '}),{parentReference:'P-7',side});
  for(const text of ['P-7 EP-L, P-7 EP-R','P-7 EP-T, P-7 EP-B',' p-7 ep-l , P-7 EP-R, P-7 EP-B, P-7 EP-T ','P-7 EP-L, P-7 EP-L']){
    const parsed=capReference({panelNumber:text});assert.equal(parsed.parentReference.toUpperCase(),'P-7');assert.equal(parsed.side,null);assert.equal(parsed.ambiguous,undefined);
  }
  for(const text of ['P-7','P-7EP-L','EP-L','P-7 EP-LEFT','P-7 EP-L notes','P-7, P-8','CAP ROUTE'])assert.equal(capReference({panelNumber:text}),null,text);
});

test('all existing clear groups match on every read across sheets and statuses, without saves or production rewrites',()=>{
  const rows=[main(),group(),main({id:'other-main',jobReference:'Other',orderNumber:'42',status:'pending',completedAt:null}),group({id:'other-caps',jobReference:'Other',orderNumber:'42',sheetNumber:'99',status:'pending',completedAt:null})],store=memory(rows,{'qa-checks':[approval()],'qa-panel-area:caps':{cutAt:cut,value:{method:'manual',areaM2:.25}},'app:variants':[{id:'stock',qty:5}],'app:offcuts':[{id:'offcut'}]}),before=structuredClone(store.docs);
  for(let repeat=0;repeat<2;repeat++){
    const panels=attestQaAssemblyPanels(store,store.read('app:cncPanels'));
    assert.equal(qaAssemblyRelation(panels[1],panels).mainPanelId,'main');assert.equal(qaAssemblyRelation(panels[3],panels).mainPanelId,'other-main');
  }
  assert.deepEqual(store.docs,before);
});

test('grouped caps require a unique stable main in the same project and literal order',()=>{
  const cap=group(),foreign=[main({id:'project',jobReference:'Other'}),main({id:'order',orderNumber:'7'})];
  assert.equal(qaAssemblyRelation(cap,[cap,...foreign]).linkState,'orphan');
  assert.equal(qaAssemblyRelation(cap,[main(),cap,...foreign]).mainPanelId,'main');
  for(const rows of [[main(),main({id:'duplicate'}),cap],[main(),main(),cap],[main(),cap,{...cap}]]){
    const relation=qaAssemblyRelation(cap,rows);assert.equal(relation.mainPanelId,null);assert.equal(relation.linkState,'ambiguous');assert.equal(resolve(cap,rows,[approval()]).qaResolved,false);
  }
});

test('mixed-role or mixed-parent lists remain unresolved components and never match a concatenated main prefix',()=>{
  for(const text of ['P-7, P-7 EP-L','P-7 EP-L, P-7','P-7 EP-L, Q-8 EP-R','P-7 EP-L,','P-7 EP-L, P-7 EP-X']){
    const cap=group({panelNumber:text}),rows=[main(),main({id:'second',panelNumber:'Q-8'}),main({id:'made-up',panelNumber:text.replace(/ EP-[LRBT]$/,'')}),cap],relation=qaAssemblyRelation(cap,rows);
    assert.equal(capReference(cap).ambiguous,true,text);assert.equal(relation.linkState,'ambiguous',text);assert.equal(relation.mainPanelId,null,text);
    const value=resolve(cap,rows,[approval(),{id:'caps',kind:'panel',status:'approved'}]);assert.equal(value.qaStandaloneRequired,false);assert.equal(value.qaStatus,'included_with_main');assert.equal(value.qaResolved,false);
    assert.equal(panelAreaFor(cap,null,{cutAt:cut,value:{method:'manual',areaM2:.25}}),null);assert.throws(()=>assemblyCheckPlan(cap,rows,[],{}),error=>error.status===409);
  }
  const cap=group(),rows=[main(),main({id:'made-up',panelNumber:'P-7 EP-L, P-7'}),cap];assert.equal(qaAssemblyRelation(cap,rows).mainPanelId,'main');
});

test('bare duplicate main IDs and all-main lists do not become guessed caps',()=>{
  const rows=[main(),main({id:'copy'}),main({id:'all-main',panelNumber:'P-7, Q-8'})];
  for(const panel of rows)assert.equal(qaAssemblyRelation(panel,rows),null);
});

test('trusted manual and sticker parent links outrank ambiguous group text while browser metadata cannot mint a link',()=>{
  const rows=[main(),main({id:'chosen',panelNumber:'Q-8'}),group({panelNumber:'P-7 EP-L, Q-8 EP-R'})],manual=memory(rows);link(manual,rows[2],rows[1]);attestQaAssemblyPanels(manual,rows);assert.equal(qaAssemblyRelation(rows[2],rows).mainPanelId,'chosen');assert.equal(qaAssemblyRelation(rows[2],rows).source,'admin_link');
  const reviewId='reviewed-stickers-000001',p=main({sticker:{reviewId,labelId:'main-label',role:'main',mainPanelId:'main',areaM2:2.75}}),c=group({panelNumber:'P-7 EP-L, Q-8 EP-R',sticker:{reviewId,labelId:'cap-label',role:'cap',mainPanelId:'main'}}),panels=[p,c],untrusted=memory(panels);
  attestQaAssemblyPanels(untrusted,panels);assert.equal(qaAssemblyRelation(c,panels).mainPanelId,null);
  const receipt={schemaVersion:1,reviewId,by:'admin',bindings:{main:{labelId:'main-label',role:'main',mainPanelId:'main',areaM2:2.75,physicalSignature:cncStickerPhysicalSignature(p)},caps:{labelId:'cap-label',role:'cap',mainPanelId:'main',physicalSignature:cncStickerPhysicalSignature(c)}}},trusted=memory(panels,{['cnc-sticker-review:'+reviewId]:receipt});attestQaAssemblyPanels(trusted,panels);assert.equal(qaAssemblyRelation(c,panels).mainPanelId,'main');assert.equal(qaAssemblyRelation(c,panels).source,'reviewed_sticker');
});

test('existing post-cut main QA covers benign groups and their combined area stays counted on the main once',()=>{
  const panels=[main(),group()],records=[approval()],areas={main:{cutAt:cut,value:{method:'manual',areaM2:2.75}},caps:{cutAt:cut,value:{method:'manual',areaM2:.25}}},before=structuredClone({panels,records,areas}),assembly=mainQaAssembly(panels[0],panels,records);
  assert.equal(mainAssemblyCoverage(panels[0],records[0],assembly).covered,true);assert.equal(resolve(panels[1],panels,records).qaResolved,true);assert.equal(assembly.caps[0].id,'caps');assert.equal(assembly.caps[0].side,null);
  assert.equal(panels.reduce((sum,panel)=>sum+(panelAreaFor(panel,records.find(record=>record.id===panel.id),areas[panel.id])?.areaM2||0),0),2.75);
  assert.deepEqual({panels,records,areas},before);
  for(const parent of [{...approval(),status:'awaiting'},{...approval(),latest:{...approval().latest,checkedAt:'2026-11-19T00:00:00Z'}}])assert.equal(resolve(panels[1],panels,[parent]).qaResolved,false);
});

test('group failures remain blockers until a fresh main snapshot covers them, with original evidence intact',()=>{
  const panels=[main(),group()],failed={id:'caps',kind:'panel',status:'recut',latest:{id:'failure',status:'recut',checkedAt:checked,results:{finish:'fail'},photo:'PRIVATE FAILED PHOTO'},history:[{id:'earlier',photo:'EARLIER PHOTO'}]},records=[approval(),failed],before=structuredClone(failed);
  assert.equal(resolve(panels[1],panels,records).qaResolved,false);
  const assembly=mainQaAssembly(panels[0],panels,records),snapshot=assemblyCheckPlan(panels[0],panels,records,{expectedAssemblySignature:assembly.signature}),fresh=approval({latest:{...approval().latest,id:'fresh-main',assemblyQa:snapshot}});
  assert.equal(resolve(panels[1],panels,[fresh,failed]).qaResolved,true);assert.deepEqual(failed,before);
  const later={...failed,latest:{...failed.latest,id:'later-failure'}};assert.equal(resolve(panels[1],panels,[fresh,later]).qaResolved,false);
  panels[1].completedAt='2026-11-22T00:00:00Z';assert.equal(resolve(panels[1],panels,[fresh,failed]).qaResolved,false);
});

test('pending group cuts block full-panel QA and later cutting keeps the same automatic association',()=>{
  const panels=[main(),group({status:'pending',completedAt:null})],records=[approval()],assembly=mainQaAssembly(panels[0],panels,records);
  assert.equal(qaAssemblyRelation(panels[1],panels).mainPanelId,'main');assert.equal(resolve(panels[1],panels,records).qaResolved,false);
  assert.throws(()=>assemblyCheckPlan(panels[0],panels,records,{expectedAssemblySignature:assembly.signature}),error=>error.status===409);
  panels[1].status='completed';panels[1].completedAt=cut;assert.equal(qaAssemblyRelation(panels[1],panels).mainPanelId,'main');assert.equal(resolve(panels[1],panels,records).qaResolved,true);
});

test('later ID-only corrections preserve inferred grouped links and existing assembly coverage without rewriting inspection history',()=>{
  const before=[main(),group()],records=[approval()],initial=mainQaAssembly(before[0],before,records),after=before.map(panel=>({...panel,panelNumber:'Corrected '+panel.id})),store=memory(before,{'qa-checks':records}),history=structuredClone(store.docs['qa-checks']);
  store.write=(key,value)=>{store.docs[key]=structuredClone(value);};preserveQaAssemblyIdLinks(store,before,after);assert.equal(store.docs[ASSEMBLY_LINK_PREFIX+'caps'].coverageRevision,'inferred:main');assert.equal(store.docs[ASSEMBLY_LINK_PREFIX+'caps'].side,null);
  attestQaAssemblyPanels(store,after);assert.equal(qaAssemblyRelation(after[1],after).mainPanelId,'main');assert.equal(mainQaAssembly(after[0],after,records).signature,initial.signature);assert.equal(resolve(after[1],after,records).qaResolved,true);assert.deepEqual(store.docs['qa-checks'],history);assert.deepEqual(store.docs['app:cncPanels'],before);
});
