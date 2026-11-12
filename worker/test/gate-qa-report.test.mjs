import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildGateQaReport,gateQaOrderMetadata} from '../src/gate-qa-report.js';
import {requireCondition as check} from '../src/security.js';
const at='2026-11-12T02:00:00Z',generatedBy='qa-team',checklists={gate:[['finish','Current Gate finish'],['inactive','An inactive check']],metalwork:[['finish','Legacy metalwork finish']]};
const component=(id,set=1,kind='Gate')=>({id,key:id,set,kind,label:kind+' '+id.slice(-1)});
const order=(extra={})=>({id:'gate-order-1',project:'Same Project',orderNumber:'007',orderType:'Bin Gate',villa:'V135',colour:'Spruce',phone:'PRIVATE PHONE',siteContact:'PRIVATE CONTACT',attachments:[{data:'PRIVATE ATTACHMENT'}],status:'submitted',gateComponents:{components:[component('part-1'),component('part-2',1,'Highlight'),component('part-3',2,'Post')],previousQaItemIds:[],shipments:[],deliveries:[]},manualProduction:{qaWorkflowVersion:1,qaRevision:'revision-current',qaItemIds:['qa-1','qa-2','qa-3'],areaM2:12.5,drawnBy:'designer',drawnAt:'2026-11-11T22:00:00Z',stages:{drawn:'complete'}},...extra});
const inspection=(id,status='approved')=>({id,status,checklistKind:'gate',checklist:[['finish','Wording at inspection']],results:{finish:status==='approved'?'pass':'fail'},checkedBy:'inspector',checkedAt:'2026-11-12T01:00:00Z',notes:'Keep full notes',photo:'data:image/png;base64,aGVsbG8='});
const qa=(index,status='approved',extra={})=>{const latest=inspection('inspection-'+index,status);return {id:'qa-'+index,kind:'metalwork',gateOrderId:'gate-order-1',gateComponentId:'part-'+index,gateSet:index===3?2:1,gateRevision:'revision-current',reference:'Piece '+index,quantity:1,status,createdAt:'2026-11-11T22:00:00Z',drawnBy:'designer',latest,history:[structuredClone(latest)],photoAdditions:[{id:'addition-'+index,attemptId:latest.id,photos:['data:image/jpeg;base64,d29ybGQ='],addedBy:'photo-team',addedAt:at,mutationId:'mutation-'+index}],...extra};};
const report=(saved=order(),records=[qa(1),qa(2),qa(3)])=>buildGateQaReport(saved,records,checklists,generatedBy,at);
const additive=summary=>summary.approved+summary.recut+summary.awaiting+summary.missing;

test('a single order snapshot includes every configured set/piece and all immutable QA evidence without private order fields',()=>{
 const saved=order(),records=[qa(1),qa(2),qa(3)],before=JSON.stringify({saved,records}),value=report(saved,records);
 assert.equal(value.type,'gate-order');assert.equal(value.orderId,saved.id);assert.equal(value.status,'approved');assert.equal(value.items.length,3);assert.deepEqual(value.items.map(item=>item.set),[1,1,2]);
 assert.deepEqual(value.items.map(item=>item.qaId),['qa-1','qa-2','qa-3']);assert.equal(value.summary.approved,3);assert.equal(value.summary.totalQuantity,3);assert.equal(additive(value.summary),3);assert.equal(value.areaM2,12.5);
 assert.equal(value.generatedAt,at);assert.equal(value.generatedBy,generatedBy);assert.equal(value.villa,'V135');assert.equal(value.currentRevision,'revision-current');assert.deepEqual(value.checklists,checklists);assert.equal(value.previousQa.length,0);
 assert.deepEqual(value.items[0].latest,records[0].latest);assert.deepEqual(value.items[0].history,records[0].history);assert.deepEqual(value.items[0].photoAdditions,records[0].photoAdditions);assert.deepEqual(value.mappingIssues,[]);
 assert.doesNotMatch(JSON.stringify(value),/PRIVATE PHONE|PRIVATE CONTACT|PRIVATE ATTACHMENT|siteContact|attachments/);assert.equal(JSON.stringify({saved,records}),before);
 records[0].latest.notes='Changed after snapshot';records[0].history[0].results.finish='fail';records[0].photoAdditions[0].photos.push('later');saved.gateComponents.components[0].label='Changed label';
 assert.equal(value.items[0].latest.notes,'Keep full notes');assert.equal(value.items[0].history[0].results.finish,'pass');assert.equal(value.items[0].photoAdditions[0].photos.length,1);assert.equal(value.items[0].label,'Gate 1');
});

