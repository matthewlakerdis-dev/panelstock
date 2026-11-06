import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteOrderRows,buildSiteOrderFeed,SITE_ORDER_COLUMNS,SITE_ORDER_ROW_COLUMNS,siteOrderDate} from '../src/site-orders-excel.js';
const order={id:'o',project:'Project',orderNumber:'007',requestedBy:'Alex',dateOrdered:'2026-09-28T22:00:00Z',requestedDeliveryDate:'2026-10-05',location:'East',drawingProgress:{drawn:true},phone:'PRIVATE',attachments:['SECRET']};
const panel={id:'p',jobReference:'Project',orderNumber:'007',status:'completed'};
const qa={id:'p',kind:'panel',status:'approved'};
const row=(panels=[],records=[],loads=[],source=order)=>buildSiteOrderRows([source],panels,records,loads)[0];
test('empty production stays pending; scheduling automatically ticks Toolpathed',()=>{const empty=row();assert.equal(empty.Drawn,'✓');for(const key of ['Toolpathed','Routed / cut','QA','Sent to PC','Ready for dispatch'])assert.equal(empty[key],'-');const pending=row([{...panel,status:'pending'}]);assert.equal(pending.Toolpathed,'✓');assert.equal(pending['Routed / cut'],'-');assert.equal(pending.QA,'-');});
test('whole order routing and QA require every panel, and regress for new or reopened work',()=>{assert.equal(row([panel],[qa])['Ready for dispatch'],'✓');for(const panels of [[panel,{...panel,id:'p2',status:'pending'}],[panel,{...panel,id:'p2'}]])assert.equal(row(panels,[qa]).QA,'-');assert.equal(row([panel],[{...qa,status:'recut'}]).QA,'-');assert.equal(row([panel],[qa],[],{...order,status:'cancelled'})['Ready for dispatch'],'-');});
test('matches exact project and order; does not mix similarly numbered orders',()=>{for(const p of [{...panel,jobReference:'Other'},{...panel,orderNumber:'7'},{...panel,projectId:'other'}])assert.equal(row([p],[],[],{...order,projectId:'project'}).Toolpathed,'-');assert.equal(row([{...panel,jobReference:' project '}]).Toolpathed,'✓');});
test('powder coated orders require all loads to return and pass final QA',()=>{const load={project:'Project',orderNumber:'007',panelIds:['p'],status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}]};assert.equal(row([panel],[qa],[load])['Sent to PC'],'✓');assert.equal(row([panel],[qa],[load])['Ready for dispatch'],'-');const coated={...load,status:'ready_for_site',coatingCompleted:{by:'Alex'}};assert.equal(row([panel],[qa],[coated])['Ready for dispatch'],'-');assert.match(row([panel],[qa],[coated]).Notes,/final QA/);assert.equal(row([panel],[qa],[{...coated,finalQa:{by:'Sam'}}])['Ready for dispatch'],'✓');const panels=[panel,{...panel,id:'p2',stockColor:'Milled'}],records=[qa,{...qa,id:'p2'}];assert.equal(row(panels,records,[load])['Sent to PC'],'-');assert.equal(row(panels,records,[{...coated,finalQa:{by:'Sam'}},{...load,panelIds:['p2']}])['Ready for dispatch'],'-');});
test('recuts require an approved linked replacement and metalwork also blocks whole-order QA',()=>{const panels=[panel,{...panel,id:'new'}],records=[{...qa,status:'replaced',replacementId:'new'},{...qa,id:'new'}];assert.equal(row(panels,records).QA,'✓');assert.equal(row([panel],[{...qa,status:'replaced'}]).QA,'-');const metal={kind:'metalwork',id:'m',project:'Project',orderNumber:'007',status:'awaiting'};assert.equal(row([panel],[qa,metal]).QA,'-');assert.equal(row([],[{...metal,status:'approved'}]).QA,'✓');});
test('exports all orders, only approved shared fields, dates typed and identifiers preserved',()=>{const rows=buildSiteOrderRows(Array.from({length:65},(_,i)=>({...order,id:String(i)})));assert.equal(rows.length,65);assert.deepEqual(Object.keys(rows[0]),SITE_ORDER_ROW_COLUMNS);assert.equal(rows[0]['Order number'],'007');assert.equal(rows[0]['Date ordered'],siteOrderDate('2026-09-29'));assert.equal(rows[0]['Requested date'],siteOrderDate('2026-10-05'));assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|SECRET/);assert.equal(siteOrderDate('2026-02-31'),'');assert.equal(siteOrderDate('bad',true),'');});
test('feed is safe text, typed dates and a blank 21-cell row clears stale orders',()=>{const feed=buildSiteOrderFeed([{...row(),Project:'=1+1 <script>','Order number':'007'}]);assert.match(feed,/x:num="\d+"[^>]*dd\/mm\/yyyy/);assert.match(feed,/x:str[^>]*>007</);assert.match(feed,/=1\+1 &lt;script&gt;/);assert.doesNotMatch(feed,/<script>|<th[ >]/);assert.equal((buildSiteOrderFeed([]).match(/<td /g)||[]).length,21);});


