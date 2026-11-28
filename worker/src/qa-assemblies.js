import {createHash} from 'node:crypto';
import {readCncStickerContext,cncStickerPhysicalSignature} from './cnc-sticker-review.js';
import {requireCondition as check} from './security.js';

const proof=Symbol('server-validated-qa-assembly'),members=Symbol('qa-assembly-all-records'),graphs=new WeakMap();
export function qaPanelsById(panels){const map=new Map(panels.map(panel=>[panel.id,panel]));Object.defineProperty(map,members,{value:panels});const graph=relationshipGraph(panels);graphs.set(map,graph);graphs.set(panels,graph);return map;}
const allPanels=panels=>Array.isArray(panels)?panels:panels?.[members]||[...panels.values()];
const normal=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const ASSEMBLY_LINK_PREFIX='qa-assembly-link:';
export const ASSEMBLY_LINK_RECEIPT='qa-assembly-link-receipt:';
export const sameAssemblyOrder=(a,b)=>normal(a?.jobReference)===normal(b?.jobReference)&&normal(a?.orderNumber)===normal(b?.orderNumber);
export function capReference(panel){
  const reference=String(panel?.panelNumber??'').trim(),suffix=value=>value.match(/^(.+?)\s+EP-([LRBT])$/i),parts=reference.split(',').map(value=>suffix(value.trim()));
  if(parts.length>1&&parts.some(Boolean)){
    const parentReference=parts.find(Boolean)[1].trim(),sameParent=parts.every(part=>part&&normal(part[1])===normal(parentReference));
    // A legacy row can contain several explicit caps. Mixed roles or
    // parents stay a component needing review, never a guessed concatenated ID.
    return {parentReference,side:null,...(!sameParent?{ambiguous:true}:{})};
  }
  const match=suffix(reference);return match?{parentReference:match[1].trim(),side:match[2].toUpperCase()}:null;
}

// Attestation is private and nonserializable. Browser CNC metadata cannot mint
// an assembly relationship; reviewed source receipts and admin link receipts do.
export function attestQaAssemblyPanels(store,panels){
  if(!Array.isArray(panels))return panels;graphs.delete(panels);
  const cache=new Map();
  for(const panel of panels){
    if(!panel||typeof panel!=='object')continue;
    delete panel[proof];let context=null;
    if(panel.sticker)try{context=readCncStickerContext(store,panel,{panels,cache});}catch{}
    if(context)Object.defineProperty(panel,proof,{value:{...context,source:'reviewed_sticker',revision:context.reviewId},configurable:true});
    const link=store.read(ASSEMBLY_LINK_PREFIX+panel.id,null);
    if(link?.schemaVersion===1&&link.panelId===panel.id&&typeof link.id==='string'){
      const receipt=store.read(ASSEMBLY_LINK_RECEIPT+link.id,null);
      if(receipt&&JSON.stringify(receipt.link)===JSON.stringify(link))Object.defineProperty(panel,proof,{value:{role:'cap',mainPanelId:link.mainPanelId,source:'admin_link',revision:link.id,coverageRevision:link.coverageRevision,side:link.side||null,parentReference:link.parentReference||''},configurable:true});
    }
  }
  graphs.set(panels,relationshipGraph(panels));
  for(const panel of panels){const relation=qaAssemblyRelation(panel,panels);if(relation?.mainPanelId){const main=panels.find(value=>value.id===relation.mainPanelId);if(main&&!qaAssemblyRelation(main,panels))Object.defineProperty(main,proof,{value:{...(main[proof]||{}),role:'main',assemblyParticipant:true},configurable:true});}}
  return panels;
}

