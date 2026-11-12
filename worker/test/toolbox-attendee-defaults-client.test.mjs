import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildToolboxPage} from '../src/toolbox-page.js';
import {handleToolbox} from '../src/toolbox.js';

const signatureImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const directory=[
 {username:'supervisor',displayName:'Supervisor Name'},
 {username:'other',displayName:'Other Supervisor'},
 {username:'first',displayName:'First Worker'},
 {username:'second',displayName:'Second Worker'},
 {username:'third',displayName:'Third Worker'}
];
const actor=username=>({username,tasks:{'factory.toolbox':true}});

function storage(){
 const docs=new Map([['users',Object.fromEntries(directory.map(u=>[u.username,{active:true}]))]]);
 return {read:(key,fallback=null)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),ctx:{storage:{transactionSync:fn=>fn()}},audit(){},requireTask(user){if(!user.isAdmin&&!user.tasks?.['factory.toolbox'])throw Object.assign(Error('Forbidden'),{status:403});}};
}

async function defaults(store,username='supervisor'){
 return (await handleToolbox(store,'/toolbox/attendee-defaults','GET',{},actor(username))).body.defaults;
}

async function saveDefaults(store,usernames,username='supervisor'){
 const current=await defaults(store,username);
 return (await handleToolbox(store,'/toolbox/attendee-defaults','POST',{usernames,expectedRevision:current.revision,mutationId:webcrypto.randomUUID()},actor(username))).body.defaults;
}

function device(store=storage(),username='supervisor'){
 const cache=new Map(),elements=new Map(),timers=new Map(),requests=[];let serial=0;
 const h={store,cache,requests,username,admin:false,taskAllowed:true,safetySelfOnly:false,users:structuredClone(directory),defaultFailure:null,dropDefaultResponse:false,defaultGate:null,defaultReadGate:null,defaultReadStarted:null};
 const element=()=>({style:{},classList:{add(){},remove(){}},innerHTML:'',textContent:'',value:'',checked:false,open:false,attributes:{},listeners:{},
  addEventListener(name,listener){(this.listeners[name]??=[]).push(listener);},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},
  querySelectorAll:()=>[],querySelector:()=>null,focus(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;},toDataURL:()=>signatureImage});
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,URLSearchParams,location:{search:'',hash:'',pathname:'/toolbox'},confirm:()=>true,
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  localStorage:{getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  window:{scrollY:0,scrollX:0,scrollTo(){}},document:{addEventListener(){},createElement:element,querySelector:element,querySelectorAll:()=>[],getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);}},
  fetch:async(path,options={})=>{
   const packet=options.body?JSON.parse(options.body):undefined,requestActor={...actor(h.username),isAdmin:h.admin};requests.push({path,packet,username:h.username});
   if(path==='/session')return {ok:true,json:async()=>({username:h.username,isAdmin:h.admin,safetySelfOnly:h.safetySelfOnly,taskAccess:{'factory.toolbox':h.taskAllowed}})};
   if(path==='/toolbox/users'||path==='/toolbox/self/users')return {ok:true,json:async()=>({users:structuredClone(h.users)})};
   if(path==='/toolbox/safety-documents/summary'||path==='/toolbox/self/safety-documents/summary')return {ok:true,json:async()=>({outstanding:0,assigned:0,completed:0,pending:[]})};
   if(path==='/logout')return {ok:true,json:async()=>({ok:true})};
   const savingDefaults=path==='/toolbox/attendee-defaults'&&!!packet;
   if(path==='/toolbox/attendee-defaults'&&!packet&&h.defaultReadGate){h.defaultReadStarted?.();await h.defaultReadGate;}
   if(savingDefaults&&h.defaultFailure)throw h.defaultFailure;
   if(savingDefaults&&h.defaultGate)await h.defaultGate;
   try{
    const result=await handleToolbox(store,path,options.method||'GET',packet||{},requestActor);
    if(savingDefaults&&h.dropDefaultResponse){h.dropDefaultResponse=false;throw Error('Default response lost');}
    return {ok:true,status:result.status,json:async()=>result.body};
   }catch(error){if(!error.status)throw error;return {ok:false,status:error.status,json:async()=>({error:error.message})};}
  }
 });
 vm.runInContext(buildToolboxPage().split('<script>')[1].split('</script>')[0],context);
 h.context=context;h.run=code=>vm.runInContext(code,context);h.login=()=>h.run("token='synthetic';startSession()");
 h.draft=()=>JSON.parse(h.run('JSON.stringify(state.draft)'));
 h.selected=()=>JSON.parse(h.run('JSON.stringify(talkAttendeePicker.options.filter(o=>o.selected).map(o=>o.key))'));
 h.posts=()=>requests.filter(r=>r.path==='/toolbox/attendee-defaults'&&r.packet);
 h.holdDefaultRead=()=>{
  let release,started;const entered=new Promise(resolve=>started=resolve);
  h.defaultReadGate=new Promise(resolve=>release=resolve);h.defaultReadStarted=started;
  return {entered,release(){h.defaultReadGate=null;h.defaultReadStarted=null;release();}};
 };
 h.choose=async(usernames,save=true)=>{
  if(save){await h.run('openSettings()');await h.run('openTalkDefaultTeam()');}else h.run("view('talk');openTalkAttendees()");
  h.run(`clearTalkAttendees();${usernames.map(username=>`toggleTalkAttendee(${JSON.stringify('user:'+username)},true);`).join('')}`);
 };
 return h;
}

