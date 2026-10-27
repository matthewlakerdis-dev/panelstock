import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {createQaReportPdf,qaReportPdfFilename} from '../src/qa-report-pdf.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const webp='data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const generatedAt='2026-10-27T01:00:00Z';
function report(){return {project:'Lennox façades',orderNumber:'007',generatedAt,generatedBy:'Office QA',checklists:{panel:[['finish','Finish is free from damage'],['dimensions','Dimensions match the drawing']]},items:[{id:'original-panel',kind:'panel',sheetNumber:'1',reference:'P-1',quantity:1,material:'Aluminium',colour:'Charcoal',thickness:3,width:1200,height:2400,cutBy:'CNC operator',cutAt:'2026-10-26T21:00:00Z',status:'replaced',replacementId:'replacement-panel',replacementReference:'P-1R',replacementStatus:'approved',history:[{id:'initial-check',status:'recut',checkedBy:'First reviewer',checkedAt:'2026-10-26T22:00:00Z',results:{finish:'fail',removedCheck:'na'},notes:'Initial scratch — replacement required.',overrideReason:'Reviewed with supervisor',photo:png}]},{id:'replacement-panel',sheetNumber:'2',reference:'P-1R',status:'approved',isRemake:true,remakeOf:'original-panel',remakeOfReference:'P-1',remakeReason:'Replace damaged finish',latest:{id:'replacement-check',status:'approved',checkedBy:'Final reviewer',checkedAt:'2026-10-27T00:00:00Z',results:{finish:'pass',dimensions:'pass'},notes:'Façade café – Δοκιμή'}},{id:'pending-panel',sheetNumber:'3',reference:'P-2',status:'awaiting_routing'},{id:'legacy-panel',sheetNumber:'4',reference:'P-3',status:'pre_qa'},{id:'separate-panel',sheetNumber:'5',reference:'P-4',status:'replaced',resolvedSeparatelyAt:'2026-10-27T00:30:00Z',resolvedSeparatelyBy:'Recut operator',resolvedSeparatelyReason:'Programmed separately'}]};}

async function rendered(bytes){
  const pdf=await PDFDocument.load(bytes),glyphs=new Map(),images=[],attachments=[];
  for(const [,object]of pdf.context.enumerateIndirectObjects()){
    if(!(object instanceof PDFRawStream))continue;
    if(object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image'){images.push(object);continue;}
    if(object.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile'){attachments.push(decodePDFRawStream(object).decode());continue;}
    const source=new TextDecoder().decode(decodePDFRawStream(object).decode());
    for(const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,glyph,unicode]of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))glyphs.set(glyph.toUpperCase(),(unicode.match(/.{4}/g)||[]).map(hex=>String.fromCharCode(parseInt(hex,16))).join(''));
  }
  const pages=pdf.getPages().map(page=>{
    const contents=page.node.Contents(),streams=contents instanceof PDFRawStream?[contents]:(contents?.asArray()||[]).map(ref=>pdf.context.lookup(ref));
    return streams.flatMap(stream=>[...new TextDecoder().decode(decodePDFRawStream(stream).decode()).matchAll(/<([0-9A-F]+)>\s*Tj/gi)].map(([,hex])=>(hex.match(/.{4}/g)||[]).map(code=>glyphs.get(code.toUpperCase())||'').join(''))).join('\n');
  });
  return {pdf,pages,text:pages.join('\n'),images,attachments};
}

test('Lennox QA PDF embeds branding, Unicode font, source snapshot metadata and every panel phase/history',async()=>{
  const r=report(),before=JSON.stringify(r),{pdf,pages,text,images}=await rendered(await createQaReportPdf(r));
  assert.equal(JSON.stringify(r),before);
  assert.equal(pdf.getTitle(),'Lennox Facades — Order QA Report — Lennox façades — Order 007');
  assert.equal(pdf.getAuthor(),'Lennox Facades');assert.equal(pdf.getCreator(),'PanelStock QA');assert.equal(pdf.getCreationDate().toISOString(),generatedAt.replace('Z','.000Z'));
  assert.ok(images.length>=2,'Brand logo and QA evidence are embedded');
  for(const value of ['Lennox façades','007','Office QA','27-10-2026 11:00 AEST','5 panels','Replaced · QA approved','Awaiting routing','Pre-QA','P-1R','P-2','P-3','P-4','original-panel','replacement-panel','Initial scratch — replacement required.','Reviewed with supervisor','First reviewer','Final reviewer','removedCheck','N/A','Façade café – Δοκιμή','Recut completed separately by Recut operator','Programmed separately'])assert.ok(text.includes(value),value);
  for(const [index,page]of pages.entries()){assert.match(page,/ORDER QA REPORT/);assert.match(page,/Lennox Facades · Order QA report/);assert.ok(page.includes(`${index+1} / ${pages.length}`));}
  for(const page of pdf.getPages()){assert.equal(page.getWidth(),842);assert.equal(page.getHeight(),595);}
  assert.equal(qaReportPdfFilename({project:'Lennox / East',orderNumber:'007'}),'QA_Report_Lennox_East_Order_007.pdf');
});

test('long checklist labels and Unicode notes paginate without omitting endings or losing panel/inspection context',async()=>{
  const r=report();r.items=[r.items[1]];
  r.checklists.panel[0][1]='Long checklist point '+Array.from({length:400},(_,i)=>'acceptance-'+i).join(' ')+' FINAL CHECK LABEL';
  r.items[0].latest.notes=Array.from({length:120},(_,i)=>`Line ${i+1}: façade finish and dimensions reviewed.`).join('\n')+'\n'+('X'.repeat(700))+'\nFINAL INSPECTION NOTE';
  const {pages,text}=await rendered(await createQaReportPdf(r));
  assert.ok(pages.length>3);assert.match(text,/FINAL CHECK LABEL/);assert.match(text,/Line 120:/);assert.match(text,/FINAL INSPECTION NOTE/);assert.equal((text.match(/X/g)||[]).length,700);
  assert.ok(pages.slice(1).every(page=>page.includes('Panel P-1R')&&page.includes('Inspection 1')));
  assert.doesNotMatch(pages[1],/continued/);
  assert.match(pages[2],/continued/);assert.match(pages[2],/Inspection check/);assert.match(pages[2],/Result/);
});

test('WebP evidence is preserved as an original attachment and explicitly identified in the PDF',async()=>{
  const r=report();r.items=[r.items[0]];r.items[0].history[0].photo=webp;
  const {attachments,text}=await rendered(await createQaReportPdf(r));
  assert.equal(attachments.length,1);assert.deepEqual(Buffer.from(attachments[0]),Buffer.from(webp.split(',')[1],'base64'));
  assert.match(text,/Original WebP evidence is included as a file attachment/);assert.match(text,/QA_Evidence_001\.webp/);
});

test('corrupt photos fail the PDF visibly instead of omitting evidence',async()=>{
  const r=report();r.items[0].history[0].photo='data:image/png;base64,aGVsbG8=';
  await assert.rejects(createQaReportPdf(r),/QA evidence photo for panel P-1 could not be opened/);
});
