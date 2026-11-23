// Measure only fixed operational documents in SQLite. Never parse their contents.
const fields=Object.freeze({'qa-checks':'qa','orders':'orders','app:photos':'photos','workshop-stock':'workshop','app:transactions':'transactions','app:cncPanels':'cnc'});
const MIB=1024*1024;
export function runtimeDocumentSizes(sql){
 return sql.exec("SELECT key,COUNT(*) AS chunks,SUM(length(CAST(value AS BLOB))) AS bytes FROM documents WHERE key IN ('qa-checks','orders','app:photos','workshop-stock','app:transactions','app:cncPanels') GROUP BY key ORDER BY key").toArray();
}
// These are source-document growth references, not measured heap limits or quotas.
export function storageSizeState(metrics){
 let trackedSourceBytes=0,observed=0;
 for(const field of Object.values(fields)){
  const key=field+'Bytes';if(!Object.hasOwn(metrics,key))continue;
  const value=metrics[key];if(!Number.isSafeInteger(value)||value<0)throw Error('Storage byte measurement is unavailable');
  trackedSourceBytes+=value;observed++;
 }
 if(!Number.isSafeInteger(trackedSourceBytes))throw Error('Storage byte measurement exceeds the supported range');
 const large=metrics.qaBytes>=40*MIB||metrics.workshopBytes>=40*MIB||metrics.photosBytes>=20*MIB||trackedSourceBytes>=80*MIB;
 return {riskState:observed?(large?'warning':'normal'):'unavailable',trackedSourceBytes,observedSourceCount:observed};
}
function usersSize(sql){
 try{
  const rows=sql.exec("SELECT COUNT(*) AS usersChunks,COALESCE(SUM(length(CAST(value AS BLOB))),0) AS usersBytes FROM documents WHERE key='users'").toArray();
  if(rows.length!==1)return {};
  const {usersBytes,usersChunks}=rows[0];
  if(!Number.isSafeInteger(usersBytes)||usersBytes<0||!Number.isSafeInteger(usersChunks)||usersChunks<1)return {};
  return {usersBytes,usersChunks};
 }catch{return {};}
}
function profilesSize(sql){
 const unavailable={profilesMeasurementAvailable:0};
 try{
  const rows=sql.exec('SELECT COUNT(*) AS profileCount,COALESCE(SUM(length(CAST(p.data AS BLOB))),0) AS profilesBytes,COALESCE(MAX(length(CAST(p.data AS BLOB))),0) AS largestProfileBytes,COALESCE(SUM(CASE WHEN u.active=1 THEN 1 ELSE 0 END),0) AS activeProfileCount,COALESCE(SUM(CASE WHEN u.active=1 THEN length(CAST(p.data AS BLOB)) ELSE 0 END),0) AS activeProfilesBytes,COALESCE(MAX(CASE WHEN u.active=1 THEN length(CAST(p.data AS BLOB)) ELSE 0 END),0) AS largestActiveProfileBytes FROM employee_profiles p LEFT JOIN access_users u ON u.username=p.username').toArray();
  if(rows.length!==1)return unavailable;
  const names=['profileCount','profilesBytes','largestProfileBytes','activeProfileCount','activeProfilesBytes','largestActiveProfileBytes'],metrics={};
  for(const name of names){const value=rows[0][name];if(!Number.isSafeInteger(value)||value<0)return unavailable;metrics[name]=value;}
  if(metrics.activeProfileCount>metrics.profileCount||metrics.activeProfilesBytes>metrics.profilesBytes||metrics.largestProfileBytes>metrics.profilesBytes||metrics.largestActiveProfileBytes>metrics.activeProfilesBytes||metrics.largestActiveProfileBytes>metrics.largestProfileBytes)return unavailable;
  if(metrics.profileCount===0&&(metrics.profilesBytes||metrics.largestProfileBytes)||metrics.activeProfileCount===0&&(metrics.activeProfilesBytes||metrics.largestActiveProfileBytes))return unavailable;
  return {profilesMeasurementAvailable:1,...metrics};
 }catch{return unavailable;}
}
export function runtimeDocumentSizeLog(sql){
 const log={event:'inventory_storage_sizes'};
 for(const {key,bytes,chunks}of runtimeDocumentSizes(sql)){
  if(!Object.hasOwn(fields,key))continue;
  if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(chunks)||chunks<1)throw Error('Storage document measurement is unavailable');
  const field=fields[key];log[field+'Bytes']=bytes;log[field+'Chunks']=chunks;
 }
 // Advisory account/profile sizes do not change the six existing source-growth
 // references. Only fixed numeric aggregates leave SQLite; no profile JSON,
 // photo, username, credential, role or other stored value is read into JS.
 return {...log,...storageSizeState(log),...usersSize(sql),...profilesSize(sql)};
}
