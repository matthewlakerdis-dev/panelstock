import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildToolboxPage} from '../src/toolbox-page.js';
import {TOOLBOX_DEFAULTS} from '../src/toolbox.js';

function harness(search=''){
 const cache=new Map(),session=new Map(),elements=new Map();let username='supervisor';
 const element=()=>({style:{},classList:{add(){},remove(){}},addEventListener(){},innerHTML:'',textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this.attributes[k]},insertAdjacentElement(){},querySelectorAll(){return []},focus(){context.focused=this},scrollIntoView(){context.scrolled=this}});
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,Blob,atob,URL:{createObjectURL:()=> 'blob:synthetic-pdf',revokeObjectURL(){}},URLSearchParams,location:{search,hash:'',pathname:'/toolbox'},setTimeout:()=>1,clearTimeout(){},confirm:()=>true,
  sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},
  window:{scrollY:0,scrollX:0,scrollTo(position){this.scrollY=position.top;this.scrollX=position.left}},document:{addEventListener(){},createElement:()=>element(),getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],querySelector:()=>element()},
  fetch:async path=>({ok:true,json:async()=>path==='/session'?{username,isAdmin:false,taskAccess:{'factory.toolbox':true}}:path==='/toolbox/users'?{users:[{username,displayName:'Supervisor Name'},{username:'worker',displayName:'Worker Name'}]}:path.endsWith('/file')?{data:'JVBERi0xLjQK',fileName:'swms.pdf'}:path==='/toolbox/templates'?{templates:structuredClone(TOOLBOX_DEFAULTS),revision:1}:path==='/toolbox/drafts'?{drafts:[],total:0,nextOffset:null,latest:null}:path==='/toolbox/list'?{records:[{id:'summary-only',date:'2026-10-13',people:[],actions:[]}],total:1,offset:0,nextOffset:null,openActions:[],openActionTotal:0,actionNextOffset:null}:{ok:true}})
 });
 vm.runInContext(buildToolboxPage().split('<script>')[1].split('</script>')[0],context);
 return {context,cache,setUser:name=>username=name,run:code=>vm.runInContext(code,context)};
}
test('device caching excludes shared list summaries and retains unsaved drafts across login',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("field('site','Private unsaved workshop');field('tasks','Unfinished notes');persist()");
 const cached=JSON.parse(h.cache.get('panelstock-toolbox-v1:supervisor'));assert.deepEqual(cached.records,[]);assert.equal(cached.draft.site,'Private unsaved workshop');
 await h.run('logout()');await h.run("token='synthetic';startSession()");assert.equal(h.run('state.draft.tasks'),'Unfinished notes');assert.equal(h.run('state.draft.site'),'Private unsaved workshop');
});
test('switching accounts resets the draft before reading even an invalid account cache',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("field('site','First supervisor private draft')");await h.run('logout()');
 h.cache.set('panelstock-toolbox-v1:other',JSON.stringify({draft:{site:'broken'},templates:TOOLBOX_DEFAULTS,records:[]}));h.setUser('other');await h.run("token='synthetic';startSession()");
 assert.equal(h.run('state.draft.site'),'');assert.equal(h.run('key'),'panelstock-toolbox-v1:other');
});
test('old caches containing shared summaries recover the draft without treating summaries as full records',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("field('tasks','Recover these draft notes')");const old=JSON.parse(h.cache.get('panelstock-toolbox-v1:supervisor'));old.records=[{id:'summary-only',people:[],actions:[]}];h.cache.set('panelstock-toolbox-v1:supervisor',JSON.stringify(old));
 await h.run("token='synthetic';startSession()");assert.equal(h.run('state.draft.tasks'),'Recover these draft notes');assert.equal(h.run('actor.username'),'supervisor');
});
test('web toolbox uses Web access and a separate session cache; other hints preserve Mobile access',()=>{
 const web=harness('?app=web');assert.equal(web.run('toolboxApp'),'web');assert.equal(web.run('sessionKey'),'panelstock-toolbox-web-session');
 for(const search of ['', '?app=site', '?app=unknown']){const mobile=harness(search);assert.equal(mobile.run('toolboxApp'),'app');assert.equal(mobile.run('sessionKey'),'panelstock-toolbox-session');}
});

test('daily drafts show inspections and weekly drafts omit daily inspection and removed attendance fields',async()=>{const h=harness();await h.run("token='synthetic';startSession()");assert.match(h.run('talkHTML()'),/inspection0/);h.run("state.draft=fresh('weekly');state.draft.people=[{name:'Worker',employer:'Contractor',ack:false,signature:null}]");assert.equal(h.run('state.draft.prestart'),undefined);assert.doesNotMatch(h.run('talkHTML()'),/inspection0|Time in/);assert.doesNotMatch(h.run('talkHTML()'),/Employer|Time out|Attendance and acknowledgement confirmed/);h.run("state.draft.people[0].signature={image:'synthetic',at:'2026-10-13'};state.draft.supervisorSignature={image:'synthetic'};person(0,'employer','Different employer')");assert.equal(h.run('state.draft.people[0].signature'),null);assert.equal(h.run('state.draft.supervisorSignature'),null);});

