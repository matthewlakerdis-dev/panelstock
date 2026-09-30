import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,workshopView,handleWorkshop} from '../src/workshop-stock.js';
const actor={username:'operator',isAdmin:true};
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const create=(category='fixings',unit='each')=>applyWorkshop(empty(),{action:'create',item:{category,unit,name:'Workshop item',sku:'STOCK-1',qty:20,reorderLevel:5,packSize:1}},actor).next;
const move=(s,action,quantity,job='Job A',reason='Count checked')=>applyWorkshop(s,{action,itemId:s.items[0].id,quantity,job,reason},actor).next;
test('reservations protect other jobs; usage consumes own allocation; returns restore on hand',()=>{
 let s=create();s=move(s,'reserve',12);assert.equal(s.items[0].qty,20);
 assert.throws(()=>move(s,'use',9,'Job B'),/unavailable/);
 assert.throws(()=>move(s,'reserve',9,'Job B'),/Not enough/);
 s=move(s,'use',5);assert.equal(s.items[0].qty,15);assert.equal(s.items[0].reservations['Job A'],7);
 s=move(s,'release',7);s=move(s,'return',2);assert.equal(s.items[0].qty,17);assert.equal(s.items[0].reservations['Job A'],0);
 assert.equal(s.movements.length,5);assert.equal(s.movements[0].user,'operator');
});
test('stocktake cannot undercut reservations and invalid movements leave state unchanged',()=>{
 const s=move(create(),'reserve',10),before=JSON.stringify(s);
 for(const [action,q] of [['stocktake',9],['damage',11],['release',11],['receive',-1],['use',NaN],['reserve',0]])assert.throws(()=>move(s,action,q));
 assert.equal(JSON.stringify(s),before);const counted=move(s,'stocktake',14);assert.equal(counted.items[0].qty,14);assert.equal(counted.movements[0].quantity,-6);
 assert.throws(()=>move(s,'damage',1,'',''),/reason/);assert.throws(()=>move(s,'use',1,''),/Job reference/);
 assert.throws(()=>move(s,'reserve',1,'__proto__'),/Invalid job/);
});
test('all new categories support bounded fractional quantities and unique stock codes',()=>{
 for(const [c,u] of [['extrusions','lengths'],['fixings','boxes'],['consumables','litres']]){
 let s=create(c,u);s=move(s,'receive',0.125);assert.equal(s.items[0].qty,20.125);
 assert.throws(()=>move(s,'receive',0.0001),/decimal/);
 assert.throws(()=>applyWorkshop(s,{action:'create',item:{category:c,unit:u,name:'Duplicate',sku:'stock-1',qty:1}},actor),/already exists/);
 }
});
function fakeStore(){const docs=new Map();return {read:(k,d)=>structuredClone(docs.has(k)?docs.get(k):d),write:(k,v)=>docs.set(k,structuredClone(v)),requireTask:(a,t)=>{if(!a.isAdmin&&!a.tasks?.[t])throw Error('Forbidden');},ctx:{storage:{transactionSync:fn=>fn()}},audit(){},broadcastRevision(){}};}
test('shared sheet overview deduplicates CNC sheets and preserves panel quantities',()=>{
 const store=fakeStore();store.write('app:variants',[{id:'sheet',qty:5,color:'White',material:'ACP',thickness:4,width:1200,height:2400}]);
 store.write('app:cncPanels',[1,2].map(id=>({id,stockItemId:'sheet',stockItemType:'variant',jobReference:'Job',orderNumber:'1',sheetNumber:'1',status:'pending'})));
 const row=workshopView(store).items[0];assert.equal(row.reserved,1);assert.equal(row.available,4);assert.equal(store.read('app:variants')[0].qty,5);
});
test('permissions, stale revisions and duplicate retries are enforced at route boundary',()=>{
 const store=fakeStore(),body={mutationId:crypto.randomUUID(),expectedRevision:0,action:'create',item:{category:'extrusions',unit:'lengths',name:'Angle',sku:'ANGLE',qty:5}};
 assert.throws(()=>handleWorkshop(store,'GET',{},{}),/Forbidden/);
 assert.throws(()=>handleWorkshop(store,'POST',body,{username:'staff',tasks:{'factory.stock':true}}),/Administrator/);
 assert.equal(handleWorkshop(store,'POST',body,actor).status,200);
 assert.equal(handleWorkshop(store,'POST',body,actor).body.duplicate,true);assert.equal(store.read('workshop-stock').items.length,1);assert.equal(store.read('app:transactions').length,1);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,item:{...body.item,qty:9}},actor),/reused/);
 assert.throws(()=>handleWorkshop(store,'POST',{...body,mutationId:crypto.randomUUID()},actor),/changed/);
});
test('offcuts require remaining dimensions and metadata does not alter quantities',()=>{
 const input={action:'create',item:{category:'offcuts',unit:'lengths',name:'Angle offcut',sku:'OFF-01',qty:1}};
 assert.throws(()=>applyWorkshop(empty(),input,actor),/dimensions/);
 input.item.details='25 × 25 × 3 mm angle; 860 mm remaining';const s=applyWorkshop(empty(),input,actor).next;
 const edited=applyWorkshop(s,{action:'metadata',itemId:s.items[0].id,location:'Rack D',supplier:'Supplier',reorderLevel:0},actor).next;
 assert.equal(edited.items[0].qty,1);assert.equal(edited.items[0].location,'Rack D');
});
