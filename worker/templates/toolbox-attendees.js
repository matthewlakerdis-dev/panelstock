let talkAttendeePicker=null;
const talkAttendeeLimit=60;
function talkAttendeePickerCurrent(){const p=talkAttendeePicker;return !!p&&!busy&&actor?.canRunToolbox&&actor.username===p.username&&draftSyncGeneration===p.generation&&page==='settings'&&settingsGeneration===p.settingsGeneration}
function showTalkAttendeePicker(){
 document.getElementById('talk-attendees-search').value='';renderTalkAttendees();document.getElementById('talk-attendees-dialog').showModal();
}
function openTalkDefaultTeam(){
 if(busy||!actor?.canRunToolbox||page!=='settings'||talkTeamSettingsLoading||!talkTeamDefaults.loaded)return;
 const selected=new Set(talkTeamDefaults.usernames),options=[...new Map(attendeeUsers.map(u=>[u.username,u])).values()].map(u=>({key:'user:'+u.username,name:u.displayName||u.username,userUsername:u.username,selected:selected.has(u.username)}));
 options.sort((a,b)=>a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
 talkAttendeePicker={username:actor.username,generation:draftSyncGeneration,settingsGeneration,options,query:''};showTalkAttendeePicker();
}
function closeTalkAttendees(){talkAttendeePicker=null;const dialog=document.getElementById('talk-attendees-dialog');dialog?.close?.();const options=document.getElementById('talk-attendees-options');if(options)options.innerHTML='';}
function talkAttendeePickerError(message){const el=document.getElementById('talk-attendees-error');if(el)el.textContent=message;}
function talkAttendeeMatches(option){const query=talkAttendeePicker.query.trim().toLocaleLowerCase();return !query||(option.name+' '+option.userUsername).toLocaleLowerCase().includes(query)}
function renderTalkAttendees(){
 const picker=talkAttendeePicker;if(!picker)return;
 const shown=picker.options.filter(talkAttendeeMatches),count=picker.options.filter(o=>o.selected).length;
 document.getElementById('talk-attendees-options').innerHTML=shown.map(o=>{const index=picker.options.indexOf(o);return `<label class="talk-attendee-option" for="talk-attendee-choice-${index}"><input id="talk-attendee-choice-${index}" type="checkbox" ${o.selected?'checked':''} onchange="toggleTalkAttendee(talkAttendeePicker.options[${index}].key,this.checked)"><span><strong>${esc(o.name)}</strong><small>${esc(o.userUsername)}</small></span></label>`}).join('')||'<p class="empty">No matching team members.</p>';
 document.getElementById('talk-attendees-count').textContent=count+' selected';
 document.getElementById('talk-attendees-all').textContent=picker.query.trim()?'Select all shown':'Select all';
 talkAttendeePickerError('');
}
function filterTalkAttendees(query){if(!talkAttendeePicker)return;talkAttendeePicker.query=String(query);renderTalkAttendees()}
function toggleTalkAttendee(key,checked){
 if(!talkAttendeePickerCurrent())return;
 const option=talkAttendeePicker.options.find(o=>o.key===key);if(!option)return;
 if(checked&&!option.selected&&talkAttendeePicker.options.filter(o=>o.selected).length>=talkAttendeeLimit){renderTalkAttendees();return talkAttendeePickerError('Choose up to 60 people for your default team.');}
 option.selected=!!checked;renderTalkAttendees();
 const index=talkAttendeePicker.options.indexOf(option);document.getElementById('talk-attendee-choice-'+index)?.focus?.({preventScroll:true});
}
function selectAllTalkAttendees(){
 if(!talkAttendeePickerCurrent())return;
 const options=talkAttendeePicker.options;
 if(options.filter(o=>o.selected||talkAttendeeMatches(o)).length>talkAttendeeLimit)return talkAttendeePickerError('Choose up to 60 attendees. Search for a team or select people individually.');
 options.forEach(o=>{if(talkAttendeeMatches(o))o.selected=true});renderTalkAttendees();
}
function clearTalkAttendees(){if(!talkAttendeePickerCurrent())return;talkAttendeePicker.options.forEach(o=>o.selected=false);renderTalkAttendees()}
async function applyTalkAttendees(){
 if(busy)return;
 if(!talkAttendeePickerCurrent()){closeTalkAttendees();return notify('The page or account changed. Open the attendee selector again.');}
 const picker=talkAttendeePicker,chosen=picker.options.filter(o=>o.selected);
 if(chosen.length>talkAttendeeLimit)return talkAttendeePickerError('Choose up to 60 people for your default team.');
 const dialog=document.getElementById('talk-attendees-dialog'),finish=beginLoading('Saving your default team…');busy=true;dialog.inert=true;let saved=false,error=null;
 try{saved=await saveTalkDefaultTeam(chosen.map(o=>o.userUsername));}catch(e){error=e;}
 finally{busy=false;dialog.inert=false;finish();}
 if(talkAttendeePicker!==picker||!talkAttendeePickerCurrent()){if(talkAttendeePicker===picker)closeTalkAttendees();return;}
 if(error||!saved){talkAttendeePickerError(error?.message||'Default team save was not confirmed. Retry to confirm it.');return;}
 closeTalkAttendees();renderTalkDefaultTeamSettings();document.getElementById('choose-default-team')?.focus?.({preventScroll:true});notify('Default team saved for your new daily and weekly talks.');
}
document.getElementById('talk-attendees-dialog').addEventListener('close',()=>{talkAttendeePicker=null;document.getElementById('talk-attendees-options').innerHTML=''});
