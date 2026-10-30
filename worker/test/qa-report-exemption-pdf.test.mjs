import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {createQaReportPdf} from '../src/qa-report-pdf.js';

const generatedAt='2026-10-30T01:30:00Z';
const exemption={id:'exemption-current',reason:'Client-supplied template panel. Factory QA is not required for this item.',by:'Admin Riley',at:'2026-10-30T01:00:00Z',cutAt:'2026-10-29T23:00:00Z',productionSignature:'internal-production-signature',active:true};
const events=[{action:'grant',id:'event-old',exemptionId:'exemption-old',reason:'Original template exemption',by:'Admin Morgan',at:'2026-10-28T00:00:00Z',cutAt:'2026-10-27T23:00:00Z'},{action:'revoke',id:'event-revoke',exemptionId:'exemption-old',reason:'Drawing revision requires review',by:'Admin Casey',at:'2026-10-29T00:00:00Z',cutAt:'2026-10-27T23:00:00Z'},{action:'grant',id:'event-current',exemptionId:exemption.id,reason:exemption.reason,by:exemption.by,at:exemption.at,cutAt:exemption.cutAt}];
function panel(overrides={}){return {id:'panel-exempt',kind:'panel',project:'Template project',orderNumber:'007',sheetNumber:'2',reference:'T-1',quantity:1,material:'Aluminium',colour:'White',thickness:3,width:900,height:1800,cutBy:'CNC operator',cutAt:exemption.cutAt,status:'not_required',qaResolved:true,qaExemption:{...exemption},qaExemptionHistory:events.map(event=>({...event})),latest:null,history:[],...overrides};}
function report(items){return {project:'Template project',orderNumber:'007',generatedAt,generatedBy:'Office QA',checklists:{panel:[['finish','Finish is free from damage']]},items};}

async function rendered(bytes){
  const pdf=await PDFDocument.load(bytes),glyphs=new Map(),attached=[];
  for(const [,object]of pdf.context.enumerateIndirectObjects()){
    if(!(object instanceof PDFRawStream)||object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image')continue;
    const source=new TextDecoder().decode(decodePDFRawStream(object).decode());
    if(object.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile'){attached.push(source);continue;}
    for(const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,glyph,unicode]of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))glyphs.set(glyph.toUpperCase(),(unicode.match(/.{4}/g)||[]).map(hex=>String.fromCharCode(parseInt(hex,16))).join(''));
  }
  const drawing=pdf.getPages().map(page=>{const contents=page.node.Contents(),streams=contents instanceof PDFRawStream?[contents]:(contents?.asArray()||[]).map(ref=>pdf.context.lookup(ref));return streams.map(stream=>new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');});
  const pages=drawing.map(source=>[...source.matchAll(/<([0-9A-F]+)>\s*Tj/gi)].map(([,hex])=>(hex.match(/.{4}/g)||[]).map(code=>glyphs.get(code.toUpperCase())||'').join('')).join('\n'));
  return {pdf,pages,drawing,details:attached.join('\n')};
}

test('an active exemption has its own cyan-blue badge, actor/date and reason without fabricated inspections',async()=>{
  const input=report([panel()]),before=JSON.stringify(input),{pdf,pages,drawing,details}=await rendered(await createQaReportPdf(input));
  assert.equal(JSON.stringify(input),before);assert.equal(pdf.getPageCount(),1);
  for(const value of ['Sheet 2 · Panel T-1','QA not required','Exempted by Admin Riley','30-10-2026 11:00 AEST','QA requirement','Exemption reason',exemption.reason])assert.ok(pages[0].replace(/\s+/g,' ').includes(value),value);
  assert.doesNotMatch(pages[0],/Approved|Latest inspection checks|Inspection 1|\bPass\b|QA: Not inspected/);
  assert.doesNotMatch(pages[0],/exemption-current|event-current|internal-production-signature/);
  assert.match(drawing[0],/0\.87 0\.94 0\.98 rg\s+[\s\S]*?624 431 cm/);
  assert.match(details,/QA EXEMPTION HISTORY/);assert.match(details,/EXEMPTION EVENT 1 — GRANTED/);assert.match(details,/EXEMPTION EVENT 2 — REVOKED/);assert.match(details,/EXEMPTION EVENT 3 — GRANTED/);
  for(const value of ['Admin Morgan','Admin Casey','Drawing revision requires review','exemption-current','internal-production-signature','Latest inspection: None of 0'])assert.ok(details.includes(value),value);
  assert.doesNotMatch(details,/INSPECTION 1/);
});

test('revoked and stale exemption decisions remain attached while their pages show their effective QA status',async()=>{
  const input=report([panel(),panel({id:'panel-revoked',reference:'T-2',status:'awaiting',qaResolved:false,qaExemption:null,qaExemptionHistory:events.slice(0,2)}),panel({id:'panel-stale',reference:'T-3',status:'pre_qa',qaResolved:false,qaExemption:{...exemption,active:false}})]),before=JSON.stringify(input),{pdf,pages,details}=await rendered(await createQaReportPdf(input));
  assert.equal(JSON.stringify(input),before);assert.equal(pdf.getPageCount(),3);
  assert.match(pages[0],/Panel T-1/);assert.match(pages[1],/Panel T-2/);assert.match(pages[2],/Panel T-3/);
  assert.match(pages[1],/Awaiting QA/);assert.match(pages[2],/Pre-QA/);
  for(const page of pages.slice(1))assert.doesNotMatch(page,/QA not required|Exempted by|Exemption reason/);
  assert.match(details,/Active exemption: None/);assert.match(details,/STORED EXEMPTION METADATA \(INACTIVE\)/);assert.match(details,/Active: false/);
  assert.match(details,/Drawing revision requires review/);assert.match(details,/EXEMPTION EVENT 2 — REVOKED/);
  for(const page of pdf.getPages()){assert.equal(page.getWidth(),842);assert.equal(page.getHeight(),595);}
});

test('long Unicode exemption reasons retain their complete text in the details attachment without adding pages',async()=>{
  const reason=Array.from({length:90},(_,index)=>`Exemption detail ${index+1}: façade dimensions and template requirements.`).join('\n')+'\nFinal reason retained ✓ 🛠',input=report([panel({qaExemption:{...exemption,reason},qaExemptionHistory:[{...events[2],reason}]})]),before=JSON.stringify(input),{pdf,pages,details}=await rendered(await createQaReportPdf(input));
  assert.equal(JSON.stringify(input),before);assert.equal(pdf.getPageCount(),1);
  assert.match(pages[0],/QA not required/);assert.match(pages[0],/Some text is abbreviated/);assert.match(pages[0],/QA_Details\.txt/);
  assert.ok(details.includes(reason));assert.match(details,/Latest inspection: None of 0/);assert.doesNotMatch(details,/INSPECTION 1/);
});