test('new pieces and absent QA are included instead of allowing an approved filtered subset to stand for the order',()=>{
 const saved=order();saved.gateComponents.components.push(component('part-4',2,'Gate'));saved.manualProduction.qaItemIds.push('qa-4');
 const awaiting=qa(4,'awaiting',{latest:null,history:[],photoAdditions:[]}),value=report(saved,[qa(1),qa(2),qa(3),awaiting]);
 assert.equal(value.items.length,4);assert.equal(value.status,'awaiting');assert.equal(value.summary.approved,3);assert.equal(value.summary.awaiting,1);assert.equal(additive(value.summary),4);
 const missing=report(saved,[qa(1),qa(2),qa(3)]);assert.equal(missing.status,'missing');assert.equal(missing.items[3].qaId,null);assert.equal(missing.items[3].status,'missing');assert.equal(missing.summary.missing,1);
});

test('order, revision, QA membership and component identities all bind current inspections; foreign data never joins by names',()=>{
 for(const changed of [{gateOrderId:'another-order'},{gateRevision:'old-revision'},{gateComponentId:'other-part'},{kind:'panel'}]){
  const records=[qa(1,'approved',changed),qa(2),qa(3)],value=report(order(),records);assert.notEqual(value.status,'approved');assert.equal(value.items[0].qaId,null);assert.equal(value.items[0].status,'missing');
 }
 const saved=order();saved.gateComponents.previousQaItemIds=['foreign-qa'];const foreign=qa(99,'approved',{id:'foreign-qa',gateOrderId:'another-order',reference:'FOREIGN PRIVATE REFERENCE',latest:{...inspection('foreign'),notes:'FOREIGN PRIVATE NOTES'}}),value=report(saved,[qa(1),qa(2),qa(3),foreign]);
 assert.equal(value.status,'approved');assert.equal(value.previousQa.length,0);assert.doesNotMatch(JSON.stringify(value),/FOREIGN PRIVATE/);
});

test('duplicate current IDs, record identities and component mappings fail closed and preserve all expected row placeholders',()=>{
 const duplicateLink=order();duplicateLink.manualProduction.qaItemIds=['qa-1','qa-1','qa-3'];let value=report(duplicateLink);assert.equal(value.status,'missing');assert.ok(value.mappingIssues.length);assert.equal(additive(value.summary),3);
 const duplicateRecord=[qa(1),qa(1),qa(2),qa(3)];value=report(order(),duplicateRecord);assert.equal(value.status,'missing');assert.equal(value.items[0].qaId,null);assert.equal(value.previousQa.length,2);
 const duplicateComponent=order();duplicateComponent.gateComponents.components[1]={...duplicateComponent.gateComponents.components[1],id:'part-1'};value=report(duplicateComponent);assert.equal(value.status,'missing');assert.equal(value.items.length,3);assert.equal(new Set(value.items.map(item=>item.id)).size,3);
 const foreignLink=order();foreignLink.manualProduction.qaItemIds.push('UNKNOWN-SAVED-ID');value=report(foreignLink);assert.equal(value.summary.approved,3);assert.equal(value.status,'missing');assert.ok(value.mappingIssues.length);assert.doesNotMatch(JSON.stringify(value.mappingIssues),/UNKNOWN-SAVED-ID/);
 const duplicatePiece=order();duplicatePiece.manualProduction.qaItemIds.push('qa-extra');value=report(duplicatePiece,[qa(1),qa(2),qa(3),qa(1,'approved',{id:'qa-extra'})]);assert.equal(value.status,'missing');assert.equal(value.items[0].qaId,null);
});

