import {pathToFileURL} from 'node:url';
const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function storageAlertPlan(account,email){
 if(!/^[a-f0-9]{32}$/i.test(account))throw Error('A valid Cloudflare account is required');
 const base=" FROM logs.workersLogs WHERE accountTag='"+account+"' AND scriptName='panelstock-reports' AND attributes['event']='inventory_storage_sizes'";
 const valid=" AND (attributes['riskState']='normal' OR attributes['riskState']='warning')";
 const sampleQuery="SELECT COUNT(*) AS value"+base+valid+" AND timestamp >= NOW() - INTERVAL '30' MINUTE";
 const definitions=[
  {name:'PanelStock source document growth',description:'A tracked source JSON document exceeds an operational growth reference: QA/workshop 40 MiB, inventory photos 20 MiB, or six tracked documents 80 MiB combined. These are source bytes, not measured heap limits or billing quotas. Review the numeric storage metrics. Evaluation every 15 minutes, repeat notifications at most hourly; warnings may remain in the 30-minute query window after a reduction.',query:"SELECT COUNT(*) AS value"+base+" AND attributes['riskState']='warning' AND timestamp >= NOW() - INTERVAL '30' MINUTE",operator:'>=',threshold:'1',window:'30m'},
  {name:'PanelStock storage monitor silence',description:'No valid storage measurement was recorded for 45 minutes. Check scheduled jobs, intentional maintenance, Worker health and log ingestion. This alert does not establish data loss. Evaluation every 15 minutes, repeat notifications at most hourly.',query:"SELECT COUNT(*) AS value"+base+valid+" AND timestamp >= NOW() - INTERVAL '45' MINUTE",operator:'<',threshold:'1',window:'45m'}
 ];
 const policies=definitions.map(value=>({name:value.name,description:value.description,alert_type:'custom_analytics',enabled:false,alert_interval:'1h',mechanisms:{email},filters:{source:['sql_api'],selectors:[value.query],execution_interval:['15m'],alert_trigger_preferences:['threshold'],alert_trigger_preferences_operator:[value.operator],alert_trigger_preferences_value:[value.threshold],alert_trigger_preferences_short_window:[value.window]}}));
 return {sampleQuery,policies};
}
export function matchingStoragePolicy(saved,wanted){
 return saved.alert_type===wanted.alert_type&&saved.alert_interval===wanted.alert_interval&&Object.entries(wanted.filters).every(([key,value])=>same(saved.filters?.[key],value))&&same((saved.mechanisms?.email||[]).map(({id})=>({id})),wanted.mechanisms.email)&&Object.entries(saved.mechanisms||{}).every(([key,value])=>key==='email'||Array.isArray(value)&&value.length===0);
}
export async function configureStorageAlerts(env=process.env,{fetcher=fetch,logger=console,now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=120000}={}){
 const account=String(env.CLOUDFLARE_ACCOUNT_ID||'').toLowerCase(),token=env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/.test(account)||!token)throw Error('Cloudflare deployment credentials are unavailable');
 async function request(path,method='GET',body){
  const response=await fetcher('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok||data.success===false||data.errors?.length)throw Error('Storage alert API HTTP '+response.status+'; error codes '+JSON.stringify((data.errors||[]).map(value=>value.code)));
  return data;
 }
 const policyPath='/accounts/'+account+'/alerting/v3/policies';
 const readPolicies=async()=>{const data=await request(policyPath);if(!Array.isArray(data.result))throw Error('Notification policy response is invalid');return data.result;};
 const initial=await readPolicies(),budget=initial.find(value=>value.enabled&&value.alert_type==='billing_budget_alert'&&value.mechanisms?.email?.length);
 if(!budget)throw Error('Existing budget email destinations are required; no recipients will be guessed');
 const email=budget.mechanisms.email.map(({id})=>({id}));if(email.some(value=>typeof value.id!=='string'||!value.id.includes('@')))throw Error('Existing email destinations are invalid');
 const plan=storageAlertPlan(account,email);
 async function preview(query){
  const data=await request('/analytics/sql','POST',{query}),value=(data.data||data.result?.data)?.[0]?.value;
  if(!((typeof value==='number'||typeof value==='string'&&/^[0-9]+$/.test(value))&&Number.isSafeInteger(Number(value))&&Number(value)>=0))throw Error('Storage alert query returned no valid count');
  return Number(value);
 }
 const deadline=now()+maxWaitMs;let samples;
 while(true){
  samples=await preview(plan.sampleQuery);if(samples>0)break;
  if(now()>=deadline)throw Error('New structured storage measurements are not indexed yet; no new alerts were enabled');
  logger.log('Waiting for a valid structured storage measurement before activating alerts.');await pause(Math.min(10000,Math.max(1,deadline-now())));
 }
 logger.log('VERIFIED live structured storage samples: '+samples);
 for(const wanted of plan.policies){
  const count=await preview(wanted.filters.selectors[0]);
  logger.log('VERIFIED SQL preview for '+wanted.name+': '+count);
  let matches=(await readPolicies()).filter(value=>value.name===wanted.name);
  if(matches.length>1)throw Error('Duplicate named storage policies require review');
  if(!matches.length){await request(policyPath,'POST',wanted);matches=(await readPolicies()).filter(value=>value.name===wanted.name);}
  if(matches.length!==1||!matchingStoragePolicy(matches[0],wanted))throw Error('Storage policy readback differs; no unmatched policy will be activated');
  const saved=matches[0];if(typeof saved.id!=='string'||!saved.id)throw Error('Saved storage policy identifier is missing');
  if(saved.enabled!==true)await request(policyPath+'/'+encodeURIComponent(saved.id),'PUT',{...wanted,enabled:true});
  const verified=(await readPolicies()).filter(value=>value.id===saved.id);
  if(verified.length!==1||verified[0].enabled!==true||!matchingStoragePolicy(verified[0],wanted))throw Error('Storage policy activation could not be verified');
  logger.log('VERIFIED enabled '+wanted.name+'; evaluation 15m; repeat 1h; existing email destinations='+email.length);
 }
 logger.log('Existing budget, request-usage and runtime-issue policies retained. No test notification was sent.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await configureStorageAlerts();}catch(error){console.error(error.message);process.exitCode=1;}
}
