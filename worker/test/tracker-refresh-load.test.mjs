import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SAFETY_READER_PATH} from '../src/safety-reader-assets.js';
import {originApp} from '../src/app-access.js';
import {HttpError,equal} from '../src/security.js';
import {CNC_REPORT_PERIODS,buildCncExcelFeed,buildCncReportFeed} from '../src/cnc-excel.js';
import {buildSiteOrderRows,buildSiteOrderFeed,splitSiteOrderRows} from '../src/site-orders-excel.js';
import {buildGateProgressFeed} from '../src/gate-progress-workbook.js';
import {trackerPdfRows} from '../src/tracker-order-pdf.js';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{InventoryStore\}.*;\r?\n/m,'').replace('export default {','const worker={');
const dependencies={SAFETY_READER_PATH,originApp,HttpError,equal,CNC_REPORT_PERIODS,buildCncExcelFeed,buildCncReportFeed,buildSiteOrderFeed,splitSiteOrderRows,buildGateProgressFeed,trackerPdfRows};
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
 const {env}=fixture();env.INVENTORY.getByName=()=>new Proxy({},{get:(_,name)=>name==='handle'?async()=>({status:401,body:{error:'Please log in'}}):()=>assert.fail('Rejected request read '+String(name))});
 for(const method of ['GET','HEAD']){
  assert.equal((await worker.fetch(new Request(url('').replace(secret,'invalid'),{method}),env)).status,404);
  for(const query of ['&report=invalid','&report=gate-progress&gateProgressVersion=99','&report=completed-orders&siteOrdersVersion=11'])assert.equal((await worker.fetch(new Request(url(query),{method}),env)).status,404);
 }
 assert.equal((await worker.fetch(new Request(url(''),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),env)).status,401);
});
