let walkDictation=null,walkDictationFinishing=null;
const walkDictationIcon='<svg class="walk-dictation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
function walkPrefersKeyboardDictation(){
 const nav=window.navigator||{},apple=/iPad|iPhone|iPod/.test(nav.userAgent||'')||(/MacIntel|Macintosh/.test((nav.platform||'')+' '+(nav.userAgent||''))&&nav.maxTouchPoints>1);
 return apple&&(nav.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches===true);
}
function walkRecognition(){return typeof window.SpeechRecognition==='function'?window.SpeechRecognition:typeof window.webkitSpeechRecognition==='function'?window.webkitSpeechRecognition:null}
function walkDictationLabel(){return !walkRecognition()?'Keyboard dictation':walkPrefersKeyboardDictation()?'Try app dictation':'Dictate'}
function walkDictationControls(id,disabled=false){
 if(disabled)return '';
 const native=`<button type="button" id="${esc(id)}-dictate" class="walk-dictation-button" aria-controls="${esc(id)}" aria-describedby="${esc(id)}-dictation-status" aria-pressed="false" onclick="toggleWalkDictation('${esc(id)}')">${walkDictationIcon}<span>${walkDictationLabel()}</span></button>`,keyboard=walkRecognition()?`<button type="button" id="${esc(id)}-dictation-keyboard" class="walk-dictation-button" aria-controls="${esc(id)}" aria-describedby="${esc(id)}-dictation-status" onclick="useKeyboardDictation('${esc(id)}')">${walkDictationIcon}<span>Keyboard dictation</span></button>`:'';
 return `<div class="walk-dictation-controls">${walkPrefersKeyboardDictation()?keyboard+native:native+keyboard}<span id="${esc(id)}-dictation-status" class="walk-dictation-status muted" role="status" aria-live="polite" aria-atomic="true"></span></div>`;
}
function walkDictationContext(){
 if(!actor||busy)return null;
 if(page==='talk'){const d=state.draft;return actor.canRunToolbox&&d?.status==='Draft'&&!d.pendingSave&&!document.getElementById('sign-dialog')?.open&&!document.getElementById('admin-draft-save-dialog')?.open?{username:actor.username,generation:draftSyncGeneration,kind:'talk',id:d.id,type:d.type}:null;}
 if(page!=='walks'||walkFinishPending||auditActionPending)return null;
 if(auditRegister)return auditAction&&auditActionEdit?{username:actor.username,generation:walkGeneration,kind:'action',id:auditAction.originAuditId,actionId:auditAction.originActionId}:null;
 return walkRecord&&!walkRecord.archived&&walkRecord.status==='Draft'&&walkRecord.createdBy===actor.username?{username:actor.username,generation:walkGeneration,kind:'walk',id:walkRecord.id}:null;
}
function validWalkDictation(s){return walkDictation===s&&s.field.isConnected&&document.getElementById(s.id)===s.field&&!s.field.disabled&&!s.field.readOnly&&JSON.stringify(walkDictationContext())===s.context}
function renderWalkDictation(s,message='',finishing=false){
 if(s.button?.isConnected){const active=walkDictation===s;s.button.innerHTML=walkDictationIcon+'<span>'+(active?(finishing?'Finishing…':'Stop dictation'):walkDictationLabel())+'</span>';s.button.setAttribute('aria-pressed',String(active));s.button.disabled=active&&finishing;}
 if(s.status?.isConnected)s.status.textContent=message;
}
function releaseWalkDictation(s,message='',ok=true){
 if(walkDictation!==s)return;
 walkDictation=null;s.recognition.onstart=s.recognition.onresult=s.recognition.onerror=s.recognition.onend=null;
 renderWalkDictation(s,message);
 if(walkDictationFinishing?.session===s){const f=walkDictationFinishing;walkDictationFinishing=null;clearTimeout(f.timer);f.resolve(ok);}
}
function abortWalkDictation(){const s=walkDictation;if(!s)return;releaseWalkDictation(s,'',false);try{s.recognition.abort()}catch{}}
function finishWalkDictation(){
 if(walkDictationFinishing)return walkDictationFinishing.promise;
 const s=walkDictation;if(!s)return Promise.resolve(true);
 if(!validWalkDictation(s)){abortWalkDictation();return Promise.resolve(false);}
 let resolve;const promise=new Promise(done=>resolve=done),f={session:s,promise,resolve,timer:null};walkDictationFinishing=f;
 renderWalkDictation(s,'Finishing dictation…',true);
 f.timer=setTimeout(()=>{if(walkDictation!==s)return;if(!validWalkDictation(s)){abortWalkDictation();return;}releaseWalkDictation(s,'Dictation stopped. Review the text.',false);try{s.recognition.abort()}catch{}notify('Dictation did not finish in time. Review the text, then try again.');},2000);
 try{s.recognition.stop()}catch{releaseWalkDictation(s,'Dictation stopped. Review the text.',false);try{s.recognition.abort()}catch{}}
 return promise;
}
function walkDictationError(error){
 const raw=typeof error==='string'?error:error?.name,code=({NotAllowedError:'not-allowed',SecurityError:'not-allowed',NotSupportedError:'service-not-allowed',UnknownError:'service-unavailable',InvalidStateError:'already-started',AbortError:'aborted',NetworkError:'network',NotFoundError:'audio-capture',NotReadableError:'audio-capture'})[raw]||raw;
 return ({'not-allowed':'Microphone access was not allowed. Allow it in your browser settings, or choose Keyboard dictation.','service-not-allowed':'App dictation is unavailable in this browser. Choose Keyboard dictation, then tap the microphone on your keyboard.','service-unavailable':'The speech recognition service could not start. Choose Keyboard dictation, then tap the microphone on your keyboard.','already-started':'App dictation is busy. Wait a moment and try again, or choose Keyboard dictation.','aborted':'Dictation was interrupted. Try again or choose Keyboard dictation.','audio-capture':'The microphone is unavailable. Check its connection or choose Keyboard dictation.','network':'Dictation could not connect. Check your connection or choose Keyboard dictation.','no-speech':'No speech was heard. Try again or choose Keyboard dictation.','language-not-supported':'Australian English dictation is unavailable in this browser. Choose Keyboard dictation.'})[code]||'App dictation could not start on this device. Choose Keyboard dictation, then tap the microphone on your keyboard.';
}
function useKeyboardDictation(id){
 if(walkDictationFinishing)return notify('Wait for dictation to finish before using the keyboard microphone.');
 const field=document.getElementById(id);
 if(!walkDictationContext()||!field||field.tagName!=='TEXTAREA'||!field.isConnected||field.disabled||field.readOnly)return;
 abortWalkDictation();
 // Keep focus in this tap handler: iOS will not open the keyboard after an await.
 field.focus();
 const message=walkPrefersKeyboardDictation()?'Tap the microphone on your keyboard to dictate. If it is missing, open Settings > General > Keyboard and turn on Enable Dictation.':'Use the microphone on your device keyboard to dictate into this field.',status=document.getElementById(id+'-dictation-status');
 if(status)status.textContent=message;
 notify(message);
}
function appendWalkDictation(s,words){
 const current=s.field.value||'',separator=current&&!/\s$/.test(current)?' ':'',max=s.field.maxLength>=0?s.field.maxLength:Infinity,room=Math.max(0,max-current.length-separator.length);
 let addition='';for(const character of words){if(addition.length+character.length>room)break;addition+=character;}
 if(addition){s.field.value=current+separator+addition;s.field.dispatchEvent(new Event('input',{bubbles:true}));s.added=true;}
 if(addition!==words){notify('Dictation reached this field’s character limit. Review the final words.');void finishWalkDictation();}
}
function toggleWalkDictation(id){
 if(walkDictationFinishing)return notify('Wait for dictation to finish before starting again.');
 if(walkDictation?.id===id){void finishWalkDictation();return;}
 if(walkDictation)abortWalkDictation();
 const field=document.getElementById(id),context=walkDictationContext();
 if(!context||!field||field.tagName!=='TEXTAREA'||!field.isConnected||field.disabled||field.readOnly)return;
 const button=document.getElementById(id+'-dictate'),status=document.getElementById(id+'-dictation-status'),Recognition=walkRecognition();
 if(!Recognition){useKeyboardDictation(id);return;}
 let recognition;try{recognition=new Recognition()}catch(error){const message=walkDictationError(error);if(status)status.textContent=message;notify(message);return;}
 const s={id,field,button,status,recognition,context:JSON.stringify(context),finals:new Set(),added:false};walkDictation=s;
 recognition.onstart=()=>{if(!validWalkDictation(s)){if(walkDictation===s)abortWalkDictation();return;}renderWalkDictation(s,walkDictationFinishing?'Finishing dictation…':'Listening…',!!walkDictationFinishing);};
 recognition.onresult=event=>{
  if(!validWalkDictation(s)){if(walkDictation===s)abortWalkDictation();return;}
  const words=[],interim=[];
  for(let i=0;i<event.results.length;i++){const result=event.results[i],text=String(result[0]?.transcript||'').trim();if(result.isFinal){if(!s.finals.has(i)){s.finals.add(i);if(text)words.push(text);}}else if(text)interim.push(text);}
  if(words.length)appendWalkDictation(s,words.join(' '));
  if(walkDictation===s){const preview=interim.join(' ');renderWalkDictation(s,walkDictationFinishing?'Finishing dictation…':preview?'Hearing: '+preview.slice(0,160):'Listening…',!!walkDictationFinishing);}
 };
 recognition.onerror=event=>{if(walkDictation!==s)return;if(!validWalkDictation(s)){abortWalkDictation();return;}const message=walkDictationError(event.error);releaseWalkDictation(s,message,false);try{recognition.abort()}catch{}notify(message);};
 recognition.onend=()=>{if(walkDictation!==s)return;if(!validWalkDictation(s)){abortWalkDictation();return;}releaseWalkDictation(s,s.added?'Dictation added. Review the text.':'No speech was added.');};
 renderWalkDictation(s,'Starting microphone…');
 try{recognition.lang='en-AU';recognition.continuous=true;recognition.interimResults=true;recognition.start()}catch(error){const message=walkDictationError(error);releaseWalkDictation(s,message,false);try{recognition.abort()}catch{}notify(message);}
}
document.addEventListener?.('visibilitychange',()=>{if(document.hidden)abortWalkDictation()});
window.addEventListener?.('pagehide',abortWalkDictation);

// Finish speech before taking a huddle snapshot. Keep no-speech actions synchronous.
async function afterHuddleDictation(action){
 const context=JSON.stringify(walkDictationContext());
 if(!await finishWalkDictation()||busy||page!=='talk'||context!==JSON.stringify(walkDictationContext()))return;
 return action();
}
function openHuddleAdminDraftSave(){return walkDictation&&page==='talk'?afterHuddleDictation(()=>openAdminDraftSave()):openAdminDraftSave()}