test('saving a default team carries across devices and starts independent unsigned daily and weekly talks',async()=>{
 const h=device();await h.login();const before=h.draft();await h.choose(['first','second']);await h.run('applyTalkAttendees()');
 assert.deepEqual((await defaults(h.store)).usernames,['first','second']);
 assert.deepEqual(h.draft(),before,'saving Settings defaults does not edit the current talk');
 assert.equal(h.posts().length,1);
 const otherDevice=device(h.store);await otherDevice.login();
 for(const type of ['daily','weekly']){
  await otherDevice.run(`newTalk('${type}')`);
  assert.equal(otherDevice.draft().type,type);
  assert.deepEqual(otherDevice.draft().people.map(({name,userUsername,ack,signature})=>({name,userUsername,ack,signature})),[
   {name:'First Worker',userUsername:'first',ack:false,signature:null},
   {name:'Second Worker',userUsername:'second',ack:false,signature:null}
  ]);
  assert.equal(otherDevice.draft().supervisorSignature,null);
 }
 otherDevice.run('previous=state.draft');await otherDevice.run("newTalk('daily')");
 otherDevice.run("previous.people[0].name='Only the old talk';previous.people[0].ack=true;previous.people[0].signature={image:'old signature'}");
 assert.equal(otherDevice.draft().people[0].name,'First Worker');assert.equal(otherDevice.draft().people[0].ack,false);assert.equal(otherDevice.draft().people[0].signature,null);
 const otherAccount=device(h.store,'other');await otherAccount.login();
 assert.deepEqual(otherAccount.draft().people,[]);assert.deepEqual((await defaults(h.store,'other')).usernames,[]);
});

test('loading personal defaults keeps an untouched login placeholder out of saved drafts',async()=>{
 const store=storage();await saveDefaults(store,['first','second']);const h=device(store);await h.login();
 assert.deepEqual(h.draft().people,[]);assert.equal(h.run('hasDeviceDraft()'),false);
 assert.equal(await h.run('syncAccountDraft()'),true);assert.deepEqual(store.read('toolbox:index',[]),[]);
 await h.run("newTalk('daily')");assert.deepEqual(h.draft().people.map(p=>p.userUsername),['first','second']);
});

test('a per-talk attendee change leaves the saved default team unchanged and the next talk uses the default',async()=>{
 const store=storage();await saveDefaults(store,['first','second']);const h=device(store);await h.login();
 await h.choose(['third'],false);await h.run('applyTalkAttendees()');
 assert.deepEqual(h.draft().people.map(p=>p.userUsername),['third']);assert.equal(h.posts().length,0);
 assert.deepEqual((await defaults(store)).usernames,['first','second']);
 await h.run("newTalk('weekly')");assert.deepEqual(h.draft().people.map(p=>p.userUsername),['first','second']);
});

