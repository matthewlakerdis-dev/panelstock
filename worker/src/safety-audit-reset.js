// One-time, user-requested production reset. Original records, PDFs and evidence stay intact.
export const MONTHLY_AUDIT_RESET_ID='2026-10-19-monthly-audit-restart-01';
export function applyMonthlyAuditReset(store,env){
 if(env.SITE_ID!=='panelstock'||env.MONTHLY_AUDIT_RESET_ID!==MONTHLY_AUDIT_RESET_ID||env.READ_ONLY==='true'||!store.read('initialized',false))return null;
 const target=env.INVENTORY?.idFromName('panelstock');if(!target||String(target)!==String(store.ctx.id))return null;
 const marker='safety:audit-reset:'+MONTHLY_AUDIT_RESET_ID;
 return store.ctx.storage.transactionSync(()=>{
  const previous=store.read(marker);if(previous)return previous;
  const records=store.read('safety:walks',[]),numbering=store.read('safety:audit-numbering',{prefix:'LF-MA-',next:1,width:4,revision:0}),at=new Date().toISOString(),active=records.filter(r=>!r.archivedAt);
  store.write('safety:audit-reset-backup:'+MONTHLY_AUDIT_RESET_ID,{at,records,numbering});
  for(const row of active)store.write('safety:walk-archived:'+row.id,{at,resetId:MONTHLY_AUDIT_RESET_ID});
  store.write('safety:walks',records.map(r=>r.archivedAt?r:{...r,archivedAt:at,resetId:MONTHLY_AUDIT_RESET_ID}));
  store.write('safety:audit-numbering',{prefix:'LF-MA-',next:1,width:4,revision:numbering.revision+1,series:MONTHLY_AUDIT_RESET_ID});
  const receipt={id:MONTHLY_AUDIT_RESET_ID,at,archivedCount:active.length,nextDocumentNumber:'LF-MA-0001',correctiveActions:'retained'};
  store.write(marker,receipt);store.audit('system','safety-monthly-audits-archived-and-renumbered',receipt);return receipt;
 });
}
