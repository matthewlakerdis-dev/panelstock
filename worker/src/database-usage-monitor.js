const HOUR=3600000,DAY=24*HOUR,INGESTION_DELAY=5*60000;

// Only these fixed numeric codes may appear in an unavailable runtime event.
// They describe monitoring failures; upstream messages and response bodies stay private.
const failure=Object.freeze({credentials:1,account:2,thresholds:3,window:4,transport:5,http:6,response:7,graphql:8,accountResult:9,metric:10,noSamples:11,projection:12,unknown:13});
class MonitoringError extends Error{
 constructor(message,code){super(message);this.code=code;}
}
const unavailable=(message,code)=>{throw new MonitoringError(message,code);};

export function monitoringWindow(now=new Date()){
 const time=Number(now);
 if(!Number.isFinite(time)||!Number.isFinite(+new Date(time-INGESTION_DELAY)))unavailable('Invalid monitoring time',failure.window);
 // The UTC date follows the delayed sample, including just after midnight.
 const asOf=new Date(time-INGESTION_DELAY),dayStart=new Date(asOf.toISOString().slice(0,10)+'T00:00:00Z');
 return {asOf:asOf.toISOString(),dayStart:dayStart.toISOString(),hourStart:new Date(+asOf-HOUR).toISOString(),recentStart:new Date(+asOf-15*60000).toISOString()};
}

export function sumMetric(groups,key){
 if(!Array.isArray(groups))unavailable('Database analytics are missing',failure.metric);
 let total=0;
 for(const group of groups){
  const value=group?.sum?.[key];
  if(!Number.isSafeInteger(value)||value<0)unavailable('Database analytics contain an invalid '+key+' value',failure.metric);
  total+=value;
  if(!Number.isSafeInteger(total))unavailable('Database analytics exceed the supported numeric range',failure.metric);
 }
 return total;
}

export async function collectUsage({token,account,now=new Date(),fetcher=fetch,requireActivity=false}){
 if(!token||!account)unavailable('Cloudflare analytics credentials are unavailable',failure.credentials);
 const window=monitoringWindow(now);
 // No namespace filter: the allowance and operational references are account-wide.
 const query='query DatabaseWriteMonitor($account:String!,$day:Time!,$hour:Time!,$recent:Time!,$until:Time!){viewer{accounts(filter:{accountTag:$account}){day:durableObjectsPeriodicGroups(limit:1,filter:{datetime_geq:$day,datetime_leq:$until}){sum{rowsWritten rowsRead}} hour:durableObjectsPeriodicGroups(limit:1,filter:{datetime_geq:$hour,datetime_leq:$until}){sum{rowsWritten}} recent:durableObjectsPeriodicGroups(limit:1,filter:{datetime_geq:$recent,datetime_leq:$until}){sum{exceededMemoryErrors exceededCpuErrors fatalInternalErrors}}}}}';
 let response;
 try{
  response=await fetcher('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{account,day:window.dayStart,hour:window.hourStart,recent:window.recentStart,until:window.asOf}}),signal:AbortSignal.timeout(20000)});
 }catch{unavailable('Cloudflare database analytics are unavailable',failure.transport);}
 if(!response?.ok)unavailable('Cloudflare database analytics returned HTTP '+response?.status,failure.http);
 let result;
 try{result=await response.json();}catch{unavailable('Cloudflare database analytics returned an invalid response',failure.response);}
 if(!result||typeof result!=='object'||Array.isArray(result)||result.errors!=null&&!Array.isArray(result.errors))unavailable('Cloudflare database analytics returned an invalid response',failure.response);
 if(result.errors?.length)unavailable('Cloudflare database analytics query failed; verify access and metric availability',failure.graphql);
 const accounts=result.data?.viewer?.accounts;
 if(!Array.isArray(accounts)||accounts.length!==1||!accounts[0]||typeof accounts[0]!=='object')unavailable('Cloudflare database analytics did not confirm this account',failure.accountResult);
 const data=accounts[0],sample={...window,dayWrites:sumMetric(data.day,'rowsWritten'),dayReads:sumMetric(data.day,'rowsRead'),hourWrites:sumMetric(data.hour,'rowsWritten'),memoryErrors:sumMetric(data.recent,'exceededMemoryErrors'),cpuErrors:sumMetric(data.recent,'exceededCpuErrors'),internalErrors:sumMetric(data.recent,'fatalInternalErrors')};
 // Keep the CLI's existing empty-array aggregation, while scheduled production
 // monitoring refuses to call an entirely absent activity sample healthy.
 if(requireActivity&&!data.day.length&&!data.hour.length&&!data.recent.length)unavailable('Cloudflare database analytics did not return activity samples',failure.noSamples);
 return sample;
}

function validateThresholds(warning,forecastReference){
 if(!Number.isSafeInteger(warning)||warning<=0||!Number.isSafeInteger(forecastReference)||forecastReference<warning)unavailable('Invalid database monitoring thresholds',failure.thresholds);
}
function assessment(sample,{warning=80000,forecastReference=100000}={}){
 validateThresholds(warning,forecastReference);
 if(!sample||typeof sample!=='object')unavailable('Incomplete database monitoring sample',failure.metric);
 for(const key of ['dayWrites','dayReads','hourWrites','memoryErrors','cpuErrors','internalErrors'])if(!Number.isSafeInteger(sample[key])||sample[key]<0)unavailable('Incomplete database monitoring sample',failure.metric);
 const asOf=Date.parse(sample.asOf),dayStart=Date.parse(sample.dayStart),elapsed=asOf-dayStart;
 if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=DAY||new Date(dayStart).toISOString().slice(11)!=='00:00:00.000Z')unavailable('Invalid UTC database monitoring window',failure.window);
 const remainingHours=(DAY-elapsed)/HOUR,forecast=Math.ceil(sample.dayWrites+sample.hourWrites*remainingHours),warnings=[];
 if(!Number.isSafeInteger(forecast))unavailable('Database write projection exceeds the supported numeric range',failure.projection);
 const dailyWarning=sample.dayWrites>=warning;
 // Avoid a full-day warning based on midnight traffic or a tiny sample.
 const forecastWarning=elapsed>=HOUR&&sample.dayWrites>=20000&&sample.hourWrites>=10000&&forecast>=forecastReference;
 const runtimeFailureWarning=!!(sample.memoryErrors||sample.cpuErrors||sample.internalErrors);
 if(dailyWarning)warnings.push('UTC-day SQLite writes reached '+sample.dayWrites.toLocaleString('en-US')+' (operational warning '+warning.toLocaleString('en-US')+').');
 if(forecastWarning)warnings.push('At the last-hour write rate, projected UTC-day writes are '+forecast.toLocaleString('en-US')+' (reference '+forecastReference.toLocaleString('en-US')+').');
 if(runtimeFailureWarning)warnings.push('Recent Durable Object failures: memory='+sample.memoryErrors+', CPU='+sample.cpuErrors+', internal='+sample.internalErrors+'.');
 return {sample,warning,forecastReference,forecast,warnings,state:warnings.length?'warning':'normal',dailyWarning,forecastWarning,runtimeFailureWarning};
}
export function assessUsage(sample,options){
 const {dailyWarning,forecastWarning,runtimeFailureWarning,...result}=assessment(sample,options);
 return result;
}

