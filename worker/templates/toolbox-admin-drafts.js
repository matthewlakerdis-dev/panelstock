let adminDraftsData=null,adminDraftsType='',adminDraftsError='',adminDraftsGeneration=0,adminDraftEditing=null,adminDraftSavePacket=null,adminDraftDeletePacket=null;
function resetAdminDrafts(){adminDraftsData=null;adminDraftsType='';adminDraftsError='';adminDraftEditing=null;adminDraftSavePacket=null;adminDraftDeletePacket=null;adminDraftsGeneration++;}
function adminDraftsHTML(){const rows=(adminDraftsData?.drafts||[]).filter(d=>!adminDraftsType||d.type===adminDraftsType);return `<div class="row between"><div><h2>Admin drafts</h2><p class="muted">Start from an admin-prepared daily pre-start or weekly talk. Your copy saves to your own account.</p></div><button onclick="openAdminDrafts(adminDraftsType)">Refresh drafts</button></div><div class="card"><label for="admin-draft-type">Talk type</label><select id="admin-draft-type" onchange="adminDraftsType=this.value;view('admin-drafts')"><option value="">Daily &amp; weekly</option><option value="daily" ${adminDraftsType==='daily'?'selected':''}>Daily pre-start</option><option value="weekly" ${adminDraftsType==='weekly'?'selected':''}>Weekly toolbox talk</option></select>${adminDraftsData?rows.map(d=>`<div class="person"><h3>${esc(d.title)}</h3><p class="muted">${d.type==='daily'?'Daily pre-start':'Weekly toolbox talk'} · ${esc(d.site)||'All workshops'} · Updated ${esc(stamp(d.updatedAt))}</p><div class="row"><button class="primary" onclick="useAdminDraft('${esc(d.id)}')">Use admin draft</button>${actor.isAdmin?`<button onclick="useAdminDraft('${esc(d.id)}',true)">Edit admin draft</button><button class="danger" onclick="deleteAdminDraft('${esc(d.id)}',${d.revision})">Delete admin draft</button>`:''}</div></div>`).join('')||'<p class="empty">No admin drafts for this talk type yet.</p>':adminDraftsError?`<p class="notice">${esc(adminDraftsError)}</p>`:'<p class="muted" role="status">Loading admin drafts…</p>'}</div>${actor.isAdmin?'<div class="card"><h3>Prepare an admin draft</h3><p>Prepare a daily or weekly talk, then choose “Save as admin draft”. Attendance, signatures and daily inspection results are completed by the supervisor using the draft.</p><div class="row"><button onclick="newTalk(\'daily\')">Prepare daily draft</button><button onclick="newTalk(\'weekly\')">Prepare weekly draft</button></div></div>':''}`;}
async function openAdminDrafts(type=''){
 if(!actor?.canRunToolbox)return;adminDraftsType=type;adminDraftsData=null;adminDraftsError='';const generation=++adminDraftsGeneration,username=actor.username;view('admin-drafts');
 try{const data=await api('/toolbox/admin-drafts');if(generation!==adminDraftsGeneration||actor?.username!==username)return;adminDraftsData=data;if(page==='admin-drafts')view('admin-drafts');}catch(e){if(generation!==adminDraftsGeneration||actor?.username!==username)return;adminDraftsError=e.message;if(page==='admin-drafts')view('admin-drafts');}
}
async function useAdminDraft(id,edit=false){
 if(busy||!actor?.canRunToolbox||edit&&!actor.isAdmin)return;
 const generation=adminDraftsGeneration,username=actor.username;busy=true;document.querySelector('.shell').inert=true;
 try{if(hasDeviceDraft()&&!await syncAccountDraft(true))return notify('Sync or back up your current draft first.');const {draft}=await api('/toolbox/admin-drafts/'+id);if(generation!==adminDraftsGeneration||actor?.username!==username)return;
  const d={...fresh(draft.content.type),...structuredClone(draft.content)};d.people=[];d.supervisorSignature=null;d.status='Draft';d.accountEdited=true;
  adminDraftEditing=edit?{talkId:d.id,id:draft.id,title:draft.title,revision:draft.revision}:null;adminDraftSavePacket=null;state.draft=d;draftSyncMessage='';persist();view('talk');await syncAccountDraft(true);notify(edit?'Edit the content, then save the admin draft.':'Admin draft copied to your talk. Review the content and complete the current inspection and attendance.');
 }catch(e){notify(e.message);}finally{busy=false;document.querySelector('.shell').inert=false;}
}
function openAdminDraftSave(){
 if(busy||!actor?.isAdmin)return;const source=adminDraftEditing?.talkId===state.draft.id?adminDraftEditing:null;
 document.getElementById('admin-draft-title').value=source?.title||state.draft.focus||state.draft.site||'';document.getElementById('admin-draft-save-heading').textContent=source?'Update admin draft':'Save as admin draft';document.getElementById('admin-draft-save-error').textContent='';document.getElementById('admin-draft-save-dialog').showModal();
}
function adminDraftRecord(d){return {type:d.type,company:d.company,site:d.site,tasks:d.tasks,focus:d.focus,topics:structuredClone(d.topics),actions:d.actions.map(a=>({text:a.text,owner:a.owner,due:'',closed:false})),...(d.prestart?{prestart:{highRisk:d.prestart.highRisk,previousShift:d.prestart.previousShift,checklist:Array(13).fill('')}}:{})};}
async function saveAdminDraft(){
 if(busy||!actor?.isAdmin)return;const title=document.getElementById('admin-draft-title').value.trim();if(!title){document.getElementById('admin-draft-title').focus();document.getElementById('admin-draft-save-error').textContent='Enter a name for this draft.';return;}
 const talkId=state.draft.id,generation=adminDraftsGeneration,username=actor.username,record=adminDraftRecord(state.draft),fingerprint=JSON.stringify({title,record});
 if(adminDraftSavePacket?.talkId!==talkId)adminDraftSavePacket=null;
 busy=true;document.querySelector('.shell').inert=true;
 try{
  // Confirm an interrupted save before writing any newer edits, so retrying a
  // newly created admin draft cannot create a second shared draft.
  for(;;){
   const source=adminDraftEditing?.talkId===talkId?adminDraftEditing:null;
   if(!adminDraftSavePacket)adminDraftSavePacket={talkId,fingerprint,body:{id:source?.id||crypto.randomUUID(),title,record,expectedRevision:source?.revision||0,mutationId:crypto.randomUUID()}};
   const packet=adminDraftSavePacket,{draft}=await api('/toolbox/admin-drafts',packet.body);
   if(generation!==adminDraftsGeneration||actor?.username!==username||state.draft.id!==talkId)return;
   adminDraftEditing={talkId,id:draft.id,title:draft.title,revision:draft.revision};adminDraftSavePacket=null;adminDraftsData=null;
   if(packet.fingerprint!==fingerprint)continue;
   document.getElementById('admin-draft-save-dialog').close();view('talk');notify('Admin draft saved. Supervisors can use their own copy.');break;
  }
 }catch(e){if(generation===adminDraftsGeneration&&actor?.username===username)document.getElementById('admin-draft-save-error').textContent=e.message;}finally{busy=false;document.querySelector('.shell').inert=false;}
}

async function deleteAdminDraft(id,revision){
 if(busy||!actor?.isAdmin||!confirm('Delete this admin draft? Talks already started from it will be kept.'))return;
 const fingerprint=JSON.stringify({id,revision});if(adminDraftDeletePacket?.fingerprint!==fingerprint)adminDraftDeletePacket={fingerprint,body:{expectedRevision:revision,mutationId:crypto.randomUUID()}};
 busy=true;try{await api('/toolbox/admin-drafts/'+id+'/delete',adminDraftDeletePacket.body);adminDraftDeletePacket=null;if(adminDraftEditing?.id===id)adminDraftEditing=null;await openAdminDrafts(adminDraftsType);notify('Admin draft deleted.');}catch(e){notify(e.message);}finally{busy=false;}
}