test('session defaults, three daily sections and attendee dropdown work without discussion checkboxes',async()=>{const h=harness();await h.run("token='synthetic';startSession()");assert.equal(h.run('state.draft.company'),'Lennox Facades');assert.equal(h.run('state.draft.time'),h.run('deviceTime()'));assert.equal(h.run('state.draft.facilitator'),'Supervisor Name');assert.equal(h.run('state.draft.topics.length'),3);assert.doesNotMatch(h.run('talkHTML()'),/Discussed with the team/);h.run("state.draft.people.push({name:'',userUsername:'',ack:false,signature:null});selectAttendee(0,'worker');topic(0,'notes','Cut frames');topic(1,'notes','Hot work');topic(2,'notes','Check extraction')");assert.equal(h.run('state.draft.people[0].name'),'Worker Name');assert.equal(h.run('state.draft.tasks'),'Cut frames');assert.equal(h.run('state.draft.prestart.highRisk'),'Hot work');assert.equal(h.run('state.draft.prestart.previousShift'),'Check extraction');assert.match(h.run('talkHTML()'),/select aria-label="Attendee 1 name"/);h.run("state.draft=fresh('weekly')");assert.equal(h.run('state.draft.topics.length'),6);});

test('Yes for all updates daily inspections, clears signatures only on change and allows individual overrides',async()=>{const h=harness();await h.run("token='synthetic';startSession()");h.run("state.draft.people=[{name:'Worker',ack:true,signature:{image:'synthetic'}}];state.draft.supervisorSignature={image:'synthetic'};prestartYesAll()");assert.equal(h.run("state.draft.prestart.checklist.every(v=>v==='Y')"),true);assert.equal(h.run('state.draft.people[0].signature'),null);assert.equal(h.run('state.draft.people[0].ack'),false);assert.equal(h.run('state.draft.supervisorSignature'),null);assert.ok(JSON.parse(h.cache.get('panelstock-toolbox-v1:supervisor')).draft.prestart.checklist.every(v=>v==='Y'));h.run("state.draft.people[0].signature={image:'unchanged'};state.draft.supervisorSignature={image:'unchanged'};prestartYesAll()");assert.equal(h.run('state.draft.supervisorSignature.image'),'unchanged');h.run("prestartField(0,'N/A')");assert.equal(h.run('state.draft.prestart.checklist[0]'),'N/A');assert.equal(h.run('state.draft.supervisorSignature'),null);h.run("state.draft=fresh('weekly');prestartYesAll()");assert.equal(h.run('state.draft.prestart'),undefined);assert.doesNotMatch(h.run('talkHTML()'),/Yes for all/);});

test('completion highlights all missing fields and focuses and scrolls to the first; corrected fields clear',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("view('talk')");await h.run('completeTalk()');
 assert.equal(h.run("document.getElementById('site').attributes['aria-invalid']"),'true');
 assert.equal(h.run("document.getElementById('inspection0').attributes['aria-invalid']"),'true');
 assert.equal(h.run("focused===document.getElementById('site')&&scrolled===focused"),true);
 h.run("field('site','Workshop');prestartYesAll();topic(0,'notes','Cut frames')");
 // The real DOM selector removes old markers before reapplying current errors.
 assert.equal(h.run("Object.hasOwn(missingFields('complete'),'site')"),false);
 h.run("view('talk')");await h.run('completeTalk()');assert.equal(h.run("focused===document.getElementById('add-attendee')"),true);
 h.run("state.draft.people=[{name:'Worker',ack:false,signature:null}];state.draft.actions=[{text:'',owner:'',due:''}]");
 assert.equal(h.run("Object.keys(missingFields('complete')).join(',')"),'signature0,act0,owner0,due0,supervisor-signature');
 h.run("openSignature('supervisor')");assert.equal(h.run("focused===document.getElementById('signature0')"),true);
});
test('weekly and legacy daily validation target the correct inputs and signing omits final sign-off',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("state.draft=fresh('weekly');state.draft.site='Workshop';state.draft.people=[{name:'',ack:false,signature:null}];state.draft.topics[1].text=''");
 assert.equal(h.run("Object.keys(missingFields('attendee')).join(',')"),'focus,point1,attendee0');
 h.run("openSignature(0)");assert.equal(h.run("focused===document.getElementById('focus')"),true);
 h.run("state.draft=fresh('daily');state.draft.topics=Array.from({length:6},()=>({text:'Point',notes:'',reviewed:true}));state.draft.site='Workshop'");
 assert.equal(h.run("Object.keys(missingFields('attendee'))[0]"),'tasks');
});

test('choosing or clearing an attendee keeps the existing form and dropdown mounted',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("state.draft.people=[{name:'',userUsername:'',ack:false,signature:null},{name:'',userUsername:'',ack:false,signature:null}];view('talk');document.getElementById('main').innerHTML='Existing form sentinel';selectAttendee(0,'worker')");
 assert.equal(h.run("document.getElementById('main').innerHTML"),'Existing form sentinel');assert.equal(h.run('state.draft.people[0].name'),'Worker Name');
 h.run("selectAttendee(1,'worker')");assert.equal(h.run('state.draft.people[1].name'),'');assert.equal(h.run("document.getElementById('attendee1').value"),'');
 h.run("selectAttendee(0,'')");assert.equal(h.run('state.draft.people[0].name'),'');assert.equal(h.run("document.getElementById('main').innerHTML"),'Existing form sentinel');
});

