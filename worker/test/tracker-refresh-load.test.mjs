import test from 'node:test';
import {trackerExportFailure} from '../src/tracker-export-diagnostics.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {buildXlsxBytes} from '../src/reports.js';
import {SAFETY_READER_PATH} from '../src/safety-reader-assets.js';
import {originApp} from '../src/app-access.js';
import {HttpError,equal} from '../src/security.js';
import {CNC_COLUMNS,CNC_REPORT_PERIODS,buildCncExcelFeed,buildCncReportFeed} from '../src/cnc-excel.js';
import {buildSiteOrderRows,buildSiteOrderFeed,splitSiteOrderRows} from '../src/site-orders-excel.js';
import {buildGateProgressFeed} from '../src/gate-progress-workbook.js';
import {trackerPdfRows} from '../src/tracker-order-pdf.js';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{InventoryStore\}.*;\r?\n/m,'').replace('export default {','const worker={');
const dependencies={trackerExportFailure,CNC_COLUMNS,buildXlsxBytes,SAFETY_READER_PATH,originApp,HttpError,equal,CNC_REPORT_PERIODS,buildCncExcelFeed,buildCncReportFeed,buildSiteOrderFeed,splitSiteOrderRows,buildGateProgressFeed,trackerPdfRows};
const worker=new Function(...Object.keys(dependencies),source+';return worker;')(...Object.values(dependencies));
const secret='synthetic-refresh-load';
const row={'Project':'Café example','Status':'Completed','Date completed':'17/11/2026','Panel IDs':'P1','Panel area (m²)':4.25};
const orders=buildSiteOrderRows([{id:'11111111-1111-4111-8111-111111111111',project:'Café example',orderNumber:'001',orderType:'Fixings',status:'submitted',items:[]}]);
const feeds=['','&report=site-orders&siteOrdersVersion=13','&report=daily&reportVersion=2','&report=weekly&reportVersion=2','&report=monthly&reportVersion=2','&report=completed-orders&siteOrdersVersion=13','&report=gate-progress&gateProgressVersion=3'];
const url=query=>'https://example.test/cnc-tracker/excel-data?token='+secret+query;
function fixture(){
 const store={
  readPublicCnc:()=>{throw Error('Raw CNC storage must not be fetched by an Excel refresh');},
  readPublicCncSettings:()=>{throw Error('Settings service is unavailable');},
  readPublicGateProduction:()=>{throw Error('Reports must use their complete projected snapshot');},
  readPublicCncExcelData:async includeGates=>({rows:[row],...(includeGates?{gateRows:[]}:{})}),
  readPublicSiteOrders:async()=>orders,
  readPublicGateProgress:async()=>[],
  handle:async()=>({status:401,body:{error:'Please log in'}})
 };
 return {store,env:{INVENTORY:{getByName:()=>store},CNC_PUBLIC_TOKEN:secret,GATE_COMPONENTS_ENABLED:'true',SITE_ID:'test'}};
}

test('Refresh All succeeds with independent feeds when unrelated raw CNC/settings services are unavailable',async()=>{
 const {env}=fixture();
 const expected=[buildCncExcelFeed([row]),buildSiteOrderFeed(await trackerPdfRows(orders,'https://example.test',secret,'test'),...Array(11).fill(true)),...CNC_REPORT_PERIODS.map(period=>buildCncReportFeed([row],period,new Date(),[])),buildSiteOrderFeed([],...Array(11).fill(true)),buildGateProgressFeed([],{legacyColumns:false,columnVersion:3})];
 const responses=await Promise.all(feeds.map(query=>worker.fetch(new Request(url(query)),env)));
 for(let index=0;index<responses.length;index++){
  const response=responses[index];assert.equal(response.status,200,feeds[index]);
  const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(new TextDecoder().decode(bytes),expected[index]);
  assert.equal(Number(response.headers.get('Content-Length')),bytes.byteLength);
  assert.match(response.headers.get('Cache-Control'),/no-store/);assert.match(response.headers.get('Cache-Control'),/no-transform/);
 }
 const heads=await Promise.all(feeds.map(query=>worker.fetch(new Request(url(query),{method:'HEAD'}),env)));
 for(const head of heads){assert.equal(head.status,200);assert.equal(await head.text(),'');assert.match(head.headers.get('Cache-Control'),/no-transform/);assert.ok(Number(head.headers.get('Content-Length'))>0);}
});

