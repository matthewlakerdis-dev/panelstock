import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchQueue} from '../src/dispatch-queue.js';
const actor={username:'dispatcher',tasks:{'factory.dispatch':true}};
const base={project:'Project',orderNumber:'007',createdAt:'2026-11-10T01:00:00Z',items:[{quantity:2,description:'Items'}]};
function fixture(orders,loads=[]){return {
 requireTask(user,task){if(!user.tasks?.[task])throw Error('Denied');},
 panelDispatchLoads(){return loads;},ordersWithDrawingProgress(){return orders;},panelCoatingStock(){return [];},
 read(key,fallback){return {'orders':orders,'panel-dispatch-loads':loads}[key]||fallback;}
};}
const load={id:'l1',project:'Project',orderNumber:'007',status:'waiting',routing:true,qaComplete:true,ready:true,items:[{id:'p1'}],legs:[]};
test('queue combines all order types and waiting orders but lists each panel load only once',()=>{
 const store=fixture([{...base,id:'panels',orderType:'Panels',status:'submitted',attachments:['PRIVATE']},{...base,id:'fixings',orderNumber:'008',orderType:'Fixings',status:'completed'},{...base,id:'gate',orderNumber:'009',orderType:'Gate',status:'approved'},{...base,id:'cancelled',orderType:'Other',status:'cancelled'},{...base,id:'sent',orderNumber:'010',orderType:'Other',orderTypeOther:'Flashings',status:'dispatched'}],[load]);
 const rows=dispatchQueue(store,actor);
 assert.deepEqual(rows.map(row=>row.key),['load:l1','order:fixings','order:gate','order:sent']);
 assert.deepEqual(rows.map(row=>row.status),['ready','ready','waiting','dispatched']);
 assert.equal(rows.at(-1).orderType,'Flashings');assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|attachments/);
 assert.throws(()=>dispatchQueue(store,{tasks:{}}),/Denied/);
});
test('unscheduled panels cannot use direct order dispatch and orphan loads remain visible',()=>{
 const rows=dispatchQueue(fixture([{...base,id:'unscheduled',orderNumber:'008',orderType:'Panels',status:'completed'}],[load]),actor);
 assert.equal(rows.length,2);assert.equal(rows.find(row=>row.key==='order:unscheduled').ready,false);
 assert.equal(rows.find(row=>row.key==='order:unscheduled').reason,'Waiting for panel scheduling');
});
test('coating, final QA and partial deliveries retain distinct load stages and actions',()=>{
 const loads=[{...load,id:'sent',status:'dispatched_to_site',legs:[{destination:'Site'}]},{...load,id:'coating',status:'at_powder_coaters',ready:false},{...load,id:'final',status:'awaiting_final_qa',ready:false},{...load,id:'pending',routing:false,qaComplete:false,ready:false}];
 const rows=dispatchQueue(fixture([{...base,id:'panels',orderType:'Panels',status:'submitted'}],loads),actor);
 assert.equal(rows.length,4);assert.ok(rows.every(row=>row.kind==='load'));
 assert.equal(rows.find(row=>row.key==='load:coating').status,'coating');
 assert.equal(rows.find(row=>row.key==='load:final').reason,'Awaiting final QA');
 assert.match(rows.find(row=>row.key==='load:pending').reason,/routing.*QA/);
 assert.equal(rows.find(row=>row.key==='load:sent').ready,false);
});

test('cancelled panel orders are absent without hiding orphan or active loads',()=>{const rows=dispatchQueue(fixture([{...base,id:'cancelled',orderType:'Panels',status:'cancelled'}],[load,{...load,id:'orphan',orderNumber:'unlinked'}]),actor);assert.deepEqual(rows.map(row=>row.key),['load:orphan']);});
