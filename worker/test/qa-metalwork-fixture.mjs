import {randomUUID} from 'node:crypto';

// Seed a pre-existing manual entry so legacy inspections stay covered after
// manual creation is disabled in the application.
export async function seedExistingMetalwork(mf,workerName,siteId,fields){
 const storage=await mf.unsafeGetDurableObjectStorage(workerName,'InventoryStore',{name:siteId});
 const rows=await storage.exec('SELECT value FROM documents WHERE key=? ORDER BY part','qa-checks');
 const records=rows.length?JSON.parse(rows.map(row=>row.value).join('')):[];
 const item={id:randomUUID(),kind:'metalwork',sheetNumber:'',createdBy:'legacy-worker',createdAt:'2026-11-19T01:00:00Z',status:'awaiting',latest:null,history:[],...fields};
 records.push(item);
 const raw=JSON.stringify(records);
 await storage.exec('DELETE FROM documents WHERE key=?','qa-checks');
 for(let index=0;index<raw.length;index+=100000)await storage.exec('INSERT INTO documents(key,part,value) VALUES(?,?,?)','qa-checks',index/100000,raw.slice(index,index+100000));
 return item;
}