test('rejected credentials, invalid report versions and write methods never query production data',async()=>{
 const {env}=fixture();env.INVENTORY.getByName=()=>new Proxy({},{get:(_,name)=>name==='httpResponse'?async()=>Response.json({error:'Please log in'},{status:401}):name==='handle'?async()=>({status:401,body:{error:'Please log in'}}):()=>assert.fail('Rejected request read '+String(name))});
 for(const method of ['GET','HEAD']){
  assert.equal((await worker.fetch(new Request(url('').replace(secret,'invalid'),{method}),env)).status,404);
  for(const query of ['&report=invalid','&report=gate-progress&gateProgressVersion=99','&report=completed-orders&siteOrdersVersion=11'])assert.equal((await worker.fetch(new Request(url(query),{method}),env)).status,404);
 }
 assert.equal((await worker.fetch(new Request(url(''),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),env)).status,401);
});

test('simultaneous exports recover from retryable broken RPC stubs using fresh connections',async()=>{
 const {store,env}=fixture();let failures=3;
 env.INVENTORY.getByName=()=>{
  let broken=false;
  return new Proxy(store,{get:(target,key)=>{
   const method=target[key];if(typeof method!=='function')return method;
   return (...args)=>{
    if(broken||failures>0){if(!broken)failures--;broken=true;throw Object.assign(Error('Synthetic interrupted read'),{retryable:true});}
    return method(...args);
   };
  }});
 };
 const responses=await Promise.all(feeds.map(query=>worker.fetch(new Request(url(query)),env)));
 for(const response of responses){assert.equal(response.status,200);assert.match(await response.text(),/<table/);}
 assert.equal(failures,0);
});

test('export recovery is bounded and never retries overload or permanent errors',async()=>{
 for(const failure of [Object.assign(Error('Temporary failure'),{retryable:true}),Object.assign(Error('Overloaded'),{retryable:true,overloaded:true}),Error('Permanent data error')]){
  const {store,env}=fixture();let reads=0;
  store.readPublicCncExcelData=()=>{reads++;throw failure;};
  const response=await worker.fetch(new Request(url('')),env);assert.equal(response.status,503);
  assert.equal(reads,failure.retryable&&!failure.overloaded?3:1);
 }
});


test('Production Tracker download builds all seven sheets from one coherent backend snapshot',async()=>{
 const {env}=fixture();let snapshots=0;
 env.INVENTORY.getByName=()=>new Proxy({readPublicTrackerWorkbookData:async()=>{
  snapshots++;return {rows:[row],cncSettings:{},siteOrderRows:orders,gateReportRows:[],gateProgressOrders:[]};
 }},{get:(target,key)=>target[key]||(()=>assert.fail('Workbook download separately fetched '+String(key)))});
 const response=await worker.fetch(new Request('https://example.test/cnc-tracker?token='+secret),env);
 assert.equal(response.status,200);assert.equal(snapshots,1);assert.equal(response.headers.get('Content-Type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.match(response.headers.get('Content-Disposition'),/PRODUCTION_TRACKER.xlsx/);
 const bytes=Buffer.from(await response.arrayBuffer()),parts={};let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){
  const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+length+extra;
  parts[bytes.subarray(offset+30,offset+30+length).toString()]=inflateRawSync(bytes.subarray(start,start+size)).toString();offset=start+size;
 }
 for(const sheet of ['Site Orders','CNC Tracker','Daily Report','Weekly Report','Monthly Report','Completed Orders','Gate Progress'])assert.ok(parts['xl/workbook.xml'].includes('name="'+sheet+'"'),sheet);
 assert.equal((parts['xl/connections.xml'].match(/<connection /g)||[]).length,7);
 assert.match(parts['xl/worksheets/sheet1.xml'],/Café example/);
 assert.match(parts['xl/worksheets/sheet5.xml'],/\/pdf\?tracker=[a-f0-9]{64}/);
});


test('download diagnostics stay redacted in internal logs and absent from the public response',async t=>{
 const log=t.mock.method(console,'error',()=>{}),{store,env}=fixture();
 store.readPublicTrackerWorkbookData=()=>{throw new TypeError('Cannot read property "PRIVATE ORDER" '+secret);};
 const response=await worker.fetch(new Request('https://example.test/cnc-tracker?token='+secret),env);
 assert.equal(response.status,503);const failure=await response.json();assert.match(failure.requestId,/^[a-f0-9-]{36}$/);assert.deepEqual({...failure,requestId:undefined},{ok:false,error:'Service unavailable; please retry',requestId:undefined});
 const details=log.mock.calls[0].arguments[1];assert.equal(details.stage,'workbook-data');assert.equal(details.name,'TypeError');assert.match(details.detail,/Cannot read property/);assert.ok(!JSON.stringify(details).includes(secret));assert.ok(!JSON.stringify(details).includes('PRIVATE ORDER'));
});
