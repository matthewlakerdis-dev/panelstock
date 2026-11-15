import {HttpError} from './security.js';

const MAX_FILE=5*1024*1024,MAX_RESULT=512*1024;
const categories=new Set(['','extrusions','fixings','consumables','other']);
const invalid=()=>new HttpError(502,'Document reading returned invalid material rows. Try a clearer or smaller PDF.');
export function validateMaterialImportResult(result){
 if(!result||typeof result!=='object'||Array.isArray(result)||!Array.isArray(result.lines)||result.lines.length>200||typeof result.supplier!=='string'||result.supplier.length>160||!Array.isArray(result.warnings)||result.warnings.length>20||result.warnings.some(w=>typeof w!=='string'||w.length>500))throw invalid();
 const fields={sku:100,description:500,colour:160,dimensions:160,unit:40,supplier:160};
 const lines=result.lines.map(line=>{
  if(!line||typeof line!=='object'||Array.isArray(line))throw invalid();
  const row={};for(const [key,max]of Object.entries(fields)){if(typeof line[key]!=='string'||line[key].length>max)throw invalid();row[key]=line[key];}
  if(!categories.has(line.category)||line.lengthMm!==null&&(!Number.isFinite(line.lengthMm)||line.lengthMm<=0||line.lengthMm>1e6))throw invalid();
  return {...row,category:line.category,lengthMm:line.lengthMm};
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
