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
 const docs=new Map();
 return {read:(key,fallback=null)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>docs.set(key,structuredClone(value)),ctx:{storage:{transactionSync:fn=>fn()}},audit(){},requireTask(actor){if(!actor.isAdmin&&!actor.tasks?.['factory.toolbox'])throw Object.assign(Error('Forbidden'),{status:403});}};
}

function device(store=storage()){
 const cache=new Map(),elements=new Map(),timers=new Map();let serial=0;
 const h={store,cache,username:'supervisor',users:structuredClone(users)};
 const element=()=>({style:{},classList:{add(){},remove(){}},innerHTML:'',textContent:'',value:'',open:false,attributes:{},listeners:{},
  addEventListener(name,listener){(this.listeners[name]??=[]).push(listener);},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},
  querySelectorAll:()=>[],querySelector:()=>null,focus(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;},toDataURL:()=>signatureImage});
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,URLSearchParams,location:{search:'',hash:'',pathname:'/toolbox'},confirm:()=>true,
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  localStorage:{getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  window:{scrollY:0,scrollX:0,scrollTo(){}},document:{addEventListener(){},createElement:element,querySelector:element,querySelectorAll:()=>[],getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);}},
  fetch:async(path,options={})=>{
   if(path==='/session')return {ok:true,json:async()=>({username:h.username,isAdmin:false,taskAccess:{'factory.toolbox':true}})};
   if(path==='/toolbox/users')return {ok:true,json:async()=>({users:structuredClone(h.users)})};
   if(path==='/toolbox/safety-documents/summary')return {ok:true,json:async()=>({outstanding:0,assigned:0,completed:0,pending:[]})};
   if(path==='/logout')return {ok:true,json:async()=>({ok:true})};
   try{const result=await handleToolbox(store,path,options.method||'GET',options.body?JSON.parse(options.body):{},{username:h.username,tasks:{'factory.toolbox':true}});return {ok:true,status:result.status,json:async()=>result.body};}
   catch(error){if(!error.status)throw error;return {ok:false,status:error.status,json:async()=>({error:error.message})};}
  }
 });
 vm.runInContext(buildToolboxPage().split('<script>')[1].split('</script>')[0],context);
 h.context=context;h.run=code=>vm.runInContext(code,context);h.login=()=>h.run("token='synthetic';startSession()");
 h.draft=()=>JSON.parse(h.run('JSON.stringify(state.draft)'));
 h.options=()=>JSON.parse(h.run('JSON.stringify(talkAttendeePicker.options)'));
 h.start=async type=>{await h.login();h.run(`state.draft=fresh('${type}');view('talk')`);};
 return h;
}

for(const type of ['daily','weekly'])test(`${type} talks explicitly select their own attendees and resume the selection from the account`,async()=>{
 const h=device();await h.start(type);
 assert.match(h.run('talkHTML()'),/openTalkAttendees\(\)/);
 h.run("openTalkAttendees();toggleTalkAttendee('user:first',true);toggleTalkAttendee('user:third',true)");
 assert.equal(h.draft().people.length,0,'checkboxes do not edit the talk until Apply');
 h.run('applyTalkAttendees()');
 assert.deepEqual(h.draft().people.map(({name,userUsername,ack,signature})=>({name,userUsername,ack,signature})),[
  {name:'First Worker',userUsername:'first',ack:false,signature:null},
  {name:'Third Worker',userUsername:'third',ack:false,signature:null}
 ]);
 assert.equal(await h.run('syncAccountDraft()'),true);
 const resumed=device(h.store);await resumed.login();
 assert.equal(resumed.draft().id,h.draft().id);
 assert.deepEqual(resumed.draft().people.map(p=>p.userUsername),['first','third']);
 resumed.run("view('talk');openTalkAttendees()");
 assert.deepEqual(resumed.options().filter(o=>o.selected).map(o=>o.key),['user:first','user:third']);
 resumed.run('closeTalkAttendees()');await resumed.run(`newTalk('${type}')`);
 assert.deepEqual(resumed.draft().people,[],'a new talk does not inherit the previous selection');
});

test('Cancel and unchanged Apply preserve the exact roster, signatures, supervisor sign-off and device cache',async()=>{
 const h=device();await h.start('daily');
 h.run("state.draft.people=[{name:'Original saved name',userUsername:'first',ack:true,signature:{image:'existing signature',contentHash:'existing hash'}}];state.draft.supervisorSignature={image:'supervisor signature'};persist(false)");
 const before=h.draft(),cached=h.cache.get('panelstock-toolbox-v1:supervisor');
 h.run("originalPerson=state.draft.people[0];openTalkAttendees();toggleTalkAttendee('user:first',false);toggleTalkAttendee('user:second',true);closeTalkAttendees()");
 assert.deepEqual(h.draft(),before);assert.equal(h.cache.get('panelstock-toolbox-v1:supervisor'),cached);
 h.run('openTalkAttendees();applyTalkAttendees()');
 assert.deepEqual(h.draft(),before);assert.equal(h.cache.get('panelstock-toolbox-v1:supervisor'),cached);
 assert.equal(h.run('state.draft.people[0]===originalPerson'),true);
});

