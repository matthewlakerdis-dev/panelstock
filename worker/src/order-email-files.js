import {requireCondition as check} from './security.js';
import {appendOrderPdfFiles,printableOrderFile,orderFileKey,MAX_ORDER_FILE,MAX_ORDER_FILES_TOTAL,MAX_ORDER_PDF} from './order-pdf-attachments.js';
export function orderEmailFileIds(value=[]){
 check(Array.isArray(value)&&value.length<=10&&new Set(value).size===value.length&&value.every(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)),'Choose up to 10 unique attachment IDs');
 return [...value];
}
const base64=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
const hashBytes=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');

// Freeze the composed PDF privately before the first provider request. A queued
// retry must never rebuild it using newer order details, files or PDF metadata.
// Previously attempted jobs retain their original separate-file payload.
export async function prepareOrderEmailPdf(store,job){
 if(job.pdfPackage||job.firstAttemptAt||!(job.files||[]).some(printableOrderFile))return null;
 const cover=job.payload.attachments?.[0];check(cover?.content,'Order PDF is unavailable');
 const {bytes,appendedIds}=await appendOrderPdfFiles(Uint8Array.from(atob(cover.content),c=>c.charCodeAt(0)),job.order.id,job.files,store.env.CAD_PROJECT_FILES);
 const key='order-email-packages/'+encodeURIComponent(job.id)+'/'+crypto.randomUUID(),pdfPackage={key,name:cover.filename,size:bytes.length,sha256:await hashBytes(bytes),appendedIds};
 try{await store.env.CAD_PROJECT_FILES.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});}
 catch(error){await store.env.CAD_PROJECT_FILES.delete(key).catch(()=>{});throw error;}
 return pdfPackage;
}
export async function discardOrderEmailPdf(store,pdfPackage){if(pdfPackage)await store.env.CAD_PROJECT_FILES.delete(pdfPackage.key).catch(()=>{});}

// The job keeps its small cover/headers and private file references. Stream the
// frozen combined PDF and remaining original documents instead of storing tens
// of megabytes of base64 in the order database.
export async function orderEmailFileBody(store,job){
 const files=job.files||[],bucket=store.env.CAD_PROJECT_FILES,encoder=new TextEncoder();
 check(bucket,'Order file storage is unavailable');
 check(files.length<=10&&files.reduce((sum,file)=>sum+file.size,0)<=MAX_ORDER_FILES_TOTAL,'Order attachments exceed the email file limits');
 const records=job.pdfPackage?[{...job.pdfPackage,limit:MAX_ORDER_PDF},...files.filter(file=>!job.pdfPackage.appendedIds.includes(file.id)).map(file=>({...file,key:orderFileKey(job.order.id,file),limit:MAX_ORDER_FILE}))]:files.map(file=>({...file,key:orderFileKey(job.order.id,file),limit:MAX_ORDER_FILE}));
 for(const file of records){
  check(file.size>0&&file.size<=file.limit&&/^[a-f0-9]{64}$/.test(file.sha256),'Invalid stored attachment');
  const object=await (bucket.head?bucket.head(file.key):bucket.get(file.key));
  check(object&&object.size===file.size,'An order attachment is unavailable. Restore the file before retrying the email.');
 }
 const {attachments,...fields}=job.payload,prefix=JSON.stringify(fields).slice(0,-1)+',"attachments":[',pdf=(job.pdfPackage?[]:attachments||[]).map(value=>JSON.stringify(value)).join(',');
 const encodedSize=encoder.encode(prefix+pdf+']}').length+records.reduce((sum,file)=>sum+4*Math.ceil(file.size/3)+encoder.encode(JSON.stringify({filename:file.name,content:''})).length+1,0);
 check(encodedSize<=40*1024*1024,'Order email exceeds the encoded attachment size limit');
 async function* chunks(){
  yield encoder.encode(prefix+pdf);let comma=!!pdf;
  for(const file of records){
   const object=await bucket.get(file.key);check(object&&object.size===file.size,'Order attachment is unavailable');
   const bytes=new Uint8Array(await object.arrayBuffer());check(bytes.length===file.size,'Order attachment size changed');
   check(await hashBytes(bytes)===file.sha256,'Order attachment contents changed');
   yield encoder.encode((comma?',':'')+'{"filename":'+JSON.stringify(file.name)+',"content":"');
   // Multiples of three keep base64 chunks joinable without interior padding.
   for(let offset=0;offset<bytes.length;offset+=196608)yield encoder.encode(base64(bytes.subarray(offset,offset+196608)));
   yield encoder.encode('"}');comma=true;
  }
  yield encoder.encode(']}');
 }
 const iterator=chunks();
 return new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(){await iterator.return();}},{highWaterMark:0});
}
