import {requireCondition as check} from './security.js';

// Enrollment is tied to the existing cut, rather than its editable human label.
// A consumed reset remains enrollment for inspected legacy cuts without dates.
export function panelQaResetEnrolled(panel,record){
  const reset=record?.qaReset;
  return panel?.status==='completed'&&record?.kind==='panel'&&
    reset?.schemaVersion===1&&typeof reset.id==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(reset.id)&&
    Object.hasOwn(reset,'cutAt')&&reset.cutAt===(panel.completedAt??null)&&
    typeof reset.by==='string'&&reset.by.length>0&&typeof reset.at==='string'&&
    typeof reset.pending==='boolean';
}

export function panelQaApplies(panel,record,enabledFrom){
  return panel?.status==='completed'&&(
    !!panel.completedAt&&String(panel.completedAt)>=enabledFrom||
    !!record?.qaExemptionHistory?.length||panelQaResetEnrolled(panel,record)
  );
}

// Old open forms do not know a newly issued reset ID. Keep checking the same ID
// after consumption, so a delayed pre-reset request cannot reapprove later.
export function assertPanelQaResetToken(record,body){
  const expected=record?.qaReset?.id??null;
  if(expected!==null||Object.hasOwn(body,'expectedQaResetId'))
    check(body.expectedQaResetId===expected,'This panel QA was reset or changed. Refresh and review a new inspection.',409);
}

export function inspectionResetFields(panel,existing,attempt){
  const result={};
  if(existing?.qaReset){
    result.qaReset=panelQaResetEnrolled(panel,existing)&&existing.qaReset.pending?
      {...existing.qaReset,pending:false,attemptId:attempt.id,inspectedAt:attempt.checkedAt,inspectedBy:attempt.checkedBy}:existing.qaReset;
  }
  if(existing?.qaResetHistory)result.qaResetHistory=existing.qaResetHistory;
  return result;
}

export function inspectionHistoryForReset(existing,attempt){
  const history=Array.isArray(existing?.history)?existing.history:[],latest=existing?.latest;
  // Legacy records sometimes stored their only inspection in latest. A reset
  // leaves it there; its next inspection must move that exact evidence into
  // history before replacing the latest pointer.
  const same=(a,b)=>{
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  };
  const missing=existing?.qaReset?.pending&&latest&&!history.some(value=>latest.id&&value?.id===latest.id||same(value,latest));
  return [...history,...(missing?[latest]:[]),attempt];
}