test('Toolbox links open safety Home and returning home preserves a draft that can be resumed',async()=>{
 const h=harness();await h.run("token='synthetic';searchTerm='Old search';startSession()");assert.equal(h.run('searchTerm'),'');assert.equal(h.run('page'),'safety-home');assert.match(h.run("document.getElementById('main').innerHTML"),/<h2>Home<\/h2>|Your acknowledgements/);assert.doesNotMatch(h.run('homeHTML()'),/Resume draft/);
 const fetch=h.context.fetch;h.context.fetch=async(path,options)=>path.startsWith('/toolbox/records/')?{ok:true,json:async()=>({record:{...JSON.parse(options.body).record,revision:1}})}:fetch(path,options);h.run("newTalk('weekly');field('site','Frame workshop');field('focus','Welding fumes')");const id=h.run('state.draft.id');await h.run('refreshSafetyHome()');assert.equal(h.run('state.draft.id'),id);await h.run('refreshHome()');assert.equal(h.run('page'),'home');assert.match(h.run('homeHTML()'),/Resume draft/);assert.equal(h.run('state.draft.id'),id);h.run("view('talk')");assert.equal(h.run('state.draft.focus'),'Welding fumes');
 await h.run("newTalk('daily')");assert.equal(h.run('state.draft.type'),'daily');assert.notEqual(h.run('state.draft.id'),id);
});
test('Home shows the latest five unfiltered records and action totals without changing record searches',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");const fetch=h.context.fetch;h.context.fetch=async(path,options)=>path==='/toolbox/list'?{ok:true,json:async()=>{assert.deepEqual(JSON.parse(options.body),{offset:0,search:''});return {records:Array.from({length:7},(_,i)=>({id:'record-'+i,type:'daily',date:'2026-10-13',status:'Completed',site:'Workshop '+i,facilitator:'Supervisor',people:[],actions:[]})),total:42,openActionTotal:8,openActions:[{text:'Fix extraction',owner:'Supervisor',due:'2026-10-14',site:'Workshop'}]}}}:fetch(path,options);
 h.run("searchTerm='Welding';totalRecords=1");await h.run('refreshHome()');const html=h.run('homeHTML()');assert.match(html,/>42<|>8<|Fix extraction/);assert.ok(html.indexOf('Workshop 0')<html.indexOf('Workshop 4'));assert.doesNotMatch(html,/Workshop 5|Workshop 6/);assert.equal(h.run('searchTerm'),'Welding');assert.equal(h.run('totalRecords'),1);h.run('state.records=homeData.records.slice(0,5)');const saved=h.run('recordsHTML()');assert.ok(saved.indexOf('Workshop 0')<saved.indexOf('Workshop 4'));
});

test('device draft deletion confirms, preserves on cancellation and clears the cached draft on success',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("newTalk('daily');field('site','Delete this workshop')");const id=h.run('state.draft.id');h.context.confirm=()=>false;await h.run('deleteDraft(state.draft.id)');assert.equal(h.run('state.draft.id'),id);
 h.context.confirm=()=>true;await h.run('deleteDraft(state.draft.id)');assert.notEqual(h.run('state.draft.id'),id);assert.equal(h.run('state.draft.site'),'');assert.equal(h.run('page'),'home');assert.equal(JSON.parse(h.cache.get('panelstock-toolbox-v1:supervisor')).draft.site,'');assert.doesNotMatch(h.run('homeHTML()'),/Resume draft/);
});
test('saved draft deletion sends the revision and retains local edits on server conflict; completed rows have no delete button',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("field('site','Keep this draft');state.draft.revision=2");const id=h.run('state.draft.id'),fetch=h.context.fetch;
 h.context.fetch=async(path,options)=>path.endsWith('/delete')?{ok:false,status:409,json:async()=>{const packet=JSON.parse(options.body);assert.equal(packet.expectedRevision,2);return {error:'Draft changed. Reopen it before deleting.'}}}:fetch(path,options);
 await h.run('deleteDraft(state.draft.id,state.draft.revision)');assert.equal(h.run('state.draft.id'),id);assert.equal(h.run('state.draft.site'),'Keep this draft');assert.match(h.run("document.getElementById('message').textContent"),/Draft changed/);
 assert.doesNotMatch(h.run("recordRows([{id:'completed',type:'daily',date:'2026-10-13',status:'Completed',site:'Workshop',facilitator:'Supervisor',people:[]}])"),/Delete draft/);
});

test('record, draft, action and export dates display day-month-year without altering stored dates',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("field('site','Workshop');state.draft.date='2026-02-03';state.draft.actions=[{text:'Inspect extraction',owner:'Supervisor',due:'2026-02-04',closed:false}]");assert.match(h.run('homeHTML()'),/03-02-2026/);assert.match(h.run('report(state.draft)'),/03-02-2026|04-02-2026/);assert.match(h.run('filename(state.draft)'),/ - 03-02-2026 - Draft$/);assert.match(h.run("stamp('2026-02-02T23:30:00Z')"),/^03-02-2026/);assert.equal(h.run('state.draft.date'),'2026-02-03');assert.match(h.run("recordRows([{id:'r',type:'weekly',status:'Completed',date:'2026-10-13',people:[],site:'Factory',facilitator:'Supervisor'}])"),/Weekly toolbox talk · 13-10-2026/);
});

