import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const image=tail=>'data:image/jpeg;base64,'+tail;
const attempt={id:'attempt-one',status:'approved',results:{finish:'pass'},checkedBy:'inspector',checkedAt:'2026-11-09T00:00:00Z',photo:image('original')};
const panel={id:'panel-one',kind:'panel',project:'Example',orderNumber:'12',sheetNumber:'1',reference:'A',quantity:1,status:'approved',cutBy:'operator',cutAt:'2026-11-08T00:00:00Z',latest:attempt,history:[attempt]};
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children),...nodes(tree.props?.action)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');return tree&&typeof tree==='object'?text(tree.children):tree==null||typeof tree==='boolean'?'':String(tree);}
function button(tree,label){return nodes(tree).find(node=>node.tag==='button'&&text(node).trim()===label);}
function qaHarness(items=[panel]){
 const states=[items,[],{panel:[['finish','Finish check']],metalwork:[],gate:[]},0,{},false,'','', 'approved'],refs=[],calls=[];let cursor=0,refCursor=0;
 // Saving is boolean and notice is text in the production component.
 states[6]=false;states[7]='';
 const context={Date,Math,import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useEffect(){},PageHeading:'heading',ShieldCheck:'shield',ChevronRight:'chevron',Camera:'camera',Upload:'upload',Check:'check',QaPhotoAppend:'append',BAKED_WORKER_URL:'https://example.test',PanelStock:{username:'team',apiFetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({items})};}}};
 const start=source.indexOf('  function QaCenter('),end=source.indexOf('  function AuditCenter(',start);vm.runInNewContext(source.slice(start,end)+'globalThis.Component=QaCenter;',context);
 const render=()=>{cursor=refCursor=0;return context.Component({username:'team',isAdmin:false,canManage:false});};
 return {states,calls,context,render};
}
function expand(h){let tree=h.render();nodes(tree).find(node=>node.props['aria-expanded']===false)?.props.onClick();return h.render();}

test('mobile team users can view completed inspection reports while reopening remains restricted',()=>{
 const h=qaHarness(),tree=expand(h);assert.ok(button(tree,'View report'));assert.equal(button(tree,'Reopen'),undefined);assert.equal(button(tree,'Completed').props.disabled,true);button(tree,'View report').props.onClick();const report=h.render();assert.match(text(report),/Inspection 1/);assert.ok(nodes(report).find(node=>node.tag==='img'&&node.props.src===image('original')));
});

test('mobile completed report includes a saved latest inspection even if legacy history is empty',()=>{
 const h=qaHarness([{...panel,history:[]}]);h.states[19]={...panel,history:[]};const tree=h.render();assert.match(text(tree),/Inspection 1/);assert.match(text(tree),/Checked by/);assert.equal(nodes(tree).filter(node=>node.tag==='img').length,1);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const file=(name,data=image(name),type='image/jpeg')=>({name,data,type});
function appendHarness({item=panel,savedAttempt=attempt,read=async value=>({data:value.data}),send=null}={}){
 const states=[],refs=[],effects=[],calls=[],saved=[];let cursor=0,refCursor=0,closed=0,uuid=0;
 const context={Date,Math,crypto:{randomUUID:()=>`mutation-${++uuid}`},processImageFile:read,import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useEffect(callback){if(!effects.length)effects.push(callback);},Camera:'camera',Upload:'upload',BAKED_WORKER_URL:'https://example.test',PanelStock:{username:'team',apiFetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return send?send(calls.at(-1)):{ok:true,status:200,json:async()=>({ok:true,item,addition:{id:'addition-one',attemptId:savedAttempt.id,photos:body.photos,addedBy:'team',addedAt:'2026-11-09T01:00:00Z',mutationId:body.mutationId},idempotent:false})};}}};
 const start=source.indexOf('  function QaPhotoAppend('),end=source.indexOf('  function QaCenter(',start);vm.runInNewContext(source.slice(start,end)+'globalThis.Component=QaPhotoAppend;',context);
 const render=()=>{cursor=refCursor=0;return context.Component({username:'team',item,attempt:savedAttempt,onClose:()=>{closed++;},onSaved:value=>saved.push(value)});};
 return {states,calls,saved,context,render,closed:()=>closed,mount:()=>effects[0]()};
}
function picker(tree,camera=false){return nodes(tree).find(node=>node.tag==='input'&&node.props.type==='file'&&!!node.props.capture===camera);}
function newPreviews(tree){return nodes(tree).filter(node=>node.tag==='img'&&/^New QA photo/.test(node.props.alt));}
function savedPreviews(tree){return nodes(tree).filter(node=>node.tag==='img'&&/^Saved QA photo/.test(node.props.alt));}
async function pick(h,files,camera=false){const target={files,value:'selected'};await picker(h.render(),camera).props.onChange({target});assert.equal(target.value,'');return h.render();}
function upload(tree){return nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});}

