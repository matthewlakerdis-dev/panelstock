import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveOffcutAreaCost,decimalRatio,samePanelMaterial} from '../src/offcut-costing.js';
import {applyWorkshop,workshopView,handleWorkshop} from '../src/workshop-stock.js';
const actor={username:'admin',isAdmin:true};
const full=(id='sheet',patch={})=>({id,catalogId:'white',color:'White',material:'ACP',thickness:3,width:2000,height:1000,qty:0,...patch});
const cut=(id='cut',patch={})=>({id,catalogId:'white',sku:'CUT',color:'White',material:'ACP',thickness:3,width:500,height:400,qty:3,...patch});
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
function setup({variants=[full()],offcuts=[cut()],metadata={'variant:sheet':{name:'Full source sheet',unitCost:200}},catalog=[{id:'white',color:'White',material:'ACP',thickness:3,width:0,height:0}]}={}){
 const docs=new Map([['workshop-stock',{...empty(),metadata}],['app:variants',variants],['app:offcuts',offcuts],['app:catalog',catalog]]);let writes=0;
 const store={read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>{writes++;docs.set(key,structuredClone(value));},requireTask:(who,task)=>{if(!who.isAdmin&&!who.tasks?.[task])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};
 const view=()=>workshopView(store).items.find(i=>i.id==='offcut:cut');
 const post=(body,who=actor)=>handleWorkshop(store,'POST',{mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision,...body},who);
 return {docs,store,view,post,get writes(){return writes;}};
}
test('unpriced panel offcuts use actual full-sheet dimensions and price per square metre without writing on GET',()=>{
 const x=setup(),before=structuredClone(x.docs),v=x.view();assert.equal(v.costBasis,'area');assert.equal(v.qty,3);assert.equal(v.unit,'sheets');assert.equal(v.available,3);
 assert.equal(v.areaCostStatus,'resolved');assert.equal(v.areaCost.ratePerM2,100);assert.equal(v.areaCost.effectiveUnitCost,20);
 assert.deepEqual(v.areaCost,{sourceItemId:'variant:sheet',sourceName:'Full source sheet',sourceWidth:2000,sourceHeight:1000,sourceCostBasis:'unit',sourceUnitCost:200,sourcePackCost:null,sourcePackSize:1,offcutWidth:500,offcutHeight:400,ratePerM2:100,effectiveUnitCost:20});
 assert.deepEqual(v.areaCostSources,[{id:'variant:sheet',name:'Full source sheet',width:2000,height:1000,ratePerM2:100,priced:true}]);
 handleWorkshop(x.store,'GET',{},actor);assert.equal(x.writes,0);assert.deepEqual(x.docs,before);
});
test('equal exact rates select a deterministic source; different rates require selection',()=>{
 const variants=[full('z',{width:1000}),full('a')],metadata={'variant:z':{unitCost:100},'variant:a':{unitCost:200}};
 let x=setup({variants,metadata});assert.equal(x.view().areaCostStatus,'resolved');assert.equal(x.view().areaCost.sourceItemId,'variant:a');
 metadata['variant:a'].unitCost=250;x=setup({variants,metadata});assert.equal(x.view().areaCostStatus,'needs_source');assert.equal(x.view().areaCost,null);assert.equal(x.view().areaCostSources.length,2);
 metadata['offcut:cut']={costBasis:'area',costSourceItemId:'variant:z'};x=setup({variants,metadata});assert.equal(x.view().areaCost.ratePerM2,100);assert.equal(x.view().areaCost.sourceItemId,'variant:z');
});
test('a missing or unpriced explicit source never falls back to a different priced sheet',()=>{
 const variants=[full('priced'),full('unpriced')],metadata={'variant:priced':{unitCost:200},'offcut:cut':{costBasis:'area',costSourceItemId:'variant:unpriced'}};
 let x=setup({variants,metadata});assert.equal(x.view().areaCostStatus,'source_unpriced');assert.equal(x.view().areaCost,null);
 metadata['offcut:cut'].costSourceItemId='variant:deleted';x=setup({variants,metadata});assert.equal(x.view().areaCostStatus,'invalid_source');assert.equal(x.view().areaCost,null);
 delete metadata['offcut:cut'];x=setup({variants,metadata});assert.equal(x.view().areaCost.sourceItemId,'variant:priced');
});
test('material colour and thickness must match even when a catalogue ID is shared',()=>{
 for(const patch of [{color:'Black'},{material:'Aluminium'},{thickness:4}]){const x=setup({variants:[full('sheet',patch)]});assert.equal(x.view().areaCostStatus,'no_matching_source');assert.deepEqual(x.view().areaCostSources,[]);}
 assert.equal(samePanelMaterial({catalogId:'missing'},{catalogId:'missing'}),false);
 const x=setup({offcuts:[cut('cut',{color:'',material:'',thickness:undefined})]});assert.equal(x.view().areaCostStatus,'resolved');
});
test('zero prices, pack-priced full sheets, decimal dimensions and scientific notation are preserved',()=>{
 let x=setup({metadata:{'variant:sheet':{unitCost:0}}});assert.equal(x.view().areaCostStatus,'resolved');assert.equal(x.view().areaCost.effectiveUnitCost,0);
 x=setup({metadata:{'variant:sheet':{costBasis:'pack',packCost:600,packSize:3,unitCost:999}}});assert.equal(x.view().areaCost.ratePerM2,100);assert.equal(x.view().areaCost.sourceCostBasis,'pack');assert.equal(x.view().areaCost.sourcePackCost,600);assert.equal(x.view().areaCost.sourcePackSize,3);assert.equal(x.view().areaCost.effectiveUnitCost,20);
 const variants=[full('a',{width:.3,height:.7}),full('b',{width:.1,height:.7})],metadata={'variant:a':{unitCost:.21},'variant:b':{unitCost:.07}};
 x=setup({variants,metadata,offcuts:[cut('cut',{width:.1,height:.1})]});assert.equal(x.view().areaCostStatus,'resolved');assert.equal(x.view().areaCost.ratePerM2,1e6);assert.equal(x.view().areaCost.effectiveUnitCost,.01);
 assert.deepEqual(decimalRatio(1e-7),{n:1n,d:10000000n});
 const r=resolveOffcutAreaCost(cut('cut',{width:1e-5,height:1e-4}),{},[full('tiny',{width:1e-4,height:1e-3})],{'variant:tiny':{unitCost:1}},[]);assert.equal(r.areaCostStatus,'resolved');assert.equal(r.areaCost.effectiveUnitCost,.01);
});
test('unusable dimensions and absent source prices remain unpriced',()=>{
 for(const patch of [{width:0},{height:NaN},{width:Infinity}]){const x=setup({offcuts:[cut('cut',patch)]});assert.equal(x.view().areaCostStatus,'invalid_offcut_dimensions');assert.equal(x.view().areaCost,null);}
 let x=setup({metadata:{}});assert.equal(x.view().areaCostStatus,'source_unpriced');assert.equal(x.view().areaCost,null);
 x=setup({variants:[full('sheet',{width:0})]});assert.equal(x.view().areaCostStatus,'invalid_source_dimensions');assert.equal(x.view().areaCost,null);
});
test('manual and pack prices are preserved while area candidates remain available',()=>{
 for(const own of [{unitCost:7},{unitCost:0},{costBasis:'unit',unitCost:10},{costBasis:'pack',packCost:null,packSize:100,unitCost:20}]){
  const x=setup({metadata:{'variant:sheet':{unitCost:200},'offcut:cut':own}}),v=x.view();assert.notEqual(v.costBasis,'area');assert.equal(v.unitCost,own.unitCost);assert.equal(v.areaCostSources.length,1);assert.equal(v.areaCost.effectiveUnitCost,20);
 }
 const x=setup({metadata:{'variant:sheet':{unitCost:200},'offcut:cut':{costBasis:'area',unitCost:99}}});assert.equal(x.view().costBasis,'area');assert.equal(x.view().unitCost,99);assert.equal(x.view().areaCost.effectiveUnitCost,20);
});
test('area pricing writes are admin-only and limited to legacy sheet offcuts',()=>{
 const x=setup(),staff={username:'staff',tasks:{'factory.stock':true}};
 assert.throws(()=>x.post({action:'metadata',itemId:'offcut:cut',costBasis:'area',costSourceItemId:'variant:sheet'},staff),/Administrator/);
 assert.throws(()=>applyWorkshop(empty(),{action:'metadata',itemId:'offcut:cut',costBasis:'area'},staff),/Administrator/);
 assert.throws(()=>x.post({action:'metadata',itemId:'variant:sheet',costBasis:'area'}),/Choose unit or pack/);
 assert.throws(()=>x.post({action:'metadata',itemId:'variant:sheet',costSourceItemId:'variant:sheet'}),/only available for panel offcuts/);
 assert.throws(()=>applyWorkshop(empty(),{action:'create',item:{name:'Angle offcut',category:'offcuts',unit:'lengths',details:'Small angle',qty:0,costBasis:'area'}},actor),/Choose unit or pack/);
 assert.equal(x.writes,0);
 const result=x.post({action:'metadata',itemId:'offcut:cut',costBasis:'area',costSourceItemId:'variant:sheet'});assert.equal(result.body.items.find(i=>i.id==='offcut:cut').areaCostStatus,'resolved');assert.equal(x.store.read('app:offcuts')[0].qty,3);assert.equal(x.store.read('workshop-stock').metadata['offcut:cut'].costSourceItemId,'variant:sheet');
});
test('actual source validation rejects wrong-material and missing sources atomically; unpriced matching sources are selectable',()=>{
 const x=setup({variants:[full(),full('black',{color:'Black'})]}),before=structuredClone(x.docs);
 for(const costSourceItemId of ['variant:black','variant:deleted'])assert.throws(()=>x.post({action:'metadata',itemId:'offcut:cut',costBasis:'area',costSourceItemId}),/matching material/);
 assert.deepEqual(x.docs,before);assert.equal(x.writes,0);
 const noPrice=setup({metadata:{}});const result=noPrice.post({action:'metadata',itemId:'offcut:cut',costBasis:'area',costSourceItemId:'variant:sheet'});assert.equal(result.body.items.find(i=>i.id==='offcut:cut').areaCostStatus,'source_unpriced');
});
test('bulk source changes validate every offcut before any write and preserve quantities',()=>{
 const x=setup({offcuts:[cut(),cut('black-cut',{color:'Black'})]}),before=structuredClone(x.docs);
 assert.throws(()=>x.post({action:'bulk_metadata',itemIds:['offcut:cut','offcut:black-cut'],changes:{costBasis:'area',costSourceItemId:'variant:sheet'}}),/matching material/);assert.deepEqual(x.docs,before);
 x.post({action:'bulk_metadata',itemIds:['offcut:cut'],changes:{costBasis:'area',costSourceItemId:'variant:sheet'}});assert.equal(x.view().areaCostStatus,'resolved');assert.equal(x.view().qty,3);
});
test('source matching uses pending catalogue relinks and rejects stale material reviews',()=>{
 const catalog=[{id:'white',color:'White',material:'ACP',thickness:3,width:0,height:0},{id:'grey',color:'Grey',material:'Aluminium',thickness:4,width:0,height:0}],variants=[full(),full('grey-sheet',{catalogId:'grey',color:'Grey',material:'Aluminium',thickness:4})];
 const x=setup({variants,catalog,metadata:{'variant:sheet':{unitCost:200},'variant:grey-sheet':{unitCost:300}}});
 const body={action:'metadata',itemId:'offcut:cut',catalogId:'grey',expectedMaterial:JSON.stringify(['white','White','ACP',3]),costBasis:'area',costSourceItemId:'variant:grey-sheet'};
 const before=structuredClone(x.docs);assert.throws(()=>x.post({...body,costSourceItemId:'variant:sheet'}),/matching material/);assert.deepEqual(x.docs,before);
 assert.throws(()=>x.post({...body,expectedMaterial:'stale'}),/material changed/);assert.deepEqual(x.docs,before);
 const result=x.post(body),v=result.body.items.find(i=>i.id==='offcut:cut');assert.equal(v.material,'Aluminium');assert.equal(v.areaCost.sourceItemId,'variant:grey-sheet');assert.equal(v.qty,3);
});
