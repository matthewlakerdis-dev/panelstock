import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {buildAdminReport} from '../src/admin-reports.js';
import {inflateRawSync} from 'node:zlib';

const store = {
  readPublicCncExcelData: () => ({
    rows: [
      {Status:'Completed','Date completed':'31/12/25','Panel area (m²)':7.5},
      {Status:'Completed','Date completed':'03/01/26','Panel area (m²)':11.75},
      {Status:'Completed','Date completed':'06/01/26','Panel area (m²)':19.25}
    ],
    gateRows:[{id:'gate',completedAt:'2026-01-03T01:00:00Z',areaM2:3.25}]
  })
};
async function worksheet(period, bounds) {
  const bytes = Buffer.from(await buildAdminReport(store, 'm2-'+period+'-all', new URLSearchParams(bounds)));
  for (let offset=0; bytes.readUInt32LE(offset)===0x04034b50;) {
    const size=bytes.readUInt32LE(offset+18), length=bytes.readUInt16LE(offset+26);
    const start=offset+30+length+bytes.readUInt16LE(offset+28);
    if (bytes.toString('utf8',offset+30,offset+30+length)==='xl/worksheets/sheet1.xml') {
      return inflateRawSync(bytes.subarray(start,start+size)).toString();
    }
    offset=start+size;
  }
  assert.fail('Missing worksheet');
}

test('date bounds include both endpoints and ISO weeks cross the calendar year', async () => {
  const daily = await worksheet('daily',{from:'2026-01-03',to:'2026-01-03'});
  assert.match(daily,/<v>15<\/v>/);
  assert.doesNotMatch(daily,/31\/12\/2025|06\/01\/2026/);
  const weekly = await worksheet('weekly',{from:'2026-W01',to:'2026-W01'});
  assert.match(weekly,/29\/12\/2025/);
  assert.match(weekly,/<v>22\.5<\/v>/);
  assert.doesNotMatch(weekly,/05\/01\/2026/);
  const monthly = await worksheet('monthly',{from:'2026-01',to:'2026-01'});
  assert.match(monthly,/<v>34\.25<\/v>/);
  assert.doesNotMatch(monthly,/01\/12\/2025|01\/02\/2026/);
});

test('invalid dates, nonexistent ISO weeks, and backwards ranges return 400', async () => {
  for (const [period,bounds] of [
    ['daily',{from:'2026-02-30'}], ['weekly',{from:'2025-W53'}],
    ['monthly',{from:'2026-03',to:'2026-02'}]
  ]) await assert.rejects(worksheet(period,bounds), {status:400});
});

test('production reports render a branded PDF with pagination', async () => {
  const filters = new URLSearchParams({format:'pdf',from:'2026-W01',to:'2026-W01'});
  const filtered = await PDFDocument.load(await buildAdminReport(store,'m2-weekly-all',filters));
  assert.equal(filtered.getTitle(),'Lennox Facades — Production m²');
  assert.equal(filtered.getPageCount(),1);

  const historical = {readPublicCncExcelData:()=>({
    rows:[{Status:'Completed','Date completed':'01/01/24','Panel area (m²)':1}]
  })};
  const pages = await PDFDocument.load(await buildAdminReport(historical,'m2-weekly-panels',new URLSearchParams({
    format:'pdf', from:'2024-W01', to:'2024-W52'
  })));
  assert.ok(pages.getPageCount()>1);
});
