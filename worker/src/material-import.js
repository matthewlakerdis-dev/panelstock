import {HttpError} from './security.js';

const MAX_FILE=5*1024*1024,MAX_RESULT=512*1024;
const categories=new Set(['','extrusions','fixings','consumables','other']);
const invalid=()=>new HttpError(502,'Document reading returned invalid material rows. Try a clearer or smaller PDF.');
const taxBases=new Set(['exGST','incGST','unknown']);
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e9&&Number(value.toFixed(2))===value;
export function materialImportSourceFields(source,error=invalid){
 const result={};
 for(const [field,max]of [['name',160],['stockUnit',40],['priceUnit',80]]){
  const value=source[field]===undefined?'':source[field];if(typeof value!=='string'||value.length>max)throw error();result[field]=value;
 }
 result.unitCost=source.unitCost===undefined?null:source.unitCost;
 result.currency=source.currency===undefined?'':source.currency;
 result.taxBasis=source.taxBasis===undefined?'unknown':source.taxBasis;
 if(result.unitCost!==null&&!amount(result.unitCost)||typeof result.currency!=='string'||!/^(?:[A-Z]{3})?$/.test(result.currency)||!taxBases.has(result.taxBasis))throw error();
 return result;
}
const normal=value=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
export const materialImportDimensions=value=>normal(value).normalize('NFKC').replace(/[×✕]/g,'x').replace(/\s*mm\b/g,'').replace(/\d+(?:\.\d+)?/g,part=>String(Number(part))).replace(/\s*x\s*/g,'x').trim();
const canonicalUnit=value=>{
 const unit=normal(value).replace(/^(?:per\s+|\$\s*\/\s*|\/\s*)/,'');
 for(const [key,aliases]of [
  ['each',['ea','each','unit','units','pc','pcs','piece','pieces']],
  ['lengths',['length','lengths','bar','bars','full length','full lengths']],
  ['metres',['m','lm','lin m','metre','metres','meter','meters','linear metre','linear metres','lineal metre','lineal metres']],
  ['kg',['kg','kgs','kilogram','kilograms']],['litres',['l','ltr','litre','litres','liter','liters']],
  ['boxes',['box','boxes']],['packs',['pack','packs']],['rolls',['roll','rolls']],['tubes',['tube','tubes']]
 ])if(aliases.includes(unit))return key;
 return '';
};
export function materialImportUnitCost(source,item){
 const blocked=reason=>({unitCost:null,reason});
 if(!source||typeof source!=='object'||!item||typeof item!=='object')return blocked('Choose a material before using the PDF price.');
 if(!amount(source.unitCost))return blocked('No valid unit price was read from the PDF.');
 if(source.currency!=='AUD')return blocked('Confirm an AUD price before entering a unit cost.');
 if(source.taxBasis!=='exGST')return blocked('The PDF price must be explicitly excluding GST.');
 if((item.costBasis??'unit')!=='unit')return blocked('Pack or area pricing needs a separate cost review.');
 if(source.category&&source.category!==item.category)return blocked('The PDF category does not match this material.');
 if(normal(source.colour)&&normal(source.colour)!==normal(item.colour||item.color))return blocked('The PDF colour does not match this material.');
 if(materialImportDimensions(source.dimensions)&&materialImportDimensions(source.dimensions)!==materialImportDimensions(item.dimensions))return blocked('The PDF dimensions do not match this material.');
 if(source.lengthMm!==null&&source.lengthMm!==undefined&&source.lengthMm!==''&&(!Number.isFinite(source.lengthMm)||source.lengthMm<=0||source.lengthMm!==item.lengthMm))return blocked('The PDF length does not match this material.');
 const target=canonicalUnit(item.unit),price=canonicalUnit(source.priceUnit),stock=canonicalUnit(source.stockUnit),printed=canonicalUnit(source.unit);
 if(!target||!price)return blocked('The PDF price basis needs a separate unit cost review.');
 const matchingLength=Number.isFinite(source.lengthMm)&&source.lengthMm>0&&source.lengthMm===item.lengthMm;
 const fullBar=price==='each'&&printed==='each'&&stock==='lengths'&&source.category==='extrusions'&&item.category==='extrusions'&&matchingLength;
 if(target==='lengths'&&!matchingLength)return blocked('Confirm the full PDF length matches this material before using its price.');
 if((target==='lengths'||target==='each'&&fullBar)&&materialImportDimensions(item.dimensions)&&!materialImportDimensions(source.dimensions))return blocked('Confirm the PDF profile dimensions before using its full-length price.');
 if(normal(source.stockUnit)&&stock!==target&&!(target==='each'&&fullBar))return blocked('The PDF stock unit does not match this material.');
 if(price===target&&(!normal(source.unit)||printed===target))return {unitCost:source.unitCost,reason:''};
 if(target==='lengths'&&fullBar)return {unitCost:source.unitCost,reason:''};
 return blocked('The PDF price basis does not match this material’s stock unit.');
}
export function validateMaterialImportResult(result){
 if(!result||typeof result!=='object'||Array.isArray(result)||!Array.isArray(result.lines)||result.lines.length>200||typeof result.supplier!=='string'||result.supplier.length>160||!Array.isArray(result.warnings)||result.warnings.length>20||result.warnings.some(w=>typeof w!=='string'||w.length>500))throw invalid();
 const fields={sku:100,description:500,colour:160,dimensions:160,unit:40,supplier:160};
 const lines=result.lines.map(line=>{
  if(!line||typeof line!=='object'||Array.isArray(line))throw invalid();
  const row={};for(const [key,max]of Object.entries(fields)){if(typeof line[key]!=='string'||line[key].length>max)throw invalid();row[key]=line[key];}
  if(!categories.has(line.category)||line.lengthMm!==null&&(!Number.isFinite(line.lengthMm)||line.lengthMm<=0||line.lengthMm>1e6))throw invalid();
  return {...row,category:line.category,lengthMm:line.lengthMm,...materialImportSourceFields(line)};
 });
 return {ok:true,supplier:result.supplier,warnings:[...result.warnings],lines};
}

