import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {toolboxPdfAssets} from './toolbox-pdf-assets.js';
import {qaAttemptPhotos} from './qa-photos.js';

const statusLabel=value=>({approved:'Approved',recut:'Recut required',failed:'Recut required',awaiting:'Awaiting QA',pending:'Awaiting QA',missing:'Missing QA record',not_drawn:'Not drawn',cancelled:'Cancelled',replaced:'Replaced'}[value]||'Awaiting QA');
const dateTime=value=>{
  if(!value||!Number.isFinite(new Date(value).getTime()))return 'Not recorded';
  const parts=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)),part=type=>parts.find(p=>p.type===type)?.value;
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')} AEST`;
};
export function gateQaReportPdfFilename(report){
  const safe=value=>String(value||'Unknown').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,100);
  return `Gate_QA_Report_${safe(report.project)}_Order_${safe(report.orderNumber)}.pdf`;
}

// One order snapshot, with a consolidated current-piece overview first. Older
// revisions, detailed checks and grouped evidence follow within the same PDF.
export async function createGateQaReportPdf(report){
  const doc=await PDFDocument.create(),assets=toolboxPdfAssets();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(assets.font,{subset:true}),logo=await doc.embedJpg(assets.logo),
    ink=rgb(.22,.23,.24),charcoal=rgb(.28,.29,.30),cyan=rgb(0,.67,.77),pale=rgb(.92,.97,.98),rule=rgb(.78,.82,.84),white=rgb(1,1,1),
    supported=new Set(font.getCharacterSet()),items=report.items||[],previous=report.previousQa||[],shared=report.checklists?.gate||report.checklists?.metalwork||[],
    labels=Object.fromEntries(shared),photos=new Map(),associations=new Set(),evidence=[],models=[];
  const mappingIssues=Array.isArray(report.mappingIssues)?report.mappingIssues:[],inspectionFor=item=>item.latest||(Array.isArray(item.history)?item.history.at(-1):null),approvedItem=item=>{const latest=inspectionFor(item);return item.status==='approved'&&latest?.status==='approved'&&!Object.values(latest.results||{}).includes('fail');};
  const invalidApproval=items.some(item=>item.status==='approved'&&!approvedItem(item));
  const allApproved=items.length>0&&items.every(approvedItem)&&Number(report.summary?.total??items.length)===items.length&&report.drawn!==false&&report.orderStatus!=='cancelled'&&!mappingIssues.length;
  let overall=report.status||'awaiting';
  if(overall==='approved'&&!allApproved)overall=report.orderStatus==='cancelled'?'cancelled':report.drawn===false?'not_drawn':mappingIssues.length||invalidApproval?'missing':items.some(item=>['recut','failed'].includes(item.status))?'recut':items.some(item=>item.status==='missing')||report.summary?.missing?'missing':'awaiting';
  let page,y,abbreviated=false;

  function display(value){return [...String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'')].map(character=>{if(character==='\n'||supported.has(character.codePointAt(0)))return character;abbreviated=true;return '□';}).join('');}
  function wrap(value,width,size){
    const result=[];
    for(const paragraph of display(value??'—').split('\n')){
      let line='';for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(font.widthOfTextAtSize(word,size)>width){if(line){result.push(line);line='';}for(const character of word){if(line&&font.widthOfTextAtSize(line+character,size)>width){result.push(line);line='';}line+=character;}}
        else if(line&&font.widthOfTextAtSize(line+' '+word,size)>width){result.push(line);line=word;}else line+=(line?' ':'')+word;
      }result.push(line||' ');
    }return result;
  }
  function fitted(value,width,size,maxLines=Infinity){
    const lines=wrap(value,width,size);if(lines.length<=maxLines)return lines;
    abbreviated=true;const shown=lines.slice(0,maxLines),last=[...shown.at(-1)];while(last.length&&font.widthOfTextAtSize(last.join('')+'…',size)>width)last.pop();shown[shown.length-1]=last.join('')+'…';return shown;
  }
  function textAt(value,x,top,width,size=9,maxLines=1,color=ink,pitch=size+3){
    const lines=fitted(value,width,size,maxLines);for(const [index,line]of lines.entries())page.drawText(line,{x,y:top-size-index*pitch,font,size,color});return lines.length*pitch;
  }
  function band(title){
    page.drawRectangle({x:34,y:y-24,width:774,height:24,color:pale});page.drawRectangle({x:34,y:y-24,width:3,height:24,color:cyan});textAt(title,44,y-5,754,11,1,charcoal);y-=31;
  }
  function newPage(section=''){
    page=doc.addPage([842,595]);
    page.drawRectangle({x:0,y:591,width:842,height:4,color:cyan});page.drawImage(logo,{x:34,y:522,width:124,height:124*logo.height/logo.width});
    page.drawText('GATE ORDER QA REPORT',{x:192,y:556,font,size:17,color:charcoal});
    page.drawText('All sets and pieces · One consolidated order snapshot',{x:192,y:538,font,size:9,color:ink});
    textAt(`Order ${report.orderNumber||'Not recorded'} · ${report.villa||'Villa not recorded'} · Generated ${dateTime(report.generatedAt)}`,192,530,616,8.5,1);
    page.drawLine({start:{x:34,y:508},end:{x:808,y:508},thickness:1.5,color:cyan});y=494;if(section)band(section);
  }
  function ensure(height,section){if(y-height<60)newPage(section?section+' (continued)':'');}
  function table(headers,rows,widths,{size=8.5,title='Current component overview',maxLines=Infinity}={}){
    const pitch=size+3,head=headers.map((value,index)=>fitted(value,widths[index]-10,size));
    function draw(cells,heading=false){
      const height=Math.max(...cells.map(lines=>lines.length),1)*pitch+10;let x=34;
      for(const [index,width]of widths.entries()){
        page.drawRectangle({x,y:y-height,width,height,borderWidth:.5,borderColor:rule,...(heading?{color:charcoal}:{})});
        for(const [lineIndex,line]of(cells[index]||[]).entries())page.drawText(line,{x:x+5,y:y-6-size-lineIndex*pitch,font,size,color:heading?white:ink});x+=width;
      }y-=height;
    }
    const headingHeight=Math.max(...head.map(lines=>lines.length))*pitch+10;
    ensure(headingHeight+pitch+10,title);draw(head,true);
    for(const row of rows){
      let cells=row.map((value,index)=>fitted(value,widths[index]-10,size,maxLines));
      while(cells.some(lines=>lines.length)){
        const remaining=Math.max(...cells.map(lines=>lines.length));
        if(y-10-pitch<60){newPage(title+' (continued)');draw(head,true);}
        const count=Math.min(remaining,Math.max(1,Math.floor((y-60-10)/pitch)));
        draw(cells.map(lines=>lines.slice(0,count)));cells=cells.map(lines=>lines.slice(count));
        if(cells.some(lines=>lines.length)){newPage(title+' (continued)');draw(head,true);}
      }
    }y-=12;
  }
  function paragraph(value,size=9,title='Gate QA details'){
    for(const line of wrap(value,774,size)){ensure(size+6,title);page.drawText(line,{x:34,y:y-size,font,size,color:ink});y-=size+6;}y-=4;
  }
  const pieceName=item=>item.label||item.reference||item.componentKind||'Unlabelled piece';
  const setName=item=>item.set==null?'—':String(item.set);
  const attemptLabels=(attempt,item)=>{const legacy=attempt&&!Array.isArray(attempt.checklist)&&!attempt.checklistKind,kind=legacy?'metalwork':attempt?.checklistKind||item?.checklistKind||'gate',definitions=kind==='metalwork'?report.checklists?.metalwork||[]:shared;return Object.fromEntries([...definitions,...(Array.isArray(attempt?.checklist)?attempt.checklist:[])]);};
  function checkSummary(attempt,item){
    if(!attempt)return 'Not inspected';const results=Object.entries(attempt.results||{}),names=attemptLabels(attempt,item),counts={pass:0,fail:0,na:0};
    for(const [,value]of results)if(Object.hasOwn(counts,value))counts[value]++;
    if(!results.length)return 'No results recorded';
    return `${counts.pass} Pass · ${counts.fail} Fail · ${counts.na} N/A`+(counts.fail?'\nFail: '+results.filter(([,value])=>value==='fail').map(([key])=>names[key]||key).join('; '):'');
  }
  async function registerPhoto(source,model,attempt,inspectionNumber,addition=null){
    let saved=photos.get(source);
    if(!saved){
      const match=String(source).match(/^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/);
      if(!match)throw Error(`A QA evidence photo for ${pieceName(model.item)} is invalid. No PDF was generated.`);
      try{
        const bytes=Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0)),fileName=`Gate_QA_Photo_${String(photos.size+1).padStart(3,'0')}.${match[1]==='jpeg'?'jpg':match[1]}`;let image;
        if(match[1]==='webp'){const signature=new TextDecoder().decode(bytes.subarray(0,12));if(bytes.length<20||signature.slice(0,4)!=='RIFF'||signature.slice(8,12)!=='WEBP')throw Error('Invalid WebP');}
        else image=match[1]==='png'?await doc.embedPng(bytes):await doc.embedJpg(bytes);
        await doc.attach(bytes,fileName,{mimeType:'image/'+match[1],description:'Original Gate QA evidence'});saved={fileName,image};photos.set(source,saved);
      }catch{throw Error(`A QA evidence photo for ${pieceName(model.item)} could not be opened. No PDF was generated.`);}
    }
    const key=JSON.stringify([model.previous,model.item.id,attempt?.id||inspectionNumber,source,addition?.id||'inspection']);
    if(!associations.has(key)){associations.add(key);evidence.push({model,attempt,inspectionNumber,addition,...saved});}
  }
  for(const [previousRevision,collection]of [[false,items],[true,previous]])for(const item of collection){
    const attempts=Array.isArray(item.history)?item.history.slice():[],snapshot=item.latest?JSON.stringify(item.latest):null,isLatest=attempt=>attempt===item.latest||((!attempt.id||!item.latest?.id||attempt.id===item.latest.id)&&JSON.stringify(attempt)===snapshot);
    if(item.latest&&!attempts.some(isLatest))attempts.push(item.latest);
    const model={item,previous:previousRevision,attempts,latest:item.latest||attempts.at(-1)||null,additions:Array.isArray(item.photoAdditions)?item.photoAdditions:[]};models.push(model);
    for(const [index,attempt]of attempts.entries())for(const source of new Set(qaAttemptPhotos(attempt)))await registerPhoto(source,model,attempt,index+1);
    for(const addition of model.additions){const index=attempts.findIndex(attempt=>attempt.id&&attempt.id===addition.attemptId);for(const source of addition.photos||[])await registerPhoto(source,model,index>=0?attempts[index]:{id:addition.attemptId},index>=0?index+1:null,addition);}
  }
  const currentModels=models.filter(model=>!model.previous),oldModels=models.filter(model=>model.previous);

  // The UTF-8 attachment retains every source value without embedding image
  // data as text. Evidence files and their exact associations are listed below.
  const details=['Lennox Facades — Gate Order QA Report','Complete order snapshot and original evidence register','Encoding: UTF-8',''];
  const valueText=value=>value==null?'Not recorded':typeof value==='object'?JSON.stringify(value,null,2):String(value);
  const keyText=key=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,character=>character.toUpperCase());
  for(const [key,value]of Object.entries(report))if(!['items','previousQa','checklists'].includes(key))details.push(`${keyText(key)}: ${valueText(value)}`);
  details.push('',`Rendered overall QA: ${statusLabel(overall)}`,'','SHARED GATE CHECKLIST');for(const [key,label]of shared)details.push(`${key}: ${label}`);
  for(const model of models){
    const {item,attempts,additions}=model;
    details.push('','='.repeat(72),model.previous?'PREVIOUS REVISION QA — EXCLUDED FROM CURRENT APPROVAL':'CURRENT EXPECTED COMPONENT',`Set ${setName(item)} · ${pieceName(item)}`);
    for(const [key,value]of Object.entries(item))if(!['latest','history','photoAdditions'].includes(key))details.push(`${keyText(key)}: ${valueText(value)}`);
    if(!attempts.length)details.push('No QA inspection recorded.');
    for(const [index,attempt]of attempts.entries()){
      details.push('',`INSPECTION ${index+1}`);for(const [key,value]of Object.entries(attempt))if(!['photos','photo','results','checklist'].includes(key))details.push(`${keyText(key)}: ${valueText(value)}`);
      const names=attemptLabels(attempt,item);if(attempt.checklist){details.push('SAVED INSPECTION CHECKLIST');for(const [key,label]of attempt.checklist)details.push(`${key}: ${label}`);}
      details.push('CHECK RESULTS');for(const [key,value]of Object.entries(attempt.results||{}))details.push(`${names[key]||key} [${key}]: ${valueText(value)}`);
      for(const source of new Set(qaAttemptPhotos(attempt)))details.push('Original evidence: '+photos.get(source).fileName);
      for(const addition of additions.filter(entry=>attempt.id&&entry.attemptId===attempt.id))details.push('Additional evidence: '+addition.id,...(addition.photos||[]).map(source=>photos.get(source).fileName));
    }
    if(additions.length)details.push('','PHOTO ADDITIONS — RECORDED AFTER INSPECTION');
    for(const addition of additions){for(const [key,value]of Object.entries(addition))if(key!=='photos')details.push(`${keyText(key)}: ${valueText(value)}`);details.push('Added at (Brisbane): '+dateTime(addition.addedAt));for(const source of addition.photos||[])details.push('Evidence: '+photos.get(source).fileName);details.push('');}
  }
  details.push('','ORIGINAL EVIDENCE REGISTER');
  for(const [index,entry]of evidence.entries()){
    details.push('',`EVIDENCE ${index+1}: ${entry.fileName}`,`Scope: ${entry.model.previous?'Previous revision':'Current order'}`,`Set: ${setName(entry.model.item)}`,`Piece: ${pieceName(entry.model.item)}`,`Inspection: ${entry.attempt?.id||entry.inspectionNumber||'Not present in snapshot'}`,`Source: ${entry.addition?'Added after inspection':'Original inspection evidence'}`);
    if(entry.addition)details.push(`Addition ID: ${entry.addition.id}`,`Added by: ${entry.addition.addedBy||'Not recorded'}`,`Added at: ${dateTime(entry.addition.addedAt)}`,`Added timestamp: ${entry.addition.addedAt||'Not recorded'}`,`Mutation ID: ${entry.addition.mutationId||'Not recorded'}`);
    else details.push(`Checked by: ${entry.attempt?.checkedBy||'Not recorded'}`,`Checked at: ${dateTime(entry.attempt?.checkedAt)}`);
  }
  await doc.attach(new TextEncoder().encode(details.join('\n')+'\n'),'QA_Details.txt',{mimeType:'text/plain',description:'Complete Gate order QA metadata, histories, saved checklists and evidence provenance'});

  newPage();
  textAt('Project: '+(report.project||'Not recorded'),34,494,570,10.5,2);textAt('Order: '+(report.orderNumber||'Not recorded'),650,494,158,10.5,2);
  textAt('Villa: '+(report.villa||'Not recorded'),34,463,300,9.3,2);textAt('Type: '+(report.orderType||'Gate'),352,463,242,9.3,2);textAt('Colour: '+(report.colour||'Not recorded'),612,463,196,9.3,2);
  textAt(`Total area: ${report.areaM2==null?'Not recorded':report.areaM2+' m²'} · Drawn: ${report.drawn?'Yes':'No'} · Order status: ${report.orderStatus||'Not recorded'}`,34,435,774,9.2,1);
  const overallFill=overall==='approved'?rgb(.88,.95,.90):['recut','failed'].includes(overall)?rgb(.99,.90,.89):rgb(1,.95,.8);
  page.drawRectangle({x:34,y:385,width:774,height:30,color:overallFill});textAt('Overall QA: '+statusLabel(overall),44,409,430,12,1,charcoal);
  const summary=report.summary||{};
  textAt(`${summary.total??items.length} pieces · Quantity ${summary.totalQuantity??items.reduce((sum,item)=>sum+(Number(item.quantity)||1),0)}\n${summary.approved??items.filter(item=>item.status==='approved').length} approved · ${summary.recut??items.filter(item=>['recut','failed'].includes(item.status)).length} recut · ${summary.awaiting??items.filter(item=>['awaiting','pending','not_drawn'].includes(item.status)).length} awaiting · ${summary.missing??items.filter(item=>item.status==='missing').length} missing`,492,411,306,8.4,2);
  y=375;
  if(mappingIssues.length){page.drawRectangle({x:34,y:y-30,width:774,height:30,color:rgb(1,.95,.8)});textAt('QA mapping requires review: '+mappingIssues[0]+(mappingIssues.length>1?` · ${mappingIssues.length} issues in attached details.`:''),42,y-5,758,9,2);y-=38;}
  const overviewRows=currentModels.map(({item,latest})=>[setName(item),pieceName(item),String(item.quantity??1),statusLabel(item.status==='approved'&&!approvedItem(item)?'missing':item.status),latest?.checkedBy||'—',latest?.checkedAt?dateTime(latest.checkedAt):'—',checkSummary(latest,item)]);
  table(['Set','Piece','Qty','Status','Checked by','Checked at','Checks'],overviewRows.length?overviewRows:[['—','No current components configured.','—',statusLabel(overall),'—','—','Not inspected']],[35,130,40,95,110,130,234],{title:'Current component overview',maxLines:3});
  const notes=currentModels.filter(({latest})=>latest?.notes||latest?.overrideReason),noteRows=notes.map(({item,latest})=>[`Set ${setName(item)} · ${pieceName(item)}`,[latest.notes,latest.overrideReason?'Administrator override: '+latest.overrideReason:''].filter(Boolean).join('\n')]);
  const noteHeight=31+21.5+noteRows.reduce((sum,row)=>sum+Math.max(...row.map((value,index)=>Math.min(5,wrap(value,[204,550][index],8.5).length)))*11.5+10,0)+12;
  const notesOnOverview=notes.length>0&&y-noteHeight>=60;
  if(notesOnOverview){band('Current inspection notes');table(['Set / piece','Notes / administrator override'],noteRows,[214,560],{title:'Current inspection notes',maxLines:5});}

  if(shared.length||currentModels.some(model=>model.latest)){
    newPage('Shared Gate checklist and current results');
    const legend=shared.map(([key,label],index)=>({key,label,code:'C'+(index+1)})),known=new Set(legend.map(entry=>JSON.stringify([entry.key,entry.label])));
    for(const {item,latest}of currentModels)for(const key of Object.keys(latest?.results||{})){const label=attemptLabels(latest,item)[key]||key,identity=JSON.stringify([key,label]);if(!known.has(identity)){known.add(identity);legend.push({key,label,code:'C'+(legend.length+1)});}}
    const middle=Math.ceil(legend.length/2),legendRows=legend.slice(0,middle).map((entry,index)=>[entry.code,entry.label,legend[middle+index]?.code||'',legend[middle+index]?.label||'']);
    if(legendRows.length){table(['ID','Criterion','ID','Criterion'],legendRows,[35,352,35,352],{size:8.2,title:'Shared Gate checklist definitions'});y+=12;}
    for(let start=0;start<legend.length;start+=8){
      const batch=legend.slice(start,start+8);ensure(95);band('Current inspection results'+(legend.length>8?` · ${batch[0].code}–${batch.at(-1).code}`:''));
      const widths=[214,...batch.map(()=>560/batch.length)],rows=currentModels.map(({item,latest})=>[`Set ${setName(item)} · ${pieceName(item)}`,...batch.map(({key,label})=>!latest?'Not inspected':attemptLabels(latest,item)[key]!==label?'—':latest.results?.[key]==='pass'?'Pass':latest.results?.[key]==='fail'?'Fail':latest.results?.[key]==='na'?'N/A':'—')]);
      table(['Set / piece',...batch.map(entry=>entry.code)],rows,widths,{size:8.2,title:'Current inspection results',maxLines:3});
    }
    if(notes.length&&!notesOnOverview){ensure(95);band('Current inspection notes');table(['Set / piece','Notes / administrator override'],noteRows,[214,560],{title:'Current inspection notes',maxLines:5});}
  }
  if(oldModels.length){
    newPage('Previous revisions — excluded from current approval');
    paragraph('Earlier, withdrawn and superseded QA is retained for reference. These records do not contribute to current order approval.');
    table(['Set / piece','Qty','Last status','Checked by','Checked at','Reason retained'],oldModels.map(({item,latest})=>[`Set ${setName(item)} · ${pieceName(item)}`,String(item.quantity??1),statusLabel(item.status||latest?.status),latest?.checkedBy||'—',latest?.checkedAt?dateTime(latest.checkedAt):'—',item.reason||'Previous revision']),[190,40,95,110,130,209],{title:'Previous revisions — excluded from current approval',maxLines:4});
  }
  for(const previousRevision of [false,true]){
    const gallery=evidence.filter(entry=>entry.model.previous===previousRevision);
    for(let offset=0;offset<gallery.length;offset+=4){
      newPage('Evidence gallery — '+(previousRevision?'previous revisions':'current components'));
      for(const [index,entry]of gallery.slice(offset,offset+4).entries()){
        const x=34+(index%2)*396,top=455-Math.floor(index/2)*199,width=378,height=187,bottom=top-height;
        page.drawRectangle({x,y:bottom,width,height,borderWidth:.6,borderColor:rule});
        textAt(`Set ${setName(entry.model.item)} · ${pieceName(entry.model.item)} · Inspection ${entry.inspectionNumber||'not present'}`,x+9,top-7,width-18,9,2);
        if(entry.image){const scale=Math.min((width-18)/entry.image.width,112/entry.image.height),w=entry.image.width*scale,h=entry.image.height*scale;page.drawImage(entry.image,{x:x+(width-w)/2,y:bottom+38+(112-h)/2,width:w,height:h});}
        else textAt('Original WebP evidence is attached.\nOpen the attachment to view this photo.',x+12,top-67,width-24,9,3);
        textAt(`${entry.addition?'Added':'Original'}: ${entry.fileName} · ${entry.addition?'by '+(entry.addition.addedBy||'Not recorded'):'checked by '+(entry.attempt?.checkedBy||'Not recorded')}`,x+9,bottom+29,width-18,7.8,1);
        textAt(dateTime(entry.addition?.addedAt||entry.attempt?.checkedAt)+(entry.addition?' · Added after inspection':''),x+9,bottom+17,width-18,7.8,1);
      }
    }
  }
  const pages=doc.getPages();
  for(const [index,current]of pages.entries()){
    current.drawText(abbreviated?'Some values are abbreviated (… / □). Full UTF-8 details and original evidence are attached in QA_Details.txt.':'Full histories, check details, notes and original evidence are attached in QA_Details.txt.',{x:34,y:48,font,size:7.5,color:ink});
    current.drawLine({start:{x:34,y:35},end:{x:808,y:35},thickness:.5,color:rule});current.drawText('Lennox Facades · Gate order QA report',{x:34,y:21,font,size:7,color:ink});current.drawText(`${index+1} / ${pages.length}`,{x:765,y:21,font,size:8,color:ink});
  }
  doc.setTitle(`Lennox Facades — Gate Order QA Report — ${report.project} — Order ${report.orderNumber}`);doc.setAuthor('Lennox Facades');doc.setCreator('PanelStock Gate QA');doc.setSubject('Consolidated current Gate components, previous revisions and supporting QA evidence');
  if(Number.isFinite(new Date(report.generatedAt).getTime())){doc.setCreationDate(new Date(report.generatedAt));doc.setModificationDate(new Date(report.generatedAt));}
  return doc.save();
}
