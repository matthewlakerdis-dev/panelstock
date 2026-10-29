import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes,splitDateTimeForExport} from '../src/reports.js';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';
import {CNC_COLUMNS,buildCncExcelFeed,buildCncExcelRows,buildCncReportRows,buildCncReportFeed} from '../src/cnc-excel.js';
import {SITE_ORDER_COLUMNS,buildSiteOrderFeed} from '../src/site-orders-excel.js';

test('CNC export timestamps use the Brisbane business timezone',()=>{
  assert.deepEqual(splitDateTimeForExport('2026-08-31T22:43:26.860Z'),{
    date:'01/09/26',time:'8:43 AM',
  });
  assert.deepEqual(splitDateTimeForExport(null),{date:'',time:''});
  assert.deepEqual(splitDateTimeForExport('invalid'),{date:'',time:''});
});

export function unzip(bytes) {
  const buffer=Buffer.from(bytes), files={};
  let offset=0;
  while(buffer.readUInt32LE(offset)===0x04034b50) {
    const size=buffer.readUInt32LE(offset+18), nameLength=buffer.readUInt16LE(offset+26), extra=buffer.readUInt16LE(offset+28);
    const name=buffer.subarray(offset+30,offset+30+nameLength).toString();
    const start=offset+30+nameLength+extra;
    files[name]=inflateRawSync(buffer.subarray(start,start+size)).toString();
    offset=start+size;
  }
  return files;
}

test('empty Excel exports have valid dimensions and no invented data row',async()=>{
  for(const rows of [[],[{}]]) {
    const sheet=unzip(await buildXlsxBytes(rows))['xl/worksheets/sheet1.xml'];
    assert.match(sheet, /dimension ref="A1:A[12]"/);
    assert.doesNotMatch(sheet, /<cols><\/cols>/);
  }
  const sheet=unzip(await buildXlsxBytes([],['order_number','panel_id']))['xl/worksheets/sheet1.xml'];
  assert.match(sheet,/dimension ref="A1:B1"/);
  assert.match(sheet,/<t>order_number<\/t>/);
  assert.match(sheet,/<t>panel_id<\/t>/);
  assert.doesNotMatch(sheet,/<row r="2">/);
});

test('populated Excel exports retain headings and escaped values',async()=>{
  const sheet=unzip(await buildXlsxBytes([{order_number:'JOB & <A>',panel_id:12}]))['xl/worksheets/sheet1.xml'];
  assert.match(sheet,/dimension ref="A1:B2"/);
  assert.match(sheet,/JOB &amp; &lt;A&gt;/);
  assert.match(sheet,/<c r="B2" t="n"><v>12<\/v><\/c>/);
});

