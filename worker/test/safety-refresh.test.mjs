import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture(){
 const nodes=new Map(),listeners=new Map(),shell={inert:false},messages=[],calls=[];let dialog=false;
 const node=()=>({hidden:true,style:{},textContent:'',classList:{toggle(){}},scrollHeight:0,clientHeight:0,parentElement:null,closest:()=>null});
 const context=vm.createContext({Array,Map,Math,Number,String,JSON,actor:{username:'member',canRunToolbox:false},busy:false,page:'safety-home',activeLoadingTasks:new Map(),window:{scrollY:0,visualViewport:{scale:1}},getComputedStyle:()=>({overflowY:'visible'}),document:{scrollingElement:{scrollTop:0},body:node(),documentElement:node(),querySelector:s=>s==='dialog[open]'?dialog?{}:null:shell,getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},addEventListener:(name,fn,options)=>listeners.set(name,{fn,options})},notify:m=>{messages.push(m)},beginLoading:()=>{context.activeLoadingTasks.set('pull','Refreshing');return ()=>context.activeLoadingTasks.delete('pull')},profileEditing:null,safetyUpload:null,credentialUploading:null,equipmentDraft:null,equipmentEditing:null,equipmentFault:null,equipmentDetail:null,equipmentRecord:null,adminDraftEditing:null,safetyAssignmentsDraft:null,safetyDetail:null,safetyData:{offset:25},safetyType:'SWMS',safetySearch:'',equipmentSearch:'',adminDraftsType:'weekly',state:{draft:{id:'draft',people:[{signature:'kept'}]}},equipmentManager:()=>true,cacheDraft:()=>true,syncAccountDraft:async()=>true,reconcileAccountDraft:async()=>{},api:async()=>({users:[]}),view:()=>{},attendeeUsers:[]});
 for(const name of ['refreshSafetyHome','refreshHome','refreshRecords','openSafetyDocument','loadSafety','openCredentials','openCompliance','openAdminDrafts','openSafetyProfiles','viewEquipmentInspection','openEquipmentFault','openEquipmentAsset','openEquipment'])context[name]=async(...args)=>calls.push([name,...args]);
 vm.runInContext(fs.readFileSync(new URL('../templates/safety-refresh.js',import.meta.url),'utf8'),context);
 const target=node(),touch=(x,y,id=1)=>({identifier:id,clientX:x,clientY:y});
 function event(name,x,y,extra={}){let prevented=false;listeners.get(name).fn({target,touches:name==='touchend'?[]:[touch(x,y)],changedTouches:[touch(x,y)],cancelable:true,preventDefault(){prevented=true},...extra});return prevented}
 return {context,listeners,nodes,shell,calls,messages,target,event,dialog(v){dialog=v},run:s=>vm.runInContext(s,context)};
}

test('pull gesture at the top refreshes once on release; short, upward, horizontal and cancelled gestures do not refresh',async()=>{
 const f=fixture();assert.equal(f.listeners.get('touchmove').options.passive,false);
 f.event('touchstart',100,50);assert.equal(f.event('touchmove',103,160),true);assert.equal(f.nodes.get('pull-refresh-label').textContent,'Release to refresh');assert.equal(f.calls.length,0);f.event('touchend',103,160);f.event('touchend',103,160);await new Promise(r=>setImmediate(r));assert.deepEqual(f.calls,[['refreshSafetyHome']]);assert.equal(f.shell.inert,false);assert.equal(f.nodes.get('pull-refresh').hidden,true);
 for(const [x,y,cancel] of [[101,90,false],[170,60,false],[100,20,false],[100,180,true]]){f.event('touchstart',100,50);f.event('touchmove',x,y);f.event(cancel?'touchcancel':'touchend',x,y)}assert.equal(f.calls.length,1);
});

test('scrolling, pinch zoom, dialogs, controls and busy tasks are excluded from pull-to-refresh',()=>{
 const f=fixture();const attempt=()=>{f.event('touchstart',100,50);assert.equal(f.event('touchmove',100,180),false);f.event('touchend',100,180)};
 f.context.document.scrollingElement.scrollTop=200;attempt();f.context.document.scrollingElement.scrollTop=0;f.context.window.visualViewport.scale=2;attempt();f.context.window.visualViewport.scale=1;f.dialog(true);attempt();f.dialog(false);f.target.closest=()=>({});attempt();f.target.closest=()=>null;f.context.busy=true;attempt();f.context.busy=false;f.context.activeLoadingTasks.set('saving',true);attempt();f.context.activeLoadingTasks.clear();f.event('touchstart',100,50);f.event('touchmove',100,180,{touches:[{identifier:1,clientX:100,clientY:180},{identifier:2,clientX:130,clientY:200}]});f.event('touchend',100,180);assert.equal(f.calls.length,0);
});

test('refresh preserves the active library type and page and rejects unsaved forms and changed signer assignments',async()=>{
 const f=fixture();f.context.page='library';await f.run('refreshSafetyScreen()');assert.deepEqual(f.calls,[['loadSafety','SWMS',25]]);
 f.context.safetyDetail={document:{id:'document'},version:{id:'version',requiredSigners:['member']}};await f.run('refreshSafetyScreen()');assert.deepEqual(f.calls[1],['openSafetyDocument','document','version']);
 f.context.safetyAssignmentsDraft={versionId:'version',usernames:['member','other']};assert.equal(await f.run('refreshSafetyScreen()'),false);assert.match(f.messages.at(-1),/required signers/);assert.equal(f.calls.length,2);
 f.context.page='equipment';f.context.equipmentDraft={answers:['Pass']};assert.equal(await f.run('refreshSafetyScreen()'),false);assert.deepEqual(f.context.equipmentDraft.answers,['Pass']);f.context.page='settings';assert.equal(await f.run('refreshSafetyScreen()'),false);assert.equal(f.calls.length,2);
});

test('a talk refresh syncs before reading account changes and retains signatures; failed sync and request errors release loading state',async()=>{
 const f=fixture();f.context.page='talk';f.context.actor.canRunToolbox=true;const order=[];f.context.cacheDraft=()=>{order.push('cache');return true};f.context.syncAccountDraft=async()=>{order.push('sync');return true};f.context.reconcileAccountDraft=async()=>order.push('reconcile');f.context.api=async()=>{order.push('users');return {users:[{username:'new-worker'}]}};f.context.view=()=>order.push('view');
 await f.run('refreshSafetyScreen()');assert.deepEqual(order,['cache','sync','reconcile','users','view']);assert.equal(f.context.state.draft.people[0].signature,'kept');assert.equal(f.context.attendeeUsers[0].username,'new-worker');f.context.syncAccountDraft=async()=>false;assert.equal(await f.run('refreshSafetyScreen()'),undefined);assert.equal(f.context.state.draft.people[0].signature,'kept');
 f.context.page='safety-home';f.context.refreshSafetyHome=async()=>{throw Error('Offline')};assert.equal(await f.run('refreshSafetyScreen()'),false);assert.equal(f.messages.at(-1),'Offline');assert.equal(f.shell.inert,false);assert.equal(f.context.activeLoadingTasks.size,0);assert.equal(f.run('pullRefreshRunning'),false);
});
