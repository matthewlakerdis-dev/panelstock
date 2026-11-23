// Fixed operation codes only: no request paths, credentials, identifiers or data.
// 1 stock, 2 purchase orders, 3 QA, 4 schedule, 5 backups, 6 staff,
// 7 organisation chart, 8 core data, 9 dispatch.
export function operationCode(path){
 if(typeof path!=='string')return 0;
 if(path==='/workshop-stock')return 1;
 if(path.startsWith('/purchase-orders'))return 2;
 if(path==='/qa'||path.startsWith('/qa/'))return 3;
 if(path==='/schedule'||path.startsWith('/schedule/'))return 4;
 if(path==='/admin/backups'||path==='/admin/backup-now'||path==='/admin/restore-backup')return 5;
 if(path==='/admin/users'||path.startsWith('/employee-profile'))return 6;
 if(path.startsWith('/org-chart'))return 7;
 if(path==='/data')return 8;
 if(path.startsWith('/dispatch/'))return 9;
 return 0;
}
// Phases: 0 started, 1 handler returned, 2 stream started, 3 stream closed,
// 4 cancelled, 5 stream failed, 6 handler threw. Observations are not attribution.
export function traceOperation(store,path,method,{logger=console,now=Date.now}={}){
 const operation=operationCode(path);
 if(store.env?.RELIABILITY_DIAGNOSTICS!=='true'||!operation)return null;
 const state=store._operationDiagnostics??={instanceMs:now(),ordinal:0};
 const ordinal=++state.ordinal,write=method==='GET'||method==='HEAD'?0:1;
 const mark=(phase,status=0)=>{
  if(!Number.isInteger(phase)||phase<0||phase>6)return;
  const timeMs=now();if(!Number.isSafeInteger(timeMs)||!Number.isSafeInteger(state.instanceMs)||!Number.isSafeInteger(ordinal))return;
  const event={event:'inventory_operation',instanceMs:state.instanceMs,ordinal,operation,write,phase,status:Number.isInteger(status)&&status>=100&&status<=599?status:0,timeMs};
  try{if(typeof logger==='function')logger(event);else logger?.log(event);}catch{}
 };
 mark(0);return {mark};
}
