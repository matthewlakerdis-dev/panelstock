import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('schedule changes use small authenticated revision checks and invalidate after saves, settings and deletes',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'schedule-updates',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'schedule-updates',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;const api=async(path,body,session=token)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify(Object.fromEntries(['admin','other','staff'].map(username=>[username,{isAdmin:username!=='staff',pinHash:createHash('sha256').update('123456:'+username+':panelstock').digest('hex')}]))));
  token=(await api('/login',{username:'admin',pin:'123456'})).body.token;const other=(await api('/login',{username:'other',pin:'123456'})).body.token;
  assert.equal((await api('/schedule/updates/initial',undefined,'')).status,401);
  const first=await api('/schedule/updates/initial');assert.equal(first.status,200);assert.ok(first.body.projects);assert.ok(first.body.orders);assert.equal(first.body.productionPlanEntries,undefined);
  let version=first.body.revision;const unchanged=await api('/schedule/updates/'+version);assert.deepEqual(Object.keys(unchanged.body).sort(),['ok','revision','unchanged']);assert.equal(unchanged.body.unchanged,true);
  assert.equal((await api('/schedule/updates/'+version,undefined,other)).body.unchanged,undefined,'revision checks are bound to the viewer session');
  const saved=await api('/schedule',{projectId:'schedule-factory-production',title:'Test work',assignedUsername:'admin',date:'2026-11-27',startTime:'07:00',endTime:'08:00',scheduleType:'general'});assert.equal(saved.status,201);
  const changed=await api('/schedule/updates/'+version);assert.notEqual(changed.body.revision,version);assert.equal(changed.body.entries[0].id,saved.body.entry.id);version=changed.body.revision;
  assert.equal((await api('/schedule/updates/'+version)).body.unchanged,true);
  const settings=changed.body.settings;assert.equal((await api('/schedule/settings',{...settings,taskColours:{general:'#ffffff'}})).status,200);const colours=await api('/schedule/updates/'+version);assert.equal(colours.body.settings.taskColours.general,'#ffffff');version=colours.body.revision;
  const share=(await api('/schedule/share')).body,publicUrl='/schedule-display/data?token='+share.token;
  const display=await api(publicUrl);assert.ok(display.body.entries);const sameDisplay=await api(publicUrl+'&revision='+display.body.revision);assert.equal(sameDisplay.body.unchanged,true);assert.equal(sameDisplay.body.entries,undefined);
  assert.equal((await api('/schedule-display/data?token=wrong&revision='+display.body.revision)).status,404);
  const response=await mf.dispatchFetch('http://localhost/schedule/'+saved.body.entry.id,{method:'DELETE',headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);
  const deleted=await api('/schedule/updates/'+version);assert.equal(deleted.body.entries.length,0);assert.notEqual(deleted.body.revision,version);
  const updatedTv=await api(publicUrl+'&revision='+display.body.revision);assert.equal(updatedTv.body.entries.length,0);assert.notEqual(updatedTv.body.revision,display.body.revision);
 }finally{await mf.dispose();}
});
