// Account drafts use the existing revision-checked, idempotent record API.
let accountDrafts=null,draftSyncTimer=null,draftSyncRun=null,draftSyncGeneration=0,draftSyncMessage='',draftSyncLoading=false;
function resetDraftSync(){clearTimeout(draftSyncTimer);draftSyncGeneration++;draftSyncRun=null;accountDrafts=null;draftSyncMessage='';draftSyncLoading=false;}
function draftFingerprint(d){return JSON.stringify({content:toolboxContent(d),signatures:[...d.people.map(p=>p.signature),d.supervisorSignature]});}
function draftDirty(d=state.draft){return !!d&&d.status==='Draft'&&(!d.accountSync||d.accountSync.fingerprint!==draftFingerprint(d));}
function cacheDraft(){try{localStorage.setItem(key,JSON.stringify({templates:state.templates,draft:state.draft,records:[]}));storageOK=true;return true}catch{storageOK=false;return false}}
function markDraftSynced(d){d.accountSync={fingerprint:draftFingerprint(d)};delete d.pendingSave;}
function draftSyncText(){const d=state.draft;if(d?.accountSync?.blocked)return 'Sync paused: this draft changed or was removed on another device. Your device copy is retained.';if(draftSyncLoading)return 'Syncing draft to your account…';if(draftSyncMessage)return draftSyncMessage;if(d?.revision&&!draftDirty())return 'Draft synced to your account.';return hasDeviceDraft()?'Changes saved on this device. Waiting to sync…':'Draft changes will save automatically to your account.';}
function draftSyncHTML(){return `<div class="notice" id="draft-sync"><p id="draft-sync-status" role="status" aria-live="polite">${esc(draftSyncText())}</p><div id="draft-sync-controls" class="row">${draftSyncControls()}</div></div>`;}
function draftSyncControls(){return state.draft?.accountSync?.blocked?'<button onclick="reloadAccountDraft()">Open account version</button><button onclick="copyDeviceDraft()">Keep device copy as new draft</button><button onclick="downloadDraft()">Back up device copy</button>':draftSyncMessage?'<button onclick="retryDraftSync()">Retry sync</button>':'';}
function updateDraftSync(){const status=document.getElementById('draft-sync-status'),controls=document.getElementById('draft-sync-controls');if(status)status.textContent=draftSyncText();if(controls)controls.innerHTML=draftSyncControls();}
function scheduleDraftSync(){clearTimeout(draftSyncTimer);if(!actor?.canRunToolbox||!hasDeviceDraft()||state.draft?.accountSync?.blocked||state.draft?.pendingSave||(!draftDirty()&&!state.draft.accountSync?.pending))return;draftSyncMessage='';updateDraftSync();draftSyncTimer=setTimeout(()=>{void syncAccountDraft();},900);}
function draftPacket(d){
 const record=structuredClone(d);delete record.accountSync;delete record.pendingSave;delete record.accountEdited;record.status='Draft';
 return {record,expectedRevision:d.revision||0,mutationId:crypto.randomUUID()};
}
async function syncAccountDraft(allowBusy=false){
 clearTimeout(draftSyncTimer);
 if(draftSyncRun){const saved=await draftSyncRun;if(!saved)return false;if(actor?.canRunToolbox&&draftDirty()&&!state.draft.accountSync?.blocked)return syncAccountDraft(allowBusy);return !state.draft?.accountSync?.blocked&&!draftDirty();}
 if(!actor?.canRunToolbox||(!allowBusy&&busy))return false;
 const d=state.draft;if(!d||d.status!=='Draft'||!hasDeviceDraft())return true;
 if(d.accountSync?.blocked)return false;
 // An unconfirmed completion belongs to the explicit completion retry, never autosave.
 if(d.pendingSave)return false;
 if(!draftDirty(d)&&!d.accountSync?.pending)return true;
 const generation=draftSyncGeneration,username=actor.username,cacheKey=key;
 const current=()=>generation===draftSyncGeneration&&actor?.username===username&&key===cacheKey&&state.draft===d;
 draftSyncRun=(async()=>{
  draftSyncLoading=true;draftSyncMessage='';updateDraftSync();
  try{
   // Retry the exact original packet first if a previous response was lost.
   const sync=d.accountSync??={},packet=sync.pending||draftPacket(d),fingerprint=draftFingerprint(packet.record);
   sync.pending=packet;cacheDraft();
   const data=await api('/toolbox/records/'+d.id,packet);
   if(!current())return false;
   if(!data.record)throw Error('No draft save was confirmed.');
   if(data.record.status!=='Draft')throw Object.assign(Error('This talk has already been completed.'),{status:409});
   d.revision=data.record.revision;d.createdBy=data.record.createdBy;d.updatedAt=data.record.updatedAt;
   d.accountSync={fingerprint};cacheDraft();
   if(accountDrafts){const exists=accountDrafts.drafts.some(r=>r.id===d.id),row={...data.record,people:data.record.people.map(p=>({name:p.name}))};accountDrafts.drafts=[row,...accountDrafts.drafts.filter(r=>r.id!==d.id)];if(!exists)accountDrafts.total++;}
   return true;
  }catch(e){if(current()){draftSyncMessage='Draft not synced: '+e.message+' Your device copy is retained.';if(e.status===409){d.accountSync??={};d.accountSync.blocked=true;delete d.accountSync.pending;}else if([400,403,413].includes(e.status))delete d.accountSync.pending;cacheDraft();}return false;}
  finally{if(current()){draftSyncLoading=false;updateDraftSync();}}
 })();
 const run=draftSyncRun,result=await run;
 if(generation===draftSyncGeneration&&draftSyncRun===run){draftSyncRun=null;if(result&&current()&&draftDirty(d))return syncAccountDraft(allowBusy);}
 return result;
}
async function reconcileAccountDraft(){
 if(!actor?.canRunToolbox)return;
 const generation=draftSyncGeneration,username=actor.username,d=state.draft;
 try{
  const data=await api('/toolbox/drafts');if(generation!==draftSyncGeneration||actor?.username!==username||state.draft!==d)return;
  accountDrafts=data;
  if(!hasDeviceDraft()){if(data.latest){state.draft=data.latest;markDraftSynced(state.draft);}draftSyncMessage='';cacheDraft();return;}
  // A lost response must be retried before comparing revisions.
  if(d.pendingSave){try{const legacy=JSON.parse(d.pendingSave.fingerprint);if(legacy.record?.id===d.id&&legacy.record.status==='Draft'){d.accountSync={pending:{record:legacy.record,expectedRevision:legacy.expectedRevision,mutationId:d.pendingSave.mutationId}};delete d.pendingSave;}}catch{}}
  if(d.accountSync?.pending||d.pendingSave){scheduleDraftSync();return;}
  if(!d.revision){scheduleDraftSync();return;}
  let remote;
  try{remote=(await api('/toolbox/records/'+d.id)).record;}catch(e){if(e.status!==404)throw e;remote=null;}
  if(generation!==draftSyncGeneration||actor?.username!==username||state.draft!==d)return;
  if(!remote||remote.status!=='Draft'){
   if(!draftDirty(d)){state.draft=data.latest||fresh(d.type);if(data.latest)markDraftSynced(state.draft);draftSyncMessage='';}
   else{d.accountSync??={};d.accountSync.blocked=true;}
  }else if(remote.revision!==d.revision){
   // Legacy device caches have no sync marker; compare their signed content first.
   if(!draftDirty(d)||(!d.accountSync&&draftFingerprint(d)===draftFingerprint(remote))){state.draft=remote;markDraftSynced(state.draft);draftSyncMessage='';}
   else{d.accountSync??={};d.accountSync.blocked=true;}
  }else if(!d.accountSync&&draftFingerprint(d)===draftFingerprint(remote)){markDraftSynced(d);}
  cacheDraft();scheduleDraftSync();updateDraftSync();
 }catch(e){if(generation===draftSyncGeneration&&actor?.username===username){draftSyncMessage='Unable to check account drafts: '+e.message+' Your device copy is retained.';updateDraftSync();}}
}
async function retryDraftSync(){if(busy)return;await reconcileAccountDraft();await syncAccountDraft();updateDraftSync();}
async function reloadAccountDraft(){
 if(busy||!state.draft?.accountSync?.blocked)return;
 if(!confirm('Open the account version and replace the device copy? Back up the device copy first if you need it.'))return;
 const generation=draftSyncGeneration,d=state.draft;
 try{const data=await api('/toolbox/records/'+d.id);if(generation!==draftSyncGeneration||state.draft!==d)return;if(data.record.status!=='Draft')return notify('This talk is completed. Back up your device copy or keep it as a new draft.');state.draft=data.record;markDraftSynced(state.draft);draftSyncMessage='';cacheDraft();view('talk');}
 catch(e){notify(e.status===404?'This draft was deleted. Back up your device copy or keep it as a new draft.':e.message);}
}
async function copyDeviceDraft(){
 if(busy||!state.draft?.accountSync?.blocked)return;
 const d=structuredClone(state.draft);d.id=crypto.randomUUID();delete d.revision;delete d.createdBy;delete d.updatedAt;delete d.accountSync;delete d.pendingSave;
 d.supervisorSignature=null;d.people.forEach(p=>{p.signature=null;p.ack=false;});state.draft=d;draftSyncMessage='';persist();view('talk');await syncAccountDraft();notify('Device copy kept as a new draft. Collect fresh signatures before completing.');
}
async function moreAccountDrafts(){if(!accountDrafts?.nextOffset)return;const generation=draftSyncGeneration,username=actor?.username;try{const data=await api('/toolbox/drafts',{offset:accountDrafts.nextOffset});if(generation!==draftSyncGeneration||actor?.username!==username)return;accountDrafts={...data,drafts:[...accountDrafts.drafts,...data.drafts]};if(page==='home')view('home');}catch(e){notify(e.message);}}
function accountDraftsHTML(){if(!accountDrafts)return '';const rows=accountDrafts.drafts.filter(r=>r.id!==state.draft?.id);return `<div class="card"><h3>Your account drafts · ${accountDrafts.total}</h3><p class="muted">Daily pre-starts and weekly talks saved to your account. Resume them on any device.</p>${rows.length?recordRows(rows,false):'<p class="empty">Your current draft appears above. No other account drafts.</p>'}${accountDrafts.nextOffset!==null?'<button onclick="moreAccountDrafts()">Load more drafts</button>':''}</div>`;}
async function resumeDraftSync(){if(!actor?.canRunToolbox||busy||draftSyncRun||document.visibilityState==='hidden')return;const prior=state.draft,id=prior?.id;await reconcileAccountDraft();if(id===state.draft?.id){await syncAccountDraft();}if(page==='home')view('home');else if(page==='talk'&&prior!==state.draft)view('talk');else updateDraftSync();}
window.addEventListener?.('online',()=>{void resumeDraftSync();});
window.addEventListener?.('focus',()=>{void resumeDraftSync();});
document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')void resumeDraftSync();});
globalThis.setInterval?.(()=>{void resumeDraftSync();},30000);
