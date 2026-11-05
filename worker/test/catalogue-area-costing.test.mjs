import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchCatalogueMaterial,resolveCatalogueCost} from '../src/catalogue-costing.js';
import {applyWorkshop,handleWorkshop,workshopView} from '../src/workshop-stock.js';

const admin={username:'admin',isAdmin:true},worker={username:'worker',tasks:{'factory.stock':true}};
const material=(id='white',patch={})=>({id,sku:id,color:'White',material:'ACP',thickness:3,width:0,height:0,unitCostPerM2:12.5,...patch});
const panel=(id='sheet',patch={})=>({id,catalogId:'white',sku:id,color:'White',material:'ACP',thickness:3,width:2000,height:1000,qty:4,...patch});
const offcut=(id='cut',patch={})=>panel(id,{width:500,height:400,qty:3,...patch});
function setup({catalog=[material()],variants=[panel()],offcuts=[offcut()],metadata={'variant:sheet':{unitCost:200,xeroGroup:'cladding'},'offcut:cut':{unitCost:7,xeroGroup:'materials'}}}={}){
 const state={revision:0,items:[{id:'workshop',name:'Angle',sku:'ANGLE',category:'extrusions',unit:'lengths',qty:2,unitCost:5,xeroGroup:'route-stiffeners',reservations:{}}],movements:[],metadata};
 const docs=new Map([['workshop-stock',state],['app:catalog',catalog],['app:variants',variants],['app:offcuts',offcuts]]);let writes=0;
 const store={read:(key,fallback)=>structuredClone(docs.has(key)?docs.get(key):fallback),write:(key,value)=>{writes++;docs.set(key,structuredClone(value));},requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};
 const view=()=>workshopView(store),post=(body,actor=admin)=>handleWorkshop(store,'POST',{mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision,...body},actor);
 return {docs,store,view,post,get writes(){return writes;}};
}

test('catalogue square-metre rates cost full panels and offcuts from their own dimensions without writes',()=>{
 const x=setup(),before=structuredClone(x.docs),view=x.view(),full=view.items.find(row=>row.id==='variant:sheet'),cut=view.items.find(row=>row.id==='offcut:cut');
 assert.equal(full.costBasis,'catalogue-area');assert.equal(full.effectiveUnitCost,25);assert.equal(cut.effectiveUnitCost,2.5);
 assert.deepEqual(full.catalogueCost,{catalogId:'white',name:'White · ACP · 3 mm',ratePerM2:12.5,width:2000,height:1000});
 assert.deepEqual(cut.catalogueCost,{catalogId:'white',name:'White · ACP · 3 mm',ratePerM2:12.5,width:500,height:400});
 assert.equal(full.unitCost,200);assert.equal(cut.unitCost,7);assert.equal(full.qty,4);assert.equal(cut.qty,3);
 assert.equal(full.xeroGroup,'cladding');assert.equal(cut.xeroGroup,'materials');assert.match(view.stocktakeMonth.key,/^\d{4}-\d{2}$/);
 assert.equal(view.items.find(row=>row.id==='workshop').unitCost,5);assert.equal(Object.hasOwn(view.items.find(row=>row.id==='workshop'),'catalogueCost'),false);
 assert.deepEqual(handleWorkshop(x.store,'GET',{},worker).body.items,view.items);assert.equal(x.writes,0);assert.deepEqual(x.docs,before);
});

test('a configured zero catalogue rate overrides manual, pack and old source-area prices',()=>{
 for(const own of [{unitCost:99},{unitCost:0},{costBasis:'pack',packCost:999,packSize:20,unitCost:50},{costBasis:'area',costSourceItemId:'variant:deleted',unitCost:80}]){
  const x=setup({catalog:[material('white',{unitCostPerM2:0})],metadata:{'variant:sheet':{costBasis:'pack',packCost:100,packSize:10},'offcut:cut':own}}),view=x.view();
  for(const row of view.items.filter(row=>row.legacy)){assert.equal(row.costBasis,'catalogue-area');assert.equal(row.catalogueCost.ratePerM2,0);assert.equal(row.effectiveUnitCost,0);}
  assert.deepEqual(x.store.read('workshop-stock').metadata['offcut:cut'],own);
 }
});

