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
    const stock={id:'stock-1',catalogId:'catalog-1',sku:'RAW-1',color:'Milled',material:'Raw Aluminium',thickness:3,width:2400,height:1500,qty:2};
    const stockPanel={id:'stock-panel',orderNumber:'3',jobReference:'Pinnacle Studios',sheetNumber:'15',panelNumber:'15,31',stockItemType:'variant',stockItemId:stock.id,stockSku:stock.sku,sheetWidth:2400,sheetHeight:1500,totalPanelArea:2.56,status:'pending',uploadedBy:'admin',uploadedAt:'2026-08-31T00:00:00.000Z'};
    await kv.put('app:variants',JSON.stringify([stock]));
    await kv.put('app:cncPanels',JSON.stringify([...panels,stockPanel]));
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
    assert.equal(current.filter(p=>p.orderNumber==='ORDER-A'&&p.status==='pending').length,2);
    const first=current.find(p=>p.id==='1');
    const batch=packet(current.filter(p=>p.orderNumber==='ORDER-A'&&p.status==='pending').map(change));
    assert.equal((await request('/mutations',batch)).status,200);
    assert.equal((await request('/mutations',batch)).body.duplicate,true);
    current=(await request('/data')).body.cncPanels;
    assert.ok(current.filter(p=>p.orderNumber==='ORDER-A').every(p=>p.status==='completed' && p.completedBy==='worker'));
    assert.deepEqual(current.find(p=>p.id==='1'),first);
    assert.equal(current.find(p=>p.id==='2').completedAt,current.find(p=>p.id==='3').completedAt);
    const beforeCompletion=(await request('/data')).body;
    const liveStock=beforeCompletion.variants.find(item=>item.id===stock.id),livePanel=beforeCompletion.cncPanels.find(panel=>panel.id===stockPanel.id);
    const completion={...livePanel,status:'completed',completedBy:'worker',completedAt:'2026-09-04T04:10:42.601Z',offcutOutcome:'confirmed',offcutDetails:{length:900,width:450,color:'Milled',material:'Raw Aluminium',thickness:3}};
    const dispatch={id:'dispatch-1',timestamp:'2026-09-04T04:10:42.601Z',user:'worker',type:'dispatch',source:'cnc',desc:'Milled Raw Aluminium 3mm 2400 × 1500',qty:1,ref:'Pinnacle Studios',customer:'CNC',itemType:'variant',sku:stock.sku,color:'Milled',material:'Raw Aluminium',thickness:3,width:2400,height:1500,note:''};
    const audit={id:'cnc-audit-1',timestamp:'2026-09-04T04:10:42.601Z',user:'worker',type:'cnc',desc:'Completed CNC sheet: Order 3 · Sheet 15 · 1 panel',qty:''};
    const completionResult=await request('/mutations',packet([{field:'variants',id:stock.id,before:liveStock,after:{...liveStock,qty:1}},{field:'transactions',id:dispatch.id,before:null,after:dispatch},{field:'transactions',id:audit.id,before:null,after:audit},{field:'cncPanels',id:stockPanel.id,before:livePanel,after:completion}]));
    assert.equal(completionResult.status,200,completionResult.body.error);
    const completedData=(await request('/data')).body;
    assert.equal(completedData.variants.find(item=>item.id===stock.id).qty,1);
    assert.equal(completedData.cncPanels.find(panel=>panel.id===stockPanel.id).status,'completed');
    assert.equal(completedData.cncPanels.find(panel=>panel.id===stockPanel.id).offcutDetails.length,900);
  } finally {await mf.dispose();}
});
