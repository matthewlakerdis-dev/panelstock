import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildToolboxPage} from '../src/toolbox-page.js';
import {handleToolbox,TOOLBOX_DEFAULTS} from '../src/toolbox.js';
function storage(){const docs=new Map();return {docs,read:(k,fallback=null)=>structuredClone(docs.has(k)?docs.get(k):fallback),write:(k,v)=>docs.set(k,structuredClone(v)),ctx:{storage:{transactionSync:fn=>fn()}},audit(){},requireTask(a){if(!a.isAdmin&&!a.tasks?.['factory.toolbox'])throw Object.assign(Error('Forbidden'),{status:403});}};}
function device(store,username='supervisor',admin=false){
 const cache=new Map(),elements=new Map(),timers=new Map(),requests=[];let serial=0;
 const element=()=>({style:{},classList:{add(){},remove(){}},addEventListener(){},innerHTML:'',textContent:'',setAttribute(){},removeAttribute(){},querySelectorAll:()=>[],focus(){},scrollIntoView(){}});
 const h={cache,requests,offline:false,dropResponse:false,gate:null,username,admin};
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,URLSearchParams,location:{search:'',hash:'',pathname:'/toolbox'},setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),confirm:()=>true,
  localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  window:{scrollY:0,scrollX:0,scrollTo(){}},document:{createElement:element,querySelector:element,querySelectorAll:()=>[],getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);}},
  fetch:async(path,options={})=>{
   const packet=options.body?JSON.parse(options.body):undefined;requests.push({path,packet});
   if(path==='/session')return {ok:true,json:async()=>({username:h.username,isAdmin:h.admin,taskAccess:{'factory.toolbox':true}})};
   if(path==='/toolbox/users')return {ok:true,json:async()=>({users:[{username:h.username,displayName:h.username}]})};
   if(path==='/toolbox/safety-documents/summary')return {ok:true,json:async()=>({outstanding:0,assigned:0,completed:0,pending:[]})};
   if(path==='/logout')return {ok:true,json:async()=>({ok:true})};
   if(h.offline)throw Error('Network unavailable');
   const actor={username:h.username,isAdmin:h.admin,tasks:{'factory.toolbox':true}};
   try{if(h.gate&&packet?.record)await h.gate;const response=await handleToolbox(store,path,packet?'POST':'GET',packet||{},actor);if(h.dropResponse&&packet?.record){h.dropResponse=false;throw Error('Response lost');}return {ok:true,status:response.status,json:async()=>response.body};}
   catch(e){if(!e.status)throw e;return {ok:false,status:e.status,json:async()=>({error:e.message})};}
  }
 });
 vm.runInContext(buildToolboxPage().split('<script>')[1].split('</script>')[0],context);
 h.context=context;h.run=code=>vm.runInContext(code,context);h.login=()=>h.run("token='synthetic';startSession()");h.draft=()=>JSON.parse(h.run('JSON.stringify(state.draft)'));
 h.debounce=async()=>{const timer=[...timers.values()].find(t=>t.ms===900);assert.ok(timer,'autosave scheduled');timer.fn();await h.run('draftSyncRun');};
 return h;
}
test('autosave and account recovery keep daily and weekly drafts across devices without leaking other users drafts',async()=>{
 const s=storage(),a=device(s);await a.login();assert.equal(s.read('toolbox:index',[]).length,0,'blank home creates no draft');
 a.run("field('site','Workshop');topic(0,'notes','Cut frames');prestartYesAll();state.draft.people.push({name:'Operator',userUsername:'operator',ack:false,signature:null});persist()");await a.debounce();
 const daily=a.draft();assert.equal(daily.revision,1);assert.equal(daily.createdBy,'supervisor');assert.match(a.run('draftSyncText()'),/synced to your account/);
 const b=device(s);await b.login();assert.equal(b.draft().id,daily.id);assert.equal(b.draft().tasks,'Cut frames');assert.equal(b.draft().people[0].name,'Operator');assert.deepEqual(b.draft().prestart.checklist,Array(13).fill('Y'));
 await a.run("newTalk('weekly')");a.run("field('site','Factory');field('focus','Welding fumes');topic(0,'notes','Check extraction')");await a.run('syncAccountDraft()');
 const c=device(s);await c.login();assert.equal(c.draft().type,'weekly');assert.equal(c.draft().topics[0].notes,'Check extraction');assert.equal(c.run('accountDrafts.total'),2);
 for(const h of [device(s,'other'),device(s,'admin',true)]){await h.login();assert.equal(h.draft().site,'');assert.equal(h.run('accountDrafts.total'),0);}
 const other={username:'other',tasks:{'factory.toolbox':true}};await assert.rejects(handleToolbox(s,'/toolbox/records/'+daily.id,'GET',{},other),{status:404});
});
test('conflicting edits pause sync and retain both copies; a copied draft gets a new identity',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','Workshop')");await a.run('syncAccountDraft()');const b=device(s);await b.login();
 a.run("topic(0,'notes','Device A newer tasks')");await a.run('syncAccountDraft()');b.run("topic(0,'notes','Device B unfinished tasks')");assert.equal(await b.run('syncAccountDraft()'),false);
 assert.equal(b.draft().accountSync.blocked,true);assert.equal(b.draft().tasks,'Device B unfinished tasks');assert.equal(s.read('toolbox:record:'+a.draft().id).tasks,'Device A newer tasks');
 const id=b.draft().id;await b.run('copyDeviceDraft()');assert.notEqual(b.draft().id,id);assert.equal(b.draft().revision,1);assert.equal(s.read('toolbox:record:'+id).tasks,'Device A newer tasks');assert.equal(b.draft().tasks,'Device B unfinished tasks');
});
test('lost save responses retry the same packet before later edits and do not duplicate drafts',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','First value')");a.dropResponse=true;assert.equal(await a.run('syncAccountDraft()'),false);
 const first=a.requests.find(r=>r.packet?.record).packet;assert.equal(a.draft().accountSync.pending.mutationId,first.mutationId);assert.equal(s.read('toolbox:record:'+a.draft().id).revision,1);
 a.run("field('site','More recent value')");assert.equal(await a.run('syncAccountDraft()'),true);
 const saves=a.requests.filter(r=>r.packet?.record);assert.deepEqual(saves[1].packet,first);assert.equal(saves[2].packet.expectedRevision,1);assert.equal(a.draft().revision,2);assert.equal(s.read('toolbox:index').length,1);assert.equal(s.read('toolbox:record:'+a.draft().id).site,'More recent value');
});
test('edits made during an in-flight autosave retain their text and save after the first response',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','First site')");let release;a.gate=new Promise(resolve=>release=resolve);
 const saving=a.run('syncAccountDraft()');await Promise.resolve();a.run("field('site','Second site');topic(0,'notes','Keep typing')");a.gate=null;release();await saving;
 assert.equal(a.draft().site,'Second site');assert.equal(a.draft().tasks,'Keep typing');assert.equal(a.draft().revision,2);assert.equal(s.read('toolbox:record:'+a.draft().id).site,'Second site');
});
test('offline edits stay in the account-specific device cache and sync on reconnect',async()=>{
 const s=storage(),a=device(s);await a.login();a.offline=true;a.run("topic(0,'notes','Offline daily notes')");assert.equal(await a.run('syncAccountDraft()'),false);assert.match(a.run('draftSyncText()'),/not synced/);assert.equal(JSON.parse(a.cache.get('panelstock-toolbox-v1:supervisor')).draft.tasks,'Offline daily notes');
 a.offline=false;await a.run('resumeDraftSync()');assert.equal(a.draft().revision,1);const b=device(s);await b.login();assert.equal(b.draft().tasks,'Offline daily notes');
});
test('clean device copies follow newer account changes and never resurrect deleted drafts',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','Workshop')");await a.run('syncAccountDraft()');const b=device(s);await b.login();const id=b.draft().id;
 a.run("field('site','New workshop')");await a.run('syncAccountDraft()');await b.run('reconcileAccountDraft()');assert.equal(b.draft().site,'New workshop');
 await a.run('deleteDraft(state.draft.id,state.draft.revision)');await b.run('resumeDraftSync()');assert.notEqual(b.draft().id,id);assert.equal(s.read('toolbox:record:'+id).status,'Deleted');assert.equal(s.read('toolbox:index').length,0);
});
test('draft recovery paginates only the signed-in account and excludes completed and deleted records',async()=>{
 const s=storage();const rows=Array.from({length:27},(_,i)=>({id:crypto.randomUUID(),createdBy:'supervisor',status:'Draft',revision:1,site:'Site '+i,people:[],actions:[]}));for(const r of rows)s.write('toolbox:record:'+r.id,r);
 s.write('toolbox:index',[{id:'other',createdBy:'other',status:'Draft'},...rows,{id:'completed',createdBy:'supervisor',status:'Completed'}]);const actor={username:'supervisor',tasks:{'factory.toolbox':true}};
 const first=(await handleToolbox(s,'/toolbox/drafts','GET',{},actor)).body;assert.equal(first.latest.id,rows[0].id);assert.equal(first.total,27);assert.equal(first.drafts.length,25);assert.equal(first.nextOffset,25);
 const next=(await handleToolbox(s,'/toolbox/drafts','POST',{offset:25},actor)).body;assert.equal(next.drafts.length,2);assert.equal(next.nextOffset,null);assert.equal(next.latest,undefined);await assert.rejects(handleToolbox(s,'/toolbox/drafts','POST',{offset:-1},actor),{status:400});
});
test('a late autosave response cannot replace a newly signed-in account draft',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','Private supervisor data')");let release;a.gate=new Promise(resolve=>release=resolve);const saving=a.run('syncAccountDraft()');await Promise.resolve();
 a.username='other';await a.login();const id=a.draft().id;a.gate=null;release();await saving;assert.equal(a.draft().id,id);assert.equal(a.draft().site,'');assert.equal(a.run('actor.username'),'other');assert.equal(s.read('toolbox:index')[0].createdBy,'supervisor');
});
test('correcting a temporarily empty date saves the current edits rather than retrying invalid data',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','Workshop');field('date','')");assert.equal(await a.run('syncAccountDraft()'),false);assert.equal(a.draft().accountSync.pending,undefined);
 a.run("field('date','2026-10-13');topic(0,'notes','Corrected draft')");assert.equal(await a.run('syncAccountDraft()'),true);assert.equal(s.read('toolbox:record:'+a.draft().id).tasks,'Corrected draft');
});
test('reverting local text after an uncertain save still confirms the pending packet before saving the reversion',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','Original site')");await a.run('syncAccountDraft()');a.run("field('site','Temporary edit')");a.dropResponse=true;assert.equal(await a.run('syncAccountDraft()'),false);
 a.run("field('site','Original site')");await a.run('syncAccountDraft()');assert.equal(a.draft().revision,3);assert.equal(s.read('toolbox:record:'+a.draft().id).site,'Original site');
});
test('an explicitly saved untouched draft is stored, while opening a blank home remains unsaved',async()=>{
 const s=storage(),a=device(s);await a.login();assert.equal(s.read('toolbox:index',[]).length,0);await a.run('saveDraft()');assert.equal(a.draft().revision,1);const b=device(s);await b.login();assert.equal(b.draft().id,a.draft().id);
});
test('an uncertain signed completion is retried as completion without autosaving or reopening the completed draft',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','Workshop');topic(0,'notes','Weld frames');prestartYesAll();state.draft.people=[{name:'Operator',ack:true,signature:null}]");
 await a.run("(async()=>{const sig={image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',at:new Date().toISOString(),contentHash:await contentHash(state.draft)};state.draft.people[0].signature=sig;state.draft.supervisorSignature=sig;persist();await syncAccountDraft();})()");
 const id=a.draft().id;a.dropResponse=true;await a.run('saveRecord(true)');assert.equal(s.read('toolbox:record:'+id).status,'Completed');assert.ok(a.draft().pendingSave);
 await a.run('saveRecord(true)');assert.notEqual(a.draft().id,id);assert.equal(s.read('toolbox:record:'+id).revision,2);const b=device(s);await b.login();assert.equal(b.run('accountDrafts.total'),0);assert.equal(b.draft().site,'');
});
test('resumed account drafts populate action date inputs with the saved ISO value',async()=>{
 const s=storage(),a=device(s);await a.login();a.run("field('site','Workshop');state.draft.actions=[{text:'Check extraction',owner:'Maintenance',due:'2026-10-14',closed:false}];persist()");await a.run('syncAccountDraft()');const b=device(s);await b.login();
 assert.equal(b.draft().actions[0].due,'2026-10-14');assert.match(b.run('talkHTML()'),/id="due0" type="date" value="2026-10-14"/);assert.match(b.run('report(state.draft)'),/14-10-2026/);
});
