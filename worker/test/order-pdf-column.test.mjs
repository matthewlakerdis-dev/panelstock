import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteOrderRows,buildSiteOrderFeed,siteOrdersSheet,SITE_ORDER_COLUMNS,siteOrderTextWidth} from '../src/site-orders-excel.js';
test('text widths account for narrow characters and preserve room for wide ones',()=>{
 assert.ok(siteOrderTextWidth('iiiiiiii')<siteOrderTextWidth('WWWWWWWW'));
 const note='***test test test test test test test test test test***';
 const sheet=siteOrdersSheet([{Location:note}],()=> '');
 const width=Number(sheet.match(/<col min="8" max="8" width="([^"]+)"/)[1]);
 assert.ok(width<note.length-5);assert.ok(width>=siteOrderTextWidth(note)+1);
});
test('PDF is first with Action immediately after it and links to the correct authenticated order',()=>{
 const id='12345678-1234-1234-1234-123456789012';
 const rows=buildSiteOrderRows([{id,project:'Example',orderNumber:'7'}]);
 assert.deepEqual(SITE_ORDER_COLUMNS.slice(0,3),['PDF','Action','Date ordered']);
 assert.match(rows[0].PDF,new RegExp('orderPdf='+id));
 assert.match(buildSiteOrderFeed(rows),/<a href="https:\/\/web.panelstockhq.com\/\?page=orders&amp;orderPdf=[^"]+"[^>]*>Open PDF<\/a>/);
 const sheet=siteOrdersSheet(rows,()=> '');assert.match(sheet,/<c r="A2"[^>]*><f>HYPERLINK/);assert.match(sheet,/A1:U2/);assert.match(sheet,/sqref="M2:T5000"/);
 assert.equal(buildSiteOrderRows([{id:'bad'}])[0].PDF,'');
});


test('Date ordered follows Action and Status / notes follows Ready for dispatch in new downloads',()=>{
 const newest='12345678-1234-4234-8234-123456789012',older='22222222-2222-4222-8222-222222222222';
 const rows=buildSiteOrderRows([{id:older,project:'Earlier project',orderNumber:'001',orderType:'Fixings',status:'submitted',dateOrdered:'2026-11-01T00:00:00Z'},{id:newest,project:'Recent project',orderNumber:'002',orderType:'Fixings',status:'completed',dateOrdered:'2026-11-08T00:00:00Z'}]);
 const cells=html=>[...html.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(m=>m[1]),values=cells(buildSiteOrderFeed([rows[0]]));
 assert.deepEqual(SITE_ORDER_COLUMNS,['PDF','Action','Date ordered','Project','Order number','Order type','Who ordered it','Location','Order notes','Requested date','Scheduled date','Schedule delivery','Drawn','Toolpathed','Routed / cut','Scheduled for production','QA','Sent to PC','Final QA','Ready for dispatch','Status / notes']);
 assert.equal(values.length,21);assert.match(values[0],new RegExp('orderPdf='+newest));assert.match(values[1],/orderAction=dispatch/);assert.equal(values[2],'08/11/2026');assert.equal(values[3],'Recent project');assert.match(values[11],/orderAction=schedule/);assert.equal(values[20],'Ready for dispatch');
 const sheet=siteOrdersSheet(rows,()=> '');
 assert.match(sheet,/<c r="C2" s="6" t="n"><v>\d+<\/v>/);assert.match(sheet,/<c r="L2"[^>]*><f>HYPERLINK\([^<]+&quot;Schedule delivery&quot;/);assert.match(sheet,/<c r="U2"[^>]*t="inlineStr"><is><t xml:space="preserve">Ready for dispatch<\/t>/);
 assert.match(sheet,/<col min="1" max="1" width="12"/);assert.match(sheet,/<col min="2" max="2" width="20"/);assert.match(sheet,/<col min="3" max="3" width="15"[^>]*style="6"/);assert.match(sheet,/<col min="12" max="12" width="20"/);assert.match(sheet,/sqref="M2:T5000"/);assert.match(sheet,/sqref="E2:E5000" numberStoredAsText/);
 const v10=cells(buildSiteOrderFeed([rows[0]],true,true,true,true,true,true,true,true,true,false));assert.equal(v10.length,20);assert.match(v10[10],/orderAction=schedule/);assert.equal(v10[19],'Ready for dispatch');assert.equal(v10[2],'Recent project');
 const v9=cells(buildSiteOrderFeed([rows[0]],true,true,true,true,true,true,true,true,false));assert.equal(v9.length,20);assert.equal(v9[10],'Ready for dispatch');assert.match(v9[19],/orderAction=schedule/);
 const v8=cells(buildSiteOrderFeed([rows[0]],true,true,true,true,true,true,true,false));assert.equal(v8.length,21);assert.equal(v8[0],'08/11/2026');assert.match(v8[1],/Open PDF/);
});