test('mobile team adds photos to a saved inspection without reopening or resubmitting QA results',async()=>{
 const h=qaHarness();let tree=expand(h);assert.ok(button(tree,'Add photos'));button(tree,'Add photos').props.onClick();tree=h.render();assert.equal(tree.tag,'append');assert.equal(tree.props.attempt.id,'attempt-one');assert.equal(h.calls.length,0);assert.equal(h.states[19].id,'panel-one');
 const j=appendHarness();tree=j.render();assert.equal(savedPreviews(tree).length,1);assert.equal(nodes(tree).filter(node=>/Remove/.test(node.props['aria-label']||'')).length,0);assert.equal(picker(tree).props.multiple,true);assert.equal(picker(tree,true).props.multiple,undefined);
 tree=await pick(j,[file('one'),file('two')]);tree=await pick(j,[file('camera')],true);assert.equal(newPreviews(tree).length,3);nodes(tree).find(node=>node.props['aria-label']==='Remove new photo 2').props.onClick();tree=j.render();assert.deepEqual(newPreviews(tree).map(node=>node.props.src),[image('one'),image('camera')]);await upload(tree);
 assert.deepEqual(j.calls[0],{url:'https://example.test/qa/photos',body:{id:'panel-one',kind:'panel',attemptId:'attempt-one',photos:[image('one'),image('camera')],mutationId:'mutation-1'}});assert.equal(j.saved.length,1);assert.equal(j.saved[0].item.status,'approved');
});

test('mobile reports join additions with only their saved attempt and display addition provenance once',()=>{
 const older={...attempt,id:'older',status:'recut',photo:image('old')},item={...panel,history:[older,attempt],photoAdditions:[{id:'newer',attemptId:'attempt-one',photos:[image('addedOne'),image('addedTwo')],addedBy:'photo teammate',addedAt:'2026-11-09T01:00:00Z'},{id:'older-addition',attemptId:'older',photos:[image('addedOld')],addedBy:'old teammate',addedAt:'2026-11-09T02:00:00Z'}]},h=qaHarness([item]);h.states[19]=item;let tree=h.render();assert.deepEqual(nodes(tree).filter(node=>node.tag==='img').map(node=>node.props.src),[image('original'),image('addedOne'),image('addedTwo'),image('old'),image('addedOld')]);assert.match(text(tree),/Added by photo teammate/);assert.match(text(tree),/Added by old teammate/);assert.equal(nodes(tree).filter(node=>node.tag==='button'&&text(node)==='Add photos').length,2);
 const j=appendHarness({item});tree=j.render();assert.deepEqual(savedPreviews(tree).map(node=>node.props.src),[image('original'),image('addedOne'),image('addedTwo')]);assert.match(text(tree),/Added by photo teammate/);assert.equal(nodes(tree).some(node=>node.props['aria-label']==='Remove saved photo 1'),false);
});

test('mobile keeps uncertain uploads frozen and retries the identical mutation without duplicate new photos',async()=>{
 let tries=0;const h=appendHarness({send:async({body})=>{if(++tries===1)throw Error('Connection lost');return {ok:true,status:200,json:async()=>({ok:true,item:panel,addition:{attemptId:'attempt-one',mutationId:body.mutationId,photos:body.photos},idempotent:true})};}});h.render();await pick(h,[file('one'),file('two')]);await upload(h.render());let tree=h.render();assert.match(text(tree),/upload may have completed/);assert.equal(picker(tree).props.disabled,true);assert.equal(nodes(tree).find(node=>node.props['aria-label']==='Remove new photo 1').props.disabled,true);await pick(h,[file('ignored')]);assert.equal(newPreviews(h.render()).length,2);await upload(h.render());assert.deepEqual(h.calls[0].body,h.calls[1].body);assert.equal(h.saved.length,1);assert.equal(h.saved[0].idempotent,true);
});

