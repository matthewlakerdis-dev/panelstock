// Approved notification setup. No billing changes and no test messages.
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('Existing Cloudflare credentials are unavailable');
const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/alerting/v3';
async function api(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();
 if(!response.ok||data.success===false)throw Error('Cloudflare HTTP '+response.status+'; error codes '+JSON.stringify((data.errors||[]).map(x=>x.code)));
 return data.result;
}
const initial=await api('/policies');
const budget=initial.find(p=>p.enabled&&p.alert_type==='billing_budget_alert'&&p.mechanisms?.email?.length);
if(!budget)throw Error('No enabled budget email policy exists; do not guess notification recipients');
const email=budget.mechanisms.email.map(({id})=>({id}));
if(email.some(value=>typeof value.id!=='string'||!value.id.includes('@')))throw Error('Existing email destinations could not be verified');
console.log('Existing budget alert retained; email destination count: '+email.length);
console.log('Existing budget threshold: '+JSON.stringify(budget.filters?.total_spend_dollars||[]));
const desired=[
 {name:'PanelStock Workers usage warning',alert_type:'billing_usage_alert',description:'Warn when account Workers requests reach 8,000,000 in the billing period. This is an early usage warning, not a spending cap or a per-day database quota alert.',enabled:true,filters:{product:['worker_requests'],limit:['8000000']},mechanisms:{email}},
 {name:'PanelStock Workers runtime issues',alert_type:'workers_observability_real_time_issue',description:'Notify existing budget-alert recipients when Cloudflare detects a Workers Observability runtime issue. Covers the account services; no hard resource limit is changed.',enabled:true,filters:{},mechanisms:{email}}
];
function matches(saved,wanted){
 const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 return saved.enabled===true&&saved.alert_type===wanted.alert_type&&JSON.stringify(canonical(saved.filters||{}))===JSON.stringify(canonical(wanted.filters))&&JSON.stringify(canonical((saved.mechanisms?.email||[]).map(({id})=>({id}))))===JSON.stringify(canonical(email));
}
let failed=false;
for(const wanted of desired){
 try{
  const existing=initial.filter(p=>p.name===wanted.name);
  if(existing.length>1)throw Error('Duplicate named policies need review');
  if(existing.length){if(!matches(existing[0],wanted))throw Error('A policy with this name has different settings; no overwrite performed');}
  else await api('/policies','POST',wanted);
  const verified=(await api('/policies')).filter(p=>p.name===wanted.name);
  if(verified.length!==1||!matches(verified[0],wanted))throw Error('Saved policy could not be verified');
  console.log('VERIFIED '+wanted.name+'; type='+wanted.alert_type+'; filters='+JSON.stringify(wanted.filters)+'; email destinations='+email.length);
 }catch(error){failed=true;console.error('NOT CONFIGURED '+wanted.name+': '+error.message);}
}
console.log('No subscription, plan, existing budget threshold or application data was changed. No test notification was sent.');
if(failed)process.exitCode=1;
