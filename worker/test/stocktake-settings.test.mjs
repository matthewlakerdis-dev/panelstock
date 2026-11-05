import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultStocktakeSettings,readStocktakeSettings,handleStocktakeSettings} from '../src/stocktake-settings.js';
import {applyWorkshop,handleWorkshop,workshopView} from '../src/workshop-stock.js';
import {handlePurchaseOrders} from '../src/purchase-orders.js';

const admin={username:'admin',isAdmin:true},worker={username:'worker',tasks:{'factory.stock':true}},settingsUser={username:'settings',tasks:{'factory.settings':true}};
const workshop=()=>({revision:9,items:[{id:'angle',name:'Angle',sku:'ANGLE',category:'extrusions',unit:'lengths',qty:7,reservations:{'Job A':2},unitCost:12.34,xeroGroup:'materials'}],metadata:{},movements:[]});
const extraGroup={id:'adhesives',label:'Adhesives',accountCode:'0051001'};
function storeFor(){
 const documents=new Map([['revision',41],['workshop-stock',workshop()],['app:variants',[{id:'sheet',sku:'SHEET',color:'White',material:'ACP',thickness:3,width:2400,height:1200,qty:4}]],['app:offcuts',[{id:'cut',sku:'CUT',color:'White',material:'ACP',thickness:3,width:600,height:300,qty:1}]]]);
 const store={documents,writes:0,transactions:0,audits:[],broadcasts:[],failWriteAt:null,
  read:(key,fallback)=>structuredClone(documents.has(key)?documents.get(key):fallback),
  write:(key,value)=>{store.writes++;if(store.failWriteAt===store.writes)throw Error('Injected storage failure');documents.set(key,structuredClone(value));},
  requireTask:(actor,task)=>{if(!actor.isAdmin&&!actor.tasks?.[task]){const error=Error('Forbidden');error.status=403;throw error;}},
  audit:(...args)=>store.audits.push(structuredClone(args)),broadcastRevision:revision=>store.broadcasts.push(revision),
  ctx:{storage:{transactionSync:fn=>{store.transactions++;const before=structuredClone([...documents]),audits=store.audits.length;try{return fn();}catch(error){documents.clear();for(const [key,value] of before)documents.set(key,value);store.audits.length=audits;throw error;}}}}};
 return store;
}
function packet(store,patch={}){
 const current=readStocktakeSettings(store);
 return {cosGroups:structuredClone(current.cosGroups),assetAccountCode:current.assetAccountCode,trackingName:current.trackingName,trackingOption:current.trackingOption,direction:current.direction,expectedRevision:current.revision,mutationId:crypto.randomUUID(),...patch};
}
const save=(store,patch={},actor=admin)=>handleStocktakeSettings(store,'POST',packet(store,patch),actor);
const withExtra=()=>[...defaultStocktakeSettings().cosGroups,extraGroup];
const postStock=(store,body,actor=admin)=>handleWorkshop(store,'POST',{mutationId:crypto.randomUUID(),expectedRevision:store.read('workshop-stock').revision,...body},actor);
const errorStatus=status=>error=>error.status===status;

test('shared stocktake settings expose stable defaults without writing or sharing mutable defaults',()=>{
 const store=storeFor(),defaults=defaultStocktakeSettings();
 assert.equal(defaults.version,1);assert.equal(defaults.revision,0);
 assert.deepEqual(defaults.cosGroups.map(({id,accountCode})=>[id,accountCode]),[['cladding','51050'],['fixings','51066'],['materials','51097'],['route-stiffeners','51085'],['silicone','51090']]);
 assert.ok(defaults.cosGroups.every(group=>typeof group.label==='string'&&group.label.trim().length>0));
 assert.equal(defaults.assetAccountCode,'11350');assert.equal(defaults.trackingName,'job');assert.equal(defaults.trackingOption,'Factory/Production - BAU');assert.equal(defaults.direction,'');
 assert.deepEqual(readStocktakeSettings(store),defaults);assert.equal(store.writes,0);assert.equal(store.transactions,0);
 defaults.cosGroups[0].label='Changed only locally';assert.notEqual(defaultStocktakeSettings().cosGroups[0].label,defaults.cosGroups[0].label);
 const read=readStocktakeSettings(store);read.cosGroups[1].accountCode='Changed';assert.equal(readStocktakeSettings(store).cosGroups[1].accountCode,'51066');
});

