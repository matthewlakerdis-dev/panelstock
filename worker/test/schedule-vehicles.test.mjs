import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {buildSiteOrderRows} from '../src/site-orders-excel.js';
test('vehicles book pickups and deliveries without accounts, preserve history, and enforce permissions',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'vehicle-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'vehicle-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let token;const api=async(path,body,method=body===undefined?'GET':'POST',session=token)=>{const response=await mf.dispatchFetch('http://localhost'+path,{method,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  const kv=await mf.getKVNamespace('LEGACY_KV'),hash=(pin,user)=>createHash('sha256').update(`${pin}:${user}:panelstock`).digest('hex');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456','admin')},staff:{isAdmin:false,pinHash:hash('654321','staff')}}));token=(await api('/login',{username:'admin',pin:'123456'})).body.token;let staff=(await api('/login',{username:'staff',pin:'654321'})).body.token;
  assert.equal((await api('/schedule/vehicles',{name:'Ute'},'POST',staff)).status,403);
  const initialSettings=(await api('/schedule/settings')).body.settings,taskColours={fabrication:'#ffffff',cnc:'#000000'};
  assert.equal((await api('/schedule/settings',{...initialSettings,taskColours},'POST',staff)).status,403);
  assert.equal((await api('/schedule/settings',{...initialSettings,taskColours})).status,200);
  assert.deepEqual((await api('/schedule')).body.settings.taskColours,taskColours);
  for(const invalid of [{fabrication:'red'},{fabrication:'#fff'},{fabrication:'url(test)'},{unknown:'#000000'},null,[]])assert.equal((await api('/schedule/settings',{...initialSettings,taskColours:invalid})).status,400);
  assert.equal((await api('/schedule/settings',initialSettings)).status,200);assert.deepEqual((await api('/schedule/settings')).body.settings.taskColours,taskColours);

  for(const name of ['', ' '.repeat(4),'X'.repeat(101)])assert.equal((await api('/schedule/vehicles',{name})).status,400);
  const created=await api('/schedule/vehicles',{name:'Ute',registration:'abc123'});assert.equal(created.status,201);const vehicle=created.body.vehicle,username='vehicle:'+vehicle.id;assert.equal(vehicle.registration,'ABC123');assert.ok(created.body.settings.visibleUsernames.includes(username));assert.equal(created.body.people.find(row=>row.username===username).kind,'vehicle');
  assert.equal((await api('/schedule/vehicles',{name:' ute '})).status,409);
  const users=(await api('/admin/users',{})).body.users;assert.equal(users.some(user=>user.username===username),false);
  for(const scheduleType of ['pickup','delivery']){const saved=await api('/schedule',{projectId:'schedule-factory-production',title:scheduleType==='pickup'?'Collect aluminium':'Deliver order',date:'2026-11-17',startTime:'08:00',endTime:'10:00',assignedUsername:username,scheduleType,notes:'Loading bay'});assert.equal(saved.status,201,JSON.stringify(saved.body));assert.equal(saved.body.entry.assignedResourceType,'vehicle');}
  await api('/admin/set-task-access',{targetUsername:'staff',taskCodes:['schedule.cnc.manage'],allowed:true});staff=(await api('/login',{username:'staff',pin:'654321'})).body.token;assert.equal((await api('/schedule',{projectId:'schedule-factory-production',title:'CNC',date:'2026-11-17',assignedUsername:username,scheduleType:'cnc'},'POST',staff)).status,403);
  const renamed=await api('/schedule/vehicles/'+vehicle.id,{name:'Workshop ute',registration:'ABC123'});assert.equal(renamed.status,200);assert.ok((await api('/schedule')).body.entries.every(entry=>entry.assignedTo==='Workshop ute · ABC123'));
  const share=(await api('/schedule/share')).body,publicData=await mf.dispatchFetch('http://localhost/schedule-display/data?token='+share.token),display=await publicData.json();assert.deepEqual(display.settings.taskColours,taskColours);assert.ok(display.people.some(row=>row.username===username));assert.equal(display.entries.filter(row=>row.assignedUsername===username).length,2);
  const removed=await api('/schedule/vehicles/'+vehicle.id,undefined,'DELETE');assert.equal(removed.status,200);assert.equal(removed.body.people.some(row=>row.username===username),false);const after=(await api('/schedule')).body;assert.equal(after.entries.filter(entry=>entry.assignedUsername===username).length,2);assert.equal(after.people.some(row=>row.username===username),false);
  assert.equal((await api('/schedule',{projectId:'schedule-factory-production',title:'More work',date:'2026-11-17',assignedUsername:username,scheduleType:'pickup'})).status,400);
  const replacement=await api('/schedule/vehicles',{name:'Workshop ute'});assert.equal(replacement.status,201);assert.notEqual(replacement.body.vehicle.id,vehicle.id);
 }finally{await mf.dispose();}
});
test('vehicle bookings do not tick an order as scheduled for production',()=>{
 const order={id:'order',orderType:'Panels'},booking={orderId:'order',assignedUsername:'vehicle:ute',assignedResourceType:'vehicle',scheduleType:'general',status:'planned'};assert.equal(buildSiteOrderRows([order],[],[],[],[],[booking])[0]['Scheduled for production'],'-');assert.equal(buildSiteOrderRows([order],[],[],[],[],[{...booking,assignedResourceType:'person',assignedUsername:'alex'}])[0]['Scheduled for production'],'✓');
});
