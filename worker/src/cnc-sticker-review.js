import {createHash} from 'node:crypto';
import {requireCondition as check} from './security.js';
import {normalizeCncInput} from './cnc-input.js';
import {activePanelQaExemption,qaProductionSignature} from './qa-exemptions.js';

const control=/[\u0000-\u001f\u007f]/,REVIEW='cnc-sticker-review:',INVALID='cnc-sticker-invalidated:';
const text=(value,max=200,empty=false)=>typeof value==='string'&&value===value.trim()&&value.length<=max&&(empty||value.length>0)&&!control.test(value);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const normal=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-AU');
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const scope=panel=>{const row=normalizeCncInput(panel);return [normal(row.jobReference),normal(row.orderNumber)];};
const sameScope=(a,b)=>same(scope(a),scope(b));
const invalidKey=(reviewId,panelId)=>INVALID+reviewId+':'+panelId;

// Human labels and lifecycle timestamps may change without changing the part.
// A separate permanent invalidation marker prevents an edited assignment from
// becoming trusted again merely because its old dimensions are restored.
export function cncStickerPhysicalSignature(panel){
  const row=normalizeCncInput(panel),value={scope:scope(row),sheetNumber:normal(row.sheetNumber),stockItemType:row.stockItemType||'variant',stockItemId:row.stockItemId||row.stockVariantId||'',stockSku:normal(row.stockSku)};
  for(const key of ['sheetWidth','sheetHeight','totalPanelArea','panelWidth','panelHeight','thickness','stockThickness','pdfPage','pdfRevision'])value[key]=row[key]??null;
  for(const key of ['panelAreaScope','material','stockMaterial','color','colour','stockColor','isRemake','isTemplate','remakeReason'])value[key]=row[key]??null;
  return hash(value);
}

export function validateCncStickerMetadata(sticker,panelId){
  check(object(sticker)&&Object.keys(sticker).every(key=>['reviewId','labelId','role','mainPanelId','areaM2'].includes(key)),'Invalid reviewed sticker assignment');
  check(text(sticker.reviewId,100)&&text(sticker.labelId,120)&&text(sticker.mainPanelId,100)&&['main','cap'].includes(sticker.role),'Invalid reviewed sticker identity');
  if(sticker.role==='main')check(sticker.mainPanelId===panelId&&typeof sticker.areaM2==='number'&&Number.isFinite(sticker.areaM2)&&sticker.areaM2>0&&sticker.areaM2<=99999,'Invalid main-panel sticker area');
  else check(sticker.mainPanelId!==panelId&&!Object.hasOwn(sticker,'areaM2'),'A cap cannot carry the combined panel area');
}

export function cncStickerContext(store,actor){
  check(actor?.isAdmin===true,'Only administrators can review panel stickers',403);store.requireTask(actor,'factory.cnc');
  const generation=store.read('qa-panel-area-reset-generation',null),restoreEpoch=store.read('restoreEpoch',0);
  check(Number.isSafeInteger(restoreEpoch)&&restoreEpoch>=0,'Refresh the saved production context',409);
  return {ok:true,areaGeneration:typeof generation==='string'?generation:generation?.id||null,restoreEpoch};
}

// Read paths independently verify the immutable receipt and permanent markers.
// A structurally plausible JSON field alone never supplies fabrication area.
export function readCncStickerContext(store,panel,{panels,cache=new Map()}={}){
  try{
    const metadata=panel?.sticker;if(!metadata)return null;validateCncStickerMetadata(metadata,panel.id);
    const readReceipt=id=>{if(!cache.has(id))cache.set(id,store.read(REVIEW+id,null));return cache.get(id);},receipt=readReceipt(metadata.reviewId),binding=receipt?.bindings?.[panel.id];
    if(receipt?.schemaVersion!==1||receipt.reviewId!==metadata.reviewId||!text(receipt.by,100)||!binding||binding.labelId!==metadata.labelId||binding.role!==metadata.role||binding.mainPanelId!==metadata.mainPanelId||metadata.role==='main'&&binding.areaM2!==metadata.areaM2||binding.physicalSignature!==cncStickerPhysicalSignature(panel)||store.read(invalidKey(metadata.reviewId,panel.id),null))return null;
    if(metadata.role==='cap'){
      const candidates=(panels||store.read('app:cncPanels',[])).filter(value=>value.id===metadata.mainPanelId);
      if(candidates.length!==1)return null;const parent=candidates[0];
      if(parent.sticker?.role!=='main'||parent.sticker.reviewId!==metadata.reviewId||!sameScope(parent,panel)||!readCncStickerContext(store,parent,{panels,cache}))return null;
    }
    return {role:metadata.role,mainPanelId:metadata.mainPanelId,reviewId:metadata.reviewId,...(metadata.role==='main'?{areaM2:metadata.areaM2}:{})};
  }catch{return null;}
}