test('Final QA follows Sent to PC, is n/a for other finishes, and gates milled order readiness',()=>{
 const stock=[{sku:'MILL',color:'Milled'},{sku:'WHITE',color:'White'}];
 const panels=[{...panel,stockSku:'MILL'},{...panel,id:'white',stockSku:'WHITE'}],records=[qa,{...qa,id:'white'}];
 const get=loads=>buildSiteOrderRows([order],panels,records,loads,stock)[0];
 assert.equal(SITE_ORDER_COLUMNS.indexOf('Final QA'),SITE_ORDER_COLUMNS.indexOf('Sent to PC')+1);
 assert.equal(get([])['Sent to PC'],'-');assert.equal(get([])['Final QA'],'-');assert.equal(get([])['Ready for dispatch'],'-');
 const load={project:'Project',orderNumber:'007',panelIds:['p'],status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}]};
 assert.equal(get([load])['Sent to PC'],'✓');assert.equal(get([load])['Final QA'],'-');
 const complete={...load,coatingCompleted:{by:'Alex'},finalQa:{by:'QA'},status:'ready_for_site'};
 assert.equal(get([complete])['Final QA'],'✓');assert.equal(get([complete])['Ready for dispatch'],'✓');
 const more=buildSiteOrderRows([order],[...panels,{...panel,id:'new',stockSku:'MILL'}],[...records,{...qa,id:'new'}],[complete],stock)[0];
 assert.equal(more['Sent to PC'],'-');assert.equal(more['Final QA'],'-');assert.equal(more['Ready for dispatch'],'-');
 assert.equal(buildSiteOrderRows([order],[panels[1]],[records[1]],[],stock)[0]['Final QA'],'n/a');
 assert.equal(buildSiteOrderRows([order],[],[],[],stock)[0]['Final QA'],'-');
});



test('non-panel order stages are n/a without automatically marking dispatch ready',()=>{
 const stages=['Drawn','Toolpathed','Routed / cut','QA','Sent to PC','Final QA'];
 for(const orderType of ['Fixings','Plant / Equipment','Other','Custom type']){
  const result=row([],[],[],{...order,orderType});
  for(const key of stages)assert.equal(result[key],'n/a');
  assert.equal(result['Ready for dispatch'],'-');
  assert.match(buildSiteOrderFeed([result]),/>n\/a</);
 }
 assert.equal(row([],[],[],{...order,orderType:'Panels'}).Toolpathed,'-');
 assert.equal(row([panel],[qa],[],{...order,orderType:'Other'}).Toolpathed,'✓');
});

test('completed non-panel orders are dispatch ready, in-stock orders stay pending',()=>{
 for(const orderType of ['Fixings','Plant / Equipment','Other','Custom type']){
  for(const status of ['submitted','ordered','in_stock','cancelled'])assert.equal(row([],[],[],{...order,orderType,status})['Ready for dispatch'],'-');
  const complete=row([],[],[],{...order,orderType,status:'completed'});
  assert.equal(complete['Ready for dispatch'],'✓');assert.equal(complete.QA,'n/a');assert.equal(complete.Drawn,'n/a');
 }
 assert.equal(row([],[],[],{...order,orderType:'Panels',status:'completed'})['Ready for dispatch'],'-');
 assert.equal(row([panel],[{...qa,status:'awaiting'}],[],{...order,orderType:'Other',status:'completed'})['Ready for dispatch'],'-');
});

test('status precedes Drawn and uses the same labels as Site Orders',()=>{
 assert.equal(SITE_ORDER_COLUMNS.indexOf('Status / notes'),SITE_ORDER_COLUMNS.indexOf('Drawn')-1);
 for(const [status,label] of Object.entries({submitted:'Submitted',approved:'Approved',ordered:'Ordered',in_stock:'In stock',completed:'Ready for dispatch',cancelled:'Cancelled'})){
  const result=row([],[],[],{...order,status});assert.equal(result.Status,label);
  const cells=[...buildSiteOrderFeed([result]).matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);
  assert.equal(cells[10],label);assert.equal(cells.length,21);
 }
});


