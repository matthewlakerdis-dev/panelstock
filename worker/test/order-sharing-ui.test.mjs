import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');
const notesHelper=source.slice(source.indexOf('  function orderFormNotes('),source.indexOf('  const orderNotesText='));
const helpers=source.slice(source.indexOf('  let sharingKeys='),source.indexOf('  async function draftApi'));
const open=source.slice(source.indexOf('  async function openCloudDraft'),source.indexOf('  async function deleteCloudDraft'));
const id='11111111-1111-4111-8111-111111111111',fid='22222222-2222-4222-8222-222222222222';
const draft={id,order:{project:'',items:[],siteContact:'Alice',phone:'123'},attachments:[{id:fid,name:'drawing.pdf',size:10}],updatedAt:'server-v1'};
function fixture(options={}){
 const calls=[],stored=new Map(),files=[];
 const local={id:'old-local',owner:'alice',fields:{projectId:'old-project'},items:[{quantity:2,description:'OLD ITEMS'}],attachments:[{id:'old-file'}]};
 const context={URLSearchParams,Blob,Uint8Array,atob,Date,JSON,API:'https://api.example',mobileHost:null,location:{hash:'#shared-draft='+id+'&owner=alice',pathname:'/',search:''},history:{replaceState(_a,_b,url){calls.push(['replace',url]);context.location.hash='';}},session:{username:'alice'},sessionVersion:0,busy:false,editorReady:true,can:()=>true,view:'orders',message:'',orderDraft:local,draftOwner:'alice',selectedOrderFiles:[{id:'old-file'}],discardDraftArmed:false,orderValidationId:'',draftNotice:'',DRAFT_KEY:'draft:',captureDraft:()=>calls.push(['capture']),listedDeviceDraft:()=>options.local===false?null:local,persistCloudDraft:async()=>{calls.push(['save-current']);if(options.saveFail)throw Error('Current draft save failed');},navigator:{onLine:true},render:()=>calls.push(['render']),esc:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),openDraft:async()=>{},draftApi:async path=>{calls.push(['api',path]);if(options.downloadFail&&path.includes('/files/'))throw Error('Download interrupted');return path.includes('/files/')?{file:{data:btoa('%PDF-test')}}:{draft:structuredClone(draft)};},attachmentDb:async(action,items)=>{assert.equal(action,'put');files.push(...items);},deviceStorage:{setItem(key,value){if(options.storageFail)throw Error('Quota');stored.set(key,value);}},...options.context};
 context.window={location:context.location};
 vm.createContext(context);vm.runInContext(notesHelper+helpers+open+'globalThis.ui={showSharingKeySetup,copySharingValue,setSharingSecret:value=>{sharingSecret=value;},resumeSharedDraft,sharedDraftIntent,sharedDraftBanner,sharingSettings,loadSharingKeys,updateSharingKey};',context);
 return {context,calls,stored,files,local,ui:context.ui};
}
test('shared PDF waits for sign-in and account/workspace readiness without dropping its link',async()=>{
 for(const patch of [{session:null},{busy:true},{editorReady:false}]){const f=fixture({context:patch});await f.ui.resumeSharedDraft();assert.equal(f.calls.length,0);assert.ok(f.context.location.hash.includes(id));}
 const f=fixture({context:{session:{username:'bob'}}});await f.ui.resumeSharedDraft();assert.match(f.context.message,/belongs to alice/);assert.ok(!f.calls.some(call=>call[0]==='api'));assert.equal(f.context.orderDraft,f.local);
});
test('opening a shared PDF saves the old draft first, stores its file and leaves submission to the user',async()=>{
 const f=fixture();await f.ui.resumeSharedDraft();
 const significant=f.calls.filter(call=>call[0]!=='render');assert.deepEqual(significant.slice(0,3),[['capture'],['save-current'],['api','/'+id]]);
 assert.equal(f.context.orderDraft.id,id);assert.equal(f.context.view,'new');assert.equal(f.context.selectedOrderFiles[0].name,'drawing.pdf');
 assert.equal(await f.files[0].file.text(),'%PDF-test');assert.equal(JSON.parse(f.stored.get('draft:alice')).id,id);
 assert.equal(f.context.location.hash,'');assert.match(f.context.message,/then submit when ready/);
 assert.ok(!f.calls.some(call=>/orders|submit/.test(call[1]||'')));
});
for(const [option,description]of [['saveFail','saving the existing draft fails'],['downloadFail','the shared file cannot be fetched'],['storageFail','device storage is full']])test('the old draft and shared link remain recoverable when '+description,async()=>{
 const f=fixture({[option]:true});await f.ui.resumeSharedDraft();
 assert.equal(f.context.orderDraft,f.local);assert.equal(f.context.selectedOrderFiles[0].id,'old-file');assert.ok(f.context.location.hash.includes(id));
 assert.ok(!f.calls.some(call=>call[0]==='replace'));assert.notEqual(f.context.view,'new');assert.match(f.context.message,/failed|interrupted|storage/i);
});
test('embedded mobile Orders exposes no Shortcut setup or deep-link import',async()=>{
 const f=fixture({context:{mobileHost:{}}});assert.equal(f.ui.sharingSettings(),'');assert.equal(f.ui.sharedDraftIntent(),null);await f.ui.resumeSharedDraft();assert.equal(f.calls.length,0);
});
test('sharing settings describe the complete PDF Shortcut recipe without putting a login token in it',()=>{
 const f=fixture(),html=f.ui.sharingSettings();for(const text of ['Get Name','Base64 Encode','Random Number','Authorization','openUrl','5 MB','Safari','90 days'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('https://api.example/order-share/import'));assert.ok(!html.includes('session.token'));assert.ok(!html.includes('type="password"'));
});

test('rendering a different draft never copies the previous form into it',()=>{
 const start=source.indexOf('  function captureDraft()'),end=source.indexOf('  async function openDraft()',start),draft={id:'new-shared',fields:{siteContact:'Alice'},items:[]};
 const context={root:{querySelector:()=>({dataset:{draftId:'old-local'},querySelector:()=>{throw Error('Old form must not be read');}})},orderDraft:draft,draftOwner:'alice',session:{username:'alice'},restoringDraft:false};
 vm.runInNewContext(source.slice(start,end)+'captureDraft();',context);assert.deepEqual(draft.items,[]);assert.equal(draft.fields.siteContact,'Alice');
});

function clipboardFixture(clipboard){
 const statuses=new Map(),selected=[];
 const f=fixture({context:{navigator:{onLine:true,clipboard},root:{querySelector:selector=>{if(selector.startsWith('[data-shortcut-copy-status=')){if(!statuses.has(selector))statuses.set(selector,{textContent:''});return statuses.get(selector);}return {focus(){},select(){selected.push(selector);}};}}}});
 return {...f,statuses,selected,copy:target=>f.ui.copySharingValue({currentTarget:{dataset:{shortcutCopy:target}}})};
}
test('Shortcut copy buttons copy exact URL, case-sensitive date format and the full scoped sharing header',async()=>{
 const values=[],f=clipboardFixture({writeText:async value=>values.push(value)});f.ui.setSharingSecret('ps-share.synthetic-ipad-key');
 await f.copy('endpoint');await f.copy('format');await f.copy('authorization');
 assert.deepEqual(values,['https://api.example/order-share/import','yyyyMMddHHmmssSSS','Bearer ps-share.synthetic-ipad-key']);assert.equal(f.selected.length,0);assert.ok([...f.statuses.values()].every(status=>status.textContent==='Copied.'));
});
test('blocked clipboard access selects the displayed field with accurate manual-copy feedback',async()=>{
 const f=clipboardFixture({writeText:async()=>{throw Error('Denied');}});await f.copy('endpoint');assert.deepEqual(f.selected,['[data-shortcut-value="endpoint"]']);assert.match([...f.statuses.values()][0].textContent,/Touch and hold/);
});
test('a late clipboard failure after switching accounts cannot select or expose the previous key',async()=>{
 let reject;const f=clipboardFixture({writeText:()=>new Promise((_resolve,fail)=>reject=fail)});f.ui.setSharingSecret('ps-share.previous-user');const pending=f.copy('authorization');f.context.sessionVersion++;f.context.session={username:'bob'};reject(Error('Denied'));await pending;assert.deepEqual(f.selected,[]);assert.equal([...f.statuses.values()][0].textContent,'');
});
test('a sharing key cannot be copied before it has been created',async()=>{
 let copies=0;const f=clipboardFixture({writeText:async()=>copies++});await f.copy('authorization');assert.equal(copies,0);assert.deepEqual(f.selected,[]);
});

test('a refreshed page explains the unavailable key and provides an enabled path back to setup',()=>{
 const f=fixture(),html=f.ui.sharingSettings();assert.match(html,/data-shortcut-key-setup>Go to key setup<\/button>/);assert.match(html,/This page has no key available to copy/);assert.match(html,/saved keys cannot be revealed again/);assert.doesNotMatch(html,/data-shortcut-copy="authorization"[^>]*disabled/);
 f.ui.setSharingSecret('ps-share.new-key');const ready=f.ui.sharingSettings();assert.match(ready,/data-shortcut-copy="authorization">Copy key for this header/);assert.doesNotMatch(ready,/data-shortcut-key-setup/);
});
test('Go to key setup loads only key metadata and focuses the explicit creation form',async()=>{
 const calls=[],focused=[];const f=fixture({context:{view:'settings',api:async(path,options={})=>{calls.push({path,method:options.method||'GET'});return Response.json({ok:true,keys:[]});},root:{querySelector:selector=>selector==='[data-sharing-key] [name="label"]'?{scrollIntoView:()=>focused.push('scroll'),focus:()=>focused.push('focus')}:null}}});
 await f.ui.showSharingKeySetup();assert.deepEqual(calls,[{path:'/order-share/keys',method:'GET'}]);assert.deepEqual(focused,['scroll','focus']);
});
test('an account switch during setup loading cannot move focus into the new account',async()=>{
 let finish;const focused=[];const f=fixture({context:{view:'settings',api:()=>new Promise(resolve=>finish=resolve),root:{querySelector:()=>({scrollIntoView:()=>focused.push('scroll'),focus:()=>focused.push('focus')})}}});
 const pending=f.ui.showSharingKeySetup();f.context.sessionVersion++;f.context.session={username:'bob'};finish(Response.json({ok:true,keys:[]}));await pending;assert.deepEqual(focused,[]);
});