test('mobile retains photos after a definite rejection and creates a new mutation only after the selection changes',async()=>{
 const h=appendHarness({send:async()=>({ok:false,status:409,json:async()=>({error:'Another teammate filled the photo slots'})})});h.render();await pick(h,[file('one'),file('two')]);await upload(h.render());let tree=h.render();assert.match(text(tree),/Another teammate filled/);assert.equal(picker(tree).props.disabled,false);assert.equal(newPreviews(tree).length,2);await upload(tree);assert.equal(h.calls[0].body.mutationId,h.calls[1].body.mutationId);nodes(h.render()).find(node=>node.props['aria-label']==='Remove new photo 2').props.onClick();await upload(h.render());assert.notEqual(h.calls[1].body.mutationId,h.calls[2].body.mutationId);assert.deepEqual(h.calls[2].body.photos,[image('one')]);
});

test('mobile validates saved-plus-new photo count and size atomically and preserves prior selections after read errors',async()=>{
 const item={...panel,photoAdditions:[{id:'addition',attemptId:attempt.id,photos:Array.from({length:7},(_,n)=>image(String(n))),addedBy:'team'}]},h=appendHarness({item,read:async value=>{if(value.name==='bad')throw Error('Unreadable photo');return {data:value.data};}});h.render();await pick(h,[file('kept')]);let tree=await pick(h,[file('tooMany'),file('second')]);assert.equal(newPreviews(tree).length,1);assert.match(text(tree),/up to 10 saved and new/);tree=await pick(h,[file('bad')]);assert.equal(newPreviews(tree).length,1);assert.match(text(tree),/Unreadable photo/);
 const chunky=image('a'.repeat(1400000)),j=appendHarness({savedAttempt:{...attempt,photos:[chunky,chunky,chunky],photo:chunky}});j.render();tree=await pick(j,[file('large',image('b'.repeat(1500000)))]);assert.equal(newPreviews(tree).length,0);assert.match(text(tree),/photo is too large/);tree=await pick(j,[file('one',chunky),file('two',chunky)]);assert.equal(newPreviews(tree).length,0);assert.match(text(tree),/too large together/);tree=await pick(j,[file('one',chunky)]);assert.equal(newPreviews(tree).length,1);
});

test('mobile blocks duplicate uploads while reading or saving and ignores late completion after cancel, logout or unmount',async()=>{
 const read=deferred(),h=appendHarness({read:()=>read.promise});h.render();const preparing=picker(h.render()).props.onChange({target:{files:[file('one')],value:'picked'}});assert.equal(button(h.render(),'Save photos').props.disabled,true);await upload(h.render());assert.equal(h.calls.length,0);button(h.render(),'Cancel').props.onClick();read.resolve({data:image('late')});await preparing;assert.equal(newPreviews(h.render()).length,0);
 for(const action of ['cancel','logout','unmount']){const request=deferred(),j=appendHarness({send:()=>request.promise});j.render();const cleanup=j.mount();await pick(j,[file('one')]);const saving=upload(j.render());await upload(j.render());assert.equal(j.calls.length,1);if(action==='cancel')button(j.render(),'Cancel').props.onClick();else if(action==='logout')j.context.PanelStock.username=null;else cleanup();request.resolve({ok:true,status:200,json:async()=>({item:panel})});await saving;assert.equal(j.saved.length,0);}
});

test('mobile historical or dispatched Gate attempts remain appendable, while missing IDs and full galleries are disabled',()=>{
 const gate={...panel,kind:'metalwork',gateOrderId:'gate-order',status:'approved',dispatchedQuantity:1,latest:attempt},h=qaHarness([gate]);let tree=expand(h);assert.equal(button(tree,'Add photos').props.disabled,false);button(tree,'Add photos').props.onClick();tree=h.render();assert.equal(tree.props.item.gateOrderId,'gate-order');
 const missing={...panel,latest:{...attempt,id:undefined},history:[{...attempt,id:undefined}]},j=qaHarness([missing]);assert.equal(button(expand(j),'Add photos').props.disabled,true);
 const full={...panel,photoAdditions:[{id:'full',attemptId:attempt.id,photos:Array.from({length:9},(_,n)=>image(String(n)))}]},k=qaHarness([full]);assert.equal(button(expand(k),'Add photos').props.disabled,true);
});