test('an offcut catalogue rate needs no full sheet or full-sheet price',()=>{
 const x=setup({variants:[],offcuts:[offcut('cut',{qty:0})],metadata:{}}),row=x.view().items.find(row=>row.id==='offcut:cut');
 assert.equal(row.costBasis,'catalogue-area');assert.equal(row.effectiveUnitCost,2.5);assert.equal(row.qty,0);assert.equal(Object.hasOwn(row,'areaCostSources'),false);
});

test('blank or absent catalogue rates preserve manual, pack and full-sheet-source fallback pricing',()=>{
 for(const blank of [null,undefined,'','   ']){
  const catalogue=material('white',{unitCostPerM2:blank});if(blank===undefined)delete catalogue.unitCostPerM2;
  const x=setup({catalog:[catalogue]}),view=x.view();
  const full=view.items.find(row=>row.id==='variant:sheet'),cut=view.items.find(row=>row.id==='offcut:cut');
  assert.equal(full.unitCost,200);assert.equal(cut.unitCost,7);assert.notEqual(full.costBasis,'catalogue-area');assert.notEqual(cut.costBasis,'catalogue-area');assert.equal(Object.hasOwn(full,'catalogueCost'),false);
  const pack=setup({catalog:[catalogue],metadata:{'variant:sheet':{costBasis:'pack',packCost:600,packSize:3},'offcut:cut':{costBasis:'pack',packCost:70,packSize:10}}});
  assert.equal(pack.view().items.find(row=>row.id==='offcut:cut').costBasis,'pack');
  const area=setup({catalog:[catalogue],metadata:{'variant:sheet':{unitCost:200}}}).view().items.find(row=>row.id==='offcut:cut');
  assert.equal(area.costBasis,'area');assert.equal(area.areaCost.ratePerM2,100);assert.equal(area.areaCost.effectiveUnitCost,20);
 }
});

test('linked catalogue IDs require consistent raw identity and otherwise use one unambiguous raw match',()=>{
 const catalog=[material(),material('black',{color:'Black',unitCostPerM2:90})];
 for(const item of [panel('one',{catalogId:'black'}),panel('two',{catalogId:'missing'}),panel('three',{catalogId:null,color:'  WHITE ',material:' acp ',thickness:'3'})]){
  assert.equal(matchCatalogueMaterial(item,catalog).id,'white');assert.equal(resolveCatalogueCost(item,catalog).catalogueCost.ratePerM2,12.5);
 }
 assert.equal(resolveCatalogueCost(panel('wrong',{color:'Grey'}),catalog),null);
 assert.equal(resolveCatalogueCost(panel('wrong',{material:'Aluminium'}),catalog),null);
 assert.equal(resolveCatalogueCost(panel('wrong',{thickness:4}),catalog),null);
});

test('duplicate raw material matches require a consistent unique ID even when their prices agree',()=>{
 const catalog=[material(),material('duplicate')];
 assert.equal(matchCatalogueMaterial(panel('no-link',{catalogId:'missing'}),catalog),null);
 assert.equal(resolveCatalogueCost(panel('no-link',{catalogId:null}),catalog),null);
 assert.equal(resolveCatalogueCost(panel(),catalog).catalogueCost.catalogId,'white');
 catalog[1].unitCostPerM2=99;assert.equal(resolveCatalogueCost(panel(),catalog).catalogueCost.ratePerM2,12.5);
 assert.equal(resolveCatalogueCost(panel(),[material(),material()]),null);
});

test('missing or invalid raw material identity never borrows identity from a catalogue link',()=>{
 for(const patch of [{color:''},{color:' '},{material:''},{thickness:undefined},{thickness:null},{thickness:''},{thickness:true},{thickness:-1},{thickness:Infinity}]){
  assert.equal(matchCatalogueMaterial(panel('bad',patch),[material()]),null);assert.equal(resolveCatalogueCost(panel('bad',patch),[material()]),null);
 }
 assert.equal(resolveCatalogueCost({...panel(),color:undefined,colour:'White'},[material()]).costBasis,'catalogue-area');
});

