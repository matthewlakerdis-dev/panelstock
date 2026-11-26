import {requireCondition as check} from './security.js';
import {preparePanelArea,commitPanelArea,panelAreaFields,panelAreaResetGeneration} from './qa-panel-area.js';
import {panelQaApplies} from './qa-panel-reset.js';
const key=value=>typeof value==='string'?value.trim().toLowerCase():'';
export function importPanelAreas(store,body,actor){
  check(actor.isAdmin||actor.tasks?.['factory.qa']===true,'Complete QA checks access is required',403);
  check(typeof body.project==='string'&&body.project.trim()&&body.project.length<=120&&typeof body.orderNumber==='string'&&body.orderNumber.trim()&&body.orderNumber.length<=100,'Choose a project and order');
  check(typeof body.importId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(body.importId),'Start a new panel area import');
  check(Array.isArray(body.rows)&&body.rows.length>0&&body.rows.length<=500,'Select between 1 and 500 panel areas');
  check(typeof body.fileName==='string'&&body.fileName.length>0&&body.fileName.length<=200,'Choose a PDF file');
  const fingerprint=JSON.stringify({project:body.project,orderNumber:body.orderNumber,fileName:body.fileName,rows:body.rows});
  const generation=panelAreaResetGeneration(store),receiptKey='qa-area-import:'+body.importId,receipt=store.read(receiptKey,null);
  if(receipt){check(receipt.username===actor.username&&receipt.fingerprint===fingerprint,'This import reference has already been used. Start a new import.',409);check((receipt.generation??null)===generation,'QA panel areas were reset. Review the PDF again and start a new import.',409);return receipt.result;}
  const panels=store.read('app:cncPanels',[]),records=store.readQaForDispatch(),seen=new Set(),settings=store.qaSettings(),
    qaById=new Map(records.filter(record=>record.kind==='panel').map(record=>[record.id,record]));
  const scoped=panels.filter(panel=>key(panel.jobReference)===key(body.project)&&key(panel.orderNumber)===key(body.orderNumber)&&panelQaApplies(panel,qaById.get(panel.id),settings.enabledFrom));
  // Use the same visibility gate as the QA queue, including failed/remade
  // candidates but excluding cuts that are still Pre-QA. Stable IDs are also
  // checked globally, so hidden rows cannot conceal an identity collision.
  const prepared=body.rows.map(row=>{
    check(row&&typeof row.id==='string'&&!seen.has(row.id),'Select each panel once');seen.add(row.id);
    check(typeof row.reference==='string'&&row.reference.trim()&&row.reference.length<=120&&Number.isInteger(row.page)&&row.page>0&&row.page<=300,'Invalid PDF panel reference');
    const matches=scoped.filter(panel=>key(panel.panelNumber)===key(row.reference));
    const selected=matches.filter(panel=>panel.id===row.id),candidateIds=matches.map(panel=>panel.id).sort();
    check(selected.length===1&&panels.filter(panel=>panel.id===row.id).length===1,'The selected panel match changed or is outside this order. Refresh QA Centre and review the PDF again.',409);
    if(Object.hasOwn(row,'matchConfirmed')){
      check(typeof row.matchConfirmed==='boolean'&&Array.isArray(row.expectedCandidateIds)&&row.expectedCandidateIds.length>0&&row.expectedCandidateIds.length<=10000,'Review the current panel candidates before saving');
      check(row.expectedCandidateIds.every(id=>typeof id==='string'&&id===id.trim()&&id.length>0&&id.length<=100&&!/[\u0000-\u001f\u007f]/.test(id))&&new Set(row.expectedCandidateIds).size===row.expectedCandidateIds.length,'Invalid or duplicate panel candidate identities');
      check(JSON.stringify(row.expectedCandidateIds)===JSON.stringify(candidateIds),'The matching panel candidates changed. Refresh QA Centre and review the selection again.',409);
    }else check(!Object.hasOwn(row,'expectedCandidateIds'),'Confirm the reviewed panel candidate explicitly');
    check(matches.length===1||row.matchConfirmed===true,'Multiple QA items use this panel ID. Choose and confirm the correct panel before saving.',409);
    const panel=selected[0],checks=records.filter(record=>record.id===panel.id);
    check(checks.length<=1,'This panel has conflicting QA identities',409);
    const record=checks[0];
    check(!record||['awaiting','approved'].includes(record.status),'This panel is no longer awaiting or approved QA. Review the import.',409);
    check(row.panelArea?.method==='manual','Import the drawing-stated panel area');
    const change=preparePanelArea(store,row,actor,panel,record);
    return {panel,record,change,page:row.page,candidateIds,matchConfirmed:row.matchConfirmed===true};
  });
  const result={ok:true,items:prepared.map(({panel,record,change})=>({id:panel.id,kind:'panel',...panelAreaFields(panel,record,change.next)})),savedCount:prepared.filter(({change})=>!change.same).length};
  store.ctx.storage.transactionSync(()=>{
    check(panelAreaResetGeneration(store)===generation,'QA panel areas were reset. Review the PDF again and start a new import.',409);
    for(const {panel,change} of prepared)commitPanelArea(store,panel,change,actor);
    store.audit(actor.username,'qa-panel-area-pdf-imported',{importId:body.importId,fileName:body.fileName,project:body.project,orderNumber:body.orderNumber,panels:prepared.map(({panel,page,change,candidateIds,matchConfirmed})=>({id:panel.id,page,areaM2:change.value.areaM2,candidateIds,matchConfirmed})),savedCount:result.savedCount});
    store.write(receiptKey,{username:actor.username,fingerprint,generation,result});
  });
  return result;
}

