import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {PDFDocument} from 'pdf-lib';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {trackerPdfRows,validTrackerPdfLink} from '../src/tracker-order-pdf.js';
import {buildSiteOrderRows} from '../src/site-orders-excel.js';
const id='12345678-1234-4234-8234-123456789012',otherId='22222222-2222-4222-8222-222222222222',secret='synthetic-tracker-credential';
const order={id,project:'Direct PDF example',orderNumber:'007',orderType:'Fixings',status:'submitted',siteContact:'Example contact',phone:'0400000000',requestedDeliveryDate:'2026-11-11',items:[{quantity:2,description:'Fixing pack'}]};
const decode=value=>value.replace(/&amp;/g,'&');
function unzip(bytes){const b=Buffer.from(bytes),parts={};let p=0;while(b.readUInt32LE(p)===0x04034b50){const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),extra=b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;parts[name]=inflateRawSync(b.subarray(start,start+size)).toString();p=start+size;}return parts;}
test('tracker PDF capabilities are order/site scoped, reusable and revoked by tracker credential rotation',async()=>{
 const rows=buildSiteOrderRows([order]),before=structuredClone(rows),signed=await trackerPdfRows(rows,'https://example.test',secret,'site-a'),url=new URL(signed[0].PDF),token=url.searchParams.get('tracker');
 assert.equal(url.pathname,'/orders/'+id+'/pdf');assert.match(token,/^[a-f0-9]{64}$/);assert.ok(!url.href.includes(secret));assert.deepEqual(rows,before);
 assert.equal(await validTrackerPdfLink(secret,'site-a',id,token),true);assert.equal(await validTrackerPdfLink(secret,'site-a',id,token),true);
 for(const [key,site,orderId,value] of [[secret,'site-a',otherId,token],[secret,'site-b',id,token],['rotated-secret','site-a',id,token],['','site-a',id,token],[secret,'site-a',id,'0'.repeat(64)],[secret,'site-a',id,secret],[secret,'site-a',id,null]])assert.equal(await validTrackerPdfLink(key,site,orderId,value),false);
 assert.equal((await trackerPdfRows(rows,'https://example.test','','site-a'))[0].PDF,'');assert.equal((await trackerPdfRows([{PDF:'bad'}],'https://example.test',secret,'site-a'))[0].PDF,'');
});
test('tracker downloads and every refresh version open only the linked PDF without a session, including attachments',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'tracker-pdf-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:'tracker-pdf-test',CNC_PUBLIC_TOKEN:secret,MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:createHash('sha256').update('123456:admin:panelstock').digest('hex')}}));
  const api=async(path,body,token)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;};
  const admin=(await api('/login',{username:'admin',pin:'123456'})).token;assert.ok(admin);
  const id=(await api('/orders',{idempotencyKey:crypto.randomUUID(),order},admin)).order.id,otherId=(await api('/orders',{idempotencyKey:crypto.randomUUID(),order:{...order,project:'Other order'}},admin)).order.id;
  const attached=await PDFDocument.create();attached.addPage([333,222]).drawText('ORDER ATTACHMENT');const bytes=await attached.save();
  await api('/orders/'+id+'/attachments',{id:crypto.randomUUID(),name:'Drawing.pdf',data:Buffer.from(bytes).toString('base64')},admin);
  let direct;
  for(let version=1;version<=11;version++){
   const response=await mf.dispatchFetch('http://localhost/cnc-tracker/excel-data?token='+secret+'&report=site-orders&siteOrdersVersion='+version);assert.equal(response.status,200);const html=await response.text(),match=html.match(new RegExp('href="([^"]*/orders/'+id+'/pdf\\?tracker=[a-f0-9]{64})"'));assert.ok(match,'direct PDF link for version '+version);const link=decode(match[1]);assert.ok(!link.includes(secret));if(direct)assert.equal(link,direct);direct=link;
   if(version>=3)assert.match(html,/https:\/\/web.panelstockhq.com\/\?page=orders&amp;orderAction=ready/);
  }
  const download=await mf.dispatchFetch('http://localhost/cnc-tracker?token='+secret);assert.equal(download.status,200);const parts=unzip(await download.arrayBuffer());assert.ok(decode(parts['xl/worksheets/sheet5.xml']).includes(direct));
  for(let n=0;n<2;n++){
   const response=await mf.dispatchFetch(direct);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.match(response.headers.get('Content-Disposition'),/^inline;/);assert.equal(response.headers.get('Location'),null);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.match(response.headers.get('X-Robots-Tag'),/noindex/);const pdf=await PDFDocument.load(await response.arrayBuffer());assert.equal(pdf.getPageCount(),2);assert.equal(pdf.getPage(1).getWidth(),333);
  }
  const token=new URL(direct).searchParams.get('tracker');
  for(const path of ['/orders/'+id+'/pdf?tracker=bad','/orders/'+otherId+'/pdf?tracker='+token,'/orders/'+id+'/pdf?tracker='+secret])assert.equal((await mf.dispatchFetch('http://localhost'+path)).status,404);
  for(const path of ['/orders/'+id+'/pdf','/orders/'+id+'?tracker='+token,'/orders/'+id+'/xlsx?tracker='+token,'/orders?tracker='+token])assert.equal((await mf.dispatchFetch('http://localhost'+path)).status,401);
  assert.equal((await mf.dispatchFetch('http://localhost/orders/'+id+'/status?tracker='+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'completed'})})).status,401);
  assert.equal((await mf.dispatchFetch('http://localhost/orders/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+admin}})).status,200);assert.equal((await mf.dispatchFetch(direct)).status,404);
 }finally{await mf.dispose();}
});
