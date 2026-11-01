import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkshop,stocktakeReport} from '../src/workshop-stock.js';
const actor={username:'counter',isAdmin:true};
const base=()=>({revision:0,items:[{id:'a',name:'Angle',sku:'ANG',category:'extrusions',qty:10,unit:'lengths',supplier:'Lennox',reservations:{}},{id:'b',name:'Bolt',sku:'BOLT',category:'fixings',qty:3,unit:'boxes',reservations:{}}],movements:[],metadata:{},stocktakes:[{id:'c',name:'November count',categories:['extrusions','fixings'],supplier:'',itemIds:['a','b'],counts:{},status:'open',createdBy:'admin'}]});
const submit=(s,id,quantity)=>applyWorkshop(s,{action:'stocktake_batch',stocktakeId:'c',counts:[{itemId:id,expectedQty:s.items.find(i=>i.id===id).qty,quantity}]},actor).next;
test('final submission saves an immutable report with exact variances and zero counts',()=>{
 let s=submit(base(),'a',8);assert.equal(s.stocktakes[0].report,undefined);
 s=submit(s,'b',0);const report=s.stocktakes[0].report;
 assert.equal(s.stocktakes[0].status,'completed');assert.equal(report.name,'November count');
 assert.deepEqual(report.rows.map(r=>[r.expectedQty,r.quantity,r.variance,r.unit]),[[10,8,-2,'lengths'],[3,0,-3,'boxes']]);
 assert.equal(report.rows[0].user,'counter');assert.ok(report.completedAt);assert.equal(report.rows[0].historicalDetails,false);
 s=applyWorkshop(s,{action:'receive',itemId:'a',quantity:5,reason:'Later delivery'},actor).next;
 s=applyWorkshop(s,{action:'metadata',itemId:'a',name:'Renamed'},actor).next;
 assert.deepEqual(s.stocktakes[0].report,report);assert.equal(s.stocktakes[0].report.rows[0].name,'Angle');assert.equal(s.items[0].qty,13);
});
test('legacy reports recover baseline from linked adjustments and never substitute current stock',()=>{
 const s=base(),c=s.stocktakes[0];c.status='completed';c.counts={a:{quantity:8,user:'old'},b:{quantity:0}};
 s.items[0].qty=100;s.movements=[{stocktakeId:'c',itemId:'a',quantity:-2}];
 const r=stocktakeReport(s,c);assert.equal(r.rows[0].expectedQty,10);assert.equal(r.rows[1].expectedQty,null);assert.equal(r.rows[1].variance,null);assert.equal(r.rows[0].historicalDetails,true);
});
