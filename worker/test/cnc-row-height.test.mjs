import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {CNC_COLUMNS,CNC_REPORT_PERIODS,buildCncExcelFeed,buildCncReportFeed} from '../src/cnc-excel.js';

function partsOf(bytes) {
  const buffer=Buffer.from(bytes),parts={};let offset=0;
  while(buffer.readUInt32LE(offset)===0x04034b50) {
    const size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28);
    const start=offset+30+nameLength+extra;
    parts[buffer.subarray(offset+30,offset+30+nameLength).toString()]=inflateRawSync(buffer.subarray(start,start+size)).toString();
    offset=start+size;
  }
  return parts;
}
const note='Remake: 19: '+('Long note with <markup> & punctuation. '.repeat(20))+'\nSecond line';
const rows=Array.from({length:31},(_,index)=>({Project:'Row height fixture','Order No.':'001','Sheet':String(index+1).padStart(3,'0'),Status:index===1?'Pending':'Completed','Date completed':index%2?'07/09/2026':'01/08/2026','Panel IDs':String(index+1),'Panel area (m²)':4.2,Notes:index===19?note:''}));

test('shared CNC workbooks use fixed 18-point data rows and retain 30-point headings',async()=>{
  for(const data of [[],rows.slice(0,1),rows]) {
    const parts=partsOf(await buildXlsxBytes(data,CNC_COLUMNS,'https://example.test/feed'));
    for(let id=1;id<=4;id++) {
      const sheet=parts[`xl/worksheets/sheet${id}.xml`];
      assert.match(sheet,/<sheetFormatPr baseColWidth="8" defaultRowHeight="18" customHeight="1"\/>/);
      assert.match(sheet,/<row r="1" ht="30" customHeight="1">/);
      const body=[...sheet.matchAll(/<row r="(\d+)"([^>]*)>/g)].filter(match=>match[1]!=='1');
      for(const row of body)assert.equal(row[2],' ht="18" customHeight="1"');
      if(!data.length)assert.equal(body.length,0,'No invented data rows in an empty workbook');
      if(id===1)assert.equal(body.length,data.length);
    }
    const styles=[...parts['xl/styles.xml'].match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)[1].matchAll(/<xf\b[^>]*>.*?<\/xf>/g)].map(match=>match[0]);
    for(const id of [0,2,4,5,6,7])assert.match(styles[id],/<alignment horizontal="center" vertical="center" wrapText="0"\/>/);
    for(const id of [1,3])assert.match(styles[id],/wrapText="1"/,'Headings still wrap');
    for(let id=1;id<=4;id++)assert.match(parts[`xl/queryTables/queryTable${id}.xml`],/preserveFormatting="1" adjustColumnWidth="1"/);
  }
});

test('tracker and report feeds carry fixed heights and no-wrap formatting for refresh growth and shrink',()=>{
  for(const data of [[],rows.slice(0,1),rows,rows.slice(0,2),[]]) {
    for(const feed of [buildCncExcelFeed(data),...CNC_REPORT_PERIODS.map(period=>buildCncReportFeed(data,period))]) {
      const tags=[...feed.matchAll(/<tr(?:\s[^>]*)?>/g)].map(match=>match[0]);
      for(const tag of tags)assert.equal(tag,'<tr height="24" style="height:18pt;mso-height-source:userset">');
      const cells=[...feed.matchAll(/<td\b[^>]*>/g)].map(match=>match[0]);
      for(const cell of cells)assert.match(cell,/white-space:nowrap;/);
      assert.doesNotMatch(feed,/<th(?:\s|>)/);
    }
  }
});

test('fixed row layout preserves long notes, identifiers, numeric formats, colours and widths',async()=>{
  const snapshot=JSON.stringify(rows),parts=partsOf(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed'));
  const sheet=parts['xl/worksheets/sheet1.xml'],feed=buildCncExcelFeed(rows);
  const escaped=note.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  assert.ok(sheet.includes(escaped));assert.ok(feed.includes(escaped));
  assert.match(sheet,/<c r="B21" t="inlineStr"><is><t>001<\/t>/);
  assert.match(sheet,/<c r="H21" t="n" s="4"><v>4.2<\/v>/);
  assert.equal((sheet.match(/bestFit="1"/g)||[]).length,20);
  for(const rgb of ['FFF2F5F7','FFFFFFFF','FFFFFF99','FF8CE28C','FFFFC7CE'])assert.ok(parts['xl/styles.xml'].includes(`rgb="${rgb}"`));
  assert.match(sheet,/conditionalFormatting sqref="A2:T1048576"/);
  assert.equal(JSON.stringify(rows),snapshot);
});

test('ordinary non-connected exports keep their existing automatic row layout',async()=>{
  const parts=partsOf(await buildXlsxBytes([{Notes:note}],['Notes']));
  assert.match(parts['xl/worksheets/sheet1.xml'],/<sheetFormatPr baseColWidth="8" defaultRowHeight="15"\/>/);
  assert.match(parts['xl/worksheets/sheet1.xml'],/<row r="2">/);
  assert.doesNotMatch(parts['xl/styles.xml'],/wrapText="0"/);
  assert.equal(parts['xl/queryTables/queryTable1.xml'],undefined);
});