function reviewedSource(review){
  check(object(review)&&review.schemaVersion===1&&review.confirmed===true&&review.scopeConfirmed===true,'Confirm the sticker areas, cap relationships and selected order');
  check(object(review.scope)&&text(review.scope.project,120)&&text(review.scope.orderNumber,200),'Choose the project and literal order number for these stickers');
  const source=review.source;
  check(object(source)&&text(source.fileName,200)&&typeof source.sha256==='string'&&/^[a-f0-9]{64}$/.test(source.sha256)&&Number.isSafeInteger(source.bytes)&&source.bytes>0&&source.bytes<=32*1024*1024,'Invalid sticker PDF provenance');
  check(Array.isArray(review.labels)&&review.labels.length>0&&review.labels.length<=500,'Review between 1 and 500 main-panel stickers');
  const labels=new Map(),mains=new Map();
  for(const label of review.labels){
    check(object(label)&&text(label.labelId,120)&&!labels.has(label.labelId)&&Number.isSafeInteger(label.page)&&label.page>=1&&label.page<=300&&text(label.reference,200),'Invalid or repeated main-panel sticker');
    check(typeof label.areaM2==='number'&&Number.isFinite(label.areaM2)&&label.areaM2>0&&label.areaM2<=99999,'Invalid combined sticker area');
    for(const key of ['project','order','date'])check(label[key]===undefined||text(label[key],200,true),'Invalid printed sticker header');
    check(label.warnings===undefined||Array.isArray(label.warnings)&&label.warnings.length<=30&&label.warnings.every(value=>text(value,1000,true)),'Invalid sticker warnings');
    check(Array.isArray(label.caps)&&label.caps.length<=4,'Review the explicit end-plate labels');
    labels.set(label.labelId,{...label,role:'main',mainLabelId:label.labelId});mains.set(label.labelId,label);
    const sides=new Set();
    for(const cap of label.caps){
      check(object(cap)&&text(cap.labelId,120)&&!labels.has(cap.labelId)&&text(cap.reference,200)&&text(cap.parentReference,200)&&['L','R','B','T'].includes(cap.side)&&!sides.has(cap.side)&&cap.evidence==='end-plate-label','Invalid or repeated cap label');
      check(normal(cap.parentReference)===normal(label.reference)&&normal(cap.reference)===normal(label.reference+' EP-'+cap.side),'A cap must have an explicit matching parent and end-plate suffix');
      sides.add(cap.side);labels.set(cap.labelId,{...cap,page:label.page,role:'cap',mainLabelId:label.labelId});
    }
  }
  check(labels.size<=1500,'The sticker PDF contains too many part labels');
  check(Array.isArray(review.mappings)&&review.mappings.length>0&&review.mappings.length<=500,'Review between 1 and 500 scheduled parts');
  return {labels,mains};
}

function recordEligible(record){
  return !record||record.kind==='panel'&&(!record.status||record.status==='awaiting')&&!record.latest&&
    !(record.history?.length||record.photoAdditions?.length||record.qaExemptionHistory?.length||record.qaExemption||record.qaReset||record.qaResetHistory?.length||record.remakeOf||record.replacementId||record.replacementStatus||record.resolvedSeparatelyAt);
}

