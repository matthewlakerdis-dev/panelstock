import {test} from 'node:test';
import assert from 'node:assert/strict';
import Upng from '@pdf-lib/upng';
import {PDFDocument,PDFName,PDFDict,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {createQaReportPdf} from '../src/qa-report-pdf.js';

const generatedAt='2026-10-27T01:00:00Z';
const checks=[['material','Material matches order'],['dimensions','Dimensions match drawing'],['finish','Finish free from damage'],['edges','Edges finished'],['folds','Folds match drawing'],['holes','Holes checked'],['film','Protective film applied'],['label','Label matches panel']];
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function secondPhoto(){const codec=Upng.default||Upng,rgba=new Uint8Array([30,80,120,255,60,100,140,255]);return 'data:image/png;base64,'+Buffer.from(codec.encode([rgba.buffer],2,1,0)).toString('base64');}
function panel(index,extra={}){
  const reference=`PANEL-${String(index).padStart(3,'0')}`,sheetNumber=`SHEET-${String(index).padStart(3,'0')}`;
  const latest={id:`inspection-${index}`,status:'approved',checkedBy:`Reviewer ${index}`,checkedAt:'2026-10-27T00:00:00Z',results:Object.fromEntries(checks.map(([key])=>[key,key==='holes'?'na':'pass'])),notes:`Ordinary inspection note for ${reference}.`};
  return {id:`panel-record-${index}`,kind:'panel',reference,sheetNumber,quantity:1,material:'Aluminium',colour:'Charcoal',thickness:3,width:1200,height:2400,cutBy:`CNC operator ${index}`,cutAt:'2026-10-26T21:00:00Z',status:'approved',history:[latest],latest,...extra};
}
function report(items){return {project:'Lennox façade east',orderNumber:'ORDER-007',generatedAt,generatedBy:'Office QA',checklists:{panel:checks},items};}

// Decode the embedded font map and page text, then read PDF file attachments
// through their file specifications. This verifies exported content without a
// native browser or PDF command-line utility.
async function readPdf(bytes){
  const pdf=await PDFDocument.load(bytes),glyphs=new Map(),attachments=[];
  for(const [,object]of pdf.context.enumerateIndirectObjects()){
    if(object instanceof PDFDict&&object.get(PDFName.of('Type'))?.toString()==='/Filespec'){
      const fileName=(object.lookup(PDFName.of('UF'))||object.lookup(PDFName.of('F')))?.decodeText();
      const files=object.lookup(PDFName.of('EF')),file=files?.lookup(PDFName.of('F'))||files?.lookup(PDFName.of('UF'));
      if(file instanceof PDFRawStream)attachments.push({fileName,bytes:decodePDFRawStream(file).decode()});
    }
    if(!(object instanceof PDFRawStream)||['/Image','/EmbeddedFile'].includes(object.dict.get(PDFName.of('Subtype'))?.toString())||object.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile')continue;
    const source=new TextDecoder().decode(decodePDFRawStream(object).decode());
    for(const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,glyph,unicode]of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))glyphs.set(glyph.toUpperCase(),(unicode.match(/.{4}/g)||[]).map(hex=>String.fromCharCode(parseInt(hex,16))).join(''));
  }
  const pages=pdf.getPages().map(page=>{
    const contents=page.node.Contents(),streams=contents instanceof PDFRawStream?[contents]:(contents?.asArray()||[]).map(ref=>pdf.context.lookup(ref));
    const text=streams.flatMap(stream=>[...new TextDecoder().decode(decodePDFRawStream(stream).decode()).matchAll(/<([0-9A-F]+)>\s*Tj/gi)].map(([,hex])=>(hex.match(/.{4}/g)||[]).map(code=>glyphs.get(code.toUpperCase())||'').join(''))).join('\n');
    const xObjects=page.node.Resources()?.lookup(PDFName.of('XObject'));
    const images=xObjects instanceof PDFDict?xObjects.values().map(ref=>pdf.context.lookup(ref)).filter(object=>object instanceof PDFRawStream&&object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image'):[];
    return {page,text,images};
  });
  return {pdf,pages,attachments};
}
function verifyPanelPages(rendered,r){
  assert.equal(rendered.pages.length,r.items.length,'one page per input panel, with no cover or separate evidence pages');
  for(const [index,{page,text,images}]of rendered.pages.entries()){
    const item=r.items[index];
    assert.ok(text.includes(item.reference),`page ${index+1} identifies its own panel`);
    assert.ok(text.includes(item.sheetNumber),`page ${index+1} identifies its own sheet`);
    for(const other of r.items.filter(other=>other!==item))assert.equal(text.includes(other.reference),false,`page ${index+1} does not combine another panel`);
    assert.match(text,/ORDER QA REPORT/);assert.match(text,/Lennox Facades/);
    assert.ok(text.includes(`${index+1} / ${r.items.length}`),'numbered within the full panel report');
    assert.ok(images.length>=1,'each page carries the embedded Lennox logo');
    assert.ok(Math.abs(page.getWidth()-841.89)<1,'A4 landscape width');assert.ok(Math.abs(page.getHeight()-595.28)<1,'A4 landscape height');
  }
}
function attachmentStrings(attachment){
  let decoded;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(attachment.bytes);}catch{return [];}
  const strings=[decoded];
  function visit(value){if(typeof value==='string')strings.push(value);else if(value&&typeof value==='object')for(const entry of Object.values(value))visit(entry);}
  try{visit(JSON.parse(decoded));}catch{}
  return strings;
}

