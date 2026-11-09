import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {buildSiteOrderRows,buildSiteOrderFeed,SITE_ORDER_COLUMNS,SITE_ORDER_ROW_COLUMNS} from '../src/site-orders-excel.js';
import {buildXlsxBytes} from '../src/reports.js';
import {CNC_COLUMNS} from '../src/cnc-excel.js';
const id='12345678-1234-4234-8234-123456789012';
const base={id,project:'Drawn link test',orderNumber:'057',orderType:'Panels',status:'approved',updatedAt:'v1'};
const row=patch=>buildSiteOrderRows([{...base,...patch}])[0];
const cells=html=>[...html.matchAll(/<td [^>]*>(.*?)<\/td>/g)].map(match=>match[1]);
function unzip(bytes){
 const buffer=Buffer.from(bytes),files={};let offset=0;
 while(buffer.readUInt32LE(offset)===0x04034b50){const size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28),name=buffer.subarray(offset+30,offset+30+nameLength).toString(),start=offset+30+nameLength+extra;files[name]=inflateRawSync(buffer.subarray(start,start+size)).toString();offset=start+size;}
 return files;
}
test('pending panels and gates use Mark drawn in Action with the existing workbook and feed column layouts',async()=>{
 for(const orderType of ['Panels','Gate',' panels ',' gate ']){
  const result=row({orderType});assert.match(result.Action,/page=orders&orderAction=drawn&orderId=/);
  const feed=buildSiteOrderFeed([result]);assert.equal(cells(feed).length,21);assert.match(cells(feed)[1],/>Mark drawn<\/a>/);assert.match(cells(feed)[11],/>Schedule delivery<\/a>/);
  assert.equal(cells(buildSiteOrderFeed([result],true,true,false)).length,19);
  for(const args of [[false],[true,false]])assert.doesNotMatch(buildSiteOrderFeed([result],...args),/orderAction=drawn/);
 }
 assert.deepEqual(Object.keys(row()),SITE_ORDER_ROW_COLUMNS);
 for(const orderType of ['Fixings','Other','Gate hardware'])assert.doesNotMatch(row({orderType}).Action,/orderAction=drawn/);
 for(const status of ['cancelled','dispatched'])assert.equal(row({status}).Action,'');
 assert.equal(row({id:'bad'}).Action,'');
 for(const patch of [{manualDrawing:{drawn:true}},{drawingProgress:{drawn:true}},{orderType:'Gate',manualProduction:{stages:{drawn:'complete'}}}])assert.equal(row(patch).Action,'');
 assert.match(row({manualDrawing:{drawn:false},drawingProgress:{drawn:true}}).Action,/orderAction=drawn/);
 const panel={id:'p',jobReference:base.project,orderNumber:base.orderNumber,status:'completed'},qa={id:'p',kind:'panel',status:'approved'};
 const ready=buildSiteOrderRows([{...base,manualDrawing:{drawn:true}}],[panel],[qa])[0];assert.match(ready.Action,/orderAction=dispatch/);
 const gateReady=row({orderType:'Gate',status:'completed',manualProduction:{stages:{drawn:'complete',fabricatedQa:'complete',readyForDispatch:'complete'}}});assert.match(gateReady.Action,/orderAction=dispatch/);
 const forged={...row(),Action:'https://example.test/?orderAction=drawn&orderId='+id};assert.doesNotMatch(buildSiteOrderFeed([forged]),/example.test/);
 const parts=unzip(await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/feed',undefined,[row()])),sheet=parts['xl/worksheets/sheet5.xml'];
 assert.match(sheet,/<c r="B2"[^>]*><f>HYPERLINK\(&quot;https:\/\/web.panelstockhq.com\/\?page=orders&amp;orderAction=drawn&amp;orderId=[^&]+&quot;,&quot;Mark drawn&quot;\)<\/f>/);
 assert.match(sheet,/dimension ref="A1:U2"/);assert.match(parts['xl/connections.xml'],/siteOrdersVersion=11/);
});
test('Excel drawn actions use authenticated APIs, preserve production safeguards and update refreshed rows',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'excel-drawn-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'excel-drawn-test',CNC_PUBLIC_TOKEN:'synthetic-drawn-feed',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const req=async(route,body,token)=>{const response=await mf.dispatchFetch('http://localhost'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),hash=(pin,user)=>createHash('sha256').update(`${pin}:${user}:panelstock`).digest('hex');
  await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456','admin')},staff:{isAdmin:false,pinHash:hash('654321','staff')}}));
  const admin=(await req('/login',{username:'admin',pin:'123456'})).body.token,staff=(await req('/login',{username:'staff',pin:'654321'})).body.token;assert.ok(admin&&staff);
  assert.equal((await req('/order-types',{name:'Gate'},admin)).status,200);
  const feed=async()=>{const r=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token=synthetic-drawn-feed&report=site-orders&siteOrdersVersion=4');assert.equal(r.status,200);return r.text();};
  const qaItems=async order=>(await req('/qa',undefined,admin)).body.items.filter(item=>item.gateOrderId===order.id);
  for(const orderType of ['Panels','Gate']){
   const created=await req('/orders',{idempotencyKey:crypto.randomUUID(),order:{project:'Excel drawn '+orderType,siteContact:'Synthetic contact',phone:'123',orderType,...(orderType==='Gate'?{villa:'Villa 12'}:{location:'North elevation'}),requestedDeliveryDate:'2026-11-12',items:[{quantity:1,description:'Item one'},{quantity:1,description:'Item two'}]}},admin);assert.equal(created.status,201,JSON.stringify(created));let order=created.body.order;
   const link='orderAction=drawn&amp;orderId='+order.id;assert.ok((await feed()).includes(link));
   const path='/orders/'+order.id+(orderType==='Gate'?'/progress':'/drawing'),body={...(orderType==='Gate'?{stages:{drawn:'complete'},areaM2:12.5}:{drawn:true}),expectedUpdatedAt:order.updatedAt};
   assert.equal((await req(path,body,staff)).status,403);assert.equal((await req(path,{...body,expectedUpdatedAt:'stale'},admin)).status,409);
   const saved=await req(path,body,admin);assert.equal(saved.status,200,JSON.stringify(saved));order=saved.body.order;
   assert.equal(order.status,'submitted');assert.equal(order.requestedDeliveryDate,'2026-11-12');assert.deepEqual(order.items,created.body.order.items);
   assert.ok(orderType==='Gate'?order.manualProduction.stages.drawn==='complete':order.manualDrawing.drawn===true);
   assert.ok(!(await feed()).includes(link));
   const unchanged=await req(path,{...body,expectedUpdatedAt:order.updatedAt},admin);assert.equal(unchanged.body.unchanged,true);
   const items=await qaItems(order);assert.equal(items.length,orderType==='Gate'?2:0);
   if(orderType==='Gate'){
    assert.ok(items.every(item=>item.status==='awaiting'&&item.drawnBy==='admin'));
    assert.equal(order.manualProduction.stages.fabricatedQa,'pending');assert.equal(order.manualProduction.stages.readyForDispatch,'pending');
    assert.equal((await req('/orders/'+order.id+'/status',{status:'completed',expectedUpdatedAt:order.updatedAt},admin)).status,409);
    assert.deepEqual((await qaItems(order)).map(item=>item.id).sort(),items.map(item=>item.id).sort());
   }
  }
 }finally{await mf.dispose();}
});
