// Read-only costing of panel-sheet offcuts from matching full-panel prices.
const normal=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
const gcd=(a,b)=>{while(b){const next=a%b;a=b;b=next;}return a<0n?-a:a;};
const rational=(n,d)=>{const divisor=gcd(n,d);return {n:n/divisor,d:d/divisor};};
export function decimalRatio(value){
 const amount=Number(value);if(!Number.isFinite(amount)||amount<=0||amount>1e6)return null;
 const match=String(amount).match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);if(!match)return null;
 const fraction=match[2]||'',power=Number(match[3]||0)-fraction.length,digits=BigInt(match[1]+fraction);
 return power>=0?rational(digits*10n**BigInt(power),1n):rational(digits,10n**BigInt(-power));
}
function areaRatio(item){const width=decimalRatio(item.width),height=decimalRatio(item.height);return width&&height?rational(width.n*height.n,width.d*height.d):null;}
function ratioNumber(n,d){
 if(n===0n)return 0;
 const numerator=n.toString(),denominator=d.toString(),takeN=Math.min(16,numerator.length),takeD=Math.min(16,denominator.length);
 return (Number(numerator.slice(0,takeN))/10**(takeN-1))/(Number(denominator.slice(0,takeD))/10**(takeD-1))*10**(numerator.length-denominator.length);
}
function costCents(value){
 if(value===null||value===undefined||value==='')return null;
 if(!['number','string'].includes(typeof value))return null;
 const number=Number(value),scaled=number*100;
 if(!Number.isFinite(number)||number<0||number>1e9||Math.abs(scaled-Math.round(scaled))>Number.EPSILON*Math.max(1,Math.abs(scaled))*4)return null;
 return BigInt(Math.round(scaled));
}
function materialIdentity(item,catalog){
 const entry=catalog.find(c=>c.id===item.catalogId),color=normal(item.color||item.colour)||normal(entry?.color||entry?.colour),material=normal(item.material)||normal(entry?.material);
 const rawThickness=item.thickness===undefined||item.thickness===null||item.thickness===''?entry?.thickness:item.thickness,thickness=Number(rawThickness);
 return color&&material&&Number.isFinite(thickness)&&thickness>0?JSON.stringify([color,material,thickness]):null;
}
export function samePanelMaterial(a,b,catalog=[]){const identity=materialIdentity(a,catalog);return identity!==null&&identity===materialIdentity(b,catalog);}
export function usesOffcutAreaCost(metadata={}){
 return metadata.costBasis==='area'||((metadata.costBasis==null||metadata.costBasis==='unit')&&(metadata.unitCost===undefined||metadata.unitCost===null||metadata.unitCost===''));
}
function panelRate(panel,metadata){
 const area=areaRatio(panel);if(!area)return {rate:null,reason:'invalid_source_dimensions'};
 const basis=metadata.costBasis||'unit',packSize=Number(metadata.packSize??1),entered=basis==='pack'?metadata.packCost:metadata.unitCost,cents=costCents(entered);
 if(!['unit','pack'].includes(basis)||cents===null||(basis==='pack'&&(!Number.isSafeInteger(packSize)||packSize<1||packSize>1e9)))return {rate:null,reason:'source_unpriced'};
 const rate=rational(cents*area.d,BigInt(basis==='pack'?packSize:1)*area.n),ratePerM2=ratioNumber(rate.n*1000000n,rate.d*100n);
 return Number.isFinite(ratePerM2)?{rate,ratePerM2,reason:null}:{rate:null,reason:'invalid_source_dimensions'};
}
export function resolveOffcutAreaCost(offcut,metadata={},variants=[],stockMetadata={},catalog=[]){
 const sources=variants.filter(panel=>samePanelMaterial(offcut,panel,catalog)).map(panel=>{
  const id='variant:'+panel.id,meta=stockMetadata[id]||{},result=panelRate(panel,meta);
  const name=meta.name||[panel.color,panel.material,panel.thickness?panel.thickness+' mm':'',panel.width+' x '+panel.height+' mm'].filter(Boolean).join(' / ');
  return {panel,meta,result,option:{id,name,width:Number(panel.width),height:Number(panel.height),ratePerM2:result.ratePerM2??null,priced:result.rate!==null}};
 }).sort((a,b)=>a.option.id<b.option.id?-1:a.option.id>b.option.id?1:0);
 const areaCostSources=sources.map(source=>source.option),sourceId=String(metadata.costSourceItemId||'').trim();
 const fail=areaCostStatus=>({areaCostSources,areaCost:null,areaCostStatus});
 const offcutArea=areaRatio(offcut);if(!offcutArea)return fail('invalid_offcut_dimensions');
 let chosen;
 if(sourceId){
  chosen=sources.find(source=>source.option.id===sourceId);if(!chosen)return fail('invalid_source');
  if(!chosen.result.rate)return fail(chosen.result.reason);
 }else{
  const priced=sources.filter(source=>source.result.rate!==null);
  if(!sources.length)return fail('no_matching_source');
  if(!priced.length)return fail(sources.every(source=>source.result.reason==='invalid_source_dimensions')?'invalid_source_dimensions':'source_unpriced');
  const first=priced[0].result.rate;
  if(priced.some(source=>source.result.rate.n*first.d!==first.n*source.result.rate.d))return fail('needs_source');
  chosen=priced[0];
 }
 const rate=chosen.result.rate,effectiveUnitCost=ratioNumber(rate.n*offcutArea.n,rate.d*offcutArea.d*100n);
 if(!Number.isFinite(effectiveUnitCost))return fail('invalid_offcut_dimensions');
 const unitCents=costCents(chosen.meta.unitCost),packCents=costCents(chosen.meta.packCost);
 return {areaCostSources,areaCostStatus:'resolved',areaCost:{sourceItemId:chosen.option.id,sourceName:chosen.option.name,sourceWidth:Number(chosen.panel.width),sourceHeight:Number(chosen.panel.height),sourceCostBasis:chosen.meta.costBasis||'unit',sourceUnitCost:unitCents===null?null:Number(unitCents)/100,sourcePackCost:packCents===null?null:Number(packCents)/100,sourcePackSize:Number(chosen.meta.packSize??1),offcutWidth:Number(offcut.width),offcutHeight:Number(offcut.height),ratePerM2:chosen.result.ratePerM2,effectiveUnitCost}};
}
