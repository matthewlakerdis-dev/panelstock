import {requireCondition as check} from './security.js';
import {decimalRatio} from './offcut-costing.js';

const normal=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
function rateCents(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||(value>0&&value<.01))return null;
 const cents=value*100;
 return Math.abs(cents-Math.round(cents))<=Number.EPSILON*Math.max(1,Math.abs(cents))*4?(Math.round(cents)||0):null;
}
export function normalizeCatalogueRate(value){
 if(value===null||(typeof value==='string'&&!value.trim()))return null;
 const cents=rateCents(value);
 check(cents!==null,'Catalogue price per m² must be a non-negative amount up to 1,000,000,000 with up to two decimal places');
 return cents/100;
}
function identity(item){
 const color=normal(item.color)||normal(item.colour),material=normal(item.material),raw=item.thickness;
 if(!['number','string'].includes(typeof raw)||typeof raw==='string'&&!raw.trim())return null;
 const thickness=Number(raw);
 return color&&material&&Number.isFinite(thickness)&&thickness>0&&thickness<=1e6?JSON.stringify([color,material,thickness]):null;
}
export function matchCatalogueMaterial(item,catalog=[]){
 const raw=identity(item);if(raw===null)return null;
 const matches=catalog.filter(entry=>identity(entry)===raw);
 const linked=matches.filter(entry=>entry.id===item.catalogId);
 if(linked.length===1)return linked[0];
 return matches.length===1?matches[0]:null;
}
export function resolveCataloguePricing(item,catalog=[]){
 const raw=identity(item);if(raw===null)return {cost:null,status:'invalid_material'};
 const matches=catalog.filter(entry=>identity(entry)===raw);
 if(!matches.length)return {cost:null,status:'no_matching_material'};
 const linked=matches.filter(entry=>entry.id===item.catalogId);
 let entry=linked.length===1&&rateCents(linked[0].unitCostPerM2)!==null?linked[0]:null;
 if(!entry){
  const priced=matches.map(entry=>({entry,cents:rateCents(entry.unitCostPerM2)})).filter(row=>row.cents!==null);
  if(!priced.length)return {cost:null,status:'unpriced_material'};
  if(priced.some(row=>row.cents!==priced[0].cents))return {cost:null,status:'conflicting_rates'};
  // Catalogue materials can have several legacy sheet-size records. Agreeing
  // prices define one material rate even when a linked size has no own price.
  entry=priced.reduce((chosen,row)=>String(row.entry.id)<String(chosen.entry.id)?row:chosen).entry;
 }
 const cents=rateCents(entry.unitCostPerM2);
 const dimension=value=>['number','string'].includes(typeof value)&&decimalRatio(value)?Number(value):null;
 const width=dimension(item.width),height=dimension(item.height),ratePerM2=cents/100;
 const name=String(entry.name||'').trim()||[entry.color||entry.colour,entry.material,Number(entry.thickness)+' mm'].filter(Boolean).join(' · ');
 return {cost:{costBasis:'catalogue-area',catalogueCost:{catalogId:entry.id,name,ratePerM2,width,height},effectiveUnitCost:width===null||height===null?null:ratePerM2*width*height/1e6},status:'resolved'};
}
export function resolveCatalogueCost(item,catalog=[]){return resolveCataloguePricing(item,catalog).cost;}
