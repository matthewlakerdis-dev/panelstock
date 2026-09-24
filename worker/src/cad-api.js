import {HttpError} from './security.js';

export async function cadRequest(path,body,env) {
  if(!env.PDF_CONVERTER_URL||!env.PDF_CONVERTER_TOKEN)throw new HttpError(503,'CAD service is not configured');
  const endpoint=path==='/cad/analyse'?'/cad-analyse':path==='/cad/generate'?'/cad-generate':null;
  if(!endpoint)throw new HttpError(404,'Not found');
  const url=new URL(env.PDF_CONVERTER_URL);
  if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname))throw new HttpError(503,'CAD service URL must use HTTPS');
  const response=await fetch(url.href.replace(/\/$/,'')+endpoint,{method:'POST',headers:{Authorization:'Bearer '+env.PDF_CONVERTER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(85000)});
  const reader=response.body?.getReader();if(!reader)throw new HttpError(502,'CAD service returned no result');
  let size=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024){await reader.cancel();throw new HttpError(502,'CAD result exceeded the size limit');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(502,'CAD service returned an invalid result');}
  if(!response.ok)throw new HttpError([400,422,503].includes(response.status)?response.status:502,String(result.error||'CAD request failed').slice(0,500));
  return result;
}
