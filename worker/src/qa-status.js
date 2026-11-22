export const migrateQaStatus=value=>value==='rework'?'recut':value;

export function migrateQaRecord(record){
  return {
    ...record,
    status:migrateQaStatus(record.status),
    replacementStatus:migrateQaStatus(record.replacementStatus),
    latest:record.latest?{...record.latest,status:migrateQaStatus(record.latest.status)}:record.latest,
    history:Array.isArray(record.history)?record.history.map(attempt=>({...attempt,status:migrateQaStatus(attempt.status)})):record.history,
  };
}

export function migrateQaRecords(records){
  const migrated=records.map(migrateQaRecord);
  // Only these status fields can change. Comparing complete serialized records
  // duplicates the entire photo history just to detect a small legacy label.
  const count=records.reduce((total,record)=>total+(
    record.status==='rework'||record.replacementStatus==='rework'||record.latest?.status==='rework'||
    Array.isArray(record.history)&&record.history.some(attempt=>attempt.status==='rework')?1:0
  ),0);
  return {records:migrated,count};
}
