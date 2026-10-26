import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {createWalkCloseoutPdf} from '../src/walk-pdf.js';

const font=fs.readFileSync(new URL('../assets/DejaVuSans.ttf',import.meta.url));
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const generatedAt='2026-10-26T16:35:00Z';
function report(){return {id:'audit-one',documentNo:'LF-MA-0012',date:'2026-10-05',auditors:'Audit Conductor',area:'Fabrication workshop',actions:[{id:'action-two',reportReference:'02',ref:'4.1',issue:'Machine guard interlock damaged',risk:'H',correctiveAction:'Replace interlock and test the emergency stop.',owner:'Assigned Owner',due:'2026-10-27',status:'Closed',closeEvidence:'Interlock replaced and operational test passed.',verifiedBy:'Factory Manager',verifiedDate:'2026-10-26'}],evidence:[],closeout:{generatedAt,total:3,closed:1,open:2}};}

// Read the renderer's embedded Unicode font map and text operators without a
// native PDF utility, so these assertions also run in the worker test suite.
async function rendered(bytes){
 const pdf=await PDFDocument.load(bytes),glyphs=new Map();
 for(const [,object] of pdf.context.enumerateIndirectObjects()){
  if(!(object instanceof PDFRawStream)||object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image')continue;
  const source=new TextDecoder().decode(decodePDFRawStream(object).decode());
  for(const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,glyph,unicode] of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))glyphs.set(glyph.toUpperCase(),(unicode.match(/.{4}/g)||[]).map(hex=>String.fromCharCode(parseInt(hex,16))).join(''));
 }
 const pages=pdf.getPages().map(page=>{
  const contents=page.node.Contents(),streams=contents instanceof PDFRawStream?[contents]:(contents?.asArray()||[]).map(ref=>pdf.context.lookup(ref));
  return streams.flatMap(stream=>[...new TextDecoder().decode(decodePDFRawStream(stream).decode()).matchAll(/<([0-9A-F]+)>\s*Tj/gi)].map(([,hex])=>(hex.match(/.{4}/g)||[]).map(code=>glyphs.get(code.toUpperCase())||'').join(''))).join('\n');
 });
 return {pdf,pages,text:pages.join('\n')};
}

test('close-out PDF preserves original action references, Brisbane date and partial status without reusing audit sign-off',async()=>{
 const r=report(),bytes=await createWalkCloseoutPdf(r,font),{pdf,text}=await rendered(bytes);
 assert.equal(pdf.getTitle(),'Lennox Facades — Corrective Action Close-out Report — LF-MA-0012');
 assert.equal(pdf.getCreationDate().toISOString(),new Date(generatedAt).toISOString());
 for(const value of ['CORRECTIVE ACTION CLOSE-OUT REPORT','LF-MA-0012','05-10-2026','Audit Conductor','Fabrication workshop','Generated as at 27-10-2026 02:35 AEST','Partial close-out','1 of 3 actions are closed. 2 actions remain open.','Completed action · Ref. 02','Assigned Owner','Factory Manager','26-10-2026',r.actions[0].closeEvidence])assert.ok(text.includes(value),value);
 assert.doesNotMatch(text,/Completed action · Ref\. 01|Signed by:|Signed content SHA-256|Source template SHA-256|Audit conductor — sign-off/);
 const withOldSignature={...r,signerName:'ORIGINAL SIGNER',statement:'ORIGINAL STATEMENT',signature:{image:'not-an-image',contentHash:'ORIGINAL HASH'},template:{sourceHash:'ORIGINAL TEMPLATE HASH'},carriedActions:[{issue:'UNRELATED CARRIED ACTION'}]};
 assert.deepEqual(await createWalkCloseoutPdf(withOldSignature,font),bytes);
});

test('close-out PDF describes a single fully closed action and distinguishes one remaining open action',async()=>{
 const r=report();r.closeout={generatedAt,total:1,closed:1,open:0};
 const all=await rendered(await createWalkCloseoutPdf(r,font));
 assert.match(all.text,/All corrective actions closed/);
 assert.match(all.text,/The corrective action is closed\./);
 assert.doesNotMatch(all.text,/Partial close-out|actions remain open/);
 r.closeout={generatedAt,total:2,closed:1,open:1};
 assert.match((await rendered(await createWalkCloseoutPdf(r,font))).text,/1 of 2 actions are closed\. 1 action remains open\./);
});

test('long close-out evidence continues across pages with its action reference, repeated column headers and no lost ending',async()=>{
 const r=report();r.actions[0].closeEvidence=Array.from({length:100},(_,i)=>'Inspection step '+(i+1)+': repaired guarding, checked the isolation and confirmed operation.').join('\n')+'\nFINAL VERIFICATION COMPLETE';
 const {pdf,pages,text}=await rendered(await createWalkCloseoutPdf(r,font));
 assert.ok(pdf.getPageCount()>2);
 assert.match(text,/FINAL VERIFICATION COMPLETE/);
 for(const [index,page] of pages.entries()){
  assert.match(page,/CORRECTIVE ACTION CLOSE-OUT REPORT/);
  assert.match(page,/Completed action · Ref\. 02/);
  assert.match(page,/Close-out evidence/);
  assert.ok(page.includes((index+1)+' / '+pages.length));
 }
 assert.match(pages[1],/Completed action · Ref\. 02 \(continued\)/);
});

test('supporting photos use the original completed action reference and exclude other action photos',async()=>{
 const r=report(),active={id:'photo-one',actionId:'action-two',fileName:'Guard repaired.png',mime:'image/png',hash:'photo-hash'},unrelated={...active,id:'photo-other',actionId:'open-action',fileName:'Unrelated.png'};
 r.evidence=[active,unrelated];const requested=[];
 const {pdf,pages}=await rendered(await createWalkCloseoutPdf(r,font,async file=>{requested.push(file.id);return image;}));
 assert.deepEqual(requested,['photo-one']);
 assert.equal(pdf.getPageCount(),2);
 assert.match(pages[1],/Supporting photo · Ref\. 02/);
 assert.match(pages[1],/Guard repaired\.png/);
 assert.match(pages[1],/Original file SHA-256: photo-hash/);
 assert.doesNotMatch(pages.join('\n'),/Unrelated\.png/);
});
