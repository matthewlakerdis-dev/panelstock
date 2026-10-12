import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildToolboxPage} from '../src/toolbox-page.js';
import {TOOLBOX_DEFAULTS} from '../src/toolbox.js';

function harness(search=''){
 const cache=new Map(),session=new Map(),elements=new Map();let username='supervisor';
 const element=()=>({style:{},classList:{add(){},remove(){}},addEventListener(){},innerHTML:'',textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this.attributes[k]},insertAdjacentElement(){},querySelectorAll(){return []},focus(){context.focused=this},scrollIntoView(){context.scrolled=this}});
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,URLSearchParams,location:{search,hash:'',pathname:'/toolbox'},setTimeout:()=>1,clearTimeout(){},confirm:()=>true,
  sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},
  window:{scrollY:0,scrollX:0,scrollTo(position){this.scrollY=position.top;this.scrollX=position.left}},document:{createElement:()=>element(),getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],querySelector:()=>element()},
  fetch:async path=>({ok:true,json:async()=>path==='/session'?{username,isAdmin:false,taskAccess:{'factory.toolbox':true}}:path==='/toolbox/users'?{users:[{username,displayName:'Supervisor Name'},{username:'worker',displayName:'Worker Name'}]}:path==='/toolbox/templates'?{templates:structuredClone(TOOLBOX_DEFAULTS),revision:1}:path==='/toolbox/list'?{records:[{id:'summary-only',date:'2026-10-13',people:[],actions:[]}],total:1,offset:0,nextOffset:null,openActions:[],openActionTotal:0,actionNextOffset:null}:{ok:true}})
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

test('Toolbox opens on Home and returning home preserves a draft that can be resumed',async()=>{
 const h=harness();await h.run("token='synthetic';searchTerm='Old search';startSession()");assert.equal(h.run('searchTerm'),'');assert.equal(h.run('page'),'home');assert.match(h.run("document.getElementById('main').innerHTML"),/Toolbox home|Start daily pre-start|Start weekly talk/);assert.doesNotMatch(h.run('homeHTML()'),/Resume draft/);
 h.run("newTalk('weekly');field('site','Frame workshop');field('focus','Welding fumes')");const id=h.run('state.draft.id');await h.run('refreshHome()');assert.equal(h.run('page'),'home');assert.match(h.run('homeHTML()'),/Resume draft/);assert.equal(h.run('state.draft.id'),id);h.run("view('talk')");assert.equal(h.run('state.draft.focus'),'Welding fumes');
 h.context.confirm=()=>false;h.run("newTalk('daily')");assert.equal(h.run('state.draft.id'),id);assert.equal(h.run('state.draft.type'),'weekly');h.context.confirm=()=>true;h.run("newTalk('daily')");assert.equal(h.run('state.draft.type'),'daily');assert.notEqual(h.run('state.draft.id'),id);
});
test('Home shows the latest five unfiltered records and action totals without changing record searches',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");const fetch=h.context.fetch;h.context.fetch=async(path,options)=>path==='/toolbox/list'?{ok:true,json:async()=>{assert.deepEqual(JSON.parse(options.body),{offset:0,search:''});return {records:Array.from({length:7},(_,i)=>({id:'record-'+i,type:'daily',date:'2026-10-13',status:'Completed',site:'Workshop '+i,facilitator:'Supervisor',people:[],actions:[]})),total:42,openActionTotal:8,openActions:[{text:'Fix extraction',owner:'Supervisor',due:'2026-10-14',site:'Workshop'}]}}}:fetch(path,options);
 h.run("searchTerm='Welding';totalRecords=1");await h.run('refreshHome()');const html=h.run('homeHTML()');assert.match(html,/>42<|>8<|Fix extraction/);assert.ok(html.indexOf('Workshop 0')<html.indexOf('Workshop 4'));assert.doesNotMatch(html,/Workshop 5|Workshop 6/);assert.equal(h.run('searchTerm'),'Welding');assert.equal(h.run('totalRecords'),1);
});
