import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleWorkshop} from '../src/workshop-stock.js';

const admin={username:'admin',isAdmin:true},reader={username:'reader',isAdmin:false,tasks:{'factory.stock':true}};
const image='data:image/png;base64,'+'a'.repeat(10000);
function fixture(){
 const state={revision:7,items:[{id:'bolt',sku:'BOLT',name:'Bolt',category:'fixings',unit:'each',qty:9,reservations:{},unitCost:1,image}],metadata:{'variant:sheet':{image}},movements:[],stocktakes:[],poStockReferences:[{key:'supplier:private',itemId:'bolt',source:{sku:'PRIVATE-SUPPLIER-ALIAS'}}]};
 const docs=new Map([['workshop-stock',JSON.stringify(state)],['revision','10'],['app:variants',JSON.stringify([{id:'sheet',qty:2,width:2400,height:1200,thickness:3,color:'White',material:'ACP'}])]]),writes=[],audits=[];let stockReads=0;
 const store={read(key,fallback){if(key==='workshop-stock'){stockReads++;assert.equal(stockReads,1,'A request must not parse the image-bearing stock document twice');}return docs.has(key)?JSON.parse(docs.get(key)):fallback;},write(key,value){writes.push(key);docs.set(key,JSON.stringify(value));},requireTask(actor,task){if(!actor.isAdmin&&!actor.tasks?.[task])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit:(...args)=>audits.push(args),broadcastRevision(){}};
 return {docs,writes,audits,request(method,body={},actor=admin){stockReads=0;const result=handleWorkshop(store,method,body,actor);assert.equal(stockReads,1);return result.body;}};
}

test('Workshop GET parses images once, preserves both image locations and limits supplier references to administrators',()=>{
 const f=fixture(),privileged=f.request('GET');assert.equal(privileged.stockLearning,true);assert.equal(privileged.stockReferences[0].source.sku,'PRIVATE-SUPPLIER-ALIAS');assert.equal(privileged.poStockReferences,undefined);assert.equal(privileged.items.find(item=>item.id==='bolt').image,image);assert.equal(privileged.items.find(item=>item.id==='variant:sheet').image,image);assert.equal(privileged.metadata['variant:sheet'].image,image);
 const ordinary=f.request('GET',{},reader);assert.equal(ordinary.stockLearning,undefined);assert.equal(ordinary.stockReferences,undefined);assert.equal(ordinary.poStockReferences,undefined);assert.equal(ordinary.items.find(item=>item.id==='bolt').image,image);assert.equal(f.writes.length,0);
 const current=JSON.parse(f.docs.get('workshop-stock'));current.revision++;current.items[0].unitCost=4;current.poStockReferences[0].source.sku='LATEST-PRIVATE-ALIAS';f.docs.set('workshop-stock',JSON.stringify(current));
 const refreshed=f.request('GET');assert.equal(refreshed.revision,8);assert.equal(refreshed.items.find(item=>item.id==='bolt').unitCost,4);assert.equal(refreshed.stockReferences[0].source.sku,'LATEST-PRIVATE-ALIAS');assert.equal(privileged.items.find(item=>item.id==='bolt').unitCost,1,'A response state must not become a cache shared by later requests');
});

test('successful edits reuse their committed state and exact retries read the latest stock once without repeating writes',()=>{
 const f=fixture(),first={action:'metadata',itemId:'bolt',unitCost:2.5,expectedRevision:7,mutationId:randomUUID()},changed=f.request('POST',first);assert.equal(changed.revision,8);assert.equal(changed.items.find(item=>item.id==='bolt').unitCost,2.5);assert.equal(changed.stockReferences[0].source.sku,'PRIVATE-SUPPLIER-ALIAS');assert.equal(changed.items.find(item=>item.id==='bolt').image,image);assert.equal(f.audits.length,1);
 f.request('POST',{...first,unitCost:3.5,expectedRevision:8,mutationId:randomUUID()});const writes=f.writes.length,audits=f.audits.length;
 const retry=f.request('POST',first);assert.equal(retry.duplicate,true);assert.equal(retry.revision,9);assert.equal(retry.items.find(item=>item.id==='bolt').unitCost,3.5);assert.equal(retry.movements.length,2);assert.equal(f.writes.length,writes);assert.equal(f.audits.length,audits);
 assert.throws(()=>f.request('POST',{...first,unitCost:99}),/reused/);assert.throws(()=>f.request('POST',{...first,mutationId:randomUUID()}),/stock changed/);assert.throws(()=>f.request('POST',{...first,expectedRevision:9,mutationId:randomUUID()},reader),/Administrator/);assert.equal(f.writes.length,writes);
});

test('legacy panel metadata validation and its successful response use the same request-local stock state',()=>{
 const f=fixture(),result=f.request('POST',{action:'metadata',itemId:'variant:sheet',unitCost:12.34,expectedRevision:7,mutationId:randomUUID()});assert.equal(result.revision,8);assert.equal(result.metadata['variant:sheet'].unitCost,12.34);assert.equal(result.items.find(item=>item.id==='variant:sheet').unitCost,12.34);assert.equal(result.metadata['variant:sheet'].image,image);
});
