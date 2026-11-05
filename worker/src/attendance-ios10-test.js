// Isolated compatibility deployment. Never add production bindings to this entry.
import attendanceWorker from './index.js';
import {InventoryStore} from './store.js';
import {HttpError,passwordRecord,requireCondition as check} from './security.js';
import {INSTALL_PATHS,initializeIos10Install,clearIos10InstallCodes,expireIos10InstallCodes,handleIos10Install} from './attendance-ios10-install.js';
import {handlePublicAttendance} from './attendance.js';
import {normalizeIos10Visit} from './attendance-ios10-fields.js';
import {isWriteQuotaError} from './schema.js';

const TEST_SITE='attendance-ios10-test';
const TEST_MARKER='attendance-ios10-test-v1';
const ALLOWED_BINDINGS=new Set(['ATTENDANCE_TEST_ENV','SITE_ID','MIGRATION_READY','EMAIL_ENABLED','READ_ONLY','ALLOWED_ORIGINS','INVENTORY','ATTENDANCE_TEST_ASSETS']);
const API_METHODS=new Map([
  ['/login',['POST']],['/session',['GET']],['/logout',['POST']],
  ['/attendance/register',['GET','POST']],['/attendance/kiosk',['POST']],
  ['/attendance/kiosk/revoke',['POST']],['/attendance/admin-check-out',['POST']],
  ...INSTALL_PATHS.map(path=>[path,['POST']]),
  ['/attendance/check-in',['POST']],['/attendance/lookup',['POST']],['/attendance/check-out',['POST']]
]);

export function assertTestEnvironment(env){
  if(env.ATTENDANCE_TEST_ENV!=='ios10'||env.SITE_ID!==TEST_SITE||env.MIGRATION_READY!=='false'||env.EMAIL_ENABLED!=='false'||env.READ_ONLY!=='false'||(env.ALLOWED_ORIGINS||'')!==''||Object.keys(env).some(key=>!ALLOWED_BINDINGS.has(key))){
    throw new Error('Isolated attendance test configuration required');
  }
}

export class AttendanceIos10TestStore extends InventoryStore {
  constructor(ctx,env){
    assertTestEnvironment(env);
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{
      if(this.read('initialized',false)){
        if(this.read('attendance-test-environment')!==TEST_MARKER)throw new Error('Refusing an existing non-test database');
        initializeIos10Install(this);
        return;
      }
      // A fresh namespace is required; no migration, import or live-data bootstrap.
      if(Object.keys(this.read('users',{})).length||this.sql.exec('SELECT COUNT(*) AS n FROM attendance_entries').toArray()[0].n){
        throw new Error('Refusing to initialize a nonempty test database');
      }
      initializeIos10Install(this);
      const user={displayName:'iPad test administrator',active:true,isAdmin:true,mustChangePin:false,password:await passwordRecord('103434')};
      ctx.storage.transactionSync(()=>{
        this.write('users',{ipadtest:user});
        this.write('revision',0);
        this.write('restoreEpoch',0);
        this.write('attendance-test-environment',TEST_MARKER);
        this.write('initialized',true);
      });
    });
  }
  async handle(path,method,body,token,ip,app=''){
    if(path==='/attendance/check-in'&&method==='POST'){
      try{
        check(this.read('initialized',false),'Service awaiting controlled test initialization',503);
        return await handlePublicAttendance(this,path,body,ip,normalizeIos10Visit);
      }catch(error){
        if(isWriteQuotaError(error))return {status:503,body:{ok:false,error:'Database writes are temporarily unavailable because the hosting daily allowance has been reached. Contact an administrator.',code:'DATABASE_WRITE_QUOTA'}};
        if(error instanceof HttpError)return {status:error.status,body:{ok:false,error:error.message,...(error.code?{code:error.code}:{})}};
        console.error('attendance_ios10_checkin_failed',{name:error.name});
        return {status:500,body:{ok:false,error:'Request failed; no successful save was confirmed.'}};
      }
    }
    if(INSTALL_PATHS.includes(path)&&method==='POST'){
      try{
        check(this.read('initialized',false),'Service awaiting controlled test initialization',503);
        return {status:200,body:await handleIos10Install(this,path,body,ip)};
      }catch(error){
        if(error instanceof HttpError)return {status:error.status,body:{ok:false,error:error.message}};
        console.error('attendance_ios10_install_failed',{path,name:error.name});
        return {status:503,body:{ok:false,error:'Setup could not be completed. Please retry.'}};
      }
    }
    const result=await super.handle(path,method,body,token,ip,app);
    if(method==='POST'&&['/attendance/kiosk','/attendance/kiosk/revoke'].includes(path)&&result.status===200)clearIos10InstallCodes(this);
    return result;
  }
  async alarm(){await expireIos10InstallCodes(this);}
}

