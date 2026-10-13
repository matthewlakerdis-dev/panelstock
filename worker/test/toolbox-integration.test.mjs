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
 const kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},supervisor:{isAdmin:false,pinHash:hash('654321:supervisor:panelstock')},member:{displayName:'Member Name',appAccess:{app:true,web:true,site:false},pinHash:hash('667788:member:panelstock')}}));
 admin=(await request('/login',{username:'admin',pin:'123456'})).body.token;
 supervisor=(await request('/login',{username:'supervisor',pin:'654321'})).body.token;
 assert.ok(admin&&supervisor);
});
after(async()=>{await mf?.dispose()});
test('toolbox shell is served locally with no external assets; data requires a permitted session',async()=>{
 const shell=await mf.dispatchFetch('https://toolbox.test/toolbox');assert.equal(shell.status,200);const html=await shell.text();assert.match(html,/Sign in to Workshop Safety/);assert.doesNotMatch(html,/__TOOLBOX_CONTENT_FUNCTION__/);assert.match(html,/function toolboxContent/);assert.match(shell.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.equal((await request('/toolbox/templates')).status,401);
 assert.equal((await request('/toolbox/templates',undefined,supervisor)).status,403);assert.equal((await request('/toolbox/users',undefined,supervisor)).status,403);
 assert.equal((await request('/admin/set-task-access',{targetUsername:'supervisor',taskCode:'factory.toolbox',allowed:true},admin)).status,200);
 supervisor=(await request('/login',{username:'supervisor',pin:'654321'})).body.token;
 const directory=await request('/toolbox/users',undefined,supervisor);assert.equal(directory.status,200);assert.ok(directory.body.users.some(u=>u.username==='supervisor'));assert.ok(directory.body.users.every(u=>Object.keys(u).sort().join(',')==='displayName,licenses,profileRevision,signoffDetails,title,username'));
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

async function rootSession(app='app'){return (await request('/login',{username:'supervisor',pin:'654321',app})).body.token;}
async function handoff(root,app='app'){const issued=(await request('/toolbox/session-ticket',{app},root)).body;assert.ok(issued.expiresAt>Date.now()&&issued.expiresAt<=Date.now()+60000);const ticket=issued.ticket;assert.match(ticket,/^[a-f0-9]{64}$/);const result=await request('/toolbox/session',{ticket,app});assert.equal(result.status,200,JSON.stringify(result.body));return {ticket,token:result.body.token,expiresAt:result.body.expiresAt};}
test('PanelStock session handoff is single-use and revokes with its parent',async()=>{const login=(await request('/login',{username:'supervisor',pin:'654321',app:'app'})).body,root=login.token,child=await handoff(root);assert.ok(child.expiresAt<=login.expiresAt);assert.equal((await request('/session',undefined,child.token)).body.username,'supervisor');assert.equal((await request('/toolbox/users',undefined,child.token)).status,200);assert.equal((await request('/data',undefined,child.token)).status,403);assert.equal((await request('/toolbox/session',{ticket:child.ticket,app:'app'})).status,401);await request('/logout',{},root);assert.equal((await request('/session',undefined,child.token)).status,401);});
test('handoff cannot cross apps or survive a revoked source session or lost permission',async()=>{assert.equal((await request('/toolbox/session-ticket',{app:'app'})).status,401);const root=await rootSession('web');const first=(await request('/toolbox/session-ticket',{app:'web'},root)).body.ticket;assert.equal((await request('/toolbox/session',{ticket:first,app:'app'})).status,401);const pending=(await request('/toolbox/session-ticket',{app:'web'},root)).body.ticket;await request('/logout',{},root);assert.equal((await request('/toolbox/session',{ticket:pending,app:'web'})).status,401);const next=await rootSession('web');const ticket=(await request('/toolbox/session-ticket',{app:'web'},next)).body.ticket;await request('/admin/set-task-access',{targetUsername:'supervisor',taskCode:'factory.toolbox',allowed:false},admin);assert.equal((await request('/toolbox/session',{ticket,app:'web'})).status,401);const denied=await rootSession('web');assert.equal((await request('/toolbox/session-ticket',{app:'web'},denied)).status,403);await request('/admin/set-task-access',{targetUsername:'supervisor',taskCode:'factory.toolbox',allowed:true},admin);});

test('deleting a large saved draft removes its document chunks and blocks stale saves through the real Worker',async()=>{
 const token=await rootSession(),record={id:crypto.randomUUID(),type:'weekly',status:'Draft',date:'2026-10-13',time:'05:00',company:'Test',site:'Workshop',facilitator:'Supervisor',tasks:'',focus:'',topics:TOOLBOX_DEFAULTS.weekly.map(text=>({text,notes:'',reviewed:true})),people:[],actions:Array.from({length:50},()=>({text:'x'.repeat(3000),owner:'',due:'',closed:false})),supervisorSignature:null};
 const path='/toolbox/records/'+record.id,saved=await request(path,{record,expectedRevision:0,mutationId:crypto.randomUUID()},token);assert.equal(saved.status,200,JSON.stringify(saved.body));
 const packet={expectedRevision:1,mutationId:crypto.randomUUID()};const deleted=await request(path+'/delete',packet,token);assert.equal(deleted.status,200,JSON.stringify(deleted.body));assert.equal(deleted.body.deleted,true);
 assert.equal((await request(path+'/delete',packet,token)).body.duplicate,true);assert.equal((await request(path,undefined,admin)).status,404);
 assert.ok(!(await request('/toolbox/list',{},token)).body.records.some(r=>r.id===record.id));assert.ok(!(await request('/toolbox/export-index',{},admin)).body.ids.includes(record.id));
 assert.equal((await request(path,{record,expectedRevision:0,mutationId:crypto.randomUUID()},token)).status,409);
});

test('Toolbox email settings require an admin and completion atomically queues one signed snapshot in staging',async()=>{
 const token=await rootSession();assert.equal((await request('/toolbox/email-settings',undefined,token)).status,403);
 const initial=await request('/toolbox/email-settings',undefined,admin);assert.equal(initial.status,200);assert.equal(initial.body.config.enabled,false);assert.equal(initial.body.sender,'PanelStock Reports <reports@panelstockhq.com>');assert.equal(initial.body.providerReady,false);
 assert.equal((await request('/toolbox/email-settings',{enabled:true,recipients:['office@example.com'],expectedRevision:0},admin)).status,200);
 const r={id:crypto.randomUUID(),type:'weekly',status:'Draft',date:'2026-10-13',time:'05:00',company:'Lennox Facades',site:'Factory',facilitator:'Supervisor',tasks:'',focus:'Safety',topics:TOOLBOX_DEFAULTS.weekly.map(text=>({text,notes:'Crew comments',reviewed:true})),people:[{name:'Worker',ack:true,signature:null}],actions:[],supervisorSignature:null};
 const path='/toolbox/records/'+r.id;assert.equal((await request(path,{record:r,expectedRevision:0,mutationId:crypto.randomUUID()},token)).status,200);assert.equal((await request('/toolbox/email-settings',undefined,admin)).body.jobs.length,0);
 r.status='Completed';const sig={image,at:new Date().toISOString(),contentHash:hash(toolboxContent(r))};r.people[0].signature=sig;r.supervisorSignature=sig;const packet={record:r,expectedRevision:1,mutationId:crypto.randomUUID()};const saved=await request(path,packet,token);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.emailStatus,'queued');assert.equal((await request(path,packet,token)).body.duplicate,true);
 const settings=(await request('/toolbox/email-settings',undefined,admin)).body;assert.equal(settings.jobs.length,1);assert.equal(settings.jobs[0].id,r.id);assert.equal(settings.jobs[0].status,'queued');assert.deepEqual(settings.jobs[0].recipients,['office@example.com']);assert.equal((await request(path,undefined,token)).body.record.status,'Completed');
});

test('Safety profile edits require admins, share licence class with employee records and protect signed snapshots',async()=>{
 const {PDFDocument}=await import('pdf-lib');const {safetyAcknowledgementContent}=await import('../src/safety-documents.js');
 let token=await rootSession();let directory=(await request('/toolbox/users',undefined,admin)).body.users,p=directory.find(u=>u.username==='supervisor');
 const packet={username:p.username,displayName:'Supervisor Name',title:'Welder',licenses:[{id:'test-white',type:'White Card',class:'General',number:'WC-123'},{id:'test-lift',type:'Forklift',class:'LF',number:'LF-456'}],expectedRevision:p.profileRevision};
 assert.equal((await request('/toolbox/user-profiles',packet,token)).status,403);const saved=await request('/toolbox/user-profiles',packet,admin);assert.equal(saved.status,200);p=saved.body.users.find(u=>u.username==='supervisor');
 assert.equal((await request('/toolbox/user-profiles',packet,admin)).status,409);assert.equal((await request('/admin/users',{},admin)).body.users.find(u=>u.username===p.username).employeeProfile.licenses[1].class,'LF');
 const employee=(await request('/admin/users',{},admin)).body.users.find(u=>u.username===p.username).employeeProfile;employee.licenses=employee.licenses.map(({class:licenceClass,...l})=>l);assert.equal((await request('/admin/update-user',{targetUsername:p.username,displayName:p.displayName,title:p.title,location:'',email:'',active:true,isAdmin:false,roleIds:[],employeeProfile:employee},admin)).status,200);assert.equal((await request('/admin/users',{},admin)).body.users.find(u=>u.username===p.username).employeeProfile.licenses[1].class,'LF');token=await rootSession();
 const pdf=await PDFDocument.create();pdf.addPage([792,612]);pdf.addPage([792,612]);const bytes=await pdf.save(),id=crypto.randomUUID();
 assert.equal((await request('/toolbox/safety-documents',{id,type:'SWMS',title:'Profile SWMS',versionLabel:'Rev 1',fileName:'test.pdf',data:Buffer.from(bytes).toString('base64'),expectedRevision:0,mutationId:crypto.randomUUID()},admin)).status,200);
 const configured=await request('/toolbox/safety-documents/'+id+'/signoff',{expectedRevision:1,firstPage:1,continuationPage:2},admin),v=configured.body.version;
 const ack={username:p.username,versionId:v.id,details:p.signoffDetails,profileRevision:p.profileRevision,profileLicenceIds:['test-white','test-lift'],mutationId:crypto.randomUUID(),signature:{image,at:new Date().toISOString(),contentHash:hash(safetyAcknowledgementContent(v,{username:p.username,name:p.displayName,details:p.signoffDetails}))}};
 const changed=await request('/toolbox/user-profiles',{...packet,title:'Supervisor',expectedRevision:p.profileRevision},admin);assert.equal(changed.status,200);assert.equal((await request('/toolbox/safety-documents/'+id+'/acknowledge',ack,token)).status,409);
 p=changed.body.users.find(u=>u.username==='supervisor');ack.details=p.signoffDetails;ack.profileRevision=p.profileRevision;ack.signature.contentHash=hash(safetyAcknowledgementContent(v,{username:p.username,name:p.displayName,details:p.signoffDetails}));
 const signed=await request('/toolbox/safety-documents/'+id+'/acknowledge',ack,token);assert.equal(signed.status,200,JSON.stringify(signed.body));assert.equal(signed.body.acknowledgements[0].details.licences[1].number,'LF-456');
 await request('/toolbox/user-profiles',{...packet,licenses:[],expectedRevision:p.profileRevision},admin);const history=await request('/toolbox/safety-documents/'+id,undefined,token);assert.equal(history.body.acknowledgements[0].details.licences[1].number,'LF-456');
});

test('self-service sessions read SWMS/SDS and sign only themselves without supervisor or inventory access',async()=>{
 const {PDFDocument}=await import('pdf-lib'),{safetyAcknowledgementContent}=await import('../src/safety-documents.js');
 const parent=(await request('/login',{username:'member',pin:'667788',app:'app'})).body.token;
 assert.equal((await request('/toolbox/session-ticket',{app:'app'},parent)).status,403);
 const issued=await request('/toolbox/self/session-ticket',{app:'app'},parent);assert.equal(issued.status,200);
 const body={ticket:issued.body.ticket,app:'app'};assert.equal((await request('/toolbox/session',body)).status,401);
 const redeemed=await request('/toolbox/self/session',body);assert.equal(redeemed.status,200);const token=redeemed.body.token;
 assert.equal((await request('/toolbox/self/session',body)).status,401);assert.equal((await request('/session',undefined,token)).body.safetySelfOnly,true);
 for(const path of ['/toolbox/users','/toolbox/list','/toolbox/templates','/toolbox/email-settings','/toolbox/session-ticket','/toolbox/user-profiles','/admin/users','/data'])assert.equal((await request(path,{},token)).status,403,path);
 const directory=await request('/toolbox/self/users',undefined,token);assert.deepEqual(directory.body.users.map(u=>u.username),['member']);const p=directory.body.users[0];
 const pdf=await PDFDocument.create();pdf.addPage([792,612]);pdf.addPage([792,612]);const bytes=await pdf.save(),id=crypto.randomUUID();
 await request('/toolbox/safety-documents',{id,type:'SWMS',title:'Self-service SWMS',versionLabel:'Rev 1',fileName:'self.pdf',data:Buffer.from(bytes).toString('base64'),expectedRevision:0,mutationId:crypto.randomUUID()},admin);
 const configured=await request('/toolbox/safety-documents/'+id+'/signoff',{expectedRevision:1,firstPage:1,continuationPage:2},admin),v=configured.body.version,base='/toolbox/self/safety-documents/'+id;
 assert.equal((await request('/toolbox/self/safety-documents/list',{},token)).status,200);assert.equal((await request(base+'/file',{versionId:v.id},token)).status,200);
 for(const path of ['/toolbox/self/safety-documents',base+'/signoff',base+'/archive'])assert.equal((await request(path,{},token)).status,403);
 const ack={versionId:v.id,username:'member',profileRevision:p.profileRevision,profileLicenceIds:['',''],details:p.signoffDetails,mutationId:crypto.randomUUID(),signature:{image,at:new Date().toISOString(),contentHash:hash(safetyAcknowledgementContent(v,{username:p.username,name:p.displayName,details:p.signoffDetails}))}};
 assert.equal((await request(base+'/acknowledge',{...ack,username:'supervisor'},token)).status,403);
 const signed=await request(base+'/acknowledge',ack,token);assert.equal(signed.status,200,JSON.stringify(signed.body));assert.equal(signed.body.acknowledgements[0].collectedBy,'member');assert.equal((await request(base+'/acknowledge',ack,token)).body.duplicate,true);
 const team=await rootSession(),u=(await request('/toolbox/users',undefined,team)).body.users.find(u=>u.username==='supervisor');
 const teamAck={...ack,username:u.username,details:u.signoffDetails,profileRevision:u.profileRevision,mutationId:crypto.randomUUID(),signature:{...ack.signature,contentHash:hash(safetyAcknowledgementContent(v,{username:u.username,name:u.displayName,details:u.signoffDetails}))}};
 assert.equal((await request('/toolbox/safety-documents/'+id+'/acknowledge',teamAck,team)).status,200);assert.equal((await request(base,undefined,token)).body.acknowledgements.length,1);assert.equal((await request('/toolbox/safety-documents/'+id,undefined,team)).body.acknowledgements.length,2);
 await request('/logout',{},parent);assert.equal((await request('/session',undefined,token)).status,401);
});
