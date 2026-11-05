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
export function resolveCatalogueCost(item,catalog=[]){
 const entry=matchCatalogueMaterial(item,catalog),cents=entry?rateCents(entry.unitCostPerM2):null;
 if(cents===null)return null;
 const dimension=value=>['number','string'].includes(typeof value)&&decimalRatio(value)?Number(value):null;
 const width=dimension(item.width),height=dimension(item.height),ratePerM2=cents/100;
 const name=String(entry.name||'').trim()||[entry.color||entry.colour,entry.material,Number(entry.thickness)+' mm'].filter(Boolean).join(' · ');
 return {costBasis:'catalogue-area',catalogueCost:{catalogId:entry.id,name,ratePerM2,width,height},effectiveUnitCost:width===null||height===null?null:ratePerM2*width*height/1e6};
}
