// Aggregate fixed operational document sizes inside SQLite. Do not parse records
// or log customer values while diagnosing isolate memory pressure.
export function runtimeDocumentSizes(sql){
 return sql.exec("SELECT key,COUNT(*) AS chunks,SUM(length(CAST(value AS BLOB))) AS bytes FROM documents WHERE key IN ('qa-checks','orders','app:photos','workshop-stock','app:transactions','app:cncPanels') GROUP BY key ORDER BY key").toArray();
}

export function runtimeDocumentSizeLog(sql){
 const fields={'qa-checks':'qa','orders':'orders','app:photos':'photos','workshop-stock':'workshop','app:transactions':'transactions','app:cncPanels':'cnc'};
 const log={event:'inventory_storage_sizes'};
 for(const {key,bytes,chunks}of runtimeDocumentSizes(sql)){const field=fields[key];if(field&&Number.isSafeInteger(bytes)&&Number.isSafeInteger(chunks)){log[field+'Bytes']=bytes;log[field+'Chunks']=chunks;}}
 return log;
}
