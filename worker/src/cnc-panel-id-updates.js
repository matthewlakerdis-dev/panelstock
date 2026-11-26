import {requireCondition as check} from './security.js';
import {cncDuplicateKey} from './cnc-input.js';
import {activePanelQaExemption,qaProductionSignature} from './qa-exemptions.js';

const control=/[\u0000-\u001f\u007f]/;
const loadSignature=panels=>JSON.stringify(panels.slice().sort((a,b)=>a.id.localeCompare(b.id)));

// Pure preparation shared by the single-label correction and order PDF review.
// All labels are evaluated in the final set, so a reviewed swap is never an
// intermediate duplicate. Callers own authorization, snapshots and transactions.
export function preparePanelIdUpdates({panels,records,loads,updates,actor,operationId,now}){
  check(Array.isArray(panels)&&Array.isArray(records)&&Array.isArray(loads)&&Array.isArray(updates),'Saved production history cannot be read. Refresh before correcting IDs.',409);
  const byId=new Map(),counts=new Map(),patches=new Map(),corrections=[];
  for(const panel of panels){if(!panel||typeof panel.id!=='string')continue;byId.set(panel.id,panel);counts.set(panel.id,(counts.get(panel.id)||0)+1);}
  for(const update of updates){
    check(update&&typeof update.panelId==='string'&&!patches.has(update.panelId),'Select each saved panel once');
    check(counts.get(update.panelId)===1,'A selected CNC panel has conflicting or missing saved identities.',409);
    check(typeof update.newPanelNumber==='string'&&update.newPanelNumber.trim().length>0&&update.newPanelNumber.trim().length<=200&&!control.test(update.newPanelNumber),'Enter a panel ID of 1 to 200 characters without control characters');
    const old=byId.get(update.panelId),newPanelNumber=update.newPanelNumber.trim();
    check(['pending','completed'].includes(old.status),'A selected panel is no longer pending or cut.',409);
    patches.set(old.id,{before:old,after:old.panelNumber===newPanelNumber?old:{...old,panelNumber:newPanelNumber}});
  }
  const nextPanels=panels.map(panel=>patches.get(panel?.id)?.after||panel),finalById=new Map(nextPanels.filter(Boolean).map(panel=>[panel.id,panel]));
  for(const {after}of patches.values()){
    const key=cncDuplicateKey(after);
    check(!nextPanels.some(other=>other?.id!==after.id&&other&&cncDuplicateKey(other)===key),'This project, order and sheet already contain that panel ID. Choose a distinct ID.',409);
  }
  let qaRecordsChanged=false,loadsChanged=false,waitingLoadsUpdated=0;
  const qaPatches=new Map(),changedIds=new Set();
  for(const [panelId,{before,after}]of patches){
    const matches=records.filter(record=>record?.id===panelId);
    check(matches.length<=1&&(!matches.length||matches[0].kind==='panel'),'A selected panel has conflicting QA identities. Resolve them before correcting its ID.',409);
    const record=matches[0],changed=before!==after;
    const qaExemptionRebased=changed&&!!record&&activePanelQaExemption(before,record),
      qaExemptionKeptInactive=changed&&!!record&&!qaExemptionRebased&&activePanelQaExemption(after,record);
    if(qaExemptionRebased||qaExemptionKeptInactive){
      qaRecordsChanged=true;
      qaPatches.set(panelId,{...record,qaExemption:qaExemptionRebased?{...record.qaExemption,productionSignature:qaProductionSignature(after)}:{...record.qaExemption,invalidatedAt:now,invalidatedBy:actor.username,invalidatedByCorrection:operationId,invalidationReason:'Panel ID correction preserves an already-expired QA exemption'}});
    }
    if(changed)changedIds.add(panelId);
    corrections.push({panelId,oldPanelNumber:before.panelNumber??null,newPanelNumber:after.panelNumber,qaExemptionRebased,qaExemptionKeptInactive});
  }
  const nextRecords=qaRecordsChanged?records.map(record=>qaPatches.get(record?.id)||record):records,
    nextLoads=loads.map(load=>{
      if(load?.status!=='waiting'||!Array.isArray(load.panelIds)||!load.panelIds.some(id=>changedIds.has(id)))return load;
      if(new Set(load.panelIds).size!==load.panelIds.length||load.panelIds.some(id=>counts.get(id)!==1))return load;
      const before=load.panelIds.map(id=>byId.get(id));
      if(load.productionSignature!==loadSignature(before))return load;
      loadsChanged=true;waitingLoadsUpdated++;
      return {...load,productionSignature:loadSignature(load.panelIds.map(id=>finalById.get(id)))};
    });
  return {panels:nextPanels,records:nextRecords,loads:nextLoads,corrections,changedCount:changedIds.size,qaRecordsChanged,loadsChanged,waitingLoadsUpdated};
}
