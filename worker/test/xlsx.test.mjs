import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';
import {CNC_COLUMNS,buildCncExcelFeed} from '../src/cnc-excel.js';

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

test('public CNC download keeps all eleven columns when the schedule is empty',async()=>{
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
    assert.match(sheet,/dimension ref="A1:K1"/);
    assert.equal((sheet.match(/<c r=/g)||[]).length,11);
    assert.match(sheet,/<t>time_completed<\/t>/);
    assert.doesNotMatch(sheet,/<row r="2">/);
    const parts=unzip(bytes);
    assert.match(parts['xl/connections.xml'],/interval="1"/);
    assert.match(parts['xl/connections.xml'],/refreshOnLoad="1"/);
    assert.match(parts['xl/connections.xml'],/localhost\/cnc-tracker\/excel-data\?token=test-export-only/);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/connectionId="1"/);
    assert.equal((await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=incorrect')).status,404);
    const feed=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=test-export-only');
    assert.equal(feed.status,200);
    assert.equal((await feed.text()).match(/<th>/g).length,11);
    if(process.env.XLSX_TEST_OUTPUT)fs.writeFileSync(process.env.XLSX_TEST_OUTPUT,bytes);
  } finally {await mf.dispose();}
});

test('connected CNC export preserves identifiers and treats input as text',async()=>{
 const rows=[{order_number:'00123',sheet_number:'01',panel_id:'=1+1',job_reference:'<script>alert(1)</script> & project'}];
 const files=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=a&b'));
 assert.match(files['xl/worksheets/sheet1.xml'],/<t>00123<\/t>/);
 assert.match(files['xl/worksheets/sheet1.xml'],/<t>=1\+1<\/t>/);
 assert.doesNotMatch(files['xl/worksheets/sheet1.xml'],/<f>/);
 assert.match(files['xl/connections.xml'],/token=a&amp;b/);
 const feed=buildCncExcelFeed(rows);
 assert.ok(feed.includes('&lt;script&gt;'));assert.ok(!feed.includes('<script>'));
 assert.match(feed,/<td x:str/);
});

test('CNC conditional formatting covers current and future rows without colouring headers or other exports',async()=>{
 for(const rows of [[],[{status:'Pending'},{status:'Completed'}]]) {
  const parts=unzip(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'));
  assert.match(parts['xl/worksheets/sheet1.xml'],/conditionalFormatting sqref="A2:K1048576"/);
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('LOWER(TRIM($E2))="completed"'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('LOWER(TRIM($E2))="pending"'));
  assert.match(parts['xl/styles.xml'],/<dxfs count="2">/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FF8CE28C"/);
  assert.match(parts['xl/styles.xml'],/<bgColor rgb="FFFFFF99"/);
  assert.match(parts['xl/queryTables/queryTable1.xml'],/preserveFormatting="1"/);
 }
 const plain=unzip(await buildXlsxBytes([{status:'Pending'}]));
 assert.doesNotMatch(plain['xl/worksheets/sheet1.xml'],/conditionalFormatting/);
});
