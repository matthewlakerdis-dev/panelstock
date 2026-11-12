let talkTeamDefaults={username:'',usernames:[],revision:0,loaded:false,error:''},talkTeamDefaultPending=null,talkTeamSettingsLoading=false;
function resetTalkTeamDefaults(){talkTeamSettingsLoading=false;talkTeamDefaults={username:'',usernames:[],revision:0,loaded:false,error:''};talkTeamDefaultPending=null}
async function requestTalkTeamDefaults(body){
 const controller=typeof AbortController==='function'?new AbortController():null;let timer;
 try{return await Promise.race([api('/toolbox/attendee-defaults',body,{signal:controller?.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(Error('Default team request timed out. Retry to confirm the save.'));},20000)})]);}
 finally{clearTimeout(timer)}
}
function acceptTalkTeamDefaults(defaults,username){
 if(!defaults||!Array.isArray(defaults.usernames)||!Number.isSafeInteger(defaults.revision))throw Error('The default team could not be loaded. Try again.');
 if(talkTeamDefaults.username!==username||!talkTeamDefaults.loaded||defaults.revision>=talkTeamDefaults.revision)talkTeamDefaults={...defaults,username,loaded:true,error:''};
}
async function loadTalkTeamDefaults(){
 if(!actor?.canRunToolbox)return false;
 const username=actor.username,generation=draftSyncGeneration;
 try{const {defaults}=await requestTalkTeamDefaults();if(actor?.username!==username||draftSyncGeneration!==generation)return false;acceptTalkTeamDefaults(defaults,username);return true;}
 catch(error){if(actor?.username===username&&draftSyncGeneration===generation)talkTeamDefaults.error=error.message;return false;}
}
function hasTalkDefaultTeam(){return talkTeamDefaults.loaded&&talkTeamDefaults.username===actor?.username&&talkTeamDefaults.revision>0}
function talkAttendeeUsers(){
 if(!actor?.canRunToolbox||!hasTalkDefaultTeam())return [];
 const selected=new Set(talkTeamDefaults.usernames);
 return [...new Map(attendeeUsers.filter(u=>selected.has(u.username)).map(u=>[u.username,u])).values()];
}
function defaultTalkAttendees(){
 if(!hasTalkDefaultTeam())return [];
 const users=new Map(attendeeUsers.map(u=>[u.username,u]));
 return [...new Set(talkTeamDefaults.usernames)].flatMap(username=>{const user=users.get(username);return user?[{name:user.displayName||username,userUsername:username,ack:false,signature:null}]:[]});
}
function talkDefaultTeamSettingsHTML(){
 if(!actor?.canRunToolbox)return '';
 const people=defaultTalkAttendees();
 return `<div class="card"><h3>Default team</h3><p>Choose the people available in your daily and weekly attendee dropdowns. New talks preselect this team. This team is saved to your account across devices.</p>${talkTeamSettingsLoading?'<p class="muted" role="status">Loading your default team…</p>':talkTeamDefaults.error?`<p class="notice" role="alert">${esc(talkTeamDefaults.error)}</p>`:people.length?`<p class="muted">${people.length} team members selected</p><div class="row">${people.map(p=>`<span class="tag">${esc(p.name)}</span>`).join('')}</div>`:'<p class="muted">No default attendees selected.</p>'}<p class="muted">Use Add attendee in a talk to include someone from this team. To make another person available, add them here first.</p><button id="choose-default-team" class="primary" onclick="openTalkDefaultTeam()" ${talkTeamSettingsLoading||!talkTeamDefaults.loaded?'disabled':''}>Choose default team</button></div>`;
}
function renderTalkDefaultTeamSettings(){if(page==='settings'&&actor?.canRunToolbox){const el=document.getElementById('talk-default-team-settings');if(el)el.innerHTML=talkDefaultTeamSettingsHTML();}}
async function saveTalkDefaultTeam(usernames){
 const username=actor?.username,generation=draftSyncGeneration,same=()=>actor?.username===username&&draftSyncGeneration===generation;
 if(!username||!actor.canRunToolbox)return false;
 const selected=[...new Set(usernames)],fingerprint=JSON.stringify(selected);
 if(!talkTeamDefaults.loaded&&(!await loadTalkTeamDefaults()||!same()))throw Error(talkTeamDefaults.error||'Sign in again before saving your default team.');
 for(;;){
  if(!same())return false;
  if(!talkTeamDefaultPending)talkTeamDefaultPending={username,fingerprint,body:{usernames:selected,expectedRevision:talkTeamDefaults.revision,mutationId:crypto.randomUUID()}};
  const packet=talkTeamDefaultPending;
  try{
   const {defaults}=await requestTalkTeamDefaults(packet.body);if(!same())return false;
   acceptTalkTeamDefaults(defaults,username);talkTeamDefaultPending=null;
   if(packet.fingerprint!==fingerprint)continue;
   return true;
  }catch(error){
   if(same()&&[400,403,409].includes(error.status)){talkTeamDefaultPending=null;if(error.status===409)await loadTalkTeamDefaults();}
   throw error;
  }
 }
}