test('withdrawn and redrawn revisions remain separate; earlier approvals never certify the current pieces',()=>{
 const saved=order(),records=[qa(1),qa(2),qa(3)];saved.manualProduction.stages.drawn='pending';saved.manualProduction.qaRevision=null;saved.manualProduction.qaItemIds=[];
 let value=report(saved,records);assert.equal(value.status,'not_drawn');assert.equal(value.summary.approved,0);assert.equal(value.summary.awaiting,3);assert.equal(value.previousQa.length,3);assert.ok(value.items.every(item=>item.status==='not_drawn'&&item.latest===null));
 saved.manualProduction.stages.drawn='complete';saved.manualProduction.qaRevision='new-revision';saved.manualProduction.qaItemIds=['new-1','new-2','new-3'];
 const fresh=records.map((record,index)=>({...record,id:'new-'+(index+1),gateRevision:'new-revision',status:'awaiting',latest:null,history:[],photoAdditions:[]}));value=report(saved,[...fresh,...records]);
 assert.equal(value.status,'awaiting');assert.equal(value.summary.approved,0);assert.equal(value.previousQa.length,3);assert.ok(value.previousQa.every(item=>item.status==='approved'));
});

test('legacy line records retain quantities and use only saved current IDs plus item indexes or exact ordered-ID fallback',()=>{
 const saved=order({gateComponents:undefined,items:[{quantity:2,description:'Legacy gate pair'},{quantity:3,description:'Legacy posts'}]}),records=[qa(1,'approved',{gateComponentId:undefined,gateItemIndex:0,quantity:2}),qa(2,'approved',{gateComponentId:undefined,gateItemIndex:1,quantity:3})];saved.manualProduction.qaItemIds=['qa-1','qa-2'];
 let value=report(saved,records);assert.equal(value.status,'approved');assert.equal(value.summary.total,2);assert.equal(value.summary.totalQuantity,5);assert.deepEqual(value.items.map(item=>item.quantity),[2,3]);assert.ok(value.items.every(item=>item.componentId===null));
 value=report(saved,records.map(({gateItemIndex,...record})=>record));assert.equal(value.status,'approved');
 value=report(saved,records.map(record=>({...record,gateOrderId:'another-order'})));assert.equal(value.status,'missing');assert.equal(value.previousQa.length,0);
 const mismatched=records.map(record=>({...record,gateItemIndex:0}));value=report(saved,mismatched);assert.equal(value.status,'missing');assert.ok(value.items.every(item=>!item.qaId));
});

test('legacy rework normalizes only in the snapshot and retains complete current and previous inspection/photo histories',()=>{
 const current=qa(1,'rework'),older=qa(2,'rework',{id:'old-qa',gateRevision:'old-revision'}),records=[current,qa(2),qa(3),older],before=JSON.stringify(records),value=report(order(),records);
 assert.equal(value.status,'recut');assert.equal(value.items[0].status,'recut');assert.equal(value.items[0].latest.status,'recut');assert.equal(value.items[0].history[0].status,'recut');assert.equal(value.previousQa[0].latest.status,'recut');assert.deepEqual(value.previousQa[0].photoAdditions,older.photoAdditions);assert.equal(JSON.stringify(records),before);
});

