import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {createGateQaReportPdf,gateQaReportPdfFilename} from '../src/gate-qa-report-pdf.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const jpeg='data:image/jpeg;base64,'+fs.readFileSync(new URL('../assets/prestart-logo.jpg',import.meta.url)).toString('base64');
const webp='data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const generatedAt='2026-11-12T02:00:00Z';
const checklist=[['finish','Finish is free from damage'],['dimensions','Dimensions match the Gate drawing']];
function component(index,overrides={}){
  const number=String(index+1).padStart(2,'0'),kind=['Gate','Highlight','Post'][index%3],label=kind+' '+number,
    latest={id:'inspection-'+number,status:'approved',checklistKind:'gate',checklist:checklist.map(pair=>pair.slice()),results:{finish:'pass',dimensions:'pass'},checkedBy:'Inspector '+number,checkedAt:'2026-11-11T23:30:00Z',notes:'Component '+number+' checked.'};
  return {id:'qa-'+number,componentId:'component-'+number,qaId:'qa-'+number,set:index<12?1:2,label,componentKind:kind,quantity:1,reference:'Villa 12 · '+label,status:'approved',gateRevision:'current-revision',latest:structuredClone(latest),history:[latest],photoAdditions:[],shipment:null,delivery:null,...overrides};
}
function report(count=8){
  return {type:'gate-order',orderId:'gate-order-example',project:'Lennox façades',orderNumber:'007',orderType:'Double Gate',villa:'Villa 12',colour:'Monument',areaM2:14.75,orderStatus:'completed',drawn:true,currentRevision:'current-revision',generatedAt,generatedBy:'Office QA',status:'approved',summary:{total:count,totalQuantity:count,approved:count,recut:0,awaiting:0,missing:0,dispatched:0,delivered:0},checklists:{gate:checklist.map(pair=>pair.slice()),metalwork:[['legacy','Legacy metalwork check']]},items:Array.from({length:count},(_,index)=>component(index,{set:index<Math.ceil(count/2)?1:2})),previousQa:[]};
}
async function rendered(bytes){
  const pdf=await PDFDocument.load(bytes),glyphs=new Map(),images=[],attachments=[];
  for(const [,object]of pdf.context.enumerateIndirectObjects()){
    if(!(object instanceof PDFRawStream))continue;
    if(object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image'){images.push(object);continue;}
    const decoded=decodePDFRawStream(object).decode();
    if(object.dict.get(PDFName.of('Type'))?.toString()==='/EmbeddedFile'){attachments.push({mime:object.dict.get(PDFName.of('Subtype'))?.toString().slice(1).replace(/#([0-9a-f]{2})/gi,(_,code)=>String.fromCharCode(parseInt(code,16))),bytes:decoded});continue;}
    const source=new TextDecoder().decode(decoded);
    for(const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const [,glyph,unicode]of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi))glyphs.set(glyph.toUpperCase(),(unicode.match(/.{4}/g)||[]).map(hex=>String.fromCharCode(parseInt(hex,16))).join(''));
  }
  const drawings=pdf.getPages().map(page=>{
    const contents=page.node.Contents(),streams=contents instanceof PDFRawStream?[contents]:(contents?.asArray()||[]).map(ref=>pdf.context.lookup(ref));
    return streams.map(stream=>new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');
  });
  const pages=drawings.map(source=>[...source.matchAll(/<([0-9A-F]+)>\s*Tj/gi)].map(([,hex])=>(hex.match(/.{4}/g)||[]).map(code=>glyphs.get(code.toUpperCase())||'').join('')).join('\n'));
  const details=attachments.filter(file=>file.mime==='text/plain').map(file=>new TextDecoder().decode(file.bytes)).join('\n');
  return {pdf,pages,text:pages.join('\n'),drawings,images,attachments,details};
}
const compact=value=>value.replace(/\s+/g,' ');
const overviewPages=pages=>pages.filter(page=>['Set','Piece','Qty','Status','Checked by','Checked at','Checks'].every(label=>compact(page).includes(label)));

test('normal eight- and twelve-piece Gate orders have one consolidated first-page overview with Lennox branding',async()=>{
  for(const count of [8,12]){
    const r=report(count),before=JSON.stringify(r),{pdf,pages,images,text,details}=await rendered(await createGateQaReportPdf(r));
    assert.equal(JSON.stringify(r),before);
    assert.match(pdf.getTitle(),/Gate.*QA/i);assert.equal(pdf.getAuthor(),'Lennox Facades');assert.equal(pdf.getCreationDate().toISOString(),'2026-11-12T02:00:00.000Z');
    assert.ok(images.length>=1,'The Lennox logo is embedded');
    for(const value of ['Lennox façades','007','Double Gate','Villa 12','Monument','14.75','Overall QA: Approved'])assert.ok(compact(pages[0]).includes(value),value);
    for(const item of r.items)assert.ok(pages[0].includes(item.label),`${count} piece overview retains ${item.label}`);
    assert.equal(overviewPages(pages).length,1,'Normal orders use one component overview table page');
    assert.ok(text.includes(checklist[0][1])||details.includes(checklist[0][1]));
    assert.ok(pages.length<count,'The document is consolidated rather than one PDF page per piece');
    for(const page of pdf.getPages()){assert.equal(page.getWidth(),842);assert.equal(page.getHeight(),595);}
  }
  const name=gateQaReportPdfFilename(report());assert.match(name,/\.pdf$/);assert.match(name,/007/);assert.doesNotMatch(name,/[<>:"/\\|?*]/);
});

test('twenty-four pieces paginate as a readable continued component table without losing labels or order',async()=>{
  const r=report(24),before=JSON.stringify(r),{pages,text}=await rendered(await createGateQaReportPdf(r)),overviews=overviewPages(pages);
  assert.equal(JSON.stringify(r),before);assert.ok(overviews.length>=2,'The maximum order uses continued overview pages');assert.ok(pages.length<24);
  const tableText=overviews.join('\n');let previous=-1;
  for(const item of r.items){const index=tableText.indexOf(item.label);assert.ok(index>previous,`Retains ${item.label} in component order`);previous=index;}
  for(const page of overviews)for(const heading of ['Set','Piece','Qty','Status','Checked by','Checked at','Checks'])assert.ok(compact(page).includes(heading),heading);
  assert.match(text,/Overall QA: Approved/);
});

test('waiting, missing and failed current pieces prevent aggregate approval even when previous revisions passed',async()=>{
  for(const status of ['awaiting','missing','recut']){
    const r=report(),latest=status==='recut'?{...r.items[0].latest,status:'recut',results:{finish:'fail',dimensions:'pass'}}:null;
    r.items[0]={...r.items[0],status,qaId:status==='missing'?null:r.items[0].qaId,latest,history:latest?[structuredClone(latest)]:[]};
    r.summary.approved=7;r.summary[status]=1;
    r.previousQa=[{...component(99),id:'previous-qa',qaId:'previous-qa',reference:'PREVIOUS REVISION ONLY',label:'PREVIOUS REVISION ONLY',gateRevision:'older-revision',reason:'Superseded drawing revision'}];
    // A stale or accidentally misleading aggregate cannot override current pieces.
    r.status='approved';
    const {pages,text,details}=await rendered(await createGateQaReportPdf(r));
    assert.match(pages[0],/Overall QA:/);assert.doesNotMatch(pages[0],/Overall QA: Approved/);
    assert.doesNotMatch(pages[0],/PREVIOUS REVISION ONLY/);assert.match(text,/PREVIOUS REVISION ONLY/);assert.match(text,/previous|earlier/i);assert.match(details,/older-revision/);
  }
});

test('all original and appended evidence is retained once, grouped visibly, with exact inspection provenance',async()=>{
  const r=report(),original={...r.items[0].latest,photo:png,photos:[png,jpeg]};
  r.items[0]={...r.items[0],latest:structuredClone(original),history:[original],photoAdditions:[{id:'later-photo-batch',attemptId:original.id,photos:[webp,png],addedBy:'Later photo uploader',addedAt:'2026-11-12T01:00:00Z',mutationId:'photo-upload-mutation'}]};
  r.previousQa=[{...component(99),id:'old-record',qaId:'old-record',gateRevision:'older-revision',reference:'Old drawing component',latest:{...component(99).latest,photo:jpeg},history:[],reason:'Superseded drawing revision'}];
  const before=JSON.stringify(r),{pdf,pages,attachments,details}=await rendered(await createGateQaReportPdf(r));
  assert.equal(JSON.stringify(r),before);
  const originals=attachments.filter(file=>file.mime.startsWith('image/'));assert.equal(originals.length,3);
  for(const source of [png,jpeg,webp])assert.equal(originals.filter(file=>Buffer.from(file.bytes).equals(Buffer.from(source.split(',')[1],'base64'))).length,1);
  for(const value of ['later-photo-batch',original.id,'Later photo uploader','2026-11-12T01:00:00Z','photo-upload-mutation','older-revision'])assert.ok(details.includes(value),value);
  assert.match(details,/evidence.*register/i);assert.doesNotMatch(details,/data:image\//);
  const gallery=pages.filter(page=>/evidence|photo/i.test(page)&&page.includes(r.items[0].label));assert.ok(gallery.length>=1);
  assert.ok(gallery.some(page=>/Later photo uploader/.test(page)),'Gallery distinguishes photos added after inspection');
  assert.ok(pages.some(page=>/WebP/i.test(page)),'Original WebP attachments are explicitly identified');
  const multiImagePage=pdf.getPages().some(page=>{const images=page.node.Resources().lookup(PDFName.of('XObject'));return images&&images.entries().length>=3;});
  assert.ok(multiImagePage,'Grouped gallery displays multiple photos on a shared page');
});

test('saved checklist labels and long historical notes remain complete without treating older QA as current',async()=>{
  const r=report(),savedLabel='Saved machining acceptance — previous checklist',notes=Array.from({length:90},(_,index)=>`Historic detail ${index+1}: façade and template requirements.`).join('\n')+'\nFINAL HISTORICAL NOTE';
  const previous={...component(99),id:'earlier-record',qaId:'earlier-record',label:'Earlier Gate drawing',reference:'Earlier Gate drawing',gateRevision:'old-revision',reason:'Earlier revision',latest:{id:'earlier-inspection',status:'approved',checkedBy:'Earlier reviewer',checkedAt:'2026-11-10T23:00:00Z',checklist:[['retired-check',savedLabel]],results:{'retired-check':'pass'},notes},history:[],photoAdditions:[]};
  r.previousQa=[previous];
  const before=JSON.stringify(r),{pages,text,details}=await rendered(await createGateQaReportPdf(r));
  assert.equal(JSON.stringify(r),before);assert.match(pages[0],/Overall QA: Approved/);assert.doesNotMatch(pages[0],/Earlier Gate drawing/);
  assert.ok(details.includes(savedLabel));assert.ok(details.includes(notes));assert.match(details,/retired-check/);assert.match(text,/Earlier Gate drawing/);
});

test('corrupt appended Gate photos fail export clearly rather than omitting evidence',async()=>{
  const r=report();r.items[0].photoAdditions=[{id:'broken-photo',attemptId:r.items[0].latest.id,photos:['data:image/png;base64,aGVsbG8='],addedBy:'Uploader',addedAt:'2026-11-12T01:00:00Z',mutationId:'broken-upload'}];
  await assert.rejects(createGateQaReportPdf(r),/photo|evidence/i);
});

test('unresolved current mapping issues prevent an approved aggregate and remain complete in attached details',async()=>{
  const r=report();r.mappingIssues=['Missing current QA association for Set 2 Post 04','Unmatched current record: '+('X'.repeat(600))+' FINAL MAPPING ISSUE'];
  const before=JSON.stringify(r),{pages,details}=await rendered(await createGateQaReportPdf(r));
  assert.equal(JSON.stringify(r),before);assert.match(pages[0],/Overall QA:/);assert.doesNotMatch(pages[0],/Overall QA: Approved/);assert.match(pages[0],/mapping|QA record/i);
  for(const issue of r.mappingIssues)assert.ok(details.includes(issue),issue.slice(0,70));
});

test('legacy metalwork attempts use their own wording when a Gate check has the same key',async()=>{
  const r=report(2),gateLabel='Gate visual finish acceptance',metalworkLabel='Legacy weld and finish acceptance';
  r.checklists.gate=[['finish',gateLabel]];r.checklists.metalwork=[['finish',metalworkLabel]];
  const legacy={id:'legacy-inspection',status:'recut',results:{finish:'fail'},checkedBy:'Legacy reviewer',checkedAt:'2026-11-11T22:00:00Z',notes:'Legacy wording must remain distinct.'};
  r.items[0]={...r.items[0],checklistKind:'metalwork',status:'recut',latest:structuredClone(legacy),history:[legacy]};
  const modern={...r.items[1].latest,checklistKind:'gate',checklist:[['finish',gateLabel]],results:{finish:'pass'}};
  r.items[1]={...r.items[1],latest:structuredClone(modern),history:[modern]};r.status='recut';r.summary.approved=1;r.summary.recut=1;
  const before=JSON.stringify(r),{pages,text,details}=await rendered(await createGateQaReportPdf(r));
  assert.equal(JSON.stringify(r),before);
  assert.ok(compact(pages[0]).includes('Fail: '+metalworkLabel));assert.ok(!compact(pages[0]).includes('Fail: '+gateLabel));
  assert.ok(details.includes(`${metalworkLabel} [finish]: fail`));assert.ok(!details.includes(`${gateLabel} [finish]: fail`));
  assert.ok(text.includes(gateLabel));assert.ok(text.includes(metalworkLabel));
  const matrix=text.slice(text.indexOf('Current inspection results'));
  assert.match(matrix,/Set 1 · Gate 01\s+—\s+Fail/);assert.match(matrix,/Set 2 · Highlight 02\s+Pass\s+—/);
});

test('a saved inspection label overrides later metalwork and Gate wording for the same check key',async()=>{
  const r=report(1),savedLabel='Saved fabrication acceptance',currentMetalwork='New metalwork acceptance',currentGate='New Gate acceptance';
  r.checklists.gate=[['finish',currentGate]];r.checklists.metalwork=[['finish',currentMetalwork]];
  const latest={...r.items[0].latest,checklistKind:'metalwork',checklist:[['finish',savedLabel]],results:{finish:'pass'}};
  r.items[0]={...r.items[0],checklistKind:'metalwork',latest:structuredClone(latest),history:[latest]};
  const {text,details}=await rendered(await createGateQaReportPdf(r));
  assert.ok(text.includes(savedLabel));assert.ok(details.includes(`${savedLabel} [finish]: pass`));
  assert.ok(!details.includes(`${currentMetalwork} [finish]: pass`));assert.ok(!details.includes(`${currentGate} [finish]: pass`));
});

test('bare approved flags do not approve an order but a real approved history fallback does',async()=>{
  const bare=report(1);bare.items[0]={...bare.items[0],latest:null,history:[]};
  const bareBefore=JSON.stringify(bare),missing=await rendered(await createGateQaReportPdf(bare));
  assert.equal(JSON.stringify(bare),bareBefore);assert.doesNotMatch(missing.pages[0],/Overall QA: Approved/);assert.match(missing.pages[0],/Missing QA record/);
  const historical=report(1);historical.items[0].latest=null;
  const historyBefore=JSON.stringify(historical),approved=await rendered(await createGateQaReportPdf(historical));
  assert.equal(JSON.stringify(historical),historyBefore);assert.match(approved.pages[0],/Overall QA: Approved/);assert.match(approved.pages[0],/Inspector 01/);assert.match(approved.pages[0],/12-11-2026 09:30 AEST/);
});

test('older unsnapshotted metalwork history keeps its wording after a newer Gate inspection on the same item',async()=>{
  const r=report(1),gateLabel='Current Gate finish acceptance',metalworkLabel='Original metalwork finish acceptance';
  r.checklists.gate=[['finish',gateLabel]];r.checklists.metalwork=[['finish',metalworkLabel]];
  const older={id:'legacy-metalwork-check',status:'recut',checkedBy:'Earlier metalwork reviewer',checkedAt:'2026-11-10T23:00:00Z',results:{finish:'fail'},notes:'Original metalwork inspection before the Gate checklist.'};
  const latest={...r.items[0].latest,id:'new-gate-check',checklistKind:'gate',checklist:[['finish',gateLabel]],results:{finish:'pass'}};
  r.items[0]={...r.items[0],checklistKind:'gate',latest:structuredClone(latest),history:[older,latest]};
  const before=JSON.stringify(r),{pages,text,details}=await rendered(await createGateQaReportPdf(r));
  assert.equal(JSON.stringify(r),before);assert.match(pages[0],/Overall QA: Approved/);assert.ok(text.includes(gateLabel));
  const first=details.slice(details.indexOf('INSPECTION 1'),details.indexOf('INSPECTION 2')),second=details.slice(details.indexOf('INSPECTION 2'));
  assert.ok(first.includes(`${metalworkLabel} [finish]: fail`));assert.ok(!first.includes(`${gateLabel} [finish]: fail`));
  assert.ok(second.includes(`${gateLabel} [finish]: pass`));assert.ok(!second.includes(`${metalworkLabel} [finish]: pass`));
});
