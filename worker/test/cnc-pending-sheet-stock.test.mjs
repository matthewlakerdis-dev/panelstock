import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as stickerHelpers from '../src/cnc-sticker-review.js';
import {validateChanges,normalizeChanges,validateOffcutCreations} from '../src/inventory.js';
import {cncDuplicateKey} from '../src/cnc-input.js';
import {requireCondition as check} from '../src/security.js';

const admin={username:'admin',isAdmin:true},staff={username:'operator',tasks:{'factory.cnc':true}},stamp='2026-11-27T00:00:00Z';
const oldStock={id:'old-stock',sku:'AL-3000',color:'Milled',material:'Solid Aluminium',thickness:3,width:3000,height:1200,qty:5,catalogId:'catalog'},newStock={...oldStock,id:'new-stock',sku:'AL-3200',width:3200,height:1250,qty:3};
const proposal={length:600,width:1200,dimensionOrder:'sheet',status:'pending',source:'cnc-pdf',rectangle:{x:2400,y:0,width:600,height:1200}};
const panel=(id,extra={})=>({id,status:'pending',jobReference:'Tower',orderNumber:'007',sheetNumber:'12',panelNumber:id.toUpperCase(),stockItemType:'variant',stockItemId:'old-stock',stockSku:'AL-3000',sheetWidth:3000,sheetHeight:1200,totalPanelArea:2.75,panelAreaScope:'sheet',pdfPage:1,pdfRevision:1,uploadedAt:'2026-11-01T00:00:00Z',uploadedBy:'Original uploader',pendingOffcuts:[structuredClone(proposal)],pendingOffcut:structuredClone(proposal),...extra});
const delta=(before,after,field='cncPanels')=>({field,id:before?.id||after.id,before,after});
let sequence=0;
const command=(changes,extra={})=>({mutationId:'resize-pending-sheet-'+String(++sequence).padStart(5,'0'),restoreEpoch:0,changes,...extra});
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8'),start=source.indexOf('  mutate(body,actor) {'),end=source.indexOf('  traceOperation(',start);assert.ok(start>=0&&end>start,'Use the current actual mutation method');
const withoutServerFields=value=>{if(!value)return value;const {serverTimestamp,uploadedAt,uploadedBy,completedAt,completedBy,voidedAt,voidedBy,...rest}=value;return rest;};
const same=(a,b)=>JSON.stringify(withoutServerFields(a))===JSON.stringify(withoutServerFields(b));
function fixture(panels=[panel('a'),panel('b')]){
 const docs={'app:cncPanels':structuredClone(panels),'qa-checks':[{id:'a',kind:'panel',status:'awaiting',latest:{id:'old-attempt',photo:'PRIVATE PHOTO',panelArea:{method:'manual',areaM2:1.234}},history:[{id:'older',photo:'OLD PRIVATE PHOTO'}]}],'qa-panel-area:a':{revision:4,cutAt:'older-cut',value:{method:'manual',areaM2:1.234}},'app:transactions':[{id:'original-activity',type:'cnc',desc:'Original schedule',qty:'',timestamp:stamp}],'app:variants':[structuredClone(oldStock),structuredClone(newStock)],'app:offcuts':[{...newStock,id:'new-offcut',sku:'OFFCUT-3200',dimensionOrder:'sheet'}],'app:catalog':[{id:'catalog'}],'panel-dispatch-loads':[],'qa-dispatches':[],orders:[{id:'site-order',status:'ordered'}],revision:12,restoreEpoch:0},writes=[],audits=[],broadcasts=[],mutations=new Map();let failKey=null;
 const deps={...stickerHelpers,check,same,ok:(body,status=200)=>({body,status}),validateChanges,normalizeChanges,validateOffcutCreations,cncDuplicateKey},methods=new Function(...Object.keys(deps),'return ({'+source.slice(start,end)+'});')(...Object.values(deps));
 return Object.assign(methods,{docs,writes,audits,broadcasts,mutations,read:(key,fallback)=>Object.hasOwn(docs,key)?structuredClone(docs[key]):fallback,write:(key,value)=>{writes.push(key);docs[key]=structuredClone(value);if(key===failKey)throw Error('Simulated storage failure');},audit:(by,action,detail)=>audits.push({by,action,detail}),broadcastRevision:revision=>broadcasts.push(revision),syncPanelLoads:()=>{},notify:()=>{},adminUsernames:()=>['admin'],failWrite:key=>{failKey=key;},
  sql:{exec(query,...args){let rows=[];if(query.startsWith('SELECT username,payload,revision FROM mutations'))rows=mutations.has(args[0])?[structuredClone(mutations.get(args[0]))]:[];else if(query.startsWith('INSERT INTO mutations'))mutations.set(args[0],{id:args[0],username:args[1],payload:args[2],revision:args[3]});else throw Error('Unexpected fixture SQL: '+query);rows.toArray=()=>rows;return rows;}},
  ctx:{storage:{transactionSync:fn=>{const before=structuredClone(docs),oldMutations=structuredClone(mutations),writeCount=writes.length,auditCount=audits.length;try{return fn();}catch(error){for(const key of Object.keys(docs))delete docs[key];Object.assign(docs,before);mutations.clear();for(const [key,value]of oldMutations)mutations.set(key,value);writes.length=writeCount;audits.length=auditCount;throw error;}}}}
 });
}
function edits(store,{ids=['a','b'],target=newStock,type='variant',freshPdf=false,transform=after=>after}={}){
 const changes=ids.map(id=>{const before=store.read('app:cncPanels').find(row=>row.id===id),after={...before,stockItemType:type,stockItemId:target.id,stockSku:target.sku,sheetWidth:Math.max(target.width,target.height),sheetHeight:Math.min(target.width,target.height),pendingOffcuts:[],pendingOffcut:null,...(freshPdf?{pdfRevision:before.pdfRevision+1}: {})};return delta(before,transform(after,before));}),activity={id:'sheet-size-activity-'+String(++sequence),type:'cnc',source:freshPdf?'cnc-pdf':'cnc-edit',panelRecordIds:ids,desc:'Update pending sheet stock and dimensions',qty:'',timestamp:stamp};return [...changes,delta(null,activity,'transactions')];
}
function rejectsWithoutWrites(store,changes,actor=admin){const before=structuredClone(store.docs),count=store.mutations.size;assert.throws(()=>store.mutate(command(changes),actor));assert.deepEqual(store.docs,before);assert.equal(store.writes.length,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);assert.equal(store.mutations.size,count);}

test('resizing both stable Sheet 12 records uses the chosen SOH size and clears proposals without changing area, evidence, stock quantities or other orders',()=>{
 const other=panel('other',{jobReference:'Other job',orderNumber:'999',sheetNumber:'12',status:'completed',sheetWidth:2800,sheetHeight:1100,completedAt:stamp}),store=fixture([panel('a'),panel('b'),other]),before=structuredClone(store.docs),result=store.mutate(command(edits(store)),admin);assert.equal(result.status,200);assert.equal(result.body.revision,13);assert.deepEqual(store.broadcasts,[13]);
 for(const id of ['a','b']){const old=before['app:cncPanels'].find(row=>row.id===id),saved=store.docs['app:cncPanels'].find(row=>row.id===id);assert.deepEqual(saved,{...old,stockItemId:'new-stock',stockSku:'AL-3200',sheetWidth:3200,sheetHeight:1250,pendingOffcuts:[],pendingOffcut:null});}
 assert.deepEqual(store.docs['app:cncPanels'].find(row=>row.id==='other'),other);for(const key of ['qa-checks','qa-panel-area:a','app:variants','app:offcuts','orders','panel-dispatch-loads'])assert.deepEqual(store.docs[key],before[key],key);assert.deepEqual(store.docs['app:transactions'].filter(row=>row.id==='original-activity'),before['app:transactions']);assert.equal(store.docs['app:cncPanels'].length,3);
});

test('SOH dimensions are canonical regardless of stock orientation and may come from an existing offcut',()=>{
 const reversed=fixture();reversed.docs['app:variants'].find(item=>item.id==='new-stock').width=1250;reversed.docs['app:variants'].find(item=>item.id==='new-stock').height=3200;assert.equal(reversed.mutate(command(edits(reversed)),admin).status,200);
 const offcut=fixture(),target=offcut.docs['app:offcuts'][0];assert.equal(offcut.mutate(command(edits(offcut,{target,type:'offcut'})),admin).status,200);assert.ok(offcut.docs['app:cncPanels'].every(row=>row.stockItemType==='offcut'&&row.stockItemId==='new-offcut'&&row.sheetWidth===3200&&row.sheetHeight===1250));assert.equal(offcut.docs['app:offcuts'][0].qty,3);
});

test('a single sibling cannot move stock or resize while its physical-sheet peers retain conflicting dimensions or stock',()=>{
 const stockOnly=fixture();rejectsWithoutWrites(stockOnly,edits(stockOnly,{ids:['a']}));
 const dimensionsOnly=fixture();rejectsWithoutWrites(dimensionsOnly,edits(dimensionsOnly,{target:oldStock,ids:['a'],transform:after=>({...after,sheetWidth:2900})}));
 const incoherent=fixture();rejectsWithoutWrites(incoherent,edits(incoherent,{transform:(after,before)=>before.id==='a'?{...after,sheetWidth:3199}:after}));
});

test('same-stock resizing must still match that SOH item and mismatched, missing or stale stock selections reject',()=>{
 const cases=[{target:oldStock,transform:after=>({...after,sheetWidth:3200,sheetHeight:1250})},{target:{...newStock,id:'missing'}},{target:{...newStock,sku:'WRONG-SKU'}},{target:newStock,type:'offcut'},{target:newStock,transform:after=>({...after,sheetWidth:3199})},{target:newStock,transform:after=>({...after,sheetWidth:3200.01})}];for(const options of cases){const store=fixture();rejectsWithoutWrites(store,edits(store,options));}
 const staleStock=fixture(),changes=edits(staleStock);staleStock.docs['app:variants'].find(item=>item.id==='new-stock').width=3100;rejectsWithoutWrites(staleStock,changes);
});

test('the existing exact-record and source identity guards reject stale before values or mismatched change IDs',()=>{
 const stale=fixture(),changes=edits(stale);changes[0].before.panelNumber='Stale prior label';rejectsWithoutWrites(stale,changes);
 const wrong=fixture(),wrongChanges=edits(wrong);wrongChanges[0].id='not-the-source-id';rejectsWithoutWrites(wrong,wrongChanges);
});

test('ordinary stock or dimension edits must clear both offcut representations on every affected sheet peer',()=>{
 for(const variant of ['array','alias','sibling']){const store=fixture(),changes=edits(store),selected=variant==='sibling'?changes[1]:changes[0];if(variant==='array')selected.after.pendingOffcuts=structuredClone(selected.before.pendingOffcuts);else if(variant==='alias')selected.after.pendingOffcut=structuredClone(selected.before.pendingOffcut);else{selected.after.pendingOffcuts=structuredClone(selected.before.pendingOffcuts);selected.after.pendingOffcut=structuredClone(selected.before.pendingOffcut);}rejectsWithoutWrites(store,changes);}
});

test('a fresh linked PDF revision can carry valid replacement proposals for each changed row',()=>{
 const store=fixture(),fresh={length:400,width:1250,dimensionOrder:'sheet',status:'pending',source:'cnc-pdf',rectangle:{x:2800,y:0,width:400,height:1250}},changes=edits(store,{freshPdf:true,transform:after=>({...after,pendingOffcuts:[structuredClone(fresh)],pendingOffcut:structuredClone(fresh)})}),result=store.mutate(command(changes),admin);assert.equal(result.status,200);for(const row of store.docs['app:cncPanels']){assert.equal(row.pdfRevision,2);assert.deepEqual(row.pendingOffcuts,[fresh]);assert.deepEqual(row.pendingOffcut,fresh);assert.equal(row.uploadedAt,'2026-11-01T00:00:00Z');assert.equal(row.uploadedBy,'Original uploader');}
});

test('one row fresh PDF revision does not authorize carrying proposals on a sibling edited ordinarily',()=>{
 const store=fixture(),fresh={length:400,width:1250,status:'pending',source:'cnc-pdf'},changes=edits(store,{transform:(after,before)=>({...after,pdfRevision:before.id==='a'?before.pdfRevision+1:before.pdfRevision,pendingOffcuts:[fresh],pendingOffcut:fresh})}),pdf={id:'fresh-pdf-for-a-only',type:'cnc',source:'cnc-pdf',panelRecordIds:['a'],desc:'Fresh PDF for one row only',qty:'',timestamp:stamp};changes.push(delta(null,pdf,'transactions'));rejectsWithoutWrites(store,changes);
});

test('a completed sibling protects the physical sheet against pending stock and size edits',()=>{
 const store=fixture([panel('a'),panel('b',{status:'completed',completedAt:stamp,completedBy:'Cutter'})]);rejectsWithoutWrites(store,edits(store,{ids:['a']}));
});

test('missing free stock and reservations for other physical sheets prevent overbooking without consuming SOH',()=>{
 const empty=fixture();empty.docs['app:variants'].find(item=>item.id==='new-stock').qty=0;rejectsWithoutWrites(empty,edits(empty));
 const reserved=fixture([panel('a'),panel('b'),panel('reserved',{jobReference:'Another job',orderNumber:'88',sheetNumber:'9',stockItemId:'new-stock',stockSku:'AL-3200',sheetWidth:3200,sheetHeight:1250,pendingOffcuts:[],pendingOffcut:null})]);reserved.docs['app:variants'].find(item=>item.id==='new-stock').qty=1;rejectsWithoutWrites(reserved,edits(reserved));
});

test('label and m²-only edits with unchanged legacy sheet dimensions do not newly require SOH reconciliation or offcut clearing',()=>{
 for(const patch of [{panelNumber:'Corrected historical ID'},{totalPanelArea:2.99}]){const store=fixture([panel('a',{sheetWidth:2999}),panel('b',{sheetWidth:2999})]),before=store.docs['app:cncPanels'][0],activity={id:'legacy-nonphysical-'+String(++sequence),type:'cnc',source:'cnc-edit',panelRecordIds:['a'],desc:'Correct a nonphysical scheduled field',qty:'',timestamp:stamp};assert.equal(store.mutate(command([delta(before,{...before,...patch}),delta(null,activity,'transactions')]),admin).status,200);const after=store.docs['app:cncPanels'][0];assert.equal(after.sheetWidth,2999);assert.deepEqual(after.pendingOffcuts,before.pendingOffcuts);assert.deepEqual(after.pendingOffcut,before.pendingOffcut);}
});

test('non-admin edits, retried mutations and transactional failures preserve stock and schedule integrity',()=>{
 const denied=fixture();rejectsWithoutWrites(denied,edits(denied),staff);
 const store=fixture(),body=command(edits(store)),first=store.mutate(body,admin);store.docs['app:cncPanels'][0].panelNumber='Later correction';const after=structuredClone(store.docs),counts=[store.writes.length,store.audits.length,store.broadcasts.length];assert.equal(store.mutate(body,admin).body.duplicate,true);assert.equal(first.body.revision,13);assert.deepEqual(store.docs,after);assert.deepEqual([store.writes.length,store.audits.length,store.broadcasts.length],counts);assert.throws(()=>store.mutate(body,{...admin,username:'other-admin'}),error=>error.status===409);
 const failed=fixture(),before=structuredClone(failed.docs);failed.failWrite('revision');assert.throws(()=>failed.mutate(command(edits(failed)),admin),/Simulated storage failure/);assert.deepEqual(failed.docs,before);assert.equal(failed.mutations.size,0);assert.equal(failed.writes.length,0);assert.equal(failed.audits.length,0);assert.equal(failed.broadcasts.length,0);
});

test('changing selected stock or size does not bypass an existing reviewed main and cap assembly binding',()=>{
 const store=fixture(),reviewId='existing-sticker-review-0001',rows=store.read('app:cncPanels'),main={...rows[0],sticker:{reviewId,labelId:'label-main',role:'main',mainPanelId:'a',areaM2:1.234}},cap={...rows[1],panelNumber:'A EP-L',sticker:{reviewId,labelId:'label-cap',role:'cap',mainPanelId:'a'}},activity={id:reviewId,type:'cnc',source:'cnc-stickers',panelRecordIds:['a','b'],desc:'Existing reviewed main and cap relationship',qty:'',timestamp:stamp,stickerReview:{schemaVersion:1,confirmed:true,scopeConfirmed:true,areaGeneration:null,restoreEpoch:0,scope:{project:'Tower',orderNumber:'007'},source:{fileName:'Original stickers.pdf',sha256:'b'.repeat(64),bytes:100},labels:[{page:1,labelId:'label-main',reference:'A',areaM2:1.234,project:'Tower',order:'007',date:'-',warnings:[],caps:[{labelId:'label-cap',reference:'A EP-L',side:'L',parentReference:'A',evidence:'end-plate-label'}]}],mappings:[{panelId:'a',labelId:'label-main',role:'main',mainPanelId:'a'},{panelId:'b',labelId:'label-cap',role:'cap',mainPanelId:'a'}]}};assert.equal(store.mutate(command([delta(rows[0],main),delta(rows[1],cap),delta(null,activity,'transactions')]),admin).status,200);const before=structuredClone(store.docs),counts=[store.writes.length,store.audits.length,store.broadcasts.length];assert.throws(()=>store.mutate(command(edits(store)),admin),error=>error.status===409&&/sticker|review|assembly/i.test(error.message));assert.deepEqual(store.docs,before);assert.deepEqual([store.writes.length,store.audits.length,store.broadcasts.length],counts);
});

test('the reported Sheet 12 change shrinks 4000 × 1250 stock to 3200 × 1250 and removes the old 3986 × 383 proposals from both records',()=>{
 const oldProposal={length:3986,width:383,dimensionOrder:'sheet',status:'pending',source:'cnc-pdf',rectangle:{x:14,y:867,width:3986,height:383}},rows=['a','b'].map(id=>panel(id,{stockSku:'AL-4000',sheetWidth:4000,sheetHeight:1250,pendingOffcuts:[structuredClone(oldProposal)],pendingOffcut:structuredClone(oldProposal)})),store=fixture(rows);Object.assign(store.docs['app:variants'].find(item=>item.id==='old-stock'),{sku:'AL-4000',width:4000,height:1250});const before=structuredClone(store.docs),result=store.mutate(command(edits(store)),admin);assert.equal(result.status,200);assert.deepEqual(store.docs['app:cncPanels'].map(row=>[row.id,row.sheetNumber,row.sheetWidth,row.sheetHeight,row.stockSku]),[['a','12',3200,1250,'AL-3200'],['b','12',3200,1250,'AL-3200']]);assert.ok(store.docs['app:cncPanels'].every(row=>row.pendingOffcuts.length===0&&row.pendingOffcut===null&&row.totalPanelArea===2.75&&row.status==='pending'));for(const key of ['app:variants','app:offcuts','qa-checks','qa-panel-area:a'])assert.deepEqual(store.docs[key],before[key]);
});

test('fresh PDF resize validates singleton offcut bounds, rectangles and list consistency while allowing a valid singleton proposal',()=>{
 const within={length:400,width:383,dimensionOrder:'sheet',status:'pending',source:'cnc-pdf',rectangle:{x:2800,y:867,width:400,height:383}},cases=[{list:null,alias:{length:3986,width:383,status:'pending',source:'cnc-pdf'}},{list:null,alias:{...within,rectangle:{x:3000,y:867,width:400,height:383}}},{list:[within],alias:{...within,length:300,rectangle:{x:2800,y:867,width:300,height:383}}}];for(const value of cases){const store=fixture(),changes=edits(store,{freshPdf:true,transform:after=>({...after,pendingOffcuts:structuredClone(value.list),pendingOffcut:structuredClone(value.alias)})});rejectsWithoutWrites(store,changes);}
 const singleton={length:3186,width:383,dimensionOrder:'sheet',status:'pending',source:'cnc-pdf',rectangle:{x:14,y:867,width:3186,height:383}},store=fixture(),result=store.mutate(command(edits(store,{freshPdf:true,transform:after=>({...after,pendingOffcuts:null,pendingOffcut:structuredClone(singleton)})})),admin);assert.equal(result.status,200);for(const row of store.docs['app:cncPanels']){assert.equal(row.sheetWidth,3200);assert.equal(row.sheetHeight,1250);assert.equal(row.pdfRevision,2);assert.equal(row.pendingOffcuts,null);assert.deepEqual(row.pendingOffcut,singleton);}
});