test('mobile retains a distinct legacy photo alongside original photos and counts their shared alias only once',()=>{
 const savedAttempt={...attempt,photo:image('legacy'),photos:[image('arrayPhoto')]},item={...panel,latest:savedAttempt,history:[savedAttempt]},h=appendHarness({item,savedAttempt});let tree=h.render();assert.deepEqual(savedPreviews(tree).map(node=>node.props.src),[image('legacy'),image('arrayPhoto')]);
 const j=qaHarness([item]);j.states[19]=item;tree=j.render();assert.deepEqual(nodes(tree).filter(node=>node.tag==='img').map(node=>node.props.src),[image('legacy'),image('arrayPhoto')]);
 const same={...attempt,photo:image('same'),photos:[image('same')]},k=appendHarness({savedAttempt:same});assert.equal(savedPreviews(k.render()).length,1);
});

test('mobile treats server errors and unconfirmed response bodies as uncertain append outcomes',async()=>{
 const responses=[{ok:false,status:503,json:async()=>({error:'Upload service unavailable'})},{ok:true,status:200,json:async()=>{throw Error('Unreadable response');}},{ok:true,status:200,json:async()=>({ok:true})}];
 for(const response of responses){const h=appendHarness({send:async()=>response});h.render();await pick(h,[file('one')]);await upload(h.render());const tree=h.render();assert.match(text(tree),/upload may have completed/);assert.equal(picker(tree).props.disabled,true);await upload(tree);assert.equal(h.calls[0].body.mutationId,h.calls[1].body.mutationId);assert.equal(h.saved.length,0);}
});


test('mobile keeps an unconfirmed upload retryable when success identifies another item, attempt, mutation or photo payload',async()=>{
 for(const mismatch of ['item','kind','attempt','mutation','photos']){
  const h=appendHarness({send:async({body})=>({ok:true,status:200,json:async()=>({ok:true,item:{...panel,...(mismatch==='item'?{id:'other-item'}:{}),...(mismatch==='kind'?{kind:'metalwork'}:{})},addition:{attemptId:mismatch==='attempt'?'other-attempt':'attempt-one',mutationId:mismatch==='mutation'?'other-mutation':body.mutationId,photos:mismatch==='photos'?[image('different')]:body.photos}})})});h.render();await pick(h,[file('one')]);await upload(h.render());let tree=h.render();assert.match(text(tree),/upload result could not be confirmed/);assert.equal(picker(tree).props.disabled,true);assert.equal(newPreviews(tree).length,1);await upload(tree);assert.deepEqual(h.calls[0].body,h.calls[1].body);assert.equal(h.saved.length,0);
 }
});


test('mobile photo append preserves derived dispatch and remake fields if the background refresh fails',async()=>{
 const derived={...panel,remainingQuantity:2,dispatchedQuantity:1,dispatchStatus:'partial',remakeOfReference:'Original A',replacementReference:'Replacement A'},h=qaHarness([derived]);let tree=expand(h);button(tree,'Add photos').props.onClick();tree=h.render();h.context.PanelStock.apiFetch=async()=>({ok:false,json:async()=>({error:'Refresh unavailable'})});
 const photoAdditions=[{id:'added',attemptId:attempt.id,photos:[image('newEvidence')],addedBy:'team',addedAt:'2026-11-09T01:00:00Z'}];tree.props.onSaved({item:{...panel,photoAdditions}});await new Promise(resolve=>setImmediate(resolve));
 for(const value of [h.states[0][0],h.states[19]]){assert.equal(value.remainingQuantity,2);assert.equal(value.dispatchedQuantity,1);assert.equal(value.dispatchStatus,'partial');assert.equal(value.remakeOfReference,'Original A');assert.equal(value.replacementReference,'Replacement A');assert.deepEqual(value.photoAdditions,photoAdditions);}
 assert.equal(h.states[7],'Refresh unavailable');assert.equal(h.calls.length,0);
});