for(const type of ['daily','weekly'])test(`${type} Add attendee keeps signed attendance and the saved default team`,async()=>{
 const store=storage();await saveDefaults(store,['first']);const h=device(store);await h.login();await h.run(`newTalk('${type}')`);
 const html=h.run('talkHTML()');assert.match(html,/<button[^>]*id="add-attendee"[^>]*onclick="addAttendee\(\)"[^>]*>\+\s*Add attendee<\/button>/);
 assert.doesNotMatch(html,/talk-attendees-default|Use this team by default/);
 h.run("field('site','Workshop');field('focus','Safe lifting');topic(0,'notes','Lift safely');if(state.draft.prestart)prestartYesAll();prepareDiscussion();ink=true;signing=0");await h.run('saveSignature()');
 h.run("ink=true;signing='supervisor'");await h.run('saveSignature()');const signed=h.draft().people[0];
 h.run("originalSignedPerson=state.draft.people[0];addAttendee();selectAttendee(1,'second')");
 assert.equal(h.run('state.draft.people[0]===originalSignedPerson'),true);assert.deepEqual(h.draft().people[0],signed);
 assert.deepEqual(h.draft().people[1],{name:'Second Worker',userUsername:'second',ack:false,signature:null});assert.equal(h.draft().supervisorSignature,null);
 assert.equal(h.posts().length,0);assert.deepEqual((await defaults(store)).usernames,['first']);
 assert.equal(await h.run('syncAccountDraft()'),true);const persisted=store.read('toolbox:record:'+h.draft().id).people[0];
 assert.deepEqual(persisted.signature,signed.signature);assert.equal(persisted.ack,true);assert.equal(persisted.userUsername,'first');
 await h.run(`newTalk('${type}')`);assert.deepEqual(h.draft().people.map(p=>p.userUsername),['first']);assert.equal(h.draft().people[0].signature,null);
});

test('supervisors manage their default team in Settings without fetching or exposing admin email controls',async()=>{
 const h=device();await h.login();assert.equal(h.run("document.getElementById('nav-settings').hidden"),false);await h.run('openSettings()');
 const mounted=h.run("document.getElementById('main').innerHTML");
 assert.match(mounted,/id="talk-default-team-settings"/);assert.match(mounted,/openTalkDefaultTeam\(\)/);
 assert.doesNotMatch(mounted,/Recipient emails|email-enabled|toolbox-email-settings/);
 assert.doesNotMatch(h.run("document.getElementById('message').textContent"),/Administrator access required/i);
 assert.equal(h.run('page'),'settings');assert.match(h.run('settingsHTML()'),/default team/i);assert.match(h.run('settingsHTML()'),/openTalkDefaultTeam\(\)/);
 h.run("emailSettings={config:{enabled:true,recipients:['private-office@example.com'],revision:7},jobs:[],providerReady:true,sender:'Private sender'}");
 assert.doesNotMatch(h.run('settingsHTML()'),/Recipient emails|email-enabled|saveEmailSettings|Recent email deliveries|private-office@example.com|Private sender/);
 await h.run('saveEmailSettings()');await h.run("retryEmail('private-delivery')");
 assert.deepEqual(h.requests.filter(r=>r.path==='/toolbox/email-settings'||r.path==='/toolbox/email-retry'),[]);
});

test('self-service sessions hide Settings and cannot render or open default-team controls',async()=>{
 for(const permissions of [{taskAllowed:false,safetySelfOnly:false},{taskAllowed:true,safetySelfOnly:true}]){
  const h=device();Object.assign(h,permissions);await h.login();
  assert.equal(h.run('actor.canRunToolbox'),false);assert.equal(h.run("document.getElementById('nav-settings').hidden"),true);
  const before=h.run("document.getElementById('main').innerHTML");
  await h.run('openSettings()');assert.equal(h.run("document.getElementById('main').innerHTML"),before);
  h.run("view('settings');openTalkDefaultTeam()");
  assert.equal(h.run("document.getElementById('main').innerHTML"),before);assert.equal(h.run('talkAttendeePicker'),null);
  assert.doesNotMatch(h.run("document.getElementById('main').innerHTML"),/talk-default-team-settings|openTalkDefaultTeam\(\)/);
  assert.deepEqual(h.requests.filter(r=>r.path==='/toolbox/attendee-defaults'||r.path==='/toolbox/email-settings'),[]);
 }
});

