// Desktop and touch layouts share the same mounted controls and signed record.
let talkLayoutState={id:null,step:0,topic:0,section:'session',guided:false};
let safetyDashboard={equipment:null,credentials:null};
const talkSteps=['Session','Discussion','Attendance','Actions','Review & sign'];
function safetyUsesGuidedLayout(){
 const n=window.navigator||{};
 return (n.maxTouchPoints>0&&window.innerWidth<=1400)||/iPad/i.test(n.userAgent||'')||(n.platform==='MacIntel'&&n.maxTouchPoints>1)||!!window.matchMedia?.('(max-width:700px)').matches||!!window.matchMedia?.('(pointer:coarse) and (max-width:1400px)').matches;
}
function updateSafetyLayout(){
 document.documentElement?.setAttribute('data-safety-layout',safetyUsesGuidedLayout()?'guided':'desktop');
 applyTalkLayout();if(page==='talk')refreshValidation();
}
function setSafetyMore(open){
 const more=document.getElementById('safety-more');more.open=!!open;more.setAttribute('data-open',String(!!open));
 document.getElementById('safety-more-summary').setAttribute('aria-expanded',String(!!open));
 document.getElementById('nav-bottom-more').setAttribute('aria-expanded',String(!!open));
}
function toggleSafetyMore(){setSafetyMore(!document.getElementById('safety-more').open)}
function talkStepDefinitions(){
 const keys=['session','discussion','attendance','actions','review'],guided=safetyUsesGuidedLayout();
 const steps=keys.map((key,i)=>({key,label:guided&&key==='review'?'Review':talkSteps[i]}));
 if(guided&&state.draft?.type==='daily')steps.splice(1,0,{key:'inspection',label:'Inspection'});
 return steps;
}
function normaliseTalkLayout(){
 const guided=safetyUsesGuidedLayout(),steps=talkStepDefinitions();
 if(talkLayoutState.id!==state.draft.id)talkLayoutState={id:state.draft.id,step:0,topic:0,section:'session',guided};
 else if(talkLayoutState.guided!==guided){talkLayoutState.step=Math.max(0,steps.findIndex(s=>s.key===talkLayoutState.section));talkLayoutState.guided=guided;}
 talkLayoutState.step=Math.max(0,Math.min(talkLayoutState.step,steps.length-1));
 talkLayoutState.topic=Math.max(0,Math.min(talkLayoutState.topic,state.draft.topics.length-1));
 talkLayoutState.section=steps[talkLayoutState.step].key;
 return steps;
}
function talkPanelStep(panel){
 const key=panel.getAttribute('data-talk-section');
 const index=talkStepDefinitions().findIndex(s=>s.key===key);
 return index>=0?index:key==='inspection'?0:Number(panel.getAttribute('data-talk-step'));
}
// Section tracking supports validation and scroll shortcuts; the entire form stays visible.
function talkStepNavigation(){normaliseTalkLayout();return ''}
function talkSessionSummary(){const d=state.draft;return `<aside class="talk-summary"><div class="card"><h3>Session overview</h3><p>${esc(d.site)||'Workshop / project to be added'}</p><dl><div><dt>Attendees</dt><dd>${d.people.length}</dd></div><div><dt>Signatures</dt><dd>${d.people.filter(p=>p.signature).length} of ${d.people.length}</dd></div><div><dt>Follow-up actions</dt><dd>${d.actions.length}</dd></div></dl><button onclick="selectTalkSection('attendance')">Review attendance</button></div><div class="notice">You can return to any section before signing. Changes to the discussion still require fresh signatures.</div></aside>`}
function talkTopicNavigation(){return ''}
function talkStepFooter(){return ''}
function compactTalkFooterHTML(){return `<div class="compact-talk-footer"><button class="compact-draft-status" type="button" onclick="openCompactTalkActions()" aria-label="Draft save status and actions"><span id="compact-draft-label" role="status" aria-live="polite"></span></button><div class="row"><button id="compact-talk-more" type="button" aria-label="More draft and app actions" aria-haspopup="dialog" onclick="openCompactTalkActions()">•••</button><button id="compact-talk-save" type="button" onclick="saveDraft()">Save draft</button><button id="compact-talk-complete" class="primary" type="button" onclick="completeTalk()">Complete &amp; save record</button></div></div>`}
function prestartChoicesHTML(d,i){return `<div class="prestart-choices" id="inspection-choice${i}" role="group" tabindex="-1" aria-labelledby="inspection-label${i}">${[['Y','Yes'],['N','No'],['N/A','N/A']].map(([v,label])=>`<button type="button" aria-pressed="${d.prestart?.checklist[i]===v}" data-prestart-value="${v}" onclick="setPrestartChoice(${i},'${v}')">${label}</button>`).join('')}</div><p id="prestart-condition${i}" class="prestart-no-note" ${d.prestart?.checklist[i]==='N'?'':'hidden'}>Resolve this condition before work starts.</p>`}
function updatePrestartUI(){
 if(page!=='talk'||state.draft?.type!=='daily')return;
 const checks=state.draft.prestart?.checklist||[];
 const progress=document.getElementById('prestart-progress');if(progress)progress.textContent=`${checks.filter(Boolean).length} of ${prestartQuestions.length}`;
 checks.forEach((value,i)=>{
  const select=document.getElementById('inspection'+i);if(select)select.value=value;
  document.getElementById('inspection-choice'+i)?.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute('data-prestart-value')===value)));
  const note=document.getElementById('prestart-condition'+i);if(note)note.hidden=value!=='N';
 });
}
function setPrestartChoice(i,value){
 if(page!=='talk'||state.draft?.type!=='daily'||!Number.isInteger(i)||i<0||i>=prestartQuestions.length||!['Y','N','N/A'].includes(value)||state.draft.prestart?.checklist[i]===value)return;
 prestartField(i,value);
}
function talkValidationTarget(el){
 if(safetyUsesGuidedLayout()&&el?.tagName==='SELECT'&&/^inspection\d+$/.test(el.id))return document.getElementById(el.id.replace('inspection','inspection-choice'))||el;
 return el;
}
function applyTalkLayout(){
 if(page!=='talk'||!state.draft)return;
 normaliseTalkLayout();
 document.querySelectorAll('[data-talk-step]').forEach(el=>{el.hidden=false});
 document.querySelectorAll('[data-talk-topic]').forEach(el=>{el.hidden=false;if(el.tagName==='DETAILS')el.open=true});
 updatePrestartUI();updateCompactDraftStatus();
}
function selectTalkStep(step){
 if(page!=='talk'||!Number.isInteger(step)||step<0||step>=talkStepDefinitions().length)return;
 if(walkDictation)return afterHuddleDictation(()=>selectTalkStep(step));
 talkLayoutState.step=step;applyTalkLayout();
 const panel=[...document.querySelectorAll('[data-talk-step]')].find(el=>talkPanelStep(el)===step);
 panel?.focus?.({preventScroll:true});panel?.scrollIntoView?.({block:'start',behavior:'instant'});
}
function selectTalkSection(key){const index=talkStepDefinitions().findIndex(s=>s.key===key);selectTalkStep(index<0&&key==='inspection'?0:index)}
function changeTalkTopic(delta){
 if(page!=='talk'||!state.draft||!Number.isInteger(delta))return;
 if(walkDictation)return afterHuddleDictation(()=>changeTalkTopic(delta));
 const next=talkLayoutState.topic+delta;
 if(next>=state.draft.topics.length)return selectTalkSection('attendance');
 talkLayoutState.topic=Math.max(0,next);applyTalkLayout();
 const panel=document.querySelector(`[data-talk-topic="${talkLayoutState.topic}"]`);
 panel?.focus?.({preventScroll:true});panel?.scrollIntoView?.({block:'start',behavior:'instant'});
}
function revealTalkField(el){
 const section=el?.closest?.('[data-talk-step]'),topic=el?.closest?.('[data-talk-topic]');
 if(!section)return;
 talkLayoutState.step=talkPanelStep(section);
 if(topic){talkLayoutState.topic=Number(topic.getAttribute('data-talk-topic'));topic.open=true;}
 applyTalkLayout();
}
function updateCompactDraftStatus(){
 if(page!=='talk'||!state.draft)return;
 const attention=!storageOK||!!state.draft.accountSync?.blocked||!!state.draft.pendingSave||!!draftSyncMessage;
 const label=document.getElementById('compact-draft-label');
 if(label)label.textContent=attention?'Save needs attention':draftSyncLoading?'Syncing…':!hasDeviceDraft()?'Draft autosaves':state.draft.revision&&!draftDirty()?'Synced to account':'Saved on this device';
 document.getElementById('main').setAttribute('data-talk-sync-attention',String(attention));
 const problem=!storageOK?'Device storage is unavailable. Back up this draft before closing.':state.draft.pendingSave?'Completion has not been confirmed. Your draft is retained. Retry completing the record or back up the device copy.':'';
 const status=document.getElementById('compact-talk-actions-status'),controls=document.getElementById('compact-talk-sync-controls');
 if(status)status.textContent=problem||draftSyncText();
 const banner=document.getElementById('draft-sync-status');if(problem&&banner)banner.textContent=problem;
 if(controls)controls.innerHTML=draftSyncControls().replaceAll('onclick="','onclick="closeCompactTalkActions();');
}
function closeCompactTalkActions(){document.getElementById('compact-talk-actions').close()}
function openCompactTalkActions(){
 if(page!=='talk'||!actor?.canRunToolbox||busy)return;
 if(walkDictation)return afterHuddleDictation(openCompactTalkActions);
 const d=state.draft,install=document.getElementById('install-safety');
 document.getElementById('compact-talk-actions-content').innerHTML=`<p id="compact-talk-actions-status" class="notice" role="status"></p><div id="compact-talk-sync-controls" class="row"></div><div class="compact-talk-actions-list"><button type="button" onclick="closeCompactTalkActions();saveDraft()">Save draft</button><button type="button" onclick="closeCompactTalkActions();downloadDraft()">Back up device copy</button>${actor.isAdmin?`<button type="button" onclick="closeCompactTalkActions();openHuddleAdminDraftSave()">${adminDraftEditing?.talkId===d.id?'Update admin draft':'Save as admin draft'}</button>`:''}<button type="button" onclick="closeCompactTalkActions();refreshHome()">Back to Toolbox home</button>${install&&!install.hidden?'<button type="button" onclick="closeCompactTalkActions();installSafety()">Install app</button>':''}<button type="button" onclick="closeCompactTalkActions();logout()">Log out</button><button type="button" class="danger" onclick="closeCompactTalkActions();deleteDraft('${esc(d.id)}',${d.revision||0})">Delete draft</button></div>`;
 updateCompactDraftStatus();document.getElementById('compact-talk-actions').showModal();
}

