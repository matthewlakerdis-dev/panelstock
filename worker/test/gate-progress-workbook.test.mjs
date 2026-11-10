import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {CNC_COLUMNS} from '../src/cnc-excel.js';
import {gateProgressSample} from '../src/gate-progress-sample.js';
import {gateProgressRows} from '../src/gate-progress-excel.js';
import {buildGateProgressFeed} from '../src/gate-progress-workbook.js';
import {gateProgressStages,isGateProgressComplete} from '../src/gate-progress-stages.js';
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
