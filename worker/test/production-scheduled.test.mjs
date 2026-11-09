import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteOrderRows,buildSiteOrderFeed,siteOrdersSheet,SITE_ORDER_COLUMNS} from '../src/site-orders-excel.js';
const orders=[{id:'panels',orderNumber:'1',project:'A',orderType:'Panels'},{id:'gate',orderNumber:'1',project:'B',orderType:'Gate'}];
const booking={orderId:'panels',assignedUsername:'person',scheduleType:'general',status:'planned'};
const rows=schedule=>buildSiteOrderRows(orders,[],[],[],[],schedule);
const flag=(schedule,id='panels')=>rows(schedule).find(row=>row['Order type']===(id==='gate'?'Gate':'Panels'))['Scheduled for production'];
test('person production bookings tick the exact order; empty and delivery bookings show a dash',()=>{
 assert.equal(flag([]),'-');assert.equal(flag([booking]),'✓');assert.equal(flag([booking],'gate'),'-');
 for(const patch of [{orderId:''},{assignedUsername:''},{assignedUsername:' '},{scheduleType:'delivery'},{status:'cancelled'}])assert.equal(flag([{...booking,...patch}]),'-');
 for(const scheduleType of ['cnc','general',undefined])assert.equal(flag([{...booking,scheduleType}]),'✓');
 assert.equal(flag([{...booking,orderId:'gate'}],'gate'),'✓');
});
test('multiple assignments retain the tick until the final booking is removed',()=>{
 const second={...booking,assignedUsername:'another'};assert.equal(flag([booking,second]),'✓');assert.equal(flag([second]),'✓');assert.equal(flag([]),'-');
 assert.equal(buildSiteOrderRows([{...orders[0],status:'cancelled'}],[],[],[],[],[booking])[0]['Scheduled for production'],'-');
});
test('worksheet and refresh feed use the same tick column without worker names or dates',()=>{
 const result=rows([booking]).filter(row=>row['Order type']==='Panels'),column=SITE_ORDER_COLUMNS.indexOf('Scheduled for production');assert.equal(column,SITE_ORDER_COLUMNS.indexOf('Routed / cut')+1);
 const feed=buildSiteOrderFeed(result),cells=[...feed.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(m=>m[1]);assert.equal(cells[column],'✓');assert.equal(cells.length,result.length*SITE_ORDER_COLUMNS.length);assert.doesNotMatch(feed,/person|assignedUsername/);
 const sheet=siteOrdersSheet(result,()=>''),letter=String.fromCharCode(65+column);assert.match(sheet,new RegExp('<c r="'+letter+'2"[^>]*>.*?>✓</t>'));assert.match(sheet,/sqref="N2:U/);
 const legacy=buildSiteOrderFeed(result,true,true,true,true,true,false);assert.equal((legacy.match(/<td /g)||[]).length,result.length*21);
});

test('non-fabricated order types skip production scheduling in rows, workbooks and existing refresh feeds',()=>{
 const types=['Consumables','Fixings','Other','Framing','Knotwood','Plant / Equipment','plant/equipment',' Plant/ Equipment ',' cOnSuMaBlEs '],column=SITE_ORDER_COLUMNS.indexOf('Scheduled for production');
 for(const orderType of types){
  for(const status of ['submitted','completed','dispatched','cancelled']){
   const order={...orders[0],orderType,orderTypeOther:'Custom supplies',status},before=structuredClone(order);
   for(const schedule of [[],[booking]]){
    const result=buildSiteOrderRows([order],[],[],[],[],schedule)[0];assert.equal(result['Scheduled for production'],'n/a',orderType+' '+status);assert.deepEqual(order,before);
    for(const args of [[],[true,true,true,true,true,true,false]]){const cells=[...buildSiteOrderFeed([result],...args).matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(m=>m[1]);assert.equal(cells[args.length?14:column],'n/a');}
    assert.match(siteOrdersSheet([result],()=> ''),/<c r="Q2"[^>]*>.*?>n\/a<\/t>/);
   }
  }
 }
 for(const orderType of ['Panels','Gate','Fabrication','Custom fabricated item','Framing components fabricated']){
  const order={...orders[0],orderType};assert.equal(buildSiteOrderRows([order])[0]['Scheduled for production'],'-');assert.equal(buildSiteOrderRows([order],[],[],[],[],[booking])[0]['Scheduled for production'],'✓');
 }
 const supply={...orders[0],orderType:'Fixings',status:'submitted'},row=buildSiteOrderRows([supply])[0];assert.equal(row.Status,'Submitted');assert.equal(row['Ready for dispatch'],'-');
});
