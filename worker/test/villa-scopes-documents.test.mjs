import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
let mf,admin,viewer;
const pdf=Buffer.from('%PDF-1.4\n'+'sample PDF data\n'.repeat(5000)+'%%EOF\n').toString('base64');
const record=id=>({ScopeEntryID:id,Stage:'5a',Villa:'00162',ScopeType:'Cladding',ScopeDescription:'Test',Colour:'Spruce',VillaPDFURL:'',ScopePDFURL:'',pos:[{POSystem:'Nexvia',PONumber:'00001',DocumentURL:''}]});
async function request(path,body,token=admin){const r=await mf.dispatchFetch('https://villas.test'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function current(id){return (await request('/villa-scopes/records')).body.records.find(r=>r.ScopeEntryID===id);}
async function create(id){const r=await request('/villa-scopes/records/'+id,{record:record(id),expectedRevision:0,mutationId:crypto.randomUUID()});assert.equal(r.status,200);}
function packet(entryId,extra={}){return {entryId,id:crypto.randomUUID(),kind:'villa',name:'Villa plan.pdf',data:pdf,expectedRevision:1,mutationId:crypto.randomUUID(),...extra};}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'villa-pdf-test',modules:true,script:fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8'),compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'InventoryStore',useSQLite:true}},kvNamespaces:['LEGACY_KV'],bindings:{SITE_ID:'villa-pdf-tests',MIGRATION_READY:'true',EMAIL_ENABLED:'false'}}]}));
 const hash=v=>createHash('sha256').update(v).digest('hex'),kv=await mf.getKVNamespace('LEGACY_KV');await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:hash('123456:admin:panelstock')},viewer:{pinHash:hash('654321:viewer:panelstock')}}));
 admin=(await request('/login',{username:'admin',pin:'123456',app:'web'},null)).body.token;
 await request('/admin/set-task-access',{targetUsername:'viewer',taskCode:'site.scopes.view',allowed:true});viewer=(await request('/login',{username:'viewer',pin:'654321',app:'web'},null)).body.token;
});
after(async()=>{await mf?.dispose()});
test('PDF uploads attach atomically, preserve exact bytes across chunks and retry only once',async()=>{
 await create('PDF-ONE');const body=packet('PDF-ONE');let r=await request('/villa-scopes/documents',body);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.entry._revision,2);assert.equal(r.body.entry.VillaPDFURL,'/villa-scopes/documents/'+body.id);
 r=await request('/villa-scopes/documents',body);assert.equal(r.body.duplicate,true);assert.equal((await current('PDF-ONE'))._revision,2);
 const path='/villa-scopes/documents/'+body.id;
 assert.equal((await request(path,undefined,null)).status,401);const read=await request(path,undefined,viewer);assert.equal(read.status,200);assert.equal(read.body.file.data,pdf);assert.equal(read.body.file.name,'Villa plan.pdf');
 assert.equal((await request('/villa-scopes/documents',{...body,name:'changed.pdf'})).status,409);
});
test('viewer and report sessions cannot upload; invalid and stale uploads leave the record unchanged',async()=>{
 await create('PDF-TWO');const body=packet('PDF-TWO');assert.equal((await request('/villa-scopes/documents',body,viewer)).status,403);
 for(const extra of [{name:'bad.html'},{data:Buffer.from('<html>not a PDF</html>').toString('base64')},{expectedRevision:9},{kind:'po',system:'Nexvia',poNumber:'missing'}]){const r=await request('/villa-scopes/documents',{...body,...extra});assert.ok([400,409,422].includes(r.status),JSON.stringify(r));assert.equal((await current('PDF-TWO'))._revision,1);}
 const ticket=(await request('/villa-scopes/session-ticket',{app:'web',view:'report'})).body.ticket;const session=(await request('/villa-scopes/session',{ticket,app:'web'},null)).body.token;assert.equal((await request('/villa-scopes/documents',body,session)).status,403);
 const oversized=packet('PDF-TWO',{data:'A'.repeat(4*Math.ceil(5*1024*1024/3)+4)});assert.equal((await request('/villa-scopes/documents',oversized)).status,413);
});
test('private iPad links can open attached PDFs but revocation, replacements and deletion stop access',async()=>{
 await create('PDF-THREE');const upload=packet('PDF-THREE',{kind:'po',system:'Nexvia',poNumber:'00001'});assert.equal((await request('/villa-scopes/documents',upload)).status,200);
 const token='a'.repeat(64);assert.equal((await request('/villa-scopes/report-link',{action:'create',token,expectedRevision:0})).status,200);
 const path='/villa-scopes/report-documents/'+upload.id;assert.equal((await request(path,undefined,token)).body.file.data,pdf);
 assert.equal((await request('/villa-scopes/documents/'+upload.id,undefined,token)).status,401);
 await request('/villa-scopes/report-link',{action:'revoke',expectedRevision:1});assert.equal((await request(path,undefined,token)).status,401);
 const replacement=packet('PDF-THREE',{kind:'po',system:'Nexvia',poNumber:'00001',expectedRevision:2});assert.equal((await request('/villa-scopes/documents',replacement)).status,200);assert.equal((await request('/villa-scopes/documents/'+upload.id)).status,404);
 await request('/villa-scopes/records/PDF-THREE/delete',{expectedRevision:3,mutationId:crypto.randomUUID()});assert.equal((await request('/villa-scopes/documents/'+replacement.id)).status,404);
});
test('saved/imported PDF references must belong to the scope being edited',async()=>{
 await create('PDF-FOUR');const upload=packet('PDF-FOUR');await request('/villa-scopes/documents',upload);await create('PDF-FIVE');const r=await request('/villa-scopes/records/PDF-FIVE',{record:{...record('PDF-FIVE'),VillaPDFURL:'/villa-scopes/documents/'+upload.id},expectedRevision:1,mutationId:crypto.randomUUID()});assert.equal(r.status,400);assert.equal((await current('PDF-FIVE')).VillaPDFURL,'');
});

test('scope PDFs attach separately without changing the villa or PO reference',async()=>{
 await create('PDF-SCOPE');const body=packet('PDF-SCOPE',{kind:'scope'});const response=await request('/villa-scopes/documents',body);assert.equal(response.status,200);const saved=await current('PDF-SCOPE');assert.equal(saved.ScopePDFURL,'/villa-scopes/documents/'+body.id);assert.equal(saved.VillaPDFURL,'');assert.equal(saved.pos[0].DocumentURL,'');
});
