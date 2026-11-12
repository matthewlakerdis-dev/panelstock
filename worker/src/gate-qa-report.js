import {isGateType} from './order-types.js';
import {requireCondition as check} from './security.js';

const copy=value=>structuredClone(value);
const text=value=>String(value??'');
const count=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):0;
const qaStatus=value=>value==='rework'?'recut':value;
const attempt=value=>value?{...copy(value),status:qaStatus(value.status)}:null;
const qaEvidence=record=>({latest:attempt(record?.latest),history:Array.isArray(record?.history)?record.history.map(attempt):[],photoAdditions:copy(record?.photoAdditions||[])});
const recordChecklistKind=record=>{const evidence=record?.latest||(Array.isArray(record?.history)?record.history.at(-1):null);return evidence?.checklistKind||record?.checklistKind||(evidence?'metalwork':'gate');};
const counts=values=>values.reduce((map,value)=>map.set(value,(map.get(value)||0)+1),new Map());

export function gateQaOrderMetadata(order){
  if(!order||!isGateType(order.orderType))return null;
  return {id:order.id,orderId:order.id,project:text(order.project),orderNumber:text(order.orderNumber),orderType:text(order.orderType),villa:text(order.villa||order.location),colour:text(order.colour),areaM2:order.manualProduction?.areaM2??null,orderStatus:text(order.status),drawn:order.manualProduction?.stages?.drawn==='complete',currentRevision:typeof order.manualProduction?.qaRevision==='string'?order.manualProduction.qaRevision||null:null,componentCount:order.gateComponents?order.gateComponents.components?.length||0:order.items?.length||0};
}

function expectedPieces(order){
  if(order.gateComponents){
    const components=order.gateComponents.components||[],ids=counts(components.map(component=>component.id));
    return components.map((component,index)=>{const componentId=typeof component.id==='string'&&component.id?component.id:null;return {id:componentId&&ids.get(componentId)===1?componentId:`${order.id}:component:${index}`,componentId,set:Number.isInteger(component.set)?component.set:null,label:text(component.label||component.kind||`Component ${index+1}`),componentKind:text(component.kind||'Component'),quantity:1,index};});
  }
  return (order.items||[]).map((item,index)=>({id:`${order.id}:item:${index}`,componentId:null,set:null,label:text(item.description||`Item ${index+1}`),componentKind:'Item',quantity:count(item.quantity),index}));
}

function previousSnapshot(record,reason){
  return {id:record.id,qaId:record.id,kind:record.kind,gateOrderId:record.gateOrderId,componentId:record.gateComponentId||null,gateComponentId:record.gateComponentId||null,gateItemIndex:Number.isInteger(record.gateItemIndex)?record.gateItemIndex:null,gateRevision:record.gateRevision||null,set:Number.isInteger(record.gateSet)?record.gateSet:null,reference:text(record.reference),label:text(record.reference),quantity:count(record.quantity),status:qaStatus(record.status)||'awaiting',checklistKind:recordChecklistKind(record),drawnBy:text(record.drawnBy),drawnAt:record.createdAt||null,createdBy:text(record.createdBy),createdAt:record.createdAt||null,reason,...qaEvidence(record)};
}

function componentMovement(entries,componentId,quantity,stage){
  const matches=(entries||[]).filter(entry=>Array.isArray(entry.componentIds)&&entry.componentIds.includes(componentId));
  if(!matches.length)return null;
  const entry=matches[matches.length-1];
  return {id:entry.id||null,at:entry.at||null,by:text(entry.by),componentIds:[componentId],quantity,status:stage,...(entry.source?{source:text(entry.source)}:{})};
}

function legacyMovement(order,index,quantity,stage){
  let entries;
  if(stage==='dispatched'){
    entries=Array.isArray(order.dispatches)&&order.dispatches.length?order.dispatches.map(trip=>({id:trip.mutationId||trip.id||null,at:trip.at||null,by:text(trip.by),quantity:(trip.lines||[]).filter(line=>line.index===index).reduce((sum,line)=>sum+count(line.quantity),0)})):
      order.dispatch?[{id:order.dispatch.mutationId||null,at:order.dispatch.at||order.dispatchedAt||null,by:text(order.dispatch.by||order.dispatchedBy),quantity}]:[];
  }else entries=(order.receipts||[]).map(receipt=>({id:receipt.id||null,at:receipt.at||null,by:text(receipt.by),quantity:(receipt.lines||[]).filter(line=>line.index===index).reduce((sum,line)=>sum+count(line.accepted),0)}));
  entries=entries.filter(entry=>entry.quantity>0);if(!entries.length)return null;
  const total=entries.reduce((sum,entry)=>sum+entry.quantity,0),last=entries[entries.length-1];
  return {...last,quantity:total,status:total>=quantity?stage:'partial',events:entries};
}

