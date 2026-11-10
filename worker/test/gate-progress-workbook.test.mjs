import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {CNC_COLUMNS} from '../src/cnc-excel.js';
import {gateProgressSample} from '../src/gate-progress-sample.js';
import {gateProgressRows} from '../src/gate-progress-excel.js';
import {buildGateProgressFeed} from '../src/gate-progress-workbook.js';
import {gateProgressStages,isGateProgressComplete} from '../src/gate-progress-stages.js';
import {gateComponentOrders} from '../src/gate-components.js';
import {updateGateProduction} from '../src/gate-order-progress.js';
function partsOf(bytes){const b=Buffer.from(bytes),parts={};let p=0;while(b.readUInt32LE(p)===0x04034b50){const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),extra=b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;parts[name]=inflateRawSync(b.subarray(start,start+size)).toString();p=start+size;}return parts;}
test('Gate Progress appends a seventh live worksheet without changing existing sheet data or query IDs',async()=>{
 const orders=gateProgressSample().orders,url='https://example.test/cnc-tracker/excel-data?token=synthetic',base=partsOf(await buildXlsxBytes([],CNC_COLUMNS,url,undefined,[],[]));
 const bytes=await buildXlsxBytes([],CNC_COLUMNS,url,undefined,[],[],orders),parts=partsOf(bytes),sheet=parts['xl/worksheets/sheet7.xml'];
 assert.equal((parts['xl/workbook.xml'].match(/<sheet /g)||[]).length,7);assert.match(parts['xl/workbook.xml'],/<sheet name="Gate Progress" sheetId="7" r:id="rId10"/);assert.match(parts['xl/workbook.xml'],/name="Gate_Progress" localSheetId="6">'Gate Progress'!\$A\$5:\$P\$20/);
 for(let id=1;id<=6;id++){assert.equal(parts[`xl/worksheets/sheet${id}.xml`],base[`xl/worksheets/sheet${id}.xml`]);assert.equal(parts[`xl/queryTables/queryTable${id}.xml`],base[`xl/queryTables/queryTable${id}.xml`]);}
 assert.match(parts['xl/_rels/workbook.xml.rels'],/Id="rId10"[^>]+Target="worksheets\/sheet7.xml"/);assert.match(parts['xl/worksheets/_rels/sheet7.xml.rels'],/queryTable7.xml/);assert.match(parts['[Content_Types].xml'],/PartName="\/xl\/worksheets\/sheet7.xml"/);assert.match(parts['[Content_Types].xml'],/PartName="\/xl\/queryTables\/queryTable7.xml"/);
 assert.equal((parts['xl/connections.xml'].match(/<connection /g)||[]).length,7);assert.match(parts['xl/connections.xml'],/report=gate-progress&amp;gateProgressVersion=1/);assert.match(parts['xl/queryTables/queryTable7.xml'],/connectionId="7"[^>]+preserveFormatting="1" adjustColumnWidth="0" growShrinkType="insertDelete"/);
 assert.match(sheet,/Order 41 — Bin Gate — Villa V135/);assert.doesNotMatch(sheet,/V137|outline|collapsed=|hidden=/);assert.match(sheet,/pane ySplit="4"/);assert.doesNotMatch(parts['xl/styles.xml'],/indent=/);
 const styles=parts['xl/styles.xml'],count=Number(styles.match(/<cellXfs count="(\d+)"/)[1]);assert.ok([...sheet.matchAll(/ s="(\d+)"/g)].every(match=>Number(match[1])<count));assert.match(styles,/formatCode="dd\/mm\/yyyy hh:mm"/);assert.equal(gateProgressRows(orders).filter(row=>row.kind==='component').length,9);
 const empty=partsOf(await buildXlsxBytes([],CNC_COLUMNS,url,undefined,[],[],[]));assert.match(empty['xl/workbook.xml'],/Gate_Progress" localSheetId="6">'Gate Progress'!\$A\$5:\$P\$5/);assert.doesNotMatch(empty['xl/worksheets/sheet7.xml'],/outline/);
});
test('live gate feed shares stages, excludes delivered orders, keeps outstanding deliveries and preserves legacy Drawn progress',()=>{
 const orders=gateProgressSample().orders,feed=buildGateProgressFeed(orders);
 assert.equal((feed.match(/<tr /g)||[]).length,gateProgressRows(orders).length);assert.equal((feed.match(/<td /g)||[]).length,gateProgressRows(orders).length*16);assert.match(feed,/bgcolor="#8ce28c"/);assert.match(feed,/bgcolor="#ffff99"/);assert.match(feed,/x:num="12.5"/);assert.doesNotMatch(feed,/V137|qaHistory|sample-order|shipment|driver|destination/);
 assert.equal(isGateProgressComplete(orders[2]),true);assert.equal(isGateProgressComplete({...orders[0],status:'dispatched'}),false);assert.equal(isGateProgressComplete({status:'completed',components:[]}),false);assert.equal(isGateProgressComplete({status:'dispatched',components:[]}),true);
 const stages=gateProgressStages([],{missing:true,legacyStages:{drawn:true,fabricatedQa:true,readyForDispatch:true}});for(const key of ['drawn','fabricatedQa','readyForDispatch'])assert.equal(stages.find(stage=>stage.key===key).symbol,'✓');
 assert.equal((buildGateProgressFeed([]).match(/<td /g)||[]).length,16);
 const unsafe=buildGateProgressFeed([{...orders[0],project:'=1+1 <script>& "quote"',phone:'PRIVATE',previousQa:[{photo:'PRIVATE'}]}]);assert.match(unsafe,/&lt;script&gt;&amp;/);assert.doesNotMatch(unsafe,/<script>|PRIVATE|<f>/);
});
test('resetting a configured gate to Undrawn reaches order, set and component rows in the workbook and live feed',async()=>{
 const actor={username:'manager',tasks:{'site.orders.manage':true}},stamp='2026-11-11T01:00:00Z';
 const components=[1,2].map(index=>({id:'component-'+index,key:'gate-'+index,set:1,kind:'Gate',label:'Gate 0'+index}));
 const records=components.map(component=>({id:'qa-'+component.id,kind:'metalwork',gateOrderId:'configured-gate',gateComponentId:component.id,gateRevision:'approved-revision',status:'approved',latest:{checkedBy:'inspector',checkedAt:stamp},history:[{status:'approved',checkedBy:'inspector',checkedAt:stamp}]}));
 const order={id:'configured-gate',project:'Drawing status',villa:'V100',orderNumber:'100',orderType:'Buggy Gate',status:'completed',updatedAt:stamp,completedAt:stamp,gateComponents:{spec:{sets:[{gates:2,highlights:0,posts:0}]},components,shipments:[],deliveries:[]},manualProduction:{areaM2:6,qaWorkflowVersion:1,qaRevision:'approved-revision',qaItemIds:records.map(record=>record.id),statusBeforeReady:'approved',stages:{drawn:'complete',fabricatedQa:'complete',readyForDispatch:'complete'}}};
 const documents=new Map([['orders',[order]],['qa-checks',records]]),store={read:(key,fallback)=>structuredClone(documents.get(key)??fallback),write:(key,value)=>documents.set(key,structuredClone(value)),requireTask:(user,task)=>assert.equal(user.tasks?.[task],true),ctx:{storage:{transactionSync:fn=>fn()}},audit(){},notify(){}};
 const schedule=[{orderId:order.id,assignedUsername:'worker',scheduleType:'general',status:'planned'}];
 const before=gateComponentOrders(store.read('orders'),store.read('qa-checks'),schedule);
 for(const row of gateProgressRows(before).filter(row=>row.kind!=='villa'))for(const key of ['drawn','fabricatedQa','readyForDispatch'])assert.equal(row.stages.find(stage=>stage.key===key).symbol,'✓');
 const reset=updateGateProduction(store,order.id,{expectedUpdatedAt:stamp,stages:{drawn:'pending'},areaM2:6},actor);
 assert.equal(reset.order.status,'approved');assert.deepEqual(store.read('qa-checks'),records);
 const after=gateComponentOrders(store.read('orders'),store.read('qa-checks'),schedule),rows=gateProgressRows(after),progress=rows.filter(row=>row.kind!=='villa');
 assert.deepEqual(progress.map(row=>row.kind),['order','set','component','component']);
 for(const row of progress){
  for(const key of ['drawn','fabricatedQa','readyForDispatch'])assert.equal(row.stages.find(stage=>stage.key===key).symbol,'-');
  assert.equal(row.stages.find(stage=>stage.key==='scheduledForProduction').symbol,'✓');
 }
 const feedRows=[...buildGateProgressFeed(after).matchAll(/<tr [^>]*>([\s\S]*?)<\/tr>/g)].map(match=>[...match[1].matchAll(/<td [^>]*>([\s\S]*?)<\/td>/g)].map(cell=>cell[1]));
 assert.equal(feedRows.length,rows.length);
 for(const values of feedRows.slice(1)){assert.equal(values[5],'-');assert.equal(values[6],'✓');assert.equal(values[7],'-');assert.equal(values[8],'-');}
 const parts=partsOf(await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=synthetic',undefined,[],[],after)),sheet=parts['xl/worksheets/sheet7.xml'];
 for(const row of [6,7,8,9]){
  for(const column of ['F','H','I'])assert.match(sheet,new RegExp('<c r="'+column+row+'"[^>]*><is><t[^>]*>-<\\/t><\\/is><\\/c>'));
  assert.match(sheet,new RegExp('<c r="G'+row+'"[^>]*><is><t[^>]*>✓<\\/t><\\/is><\\/c>'));
 }
});
test('Drawn summaries respect explicit undrawn components and retain sample and legacy defaults',()=>{
 const sample=gateProgressSample().orders.find(order=>order.orderType==='Buggy Gate');
 assert.equal(gateProgressStages(sample.components).find(stage=>stage.key==='drawn').symbol,'✓');
 assert.equal(gateProgressStages(sample.components.map(component=>({...component,drawn:true}))).find(stage=>stage.key==='drawn').symbol,'✓');
 const mixed=gateProgressStages(sample.components.map((component,index)=>({...component,drawn:index===0}))).find(stage=>stage.key==='drawn');
 assert.equal(mixed.symbol,'-');assert.equal(mixed.detail,'1/2 complete');
 assert.equal(gateProgressStages([],{missing:true,legacyStages:{drawn:true}}).find(stage=>stage.key==='drawn').symbol,'✓');
 assert.equal(gateProgressStages([],{missing:true,legacyStages:{drawn:false}}).find(stage=>stage.key==='drawn').symbol,'-');
});
