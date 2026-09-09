import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateQaRecord,migrateQaRecords} from '../src/qa-status.js';

test('legacy QA rework states migrate to recut without changing other data',()=>{
  const original={
    id:'metal-1',
    status:'rework',
    replacementStatus:'rework',
    latest:{status:'rework',checkedBy:'alex'},
    history:[{status:'approved'},{status:'rework'}],
  };
  const migrated=migrateQaRecord(original);
  assert.equal(migrated.status,'recut');
  assert.equal(migrated.replacementStatus,'recut');
  assert.equal(migrated.latest.status,'recut');
  assert.deepEqual(migrated.history.map(entry=>entry.status),['approved','recut']);
  assert.equal(migrated.latest.checkedBy,'alex');
  assert.deepEqual(migrateQaRecord(migrated),migrated);
});

test('ordinary notes containing rework do not trigger a migration',()=>{
  const current={id:'metal-2',status:'approved',notes:'No rework is needed'};
  const unchanged=migrateQaRecords([current]);
  assert.equal(unchanged.count,0);
  assert.equal(unchanged.records[0].status,'approved');
  assert.equal(unchanged.records[0].notes,current.notes);
  assert.equal(migrateQaRecords([{...current,status:'rework'}]).count,1);
});
