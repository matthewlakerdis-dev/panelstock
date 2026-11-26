import {createHash} from 'node:crypto';
import {requireCondition as check} from './security.js';
import {cncDuplicateKey,normalizeCncInput} from './cnc-input.js';
import {panelQaResolution} from './qa-resolution.js';
import {preparePanelIdUpdates} from './cnc-panel-id-updates.js';

const control=/[\u0000-\u001f\u007f]/,MAX_ROWS=500,MAX_PAGES=300,TTL=2*60*60*1000;
const ANALYSIS='cnc-order-id-analysis:',RECEIPT='cnc-order-id-reupload:';
const normal=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-AU');
const orderKey=value=>normal(normalizeCncInput({orderNumber:String(value??'')}).orderNumber||value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textHash=value=>createHash('sha256').update(value).digest('hex');
const inScope=(panel,scope)=>normal(panel?.jobReference)===normal(scope.project)&&orderKey(panel?.orderNumber)===orderKey(scope.orderNumber);
function authorize(store,actor){check(actor?.isAdmin===true,'Only administrators can update panel IDs from order drawings',403);store.requireTask(actor,'factory.cnc');}
function scopeOf(input){
  check(input&&typeof input.project==='string'&&input.project.trim().length<=120&&!control.test(input.project),'Choose an existing CNC project');
  check(typeof input.orderNumber==='string'&&input.orderNumber.trim().length>0&&input.orderNumber.trim().length<=200&&!control.test(input.orderNumber),'Choose an existing CNC order');
  return {project:input.project.trim(),orderNumber:input.orderNumber.trim()};
}
// Typed hashes retain exact object/array/value distinctions without duplicating
// large embedded photo strings in an order-wide optimistic snapshot.
function snapshotValue(value){
  if(value===null)return ['null'];
  if(typeof value==='string')return ['string',value.length,value.length>4096?['sha256',textHash(value)]:value];
  if(Array.isArray(value))return ['array',value.map(snapshotValue)];
  if(value&&typeof value==='object')return ['object',Object.keys(value).sort().map(key=>[key,snapshotValue(value[key])])];
  return [typeof value,value];
}
function orderState(store,scope){
  const panels=store.read('app:cncPanels',[]),records=store.read('qa-checks',[]),loads=store.read('panel-dispatch-loads',[]);
  check(Array.isArray(panels)&&Array.isArray(records)&&Array.isArray(loads),'Saved production history cannot be read. Refresh this CNC order.',409);
  const selected=panels.filter(panel=>panel&&inScope(panel,scope)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  check(selected.length>0,'No existing CNC panels were found for this project and order',404);
  check(selected.length<=10000,'Choose an order containing at most 10,000 existing CNC records');
  const counts=new Map(),byId=new Map(),qaCounts=new Map(),qaById=new Map();
  for(const panel of panels){if(typeof panel?.id==='string'){counts.set(panel.id,(counts.get(panel.id)||0)+1);byId.set(panel.id,panel);}}
  for(const record of records){if(typeof record?.id==='string'){qaCounts.set(record.id,(qaCounts.get(record.id)||0)+1);qaById.set(record.id,record);}}
  const ids=new Set(selected.map(panel=>panel.id));
  for(const panel of selected){
    check(typeof panel.id==='string'&&panel.id.trim().length>0&&panel.id.length<=100&&counts.get(panel.id)===1,'This order has conflicting saved CNC identities. Resolve them before updating IDs.',409);
    check((qaCounts.get(panel.id)||0)<=1&&(!qaById.has(panel.id)||qaById.get(panel.id).kind==='panel'),'This order has conflicting QA identities. Resolve them before updating IDs.',409);
  }
  const items=selected.map(panel=>{
    const record=qaById.get(panel.id),resolution=record?panelQaResolution(panel,record,byId,qaById):null;
    return {id:panel.id,panelId:panel.id,panelNumber:panel.panelNumber??null,sheetNumber:String(panel.sheetNumber??''),status:panel.status,
      completedAt:panel.completedAt??null,completedBy:panel.completedBy??null,
      qaStatus:resolution?.qaStatus||(panel.status==='pending'?'awaiting_routing':'awaiting'),
      fabricationStatus:record?(panel.status==='completed'&&resolution.qaResolved?'completed':'pending'):null};
  });
  const revision=store.read('revision',0),restoreEpoch=store.read('restoreEpoch',0);
  check(Number.isSafeInteger(revision)&&revision>=0&&revision<Number.MAX_SAFE_INTEGER&&Number.isSafeInteger(restoreEpoch)&&restoreEpoch>=0,'The saved CNC revision is invalid. Refresh the tracker.',409);
  const affectedLoads=loads.filter(load=>Array.isArray(load?.panelIds)&&load.panelIds.some(id=>ids.has(id))),
    snapshot=hash(snapshotValue({scope:{project:normal(scope.project),orderNumber:orderKey(scope.orderNumber)},panels:selected,
      records:records.filter(record=>ids.has(record?.id)),loads:affectedLoads,revision,restoreEpoch}));
  return {scope,panels,records,loads,selected,items,revision,restoreEpoch,snapshot};
}

function parsedOccurrences(pages,scope){
  check(Array.isArray(pages)&&pages.length>0&&pages.length<=MAX_PAGES,'Analyse a PDF with 1 to 300 pages');
  const occurrences=[],warnings=[],seenPages=new Set();
  const sorted=pages.map(page=>{
    check(page&&typeof page==='object'&&!Array.isArray(page)&&Number.isInteger(page.page)&&page.page>=1&&page.page<=MAX_PAGES&&!seenPages.has(page.page),'The analysed PDF contains an invalid or repeated page number');
    seenPages.add(page.page);return page;
  }).sort((a,b)=>a.page-b.page);
  for(const page of sorted){
    const number=page.page,ids=page.panelIds??[];
    check(Array.isArray(ids)&&ids.length<=MAX_ROWS,'The analysed PDF contains an invalid panel ID list');
    check(page.orderNumber===undefined||page.orderNumber===null||typeof page.orderNumber==='string'||Number.isSafeInteger(page.orderNumber),'The analysed PDF contains an invalid order header');
    check(page.sheetNumber===undefined||page.sheetNumber===null||typeof page.sheetNumber==='string'||Number.isSafeInteger(page.sheetNumber),'The analysed PDF contains an invalid sheet header');
    check(page.project===undefined||page.project===null||typeof page.project==='string','The analysed PDF contains an invalid project header');
    const printedProject=String(page.project??'').trim(),printedOrder=String(page.orderNumber??'').trim(),sheetNumber=String(page.sheetNumber??'').trim(),
      rawQuantity=page.quantity===undefined||page.quantity===null||page.quantity===''?1:page.quantity,
      quantity=typeof rawQuantity==='string'&&/^\d+$/.test(rawQuantity)?Number(rawQuantity):rawQuantity;
    check(printedProject.length<=200&&!control.test(printedProject)&&printedOrder.length<=200&&!control.test(printedOrder)&&sheetNumber.length<=200&&!control.test(sheetNumber),'The analysed PDF contains an invalid project, order or sheet header');
    check(Number.isInteger(quantity)&&quantity>=1&&quantity<=MAX_ROWS,'The analysed PDF contains an invalid sheet quantity');
    let pageError='';
    if(!printedProject)warnings.push(`PDF page ${number}: project name is missing; the selected existing project is retained.`);
    else if(normal(printedProject)!==normal(scope.project))warnings.push(`PDF page ${number}: printed project ${printedProject} differs from selected ${scope.project||'No project'}. Verify this drawing; the selected project will not change.`);
    if(!printedOrder)warnings.push(`PDF page ${number}: order number is missing; verify this page belongs to the selected order.`);
    else if(orderKey(printedOrder)!==orderKey(scope.orderNumber)){pageError=`PDF page ${number} states Order ${printedOrder}, not selected Order ${scope.orderNumber}.`;warnings.push(pageError);}
    if(!sheetNumber)warnings.push(`PDF page ${number}: sheet number is missing; map its IDs explicitly.`);
    if(!ids.length)warnings.push(`PDF page ${number}: no panel IDs were detected.`);
    if(Array.isArray(page.warnings))for(const warning of page.warnings.slice(0,20))if(typeof warning==='string'&&warning.trim())warnings.push(`PDF page ${number}: ${warning.trim().replace(/\s+/g,' ').slice(0,500)}`);
    if(quantity>1)warnings.push(`PDF page ${number}: quantity ${quantity}; select the correct existing record for each copy. Stored physical sheet numbers will not change.`);
    for(let copyIndex=0;copyIndex<quantity;copyIndex++)for(let index=0;index<ids.length;index++){
      check(occurrences.length<MAX_ROWS,'The analysed PDF contains more than 500 panel occurrences');
      const raw=ids[index],valid=typeof raw==='string'&&raw.trim().length>0&&raw.trim().length<=200&&!control.test(raw),panelNumber=valid?raw.trim():'',
        error=pageError||(!valid?`PDF page ${number}: panel ID ${index+1} is unreadable or invalid.`:'');
      occurrences.push({occurrenceId:`page-${number}-copy-${copyIndex+1}-id-${index+1}`,panelNumber,page:number,sheetNumber,copyIndex,quantity,eligible:!error,...(error?{error}:{})});
    }
  }
  check(occurrences.length>0,'No panel ID occurrences were detected in this PDF');
  return {occurrences,warnings:[...new Set(warnings)].slice(0,1000)};
}

// Trusted RPC only: the gateway supplies these pages after analysing the actual
// PDF bytes and calculating the source hash. There is no public staging action.
export function stageCncOrderIdAnalysis(store,input,actor){
  authorize(store,actor);const scope=scopeOf(input),source=input?.source;
  check(source&&typeof source==='object'&&!Array.isArray(source)&&typeof source.fileName==='string'&&source.fileName.trim().length>0&&source.fileName.trim().length<=200&&!control.test(source.fileName),'Choose a PDF filename of 1 to 200 characters');
  check(typeof source.sha256==='string'&&/^[a-f0-9]{64}$/.test(source.sha256)&&Number.isSafeInteger(source.bytes)&&source.bytes>0&&source.bytes<=8*1024*1024,'The analysed PDF source could not be verified');
  const parsed=parsedOccurrences(input.pages,scope),state=orderState(store,scope),analysisId=crypto.randomUUID(),now=new Date().toISOString(),
    analysis={schemaVersion:1,analysisId,owner:actor.username,createdAt:now,expiresAt:new Date(Date.now()+TTL).toISOString(),restoreEpoch:state.restoreEpoch,scope,
      source:{fileName:source.fileName.trim(),sha256:source.sha256,bytes:source.bytes},...parsed};
  store.ctx.storage.transactionSync(()=>{
    check(store.read('restoreEpoch',0)===state.restoreEpoch,'A backup was restored during PDF analysis. Upload the PDF again.',409);
    store.write(ANALYSIS+analysisId,analysis);
  });
  return {ok:true,analysisId,scope,source:analysis.source,occurrences:analysis.occurrences,warnings:analysis.warnings,panels:state.items,revision:state.revision,restoreEpoch:state.restoreEpoch};
}

function readAnalysis(store,analysisId,actor){
  check(typeof analysisId==='string'&&/^[a-f0-9-]{36}$/.test(analysisId),'Upload and analyse an order PDF first');
  const analysis=store.read(ANALYSIS+analysisId,null);
  check(analysis?.schemaVersion===1&&analysis.analysisId===analysisId,'This analysed PDF is unavailable. Upload it again.',404);
  check(analysis.owner===actor.username,'This analysed PDF belongs to another administrator',403);
  check(Number.isFinite(Date.parse(analysis.expiresAt))&&Date.parse(analysis.expiresAt)>Date.now(),'This PDF analysis expired. Upload and analyse the PDF again.',409);
  check(analysis.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Upload and analyse the PDF again.',409);
  return analysis;
}
function validateMappings(mappings){
  check(Array.isArray(mappings)&&mappings.length>0&&mappings.length<=MAX_ROWS,'Map between 1 and 500 existing CNC records');
  const ids=new Set(),occurrences=new Set();
  for(const mapping of mappings){
    check(mapping&&typeof mapping==='object'&&!Array.isArray(mapping)&&typeof mapping.panelId==='string'&&mapping.panelId.trim().length>0&&mapping.panelId.length<=100&&!ids.has(mapping.panelId),'Map each saved panel once');ids.add(mapping.panelId);
    check(Array.isArray(mapping.occurrenceIds)&&mapping.occurrenceIds.length>0&&mapping.occurrenceIds.length<=MAX_ROWS,'Select the detected IDs for every mapped panel');
    check(mapping.combineConfirmed===undefined||typeof mapping.combineConfirmed==='boolean','Confirm combined labels explicitly');
    if(mapping.occurrenceIds.length>1)check(mapping.combineConfirmed===true,'Confirm combining multiple printed labels into this one existing record');
    for(const id of mapping.occurrenceIds){check(typeof id==='string'&&id.length>0&&id.length<=100&&!occurrences.has(id),'Use each printed occurrence once');occurrences.add(id);check(occurrences.size<=MAX_ROWS,'Map at most 500 printed occurrences');}
  }
}
function reviewedPlan(store,analysis,mappings){
  validateMappings(mappings);const state=orderState(store,analysis.scope),byId=new Map(state.selected.map(panel=>[panel.id,panel])),itemById=new Map(state.items.map(item=>[item.panelId,item])),
    source=new Map(analysis.occurrences.map((occurrence,index)=>[occurrence.occurrenceId,{...occurrence,index}])),used=new Set(),mapped=new Set(),rows=[];
  for(const mapping of mappings){
    const panel=byId.get(mapping.panelId);check(panel,'A selected panel is outside this project/order or no longer exists.',409);
    check(['pending','completed'].includes(panel.status),'A selected panel is no longer pending or cut.',409);
    const labels=mapping.occurrenceIds.map(id=>{const occurrence=source.get(id);check(occurrence?.eligible,'A selected PDF occurrence is missing or belongs to a different order.',409);return occurrence;}).sort((a,b)=>a.index-b.index),
      newPanelNumber=labels.map(label=>label.panelNumber).join(', ');
    check(newPanelNumber.length>0&&newPanelNumber.length<=200,'Combined panel IDs must fit within 200 characters');
    mapped.add(panel.id);for(const label of labels)used.add(label.occurrenceId);
    const item=itemById.get(panel.id);
    rows.push({panelId:panel.id,oldPanelNumber:panel.panelNumber??null,newPanelNumber,sheetNumber:item.sheetNumber,status:item.status,qaStatus:item.qaStatus,fabricationStatus:item.fabricationStatus,completedAt:item.completedAt,occurrenceIds:labels.map(label=>label.occurrenceId)});
  }
  rows.sort((a,b)=>a.panelId.localeCompare(b.panelId));
  const replacements=new Map(rows.map(row=>[row.panelId,row.newPanelNumber])),keys=new Set();
  for(const panel of state.selected){const final=replacements.has(panel.id)?{...panel,panelNumber:replacements.get(panel.id)}:panel,key=cncDuplicateKey(final);check(!keys.has(key),'The final order would contain duplicate IDs on the same sheet. Review all mappings.',409);keys.add(key);}
  const unmatchedPanelIds=state.selected.filter(panel=>!mapped.has(panel.id)).map(panel=>panel.id),unmatchedOccurrenceIds=analysis.occurrences.filter(item=>!used.has(item.occurrenceId)).map(item=>item.occurrenceId),
    snapshot=hash(snapshotValue({state:state.snapshot,analysisId:analysis.analysisId,scope:analysis.scope,source:analysis.source,rows,unmatchedPanelIds,unmatchedOccurrenceIds})),
    plan={analysisId:analysis.analysisId,scope:analysis.scope,source:analysis.source,snapshot,revision:state.revision,restoreEpoch:state.restoreEpoch,rows,unmatchedPanelIds,unmatchedOccurrenceIds,changedCount:rows.filter(row=>row.oldPanelNumber!==row.newPanelNumber).length};
  return {plan,state};
}

export function orderIdReupload(store,body,actor){
  authorize(store,actor);check(body&&typeof body==='object'&&!Array.isArray(body)&&['context','preview','save'].includes(body.action),'Choose an order drawing ID update action');
  if(body.action==='context'){const scope=scopeOf(body),state=orderState(store,scope);return {ok:true,scope,panels:state.items,revision:state.revision,restoreEpoch:state.restoreEpoch};}
  validateMappings(body.mappings);
  if(body.action==='preview'){const analysis=readAnalysis(store,body.analysisId,actor);return {ok:true,plan:reviewedPlan(store,analysis,body.mappings).plan};}
  check(body.confirmed===true,'Confirm that these mappings preserve the existing physical panels');
  check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Start a new order drawing ID update');
  check(typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.trim().length<=1000&&!control.test(body.reason),'Enter an update reason of 1 to 1000 characters without control characters');
  check(typeof body.snapshot==='string'&&/^[a-f0-9]{64}$/.test(body.snapshot)&&Number.isSafeInteger(body.revision)&&body.revision>=0&&Number.isSafeInteger(body.restoreEpoch)&&body.restoreEpoch>=0,'Review the current order mappings before saving');
  const reason=body.reason.trim(),fingerprint=hash(snapshotValue({analysisId:body.analysisId,mappings:body.mappings,snapshot:body.snapshot,revision:body.revision,restoreEpoch:body.restoreEpoch,reason,confirmed:true})),receiptKey=RECEIPT+body.mutationId;
  let committed=false;
  const result=store.ctx.storage.transactionSync(()=>{
    check(body.restoreEpoch===store.read('restoreEpoch',0),'A backup was restored. Review the order again.',409);
    const receipt=store.read(receiptKey,null);
    if(receipt){check(receipt.by===actor.username&&receipt.fingerprint===fingerprint,'This update reference was already used with different details.',409);return {...receipt.result,idempotent:true};}
    const analysis=readAnalysis(store,body.analysisId,actor),{plan,state}=reviewedPlan(store,analysis,body.mappings);
    check(body.revision===plan.revision&&body.restoreEpoch===plan.restoreEpoch&&body.snapshot===plan.snapshot,'This order, its QA or its dispatch progress changed. Review the mappings again.',409);
    const now=new Date().toISOString(),prepared=preparePanelIdUpdates({panels:state.panels,records:state.records,loads:state.loads,updates:plan.rows.map(row=>({panelId:row.panelId,newPanelNumber:row.newPanelNumber})),actor,operationId:body.mutationId,now}),revision=state.revision+1,
      summary={analysisId:analysis.analysisId,source:analysis.source,scope:analysis.scope,rows:plan.rows,mappedCount:plan.rows.length,changedCount:prepared.changedCount,unmatchedPanelIds:plan.unmatchedPanelIds,unmatchedOccurrenceIds:plan.unmatchedOccurrenceIds},
      result={ok:true,revision,summary},transactions=store.read('app:transactions',[]);
    check(Array.isArray(transactions),'Saved CNC activity cannot be read. Refresh before updating IDs.',409);
    const activity={id:crypto.randomUUID(),type:'cnc',source:'cnc-order-id-reupload',user:actor.username,timestamp:now,serverTimestamp:now,qty:'',panelRecordIds:plan.rows.map(row=>row.panelId),analysisId:analysis.analysisId,fileName:analysis.source.fileName,sha256:analysis.source.sha256,reason,corrections:plan.rows.map(row=>({panelId:row.panelId,oldPanelNumber:row.oldPanelNumber,newPanelNumber:row.newPanelNumber,occurrenceIds:row.occurrenceIds})),desc:`Updated IDs from CNC drawing: ${analysis.scope.project||'No project'} · Order ${analysis.scope.orderNumber} · ${prepared.changedCount} changed, ${plan.rows.length} mapped · ${analysis.source.fileName}`.slice(0,4000)};
    if(prepared.changedCount)store.write('app:cncPanels',prepared.panels);
    if(prepared.qaRecordsChanged)store.write('qa-checks',prepared.records);
    if(prepared.loadsChanged)store.write('panel-dispatch-loads',prepared.loads);
    store.write('app:transactions',[activity,...transactions]);store.write('revision',revision);
    store.audit(actor.username,'cnc-order-ids-reuploaded',{mutationId:body.mutationId,...summary,reason,revision});
    const usedOccurrences=new Set(plan.rows.flatMap(row=>row.occurrenceIds));
    store.write(receiptKey,{schemaVersion:1,by:actor.username,at:now,fingerprint,analysisId:analysis.analysisId,source:analysis.source,scope:analysis.scope,sourceOccurrences:analysis.occurrences.filter(item=>usedOccurrences.has(item.occurrenceId)),mappings:body.mappings,result});
    committed=true;return result;
  });
  if(committed)store.broadcastRevision(result.revision);
  return result;
}
