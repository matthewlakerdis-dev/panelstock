import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {createQaReportPdf} from '../src/qa-report-pdf.js';

const corruptPng='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const validPng='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const jpeg='data:image/jpeg;base64,'+fs.readFileSync(new URL('../assets/prestart-logo.jpg',import.meta.url)).toString('base64');
const webp='data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const attempt=(overrides={})=>({id:'approved-attempt',status:'approved',checkedBy:'Original inspector',checkedAt:'2026-11-08T23:00:00Z',results:{finish:'pass'},notes:'Approved without reopening.',photo:validPng,...overrides});
const addition=(overrides={})=>({id:'addition-later',attemptId:'approved-attempt',photos:[webp],addedBy:'Later uploader',addedAt:'2026-11-09T01:00:00Z',mutationId:'upload-mutation',...overrides});
function report(history,latest=history.at(-1),photoAdditions=[]){return {project:'Photo project',orderNumber:'007',generatedAt:'2026-11-09T02:00:00Z',generatedBy:'Office QA',checklists:{panel:[['finish','Finish is free from damage']]},items:[{id:'panel-original',kind:'panel',sheetNumber:'1',reference:'P-1',status:'approved',cutBy:'CNC operator',cutAt:'2026-11-08T22:00:00Z',history,latest,photoAdditions}]};}

async function rendered(bytes){
  const pdf=await PDFDocument.load(bytes),glyphs=new Map(),attachments=[];
  for(const [,object]of pdf.context.enumerateIndirectObjects()){
    if(!(object instanceof PDFRawStream)||object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image')continue;
    const decoded=decodePDFRawStream(object).decode();
    if(object.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile'){attachments.push({mime:object.dict.get(PDFName.of('Subtype'))?.toString().slice(1).replace(/#([0-9a-f]{2})/gi,(_,code)=>String.fromCharCode(parseInt(code,16))),bytes:decoded});continue;}
    const source=new TextDecoder().decode(decoded);
    for(const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,glyph,unicode]of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))glyphs.set(glyph.toUpperCase(),(unicode.match(/.{4}/g)||[]).map(hex=>String.fromCharCode(parseInt(hex,16))).join(''));
  }
  const pages=pdf.getPages().map(page=>{
    const contents=page.node.Contents(),streams=contents instanceof PDFRawStream?[contents]:(contents?.asArray()||[]).map(ref=>pdf.context.lookup(ref));
    return streams.flatMap(stream=>[...new TextDecoder().decode(decodePDFRawStream(stream).decode()).matchAll(/<([0-9A-F]+)>\s*Tj/gi)].map(([,hex])=>(hex.match(/.{4}/g)||[]).map(code=>glyphs.get(code.toUpperCase())||'').join(''))).join('\n');
  });
  const details=attachments.filter(file=>file.mime==='text/plain').map(file=>new TextDecoder().decode(file.bytes)).join('\n');
  return {pdf,pages,details,attachments};
}
function pageImageWidths(pdf){
  const objects=pdf.getPages()[0].node.Resources().lookup(PDFName.of('XObject'));
  return objects.entries().map(([,ref])=>pdf.context.lookup(ref).dict.get(PDFName.of('Width'))?.asNumber());
}