test('settings reads allow stock and settings viewers while every write requires admin access',()=>{
 const store=storeFor(),before=structuredClone([...store.documents]);
 for(const actor of [admin,worker,settingsUser]){
  const result=handleStocktakeSettings(store,'GET',{},actor);assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.deepEqual(result.body.stocktakeSettings,defaultStocktakeSettings());
 }
 for(const actor of [{username:'none'},{username:'unrelated',tasks:{'factory.receive':true}}])assert.throws(()=>handleStocktakeSettings(store,'GET',{},actor),errorStatus(403));
 for(const actor of [worker,settingsUser,{username:'none'}])assert.throws(()=>save(store,{},actor),errorStatus(403));
 assert.deepEqual([...store.documents],before);assert.equal(store.writes,0);assert.equal(store.transactions,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
});

test('admin saves trim fields, preserve leading zero codes and commit settings once without changing workshop stock',()=>{
 const store=storeFor(),beforeWorkshop=store.read('workshop-stock'),groups=withExtra().map(group=>({...group,label:'  '+group.label+'  ',accountCode:'  '+group.accountCode+'  '}));
 const result=save(store,{cosGroups:groups,assetAccountCode:'  0011350  ',trackingName:'  Job  ',trackingOption:'  Factory & Production  ',direction:'asset-credit'}),settings=result.body.stocktakeSettings;
 assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.equal(settings.version,1);assert.equal(settings.revision,1);
 assert.equal(settings.assetAccountCode,'0011350');assert.equal(settings.trackingName,'Job');assert.equal(settings.trackingOption,'Factory & Production');assert.equal(settings.direction,'asset-credit');
 assert.equal(settings.cosGroups.at(-1).accountCode,'0051001');assert.equal(settings.cosGroups.at(-1).label,'Adhesives');
 assert.deepEqual(store.read('workshop-stock'),beforeWorkshop);assert.equal(store.read('revision'),42);assert.equal(store.writes,3);assert.equal(store.transactions,1);assert.equal(store.audits.length,1);assert.deepEqual(store.broadcasts,[42]);
 assert.deepEqual(readStocktakeSettings(store),settings);assert.deepEqual(handleStocktakeSettings(store,'GET',{},worker).body.stocktakeSettings,settings);
});

test('duplicate labels and account codes are allowed while group IDs remain stable',()=>{
 const store=storeFor(),groups=withExtra();groups[0]={...groups[0],label:'Combined expense',accountCode:'00510'};groups[1]={...groups[1],label:'Combined expense',accountCode:'00510'};
 const result=save(store,{cosGroups:groups});assert.equal(result.status,200);
 assert.deepEqual(result.body.stocktakeSettings.cosGroups.slice(0,2).map(({label,accountCode})=>[label,accountCode]),[['Combined expense','00510'],['Combined expense','00510']]);
 const reversed=[...result.body.stocktakeSettings.cosGroups].reverse();assert.equal(save(store,{cosGroups:reversed}).status,200);
 assert.deepEqual(readStocktakeSettings(store).cosGroups.map(group=>group.id),reversed.map(group=>group.id));
});

test('group settings accept the fifty group limit and trim valid maximum length fields',()=>{
 const store=storeFor(),groups=defaultStocktakeSettings().cosGroups;
 for(let i=groups.length;i<50;i++)groups.push({id:'custom-'+i,label:'L'.repeat(120),accountCode:'0'.repeat(30)});
 const result=save(store,{cosGroups:groups,assetAccountCode:'  '+'0'.repeat(30)+'  ',trackingName:'  '+'N'.repeat(120)+'  ',trackingOption:'  '+'O'.repeat(120)+'  ',direction:'asset-debit'});
 assert.equal(result.body.stocktakeSettings.cosGroups.length,50);assert.equal(result.body.stocktakeSettings.trackingName.length,120);assert.equal(result.body.stocktakeSettings.assetAccountCode.length,30);
});

test('invalid group IDs, duplicate IDs, invalid counts and removed historical IDs reject atomically',()=>{
 const store=storeFor(),before=structuredClone([...store.documents]),defaults=defaultStocktakeSettings().cosGroups;
 const invalidGroups=[null,{},[],[...defaults,...Array.from({length:46},(_,i)=>({id:'extra-'+i,label:'Extra',accountCode:'001'}))],[...defaults,defaults[0]],defaults.slice(1)];
 for(const id of ['',1,null,'1group','Group','two_words','asset','constructor','prototype','a'.repeat(81),'route/stiffeners',' materials'])invalidGroups.push([...defaults,{id,label:'Invalid ID',accountCode:'001'}]);
 for(const cosGroups of invalidGroups){assert.throws(()=>save(store,{cosGroups}),errorStatus(400));assert.deepEqual([...store.documents],before);}
 save(store,{cosGroups:withExtra()});const committed=structuredClone([...store.documents]),writes=store.writes;
 assert.throws(()=>save(store,{cosGroups:defaults}),errorStatus(400));assert.deepEqual([...store.documents],committed);assert.equal(store.writes,writes);
});

test('invalid labels, codes, tracking fields and journal directions reject without writes',()=>{
 const store=storeFor(),before=structuredClone([...store.documents]),defaults=defaultStocktakeSettings().cosGroups;
 const invalidText=['','   ',null,1,{},[],true,'Control\u0000value','Line\nbreak','Trailing newline\n','\tLeading tab','C1\u0085control','Line\u2028separator','Paragraph\u2029separator','<tag>','Greater > value'];
 const patches=[];
 for(const value of [...invalidText,'L'.repeat(121)])patches.push({cosGroups:defaults.map((group,i)=>i?group:{...group,label:value})});
 for(const value of [...invalidText,'0'.repeat(31)]){patches.push({cosGroups:defaults.map((group,i)=>i?group:{...group,accountCode:value})});patches.push({assetAccountCode:value});}
 for(const value of [...invalidText,'T'.repeat(121)]){patches.push({trackingName:value});patches.push({trackingOption:value});}
 for(const direction of ['debit','credit','ASSET-DEBIT',' asset-debit',null,1,{},[]])patches.push({direction});
 for(const patch of patches){assert.throws(()=>save(store,patch),errorStatus(400));assert.deepEqual([...store.documents],before);}
 assert.equal(store.writes,0);assert.equal(store.transactions,0);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
});

test('settings enforce revision leases and exact retries return current settings without duplicate audit',()=>{
 const store=storeFor(),firstBody=packet(store,{cosGroups:withExtra(),trackingName:'First'}),first=handleStocktakeSettings(store,'POST',firstBody,admin);
 assert.equal(first.body.stocktakeSettings.revision,1);
 const second=save(store,{trackingName:'Current',direction:'asset-debit'});assert.equal(second.body.stocktakeSettings.revision,2);
 const before=structuredClone([...store.documents]),writes=store.writes,audits=store.audits.length,broadcasts=store.broadcasts.length;
 const retry=handleStocktakeSettings(store,'POST',firstBody,admin);assert.equal(retry.body.duplicate,true);assert.deepEqual(retry.body.stocktakeSettings,second.body.stocktakeSettings);
 assert.equal(store.writes,writes);assert.equal(store.audits.length,audits);assert.equal(store.broadcasts.length,broadcasts);assert.deepEqual([...store.documents],before);
 assert.throws(()=>handleStocktakeSettings(store,'POST',{...firstBody,trackingName:'Different'},admin),errorStatus(409));
 assert.throws(()=>handleStocktakeSettings(store,'POST',{...firstBody,mutationId:crypto.randomUUID()},admin),errorStatus(409));
 assert.throws(()=>handleStocktakeSettings(store,'POST',firstBody,{username:'another-admin',isAdmin:true}),errorStatus(409));
 assert.deepEqual([...store.documents],before);
});

test('invalid mutation identifiers reject and failed storage commits roll back settings and global revision',()=>{
 const store=storeFor(),before=structuredClone([...store.documents]);
 for(const mutationId of ['',null,1,'short','invalid id with spaces'])assert.throws(()=>handleStocktakeSettings(store,'POST',packet(store,{mutationId}),admin),errorStatus(400));
 assert.equal(store.writes,0);store.failWriteAt=2;
 assert.throws(()=>save(store,{cosGroups:withExtra()}),/Injected storage failure/);
 assert.deepEqual([...store.documents],before);assert.equal(readStocktakeSettings(store).revision,0);assert.equal(store.read('revision'),41);assert.equal(store.audits.length,0);assert.equal(store.broadcasts.length,0);
});

test('trusted settings extend create, metadata and mixed bulk group validation while defaults remain compatible',()=>{
 const store=storeFor(),settings=save(store,{cosGroups:withExtra()}).body.stocktakeSettings,state=workshop();
 const create={action:'create',item:{name:'New stock',sku:'NEW',category:'fixings',unit:'each',qty:0,xeroGroup:'adhesives'}};
 assert.throws(()=>applyWorkshop(state,create,admin),/Xero stock group/);
 let next=applyWorkshop(state,create,admin,settings).next;assert.equal(next.items.at(-1).xeroGroup,'adhesives');
 next=applyWorkshop(next,{action:'metadata',itemId:'angle',xeroGroup:'adhesives'},admin,settings).next;assert.equal(next.items[0].xeroGroup,'adhesives');
 next=applyWorkshop(next,{action:'metadata',itemId:'variant:sheet',xeroGroup:'adhesives'},admin,settings).next;assert.equal(next.metadata['variant:sheet'].xeroGroup,'adhesives');
 next=applyWorkshop(next,{action:'bulk_metadata',itemIds:['angle','variant:sheet','offcut:cut'],changes:{xeroGroup:'adhesives'}},admin,settings).next;
 assert.equal(next.metadata['offcut:cut'].xeroGroup,'adhesives');assert.equal(next.items[0].qty,7);assert.equal(next.items[0].unitCost,12.34);assert.deepEqual(next.items[0].reservations,{'Job A':2});
 for(const input of [create,{action:'metadata',itemId:'angle',xeroGroup:'adhesives'},{action:'bulk_metadata',itemIds:['angle'],changes:{xeroGroup:'adhesives'}}])assert.throws(()=>applyWorkshop(state,input,worker,settings),errorStatus(403));
});

test('workshop handler reads shared groups from the server and ignores injected client settings',()=>{
 const store=storeFor();save(store,{cosGroups:withExtra()});
 let result=postStock(store,{action:'metadata',itemId:'angle',xeroGroup:'adhesives',stocktakeSettings:defaultStocktakeSettings()});assert.equal(result.body.items.find(row=>row.id==='angle').xeroGroup,'adhesives');
 result=postStock(store,{action:'bulk_metadata',itemIds:['angle','variant:sheet','offcut:cut'],changes:{xeroGroup:'adhesives'}});
 for(const id of ['angle','variant:sheet','offcut:cut'])assert.equal(result.body.items.find(row=>row.id===id).xeroGroup,'adhesives');
 const before=store.read('workshop-stock'),injected={...readStocktakeSettings(store),cosGroups:[...withExtra(),{id:'injected',label:'Injected',accountCode:'999'}]};
 for(const input of [{action:'create',item:{name:'Injected stock',sku:'INJECTED',category:'fixings',unit:'each',qty:0,xeroGroup:'injected'}},{action:'metadata',itemId:'angle',xeroGroup:'injected'},{action:'bulk_metadata',itemIds:['angle','variant:sheet'],changes:{xeroGroup:'injected'}}]){
  assert.throws(()=>postStock(store,{...input,stocktakeSettings:injected,cosGroups:injected.cosGroups}),/Xero stock group/);assert.deepEqual(store.read('workshop-stock'),before);
 }
 assert.deepEqual(workshopView(store).stocktakeSettings,readStocktakeSettings(store));
});

test('renaming shared groups preserves assignments and omitted legacy assignments stay unchanged',()=>{
 const store=storeFor();save(store,{cosGroups:withExtra()});
 postStock(store,{action:'bulk_metadata',itemIds:['angle','variant:sheet'],changes:{xeroGroup:'adhesives'}});
 const before=store.read('workshop-stock'),groups=readStocktakeSettings(store).cosGroups.map(group=>group.id==='adhesives'?{...group,label:'Sealants and adhesives',accountCode:'00099'}:group);
 save(store,{cosGroups:groups});assert.deepEqual(store.read('workshop-stock'),before);
 const view=workshopView(store);assert.equal(view.stocktakeSettings.cosGroups.find(group=>group.id==='adhesives').label,'Sealants and adhesives');assert.equal(view.items.find(row=>row.id==='angle').xeroGroup,'adhesives');assert.equal(view.items.find(row=>row.id==='variant:sheet').xeroGroup,'adhesives');
 const older=workshop();older.items[0].xeroGroup='historical-group';older.metadata['offcut:cut']={xeroGroup:'historical-group'};
 const next=applyWorkshop(older,{action:'bulk_metadata',itemIds:['angle','offcut:cut'],changes:{location:'Rack B'}},admin,readStocktakeSettings(store)).next;
 assert.equal(next.items[0].xeroGroup,'historical-group');assert.equal(next.metadata['offcut:cut'].xeroGroup,'historical-group');assert.equal(next.items[0].qty,older.items[0].qty);
});

test('PO item creation validates custom groups against server settings and remains retry safe',()=>{
 const store=storeFor();save(store,{cosGroups:withExtra()});const original=store.read('workshop-stock');
 const body={action:'create_item',restoreEpoch:0,mutationId:crypto.randomUUID(),stocktakeSettings:defaultStocktakeSettings(),item:{sku:'ADHESIVE',name:'Adhesive tube',category:'consumables',unit:'tubes',qty:0,xeroGroup:'adhesives'}};
 assert.throws(()=>handlePurchaseOrders(store,'POST',body,{username:'receiver',tasks:{'factory.receive':true}}),errorStatus(403));
 const result=handlePurchaseOrders(store,'POST',body,admin);assert.equal(result.status,200);
 const created=result.body.items.find(row=>row.id===result.body.itemId);assert.equal(created.xeroGroup,'adhesives');assert.equal(created.qty,0);assert.deepEqual(result.body.orders,[]);
 const state=store.read('workshop-stock'),history=store.read('app:transactions'),writes=store.writes;
 assert.equal(state.revision,original.revision+1);assert.deepEqual(state.items.find(row=>row.id==='angle'),original.items[0]);
 const retry=handlePurchaseOrders(store,'POST',body,admin);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.itemId,result.body.itemId);assert.equal(store.writes,writes);assert.deepEqual(store.read('workshop-stock'),state);assert.deepEqual(store.read('app:transactions'),history);
 const injected={...readStocktakeSettings(store),cosGroups:[...withExtra(),{id:'injected',label:'Injected',accountCode:'999'}]};
 assert.throws(()=>handlePurchaseOrders(store,'POST',{...body,mutationId:crypto.randomUUID(),stocktakeSettings:injected,item:{...body.item,sku:'INJECTED',xeroGroup:'injected'}},admin),/Xero stock group/);
 assert.deepEqual(store.read('workshop-stock'),state);assert.equal(store.writes,writes);
});
