import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {CNC_COLUMNS,CNC_REPORT_PERIODS,buildCncExcelRows,buildCncReportFeed,buildCncReportRows} from '../src/cnc-excel.js';

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
const completed=(date,area=4.2,ids='21, 22')=>({'Status':'Completed','Date completed':date,'Panel area (m²)':area,'Panel IDs':ids});
const rows=[completed('30/08/2026'),completed('06/09/2026',5.7,'51'),completed('07/09/2026',1.25,'61'),completed('01/10/2026',2.5,'71')];

test('report areas preserve manual panel totals and count explicit sheet totals once per physical sheet',()=>{
  const base={jobReference:'Test',orderNumber:'001',sheetNumber:'1',stockItemId:'stock1',sheetWidth:4000,sheetHeight:1500,status:'completed'};
  const dates=()=>({date:'06/09/2026',time:'10:00'});
  const cases=[
    {panels:[{totalPanelArea:2.1},{totalPanelArea:2.1}],area:4.2,sheets:1},
    {panels:[{totalPanelArea:4.2,panelAreaScope:'sheet'},{totalPanelArea:4.2,panelAreaScope:'sheet'}],area:4.2,sheets:1},
    {panels:[{totalPanelArea:4.2,panelAreaScope:'sheet'},{totalPanelArea:1.5}],area:5.7,sheets:1},
    {panels:[{totalPanelArea:4.2,panelAreaScope:'sheet'},{totalPanelArea:4.2,panelAreaScope:'sheet',sheetNumber:'2'}],area:8.4,sheets:2},
  ];
  for(const fixture of cases){
    const panels=fixture.panels.map((panel,index)=>({...base,panelNumber:String(index+1),...panel}));
    const before=JSON.stringify(panels);
    const reports=buildCncReportRows(buildCncExcelRows(panels,dates));
    for(const period of CNC_REPORT_PERIODS)assert.deepEqual(reports[period].map(({sheets,panels,area})=>({sheets,panels,area})),[{sheets:fixture.sheets,panels:2,area:fixture.area}]);
    assert.equal(JSON.stringify(panels),before);
  }
});

