import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildToolboxPage} from '../src/toolbox-page.js';
import {handleToolbox} from '../src/toolbox.js';

const signatureImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const users=[
 {username:'supervisor',displayName:'Supervisor Name'},
 {username:'first',displayName:'First Worker'},
 {username:'second',displayName:'Second Worker'},
 {username:'third',displayName:'Third Worker'}
];

function storage(){
 const docs=new Map([['users',Object.fromEntries(users.map(u=>[u.username,{active:true}]))]]);
 return {read:(key,fallback=null)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),ctx:{storage:{transactionSync:fn=>fn()}},audit(){},requireTask(actor){if(!actor.isAdmin&&!actor.tasks?.['factory.toolbox'])throw Object.assign(Error('Forbidden'),{status:403});}};
}

async function saveTeam(store,usernames,username='supervisor'){
 const actor={username,tasks:{'factory.toolbox':true}},current=(await handleToolbox(store,'/toolbox/attendee-defaults','GET',{},actor)).body.defaults;
 return (await handleToolbox(store,'/toolbox/attendee-defaults','POST',{usernames,expectedRevision:current.revision,mutationId:webcrypto.randomUUID()},actor)).body.defaults;
}

function device(store=storage()){
 const cache=new Map(),elements=new Map(),timers=new Map(),requests=[];let serial=0;
 const h={store,cache,requests,username:'supervisor',users:structuredClone(users),defaultReadFailure:null};
 const element=()=>({style:{},classList:{add(){},remove(){}},innerHTML:'',textContent:'',value:'',open:false,attributes:{},listeners:{},
  addEventListener(name,listener){(this.listeners[name]??=[]).push(listener);},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},
  querySelectorAll:()=>[],querySelector:()=>null,focus(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;},toDataURL:()=>signatureImage});
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,URLSearchParams,location:{search:'',hash:'',pathname:'/toolbox'},confirm:()=>true,
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  localStorage:{getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  window:{scrollY:0,scrollX:0,scrollTo(){}},document:{addEventListener(){},createElement:element,querySelector:element,querySelectorAll:()=>[],getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);}},
  fetch:async(path,options={})=>{
   requests.push({path,body:options.body?JSON.parse(options.body):null});
   if(path==='/session')return {ok:true,json:async()=>({username:h.username,isAdmin:false,taskAccess:{'factory.toolbox':true}})};
   if(path==='/toolbox/users')return {ok:true,json:async()=>({users:structuredClone(h.users)})};
   if(path==='/toolbox/safety-documents/summary')return {ok:true,json:async()=>({outstanding:0,assigned:0,completed:0,pending:[]})};
   if(path==='/logout')return {ok:true,json:async()=>({ok:true})};
   if(path==='/toolbox/attendee-defaults'&&!options.body&&h.defaultReadFailure)throw h.defaultReadFailure;
   try{const result=await handleToolbox(store,path,options.method||'GET',options.body?JSON.parse(options.body):{},{username:h.username,tasks:{'factory.toolbox':true}});return {ok:true,status:result.status,json:async()=>result.body};}
   catch(error){if(!error.status)throw error;return {ok:false,status:error.status,json:async()=>({error:error.message})};}
  }
 });
 vm.runInContext(buildToolboxPage().split('<script>')[1].split('</script>')[0],context);
 h.context=context;h.run=code=>vm.runInContext(code,context);h.login=()=>h.run("token='synthetic';startSession()");
 h.draft=()=>JSON.parse(h.run('JSON.stringify(state.draft)'));
 h.options=()=>JSON.parse(h.run('JSON.stringify(talkAttendeePicker.options)'));
 h.pool=()=>JSON.parse(h.run('JSON.stringify(talkAttendeeUsers().map(u=>u.username))'));
 h.selectHTML=i=>h.run(`attendeeSelect(state.draft.people[${i}],${i})`);
 h.openTeam=async()=>{await h.run('openSettings()');h.run('openTalkDefaultTeam()');};
 h.start=async(type,team=['first','second'])=>{if(team!==null)await saveTeam(store,team,h.username);await h.login();await h.run(`newTalk('${type}')`);};
 return h;
}

