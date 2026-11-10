import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('shared CNC links cannot print offcut labels, including with a signed-in nonadmin session',async()=>{
  const stock={id:'source',sku:'SOURCE',color:'Milled',material:'Solid Aluminium',thickness:3,width:3000,height:1200,qty:8,cost:519,supplier:'PRIVATE-SUPPLIER'};
  const panels=[{id:'a',jobReference:'Job A',orderNumber:'0007',sheetNumber:'1',panelNumber:'A',status:'pending',stockItemType:'variant',stockItemId:stock.id,pendingOffcuts:[{length:500,width:1200,approved:true,status:'pending'}]}];
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'cnc-label-access',modules:true,
    script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),
    compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],
    durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],
    bindings:{SITE_ID:'cnc-label-access-test',CNC_PUBLIC_TOKEN:'synthetic-offcut-label-share',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
  try{
    const kv=await mf.getKVNamespace('LEGACY_KV');
    const user=isAdmin=>({isAdmin,pinHash:createHash('sha256').update('123456:'+(isAdmin?'admin':'worker')+':panelstock').digest('hex')});
    await kv.put('users',JSON.stringify({admin:user(true),worker:user(false)}));
    for(const [field,value] of Object.entries({variants:[stock],offcuts:[],cncPanels:panels,catalog:[],transactions:[],reasons:[],photos:{}}))await kv.put('app:'+field,JSON.stringify(value));
    const fetch=(path,options)=>mf.dispatchFetch('http://localhost'+path,options);
    const tokens={};
    for(const username of ['admin','worker']){
      const login=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,pin:'123456'})});
      assert.equal(login.status,200);tokens[username]=(await login.json()).token;
      const session=await fetch('/session/full',{headers:{Authorization:'Bearer '+tokens[username]}});
      assert.equal(session.status,200);assert.equal((await session.json()).isAdmin,username==='admin');
    }
    const snapshot=async()=>{const response=await fetch('/data',{headers:{Authorization:'Bearer '+tokens.admin}});assert.equal(response.status,200);const data=await response.json();return {cncPanels:data.cncPanels,variants:data.variants,offcuts:data.offcuts,transactions:data.transactions};};
    const before=await snapshot(),route='/cnc-tracker/offcut-labels?job=Job+A&order=0007&sheet=1';
    for(const credential of ['','wrong','synthetic-offcut-label-share']){
      for(const method of ['GET','POST','PUT','DELETE']){
        const denied=await fetch(route+'&token='+credential,{method});
        assert.equal(denied.status,404);assert.doesNotMatch(await denied.text(),/Offcut label|@page|window\.print/);
      }
    }
    // This endpoint is retired for everyone. Admins print inside the signed-in app.
    for(const username of ['worker','admin']){
      const denied=await fetch(route+'&token=synthetic-offcut-label-share',{headers:{Authorization:'Bearer '+tokens[username]}});
      assert.equal(denied.status,404);
    }
    const feed=await fetch('/cnc-tracker/data?token=synthetic-offcut-label-share');assert.equal(feed.status,200);const data=await feed.json();
    assert.ok(Array.isArray(data.panels));assert.equal(Object.hasOwn(data,'offcutLabelCounts'),false);
    assert.doesNotMatch(JSON.stringify(data),/PRIVATE-SUPPLIER|"cost"/);
    const view=await fetch('/cnc-tracker/view?token=synthetic-offcut-label-share');assert.equal(view.status,200);
    assert.doesNotMatch(await view.text(),/Print offcut labels|\/cnc-tracker\/offcut-labels|offcutLabelCounts/);
    assert.equal((await fetch('/cnc-tracker/data?token=wrong')).status,404);
    assert.deepEqual(await snapshot(),before);
  }finally{await mf.dispose();}
});