test('scheduled date follows requested date and exports only the confirmed schedule as an Excel date',()=>{
 assert.equal(SITE_ORDER_COLUMNS.indexOf('Scheduled date'),SITE_ORDER_COLUMNS.indexOf('Requested date')+1);
 for(const value of [undefined,'','bad','2026-02-31'])assert.equal(row([],[],[],{...order,scheduledDeliveryDate:value})['Scheduled date'],'');
 const result=row([],[],[],{...order,scheduledDeliveryDate:'2026-10-08'});
 assert.equal(result['Requested date'],siteOrderDate('2026-10-05'));
 assert.equal(result['Scheduled date'],siteOrderDate('2026-10-08'));
 const cells=[...buildSiteOrderFeed([result]).matchAll(/<td [^>]*>.*?<\/td>/g)].map(match=>match[0]);
 assert.match(cells[9],new RegExp('x:num="'+result['Scheduled date']+'"'));
 assert.match(cells[9],/mso-number-format:"dd\/mm\/yyyy"/);
 assert.match(cells[9],/>08\/10\/2026<\/td>/);
});


test('order type follows order number and preserves standard, custom and Other labels as safe text',()=>{
 assert.equal(SITE_ORDER_COLUMNS.indexOf('Order type'),SITE_ORDER_COLUMNS.indexOf('Order number')+1);
 for(const [source,label] of [[{orderType:'Panels'},'Panels'],[{orderType:'Fixings'},'Fixings'],[{orderType:'Plant / Equipment'},'Plant / Equipment'],[{orderType:'Gates'},'Gates'],[{orderType:'Custom type'},'Custom type'],[{orderType:'Other',orderTypeOther:'Custom screens'},'Other: Custom screens'],[{orderType:'Other'},'Other'],[{},'']]){
  const result=row([],[],[],{...order,...source});
  assert.equal(result['Order type'],label);
  assert.deepEqual(Object.keys(result),SITE_ORDER_ROW_COLUMNS);
  const cells=[...buildSiteOrderFeed([result]).matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);
  assert.equal(cells[4],label);
 }
 const result=row([],[],[],{...order,orderType:'Other',orderTypeOther:'=SUM(A1) <script> & note'});
 assert.match(buildSiteOrderFeed([result]),/x:str[^>]*>Other: =SUM\(A1\) &lt;script&gt; &amp; note<\/td>/);
});

test('legacy refresh keeps the previous columns and correct typed dates',()=>{
 const result=row([],[],[],{...order,orderType:'Fixings',scheduledDeliveryDate:'2026-10-08'});
 const cells=[...buildSiteOrderFeed([result],false).matchAll(/<td [^>]*>.*?<\/td>/g)].map(match=>match[0]);
 assert.equal(cells.length,17);
 assert.match(cells[4],/>Alex<\/td>/);
 assert.match(cells[6],/x:num="\d+"[^>]*dd\/mm\/yyyy[^>]*>05\/10\/2026<\/td>/);
 assert.match(cells[7],/x:num="\d+"[^>]*dd\/mm\/yyyy[^>]*>08\/10\/2026<\/td>/);
 assert.equal((buildSiteOrderFeed([],false).match(/<td /g)||[]).length,17);
});


test('non-milled panels show n/a for both coating steps without skipping production QA',()=>{
 const stock=[{sku:'WHITE',color:'White'}],white={...panel,stockSku:'WHITE'};
 const get=(panels,records,loads=[])=>buildSiteOrderRows([order],panels,records,loads,stock)[0];
 const complete=get([white],[qa]);
 assert.equal(complete['Sent to PC'],'n/a');assert.equal(complete['Final QA'],'n/a');assert.equal(complete['Ready for dispatch'],'✓');
 for(const [panels,records] of [[[white],[]],[[{...white,status:'pending'}],[qa]]]){
  const pending=get(panels,records);
  assert.equal(pending['Sent to PC'],'n/a');assert.equal(pending['Final QA'],'n/a');assert.equal(pending['Ready for dispatch'],'-');
 }
 const unrelated={project:'Another project',orderNumber:'007',panelIds:['p'],status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}]};
 assert.deepEqual(get([white],[qa],[unrelated]),complete);
 for(const includeType of [true,false]){
  const columns=includeType?SITE_ORDER_COLUMNS:SITE_ORDER_COLUMNS.filter(key=>key!=='Order type');
  const cells=[...buildSiteOrderFeed([complete],includeType).matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);
  for(const key of ['Sent to PC','Final QA'])assert.equal(cells[includeType?columns.indexOf(key):key==='Sent to PC'?13:14],'n/a');
 }
});

