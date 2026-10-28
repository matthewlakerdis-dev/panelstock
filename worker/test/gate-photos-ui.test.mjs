import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../panelstock-app.modern.js',import.meta.url),'utf8');
const gate={id:'gate-qa',kind:'metalwork',checklistKind:'gate',gateOrderId:'gate-order',reference:'Gate: A',project:'Example',orderNumber:'12',quantity:1,status:'awaiting',drawnBy:'drafter'};
const lists={panel:[['panel','Panel check']],metalwork:[['material','Metal material check']],gate:[['hinges','Gate hinges check']]};
const jpeg=tail=>'data:image/jpeg;base64,'+tail, image=(name,data=jpeg(name),type='image/jpeg')=>({name,type,data});
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');return tree&&typeof tree==='object'?text(tree.children):tree==null||typeof tree==='boolean'?'':String(tree);}
function button(tree,label){return nodes(tree).find(node=>node.tag==='button'&&text(node).trim()===label);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness({items=[gate],read=async file=>({data:file.data}),submitError='',report=null,settings={},send=null}={}){
 const states=[items,[],structuredClone(lists),0,settings,false],refs=[],effects=[],calls=[];if(report)states[19]=report;let cursor=0,refCursor=0;
 const response=()=>({items,dispatches:[],checklists:lists,settings});
 const context={Date,Math,import_react:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useEffect(callback){if(!effects.length)effects.push(callback);},PageHeading:'heading',ShieldCheck:'shield',ChevronRight:'chevron',Camera:'camera',Upload:'upload',Check:'check',processImageFile:read,BAKED_WORKER_URL:'https://example.test',PanelStock:{apiFetch:async(url,options)=>{if(!options)return {ok:true,json:async()=>response()};const body=JSON.parse(options.body);calls.push({url,body});if(send)return send({url,body});return {ok:!submitError,json:async()=>submitError?{error:submitError}:{...response(),item:{status:'approved'}}};}}};
 const start=source.indexOf('  function QaCenter('),end=source.indexOf('  function AuditCenter(',start);vm.runInNewContext(source.slice(start,end)+'globalThis.Component=QaCenter;',context);
 const render=()=>{cursor=refCursor=0;return context.Component({username:'inspector',isAdmin:true,canManage:true});};
 const mount=async()=>{const cleanup=effects[0]();await settle();return cleanup;};
 return {states,refs,calls,render,mount};
}
function open(h,id=gate.id){let tree=h.render();const expand=nodes(tree).find(node=>node.props['aria-expanded']===false);if(expand){expand.props.onClick();tree=h.render();}const row=nodes(tree).find(node=>node.tag==='article'&&node.props.key===id);button(row,'Open check').props.onClick();return h.render();}
function chooser(tree,camera=false){return nodes(tree).find(node=>node.tag==='input'&&node.props.type==='file'&&!!node.props.capture===camera);}
async function choose(h,files,camera=false){const target={files,value:'selected'};await chooser(h.render(),camera).props.onChange({target});assert.equal(target.value,'');return h.render();}
function photos(tree){return nodes(tree).filter(node=>node.tag==='img'&&/preview$/.test(node.props.alt));}
async function submit(h){let tree=h.render();button(tree,'Complete all').props.onClick();tree=h.render();await nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});return h.render();}

test('mobile Gate gallery appends multiple selections and camera captures, removes thumbnails and submits all photos once',async()=>{
 const h=harness();let tree=open(h);assert.equal(chooser(tree).props.multiple,true);assert.equal(chooser(tree,true).props.multiple,undefined);
 tree=await choose(h,[image('one'),image('two')]);assert.equal(photos(tree).length,2);assert.match(text(tree),/2 \/ 10 photos ready/);
 tree=await choose(h,[image('camera')],true);assert.deepEqual(photos(tree).map(node=>node.props.src),[jpeg('one'),jpeg('two'),jpeg('camera')]);
 nodes(tree).find(node=>node.props['aria-label']==='Remove photo 2').props.onClick();tree=h.render();assert.deepEqual(photos(tree).map(node=>node.props.src),[jpeg('one'),jpeg('camera')]);
 tree=await submit(h);assert.deepEqual(h.calls[0].body.photos,[jpeg('one'),jpeg('camera')]);assert.equal('photo' in h.calls[0].body,false);assert.equal(h.calls[0].body.kind,'metalwork');assert.equal(h.states[21].length,0);assert.equal(photos(tree).length,0);
});

test('mobile preserves a Gate gallery after read and upload failures and rejects excess count without silently dropping files',async()=>{
 const h=harness({submitError:'Try again',read:async file=>{if(file.name==='bad')throw Error('Unreadable photo');return {data:file.data};}});open(h);await choose(h,[image('kept')]);
 let tree=await choose(h,[image('second'),image('bad')]);assert.deepEqual(photos(tree).map(node=>node.props.src),[jpeg('kept')]);assert.match(text(tree),/Unreadable photo/);
 tree=await choose(h,Array.from({length:10},(_,index)=>image(String(index))));assert.equal(photos(tree).length,1);assert.match(text(tree),/up to 10 photos/);
 tree=await choose(h,[image('unsupported',jpeg('a'),'application/pdf')]);assert.equal(photos(tree).length,1);assert.match(text(tree),/Choose an image/);
 tree=await submit(h);assert.match(text(tree),/Try again/);assert.equal(photos(tree).length,1);assert.deepEqual(h.calls[0].body.photos,[jpeg('kept')]);
});