test('declining signed attendee removal keeps the roster and leaves the pending selection available to cancel',async()=>{
 const h=device();await h.start('weekly');
 h.run("state.draft.people=[{name:'First Worker',userUsername:'first',ack:true,signature:{image:'existing signature',contentHash:'existing hash'}},{name:'Second Worker',userUsername:'second',ack:false,signature:null}];state.draft.supervisorSignature={image:'supervisor signature'};persist(false)");
 const before=h.draft();let confirmations=0;
 h.context.confirm=()=>{confirmations++;return false;};
 h.run("openTalkAttendees();toggleTalkAttendee('user:first',false);applyTalkAttendees()");
 assert.equal(confirmations,1);assert.deepEqual(h.draft(),before);
 assert.equal(h.options().find(o=>o.key==='user:first').selected,false);
 h.run('closeTalkAttendees()');assert.deepEqual(h.draft(),before);
});

test('search bulk selection retains hidden choices, ignores unknown keys and Clear selection applies an empty roster',async()=>{
 const h=device();await h.start('weekly');
 h.run("state.draft.people=[{name:'Supervisor Name',userUsername:'supervisor',ack:false,signature:null}];openTalkAttendees();filterTalkAttendees('  wOrKeR  ');selectAllTalkAttendees();toggleTalkAttendee('user:missing',true)");
 assert.deepEqual(h.options().filter(o=>o.selected).map(o=>o.key).sort(),['user:first','user:second','user:supervisor','user:third']);
 h.run("filterTalkAttendees('No matching person');selectAllTalkAttendees();applyTalkAttendees()");
 assert.deepEqual(h.draft().people.map(p=>p.userUsername).sort(),['first','second','supervisor','third']);
 h.run("openTalkAttendees();filterTalkAttendees('first');clearTalkAttendees();applyTalkAttendees()");
 assert.deepEqual(h.draft().people,[],'Clear selection also clears choices hidden by the search');
 assert.equal(await h.run('syncAccountDraft()'),true);
 assert.deepEqual(h.store.read('toolbox:record:'+h.draft().id).people,[]);
});

test('saved attendees absent from the directory and legacy names remain independently selectable',async()=>{
 const h=device();await h.start('weekly');
 h.run("state.draft.people=[{name:'Saved directory name',userUsername:'first',ack:false,signature:null},{name:'Former employee',userUsername:'departed',employer:'Original company',ack:false,signature:null},{name:'Guest',employer:'Contractor',ack:false,signature:null}];savedPeople=state.draft.people.slice();openTalkAttendees()");
 assert.deepEqual(h.options().filter(o=>o.selected).map(o=>o.key).sort(),['saved:1','saved:2','user:first']);
 h.run("toggleTalkAttendee('saved:1',false);toggleTalkAttendee('user:second',true);applyTalkAttendees()");
 assert.deepEqual(h.draft().people.map(p=>p.name),['Saved directory name','Guest','Second Worker']);
 assert.equal(h.run('state.draft.people[0]===savedPeople[0]&&state.draft.people[1]===savedPeople[2]'),true);
 assert.equal(h.draft().people[1].employer,'Contractor');
 assert.equal(await h.run('syncAccountDraft()'),true);
 const resumed=device(h.store);await resumed.login();
 assert.deepEqual(resumed.draft().people.map(p=>p.name),['Saved directory name','Guest','Second Worker']);
});

for(const type of ['daily','weekly'])test(`${type} selection changes retain existing signed attendance through sync, resume and completion`,async()=>{
 const h=device();await h.start(type);
 h.run("field('site','Workshop');field('focus','Guarding');topic(0,'notes','Work safely');if(state.draft.prestart)prestartYesAll();prepareDiscussion();openTalkAttendees();toggleTalkAttendee('user:first',true);toggleTalkAttendee('user:second',true);applyTalkAttendees();ink=true;signing=0");
 await h.run('saveSignature()');h.run('ink=true;signing=1');await h.run('saveSignature()');h.run("ink=true;signing='supervisor'");await h.run('saveSignature()');
 const first=h.draft().people[0];
 h.run("originalPerson=state.draft.people[0];openTalkAttendees();toggleTalkAttendee('user:second',false);toggleTalkAttendee('user:third',true);applyTalkAttendees()");
 assert.equal(h.run('state.draft.people[0]===originalPerson'),true);
 assert.deepEqual(h.draft().people[0],first);assert.equal(h.draft().supervisorSignature,null);
 assert.equal(h.draft().people[1].ack,false);assert.equal(h.draft().people[1].signature,null);
 assert.equal(await h.run('syncAccountDraft()'),true);
 const resumed=device(h.store);await resumed.login();
 assert.deepEqual(resumed.draft().people[0].signature,first.signature);assert.equal(resumed.draft().people[0].ack,true);
 resumed.run("view('talk');ink=true;signing=1");await resumed.run('saveSignature()');resumed.run("ink=true;signing='supervisor'");await resumed.run('saveSignature()');
 const id=resumed.draft().id;await resumed.run('saveRecord(true)');
 const completed=h.store.read('toolbox:record:'+id);
 assert.equal(completed.status,'Completed');assert.deepEqual(completed.people.map(p=>p.userUsername),['first','third']);
 assert.deepEqual(completed.people[0].signature,first.signature);
});

