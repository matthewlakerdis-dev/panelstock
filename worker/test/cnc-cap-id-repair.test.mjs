import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageCncOrderIdAnalysis,orderIdReupload} from '../src/cnc-order-id-reupload.js';
import {attestQaAssemblyPanels,preserveQaAssemblyIdLinks,qaPanelsById} from '../src/qa-assemblies.js';
import {panelQaResolution} from '../src/qa-resolution.js';
import {panelAreaFields} from '../src/qa-panel-area.js';

const actor={username:'reviewing-admin',isAdmin:true};
const scope={project:'141 Queen Street Mall',orderNumber:'BATCH 2'};
const source={fileName:'BATCH 2 - CNC DRAWINGS.pdf',sha256:'a'.repeat(64),bytes:1234};
const mainId='main-sheet-8',topId='top-sheet-1',bottomId='bottom-sheet-6';
const panel=(id,sheet,reference='Z5W5-8a',extra={})=>({
  id,panelNumber:reference,jobReference:scope.project,orderNumber:scope.orderNumber,sheetNumber:sheet,
  status:'completed',completedAt:sheet==='1'?'2026-11-24T01:10:40Z':'2026-11-25T05:57:41Z',completedBy:'Cutter',
  uploadedBy:'Original uploader',uploadedAt:'2026-11-23T00:00:00Z',pdfPage:Number(sheet),pdfRevision:1,
  stockItemId:'stock-sheet',stockItemType:'variant',stockSku:'AL-SHEET',sheetWidth:4000,sheetHeight:1250,
  totalPanelArea:2.72,panelAreaScope:'sheet',savedOffcuts:[{id:'existing-offcut-'+id,length:500,width:1250}],...extra
});
const inspection=(id,status='approved')=>({id,kind:'panel',status,latest:{id:'check-'+id,status,
  checkedAt:'2026-11-27T03:00:00Z',checkedBy:'Inspector',results:{finish:'pass'},photo:'PRIVATE-'+id},
  history:[{id:'old-'+id,status:'recut',notes:'Keep the original inspection',photo:'HISTORICAL-'+id}]
});
function fixture(){
  const panels=[panel(topId,'1'),panel(bottomId,'6'),panel(mainId,'8'),
    panel('different-letter','8','Z5W5-8b'),panel('ordinary','9','C1-20')];
  const docs={'app:cncPanels':panels,'qa-checks':panels.map(p=>inspection(p.id)),
    'app:variants':[{id:'stock-sheet',qty:5}], 'app:offcuts':[{id:'existing-offcut',qty:2}],
    'app:transactions':[{id:'old-cut',type:'cnc',timestamp:'2026-11-25T05:57:41Z',desc:'Original cutting activity'}],
    'panel-dispatch-loads':[{id:'already-fabricated-load',status:'dispatched_to_site',panelIds:[mainId,topId,bottomId],
      fabrication:{by:'Fabricator',at:'2026-11-27T04:00:00Z'},legs:[{at:'2026-11-27T05:00:00Z',reference:'Original dispatch'}]}],
    ['qa-panel-area:'+topId]:{value:{method:'manual',areaM2:0.914},revision:2,cutAt:panels[0].completedAt},
    revision:12,restoreEpoch:0};
  const writes=[],audits=[],broadcasts=[];
  const store={docs,writes,audits,broadcasts,
    read(key,fallback=null){const value=Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback;
      return key==='app:cncPanels'?attestQaAssemblyPanels(store,value):value;},
    write(key,value){if(key==='app:cncPanels')preserveQaAssemblyIdLinks(store,store.read(key,[]),value);
      docs[key]=structuredClone(value);writes.push(key);},
    requireTask(a,task){assert.equal(a.isAdmin,true);assert.equal(task,'factory.cnc');},
    audit(by,action,detail){audits.push({by,action,detail});},
    broadcastRevision(revision){broadcasts.push(revision);},
    ctx:{storage:{transactionSync(fn){const before=structuredClone(docs),writeCount=writes.length,auditCount=audits.length;
      try{return fn();}catch(error){for(const key of Object.keys(docs))delete docs[key];Object.assign(docs,before);
        writes.length=writeCount;audits.length=auditCount;throw error;}}}}
  };
  return store;
}
function projection(store){
  const panels=store.read('app:cncPanels',[]),byPanel=qaPanelsById(panels),byQa=new Map(store.docs['qa-checks'].map(r=>[r.id,r]));
  return panels.map(p=>({id:p.id,reference:p.panelNumber,...panelAreaFields(p,byQa.get(p.id),store.docs['qa-panel-area:'+p.id]||null),
    ...panelQaResolution(p,byQa.get(p.id),byPanel,byQa)}));
}
function repair(store){
  const pages=[{page:1,sheetNumber:'1',panelIds:['Z5W5-8a EP-T']},
    {page:6,sheetNumber:'6',panelIds:['Z5W5-8a EP-B']},
    {page:8,sheetNumber:'8',panelIds:['Z5W5-8a','Z5W5-8b']}]
    .map(page=>({...page,project:scope.project,orderNumber:scope.orderNumber,quantity:1}));
  const analysis=stageCncOrderIdAnalysis(store,{...scope,source,pages},actor);
  const ids=[topId,bottomId,mainId,'different-letter'];
  const mappings=analysis.occurrences.map((occurrence,index)=>({panelId:ids[index],occurrenceIds:[occurrence.occurrenceId]}));
  const plan=orderIdReupload(store,{action:'preview',analysisId:analysis.analysisId,mappings},actor).plan;
  const body={action:'save',analysisId:analysis.analysisId,mappings,snapshot:plan.snapshot,revision:plan.revision,
    restoreEpoch:plan.restoreEpoch,mutationId:'reviewed-cap-id-repair-0001',reason:'Restore the full printed cap IDs from the CNC drawing',confirmed:true};
  return {analysis,plan,body};
}

