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
  const count=records.reduce((total,record,index)=>total+(JSON.stringify(record)!==JSON.stringify(migrated[index])?1:0),0);
  return {records:migrated,count};
}
