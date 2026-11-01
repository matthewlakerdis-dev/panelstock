// One set of form controls and record state serves desktop and touch layouts.
let talkLayoutState={id:null,step:0,topic:0};
let safetyDashboard={equipment:null,credentials:null};
const talkSteps=['Session','Discussion','Attendance','Actions','Review & sign'];
function safetyUsesGuidedLayout(){
 const n=window.navigator||{};
 return (n.maxTouchPoints>0&&window.innerWidth<=1400)||/iPad/i.test(n.userAgent||'')||(n.platform==='MacIntel'&&n.maxTouchPoints>1)||!!window.matchMedia?.('(max-width:700px)').matches||!!window.matchMedia?.('(pointer:coarse) and (max-width:1400px)').matches;
}
function updateSafetyLayout(){
 document.documentElement?.setAttribute('data-safety-layout',safetyUsesGuidedLayout()?'guided':'desktop');
 applyTalkLayout();
}
function setSafetyMore(open){
 const more=document.getElementById('safety-more');
 more.open=!!open;more.setAttribute('data-open',String(!!open));
 document.getElementById('safety-more-summary').setAttribute('aria-expanded',String(!!open));
 document.getElementById('nav-bottom-more').setAttribute('aria-expanded',String(!!open));
}
function toggleSafetyMore(){setSafetyMore(!document.getElementById('safety-more').open)}
function talkStepNavigation(){
 if(talkLayoutState.id!==state.draft.id)talkLayoutState={id:state.draft.id,step:0,topic:0};
 talkLayoutState.topic=Math.max(0,Math.min(talkLayoutState.topic,state.draft.topics.length-1));
 return `<div class="talk-steps" role="group" aria-label="Talk sections">${talkSteps.map((label,i)=>`<button type="button" data-talk-nav="${i}" onclick="selectTalkStep(${i})"><b>${i+1}</b><span>${label}</span></button>`).join('')}</div>`;
}
function talkSessionSummary(){const d=state.draft;return `<aside class="talk-summary"><div class="card"><h3>Session overview</h3><p>${esc(d.site)||'Workshop / project to be added'}</p><dl><div><dt>Attendees</dt><dd>${d.people.length}</dd></div><div><dt>Signatures</dt><dd>${d.people.filter(p=>p.signature).length} of ${d.people.length}</dd></div><div><dt>Follow-up actions</dt><dd>${d.actions.length}</dd></div></dl><button onclick="selectTalkStep(2)">Review attendance</button></div><div class="notice">You can return to any section before signing. Changes to the discussion still require fresh signatures.</div></aside>`}
function talkTopicNavigation(){return `<div class="talk-topic-navigation"><button id="talk-topic-back" onclick="changeTalkTopic(-1)">Previous topic</button><span id="talk-topic-progress" class="muted" role="status"></span><button id="talk-topic-next" class="primary" onclick="changeTalkTopic(1)">Next topic</button></div>`}
function talkStepFooter(){return `<div class="talk-step-footer"><button id="talk-step-back" onclick="selectTalkStep(talkLayoutState.step-1)">Back</button><span id="talk-step-progress" class="muted" role="status"></span><button id="talk-step-next" class="primary" onclick="selectTalkStep(talkLayoutState.step+1)">Continue</button></div>`}
function applyTalkLayout(){
 if(page!=='talk'||!state.draft||!document.getElementById('talk-step-progress'))return;
 const guided=safetyUsesGuidedLayout(),step=talkLayoutState.step;
 document.querySelectorAll('[data-talk-step]').forEach(el=>{el.hidden=Number(el.getAttribute('data-talk-step'))!==step});
 document.querySelectorAll('[data-talk-nav]').forEach(el=>{
  const active=Number(el.getAttribute('data-talk-nav'))===step;
  el.setAttribute('aria-current',active?'step':'false');
 });
 document.querySelectorAll('[data-talk-topic]').forEach(el=>{el.hidden=guided&&Number(el.getAttribute('data-talk-topic'))!==talkLayoutState.topic;if(guided)el.open=true});
 const count=state.draft.topics.length;
 document.getElementById('talk-step-progress').textContent=`Step ${step+1} of ${talkSteps.length}`;
 document.getElementById('talk-topic-progress').textContent=`Topic ${talkLayoutState.topic+1} of ${count}`;
 document.getElementById('talk-step-back').disabled=step===0;
 document.getElementById('talk-step-next').hidden=step===talkSteps.length-1;
 document.getElementById('talk-topic-back').disabled=talkLayoutState.topic===0;
 document.getElementById('talk-topic-next').textContent=talkLayoutState.topic===count-1?'Continue to attendance':'Next topic';
}
function selectTalkStep(step){
 if(page!=='talk'||!Number.isInteger(step)||step<0||step>=talkSteps.length)return;
 if(walkDictation)return afterHuddleDictation(()=>selectTalkStep(step));
 talkLayoutState.step=step;applyTalkLayout();
 const panel=document.querySelector(`[data-talk-step="${step}"]`);
 panel?.focus?.({preventScroll:true});panel?.scrollIntoView?.({block:'start',behavior:'instant'});
}
function changeTalkTopic(delta){
 if(page!=='talk'||!state.draft||!Number.isInteger(delta))return;
 if(walkDictation)return afterHuddleDictation(()=>changeTalkTopic(delta));
 const next=talkLayoutState.topic+delta;
 if(next>=state.draft.topics.length)return selectTalkStep(2);
 talkLayoutState.topic=Math.max(0,next);applyTalkLayout();
 const panel=document.querySelector(`[data-talk-topic="${talkLayoutState.topic}"]`);
 panel?.focus?.({preventScroll:true});panel?.scrollIntoView?.({block:'start',behavior:'instant'});
}
function revealTalkField(el){
 const section=el?.closest?.('[data-talk-step]'),topic=el?.closest?.('[data-talk-topic]');
 if(!section)return;
 talkLayoutState.step=Number(section.getAttribute('data-talk-step'));
 if(topic){talkLayoutState.topic=Number(topic.getAttribute('data-talk-topic'));topic.open=true;}
 applyTalkLayout();
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