test('configured catalogue rates remain authoritative but unresolved when own stock dimensions are invalid',()=>{
 for(const patch of [{width:0},{height:NaN},{width:Infinity},{height:undefined},{width:true},{height:1000001}]){
  const x=setup({offcuts:[offcut('cut',patch)]}),row=x.view().items.find(row=>row.id==='offcut:cut');
  assert.equal(row.costBasis,'catalogue-area');assert.equal(row.effectiveUnitCost,null);assert.ok(row.catalogueCost.width===null||row.catalogueCost.height===null);assert.equal(row.unitCost,7);
 }
});

test('derived references retain decimal dimensions and update immediately when the catalogue rate changes',()=>{
 const x=setup({catalog:[material('white',{name:'Named material',unitCostPerM2:1.15})],offcuts:[offcut('cut',{width:.3,height:.7})]}),row=x.view().items.find(row=>row.id==='offcut:cut');
 assert.equal(row.catalogueCost.width,.3);assert.equal(row.catalogueCost.height,.7);assert.equal(row.catalogueCost.name,'Named material');assert.ok(Math.abs(row.effectiveUnitCost-1.15*.21/1e6)<1e-20);
 x.docs.set('app:catalog',[material('white',{unitCostPerM2:20})]);assert.equal(x.view().items.find(row=>row.id==='variant:sheet').effectiveUnitCost,40);
 x.docs.set('app:catalog',[material('white',{unitCostPerM2:null})]);assert.equal(x.view().items.find(row=>row.id==='variant:sheet').unitCost,200);assert.notEqual(x.view().items.find(row=>row.id==='variant:sheet').costBasis,'catalogue-area');
 assert.deepEqual(x.store.read('workshop-stock').metadata,{'variant:sheet':{unitCost:200,xeroGroup:'cladding'},'offcut:cut':{unitCost:7,xeroGroup:'materials'}});
});

test('configured catalogue pricing bypasses stale full-sheet source validation during normal and bulk metadata edits',()=>{
 const stale={costBasis:'area',costSourceItemId:'variant:deleted',unitCost:99},x=setup({variants:[],metadata:{'offcut:cut':stale}});
 let result=x.post({action:'metadata',itemId:'offcut:cut',xeroGroup:'cladding'});assert.equal(result.body.items.find(row=>row.id==='offcut:cut').costBasis,'catalogue-area');
 assert.equal(x.store.read('workshop-stock').metadata['offcut:cut'].costSourceItemId,'variant:deleted');
 result=x.post({action:'bulk_metadata',itemIds:['offcut:cut'],changes:{xeroGroup:'materials'}});assert.equal(result.body.items.find(row=>row.id==='offcut:cut').xeroGroup,'materials');assert.equal(x.store.read('app:offcuts')[0].qty,3);
 const before=structuredClone(x.docs);
 assert.throws(()=>x.post({action:'metadata',itemId:'offcut:cut',costBasis:'catalogue-area'}),/Choose unit, pack or area/);assert.deepEqual(x.docs,before);
 x.docs.set('app:catalog',[material('white',{unitCostPerM2:null})]);assert.throws(()=>x.post({action:'metadata',itemId:'offcut:cut',xeroGroup:'fixings'}),/matching material/);
});

test('pending offcut relinks use the resulting material catalogue rate',()=>{
 const x=setup({catalog:[material(),material('grey',{color:'Grey',material:'Aluminium',thickness:4,unitCostPerM2:30})],variants:[],metadata:{'offcut:cut':{costBasis:'area',costSourceItemId:'variant:deleted'}}});
 const result=x.post({action:'metadata',itemId:'offcut:cut',catalogId:'grey',expectedMaterial:JSON.stringify(['white','White','ACP',3]),xeroGroup:'materials'}),row=result.body.items.find(row=>row.id==='offcut:cut');
 assert.equal(row.catalogueCost.catalogId,'grey');assert.equal(row.catalogueCost.ratePerM2,30);assert.equal(row.effectiveUnitCost,6);assert.equal(row.qty,3);
});
