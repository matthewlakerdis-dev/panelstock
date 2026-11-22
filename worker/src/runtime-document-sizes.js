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
export function runtimeDocumentSizeLog(sql){
 const log={event:'inventory_storage_sizes'};
 for(const {key,bytes,chunks}of runtimeDocumentSizes(sql)){
  if(!Object.hasOwn(fields,key))continue;
  if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(chunks)||chunks<1)throw Error('Storage document measurement is unavailable');
  const field=fields[key];log[field+'Bytes']=bytes;log[field+'Chunks']=chunks;
 }
 return {...log,...storageSizeState(log)};
}
