import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteOrderRows,buildSiteOrderFeed,siteOrdersSheet,SITE_ORDER_COLUMNS,siteOrderTextWidth} from '../src/site-orders-excel.js';
test('text widths account for narrow characters and preserve room for wide ones',()=>{
 assert.ok(siteOrderTextWidth('iiiiiiii')<siteOrderTextWidth('WWWWWWWW'));
 const note='***test test test test test test test test test test***';
 const sheet=siteOrdersSheet([{Location:note}],()=> '');
 const width=Number(sheet.match(/<col min="7" max="7" width="([^"]+)"/)[1]);
 assert.ok(width<note.length-5);assert.ok(width>=siteOrderTextWidth(note)+1);
});
test('PDF is first with Action immediately after it and links to the correct authenticated order',()=>{
 const id='12345678-1234-1234-1234-123456789012';
 const rows=buildSiteOrderRows([{id,project:'Example',orderNumber:'7'}]);
 assert.deepEqual(SITE_ORDER_COLUMNS.slice(0,3),['PDF','Action','Project']);
 assert.match(rows[0].PDF,new RegExp('orderPdf='+id));
 assert.match(buildSiteOrderFeed(rows),/<a href="https:\/\/web.panelstockhq.com\/\?page=orders&amp;orderPdf=[^"]+"[^>]*>Open PDF<\/a>/);
 const sheet=siteOrdersSheet(rows,()=> '');assert.match(sheet,/<c r="A2"[^>]*><f>HYPERLINK/);assert.match(sheet,/A1:T2/);assert.match(sheet,/sqref="L2:S5000"/);
 assert.equal(buildSiteOrderRows([{id:'bad'}])[0].PDF,'');
});


test('new downloads omit Date ordered and put live actions beside PDF while previous downloads retain their layout',()=>{
 const newest='12345678-1234-4234-8234-123456789012',older='22222222-2222-4222-8222-222222222222';
 const rows=buildSiteOrderRows([{id:older,project:'Earlier project',orderNumber:'1',orderType:'Fixings',status:'submitted',dateOrdered:'2026-11-01T00:00:00Z'},{id:newest,project:'Recent project',orderNumber:'2',orderType:'Fixings',status:'completed',dateOrdered:'2026-11-08T00:00:00Z'}]);
 const cells=html=>[...html.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(m=>m[1]),values=cells(buildSiteOrderFeed([rows[0]]));
 assert.deepEqual(SITE_ORDER_COLUMNS.slice(0,3),['PDF','Action','Project']);assert.equal(SITE_ORDER_COLUMNS.includes('Date ordered'),false);assert.equal(SITE_ORDER_COLUMNS.length,20);
 assert.match(rows[0].PDF,new RegExp(newest));assert.ok(Number.isFinite(rows[0]['Date ordered']));
 assert.equal(values.length,20);assert.match(values[0],new RegExp('orderPdf='+newest));assert.match(values[1],/orderAction=dispatch/);assert.equal(values[2],'Recent project');assert.match(values[10],/orderAction=schedule/);
 const sheet=siteOrdersSheet(rows,()=> '');assert.doesNotMatch(sheet,/>Date ordered<\/t>/);
 assert.match(sheet,/<c r="A2"[^>]*><f>HYPERLINK\([^<]+orderPdf=/);assert.match(sheet,/<c r="B2"[^>]*><f>HYPERLINK\([^<]+&quot;Dispatch&quot;/);assert.match(sheet,/<c r="B3"[^>]*><f>HYPERLINK\([^<]+&quot;Mark ready&quot;/);
 assert.match(sheet,/<col min="1" max="1" width="12"/);assert.match(sheet,/<col min="2" max="2" width="20"/);assert.match(sheet,/sqref="L2:S5000"/);
 const legacy=buildSiteOrderFeed([rows[0]],true,true,true,true,true,true,true,false),old=cells(legacy);assert.equal(old.length,21);assert.equal(old[0],'08/11/2026');assert.match(old[1],/Open PDF/);assert.match(old[19],/orderAction=dispatch/);assert.match(old[20],/orderAction=schedule/);
});

test('Schedule delivery is in K and Status / notes is in T, with the previous K/T layout retained for old refreshes',()=>{
 const rows=buildSiteOrderRows([{id:'12345678-1234-4234-8234-123456789012',project:'Example',orderType:'Fixings',status:'submitted'}]);
 const cells=html=>[...html.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(m=>m[1]);
 assert.equal(SITE_ORDER_COLUMNS[10],'Schedule delivery');assert.equal(SITE_ORDER_COLUMNS[19],'Status / notes');assert.deepEqual(SITE_ORDER_COLUMNS.slice(0,3),['PDF','Action','Project']);
 const values=cells(buildSiteOrderFeed(rows));assert.equal(values.length,20);assert.match(values[10],/orderAction=schedule/);assert.equal(values[19],'Submitted');
 const sheet=siteOrdersSheet(rows,()=> '');assert.match(sheet,/<c r="K1"[^>]*><is><t xml:space="preserve">Schedule delivery<\/t>/);assert.match(sheet,/<c r="T1"[^>]*><is><t xml:space="preserve">Status \/ notes<\/t>/);
 assert.match(sheet,/<c r="K2"[^>]*><f>HYPERLINK\([^<]+&quot;Schedule delivery&quot;/);assert.match(sheet,/<c r="T2"[^>]*t="inlineStr"><is><t xml:space="preserve">Submitted<\/t>/);assert.match(sheet,/<col min="11" max="11" width="20"/);assert.match(sheet,/sqref="L2:S5000"/);
 const previous=cells(buildSiteOrderFeed(rows,true,true,true,true,true,true,true,true,false));assert.equal(previous.length,20);assert.equal(previous[10],'Submitted');assert.match(previous[19],/orderAction=schedule/);
});
