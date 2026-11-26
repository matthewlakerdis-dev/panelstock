import {HttpError,requireCondition as check} from './security.js';

export const CNC_ORDER_ID_PDF_MAX_BYTES=8*1024*1024;
const controls=/[\u0000-\u001f\u007f]/;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const pageFields=['page','project','orderNumber','sheetNumber','quantity','panelIds','warnings'];
const normal=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
const sameScope=(scope,project,orderNumber)=>plain(scope)&&typeof scope.project==='string'&&typeof scope.orderNumber==='string'&&
  normal(scope.project)===normal(project)&&normal(scope.orderNumber)===normal(orderNumber);

function scopeValue(value,label,max,allowEmpty=false){
  check(typeof value==='string'&&value.length<=max&&!controls.test(value),`Choose a valid ${label}`);
  const result=value.trim();
  check(allowEmpty||result.length>0,`Choose a valid ${label}`);
  return result;
}

function pdfBytes(value){
  check(typeof value==='string','Choose a valid CNC PDF');
  const match=value.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/);
  check(match,'Choose a valid CNC PDF');
  check(match[1].length<=4*Math.ceil(CNC_ORDER_ID_PDF_MAX_BYTES/3),'CNC PDF must be 8 MB or smaller',413);
  let decoded;
  try{decoded=atob(match[1]);}catch{throw new HttpError(400,'The CNC PDF data is invalid');}
  check(decoded.length<=CNC_ORDER_ID_PDF_MAX_BYTES,'CNC PDF must be 8 MB or smaller',413);
  check(decoded.length>=5&&decoded.slice(0,5)==='%PDF-','Choose a valid CNC PDF');
  return Uint8Array.from(decoded,character=>character.charCodeAt(0));
}

function checkedEnvelope(value){
  check(plain(value)&&Number.isInteger(value.status)&&value.status>=200&&value.status<=599&&plain(value.body),'The order drawing service could not be verified. Refresh and retry.',503);
  return value;
}

// The HTTP route authenticates before reading the large request. Context and
// staging each check fresh server-side permissions; the latter occurs after
// asynchronous conversion. Only trusted parser output and an actual-byte hash
// reach the private staging RPC, never browser-supplied identities or progress.
export async function analyseCncOrderIdUpload({store,body,token,ip='unknown',app='',analyse}){
  check(plain(body),'Choose an existing order and CNC PDF');
  const project=scopeValue(body.project,'project',120,true),orderNumber=scopeValue(body.orderNumber,'order',200),
    fileName=scopeValue(body.fileName,'PDF file name',200);
  check(typeof analyse==='function','CNC PDF analysis is not configured',503);
  const context=checkedEnvelope(await store.handle('/cnc/order-id-reupload','POST',{action:'context',project,orderNumber},token,ip,app));
  if(context.status!==200)return context;
  check(context.body.ok===true&&sameScope(context.body.scope,project,orderNumber)&&Array.isArray(context.body.panels)&&context.body.panels.length>0,'The selected CNC order could not be verified. Refresh and retry.',409);
  const bytes=pdfBytes(body.pdf),analysed=await analyse(body.pdf);
  check(plain(analysed)&&Array.isArray(analysed.pages)&&analysed.pages.length>0&&analysed.pages.length<=300,'The CNC PDF did not return valid drawing pages. Review the file and retry.',422);
  const pages=analysed.pages.map(page=>{
    check(plain(page),'The CNC PDF returned an invalid drawing page. Review the file and retry.',422);
    return Object.fromEntries(pageFields.filter(key=>Object.hasOwn(page,key)).map(key=>[key,page[key]]));
  });
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join(''),
    staged=checkedEnvelope(await store.stageCncOrderIdAnalysis(token,app,{project,orderNumber,source:{fileName,sha256,bytes:bytes.length},pages}));
  if(staged.status!==200)return staged;
  check(staged.body.ok===true&&sameScope(staged.body.scope,project,orderNumber)&&typeof staged.body.analysisId==='string'&&staged.body.analysisId.length>0&&Array.isArray(staged.body.occurrences)&&
    staged.body.source?.sha256===sha256&&staged.body.source?.bytes===bytes.length&&staged.body.source?.fileName===fileName,
    'The analysed CNC PDF could not be verified. Refresh and retry.',503);
  return staged;
}
