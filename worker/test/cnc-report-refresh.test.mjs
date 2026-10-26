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
    const reports=buildCncReportRows(buildCncExcelRows(panels,dates),new Date('2026-09-06T00:00:00Z'));
    for(const period of CNC_REPORT_PERIODS)assert.deepEqual(reports[period].map(({sheets,panels,area})=>({sheets,panels,area})),[{sheets:fixture.sheets,panels:2,area:fixture.area}]);
    assert.equal(JSON.stringify(panels),before);
  }
});

test('all four worksheets have native refreshable queries with independent ranges and the same sharing token',async()=>{
  for(const data of [[],rows]) {
    const parts=partsOf(await buildXlsxBytes(data,CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=a%26b&v=123'));
    const connections=[...parts['xl/connections.xml'].matchAll(/<connection\s[^>]+>.*?<\/connection>/g)].map(match=>match[0]);
    assert.equal(connections.length,5);
    assert.equal(Object.keys(parts).filter(name=>/^xl\/queryTables\//.test(name)).length,5);
    connections.splice(connections.findIndex(connection=>connection.includes('id="5"')),1);
    const reports=buildCncReportRows(data);
    for(let index=0;index<4;index++) {
      const id=index+1,period=CNC_REPORT_PERIODS[index-1],name=index?period[0].toUpperCase()+period.slice(1)+'_Report':'CNC_Tracker';
      const title=name.replace('_',' '),last=Math.max(2,(index?reports[period].length:data.length)+1),column=index?'D':'T';
      const url=new URL(connections[index].match(/url="([^"]+)"/)[1].replaceAll('&amp;','&'));
      assert.equal(url.origin,'https://example.test');assert.equal(url.pathname,'/cnc-tracker/excel-data');
      assert.equal(url.searchParams.get('token'),'a&b');assert.equal(url.searchParams.get('v'),'123');
      assert.equal(url.searchParams.get('report'),period||null);
      assert.match(connections[index],/refreshOnLoad="1" interval="15"/);
      const query=parts[`xl/queryTables/queryTable${id}.xml`];
      assert.ok(query.includes(`name="${name}"`));assert.ok(query.includes(`connectionId="${id}"`));
      assert.match(query,/headers="0" backgroundRefresh="1" refreshOnLoad="1"/);
      assert.match(query,/preserveFormatting="1" adjustColumnWidth="0" growShrinkType="insertDelete"/);
      assert.ok(query.includes(`applyNumberFormats="${index?1:0}"`));
      assert.ok(parts[`xl/worksheets/_rels/sheet${id}.xml.rels`].includes(`Target="../queryTables/queryTable${id}.xml"`));
      assert.ok(parts['[Content_Types].xml'].includes(`PartName="/xl/queryTables/queryTable${id}.xml"`));
      assert.ok(parts['xl/workbook.xml'].includes(`<definedName name="${name}" localSheetId="${index?index+1:1}">'${title}'!$A$2:$${column}$${last}</definedName>`));
      if(index) {
        const sheet=parts[`xl/worksheets/sheet${id}.xml`];
        assert.match(sheet,/sqref="A2:D5000"/);
        assert.equal((sheet.match(/bestFit="1"/g)||[]).length,4);
        assert.match(sheet,new RegExp(`<col min="1" max="1" width="[^"]+" customWidth="1" bestFit="1" style="${index===3?7:6}"/>`));
        assert.match(sheet,/<col min="4" max="4" width="[^"]+" customWidth="1" bestFit="1" style="4"\/>/);
        assert.match(sheet,/state="frozen"/);
        if(!data.length)for(const column of ['B','C','D'])assert.match(sheet,new RegExp(`<c r="${column}2" t="n" s="[04]"><v>0</v></c>`));
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
  assert.deepEqual(reports.daily.filter(r=>r.sheets).map(r=>r.date),['30/08/2026','06/09/2026','07/09/2026','01/10/2026']);
  assert.deepEqual(reports.weekly.filter(r=>r.sheets).map(r=>r.date),['24/08/2026','31/08/2026','07/09/2026','28/09/2026']);
  assert.deepEqual(reports.monthly.filter(r=>r.sheets),[{date:'01/08/2026',sheets:1,panels:2,area:4.2},{date:'01/09/2026',sheets:2,panels:2,area:6.95},{date:'01/10/2026',sheets:1,panels:1,area:2.5}]);
  const serial=Math.floor((Date.UTC(2026,8,6)-Date.UTC(1899,11,30))/86400000);
  assert.ok(buildCncReportFeed(initial,'daily').includes(`x:num="${serial}"`));
  assert.match(buildCncReportFeed(initial,'daily'),/mso-number-format:"dd\/mm\/yyyy"[^>]*>06\/09\/2026/);
  assert.match(buildCncReportFeed(initial,'monthly'),/mso-number-format:"mmmm yyyy"[^>]*>September 2026/);
  assert.match(buildCncReportFeed(updated,'daily'),/mso-number-format:"0.00"[^>]*>9.90/);
  assert.equal(JSON.stringify(rows),before);
});

test('reports with no valid completions show zero totals for the current Brisbane period',()=>{
  const now=new Date('2026-10-25T14:00:00Z');
  const expected={daily:[{date:'26/10/2026',sheets:0,panels:0,area:0}],weekly:[{date:'26/10/2026',sheets:0,panels:0,area:0}],monthly:[{date:'01/10/2026',sheets:0,panels:0,area:0}]};
  assert.deepEqual(buildCncReportRows([],now),expected);
  for(const period of CNC_REPORT_PERIODS){
    const empty=buildCncReportFeed([],period,now);
    assert.equal(buildCncReportFeed([completed('31/02/2026'),{...rows[0],Status:'Pending'}],period,now),empty);
    assert.equal((empty.match(/<tr(?:\s[^>]*)?>/g)||[]).length,1);
    assert.equal((empty.match(/x:num=/g)||[]).length,4);
    assert.equal((empty.match(/x:num="0"/g)||[]).length,3);
    assert.match(empty,/>0\.00<\/td>/);
  }
  for(const invalid of ['','yearly','__proto__','constructor'])assert.throws(()=>buildCncReportFeed([],invalid,now),RangeError);
});

test('zero-activity gaps include leap days, whole weeks, whole months and the quiet period through today',()=>{
  const data=[completed('02/05/2024',5,'B1'),completed('28/02/2024',2.5,'A1, A2')],before=JSON.stringify(data);
  const reports=buildCncReportRows(data,new Date('2024-05-03T14:00:00Z'));
  assert.equal(reports.daily.length,67);
  assert.equal(reports.daily[0].date,'28/02/2024');
  assert.deepEqual(reports.daily[1],{date:'29/02/2024',sheets:0,panels:0,area:0});
  assert.deepEqual(reports.daily.at(-1),{date:'04/05/2024',sheets:0,panels:0,area:0});
  assert.equal(reports.weekly.length,10);
  assert.deepEqual(reports.weekly[1],{date:'04/03/2024',sheets:0,panels:0,area:0});
  assert.deepEqual(reports.monthly,[
    {date:'01/02/2024',sheets:1,panels:2,area:2.5},
    {date:'01/03/2024',sheets:0,panels:0,area:0},
    {date:'01/04/2024',sheets:0,panels:0,area:0},
    {date:'01/05/2024',sheets:1,panels:1,area:5}
  ]);
  for(const period of CNC_REPORT_PERIODS){
    assert.deepEqual(reports[period].reduce((total,row)=>({sheets:total.sheets+row.sheets,panels:total.panels+row.panels,area:total.area+row.area}),{sheets:0,panels:0,area:0}),{sheets:2,panels:3,area:7.5});
  }
  assert.equal(JSON.stringify(data),before);
});

test('the report extends at Brisbane midnight into a new year and a new Monday week',()=>{
  const data=[completed('31/12/2025',3,'A')];
  const before=buildCncReportRows(data,new Date('2025-12-31T13:59:59Z'));
  const after=buildCncReportRows(data,new Date('2025-12-31T14:00:00Z'));
  assert.equal(before.daily.length,1);
  assert.deepEqual(after.daily.at(-1),{date:'01/01/2026',sheets:0,panels:0,area:0});
  assert.deepEqual(after.monthly.at(-1),{date:'01/01/2026',sheets:0,panels:0,area:0});
  const monday=buildCncReportRows(data,new Date('2026-01-04T14:00:00Z'));
  assert.deepEqual(monday.weekly,[{date:'29/12/2025',sheets:1,panels:1,area:3},{date:'05/01/2026',sheets:0,panels:0,area:0}]);
});

test('all report refresh feeds include calendar gaps as numeric zero cells',()=>{
  const data=[completed('28/02/2024')],now=new Date('2024-05-05T14:00:00Z');
  for(const period of CNC_REPORT_PERIODS){
    const reports=buildCncReportRows(data,now)[period],feed=buildCncReportFeed(data,period,now);
    const zeroRows=reports.filter(row=>row.sheets===0).length;
    assert.ok(zeroRows>0);
    assert.equal((feed.match(/<tr(?:\s[^>]*)?>/g)||[]).length,reports.length);
    assert.equal((feed.match(/x:num="0"/g)||[]).length,zeroRows*3);
    assert.equal((feed.match(/>0\.00<\/td>/g)||[]).length,zeroRows);
  }
});

test('downloaded workbook includes zero rows and expands each report query range',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2024-05-06T00:00:00Z')});
  const data=[completed('28/02/2024'),completed('02/05/2024')];
  const parts=partsOf(await buildXlsxBytes(data,CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=synthetic'));
  const reports=buildCncReportRows(data);
  for(const [period,sheet,year,month,day]of [['daily',2,2024,1,29],['weekly',3,2024,2,4],['monthly',4,2024,2,1]]){
    const serial=Math.floor((Date.UTC(year,month,day)-Date.UTC(1899,11,30))/86400000);
    const row=[...parts[`xl/worksheets/sheet${sheet}.xml`].matchAll(/<row\b[^>]*>.*?<\/row>/g)].map(match=>match[0]).find(value=>value.includes(`<v>${serial}</v>`));
    assert.ok(row,`${period} gap is present in the saved workbook`);
    for(const column of ['B','C','D'])assert.match(row,new RegExp(`<c r="${column}\\d+"[^>]*><v>0</v></c>`));
    const name=period[0].toUpperCase()+period.slice(1)+' Report';
    assert.ok(parts['xl/workbook.xml'].includes(`'${name}'!$A$2:$D$${reports[period].length+1}</definedName>`));
  }
});
