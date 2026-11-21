import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const HOUR=3600000,DAY=24*HOUR;
export function monitoringWindow(now=new Date()){
 const time=Number(now);if(!Number.isFinite(time))throw Error('Invalid monitoring time');
 // Allow five minutes for Cloudflare analytics ingestion.
 const asOf=new Date(time-5*60000),dayStart=new Date(asOf.toISOString().slice(0,10)+'T00:00:00Z');
 return {asOf:asOf.toISOString(),dayStart:dayStart.toISOString(),hourStart:new Date(+asOf-HOUR).toISOString(),recentStart:new Date(+asOf-15*60000).toISOString()};
}
export function sumMetric(groups,key){
 if(!Array.isArray(groups))throw Error('Database analytics are missing');
 let total=0;
 for(const group of groups){
  const value=group?.sum?.[key];
  if(!Number.isSafeInteger(value)||value<0)throw Error('Database analytics contain an invalid '+key+' value');
  total+=value;if(!Number.isSafeInteger(total))throw Error('Database analytics exceed the supported numeric range');
 }
 return total;
}
export async function collectUsage({token,account,now=new Date(),fetcher=fetch}){
 if(!token||!account)throw Error('Cloudflare analytics credentials are unavailable');
 const window=monitoringWindow(now);
 const query='query DatabaseWriteMonitor($account:String!,$day:Time!,$hour:Time!,$recent:Time!,$until:Time!){viewer{accounts(filter:{accountTag:$account}){day:durableObjectsPeriodicGroups(limit:1,filter:{datetime_geq:$day,datetime_leq:$until}){sum{rowsWritten rowsRead}} hour:durableObjectsPeriodicGroups(limit:1,filter:{datetime_geq:$hour,datetime_leq:$until}){sum{rowsWritten}} recent:durableObjectsPeriodicGroups(limit:1,filter:{datetime_geq:$recent,datetime_leq:$until}){sum{exceededMemoryErrors exceededCpuErrors fatalInternalErrors}}}}}';
 const response=await fetcher('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{account,day:window.dayStart,hour:window.hourStart,recent:window.recentStart,until:window.asOf}}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Cloudflare database analytics returned HTTP '+response.status);
 const result=await response.json();
 if(result.errors?.length)throw Error('Cloudflare database analytics query failed; verify access and metric availability');
 const accounts=result.data?.viewer?.accounts;
 if(!Array.isArray(accounts)||accounts.length!==1)throw Error('Cloudflare database analytics did not confirm this account');
 const data=accounts[0];
 return {...window,dayWrites:sumMetric(data.day,'rowsWritten'),dayReads:sumMetric(data.day,'rowsRead'),hourWrites:sumMetric(data.hour,'rowsWritten'),memoryErrors:sumMetric(data.recent,'exceededMemoryErrors'),cpuErrors:sumMetric(data.recent,'exceededCpuErrors'),internalErrors:sumMetric(data.recent,'fatalInternalErrors')};
}
export function assessUsage(sample,{warning=80000,forecastReference=100000}={}){
 if(!Number.isSafeInteger(warning)||warning<=0||!Number.isSafeInteger(forecastReference)||forecastReference<warning)throw Error('Invalid database monitoring thresholds');
 for(const key of ['dayWrites','dayReads','hourWrites','memoryErrors','cpuErrors','internalErrors'])if(!Number.isSafeInteger(sample[key])||sample[key]<0)throw Error('Incomplete database monitoring sample');
 const asOf=Date.parse(sample.asOf),dayStart=Date.parse(sample.dayStart),elapsed=asOf-dayStart;
 if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=DAY||new Date(dayStart).toISOString().slice(11)!=='00:00:00.000Z')throw Error('Invalid UTC database monitoring window');
 const remainingHours=(DAY-elapsed)/HOUR,forecast=Math.ceil(sample.dayWrites+sample.hourWrites*remainingHours),warnings=[];
 if(!Number.isSafeInteger(forecast))throw Error('Database write projection exceeds the supported numeric range');
 if(sample.dayWrites>=warning)warnings.push('UTC-day SQLite writes reached '+sample.dayWrites.toLocaleString('en-US')+' (operational warning '+warning.toLocaleString('en-US')+').');
 // Avoid projecting a full day from the first few minutes or a tiny sample.
 if(elapsed>=HOUR&&sample.dayWrites>=20000&&sample.hourWrites>=10000&&forecast>=forecastReference)warnings.push('At the last-hour write rate, projected UTC-day writes are '+forecast.toLocaleString('en-US')+' (reference '+forecastReference.toLocaleString('en-US')+').');
 if(sample.memoryErrors||sample.cpuErrors||sample.internalErrors)warnings.push('Recent Durable Object failures: memory='+sample.memoryErrors+', CPU='+sample.cpuErrors+', internal='+sample.internalErrors+'.');
 return {sample,warning,forecastReference,forecast,warnings,state:warnings.length?'warning':'normal'};
}
export function reportUsage(result){
 const {sample:s}=result;
 return '# Database write monitoring\n\n'+
  'Status: **'+result.state+'**. Account-wide Durable Object SQLite metrics, including staging.\n\n'+
  '| Measurement | Value |\n| --- | --- |\n'+
  '| UTC usage day | '+s.dayStart.slice(0,10)+' |\n'+
  '| Analytics through (UTC, five-minute delay) | '+s.asOf+' |\n'+
  '| Rows written in UTC day | '+s.dayWrites+' |\n'+
  '| Rows read in UTC day | '+s.dayReads+' |\n'+
  '| Rows written in previous hour | '+s.hourWrites+' |\n'+
  '| Projected UTC-day writes if last-hour rate continues | '+result.forecast+' |\n'+
  '| Memory / CPU / internal failures in previous 15 minutes | '+s.memoryErrors+' / '+s.cpuErrors+' / '+s.internalErrors+' |\n\n'+
  (result.warnings.length?result.warnings.map(value=>'- '+value).join('\n')+'\n\n':'')+
  'The '+result.warning+' daily warning and '+result.forecastReference+' forecast reference are conservative operational thresholds, not verified account quotas. Paid plans do not share the Free daily write cap. This monitor does not infer a billing-cycle allowance or spending cap. Forecasts assume the last-hour rate continues and may differ from actual usage.\n\n'+
  'Warnings fail this GitHub Actions job and use existing GitHub Actions notification settings. No application request is blocked. This monitor does not send Cloudflare notification emails. Scheduling and analytics can be delayed.\n';
}
export async function runMonitor(env=process.env){
 const sample=await collectUsage({token:env.CLOUDFLARE_API_TOKEN,account:env.CLOUDFLARE_ACCOUNT_ID});
 const result=assessUsage(sample,{warning:Number(env.DATABASE_DAILY_WRITE_WARNING||80000),forecastReference:Number(env.DATABASE_DAILY_WRITE_FORECAST_REFERENCE||100000)});
 const report=reportUsage(result);console.log(report);
 if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,report);
 for(const warning of result.warnings)console.log('::warning title=Database usage warning::'+warning);
 return result.warnings.length?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await runMonitor();}
 catch(error){console.error('::error title=Database monitoring unavailable::'+error.message);process.exitCode=2;}
}
