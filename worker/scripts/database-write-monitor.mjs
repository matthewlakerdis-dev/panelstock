import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

import {monitoringWindow,sumMetric,collectUsage,assessUsage} from '../src/database-usage-monitor.js';
export {monitoringWindow,sumMetric,collectUsage,assessUsage};

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
