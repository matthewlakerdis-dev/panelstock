import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';

test('worker can complete a sheet atomically; stale batch leaves remaining panels pending',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'cnc-batch',modules:true,
    script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),
    compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],
    durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],
    bindings:{SITE_ID:'cnc-test',MIGRATION_READY:'true'}}]}));
  try {
    const kv=await mf.getKVNamespace('LEGACY_KV');
    await kv.put('users',JSON.stringify({admin:{isAdmin:true},worker:{isAdmin:false,pinHash:createHash('sha256').update('654321:worker:panelstock').digest('hex')}}));
    const panels=['1','2','3'].map(id=>({id,orderNumber:'ORDER-A',sheetNumber:'1',panelNumber:id,status:'pending',uploadedBy:'admin',uploadedAt:'2026-08-31T00:00:00.000Z'}));
    await kv.put('app:cncPanels',JSON.stringify(panels));
    let token;
    async function request(path,body) {
      const r=await mf.dispatchFetch('http://localhost'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
      return {status:r.status,body:await r.json()};
    }
    token=(await request('/login',{username:'worker',pin:'654321'})).body.token;
    assert.ok(token);
    const change=p=>({field:'cncPanels',id:p.id,before:p,after:{...p,status:'completed',completedBy:'forged',completedAt:'2000-01-01'}});
    const packet=changes=>({mutationId:randomUUID(),restoreEpoch:0,changes});
    assert.equal((await request('/mutations',packet([change(panels[0])]))).status,200);
    assert.equal((await request('/mutations',packet(panels.map(change)))).status,409);
    let current=(await request('/data')).body.cncPanels;
    assert.equal(current.filter(p=>p.status==='pending').length,2);
    const first=current.find(p=>p.id==='1');
    const batch=packet(current.filter(p=>p.status==='pending').map(change));
    assert.equal((await request('/mutations',batch)).status,200);
    assert.equal((await request('/mutations',batch)).body.duplicate,true);
    current=(await request('/data')).body.cncPanels;
    assert.ok(current.every(p=>p.status==='completed' && p.completedBy==='worker'));
    assert.deepEqual(current.find(p=>p.id==='1'),first);
    assert.equal(current.find(p=>p.id==='2').completedAt,current.find(p=>p.id==='3').completedAt);
  } finally {await mf.dispose();}
});