function safetyStartTiles(){return actor.canRunToolbox?`<div class="safety-start-tiles"><button onclick="newTalk('daily')"><svg class="safety-nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8M22 21v-2a6 6 0 0 0-3-5"/></svg><strong>Daily pre-start</strong><span>Prepare for today’s work</span></button><button onclick="newTalk('weekly')"><svg class="safety-nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H5v18h14V3h-4M9 1h6v4H9zM8 10h8M8 14h8M8 18h5"/></svg><strong>Weekly toolbox talk</strong><span>Review hazards with the crew</span></button></div>`:''}
function safetyResumeDraft(){const d=state.draft;return actor.canRunToolbox&&hasDeviceDraft()?`<div class="card toolbox-resume"><div><span class="tag">IN PROGRESS</span><h3>${d.type==='weekly'?'Weekly toolbox talk':'Daily pre-start'}</h3><p class="muted">${esc(d.site)||'Workshop / project to be added'} · ${esc(displayDate(d.date))} · ${d.people.length} attendees</p></div><div><button class="primary" onclick="view('talk')">Resume draft</button>${draftSyncHTML()}</div></div>`:''}
function safetyTaskRow(title,detail,button){return `<div class="safety-task-row"><div><strong>${esc(title)}</strong><p class="muted">${esc(detail)}</p></div>${button}</div>`}
function safetyDashboardHTML(){
 const data=safetyHomeData,equipment=safetyDashboard.equipment,credentials=safetyDashboard.credentials;
 const due=equipment?.totals?.due,expiring=credentials?.rows?.filter(r=>r.username===actor.username&&['Expired','Expiring soon'].includes(r.status))||[];
 const tasks=(data?.pending||[]).map(d=>safetyTaskRow(d.title,`${d.type} · ${d.versionLabel}`,`<button class="primary" onclick="openSafetyDocument('${esc(d.id)}',null,true)">Read &amp; sign</button>`)).join('');
 const modules=[['Equipment inspections','Daily checks and fault follow-up.','openEquipment()'],['Licences & training','Expiry dates, cards and certificates.','openCredentials()'],['SWMS','Read and sign assigned methods.',"loadSafety('SWMS')"],['SDS','Read and download. No acknowledgement required.',"loadSafety('SDS')"]];
 if(actor.canRunToolbox)modules.push(['Monthly Audit','Factory inspections and signed audit records.','openWalks()'],['Corrective actions','Follow up findings and agreed controls.','openAuditActions()']);
 if(actor.isAdmin&&actor.canRunToolbox)modules.push(['Team compliance','Review outstanding team acknowledgements.','openCompliance()']);
 return `<div class="safety-dashboard"><div class="row between toolbox-home-heading"><div><span class="toolbox-heading-label">Lennox Facades · Safety Hub</span><h2><span class="safety-desktop-only">Safety overview</span><span class="safety-guided-only">What needs doing?</span></h2><p class="muted">Welcome, ${esc(actor.displayName||actor.username)}. Your work and follow-ups in one place.</p></div><button onclick="refreshSafetyHome()">Refresh</button></div><div class="safety-guided-only">${safetyStartTiles()}</div><div class="safety-overview-stats safety-desktop-only"><div><strong>${data?data.outstanding:'—'}</strong><span>SWMS to acknowledge</span></div><div><strong>${due??'—'}</strong><span>Equipment checks due</span></div>${actor.canRunToolbox?`<div><strong>${hasDeviceDraft()?1:0}</strong><span>Talk in progress on this device</span></div>`:`<div><strong>${credentials?.totals?expiring.length:'—'}</strong><span>Your licences needing attention</span></div>`}</div>${safetyResumeDraft()}<div class="safety-dashboard-columns"><div><div class="card"><div class="row between"><h3>Your acknowledgements</h3>${data?`<span class="tag">${data.outstanding} to sign</span>`:''}</div>${data?`<p class="muted">${data.completed} of ${data.assigned} current assigned SWMS acknowledged.</p>${tasks||'<p class="notice">You’re all up to date. No outstanding acknowledgements.</p>'}`:safetyHomeError?`<p class="notice">Unable to load your acknowledgements: ${esc(safetyHomeError)}</p><button onclick="refreshSafetyHome()">Try again</button>`:'<p class="muted" role="status">Loading your acknowledgements…</p>'}${due?safetyTaskRow('Equipment inspections',`${due} equipment checks due`,'<button onclick="openEquipment()">Inspect</button>'):''}${expiring.slice(0,3).map(r=>safetyTaskRow(r.type,`${r.status}${r.expiryDate?' · '+displayDate(r.expiryDate):''}`,'<button onclick="openCredentials()">Review</button>')).join('')}</div><div class="card"><h3>Documents and safety tasks</h3><div class="safety-module-links">${modules.map(([title,desc,action])=>`<button onclick="${action}"><strong>${esc(title)}</strong><span>${esc(desc)}</span></button>`).join('')}</div></div></div>${actor.canRunToolbox?`<aside><div class="card safety-desktop-only"><h3>Quick start</h3>${safetyStartTiles()}<button onclick="openAdminDrafts()">Use an admin draft</button></div><div class="card"><div class="row between"><h3>Recent records</h3><button onclick="refreshRecords()">View all</button></div>${homeData?(homeData.records||[]).slice(0,3).map(r=>safetyTaskRow(r.site||'Workshop',`${r.type==='weekly'?'Weekly talk':'Daily pre-start'} · ${displayDate(r.date)}`,r.status==='Draft'?`<button onclick="openDraft('${esc(r.id)}')">Open draft</button>`:`<button onclick="exportRecord('${esc(r.id)}','pdf')">PDF</button>`)).join('')||'<p class="muted">No saved records yet.</p>':'<p class="muted">Open Toolbox Talks to load your saved records.</p>'}</div></aside>`:''}</div></div>`;
}
window.addEventListener?.('resize',updateSafetyLayout);
window.matchMedia?.('(pointer:coarse) and (max-width:1400px)').addEventListener?.('change',updateSafetyLayout);
updateSafetyLayout();