test('partial component dispatch and delivery stay separate from QA; shipment approval snapshots cannot replace missing QA',()=>{
 const saved=order();saved.gateComponents.shipments=[{id:'trip-1',componentIds:['part-1'],at:at,by:'dispatcher',destination:'PRIVATE ADDRESS',driver:'PRIVATE DRIVER',notes:'PRIVATE SHIPPING NOTES',photo:'PRIVATE SHIPPING PHOTO',fingerprint:'PRIVATE FINGERPRINT',qaApprovals:[{componentId:'part-1',qaId:'qa-1',checkedAt:at}]}];saved.gateComponents.deliveries=[{id:'receipt-1',componentIds:['part-1'],at:at,by:'receiver',receivedBy:'PRIVATE SITE PERSON',notes:'PRIVATE RECEIPT NOTES',acknowledgement:{signature:'PRIVATE SIGNATURE'}}];
 let value=report(saved);assert.equal(value.status,'approved');assert.equal(value.dispatchStatus,'partial');assert.equal(value.deliveryStatus,'partial');assert.equal(value.summary.dispatched,1);assert.equal(value.summary.delivered,1);assert.equal(value.items[0].shipment.id,'trip-1');assert.equal(value.items[0].delivery.id,'receipt-1');assert.doesNotMatch(JSON.stringify(value),/PRIVATE ADDRESS|PRIVATE DRIVER|PRIVATE SHIPPING|PRIVATE FINGERPRINT|PRIVATE SITE|PRIVATE RECEIPT|PRIVATE SIGNATURE/);
 value=report(saved,[qa(2),qa(3)]);assert.equal(value.status,'missing');assert.equal(value.items[0].status,'missing');assert.equal(value.items[0].shipment.status,'dispatched');assert.equal(value.summary.dispatched,1);
});

test('legacy partial quantities distinguish one sent piece from a fully dispatched multi-piece line',()=>{
 const saved=order({gateComponents:undefined,items:[{quantity:3,description:'Gate set'}],dispatches:[{mutationId:'trip-1',at:at,by:'driver',destination:'PRIVATE',lines:[{index:0,quantity:1}]}],receipts:[{id:'receipt-1',at:at,by:'receiver',lines:[{index:0,accepted:1,damaged:0,missing:0}],acknowledgement:{name:'PRIVATE',contentHash:'PRIVATE'}}]});saved.manualProduction.qaItemIds=['qa-1'];
 const records=[qa(1,'approved',{gateComponentId:undefined,gateItemIndex:0,quantity:3})],value=report(saved,records);
 assert.equal(value.summary.totalQuantity,3);assert.equal(value.summary.dispatched,0);assert.equal(value.summary.dispatchedQuantity,1);assert.equal(value.dispatchStatus,'partial');assert.equal(value.deliveryStatus,'partial');assert.equal(value.items[0].shipment.status,'partial');assert.equal(value.items[0].delivery.quantity,1);assert.doesNotMatch(JSON.stringify(value),/PRIVATE/);
 const resent=structuredClone(saved);resent.dispatches=[];resent.dispatch={mutationId:'whole-order-trip',at,by:'driver',destination:'PRIVATE ADDRESS'};const resentReport=report(resent,records);assert.equal(resentReport.dispatchStatus,'dispatched');assert.equal(resentReport.summary.dispatchedQuantity,3);assert.equal(resentReport.items[0].shipment.id,'whole-order-trip');assert.doesNotMatch(JSON.stringify(resentReport),/PRIVATE ADDRESS/);
});

