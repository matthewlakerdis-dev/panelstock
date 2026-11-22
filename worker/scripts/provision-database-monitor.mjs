import {pathToFileURL} from 'node:url';

const API='https://api.cloudflare.com/client/v4';
const WORKER='panelstock-reports',SECRET='DATABASE_ANALYTICS_TOKEN';
const TOKEN_NAME='PanelStock database monitoring (read only)';
const ACCOUNT_SCOPE='com.cloudflare.api.account',YEAR=365*24*60*60*1000;
class ProvisionError extends Error {
 constructor(stage,{status=0,ambiguous=false}={}){super('Database monitoring credential operation failed');this.stage=stage;this.status=status;this.ambiguous=ambiguous;}
}
const manualSteps=logger=>{
 logger.log('SETUP_REQUIRED: Create an account-owned token named "'+TOKEN_NAME+'" with Account > Account Analytics > Read on this account only.');
 logger.log('Save its value privately as GitHub Actions secret CLOUDFLARE_ANALYTICS_API_TOKEN and rerun provisioning. Never paste it into chat or logs.');
 logger.log('Do not broaden the deployment token or grant the monitoring token Worker, notification, billing or token-management permissions.');
};

export async function provisionDatabaseMonitor(env=process.env,{fetcher=fetch,logger=console,now=Date.now}={}){
 const account=String(env.CLOUDFLARE_ACCOUNT_ID||'').toLowerCase(),deploymentToken=String(env.CLOUDFLARE_API_TOKEN||'').trim();
 const suppliedToken=String(env.CLOUDFLARE_ANALYTICS_API_TOKEN||'').trim();
 if(!/^[a-f0-9]{32}$/.test(account)||!deploymentToken){manualSteps(logger);return {state:'setup_required',reason:'deployment_credentials_missing'};}
 const time=Number(now());if(!Number.isFinite(time))throw Error('Invalid database provisioning time');
 const accountPath='/accounts/'+account,secretPath=accountPath+'/workers/scripts/'+WORKER+'/secrets';
 let createdId=null,installationStarted=false,installationConfirmed=false;
 async function request(path,{method='GET',body,credential=deploymentToken,stage}={}){
  let response,data;
  try{response=await fetcher(API+path,{method,headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});}
  catch{throw new ProvisionError(stage,{ambiguous:['POST','PUT','DELETE'].includes(method)});}
  if(!response.ok)throw new ProvisionError(stage,{status:response.status,ambiguous:['POST','PUT','DELETE'].includes(method)&&(response.status>=500||response.status===408)});
  try{data=await response.json();}catch{throw new ProvisionError(stage,{status:response.status,ambiguous:['POST','PUT','DELETE'].includes(method)});}
  if(data?.success===false||data?.errors?.length)throw new ProvisionError(stage,{status:response.status});
  return data;
 }
 async function hasSecret(){
  const data=await request(secretPath,{stage:'secret_list'});
  if(!Array.isArray(data?.result))throw new ProvisionError('secret_list');
  return data.result.some(value=>value?.name===SECRET);
 }
 async function verifyCandidate(candidate,expectedId){
  const verified=await request(accountPath+'/tokens/verify',{credential:candidate,stage:'candidate_verify'});
  const id=verified?.result?.id;
  if(verified?.result?.status!=='active'||!/^[a-f0-9]{32}$/i.test(id||'')||expectedId&&id!==expectedId)throw new ProvisionError('candidate_verify');
  const until=new Date(time-5*60000).toISOString(),since=new Date(time-65*60000).toISOString();
  const query='query DatabaseMonitorCredential($account:String!,$since:Time!,$until:Time!){viewer{accounts(filter:{accountTag:$account}){durableObjectsPeriodicGroups(limit:1,filter:{datetime_geq:$since,datetime_leq:$until}){sum{rowsWritten}}}}}';
  const usage=await request('/graphql',{method:'POST',credential:candidate,stage:'candidate_analytics',body:{query,variables:{account,since,until}}});
  const accounts=usage?.data?.viewer?.accounts,groups=accounts?.[0]?.durableObjectsPeriodicGroups;
  if(!Array.isArray(accounts)||accounts.length!==1||!Array.isArray(groups)||groups.length>1||groups.some(group=>!Number.isSafeInteger(group?.sum?.rowsWritten)||group.sum.rowsWritten<0))throw new ProvisionError('candidate_analytics');
 }
 async function ensureNoPreviousToken(){
  // A previous create/install may have lost its response. Never mint another
  // token under this name merely because the Worker secret is not visible yet.
  for(let page=1;page<=5;page++){
   const data=await request(accountPath+'/tokens?per_page=100&include_expired=false&direction=desc&page='+page,{stage:'token_inventory'});
   if(!Array.isArray(data?.result))throw new ProvisionError('token_inventory');
   if(data.result.some(value=>value?.name===TOKEN_NAME))return false;
   const info=data.result_info;
   if(Number.isSafeInteger(info?.total_pages)&&page>=info.total_pages)return true;
   if(data.result.length<100)return true;
  }
  throw new ProvisionError('token_inventory');
 }
 async function cleanup(){
  if(!createdId||installationStarted)return 'not_needed';
  try{await request(accountPath+'/tokens/'+createdId,{method:'DELETE',stage:'token_cleanup'});logger.log('Removed the new, uninstalled monitoring token.');return 'revoked';}
  catch{logger.log('Manual cleanup may be required for the newly created monitoring token; inspect its fixed name in Cloudflare. No token identifier or value is logged.');return 'required';}
 }
 try{
  if(await hasSecret()){
   logger.log('EXISTS: The named Worker analytics secret is present. No token was minted or changed; runtime monitoring must confirm its current access.');
   return {state:'ready',source:'existing_secret',validated:false};
  }
  if(suppliedToken&&suppliedToken===deploymentToken){
   logger.log('SETUP_REQUIRED: The supplied analytics credential is the deployment credential. It will not be copied into the runtime Worker.');
   manualSteps(logger);return {state:'setup_required',reason:'analytics_credential_not_dedicated'};
  }
  let candidate=suppliedToken,expiresOn;
  if(!candidate){
   const groups=await request(accountPath+'/tokens/permission_groups?name=Account%20Analytics%20Read&scope='+encodeURIComponent(ACCOUNT_SCOPE),{stage:'permission_groups'});
   if(!Array.isArray(groups?.result))throw new ProvisionError('permission_groups');
   const selected=groups.result.filter(value=>value?.name==='Account Analytics Read'&&Array.isArray(value.scopes)&&value.scopes.includes(ACCOUNT_SCOPE));
   if(selected.length!==1||selected[0].is_selectable===false||!/^[a-f0-9]{32}$/i.test(selected[0].id||'')){
    manualSteps(logger);return {state:'setup_required',reason:'analytics_permission_not_selectable'};
   }
   if(!await ensureNoPreviousToken()){
    logger.log('SETUP_REQUIRED: A token with the monitoring name already exists, but its Worker secret is absent. Review or install that credential privately before retrying; no additional token was minted.');
    return {state:'setup_required',reason:'existing_monitor_token'};
   }
   // Routine expiry is one year (365 days). Rotate privately before this date.
   expiresOn=new Date(time+YEAR).toISOString();
   const minted=await request(accountPath+'/tokens',{method:'POST',stage:'token_create',body:{name:TOKEN_NAME,expires_on:expiresOn,policies:[{effect:'allow',permission_groups:[{id:selected[0].id}],resources:{[ACCOUNT_SCOPE+'.'+account]:'*'}}]}});
   const result=minted?.result;
   if(/^[a-f0-9]{32}$/i.test(result?.id||''))createdId=result.id;
   if(!createdId){logger.log('UNCERTAIN: Token creation returned no usable identifier. Review the fixed token name in Cloudflare before retrying; no automatic retry or replacement was attempted.');return {state:'uncertain',reason:'token_creation_uncertain'};}
   candidate=typeof result.value==='string'?result.value.trim():'';
   if(!candidate)throw new ProvisionError('token_create_result');
  }
  await verifyCandidate(candidate,createdId);
  installationStarted=true;
  try{
   await request(secretPath,{method:'PUT',stage:'secret_install',body:{name:SECRET,type:'secret_text',text:candidate}});
   installationConfirmed=true;
  }catch(error){
   // An explicit HTTP rejection means the installation did not happen. A
   // transport/decoding failure can follow a committed write and is uncertain.
   if(error instanceof ProvisionError&&!error.ambiguous){installationStarted=false;throw error;}
   throw error;
  }
  if(!await hasSecret())throw new ProvisionError('secret_confirmation',{ambiguous:true});
  logger.log('VERIFIED: Analytics access was validated and the named Worker secret is present. No credential value or identifier was logged.');
  if(expiresOn)logger.log('The dedicated read-only credential expires '+expiresOn+'; rotate privately before expiry.');
  return {state:'ready',source:createdId?'created_token':'provided_token',validated:true,...(expiresOn?{expiresOn}:{})};
 }catch(error){
  const failure=error instanceof ProvisionError?error:new ProvisionError('unexpected');
  if(installationStarted||installationConfirmed||failure.stage==='token_create'&&failure.ambiguous){
   let secretPresent=null;try{secretPresent=await hasSecret();}catch{}
   logger.log('UNCERTAIN: Credential creation or installation could not be confirmed. No credential was revoked or automatically reminted. Verify the named Worker secret and runtime access before retrying.');
   return {state:'uncertain',reason:failure.stage==='token_create'?'token_creation_uncertain':'secret_installation_uncertain',secretPresent};
  }
  const removed=await cleanup();
  if(failure.status===401||failure.status===403){logger.log('Credential setup denied at '+failure.stage+'; HTTP '+failure.status+'.');manualSteps(logger);return {state:'setup_required',reason:failure.stage+'_denied',cleanup:removed};}
  logger.log('FAILED: Monitoring credential setup could not be verified at '+failure.stage+'. Provider response contents and credentials are not logged.');
  return {state:'failed',reason:failure.stage,cleanup:removed};
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await provisionDatabaseMonitor();process.exitCode=result.state==='ready'?0:result.state==='setup_required'?2:result.state==='uncertain'?3:1;}
 catch{console.error('FAILED: Monitoring credential setup stopped safely; no credential details are logged.');process.exitCode=1;}
}
