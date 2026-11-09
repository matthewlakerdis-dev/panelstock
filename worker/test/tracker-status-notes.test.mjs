import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteOrderRows,buildSiteOrderFeed,siteOrdersSheet,SITE_ORDER_COLUMNS} from '../src/site-orders-excel.js';
const source={id:'12345678-1234-4234-8234-123456789012',project:'Example',orderNumber:'57',orderType:'Panels',status:'submitted',notes:'Keep wrapped',location:'North elevation'};
const cells=html=>[...html.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);
test('Status / notes removes repeated state messages while retaining specific dispatch, coating and area details',()=>{
 const base=buildSiteOrderRows([source])[0];
 for(const [Status,Notes,expected] of [
  ['Dispatched','Dispatched to site','Dispatched to site'],
  ['Dispatched','Dispatched to site; Gate area: 12 m²','Dispatched to site; Gate area: 12 m²'],
  ['Dispatched','Use loading bay','Dispatched; Use loading bay'],
  ['Cancelled','Order cancelled; Gate area: 12 m²','Cancelled; Gate area: 12 m²'],
  ['Submitted','At powder coaters','Submitted; At powder coaters'],
  ['Approved','Approved; At powder coaters; at powder coaters','Approved; At powder coaters'],
  ['Ready for dispatch','Ready for dispatch','Ready for dispatch'],
  ['Submitted','','Submitted'],
  ['','Awaiting final QA after coating','Awaiting final QA after coating'],
  ['Dispatched','Dispatched to site reception; Call before arrival','Dispatched; Dispatched to site reception; Call before arrival']
 ]){
  const row={...base,Status,Notes},before=structuredClone(row),values=cells(buildSiteOrderFeed([row]));
  assert.equal(values[19],expected);assert.equal(values[7],'Keep wrapped');assert.deepEqual(row,before);
  const sheet=siteOrdersSheet([row],()=> '');assert.ok(sheet.includes(`<c r="T2" s="0" t="inlineStr"><is><t xml:space="preserve">${expected}</t>`));
 }
});
test('fresh workbooks have one combined status column and keep the raw progress and old download layouts intact',()=>{
 const row={...buildSiteOrderRows([source])[0],Status:'Dispatched',Notes:'Dispatched to site'};
 assert.equal(SITE_ORDER_COLUMNS.length,20);assert.equal(SITE_ORDER_COLUMNS.includes('Status'),false);assert.equal(SITE_ORDER_COLUMNS.includes('Notes'),false);
 assert.equal(SITE_ORDER_COLUMNS.indexOf('Schedule delivery')+1,SITE_ORDER_COLUMNS.indexOf('Drawn'));assert.equal(SITE_ORDER_COLUMNS.indexOf('Scheduled for production'),14);
 for(const [args,count,status,notes] of [[[true,true,true,true,true,false],21,10,18],[[true,true,true,true,true,true,false],22,10,19]]){
  const values=cells(buildSiteOrderFeed([row],...args));assert.equal(values.length,count);assert.equal(values[status],'Dispatched');assert.equal(values[notes],'Dispatched to site');
 }
 const values=cells(buildSiteOrderFeed([row]));assert.equal(values.length,20);assert.equal(values[19],'Dispatched to site');
 assert.equal(row.Status,'Dispatched');assert.equal(row.Notes,'Dispatched to site');
 const sheet=siteOrdersSheet([row],()=> '');assert.match(sheet,/<c r="T1"[^>]*><is><t xml:space="preserve">Status \/ notes<\/t>/);assert.doesNotMatch(sheet,/<t xml:space="preserve">Notes<\/t>/);assert.match(sheet,/sqref="L2:S5000"/);
});
test('combined text is formula-safe, escaped, and fitted to the full status and details',()=>{
 const row={...buildSiteOrderRows([source])[0],Status:'Approved',Notes:'=1+1 & <note> '+ 'Wide detail '.repeat(8)};
 const feed=buildSiteOrderFeed([row]),sheet=siteOrdersSheet([row],()=> '');assert.match(feed,/Approved; =1\+1 &amp; &lt;note&gt;/);assert.doesNotMatch(feed,/<note>/);
 assert.match(sheet,/<c r="T2" s="0" t="inlineStr">/);assert.doesNotMatch(sheet,/<c r="T2"[^>]*><f>/);
 assert.ok(Number(sheet.match(/<col min="20" max="20" width="([^"]+)"/)[1])>32);
});