test('all four worksheets have native refreshable queries with independent ranges and the same sharing token',async()=>{
  for(const data of [[],rows]) {
    const parts=partsOf(await buildXlsxBytes(data,CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=a%26b&v=123'));
    const connections=[...parts['xl/connections.xml'].matchAll(/<connection\s[^>]+>.*?<\/connection>/g)].map(match=>match[0]);
    assert.equal(connections.length,4);
    assert.equal(Object.keys(parts).filter(name=>/^xl\/queryTables\//.test(name)).length,4);
    const reports=buildCncReportRows(data);
    for(let index=0;index<4;index++) {
      const id=index+1,period=CNC_REPORT_PERIODS[index-1],name=index?period[0].toUpperCase()+period.slice(1)+'_Report':'CNC_Tracker';
      const title=name.replace('_',' '),last=Math.max(2,(index?reports[period].length:data.length)+1),column=index?'D':'T';
      const url=new URL(connections[index].match(/url="([^"]+)"/)[1].replaceAll('&amp;','&'));
      assert.equal(url.origin,'https://example.test');assert.equal(url.pathname,'/cnc-tracker/excel-data');
      assert.equal(url.searchParams.get('token'),'a&b');assert.equal(url.searchParams.get('v'),'123');
      assert.equal(url.searchParams.get('report'),period||null);
      assert.match(connections[index],/refreshOnLoad="1" interval="1"/);
      const query=parts[`xl/queryTables/queryTable${id}.xml`];
      assert.ok(query.includes(`name="${name}"`));assert.ok(query.includes(`connectionId="${id}"`));
      assert.match(query,/headers="0" backgroundRefresh="0" refreshOnLoad="1"/);
      assert.match(query,/preserveFormatting="1" adjustColumnWidth="1" growShrinkType="insertDelete"/);
      assert.ok(query.includes(`applyNumberFormats="${index?1:0}"`));
      assert.ok(parts[`xl/worksheets/_rels/sheet${id}.xml.rels`].includes(`Target="../queryTables/queryTable${id}.xml"`));
      assert.ok(parts['[Content_Types].xml'].includes(`PartName="/xl/queryTables/queryTable${id}.xml"`));
      assert.ok(parts['xl/workbook.xml'].includes(`<definedName name="${name}" localSheetId="${index}">'${title}'!$A$2:$${column}$${last}</definedName>`));
      if(index) {
        const sheet=parts[`xl/worksheets/sheet${id}.xml`];
        assert.match(sheet,/sqref="A2:D1048576"/);
        assert.equal((sheet.match(/bestFit="1"/g)||[]).length,4);
        assert.match(sheet,new RegExp(`<col min="1" max="1" width="[^"]+" customWidth="1" bestFit="1" style="${index===3?7:6}"/>`));
        assert.match(sheet,/<col min="4" max="4" width="[^"]+" customWidth="1" bestFit="1" style="4"\/>/);
        assert.match(sheet,/state="frozen"/);
        if(!data.length)assert.doesNotMatch(sheet,/<row r="2">/);
      }
    }
  }
});

test('report refresh feeds recalculate existing totals and include new days, Monday weeks and months',()=>{
  const before=JSON.stringify(rows);
  const initial=[completed('06/09/2026')],updated=[...initial,completed('06/09/2026',5.7,'51')];
  for(const period of CNC_REPORT_PERIODS) {
    const first=buildCncReportFeed(initial,period),next=buildCncReportFeed(updated,period);
    assert.match(first,/x:num="4.2"/);assert.match(next,/x:num="9.9"/);
    assert.match(next,/x:num="2"[^>]*>2<\/td>/);assert.match(next,/x:num="3"[^>]*>3<\/td>/);
    const aggregate=buildCncReportRows(rows)[period],feed=buildCncReportFeed(rows,period);
    assert.equal((feed.match(/<tr(?:\s[^>]*)?>/g)||[]).length,aggregate.length);
    assert.equal((feed.match(/x:num=/g)||[]).length,aggregate.length*4);
    assert.doesNotMatch(feed,/<th(?:\s|>)|<script|<f>/);
    assert.match(feed,/text-align:center;vertical-align:middle/);
  }
  const reports=buildCncReportRows(rows);
  assert.deepEqual(reports.daily.map(r=>r.date),['30/08/2026','06/09/2026','07/09/2026','01/10/2026']);
  assert.deepEqual(reports.weekly.map(r=>r.date),['24/08/2026','31/08/2026','07/09/2026','28/09/2026']);
  assert.deepEqual(reports.monthly,[{date:'01/08/2026',sheets:1,panels:2,area:4.2},{date:'01/09/2026',sheets:2,panels:2,area:6.95},{date:'01/10/2026',sheets:1,panels:1,area:2.5}]);
  const serial=Math.floor((Date.UTC(2026,8,6)-Date.UTC(1899,11,30))/86400000);
  assert.ok(buildCncReportFeed(initial,'daily').includes(`x:num="${serial}"`));
  assert.match(buildCncReportFeed(initial,'daily'),/mso-number-format:"dd\/mm\/yyyy"[^>]*>06\/09\/2026/);
  assert.match(buildCncReportFeed(initial,'monthly'),/mso-number-format:"mmmm yyyy"[^>]*>September 2026/);
  assert.match(buildCncReportFeed(updated,'daily'),/mso-number-format:"0.00"[^>]*>9.90/);
  assert.equal(JSON.stringify(rows),before);
});

test('empty reports retain a blank four-cell query result without invented dates or totals',()=>{
  for(const period of CNC_REPORT_PERIODS) {
    const empty=buildCncReportFeed([],period);
    assert.equal(buildCncReportFeed([completed('31/02/2026'),{...rows[0],Status:'Pending'}],period),empty);
    assert.equal((empty.match(/<tr(?:\s[^>]*)?>/g)||[]).length,1);
    assert.equal((empty.match(/<td x:str[^>]*><\/td>/g)||[]).length,4);
    assert.doesNotMatch(empty,/x:num/);
    assert.notEqual(buildCncReportFeed(rows,period),empty);
  }
  for(const invalid of ['','yearly','__proto__','constructor'])assert.throws(()=>buildCncReportFeed([],invalid),RangeError);
});
