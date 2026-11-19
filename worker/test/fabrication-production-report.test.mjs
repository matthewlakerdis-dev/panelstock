import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fabricationProductionReportRows} from '../src/fabrication-production-report.js';
import {buildCncReportRows,buildCncReportFeed,CNC_REPORT_PERIODS} from '../src/cnc-excel.js';
import {buildAdminReport} from '../src/admin-reports.js';
import {PDFDocument} from 'pdf-lib';
const at='2026-11-18T14:30:00Z',cut='2026-11-17T00:00:00Z';
const base={jobReference:'Fabrication test',orderNumber:'001',sheetNumber:'1',stockItemType:'variant',stockItemId:'stock',sheetWidth:4000,sheetHeight:1500,status:'completed',completedAt:cut,totalPanelArea:4.2};
const approved=(id,checkedAt=at)=>({id,kind:'panel',status:'approved',latest:{status:'approved',checkedAt,photo:'PRIVATE PHOTO',notes:'PRIVATE QA NOTES'}});
const cells=html=>[...html.matchAll(/<td x:num="([^"]+)"/g)].map(m=>Number(m[1]));
function parts(bytes){const b=Buffer.from(bytes),result={};let p=0;while(b.readUInt32LE(p)===0x04034b50){const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),start=p+30+n+b.readUInt16LE(p+28);result[b.subarray(p+30,p+30+n).toString()]=inflateRawSync(b.subarray(start,start+size)).toString();p=start+size;}return result;}
test('fabrication recognises approved panels once, keeps the original pass date, and exports no QA evidence',()=>{
 const p={...base,id:'one'},r=approved('one'),later={status:'approved',checkedAt:'2026-11-20T01:00:00Z'},input=[r,{id:'gate',kind:'metalwork',status:'approved'}],before=structuredClone(input);
 const rows=fabricationProductionReportRows([p,p],input);assert.deepEqual(rows,[{id:'one',completedAt:at,areaM2:4.2}]);assert.deepEqual(input,before);
 assert.deepEqual(fabricationProductionReportRows([p],[{...r,latest:later,history:[r.latest,later]}]),rows);
 for(const status of ['awaiting','recut','replaced','not_required'])assert.deepEqual(fabricationProductionReportRows([p],[{...r,status}]),[]);
 assert.deepEqual(fabricationProductionReportRows([{...p,status:'pending'}],[r]),[]);
 assert.deepEqual(fabricationProductionReportRows([p],[approved('one','bad')]),[]);
 assert.deepEqual(fabricationProductionReportRows([p],[approved('one','2026-11-16T00:00:00Z')]),[]);
 for(const totalPanelArea of [0,-1,Infinity,'bad',100000])assert.deepEqual(fabricationProductionReportRows([{...p,totalPanelArea}],[r]),[]);
 assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|photo|notes|checkedBy/);
});
test('a shared sheet area waits for every shared panel and counts once on the final approval, separate from individual areas',()=>{
 const a={...base,id:'a',panelAreaScope:'sheet'},b={...a,id:'b',panelNumber:'B'},individual={...base,id:'c',totalPanelArea:1.5};
 const first=approved('a'),last=approved('b','2026-11-19T14:00:00Z');
 assert.deepEqual(fabricationProductionReportRows([a,b],[first]),[]);
 const rows=fabricationProductionReportRows([a,b,individual],[first,last,approved('c')]);
 assert.deepEqual(rows,[{id:'c',areaM2:1.5,completedAt:at},{id:'sheet:a',areaM2:4.2,completedAt:last.latest.checkedAt}]);
 const other={...a,id:'d',jobReference:'Other project'};assert.equal(fabricationProductionReportRows([a,b,other],[first,last,approved('d')]).reduce((n,row)=>n+row.areaM2,0),8.4);
});
test('QA-only days stay visible in Brisbane periods, duplicates are ignored and fabrication stays outside production totals',()=>{
 const cnc=[{Status:'Completed','Date completed':'18/11/2026','Panel area (m²)':5,'Panel IDs':'A'}],event={id:'qa',completedAt:at,areaM2:2.25},now=new Date('2026-11-20T00:00:00Z');
 const report=buildCncReportRows(cnc,now,[],[event,event]);assert.equal(report.daily.length,2);assert.equal(report.daily[1].date,'19/11/2026');assert.equal(report.daily[1].fabricationArea,2.25);assert.equal(report.daily[1].totalArea,0);
 for(const period of CNC_REPORT_PERIODS){const data=report[period];assert.equal(data.reduce((n,row)=>n+row.fabricationArea,0),2.25);assert.equal(data.reduce((n,row)=>n+row.totalArea,0),5);assert.equal(cells(buildCncReportFeed(cnc,period,now,[],[event])).length%7,0);assert.equal(cells(buildCncReportFeed(cnc,period,now,[])).length%6,0);}
 const empty=buildCncReportFeed([],'daily',now,[],[]);assert.equal((empty.match(/<td /g)||[]).length,7);
});
test('Production m² XLSX and PDF include fabrication for panels/all, preserve totals and respect period bounds',async()=>{
 const store={readPublicCncExcelData:async(gates,fabrication)=>({rows:[{Status:'Completed','Date completed':'18/11/2026','Panel area (m²)':5}],...(gates?{gateRows:[]} :{}),...(fabrication?{fabricationRows:[{id:'qa',completedAt:at,areaM2:2.25}]}:{})})};
 for(const period of CNC_REPORT_PERIODS){
  const xml=parts(await buildAdminReport(store,'m2-'+period+'-all'))['xl/worksheets/sheet1.xml'];assert.match(xml,/Fabrication area \(m²\)/);assert.match(xml,/<v>2.25<\/v>/);assert.match(xml,/<v>5<\/v>/);assert.doesNotMatch(xml,/<v>7.25<\/v>/);
  const pdf=await PDFDocument.load(await buildAdminReport(store,'m2-'+period+'-all',new URLSearchParams({format:'pdf'})));assert.ok(pdf.getPageCount()>0);
 }
 const bounds=new URLSearchParams({from:'2026-11-19',to:'2026-11-19'}),xml=parts(await buildAdminReport(store,'m2-daily-panels',bounds))['xl/worksheets/sheet1.xml'];assert.match(xml,/<v>2.25<\/v>/);assert.doesNotMatch(xml,/<v>5<\/v>/);
 assert.doesNotMatch(parts(await buildAdminReport(store,'m2-daily-gates'))['xl/worksheets/sheet1.xml'],/Fabrication area/);
});
test('real QA saves update refresh feeds, versioned workbooks and Production m² reports without leaking evidence',async()=>{
 const site='fabrication-report-test',mf=new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name:site,modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:site,MIGRATION_READY:'true',EMAIL_ENABLED:'false',CNC_PUBLIC_TOKEN:'synthetic-fabrication'}}]}));
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));
  let token;const api=async(path,body)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};token=(await api('/login',{username:'admin',pin:'123456'})).token;
  const storage=await mf.unsafeGetDurableObjectStorage(site,'InventoryStore',{name:site}),save=async(key,value)=>{await storage.exec('DELETE FROM documents WHERE key=?',key);await storage.exec('INSERT INTO documents(key,part,value) VALUES(?,?,?)',key,0,JSON.stringify(value));};
  const panels=[{...base,id:'a',panelNumber:'A',panelAreaScope:'sheet'},{...base,id:'b',panelNumber:'B',panelAreaScope:'sheet'},{...base,id:'c',panelNumber:'C',sheetNumber:'2',totalPanelArea:2.5}];await save('app:cncPanels',panels);await save('qa-settings',{enabledFrom:'2026-01-01T00:00:00Z',preventSelfApproval:false});
  const checks=(await api('/qa')).checklists.panel,results=Object.fromEntries(checks.map(([key])=>[key,'pass']));
  const report=async(expected)=>{for(const period of CNC_REPORT_PERIODS){const url='http://localhost/cnc-tracker/excel-data?token=synthetic-fabrication&report='+period,r=await mf.dispatchFetch(url+'&reportVersion=3');assert.equal(r.status,200);const html=await r.text(),data=cells(html);assert.equal(data.length%7,0);assert.equal(data.filter((_,i)=>i%7===4).reduce((n,v)=>n+v,0),expected);assert.equal(data.filter((_,i)=>i%7===6).reduce((n,v)=>n+v,0),6.7);assert.doesNotMatch(html,/PRIVATE QA/);const old=cells(await(await mf.dispatchFetch(url+'&reportVersion=2')).text());assert.equal(old.length%6,0);assert.equal(old.filter((_,i)=>i%6===5).reduce((n,v)=>n+v,0),6.7);}};
  await report(0);await api('/qa/check',{id:'a',kind:'panel',results,notes:'PRIVATE QA NOTES'});await report(0);await api('/qa/check',{id:'b',kind:'panel',results});await report(4.2);await api('/qa/check',{id:'c',kind:'panel',results});await report(6.7);
  const response=await mf.dispatchFetch('http://localhost/cnc-tracker?token=synthetic-fabrication');assert.equal(response.status,200);const files=parts(await response.arrayBuffer());for(const sheet of [2,3,4]){assert.match(files['xl/worksheets/sheet'+sheet+'.xml'],/Fabrication area \(m²\)/);assert.match(files['xl/worksheets/sheet'+sheet+'.xml'],/dimension ref="A1:G/);}assert.equal((files['xl/connections.xml'].match(/reportVersion=3/g)||[]).length,3);assert.match(files['xl/workbook.xml'],/Daily Report&apos;|Daily Report'/);
  const failed={...results,[checks[0][0]]:'fail'};await api('/qa/check',{id:'a',kind:'panel',results:failed,notes:'Failed inspection',photo:'data:image/png;base64,aGVsbG8='});await report(2.5);
  assert.equal((await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=wrong&report=daily&reportVersion=3')).status,404);
 }finally{await mf.dispose();}
});
