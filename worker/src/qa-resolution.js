const normalized=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();

export function sameQaOrder(original,replacement){
  return normalized(original?.jobReference)===normalized(replacement?.jobReference)&&
    normalized(original?.orderNumber)===normalized(replacement?.orderNumber);
}

export function sameQaReference(original,replacement){
  return normalized(original?.panelNumber)===normalized(replacement?.panelNumber);
}

// A separate recut closeout preserves the failed original; only its real,
// approved replacement resolves production QA. Dispatch also requires that
// replacement to travel in the selected load.
export function panelQaResolution(panel,record,panelsById,recordsById,loadPanelIds){
  const replacement=panelsById.get(record?.replacementId),replacementRecord=recordsById.get(record?.replacementId);
  const context={replacementId:record?.replacementId||null,replacementReference:replacement?.panelNumber||'',replacementStatus:replacementRecord?.status||record?.replacementStatus||null};
  let qaResolved=false,qaBlocker='Awaiting QA';
  if(record?.status==='approved'){
    qaResolved=true;qaBlocker='';
  }else if(record?.status==='replaced'){
    qaBlocker='Approved replacement required';
    if(replacement&&replacement.id!==panel?.id&&replacement.status==='completed'&&sameQaOrder(panel,replacement)){
      if(replacementRecord?.status!=='approved')qaBlocker='Replacement needs QA';
      else if(loadPanelIds&&!loadPanelIds.has(replacement.id))qaBlocker='Approved replacement outside this load';
      else{qaResolved=true;qaBlocker='';}
    }
  }else if(record?.status==='recut')qaBlocker='Recut required';
  return {...context,qaResolved,qaBlocker};
}