// Called with the server-normalized final mutation. It prepares only immutable
// review/invalidation documents and genuine cap exemptions at the actual cut.
// The caller commits them in the existing stock/CNC transaction.
export function prepareCncStickerMutation(store,changes,actor,now,mutationId){
  const relevant=changes.some(change=>change.field==='cncPanels'&&(change.before?.sticker||change.after?.sticker)||change.field==='transactions'&&!change.before&&change.after?.source==='cnc-stickers');
  if(!relevant)return {reviewDocuments:[],records:null,qaChanged:false,audits:[]};
  const panels=store.read('app:cncPanels',[]),records=store.read('qa-checks',[]),loads=store.read('panel-dispatch-loads',[]),dispatches=store.read('qa-dispatches',[]);
  check([panels,records,loads,dispatches].every(Array.isArray),'Refresh production history before using sticker assignments',409);
  const before=new Map(),counts=new Map();for(const panel of panels){before.set(panel.id,panel);counts.set(panel.id,(counts.get(panel.id)||0)+1);}
  const final=new Map(before),cncChanges=changes.filter(change=>change.field==='cncPanels'),changedById=new Map(cncChanges.map(change=>[change.id,change]));
  for(const change of cncChanges){if(change.after)final.set(change.id,change.after);else final.delete(change.id);}
  const reviews=new Map(),reviewDocuments=[],audits=[],invalidated=new Set(),qaById=new Map();
  for(const record of records){const list=qaById.get(record.id)||[];list.push(record);qaById.set(record.id,list);}
  const pendingReviews=changes.filter(change=>change.field==='transactions'&&!change.before&&change.after?.source==='cnc-stickers');
  for(const change of pendingReviews){
    check(actor?.isAdmin===true,'Only administrators can review sticker areas and cap exclusions',403);
    const activity=change.after,review=activity.stickerReview,{labels}=reviewedSource(review),mapped=new Map(),used=new Set();
    const generation=store.read('qa-panel-area-reset-generation',null),currentGeneration=typeof generation==='string'?generation:generation?.id||null;
    check(Object.hasOwn(review,'areaGeneration')&&review.areaGeneration===currentGeneration&&review.restoreEpoch===store.read('restoreEpoch',0),'Panel areas were reset or a backup was restored. Review the sticker PDF again.',409);
    check(activity.type==='cnc'&&text(activity.id,100)&&!reviews.has(activity.id)&&!store.read(REVIEW+activity.id,null),'This sticker review reference was already used. Start a new review.',409);
    for(const mapping of review.mappings){
      check(object(mapping)&&text(mapping.panelId,100)&&text(mapping.labelId,120)&&text(mapping.mainPanelId,100)&&['main','cap'].includes(mapping.role)&&!mapped.has(mapping.panelId)&&!used.has(mapping.labelId),'Map each printed part and scheduled record once');
      const panel=final.get(mapping.panelId),source=labels.get(mapping.labelId),delta=changedById.get(mapping.panelId);
      check(panel?.status==='pending'&&delta?.after?.status==='pending'&&(!delta.before||delta.before.status==='pending'),'Only new or pending scheduled parts can receive sticker review',409);
      check((counts.get(panel.id)||0)<=1&&source?.role===mapping.role,'A sticker match is missing, ambiguous or has the wrong part role',409);
      check(sameScope(panel,{jobReference:review.scope.project,orderNumber:review.scope.orderNumber}),'A sticker target belongs to another project or order',409);
      check(normal(panel.panelNumber)===normal(source.reference),'The reviewed printed ID does not match this scheduled part',409);
      const expected={reviewId:activity.id,labelId:mapping.labelId,role:mapping.role,mainPanelId:mapping.mainPanelId,...(mapping.role==='main'?{areaM2:source.areaM2}:{})};
      validateCncStickerMetadata(panel.sticker,panel.id);check(same(panel.sticker,expected),'The scheduled sticker assignment differs from the reviewed label',409);
      mapped.set(mapping.panelId,{...mapping,source});used.add(mapping.labelId);
    }
    check(Array.isArray(activity.panelRecordIds)&&new Set(activity.panelRecordIds).size===mapped.size&&activity.panelRecordIds.length===mapped.size&&activity.panelRecordIds.every(id=>mapped.has(id)),'The sticker review activity must identify exactly its scheduled parts');
    for(const mapping of mapped.values())if(mapping.role==='cap'){
      const parent=mapped.get(mapping.mainPanelId);
      check(parent?.role==='main'&&parent.source.labelId===mapping.source.mainLabelId,'Map each cap to its reviewed main panel',409);
    }
    const bindings=Object.fromEntries([...mapped].map(([id,mapping])=>[id,{...review.mappings.find(value=>value.panelId===id),...(mapping.role==='main'?{areaM2:mapping.source.areaM2}:{}),physicalSignature:cncStickerPhysicalSignature(final.get(id)),qaBaseline:hash((qaById.get(id)||[]).length===1?qaById.get(id)[0]:null)}])),
      receipt={schemaVersion:1,reviewId:activity.id,mutationId,by:actor.username,at:now,provenance:'administrator-reviewed-browser-extraction',source:review.source,scope:review.scope,labels:review.labels,mappings:review.mappings,bindings};
    reviews.set(activity.id,receipt);reviewDocuments.push({key:REVIEW+activity.id,value:receipt});
    audits.push({action:'cnc-stickers-reviewed',detail:{reviewId:activity.id,mutationId,source:review.source,scope:review.scope,partCount:mapped.size,mainCount:[...mapped.values()].filter(value=>value.role==='main').length,areaM2:[...mapped.values()].filter(value=>value.role==='main').reduce((total,value)=>total+value.source.areaM2,0),provenance:receipt.provenance}});
  }
  const readReview=id=>reviews.get(id)||store.read(REVIEW+id,null);
  for(const change of cncChanges){
    const old=change.before?.sticker,next=change.after?.sticker;
    if(old&&(!next||!same(old,next)||change.after&&cncStickerPhysicalSignature(change.before)!==cncStickerPhysicalSignature(change.after))){
      check(actor?.isAdmin===true,'Only administrators can clear or replace reviewed sticker assignments',403);
      const assembly=panels.filter(panel=>panel.sticker?.reviewId===old.reviewId&&panel.sticker?.mainPanelId===old.mainPanelId);
      check(assembly.every(panel=>panel.status==='pending'),'This sticker assembly already has cut parts. Preserve that progress and use a new revision or remake.',409);
      check(assembly.every(panel=>{const remaining=final.get(panel.id)?.sticker;return !remaining||remaining.reviewId!==old.reviewId;}),'Clear or replace every pending part of the reviewed assembly, including caps on other sheets.',409);
      const key=invalidKey(old.reviewId,change.id);invalidated.add(key);
      if(!store.read(key,null)){
        reviewDocuments.push({key,value:{schemaVersion:1,reviewId:old.reviewId,panelId:change.id,at:now,by:actor.username,mutationId,reason:'The reviewed scheduled part was changed, cleared or removed'}});
        audits.push({action:'cnc-sticker-assignment-invalidated',detail:{reviewId:old.reviewId,panelId:change.id,mainPanelId:old.mainPanelId,mutationId}});
      }
    }
    if(!next)continue;
    validateCncStickerMetadata(next,change.id);
    if(!old||!same(old,next))check(reviews.has(next.reviewId),'Sticker roles and areas require a new explicit administrator review',403);
    if(old&&same(old,next)&&change.after&&cncStickerPhysicalSignature(change.before)!==cncStickerPhysicalSignature(change.after))check(false,'The reviewed sticker context changed. Clear the assembly assignments or review the stickers again.',409);
  }
  const trusted=(panel)=>{
    const metadata=panel?.sticker;if(!metadata)return null;
    validateCncStickerMetadata(metadata,panel.id);
    const receipt=readReview(metadata.reviewId),binding=receipt?.bindings?.[panel.id],key=invalidKey(metadata.reviewId,panel.id);
    check(receipt?.schemaVersion===1&&receipt.reviewId===metadata.reviewId&&text(receipt.by,100)&&binding&&
      binding.labelId===metadata.labelId&&binding.role===metadata.role&&binding.mainPanelId===metadata.mainPanelId&&(metadata.role!=='main'||binding.areaM2===metadata.areaM2)&&binding.physicalSignature===cncStickerPhysicalSignature(panel)&&
      !invalidated.has(key)&&!store.read(key,null),'This sticker assignment was changed or is no longer trusted. Review it again.',409);
    return {receipt,binding};
  };
  // Check related final identities, including parents on other physical sheets.
  const affected=new Set(cncChanges.flatMap(change=>[change.id,change.before?.sticker?.mainPanelId,change.after?.sticker?.mainPanelId].filter(Boolean)));
  for(const panel of final.values())if(panel?.sticker&&(affected.has(panel.id)||affected.has(panel.sticker.mainPanelId))){
    trusted(panel);
    if(panel.sticker.role==='cap'){
      const parent=final.get(panel.sticker.mainPanelId);
      check(parent?.sticker?.role==='main'&&parent.sticker.reviewId===panel.sticker.reviewId&&sameScope(parent,panel),'Keep the reviewed main panel and cap relationship, or clear and review the whole assembly.',409);trusted(parent);
    }
  }
  let qaChanged=false;const patches=new Map(),grants=[];
  for(const change of cncChanges){
    const panel=change.after;if(change.before?.status!=='pending'||panel?.status!=='completed'||panel.sticker?.role!=='cap')continue;
    const {receipt,binding}=trusted(panel),matches=qaById.get(panel.id)||[],previous=matches.length===1?matches[0]:null,
      shipped=loads.some(load=>load?.panelIds?.includes(panel.id)&&(load.status!=='waiting'||load.legs?.length||load.finalQa||load.coatingCompleted))||dispatches.some(dispatch=>dispatch?.lines?.some(line=>line.kind==='panel'&&line.id===panel.id)),
      inverse=records.some(record=>record.id!==panel.id&&(record.remakeOf===panel.id||record.replacementId===panel.id));
    if(matches.length>1||matches.length===1&&previous.kind!=='panel'||!recordEligible(previous)||hash(previous)!==binding.qaBaseline||shipped||inverse){
      audits.push({action:'cnc-cap-exemption-preserved-qa',detail:{panelId:panel.id,reviewId:receipt.reviewId,reason:'Existing QA or physical progress is preserved; no automatic cap exemption applied'}});continue;
    }
    const reason=`End plate included in main panel ${panel.sticker.mainPanelId}; administrator-reviewed sticker PDF ${receipt.source.fileName}`.slice(0,1000),signature=qaProductionSignature(panel),exemption={id:crypto.randomUUID(),reason,by:receipt.by,at:now,cutAt:panel.completedAt??null,productionSignature:signature,source:'cnc-stickers',reviewId:receipt.reviewId,mainPanelId:panel.sticker.mainPanelId,reviewedAt:receipt.at,appliedBy:actor.username},
      event={id:crypto.randomUUID(),action:'grant',exemptionId:exemption.id,...Object.fromEntries(['reason','by','at','cutAt','productionSignature','source','reviewId','mainPanelId','reviewedAt','appliedBy'].map(key=>[key,exemption[key]]))},
      current={...(previous||{id:panel.id,kind:'panel',latest:null,history:[]}),status:'not_required',qaExemption:exemption,qaExemptionHistory:[...(previous?.qaExemptionHistory||[]),event]};
    qaChanged=true;patches.set(panel.id,current);grants.push({panelId:panel.id,reviewId:receipt.reviewId,completedAt:panel.completedAt??null,previousRecord:previous,grantedRecord:current});audits.push({action:'cnc-cap-qa-not-required',detail:{panelId:panel.id,reviewId:receipt.reviewId,mainPanelId:panel.sticker.mainPanelId,authorizedBy:receipt.by,appliedBy:actor.username,cutAt:exemption.cutAt,exemptionId:exemption.id,reason}});
  }
  const nextRecords=qaChanged?[...records.map(record=>patches.get(record.id)||record),...[...patches.values()].filter(record=>!qaById.has(record.id))]:records;
  if(grants.length)reviewDocuments.push({key:'cnc-sticker-cut:'+mutationId,value:{schemaVersion:1,mutationId,at:now,by:actor.username,grants}});
  return {reviewDocuments,records:nextRecords,qaChanged,audits};
}