test('public CNC download keeps all twenty columns when the schedule is empty',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'xlsx-test',modules:true,
    script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),
    compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],
    durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},
    bindings:{CNC_PUBLIC_TOKEN:'test-export-only'}}]}));
  try {
    const denied=await mf.dispatchFetch('http://localhost/cnc-tracker?token=incorrect');
    assert.equal(denied.status,404);
    const response=await mf.dispatchFetch('http://localhost/cnc-tracker?token=test-export-only');
    assert.equal(response.status,200);
    assert.match(response.headers.get('Content-Type'),/spreadsheetml.sheet/);
    const bytes=new Uint8Array(await response.arrayBuffer());
    const sheet=unzip(bytes)['xl/worksheets/sheet1.xml'];
    assert.match(sheet,/dimension ref="A1:T1"/);
    assert.equal((sheet.match(/<c r=/g)||[]).length,20);
    assert.match(sheet,/<c r="B1"[^>]*><is><t>Order No\.<\/t><\/is><\/c>/);
    assert.match(sheet,/<c r="C1"[^>]*><is><t>Sheet<\/t><\/is><\/c>/);
    assert.match(sheet,/<c r="Q1"[^>]*><is><t>Off-cut<\/t><\/is><\/c>/);
    assert.match(sheet,/<c r="R1"[^>]*><is><t>Details<\/t><\/is><\/c>/);
    assert.match(sheet,/<c r="S1"[^>]*><is><t>Template \/ Remake<\/t><\/is><\/c>/);
    assert.match(sheet,/<c r="T1"[^>]*><is><t>Notes<\/t><\/is><\/c>/);
    assert.match(sheet,/<t>Time completed<\/t>/);
    assert.doesNotMatch(sheet,/<tableParts/);
    assert.doesNotMatch(sheet,/<row r="2">/);
    const parts=unzip(bytes);
    assert.match(parts['xl/connections.xml'],/interval="15"/);
    assert.match(parts['xl/connections.xml'],/refreshOnLoad="1"/);
    assert.match(parts['xl/connections.xml'],/localhost\/cnc-tracker\/excel-data\?token=test-export-only&amp;v=\d+/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/connectionId="1"/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/adjustColumnWidth="0"/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/headers="0" backgroundRefresh="1"/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/growShrinkType="insertDelete"/);
    assert.match(sheet,/<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/><selection pane="bottomLeft" activeCell="A2" sqref="A2"\/>/);
    assert.match(parts['xl/styles.xml'],/<sz val="10"\/>/);
    assert.match(parts['xl/styles.xml'],/<name val="Segoe UI"\/>/);
    assert.equal((sheet.match(/<col width="[^"]+" customWidth="1"(?: bestFit="1")? min="\d+" max="\d+"(?: style="8")?\/>/g)||[]).length,20);
    assert.equal(parts['xl/tables/table1.xml'],undefined);
    assert.match(parts['xl/workbook.xml'],/<definedName name="CNC_Tracker" localSheetId="1">'CNC Tracker'!\$A\$2:\$T\$2<\/definedName>/);
    assert.match(parts['xl/worksheets/_rels/sheet1.xml.rels'],/relationships\/queryTable/);
    assert.match(sheet,/<ignoredError sqref="B2:C5000 G2:G5000 L2:T5000" numberStoredAsText="1"\/>/);
    assert.ok(sheet.indexOf('<ignoredErrors>')<sheet.indexOf('</worksheet>'));
    assert.equal((parts['xl/styles.xml'].match(/<alignment horizontal="center" vertical="center"/g)||[]).length,13);
    assert.equal((await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=incorrect')).status,404);
    const feed=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=test-export-only');
    assert.equal(feed.status,200);
    assert.match(feed.headers.get('Cache-Control'),/no-cache/);
    assert.equal(feed.headers.get('Pragma'),'no-cache');
    assert.equal(feed.headers.get('Expires'),'0');
    const feedText=await feed.text();
    assert.doesNotMatch(feedText,/<th(?:\s|>)/);
    assert.match(feedText,/<table id="cnc-data"><tbody><\/tbody><\/table>/);
    for(const period of ['daily','weekly','monthly']) {
      for(const token of ['','incorrect'])assert.equal((await mf.dispatchFetch(`http://localhost/cnc-tracker/excel-data?token=${token}&report=${period}`)).status,404);
      const report=await mf.dispatchFetch(`http://localhost/cnc-tracker/excel-data?token=test-export-only&report=${period}`);
      assert.equal(report.status,200);
      assert.match(report.headers.get('Cache-Control'),/no-store, no-cache/);
      assert.equal(report.headers.get('Referrer-Policy'),'no-referrer');
      assert.equal(await report.text(),buildCncReportFeed([],period));
    }
    for(const period of ['','yearly','__proto__','constructor','DAILY'])assert.equal((await mf.dispatchFetch(`http://localhost/cnc-tracker/excel-data?token=test-export-only&report=${period}`)).status,404);
    assert.equal((await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?report=site-orders&token=incorrect')).status,404);
    const siteFeed=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?report=site-orders&token=test-export-only');
    assert.equal(siteFeed.status,200);assert.match(siteFeed.headers.get('Cache-Control'),/no-store/);assert.equal(await siteFeed.text(),buildSiteOrderFeed([]));
    if(process.env.XLSX_TEST_OUTPUT)fs.writeFileSync(process.env.XLSX_TEST_OUTPUT,bytes);
  } finally {await mf.dispose();}
});

test('Site Orders is the first connected tab with the same styling and all requested columns',async()=>{
 const rows=Array.from({length:65},(_,index)=>Object.fromEntries(SITE_ORDER_COLUMNS.map(key=>[key,['Date ordered','Requested date','Scheduled date'].includes(key)?46294:key==='Order number'?String(index).padStart(3,'0'):key==='Project'?'=1+1 <script>':key==='Drawn'?'✓':''])));
 const parts=unzip(await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/feed?token=synthetic',undefined,rows));
 assert.match(parts['xl/workbook.xml'],/name="Site Orders"[^>]+\/><sheet name="CNC Tracker"[^>]+\/><sheet name="Daily Report"/);
 assert.match(parts['xl/workbook.xml'],/<definedName name="Site_Orders" localSheetId="0">'Site Orders'!\$A\$2:\$Q\$66/);
 for(const [name,index] of [['Daily_Report',2],['Weekly_Report',3],['Monthly_Report',4]])assert.ok(parts['xl/workbook.xml'].includes(`name="${name}" localSheetId="${index}"`));
 const sheet=parts['xl/worksheets/sheet5.xml'];
 assert.match(sheet,/dimension ref="A1:Q66"/);assert.match(sheet,/pane ySplit="1"/);assert.match(sheet,/defaultRowHeight="18"/);
 assert.match(sheet,/<c r="A2" s="6" t="n"><v>46294<\/v>/);assert.match(sheet,/<c r="D2" s="0" t="inlineStr"><is><t xml:space="preserve">000</);
 assert.match(sheet,/<c r="H2" s="6" t="n"><v>46294<\/v>/);
 assert.match(sheet,/<c r="G1"[^>]*><is><t xml:space="preserve">Requested date<\/t><\/is><\/c><c r="H1"[^>]*><is><t xml:space="preserve">Scheduled date<\/t>/);
 assert.doesNotMatch(sheet,/<f>|<script>/);assert.match(sheet,/&lt;script&gt;/);assert.match(sheet,/sqref="J2:P5000"/);assert.doesNotMatch(sheet,/sqref="I2:I5000"/);assert.match(sheet,/<c r="I1" s="9" t="inlineStr"><is><t xml:space="preserve">Status<\/t>/);assert.match(sheet,/sqref="A2:Q5000"/);
 for(const key of SITE_ORDER_COLUMNS)assert.ok(sheet.includes(`>${key==='QA'?'Fabricated/QA':key}</t>`));
 assert.match(parts['xl/connections.xml'],/report=site-orders/);assert.equal((parts['xl/connections.xml'].match(/refreshOnLoad="1" interval="15"/g)||[]).length,5);
 assert.match(parts['xl/queryTables/queryTable5.xml'],/connectionId="5" preserveFormatting="1" adjustColumnWidth="0"/);
 assert.match(parts['xl/worksheets/_rels/sheet5.xml.rels'],/queryTable5.xml/);assert.match(parts['[Content_Types].xml'],/sheet5.xml/);
});

test('connected CNC export preserves identifiers and treats input as text',async()=>{
 const rows=[{'Order No.':'00123','Sheet':'01','Panel IDs':'=1+1','Project':'<script>alert(1)</script> & project'}];
 const files=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=a&b'));
 assert.match(files['xl/worksheets/sheet1.xml'],/<t>00123<\/t>/);
 assert.match(files['xl/worksheets/sheet1.xml'],/<t>=1\+1<\/t>/);
 assert.doesNotMatch(files['xl/worksheets/sheet1.xml'],/<f>/);
 assert.match(files['xl/connections.xml'],/token=a&amp;b/);
 const feed=buildCncExcelFeed(rows);
 assert.ok(feed.includes('&lt;script&gt;'));assert.ok(!feed.includes('<script>'));
 assert.match(feed,/<td x:str/);
});

test('CNC live refresh keeps measurements numeric and waste formatted as a percentage',()=>{
 const feed=buildCncExcelFeed([{'Order No.':'00123','Length (mm)':2400,'Width (mm)':1500,'Sheet area (m²)':3.6,'Panel area (m²)':2.96,'Waste':0.1777777777777778}]);
 assert.match(feed,/<td x:str[^>]*>00123<\/td>/);
 assert.match(feed,/<td x:num="2400"[^>]*>2400<\/td>/);
 assert.match(feed,/<td x:num="3.6"[^>]*mso-number-format:"0.00"[^>]*>3.6<\/td>/);
 assert.match(feed,/<td x:num="0.1778"[^>]*mso-number-format:"0%"[^>]*>18%<\/td>/);
 assert.doesNotMatch(feed,/<th(?:\s|>)/);
 assert.equal((feed.match(/text-align:center/g)||[]).length,18);
 assert.equal((feed.match(/text-align:left/g)||[]).length,2);
});

test('CNC conditional formatting covers current and future rows without colouring headers or other exports',async()=>{
 for(const rows of [[],[{'Status':'Pending'},{'Status':'Completed'}]]) {
  const parts=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'));
  assert.match(parts['xl/worksheets/sheet1.xml'],/conditionalFormatting sqref="I2:I5000"/);
  assert.match(parts['xl/worksheets/sheet1.xml'],/conditionalFormatting sqref="J2:J5000"/);
  assert.match(parts['xl/worksheets/sheet1.xml'],/conditionalFormatting sqref="Q2:Q5000"/);
  assert.match(parts['xl/worksheets/sheet1.xml'],/conditionalFormatting sqref="S2:S5000"/);
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('TRIM($Q2)="✓"'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('TRIM($Q2)="✕"'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('TRIM($Q2)="-"'));
  const worksheet=parts['xl/worksheets/sheet1.xml'];
  assert.ok(worksheet.indexOf('<conditionalFormatting')<worksheet.indexOf('<pageMargins'));
  assert.ok(worksheet.indexOf('<pageMargins')<worksheet.indexOf('<ignoredErrors'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('LOWER(TRIM($J2))="completed"'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('LOWER(TRIM($J2))="pending"'));
  assert.match(parts['xl/styles.xml'],/<dxfs count="7">/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FF8CE28C"/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FFFFFF99"/);
  assert.doesNotMatch(parts['xl/styles.xml'],/<bgColor rgb="FFFFC000"/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FFF2F5F7"/);
  assert.match(parts['xl/styles.xml'],/<fgColor rgb="FFF2F5F7"\/><bgColor rgb="FFF2F5F7"\/><\/patternFill><\/fill><\/dxf>/);
  assert.match(worksheet,/conditionalFormatting sqref="A2:T5000"/);
  assert.ok(worksheet.includes('AND($A2&lt;&gt;"",MOD(ROW(),2)=0)'));
  assert.equal(parts['xl/tables/table1.xml'],undefined);
  assert.match(parts['xl/queryTables/queryTable1.xml'],/preserveFormatting="1"/);
  assert.doesNotMatch(parts['xl/queryTables/queryTable1.xml'],/queryTableFields/);
  assert.match(parts['xl/queryTables/queryTable1.xml'],/applyNumberFormats="0"/);
 }
 const plain=unzip(await buildXlsxBytes([{status:'Pending'}]));
 assert.doesNotMatch(plain['xl/worksheets/sheet1.xml'],/conditionalFormatting/);
});

test('shared Excel stripes alternate solid grey and solid white on all four tabs below status colours',async()=>{
 for(const rows of [[],[{Project:'Example',Status:'Completed','Date completed':'06/09/2026','Panel IDs':'A1','Panel area (m²)':4.2}]]) {
  const parts=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'));
  const dxfs=[...parts['xl/styles.xml'].match(/<dxfs[^>]*>(.*?)<\/dxfs>/)[1].matchAll(/<dxf>(.*?)<\/dxf>/g)].map(match=>match[1]);
  assert.equal(dxfs.length,7);
  for(const [id,colour] of [[5,'FFF2F5F7'],[6,'FFFFFFFF']])assert.ok(dxfs[id].includes(`<patternFill patternType="solid"><fgColor rgb="${colour}"/><bgColor rgb="${colour}"/></patternFill>`));
  for(let id=1;id<=4;id++) {
   const sheet=parts[`xl/worksheets/sheet${id}.xml`],lastColumn=id===1?'T':'D';
   const stripe=sheet.match(new RegExp(`<conditionalFormatting sqref="A2:${lastColumn}5000">(.*?)</conditionalFormatting>`))[1];
   const rules=[...stripe.matchAll(/<cfRule type="expression" dxfId="(\d+)" priority="(\d+)"><formula>(.*?)<\/formula><\/cfRule>/g)];
   assert.equal(rules.length,2);
   assert.deepEqual(rules.map(rule=>Number(rule[1])),[5,6]);
   assert.deepEqual(rules.map(rule=>rule[3]),['AND($A2&lt;&gt;"",MOD(ROW(),2)=0)','AND($A2&lt;&gt;"",MOD(ROW(),2)=1)']);
   assert.deepEqual(rules.map(rule=>Number(rule[2])),id===1?[11,12]:[1,2]);
   assert.doesNotMatch(stripe,/stopIfTrue="1"/);
   if(id===1) {
    const statusRules=[...sheet.matchAll(/<cfRule type="expression" dxfId="([0-4])" priority="(\d+)"/g)];
    assert.equal(statusRules.length,10);
    assert.ok(statusRules.every(rule=>Number(rule[2])<11));
   }
   assert.match(parts[`xl/queryTables/queryTable${id}.xml`],new RegExp(`preserveFormatting="1" adjustColumnWidth="0"`));
  }
 }
});

test('CNC waste colour thresholds come from CNC settings without an orange band',async()=>{
 const parts=unzip(await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/feed',{wasteGreenMax:4,wasteYellowMax:9}));
 const sheet=parts['xl/worksheets/sheet1.xml'];
 assert.ok(sheet.includes('$I2&lt;=0.04'));
 assert.ok(sheet.includes('$I2&gt;0.04,$I2&lt;=0.09'));
 assert.ok(sheet.includes('$I2&gt;0.09'));
 assert.doesNotMatch(sheet,/dxfId="7"/);
});

test('shared tracker fixes Panel IDs and Notes in pixels and fits every other column',async()=>{
 const longRow=Object.fromEntries(['Project','Order No.','Uploaded by','Completed by','Details','Notes'].map(key=>[key,key+' example '.repeat(80)]));
 longRow['Panel IDs']=Array.from({length:200},(_,index)=>String(index+1)).join(', ');
 for(const rows of [[],[{Project:'Example','Off-cut':'✓','Template / Remake':'✕',Notes:'A longer note stays readable'}],[longRow]]) {
  const connected=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'));
  const plain=unzip(await buildXlsxBytes(rows,CNC_COLUMNS));
  const columns=sheet=>[...sheet.matchAll(/<col width="([^"]+)" customWidth="1"(?: bestFit="1")? min="(\d+)" max="\2"(?: style="8")?\/>/g)].map(match=>({index:Number(match[2]),width:Number(match[1]),bestFit:match[0].includes('bestFit="1"')}));
  const actual=columns(connected['xl/worksheets/sheet1.xml']),original=columns(plain['xl/worksheets/sheet1.xml']);
  assert.equal(actual.length,20);
  const pixels=width=>Math.trunc((256*width+Math.trunc(128/7))/256*7);
  assert.equal(pixels(actual.find(column=>column.index===7).width),285);
  assert.equal(pixels(actual.find(column=>column.index===20).width),355);
  for(const column of actual)assert.equal(column.bestFit,![7,20].includes(column.index));
  if(rows[0]===longRow){
   for(const index of [1,2,11,14,18])assert.equal(actual.find(column=>column.index===index).width,255);
   for(const value of Object.values(longRow)){
    assert.ok(connected['xl/worksheets/sheet1.xml'].includes(value));
    assert.ok(buildCncExcelFeed(rows).includes(value));
   }
  }
  assert.equal(actual.find(column=>column.index===17).width,9);
  assert.equal(actual.find(column=>column.index===19).width,19);
  if(rows[0]===longRow)assert.notEqual(actual.find(column=>column.index===18).width,actual.find(column=>column.index===20).width);
  assert.ok(original.every(column=>!column.bestFit));
  assert.doesNotMatch(plain['xl/styles.xml'],/<dxfs/);
  assert.doesNotMatch(plain['xl/worksheets/sheet1.xml'],/<conditionalFormatting/);
  assert.match(connected['xl/queryTables/queryTable1.xml'],/adjustColumnWidth="0"/);
  assert.match(connected['xl/queryTables/queryTable1.xml'],/applyWidthHeightFormats="0"/);
 }
});

test('CNC Excel marks pending off-cuts with a dash and historical completed sheets as not saved',()=>{
 const rows=buildCncExcelRows([
  {jobReference:'Project A',orderNumber:'1',sheetNumber:'1',panelNumber:'A1',status:'pending'},
  {jobReference:'Project A',orderNumber:'1',sheetNumber:'2',panelNumber:'A2',status:'completed',completedAt:'2026-09-01T02:00:00Z'}
 ],splitDateTimeForExport);
 assert.equal(rows[0]['Off-cut'],'-');assert.equal(rows[0]['Details'],'');
 assert.equal(rows[1]['Off-cut'],'✕');assert.equal(rows[1]['Details'],'');
 assert.equal(rows[0]['Template / Remake'],'✕');assert.equal(rows[0]['Notes'],'');
});

test('CNC Excel groups panels by sheet and calculates sheet area and waste',async()=>{
 const rows=buildCncExcelRows([
  {jobReference:'Project A',orderNumber:'007',sheetNumber:'2',panelNumber:'A1',sheetWidth:1500,sheetHeight:6000,totalPanelArea:2,status:'completed',isTemplate:true,offcutOutcome:'confirmed',offcutDetails:{length:1200,width:450,color:'Charcoal',material:'Alupolic',thickness:4},uploadedBy:'msmith',uploadedAt:'2026-09-01T00:00:00Z',completedBy:'bjones',completedAt:'2026-09-01T02:00:00Z'},
  {jobReference:'Project A',orderNumber:'007',sheetNumber:'2',panelNumber:'A2',sheetWidth:6000,sheetHeight:1500,totalPanelArea:3,status:'completed',isRemake:true,remakeReason:'Damaged finish',uploadedBy:'msmith',uploadedAt:'2026-09-01T00:01:00Z',completedBy:'bjones',completedAt:'2026-09-01T02:05:00Z'}
 ],splitDateTimeForExport);
 assert.equal(rows.length,1);assert.equal(rows[0]['Project'],'Project A');assert.equal(rows[0]['Length (mm)'],6000);assert.equal(rows[0]['Width (mm)'],1500);assert.equal(rows[0]['Panel IDs'],'A1, A2');assert.equal(rows[0]['Panel area (m²)'],5);assert.equal(rows[0]['Status'],'Completed');assert.equal(rows[0]['Off-cut'],'✓');assert.equal(rows[0]['Details'],'1200 × 450 mm · Charcoal · Alupolic · 4mm');
 assert.equal(rows[0]['Template / Remake'],'✓');assert.equal(rows[0]['Notes'],'Template: A1; Remake: Damaged finish');
 const sheet=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'))['xl/worksheets/sheet1.xml'];
 assert.match(sheet,/<c r="F2" s="4"><f>D2\*E2\/1000000<\/f><v>9<\/v><\/c>/);
 assert.match(sheet,/<c r="I2" s="5"><f>IF\(F2&gt;0,MAX\(0,\(F2-H2\)\/F2\),&quot;&quot;\)<\/f>/);
 assert.match(sheet,/<col width="8" customWidth="1" bestFit="1" min="9" max="9"\/>/);
 assert.match(sheet,/<c r="B2" t="inlineStr">/);
 assert.doesNotMatch(sheet,/<c r="B2"[^>]*s="2"/);
});

test('CNC Excel writes a shared remake reason once while retaining every panel ID',async()=>{
 const panels=['Z4W8-8 EP-L','Z4W9-18 EP-L','Z4W9-17','Z4W9-16','Z4W9-15','Z4W9-12'].map(panelNumber=>({jobReference:'Project A',orderNumber:'7',sheetNumber:'1',panelNumber,isRemake:true,remakeReason:'DRAWING ERROR',totalPanelArea:0.5}));
 const snapshot=JSON.stringify(panels),rows=buildCncExcelRows(panels,splitDateTimeForExport);
 assert.equal(rows.length,1);
 assert.equal(rows[0].Notes,'Remake: DRAWING ERROR');
 assert.equal(rows[0]['Panel IDs'],panels.map(panel=>panel.panelNumber).join(', '));
 assert.equal(rows[0]['Panel area (m²)'],3);
 assert.equal(rows[0]['Template / Remake'],'✓');
 assert.equal(JSON.stringify(panels),snapshot);
 const feed=buildCncExcelFeed(rows),sheet=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'))['xl/worksheets/sheet1.xml'];
 assert.equal(feed.split('Remake: DRAWING ERROR').length-1,1);
 assert.match(sheet,/<c r="T2"[^>]*><is><t[^>]*>Remake: DRAWING ERROR<\/t><\/is><\/c>/);
});

test('CNC Excel keeps distinct remake reasons, blank legacy flags and template notes',()=>{
 const common={jobReference:'Project A',orderNumber:'7',sheetNumber:'1'};
 const rows=buildCncExcelRows([
  {...common,panelNumber:'A1',isRemake:true,remakeReason:' Drawing   error '},
  {...common,panelNumber:'A2',isRemake:true,remakeReason:'drawing error'},
  {...common,panelNumber:'T1',isTemplate:true},
  {...common,panelNumber:'A3',isRemake:true,remakeReason:'Damaged finish'},
  {...common,panelNumber:'A4',isRemake:true,remakeReason:'DAMAGED\tFINISH'},
  {...common,panelNumber:'A5',isRemake:true},
  {...common,panelNumber:'A6',isRemake:true,remakeReason:'   '},
  {...common,panelNumber:'A7',remakeReason:'Stale reason'}
 ],splitDateTimeForExport);
 assert.equal(rows[0].Notes,'Remake: Drawing error; Template: T1; Remake: Damaged finish; Remake');
 assert.equal(rows[0]['Panel IDs'],'A1, A2, T1, A3, A4, A5, A6, A7');
});

test('CNC Excel repeats remake reasons independently on separate tracker rows',()=>{
 const common={jobReference:'Project A',orderNumber:'7',sheetNumber:'1',panelNumber:'A1',isRemake:true,remakeReason:'DRAWING ERROR'};
 const rows=buildCncExcelRows([common,{...common,panelNumber:'A2'},{...common,sheetNumber:'2'},{...common,orderNumber:'8'},{...common,jobReference:'Project B'},{...common,stockItemId:'other-stock'}],splitDateTimeForExport);
 assert.equal(rows.length,5);
 assert.ok(rows.every(row=>row.Notes==='Remake: DRAWING ERROR'));
});

test('CNC Excel includes daily, weekly and monthly production reports',async()=>{
 const rows=[
  {'Status':'Completed','Date completed':'01/09/2026','Panel IDs':'A1, A2','Panel area (m²)':5},
  {'Status':'Completed','Date completed':'01/09/2026','Panel IDs':'B1','Panel area (m²)':2.5},
  {'Status':'Completed','Date completed':'03/09/2026','Panel IDs':'C1, C2, C3','Panel area (m²)':7.25},
  {'Status':'Completed','Date completed':'08/10/2026','Panel IDs':'E1, E2','Panel area (m²)':4},
  {'Status':'Completed','Date completed':'31/02/2026','Panel IDs':'INVALID','Panel area (m²)':99},
  {'Status':'Pending','Date completed':'03/09/2026','Panel IDs':'D1','Panel area (m²)':9}
 ];
 const reports=buildCncReportRows(rows);
 assert.deepEqual(reports.daily.filter(row=>row.sheets),[{date:'01/09/2026',sheets:2,panels:3,area:7.5},{date:'03/09/2026',sheets:1,panels:3,area:7.25},{date:'08/10/2026',sheets:1,panels:2,area:4}]);
 assert.deepEqual(reports.weekly.filter(row=>row.sheets),[{date:'31/08/2026',sheets:3,panels:6,area:14.75},{date:'05/10/2026',sheets:1,panels:2,area:4}]);
 assert.deepEqual(reports.monthly.filter(row=>row.sheets),[{date:'01/09/2026',sheets:3,panels:6,area:14.75},{date:'01/10/2026',sheets:1,panels:2,area:4}]);
 const parts=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'));
 assert.match(parts['xl/workbook.xml'],/<sheet name="CNC Tracker" sheetId="1" r:id="rId1"\/>/);
 assert.match(parts['xl/workbook.xml'],/<definedName name="CNC_Tracker" localSheetId="1">'CNC Tracker'!\$A\$2:\$T\$7<\/definedName>/);
 assert.doesNotMatch(parts['xl/workbook.xml'],/name="Sheet1"/);
 assert.match(parts['xl/workbook.xml'],/<sheet name="Daily Report" sheetId="2" r:id="rId5"\/>/);
 assert.match(parts['xl/workbook.xml'],/<sheet name="Weekly Report" sheetId="3" r:id="rId6"\/>/);
 assert.match(parts['xl/workbook.xml'],/<sheet name="Monthly Report" sheetId="4" r:id="rId7"\/>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<t>Sheets completed<\/t>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<t>Panels completed<\/t>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<t>Total panel area \(m²\)<\/t>/);
 assert.match(parts['xl/worksheets/sheet3.xml'],/<t>Week commencing<\/t>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<conditionalFormatting sqref="A2:D5000">.*<formula>AND\(\$A2&lt;&gt;"",MOD\(ROW\(\),2\)=0\)<\/formula>.*<\/conditionalFormatting>/);
 assert.match(parts['xl/worksheets/sheet3.xml'],/<conditionalFormatting sqref="A2:D5000">.*dxfId="5".*<\/conditionalFormatting>/);
 assert.match(parts['xl/worksheets/sheet4.xml'],/<t>Month<\/t>/);
 assert.match(parts['xl/worksheets/sheet4.xml'],/<conditionalFormatting sqref="A2:D5000">.*dxfId="5".*<\/conditionalFormatting>/);
 assert.match(parts['xl/worksheets/sheet4.xml'],/<c r="A2" t="n" s="7">/);
 assert.match(parts['xl/styles.xml'],/<numFmt numFmtId="164" formatCode="dd\/mm\/yyyy"\/>/);
 assert.match(parts['xl/styles.xml'],/<numFmt numFmtId="165" formatCode="mmmm yyyy"\/>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<c r="D2" t="n" s="4"><v>7.5<\/v><\/c>/);
});


test('Production Tracker downloads require modify access while retaining all five refreshable queries',async t=>{
  const syntheticPassword='001122334455667';
  t.mock.method(globalThis.crypto,'randomUUID',()=> '00112233-4455-6677-8899-aabbccddeeff');
  for(const rows of [[],[{'Project':'Synthetic project','Status':'Completed','Date completed':'01/10/2026','Panel IDs':'P1','Panel area (m²)':2.5}]]){
    const parts=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=synthetic'));
    // Known legacy verifier, independently checked against openpyxl's hash_password.
    assert.match(parts['xl/workbook.xml'],/<fileSharing readOnlyRecommended="1" userName="PanelStockHQ" reservationPassword="EC19"\/><workbookPr\/>/);
    assert.ok(parts['xl/workbook.xml'].indexOf('<fileSharing ')<parts['xl/workbook.xml'].indexOf('<bookViews>'));
    const connections=[...parts['xl/connections.xml'].matchAll(/<connection\b[^>]*>/g)].map(match=>match[0]);
    assert.equal(connections.length,5);
    for(const connection of connections)assert.match(connection,/refreshOnLoad="1" interval="15"/);
    for(let id=1;id<=5;id++){
      const query=parts[`xl/queryTables/queryTable${id}.xml`];
      assert.match(query,/backgroundRefresh="1" refreshOnLoad="1"/);
      assert.match(query,/growShrinkType="insertDelete"/);
      assert.doesNotMatch(query,/disableRefresh="(?:1|true)"/);
      assert.doesNotMatch(parts[`xl/worksheets/sheet${id}.xml`],/<sheetProtection\b/);
    }
    for(const part of Object.values(parts))assert.ok(!part.includes(syntheticPassword),'the modify password is not distributed');
  }
  const ordinary=unzip(await buildXlsxBytes([{'Order No.':'123'}]));
  assert.doesNotMatch(ordinary['xl/workbook.xml'],/<fileSharing\b/);
});

