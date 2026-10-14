// Pull down at the top of a Safety screen to refresh its data.
const PULL_REFRESH_DISTANCE=88;
let pullGesture=null,pullRefreshRunning=false;
function pullRefreshIdle(){return !!actor&&!busy&&!pullRefreshRunning&&!activeLoadingTasks.size&&!document.querySelector('dialog[open]')}
function pullRefreshTop(){return (document.scrollingElement?.scrollTop??window.scrollY??0)<=3&&(window.visualViewport?.scale??1)<=1.05}
function pullRefreshTarget(target){if(!target||target.closest?.('input,textarea,select,button,a,canvas,dialog,details[open],[contenteditable="true"],[contenteditable=""]'))return false;for(let el=target;el&&el!==document.body&&el!==document.documentElement;el=el.parentElement){if(el.scrollHeight>el.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(el).overflowY))return false}return true}
function paintPullRefresh(distance=0,running=false){const el=document.getElementById('pull-refresh'),label=document.getElementById('pull-refresh-label'),icon=document.getElementById('pull-refresh-icon');el.hidden=!distance&&!running;el.classList.toggle('running',running);const text=running?'Refreshing…':distance>=PULL_REFRESH_DISTANCE?'Release to refresh':'Pull down to refresh';if(label.textContent!==text)label.textContent=text;el.style.opacity=running?'1':String(Math.min(1,distance/PULL_REFRESH_DISTANCE));el.style.transform='translate(-50%,'+(running?0:Math.min(20,-40+distance*.45))+'px)';icon.style.transform=running?'':'rotate('+Math.min(300,distance*2)+'deg)'}
function cancelPullRefresh(){pullGesture=null;if(!pullRefreshRunning)paintPullRefresh()}
function startPullRefresh(e){cancelPullRefresh();if(e.touches.length!==1||!pullRefreshIdle()||!pullRefreshTop()||!pullRefreshTarget(e.target))return;const t=e.touches[0];pullGesture={id:t.identifier,x:t.clientX,y:t.clientY,distance:0,locked:false}}
function movePullRefresh(e){const g=pullGesture;if(!g)return;if(e.touches.length!==1||!pullRefreshIdle()||!pullRefreshTop()){cancelPullRefresh();return}const t=e.touches[0];if(t.identifier!==g.id){cancelPullRefresh();return}const dx=t.clientX-g.x,dy=t.clientY-g.y;if(!g.locked){if(Math.abs(dx)>12&&Math.abs(dx)>=Math.abs(dy)||dy<-8){cancelPullRefresh();return}if(dy<12)return;if(Math.abs(dy)<Math.abs(dx)*1.5){cancelPullRefresh();return}g.locked=true}if(!e.cancelable){cancelPullRefresh();return}e.preventDefault();g.distance=Math.max(0,dy);paintPullRefresh(g.distance)}
function endPullRefresh(e){const g=pullGesture;if(!g)return;if(e.changedTouches&&!Array.from(e.changedTouches).some(t=>t.identifier===g.id))return;const trigger=g.locked&&g.distance>=PULL_REFRESH_DISTANCE;cancelPullRefresh();if(trigger&&pullRefreshIdle())void refreshSafetyScreen()}
function pullRefreshFormReason(){
 if(page==='admin'||page==='settings'||page==='profiles'&&profileEditing||page==='library'&&safetyUpload||page==='credentials'&&credentialUploading||page==='equipment'&&(equipmentDraft||equipmentEditing||equipmentFault&&equipmentManager())||page==='talk'&&adminDraftEditing?.talkId===state.draft.id)return 'Save or leave this form before refreshing.';
 if(page==='library'&&safetyAssignmentsDraft&&safetyDetail&&safetyAssignmentsDraft.versionId===safetyDetail.version.id){const a=[...safetyAssignmentsDraft.usernames].sort(),b=[...(safetyDetail.version.requiredSigners||[])].sort();if(JSON.stringify(a)!==JSON.stringify(b))return 'Save the required signers before refreshing.'}
 return '';
}
async function refreshSafetyScreen(){
 if(!pullRefreshIdle())return false;const reason=pullRefreshFormReason();if(reason){notify(reason);return false}
 pullRefreshRunning=true;paintPullRefresh(PULL_REFRESH_DISTANCE,true);const finish=beginLoading('Refreshing page…'),shell=document.querySelector('.shell'),wasInert=shell.inert;const username=actor.username; shell.inert=true;
 try{
  if(page==='safety-home')await refreshSafetyHome();
  else if(page==='home')await refreshHome();
  else if(page==='records')await refreshRecords();
  else if(page==='library'){if(safetyDetail)await openSafetyDocument(safetyDetail.document.id,safetyDetail.version.id);else{const query=document.getElementById('safety-search')?.value,changed=typeof query==='string'&&query!==safetySearch;if(typeof query==='string')safetySearch=query;await loadSafety(safetyType,changed?0:safetyData?.offset||0)}}
  else if(page==='credentials')await openCredentials();
  else if(page==='compliance')await openCompliance();
  else if(page==='admin-drafts')await openAdminDrafts(adminDraftsType);
  else if(page==='profiles')await openSafetyProfiles();
  else if(page==='equipment'){if(equipmentRecord)await viewEquipmentInspection(equipmentRecord.id);else if(equipmentFault)await openEquipmentFault(equipmentFault.fault.id);else if(equipmentDetail)await openEquipmentAsset(equipmentDetail.equipment.id);else{const query=document.getElementById('equipment-search')?.value;if(typeof query==='string')equipmentSearch=query;await openEquipment()}}
  else if(page==='talk'){
   if(!cacheDraft()||!await syncAccountDraft())return notify('Sync or back up this draft before refreshing.');
   await reconcileAccountDraft();if(actor?.username!==username)return false;
   const directory=await api('/toolbox/users');if(actor?.username!==username)return false;attendeeUsers=directory.users||[];view('talk',true);
  }
  return true;
 }catch(e){notify(e.message);return false}finally{shell.inert=wasInert;pullRefreshRunning=false;finish();paintPullRefresh()}
}
document.addEventListener('touchstart',startPullRefresh,{passive:true});
document.addEventListener('touchmove',movePullRefresh,{passive:false});
document.addEventListener('touchend',endPullRefresh,{passive:true});
document.addEventListener('touchcancel',cancelPullRefresh,{passive:true});