test('Settings selects the saved default team independently of current talk attendees',async()=>{
 const store=storage();await saveDefaults(store,['second']);const h=device(store);await h.login();await h.choose(['first'],false);await h.run('applyTalkAttendees()');
 const before=h.draft();await h.run('openSettings()');h.run('openTalkDefaultTeam()');
 assert.deepEqual(h.selected(),['user:second']);assert.equal(h.run("document.getElementById('talk-attendees-title').textContent"),'Choose default team');
 assert.equal(h.run("document.getElementById('talk-attendees-apply').textContent"),'Save default team');assert.deepEqual(h.draft(),before);
 h.run('closeTalkAttendees()');
});

test('admins can save default teams without replacing their unsaved email settings form',async()=>{
 const h=device();h.admin=true;await h.login();await h.run('openSettings()');
 assert.match(h.run('settingsHTML()'),/Recipient emails/);assert.match(h.run('settingsHTML()'),/openTalkDefaultTeam\(\)/);
 h.run("document.getElementById('email-enabled').checked=true;document.getElementById('email-recipients').value='unsaved@example.com';document.getElementById('main').innerHTML='Unsaved email controls sentinel';openTalkDefaultTeam();clearTalkAttendees();toggleTalkAttendee('user:first',true)");
 await h.run('applyTalkAttendees()');
 assert.deepEqual((await defaults(h.store)).usernames,['first']);assert.equal(h.run("document.getElementById('main').innerHTML"),'Unsaved email controls sentinel');
 assert.equal(h.run("document.getElementById('email-enabled').checked"),true);assert.equal(h.run("document.getElementById('email-recipients').value"),'unsaved@example.com');
 assert.equal(h.requests.filter(r=>r.path==='/toolbox/email-settings'&&r.packet).length,0);
});

test('stale or unauthorized Settings selections cannot save a default team',async()=>{
 for(const change of ["view('home')","actor.username='other'","actor.canRunToolbox=false"]){
  const h=device();await h.login();await h.choose(['second'],true);h.run(change);const before=h.draft();await h.run('applyTalkAttendees()');
  assert.deepEqual(h.draft(),before,change);assert.equal(h.posts().length,0,change);assert.deepEqual((await defaults(h.store)).usernames,[],change);
 }
 const h=device();await h.login();h.run("actor.canRunToolbox=false;document.getElementById('main').innerHTML='Restricted view'");await h.run('openSettings()');
 h.run('openTalkDefaultTeam()');assert.equal(h.run('talkAttendeePicker'),null);assert.equal(h.run("document.getElementById('main').innerHTML"),'Restricted view');
});

test('a Settings default refresh does not reopen Settings after navigation',async()=>{
 const h=device();await h.login();const paused=h.holdDefaultRead(),opening=h.run('openSettings()');await paused.entered;
 h.run("view('talk');field('site','Work continued while settings loaded')");const before=h.draft();paused.release();await opening;
 assert.equal(h.run('page'),'talk');assert.deepEqual(h.draft(),before);
});

test('saving an empty default team clears automatic attendees for future talks',async()=>{
 const store=storage();await saveDefaults(store,['first']);const h=device(store);await h.login();await h.run("newTalk('daily')");
 assert.deepEqual(h.draft().people.map(p=>p.userUsername),['first']);const before=h.draft();await h.choose([],true);await h.run('applyTalkAttendees()');
 assert.deepEqual(h.draft(),before);assert.deepEqual((await defaults(store)).usernames,[]);
 assert.equal((await defaults(store)).revision,2);await h.run("newTalk('weekly')");assert.deepEqual(h.draft().people,[]);
});

