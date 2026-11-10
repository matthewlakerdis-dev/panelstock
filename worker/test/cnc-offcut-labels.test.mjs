import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {collectPublicCncOffcutLabels,cncOffcutLabelCounts,selectCncOffcutLabels,buildCncOffcutLabelDocument} from '../src/cnc-offcut-labels.js';

const stock={id:'source',sku:'SOURCE',color:'Black & silver',material:'Aluminium <ACP>',thickness:4,width:4000,height:1500,qty:8,cost:519,supplier:'PRIVATE-SUPPLIER'};
const piece={length:500,width:1200,source:'manual',approved:true,status:'pending'};
const panel={id:'a',jobReference:'JOB a',orderNumber:'0007',sheetNumber:'1',panelNumber:'A',status:'pending',stockItemType:'variant',stockItemId:stock.id,pendingOffcuts:[piece]};
const saved={length:900,width:300,material:'Saved ACP',color:'Saved charcoal',thickness:3,stockSku:'SAVED-OFFCUT'};
const panels=[
  {...panel,orderNumber:'Order 0007'},
  {...panel,id:'b',jobReference:'job A',panelNumber:'B'},
  {...panel,id:'zero',sheetNumber:'01',pendingOffcuts:[piece,{...piece}]},
  {...panel,id:'repeat',sheetNumber:'1.2',pendingOffcuts:[{...piece,length:777,width:888}]},
  {...panel,id:'done',sheetNumber:'2',status:'completed',offcutOutcome:'confirmed',savedOffcuts:[saved],pendingOffcuts:[{...piece,length:9999}]},
  {...panel,id:'done-sibling',sheetNumber:'2',panelNumber:'C',status:'completed',offcutOutcome:'confirmed',savedOffcuts:[saved]},
  {...panel,id:'declined',sheetNumber:'3',status:'completed',offcutOutcome:'none'},
  {...panel,id:'unknown',sheetNumber:'4',pendingOffcuts:[],pendingOffcut:null},
  {...panel,id:'rejected',sheetNumber:'5',pendingOffcuts:[{...piece,approved:false}]},
  {...panel,id:'other-job',jobReference:'Job B'},
  {...panel,id:'other-order',orderNumber:'7'}
];
const query=(job='job a',order='0007',sheet)=>new URLSearchParams({job,order,...(sheet===undefined?{}:{sheet})});

test('public CNC offcut labels use full physical-sheet scope without changing source records',()=>{
  const before=JSON.stringify({panels,stock});
  const items=collectPublicCncOffcutLabels(panels,{variants:[stock],offcuts:[]});
  assert.equal(selectCncOffcutLabels(items,query()).length,5);
  assert.equal(selectCncOffcutLabels(items,query(' JOB   A ','Order 0007','1')).length,1);
  assert.equal(selectCncOffcutLabels(items,query('Job A','0007','01')).length,2);
  assert.equal(selectCncOffcutLabels(items,query('Job A','0007','1.2')).length,1);
  assert.equal(selectCncOffcutLabels(items,query('Job B')).length,1);
  assert.equal(selectCncOffcutLabels(items,query('Job A','7')).length,1);
  assert.equal(selectCncOffcutLabels(items,new URLSearchParams('order=0007')).length,0);
  for(const sheet of ['3','4','5'])assert.equal(selectCncOffcutLabels(items,query('Job A','0007',sheet)).length,0);
  const completed=selectCncOffcutLabels(items,query('Job A','0007','2'));
  assert.equal(completed.length,1);assert.equal(completed[0].material,'Saved ACP');assert.equal(completed[0].length,900);
  const html=buildCncOffcutLabelDocument(selectCncOffcutLabels(items,query()));
  assert.match(html,/@page\{size:50mm 30mm/);assert.equal((html.match(/aria-label="Offcut label"/g)||[]).length,5);
  assert.match(html,/500 × 1200 mm/);assert.match(html,/Aluminium &lt;ACP&gt;/);assert.match(html,/Black &amp; silver/);
  assert.doesNotMatch(html,/PRIVATE-SUPPLIER|9999|cost/);
  assert.ok(cncOffcutLabelCounts(items).every(value=>Object.keys(value).sort().join(',')==='count,jobReference,orderNumber,sheetNumber'));
  assert.equal(JSON.stringify({panels,stock}),before);
});

test('shared CNC label route is token protected, GET only and keeps stock and activity unchanged',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'cnc-labels',modules:true,
    script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),
    compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],
    durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],
    bindings:{SITE_ID:'cnc-labels-test',CNC_PUBLIC_TOKEN:'synthetic-offcut-label-share',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
  try{
    const kv=await mf.getKVNamespace('LEGACY_KV');
    const pinHash=createHash('sha256').update('123456:admin:panelstock').digest('hex');
    await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash}}));
    for(const [field,value] of Object.entries({variants:[stock],offcuts:[],cncPanels:panels,catalog:[],transactions:[],reasons:[],photos:{}}))await kv.put('app:'+field,JSON.stringify(value));
    const fetch=(path,options)=>mf.dispatchFetch('http://localhost'+path,options);
    const login=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',pin:'123456'})});
    assert.equal(login.status,200);const token=(await login.json()).token;
    const snapshot=async()=>{const response=await fetch('/data',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);const data=await response.json();return {cncPanels:data.cncPanels,variants:data.variants,offcuts:data.offcuts,transactions:data.transactions};};
    const before=await snapshot();
    const route='/cnc-tracker/offcut-labels?job=job+a&order=0007';
    for(const credential of ['','wrong'])assert.equal((await fetch(route+'&token='+credential)).status,404);
    const share='&token=synthetic-offcut-label-share';
    for(const method of ['POST','PUT','DELETE'])assert.equal((await fetch(route+share,{method})).status,404);
    assert.equal((await fetch('/cnc-tracker/offcut-labels?order=0007'+share)).status,404);
    assert.equal((await fetch(route+share+'&sheet=4')).status,404);
    const response=await fetch(route+share);
    assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/text\/html/);
    assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    const html=await response.text();assert.equal((html.match(/aria-label="Offcut label"/g)||[]).length,5);assert.doesNotMatch(html,/PRIVATE-SUPPLIER|9999/);
    const leading=await fetch(route+share+'&sheet=01');assert.equal(leading.status,200);assert.equal(((await leading.text()).match(/aria-label="Offcut label"/g)||[]).length,2);
    const feed=await fetch('/cnc-tracker/data?token=synthetic-offcut-label-share');assert.equal(feed.status,200);const data=await feed.json();
    assert.ok(data.offcutLabelCounts.some(row=>row.jobReference==='Job A'&&row.orderNumber==='0007'&&row.sheetNumber==='01'&&row.count===2));
    assert.ok(data.offcutLabelCounts.every(value=>Object.keys(value).sort().join(',')==='count,jobReference,orderNumber,sheetNumber'));
    assert.doesNotMatch(JSON.stringify(data),/PRIVATE-SUPPLIER|"cost"/);
    assert.deepEqual(await snapshot(),before);
  }finally{await mf.dispose();}
});
