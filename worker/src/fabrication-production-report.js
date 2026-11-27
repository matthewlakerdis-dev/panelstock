import {qaPanelsById} from './qa-assemblies.js';
import {panelQaResolution} from './qa-resolution.js';
import {panelAreaFor} from './qa-panel-area.js';
import {panelQaResetEnrolled} from './qa-panel-reset.js';

// Each approved QA item contributes its own actual area, never a shared sheet total.
export function fabricationProductionReportRows(panels,records,areas={}){
  const panelsById=qaPanelsById(panels);
  const qa=new Map(records.filter(record=>record.kind==='panel').map(record=>[record.id,record]));
  const unique=[...new Map(panels.filter(panel=>panel.id).map(panel=>[panel.id,panel])).values()],events=[];
  for(const panel of unique){
    const record=qa.get(panel.id),resolution=panelQaResolution(panel,record,panelsById,qa);
    if(resolution.qaStandaloneRequired===false||!resolution.qaResolved)continue;
    if(panel.status!=='completed'||record?.status!=='approved'||record.latest?.status!=='approved')continue;
    let attempts=[...(record.history||[]),record.latest];
    if(resolution.qaAssembly&&record.latest?.assemblyQa)attempts=[record.latest];
    if(panelQaResetEnrolled(panel,record)){
      // Historical approvals remain evidence, but completion after a deliberate
      // reset belongs to the new inspection cycle, even for an undated cut.
      const first=attempts.findIndex(attempt=>attempt?.id===record.qaReset.attemptId);
      if(record.qaReset.pending||!record.qaReset.attemptId||first<0)continue;
      attempts=attempts.slice(first);
    }
    const cut=Date.parse(panel.completedAt),approvals=attempts.filter(attempt=>attempt?.status==='approved'&&Number.isFinite(Date.parse(attempt.checkedAt))&&(!Number.isFinite(cut)||Date.parse(attempt.checkedAt)>=cut));
    const area=panelAreaFor(panel,record,Object.hasOwn(areas,panel.id)?areas[panel.id]:null);
    if(!area||!approvals.length)continue;
    const completedAt=approvals.reduce((first,attempt)=>Date.parse(attempt.checkedAt)<Date.parse(first.checkedAt)?attempt:first).checkedAt;
    events.push({id:panel.id,completedAt,areaM2:area.areaM2});
  }
  return events;
}
