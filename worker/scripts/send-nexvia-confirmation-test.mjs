// Run only in the trusted deployment environment: no Resend credential is copied.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

if(process.argv[2]!=='--send-po7413-test'){
  console.log('Use --send-po7413-test to send the explicitly requested existing-PO email test. No PO is created.');
  process.exit(0);
}
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)throw Error('Production Cloudflare credentials are required.');
const temporary=await mkdtemp(join(tmpdir(),'panelstock-nexvia-test-'));
const name='panelstock-po-test-'+randomBytes(8).toString('hex');
const token=randomBytes(32).toString('hex');
const digest=createHash('sha256').update(token).digest('hex');
const config=join(temporary,'wrangler.json');
const expiry=Date.now()+5*60*1000;
// Only this fixed test RPC is reachable. Authentication expires even if cleanup fails.
const source=`export default {async fetch(request,env){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/po7413-test'||Date.now()>${expiry})return new Response('Not found',{status:404});
  const supplied=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(supplied))),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==${JSON.stringify(digest)})return new Response('Not found',{status:404});
  const result=await env.INVENTORY.getByName('panelstock').sendNexviaTestConfirmation();
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}};`;
function wrangler(args){
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{encoding:'utf8',timeout:120000,env:process.env});
  if(result.status!==0)throw Error('Cloudflare test helper operation failed. Inspect the deployment in Cloudflare; no credential values were logged.');
  return result.stdout;
}
let deploymentAttempted=false;
try{
  await writeFile(join(temporary,'index.js'),source,{mode:0o600});
  await writeFile(config,JSON.stringify({name,main:'index.js',compatibility_date:'2026-08-21',workers_dev:true,observability:{enabled:false},durable_objects:{bindings:[{name:'INVENTORY',class_name:'InventoryStore',script_name:'panelstock-reports'}]}}),{mode:0o600});
  deploymentAttempted=true;
  wrangler(['deploy','--config',config]);
  const account=process.env.CLOUDFLARE_ACCOUNT_ID;
  const subdomainResponse=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/workers/subdomain',{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(20000)});
  const subdomain=await subdomainResponse.json();
  if(!subdomainResponse.ok||!subdomain.success||!subdomain.result?.subdomain)throw Error('Cannot resolve the temporary Worker URL.');
  const target='https://'+name+'.'+subdomain.result.subdomain+'.workers.dev/po7413-test';
  let confirmation;
  for(let attempt=0;attempt<6;attempt++){
    try{
      const response=await fetch(target,{method:'POST',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(45000)});
      const result=await response.json();
      if(!response.ok||!result.ok)throw Error('Test request failed.');
      confirmation=result.confirmation;
      if(confirmation?.status==='sent'&&confirmation.providerId)break;
      if(['failed','needs_review','retrying'].includes(confirmation?.status))break;
    }catch{
      // Repeating this fixed RPC reuses the persisted test job and provider key.
      if(attempt===5)throw Error('Test outcome could not be read. Check the stored job before trying a different test.');
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(confirmation?.status!=='sent'||!confirmation.providerId)throw Error('Resend has not accepted the test. Stored status: '+(confirmation?.status||'unknown')+'. No success is claimed.');
  console.log('Resend accepted the PO7413 test to matt@lennoxfacades.com from porequest@panelstockhq.com.');
  console.log('Provider ID: '+confirmation.providerId);
  console.log('This email-only test did not create or modify a Nexvia PO.');
}finally{
  try{if(deploymentAttempted)wrangler(['delete','--config',config,'--force']);}
  catch{console.error('Temporary Worker cleanup failed; its authentication expires within five minutes. Delete '+name+' in Cloudflare.');process.exitCode=1;}
  await rm(temporary,{recursive:true,force:true});
}
