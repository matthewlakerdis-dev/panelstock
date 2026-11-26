import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';

const site='qa-report-summary-test',origin='https://web.panelstockhq.com';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const jpeg='data:image/jpeg;base64,'+fs.readFileSync(new URL('../assets/prestart-logo.jpg',import.meta.url)).toString('base64');
const sha=value=>createHash('sha256').update(value).digest('hex');
const reference=value=>'qa-r2:v1:'+sha(value)+':'+value.length;
const selectors={project:'Timeout project',orderNumber:'107'};
let mf,storage,admin,team,records;

async function request(body,token=admin){
 const response=await mf.dispatchFetch('http://localhost/qa/report',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 return {status:response.status,headers:response.headers,body:await response.json()};
}
async function call(path,body,token){
 const response=await mf.dispatchFetch('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
async function save(key,value){
 await storage.exec('DELETE FROM documents WHERE key=?',key);
 await storage.exec('INSERT INTO documents(key,part,value) VALUES(?,0,?)',key,JSON.stringify(value));
}
async function reads(){return storage.exec('SELECT key FROM qa_report_probe_reads ORDER BY rowid');}
async function snapshot(){return {documents:await storage.exec('SELECT key,part,value FROM documents ORDER BY key,part'),audit:await storage.exec('SELECT * FROM audit ORDER BY id')};}
function evidenceAttachments(pdf){
 const files=[];
 for(const [,object]of pdf.context.enumerateIndirectObjects()){
  if(object instanceof PDFRawStream&&object.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile'&&object.dict.get(PDFName.of('Subtype'))?.toString().startsWith('/image'))files.push(Buffer.from(decodePDFRawStream(object).decode()));
 }
 return files;
}

before(async()=>{
 const bundle=fs.readFileSync(new URL('../dist/index.js',import.meta.url),'utf8');
 // Keep production authentication, report generation, PDF rendering and transport.
 // Count private evidence reads and freeze only the snapshot timestamp for a
 // byte-for-byte comparison of the two response representations.
 const script=bundle+`\nexport class QaReportProbe extends InventoryStore {
  constructor(ctx,env){
   const bucket=env.CAD_PROJECT_FILES;
   super(ctx,{...env,CAD_PROJECT_FILES:{head:(...args)=>bucket.head(...args),put:(...args)=>bucket.put(...args),get:(key,...args)=>{ctx.storage.sql.exec('INSERT INTO qa_report_probe_reads (key) VALUES (?)',key);return bucket.get(key,...args);}}});
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS qa_report_probe_reads (key TEXT)');
  }
  qaOrderReport(body,actor){const result=super.qaOrderReport(body,actor);result.body.report.generatedAt='2026-11-27T01:00:00Z';return result;}
 }`;
 mf=new Miniflare(convertV4MiniflareOptions({unsafeInspectDurableObjects:true,workers:[{name:site,modules:true,script,compatibilityDate:'2026-08-21',compatibilityFlags:['nodejs_compat'],durableObjects:{INVENTORY:{className:'QaReportProbe',useSQLite:true}},kvNamespaces:['LEGACY_KV'],r2Buckets:['CAD_PROJECT_FILES'],bindings:{SITE_ID:site,QA_MEDIA_ENABLED:'true',MIGRATION_READY:'true',EMAIL_ENABLED:'false',ALLOWED_ORIGINS:origin}}]}));
 const kv=await mf.getKVNamespace('LEGACY_KV');
 await kv.put('users',JSON.stringify({admin:{isAdmin:true,pinHash:sha('123456:admin:panelstock')},team:{isAdmin:false,pinHash:sha('654321:team:panelstock')}}));
 admin=(await call('/login',{username:'admin',pin:'123456'})).body.token;
 const tasks=(await call('/admin/users',{},admin)).body.tasks.map(task=>task.code);
 assert.equal((await call('/admin/set-task-access',{targetUsername:'team',taskCodes:tasks,allowed:false},admin)).status,200);
 assert.equal((await call('/admin/set-task-access',{targetUsername:'team',taskCode:'factory.qa',allowed:true},admin)).status,200);
 team=(await call('/login',{username:'team',pin:'654321'})).body.token;
 storage=await mf.unsafeGetDurableObjectStorage(site,'QaReportProbe',{name:site});
 const bucket=await mf.getR2Bucket('CAD_PROJECT_FILES');
 for(const photo of [png,jpeg])await bucket.put('qa-evidence/v1/'+site+'/'+sha(photo),photo);
 const panels=Array.from({length:3},(_,index)=>({id:'summary-panel-'+index,jobReference:selectors.project,orderNumber:selectors.orderNumber,sheetNumber:String(index+1),panelNumber:'P-'+index,status:'completed',completedAt:'2099-01-01T00:00:00Z',completedBy:'fabricator'}));
 records=panels.map(panel=>{
  const latest={id:panel.id+'-inspection',status:'approved',results:{finish:'pass'},notes:'Keep all current inspection notes',photo:reference(png),photos:[reference(png)],checkedBy:'inspector',checkedAt:'2026-11-26T01:00:00Z'};
  const previous={...latest,id:panel.id+'-previous',status:'recut',results:{finish:'fail'},notes:'Keep the earlier failure'};
  return {id:panel.id,kind:'panel',status:'approved',latest,history:[previous,latest],photoAdditions:[{id:panel.id+'-supplement',attemptId:latest.id,photos:[reference(jpeg)],addedBy:'photo-team',addedAt:'2026-11-26T02:00:00Z',mutationId:panel.id+'-upload'}]};
 });
 await save('app:cncPanels',panels);await save('qa-checks',records);
});
after(async()=>{await mf?.dispose();});

test('summary report builds the complete PDF once without re-reading evidence into its JSON response',async()=>{
 await storage.exec('DELETE FROM qa_report_probe_reads');
 const before=await snapshot(),summary=await request({...selectors,includePdf:true,responseView:'summary'});
 assert.equal(summary.status,200,summary.body.error);
 assert.equal((await reads()).length,2,'PDF reads each unique source exactly once, with no later JSON evidence reads');
 assert.equal(summary.body.report.evidenceLoaded,false);
 assert.equal(summary.body.report.items.length,3);
 assert.deepEqual(summary.body.report.items.map(item=>item.reference),['P-0','P-1','P-2']);
 for(const [index,item]of summary.body.report.items.entries()){
  assert.equal(item.evidenceLoaded,false);assert.equal(item.hasPhotoEvidence,true);
  assert.equal(item.latest.photoCount,2);assert.equal(item.history[0].photoCount,1);assert.equal(item.photoAdditions[0].photoCount,1);
  assert.equal(item.latest.notes,records[index].latest.notes);assert.deepEqual(item.latest.results,records[index].latest.results);
  assert.equal(item.history[0].notes,records[index].history[0].notes);assert.equal(item.photoAdditions[0].addedBy,'photo-team');
 }
 assert.doesNotMatch(JSON.stringify(summary.body.report),/data:image\/|qa-r2:v1:|"photos?":/);
 assert.ok(JSON.stringify(summary.body.report).length<15000);
 assert.equal(summary.body.pdf.mime,'application/pdf');
 const bytes=Buffer.from(summary.body.pdf.data,'base64'),pdf=await PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),3);
 const attachments=evidenceAttachments(pdf);
 assert.equal(attachments.length,2);
 assert.deepEqual(attachments.map(value=>sha(value)).sort(),[png,jpeg].map(value=>sha(Buffer.from(value.split(',')[1],'base64'))).sort());
 assert.deepEqual(await snapshot(),before,'report generation keeps production documents and audit read-only');
 await storage.exec('DELETE FROM qa_report_probe_reads');
 const legacy=await request({...selectors,includePdf:true});
 assert.equal(legacy.status,200,legacy.body.error);
 assert.ok((await reads()).length>2,'legacy response still resolves its original evidence fields');
 assert.deepEqual(Buffer.from(legacy.body.pdf.data,'base64'),bytes,'response projection leaves the complete PDF unchanged');
 assert.equal(legacy.body.report.evidenceLoaded,undefined);
 assert.equal(legacy.body.report.items[0].latest.photo,png);
 assert.deepEqual(legacy.body.report.items[0].photoAdditions[0].photos,[jpeg]);
 assert.ok(JSON.stringify(legacy.body.report).length>JSON.stringify(summary.body.report).length*3);
 assert.deepEqual(await snapshot(),before);
 assert.equal(summary.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(summary.headers.get('Cache-Control'),'no-store');
});

test('summary view keeps administrator authorization and requires a complete PDF request',async()=>{
 const before=await snapshot();
 assert.equal((await request({...selectors,includePdf:true,responseView:'summary'},null)).status,401);
 assert.equal((await request({...selectors,includePdf:true,responseView:'summary'},team)).status,403);
 for(const responseView of [null,'invalid',{},true])assert.equal((await request({...selectors,includePdf:true,responseView})).status,400);
 for(const includePdf of [undefined,false,'true'])assert.equal((await request({...selectors,includePdf,responseView:'summary'})).status,400);
 const legacy=await request({...selectors,responseView:'full'});assert.equal(legacy.status,200);assert.equal(legacy.body.pdf,undefined);assert.equal(legacy.body.report.items[0].latest.photo,png);
 assert.deepEqual(await snapshot(),before);
});

test('missing saved evidence fails the report without returning a PDF or partial summary',async()=>{
 const bucket=await mf.getR2Bucket('CAD_PROJECT_FILES');
 await bucket.delete('qa-evidence/v1/'+site+'/'+sha(png));
 const before=await snapshot(),response=await request({...selectors,includePdf:true,responseView:'summary'});
 assert.equal(response.status,422);assert.match(response.body.error,/evidence.*unavailable/i);
 assert.equal(response.body.pdf,undefined);assert.equal(response.body.report,undefined);
 assert.deepEqual(await snapshot(),before);
});
