import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';

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
    if(process.env.XLSX_TEST_OUTPUT)fs.writeFileSync(process.env.XLSX_TEST_OUTPUT,bytes);
  } finally {await mf.dispose();}
});
