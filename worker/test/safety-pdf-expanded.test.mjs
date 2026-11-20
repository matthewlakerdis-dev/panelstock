import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import UPNG from '@pdf-lib/upng';
import {PDFDocument,PDFName,PDFDict,PDFArray,decodePDFRawStream,StandardFonts} from 'pdf-lib';
import {createSignedSafetyPdf} from '../src/safety-pdf.js';
import {fillExpandedSafetySignoff} from '../src/safety-pdf-expanded.js';
import {safetyPdfLicenceRows} from '../src/safety-pdf-licences.js';

const font=fs.readFileSync(new URL('../assets/DejaVuSans.ttf',import.meta.url));
function png(red){const pixels=new Uint8Array(120*30*4);for(let y=10;y<20;y++)for(let x=10;x<110;x++){const i=(y*120+x)*4;pixels[i]=red;pixels[i+1]=25;pixels[i+2]=50;pixels[i+3]=255;}return 'data:image/png;base64,'+Buffer.from(UPNG.default.encode([pixels.buffer],120,30,0)).toString('base64');}
const managerImage=png(20),workerImage=png(150);
const columns={name:[50,90],role:[140,100],type:[240,90],class:[330,90],number:[420,90],date:[510,80],signature:[590,140]};
const table={page:2,width:792,height:612,columns,rows:[0,1,2].map(i=>({top:200+i*36,height:36,needsConstructionCardLabel:true,licenceRows:[0,1,2].map(j=>({top:200+i*36+j*12,height:12}))}))};
const supervisor={page:1,width:792,height:612,name:'Eugene Molenaar',label:'Signature',rect:[120,170,300,20],username:'eugene'};
function version(pages=[table]){return {id:'version',documentId:'document',title:'SWMS test',label:'Rev 01',fileHash:'a'.repeat(64),signoff:{layout:'lf-swms-detected-v1',pages,supervisors:[supervisor],statement:'Read and understood.'}};}
const licences=count=>Array.from({length:count},(_,i)=>({description:i?'Licence '+String(i+1).padStart(2,'0'):'White Card',class:'C'+i,number:'LIC-'+String(i+1).padStart(2,'0')}));
function ack(v,count,username='eugene'){return {id:'ack-'+username,username,name:username==='eugene'?'Eugene Molenaar':'Ben Hobson',documentId:v.documentId,versionId:v.id,fileHash:v.fileHash,signoff:structuredClone(v.signoff),details:{role:username==='eugene'?'Factory Manager':'Fabricator',allLicences:licences(count)},signature:{image:username==='eugene'?managerImage:workerImage,at:'2026-11-20T00:00:00Z',contentHash:'b'.repeat(64)}};}
async function source(){const pdf=await PDFDocument.create(),f=await pdf.embedFont(StandardFonts.Helvetica);for(let i=0;i<3;i++){const page=pdf.addPage([792,612]);page.drawText('ORIGINAL HEADER '+(i+1),{font:f,x:50,y:550,size:10});page.drawText('ORIGINAL FOOTER '+(i+1),{font:f,x:50,y:40,size:10});}return pdf.save();}
function content(pdf,page){const contents=page.node.Contents();if(!contents)return '';const refs=contents instanceof PDFArray?contents.asArray():[contents];return refs.map(ref=>Buffer.from(decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString()).join('\n');}
function writtenText(pdf,page){
 const fonts=new Map();
 for(const [name,ref] of page.node.Resources().lookup(PDFName.of('Font'),PDFDict).entries()){
  const unicode=pdf.context.lookup(ref).get(PDFName.of('ToUnicode'));if(!unicode)continue;
  const cmap=Buffer.from(decodePDFRawStream(pdf.context.lookup(unicode)).decode()).toString(),chars=new Map();
  for(const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,from,to] of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))chars.set(from.toUpperCase(),String.fromCharCode(...to.match(/.{4}/g).map(code=>parseInt(code,16))));
  fonts.set(name.toString(),chars);
 }
 const values=[];let fontName='';
 for(const match of content(pdf,page).matchAll(/(\/[^\s]+)\s+[\d.]+\s+Tf|<([0-9A-F]+)>\s*Tj/gi)){
  if(match[1])fontName=match[1];else if(fonts.has(fontName))values.push(match[2].match(/.{4}/g).map(code=>fonts.get(fontName).get(code.toUpperCase())||'').join(''));
 }
 return values;
}
function images(pdf,page){return page.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict)?.entries().map(([,ref])=>pdf.context.lookup(ref)).filter(o=>o.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image')||[];}

test('four licence rows expand within the same table without losing the next worker or supervisor signature',async()=>{
 const v=version(),bytes=await source(),before=Buffer.from(bytes),acks=[ack(v,4),ack(v,3,'ben')],snapshot=JSON.stringify(acks),pdf=await PDFDocument.load(await createSignedSafetyPdf(bytes,v,acks,font));
 assert.equal(pdf.getPageCount(),3);const text=writtenText(pdf,pdf.getPage(1));
 for(const value of ['Eugene Molenaar','Factory Manager','Ben Hobson','Fabricator','LIC-04'])assert.equal(text.filter(t=>t===value).length,1,value+' appears once');
 assert.equal(text.filter(t=>t==='20-11-2026').length,2);assert.equal(text.filter(t=>t==='LIC-01').length,2);
 assert.equal(images(pdf,pdf.getPage(0)).length,1);assert.equal(images(pdf,pdf.getPage(1)).length,2);
 assert.deepEqual(decodePDFRawStream(images(pdf,pdf.getPage(0))[0]).decode(),decodePDFRawStream(images(pdf,pdf.getPage(1))[0]).decode());
 assert.notDeepEqual(decodePDFRawStream(images(pdf,pdf.getPage(1))[0]).decode(),decodePDFRawStream(images(pdf,pdf.getPage(1))[1]).decode());
 assert.equal(JSON.stringify(acks),snapshot);assert.deepEqual(Buffer.from(bytes),before);
 const original=await PDFDocument.load(bytes);for(let i=0;i<3;i++)assert.ok(content(pdf,pdf.getPage(i)).includes(content(original,original.getPage(i)).trim()),'Original page content is retained');
});

test('seven licences move the following worker to a blank continuation without duplicating the manager',async()=>{
 const v=version(),acks=[ack(v,7),ack(v,3,'ben')],pdf=await PDFDocument.load(await createSignedSafetyPdf(await source(),v,acks,font));
 assert.equal(pdf.getPageCount(),4);const text=pdf.getPages().map(page=>writtenText(pdf,page));
 assert.equal(text[1].filter(t=>t==='Eugene Molenaar').length,1);assert.ok(!text[1].includes('Ben Hobson'));
 assert.equal(text[3].filter(t=>t==='Ben Hobson').length,1);assert.ok(!text[3].includes('Eugene Molenaar'));
 for(let i=4;i<=7;i++)assert.equal(text.flat().filter(t=>t==='LIC-'+String(i).padStart(2,'0')).length,1);
 assert.equal(images(pdf,pdf.getPage(3)).length,1,'Continuation only contains the next worker signature, not a copied supervisor stamp');
});

test('fifty captured licences continue across pages exactly once with the same sign-off and preserved identity',async()=>{
 const v=version(),signed=ack(v,50),snapshot=JSON.stringify(signed),pdf=await PDFDocument.load(await createSignedSafetyPdf(await source(),v,[signed],font)),text=pdf.getPages().map(page=>writtenText(pdf,page));
 assert.equal(pdf.getPageCount(),8);for(let i=1;i<=50;i++)assert.equal(text.flat().filter(t=>t==='LIC-'+String(i).padStart(2,'0')).length,1,'Licence '+i+' is retained exactly once');
 for(const pageIndex of [1,3,4,5,6,7]){
  assert.equal(text[pageIndex].filter(t=>t==='Eugene Molenaar').length,1);assert.equal(text[pageIndex].filter(t=>t==='Factory Manager').length,1);assert.equal(text[pageIndex].filter(t=>t==='20-11-2026').length,1);
  assert.equal(images(pdf,pdf.getPage(pageIndex)).length,1);assert.deepEqual(decodePDFRawStream(images(pdf,pdf.getPage(pageIndex))[0]).decode(),decodePDFRawStream(images(pdf,pdf.getPage(0))[0]).decode());
  assert.equal(text[pageIndex].includes('Continued'),pageIndex!==1);
 }
 assert.equal(JSON.stringify(signed),snapshot);
});

test('captured licences below the old limit use all actual entries and do not invent a Construction Card',()=>{
 const actual=[{description:'Forklift',class:'LF',number:'F1'},{description:'EWP',class:'WP',number:'W2'},{description:'Dogging',class:'DG',number:'D3'}];
 assert.deepEqual(safetyPdfLicenceRows({allLicences:actual,licenceDescription:'Construction Card',licences:[{description:'Wrong',class:'',number:''}]}),actual);
 assert.deepEqual(safetyPdfLicenceRows({allLicences:[]}),Array.from({length:3},()=>({description:'',class:'',number:''})));
 assert.equal(safetyPdfLicenceRows({licenceDescription:'White Card',licenceNumber:'OLD',licences:[{description:'Forklift',number:'F1'},{description:'EWP',number:'W2'}]})[0].number,'OLD');
 assert.throws(()=>safetyPdfLicenceRows({allLicences:Array(51).fill(actual[0])}),/Invalid captured/);
});

test('long captured descriptions wrap into taller rows and retain their full text',async()=>{
 const v=version(),signed=ack(v,4),description='Advanced elevated work platform operation and emergency rescue procedures for complex industrial fabrication work';signed.details.allLicences[3].description=description;
 const pdf=await PDFDocument.load(await createSignedSafetyPdf(await source(),v,[signed],font)),text=pdf.getPages().flatMap(page=>writtenText(pdf,page));
 const start=text.findIndex(t=>t.startsWith('Advanced'));let joined='';for(let i=start;i<text.length&&joined.length<description.length;i++)joined+=(joined?' ':'')+text[i];
 assert.equal(joined,description);assert.equal(text.filter(t=>t==='LIC-04').length,1);
});

test('manual-layout exports also expand all licence rows and retain historical snapshots',async()=>{
 const v={...version(),signoff:{layout:'lf-swms-v1',firstPage:1,continuationPage:2}},manager=ack(v,50),old=ack(v,3,'ben');delete old.details.allLicences;old.details.licenceDescription='White Card';old.details.licenceNumber='OLD-CARD';old.details.licences=[{description:'Old Forklift',class:'LF',number:'OLD-FL'},{description:'Old EWP',class:'WP',number:'OLD-WP'}];
 const pdf=await PDFDocument.load(await createSignedSafetyPdf(await source(),v,[manager,old],font)),text=pdf.getPages().flatMap(page=>writtenText(pdf,page));
 for(let i=1;i<=50;i++)assert.equal(text.filter(t=>t==='LIC-'+String(i).padStart(2,'0')).length,1);
 for(const value of ['Ben Hobson','OLD-CARD','OLD-FL','OLD-WP'])assert.equal(text.filter(t=>t===value).length,1);
 assert.ok(pdf.getPageCount()>=3);assert.ok(text.includes('Continued'));
});

function recordingPdf(){
 const operations=[];const makePage=()=>({getWidth:()=>792,getHeight:()=>612,getRotation:()=>({angle:0}),drawText:(text,options)=>operations.push({kind:'text',text,...options}),drawRectangle:options=>operations.push({kind:'rectangle',...options}),drawLine:options=>operations.push({kind:'line',...options}),drawImage:(image,options)=>operations.push({kind:'image',...options})});
 const pages=[makePage(),makePage()],pdf={getPageCount:()=>pages.length,getPage:i=>pages[i],copyPages:async()=>{assert.equal(operations.length,0,'Blank pages copied before any content is drawn');return [makePage()];},addPage:page=>pages.push(page),embedPng:async()=>({width:120,height:30})};
 const font={getCharacterSet:()=>Array.from({length:95},(_,i)=>i+32),widthOfTextAtSize:(value,size)=>value.length*size/2};return {pdf,font,operations};
}

test('sparse table regions preserve the intervening source area and every painted field stays in its region',async()=>{
 const h=recordingPdf(),v=version([{...table,rows:[{top:200,height:36},{top:270,height:36}]}]);await fillExpandedSafetySignoff(h.pdf,h.font,v.signoff.pages,[ack(v,4),ack(v,3,'ben')]);
 for(const op of h.operations){
  if(op.kind==='rectangle'||op.kind==='image'){const top=612-op.y-op.height,bottom=612-op.y;assert.ok(bottom<=236+.01||top>=270-.01,'No painted rectangle or image crosses the source gap');}
  if(op.kind==='text')assert.ok(op.y>=612-236||op.y<=612-270,'No text enters the source gap');
 }
 assert.equal(h.operations.filter(op=>op.kind==='text'&&op.text==='LIC-04').length,1);
});

test('a supervisor field between separate table regions is filled only on the original page',async()=>{
 const v=version([{...table,rows:[{top:200,height:36},{top:270,height:36}]}]);v.signoff.supervisors=[{...supervisor,page:2,rect:[120,242,300,18]}];
 const original=await PDFDocument.load(await source()),printed=await original.embedFont(StandardFonts.Helvetica);original.getPage(1).drawText('SOURCE GAP CONTENT',{font:printed,size:8,x:500,y:360});const bytes=await original.save(),acks=[ack(v,4),ack(v,3,'ben')];
 const pdf=await PDFDocument.load(await createSignedSafetyPdf(bytes,v,acks,font));assert.equal(pdf.getPageCount(),4);
 assert.equal(images(pdf,pdf.getPage(1)).length,3,'Two manager licence blocks plus the original supervisor field');
 assert.equal(images(pdf,pdf.getPage(3)).length,1,'The copied table page only gains Ben’s signature');
 const retained=await PDFDocument.load(bytes);assert.ok(content(pdf,pdf.getPage(1)).includes(content(retained,retained.getPage(1)).trim()));
 const text=pdf.getPages().map(page=>writtenText(pdf,page));assert.equal(text[1].filter(value=>value==='Eugene Molenaar').length,2);assert.equal(text[3].filter(value=>value==='Ben Hobson').length,1);assert.ok(!text[3].includes('Eugene Molenaar'));
});

test('invalid expanded geometry fails before altering a source page',async()=>{
 for(const tableChange of [{columns:{...columns,role:[141,99]}},{columns:{...columns,role:[130,110]}},{rows:[{top:200,height:36},{top:230,height:36}]},{rows:[{top:600,height:36}]}]){
  const h=recordingPdf(),v=version([{...table,...tableChange}]);await assert.rejects(fillExpandedSafetySignoff(h.pdf,h.font,v.signoff.pages,[ack(v,4)]),/sign-off/);assert.equal(h.operations.length,0);
 }
});
