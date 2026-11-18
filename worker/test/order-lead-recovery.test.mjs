import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import lead from '../../order-lead-times.js';
const source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8'),start=source.indexOf('  async function updateSubmissionDelivery('),end=source.indexOf('  function wireSubmissionRecovery(',start);
function recovery(){
 const packet={localId:'local',idempotencyKey:'same-submission-key',order:{orderType:'Fixings',requestedDeliveryDate:'2020-01-01',items:[{quantity:2,description:'RETAIN ITEM'}]},attachments:[{id:'file',storageId:'retained-file',name:'notes.pdf'}],error:{code:'ORDER_LEAD_TIME',step:'order',message:'Too soon'}},input={dataset:{submissionDelivery:'local'},value:'2099-11-30',reportValidity:()=>true};let writes=0,renders=0;
 const context={busy:false,session:{username:'requester'},sessionVersion:1,window:{PanelStockOrderLeadTimes:lead},root:{querySelectorAll:()=>[input]},submissionPacket:key=>key==='local'&&context.session.username==='requester'?packet:null,saveOutbox:()=>writes++,render:()=>renders++,api:async()=>Response.json({leadTimes:{days:{Fixings:5}}}),message:''};vm.createContext(context);vm.runInContext(source.slice(start,end),context);return {context,packet,input,writes:()=>writes,renders:()=>renders,run:()=>context.updateSubmissionDelivery('local')};
}
test('rejected unsaved requests can change only their delivery date while retaining files and retry identity',async()=>{
 const c=recovery(),before=structuredClone(c.packet);await c.run();assert.equal(c.packet.order.requestedDeliveryDate,'2099-11-30');assert.equal(c.packet.idempotencyKey,before.idempotencyKey);assert.deepEqual(c.packet.order.items,before.order.items);assert.deepEqual(c.packet.attachments,before.attachments);assert.equal(c.packet.error,undefined);assert.equal(c.writes(),1);assert.equal(c.context.busy,false);
});
test('current minimums and storage failure retain the original queued request',async()=>{
 const c=recovery();c.input.value='2020-01-02';await c.run();assert.equal(c.packet.order.requestedDeliveryDate,'2020-01-01');assert.equal(c.writes(),0);assert.match(c.packet.error.message,/Earliest/);
 c.input.value='2099-11-30';c.context.saveOutbox=()=>{throw Error('Storage full');};await c.run();assert.equal(c.packet.order.requestedDeliveryDate,'2020-01-01');assert.equal(c.packet.error.message,'Storage full');assert.equal(c.packet.attachments[0].storageId,'retained-file');
});
test('saved orders, account switches and duplicate clicks cannot alter a waiting request',async()=>{
 const saved=recovery();saved.packet.orderId='already-saved';await saved.run();assert.equal(saved.writes(),0);
 const c=recovery();let finish,calls=0;c.context.api=()=>{calls++;return new Promise(resolve=>finish=resolve);};const pending=c.run();await c.run();assert.equal(calls,1);c.context.session={username:'other'};c.context.sessionVersion++;finish(Response.json({leadTimes:{days:{Fixings:5}}}));await pending;assert.equal(c.writes(),0);assert.equal(c.packet.order.requestedDeliveryDate,'2020-01-01');
});