export async function analyseMaterialCatalogue(body,env){
 if(!env.PDF_CONVERTER_URL||!env.PDF_CONVERTER_TOKEN)throw new HttpError(503,'Document reading is unavailable. You can enter the materials manually.');
 if(!body||typeof body.name!=='string'||body.name.length>200||!/^.+\.pdf$/i.test(body.name)||typeof body.data!=='string'||!body.data.length||body.data.length>4*Math.ceil(MAX_FILE/3))throw new HttpError(400,'Choose a PDF material list up to 5 MB.');
 let raw;try{raw=atob(body.data);}catch{throw new HttpError(400,'Choose a valid PDF material list.');}
 if(raw.length<5||raw.length>MAX_FILE||!raw.startsWith('%PDF-'))throw new HttpError(400,'Choose a valid PDF material list up to 5 MB.');
 let url;try{url=new URL(env.PDF_CONVERTER_URL);}catch{throw new HttpError(503,'The document service is not configured correctly.');}
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new HttpError(503,'Document service must use HTTPS');
 let response;
 try{response=await fetch(url.href.replace(/\/$/,'')+'/material-analyse',{method:'POST',headers:{Authorization:'Bearer '+env.PDF_CONVERTER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({name:body.name,data:body.data}),signal:AbortSignal.timeout(80000)});}catch{throw new HttpError(503,'Material reading timed out or is unavailable. Retry or enter the materials manually.');}
 const reader=response.body?.getReader();if(!reader)throw new HttpError(502,'Document reading returned no result');
 let size=0;const chunks=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_RESULT){await reader.cancel();throw new HttpError(502,'Document reading exceeded its size limit');}chunks.push(value);}}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'The material reading response was interrupted. Retry the PDF.');}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(503,'Document reading is unavailable. Retry or enter the materials manually.');}
 if(!response.ok)throw new HttpError([400,422,503].includes(response.status)?response.status:502,String(result?.error||'Material reading failed').slice(0,500));
 return validateMaterialImportResult(result);
}
