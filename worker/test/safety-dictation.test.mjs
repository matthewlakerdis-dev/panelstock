import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../templates/safety-dictation.js',import.meta.url),'utf8');

function device({prefixed=false,unsupported=false,startError=null,constructorError=null,configError=null,navigator={},standaloneDisplay=false}={}){
 const fields=new Map(),sessions=[],messages=[],timers=new Map(),listeners={},saved=[];let timerId=0;
 const node=(id,tagName='SPAN')=>({id,tagName,isConnected:true,disabled:false,readOnly:false,innerHTML:'',textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;}});
 function field(id,value='',maxLength=2000){const f={...node(id,'TEXTAREA'),value,maxLength,focus(){this.focused=true;},dispatchEvent(event){assert.equal(event.type,'input');saved.push({id:this.id,value:this.value});}};fields.set(id,f);fields.set(id+'-dictate',node(id+'-dictate','BUTTON'));fields.set(id+'-dictation-keyboard',node(id+'-dictation-keyboard','BUTTON'));fields.set(id+'-dictation-status',node(id+'-dictation-status'));return f;}
 class Recognition{
  constructor(){if(constructorError)throw constructorError;sessions.push(this);this.starts=0;this.stops=0;this.aborts=0;if(configError)Object.defineProperty(this,'continuous',{set(){throw configError;}});}
  start(){this.starts++;if(startError)throw startError;this.onstart?.();}
  stop(){this.stops++;}
  abort(){this.aborts++;}
  result(parts){this.onresult?.({resultIndex:0,results:parts.map(p=>Object.assign([{transcript:typeof p==='string'?p:p.text}],{isFinal:typeof p==='string'||!!p.final}))});}
  end(){this.onend?.();}
  error(error){this.onerror?.({error});}
 }
 const context=vm.createContext({window:{navigator,matchMedia:query=>({matches:query==='(display-mode: standalone)'&&standaloneDisplay}),...(unsupported?{}:{[prefixed?'webkitSpeechRecognition':'SpeechRecognition']:Recognition}),addEventListener:(name,callback)=>listeners[name]=callback},document:{hidden:false,getElementById:id=>fields.get(id)||null,addEventListener:(name,callback)=>listeners[name]=callback},actor:{username:'supervisor'},page:'walks',busy:false,walkGeneration:3,walkFinishPending:null,auditActionPending:null,auditRegister:false,auditAction:null,auditActionEdit:null,walkRecord:{id:'audit-1',createdBy:'supervisor',status:'Draft'},Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;'),notify:message=>messages.push(message),setTimeout:(callback,ms)=>{const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source,context);
 return {context,fields,sessions,messages,timers,listeners,saved,field,run:code=>vm.runInContext(code,context),current:()=>sessions.at(-1)};
}

test('standard and prefixed dictation append final speech once, preserve typing and trigger normal input persistence',()=>{
 for(const prefixed of [false,true]){
  const d=device({prefixed}),f=d.field('notes','Existing notes');d.run("toggleWalkDictation('notes')");const s=d.current();
  assert.equal(s.lang,'en-AU');assert.equal(s.continuous,true);assert.equal(s.interimResults,true);
  s.result([{text:'Check the',final:false}]);assert.equal(f.value,'Existing notes');assert.equal(d.saved.length,0);assert.match(d.fields.get('notes-dictation-status').textContent,/Check the/);
  s.result(['Guard checked']);assert.equal(f.value,'Existing notes Guard checked');assert.equal(d.saved.length,1);
  f.value+=' and manually edited';s.result(['Guard checked',{text:'No issue',final:false}]);assert.equal(d.saved.length,1);
  s.result(['Guard checked','No issue']);assert.equal(f.value,'Existing notes Guard checked and manually edited No issue');assert.equal(d.saved.length,2);
  // Autosave can replace the record object while leaving this same field active.
  d.context.walkRecord={id:'audit-1',createdBy:'supervisor',status:'Draft',revision:2};s.result(['Guard checked','No issue','Action saved']);
  assert.match(f.value,/Action saved$/);s.end();assert.equal(d.run('walkDictation'),null);assert.equal(d.fields.get('notes-dictate').attributes['aria-pressed'],'false');
 }
});

test('finishing accepts the trailing final transcript before resolving and prevents new sessions while waiting',async()=>{
 const d=device(),f=d.field('notes');d.field('other');d.run("toggleWalkDictation('notes')");const s=d.current(),finished=d.run('finishWalkDictation()');
 assert.equal(s.stops,1);assert.equal(d.run('finishWalkDictation()'),finished);assert.equal(d.fields.get('notes-dictate').disabled,true);
 d.run("toggleWalkDictation('other')");assert.equal(d.sessions.length,1);
 s.result(['Final words']);s.end();assert.equal(await finished,true);assert.equal(f.value,'Final words');assert.equal(d.timers.size,0);assert.equal(d.fields.get('notes-dictate').disabled,false);
 assert.equal(await d.run('finishWalkDictation()'),true);
});

test('switching fields invalidates late results and hard cancellation settles pending completion',async()=>{
 const d=device(),first=d.field('notes'),second=d.field('other');d.run("toggleWalkDictation('notes')");const old=d.current(),late=old.onresult;
 old.result(['Keep this']);d.run("toggleWalkDictation('other')");assert.equal(old.aborts,1);
 late({results:[Object.assign([{transcript:'Wrong field'}],{isFinal:true})]});assert.equal(first.value,'Keep this');assert.equal(second.value,'');
 const next=d.current(),finished=d.run('finishWalkDictation()'),nextLate=next.onresult;d.run('abortWalkDictation()');
 assert.equal(await finished,false);nextLate({results:[Object.assign([{transcript:'Too late'}],{isFinal:true})]});assert.equal(second.value,'');assert.equal(next.aborts,1);
});

test('late events cannot change another account, audit, page, replaced field or locked form',()=>{
 const changes=[
  d=>d.context.actor={username:'another'},d=>d.context.walkRecord.id='audit-2',d=>d.context.walkGeneration++,d=>d.context.page='home',
  d=>d.context.busy=true,d=>d.context.walkFinishPending={},d=>d.context.walkRecord.status='Completed',d=>d.context.walkRecord.archived=true,
  d=>d.fields.get('notes').disabled=true,d=>d.fields.get('notes').readOnly=true,d=>d.fields.get('notes').isConnected=false,
  d=>d.field('notes','Replacement'),
 ];
 for(const change of changes){const d=device(),f=d.field('notes','Original');d.run("toggleWalkDictation('notes')");const s=d.current();change(d);s.result(['Late words']);assert.equal(f.value,'Original');assert.equal(d.saved.length,0);assert.equal(s.aborts,1);assert.equal(d.run('walkDictation'),null);}
});

test('action close-out dictation follows action identity and rejects pending updates',()=>{
 const d=device(),f=d.field('register-closeEvidence');Object.assign(d.context,{auditRegister:true,auditAction:{originAuditId:'audit-1',originActionId:'action-1'},auditActionEdit:{closeEvidence:''}});
 d.run("toggleWalkDictation('register-closeEvidence')");d.current().result(['Repair completed']);assert.equal(f.value,'Repair completed');
 d.context.auditAction.originActionId='action-2';d.current().result(['Repair completed','Wrong action']);assert.equal(f.value,'Repair completed');
 d.run("toggleWalkDictation('register-closeEvidence')");d.context.auditActionPending={};d.current().result(['Still waiting']);assert.equal(f.value,'Repair completed');
});

test('dictation respects maxLength without splitting surrogate pairs and stops when full',async()=>{
 const d=device(),f=d.field('notes','A',5);d.run("toggleWalkDictation('notes')");const s=d.current();s.result(['😀😀']);
 assert.equal(f.value,'A 😀');assert.ok(f.value.length<=5);assert.equal(d.saved.length,1);assert.equal(s.stops,1);assert.match(d.messages.at(-1),/character limit/);
 s.end();const full=d.field('full','12345',5);d.run("toggleWalkDictation('full')");d.current().result(['Extra']);assert.equal(full.value,'12345');assert.equal(d.saved.length,1);d.current().end();
});

test('unsupported browsers focus the field and offer device keyboard dictation; read-only controls are omitted',()=>{
 const d=device({unsupported:true}),f=d.field('notes');assert.equal(d.run("walkDictationControls('notes',true)"),'');assert.match(d.run("walkDictationControls('notes')"),/type="button".*aria-pressed="false"/);
 d.run("toggleWalkDictation('notes')");assert.equal(f.focused,true);assert.match(d.messages.at(-1),/microphone on your device keyboard/);assert.equal(d.run('walkDictation'),null);
});

test('permission errors and synchronous start failures restore controls and allow retry',async()=>{
 const d=device();d.field('notes');d.run("toggleWalkDictation('notes')");const finished=d.run('finishWalkDictation()');d.current().error('not-allowed');assert.equal(await finished,false);assert.equal(d.run('walkDictation'),null);assert.equal(d.fields.get('notes-dictate').disabled,false);assert.match(d.messages.at(-1),/Microphone access was not allowed/);
 d.run("toggleWalkDictation('notes')");assert.equal(d.sessions.length,2);d.current().error('network');assert.match(d.messages.at(-1),/could not connect/);
 const failed=device({startError:Object.assign(Error('denied'),{name:'NotAllowedError'})});failed.field('notes');failed.run("toggleWalkDictation('notes')");assert.equal(failed.run('walkDictation'),null);assert.equal(failed.current().aborts,1);assert.match(failed.messages.at(-1),/Microphone access/);
});

test('a stalled recognition stop is bounded and does not save interim speech',async()=>{
 const d=device(),f=d.field('notes');d.run("toggleWalkDictation('notes')");const s=d.current();s.result([{text:'Unconfirmed words',final:false}]);const finished=d.run('finishWalkDictation()');
 const timer=[...d.timers.values()][0];assert.equal(timer.ms,2000);timer.callback();assert.equal(await finished,false);assert.equal(f.value,'');assert.equal(s.aborts,1);assert.equal(d.run('walkDictation'),null);assert.match(d.messages.at(-1),/did not finish in time/);
});

test('hidden pages stop recording without restarting when the page returns',()=>{
 const d=device();d.field('notes');d.run("toggleWalkDictation('notes')");const s=d.current();d.context.document.hidden=true;d.listeners.visibilitychange();assert.equal(s.aborts,1);assert.equal(d.run('walkDictation'),null);
 d.context.document.hidden=false;d.listeners.visibilitychange();assert.equal(d.sessions.length,1);
 d.run("toggleWalkDictation('notes')");d.listeners.pagehide();assert.equal(d.current().aborts,1);
});

test('busy and read-only forms cannot start dictation, and old context errors stay silent',()=>{
 for(const lock of [d=>d.context.busy=true,d=>d.fields.get('notes').readOnly=true,d=>d.fields.get('notes').disabled=true,d=>d.context.walkRecord.status='Completed']){
  const d=device();d.field('notes');lock(d);d.run("toggleWalkDictation('notes')");assert.equal(d.sessions.length,0);
 }
 const d=device();d.field('notes');d.run("toggleWalkDictation('notes')");d.context.actor=null;d.current().error('network');assert.equal(d.messages.length,0);assert.equal(d.run('walkDictation'),null);
});

test('installed Apple devices offer keyboard dictation first without removing optional app dictation',()=>{
 const variants=[
  {navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',standalone:true},keyboardFirst:true},
  {navigator:{userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'},standaloneDisplay:true,keyboardFirst:true},
  {navigator:{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:5,standalone:true},keyboardFirst:true},
  {navigator:{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',maxTouchPoints:5},standaloneDisplay:true,keyboardFirst:true},
  {navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',standalone:false},keyboardFirst:false},
  {navigator:{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:0},standaloneDisplay:true,keyboardFirst:false},
  {navigator:{userAgent:'Mozilla/5.0 (Linux; Android 15) Chrome/130',maxTouchPoints:5},standaloneDisplay:true,keyboardFirst:false},
 ];
 for(const options of variants){
  const d=device(options);d.field('notes');assert.equal(d.run('walkPrefersKeyboardDictation()'),options.keyboardFirst);
  const html=d.run("walkDictationControls('notes')"),keyboard=html.indexOf('id="notes-dictation-keyboard"'),native=html.indexOf('id="notes-dictate"');
  assert.ok(keyboard>=0&&native>=0);assert.equal(keyboard<native,options.keyboardFirst);assert.match(html,options.keyboardFirst?/>Try app dictation</:/>Dictate</);
  // The explicit app button still starts recognition, including on recent iOS versions where it works.
  d.run("toggleWalkDictation('notes')");assert.equal(d.current().starts,1);d.current().end();
  assert.match(d.fields.get('notes-dictate').innerHTML,options.keyboardFirst?/>Try app dictation</:/>Dictate</);
 }
});

test('keyboard dictation focuses immediately, preserves existing text and ignores late native results',()=>{
 const d=device({navigator:{userAgent:'iPad',standalone:true}}),first=d.field('notes','Typed notes'),second=d.field('other','Other comments');
 d.run("toggleWalkDictation('notes')");const session=d.current(),late=session.onresult;session.result(['Confirmed words']);
 d.run("useKeyboardDictation('other')");assert.equal(second.focused,true);assert.equal(session.aborts,1);assert.equal(d.run('walkDictation'),null);assert.equal(d.sessions.length,1);
 assert.equal(first.value,'Typed notes Confirmed words');assert.equal(second.value,'Other comments');assert.equal(d.saved.length,1);
 late({results:[Object.assign([{transcript:'Too late'}],{isFinal:true})]});assert.equal(first.value,'Typed notes Confirmed words');assert.equal(second.value,'Other comments');assert.equal(d.saved.length,1);
 assert.match(d.messages.at(-1),/microphone on your keyboard/);assert.match(d.messages.at(-1),/Settings > General > Keyboard.*Enable Dictation/);
 assert.equal(d.fields.get('other-dictation-status').textContent,d.messages.at(-1));
 // Device-keyboard speech arrives through ordinary input and follows the same persistence path as typing.
 second.value+=' Keyboard words';second.dispatchEvent(new d.context.Event('input',{bubbles:true}));assert.deepEqual(d.saved.at(-1),{id:'other',value:'Other comments Keyboard words'});
});

test('keyboard fallback respects edit locks and does not interrupt a pending final transcript',async()=>{
 const locks=[d=>d.context.actor=null,d=>d.context.page='home',d=>d.context.busy=true,d=>d.context.walkFinishPending={},d=>d.context.auditActionPending={},d=>d.context.walkRecord.status='Completed',d=>d.context.walkRecord.archived=true,d=>d.context.walkRecord.createdBy='another',d=>d.fields.get('notes').disabled=true,d=>d.fields.get('notes').readOnly=true,d=>d.fields.get('notes').isConnected=false,d=>d.fields.get('notes').tagName='INPUT'];
 for(const lock of locks){const d=device(),f=d.field('notes','Original');lock(d);d.run("useKeyboardDictation('notes')");assert.equal(f.focused,undefined);assert.equal(f.value,'Original');assert.equal(d.saved.length,0);assert.equal(d.sessions.length,0);}
 const d=device(),f=d.field('notes','Original'),other=d.field('other');d.run("toggleWalkDictation('notes')");const session=d.current(),finished=d.run('finishWalkDictation()');
 d.run("useKeyboardDictation('other')");assert.equal(other.focused,undefined);assert.equal(session.aborts,0);assert.match(d.messages.at(-1),/Wait for dictation to finish/);
 session.result(['Last words']);session.end();assert.equal(await finished,true);assert.equal(f.value,'Original Last words');
 d.run("useKeyboardDictation('other')");assert.equal(other.focused,true);
});

test('daily and weekly keyboard dictation uses the same editable-draft restrictions',()=>{
 for(const type of ['daily','weekly']){
  const setup=()=>{const d=device({navigator:{userAgent:'iPhone',standalone:true}});Object.assign(d.context,{page:'talk',actor:{username:'supervisor',canRunToolbox:true},draftSyncGeneration:1,state:{draft:{id:'talk-1',type,status:'Draft'}}});return d;};
  const d=setup(),f=d.field('notes','Saved comments');d.run("useKeyboardDictation('notes')");assert.equal(f.focused,true);assert.equal(f.value,'Saved comments');assert.equal(d.saved.length,0);
  for(const lock of [d=>d.context.actor.canRunToolbox=false,d=>d.context.state.draft.status='Completed',d=>d.context.state.draft.pendingSave={},d=>d.fields.set('sign-dialog',{open:true}),d=>d.fields.set('admin-draft-save-dialog',{open:true})]){
   const locked=setup(),field=locked.field('notes');lock(locked);locked.run("useKeyboardDictation('notes')");assert.equal(field.focused,undefined);assert.equal(locked.saved.length,0);
  }
 }
});

test('constructor, configuration and start failures give actionable feedback and preserve the field',()=>{
 const cases=[
  ['constructorError','NotSupportedError',/unavailable/],['constructorError','SecurityError',/Microphone access/],['constructorError','UnknownError',/service could not start/],
  ['configError','NotSupportedError',/unavailable/],['configError','SecurityError',/Microphone access/],
  ['startError','NotAllowedError',/Microphone access/],['startError','InvalidStateError',/busy|Wait a moment/],['startError','AbortError',/interrupted/],['startError','UnknownError',/service could not start/],['startError','NotSupportedError',/unavailable/],
 ];
 for(const [phase,name,expected] of cases){
  const d=device({[phase]:Object.assign(Error('Browser failure'),{name})}),f=d.field('notes','Do not lose these notes');
  assert.doesNotThrow(()=>d.run("toggleWalkDictation('notes')"),phase+': '+name);assert.equal(d.run('walkDictation'),null);assert.equal(d.run('walkDictationFinishing'),null);
  assert.equal(f.value,'Do not lose these notes');assert.equal(d.saved.length,0);assert.equal(d.messages.length,1);assert.match(d.messages[0],expected);assert.match(d.messages[0],/Keyboard dictation/);assert.equal(d.fields.get('notes-dictation-status').textContent,d.messages[0]);assert.equal(d.fields.get('notes-dictate').disabled,false);
  if(phase==='constructorError')assert.equal(d.sessions.length,0);
  else{const session=d.current();assert.equal(session.aborts,1);assert.equal(session.starts,phase==='startError'?1:0);for(const handler of ['onstart','onresult','onerror','onend'])assert.equal(session[handler],null);}
  d.run("useKeyboardDictation('notes')");assert.equal(f.focused,true);assert.equal(f.value,'Do not lose these notes');assert.equal(d.saved.length,0);
 }
});

test('an aborted native session retains accepted speech and exposes a working keyboard fallback',()=>{
 const d=device({navigator:{userAgent:'iPhone',standalone:true}}),f=d.field('notes','Existing');d.run("toggleWalkDictation('notes')");const session=d.current(),late=session.onresult;session.result(['Accepted words']);session.error('aborted');
 assert.equal(f.value,'Existing Accepted words');assert.match(d.messages.at(-1),/interrupted/);assert.match(d.messages.at(-1),/Keyboard dictation/);assert.equal(d.fields.get('notes-dictation-status').textContent,d.messages.at(-1));assert.equal(d.run('walkDictation'),null);assert.equal(session.aborts,1);
 late({results:[Object.assign([{transcript:'Unaccepted words'}],{isFinal:true})]});assert.equal(f.value,'Existing Accepted words');assert.equal(d.saved.length,1);
 d.run("useKeyboardDictation('notes')");assert.equal(f.focused,true);assert.equal(d.sessions.length,1);assert.equal(d.saved.length,1);
});

test('unusable recognition globals fall back to the keyboard or a callable prefixed implementation',()=>{
 const d=device({unsupported:true}),f=d.field('notes','Saved');d.context.window.SpeechRecognition={};
 const html=d.run("walkDictationControls('notes')");assert.match(html,/>Keyboard dictation</);assert.doesNotMatch(html,/id="notes-dictation-keyboard"/);
 d.run("toggleWalkDictation('notes')");assert.equal(f.focused,true);assert.equal(f.value,'Saved');assert.equal(d.saved.length,0);assert.equal(d.sessions.length,0);
 const prefixed=device({prefixed:true});prefixed.field('notes');prefixed.context.window.SpeechRecognition={};prefixed.run("toggleWalkDictation('notes')");assert.equal(prefixed.current().starts,1);
 const legacy=device({navigator:{userAgent:'iPhone'}});delete legacy.context.window.matchMedia;assert.equal(legacy.run('walkPrefersKeyboardDictation()'),false);legacy.context.window.navigator.standalone=true;assert.equal(legacy.run('walkPrefersKeyboardDictation()'),true);
});
