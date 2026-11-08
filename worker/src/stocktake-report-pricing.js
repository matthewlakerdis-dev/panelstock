import {resolveCataloguePricing} from './catalogue-costing.js';
import {resolveOffcutAreaCost,usesOffcutAreaCost} from './offcut-costing.js';

const geometryFields=['catalogId','color','material','thickness','width','height'];
const pricingFields=['costBasis','unitCost','packCost','packSize','costSourceItemId','xeroGroup'];
const areaFields=['sourceItemId','sourceName','sourceWidth','sourceHeight','sourceCostBasis','sourceUnitCost','sourcePackCost','sourcePackSize','offcutWidth','offcutHeight','ratePerM2','effectiveUnitCost'];
const catalogueFields=['catalogId','name','ratePerM2','width','height'];
const picked=(value,fields)=>Object.fromEntries(fields.map(key=>[key,value?.[key]??null]));

// This builder is called only on completion. Legacy reports are never enriched
// on read, and submitted identities never supply the completion-time prices.
export function captureStocktakeReportPricing(report,state,count,settings,context={}){
 const currentItems=new Map(state.items.map(item=>[item.id,item]));
 const variants=context.variants||[],offcuts=context.offcuts||[],catalog=context.catalog||[];
 const panels=new Map(variants.map(item=>['variant:'+item.id,item])),cuts=new Map(offcuts.map(item=>['offcut:'+item.id,item]));
 const frozenSettings=structuredClone(settings),groups=new Map(frozenSettings.cosGroups.map(group=>[group.id,group]));
 const categories={panels:'Panels',extrusions:'Extrusions',fixings:'Fixings',consumables:'Consumables',offcuts:'Offcuts',steel:'Steel',other:'Other',...state.categories};
 const capturedAt=count.completedAt;
 const rows=report.rows.map(row=>{
  const identity=count.counts[row.itemId]?.item||{},current=currentItems.get(row.itemId);
  const legacyPanel=panels.get(row.itemId),legacyOffcut=cuts.get(row.itemId);
  const legacy=!!(legacyPanel||legacyOffcut),raw=legacyPanel||legacyOffcut;
  const base=legacy?raw:current||{},metadata=legacy?state.metadata[row.itemId]||{}:{};
  const source=Object.fromEntries(pricingFields.map(key=>[key,Object.hasOwn(metadata,key)?metadata[key]:base[key]]));
  // In particular, never borrow current dimensions/material for an older
  // submission that did not capture them: that may describe different stock.
  const target={...Object.fromEntries(geometryFields.map(key=>[key,identity[key]===''?null:identity[key]??null])),colour:identity.colour??''};
  const catalogue=resolveCataloguePricing(target,catalog);
  const snapshot={pricingCapturedAt:capturedAt,costBasis:source.costBasis??'unit',unitCost:source.unitCost??null,packCost:source.packCost??null,packSize:source.packSize??1,areaCost:null,catalogueCost:null,width:target.width,height:target.height,xeroGroup:typeof source.xeroGroup==='string'?source.xeroGroup:''};
  if(catalogue.cost){
   snapshot.costBasis='catalogue-area';snapshot.catalogueCost=picked(catalogue.cost.catalogueCost,catalogueFields);
  }else if(legacyOffcut||source.costBasis==='area'){
   if(usesOffcutAreaCost(source)){
    snapshot.costBasis='area';
    const area=catalogue.status==='invalid_material'?null:resolveOffcutAreaCost(target,source,variants,state.metadata,catalog);
    snapshot.areaCost=area?.areaCost?picked(area.areaCost,areaFields):null;
   }
  }
  // A known catalogue-priced record with unavailable counted geometry must
  // remain frozen as unpriced rather than expose its retained manual fallback.
  if(!catalogue.cost&&resolveCataloguePricing(raw||current||{},catalog).cost){snapshot.costBasis='catalogue-area';snapshot.catalogueCost=null;snapshot.areaCost=null;}
  if(snapshot.costBasis==='catalogue-area'&&(!snapshot.catalogueCost||snapshot.catalogueCost.width===null||snapshot.catalogueCost.height===null)){snapshot.unitCost=null;snapshot.packCost=null;}
  const group=groups.get(snapshot.xeroGroup);
  return {...row,details:identity.details??'',categoryLabel:categories[row.category]||row.category,...snapshot,xeroGroupLabel:group?.label||'',xeroAccountCode:group?.accountCode||''};
 });
 return {...report,version:2,pricingCapturedAt:capturedAt,pricing:{basis:'completion',label:'Prices captured at completion',capturedAt},stocktakeSettings:frozenSettings,rows};
}
