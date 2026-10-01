import {HttpError} from './security.js';

export async function analysePurchaseOrder(body,env){
 if(!env.PDF_CONVERTER_URL||!env.PDF_CONVERTER_TOKEN)throw new HttpError(503,'Document reading is unavailable. You can enter the PO manually.');
 if(typeof body.name!=='string'||body.name.length>200||!/^.+\.(pdf|png|jpe?g|xlsx)$/i.test(body.name)||typeof body.data!=='string'||body.data.length>4*Math.ceil(5*1024*1024/3)||!body.data.length)throw new HttpError(400,'Choose a PDF, JPG, PNG or Excel file up to 5 MB.');
 const url=new URL(env.PDF_CONVERTER_URL);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new HttpError(503,'Document service must use HTTPS');
 let response;
 try{response=await fetch(url.href.replace(/\/$/,'')+'/po-analyse',{method:'POST',headers:{Authorization:'Bearer '+env.PDF_CONVERTER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({name:body.name,data:body.data}),signal:AbortSignal.timeout(80000)});}catch{throw new HttpError(503,'Document reading timed out or is unavailable. Retry or enter the PO manually.');}
 const reader=response.body?.getReader();if(!reader)throw new HttpError(502,'Document reading returned no result');
 let size=0;const chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>512*1024){await reader.cancel();throw new HttpError(502,'Document reading exceeded its size limit');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(503,'Document reading is unavailable. Retry or enter the PO manually.');}
 if(!response.ok)throw new HttpError([400,422,503].includes(response.status)?response.status:502,String(result.error||'Document reading failed').slice(0,500));
 if(!result||!Array.isArray(result.lines)||result.lines.length>200)throw new HttpError(502,'Document reading returned invalid PO lines');
 return result;
}
