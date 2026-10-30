import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {toolboxPdfAssets} from './toolbox-pdf-assets.js';

const statusLabel=item=>item?.qaResolved===false&&item.qaBlocker?item.qaBlocker:item?.resolvedSeparatelyAt?'Recut completed separately':({approved:'Approved',replaced:'Replaced · QA approved',not_required:'QA not required',recut:'Recut required',awaiting:'Awaiting QA',awaiting_routing:'Awaiting routing',pre_qa:'Pre-QA'}[typeof item==='string'?item:item?.status]||'Awaiting QA');
const timestamp=value=>{
  if(!value||!Number.isFinite(new Date(value).getTime()))return 'Not recorded';
  const parts=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)),part=type=>parts.find(p=>p.type===type)?.value;
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')} AEST`;
};
export function qaReportPdfFilename(report){
  const safe=value=>String(value||'Unknown').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,100);
  return `QA_Report_${safe(report.project)}_Order_${safe(report.orderNumber)}.pdf`;
}

// Each panel has exactly one readable overview page. Complete source details
// and original evidence are attached rather than creating continuation pages.
export async function createQaReportPdf(report){
  const assets=toolboxPdfAssets(),doc=await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font=await doc.embedFont(assets.font,{subset:true}),logo=await doc.embedJpg(assets.logo),
    ink=rgb(.22,.23,.24),charcoal=rgb(.28,.29,.30),cyan=rgb(0,.67,.77),pale=rgb(.92,.97,.98),rule=rgb(.78,.82,.84),white=rgb(1,1,1),
    supported=new Set(font.getCharacterSet()),labels=Object.fromEntries(report.checklists?.panel||[]),items=report.items||[],photos=new Map(),models=[];
  if(!items.length)throw Error('No panels were found for this QA report.');
  let overflow=false;
  function displayText(value){
    return [...String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'')].map(character=>{
      if(character==='\n'||supported.has(character.codePointAt(0)))return character;
      overflow=true;return '□';
    }).join('');
  }
  function wrap(value,width,size){
    const result=[];
    for(const paragraph of displayText(value??'—').split('\n')){
      let line='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(font.widthOfTextAtSize(word,size)>width){
          if(line){result.push(line);line='';}
          for(const character of word){if(line&&font.widthOfTextAtSize(line+character,size)>width){result.push(line);line='';}line+=character;}
        }else if(line&&font.widthOfTextAtSize(line+' '+word,size)>width){result.push(line);line=word;}
        else line+=(line?' ':'')+word;
      }
      result.push(line||' ');
    }
    return result;
  }
  function fit(value,width,size,maxLines){
    const lines=wrap(value,width,size);
    if(lines.length<=maxLines)return lines;
    overflow=true;
    const visible=lines.slice(0,maxLines),last=[...visible[maxLines-1]];
    while(last.length&&font.widthOfTextAtSize(last.join('')+'…',size)>width)last.pop();
    visible[maxLines-1]=last.join('')+'…';return visible;
  }
  function textBox(page,value,x,top,width,maxLines=1,size=9.3,color=ink,pitch=size+3){
    const lines=fit(value,width,size,maxLines);
    for(const [index,line]of lines.entries())page.drawText(line,{x,y:top-size-index*pitch,font,size,color});
    return lines.length*pitch;
  }
  function sectionHeader(page,title,x,top,width){
    page.drawRectangle({x,y:top-23,width,height:23,color:charcoal});
    textBox(page,title,x+8,top-5,width-16,1,9.2,white);
  }
  function noInspection(item){
    return item.status==='not_required'?'QA not required — no checklist results are recorded for this exemption.':item.status==='awaiting_routing'?'Awaiting routing — no QA inspection recorded.':item.status==='pre_qa'?'Pre-QA — completed before QA tracking began; no QA inspection recorded.':'No QA inspection has been recorded for this panel.';
  }
  async function preparePhoto(source,item,inspectionNumber){
    if(photos.has(source))return photos.get(source);
    const match=String(source).match(/^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/);
    if(!match)throw Error(`A QA evidence photo for panel ${item.reference||item.id||'Unknown'} is invalid. No PDF was generated.`);
    try{
      const bytes=Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0)),extension=match[1]==='jpeg'?'jpg':match[1],fileName=`QA_Photo_${String(photos.size+1).padStart(3,'0')}.${extension}`;
      let image;
      if(match[1]==='webp'){
        const signature=new TextDecoder().decode(bytes.subarray(0,12));
        if(bytes.length<20||signature.slice(0,4)!=='RIFF'||signature.slice(8,12)!=='WEBP')throw Error('Invalid WebP');
      }else image=match[1]==='png'?await doc.embedPng(bytes):await doc.embedJpg(bytes);
      await doc.attach(bytes,fileName,{mimeType:'image/'+match[1],description:`Original QA evidence · Sheet ${item.sheetNumber||'Not recorded'} · Panel ${item.reference||'Not recorded'} · Inspection ${inspectionNumber}`});
      const saved={image,fileName,webp:match[1]==='webp'};photos.set(source,saved);return saved;
    }catch{throw Error(`A QA evidence photo for panel ${item.reference||item.id||'Unknown'} could not be opened. No PDF was generated.`);}
  }

  for(const item of items){
    const attempts=Array.isArray(item.history)?item.history.slice():[],latestSnapshot=item.latest?JSON.stringify(item.latest):null;
    const isLatest=attempt=>attempt===item.latest||((!attempt.id||!item.latest?.id||attempt.id===item.latest.id)&&JSON.stringify(attempt)===latestSnapshot);
    if(item.latest&&!attempts.some(isLatest))attempts.push(item.latest);
    const latest=item.latest||attempts.at(-1)||null;
    for(const [index,attempt]of attempts.entries())if(attempt.photo)await preparePhoto(attempt.photo,item,index+1);
    models.push({item,attempts,latest,latestNumber:item.latest?attempts.findIndex(isLatest)+1:attempts.length});
  }

  const details=['Lennox Facades — Order QA Report','Complete details and original evidence register','Encoding: UTF-8','',`Project: ${report.project||'Not recorded'}`,`Order number: ${report.orderNumber||'Not recorded'}`,`Generated by: ${report.generatedBy||'Not recorded'}`,`Generated at: ${timestamp(report.generatedAt)}`,`Generated timestamp: ${report.generatedAt||'Not recorded'}`,`Panels: ${items.length}`,'','CHECKLIST DEFINITIONS'];
  for(const [key,label]of report.checklists?.panel||[])details.push(`${key}: ${label}`);
  const readableKey=value=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,character=>character.toUpperCase());
  const readableValue=value=>value===null||value===undefined?'Not recorded':typeof value==='object'?JSON.stringify(value,null,2):String(value);
  for(const [index,{item,attempts,latestNumber}]of models.entries()){
    details.push('','='.repeat(72),`PANEL ${index+1}: Sheet ${item.sheetNumber||'Not recorded'} · Panel ${item.reference||'Not recorded'}`,`Current status: ${statusLabel(item)}`,'','PANEL METADATA');
    for(const [key,value]of Object.entries(item))if(!['history','latest','qaExemption','qaExemptionHistory'].includes(key))details.push(`${readableKey(key)}: ${readableValue(value)}`);
    if(item.qaExemption||item.qaExemptionHistory?.length||item.status==='not_required'){
      details.push('','QA EXEMPTION',`Active exemption: ${item.status==='not_required'?'QA not required':'None'}`);
      if(item.qaExemption){
        details.push(item.status==='not_required'?'CURRENT EXEMPTION METADATA':'STORED EXEMPTION METADATA (INACTIVE)');
        for(const [key,value]of Object.entries(item.qaExemption))details.push(`${readableKey(key)}: ${readableValue(value)}`);
      }
      details.push('','QA EXEMPTION HISTORY');
      const events=Array.isArray(item.qaExemptionHistory)?item.qaExemptionHistory:[];
      if(!events.length)details.push('No exemption events recorded.');
      for(const [eventIndex,event]of events.entries()){
        details.push('',`EXEMPTION EVENT ${eventIndex+1} — ${event.action==='grant'?'GRANTED':event.action==='revoke'?'REVOKED':readableValue(event.action)}`);
        for(const [key,value]of Object.entries(event))details.push(`${readableKey(key)}: ${readableValue(value)}`);
      }
    }
    details.push('',`Latest inspection: ${latestNumber||'None'} of ${attempts.length}`);
    if(!attempts.length)details.push(noInspection(item));
    for(const [attemptIndex,attempt]of attempts.entries()){
      details.push('','-'.repeat(56),`INSPECTION ${attemptIndex+1}${attemptIndex+1===latestNumber?' — LATEST':''}`,`Inspection status: ${statusLabel(attempt)}`);
      for(const [key,value]of Object.entries(attempt))if(!['results','notes','overrideReason','photo'].includes(key))details.push(`${readableKey(key)}: ${readableValue(value)}`);
      details.push('','CHECKLIST RESULTS');
      const results=Object.entries(attempt.results||{});
      if(!results.length)details.push('No checklist results recorded.');
      for(const [key,value]of results)details.push(`${labels[key]||key} [${key}]: ${readableValue(value)}`);
      if(attempt.notes)details.push('','NOTES',attempt.notes);
      if(attempt.overrideReason)details.push('','ADMINISTRATOR OVERRIDE',attempt.overrideReason);
      if(attempt.photo)details.push('','ORIGINAL EVIDENCE ATTACHMENT',photos.get(attempt.photo).fileName);
    }
  }
  await doc.attach(new TextEncoder().encode(details.join('\n')+'\n'),'QA_Details.txt',{mimeType:'text/plain',description:'Complete UTF-8 QA snapshot: panel metadata, all inspection history, check results, notes, overrides and original evidence register'});

  for(const [index,{item,attempts,latest,latestNumber}]of models.entries()){
    overflow=false;
    const page=doc.addPage([842,595]),left=34,leftWidth=430,right=484,rightWidth=324,columnTop=344,bottom=78,notRequired=item.status==='not_required',exemption=notRequired?item.qaExemption:null;
    page.drawRectangle({x:0,y:591,width:842,height:4,color:cyan});
    page.drawImage(logo,{x:34,y:522,width:124,height:124*logo.height/logo.width});
    page.drawText('ORDER QA REPORT',{x:192,y:556,font,size:17,color:charcoal});
    page.drawText(notRequired?'One panel per page · QA requirement and exemption details':'One panel per page · Latest inspection and supporting evidence',{x:192,y:538,font,size:9,color:ink});
    page.drawText('Generated '+timestamp(report.generatedAt),{x:192,y:521,font,size:9,color:charcoal});
    page.drawLine({start:{x:34,y:508},end:{x:808,y:508},thickness:1.5,color:cyan});
    textBox(page,'Project: '+(report.project||'Not recorded'),34,496,570,2,10);
    textBox(page,'Order: '+(report.orderNumber||'Not recorded'),620,496,188,2,10);
    page.drawRectangle({x:34,y:423,width:774,height:40,color:pale});
    page.drawRectangle({x:34,y:423,width:3,height:40,color:cyan});
    textBox(page,`Sheet ${item.sheetNumber||'Not recorded'} · Panel ${item.reference||'Not recorded'}`,44,459,568,2,13,charcoal,15);
    const badge=item.qaResolved===false?rgb(1,.95,.8):notRequired?rgb(.87,.94,.98):['approved','replaced'].includes(item.status)?rgb(.88,.95,.90):item.status==='recut'?rgb(.99,.90,.89):rgb(.91,.94,.95);
    page.drawRectangle({x:624,y:431,width:176,height:24,color:badge});
    textBox(page,statusLabel(item),631,451,162,2,9,charcoal,10);
    const material=[item.material,item.colour,item.thickness?item.thickness+' mm':''].filter(Boolean).join(' · ')||'Not recorded',dimensions=item.width>0&&item.height>0?item.width+' × '+item.height+' mm':'Not recorded';
    textBox(page,'Material: '+material,34,414,494,2,9.4);
    textBox(page,`Dimensions: ${dimensions} · Qty ${item.quantity||1}`,542,414,266,2,9.4);
    textBox(page,`Cut: ${item.cutBy||'Not recorded'} · ${timestamp(item.cutAt)}`,34,382,leftWidth,2,9.2);
    if(notRequired){
      textBox(page,'Exempted by '+(exemption?.by||'Not recorded'),right,382,rightWidth,1,9.2);
      textBox(page,timestamp(exemption?.at),right,369.8,rightWidth,1,9.2);
    }else textBox(page,latest?`QA: ${latest.checkedBy||'Not recorded'} · ${timestamp(latest.checkedAt)}\nInspection ${latestNumber} of ${attempts.length} · ${statusLabel(latest)}`:'QA: Not inspected',right,382,rightWidth,2,9.2);
    sectionHeader(page,notRequired?'QA requirement':'Latest inspection checks',left,columnTop,leftWidth);
    if(!notRequired)textBox(page,'Result',left+356,columnTop-5,66,1,9.2,white);
    let checkY=columnTop-23;
    const results=notRequired?[]:Object.entries(latest?.results||{});
    if(!results.length){page.drawRectangle({x:left,y:checkY-52,width:leftWidth,height:52,borderWidth:.5,borderColor:rule});textBox(page,notRequired?noInspection(item):latest?'No checklist results recorded.':noInspection(item),left+8,checkY-9,leftWidth-16,3,9.3);}
    for(const [resultIndex,[key,value]]of results.entries()){
      const lines=fit(labels[key]||key,338,9.3,2),result=value==='pass'?'Pass':value==='fail'?'Fail':value==='na'?'N/A':String(value??'Not recorded'),height=Math.max(23,lines.length*12+8),remaining=results.length-resultIndex;
      if(checkY-height<(remaining>1?bottom+24:bottom)){
        overflow=true;page.drawRectangle({x:left,y:checkY-24,width:leftWidth,height:24,color:pale,borderWidth:.5,borderColor:rule});
        textBox(page,`${remaining} more check${remaining===1?'':'s'} in QA_Details.txt`,left+8,checkY-6,leftWidth-16,1,9.1);break;
      }
      page.drawRectangle({x:left,y:checkY-height,width:leftWidth,height,borderWidth:.5,borderColor:rule,...(resultIndex%2?{color:rgb(.97,.98,.98)}:{})});
      page.drawLine({start:{x:left+348,y:checkY},end:{x:left+348,y:checkY-height},thickness:.5,color:rule});
      for(const [lineIndex,line]of lines.entries())page.drawText(line,{x:left+8,y:checkY-6-9.3-lineIndex*12,font,size:9.3,color:ink});
      textBox(page,result,left+356,checkY-6,66,1,9.2,value==='fail'?rgb(.68,.12,.10):value==='pass'?rgb(.13,.39,.25):ink);checkY-=height;
    }
    const notes=notRequired?[exemption?.reason||'No exemption reason recorded.']:[];
    if(!notRequired&&latest?.notes)notes.push(latest.notes);
    if(!notRequired&&latest?.overrideReason)notes.push('Administrator override: '+latest.overrideReason);
    if(item.isRemake||item.remakeOf)notes.push('Remake'+(item.remakeOfReference?' of '+item.remakeOfReference:'')+(item.remakeReason?': '+item.remakeReason:''));
    if(item.replacementId)notes.push('Replacement'+(item.replacementReference?' '+item.replacementReference:'')+' · '+statusLabel(item.replacementStatus));
    if(item.resolvedSeparatelyAt)notes.push(`Recut completed separately by ${item.resolvedSeparatelyBy||'Not recorded'} · ${timestamp(item.resolvedSeparatelyAt)}${item.resolvedSeparatelyReason?'\n'+item.resolvedSeparatelyReason:''}`);
    if(!latest&&!notRequired)notes.unshift(noInspection(item));
    const photo=!notRequired&&latest?.photo?photos.get(latest.photo):null;
    let notesTop=columnTop;
    if(photo){
      sectionHeader(page,'QA photo · Latest inspection',right,columnTop,rightWidth);
      page.drawRectangle({x:right,y:187,width:rightWidth,height:134,color:rgb(.96,.97,.97),borderWidth:.5,borderColor:rule});
      if(photo.image){const scale=Math.min((rightWidth-12)/photo.image.width,122/photo.image.height),width=photo.image.width*scale,height=photo.image.height*scale;page.drawImage(photo.image,{x:right+(rightWidth-width)/2,y:187+(134-height)/2,width,height});}
      else textBox(page,'Original WebP evidence is attached.\nOpen the attachment to view the photo.',right+12,288,rightWidth-24,4,9.4);
      textBox(page,'Original: '+photo.fileName,right,182,rightWidth,1,8.5);notesTop=164;
    }
    sectionHeader(page,notRequired?'Exemption reason':'Notes and follow-up',right,notesTop,rightWidth);
    const notesHeight=notesTop-23-bottom,maxNoteLines=Math.max(1,Math.floor((notesHeight-10)/12));
    textBox(page,notes.length?notes.join('\n'):'No inspection notes recorded.',right+8,notesTop-31,rightWidth-16,maxNoteLines,9.3,ink,12);
    const notice=overflow?'Some text is abbreviated (… / □). Complete details and evidence are attached.':notRequired?'Full exemption history and reason are attached in QA_Details.txt.':'Full history, notes and original photos are attached; this page shows the latest inspection.';
    page.drawText(notice,{x:34,y:61,font,size:8,color:ink});
    page.drawText('Full details: QA Centre and QA_Details.txt · Open PDF attachments to view original evidence.',{x:34,y:49,font,size:8,color:ink});
    page.drawLine({start:{x:34,y:35},end:{x:808,y:35},thickness:.5,color:rule});
    page.drawText('Lennox Facades · Order QA report',{x:34,y:21,font,size:7,color:ink});
    page.drawText(`${index+1} / ${items.length}`,{x:765,y:21,font,size:8,color:ink});
  }
  doc.setTitle(`Lennox Facades — Order QA Report — ${report.project} — Order ${report.orderNumber}`);
  doc.setAuthor('Lennox Facades');doc.setCreator('PanelStock QA');doc.setSubject('Order QA snapshot, panel inspection history and supporting evidence');
  if(Number.isFinite(new Date(report.generatedAt).getTime())){doc.setCreationDate(new Date(report.generatedAt));doc.setModificationDate(new Date(report.generatedAt));}
  return doc.save();
}