// Undo may reverse the original cut's own automatic authorization, but never
// later QA work. ID-only corrections legitimately rebase the live signature;
// every other saved grant/evidence field must still match the cut receipt.
export function prepareCncStickerUndoQa(store,sourceMutationId,panels,records,ids){
  const receipt=store.read('cnc-sticker-cut:'+sourceMutationId,null),allowed=new Set(),restore=new Map();
  if(receipt?.schemaVersion!==1||receipt.mutationId!==sourceMutationId||!Array.isArray(receipt.grants))return {allowed,records,qaChanged:false};
  for(const grant of receipt.grants){
    if(!ids.has(grant.panelId))continue;
    const matching=records.filter(record=>record.id===grant.panelId),panel=panels.find(value=>value.id===grant.panelId),expected=grant.grantedRecord,current=matching[0];
    if(matching.length!==1||!panel||panel.completedAt!==grant.completedAt||panel.sticker?.role!=='cap'||panel.sticker.reviewId!==grant.reviewId||!readCncStickerContext(store,panel,{panels})||!activePanelQaExemption(panel,current))continue;
    if(expected?.qaExemption?.source!=='cnc-stickers'||expected.qaExemption.reviewId!==grant.reviewId||current.qaExemption.id!==expected.qaExemption.id)continue;
    const comparison={...current,qaExemption:{...current.qaExemption,productionSignature:expected.qaExemption.productionSignature}};
    if(!same(comparison,expected))continue;
    allowed.add(grant.panelId);restore.set(grant.panelId,grant.previousRecord??null);
  }
  const next=records.flatMap(record=>restore.has(record.id)?restore.get(record.id)?[restore.get(record.id)]:[]:[record]);
  return {allowed,records:next,qaChanged:allowed.size>0};
}