test('cancelled, empty and structurally inconsistent orders cannot be advertised as approved',()=>{
 assert.equal(report(order({status:'cancelled'})).status,'cancelled');
 const empty=order();empty.gateComponents.components=[];empty.manualProduction.qaItemIds=[];assert.equal(report(empty,[]).status,'missing');assert.ok(report(empty,[]).mappingIssues.length);
 const contradict=qa(1,'approved',{latest:inspection('inspection-1','recut')});assert.equal(report(order(),[contradict,qa(2),qa(3)]).status,'missing');
 for(const history of [[],[inspection('old-failure','recut')]]){const incomplete=qa(1,'approved',{latest:null,history});const value=report(order(),[incomplete,qa(2),qa(3)]);assert.equal(value.status,'missing');assert.equal(value.items[0].qaId,null);assert.match(value.previousQa[0].reason,/incomplete|conflicts/);}
 const historyOnly=qa(1,'approved',{latest:null,history:[inspection('history-approval')]});const historyReport=report(order(),[historyOnly,qa(2),qa(3)]);assert.equal(historyReport.status,'approved');assert.equal(historyReport.items[0].latest,null);assert.deepEqual(historyReport.items[0].history,historyOnly.history);
 assert.equal(historyReport.items[0].checklistKind,'gate');const legacyHistoryOnly=qa(1,'approved',{latest:null,history:[{id:'legacy-history',status:'approved',results:{finish:'pass'}}]});assert.equal(report(order(),[legacyHistoryOnly,qa(2),qa(3)]).items[0].checklistKind,'metalwork');assert.equal(report(order(),[qa(2),qa(3)]).items[0].checklistKind,'gate');
 const conflictingHistory=qa(1,'approved',{history:[inspection('inspection-1','recut')]});assert.equal(report(order(),[conflictingHistory,qa(2),qa(3)]).status,'missing');
 const previousConflict=order();previousConflict.gateComponents.previousQaItemIds=['qa-1'];assert.equal(report(previousConflict).status,'missing');
});

test('all saved Gate variants are recognized and compact group metadata excludes contacts and private attachments',()=>{
 for(const orderType of ['Gate','Bin Gate','Buggy Gate','Side Access Gate']){const saved=order({orderType}),metadata=gateQaOrderMetadata(saved);assert.equal(metadata.orderId,saved.id);assert.equal(report(saved).orderType,orderType);assert.doesNotMatch(JSON.stringify(metadata),/PRIVATE|phone|siteContact|attachments/);}
 assert.equal(gateQaOrderMetadata(order({orderType:'Panels'})),null);assert.throws(()=>report(order({orderType:'Fixings'})),error=>error.status===404);
});

const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8'),method=source.slice(source.indexOf('  qaGateOrderReport('),source.indexOf('  addQaInspectionPhotos('));
const createStore=new Function('check','ok','buildGateQaReport',`return ({${method}});`);
const qaTeam={username:'qa-team',tasks:{'factory.qa':true}};
function storeFixture(orders=[order()],records=[qa(1),qa(2),qa(3)]){
 const reads=[],store=Object.assign(createStore(check,(body,status=200)=>({body,status}),buildGateQaReport),{read:(key,fallback)=>{reads.push(key);return structuredClone(key==='orders'?orders:key==='qa-checks'?records:fallback);},qaSettings:()=>({gateChecks:checklists.gate,metalworkChecks:checklists.metalwork}),requireTask:(actor,key)=>check(actor.isAdmin||actor.tasks?.[key],'Task denied',403),write(){throw Error('Snapshot must not write');},audit(){throw Error('Snapshot must not audit');},qaItemsFor(){throw Error('Snapshot must not migrate stored QA');}});
 return {store,reads};
}

test('the report service permits factory QA team members, validates saved identity and performs only reads',()=>{
 const f=storeFixture(),result=f.store.qaGateOrderReport({orderId:'gate-order-1'},qaTeam);assert.equal(result.status,200);assert.equal(result.body.report.generatedBy,'qa-team');assert.equal(result.body.report.status,'approved');assert.deepEqual(f.reads,['orders','qa-checks']);
 assert.throws(()=>f.store.qaGateOrderReport({orderId:'gate-order-1'},{username:'viewer',tasks:{}}),error=>error.status===403);
 for(const body of [null,[],{}, {orderId:''},{orderId:' gate-order-1'},{orderId:'gate-order-1',includePdf:'yes'}])assert.throws(()=>f.store.qaGateOrderReport(body,qaTeam),error=>error.status===400);
 assert.throws(()=>f.store.qaGateOrderReport({orderId:'missing'},qaTeam),error=>error.status===404);
 assert.throws(()=>storeFixture([order({orderType:'Panels'})]).store.qaGateOrderReport({orderId:'gate-order-1'},qaTeam),error=>error.status===404);
});
