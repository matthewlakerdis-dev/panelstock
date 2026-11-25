import {panelAreaFor} from './qa-panel-area.js';

// Each approved QA item contributes its own actual area, never a shared sheet total.
export function fabricationProductionReportRows(panels,records,areas={}){
  const qa=new Map(records.filter(record=>record.kind==='panel').map(record=>[record.id,record]));
  const unique=[...new Map(panels.filter(panel=>panel.id).map(panel=>[panel.id,panel])).values()],events=[];
  for(const panel of unique){
    const record=qa.get(panel.id);
    if(panel.status!=='completed'||record?.status!=='approved'||record.latest?.status!=='approved')continue;
    const cut=Date.parse(panel.completedAt),approvals=[...(record.history||[]),record.latest].filter(attempt=>attempt?.status==='approved'&&Number.isFinite(Date.parse(attempt.checkedAt))&&(!Number.isFinite(cut)||Date.parse(attempt.checkedAt)>=cut));
    const area=panelAreaFor(panel,record,Object.hasOwn(areas,panel.id)?areas[panel.id]:null);
    if(!area||!approvals.length)continue;
    const completedAt=approvals.reduce((first,attempt)=>Date.parse(attempt.checkedAt)<Date.parse(first.checkedAt)?attempt:first).checkedAt;
    events.push({id:panel.id,completedAt,areaM2:area.areaM2});
  }
  return events;
}
