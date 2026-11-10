import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('dispatch-only users open one-use PDFs for visible Site Orders without general order access',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'dispatch-order-pdf-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'dispatch-order-pdf-test',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 let admin,staff;
 const request=async(route,body,token)=>{const response=await mf.dispatchFetch('http://localhost'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
 const setupUser=async(username,newPin)=>{const invite=await request('/admin/create-invite',{targetUsername:username},admin);assert.equal(invite.status,200);const accepted=await request('/invite/accept',{token:invite.body.token,action:'accept',newPin});assert.equal(accepted.status,200);};
 try{
 const kv=await mf.getKVNamespace('LEGACY_KV'),hash=value=>createHash('sha256').update(value).digest('hex');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},staff:{isAdmin:false,pinHash:hash('654321:staff:panelstock')}}));admin=(await request('/login',{username:'admin',pin:'123456'})).body.token;staff=(await request('/login',{username:'staff',pin:'654321'})).body.token;assert.ok(admin&&staff);
 const username='dispatchpdfuser';assert.equal((await request('/admin/create-user',{targetUsername:username,displayName:'Dispatch PDF User'},admin)).status,201);await setupUser(username,'456789');
 const tasks=(await request('/admin/users',{},admin)).body.tasks.map(task=>task.code);await request('/admin/set-task-access',{targetUsername:username,taskCodes:tasks,allowed:false},admin);
 let token=(await request('/login',{username,pin:'456789'})).body.token;assert.ok(token,'Dispatch test login must succeed');
 const create=async(project,orderType='Fixings')=>{const result=await request('/orders',{idempotencyKey:crypto.randomUUID(),order:{project,orderType,location:orderType==='Panels'?'Level 1':'',siteContact:'Test contact',phone:'0400',requestedDeliveryDate:'2026-11-20',items:[{quantity:2,description:'TEST ITEMS'}]}},admin);assert.equal(result.status,201);return result.body.order;};
 const order=await create('Dispatch PDF access'),panel=await create('Dispatch Panel PDF access','Panels'),cancelled=await create('Cancelled dispatch PDF');
 const path='/orders/'+order.id+'/pdf-link';assert.equal((await request(path,{})).status,401);assert.equal((await request(path,{},token)).status,403);
 await request('/admin/set-task-access',{targetUsername:username,taskCode:'factory.dispatch',allowed:true},admin);token=(await request('/login',{username,pin:'456789'})).body.token;assert.ok(token,'Dispatch login with permission must succeed');
 assert.equal((await request('/orders',undefined,token)).status,403);assert.equal((await request('/orders/'+order.id,undefined,token)).status,403);assert.equal((await request('/orders/'+order.id+'/status',{status:'completed',expectedUpdatedAt:order.updatedAt},token)).status,403);
 const queue=(await request('/dispatch',undefined,token)).body.entries;assert.ok(queue.some(entry=>entry.order?.id===order.id));assert.ok(queue.some(entry=>entry.order?.id===panel.id));
 const before=(await request('/orders/'+order.id,undefined,admin)).body.order,link=await request(path,{},token);assert.equal(link.status,200);assert.match(link.body.pdfToken,/^[a-f0-9]{64}$/);assert.ok(link.body.expiresAt>Date.now()&&link.body.expiresAt<=Date.now()+120000);
 assert.equal((await mf.dispatchFetch('http://localhost/orders/'+panel.id+'/pdf?ticket='+link.body.pdfToken)).status,404);
 const pdf=await mf.dispatchFetch('http://localhost/orders/'+order.id+'/pdf?ticket='+link.body.pdfToken);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.match(new TextDecoder().decode(await pdf.arrayBuffer()),/^%PDF-/);assert.equal((await mf.dispatchFetch('http://localhost/orders/'+order.id+'/pdf?ticket='+link.body.pdfToken)).status,404);
 assert.deepEqual((await request('/orders/'+order.id,undefined,admin)).body.order,before);assert.equal((await request('/orders/'+panel.id+'/pdf-link',{},token)).status,200);
 const changed=await request('/orders/'+cancelled.id+'/status',{status:'cancelled',expectedUpdatedAt:cancelled.updatedAt},admin);assert.equal(changed.status,200);assert.equal((await request('/orders/'+cancelled.id+'/pdf-link',{},token)).status,404);assert.equal((await request('/orders/'+cancelled.id+'/pdf-link',{},staff)).status,200);assert.equal((await request('/orders/99999999-9999-4999-8999-999999999999/pdf-link',{},token)).status,404);
 }finally{await mf.dispose();}
});
