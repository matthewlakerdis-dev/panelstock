import {buildCncManifest,cncInstallIcon} from './cnc-install.js';
import {normalizeCncInput} from './cnc-input.js';
import {CNC_COLUMNS,buildCncExcelFeed} from './cnc-excel.js';
import {HttpError,equal} from './security.js';
import {sendReport,localParts,buildXlsxBytes,buildCncTrackerHtml,splitDateTimeForExport} from './reports.js';
import {buildOrderPdf} from './order-pdf.js';
import {buildOrderXlsx} from './order-xlsx.js';
export {InventoryStore} from './store.js';
const MAX_BODY=8*1024*1024;
async function libreOfficePdf(env,xlsx) {
  if(!env.PDF_CONVERTER_URL||!env.PDF_CONVERTER_TOKEN)return null;
  try {
    const converted=await fetch(env.PDF_CONVERTER_URL.replace(/\/$/,'')+'/convert',{method:'POST',headers:{'Authorization':'Bearer '+env.PDF_CONVERTER_TOKEN,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:xlsx,signal:AbortSignal.timeout(45000)});
    if(!converted.ok)return null;
    const bytes=new Uint8Array(await converted.arrayBuffer());
    if(bytes.length<5||bytes.length>12*1024*1024||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')return null;
    return bytes;
  }catch{return null;}
}
async function readBody(request) {
  if(Number(request.headers.get('Content-Length'))>MAX_BODY)throw new HttpError(413,'Request too large');
  const reader=request.body?.getReader();if(!reader)return {};
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();throw new HttpError(413,'Request too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{const v=JSON.parse(new TextDecoder().decode(bytes));if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{throw new HttpError(400,'Invalid JSON object');}
}
function response(body,status,origin) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}:{})}});
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    const origin=request.headers.get('Origin');
    const allowed=(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean);
    if(origin && !allowed.includes(origin) && origin!==url.origin)return response({error:'Origin not allowed'},403,null);
    if(request.method==='OPTIONS')return response({},200,origin);
    if(url.pathname.startsWith('/debug-'))return response({error:'Not found'},404,origin);
    if(request.method==='GET' && ['/cnc-tracker/icon-192.png','/cnc-tracker/icon-512.png','/cnc-tracker/icon-mobile-v3-192.png','/cnc-tracker/icon-mobile-v3-512.png','/cnc-tracker/icon-adaptive-v4-192.png','/cnc-tracker/icon-adaptive-v4-512.png'].includes(url.pathname)) {
      const size=url.pathname.includes('192')?192:512;
      return new Response(cncInstallIcon(size),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
    }
    const store=env.INVENTORY.getByName(env.SITE_ID||'panelstock');
    try {
      if(['/cnc-tracker','/cnc-tracker/view','/cnc-tracker/data','/cnc-tracker/excel-data','/cnc-tracker/manifest.webmanifest'].includes(url.pathname) && request.method==='GET') {
        if(!env.CNC_PUBLIC_TOKEN || !equal(url.searchParams.get('token'),env.CNC_PUBLIC_TOKEN))return response({error:'Not found'},404,origin);
        const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
        if(url.pathname.endsWith('/manifest.webmanifest'))return new Response(JSON.stringify(buildCncManifest(env.CNC_PUBLIC_TOKEN)),{headers:{...headers,'Content-Type':'application/manifest+json'}});
        if(url.pathname.endsWith('/view'))return new Response(buildCncTrackerHtml(env.CNC_PUBLIC_TOKEN),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
        const panels=await store.readPublicCnc();
        if(url.pathname.endsWith('/data'))return response({ok:true,panels,serverTime:new Date().toISOString()},200,origin);
        const rows=panels.map(p=>{const uploaded=splitDateTimeForExport(p.uploadedAt),completed=splitDateTimeForExport(p.completedAt);return {order_number:p.orderNumber,job_reference:p.jobReference||'',sheet_number:p.sheetNumber,panel_id:normalizeCncInput(p).panelNumber,status:p.status==='completed'?'Completed':'Pending',uploaded_by:p.uploadedBy||'',date_uploaded:uploaded.date,time_uploaded:uploaded.time,completed_by:p.completedBy||'',date_completed:completed.date,time_completed:completed.time};});
        if(url.pathname.endsWith('/excel-data'))return new Response(buildCncExcelFeed(rows),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
        return new Response(await buildXlsxBytes(rows,CNC_COLUMNS,url.origin+'/cnc-tracker/excel-data?token='+encodeURIComponent(env.CNC_PUBLIC_TOKEN)),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="CNC_TRACKER.xlsx"'}});
      }
      const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
      if(env.READ_ONLY==='true' && request.method!=='GET' && !['/login','/set-pin','/logout'].includes(url.pathname))return response({ok:false,error:'Stock editing is temporarily paused for maintenance. Pending changes are retained.'},503,origin);
      const body=request.method==='POST'?await readBody(request):{};
      if(url.pathname==='/cnc-share' && request.method==='GET') {
        const access=await store.handle('/session','GET',{},token,request.headers.get('CF-Connecting-IP')||'unknown');
        if(access.status!==200)return response(access.body,access.status,origin);
        return response({token:env.CNC_PUBLIC_TOKEN||null},200,origin);
      }
      if(url.pathname==='/send-now' && request.method==='POST') {
        const access=await store.handle('/report-data','POST',{},token,request.headers.get('CF-Connecting-IP')||'unknown');
        if(access.status!==200)return response(access.body,access.status,origin);
        if(env.EMAIL_ENABLED!=='true')return response({ok:false,error:'Email sending is disabled in this environment'},503,origin);
        if(!access.body.config?.recipients?.length)return response({ok:false,error:'Configure email recipients first'},400,origin);
        const result=await sendReport(env,access.body.config,access.body.data);
        return response({ok:result.ok,...(!result.ok?{error:'Email provider did not confirm delivery'}:{})},result.ok?200:502,origin);
      }
      const orderPdf=url.pathname.match(/^\/orders\/([a-zA-Z0-9-]{16,100})\/pdf$/);
      if(orderPdf && request.method==='GET') {
        const result=url.searchParams.has('ticket')?await store.redeemOrderPdfTicket(orderPdf[1],url.searchParams.get('ticket')):await store.handle('/orders/'+orderPdf[1],'GET',{},token,request.headers.get('CF-Connecting-IP')||'unknown');
        if(result.status!==200)return response(result.body,result.status,origin);
        const template=await env.LEGACY_KV.get('site-order-cover-template',{type:'arrayBuffer'});
        const xlsx=template?await buildOrderXlsx(result.body.order,template):null;
        const bytes=xlsx?await libreOfficePdf(env,xlsx):null;
        const output=bytes||buildOrderPdf(result.body.order);
        const disposition=url.searchParams.get('download')==='1'?'attachment':'inline';
        return new Response(output,{headers:{'Content-Type':'application/pdf','Content-Disposition':`${disposition}; filename="Site-Order-${result.body.order.orderNumber}.pdf"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-PanelStock-PDF-Renderer':bytes?'libreoffice':'fallback'}});
      }
      const orderXlsx=url.pathname.match(/^\/orders\/([a-zA-Z0-9-]{16,100})\/xlsx$/);
      if(orderXlsx && request.method==='GET') {
        const result=url.searchParams.has('ticket')?await store.redeemOrderPdfTicket(orderXlsx[1],url.searchParams.get('ticket')):await store.handle('/orders/'+orderXlsx[1],'GET',{},token,request.headers.get('CF-Connecting-IP')||'unknown');
        if(result.status!==200)return response(result.body,result.status,origin);
        const template=await env.LEGACY_KV.get('site-order-cover-template',{type:'arrayBuffer'});
        if(!template)return response({error:'Site order template is not configured'},503,origin);
        const bytes=await buildOrderXlsx(result.body.order,template);
        return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="Site-Order-${result.body.order.orderNumber}.xlsx"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
      }
      const result=await store.handle(url.pathname,request.method,body,token,request.headers.get('CF-Connecting-IP')||'unknown');
      return response(result.body,result.status,origin);
    }catch(error){console.error('worker_request_failed',{path:url.pathname,name:error.name});return response({ok:false,error:error instanceof HttpError?error.message:'Service unavailable; please retry'},error instanceof HttpError?error.status:503,origin);}
  },
  async scheduled(event,env,ctx) {
    if(env.READ_ONLY==='true')return;
    const store=env.INVENTORY.getByName(env.SITE_ID||'panelstock');
    const {data,config,lastSent}=await store.scheduledData();
    if(env.EMAIL_ENABLED!=='true'||!config?.enabled||!config.recipients?.length)return;
    const local=localParts(new Date(event.scheduledTime),config.timezone||'Australia/Brisbane');
    const [h,m]=(config.time||'07:00').split(':').map(Number);
    // Never send before the requested minute; retry later that day if delivery fails.
    if(!config.days.includes(local.dayOfWeek)||local.hour*60+local.minute<h*60+m)return;
    const period='day-'+local.dateKey;
    if(lastSent===period||!await store.claimReport(period))return;
    let success=false;
    try{success=(await sendReport(env,config,data,`${env.SITE_ID||'panelstock'}-${period}`)).ok;}
    finally{await store.finishReport(period,success);}
  }
};
