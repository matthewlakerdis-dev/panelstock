export const isGateProgressComplete=order=>order.components?.length>0?order.components.every(component=>!!component.delivery):order.status==='dispatched';
export const gateProgressStageDefinitions=[
 ['drawn','Drawn'],
 ['scheduledForProduction','Scheduled for production'],['fabricatedQa','Fabricated/QA'],
 ['readyForDispatch','Ready for dispatch'],
 ['dispatched','Dispatched'],['delivered','Delivered']
];
// A scheduled delivery alone does not mean fabrication has been scheduled.
export function gateProgressStages(components,{missing=false,scheduled=0,scheduleTotal=1,legacyStages=null}={}){
 const total=components.length,counts={drawn:total,fabricatedQa:components.filter(c=>c.qaStatus==='approved').length,
  readyForDispatch:components.filter(c=>c.qaStatus==='approved'&&(c.ready||c.shipment)).length,
  dispatched:components.filter(c=>c.shipment).length,delivered:components.filter(c=>c.delivery).length};
 return gateProgressStageDefinitions.map(([key,label])=>{
  const isSchedule=key==='scheduledForProduction';
  const legacy=!!legacyStages&&!total,count=isSchedule?scheduled:legacy?(legacyStages[key]?1:0):counts[key]||0,denominator=isSchedule?scheduleTotal:legacy?1:total;
  const complete=denominator>0&&count===denominator&&(isSchedule||legacy||!missing),rework=key==='fabricatedQa'&&components.some(c=>c.qaStatus==='recut');
  const state=rework?'rework':complete?'complete':'pending';
  const detail=rework?'Rework required':`${count}/${denominator} complete${!isSchedule&&(!legacy&&(missing||!total))?' · setup required':''}`;
  return {key,label,state,symbol:complete?'✓':'-',detail};
 });
}
