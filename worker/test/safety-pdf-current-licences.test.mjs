import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import UPNG from '@pdf-lib/upng';
import {PDFDocument,PDFName,PDFDict,PDFArray,decodePDFRawStream,StandardFonts} from 'pdf-lib';
import {createSignedSafetyPdf} from '../src/safety-pdf.js';

const font=fs.readFileSync(new URL('../assets/DejaVuSans.ttf',import.meta.url));
function png(red){const pixels=new Uint8Array(120*30*4);for(let y=10;y<20;y++)for(let x=10;x<110;x++){const i=(y*120+x)*4;pixels[i]=red;pixels[i+1]=25;pixels[i+2]=50;pixels[i+3]=255;}return 'data:image/png;base64,'+Buffer.from(UPNG.default.encode([pixels.buffer],120,30,0)).toString('base64');}
const managerImage=png(20),workerImage=png(150);
const columns={name:[50,90],role:[140,100],type:[240,90],class:[330,90],number:[420,90],date:[510,80],signature:[590,140]};
const table={page:2,width:792,height:612,columns,rows:Array.from({length:6},(_,i)=>({top:200+i*36,height:36,needsConstructionCardLabel:true,licenceRows:[0,1,2].map(j=>({top:200+i*36+j*12,height:12}))}))};
const supervisor={page:1,width:792,height:612,name:'Eugene Molenaar',label:'Signature',rect:[120,170,300,20],username:'eugene'};
function version(pages=[table]){return {id:'version',documentId:'document',title:'Factory SWMS',label:'Rev 01',fileHash:'a'.repeat(64),signoff:{layout:'lf-swms-detected-v1',pages,supervisors:[supervisor],statement:'Read and understood.'}};}
const licences=(count,prefix='NEW')=>Array.from({length:count},(_,i)=>({description:'Licence '+String(i+1).padStart(2,'0'),class:'C'+i,number:prefix+'-'+String(i+1).padStart(2,'0')}));
function ack(v,username='eugene',{legacy=false}={}){const details={role:username==='eugene'?'Factory Manager':'Fabricator',licenceDescription:'White Card',licenceClass:'General',licenceNumber:username+'-OLD-CARD',licences:[{description:'Forklift',class:'LF',number:username+'-OLD-FL'},{description:'EWP',class:'WP',number:username+'-OLD-WP'}]};if(!legacy)details.allLicences=[{description:details.licenceDescription,class:details.licenceClass,number:details.licenceNumber},...details.licences];return {id:'ack-'+username,username,name:username==='eugene'?'Eugene Molenaar':'Ben Hobson',documentId:v.documentId,versionId:v.id,fileHash:v.fileHash,signoff:structuredClone(v.signoff),details,signature:{image:username==='eugene'?managerImage:workerImage,at:'2026-11-20T00:00:00Z',contentHash:'b'.repeat(64)}};}
const updates=(a,count=1)=>({asOf:'2026-11-24T15:30:00Z',entries:[{acknowledgementId:a.id,username:a.username,licences:licences(count)}]});
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
const allText=pdf=>pdf.getPages().flatMap(page=>writtenText(pdf,page));
function images(pdf,page){return page.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict)?.entries().map(([,ref])=>pdf.context.lookup(ref)).filter(o=>o.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image')||[];}
const imageData=image=>decodePDFRawStream(image).decode();

test('current profile rows add a licence beside an older sign-off without presenting it as newly signed',async()=>{
 const v=version(),original=await source(),before=Buffer.from(original),manager=ack(v,'eugene',{legacy:true}),worker=ack(v,'ben'),acks=[manager,worker],extra=updates(manager),snapshot=JSON.stringify({acks,extra});
 const pdf=await PDFDocument.load(await createSignedSafetyPdf(original,v,acks,font,extra)),text=allText(pdf),joined=text.join(' ');
 assert.equal(pdf.getPageCount(),3);
 for(const value of ['eugene-OLD-CARD','eugene-OLD-FL','eugene-OLD-WP','ben-OLD-CARD','ben-OLD-FL','ben-OLD-WP','NEW-01'])assert.equal(text.filter(t=>t===value).length,1,value+' appears exactly once');
 assert.match(joined,/Current profile/);assert.match(joined,/Profile as at/);assert.match(joined,/Not part of original sign-off/);
 assert.equal(text.filter(t=>t==='20-11-2026').length,2,'Original signing dates remain');assert.equal(text.filter(t=>t==='25-11-2026').length,1,'Profile date uses Brisbane time');
 assert.equal(images(pdf,pdf.getPage(0)).length,1);assert.equal(images(pdf,pdf.getPage(1)).length,2,'The unsigned current-profile block has no signature image');
 assert.deepEqual(imageData(images(pdf,pdf.getPage(0))[0]),imageData(images(pdf,pdf.getPage(1))[0]));assert.notDeepEqual(imageData(images(pdf,pdf.getPage(1))[0]),imageData(images(pdf,pdf.getPage(1))[1]));
 assert.equal(JSON.stringify({acks,extra}),snapshot);assert.deepEqual(Buffer.from(original),before);
 const sourcePdf=await PDFDocument.load(original);for(let i=0;i<3;i++)assert.ok(content(pdf,pdf.getPage(i)).includes(content(sourcePdf,sourcePdf.getPage(i)).trim()));
});

test('fifty current-profile additions paginate without repeating the old signature or losing the following worker',async()=>{
 const v=version(),manager=ack(v),worker=ack(v,'ben'),extra=updates(manager,50),pdf=await PDFDocument.load(await createSignedSafetyPdf(await source(),v,[manager,worker],font,extra)),textByPage=pdf.getPages().map(page=>writtenText(pdf,page)),text=textByPage.flat();
 assert.ok(pdf.getPageCount()>3);
 for(let i=1;i<=50;i++)assert.equal(text.filter(t=>t==='NEW-'+String(i).padStart(2,'0')).length,1,'Added licence '+i+' appears once');
 for(const value of ['eugene-OLD-CARD','eugene-OLD-FL','eugene-OLD-WP','ben-OLD-CARD','ben-OLD-FL','ben-OLD-WP'])assert.equal(text.filter(t=>t===value).length,1);
 assert.equal(text.filter(t=>t==='20-11-2026').length,2,'Only original signed blocks carry the signature date');
 const updatePages=textByPage.map((values,index)=>({values,index})).filter(({values})=>values.some(t=>/^NEW-\d+$/.test(t)));
 assert.ok(updatePages.length>=2);
 for(const {values,index} of updatePages){const joined=values.join(' ');assert.match(joined,/Eugene Molenaar/);assert.match(joined,/Current profile/);assert.match(joined,/Not part of original sign-off/);assert.ok(values.includes('25-11-2026'));if(!values.includes('eugene-OLD-CARD')&&!values.includes('ben-OLD-CARD'))assert.equal(images(pdf,pdf.getPage(index)).length,0,'Continuation additions do not acquire a captured signature');}
 assert.equal(pdf.getPages().reduce((n,page)=>n+images(pdf,page).length,0),3,'Only manager, worker and original supervisor field have image signatures');
});

test('manual sign-off layouts show current additions while keeping the captured three-row data',async()=>{
 const v={...version(),signoff:{layout:'lf-swms-v1',firstPage:1,continuationPage:2}},manager=ack(v,'eugene',{legacy:true}),pdf=await PDFDocument.load(await createSignedSafetyPdf(await source(),v,[manager],font,updates(manager,4))),text=allText(pdf);
 for(const value of ['eugene-OLD-CARD','eugene-OLD-FL','eugene-OLD-WP','NEW-01','NEW-02','NEW-03','NEW-04'])assert.equal(text.filter(t=>t===value).length,1);
 assert.equal(text.filter(t=>t==='20-11-2026').length,1);assert.match(text.join(' '),/Current profile/);assert.match(text.join(' '),/Not part of original sign-off/);assert.equal(pdf.getPages().reduce((n,page)=>n+images(pdf,page).length,0),1);
});

test('long current-profile descriptions and licence numbers wrap without losing their contents',async()=>{
 const v=version(),manager=ack(v),extra=updates(manager),entry=extra.entries[0].licences[0];
 entry.description='Advanced elevated work platform rescue qualification '.repeat(3).slice(0,120);entry.number='LONG-'+'1234567890'.repeat(9)+'ABCDE';
 assert.equal(entry.number.length,100);
 const pdf=await PDFDocument.load(await createSignedSafetyPdf(await source(),v,[manager],font,extra)),text=allText(pdf),flattened=text.join('').replace(/\s/g,'');
 assert.ok(flattened.includes(entry.description.replace(/\s/g,'')));assert.ok(flattened.includes(entry.number));assert.match(text.join(' '),/Not part of original sign-off/);
 assert.equal(pdf.getPages().reduce((n,page)=>n+images(pdf,page).length,0),2,'Long current fields never gain a captured signature');
});

test('profile whitespace is normalized only for display and other control characters are rejected',async()=>{
 const v=version(),manager=ack(v),extra=updates(manager),entry=extra.entries[0].licences[0],original=await source();
 entry.description='  Crane\t\r\nLicence  ';entry.class=' CN\t';entry.number='NEW\n1';const snapshot=JSON.stringify(extra);
 const pdf=await PDFDocument.load(await createSignedSafetyPdf(original,v,[manager],font,extra)),text=allText(pdf);
 for(const value of ['Crane Licence','CN','NEW 1'])assert.ok(text.includes(value),value+' is readable');assert.equal(JSON.stringify(extra),snapshot,'Original profile text is not rewritten');
 for(const control of ['\u0000','\u0001','\u0008','\u000b','\u000c','\u000e','\u001f','\u007f'])for(const field of ['description','class','number']){
  const invalid=updates(manager);invalid.entries[0].licences[0][field]='A'+control+'B';await assert.rejects(createSignedSafetyPdf(original,v,[manager],font,invalid),/Invalid current profile licence/);
 }
});

test('an empty current-profile update preserves the ordinary signed export layout and contents',async()=>{
 const v=version(),manager=ack(v),original=await source(),baseline=await PDFDocument.load(await createSignedSafetyPdf(original,v,[manager],font)),updated=await PDFDocument.load(await createSignedSafetyPdf(original,v,[manager],font,{asOf:'2026-11-25T00:00:00Z',entries:[]}));
 assert.equal(updated.getPageCount(),baseline.getPageCount());for(let i=0;i<baseline.getPageCount();i++){assert.equal(content(updated,updated.getPage(i)),content(baseline,baseline.getPage(i)));assert.equal(images(updated,updated.getPage(i)).length,images(baseline,baseline.getPage(i)).length);}
 assert.doesNotMatch(allText(updated).join(' '),/Current profile|Profile as at/);
});

test('updates cannot be attached to an unknown acknowledgement, a different account or a different signed version',async()=>{
 const v=version();v.signoff.supervisors=[];const worker=ack(v,'ben'),original=await source(),base=updates(worker);
 for(const extra of [
  {...base,entries:[{...base.entries[0],acknowledgementId:'unknown'}]},
  {...base,entries:[{...base.entries[0],username:'eugene'}]},
  {...base,entries:[base.entries[0],base.entries[0]]}
 ])await assert.rejects(createSignedSafetyPdf(original,v,[worker],font,extra),/licence|profile|acknowledgement|update/i);
 for(const change of [{versionId:'other-version'},{documentId:'other-document'},{fileHash:'c'.repeat(64)},{signoff:{...v.signoff,statement:'Changed declaration'}}])await assert.rejects(createSignedSafetyPdf(original,v,[{...worker,...change}],font,base),/licence|profile|acknowledgement|version|update/i);
});

test('malformed dates and licence update rows are rejected instead of silently changing the signed export',async()=>{
 const v=version(),manager=ack(v),original=await source(),base=updates(manager);
 const invalid=[null,{}, {...base,asOf:'not-a-date'},{...base,entries:{}},{...base,entries:[null]},...[
  null,{},[],Array(51).fill(base.entries[0].licences[0]),[null],[{description:'',class:'LF',number:'NEW'}],[{description:'x'.repeat(121),class:'LF',number:'NEW'}],[{description:'Licence',class:'x'.repeat(19),number:'NEW'}],[{description:'Licence',class:'LF',number:'x'.repeat(101)}]
 ].map(licences=>({...base,entries:[{...base.entries[0],licences}]}))];
 for(const extra of invalid)await assert.rejects(createSignedSafetyPdf(original,v,[manager],font,extra),/licence|profile|update/i);
});

test('supervisor-only forms append clearly unsigned current licences without changing original source content',async()=>{
 const v=version([]),manager=ack(v),original=await source(),sourcePdf=await PDFDocument.load(original),pdf=await PDFDocument.load(await createSignedSafetyPdf(original,v,[manager],font,updates(manager,4))),text=allText(pdf);
 assert.ok(pdf.getPageCount()>3);for(let i=1;i<=4;i++)assert.equal(text.filter(t=>t==='NEW-'+String(i).padStart(2,'0')).length,1);
 assert.match(text.join(' '),/Current profile/);assert.match(text.join(' '),/Not part of original sign-off/);assert.ok(text.includes('25-11-2026'));
 for(let i=0;i<3;i++)assert.ok(content(pdf,pdf.getPage(i)).includes(content(sourcePdf,sourcePdf.getPage(i)).trim()));
 assert.equal(images(pdf,pdf.getPage(0)).length,1);for(let i=1;i<pdf.getPageCount();i++)assert.equal(images(pdf,pdf.getPage(i)).length,0,'Only the original supervisor field holds a signature image');
});
