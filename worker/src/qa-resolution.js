import {panelQaExemptionFields} from './qa-exemptions.js';
import {qaAssemblyRelation,mainQaAssembly,mainAssemblyCoverage} from './qa-assemblies.js';
const normalized=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
export function sameQaOrder(original,replacement){return normalized(original?.jobReference)===normalized(replacement?.jobReference)&&normalized(original?.orderNumber)===normalized(replacement?.orderNumber);}
export function sameQaReference(original,replacement){return normalized(original?.panelNumber)===normalized(replacement?.panelNumber);}
function ordinaryResolution(panel,record,panelsById,recordsById,loadPanelIds){
  const replacement=panelsById.get(record?.replacementId),replacementRecord=recordsById.get(record?.replacementId),context={replacementId:record?.replacementId||null,replacementReference:replacement?.panelNumber||'',replacementStatus:replacementRecord?.status||record?.replacementStatus||null},exemption=panelQaExemptionFields(panel,record);
  let qaResolved=false,qaBlocker=record?.status==='not_required'?'QA exemption expired':'Awaiting QA';
  if(exemption.qaStatus==='not_required'||record?.status==='approved'){qaResolved=true;qaBlocker='';}
  else if(record?.status==='replaced'){
    qaBlocker='Approved replacement required';
    if(replacement&&replacement.id!==panel?.id&&replacement.status==='completed'&&sameQaOrder(panel,replacement)){
      if(replacementRecord?.status!=='approved')qaBlocker='Replacement needs QA';
      else if(loadPanelIds&&!loadPanelIds.has(replacement.id))qaBlocker='Approved replacement outside this load';
      else{qaResolved=true;qaBlocker='';}
    }
  }else if(record?.status==='recut')qaBlocker='Recut required';
  return {...context,...exemption,qaResolved,qaBlocker};
}
function mainResolution(panel,record,panelsById,recordsById,loadPanelIds){
  const result=ordinaryResolution(panel,record,panelsById,recordsById,loadPanelIds),assembly=mainQaAssembly(panel,panelsById,recordsById);
  if(!assembly)return {...result,qaStandaloneRequired:true};
  const coverage=mainAssemblyCoverage(panel,record,assembly),issues=record?.status==='replaced'&&!coverage.covered?['Associate these components with the approved replacement, then check the full panel']:coverage.issues;
  const caps=assembly.caps.map(({snapshot,...cap})=>({...cap,historicalIssues:cap.issues,issues:coverage.covered?[]:cap.issues,coveredByMain:coverage.covered,qaResolved:panel.status==='completed'&&result.qaResolved&&coverage.covered,qaBlocker:result.qaBlocker||issues.join('; ')}));
  return {...result,qaStandaloneRequired:true,qaAssemblySignature:assembly.signature,qaAssembly:{role:'main',signature:assembly.signature,caps,issues,requiresInspection:!coverage.covered},...(record?.status==='approved'&&!coverage.covered?{qaStatus:'awaiting'}:{}),qaResolved:panel.status==='completed'&&result.qaResolved&&coverage.covered,qaBlocker:result.qaBlocker||issues.join('; ')};
}
export function panelQaResolution(panel,record,panelsById,recordsById,loadPanelIds){
  const relation=qaAssemblyRelation(panel,panelsById);
  if(!relation)return mainResolution(panel,record,panelsById,recordsById,loadPanelIds);
  const issues=[];let qaResolved=false,qaBlocker='';
  if(relation.linkState!=='linked'){qaBlocker=relation.linkState==='ambiguous'?'Choose the main panel for this component':'Main panel not found for this component';issues.push(qaBlocker);}
  else{
    const main=panelsById.get(relation.mainPanelId),mainRecord=recordsById.get(relation.mainPanelId),parent=mainResolution(main,mainRecord,panelsById,recordsById,loadPanelIds);
    if(panel.status!=='completed')qaBlocker='Component has not been cut';
    else if(main.status!=='completed')qaBlocker='Main panel has not been cut';
    else if(!parent.qaResolved)qaBlocker=parent.qaBlocker||'The full main panel needs QA';
    else qaResolved=true;
    if(qaBlocker)issues.push(qaBlocker);
  }
  return {...ordinaryResolution(panel,record,panelsById,recordsById,loadPanelIds),qaStatus:'included_with_main',qaStandaloneRequired:false,qaExemptionEligible:false,qaExemptionRevocable:false,qaResolved,qaBlocker,qaAssembly:{...relation,issues}};
}
