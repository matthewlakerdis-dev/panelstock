let talkTeamDefaults={username:'',usernames:[],revision:0,loaded:false,error:''},talkTeamDefaultPending=null;
function resetTalkTeamDefaults(){talkTeamDefaults={username:'',usernames:[],revision:0,loaded:false,error:''};talkTeamDefaultPending=null}
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
function defaultTalkAttendees(){
 if(!hasTalkDefaultTeam())return [];
 const users=new Map(attendeeUsers.map(u=>[u.username,u]));
 return [...new Set(talkTeamDefaults.usernames)].flatMap(username=>{const user=users.get(username);return user?[{name:user.displayName||username,userUsername:username,ack:false,signature:null}]:[]});
}
function renderTalkAttendeeDefaultInfo(){
 const el=document.getElementById('talk-attendees-default-info');if(!el)return;
 const missing=talkAttendeePicker?.options.some(o=>o.selected&&!attendeeUsers.some(u=>u.username===o.userUsername));
 el.textContent=(hasTalkDefaultTeam()?'Your default team has '+defaultTalkAttendees().length+' people. ':'')+'This applies to your new daily and weekly talks.'+(missing?' Saved attendees without a current user account stay in this talk only.':'');
}
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
