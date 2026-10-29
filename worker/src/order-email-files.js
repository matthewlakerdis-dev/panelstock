import {requireCondition as check} from './security.js';
const MAX_FILE=5*1024*1024,MAX_TOTAL=25*1024*1024;
export function orderEmailFileIds(value=[]){
 check(Array.isArray(value)&&value.length<=10&&new Set(value).size===value.length&&value.every(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)),'Choose up to 10 unique attachment IDs');
 return [...value];
}
const objectKey=(orderId,file)=>'order-attachments/'+orderId+'/'+file.id+'/'+file.sha256;
const base64=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
// Keep the frozen PDF/headers and file references in the job. Stream one private
// file at a time instead of storing a second 25 MB file set in the order database.
export async function orderEmailFileBody(store,job){
 const files=job.files||[],bucket=store.env.CAD_PROJECT_FILES,encoder=new TextEncoder();
 check(bucket,'Order file storage is unavailable');
 check(files.length<=10&&files.reduce((sum,file)=>sum+file.size,0)<=MAX_TOTAL,'Order attachments exceed the email file limits');
 for(const file of files){
  check(file.size>0&&file.size<=MAX_FILE&&/^[a-f0-9]{64}$/.test(file.sha256),'Invalid stored attachment');
  const object=await (bucket.head?bucket.head(objectKey(job.order.id,file)):bucket.get(objectKey(job.order.id,file)));
  check(object&&object.size===file.size,'An order attachment is unavailable. Restore the file before retrying the email.');
 }
 const {attachments,...fields}=job.payload,prefix=JSON.stringify(fields).slice(0,-1)+',"attachments":[',pdf=(attachments||[]).map(value=>JSON.stringify(value)).join(',');
 const encodedSize=encoder.encode(prefix+pdf+']}').length+files.reduce((sum,file)=>sum+4*Math.ceil(file.size/3)+encoder.encode(JSON.stringify({filename:file.name,content:''})).length+1,0);
 check(encodedSize<=40*1024*1024,'Order email exceeds the encoded attachment size limit');
 async function* chunks(){
  yield encoder.encode(prefix+pdf);let comma=!!pdf;
  for(const file of files){
   const object=await bucket.get(objectKey(job.order.id,file));check(object&&object.size===file.size,'Order attachment is unavailable');
   const bytes=new Uint8Array(await object.arrayBuffer());check(bytes.length===file.size,'Order attachment size changed');
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
   check(hash===file.sha256,'Order attachment contents changed');
   yield encoder.encode((comma?',':'')+'{"filename":'+JSON.stringify(file.name)+',"content":"'+base64(bytes)+'"}');comma=true;
  }
  yield encoder.encode(']}');
 }
 const iterator=chunks();
 return new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(){await iterator.return();}},{highWaterMark:0});
}
