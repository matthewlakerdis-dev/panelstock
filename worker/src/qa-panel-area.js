import {requireCondition as check} from './security.js';
const numeric=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value));
const validArea=value=>numeric(value)&&Number(value)>0&&Number(value)<=99999;
export const PANEL_AREA_RESET_GENERATION_KEY='qa-panel-area-reset-generation';
export function panelAreaResetGeneration(store){const saved=store.read(PANEL_AREA_RESET_GENERATION_KEY,null);return typeof saved==='string'?saved:saved?.id||null;}
export function normalizePanelArea(input){
  check(input&&typeof input==='object'&&!Array.isArray(input),'Enter this panel’s length and width, or its actual m²');
  check(['dimensions','manual'].includes(input.method),'Choose dimensions or manual m²');
  if(input.method==='dimensions'){
    check([input.lengthMm,input.widthMm].every(value=>numeric(value)&&Number(value)>0&&Number(value)<=1000000),'Enter a positive panel length and width in millimetres');
    const lengthMm=Number(input.lengthMm),widthMm=Number(input.widthMm),areaM2=Math.round(lengthMm*widthMm*100)/100000000;
    check(validArea(areaM2),'Panel area must be greater than zero and at most 99,999 m²');
    return {method:'dimensions',lengthMm,widthMm,areaM2};
  }
  check(validArea(input.areaM2),'Enter a positive actual panel area of at most 99,999 m²');
  return {method:'manual',areaM2:Number(input.areaM2)};
}
export function panelAreaFor(panel,record,saved){
  // A reset deliberately suppresses historical inspection and CNC fallbacks.
  // An explicit area save replaces this tombstone without changing that history.
  if(saved?.value===null&&typeof saved.resetId==='string'&&saved.resetId)return null;
  const value=saved?.cutAt===(panel?.completedAt||null)?saved.value:record?.latest?.panelArea;
  if(value){try{return normalizePanelArea(value);}catch{return null;}}
  if(numeric(panel?.panelWidth)&&numeric(panel?.panelHeight)&&Number(panel.panelWidth)>0&&Number(panel.panelHeight)>0){try{return normalizePanelArea({method:'dimensions',lengthMm:panel.panelHeight,widthMm:panel.panelWidth});}catch{}}
  // A PDF's shared sheet total is never treated as an individual panel area.
  if(panel?.panelAreaScope!=='sheet'&&validArea(panel?.totalPanelArea))return {method:'manual',areaM2:Number(panel.totalPanelArea)};
  return null;
}
export function panelAreaFields(panel,record,saved){return {panelArea:panelAreaFor(panel,record,saved),panelAreaRevision:saved?.revision||0};}
export function preparePanelArea(store,body,actor,panel,record){
  check(actor.isAdmin||actor.tasks?.['factory.qa']===true,'Complete QA checks access is required',403);
  check(panel?.status==='completed','Choose a completed CNC panel',409);
  check(!record||record.kind==='panel','This QA identity is not a panel',409);
  check(!['recut','replaced','not_required'].includes(record?.status),'Record area for a panel awaiting or approved QA',409);
  const saved=store.read('qa-panel-area:'+panel.id,null),value=normalizePanelArea(body.panelArea);
  check(body.cutAt===(panel.completedAt||null),'This panel’s CNC completion changed. Refresh QA Centre.',409);
  check(body.expectedAttemptId===(record?.latest?.id||null),'This QA inspection changed. Refresh QA Centre.',409);
  check(Number.isSafeInteger(body.expectedAreaRevision)&&body.expectedAreaRevision>=0,'Refresh the panel area before saving');
  const same=saved?.cutAt===(panel.completedAt||null)&&JSON.stringify(saved.value)===JSON.stringify(value);
  check(body.expectedAreaRevision===(saved?.revision||0)||same,'Panel area changed on another device. Refresh QA Centre.',409);
  if(!same&&record?.status==='approved'&&panelAreaFor(panel,record,saved))check(actor.isAdmin||actor.tasks?.['factory.qa.manage']===true,'Manage QA access is required to correct an approved panel’s area',403);
  return {previous:saved,value,same,next:same?saved:{value,revision:(saved?.revision||0)+1,cutAt:panel.completedAt||null,updatedAt:new Date().toISOString(),updatedBy:actor.username}};
}
export function commitPanelArea(store,panel,prepared,actor){
  if(prepared.same)return;
  store.write('qa-panel-area:'+panel.id,prepared.next);
  store.audit(actor.username,'qa-panel-area-saved',{panelId:panel.id,previous:prepared.previous?.value||null,value:prepared.value,revision:prepared.next.revision,cutAt:panel.completedAt||null});
}

export function readPanelAreas(store){return Object.fromEntries(store.sql.exec("SELECT key,value FROM documents WHERE key GLOB 'qa-panel-area:*' AND part=0").toArray().map(({key,value})=>[key.slice('qa-panel-area:'.length),JSON.parse(value)]));}