test('non-milled panels actually sent for coating keep both steps active until post-coating QA passes',()=>{
 const white={...panel,stockColor:'White'},load={project:'Project',orderNumber:'007',panelIds:['p'],status:'at_powder_coaters',legs:[{destinationType:'powder_coaters'}]};
 const get=value=>row([white],[qa],[value]);
 const sent=get(load);
 assert.equal(sent['Sent to PC'],'✓');assert.equal(sent['Final QA'],'-');assert.equal(sent['Ready for dispatch'],'-');
 const coated={...load,status:'awaiting_final_qa',coatingCompleted:{by:'Alex'}};
 assert.equal(get(coated)['Final QA'],'-');assert.equal(get(coated)['Ready for dispatch'],'-');
 const complete=get({...coated,status:'ready_for_site',finalQa:{by:'Sam'}});
 assert.equal(complete['Sent to PC'],'✓');assert.equal(complete['Final QA'],'✓');assert.equal(complete['Ready for dispatch'],'✓');
 const other={...white,id:'white-2'};
 assert.equal(row([white,other],[qa,{...qa,id:'white-2'}],[load])['Sent to PC'],'✓');
});


test('Excel actions mark eligible orders ready and dispatch ready orders without bypassing production',()=>{
 const id='12345678-1234-4234-8234-123456789012',source={...order,id,orderType:'Fixings',status:'submitted'};
 const pending=buildSiteOrderRows([source])[0];
 assert.match(pending.Action,/page=orders&orderAction=ready&orderId=12345678/);
 const ready=buildSiteOrderRows([{...source,status:'completed'}])[0];
 assert.match(ready.Action,/page=dispatch&orderAction=dispatch&orderId=12345678/);
 for(const status of ['cancelled','dispatched'])assert.equal(buildSiteOrderRows([{...source,status}])[0].Action,'');
 assert.equal(buildSiteOrderRows([{...source,orderType:'Panels'}])[0].Action,'');
 assert.match(buildSiteOrderRows([{...source,orderType:'Gate'}])[0].Action,/orderAction=drawn/);
 assert.equal(buildSiteOrderRows([{...source,id:'bad'}])[0].Action,'');
 const panels=buildSiteOrderRows([{...source,orderType:'Panels'}],[panel],[qa])[0];
 assert.equal(panels['Ready for dispatch'],'✓');assert.match(panels.Action,/orderAction=dispatch/);
 const html=buildSiteOrderFeed([pending,ready]);
 assert.match(html,/<a href="https:\/\/web.panelstockhq.com\/\?page=orders&amp;orderAction=ready&amp;orderId=[^"]+"[^>]*>Mark ready<\/a>/);
 assert.match(html,/>Dispatch<\/a>/);
 assert.doesNotMatch(buildSiteOrderFeed([pending],true,false),/Mark ready|orderAction=/);
 assert.doesNotMatch(buildSiteOrderFeed([{...pending,Action:'https://example.test/?orderAction=ready&orderId='+id}]),/href="https:\/\/example.test/);
});


test('active orders expose a delivery scheduling link without changing their numeric scheduled date',()=>{
 const source={...order,id:'12345678-1234-4234-8234-123456789012',orderType:'Panels',status:'submitted',scheduledDeliveryDate:'2026-11-09'};
 const result=buildSiteOrderRows([source])[0];assert.match(result['Schedule delivery'],/page=orders&orderAction=schedule&orderId=12345678/);
 assert.equal(result['Scheduled date'],siteOrderDate('2026-11-09'));assert.equal(result.Action,'');
 const feed=buildSiteOrderFeed([result]);assert.match(feed,/>Schedule delivery<\/a>/);assert.match(feed,new RegExp('x:num="'+result['Scheduled date']+'"'));
 for(const status of ['cancelled','dispatched'])assert.equal(buildSiteOrderRows([{...source,status}])[0]['Schedule delivery'],'');
 assert.equal(buildSiteOrderRows([{...source,id:'bad'}])[0]['Schedule delivery'],'');
 for(const args of [[false],[true,false],[true,true,false]])assert.doesNotMatch(buildSiteOrderFeed([result],...args),/orderAction=schedule/);
});

test('dispatch notes replace tracker defaults, with latest nonblank notes per load',()=>{
 const load={project:'Project',orderNumber:'007',status:'dispatched_to_site',legs:[{destinationType:'powder_coaters',notes:'Earlier note'},{destinationType:'site',notes:'Use rear loading bay'}]};
 assert.equal(row([],[],[load]).Notes,'Use rear loading bay');
 assert.equal(row([],[],[{...load,legs:[{notes:'   '}]}]).Notes,'Dispatched to site');
 assert.equal(row([],[],[{...load,project:'Other'}]).Notes,'');
 assert.equal(row([],[],[load,{...load,legs:[{notes:'Call on arrival'}]}]).Notes,'Use rear loading bay; Call on arrival');
});