export async function runScheduledDatabaseMonitor(env,{fetcher=fetch,logger=console,now=new Date()}={}){
 let event;
 const collectedAtMs=Number(now),timestamp=Number.isSafeInteger(collectedAtMs)&&Number.isFinite(+new Date(collectedAtMs))?{collectedAtMs}:{};
 try{
  const token=env?.DATABASE_ANALYTICS_TOKEN,account=env?.DATABASE_ANALYTICS_ACCOUNT_ID;
  // The deployment credential is deliberately not a fallback for this read-only token.
  if(typeof token!=='string'||!token.trim())unavailable('Cloudflare analytics credentials are unavailable',failure.credentials);
  if(typeof account!=='string'||!/^[a-f0-9]{32}$/i.test(account))unavailable('Cloudflare analytics account is invalid',failure.account);
  const warning=env.DATABASE_DAILY_WRITE_WARNING===undefined?80000:Number(env.DATABASE_DAILY_WRITE_WARNING),forecastReference=env.DATABASE_DAILY_WRITE_FORECAST_REFERENCE===undefined?100000:Number(env.DATABASE_DAILY_WRITE_FORECAST_REFERENCE);
  validateThresholds(warning,forecastReference);
  const sample=await collectUsage({token,account,now,fetcher,requireActivity:true}),result=assessment(sample,{warning,forecastReference});
  event={event:'database_usage_metrics',state:result.state,metricsAvailable:1,...timestamp,asOfMs:Date.parse(sample.asOf),utcDayStartMs:Date.parse(sample.dayStart),dayWrites:sample.dayWrites,dayReads:sample.dayReads,hourWrites:sample.hourWrites,projectedDayWrites:result.forecast,warningReference:warning,forecastReference,dailyWarning:Number(result.dailyWarning),forecastWarning:Number(result.forecastWarning),runtimeFailureWarning:Number(result.runtimeFailureWarning),memoryErrors:sample.memoryErrors,cpuErrors:sample.cpuErrors,internalErrors:sample.internalErrors};
 }catch(error){
  event={event:'database_usage_metrics',state:'unavailable',metricsAvailable:0,...timestamp,unavailableCode:error instanceof MonitoringError?error.code:failure.unknown};
 }
 // A logging or monitoring failure must never interrupt application maintenance.
 try{if(typeof logger==='function')await logger(event);else await logger?.log(event);}catch{}
 return {state:event.state};
}
