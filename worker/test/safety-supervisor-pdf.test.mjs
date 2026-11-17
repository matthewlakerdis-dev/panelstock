import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import UPNG from '@pdf-lib/upng';
import {PDFDocument,PDFName,PDFDict,PDFArray,decodePDFRawStream,StandardFonts,degrees} from 'pdf-lib';
import {createSignedSafetyPdf} from '../src/safety-pdf.js';
import {fillSupervisorSignoff} from '../src/safety-pdf-supervisor.js';

const font=fs.readFileSync(new URL('../assets/DejaVuSans.ttf',import.meta.url));
const rgba=new Uint8Array(200*40*4);
for(let x=10;x<190;x++)for(let y=15;y<25;y++){const offset=(y*200+x)*4;rgba[offset]=20;rgba[offset+1]=30;rgba[offset+2]=40;rgba[offset+3]=255;}
const image='data:image/png;base64,'+Buffer.from(UPNG.default.encode([rgba.buffer],200,40,0)).toString('base64');
const supervisor=(overrides={})=>({page:1,width:792,height:612,name:'Eugene Molenaar',label:'Signature',rect:[120,170,300,20],username:'eugene',...overrides});
const table={page:2,width:792,height:612,columns:{name:[50,90],role:[140,100],type:[240,90],class:[330,90],number:[420,90],date:[510,80],signature:[590,140]},rows:[{top:200,height:36}]};
function version(fields=[supervisor()],pages=[]){return {id:'version-1',documentId:'document-1',title:'SWMS test',label:'Rev 01',fileHash:'a'.repeat(64),signoff:{layout:'lf-swms-detected-v1',pages,supervisors:fields,statement:'Read and understood.'}};}
function acknowledgement(v,username='eugene',overrides={}){return {id:'ack-'+username,username,name:'Eugene Molenaar',documentId:v.documentId,versionId:v.id,fileHash:v.fileHash,signoff:structuredClone(v.signoff),details:{role:'Factory Manager',licenceDescription:'Construction Card',licenceNumber:'TEST'},signature:{image,at:'2026-11-17T00:00:00.000Z',contentHash:'b'.repeat(64)},...overrides};}
async function source(count=2){const pdf=await PDFDocument.create(),printed=await pdf.embedFont(StandardFonts.Helvetica);for(let i=0;i<count;i++){const page=pdf.addPage([792,612]);page.drawText('ORIGINAL PAGE '+(i+1),{x:20,y:570,font:printed,size:10});}return pdf.save();}
const objects=(pdf,page)=>page.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict)?.entries().map(([,ref])=>pdf.context.lookup(ref))||[];
const images=(pdf,page)=>objects(pdf,page).filter(o=>o.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image');
function content(pdf,page){const contents=page.node.Contents();if(!contents)return '';const refs=contents instanceof PDFArray?contents.asArray():[contents];return refs.map(ref=>Buffer.from(decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString()).join('\n');}

test('supervisor-only detection stamps the exact account and preserves PNG transparency and source content',async()=>{
 const bytes=await source(),before=Buffer.from(bytes),v=version(),acks=[acknowledgement(v,'different-account'),acknowledgement(v)];
 const original=await PDFDocument.load(bytes),snapshot=JSON.stringify(acks),signed=await PDFDocument.load(await createSignedSafetyPdf(bytes,v,acks,font));
 assert.equal(signed.getPageCount(),2);assert.equal(images(signed,signed.getPage(0)).length,1);assert.equal(images(signed,signed.getPage(1)).length,0);
 assert.ok(images(signed,signed.getPage(0))[0].dict.get(PDFName.of('SMask')),'Transparent signature retains an alpha mask');
 assert.ok(content(signed,signed.getPage(0)).includes(content(original,original.getPage(0)).trim()),'Original text operators remain');
 assert.deepEqual(Buffer.from(bytes),before);assert.equal(JSON.stringify(acks),snapshot);
 assert.match(signed.getTitle(),/signed SWMS/);
});

test('pending supervisors stay blank and display-name matches cannot substitute for their account',async()=>{
 const bytes=await source(),v=version();
 for(const acks of [[],[acknowledgement(v,'same-name-other-user')]]){
  const signed=await PDFDocument.load(await createSignedSafetyPdf(bytes,v,acks,font));assert.equal(images(signed,signed.getPage(0)).length,0);
 }
});

test('stale or modified supervisor acknowledgements cannot be reused across documents, versions or sign-off setups',async()=>{
 const bytes=await source(),v=version();
 for(const change of [{versionId:'previous-version'},{documentId:'other-document'},{fileHash:'c'.repeat(64)},{signoff:undefined},{signoff:{...v.signoff,statement:'Different declaration'}}]){
  await assert.rejects(createSignedSafetyPdf(bytes,v,[acknowledgement(v,'eugene',change)],font),/does not match this SWMS version/);
 }
 await assert.rejects(createSignedSafetyPdf(bytes,v,[acknowledgement(v),acknowledgement(v)],font),/More than one acknowledgement/);
 for(const signature of [null,{image,at:'bad-date',contentHash:'b'.repeat(64)},{image:'not a PNG',at:'2026-11-17T00:00:00Z',contentHash:'b'.repeat(64)},{image,at:'2026-11-17T00:00:00Z',contentHash:'invalid'}]){
  await assert.rejects(createSignedSafetyPdf(bytes,v,[acknowledgement(v,'eugene',{signature})],font),/no valid captured signature/);
 }
});

test('one acknowledgement fills its measured fields on multiple pages without assuming page one',async()=>{
 const v=version([supervisor({page:2,rect:[80,100,250,30]}),supervisor({page:3,rect:[200,400,300,25]})]),signed=await PDFDocument.load(await createSignedSafetyPdf(await source(3),v,[acknowledgement(v)],font));
 assert.deepEqual(signed.getPages().map(p=>images(signed,p).length),[0,1,1]);
});

test('supervisor image remains inside its field with its original aspect ratio and no background overprint',async()=>{
 const draws=[],page={getWidth:()=>792,getHeight:()=>612,getRotation:()=>({angle:0}),drawImage:(image,options)=>draws.push(options)},pdf={getPageCount:()=>1,getPage:()=>page,embedPng:async()=>({width:200,height:40})},v=version();
 await fillSupervisorSignoff(pdf,v,[acknowledgement(v)]);assert.equal(draws.length,1);
 const d=draws[0];assert.equal(d.width/d.height,5);assert.ok(d.x>=122&&d.x+d.width<=418);assert.ok(d.y>=424&&d.y+d.height<=440);
});

test('invalid supervisor page geometry fails even before a signature is collected',async()=>{
 const bytes=await source();
 for(const field of [supervisor({page:0}),supervisor({page:3}),supervisor({page:1.5}),supervisor({width:800}),supervisor({height:NaN}),supervisor({rect:[-1,170,300,20]}),supervisor({rect:[120,600,300,20]}),supervisor({rect:[120,170,Infinity,20]}),supervisor({rect:[120,170,300,4]}),supervisor({rect:[120,170,300]}),supervisor({username:''})]){
  await assert.rejects(createSignedSafetyPdf(bytes,version([field]),[],font),/supervisor|Supervisor/);
 }
 await assert.rejects(createSignedSafetyPdf(bytes,version([supervisor(),supervisor({rect:[130,175,100,20]})]),[],font),/overlap/);
 const rotated=await PDFDocument.load(bytes);rotated.getPage(0).setRotation(degrees(90));await assert.rejects(createSignedSafetyPdf(await rotated.save(),version(),[],font),/dimensions changed/);
});

test('worker tables retain every acknowledgement and overflow without copying a supervisor stamp into continuation pages',async()=>{
 const bytes=await source(),v=version([supervisor({page:2,rect:[120,100,300,20]})],[table]),acks=[acknowledgement(v),acknowledgement(v,'worker-2'),acknowledgement(v,'worker-3')];
 const signed=await PDFDocument.load(await createSignedSafetyPdf(bytes,v,acks,font));
 assert.equal(signed.getPageCount(),4);assert.deepEqual(signed.getPages().map(p=>images(signed,p).length),[0,2,1,1]);
 const invalid=version([supervisor({page:3})],[table]);await assert.rejects(createSignedSafetyPdf(bytes,invalid,acks.map(a=>({...a,signoff:invalid.signoff})),font),/Invalid supervisor sign-off field/);
});

test('an empty detected setup still fails while older worker-only exports retain their existing contract',async()=>{
 const bytes=await source();await assert.rejects(createSignedSafetyPdf(bytes,version([],[]),[],font),/No detected sign-off fields/);
 const v=version([], [table]);delete v.signoff.supervisors;const legacy=[{name:'Existing worker',details:{licenceDescription:'Construction Card'},signature:{image,at:'2026-11-17T00:00:00Z'}}];
 const signed=await PDFDocument.load(await createSignedSafetyPdf(bytes,v,legacy,font));assert.equal(images(signed,signed.getPage(1)).length,1);
});