function dropdownOptions(html){
 return [...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([,attributes,label])=>({value:attributes.match(/\bvalue="([^"]*)"/)?.[1],selected:/\bselected\b/.test(attributes),disabled:/\bdisabled\b/.test(attributes),label}));
}

for(const type of ['daily','weekly'])test(`${type} talks use only the Settings team in attendee dropdowns and omit the bulk chooser`,async()=>{
 const h=device();await h.start(type,['first','third']);
 const html=h.run('talkHTML()');assert.doesNotMatch(html,/Choose attendees|openTalkAttendees\(|talk-attendee-choice/);assert.match(html,/onclick="addAttendee\(\)"/);
 assert.deepEqual(h.pool(),['first','third']);assert.deepEqual(dropdownOptions(h.selectHTML(0)).map(o=>o.value),['','first','third']);
 assert.equal(dropdownOptions(h.selectHTML(0)).find(o=>o.value==='third').disabled,true,'a person in another row cannot be selected twice');
 h.run("removeAttendee(1);addAttendee();selectAttendee(1,'third')");
 assert.deepEqual(h.draft().people.map(p=>p.userUsername),['first','third']);
 assert.equal(h.requests.filter(r=>r.path==='/toolbox/attendee-defaults'&&r.body).length,0);
 assert.equal(await h.run('syncAccountDraft()'),true);
 const resumed=device(h.store);await resumed.login();assert.equal(resumed.draft().id,h.draft().id);
 assert.deepEqual(resumed.pool(),['first','third']);assert.deepEqual(resumed.draft().people.map(p=>p.userUsername),['first','third']);
});

test('Settings search and Select all preserve hidden choices while Clear selection saves an empty team',async()=>{
 const h=device();await h.start('weekly',['supervisor']);const before=h.draft();await h.openTeam();
 h.run("filterTalkAttendees('  wOrKeR  ');selectAllTalkAttendees();toggleTalkAttendee('user:missing',true)");
 assert.deepEqual(h.options().filter(o=>o.selected).map(o=>o.key).sort(),['user:first','user:second','user:supervisor','user:third']);
 h.run("filterTalkAttendees('No matching person');selectAllTalkAttendees()");await h.run('applyTalkAttendees()');
 assert.deepEqual(h.pool().sort(),['first','second','supervisor','third']);assert.deepEqual(h.draft(),before);
 await h.openTeam();h.run("filterTalkAttendees('first');clearTalkAttendees()");await h.run('applyTalkAttendees()');
 assert.deepEqual(h.pool(),[]);assert.deepEqual(h.store.read('toolbox:attendee-defaults:supervisor').usernames,[]);
 assert.deepEqual(h.draft(),before,'clearing Settings never clears the current talk roster');
 await h.run("newTalk('weekly')");assert.deepEqual(h.draft().people,[]);
});

test('Cancel and saving the unchanged Settings team preserve the signed current talk and device cache',async()=>{
 const h=device();await h.start('daily');
 h.run("state.draft.people=[{name:'Original saved name',userUsername:'first',ack:true,signature:{image:'existing signature',contentHash:'existing hash'}}];state.draft.supervisorSignature={image:'supervisor signature'};persist(false);originalPerson=state.draft.people[0]");
 const before=h.draft(),cached=h.cache.get('panelstock-toolbox-v1:supervisor');
 await h.openTeam();h.run("toggleTalkAttendee('user:first',false);toggleTalkAttendee('user:third',true);closeTalkAttendees()");
 assert.deepEqual(h.draft(),before);assert.equal(h.cache.get('panelstock-toolbox-v1:supervisor'),cached);
 await h.openTeam();await h.run('applyTalkAttendees()');
 assert.deepEqual(h.draft(),before);assert.equal(h.cache.get('panelstock-toolbox-v1:supervisor'),cached);assert.equal(h.run('state.draft.people[0]===originalPerson'),true);
});

test('Settings team selection enforces the limit of 60 before saving or adding talk rows',async()=>{
 const h=device();h.users=Array.from({length:61},(_,i)=>({username:'worker'+i,displayName:'Worker '+i}));h.store.write('users',Object.fromEntries(h.users.map(u=>[u.username,{active:true}])));
 await h.start('weekly',[]);const before=h.draft();await h.openTeam();h.run('selectAllTalkAttendees()');
 assert.equal(h.options().filter(o=>o.selected).length,0);assert.match(h.run("document.getElementById('talk-attendees-error').textContent"),/60/);
 h.run('talkAttendeePicker.options.forEach(o=>o.selected=true)');await h.run('applyTalkAttendees()');
 assert.deepEqual(h.draft(),before);assert.equal(h.requests.filter(r=>r.path==='/toolbox/attendee-defaults'&&r.body).length,0);
 h.run("clearTalkAttendees();for(let i=0;i<60;i++)toggleTalkAttendee('user:worker'+i,true)");await h.run('applyTalkAttendees()');
 assert.equal(h.store.read('toolbox:attendee-defaults:supervisor').usernames.length,60);assert.equal(h.pool().length,60);
 await h.run("newTalk('daily')");assert.equal(h.draft().people.length,60);h.run('addAttendee()');assert.equal(h.draft().people.length,60);
});

test('outside-team, unknown and duplicate dropdown choices preserve signatures and the device cache',async()=>{
 const h=device();await h.start('weekly');
 h.run("state.draft.people[0].signature={image:'first signed'};state.draft.people[0].ack=true;state.draft.people[1].signature={image:'second signed'};state.draft.people[1].ack=true;state.draft.supervisorSignature={image:'supervisor signed'};persist(false)");
 const before=h.draft(),cached=h.cache.get('panelstock-toolbox-v1:supervisor');
 for(const username of ['third','missing','second','first']){
  h.run(`selectAttendee(0,${JSON.stringify(username)})`);assert.deepEqual(h.draft(),before,username);assert.equal(h.cache.get('panelstock-toolbox-v1:supervisor'),cached,username);
 }
 assert.doesNotMatch(h.selectHTML(0),/value="third"|value="supervisor"/);
 const mounted=dropdownOptions(h.run("document.getElementById('attendee0').innerHTML"));
 assert.deepEqual(mounted.map(o=>o.value),['','first','second']);assert.equal(mounted.find(o=>o.value==='first').selected,true);
});

test('busy, completed, pending and unauthorized talks reject Add and dropdown changes',async()=>{
 for(const change of ["busy=true","state.draft.status='Completed'","state.draft.pendingSave={}","actor.canRunToolbox=false"]){
  const h=device();await h.start('daily');h.run("state.draft.people[0].signature={image:'signed'};state.draft.people[0].ack=true;state.draft.supervisorSignature={image:'supervisor signed'}");h.run(change);
  const before=h.draft(),cached=h.cache.get('panelstock-toolbox-v1:supervisor');
  h.run("addAttendee();selectAttendee(0,'');selectAttendee(-1,'first');selectAttendee(99,'second')");
  assert.deepEqual(h.draft(),before,change);assert.equal(h.cache.get('panelstock-toolbox-v1:supervisor'),cached,change);
 }
 const h=device();await h.start('daily');const before=h.draft();
 h.run("selectAttendee(-1,'first');selectAttendee(99,'second')");assert.deepEqual(h.draft(),before);
});

test('configured accounts absent from the active directory cannot appear as new dropdown choices',async()=>{
 const h=device();h.users=h.users.filter(u=>u.username!=='first');await h.start('weekly',['first','second']);
 assert.deepEqual(h.pool(),['second']);assert.deepEqual(h.draft().people.map(p=>p.userUsername),['second']);
 assert.deepEqual(dropdownOptions(h.selectHTML(0)).map(o=>o.value),['','second']);
 const before=h.draft();h.run("selectAttendee(0,'first')");assert.deepEqual(h.draft(),before);
});

test('saved out-of-team accounts and legacy names stay visible only in their existing row',async()=>{
 const h=device();await h.start('weekly',['second']);
 h.run("state.draft.people=[{name:'Original saved name',userUsername:'first',ack:false,signature:null},{name:'Former employee',userUsername:'departed',employer:'Original company',ack:false,signature:null},{name:'Guest',employer:'Contractor',ack:false,signature:null}];savedPeople=state.draft.people.slice();view('talk')");
 for(const [i,name] of ['Original saved name','Former employee','Guest'].entries()){
  const options=dropdownOptions(h.selectHTML(i)),saved=options.find(o=>o.selected);
  assert.equal(saved.disabled,true);assert.ok(saved.label.includes(name));assert.deepEqual(options.filter(o=>o.value).filter(o=>!o.disabled).map(o=>o.value),['second']);
 }
 h.run("addAttendee();selectAttendee(3,'first')");assert.equal(h.draft().people[3].name,'');
 h.run("selectAttendee(3,'second')");assert.equal(h.run('state.draft.people.slice(0,3).every((p,i)=>p===savedPeople[i])'),true);
 assert.deepEqual(h.draft().people.map(p=>p.name),['Original saved name','Former employee','Guest','Second Worker']);
 assert.equal(await h.run('syncAccountDraft()'),true);const resumed=device(h.store);await resumed.login();
 assert.deepEqual(resumed.draft().people.map(p=>p.name),['Original saved name','Former employee','Guest','Second Worker']);assert.equal(resumed.draft().people[2].employer,'Contractor');
});

for(const type of ['daily','weekly'])test(`${type} signed attendees outside a changed team survive additions, sync, resume and completion`,async()=>{
 const h=device();await h.start(type);
 h.run("field('site','Workshop');field('focus','Guarding');topic(0,'notes','Work safely');if(state.draft.prestart)prestartYesAll();prepareDiscussion();ink=true;signing=0");
 await h.run('saveSignature()');h.run('ink=true;signing=1');await h.run('saveSignature()');h.run("ink=true;signing='supervisor'");await h.run('saveSignature()');
 const signed=h.draft().people,before=h.draft();await saveTeam(h.store,['third']);await h.run('openSettings()');
 assert.deepEqual(h.draft(),before);assert.deepEqual(h.pool(),['third']);h.run("view('talk')");
 assert.equal(dropdownOptions(h.selectHTML(0)).find(o=>o.selected).disabled,true);
 h.run("addAttendee();selectAttendee(2,'third')");assert.deepEqual(h.draft().people.slice(0,2),signed);assert.equal(h.draft().supervisorSignature,null);
 assert.equal(h.draft().people[2].ack,false);assert.equal(h.draft().people[2].signature,null);assert.equal(await h.run('syncAccountDraft()'),true);
 const resumed=device(h.store);await resumed.login();assert.deepEqual(resumed.draft().people.slice(0,2).map(p=>p.signature),signed.map(p=>p.signature));
 resumed.run("view('talk');ink=true;signing=2");await resumed.run('saveSignature()');resumed.run("ink=true;signing='supervisor'");await resumed.run('saveSignature()');
 const id=resumed.draft().id;await resumed.run('saveRecord(true)');const completed=h.store.read('toolbox:record:'+id);
 assert.equal(completed.status,'Completed');assert.deepEqual(completed.people.map(p=>p.userUsername),['first','second','third']);assert.deepEqual(completed.people.slice(0,2).map(p=>p.signature),signed.map(p=>p.signature));
});

test('normal dropdown changes preserve the hash and roster snapshot of legacy signed attendance',async()=>{
 const h=device();await h.start('daily',['first','second','third']);h.run("removeAttendee(2);field('site','Workshop');topic(0,'notes','Cut frames');prestartYesAll();prepareDiscussion()");
 await h.run(`(async()=>{const signature={image:${JSON.stringify(signatureImage)},at:new Date().toISOString(),contentHash:await contentHash(state.draft)};state.draft.people[0].signature=signature;state.draft.people[0].ack=true;state.draft.supervisorSignature={...signature};})()`);
 const signature=h.draft().people[0].signature,roster=h.run('JSON.stringify(state.draft.people.map(toolboxAttendeeSnapshot))');
 h.run("selectAttendee(1,'third')");assert.deepEqual(h.draft().people[0].signature,{...signature,attendeeRoster:JSON.parse(roster)});
 assert.equal(h.draft().supervisorSignature,null);assert.equal(h.draft().people[0].ack,true);assert.equal(await h.run('syncAccountDraft()'),true);
 assert.deepEqual(h.store.read('toolbox:record:'+h.draft().id).people[0].signature,h.draft().people[0].signature);
});

test('unset, empty and unavailable teams never expose the full directory or permit added attendees',async()=>{
 for(const mode of ['unset','empty','unavailable']){
  const h=device();if(mode==='unavailable')h.defaultReadFailure=Error('Defaults unavailable');await h.start('daily',mode==='empty'?[]:null);
  assert.deepEqual(h.pool(),[],mode);const before=h.draft(),cached=h.cache.get('panelstock-toolbox-v1:supervisor');h.run('addAttendee()');
  assert.deepEqual(h.draft(),before,mode);assert.equal(h.cache.get('panelstock-toolbox-v1:supervisor'),cached,mode);assert.match(h.run("document.getElementById('message').textContent"),/settings/i);
  h.run("state.draft.people=[{name:'',userUsername:'',ack:false,signature:null}]");const blank=h.draft();assert.deepEqual(dropdownOptions(h.selectHTML(0)).filter(o=>o.value),[]);
  h.run("selectAttendee(0,'first')");assert.deepEqual(h.draft(),blank,mode);
 }
});

test('switching accounts clears the previous dropdown team, including when the new account defaults fail',async()=>{
 const h=device();await h.start('weekly',['first']);await saveTeam(h.store,['third'],'other');
 h.username='other';await h.login();assert.deepEqual(h.pool(),['third']);
 h.run("view('talk');addAttendee()");assert.deepEqual(dropdownOptions(h.selectHTML(0)).map(o=>o.value),['','third']);
 const before=h.draft();h.run("selectAttendee(0,'first')");assert.deepEqual(h.draft(),before);
 h.defaultReadFailure=Error('Defaults unavailable');h.username='supervisor';await h.login();assert.deepEqual(h.pool(),[]);
});

test('Settings selection is unavailable from talks and stale account or navigation cannot save it',async()=>{
 const h=device();await h.start('daily');h.run('openTalkDefaultTeam()');assert.equal(h.run('talkAttendeePicker'),null);
 for(const change of ["view('talk')","actor.username='other'","actor.canRunToolbox=false","busy=true"]){
  const d=device();await d.start('daily');await d.openTeam();d.run("toggleTalkAttendee('user:third',true)");d.run(change);const before=d.draft();await d.run('applyTalkAttendees()');
  assert.deepEqual(d.draft(),before);assert.equal(d.requests.filter(r=>r.path==='/toolbox/attendee-defaults'&&r.body).length,0,change);
 }
});
