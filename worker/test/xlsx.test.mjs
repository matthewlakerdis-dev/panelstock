import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes,splitDateTimeForExport} from '../src/reports.js';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';
import {CNC_COLUMNS,buildCncExcelFeed,buildCncExcelRows,buildCncReportRows} from '../src/cnc-excel.js';

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

test('public CNC download keeps all eighteen columns when the schedule is empty',async()=>{
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
    assert.match(sheet,/dimension ref="A1:R1"/);
    assert.equal((sheet.match(/<c r=/g)||[]).length,18);
    assert.match(sheet,/<c r="Q1"[^>]*><is><t>Off-cut<\/t><\/is><\/c>/);
    assert.match(sheet,/<c r="R1"[^>]*><is><t>Details<\/t><\/is><\/c>/);
    assert.match(sheet,/<t>Time completed<\/t>/);
    assert.doesNotMatch(sheet,/<tableParts/);
    assert.doesNotMatch(sheet,/<row r="2">/);
    const parts=unzip(bytes);
    assert.match(parts['xl/connections.xml'],/interval="1"/);
    assert.match(parts['xl/connections.xml'],/refreshOnLoad="1"/);
    assert.match(parts['xl/connections.xml'],/localhost\/cnc-tracker\/excel-data\?token=test-export-only&amp;v=\d+/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/connectionId="1"/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/adjustColumnWidth="0"/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/headers="0" backgroundRefresh="0"/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/growShrinkType="insertDelete"/);
    assert.match(sheet,/<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/><selection pane="bottomLeft" activeCell="A2" sqref="A2"\/>/);
    assert.match(parts['xl/styles.xml'],/<sz val="10"\/>/);
    assert.match(parts['xl/styles.xml'],/<name val="Segoe UI"\/>/);
    assert.equal((sheet.match(/<col width="[^"]+" customWidth="1" min="\d+" max="\d+"\/>/g)||[]).length,18);
    assert.equal(parts['xl/tables/table1.xml'],undefined);
    assert.match(parts['xl/workbook.xml'],/<definedName name="CNC_Tracker" localSheetId="0">'CNC Tracker'!\$A\$2:\$R\$2<\/definedName>/);
    assert.match(parts['xl/worksheets/_rels/sheet1.xml.rels'],/relationships\/queryTable/);
    assert.match(sheet,/<ignoredError sqref="B2:C1048576 G2:G1048576 L2:R1048576" numberStoredAsText="1"\/>/);
    assert.ok(sheet.indexOf('<ignoredErrors>')<sheet.indexOf('</worksheet>'));
    assert.equal((parts['xl/styles.xml'].match(/<alignment horizontal="center" vertical="center"/g)||[]).length,14);
    assert.equal((await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=incorrect')).status,404);
    const feed=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=test-export-only');
    assert.equal(feed.status,200);
    assert.match(feed.headers.get('Cache-Control'),/no-cache/);
    assert.equal(feed.headers.get('Pragma'),'no-cache');
    assert.equal(feed.headers.get('Expires'),'0');
    const feedText=await feed.text();
    assert.doesNotMatch(feedText,/<th(?:\s|>)/);
    assert.match(feedText,/<table id="cnc-data"><tbody><\/tbody><\/table>/);
    if(process.env.XLSX_TEST_OUTPUT)fs.writeFileSync(process.env.XLSX_TEST_OUTPUT,bytes);
  } finally {await mf.dispose();}
});

test('connected CNC export preserves identifiers and treats input as text',async()=>{
 const rows=[{'Order number':'00123','Sheet number':'01','Panel IDs':'=1+1','Project':'<script>alert(1)</script> & project'}];
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
 const feed=buildCncExcelFeed([{'Order number':'00123','Length (mm)':2400,'Width (mm)':1500,'Sheet area (m²)':3.6,'Panel area (m²)':2.96,'Waste':0.1777777777777778}]);
 assert.match(feed,/<td x:str[^>]*>00123<\/td>/);
 assert.match(feed,/<td x:num="2400"[^>]*>2400<\/td>/);
 assert.match(feed,/<td x:num="3.6"[^>]*mso-number-format:"0.00"[^>]*>3.6<\/td>/);
 assert.match(feed,/<td x:num="0.1778"[^>]*mso-number-format:"0%"[^>]*>18%<\/td>/);
 assert.doesNotMatch(feed,/<th(?:\s|>)/);
 assert.equal((feed.match(/text-align:center/g)||[]).length,18);
});

test('CNC conditional formatting covers current and future rows without colouring headers or other exports',async()=>{
 for(const rows of [[],[{'Status':'Pending'},{'Status':'Completed'}]]) {
  const parts=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'));
  assert.match(parts['xl/worksheets/sheet1.xml'],/conditionalFormatting sqref="I2:I1048576"/);
  assert.match(parts['xl/worksheets/sheet1.xml'],/conditionalFormatting sqref="J2:J1048576"/);
  assert.match(parts['xl/worksheets/sheet1.xml'],/conditionalFormatting sqref="Q2:Q1048576"/);
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('TRIM($Q2)="✓"'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('TRIM($Q2)="✕"'));
  const worksheet=parts['xl/worksheets/sheet1.xml'];
  assert.ok(worksheet.indexOf('<conditionalFormatting')<worksheet.indexOf('<pageMargins'));
  assert.ok(worksheet.indexOf('<pageMargins')<worksheet.indexOf('<ignoredErrors'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('LOWER(TRIM($J2))="completed"'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('LOWER(TRIM($J2))="pending"'));
  assert.match(parts['xl/styles.xml'],/<dxfs count="6">/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FF8CE28C"/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FFFFFF99"/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FFFFC000"/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FFF2F5F7"/);
  assert.match(parts['xl/styles.xml'],/<fgColor rgb="FFF2F5F7"\/><bgColor rgb="FFF2F5F7"\/><\/patternFill><\/fill><alignment horizontal="center" vertical="center"\/><\/dxf>/);
  assert.match(worksheet,/conditionalFormatting sqref="A2:R1048576"/);
  assert.ok(worksheet.includes('AND($A2&lt;&gt;"",MOD(ROW(),2)=0)'));
  assert.equal(parts['xl/tables/table1.xml'],undefined);
  assert.match(parts['xl/queryTables/queryTable1.xml'],/preserveFormatting="1"/);
  assert.doesNotMatch(parts['xl/queryTables/queryTable1.xml'],/queryTableFields/);
  assert.match(parts['xl/queryTables/queryTable1.xml'],/applyNumberFormats="0"/);
 }
 const plain=unzip(await buildXlsxBytes([{status:'Pending'}]));
 assert.doesNotMatch(plain['xl/worksheets/sheet1.xml'],/conditionalFormatting/);
});

test('CNC Excel leaves pending off-cuts blank and marks historical completed sheets as not saved',()=>{
 const rows=buildCncExcelRows([
  {jobReference:'Project A',orderNumber:'1',sheetNumber:'1',panelNumber:'A1',status:'pending'},
  {jobReference:'Project A',orderNumber:'1',sheetNumber:'2',panelNumber:'A2',status:'completed',completedAt:'2026-09-01T02:00:00Z'}
 ],splitDateTimeForExport);
 assert.equal(rows[0]['Off-cut'],'');assert.equal(rows[0]['Details'],'');
 assert.equal(rows[1]['Off-cut'],'✕');assert.equal(rows[1]['Details'],'');
});

test('CNC Excel groups panels by sheet and calculates sheet area and waste',async()=>{
 const rows=buildCncExcelRows([
  {jobReference:'Project A',orderNumber:'007',sheetNumber:'2',panelNumber:'A1',sheetWidth:1500,sheetHeight:6000,totalPanelArea:2,status:'completed',offcutOutcome:'confirmed',offcutDetails:{length:1200,width:450,color:'Charcoal',material:'Alupolic',thickness:4},uploadedBy:'msmith',uploadedAt:'2026-09-01T00:00:00Z',completedBy:'bjones',completedAt:'2026-09-01T02:00:00Z'},
  {jobReference:'Project A',orderNumber:'007',sheetNumber:'2',panelNumber:'A2',sheetWidth:6000,sheetHeight:1500,totalPanelArea:3,status:'completed',uploadedBy:'msmith',uploadedAt:'2026-09-01T00:01:00Z',completedBy:'bjones',completedAt:'2026-09-01T02:05:00Z'}
 ],splitDateTimeForExport);
 assert.equal(rows.length,1);assert.equal(rows[0]['Project'],'Project A');assert.equal(rows[0]['Length (mm)'],6000);assert.equal(rows[0]['Width (mm)'],1500);assert.equal(rows[0]['Panel IDs'],'A1, A2');assert.equal(rows[0]['Panel area (m²)'],5);assert.equal(rows[0]['Status'],'Completed');assert.equal(rows[0]['Off-cut'],'✓');assert.equal(rows[0]['Details'],'1200 × 450 mm · Charcoal · Alupolic · 4mm');
 const sheet=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'))['xl/worksheets/sheet1.xml'];
 assert.match(sheet,/<c r="F2" s="4"><f>D2\*E2\/1000000<\/f><v>9<\/v><\/c>/);
 assert.match(sheet,/<c r="I2" s="5"><f>IF\(F2&gt;0,MAX\(0,\(F2-H2\)\/F2\),&quot;&quot;\)<\/f>/);
 assert.match(sheet,/<col width="8" customWidth="1" min="9" max="9"\/>/);
 assert.match(sheet,/<c r="B2" t="inlineStr">/);
 assert.doesNotMatch(sheet,/<c r="B2"[^>]*s="2"/);
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
 assert.deepEqual(reports.daily,[{date:'01/09/2026',sheets:2,panels:3,area:7.5},{date:'03/09/2026',sheets:1,panels:3,area:7.25},{date:'08/10/2026',sheets:1,panels:2,area:4}]);
 assert.deepEqual(reports.weekly,[{date:'31/08/2026',sheets:3,panels:6,area:14.75},{date:'05/10/2026',sheets:1,panels:2,area:4}]);
 assert.deepEqual(reports.monthly,[{date:'01/09/2026',sheets:3,panels:6,area:14.75},{date:'01/10/2026',sheets:1,panels:2,area:4}]);
 const parts=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'));
 assert.match(parts['xl/workbook.xml'],/<sheet name="CNC Tracker" sheetId="1" r:id="rId1"\/>/);
 assert.match(parts['xl/workbook.xml'],/<definedName name="CNC_Tracker" localSheetId="0">'CNC Tracker'!\$A\$2:\$R\$7<\/definedName>/);
 assert.doesNotMatch(parts['xl/workbook.xml'],/name="Sheet1"/);
 assert.match(parts['xl/workbook.xml'],/<sheet name="Daily Report" sheetId="2" r:id="rId5"\/>/);
 assert.match(parts['xl/workbook.xml'],/<sheet name="Weekly Report" sheetId="3" r:id="rId6"\/>/);
 assert.match(parts['xl/workbook.xml'],/<sheet name="Monthly Report" sheetId="4" r:id="rId7"\/>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<t>Sheets completed<\/t>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<t>Panels completed<\/t>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<t>Total panel area \(m²\)<\/t>/);
 assert.match(parts['xl/worksheets/sheet3.xml'],/<t>Week commencing<\/t>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<conditionalFormatting sqref="A2:D4">.*<formula>AND\(\$A2&lt;&gt;"",MOD\(ROW\(\),2\)=0\)<\/formula>.*<\/conditionalFormatting>/);
 assert.match(parts['xl/worksheets/sheet3.xml'],/<conditionalFormatting sqref="A2:D3">.*dxfId="5".*<\/conditionalFormatting>/);
 assert.match(parts['xl/worksheets/sheet4.xml'],/<t>Month<\/t>/);
 assert.match(parts['xl/worksheets/sheet4.xml'],/<conditionalFormatting sqref="A2:D3">.*dxfId="5".*<\/conditionalFormatting>/);
 assert.match(parts['xl/worksheets/sheet4.xml'],/<c r="A2" t="n" s="7">/);
 assert.match(parts['xl/styles.xml'],/<numFmt numFmtId="164" formatCode="dd\/mm\/yyyy"\/>/);
 assert.match(parts['xl/styles.xml'],/<numFmt numFmtId="165" formatCode="mmmm yyyy"\/>/);
 assert.match(parts['xl/worksheets/sheet2.xml'],/<c r="D2" t="n" s="4"><v>7.5<\/v><\/c>/);
});
