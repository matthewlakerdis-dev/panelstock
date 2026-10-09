import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {orderHistory} from '../src/order-history.js';
test('history is scoped to one order, chronological and exposes only safe fields',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE audit(id INTEGER PRIMARY KEY,username TEXT,action TEXT,at TEXT,detail TEXT)');
 const insert=db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)');
 insert.run(1,'alice','order-created','2026-10-01',JSON.stringify({orderId:'one',secret:'private'}));
 insert.run(2,'bob','order-status','2026-10-02',JSON.stringify({orderId:'other',status:'cancelled'}));
 insert.run(3,'bob','order-status','2026-10-03',JSON.stringify({orderId:'one',status:'ordered'}));
 insert.run(4,'bob','order-attachment-added','2026-10-04',JSON.stringify({orderId:'one',name:'drawing.pdf',data:'private'}));
 const store={requireTask(actor,task){assert.equal(task,'site.orders.view');if(!actor.allowed)throw Error('Denied');},read:()=>[{id:'one',createdAt:'2026-10-01',requestedBy:'alice'},{id:'old',createdAt:'2025-01-01',requestedBy:'legacy'}],sql:{exec:(sql,...args)=>({toArray:()=>db.prepare(sql).all(...args)})}};
 assert.throws(()=>orderHistory(store,'one',{}),/Denied/);
 assert.throws(()=>orderHistory(store,'missing',{allowed:true}),/not found/);
 const result=orderHistory(store,'one',{allowed:true});assert.equal(result.events.length,3);assert.equal(result.events[1].status,'ordered');assert.equal(result.events[1].actor,'bob');assert.equal(result.events[2].fileName,'drawing.pdf');assert.doesNotMatch(JSON.stringify(result),/private|cancelled/);
 assert.equal(orderHistory(store,'old',{allowed:true}).events[0].actor,'legacy');db.close();
});