test('personal defaults replace admin-template attendees for a new talk while editing retains the template team',async()=>{
 for(const personal of [null,['first'],[]]){
  const store=storage();if(personal)await saveDefaults(store,personal);const h=device(store);await h.login();
  h.run("state.draft=fresh('weekly')");const record=h.draft();record.site='Admin workshop';record.people=[{name:'Template Worker',userUsername:'third',ack:false,signature:null}];
  const id=webcrypto.randomUUID();await handleToolbox(store,'/toolbox/admin-drafts','POST',{id,title:'Prepared weekly talk',record,expectedRevision:0,mutationId:webcrypto.randomUUID()},{username:'supervisor',isAdmin:true});
  await h.run(`useAdminDraft('${id}')`);
  assert.deepEqual(h.draft().people.map(p=>p.userUsername),personal===null?['third']:personal);
  assert.equal(h.draft().site,'Admin workshop');assert.ok(h.draft().people.every(p=>!p.ack&&p.signature===null));
  h.admin=true;h.run('actor.isAdmin=true');await h.run(`useAdminDraft('${id}',true)`);
  assert.deepEqual(h.draft().people.map(p=>p.userUsername),['third']);
  assert.deepEqual(store.read('toolbox:admin-draft:'+id).content.people,[{name:'Template Worker',userUsername:'third'}]);
 }
});

test('loading a new default never replaces attendees or signatures in an existing saved draft',async()=>{
 const store=storage(),original=device(store);await original.login();
 await original.choose(['first'],false);await original.run('applyTalkAttendees()');
 original.run("field('site','Workshop');topic(0,'notes','Guard moving machinery');prestartYesAll();ink=true;signing=0");await original.run('saveSignature()');
 original.run("ink=true;signing='supervisor'");await original.run('saveSignature()');assert.equal(await original.run('syncAccountDraft()'),true);
 const saved=store.read('toolbox:record:'+original.draft().id);await saveDefaults(store,['second','third']);
 const resumed=device(store);await resumed.login();
 assert.equal(resumed.draft().id,saved.id);assert.deepEqual(resumed.draft().people,saved.people);assert.deepEqual(resumed.draft().supervisorSignature,saved.supervisorSignature);
 assert.deepEqual(store.read('toolbox:record:'+saved.id).people,saved.people);
 await resumed.run("newTalk('weekly')");assert.deepEqual(resumed.draft().people.map(p=>p.userUsername),['second','third']);
 assert.ok(resumed.draft().people.every(p=>!p.ack&&p.signature===null));assert.equal(resumed.draft().supervisorSignature,null);
});

test('Cancel from Settings saves neither the pending default nor any current draft changes',async()=>{
 const store=storage();await saveDefaults(store,['first']);const h=device(store);await h.login();const before=h.draft();
 await h.choose(['second'],true);h.run('closeTalkAttendees()');
 assert.deepEqual(h.draft(),before);assert.equal(h.posts().length,0);assert.deepEqual((await defaults(store)).usernames,['first']);
});

test('saving a different default team in Settings preserves the current signed roster and supervisor sign-off',async()=>{
 const h=device();await h.login();await h.choose(['first'],false);await h.run('applyTalkAttendees()');
 h.run("field('site','Workshop');topic(0,'notes','Safe lifting');prestartYesAll();ink=true;signing=0");await h.run('saveSignature()');h.run("ink=true;signing='supervisor'");await h.run('saveSignature()');
 const before=h.draft(),cached=h.cache.get('panelstock-toolbox-v1:supervisor');await h.choose(['second','third'],true);await h.run('applyTalkAttendees()');
 assert.deepEqual(h.draft(),before);assert.equal(h.cache.get('panelstock-toolbox-v1:supervisor'),cached);
 assert.deepEqual((await defaults(h.store)).usernames,['second','third']);
});

test('network and revision failures retain the current talk and pending default selection for recovery',async()=>{
 for(const failure of ['network','conflict']){
  const store=storage();await saveDefaults(store,['first']);const h=device(store);await h.login();const before=h.draft();
  await h.choose(['second'],true);
  if(failure==='network')h.defaultFailure=Error('Network unavailable');else await saveDefaults(store,['third']);
  await h.run('applyTalkAttendees()');
  assert.deepEqual(h.draft(),before,failure);assert.deepEqual(h.selected(),['user:second']);
  assert.equal(h.run("document.getElementById('talk-attendees-dialog').open"),true);
  assert.match(h.run("document.getElementById('talk-attendees-error').textContent"),failure==='network'?/Network unavailable/:/changed|revision|conflict/i);
  if(failure==='network'){
   h.defaultFailure=null;await h.run('applyTalkAttendees()');
   assert.deepEqual(h.draft(),before);assert.deepEqual((await defaults(store)).usernames,['second']);
  }else assert.deepEqual((await defaults(store)).usernames,['third']);
 }
});

