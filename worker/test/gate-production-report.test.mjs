import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {gateProductionReportRows} from '../src/gate-production-report.js';
import {buildCncReportRows,CNC_REPORT_PERIODS,buildCncReportFeed} from '../src/cnc-excel.js';
import {ordersWithCompletionDates} from '../src/order-history.js';
const now=new Date('2026-11-03T01:00:00Z');
const gate={id:'gate-1',orderType:'Gate',status:'completed',completedAt:'2026-10-31T14:30:00Z',manualProduction:{areaM2:6.75,stages:{drawn:'complete',fabricatedQa:'complete',readyForDispatch:'complete'}},items:[{quantity:2},{quantity:5}]};
const panel={'Status':'Completed','Date completed':'01/11/2026','Panel IDs':'P1, P2','Panel area (m²)':4.25};
const cells=html=>[...html.matchAll(/<td x:num="([^"]+)"/g)].map(m=>Number(m[1]));
function partsOf(bytes){const b=Buffer.from(bytes),parts={};let p=0;while(b.readUInt32LE(p)===0x04034b50){const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),extra=b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;parts[name]=inflateRawSync(b.subarray(start,start+size)).toString();p=start+size;}return parts;}
test('whole-order gate areas count once in Brisbane periods, separately from CNC panels',()=>{
 const input=[gate,{...gate,id:'bin',orderType:'Bin Gate',completedAt:'2026-11-01T14:00:00Z',manualProduction:{...gate.manualProduction,areaM2:2.5}},{...gate,id:'buggy',orderType:'Buggy Gate',status:'dispatched',manualProduction:{...gate.manualProduction,areaM2:1.25}}],before=structuredClone(input),data=gateProductionReportRows(input),reports=buildCncReportRows([panel],now,[...data,data[0]]);
 assert.deepEqual(reports.daily,[{date:'01/11/2026',sheets:1,panels:2,area:4.25,gateArea:8,totalArea:12.25},{date:'02/11/2026',sheets:0,panels:0,area:0,gateArea:2.5,totalArea:2.5}]);
 assert.deepEqual(reports.weekly,[{date:'26/10/2026',sheets:1,panels:2,area:4.25,gateArea:8,totalArea:12.25},{date:'02/11/2026',sheets:0,panels:0,area:0,gateArea:2.5,totalArea:2.5}]);
 assert.deepEqual(reports.monthly,[{date:'01/11/2026',sheets:1,panels:2,area:4.25,gateArea:10.5,totalArea:14.75}]);assert.deepEqual(input,before);assert.deepEqual(Object.keys(data[0]),['id','completedAt','areaM2']);
 const zeroPanel={...panel,'Date completed':'03/11/2026','Panel area (m²)':0},withZero=buildCncReportRows([panel,zeroPanel],now,data);
 assert.deepEqual(withZero.daily,reports.daily);assert.equal(withZero.weekly[1].sheets,1);assert.equal(withZero.monthly[0].panels,4);assert.equal(withZero.monthly[0].totalArea,14.75);
 const emptyDaily=buildCncReportFeed([zeroPanel],'daily',now,[]);assert.equal((emptyDaily.match(/<td /g)||[]).length,6);assert.doesNotMatch(emptyDaily,/x:num=|03\/11\/2026/);

});
test('pending, reopened, cancelled and invalid gates are excluded; historical dates use completion audit',()=>{
 assert.deepEqual(gateProductionReportRows([{...gate,orderType:'Fixings'},{...gate,status:'approved'},{...gate,status:'cancelled'},{...gate,completedAt:null},{...gate,manualProduction:{...gate.manualProduction,stages:{drawn:'complete',fabricatedQa:'pending'}}}]),[]);
 for(const areaM2 of [null,'bad',-1,0,Infinity,100000])assert.equal(buildCncReportRows([],now,gateProductionReportRows([{...gate,manualProduction:{...gate.manualProduction,areaM2}}])).daily.reduce((sum,r)=>sum+r.gateArea,0),0);
 for(const completedAt of ['',null,'bad'])assert.equal(buildCncReportRows([],now,[{id:'invalid',areaM2:6.75,completedAt}]).daily.reduce((sum,r)=>sum+r.gateArea,0),0);
 const old={...gate,status:'dispatched',completedAt:null,dispatchedAt:'2026-11-03T00:00:00Z'},events=[{action:'order-production-updated',at:gate.completedAt,detail:JSON.stringify({orderId:gate.id,status:'completed'})},{action:'order-dispatched',at:old.dispatchedAt,detail:JSON.stringify({orderId:gate.id,status:'dispatched'})}];
 assert.equal(gateProductionReportRows(ordersWithCompletionDates({sql:{exec:()=>({toArray:()=>events})}},[old]))[0].completedAt,gate.completedAt);
 for(const period of CNC_REPORT_PERIODS){const modern=cells(buildCncReportFeed([],period,now,gateProductionReportRows([gate]))),legacy=cells(buildCncReportFeed([],period,now));assert.equal(modern.length%6,0);assert.equal(legacy.length,period==='daily'?0:4);assert.equal(modern.filter((_,i)=>i%6===4).reduce((a,b)=>a+b,0),6.75);}
});
test('saved QA, corrections, reopening and dispatch flow into all reports and six-column downloads',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'gate-reports-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'gate-reports-test',CNC_PUBLIC_TOKEN:'synthetic-gate-reports',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;const api=async(path,body)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
 const reports=async area=>{for(const period of CNC_REPORT_PERIODS){const r=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-gate-reports&report='+period+'&reportVersion=2');assert.equal(r.status,200);const values=cells(await r.text());assert.equal(values.length%6,0);if(period==='daily'&&area===0)assert.equal(values.length,0);assert.equal(values.filter((_,i)=>i%6===4).reduce((a,b)=>a+b,0),area);assert.equal(values.filter((_,i)=>i%6===5).reduce((a,b)=>a+b,0),area);assert.ok(values.filter((_,i)=>[1,2,3].includes(i%6)).every(v=>v===0));const old=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-gate-reports&report='+period);assert.equal(cells(await old.text()).length,period==='daily'?0:4);}};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));token=(await api('/login',{username:'admin',pin:'123456'})).token;
  await api('/order-types',{name:'Gate'});let order=(await api('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Gate reports example',orderType:'Gate',villa:'V132',colour:'Spruce',siteContact:'Contact',phone:'PRIVATE PHONE',requestedDeliveryDate:'2026-11-15',items:[{quantity:2,description:'Front'},{quantity:5,description:'Rear'}]}})).order;
  await reports(0);order=(await api('/orders/'+order.id+'/progress',{expectedUpdatedAt:order.updatedAt,areaM2:6.75,stages:{drawn:'complete'}})).order;await reports(0);
  const approve=async()=>{const qa=await api('/qa'),items=qa.items.filter(item=>item.gateOrderId===order.id),results=Object.fromEntries(qa.checklists.gate.map(([key])=>[key,'pass']));assert.equal(items.length,2);await api('/qa/check',{id:items[0].id,kind:'metalwork',results,overrideReason:'Synthetic inspection'});await reports(0);await api('/qa/check',{id:items[1].id,kind:'metalwork',results,overrideReason:'Synthetic inspection'});order=(await api('/orders/'+order.id)).order;};
  await approve();await reports(6.75);const completedAt=order.completedAt;
  order=(await api('/orders/'+order.id+'/progress',{expectedUpdatedAt:order.updatedAt,areaM2:7.25,stages:{drawn:'complete'}})).order;assert.equal(order.completedAt,completedAt);await reports(7.25);
  order=(await api('/orders/'+order.id+'/progress',{expectedUpdatedAt:order.updatedAt,stages:{drawn:'pending'}})).order;await reports(0);order=(await api('/orders/'+order.id+'/progress',{expectedUpdatedAt:order.updatedAt,stages:{drawn:'complete'}})).order;await approve();await reports(7.25);
  const approvedAt=order.completedAt;order=(await api('/dispatch/orders',{id:order.id,expectedUpdatedAt:order.updatedAt,mutationId:crypto.randomUUID(),destination:'Project site',transport:'Truck',driver:'Driver'})).order;assert.equal(order.completedAt,approvedAt);await reports(7.25);
  const download=await mf.dispatchFetch('http://localhost/cnc-tracker?token=synthetic-gate-reports');assert.equal(download.status,200);const parts=partsOf(await download.arrayBuffer());for(const sheet of [2,3,4]){const xml=parts['xl/worksheets/sheet'+sheet+'.xml'];assert.match(xml,/Gate area \(m²\)/);assert.match(xml,/Total production area \(m²\)/);assert.match(xml,/<c r="E2" t="n" s="4"><v>7.25<\/v>/);assert.match(xml,/<c r="F2" t="n" s="4"><v>7.25<\/v>/);assert.match(xml,/dimension ref="A1:F/);}assert.equal((parts['xl/connections.xml'].match(/reportVersion=2/g)||[]).length,3);
  assert.equal((await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=wrong&report=daily&reportVersion=2')).status,404);
 }finally{await mf.dispose();}
});