test('reviewed full cap ID repair preserves physical and QA history while QA includes the caps with the main on sheet 8',()=>{
  const store=fixture(),original=structuredClone(store.docs);
  const initially=projection(store);assert.ok(initially.every(item=>item.qaStandaloneRequired===true));
  assert.equal(initially.find(item=>item.id===topId).panelArea.areaM2,0.914);
  const {analysis,plan,body}=repair(store);
  assert.deepEqual(analysis.occurrences.map(item=>item.panelNumber),['Z5W5-8a EP-T','Z5W5-8a EP-B','Z5W5-8a','Z5W5-8b']);
  assert.equal(plan.changedCount,2);
  assert.deepEqual(store.docs['app:cncPanels'],original['app:cncPanels']);
  const result=orderIdReupload(store,body,actor);
  assert.equal(result.summary.changedCount,2);assert.equal(result.summary.mappedCount,4);
  const names=new Map([[topId,'Z5W5-8a EP-T'],[bottomId,'Z5W5-8a EP-B']]);
  assert.deepEqual(store.docs['app:cncPanels'],original['app:cncPanels'].map(p=>names.has(p.id)?{...p,panelNumber:names.get(p.id)}:p));
  for(const key of ['qa-checks','app:variants','app:offcuts','panel-dispatch-loads','qa-panel-area:'+topId])
    assert.deepEqual(store.docs[key],original[key],key+' is retained');
  assert.equal(Object.hasOwn(store.docs,'qa-panel-area:'+mainId),false,'repair does not transfer a cap area onto its main');
  assert.deepEqual(store.docs['app:transactions'].slice(1),original['app:transactions']);
  assert.equal(store.docs['app:transactions'][0].source,'cnc-order-id-reupload');
  assert.deepEqual(store.broadcasts,[13]);assert.equal(store.audits[0].action,'cnc-order-ids-reuploaded');
  const items=projection(store),caps=items.filter(item=>item.qaStandaloneRequired===false);
  assert.deepEqual(caps.map(item=>item.id).sort(),[bottomId,topId].sort());
  for(const cap of caps){assert.equal(cap.qaAssembly.mainPanelId,mainId);
    assert.equal(cap.qaStatus,'included_with_main');assert.equal(cap.panelArea,null);assert.equal(cap.qaResolved,true);}
  const main=items.find(item=>item.id===mainId);
  assert.equal(main.qaStandaloneRequired,true);assert.equal(main.qaAssembly.role,'main');assert.equal(main.qaResolved,true);
  assert.equal(main.panelArea,null);assert.deepEqual(main.qaAssembly.caps.map(cap=>cap.side).sort(),['B','T']);
  assert.deepEqual(items.filter(item=>item.qaStandaloneRequired!==false).map(item=>item.id),[mainId,'different-letter','ordinary']);
  for(const id of ['different-letter','ordinary']){const item=items.find(item=>item.id===id);
    assert.equal(item.qaStandaloneRequired,true);assert.equal(item.qaAssembly,undefined);assert.equal(item.qaAssemblySignature,undefined);assert.equal(item.qaResolved,true);}
  const beforeRetry=structuredClone(store.docs),writeCount=store.writes.length;
  assert.equal(orderIdReupload(store,body,actor).idempotent,true);
  assert.deepEqual(store.docs,beforeRetry);assert.equal(store.writes.length,writeCount);
});

test('a QA evidence change after the cap ID review prevents any stale name repair',()=>{
  const store=fixture(),{body}=repair(store);
  store.docs['qa-checks'].find(record=>record.id===topId).latest.photo='NEW EVIDENCE';
  const before=structuredClone(store.docs),writeCount=store.writes.length;
  assert.throws(()=>orderIdReupload(store,body,actor),error=>error.status===409);
  assert.deepEqual(store.docs,before);assert.equal(store.writes.length,writeCount);
  assert.ok(projection(store).every(item=>item.qaStandaloneRequired===true));
});
