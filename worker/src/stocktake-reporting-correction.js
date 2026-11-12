import {stocktakeMonth} from './stocktake-month.js';
import {correctStocktakeReportingMonth} from './stocktake-reporting-month.js';

// The user identified exactly these two October reports, created in October or
// during November testing. The production gate is specific to this repair.
export const OCTOBER_STOCKTAKE_CORRECTION_ID='2026-11-12-october-stocktake-month-v1';
const REPORTING_MONTH='2026-10';
const TARGETS=[{name:'October Stocktake - Remainder',manualItems:11},{name:'October Monthly Stocktake',manualItems:61}];
const marker='stocktake-reporting-correction:'+OCTOBER_STOCKTAKE_CORRECTION_ID;
const backupKey='stocktake-reporting-correction-backup:'+OCTOBER_STOCKTAKE_CORRECTION_ID;
const blocked=reason=>({status:'blocked',reason});
const manualId=id=>typeof id==='string'&&id&&!id.startsWith('variant:');
const submitted=value=>value!==null&&value!==undefined&&(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0;
const monthOf=value=>{if(typeof value!=='string'||!value.trim()||!Number.isFinite(Date.parse(value)))return null;return stocktakeMonth(value).key;};

function gate(store,env){
 if(env.SITE_ID!=='panelstock'||env.STOCKTAKE_REPORTING_MONTH_CORRECTION_ID!==OCTOBER_STOCKTAKE_CORRECTION_ID)return 'not_enabled';
 if(env.READ_ONLY==='true')return 'read_only';
 if(!store.read('initialized',false))return 'not_initialized';
 const id=env.INVENTORY?.idFromName('panelstock');if(!id||String(id)!==String(store.ctx.id))return 'not_canonical';
 return null;
}
function inspect(state){
 if(!state||!Array.isArray(state.stocktakes)||!Number.isSafeInteger(state.revision))return blocked('targets_missing');
 const targets=[];
 for(const expected of TARGETS){
  const matches=state.stocktakes.filter(count=>count?.name===expected.name);
  if(matches.length===0)return blocked('targets_missing');if(matches.length!==1)return blocked('targets_ambiguous');
  const count=matches[0];if(typeof count.id!=='string'||!count.id||state.stocktakes.filter(row=>row?.id===count.id).length!==1)return blocked('target_identity_invalid');
  if(count.status!=='completed')return blocked('target_status_changed');
  if(!['2026-10','2026-11'].includes(monthOf(count.createdAt))||monthOf(count.completedAt)!=='2026-11')return blocked('target_dates_mismatch');
  if(!Array.isArray(count.itemIds)||!count.counts||typeof count.counts!=='object'||!Array.isArray(count.report?.rows))return blocked('target_count_mismatch');
  const ids=count.itemIds.filter(manualId),entries=Object.entries(count.counts).filter(([id])=>manualId(id)),rows=count.report.rows.filter(row=>row?.quantitySource!=='soh-snapshot'),scope=new Set(ids);
  if(ids.length!==expected.manualItems||scope.size!==ids.length||entries.length!==expected.manualItems||rows.length!==expected.manualItems)return blocked('target_count_mismatch');
  if(entries.some(([id,entry])=>!scope.has(id)||!submitted(entry?.quantity))||rows.some(row=>!scope.has(row?.itemId)||!submitted(row.quantity))||new Set(rows.map(row=>row.itemId)).size!==rows.length)return blocked('target_count_mismatch');
  if(count.report.rows.some(row=>row?.quantitySource==='soh-snapshot'&&!(typeof row.itemId==='string'&&row.itemId.startsWith('variant:'))))return blocked('target_count_mismatch');
  const overrides=[count.reportingMonth,count.report.reportingMonth];
  if(overrides.some(value=>value!==undefined&&value!==null&&value!==''&&value!==REPORTING_MONTH))return blocked('prior_override_conflict');
  if(overrides.some(value=>value===REPORTING_MONTH)&&!overrides.every(value=>value===REPORTING_MONTH))return blocked('override_mismatch');
  targets.push({count,expected});
 }
 if(new Set(targets.map(target=>target.count.id)).size!==TARGETS.length)return blocked('target_identity_invalid');
 return {targets};
}
function unchangedPayload(count){
 const {reportingMonth,reportingMonthAudit,...value}=count;
 if(value.report){const {reportingMonth:reportMonth,...report}=value.report;value.report=report;}
 return JSON.stringify(value);
}
function verify(store,state,receipt){
 const checked=inspect(state),backup=store.read(backupKey,null);
 if(!checked.targets||receipt?.id!==OCTOBER_STOCKTAKE_CORRECTION_ID||receipt.reportingMonth!==REPORTING_MONTH||receipt.status!=='applied'||!Array.isArray(receipt.stocktakes)||receipt.stocktakes.length!==2||!Array.isArray(backup?.stocktakes)||backup.stocktakes.length!==2)return false;
 return checked.targets.every(({count,expected})=>{
  const recorded=receipt.stocktakes.find(row=>row.id===count.id&&row.name===expected.name&&row.manualItems===expected.manualItems),before=backup.stocktakes.find(row=>row.id===count.id);
  return !!recorded&&!!before&&count.reportingMonth===REPORTING_MONTH&&count.report.reportingMonth===REPORTING_MONTH&&unchangedPayload(before)===unchangedPayload(count);
 });
}

// Read-only public proof exposes only a bounded status code. Names, IDs, stock
// values and the two original records remain in private receipt/backup documents.
export function octoberStocktakeReportingCorrectionStatus(store,env){
 const disabled=gate(store,env);if(disabled)return blocked(disabled);
 const state=store.read('workshop-stock',null),receipt=store.read(marker,null);
 if(receipt)return verify(store,state,receipt)?{status:'verified'}:blocked('receipt_mismatch');
 const checked=inspect(state);return checked.targets?{status:'pending'}:checked;
}

export function applyOctoberStocktakeReportingCorrection(store,env){
 const disabled=gate(store,env);if(disabled)return blocked(disabled);
 try{return store.ctx.storage.transactionSync(()=>{
  const previous=store.read(marker,null),state=store.read('workshop-stock',null);
  if(previous)return verify(store,state,previous)?previous:blocked('receipt_mismatch');
  const checked=inspect(state);if(!checked.targets)return checked;
  const at=new Date().toISOString(),revision=store.read('revision',0),updates=new Map(),corrections=[];
  for(const {count} of checked.targets){
   if(count.reportingMonth===REPORTING_MONTH&&count.report.reportingMonth===REPORTING_MONTH)continue;
   const changed=correctStocktakeReportingMonth(count,{reportingMonth:REPORTING_MONTH,reason:'User requested October 2026 reporting for this October stocktake completed during November testing.',mutationId:OCTOBER_STOCKTAKE_CORRECTION_ID+':'+count.id},{username:'system',isAdmin:true},at,'controlled-correction');
   updates.set(count.id,changed.count);corrections.push(changed.correction);
  }
  const receipt={id:OCTOBER_STOCKTAKE_CORRECTION_ID,status:'applied',reportingMonth:REPORTING_MONTH,at,previousWorkshopRevision:state.revision,workshopRevision:state.revision+1,previousRevision:revision,revision:revision+1,changedCount:updates.size,stocktakes:checked.targets.map(({count,expected})=>({id:count.id,name:count.name,manualItems:expected.manualItems})),corrections};
  store.write(backupKey,{id:OCTOBER_STOCKTAKE_CORRECTION_ID,at,workshopRevision:state.revision,revision,stocktakes:structuredClone(checked.targets.map(({count})=>count))});
  store.write('workshop-stock',{...state,revision:state.revision+1,stocktakes:state.stocktakes.map(count=>updates.get(count.id)||count)});
  store.write('revision',revision+1);store.write(marker,receipt);store.audit('system','stocktake-reporting-month-correction',receipt);
  return receipt;
 });}catch{return blocked('storage_error');}
}