test('three ordinary panels produce three branded pages with each panel and its inspection evidence together',async()=>{
  const items=[panel(1),panel(2),panel(3)];items[1].latest.photo=png;
  const r=report(items),before=JSON.stringify(r),rendered=await readPdf(await createQaReportPdf(r));
  assert.equal(JSON.stringify(r),before,'export leaves the source report unchanged');verifyPanelPages(rendered,r);
  for(const [index,{text}]of rendered.pages.entries()){
    const item=items[index];
    for(const value of [r.project,r.orderNumber,item.material,item.colour,'1200','2400',item.cutBy,item.latest.checkedBy,'27-10-2026 07:00 AEST','27-10-2026 10:00 AEST',item.latest.notes])assert.ok(text.includes(value),`page ${index+1}: ${value}`);
    for(const [,label]of checks)assert.ok(text.includes(label),`page ${index+1}: checklist ${label}`);
    assert.match(text,/Pass/);assert.match(text,/N\/A/);
  }
  assert.ok(rendered.pages[1].images.length>=2,'QA photo appears inline on its own panel page beside the branded report');
});

test('many panels retain exact source order and one page each',async()=>{
  const items=Array.from({length:24},(_,index)=>panel(index+1)).reverse();
  const r=report(items),before=JSON.stringify(r),rendered=await readPdf(await createQaReportPdf(r));
  assert.equal(JSON.stringify(r),before);verifyPanelPages(rendered,r);
});

test('long notes and older inspection photos stay recoverable without adding panel pages',async()=>{
  const olderPhoto=secondPhoto(),longNotes=Array.from({length:180},(_,index)=>`Line ${index+1}: façade quality checked — complète.`).join('\n')+'\nFINAL NOTE END '+('X'.repeat(800));
  const latest={id:'latest-inspection',status:'approved',checkedBy:'Latest reviewer',checkedAt:'2026-10-27T00:30:00Z',results:Object.fromEntries(checks.map(([key])=>[key,'pass'])),notes:longNotes,photo:png};
  const older={id:'earlier-inspection',status:'recut',checkedBy:'Earlier reviewer',checkedAt:'2026-10-26T23:00:00Z',results:{finish:'fail'},notes:'Full original failure notes — café Δοκιμή.',overrideReason:'Original supervisor decision retained.',photo:olderPhoto};
  const subject=panel(51,{latest,history:[older,latest]}),r=report([subject,panel(52)]),before=JSON.stringify(r),rendered=await readPdf(await createQaReportPdf(r));
  assert.equal(JSON.stringify(r),before);verifyPanelPages(rendered,r);
  const currentPage=rendered.pages[0];
  assert.match(currentPage.text,/Latest reviewer/);assert.match(currentPage.text,/Approved/);
  assert.ok(currentPage.images.length>=2,'latest QA photo remains on the main panel page');
  assert.match(currentPage.text,/attach|full (?:history|record|notes)|supporting record/i,'panel page tells the reader where the complete supporting evidence is available');
  const strings=rendered.attachments.flatMap(attachmentStrings);
  for(const value of [longNotes,older.notes,older.overrideReason,older.checkedBy,older.id])assert.ok(strings.some(text=>text.includes(value)),`human-readable attachment preserves ${value.slice(0,70)}`);
  for(const photo of [olderPhoto,png])assert.ok(rendered.attachments.some(attachment=>Buffer.from(attachment.bytes).equals(Buffer.from(photo.split(',')[1],'base64'))),'original photo attachment bytes can be recovered exactly');
});