test('Toolbox Settings is restricted to admins and saves recipient emails with the shared revision',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");assert.equal(h.run("document.getElementById('nav-settings').hidden"),true);await h.run('openSettings()');assert.notEqual(h.run('page'),'settings');h.run('actor.isAdmin=true');const original=h.context.fetch;let saved;
 h.context.fetch=async(path,options)=>path==='/toolbox/email-settings'?{ok:true,json:async()=>{if(options.method==='POST')saved=JSON.parse(options.body);return {config:{enabled:true,recipients:['office@example.com'],revision:saved?1:0},sender:'PanelStock Reports <reports@panelstockhq.com>',providerReady:true,jobs:[]}}}:original(path,options);
 await h.run('openSettings()');assert.equal(h.run('page'),'settings');assert.match(h.run('settingsHTML()'),/reports@panelstockhq.com|Recipient emails/);h.run("document.getElementById('email-enabled').checked=true;document.getElementById('email-recipients').value='office@example.com, safety@example.com'");await h.run('saveEmailSettings()');assert.deepEqual(saved,{enabled:true,recipients:['office@example.com','safety@example.com'],expectedRevision:0});assert.equal(h.run('emailSettings.config.revision'),1);
});

test('direct Safety login uses existing APIs and stores only the scoped token while clearing the PIN',async()=>{
 const h=harness(),requests=[];h.context.history={replaceState(){}};const original=h.context.fetch;h.context.fetch=async(path,options)=>{if(['/login','/toolbox/session-ticket','/toolbox/session'].includes(path)){requests.push({path,headers:options.headers,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>path==='/login'?{token:'parent-token'}:path==='/toolbox/session-ticket'?{ticket:'ticket'}:{token:'scoped-token'}};}return original(path,options)};
 h.run("loginView();document.getElementById('safety-username').value='supervisor';document.getElementById('safety-pin').value='654321'");await h.run('signInSafety()');assert.deepEqual(requests.map(r=>r.path),['/login','/toolbox/session-ticket','/toolbox/session']);assert.equal(requests[1].headers.Authorization,'Bearer parent-token');assert.equal(h.run("sessionStorage.getItem('panelstock-toolbox-session')"),'scoped-token');assert.equal(h.run("document.getElementById('safety-pin').value"),'');assert.equal(h.run('actor.username'),'supervisor');assert.ok(![...h.cache.values()].some(v=>v.includes('parent-token')));
});
test('invalid direct login keeps the form, clears the PIN and shows a sign-in error',async()=>{
 const h=harness();h.context.fetch=async()=>({ok:false,status:401,json:async()=>({error:'Invalid username or PIN'})});h.run("loginView();document.getElementById('safety-username').value='supervisor';document.getElementById('safety-pin').value='999999'");await h.run('signInSafety()');assert.equal(h.run("document.getElementById('safety-pin').value"),'');assert.match(h.run("document.getElementById('safety-login-error').textContent"),/Invalid username or PIN/);assert.equal(h.run('actor'),null);
});

test('loading status stays visible across overlapping tasks and clears after errors',async()=>{
 const h=harness();await h.run('Promise.resolve()');
 h.run("endFirst=beginLoading('Saving acknowledgement…');endSecond=beginLoading('Preparing PDF…')");
 assert.equal(h.run("document.getElementById('task-loading').hidden"),false);assert.equal(h.run("document.getElementById('task-loading-label').textContent"),'Saving acknowledgement…');assert.equal(h.run("document.getElementById('main').attributes['aria-busy']"),'true');
 h.run('endFirst();endFirst()');assert.equal(h.run("document.getElementById('task-loading-label').textContent"),'Preparing PDF…');h.run('endSecond()');assert.equal(h.run("document.getElementById('task-loading').hidden"),true);
 await assert.rejects(h.run("loadingTask(async()=>{throw Error('Synthetic failure')},'Saving draft…')()"),/Synthetic failure/);
 assert.equal(h.run("document.getElementById('task-loading').hidden"),true);assert.equal(h.run("document.getElementById('main').attributes['aria-busy']"),'false');
});

test('assigned signers use profile details directly without the redundant form and restrict who can sign',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");
 h.run(`attendeeUsers[1].profileRevision='profile-v1';attendeeUsers[1].licenses=[{id:'construction',type:'Construction Card',class:'C',number:'123'},{id:'white',type:'White Card',class:'W',number:'456'}];attendeeUsers[1].signoffDetails={role:'Welder',licenceClass:'C',licenceNumber:'123',qualifications:'',licences:[{description:'White Card',class:'W',number:'456'},{description:'',class:'',number:''}]};safetyDetail={document:{id:'d',type:'SWMS',currentVersion:'v',versions:[{id:'v',label:'Revision 1'}]},version:{id:'v',title:'Welding',label:'Revision 1',size:1,requiredSigners:['worker'],signoff:{firstPage:11,continuationPage:12}},acknowledgements:[]};document.getElementById('sign-dialog').showModal=()=>{};document.getElementById('signature-pad').getContext=()=>({clearRect(){}});loadSafetyPdfReader=async()=>true`);
 assert.doesNotMatch(h.run('safetyHTML()'),/safety-attendee|swms-role|swms-licence-/);
 await h.run("openSafetySignature('worker')");assert.equal(h.run('safetySigning.user.details.role'),'Welder');assert.equal(h.run('safetySigning.profileRevision'),'profile-v1');assert.equal(h.run('JSON.stringify(safetySigning.profileLicenceIds)'), '["white",""]');
 h.run("attendeeUsers[1].signoffDetails.role='Changed';actor.canRunToolbox=false;actor.username='supervisor';safetySigning=null;openSafetySignature('worker')");assert.equal(h.run('safetySigning'),null);
 await h.run("actor.username='worker';openSafetySignature('worker')");assert.equal(h.run('safetySigning.user.details.role'),'Changed');
 for(const restriction of ["safetyDetail.acknowledgements=[{username:'worker'}]", "safetyDetail.acknowledgements=[];safetyDetail.version.requiredSigners=[]", "safetyDetail.version.requiredSigners=['worker'];safetyDetail.document.archived=true", "safetyDetail.document.archived=false;safetyDetail.document.currentVersion='other'"]){h.run(restriction+";safetySigning=null;openSafetySignature('worker')");assert.equal(h.run('safetySigning'),null);}
});

