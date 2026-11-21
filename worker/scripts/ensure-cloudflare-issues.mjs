// Retain existing logging, sampling and tracing while enabling runtime issue detection.
// Reapply after Wrangler deployments until the pinned Wrangler supports issues in config.
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('Cloudflare deployment credentials are unavailable');
const script='panelstock-reports',url='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+script+'/script-settings';
async function settings(method='GET',body){
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();
 if(!response.ok||data.success===false)throw Error('Worker issue settings: HTTP '+response.status+'; error codes '+JSON.stringify((data.errors||[]).map(value=>value.code)));
 if(!data.result||typeof data.result!=='object')throw Error('Worker settings response is invalid');
 return data.result;
}
const initial=await settings(),prior=initial.observability||{};
if(prior.enabled!==true)throw Error('Existing Worker observability is disabled; enablement needs review');
if(prior.issues?.enabled!==true){
 const observability={...prior,issues:{...prior.issues,enabled:true}};
 await settings('PATCH',{observability});
}
const verified=await settings(),current=verified.observability;
if(current?.enabled!==true||current?.issues?.enabled!==true)throw Error('Runtime issue detection was not confirmed enabled');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
for(const key of ['logs','traces','head_sampling_rate','redact_query_string']){
 if(Object.hasOwn(prior,key)&&JSON.stringify(canonical(prior[key]))!==JSON.stringify(canonical(current[key])))throw Error('An existing observability setting changed unexpectedly: '+key);
}
console.log('VERIFIED runtime issue detection enabled for '+script+'; existing logs, traces and sampling retained.');
