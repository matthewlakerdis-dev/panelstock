import {validReportingMonth} from './stocktake-reporting-month.js';
const TIME_ZONE='Australia/Brisbane';
const monthParts=new Intl.DateTimeFormat('en-AU',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit'});
const monthLabel=new Intl.DateTimeFormat('en-AU',{timeZone:TIME_ZONE,year:'numeric',month:'long'});

export function stocktakeMonth(now=new Date()){
 const date=new Date(now),parts=monthParts.formatToParts(date),get=type=>parts.find(part=>part.type===type).value;
 return {key:get('year')+'-'+get('month'),label:monthLabel.format(date),timeZone:TIME_ZONE};
}

const timestamp=value=>{if(typeof value!=='string'||!value.trim())return undefined;const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:undefined;};
const submitted=value=>value!==null&&value!==undefined&&(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0;

export function countedStockItemsThisMonth(state,month=stocktakeMonth()){
 const [year,number]=month.key.split('-').map(Number);
 // Brisbane has no daylight saving; calendar month boundaries are UTC +10.
 const start=Date.UTC(year,number-1,1)-10*3600000,end=Date.UTC(year,number,1)-10*3600000;
 const counted=new Set(),linkedMovements=new Map();
 const mark=(id,at,reportingMonth)=>{if(typeof id==='string'&&id&&at!==undefined&&(reportingMonth?reportingMonth===month.key:at>=start&&at<end))counted.add(id);};
 for(const movement of state.movements||[]){
  if(movement.action!=='stocktake')continue;
  const at=timestamp(movement.at);if(at===undefined)continue;
  if(movement.stocktakeId){
   let items=linkedMovements.get(movement.stocktakeId);if(!items){items=new Map();linkedMovements.set(movement.stocktakeId,items);}
   if(!items.has(movement.itemId)||at>items.get(movement.itemId))items.set(movement.itemId,at);
  }else mark(movement.itemId,at);
 }
 for(const count of state.stocktakes||[]){
  const linked=linkedMovements.get(count.id);linkedMovements.delete(count.id);
  if(count.status==='draft')continue;
  const entries=count.counts||{},completed=count.status==='completed',reportRows=new Map();
  const reportingMonth=completed?(validReportingMonth(count.reportingMonth)?count.reportingMonth:validReportingMonth(count.report?.reportingMonth)?count.report.reportingMonth:undefined):undefined;
  if(completed)for(const row of count.report?.rows||[])if(submitted(row.quantity))reportRows.set(row.itemId,row);
  const completion=completed?(timestamp(count.completedAt)??timestamp(count.report?.completedAt)):undefined;
  for(const [id,entry] of Object.entries(entries)){
   if(!submitted(entry?.quantity))continue;
   const at=timestamp(entry.at)??linked?.get(id)??(completed?(timestamp(reportRows.get(id)?.at)??completion):undefined);
   mark(id,at,reportingMonth);reportRows.delete(id);linked?.delete(id);
  }
  // A saved report can be the only remaining evidence for older completed counts.
  for(const [id,row] of reportRows){mark(id,linked?.get(id)??timestamp(row.at)??completion,reportingMonth);linked?.delete(id);}
  for(const [id,at] of linked||[])mark(id,at,reportingMonth);
 }
 for(const items of linkedMovements.values())for(const [id,at] of items)mark(id,at);
 return counted;
}