test('all base and added originals attach once while primary evidence and original approval stay unchanged',async()=>{
  const original=attempt({photos:[validPng,jpeg]}),input=report([original],structuredClone(original),[addition({photos:[webp,validPng]})]),before=JSON.stringify(input),{pdf,pages,details,attachments}=await rendered(await createQaReportPdf(input));
  assert.equal(JSON.stringify(input),before);assert.equal(pdf.getPageCount(),1);
  const images=attachments.filter(file=>file.mime.startsWith('image/'));
  assert.equal(images.length,3);
  for(const source of [validPng,jpeg,webp])assert.equal(images.filter(file=>Buffer.from(file.bytes).equals(Buffer.from(source.split(',')[1],'base64'))).length,1);
  assert.ok(pageImageWidths(pdf).includes(1),'Original one-pixel PNG remains the inline primary photo');
  assert.match(pages[0],/Original inspector/);assert.match(pages[0],/Approved/);assert.match(pages[0],/09-11-2026 09:00 AEST/);assert.match(pages[0],/3 photos attached/);assert.doesNotMatch(pages[0],/Later uploader/);
  assert.match(details,/ORIGINAL EVIDENCE REGISTER/);assert.match(details,/Source: Added after inspection/);assert.match(details,/Added by: Later uploader/);assert.match(details,/09-11-2026 11:00 AEST/);assert.match(details,/Mutation ID: upload-mutation/);
  assert.equal((details.match(/PHOTO ADDITION 1\n/g)||[]).length,1);
  assert.equal((details.match(/INSPECTION 1 — LATEST/g)||[]).length,1);
  assert.match(details,/Latest inspection: 1 of 1/);assert.match(details,/Attempt Id: approved-attempt/);assert.doesNotMatch(details,/data:image\//);
});

test('historical added evidence stays linked to its specific inspection and does not replace the latest gallery',async()=>{
  const older=attempt({id:'failed-attempt',status:'recut',photo:jpeg,results:{finish:'fail'},notes:'Historical failure.'}),latest=attempt(),input=report([older,latest],structuredClone(latest),[addition({attemptId:'failed-attempt',id:'historical-upload'})]),before=JSON.stringify(input),{pdf,pages,details,attachments}=await rendered(await createQaReportPdf(input));
  assert.equal(JSON.stringify(input),before);assert.equal(pdf.getPageCount(),1);assert.ok(pageImageWidths(pdf).includes(1));assert.doesNotMatch(pages[0],/WebP|Historical failure|Later uploader/);
  const first=details.slice(details.indexOf('INSPECTION 1\n'),details.indexOf('INSPECTION 2 — LATEST'));
  const second=details.slice(details.indexOf('INSPECTION 2 — LATEST'));
  assert.match(first,/ADDITIONAL EVIDENCE FOR THIS INSPECTION/);assert.match(first,/Addition: historical-upload/);assert.doesNotMatch(second,/historical-upload/);
  assert.match(details,/Inspection: failed-attempt/);assert.match(details,/Added by: Later uploader/);
  assert.ok(attachments.some(file=>file.mime==='image/webp'&&Buffer.from(file.bytes).equals(Buffer.from(webp.split(',')[1],'base64'))));
});

test('an added photo supplies a thumbnail for a previously photo-free approval without changing its inspection',async()=>{
  const original=attempt({photo:''}),input=report([original],structuredClone(original),[addition({photos:[validPng]})]),before=JSON.stringify(input),{pdf,pages,details}=await rendered(await createQaReportPdf(input));
  assert.equal(JSON.stringify(input),before);assert.equal(pdf.getPageCount(),1);assert.ok(pageImageWidths(pdf).includes(1));
  assert.match(pages[0],/QA photo · Added after inspection/);assert.match(pages[0],/Added by Later uploader/);assert.match(pages[0],/09-11-2026 11:00 AEST/);
  assert.match(pages[0],/Original inspector/);assert.match(pages[0],/09-11-2026 09:00 AEST/);assert.match(pages[0],/Approved without reopening/);assert.doesNotMatch(pages[0],/Original: QA_Photo/);
  assert.match(details,/PHOTO ADDITIONS — RECORDED AFTER INSPECTION/);assert.match(details,/Added By: Later uploader/);assert.match(details,/INSPECTION 1 — LATEST/);assert.match(details,/Inspection status: Approved/);
});

test('corrupt historical additions fail export explicitly rather than dropping later evidence',async()=>{
  const older=attempt({id:'old-attempt',photo:''}),latest=attempt(),input=report([older,latest],latest,[addition({attemptId:'old-attempt',photos:[corruptPng]})]);
  await assert.rejects(createQaReportPdf(input),/QA evidence photo for panel P-1 could not be opened/);
});