test('changing a legacy signed roster preserves the original hash and snapshots the roster before removal',async()=>{
 const h=device();await h.start('daily');
 h.run("field('site','Workshop');topic(0,'notes','Cut frames');prestartYesAll();prepareDiscussion();openTalkAttendees();toggleTalkAttendee('user:first',true);toggleTalkAttendee('user:second',true);applyTalkAttendees()");
 await h.run(`(async()=>{const signature={image:${JSON.stringify(signatureImage)},at:new Date().toISOString(),contentHash:await contentHash(state.draft)};state.draft.people[0].signature=signature;state.draft.people[0].ack=true;state.draft.supervisorSignature={...signature};})()`);
 const signature=h.draft().people[0].signature,roster=h.run('JSON.stringify(state.draft.people.map(toolboxAttendeeSnapshot))');
 h.run("openTalkAttendees();toggleTalkAttendee('user:second',false);toggleTalkAttendee('user:third',true);applyTalkAttendees()");
 assert.deepEqual(h.draft().people[0].signature,{...signature,attendeeRoster:JSON.parse(roster)});
 assert.equal(h.draft().supervisorSignature,null);assert.equal(h.draft().people[0].ack,true);
 assert.equal(await h.run('syncAccountDraft()'),true,'backend accepts the original full-roster signature');
 assert.deepEqual(h.store.read('toolbox:record:'+h.draft().id).people[0].signature,h.draft().people[0].signature);
});

test('selection respects the backend limit of 60 and reports oversized bulk choices',async()=>{
 const h=device();await h.start('weekly');
 h.run("attendeeUsers=Array.from({length:61},(_,i)=>({username:'worker'+i,displayName:'Worker '+i}));openTalkAttendees();selectAllTalkAttendees()");
 assert.equal(h.options().filter(o=>o.selected).length,0,'an oversized bulk choice is rejected as a whole');
 assert.match(h.run("document.getElementById('talk-attendees-error').textContent"),/60/);
 h.run("talkAttendeePicker.options.forEach(o=>o.selected=true);applyTalkAttendees()");
 assert.equal(h.draft().people.length,0,'Apply independently rejects more than 60');
 h.run("clearTalkAttendees();for(let i=0;i<60;i++)toggleTalkAttendee('user:worker'+i,true);applyTalkAttendees()");
 assert.equal(h.draft().people.length,60);assert.equal(await h.run('syncAccountDraft()'),true);
 assert.equal(h.store.read('toolbox:record:'+h.draft().id).people.length,60);
});

test('stale selections cannot overwrite a different draft, a changed roster or another account',async()=>{
 for(const change of ["state.draft=fresh('weekly')","state.draft.people.push({name:'New arrival',userUsername:'third',ack:false,signature:null})","actor.username='other'"]){
  const h=device();await h.start('daily');
  h.run("state.draft.people=[{name:'First Worker',userUsername:'first',ack:false,signature:null}];openTalkAttendees();toggleTalkAttendee('user:second',true)");
  h.run(change);const before=h.draft();h.run('applyTalkAttendees()');
  assert.deepEqual(h.draft(),before,change);
 }
 const h=device();await h.start('daily');
 h.run("openTalkAttendees();toggleTalkAttendee('user:first',true)");h.username='other';await h.login();
 const before=h.draft();h.run('applyTalkAttendees()');
 assert.deepEqual(h.draft(),before);assert.deepEqual(h.draft().people,[]);
});

test('busy, completed and unauthorized sessions cannot open or apply attendee edits',async()=>{
 for(const change of ["busy=true","state.draft.status='Completed'","actor.canRunToolbox=false"]){
  const h=device();await h.start('daily');h.run(change);const before=h.draft();h.run('openTalkAttendees()');
  assert.equal(h.run('talkAttendeePicker'),null);assert.deepEqual(h.draft(),before);
 }
 for(const change of ["busy=true","state.draft.status='Completed'","actor.canRunToolbox=false"]){
  const h=device();await h.start('daily');h.run("openTalkAttendees();toggleTalkAttendee('user:first',true)");h.run(change);
  const before=h.draft();h.run('applyTalkAttendees()');assert.deepEqual(h.draft(),before);
 }
});