test('safety home loads personal counts, provides document links and refreshes without showing a false zero on failure',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");let summary={assigned:3,completed:1,outstanding:2,swms:2,sds:0,pending:[{id:'doc',title:'Welding SWMS',type:'SWMS',versionLabel:'Rev 1'},{id:'ewp',title:'EWP SWMS',type:'SWMS',versionLabel:'Rev 2'}]},fail=false;const fetch=h.context.fetch;
 h.context.fetch=async(path,options)=>{if(path.includes('/summary')){assert.equal(options.method,'GET');return {ok:!fail,status:fail?503:200,json:async()=>fail?{error:'Temporarily unavailable'}:summary}}return fetch(path,options)};
 await h.run('refreshSafetyHome()');assert.equal(h.run('safetyHomeData.outstanding'),2);assert.match(h.run('safetyHomeHTML()'),/1 of 3 current assigned SWMS/);assert.match(h.run('safetyHomeHTML()'),/openSafetyDocument\('doc',null,true\)/);
 summary={assigned:3,completed:3,outstanding:0,swms:0,sds:0,pending:[]};await h.run('refreshSafetyHome()');assert.match(h.run('safetyHomeHTML()'),/all up to date/);
 fail=true;await h.run('refreshSafetyHome()');assert.match(h.run('safetyHomeHTML()'),/Temporarily unavailable/);assert.doesNotMatch(h.run('safetyHomeHTML()'),/all up to date/);
});

test('SDS show document reading controls without signer selection, acknowledgement or signature actions',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("actor.isAdmin=true;safetyDetail={document:{id:'d',type:'SDS',currentVersion:'v',versions:[{id:'v',label:'Rev 1'}]},version:{id:'v',type:'SDS',title:'Chemical SDS',label:'Rev 1',size:1,requiredSigners:['worker']},acknowledgements:[]}");
 const html=h.run('safetyHTML()');assert.match(html,/View PDF|Download \/ read PDF/);assert.match(html,/No acknowledgement is required for SDS/);assert.doesNotMatch(html,/Who needs to sign|Team acknowledgements|Sign my acknowledgement|Collect signature|Download acknowledgement register/);
 h.run("safetySigning=null;openSafetySignature('worker')");assert.equal(h.run('safetySigning'),null);
});

test('admin compliance filters limit bulk reminders and failed requests reuse the same request identifier',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");await h.run('openCompliance()');assert.notEqual(h.run('page'),'compliance');h.run('actor.isAdmin=true');const fetch=h.context.fetch,items=[{documentId:'d1',versionId:'v1',username:'worker',name:'Worker',title:'Welding',versionLabel:'Rev 1',status:'Outstanding',canRemind:true},{documentId:'d2',versionId:'v2',username:'other',name:'Other',title:'EWP',versionLabel:'Rev 1',status:'Outstanding',canRemind:true},{documentId:'d1',versionId:'v1',username:'other',name:'Other',title:'Welding',versionLabel:'Rev 1',status:'Acknowledged',canRemind:false}],data={rows:items,documents:[{id:'d1',title:'Welding'}],people:[{username:'worker',name:'Worker'}],totals:{assigned:3,outstanding:2,completed:1,peopleOutstanding:2,documentsOutstanding:2}};const packets=[];let fail=true;
 h.context.fetch=async(path,options)=>{if(path.endsWith('/compliance'))return {ok:true,json:async()=>data};if(path.endsWith('/remind')){packets.push(JSON.parse(options.body));if(fail)throw Error('Connection interrupted');return {ok:true,json:async()=>({recipients:1,reminded:1,skipped:0})}}return fetch(path,options)};
 await h.run('openCompliance()');assert.equal(h.run('page'),'compliance');assert.equal(h.run('complianceRows().length'),2);h.run("filterCompliance('document','d1');filterCompliance('user','worker')");assert.equal(h.run('complianceRows().length'),1);await h.run('sendComplianceReminder()');assert.equal(packets.length,1);assert.deepEqual(packets[0].items,[{documentId:'d1',versionId:'v1',username:'worker'}]);fail=false;await h.run('sendComplianceReminder()');assert.equal(packets[0].mutationId,packets[1].mutationId);assert.equal(h.run('busy'),false);assert.equal(h.run('complianceRetry'),null);
 h.run("filterCompliance('user','');filterCompliance('status','Acknowledged')");assert.equal(h.run('complianceRows().length'),1);assert.match(h.run('complianceHTML()'),/Send reminders to 0 people shown/);
});

