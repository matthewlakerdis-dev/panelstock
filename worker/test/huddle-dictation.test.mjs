import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const template=fs.readFileSync(new URL('../templates/toolbox.html',import.meta.url),'utf8'),controller=fs.readFileSync(new URL('../templates/safety-dictation.js',import.meta.url),'utf8');
const functions=['invalidateAll','field','topic','action','prestartField','prepareDiscussion','openSignature','completeTalk','saveDraft','pdf','downloadReport','prestartHTML','talkHTML'];
const code=functions.map(name=>{const line=template.split('\n').find(l=>l.startsWith('function '+name+'(')||l.startsWith('async function '+name+'('));assert.ok(line,name);return line;}).join('\n');
function device(type='daily'){
 const nodes=new Map(),sessions=[],saved=[],snapshots=[],messages=[];
 const makeNode=id=>({id,tagName:'SPAN',isConnected:true,disabled:false,readOnly:false,open:false,innerHTML:'',textContent:'',value:'',setAttribute(){},getAttribute(){return '';},querySelectorAll(){return [];},showModal(){this.open=true;},focus(){},close(){this.open=false;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,makeNode(id));return nodes.get(id);};
 class Recognition{constructor(){sessions.push(this);}start(){this.onstart?.();}stop(){}abort(){this.aborted=true;}result(text){this.onresult?.({results:[Object.assign([{transcript:text}],{isFinal:true})]});}end(){this.onend?.();}}
 const draft={id:'talk-1',status:'Draft',type,company:'Lennox Facades',facilitator:'Supervisor',date:'2026-10-26',tasks:'',topics:Array.from({length:type==='daily'?3:6},()=>({text:'Prompt',notes:'',reviewed:true})),people:[],actions:[{text:'',owner:'',due:''}],supervisorSignature:null,...(type==='daily'?{prestart:{highRisk:'',previousShift:'',checklist:Array(13).fill('Y')}}:{})};
 const context=vm.createContext({structuredClone,Uint8Array,state:{draft},actor:{username:'supervisor',displayName:'Supervisor',canRunToolbox:true,isAdmin:true},page:'talk',busy:false,draftSyncGeneration:1,walkGeneration:0,walkFinishPending:null,auditActionPending:null,auditRegister:false,adminDraftEditing:null,Event:class{constructor(type){this.type=type;}},window:{SpeechRecognition:Recognition,addEventListener(){}},document:{getElementById:get,querySelectorAll:()=>[],addEventListener(){}},setTimeout:()=>1,clearTimeout(){},esc:v=>String(v??''),notify:m=>messages.push(m),persist:()=>{saved.push(structuredClone(context.state.draft));return true;},resetSignaturePdf(){},validateTalk:()=>true,clearPad(){},signing:null,hasDeviceDraft:()=>true,syncAccountDraft:async()=>{snapshots.push(structuredClone(context.state.draft));return true;},updateDraftSync(){},prepareDiscussion(){},ToolboxPdf:{createPdf:async d=>{snapshots.push(structuredClone(d));return new Uint8Array();}},download(){},filename:()=> 'synthetic',report:d=>{snapshots.push(structuredClone(d));return '';},openAdminDraftSave:()=>snapshots.push(structuredClone(context.state.draft)),draftSyncHTML:()=>'',input:()=>'',sectionTitles:d=>d.topics.map((_,i)=>'Topic '+i),dailyTitles:['Tasks','Risks','Previous shift'],prestartQuestions:Array(13).fill('Check'),attendeeSelect:()=>'',stamp:()=>'',saveRecord:async()=>snapshots.push(structuredClone(context.state.draft))});
 vm.runInContext(controller+'\n'+code,context);
 const run=s=>vm.runInContext(s,context);
 function field(id,callback,maxLength=5000){const node=get(id);Object.assign(node,{tagName:'TEXTAREA',maxLength,value:'',dispatchEvent(event){assert.equal(event.type,'input');context.inputValue=this.value;run(callback);}});get(id+'-dictate');get(id+'-dictation-status');return node;}
 return {context,nodes,sessions,saved,snapshots,messages,run,field,draft:()=>context.state.draft,current:()=>sessions.at(-1)};
}

test('daily and weekly huddles expose dictation on editable notes, talking points, tasks and actions with server limits',()=>{
 for(const type of ['daily','weekly']){const d=device(type),html=d.run('talkHTML()');for(const id of ['point0','note0','act0'])assert.ok(html.includes('id="'+id+'-dictate"'));assert.match(html,/<textarea id="note0" maxlength="5000"/);assert.match(html,/<textarea id="act0" maxlength="3000"/);if(type==='weekly')assert.ok(html.includes('id="tasks-dictate"'));}
 const old=device();old.context.state.draft.topics.push({text:'Legacy',notes:'',reviewed:true});const html=old.run('talkHTML()');for(const id of ['tasks','highRisk','previousShift'])assert.ok(html.includes('id="'+id+'-dictate"'));
});

test('dictated daily comments use normal edits, mirror export fields, cache changes and invalidate existing signatures',()=>{
 const d=device();d.context.state.draft.people=[{name:'Worker',signature:{image:'saved'},ack:true}];d.context.state.draft.supervisorSignature={image:'saved'};
 for(const [i,text] of ['Cut frames','Hot work','Check extraction'].entries()){const field=d.field('note'+i,`topic(${i},'notes',inputValue)`);d.run(`toggleWalkDictation('note${i}')`);d.current().result(text);d.current().end();assert.equal(field.value,text);}
 assert.equal(d.draft().tasks,'Cut frames');assert.equal(d.draft().prestart.highRisk,'Hot work');assert.equal(d.draft().prestart.previousShift,'Check extraction');assert.equal(d.saved.length,3);assert.equal(d.draft().people[0].signature,null);assert.equal(d.draft().supervisorSignature,null);
});

test('weekly dictation preserves manual edits and accepts an autosave replacement of the same draft',()=>{
 const d=device('weekly'),field=d.field('note0',"topic(0,'notes',inputValue)");field.value='Typed comments.';d.run("toggleWalkDictation('note0')");d.current().result('Guarding checked.');field.value+=' Manual correction.';
 d.context.state.draft=structuredClone(d.draft());d.current().onresult({results:[Object.assign([{transcript:'Guarding checked.'}],{isFinal:true}),Object.assign([{transcript:'Team questions answered.'}],{isFinal:true})]});
 assert.equal(d.draft().topics[0].notes,'Typed comments. Guarding checked. Manual correction. Team questions answered.');assert.equal(d.saved.length,2);
});

test('signing, saving, completion, admin draft and current-draft exports wait for the last spoken words',async()=>{
 for(const action of ["openSignature('supervisor')",'saveDraft()','completeTalk()','openHuddleAdminDraftSave()','pdf(state.draft)','downloadReport(state.draft)']){
  const d=device('weekly');d.field('note0',"topic(0,'notes',inputValue)");d.run("toggleWalkDictation('note0')");const pending=d.run(action);assert.equal(d.snapshots.length,0);assert.equal(d.nodes.get('sign-dialog').open,false);
  d.current().result('Last words before the action.');d.current().end();await pending;
  assert.equal(d.draft().topics[0].notes,'Last words before the action.');if(action.startsWith('openSignature'))assert.equal(d.nodes.get('sign-dialog').open,true);else assert.equal(d.snapshots[0].topics[0].notes,'Last words before the action.');
 }
});

test('a changed account, draft, generation, type or page cannot receive late speech or resume a pending huddle action',async()=>{
 const changes=[d=>d.context.actor.username='another',d=>d.context.state.draft.id='talk-2',d=>d.context.draftSyncGeneration++,d=>d.context.state.draft.type='daily',d=>d.context.page='home',d=>d.context.busy=true];
 for(const change of changes){const d=device('weekly'),field=d.field('note0',"topic(0,'notes',inputValue)");d.run("toggleWalkDictation('note0')");const s=d.current(),pending=d.run('saveDraft()');change(d);s.result('Too late');s.end();await pending;assert.equal(field.value,'');assert.equal(d.snapshots.length,0);assert.equal(s.aborted,true);}
});

test('completed or unauthorized huddles and an open signing dialog cannot start dictation',()=>{
 for(const change of [d=>d.context.state.draft.status='Completed',d=>d.context.actor.canRunToolbox=false,d=>d.context.state.draft.pendingSave={},d=>d.nodes.get('sign-dialog').open=true]){const d=device();d.field('note0',"topic(0,'notes',inputValue)");d.nodes.set('sign-dialog',{isConnected:true,open:false});change(d);d.run("toggleWalkDictation('note0')");assert.equal(d.sessions.length,0);}
});
