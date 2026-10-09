import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteOrderRows,buildSiteOrderFeed,siteOrdersSheet,SITE_ORDER_COLUMNS,siteOrderTextWidth} from '../src/site-orders-excel.js';
test('text widths account for narrow characters and preserve room for wide ones',()=>{
 assert.ok(siteOrderTextWidth('iiiiiiii')<siteOrderTextWidth('WWWWWWWW'));
 const note='***test test test test test test test test test test***';
 const sheet=siteOrdersSheet([{'Location / notes':note}],()=> '');
 const width=Number(sheet.match(/<col min="6" max="6" width="([^"]+)"/)[1]);
 assert.ok(width<note.length-5);assert.ok(width>=siteOrderTextWidth(note)+1);
});
test('PDF column follows ordered date and links to the correct authenticated order',()=>{
 const id='12345678-1234-1234-1234-123456789012';
 const rows=buildSiteOrderRows([{id,project:'Example',orderNumber:'7'}]);
 assert.deepEqual(SITE_ORDER_COLUMNS.slice(0,3),['Date ordered','PDF','Project']);
 assert.match(rows[0].PDF,new RegExp('orderPdf='+id));
 assert.match(buildSiteOrderFeed(rows),/<a href="https:\/\/web.panelstockhq.com\/\?page=orders&amp;orderPdf=[^"]+"[^>]*>Open PDF<\/a>/);
 const sheet=siteOrdersSheet(rows,()=> '');assert.match(sheet,/<c r="B2"[^>]*><f>HYPERLINK/);assert.match(sheet,/A1:O2/);assert.match(sheet,/sqref="H2:N5000"/);
 assert.equal(buildSiteOrderRows([{id:'bad'}])[0].PDF,'');
});