test('licence and training dashboard supports personal scope, expiry filters and credential uploads',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");const fetch=h.context.fetch;h.context.fetch=async(path,options)=>path.endsWith('/credentials')?{ok:true,json:async()=>({rows:[{username:'worker',name:'Worker',kind:'licenses',id:'lift',type:'Forklift',expiryDate:'2026-11-12',status:'Expiring soon',daysRemaining:30,files:[]},{username:'worker',name:'Worker',kind:'inductions',id:'aid',type:'First Aid',expiryDate:'2026-10-12',status:'Expired',daysRemaining:-1,files:[]}],people:[{username:'worker',name:'Worker'}],totals:{valid:0,expiring:1,expired:1,undated:0},automaticReminders:true})}:fetch(path,options);
 h.run('actor.canRunToolbox=false');await h.run('openCredentials()');assert.equal(h.run('page'),'credentials');assert.doesNotMatch(h.run('credentialsHTML()'),/Manage team profiles|Edit profile/);assert.match(h.run('credentialsHTML()'),/12-11-2026/);h.run("filterCredentials('status','Expired')");assert.equal(h.run('credentialRows().length'),1);h.run('startCredentialUpload(1)');assert.match(h.run('credentialsHTML()'),/First Aid|PDF, PNG or JPEG/);
});

test('equipment inspection validation focuses missing checks and fault notes without losing entered results',async()=>{const h=harness();await h.run("token='synthetic';startSession()");h.run("equipmentDetail={equipment:{id:'machine',revision:1,name:'Forklift',type:'Forklift',assetNumber:'FL1',location:'Workshop',checks:[{id:'brakes',label:'Brakes',critical:true,allowNA:false},{id:'lights',label:'Lights',critical:false,allowNA:true}],archived:false},faults:[],inspections:[],nextOffset:null};startEquipmentInspection()");assert.equal(h.run('page'),'equipment');assert.equal(h.run('validateEquipmentInspection()'),false);assert.equal(h.run("focused===document.getElementById('equipment-answer-0')"),true);h.run("equipmentAnswer(0,'result','Fail');equipmentAnswer(1,'result','Pass')");assert.equal(h.run('validateEquipmentInspection()'),false);assert.equal(h.run("focused===document.getElementById('equipment-note-0')"),true);h.run("equipmentAnswer(0,'notes','Fluid leak')");assert.equal(h.run('validateEquipmentInspection()'),true);assert.match(h.run('equipmentHTML()'),/Fluid leak|Critical/);h.run("equipmentAnswer(0,'result','Pass')");assert.equal(h.run('equipmentDraft.answers[0].notes'),'');});


test('read and sign opens the exact assigned PDF with signing beneath it; failed or stale loads cannot open the pad',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");
 const detail={document:{id:'doc',type:'SWMS',currentVersion:'v',versions:[{id:'v',label:'Rev 1'}]},version:{id:'v',documentId:'doc',type:'SWMS',title:'Welding',label:'Rev 1',size:1,requiredSigners:['supervisor']},acknowledgements:[]};
 let pdfMode='ok',opens=0,requested=[];const fetch=h.context.fetch;
 h.context.fetch=async(path,options)=>{if(path==='/toolbox/safety-documents/doc')return {ok:true,json:async()=>detail};if(path.endsWith('/file')){requested.push(JSON.parse(options.body));if(pdfMode==='error')throw Error('Offline');if(pdfMode==='stale')h.run('safetyGeneration++');return {ok:true,json:async()=>({data:'JVBERi0xLjQK'})}}return fetch(path,options)};
 h.context.opens=()=>opens++;h.run("document.getElementById('sign-dialog').showModal=opens;document.getElementById('signature-pad').getContext=()=>({clearRect(){}});loadSafetyPdfReader=async()=>true");
 await h.run("openSafetyDocument('doc',null,true)");assert.equal(opens,1);assert.deepEqual(requested,[{versionId:'v'}]);assert.equal(h.run("document.getElementById('sign-pdf-link').href"),'blob:synthetic-pdf');assert.equal(h.run('page'),'safety-home');assert.equal(h.run('safetyDetail'),null);assert.equal(h.run("document.getElementById('sign-pdf-section').hidden"),false);assert.equal(h.run('safetySigning.user.username'),'supervisor');
 const html=buildToolboxPage();assert.ok(html.indexOf('id="sign-pdf"')<html.indexOf('id="signature-pad"'));
 h.run('resetSignaturePdf();safetySigning=null');assert.equal(h.run('signaturePdfUrl'),null);assert.equal(h.run("document.getElementById('sign-pdf-section').hidden"),true);
 for(const mode of ['error','stale']){pdfMode=mode;h.context.detail=detail;await h.run("openSafetySignature('supervisor',detail)");assert.equal(opens,1);assert.equal(h.run('safetySigning'),null);assert.equal(h.run('busy'),false);}
 assert.equal(requested.length,3);
});