test('an uncertain default save retries its immutable packet before saving later checkbox changes',async()=>{
 const h=device();await h.login();await h.choose(['first'],true);h.dropDefaultResponse=true;await h.run('applyTalkAttendees()');
 assert.deepEqual(h.draft().people,[]);assert.deepEqual((await defaults(h.store)).usernames,['first']);
 const firstPacket=structuredClone(h.posts()[0].packet);
 h.run("toggleTalkAttendee('user:first',false);toggleTalkAttendee('user:second',true)");await h.run('applyTalkAttendees()');
 assert.deepEqual(h.posts()[1].packet,firstPacket);
 assert.deepEqual(h.posts().at(-1).packet.usernames,['second']);assert.equal(h.posts().at(-1).packet.expectedRevision,1);
 assert.deepEqual((await defaults(h.store)).usernames,['second']);assert.deepEqual(h.draft().people,[]);
});

test('a late default save response cannot change the newly signed-in account or its new talks',async()=>{
 const h=device();await h.login();await h.choose(['first'],true);let release;h.defaultGate=new Promise(resolve=>release=resolve);
 const saving=h.run('applyTalkAttendees()');await Promise.resolve();
 h.username='other';await h.login();const before=h.draft();h.defaultGate=null;release();await saving;
 assert.deepEqual(h.draft(),before);assert.equal(h.run('actor.username'),'other');assert.deepEqual(h.draft().people,[]);
 h.run("state.draft=fresh('weekly')");assert.deepEqual(h.draft().people,[]);
 assert.deepEqual((await defaults(h.store,'other')).usernames,[]);assert.deepEqual((await defaults(h.store)).usernames,['first']);
});

test('a delayed new-talk default refresh preserves a replaced draft, newer typing or navigation',async()=>{
 for(const change of ["state.draft=fresh('daily');field('site','Replacement draft')","field('site','New typing while defaults load')","view('home')"]){
  const store=storage();await saveDefaults(store,['first']);const h=device(store);await h.login();h.run("view('talk')");
  const paused=h.holdDefaultRead(),starting=h.run("newTalk('weekly')");await paused.entered;
  assert.equal(h.run('busy'),true,'the old talk is locked during the default refresh');
  h.run(change);const before=h.draft(),openedPage=h.run('page');paused.release();await starting;
  assert.deepEqual(h.draft(),before,change);assert.equal(h.run('page'),openedPage,change);assert.equal(h.run('busy'),false);
 }
});

test('overlapping new-talk requests cannot replace the first requested talk during a default refresh',async()=>{
 const store=storage();await saveDefaults(store,['first']);const h=device(store);await h.login();const previousId=h.draft().id;
 const readsBefore=h.requests.filter(r=>r.path==='/toolbox/attendee-defaults'&&!r.packet).length;
 const paused=h.holdDefaultRead(),first=h.run("newTalk('daily')");await paused.entered;
 await h.run("newTalk('weekly')");assert.equal(h.draft().id,previousId);
 assert.equal(h.requests.filter(r=>r.path==='/toolbox/attendee-defaults'&&!r.packet).length,readsBefore+1);
 paused.release();await first;
 assert.equal(h.draft().type,'daily');assert.notEqual(h.draft().id,previousId);assert.deepEqual(h.draft().people.map(p=>p.userUsername),['first']);
 assert.equal(h.run('busy'),false);
});

test('a delayed default refresh from an earlier login cannot replace the new account session',async()=>{
 const store=storage();await saveDefaults(store,['first']);await saveDefaults(store,['second'],'other');const h=device(store);await h.login();
 const paused=h.holdDefaultRead(),oldLogin=h.login();await paused.entered;
 h.defaultReadGate=null;h.defaultReadStarted=null;h.username='other';await h.login();
 h.run("view('talk');field('site','Other account current draft')");const before=h.draft(),openedPage=h.run('page');paused.release();await oldLogin;
 assert.equal(h.run('actor.username'),'other');assert.equal(h.run('key'),'panelstock-toolbox-v1:other');
 assert.deepEqual(h.draft(),before);assert.equal(h.run('page'),openedPage);
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(talkTeamDefaults.usernames)')),['second']);
 assert.equal(h.run('talkTeamDefaults.username'),'other');
});
