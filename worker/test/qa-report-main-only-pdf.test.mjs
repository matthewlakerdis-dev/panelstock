import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {createQaReportPdf} from '../src/qa-report-pdf.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const report=items=>({project:'QA visibility project',orderNumber:'007',generatedAt:'2026-11-27T01:00:00Z',generatedBy:'Inspector',checklists:{panel:[['finish','Finish']]},items});
async function rendered(bytes){
  const pdf=await PDFDocument.load(bytes),glyphs=new Map(),attachments=[];
  for(const [,object]of pdf.context.enumerateIndirectObjects()){
    if(!(object instanceof PDFRawStream))continue;
    if(object.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile'){attachments.push({mime:object.dict.get(PDFName.of('Subtype'))?.toString(),bytes:decodePDFRawStream(object).decode()});continue;}
    if(object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image')continue;
    const text=new TextDecoder().decode(decodePDFRawStream(object).decode());
    for(const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,glyph,unicode]of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))glyphs.set(glyph.toUpperCase(),(unicode.match(/.{4}/g)||[]).map(hex=>String.fromCharCode(parseInt(hex,16))).join(''));
  }
  const pages=pdf.getPages().map(page=>{const contents=page.node.Contents(),streams=contents instanceof PDFRawStream?[contents]:(contents?.asArray()||[]).map(ref=>pdf.context.lookup(ref));return streams.flatMap(stream=>[...new TextDecoder().decode(decodePDFRawStream(stream).decode()).matchAll(/<([0-9A-F]+)>\s*Tj/gi)].map(([,hex])=>(hex.match(/.{4}/g)||[]).map(code=>glyphs.get(code.toUpperCase())||'').join(''))).join('\n');});
  return {pdf,pages,attachments,details:attachments.filter(file=>file.mime==='/text#2Fplain').map(file=>new TextDecoder().decode(file.bytes)).join('\n')};
}

test('QA PDF shows ordinary panels and mains only, with no cap pages or separate cap photo attachments',async()=>{
  const input=report([{id:'plain',kind:'panel',reference:'PLAIN-1',sheetNumber:'1',status:'awaiting'},{id:'main',kind:'panel',reference:'MAIN-1',sheetNumber:'2',status:'approved',qaStandaloneRequired:true,qaAssembly:{role:'main',caps:[{id:'cap',reference:'MAIN-1 EP-L'}]},latest:{id:'main-inspection',status:'approved',checkedAt:'2026-11-26T01:00:00Z',results:{finish:'pass'},photo:'main-photo-ref'},history:[]},{id:'cap',kind:'panel',reference:'MAIN-1 EP-L',sheetNumber:'3',status:'included_with_main',qaStandaloneRequired:false,latest:{id:'cap-failure',status:'recut',photo:'cap-photo-ref'},history:[{id:'cap-history',photo:'old-cap-photo-ref'}]},{id:'role-cap',kind:'panel',reference:'MAIN-1 EP-R',sheetNumber:'3',status:'included_with_main',qaAssembly:{role:'cap'},latest:{id:'other-cap-failure',photo:'other-cap-photo-ref'}}]),before=JSON.stringify(input),reads=[];
  const {pdf,pages,attachments,details}=await rendered(await createQaReportPdf(input,{readPhoto:async value=>{reads.push(value);assert.equal(value,'main-photo-ref','A hidden component photo must not be requested');return png;}}));
  assert.equal(pdf.getPageCount(),2);assert.match(pages[0],/Panel PLAIN-1/);assert.match(pages[1],/Panel MAIN-1/);assert.ok(pages.every(page=>!page.includes('EP-L')&&!page.includes('EP-R')));assert.deepEqual(reads,['main-photo-ref']);
  assert.equal(attachments.filter(file=>file.mime!=='/text#2Fplain').length,1);assert.match(details,/PANEL 1:.*PLAIN-1/);assert.match(details,/PANEL 2:.*MAIN-1/);assert.doesNotMatch(details,/PANEL 3:|cap-failure|cap-history|other-cap-failure/);
  assert.equal(JSON.stringify(input),before);assert.equal(input.items[2].history[0].photo,'old-cap-photo-ref');
});

test('QA PDF keeps panels without any cap metadata and never requires a main-role marker',async()=>{
  const input=report([{id:'ordinary-a',reference:'A-1',status:'awaiting'},{id:'ordinary-b',reference:'B-1',status:'approved',qaStandaloneRequired:true,latest:{id:'ordinary-pass',status:'approved',results:{finish:'pass'}}}]),{pdf,pages}=await rendered(await createQaReportPdf(input));
  assert.equal(pdf.getPageCount(),2);assert.match(pages[0],/Panel A-1/);assert.match(pages[1],/Panel B-1/);
});

test('a component-only report produces no empty or partial PDF and does not load historical cap photos',async()=>{
  const input=report([{id:'cap',reference:'MAIN-1 EP-L',qaStandaloneRequired:false,latest:{photo:'not-for-visible-qa'}}]),before=JSON.stringify(input);let reads=0;
  await assert.rejects(createQaReportPdf(input,{readPhoto:async()=>{reads++;throw Error('Hidden cap photo');}}),/No panels were found for this QA report/);assert.equal(reads,0);assert.equal(JSON.stringify(input),before);
});
