import {pathToFileURL} from 'node:url';
import {configureStorageAlerts} from './configure-storage-alerts.mjs';

export function databaseAlertPlan(account,email){
 if(!/^[a-f0-9]{32}$/i.test(account))throw Error('A valid Cloudflare account is required');
 const base=" FROM logs.workersLogs WHERE accountTag='"+account+"' AND scriptName='panelstock-reports' AND attributes['event']='database_usage_metrics'";
 const valid=" AND attributes['metricsAvailable']=1 AND (attributes['state']='normal' OR attributes['state']='warning')";
 const count=where=>"SELECT COUNT(*) AS value"+base+where;
 const sampleQuery=count(valid+" AND timestamp >= NOW() - INTERVAL '30' MINUTE");
 const definitions=[
  {name:'PanelStock database write usage',description:'Account-wide Durable Object SQLite analytics, including staging: 80,000 measured UTC-day writes, a guarded 100,000 write projection, or recent memory/CPU/internal errors. These are operational references, not verified quotas or billing caps. Analytics allow five minutes for ingestion. Projection requires at least one elapsed hour, 20,000 day writes and 10,000 last-hour writes. Evaluate every 15 minutes; repeat at most hourly; warning samples remain in the query window for 30 minutes.',query:count(" AND attributes['metricsAvailable']=1 AND attributes['state']='warning' AND timestamp >= NOW() - INTERVAL '30' MINUTE"),operator:'>=',window:'30m'},
  {name:'PanelStock database usage unavailable',description:'The scheduled read-only analytics collector could not validate its account-wide database usage sample. Check the dedicated Analytics Read secret, expiry, API access and ingestion. Missing measurements are never reported as zero usage. Evaluate every 15 minutes; repeat at most hourly.',query:count(" AND attributes['state']='unavailable' AND timestamp >= NOW() - INTERVAL '30' MINUTE"),operator:'>=',window:'30m'},
  {name:'PanelStock database monitor silence',description:'No valid account-wide database usage measurement was logged for 45 minutes. Check the Cloudflare scheduled job, monitoring credential and log ingestion. This does not establish data loss. Evaluate every 15 minutes; repeat at most hourly.',query:count(valid+" AND timestamp >= NOW() - INTERVAL '45' MINUTE"),operator:'<',window:'45m'}
 ];
 return {sampleQuery,policies:definitions.map(value=>({name:value.name,description:value.description,alert_type:'custom_analytics',enabled:false,alert_interval:'1h',mechanisms:{email},filters:{source:['sql_api'],selectors:[value.query],execution_interval:['15m'],alert_trigger_preferences:['threshold'],alert_trigger_preferences_operator:[value.operator],alert_trigger_preferences_value:['1'],alert_trigger_preferences_short_window:[value.window]}}))};
}
export function configureDatabaseAlerts(env=process.env,options={}){
 return configureStorageAlerts(env,{maxWaitMs:16*60000,...options,planFactory:databaseAlertPlan,monitorLabel:'database usage'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await configureDatabaseAlerts();}catch(error){console.error(error.message);process.exitCode=1;}
}
