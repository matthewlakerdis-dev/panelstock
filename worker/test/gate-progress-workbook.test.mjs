import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {CNC_COLUMNS} from '../src/cnc-excel.js';
import {gateProgressSample} from '../src/gate-progress-sample.js';
import {gateProgressRows,buildGateProgressDraft,GATE_PROGRESS_HEADERS} from '../src/gate-progress-excel.js';
import {buildGateProgressFeed} from '../src/gate-progress-workbook.js';
import {gateProgressStages,isGateProgressComplete} from '../src/gate-progress-stages.js';
import {gateComponentOrders} from '../src/gate-components.js';
import {updateGateProduction} from '../src/gate-order-progress.js';
import {brandLogo} from '../src/brand-logo.js';
function entriesOf(bytes){const b=Buffer.from(bytes),entries=[];let p=0;while(b.readUInt32LE(p)===0x04034b50){const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),extra=b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;entries.push({name,data:inflateRawSync(b.subarray(start,start+size))});p=start+size;}return entries;}
const partsOf=bytes=>Object.fromEntries(entriesOf(bytes).map(({name,data})=>[name,data.toString()]));
const section=(styles,name)=>styles.match(new RegExp('<'+name+' count="\\d+">([\\s\\S]*?)</'+name+'>'))[1];
const feedCells=feed=>[...feed.matchAll(/<tr [^>]*>([\s\S]*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<td [^>]*>([\s\S]*?)<\/td>/g)].map(cell=>cell[1]));
function sheetValue(sheet,ref){const cell=sheet.match(new RegExp('<c r="'+ref+'"[^>]*>([\\s\\S]*?)</c>'))?.[1]||'';return cell.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]??cell.match(/<v>([\s\S]*?)<\/v>/)?.[1]??'';}
test('Gate Progress appends a seventh live worksheet without changing existing sheet data or query IDs',async()=>{
 const orders=gateProgressSample().orders,url='https://example.test/cnc-tracker/excel-data?token=synthetic',base=partsOf(await buildXlsxBytes([],CNC_COLUMNS,url,undefined,[],[]));
 const bytes=await buildXlsxBytes([],CNC_COLUMNS,url,undefined,[],[],orders),parts=partsOf(bytes),sheet=parts['xl/worksheets/sheet7.xml'];
 assert.equal((parts['xl/workbook.xml'].match(/<sheet /g)||[]).length,7);assert.match(parts['xl/workbook.xml'],/<sheet name="Gate Progress" sheetId="7" r:id="rId10"/);assert.match(parts['xl/workbook.xml'],/name="Gate_Progress" localSheetId="6">'Gate Progress'!\$A\$2:\$P\$16/);
 for(let id=1;id<=6;id++){assert.equal(parts[`xl/worksheets/sheet${id}.xml`],base[`xl/worksheets/sheet${id}.xml`]);assert.equal(parts[`xl/queryTables/queryTable${id}.xml`],base[`xl/queryTables/queryTable${id}.xml`]);assert.equal(parts[`xl/worksheets/_rels/sheet${id}.xml.rels`],base[`xl/worksheets/_rels/sheet${id}.xml.rels`]);}
 assert.match(parts['xl/_rels/workbook.xml.rels'],/Id="rId10"[^>]+Target="worksheets\/sheet7.xml"/);assert.match(parts['xl/worksheets/_rels/sheet7.xml.rels'],/queryTable7.xml/);assert.match(parts['[Content_Types].xml'],/PartName="\/xl\/worksheets\/sheet7.xml"/);assert.match(parts['[Content_Types].xml'],/PartName="\/xl\/queryTables\/queryTable7.xml"/);
 assert.equal((parts['xl/connections.xml'].match(/<connection /g)||[]).length,7);assert.match(parts['xl/connections.xml'],/report=gate-progress&amp;gateProgressVersion=3/);assert.match(parts['xl/queryTables/queryTable7.xml'],/connectionId="7"[^>]+preserveFormatting="1" adjustColumnWidth="0" growShrinkType="insertDelete"/);assert.match(parts['xl/queryTables/queryTable7.xml'],/applyWidthHeightFormats="1"/);
 assert.match(sheet,/Order 41/);assert.doesNotMatch(sheet,/V137|outline|collapsed=|hidden=/);assert.match(sheet,/pane ySplit="1" topLeftCell="A2"/);assert.doesNotMatch(parts['xl/styles.xml'],/indent=/);
 const styles=parts['xl/styles.xml'],count=Number(styles.match(/<cellXfs count="(\d+)"/)[1]);assert.ok([...sheet.matchAll(/ s="(\d+)"/g)].every(match=>Number(match[1])<count));assert.match(styles,/formatCode="dd\/mm\/yyyy hh:mm"/);assert.equal(gateProgressRows(orders).filter(row=>row.kind==='component').length,9);
 for(const name of ['fonts','fills','cellXfs'])assert.ok(section(styles,name).startsWith(section(base['xl/styles.xml'],name)),name+' keeps the existing styles and their IDs');
 const empty=partsOf(await buildXlsxBytes([],CNC_COLUMNS,url,undefined,[],[],[]));assert.match(empty['xl/workbook.xml'],/Gate_Progress" localSheetId="6">'Gate Progress'!\$A\$2:\$P\$2/);assert.doesNotMatch(empty['xl/worksheets/sheet7.xml'],/outline/);
});
test('Gate Progress leads with its hierarchy and keeps order metadata on summary rows across feed layouts',async()=>{
 const sample=gateProgressSample().orders,orders=[
  {...sample[0],project:'PRIVATE PROJECT A',villa:'V74',orderNumber:'0060',colour:'Spruce'},
  {...sample[1],project:'PRIVATE PROJECT A',villa:'V74',orderNumber:'0064',colour:'Norwegian Beech'},
  {...sample[0],id:'without-colour',project:'PRIVATE PROJECT B',villa:'V74',orderNumber:'0065',colour:undefined}
 ],before=structuredClone(orders),rows=gateProgressRows(orders),version2=gateProgressRows(orders,{columnVersion:2}),legacy=gateProgressRows(orders,{legacyColumns:true});
 assert.deepEqual(GATE_PROGRESS_HEADERS.slice(0,5),['Order / set / component','Order','Villa','Colour','Gate type']);assert.equal(GATE_PROGRESS_HEADERS.length,16);assert.ok(!GATE_PROGRESS_HEADERS.includes('Project'));
 assert.equal(rows.filter(row=>row.kind==='villa').length,0,'villa headings are not exported');
 assert.equal(rows.filter(row=>row.kind==='spacer').length,2,'each order has its own gap, including orders in the same villa');
 assert.notEqual(rows[0].kind,'spacer');assert.notEqual(rows.at(-1).kind,'spacer');
 for(const [number,colour]of [['0060','Spruce'],['0064','Norwegian Beech'],['0065','']]){
  const matching=rows.filter(row=>row.kind==='order'&&row.values[1]===number);assert.equal(matching.length,1);
  assert.match(matching[0].values[0],new RegExp('Order '+number));assert.deepEqual(matching[0].values.slice(1,4),[number,'V74',colour]);
 }
 for(const row of rows.filter(row=>['set','component'].includes(row.kind))){assert.ok(row.values[0]);assert.deepEqual(row.values.slice(1,5),['','','',''],'current metadata is shown only on the order row');}
 assert.equal(rows.length,legacy.length);assert.equal(rows.length,version2.length);
 for(let index=0;index<rows.length;index++)for(const oldRows of [legacy,version2]){assert.equal(rows[index].values.length,16);assert.equal(rows[index].kind,oldRows[index].kind);assert.deepEqual(rows[index].stages,oldRows[index].stages);assert.deepEqual(rows[index].values.slice(5),oldRows[index].values.slice(5),'stage, evidence, date and area columns F:P remain unchanged');}
 for(const oldRows of [legacy,version2])for(const row of oldRows.filter(row=>['set','component'].includes(row.kind))){assert.deepEqual(row.values.slice(0,4),['','','','']);assert.ok(row.values[4]);}
 assert.deepEqual(version2[0].values.slice(0,4),['0060','V74','Spruce','Bin Gate']);assert.deepEqual(legacy[0].values.slice(0,4),['PRIVATE PROJECT A','V74','0060','Bin Gate']);
 const feed=buildGateProgressFeed(orders),v2Feed=buildGateProgressFeed(orders,{columnVersion:2}),oldFeed=buildGateProgressFeed(orders,{legacyColumns:true}),cells=feedCells(feed),v2Cells=feedCells(v2Feed),oldCells=feedCells(oldFeed);
 assert.equal(cells.length,rows.length);assert.match(cells[0][0],/Order 0060/);assert.deepEqual(cells[0].slice(1,5),['0060','V74','Spruce','Bin Gate']);assert.deepEqual(v2Cells[0].slice(0,4),['0060','V74','Spruce','Bin Gate']);assert.deepEqual(oldCells[0].slice(0,4),['PRIVATE PROJECT A','V74','0060','Bin Gate']);
 assert.ok(cells.every(row=>row.length===16));for(let index=0;index<cells.length;index++)for(const prior of [oldCells,v2Cells])assert.deepEqual(cells[index].slice(5),prior[index].slice(5));
 assert.doesNotMatch(feed,/PRIVATE PROJECT|undefined|null/);assert.doesNotMatch(v2Feed,/PRIVATE PROJECT/);assert.match(oldFeed,/PRIVATE PROJECT A/);
 const parts=partsOf(await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=synthetic',undefined,[],[],orders)),sheet=parts['xl/worksheets/sheet7.xml'];
 assert.deepEqual(['A1','B1','C1','D1','E1'].map(ref=>sheetValue(sheet,ref)),GATE_PROGRESS_HEADERS.slice(0,5));assert.deepEqual(['B2','C2','D2','E2'].map(ref=>sheetValue(sheet,ref)),['0060','V74','Spruce','Bin Gate']);
 for(const [index,row]of rows.entries())if(['set','component'].includes(row.kind))for(const column of 'BCDE')assert.equal(sheetValue(sheet,column+(index+2)),'');
 assert.doesNotMatch(sheet,/PRIVATE PROJECT|undefined|null|>Project<|>n\/a</);assert.match(parts['xl/workbook.xml'],/Gate_Progress" localSheetId="6">'Gate Progress'!\$A\$2:\$P\$/);
 const standalone=partsOf(await buildGateProgressDraft(orders));assert.deepEqual(['A1','B1','C1','D1','E1'].map(ref=>sheetValue(standalone['xl/worksheets/sheet1.xml'],ref)),GATE_PROGRESS_HEADERS.slice(0,5));assert.doesNotMatch(standalone['xl/worksheets/sheet1.xml'],/PRIVATE PROJECT/);
 assert.deepEqual(orders,before,'export does not rewrite the saved orders');
});
test('Gate Progress shares the Site Orders branded header and reuses its original logo without duplicate assets',async()=>{
 const url='https://example.test/cnc-tracker/excel-data?token=synthetic',base=partsOf(await buildXlsxBytes([],CNC_COLUMNS,url,undefined,[],[]));
 const bytes=await buildXlsxBytes([],CNC_COLUMNS,url,undefined,[],[],gateProgressSample().orders),entries=entriesOf(bytes),parts=partsOf(bytes),sheet=parts['xl/worksheets/sheet7.xml'],styles=parts['xl/styles.xml'];
 const drawing='xl/drawings/gateProgressBrand.xml',drawingRels='xl/drawings/_rels/gateProgressBrand.xml.rels',sheetRels=parts['xl/worksheets/_rels/sheet7.xml.rels'];
 for(const name of ['xl/drawings/siteOrdersBrand.xml','xl/drawings/completedOrdersBrand.xml','xl/drawings/_rels/siteOrdersBrand.xml.rels','xl/drawings/_rels/completedOrdersBrand.xml.rels'])assert.equal(parts[name],base[name],name+' remains unchanged');
 assert.equal(entries.filter(entry=>entry.name==='xl/media/lennox-logo.png').length,1);assert.deepEqual(entries.find(entry=>entry.name==='xl/media/lennox-logo.png').data,Buffer.from(brandLogo.split(',')[1],'base64'));
 assert.equal(new Set(entries.map(entry=>entry.name)).size,entries.length,'ZIP part names are unique');
 assert.equal((parts['[Content_Types].xml'].match(/<Default Extension="png"/g)||[]).length,1);assert.match(parts['[Content_Types].xml'],/PartName="\/xl\/drawings\/gateProgressBrand.xml" ContentType="application\/vnd.openxmlformats-officedocument.drawing\+xml"/);
 assert.match(sheetRels,/Id="rId1"[^>]*Type="[^"]*\/queryTable"[^>]*Target="\.\.\/queryTables\/queryTable7.xml"/);assert.match(sheetRels,/Id="rIdBrand"[^>]*Type="[^"]*\/drawing"[^>]*Target="\.\.\/drawings\/gateProgressBrand.xml"/);
 assert.match(sheet,/<drawing r:id="rIdBrand"\/>/);assert.match(parts[drawingRels],/Id="rId1"[^>]*Type="[^"]*\/image"[^>]*Target="\.\.\/media\/lennox-logo.png"/);
 assert.match(parts[drawing],/<a:t>Gate Progress<\/a:t>/);assert.doesNotMatch(parts[drawing],/<a:t>Site Orders<\/a:t>/);
 assert.equal(parts[drawing].match(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/)[0],base['xl/drawings/siteOrdersBrand.xml'].match(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/)[0],'logo placement and dimensions match Site Orders');
 assert.match(sheet,/<row r="1" ht="142" customHeight="1">/);assert.match(sheet,/<row r="2" ht="18" customHeight="1">/);assert.match(sheet,/<sheetFormatPr[^>]*defaultRowHeight="18"[^>]*\/>/);assert.match(sheet,/<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"\/>/);assert.doesNotMatch(sheet,/<mergeCells|GATE PROGRESS|SNAPSHOT|Order \/ villa/);
 const xfs=[...section(styles,'cellXfs').matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map(match=>match[0]),fonts=[...section(styles,'fonts').matchAll(/<font>[\s\S]*?<\/font>/g)].map(match=>match[0]),fills=[...section(styles,'fills').matchAll(/<fill>[\s\S]*?<\/fill>/g)].map(match=>match[0]);
 for(const [ref,alignment]of [['A1',/horizontal="center" vertical="bottom" wrapText="0"/],['F1',/horizontal="center" vertical="bottom" textRotation="90" wrapText="0"/]]){
  const xf=xfs[Number(sheet.match(new RegExp('<c r="'+ref+'"[^>]* s="(\\d+)"'))[1])],font=fonts[Number(xf.match(/fontId="(\d+)"/)[1])],fill=fills[Number(xf.match(/fillId="(\d+)"/)[1])];
  assert.match(xf,alignment);assert.match(font,/<sz val="10"\/>/);assert.match(font,/<name val="Segoe UI"\/>/);assert.match(font,/FFFFFFFF/);assert.match(fill,/FF155E75/);
 }
 const areaStyle=xfs[Number(sheet.match(/<c r="P2"[^>]* s="(\d+)"/)[1])];assert.match(areaStyle,/numFmtId="2"/);assert.match(fonts[Number(areaStyle.match(/fontId="(\d+)"/)[1])],/<b\/>/);assert.match(fills[Number(areaStyle.match(/fillId="(\d+)"/)[1])],/FFDDEBF7/,'formatted area keeps the same order-row colour');
 const sampleBytes=await buildGateProgressDraft(gateProgressSample().orders,{sample:true}),sampleEntries=entriesOf(sampleBytes),sample=partsOf(sampleBytes);
 assert.deepEqual(sampleEntries.find(entry=>entry.name==='xl/media/lennox-logo.png').data,Buffer.from(brandLogo.split(',')[1],'base64'),'standalone sample includes the original binary PNG');
 assert.match(sample['xl/drawings/gateProgressBrand.xml'],/<a:t>Gate Progress — Sample<\/a:t>/);assert.match(sample['xl/worksheets/_rels/sheet1.xml.rels'],/Id="rIdBrand"[^>]*Target="\.\.\/drawings\/gateProgressBrand.xml"/);
});
test('live gate feed shares stages, retains unfinished orders and preserves legacy Drawn progress',()=>{
 const orders=gateProgressSample().orders,feed=buildGateProgressFeed(orders);
 assert.equal((feed.match(/<tr /g)||[]).length,gateProgressRows(orders).length);assert.equal((feed.match(/<td /g)||[]).length,gateProgressRows(orders).length*16);assert.match(feed,/bgcolor="#8ce28c"/);assert.match(feed,/bgcolor="#ffff99"/);assert.match(feed,/x:num="12.5"/);assert.doesNotMatch(feed,/V137|qaHistory|sample-order|shipment|driver|destination/);
 assert.match(feed,/<tr height="24" style="height:18pt;mso-height-source:userset">/);assert.match(feed,/font-family:Segoe UI;font-size:10pt/);assert.doesNotMatch(feed,/<th\b|<img\b|SNAPSHOT|<a:t>/);
 assert.equal(isGateProgressComplete(orders[2]),true);assert.equal(isGateProgressComplete({...orders[0],status:'dispatched'}),false);assert.equal(isGateProgressComplete({status:'completed',components:[]}),false);assert.equal(isGateProgressComplete({status:'dispatched',components:[]}),true);
 const stages=gateProgressStages([],{missing:true,legacyStages:{drawn:true,fabricatedQa:true,readyForDispatch:true}});for(const key of ['drawn','fabricatedQa','readyForDispatch'])assert.equal(stages.find(stage=>stage.key===key).symbol,'✓');
 assert.equal((buildGateProgressFeed([]).match(/<td /g)||[]).length,16);
 const unsafe=buildGateProgressFeed([{...orders[0],project:'PRIVATE PROJECT',colour:'=1+1 <script>& "quote"',phone:'PRIVATE',previousQa:[{photo:'PRIVATE'}]}]);assert.match(unsafe,/&lt;script&gt;&amp;/);assert.doesNotMatch(unsafe,/<script>|PRIVATE|<f>/);
});
test('Excel removes QA-complete dispatched orders before spacing each active order in all feed layouts',async()=>{
 const part=(number,qaStatus='approved',sent=false,delivered=false)=>({id:'part-'+number,set:1,kind:'Gate',label:'Gate '+number,qaStatus,drawn:true,ready:qaStatus==='approved'&&!sent,shipment:sent?{at:'2026-11-10T01:00:00Z'}:null,delivery:delivered?{at:'2026-11-11T01:00:00Z'}:null});
 const order=(number,project,villa,status,components)=>({id:'order-'+number,orderNumber:String(number),project,villa,orderType:'Buggy Gate',colour:'Spruce',status,components,areaM2:6,scheduledForProduction:true});
 const qaOnly=order(10,'Alpha','V2','completed',[part(1),part(2)]),partial=order(11,'Alpha','V2','completed',[part(1,'approved',true),part(2)]);
 const fullySent=order(12,'Alpha','V3','dispatched',[part(1,'approved',true),part(2,'approved',true)]),sentBeforeStatus=order(19,'Alpha','V3','completed',[part(1,'approved',true),part(2,'approved',true)]);
 const rework=order(13,'Alpha','V10','dispatched',[part(1,'approved',true),part(2,'recut',true)]),awaiting=order(14,'Alpha','V10','dispatched',[part(1,'approved',true),part(2,'awaiting',true)]);
 const legacyReady={...order(15,'Beta','V2','completed',[]),legacyStages:{drawn:true,fabricatedQa:true,readyForDispatch:true}},legacySent=order(16,'Beta','V99','dispatched',[]),delivered=order(17,'Alpha','V1','dispatched',[part(1,'approved',true,true),part(2,'approved',true,true)]);
 const orders=[legacySent,rework,delivered,qaOnly,fullySent,partial,awaiting,legacyReady,sentBeforeStatus],before=structuredClone(orders),activeNumbers=['10','11','13','14','15'];
 // The website retains its delivery-based completion rule; this exclusion is Excel-only.
 assert.equal(isGateProgressComplete(fullySent),false);assert.equal(isGateProgressComplete(delivered),true);assert.equal(isGateProgressComplete(legacySent),true);
 for(const [options,orderColumn]of [[{},1],[{columnVersion:2},0],[{legacyColumns:true},2]]){
  const rows=gateProgressRows(orders,options);
  assert.deepEqual(rows.filter(row=>row.kind==='order').map(row=>row.values[orderColumn]),activeNumbers);
  assert.equal(rows.filter(row=>row.kind==='villa').length,0);assert.equal(rows.filter(row=>row.kind==='spacer').length,4);
  assert.equal(rows[0].kind,'order');assert.equal(rows.at(-1).kind,'order');
  for(const [index,row]of rows.entries())if(row.kind==='spacer'){
   assert.ok(index>0&&index<rows.length-1);assert.notEqual(rows[index-1].kind,'spacer');assert.equal(rows[index+1].kind,'order');
   assert.deepEqual(row.values,Array(16).fill(''));assert.deepEqual(row.stages,[]);assert.equal(row.level,0);
  }
  const groups=[[]];for(const row of rows){if(row.kind==='spacer')groups.push([]);else if(row.kind==='order')groups.at(-1).push(row.values[orderColumn]);}
  assert.deepEqual(groups,[['10'],['11'],['13'],['14'],['15']],'each surviving order has one gap, even within the same project and villa');
  const feed=buildGateProgressFeed(orders,options),cells=feedCells(feed);assert.equal(cells.length,rows.length);assert.ok(cells.every(row=>row.length===16));
  for(const [index,row]of rows.entries())if(row.kind==='spacer'){
   assert.deepEqual(cells[index],Array(16).fill(''),'spacers contain no metadata or stage markers');
   const html=[...feed.matchAll(/<tr [^>]*>([\s\S]*?)<\/tr>/g)][index];assert.match(html[0],/^<tr height="12" style="height:9pt;/);assert.doesNotMatch(html[1],/#8ce28c|#ffff99|#ffc7ce/,'spacers have no progress colours');
  }
  assert.ok(cells.some(values=>values[orderColumn]==='10'&&values[7]==='✓'&&values[9]==='-'),'QA-only order remains until dispatch');
  assert.ok(cells.some(values=>values[orderColumn]==='11'&&values[7]==='✓'&&values[9]==='-'),'partial dispatch remains');
  assert.ok(rows.some(row=>row.kind==='order'&&row.values[orderColumn]==='13'&&row.stages.find(stage=>stage.key==='fabricatedQa').state==='rework'));
 }
 assert.deepEqual(gateProgressRows([fullySent,legacySent,delivered]),[]);assert.deepEqual(gateProgressRows([]),[]);
 assert.deepEqual(gateProgressRows([qaOnly]).map(row=>row.kind),['order','set','component','component'],'one active order needs no spacer');
 for(const options of [{},{columnVersion:2},{legacyColumns:true}])assert.deepEqual(feedCells(buildGateProgressFeed([fullySent,legacySent,delivered],options)),[Array(16).fill('')],'empty refresh feed clears prior query data');
 const rows=gateProgressRows(orders),parts=partsOf(await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=synthetic',undefined,[],[],orders)),sheet=parts['xl/worksheets/sheet7.xml'];
 assert.doesNotMatch(sheet,/>Villa V\d+<\/t>/,'there are no standalone villa heading rows');
 for(const [index,row]of rows.entries())if(row.kind==='spacer'){assert.match(sheet,new RegExp('<row r="'+(index+2)+'" ht="9" customHeight="1">'));for(const column of 'ABCDEFGHIJKLMNOP')assert.equal(sheetValue(sheet,column+(index+2)),'');}
 const standalone=partsOf(await buildGateProgressDraft(orders));for(const [index,row]of rows.entries())if(row.kind==='spacer'){assert.match(standalone['xl/worksheets/sheet1.xml'],new RegExp('<row r="'+(index+2)+'" ht="9" customHeight="1">'));for(const column of 'ABCDEFGHIJKLMNOP')assert.equal(sheetValue(standalone['xl/worksheets/sheet1.xml'],column+(index+2)),'');}
 assert.deepEqual(orders,before,'export filtering preserves source production and delivery records');
});
test('resetting a configured gate to Undrawn reaches order, set and component rows in the workbook and live feed',async()=>{
 const actor={username:'manager',tasks:{'site.orders.manage':true}},stamp='2026-11-11T01:00:00Z';
 const components=[1,2].map(index=>({id:'component-'+index,key:'gate-'+index,set:1,kind:'Gate',label:'Gate 0'+index}));
 const records=components.map(component=>({id:'qa-'+component.id,kind:'metalwork',gateOrderId:'configured-gate',gateComponentId:component.id,gateRevision:'approved-revision',status:'approved',latest:{checkedBy:'inspector',checkedAt:stamp},history:[{status:'approved',checkedBy:'inspector',checkedAt:stamp}]}));
 const order={id:'configured-gate',project:'Drawing status',villa:'V100',orderNumber:'100',orderType:'Buggy Gate',status:'completed',updatedAt:stamp,completedAt:stamp,gateComponents:{spec:{sets:[{gates:2,highlights:0,posts:0}]},components,shipments:[],deliveries:[]},manualProduction:{areaM2:6,qaWorkflowVersion:1,qaRevision:'approved-revision',qaItemIds:records.map(record=>record.id),statusBeforeReady:'approved',stages:{drawn:'complete',fabricatedQa:'complete',readyForDispatch:'complete'}}};
 const documents=new Map([['orders',[order]],['qa-checks',records]]),store={read:(key,fallback)=>structuredClone(documents.get(key)??fallback),write:(key,value)=>documents.set(key,structuredClone(value)),requireTask:(user,task)=>assert.equal(user.tasks?.[task],true),ctx:{storage:{transactionSync:fn=>fn()}},audit(){},notify(){}};
 const schedule=[{orderId:order.id,assignedUsername:'worker',scheduleType:'general',status:'planned'}];
 const before=gateComponentOrders(store.read('orders'),store.read('qa-checks'),schedule);
 for(const row of gateProgressRows(before).filter(row=>row.kind!=='spacer'))for(const key of ['drawn','fabricatedQa','readyForDispatch'])assert.equal(row.stages.find(stage=>stage.key===key).symbol,'✓');
 const reset=updateGateProduction(store,order.id,{expectedUpdatedAt:stamp,stages:{drawn:'pending'},areaM2:6},actor);
 assert.equal(reset.order.status,'approved');assert.deepEqual(store.read('qa-checks'),records);
 const after=gateComponentOrders(store.read('orders'),store.read('qa-checks'),schedule),rows=gateProgressRows(after),progress=rows.filter(row=>row.kind!=='spacer');
 assert.deepEqual(progress.map(row=>row.kind),['order','set','component','component']);
 for(const row of progress){
  for(const key of ['drawn','fabricatedQa','readyForDispatch'])assert.equal(row.stages.find(stage=>stage.key===key).symbol,'-');
  assert.equal(row.stages.find(stage=>stage.key==='scheduledForProduction').symbol,'✓');
 }
 const feedRows=[...buildGateProgressFeed(after).matchAll(/<tr [^>]*>([\s\S]*?)<\/tr>/g)].map(match=>[...match[1].matchAll(/<td [^>]*>([\s\S]*?)<\/td>/g)].map(cell=>cell[1]));
 assert.equal(feedRows.length,rows.length);
 for(const values of feedRows){assert.equal(values[5],'-');assert.equal(values[6],'✓');assert.equal(values[7],'-');assert.equal(values[8],'-');}
 const parts=partsOf(await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=synthetic',undefined,[],[],after)),sheet=parts['xl/worksheets/sheet7.xml'];
 for(const row of [2,3,4,5]){
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
