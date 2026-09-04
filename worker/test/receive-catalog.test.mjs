import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');

test('catalog creation returns one material definition without creating a sized stock row',()=>{
 const start=html.indexOf('    function addCatalogItem('),end=html.indexOf('    function addCatalogItemsBulk(',start);
 const writes=[];let id=0;
 const item=vm.runInNewContext(html.slice(start,end)+';addCatalogItem({color:"Silver",material:"ACP",thickness:4,width:1200,height:2400});',{
  uid:()=>String(++id),genSku:()=> 'TEST-NEW',catalog:[],catalogKey:item=>`${item.color}|${item.material}|${item.thickness}`,setCatalog(){},persist:v=>writes.push(v),logTxn(){},showToast(){}
 });
 assert.equal(writes.length,1);assert.equal(item.id,writes[0].catalog[0].id);assert.equal(writes[0].variants,undefined);assert.equal(item.width,0);assert.equal(item.height,0);
});

test('mobile receive screen only accepts approved catalogue selections',()=>{
 const start=html.indexOf('  function ReceiveTab('),end=html.indexOf('  function DispatchTab(',start);
 const receiveTab=html.slice(start,end);
 assert.match(receiveTab,/function ReceiveTab\(\{ catalog, variants, onSubmit \}\)/);
 assert.match(receiveTab,/onSubmit\(\{ catalogId: selected\.id/);
});