test('daily and weekly export names are readable, date formatted and portable to OneDrive',()=>{const h=harness();for(const [type,label] of [['daily','Daily Pre-start'],['weekly','Weekly Toolbox Talk']]){const record={id:'fef4e804-69e4-446f-b773-4f5840b67ab4',type,status:'Completed',company:'Lennox Facades',site:'Factory',date:'2026-10-22'};assert.equal(h.run('filename('+JSON.stringify(record)+')'),'Lennox Facades - '+label+' - Factory - 22-10-2026');record.status='Draft';assert.match(h.run('filename('+JSON.stringify(record)+')'),/ - Draft$/);}const long={type:'daily',status:'Completed',date:'2026-10-22',company:'A'.repeat(300),site:'B'.repeat(300)};assert.ok(h.run('filename('+JSON.stringify(long)+')').length<200);const unsafe={...long,company:'A<>:"/\\|?*#% Company',site:'  Factory / CNC: Bay 1?\n  '};assert.equal(h.run('filename('+JSON.stringify(unsafe)+')'),'A Company - Daily Pre-start - Factory CNC Bay 1 - 22-10-2026');assert.equal(h.run("filename({type:'daily',status:'Completed',company:'',site:'',date:''})"),'Lennox Facades - Daily Pre-start - Workshop - Undated');});

test('Safety selects the guided layout for iPad in both orientations and retains desktop for mouse users',()=>{
 const h=harness();
 assert.equal(h.run('safetyUsesGuidedLayout()'),false);
 h.context.window.navigator={userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'};
 assert.equal(h.run('safetyUsesGuidedLayout()'),true);
 h.context.window.navigator={userAgent:'Mozilla/5.0 (Macintosh)',platform:'MacIntel',maxTouchPoints:5};
 assert.equal(h.run('safetyUsesGuidedLayout()'),true);
 h.context.window.navigator={platform:'MacIntel',maxTouchPoints:0};
 assert.equal(h.run('safetyUsesGuidedLayout()'),false);
 h.context.window.matchMedia=query=>({matches:query==='(pointer:coarse) and (max-width:1400px)'});
 assert.equal(h.run('safetyUsesGuidedLayout()'),true);
});

test('talk navigation preserves the mounted inputs, draft identity, signatures and current topic on rerender',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("state.draft=fresh('weekly');view('talk')");
 const id=h.run('state.draft.id');
 h.run("state.draft.topics[0].notes='Keep these agreed controls';state.draft.people=[{name:'Worker',ack:true,signature:{image:'existing-signature'}}];document.getElementById('main').innerHTML='Mounted form';selectTalkStep(1);changeTalkTopic(1)");
 assert.equal(h.run('talkLayoutState.topic'),1);
 assert.equal(h.run("document.getElementById('main').innerHTML"),'Mounted form');
 assert.equal(h.run('state.draft.id'),id);
 assert.equal(h.run('state.draft.people[0].signature.image'),'existing-signature');
 h.run("view('talk')");
 assert.equal(h.run('talkLayoutState.step'),1);assert.equal(h.run('talkLayoutState.topic'),1);
 assert.equal(h.run('state.draft.topics[0].notes'),'Keep these agreed controls');
 h.run("state.draft=fresh('daily');view('talk')");assert.equal(h.run('talkLayoutState.step'),0);assert.equal(h.run('talkLayoutState.topic'),0);
});

test('guided topic navigation reaches attendance after the last topic and cannot leave the valid step range',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("view('talk');selectTalkStep(1);changeTalkTopic(-1)");
 assert.equal(h.run('talkLayoutState.topic'),0);
 h.run('changeTalkTopic(1);changeTalkTopic(1);changeTalkTopic(1)');assert.equal(h.run('talkLayoutState.step'),2);
 h.run('selectTalkStep(-1);selectTalkStep(5);selectTalkStep(NaN)');assert.equal(h.run('talkLayoutState.step'),2);
});

test('validation reveals a hidden section and expands its topic before focusing the required input',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("state.draft=fresh('weekly');view('talk');selectTalkStep(4)");
 h.run("document.getElementById('site').closest=selector=>selector==='[data-talk-step]'?{getAttribute:()=> '0'}:null;validateTalk('complete')");
 assert.equal(h.run('talkLayoutState.step'),0);assert.equal(h.run("focused===document.getElementById('site')"),true);
 h.run("state.draft.site='Workshop';state.draft.focus='Safe work';state.draft.topics[4].text='';globalThis.hiddenTopic={open:false,getAttribute:()=> '4'};document.getElementById('point4').closest=selector=>selector==='[data-talk-step]'?{getAttribute:()=> '1'}:hiddenTopic;validateTalk('attendee')");
 assert.equal(h.run('talkLayoutState.step'),1);assert.equal(h.run('talkLayoutState.topic'),4);assert.equal(h.run('hiddenTopic.open'),true);
});

