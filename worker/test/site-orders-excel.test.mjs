import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteOrderRows,buildSiteOrderFeed,SITE_ORDER_COLUMNS,siteOrderDate} from '../src/site-orders-excel.js';
const order={id:'o',project:'Project',orderNumber:'007',requestedBy:'Alex',dateOrdered:'2026-09-28T22:00:00Z',requestedDeliveryDate:'2026-10-05',locationNotes:'East',drawingProgress:{drawn:true},phone:'PRIVATE',attachments:['SECRET']};
const panel={id:'p',jobReference:'Project',orderNumber:'007',status:'completed'};
const qa={id:'p',kind:'panel',status:'approved'};
const row=(panels=[],records=[],loads=[],source=order)=>buildSiteOrderRows([source],panels,records,loads)[0];
test('empty production stays pending; scheduling automatically ticks Toolpathed',()=>{const empty=row();assert.equal(empty.Drawn,'✓');for(const key of ['Toolpathed','Routed / cut','QA','Sent to PC','Ready for dispatch'])assert.equal(empty[key],'-');const pending=row([{...panel,status:'pending'}]);assert.equal(pending.Toolpathed,'✓');assert.equal(pending['Routed / cut'],'-');assert.equal(pending.QA,'-');});
test('whole order routing and QA require every panel, and regress for new or reopened work',()=>{assert.equal(row([panel],[qa])['Ready for dispatch'],'✓');for(const panels of [[panel,{...panel,id:'p2',status:'pending'}],[panel,{...panel,id:'p2'}]])assert.equal(row(panels,[qa]).QA,'-');assert.equal(row([panel],[{...qa,status:'recut'}]).QA,'-');assert.equal(row([panel],[qa],[],{...order,status:'cancelled'})['Ready for dispatch'],'-');});
test('matches exact project and order; does not mix similarly numbered orders',()=>{for(const p of [{...panel,jobReference:'Other'},{...panel,orderNumber:'7'},{...panel,projectId:'other'}])assert.equal(row([p],[],[],{...order,projectId:'project'}).Toolpathed,'-');assert.equal(row([{...panel,jobReference:' project '}]).Toolpathed,'✓');});
test('powder coated orders require all loads to return and pass final QA',()=>{const load={project:'Project',orderNumber:'007',panelIds:['p'],status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}]};assert.equal(row([panel],[qa],[load])['Sent to PC'],'✓');assert.equal(row([panel],[qa],[load])['Ready for dispatch'],'-');const coated={...load,status:'ready_for_site',coatingCompleted:{by:'Alex'}};assert.equal(row([panel],[qa],[coated])['Ready for dispatch'],'-');assert.match(row([panel],[qa],[coated]).Notes,/final QA/);assert.equal(row([panel],[qa],[{...coated,finalQa:{by:'Sam'}}])['Ready for dispatch'],'✓');const panels=[panel,{...panel,id:'p2'}],records=[qa,{...qa,id:'p2'}];assert.equal(row(panels,records,[load])['Sent to PC'],'-');assert.equal(row(panels,records,[{...coated,finalQa:{by:'Sam'}},{...load,panelIds:['p2']}])['Ready for dispatch'],'-');});
test('recuts require an approved linked replacement and metalwork also blocks whole-order QA',()=>{const panels=[panel,{...panel,id:'new'}],records=[{...qa,status:'replaced',replacementId:'new'},{...qa,id:'new'}];assert.equal(row(panels,records).QA,'✓');assert.equal(row([panel],[{...qa,status:'replaced'}]).QA,'-');const metal={kind:'metalwork',id:'m',project:'Project',orderNumber:'007',status:'awaiting'};assert.equal(row([panel],[qa,metal]).QA,'-');assert.equal(row([],[{...metal,status:'approved'}]).QA,'✓');});
test('exports all orders, only approved shared fields, dates typed and identifiers preserved',()=>{const rows=buildSiteOrderRows(Array.from({length:65},(_,i)=>({...order,id:String(i)})));assert.equal(rows.length,65);assert.deepEqual(Object.keys(rows[0]),SITE_ORDER_COLUMNS);assert.equal(rows[0]['Order number'],'007');assert.equal(rows[0]['Date ordered'],siteOrderDate('2026-09-29'));assert.equal(rows[0]['Requested date'],siteOrderDate('2026-10-05'));assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|SECRET/);assert.equal(siteOrderDate('2026-02-31'),'');assert.equal(siteOrderDate('bad',true),'');});
test('feed is safe text, typed dates and a blank 15-cell row clears stale orders',()=>{const feed=buildSiteOrderFeed([{...row(),Project:'=1+1 <script>','Order number':'007'}]);assert.match(feed,/x:num="\d+"[^>]*dd\/mm\/yyyy/);assert.match(feed,/x:str[^>]*>007</);assert.match(feed,/=1\+1 &lt;script&gt;/);assert.doesNotMatch(feed,/<script>|<th[ >]/);assert.equal((buildSiteOrderFeed([]).match(/<td /g)||[]).length,15);});


test('Final QA follows Sent to PC, is N/A for other finishes, and gates milled order readiness',()=>{
 const stock=[{sku:'MILL',color:'Milled'},{sku:'WHITE',color:'White'}];
 const panels=[{...panel,stockSku:'MILL'},{...panel,id:'white',stockSku:'WHITE'}],records=[qa,{...qa,id:'white'}];
 const get=loads=>buildSiteOrderRows([order],panels,records,loads,stock)[0];
 assert.equal(SITE_ORDER_COLUMNS.indexOf('Final QA'),SITE_ORDER_COLUMNS.indexOf('Sent to PC')+1);
 assert.equal(get([])['Final QA'],'-');assert.equal(get([])['Ready for dispatch'],'-');
 const load={project:'Project',orderNumber:'007',panelIds:['p'],status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}]};
 assert.equal(get([load])['Sent to PC'],'✓');assert.equal(get([load])['Final QA'],'-');
 const complete={...load,coatingCompleted:{by:'Alex'},finalQa:{by:'QA'},status:'ready_for_site'};
 assert.equal(get([complete])['Final QA'],'✓');assert.equal(get([complete])['Ready for dispatch'],'✓');
 const more=buildSiteOrderRows([order],[...panels,{...panel,id:'new',stockSku:'MILL'}],[...records,{...qa,id:'new'}],[complete],stock)[0];
 assert.equal(more['Final QA'],'-');assert.equal(more['Ready for dispatch'],'-');
 assert.equal(buildSiteOrderRows([order],[panels[1]],[records[1]],[],stock)[0]['Final QA'],'N/A');
 assert.equal(buildSiteOrderRows([order],[],[],[],stock)[0]['Final QA'],'-');
});


