import {requireCondition as check,digest} from './security.js';

const INDEX='villa-scopes:index',JOURNAL='villa-scopes:mutations';
const entryKey=id=>'villa-scopes:entry:'+id;
const own=v=>v&&typeof v==='object'&&!Array.isArray(v);
const idOK=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v)&&!['.','..','__proto__','constructor','prototype'].includes(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const ok=body=>({status:200,body:{ok:true,...body}});
export const VILLA_SCOPE_LIMITS={entries:5000,totalBytes:4*1024*1024,entryBytes:32768,poReferences:100};
export function villaScopeAccess(actor){return {canView:!!actor&&(actor.isAdmin||actor.tasks?.['site.scopes.view']===true||actor.tasks?.['site.scopes.manage']===true),canManage:!!actor&&!actor.villaScopesReadOnly&&(actor.isAdmin||actor.tasks?.['site.scopes.manage']===true)};}
function text(v,max,required=false){check(typeof v==='string'&&v.length<=max,'Invalid or overlong villa register text');const value=v.trim();check(!required||value,'Complete Stage, Villa, Scope, Description and Colour');return value;}
function documentURL(v){v=text(v??'',2048);if(!v)return '';let url;try{url=new URL(v)}catch{}check(url&&url.protocol==='https:'&&!url.username&&!url.password,'Document links must be HTTPS URLs without embedded credentials');return url.href;}
export function normalizeVillaScope(input){
 check(own(input)&&idOK(input.ScopeEntryID),'A stable ScopeEntryID is required');
 const r={ScopeEntryID:input.ScopeEntryID};
 for(const [field,max] of Object.entries({Stage:30,Villa:60,ScopeType:250,ScopeDescription:5000,Colour:100}))r[field]=text(input[field],max,true);
 r.VillaPDFURL=documentURL(input.VillaPDFURL);r.ScopePDFURL=documentURL(input.ScopePDFURL);
 check(Array.isArray(input.pos)&&input.pos.length<=VILLA_SCOPE_LIMITS.poReferences,'A scope supports up to 100 PO associations');
 r.pos=[];const seen=new Map();
 for(const p of input.pos){check(own(p)&&['Nexvia','Palm Lakes','Knotwood'].includes(p.POSystem),'Select Nexvia, Palm Lakes or Knotwood');const item={POSystem:p.POSystem,PONumber:text(p.PONumber,150,true),DocumentURL:documentURL(p.DocumentURL)},key=JSON.stringify([item.POSystem,item.PONumber]);if(seen.has(key)){const old=seen.get(key);check(!old.DocumentURL||!item.DocumentURL||old.DocumentURL===item.DocumentURL,'Conflicting links for the same PO');if(item.DocumentURL)old.DocumentURL=item.DocumentURL;}else{seen.set(key,item);r.pos.push(item);}}
 check(bytes(r)<=VILLA_SCOPE_LIMITS.entryBytes,'Scope entry exceeds 32 KB',413);return r;
}
function index(store){return store.read(INDEX,{revision:0,entries:{}});}
function publicEntry(saved){return {...saved.record,_revision:saved.revision,_updatedAt:saved.updatedAt,_updatedBy:saved.updatedBy};}
export function villaScopeList(store,actor){
 check(villaScopeAccess(actor).canView,'Villa scope report access required',403);
 const current=index(store),records=[];
 for(const id of Object.keys(current.entries)){const saved=store.read(entryKey(id));if(saved&&!saved.deleted)records.push(publicEntry(saved));}
 return {records,revision:current.revision,username:actor.username,...villaScopeAccess(actor)};
}
function capacity(current){const entries=Object.values(current.entries);check(entries.length<=VILLA_SCOPE_LIMITS.entries,'The register supports up to 5,000 scope entries',413);check(entries.reduce((n,v)=>n+v,0)<=VILLA_SCOPE_LIMITS.totalBytes,'The register exceeds the 4 MB data limit. Export a backup and reduce its size.',413);}
async function mutate(store,actor,body,operation,work){
 check(villaScopeAccess(actor).canManage,'Manage villa scopes access required',403);
 check(uuid(body.mutationId),'A mutation ID is required');store.consumeLimit('villa-write:'+actor.username,60);
 const fingerprint=await digest(JSON.stringify(operation)),key=actor.username+':'+body.mutationId;
 return store.ctx.storage.transactionSync(()=>{
  const journal=store.read(JOURNAL,[]),previous=journal.find(v=>v.key===key);
  if(previous){check(previous.fingerprint===fingerprint,'This request ID was used for different changes',409);return ok({...previous.result,duplicate:true});}
  const result=work();
  const remembered=result.entry?{...result,entry:{ScopeEntryID:result.entry.ScopeEntryID,_revision:result.entry._revision}}:result;
  store.write(JOURNAL,[...journal,{key,fingerprint,result:remembered}].slice(-500));
  return ok(result);
 });
}
export async function handleVillaScopes(store,path,method,body,actor){
 check(villaScopeAccess(actor).canView,'Villa scope report access required',403);
 if(path==='/villa-scopes/records'){check(method==='GET','Method not allowed',405);return ok(villaScopeList(store,actor));}
 if(path==='/villa-scopes/import'){
  check(method==='POST','Method not allowed',405);check(villaScopeAccess(actor).canManage,'Manage villa scopes access required',403);
  check(Array.isArray(body.records)&&body.records.length>0&&body.records.length<=VILLA_SCOPE_LIMITS.entries,'Select between 1 and 5,000 scope entries');
  const records=body.records.map(normalizeVillaScope),ids=new Set(records.map(r=>r.ScopeEntryID));check(ids.size===records.length,'Duplicate ScopeEntryID in the import');
  check(bytes(records)<=VILLA_SCOPE_LIMITS.totalBytes,'Import exceeds 4 MB',413);
  return mutate(store,actor,body,{kind:'import',records,expectedRevision:body.expectedRevision},()=>{
   const current=index(store);check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision===current.revision,'The register changed. Reload, review the import and retry.',409);
   const changed=[],now=new Date().toISOString();let added=0,updated=0;
   for(const record of records){const existing=store.read(entryKey(record.ScopeEntryID));check(!existing?.deleted,'An imported ScopeEntryID was previously deleted. Review it before assigning a new ID.',409);if(existing&&JSON.stringify(existing.record)===JSON.stringify(record))continue;const revision=(existing?.revision||0)+1;changed.push([record.ScopeEntryID,{record,revision,updatedAt:now,updatedBy:actor.username}]);current.entries[record.ScopeEntryID]=bytes(record);if(existing)updated++;else added++;}
   capacity(current);
   if(changed.length){for(const [id,value] of changed)store.write(entryKey(id),value);current.revision++;store.write(INDEX,current);store.audit(actor.username,'villa-scopes-import',{added,updated,revision:current.revision});}
   return {added,updated,unchanged:records.length-changed.length,revision:current.revision};
  });
 }
 const match=path.match(/^\/villa-scopes\/records\/([^/]+)(\/delete)?$/);check(match,'Not found',404);
 check(method==='POST','Method not allowed',405);let id;try{id=decodeURIComponent(match[1])}catch{}check(idOK(id),'Invalid ScopeEntryID');const deleting=!!match[2];
 check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0,'A reviewed entry revision is required');
 const record=deleting?null:normalizeVillaScope(body.record);check(!record||record.ScopeEntryID===id,'ScopeEntryID does not match the requested entry');
 return mutate(store,actor,body,{kind:deleting?'delete':'save',id,record,expectedRevision:body.expectedRevision},()=>{
  const existing=store.read(entryKey(id)),current=index(store),revision=existing?.revision||0;
  check(body.expectedRevision===revision,'This scope entry changed. Reload and review before saving.',409);
  check(!existing?.deleted,'This scope entry was deleted. Reload the register.',409);
  if(deleting)check(existing,'Scope entry not found',404);
  const saved={revision:revision+1,updatedAt:new Date().toISOString(),updatedBy:actor.username,...(deleting?{deleted:true}:{record})};
  if(deleting)delete current.entries[id];else current.entries[id]=bytes(record);capacity(current);
  store.write(entryKey(id),saved);current.revision++;store.write(INDEX,current);
  store.audit(actor.username,deleting?'villa-scope-deleted':'villa-scope-saved',{id,revision:saved.revision});
  return {revision:current.revision,...(deleting?{deleted:true}:{entry:publicEntry(saved)})};
 });
}

export function villaScopeBackup(store){if(!store.read(INDEX))return null;const current=index(store);return {format:'lennox-villa-scope-dashboard',version:1,datasetName:'Villa scope register',sourceName:'PanelStockHQ',importedAt:new Date().toISOString(),isDemo:false,records:Object.keys(current.entries).map(id=>store.read(entryKey(id))).filter(v=>v&&!v.deleted).map(v=>v.record),links:[]};}