test('mobile validates prepared photo and aggregate limits atomically while keeping earlier photos',async()=>{
 const h=harness();open(h);await choose(h,[image('kept')]);let tree=await choose(h,[image('large',jpeg('a'.repeat(1500000)))]);assert.equal(photos(tree).length,1);assert.match(text(tree),/photo is too large/);
 const chunky=jpeg('a'.repeat(1400000));tree=await choose(h,[0,1,2,3].map(n=>image(String(n),chunky)));assert.equal(photos(tree).length,5);
 tree=await choose(h,[image('over total',chunky)]);assert.equal(photos(tree).length,5);assert.match(text(tree),/too large together/);
});

test('mobile blocks submission while preparing photos and rejects late results after cancel, next inspection and unmount',async()=>{
 const pending=deferred(),h=harness({items:[gate,{...gate,id:'second'}],read:()=>pending.promise});let tree=open(h);const preparing=chooser(tree).props.onChange({target:{files:[image('pending')],value:'picked'}});tree=h.render();assert.equal(button(tree,'Approve QA').props.disabled,true);assert.equal(chooser(tree).props.disabled,true);
 await nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,0);
 button(tree,'Cancel').props.onClick();tree=open(h,'second');assert.equal(photos(tree).length,0);pending.resolve({data:jpeg('late')});await preparing;assert.equal(photos(h.render()).length,0);
 const late=deferred(),j=harness({read:()=>late.promise});open(j);const cleanup=await j.mount();const reading=chooser(j.render()).props.onChange({target:{files:[image('late')],value:'picked'}});cleanup();late.resolve({data:jpeg('unmounted')});await reading;assert.equal(j.states[21].length,0);
});

test('mobile Gate photo requirements count the gallery and cancel starts a fresh empty selection',async()=>{
 const h=harness({settings:{requireQaPhoto:true}});let tree=open(h);button(tree,'Complete all').props.onClick();tree=h.render();assert.equal(button(tree,'Approve QA').props.disabled,true);tree=await choose(h,[image('one')]);assert.equal(button(tree,'Approve QA').props.disabled,false);
 nodes(tree).find(node=>node.props['aria-label']==='Remove photo 1').props.onClick();tree=h.render();assert.equal(button(tree,'Approve QA').props.disabled,true);await choose(h,[image('two')]);button(h.render(),'← Back to QA Centre').props.onClick();tree=open(h);assert.equal(photos(tree).length,0);
});

test('mobile ordinary metalwork still replaces a single photo and sends the legacy photo field',async()=>{
 const normal={...gate,id:'normal',gateOrderId:undefined,checklistKind:'metalwork',fabricatedBy:'maker'},h=harness({items:[normal]});let tree=open(h,'normal');assert.equal(chooser(tree).props.multiple,false);await choose(h,[image('first'),image('ignored')]);tree=await choose(h,[image('replacement')]);assert.equal(photos(tree).length,1);assert.equal(photos(tree)[0].props.src,jpeg('replacement'));
 await submit(h);assert.equal(h.calls[0].body.photo,jpeg('replacement'));assert.equal('photos' in h.calls[0].body,false);
});

test('mobile inspection reports show each stored Gate photo once and retain old single-photo evidence',()=>{
 const h=harness({report:{...gate,status:'approved',history:[{id:'old',status:'approved',results:{},photo:jpeg('old')},{id:'new',status:'approved',results:{},photos:[jpeg('new1'),jpeg('new2')],photo:jpeg('new1')}]}});const displayed=nodes(h.render()).filter(node=>node.tag==='img').map(node=>node.props.src);assert.deepEqual(displayed,[jpeg('new1'),jpeg('new2'),jpeg('old')]);
});


test('mobile accepts convertible phone-image formats and validates the prepared image data',async()=>{
 const h=harness();let tree=open(h);assert.equal(chooser(tree).props.accept,'image/*');
 tree=await choose(h,[image('heic',jpeg('convertedHEIC'),'image/heic'),image('avif',jpeg('convertedAVIF'),'image/avif')]);assert.equal(photos(tree).length,2);
 tree=await choose(h,[image('invalid',jpeg('bad!data'))]);assert.equal(photos(tree).length,2);assert.match(text(tree),/photo could not be prepared/);
});

test('mobile ignores successful and rejected saves from a cancelled inspection without clearing new Gate photos',async()=>{
 for(const rejection of [false,true]){
  const pending=deferred(),h=harness({items:[gate,{...gate,id:'next-gate'}],send:()=>pending.promise});let tree=open(h);await choose(h,[image('old')]);tree=h.render();button(tree,'Complete all').props.onClick();tree=h.render();
  const saving=nodes(tree).find(node=>node.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,1);button(h.render(),'Cancel').props.onClick();tree=open(h,'next-gate');tree=await choose(h,[image('new')]);assert.equal(h.states[6],false);
  if(rejection)pending.reject(Error('Old inspection failed'));else pending.resolve({ok:true,json:async()=>({items:[],dispatches:[],item:{status:'approved'}})});
  await saving;tree=h.render();assert.equal(h.states[11].id,'next-gate');assert.deepEqual(photos(tree).map(node=>node.props.src),[jpeg('new')]);assert.equal(h.states[6],false);assert.doesNotMatch(text(tree),/Old inspection failed|QA check approved/);
 }
});
