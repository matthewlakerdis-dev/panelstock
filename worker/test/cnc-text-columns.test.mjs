import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {CNC_COLUMNS,CNC_REPORT_PERIODS,buildCncExcelFeed,buildCncReportFeed} from '../src/cnc-excel.js';
function partsOf(bytes){
  const buf=Buffer.from(bytes),parts={};let offset=0;
  while(buf.readUInt32LE(offset)===0x04034b50){const size=buf.readUInt32LE(offset+18),len=buf.readUInt16LE(offset+26),extra=buf.readUInt16LE(offset+28),start=offset+30+len+extra;parts[buf.subarray(offset+30,offset+30+len).toString()]=inflateRawSync(buf.subarray(start,start+size)).toString();offset=start+size;}
  return parts;
}
const row={Project:'Example','Order No.':'001',Status:'Completed','Date completed':'07/09/2026','Panel IDs':'81','Panel area (m²)':5.7,'Off-cut':'✓',Details:'1340 × 1270 mm · Milled · Raw Aluminium · 3mm','Template / Remake':'✓',Notes:'Remake: 81: TOOLPATHING ERROR'};
const later=Array.from({length:31},(_,index)=>({...row,Details:index===30?row.Details:'',Notes:index===30?row.Notes:''}));

test('shared tracker fixes flag widths and aligns the fitted Details and Notes areas',async()=>{
  for(const rows of [[],[{}],[row],later,[{...row,Notes:'N'.repeat(100)}]]){
    const parts=partsOf(await buildXlsxBytes(rows,CNC_COLUMNS,'https://example.test/feed')),sheet=parts['xl/worksheets/sheet1.xml'];
    const columns=[...sheet.matchAll(/<col\b[^>]*\/>/g)].map(match=>({xml:match[0],width:Number(match[0].match(/width="([^"]+)"/)[1]),index:Number(match[0].match(/min="(\d+)"/)[1])}));
    assert.equal(columns.length,20);
    const display=(key,raw)=>{const value=raw&&typeof raw==='object'&&Object.hasOwn(raw,'value')?raw.value:raw;return value==null?'':key==='Waste'&&Number.isFinite(Number(value))?`${Math.round(Number(value)*100)}%`:String(value);};
    const fitted=key=>Math.min(Math.max(Math.max(key.length,...rows.map(item=>Math.max(...display(key,item[key]).split(/\r?\n/).map(part=>part.length))))+2,8),255);
    const textWidth=Math.max(fitted('Details'),fitted('Notes'));
    CNC_COLUMNS.forEach((key,index)=>{
      const expected=index===16?7:index===18?9:[17,19].includes(index)?textWidth:fitted(key);
      assert.equal(columns[index].width,expected,key);
      assert.match(columns[index].xml,/bestFit="1"/,key);
      assert.equal(columns[index].xml.includes('style="8"'),[17,19].includes(index),key);
    });
    for(const cell of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>/g)){
      if(Number(cell[2])>1&&['R','T'].includes(cell[1]))assert.match(cell[3],/ s="8"/);
      else assert.doesNotMatch(cell[3],/ s="8"/);
    }
    const xfs=[...parts['xl/styles.xml'].match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)[1].matchAll(/<xf\b[^>]*>.*?<\/xf>/g)].map(m=>m[0]);
    assert.equal(xfs.length,9);
    assert.match(xfs[8],/<alignment horizontal="left" vertical="center" wrapText="0"\/>/);
    assert.match(xfs[0],/horizontal="center"/);
    assert.match(xfs[1],/horizontal="center" vertical="center" wrapText="1"/);
    assert.match(sheet,/defaultRowHeight="18" customHeight="1"/);
    for(const match of sheet.matchAll(/<row r="(\d+)"([^>]*)>/g))assert.equal(match[2],` ht="${match[1]==='1'?30:18}" customHeight="1"`);
    assert.match(parts['xl/queryTables/queryTable1.xml'],/preserveFormatting="1" adjustColumnWidth="0"/);
  }
});

test('only the Details and Notes cells are left-aligned in each refreshed feed row',()=>{
  const long={...row,Details:'<details> & '.repeat(100),Notes:'=literal text\n'+row.Notes.repeat(30)};
  const data=[{},row,...later,long],snapshot=JSON.stringify(data),feed=buildCncExcelFeed(data);
  const feedRows=[...feed.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)].map(m=>m[1]);
  assert.equal(feedRows.length,data.length);
  for(const html of feedRows){
    const cells=[...html.matchAll(/<td\b[^>]*>/g)].map(m=>m[0]);
    assert.equal(cells.length,20);
    cells.forEach((cell,index)=>{
      assert.match(cell,new RegExp(`text-align:${[17,19].includes(index)?'left':'center'};`));
      assert.match(cell,/white-space:nowrap;/);
    });
  }
  assert.ok(feed.includes('&lt;details&gt; &amp; '.repeat(100)));
  assert.ok(feed.includes(long.Notes));
  assert.equal(JSON.stringify(data),snapshot);
  for(const period of CNC_REPORT_PERIODS)assert.doesNotMatch(buildCncReportFeed([row],period),/text-align:left/);
});

test('stripe fills do not override text alignment and all unrelated workbook parts remain unchanged',async()=>{
  const parts=partsOf(await buildXlsxBytes([row],CNC_COLUMNS,'https://example.test/feed'));
  const dxfs=[...parts['xl/styles.xml'].match(/<dxfs[^>]*>(.*?)<\/dxfs>/s)[1].matchAll(/<dxf>(.*?)<\/dxf>/g)].map(m=>m[1]);
  assert.equal(dxfs.length,7);
  for(const [id,colour] of [[5,'FFF2F5F7'],[6,'FFFFFFFF']]){
    assert.match(dxfs[id],new RegExp(`patternType="solid"><fgColor rgb="${colour}"/><bgColor rgb="${colour}"/>`));
    assert.doesNotMatch(dxfs[id],/<alignment/);
  }
  for(const id of [0,1,2,3,4])assert.match(dxfs[id],/horizontal="center" vertical="center"/);
  const plain=partsOf(await buildXlsxBytes([row],CNC_COLUMNS));
  assert.doesNotMatch(plain['xl/worksheets/sheet1.xml'],/style="8"| s="8"/);
  assert.doesNotMatch(plain['xl/styles.xml'],/horizontal="left"/);
  const columns=sheet=>[...sheet.matchAll(/<col\b[^>]*>/g)].map(m=>m[0]);
  const connectedCols=columns(parts['xl/worksheets/sheet1.xml']),ordinaryCols=columns(plain['xl/worksheets/sheet1.xml']);
  connectedCols.forEach((col,index)=>{
    if(index===16)assert.match(col,/<col width="7" /);
    else if(index===18)assert.match(col,/<col width="9" /);
    else if(index===17||index===19)return;
    else assert.equal(col.replace(' bestFit="1"',''),ordinaryCols[index]);
  });
  assert.match(connectedCols[17],/style="8"/);
  assert.match(connectedCols[19],/style="8"/);
  assert.equal(connectedCols[17].match(/width="([^"]+)"/)[1],connectedCols[19].match(/width="([^"]+)"/)[1]);
  assert.equal((parts['xl/worksheets/sheet1.xml'].match(/bestFit="1"/g)||[]).length,20);
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes(row.Notes));
});
