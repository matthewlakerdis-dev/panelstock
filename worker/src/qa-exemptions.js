import {requireCondition as check} from './security.js';
import {createHash} from 'node:crypto';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const qaProductionSignature=panel=>createHash('sha256').update(JSON.stringify(canonical(panel))).digest('hex');
const cutAt=panel=>panel?.completedAt||null;
const inspected=record=>!!record?.latest||(Array.isArray(record?.history)&&record.history.length>0);

export function activePanelQaExemption(panel,record){
  const exemption=record?.qaExemption;
  return !!panel&&panel.status==='completed'&&record?.kind==='panel'&&record.status==='not_required'&&!inspected(record)&&
    !!exemption?.id&&exemption.cutAt===cutAt(panel)&&exemption.productionSignature===qaProductionSignature(panel);
}

export function effectivePanelQaStatus(panel,record){
  return record?.status==='not_required'?(activePanelQaExemption(panel,record)?'not_required':'awaiting'):record?.status||'awaiting';
}

export function panelQaExemptionFields(panel,record,shipped=false){
  const active=activePanelQaExemption(panel,record),status=effectivePanelQaStatus(panel,record),completed=panel?.status==='completed';
  return {
    qaStatus:status,qaExemption:record?.qaExemption?{...record.qaExemption,active}:null,
    qaExemptionHistory:record?.qaExemptionHistory||[],qaProductionSignature:panel?qaProductionSignature(panel):'',
    qaExemptionEligible:!!completed&&!shipped&&!active&&!inspected(record)&&(!record?.status||['awaiting','not_required'].includes(record.status)),
    qaExemptionRevocable:!!completed&&!shipped&&record?.status==='not_required'&&!!record.qaExemption?.id,
    cutAt:cutAt(panel)
  };
}

export function qaExemptionShippedIds(loads=[],dispatches=[]){
  return new Set([...loads.filter(load=>load.status==='dispatched_to_site').flatMap(load=>load.panelIds||[]),
    ...dispatches.flatMap(dispatch=>(dispatch.lines||[]).filter(line=>line.kind==='panel').map(line=>line.id))]);
}

// Prepare the entire batch before its caller writes any record or audit event.
export function preparePanelQaExemptions(state,body,actor,now=new Date().toISOString()){
  check(actor.isAdmin,'Admin access required',403);
  check(body&&typeof body==='object'&&!Array.isArray(body),'Invalid QA requirement request');
  check(['grant','revoke'].includes(body.action),'Choose whether QA is required');
  check(typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.trim().length<=1000,'Add a reason of 1 to 1000 characters');
  check(Array.isArray(body.panels)&&body.panels.length>0&&body.panels.length<=500,'Select between 1 and 500 panels');
  const reason=body.reason.trim(),records=structuredClone(state.records),byId=new Map(state.panels.map(panel=>[panel.id,panel])),seen=new Set(),
    shipped=qaExemptionShippedIds(state.loads,state.dispatches),events=[];
  for(const input of body.panels){
    check(input&&typeof input==='object'&&typeof input.id==='string'&&input.id.length>0&&input.id.length<=100&&!seen.has(input.id),'Invalid or duplicate panel');seen.add(input.id);
    check(Object.hasOwn(input,'cutAt')&&(input.cutAt===null||typeof input.cutAt==='string'),'A current CNC completion is required');
    check(typeof input.productionSignature==='string','A current production signature is required');
    check(Object.hasOwn(input,'expectedExemptionId')&&(input.expectedExemptionId===null||typeof input.expectedExemptionId==='string'&&input.expectedExemptionId.length>0),'A current exemption ID is required');
    const panel=byId.get(input.id),index=records.findIndex(record=>record.kind==='panel'&&record.id===input.id),previous=index>=0?records[index]:null;
    check(panel?.status==='completed','Only completed CNC panels can have QA marked not required',409);
    check(input.cutAt===cutAt(panel)&&input.productionSignature===qaProductionSignature(panel),'Panel production changed. Refresh before changing its QA requirement.',409);
    check(input.expectedExemptionId===(previous?.qaExemption?.id||null),'The QA requirement changed. Refresh before saving.',409);
    const fields=panelQaExemptionFields(panel,previous,shipped.has(panel.id));
    check(!shipped.has(panel.id),'Dispatched panels cannot have their QA requirement changed',409);
    if(body.action==='grant')check(fields.qaExemptionEligible,'Only uninspected panels awaiting QA can have QA marked not required',409);
    else check(fields.qaExemptionRevocable,'This panel no longer has a QA exemption to revoke',409);
    const exemption=body.action==='grant'?{id:crypto.randomUUID(),reason,by:actor.username,at:now,cutAt:cutAt(panel),productionSignature:input.productionSignature}:null,
      event={id:crypto.randomUUID(),action:body.action,exemptionId:exemption?.id||previous.qaExemption.id,reason,by:actor.username,at:now,cutAt:cutAt(panel),productionSignature:input.productionSignature},
      current={...(previous||{id:panel.id,kind:'panel',latest:null,history:[]}),status:body.action==='grant'?'not_required':'awaiting',qaExemption:exemption,qaExemptionHistory:[...(previous?.qaExemptionHistory||[]),event]};
    if(index>=0)records[index]=current;else records.push(current);
    events.push({...event,panelId:panel.id,project:panel.jobReference||'',orderNumber:panel.orderNumber||'',sheetNumber:panel.sheetNumber||'',reference:panel.panelNumber||''});
  }
  return {records,events};
}