// This is a read-only snapshot. Saved identities, never names, determine links.
export function buildGateQaReport(order,records,checklists={},generatedBy='',generatedAt=new Date().toISOString()){
  check(order&&isGateType(order.orderType),'Gate order not found',404);
  const metadata=gateQaOrderMetadata(order),pieces=expectedPieces(order),production=order.manualProduction||{},currentIds=Array.isArray(production.qaItemIds)?production.qaItemIds:[],
    idCounts=counts(records.map(record=>record.id)),currentCounts=counts(currentIds),componentCounts=counts(pieces.map(piece=>piece.componentId).filter(Boolean)),
    previousIds=new Set(order.gateComponents?.previousQaItemIds||[]),orderRecords=records.filter(record=>record.kind==='metalwork'&&record.gateOrderId===order.id),used=new Set(),rejectedReasons=new Map(),mappingIssues=[];
  const issue=message=>{if(!mappingIssues.includes(message))mappingIssues.push(message);};
  const currentReady=metadata.drawn&&production.qaWorkflowVersion===1&&!!metadata.currentRevision&&Array.isArray(production.qaItemIds);
  if(metadata.drawn&&!currentReady)issue('The current drawing does not have a valid saved QA revision.');
  if(metadata.drawn&&currentIds.length!==pieces.length)issue('The current QA links do not match the number of expected pieces.');
  if(metadata.drawn&&currentIds.some(id=>typeof id!=='string'||!id||currentCounts.get(id)!==1))issue('The current drawing contains missing or duplicate QA links.');
  if(!pieces.length)issue('No expected Gate pieces are saved for this order.');
  const currentPool=currentReady?orderRecords.filter(record=>record.gateRevision===metadata.currentRevision&&currentCounts.has(record.id)):[];
  const items=pieces.map(piece=>{
    const {index,...definition}=piece;
    const candidates=currentPool.filter(record=>order.gateComponents?record.gateComponentId===piece.componentId&&piece.componentId:
      !record.gateComponentId&&(Number.isInteger(record.gateItemIndex)?record.gateItemIndex===index:currentIds.length===pieces.length&&currentIds[index]===record.id));
    const candidate=candidates.length===1?candidates[0]:null,valid=!!candidate&&idCounts.get(candidate.id)===1&&currentCounts.get(candidate.id)===1&&!previousIds.has(candidate.id)&&(!order.gateComponents||componentCounts.get(piece.componentId)===1)&&count(candidate.quantity)===piece.quantity&&piece.quantity>0;
    let record=valid?candidate:null,status=!metadata.drawn?'not_drawn':record?(['approved','recut'].includes(qaStatus(record.status))?qaStatus(record.status):'awaiting'):'missing';
    const lastHistory=Array.isArray(record?.history)?record.history.at(-1):null,approvalEvidence=record?.latest||lastHistory,
      conflictingAlias=record?.latest&&lastHistory&&record.latest.id===lastHistory.id&&(qaStatus(lastHistory.status)!=='approved'||Object.values(lastHistory.results||{}).includes('fail'));
    if(record?.status==='approved'&&(!approvalEvidence||qaStatus(approvalEvidence.status)!=='approved'||Object.values(approvalEvidence.results||{}).includes('fail')||conflictingAlias)){status='missing';rejectedReasons.set(record,'Saved current QA is incomplete or conflicts with its inspection evidence.');record=null;issue('A saved QA approval is missing a consistent current inspection.');}
    if(record&&metadata.drawn)used.add(record);else record=null;
    if(metadata.drawn&&status==='missing')issue('One or more expected pieces do not have a unique current QA inspection.');
    const shipment=order.gateComponents?componentMovement(order.gateComponents.shipments,piece.componentId,piece.quantity,'dispatched'):legacyMovement(order,index,piece.quantity,'dispatched'),delivery=order.gateComponents?componentMovement(order.gateComponents.deliveries,piece.componentId,piece.quantity,'delivered'):legacyMovement(order,index,piece.quantity,'delivered');
    return {...definition,qaId:record?.id||null,gateOrderId:order.id,gateRevision:record?.gateRevision||null,reference:text(record?.reference||piece.label),status,drawnBy:text(record?.drawnBy||production.drawnBy),drawnAt:record?.createdAt||production.drawnAt||null,checklistKind:recordChecklistKind(record),...qaEvidence(record),shipment,delivery};
  });
  if(metadata.drawn&&currentIds.some(id=>!Array.from(used).some(record=>record.id===id)))issue('Some current QA links do not match the expected pieces.');
  const previousQa=orderRecords.filter(record=>!used.has(record)).map(record=>previousSnapshot(record,rejectedReasons.get(record)||
    (!metadata.drawn?'QA retained from an earlier or withdrawn drawing.':record.gateRevision!==metadata.currentRevision?'QA from an earlier drawing revision.':previousIds.has(record.id)?'Earlier QA retained from a previous component layout.':!currentCounts.has(record.id)?'QA is no longer linked to the current drawing.':'QA does not map uniquely to a current expected piece.')));
  const summary={total:items.length,totalQuantity:items.reduce((sum,item)=>sum+item.quantity,0),approved:items.filter(item=>item.status==='approved').length,recut:items.filter(item=>item.status==='recut').length,awaiting:items.filter(item=>['awaiting','not_drawn'].includes(item.status)).length,missing:items.filter(item=>item.status==='missing').length,dispatched:items.filter(item=>item.shipment?.status==='dispatched').length,delivered:items.filter(item=>item.delivery?.status==='delivered').length,
    dispatchedQuantity:items.reduce((sum,item)=>sum+(item.shipment?.quantity||0),0),deliveredQuantity:items.reduce((sum,item)=>sum+(item.delivery?.quantity||0),0)};
  const status=order.status==='cancelled'?'cancelled':!metadata.drawn?'not_drawn':summary.recut?'recut':mappingIssues.length||summary.missing?'missing':summary.awaiting?'awaiting':summary.total>0&&summary.approved===summary.total?'approved':'missing',
    dispatchStatus=summary.totalQuantity>0&&summary.dispatchedQuantity>=summary.totalQuantity?'dispatched':summary.dispatchedQuantity>0?'partial':'not_dispatched',deliveryStatus=summary.totalQuantity>0&&summary.deliveredQuantity>=summary.totalQuantity?'delivered':summary.deliveredQuantity>0?'partial':'not_delivered';
  const {id,componentCount,...reportMetadata}=metadata;
  return {type:'gate-order',...reportMetadata,generatedAt,generatedBy,status,summary,dispatchStatus,deliveryStatus,mappingIssues,items,previousQa,checklists:copy({gate:checklists.gate||[],metalwork:checklists.metalwork||[]})};
}