test('Safety dashboard keeps personal acknowledgements when optional data fails and ignores stale account responses',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");const original=h.context.fetch;let resolveEquipment;
 h.context.fetch=async(path,options)=>path==='/toolbox/equipment'?new Promise(resolve=>{resolveEquipment=resolve}):path==='/toolbox/credentials'?{ok:false,status:503,json:async()=>({error:'Unavailable'})}:path.includes('/summary')?{ok:true,json:async()=>({outstanding:1,assigned:2,completed:1,pending:[{id:'doc',title:'SWMS',type:'SWMS',versionLabel:'Rev 1'}]})}:original(path,options);
 const pending=h.run('refreshSafetyHome()');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.run('safetyHomeData.outstanding'),1);
 h.run("actor={...actor,username:'different-user'};safetyDashboard={equipment:null,credentials:null}");
 resolveEquipment({ok:true,json:async()=>({totals:{due:99}})});await pending;
 assert.equal(h.run('safetyDashboard.equipment'),null);
});

function resetDialogHarness(search=''){
 const h=harness(search);h.run("globalThis.resetDialog=document.getElementById('safety-reset-dialog');resetDialog.open=false;resetDialog.showModal=function(){this.open=true};resetDialog.close=function(){this.open=false};loginView()");return h;
}
test('Safety recovery asks for a username and confirmation before sending a reset request',async()=>{
 const h=resetDialogHarness();let calls=0;h.context.fetch=async()=>{calls++;throw Error('Unexpected request')};
 h.run("document.getElementById('safety-username').value='   ';openSafetyPinReset()");
 assert.equal(h.run('resetDialog.open'),false);assert.match(h.run("document.getElementById('safety-login-error').textContent"),/Enter your username/);
 assert.equal(h.run("focused===document.getElementById('safety-username')"),true);
 h.run("document.getElementById('safety-username').value=' sam ';openSafetyPinReset()");assert.equal(h.run('resetDialog.open'),true);
 assert.equal(h.run("document.getElementById('safety-reset-username').textContent"),'sam');assert.equal(calls,0);
 h.run('resetDialog.close()');await h.run('sendSafetyPinReset()');assert.equal(calls,0);
});
test('Safety reset uses the existing unauthenticated endpoint with only the confirmed username, on Web and Mobile',async()=>{
 for(const search of ['', '?app=web']){
  const h=resetDialogHarness(search),calls=[];const message='If your account has an email address, a PIN reset link will be sent. Otherwise, contact your administrator.';
  h.context.fetch=async(path,options)=>{calls.push({path,options});return{ok:true,json:async()=>({ok:true,message})}};
  h.run("token='stale-session';document.getElementById('safety-username').value=' sam ';document.getElementById('safety-pin').value='654321';openSafetyPinReset();document.getElementById('safety-username').value='other'");
  await h.run('sendSafetyPinReset()');assert.equal(calls.length,1);assert.equal(calls[0].path,'/passcode-reset-request');assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body),{username:'sam'});assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(h.run("document.getElementById('safety-reset-status').textContent"),message);
  assert.equal(h.run("document.getElementById('safety-reset-send').hidden"),true);assert.equal(h.run("document.getElementById('safety-reset-cancel').textContent"),'Back to sign in');
  assert.equal(h.run("document.getElementById('safety-pin').value"),'');assert.equal(h.run('busy'),false);
 }
});
test('pending Safety reset prevents duplicate requests and sign-in, and restores controls afterward',async()=>{
 const h=resetDialogHarness();let calls=0,resolve;h.context.fetch=()=>{calls++;return new Promise(done=>resolve=done)};
 h.run("document.getElementById('safety-username').value='sam';openSafetyPinReset()");const pending=h.run('sendSafetyPinReset()');
 assert.equal(h.run('busy'),true);assert.equal(h.run("document.getElementById('safety-reset-send').disabled"),true);assert.equal(h.run("document.getElementById('safety-login-button').disabled"),true);
 await h.run('sendSafetyPinReset()');await h.run('signInSafety()');assert.equal(calls,1);
 resolve({ok:true,json:async()=>({ok:true})});await pending;
 assert.equal(h.run('busy'),false);assert.equal(h.run("document.getElementById('safety-login-button').disabled"),false);assert.equal(h.run("document.getElementById('safety-forgot-pin').disabled"),false);
});
test('Safety reset shows failures without reporting success and allows retry while preserving the username',async()=>{
 for(const response of [{ok:false,json:async()=>({error:'Too many attempts. Try again later.'})},{ok:true,json:async()=>{throw Error('Invalid JSON')}},null]){
  const h=resetDialogHarness();h.context.fetch=async()=>{if(!response)throw Error('Could not reach the server');return response};
  h.run("document.getElementById('safety-username').value='sam';openSafetyPinReset()");await h.run('sendSafetyPinReset()');
  assert.match(h.run("document.getElementById('safety-reset-status').className"),/safety-reset-error/);
  assert.doesNotMatch(h.run("document.getElementById('safety-reset-status').textContent"),/will be sent/);
  assert.equal(h.run("document.getElementById('safety-reset-send').hidden"),false);assert.equal(h.run("document.getElementById('safety-reset-send').disabled"),false);
  assert.equal(h.run("document.getElementById('safety-username').value"),'sam');assert.equal(h.run('busy'),false);
 }
});
