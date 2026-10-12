import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {TOOLBOX_DEFAULTS,toolboxContent} from '../src/toolbox.js';
let mf,admin,supervisor;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const hash=(value)=>createHash('sha256').update(value).digest('hex');
async function request(path,body,token){const r=await mf.dispatchFetch('https://toolbox.test'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'toolbox-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'toolbox-tests',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},supervisor:{isAdmin:false,pinHash:hash('654321:supervisor:panelstock')}}));
 admin=(await request('/login',{username:'admin',pin:'123456'})).body.token;
 supervisor=(await request('/login',{username:'supervisor',pin:'654321'})).body.token;
 assert.ok(admin&&supervisor);
});
after(async()=>{await mf?.dispose()});
test('toolbox shell is served locally with no external assets; data requires a permitted session',async()=>{
 const shell=await mf.dispatchFetch('https://toolbox.test/toolbox');assert.equal(shell.status,200);const html=await shell.text();assert.match(html,/Supervisor sign-in/);assert.doesNotMatch(html,/__TOOLBOX_CONTENT_FUNCTION__/);assert.match(html,/function toolboxContent/);assert.match(shell.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.equal((await request('/toolbox/templates')).status,401);
 assert.equal((await request('/toolbox/templates',undefined,supervisor)).status,403);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'supervisor',taskCode:'factory.toolbox',allowed:true},admin)).status,200);
 supervisor=(await request('/login',{username:'supervisor',pin:'654321'})).body.token;
 assert.equal((await request('/toolbox/templates',undefined,supervisor)).status,200);
 assert.equal((await request('/toolbox/templates',{expectedRevision:0,templates:TOOLBOX_DEFAULTS},supervisor)).status,403);
});
test('signed records persist in the Durable Object with audit ownership, stable retries and immutable content',async()=>{
 const record={id:crypto.randomUUID(),type:'weekly',status:'Completed',date:'2026-10-13',time:'06:30',company:'Test fabricator',site:'Test workshop',facilitator:'Supervisor',tasks:'',focus:'Welding fumes',topics:TOOLBOX_DEFAULTS.weekly.map(text=>({text,notes:'Crew discussed extraction',reviewed:true})),people:[{name:'Test attendee',ack:true}],actions:[]};
 const sig={image,at:new Date().toISOString(),contentHash:hash(toolboxContent(record))};record.people[0].signature=sig;record.supervisorSignature=sig;
 const path='/toolbox/records/'+record.id,packet={mutationId:crypto.randomUUID(),expectedRevision:0,record};
 const saved=await request(path,packet,supervisor);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.record.completedBy,'supervisor');assert.equal(saved.body.record.revision,1);
 const get=await request(path,undefined,admin);assert.equal(get.status,200);assert.deepEqual(get.body.record.people[0].signature,sig);
 assert.equal((await request(path,packet,supervisor)).body.duplicate,true);
 assert.equal((await request(path,{...packet,mutationId:crypto.randomUUID(),expectedRevision:1},admin)).status,409);
 const list=await request('/toolbox/list',{},supervisor);assert.equal(list.status,200);assert.equal(list.body.total,1);assert.equal(JSON.stringify(list.body).includes('data:image'),false);
 assert.equal((await request('/logout',{},supervisor)).status,200);assert.equal((await request(path,undefined,supervisor)).status,401);
});
