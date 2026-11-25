import {requireCondition as check} from './security.js';
import {preparePanelArea,commitPanelArea,panelAreaFields} from './qa-panel-area.js';
const key=value=>typeof value==='string'?value.trim().toLowerCase():'';
export function importPanelAreas(store,body,actor){
  check(actor.isAdmin||actor.tasks?.['factory.qa']===true,'Complete QA checks access is required',403);
  check(typeof body.project==='string'&&body.project.trim()&&body.project.length<=120&&typeof body.orderNumber==='string'&&body.orderNumber.trim()&&body.orderNumber.length<=100,'Choose a project and order');
  check(typeof body.importId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(body.importId),'Start a new panel area import');
  check(Array.isArray(body.rows)&&body.rows.length>0&&body.rows.length<=500,'Select between 1 and 500 panel areas');
  check(typeof body.fileName==='string'&&body.fileName.length>0&&body.fileName.length<=200,'Choose a PDF file');
  const fingerprint=JSON.stringify({project:body.project,orderNumber:body.orderNumber,fileName:body.fileName,rows:body.rows});
  const receiptKey='qa-area-import:'+body.importId,receipt=store.read(receiptKey,null);
  if(receipt){check(receipt.username===actor.username&&receipt.fingerprint===fingerprint,'This import reference has already been used. Start a new import.',409);return receipt.result;}
  const panels=store.read('app:cncPanels',[]),records=store.readQaForDispatch(),seen=new Set();
  const scoped=panels.filter(panel=>panel.status==='completed'&&key(panel.jobReference)===key(body.project)&&key(panel.orderNumber)===key(body.orderNumber));
  // Resolve against every completed panel in the order, including failed/remade identities.
  // Never silently choose one sheet when a panel ID has been reused.
  const prepared=body.rows.map(row=>{
    check(row&&typeof row.id==='string'&&!seen.has(row.id),'Select each panel once');seen.add(row.id);
    check(typeof row.reference==='string'&&row.reference.trim()&&row.reference.length<=120&&Number.isInteger(row.page)&&row.page>0&&row.page<=300,'Invalid PDF panel reference');
    const matches=scoped.filter(panel=>key(panel.panelNumber)===key(row.reference));
    check(matches.length===1&&matches[0].id===row.id&&panels.filter(panel=>panel.id===row.id).length===1,'A panel match changed or is ambiguous. Refresh QA Centre and review the PDF again.',409);
    const panel=matches[0],checks=records.filter(record=>record.id===panel.id);
    check(checks.length<=1,'This panel has conflicting QA identities',409);
    const record=checks[0];
    check(!record||['awaiting','approved'].includes(record.status),'This panel is no longer awaiting or approved QA. Review the import.',409);
    check(row.panelArea?.method==='manual','Import the drawing-stated panel area');
    const change=preparePanelArea(store,row,actor,panel,record);
    return {panel,record,change,page:row.page};
  });
  const result={ok:true,items:prepared.map(({panel,record,change})=>({id:panel.id,kind:'panel',...panelAreaFields(panel,record,change.next)})),savedCount:prepared.filter(({change})=>!change.same).length};
  store.ctx.storage.transactionSync(()=>{
    for(const {panel,change} of prepared)commitPanelArea(store,panel,change,actor);
    store.audit(actor.username,'qa-panel-area-pdf-imported',{importId:body.importId,fileName:body.fileName,project:body.project,orderNumber:body.orderNumber,panels:prepared.map(({panel,page,change})=>({id:panel.id,page,areaM2:change.value.areaM2})),savedCount:result.savedCount});
    store.write(receiptKey,{username:actor.username,fingerprint,result});
  });
  return result;
}