function marked(response){
  const headers=new Headers(response.headers);
  headers.set('X-Attendance-Environment','ios10-test');
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function json(body,status=200){
  return marked(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8'}}));
}
async function page(request,env,manage){
  const assetUrl=new URL(request.url);
  assetUrl.pathname=manage?'/manage/index.html':'/index.html';
  assetUrl.search='';
  const asset=await env.ATTENDANCE_TEST_ASSETS.fetch(new Request(assetUrl,{method:'GET'}));
  if(!asset.ok)return json({ok:false,error:'Test page build unavailable'},503);
  const html=await asset.text();
  // The generator hashes the exact script/style bytes. Promote its CSP to a
  // response header so frame-ancestors is enforced as well as the meta policy.
  const policy=html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?\s*>/i)?.[1]
    ?.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&');
  if(!policy||!policy.includes("script-src 'sha256-")||!policy.includes("style-src 'sha256-")||!html.includes('iOS 10 compatibility test')){
    return json({ok:false,error:'Invalid test page build'},503);
  }
  return marked(new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policy+"; frame-ancestors 'none'"}}));
}
async function homeScreenIcon(request,env){
  const assetUrl=new URL(request.url);
  assetUrl.pathname='/apple-touch-icon.png';
  assetUrl.search='';
  const asset=await env.ATTENDANCE_TEST_ASSETS.fetch(new Request(assetUrl,{method:'GET'}));
  if(!asset.ok||asset.headers.get('Content-Type')?.split(';')[0].trim()!=='image/png'){
    return json({ok:false,error:'Test icon build unavailable'},503);
  }
  const bytes=new Uint8Array(await asset.arrayBuffer());
  const signature=[137,80,78,71,13,10,26,10];
  // Reject an asset fallback or stale build before returning an install icon.
  if(bytes.length<24||!signature.every((value,index)=>bytes[index]===value)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR'||new DataView(bytes.buffer).getUint32(16)!==192||new DataView(bytes.buffer).getUint32(20)!==192){
    return json({ok:false,error:'Invalid test icon build'},503);
  }
  return marked(new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':'image/png','Content-Length':String(bytes.length)}}));
}

export default {
  async fetch(request,env){
    try{assertTestEnvironment(env);}catch{return json({ok:false,error:'Isolated attendance test configuration required'},503);}
    const url=new URL(request.url),path=url.pathname;
    if(request.method==='GET'&&path==='/health')return json({ok:true,environment:'ios10-test',siteId:TEST_SITE,productionData:false});
    if(request.method==='GET'&&path==='/')return marked(new Response(null,{status:302,headers:{Location:'/sign-in/manage'}}));
    if(request.method==='GET'&&['/sign-in','/sign-in/','/sign-in/manage','/sign-in/manage/'].includes(path)){
      return page(request,env,path.startsWith('/sign-in/manage'));
    }
    if(['GET','HEAD'].includes(request.method)&&['/sign-in/apple-touch-icon.png','/apple-touch-icon.png'].includes(path)){
      return homeScreenIcon(request,env);
    }
    const methods=API_METHODS.get(path);
    if(!methods||!methods.includes(request.method)&&request.method!=='OPTIONS')return json({ok:false,error:'Not found'},404);
    // All delegated data requests resolve only the dedicated test site/class.
    return marked(await attendanceWorker.fetch(request,env));
  }
};
