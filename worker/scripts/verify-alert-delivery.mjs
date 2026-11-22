import {pathToFileURL} from 'node:url';

const POLICY_NAME='PanelStock source document growth';
const DAY=24*60*60*1000;
const sorted=values=>[...values].sort();
function emailDestinations(mechanisms){
 if(!mechanisms||!Array.isArray(mechanisms.email)||!mechanisms.email.length)throw Error('Expected existing email destinations are unavailable');
 const ids=mechanisms.email.map(value=>value?.id);
 if(ids.some(value=>typeof value!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value))||new Set(ids).size!==ids.length)throw Error('Existing email destinations are invalid');
 return sorted(ids);
}
function approvedPolicy(policies){
 const budgets=policies.filter(value=>value.enabled===true&&value.alert_type==='billing_budget_alert'&&value.mechanisms?.email?.length);
 if(!budgets.length)throw Error('An active budget email destination is required');
 const recipients=emailDestinations(budgets[0].mechanisms),signature=JSON.stringify(recipients);
 if(budgets.some(value=>JSON.stringify(emailDestinations(value.mechanisms))!==signature))throw Error('Budget email destinations are ambiguous');
 const matches=policies.filter(value=>value.name===POLICY_NAME);
 if(matches.length!==1||matches[0].enabled!==true||matches[0].alert_type!=='custom_analytics'||typeof matches[0].id!=='string'||!matches[0].id)throw Error('The enabled source document growth policy is unavailable or ambiguous');
 const policy=matches[0];
 if(JSON.stringify(emailDestinations(policy.mechanisms))!==signature||Object.entries(policy.mechanisms).some(([key,value])=>key!=='email'&&(!Array.isArray(value)||value.length)))throw Error('Notification destinations differ from the approved budget email destinations');
 return {policy,recipients};
}

// The returned summary deliberately excludes addresses, notification bodies and credentials.
export async function verifyAlertDelivery(env=process.env,{fetcher=fetch,logger=console,now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=60000}={}){
 const started=Number(now()),account=String(env.CLOUDFLARE_ACCOUNT_ID||'').toLowerCase(),token=env.CLOUDFLARE_API_TOKEN;
 if(!Number.isFinite(started)||!Number.isFinite(maxWaitMs)||maxWaitMs<0)throw Error('Alert verification timing is invalid');
 if(!/^[a-f0-9]{32}$/.test(account)||typeof token!=='string'||!token)throw Error('Cloudflare notification credentials are unavailable');
 const send=env.SEND_MONITOR_TEST==='true',runId=String(env.GITHUB_RUN_ID||'');
 if(send&&!/^[0-9]{1,24}$/.test(runId))throw Error('A valid GitHub run identifier is required for an explicit test');
 const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/alerting/v3';
 const log=value=>typeof logger==='function'?logger(value):logger.log(value);
 async function get(path){
  let response,data;
  try{response=await fetcher(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});}catch{throw Error('Notification history or policy access is unavailable');}
  if(!response.ok)throw Error('Notification history or policy access returned HTTP '+response.status);
  try{data=await response.json();}catch{throw Error('Notification API returned an invalid response');}
  if(data.success===false||data.errors?.length||!Array.isArray(data.result))throw Error('Notification API did not confirm a valid result');
  return data.result;
 }
 const {policy,recipients}=approvedPolicy(await get('/policies'));
 let testRequest='not_sent';
 if(send){
  // This POST is deliberately outside every polling/retry loop, even for HTTP 5xx.
  testRequest='unknown';
  try{
   const response=await fetcher(base+'/policies/'+encodeURIComponent(policy.id)+'/test',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({severity:1,source:'PanelStock monitoring delivery test '+runId}),signal:AbortSignal.timeout(20000)});
   if(response.ok){const data=await response.json();if(data.success===true&&!data.errors?.length)testRequest='accepted';else if(data.success===false||data.errors?.length)testRequest='rejected';}
   else if(response.status>=400&&response.status<500)testRequest='rejected';
  }catch{/* A missing response does not establish that the test was not sent. */}
  log('INFO notification test request '+testRequest+'; this invocation will not resend it.');
 }
 const since=send?started:started-DAY,deadline=started+maxWaitMs;
 let matchedEmailRecords=0,latestSent=null;
 while(true){
  const matches=new Map();
  for(let page=1;page<=3;page++){
   const query=new URLSearchParams({since:new Date(since).toISOString(),page:String(page),per_page:'25'});
   const records=await get('/history?'+query);
   for(const record of records){
    const sent=Date.parse(record.sent);
    if(record.policy_id!==policy.id||record.mechanism_type!=='email'||!recipients.includes(record.mechanism)||!Number.isFinite(sent)||sent<since||sent>Number(now()))continue;
    const key=typeof record.id==='string'?record.id:record.mechanism+'|'+sent;
    matches.set(key,sent);
   }
   if(records.length<25)break;
  }
  matchedEmailRecords=matches.size;latestSent=matchedEmailRecords?new Date(Math.max(...matches.values())).toISOString():null;
  if(!send||matchedEmailRecords||testRequest==='rejected'||Number(now())>=deadline)break;
  await pause(Math.min(5000,Math.max(1,deadline-Number(now()))));
 }
 const state=!send?'history_only':testRequest==='rejected'?'rejected':matchedEmailRecords?'dispatched':'pending';
 log('Email dispatch history: matched records='+matchedEmailRecords+'; latest sent='+(latestSent||'none')+'.');
 log('Dispatch history does not confirm inbox receipt.');
 return {state,testRequest,matchedEmailRecords,latestSent};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await verifyAlertDelivery();process.exitCode=result.state==='pending'||result.state==='rejected'?2:0;}
 catch(error){console.error(error.message);process.exitCode=2;}
}