function relationshipGraph(all){
  const ids=new Map(),parents=new Map(),relations=new Map();
  for(const panel of all){ids.set(panel.id,(ids.get(panel.id)||0)+1);if(panel[proof]?.role!=='cap'&&(!capReference(panel)||panel[proof]?.role==='main')){const key=JSON.stringify([normal(panel.jobReference),normal(panel.orderNumber),normal(panel.panelNumber)]),group=parents.get(key)||[];group.push(panel);parents.set(key,group);}}
  for(const panel of all){
    const trusted=panel?.[proof],parsed=capReference(panel);if(trusted?.role==='main'||trusted?.role!=='cap'&&!parsed)continue;
    const parentReference=trusted?.parentReference||parsed?.parentReference||'',side=trusted?.side||parsed?.side||null,ambiguousReference=trusted?.role!=='cap'&&parsed?.ambiguous===true;
    let candidates=ambiguousReference?[]:trusted?.role==='cap'?all.filter(value=>value?.id===trusted.mainPanelId&&value.id!==panel.id&&value[proof]?.role!=='cap'&&(!capReference(value)||value[proof]?.role==='main')&&sameAssemblyOrder(panel,value)):(parents.get(JSON.stringify([normal(panel.jobReference),normal(panel.orderNumber),normal(parentReference)]))||[]).filter(value=>value.id!==panel.id);
    const stableUnique=candidates.length===1&&ids.get(candidates[0].id)===1&&ids.get(panel.id)===1;
    relations.set(panel,{role:'cap',mainPanelId:stableUnique?candidates[0].id:null,parentReference:parentReference||candidates[0]?.panelNumber||'',side,linkState:ambiguousReference?'ambiguous':stableUnique?'linked':candidates.length?'ambiguous':'orphan',source:trusted?.source||'ep_suffix',linkRevision:trusted?.coverageRevision??trusted?.revision??('inferred:'+(stableUnique?candidates[0].id:''))});
  }
  return relations;
}
export function qaAssemblyRelation(panel,panels){const graph=graphs.get(panels)||relationshipGraph(allPanels(panels));return graph.get(panel)||[...graph].find(([member])=>member.id===panel?.id)?.[1]||null;}

const issueFor=(panel,record)=>{
  if(panel?.status!=='completed')return 'Component has not been cut';
  if(['recut','rework'].includes(record?.status))return 'Component has a failed QA inspection';
  if(record?.status==='replaced'||record?.replacementId||record?.remakeOf)return 'Component has a recut or replacement relationship';
  if(record?.qaReset?.pending)return 'Component QA was reset';
  if(['recut','rework','fail'].includes(record?.latest?.status)||Object.values(record?.latest?.results||{}).includes('fail'))return 'Component has a failed QA inspection';
  return '';
};
const capSnapshot=(panel,record,relation)=>({id:panel.id,status:panel.status,cutAt:panel.completedAt??null,physicalSignature:cncStickerPhysicalSignature(panel),linkRevision:relation.linkRevision,mainPanelId:relation.mainPanelId,qaStatus:record?.status||'awaiting',attemptId:record?.latest?.id||null,attemptAt:record?.latest?.checkedAt||null,attemptStatus:record?.latest?.status||null,attemptResults:record?.latest?.results||null,resetId:record?.qaReset?.id||null,resetPending:record?.qaReset?.pending===true,replacementId:record?.replacementId||null,remakeOf:record?.remakeOf||null});
export function mainQaAssembly(panel,panels,records){
  if(!panel)return null;
  const all=allPanels(panels),byQa=records instanceof Map?records:new Map(records.map(value=>[value.id,value]));
  if(qaAssemblyRelation(panel,all))return null;
  const caps=all.map(component=>({component,relation:qaAssemblyRelation(component,all)})).filter(({relation})=>relation?.mainPanelId===panel.id).sort((a,b)=>String(a.component.id).localeCompare(String(b.component.id)));
  if(!caps.length)return null;
  const snapshots=caps.map(({component,relation})=>capSnapshot(component,byQa.get(component.id),relation));
  const signature=hash({mainPanelId:panel.id,mainCutAt:panel.completedAt??null,mainPhysicalSignature:cncStickerPhysicalSignature(panel),caps:snapshots});
  return {role:'main',signature,caps:caps.map(({component,relation},index)=>({id:component.id,reference:component.panelNumber||'',sheetNumber:component.sheetNumber??'',side:relation.side,linkState:relation.linkState,status:component.status,cutAt:component.completedAt??null,qaStatus:byQa.get(component.id)?.status||'awaiting',issues:[issueFor(component,byQa.get(component.id))].filter(Boolean),snapshot:snapshots[index]})),issues:[],snapshot:{signature,mainPanelId:panel.id,caps:snapshots}};
}
export function mainAssemblyCoverage(panel,record,assembly){
  if(!assembly)return {covered:true,issues:[]};
  if(assembly.caps.some(cap=>cap.status!=='completed'))return {covered:false,issues:['Every component must be cut before the full panel can pass QA']};
  if(record?.status==='approved'&&record.latest?.status==='approved'&&record.latest?.assemblyQa?.signature===assembly.signature)return {covered:true,issues:[]};
  const issues=assembly.caps.flatMap(cap=>cap.issues.map(value=>`${cap.reference||cap.id}: ${value}`));
  if(issues.length)return {covered:false,issues};
  // Existing approvals remain valid only where their timestamp proves they
  // covered all already-cut, unproblematic components. No historical grant is created.
  const checked=Date.parse(record?.latest?.checkedAt);
  if(record?.status==='approved'&&record.latest?.status==='approved'&&Number.isFinite(checked)&&(!Number.isFinite(Date.parse(panel.completedAt))||Date.parse(panel.completedAt)<=checked)&&assembly.caps.every(cap=>Number.isFinite(Date.parse(cap.cutAt))&&Date.parse(cap.cutAt)<=checked)&&!record.latest?.assemblyQa)return {covered:true,issues:[]};
  // A real main exemption covers its assembly without inventing an inspection.
  if(record?.status==='not_required')return {covered:true,issues:[]};
  return {covered:false,issues:['The full panel needs a current QA inspection covering its components']};
}
export function assemblyCheckPlan(panel,panels,records,body){
  check(!qaAssemblyRelation(panel,panels),'This component is checked with its full main panel. Open the main panel’s QA check.',409);
  const assembly=mainQaAssembly(panel,panels,records);
  if(!assembly){check(body.expectedAssemblySignature===undefined||body.expectedAssemblySignature===null||body.expectedAssemblySignature==='','This panel’s components changed. Refresh and review the full panel before QA.',409);return null;}
  check(body.expectedAssemblySignature===assembly.signature,'This panel’s components changed. Refresh and review the full panel before QA.',409);
  check(assembly.caps.every(cap=>cap.status==='completed'),'Cut every component before checking the full panel',409);
  return assembly.snapshot;
}
export const qaAssemblyHash=hash;

