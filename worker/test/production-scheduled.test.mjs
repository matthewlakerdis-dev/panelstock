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
 const sheet=siteOrdersSheet(result,()=>''),letter=String.fromCharCode(65+column);assert.match(sheet,new RegExp('<c r="'+letter+'2"[^>]*>.*?>✓</t>'));assert.match(sheet,/sqref="L2:S/);
 const legacy=buildSiteOrderFeed(result,true,true,true,true,true,false);assert.equal((legacy.match(/<td /g)||[]).length,result.length*(SITE_ORDER_COLUMNS.length-1));
});
