export const isGateProgressComplete=order=>order.components?.length>0?order.components.every(component=>!!component.delivery):order.status==='dispatched';
export const gateProgressStageDefinitions=[
 ['drawn','Drawn'],
 ['scheduledForProduction','Scheduled for production'],['fabricatedQa','Fabricated/QA'],
 ['readyForDispatch','Ready for dispatch'],
 ['dispatched','Dispatched'],['delivered','Delivered']
];
// A scheduled delivery alone does not mean fabrication has been scheduled.
export function gateProgressStages(components,{missing=false,scheduled=0,scheduleTotal=1,legacyStages=null}={}){
 const total=components.length,counts={drawn:components.filter(c=>c.drawn!==false).length,fabricatedQa:components.filter(c=>c.qaStatus==='approved').length,
  readyForDispatch:components.filter(c=>c.qaStatus==='approved'&&(c.ready||c.shipment)).length,
  dispatched:components.filter(c=>c.shipment).length,delivered:components.filter(c=>c.delivery).length};
 return gateProgressStageDefinitions.map(([key,label])=>{
  const isSchedule=key==='scheduledForProduction';
  const legacy=!!legacyStages&&!total,count=isSchedule?scheduled:legacy?(legacyStages[key]?1:0):counts[key]||0,denominator=isSchedule?scheduleTotal:legacy?1:total;
  const complete=denominator>0&&count===denominator&&(isSchedule||legacy||!missing),rework=key==='fabricatedQa'&&components.some(c=>c.qaStatus==='recut');
  const state=rework?'rework':complete?'complete':'pending';
  const detail=rework?'Rework required':`${count}/${denominator} complete${!isSchedule&&(!legacy&&(missing||!total))?' · setup required':''}`;
  return {key,label,state,count:Number(count),total:Number(denominator),symbol:complete?'✓':'-',detail};
 });
}

// Villa summaries count known parts without inventing components for legacy orders.
// Scheduling remains an order-level measure, regardless of the number of parts.
export function gateProgressSummary(orders){
 const rows=orders.map(order=>{
  const components=order.components||[];
  return {components,stages:gateProgressStages(components,{missing:!components.length,scheduled:order.scheduledForProduction?1:0,legacyStages:order.legacyStages})};
 });
 const configured=rows.filter(row=>row.components.length),withoutComponents=rows.filter(row=>!row.components.length);
 return gateProgressStageDefinitions.map(([key,label],index)=>{
  const scheduled=key==='scheduledForProduction',useParts=!scheduled&&configured.length>0,source=useParts?configured:rows;
  const count=scheduled?orders.filter(order=>order.scheduledForProduction).length:source.reduce((sum,row)=>sum+(useParts?row.stages[index].count:Number(row.stages[index].state==='complete')),0);
  const total=scheduled?orders.length:useParts?configured.reduce((sum,row)=>sum+row.components.length,0):orders.length,unit=useParts?'parts':'orders';
  const rework=key==='fabricatedQa'&&rows.some(row=>row.stages[index].state==='rework'),complete=rows.length>0&&rows.every(row=>row.stages[index].state==='complete');
  const state=rework?'rework':complete?'complete':'pending',setupOrders=scheduled?0:withoutComponents.length;
  let detail=`${count}/${total} ${unit} complete`;
  if(setupOrders){
   const legacyComplete=withoutComponents.filter(row=>row.stages[index].state==='complete').length;
   detail+=useParts?` · ${legacyComplete}/${setupOrders} orders without component details complete`:` · ${setupOrders} order${setupOrders===1?'':'s'} without component details`;
  }
  if(rework){const failed=rows.reduce((sum,row)=>sum+row.components.filter(component=>component.qaStatus==='recut').length,0);detail+=` · Rework required for ${failed} component${failed===1?'':'s'}`;}
  return {key,label,state,count,total,unit,detail,setupOrders,symbol:complete?'✓':'-'};
 });
}