export const isQaComponent=panel=>panel?.[proof]?.role==='cap'||panel?.[proof]?.role!=='main'&&!!capReference(panel);
export const assemblyQaApplies=panel=>panel?.status==='completed'&&(isQaComponent(panel)||panel?.[proof]?.assemblyParticipant===true);

// ID corrections preserve an already unambiguous physical association. This
// records the old inference before editable labels cease to describe it.
export function preserveQaAssemblyIdLinks(store,before,after){
  if(!Array.isArray(before)||!Array.isArray(after))return;
  const byId=new Map(after.map(panel=>[panel.id,panel])),changed=new Set();
  const withoutLabel=panel=>{const {panelNumber,...rest}=panel;return JSON.stringify(rest);};
  for(const panel of before){const next=byId.get(panel.id);if(next&&panel.panelNumber!==next.panelNumber&&withoutLabel(panel)===withoutLabel(next))changed.add(panel.id);}
  if(!changed.size)return;
  for(const panel of before){const relation=qaAssemblyRelation(panel,before);if(relation?.source!=='ep_suffix'||relation.linkState!=='linked'||!changed.has(panel.id)&&!changed.has(relation.mainPanelId))continue;
    const id='inferred-id-link-'+crypto.randomUUID(),link={schemaVersion:1,id,panelId:panel.id,mainPanelId:relation.mainPanelId,parentReference:relation.parentReference,side:relation.side,source:'preserved_id_correction',coverageRevision:relation.linkRevision,by:'system:id-correction',at:new Date().toISOString()};
    store.write(ASSEMBLY_LINK_RECEIPT+id,{schemaVersion:1,by:link.by,link,before:{componentReference:panel.panelNumber,parentReference:before.find(value=>value.id===relation.mainPanelId)?.panelNumber},after:{componentReference:byId.get(panel.id)?.panelNumber,parentReference:byId.get(relation.mainPanelId)?.panelNumber}});
    store.write(ASSEMBLY_LINK_PREFIX+panel.id,link);
  }
}

export function assemblyQaPreventsUndo(panels,records,ids){
  const targets=panels.filter(panel=>ids.has(panel.id));
  for(const record of records){for(const attempt of [...(record.history||[]),record.latest].filter(Boolean)){
    if(attempt.assemblyQa?.caps?.some(snapshot=>targets.some(panel=>snapshot.id===panel.id&&snapshot.cutAt===(panel.completedAt??null))))return true;
  }}
  for(const panel of targets){const relation=qaAssemblyRelation(panel,panels);if(!relation?.mainPanelId)continue;const parent=records.find(record=>record.kind==='panel'&&record.id===relation.mainPanelId),cut=Date.parse(panel.completedAt);if(Number.isFinite(cut)&&[...(parent?.history||[]),parent?.latest].some(attempt=>Number.isFinite(Date.parse(attempt?.checkedAt))&&Date.parse(attempt.checkedAt)>=cut))return true;}
  return false;
}
