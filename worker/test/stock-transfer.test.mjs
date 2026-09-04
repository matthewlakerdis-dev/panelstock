import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';

test('staff atomically convert one large sheet into matching smaller sheet sizes',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'stock-transfer',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'transfer-test',MIGRATION_READY:'true'}}]}));
  try {
    const kv=await mf.getKVNamespace('LEGACY_KV');
    await kv.put('users',JSON.stringify({admin:{isAdmin:true},worker:{isAdmin:false,pinHash:createHash('sha256').update('654321:worker:panelstock').digest('hex')}}));
    const common={color:'Milled',material:'Raw Aluminium',thickness:3};
    const large={id:'large',catalogId:'cat-large',sku:'RAW-6000',width:6000,height:1500,qty:2,...common};
    const small={id:'small',catalogId:'cat-small',sku:'RAW-2000',width:2000,height:1500,qty:0,...common};
    const medium={id:'medium',catalogId:'cat-medium',sku:'RAW-4000',width:4000,height:1500,qty:0,...common};
    await kv.put('app:variants',JSON.stringify([large,small,medium]));
    let token;
    const request=async(path,body)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
    token=(await request('/login',{username:'worker',pin:'654321'})).body.token;
    const transaction={id:'transfer-1',timestamp:new Date().toISOString(),user:'worker',type:'transfer',desc:'Converted 1 × 6000 × 1500 into 1 × 2000 × 1500, 1 × 4000 × 1500',qty:1,itemType:'variant',sku:large.sku,sourceSku:large.sku,outputs:[{sku:small.sku,qty:1},{sku:medium.sku,qty:1}]};
    const changes=[{field:'variants',id:large.id,before:large,after:{...large,qty:1}},{field:'variants',id:small.id,before:small,after:{...small,qty:1}},{field:'variants',id:medium.id,before:medium,after:{...medium,qty:1}},{field:'transactions',id:transaction.id,before:null,after:transaction}];
    const result=await request('/mutations',{mutationId:randomUUID(),restoreEpoch:0,changes});
    assert.equal(result.status,200,result.body.error);
    const data=(await request('/data')).body;
    assert.deepEqual(data.variants.map(item=>item.qty),[1,1,1]);
    const excessive={...transaction,id:'transfer-2',timestamp:new Date().toISOString(),outputs:[{sku:small.sku,qty:4}]};
    const liveLarge=data.variants.find(item=>item.id==='large'),liveSmall=data.variants.find(item=>item.id==='small');
    const rejected=await request('/mutations',{mutationId:randomUUID(),restoreEpoch:0,changes:[{field:'variants',id:'large',before:liveLarge,after:{...liveLarge,qty:0}},{field:'variants',id:'small',before:liveSmall,after:{...liveSmall,qty:5}},{field:'transactions',id:excessive.id,before:null,after:excessive}]});
    assert.equal(rejected.status,403);
    assert.match(rejected.body.error,/area exceeds/i);
    const newCatalog={id:'cat-1000',sku:'RAW-1000',width:1000,height:1500,...common};
    const newVariant={...newCatalog,id:'smallest',catalogId:newCatalog.id,qty:1};
    const custom={...transaction,id:'transfer-3',timestamp:new Date().toISOString(),desc:'Converted 1 × 6000 × 1500 into 1 × 1000 × 1500',outputs:[{sku:newVariant.sku,qty:1}]};
    const customResult=await request('/mutations',{mutationId:randomUUID(),restoreEpoch:0,changes:[{field:'catalog',id:newCatalog.id,before:null,after:newCatalog},{field:'variants',id:'large',before:liveLarge,after:{...liveLarge,qty:0}},{field:'variants',id:newVariant.id,before:null,after:newVariant},{field:'transactions',id:custom.id,before:null,after:custom}]});
    assert.equal(customResult.status,200,customResult.body.error);
    const customData=(await request('/data')).body;
    assert.equal(customData.variants.find(item=>item.id==='smallest').qty,1);
    assert.equal(customData.catalog.find(item=>item.id==='cat-1000').width,1000);
  } finally {await mf.dispose();}
});
