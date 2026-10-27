import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {toolboxPdfAssets} from './toolbox-pdf-assets.js';

const statusLabel=item=>item?.resolvedSeparatelyAt?'Recut completed separately':({approved:'Approved',replaced:'Replaced · QA approved',recut:'Recut required',awaiting:'Awaiting QA',awaiting_routing:'Awaiting routing',pre_qa:'Pre-QA'}[typeof item==='string'?item:item?.status]||'Awaiting QA');
const timestamp=value=>{
  if(!value||!Number.isFinite(new Date(value).getTime()))return 'Not recorded';
  const parts=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)),part=type=>parts.find(p=>p.type===type)?.value;
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')} AEST`;
};
export function qaReportPdfFilename(report){
  const safe=value=>String(value||'Unknown').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,100);
  return `QA_Report_${safe(report.project)}_Order_${safe(report.orderNumber)}.pdf`;
}

// Standalone QA snapshots share the Lennox audit report's logo, palette and
// page furniture. The source report is read-only; content is paginated in full.
export async function createQaReportPdf(report){
  const assets=toolboxPdfAssets(),doc=await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font=await doc.embedFont(assets.font,{subset:true}),logo=await doc.embedJpg(assets.logo),
    ink=rgb(.22,.23,.24),charcoal=rgb(.28,.29,.30),cyan=rgb(0,.67,.77),pale=rgb(.92,.97,.98),rule=rgb(.78,.82,.84),white=rgb(1,1,1),
    supported=new Set(font.getCharacterSet()),labels=Object.fromEntries(report.checklists?.panel||[]),items=report.items||[],photos=new Map();
  let page,y,context='';
  function clean(value){
    const text=String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
    for(const character of text)if(character!=='\n'&&!supported.has(character.codePointAt(0)))throw Error(`The PDF font cannot display “${character}” in this QA report.`);
    return text;
  }
  function wrap(value,width,size=8.5){
    const result=[];
    for(const paragraph of clean(value??'—').split('\n')){
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
  function drawBand(title){
    const lines=wrap(title,754,11),height=Math.max(24,lines.length*14+10);
    page.drawRectangle({x:34,y:y-height,width:774,height,color:pale});
    page.drawRectangle({x:34,y:y-height,width:3,height,color:cyan});
    for(const [index,line]of lines.entries())page.drawText(line,{x:44,y:y-16-index*14,font,size:11,color:charcoal});
    y-=height+7;
  }
  function newPage(continuation=''){
    page=doc.addPage([842,595]);
    page.drawRectangle({x:0,y:591,width:842,height:4,color:cyan});
    page.drawImage(logo,{x:34,y:522,width:124,height:124*logo.height/logo.width});
    page.drawText('ORDER QA REPORT',{x:192,y:556,font,size:17,color:charcoal});
    page.drawText('Panel inspections, production status and supporting evidence',{x:192,y:538,font,size:9,color:ink});
    page.drawText('Generated '+timestamp(report.generatedAt),{x:192,y:521,font,size:9,color:charcoal});
    page.drawLine({start:{x:34,y:508},end:{x:808,y:508},thickness:1.5,color:cyan});
    y=494;
    if(continuation)drawBand(continuation+' (continued)');
  }
  function ensure(height,continuation=context){if(y-height<42)newPage(continuation);}
  function band(title){ensure(Math.max(24,wrap(title,754,11).length*14+10)+55,'');drawBand(title);}
  function text(value,size=9){
    for(const line of wrap(value,774,size)){ensure(size+6);page.drawText(line,{x:34,y:y-size,font,size,color:ink});y-=size+6;}
    y-=4;
  }
  function table(headers,rows,widths,size=8.5,continuation=context){
    const pitch=size+3,head=headers.map((value,index)=>wrap(value,widths[index]-10,size));
    function draw(cells,heading=false){
      const height=Math.max(...cells.map(lines=>lines.length),1)*pitch+12;
      let x=34;
      for(const [index,width]of widths.entries()){
        page.drawRectangle({x,y:y-height,width,height,borderWidth:.5,borderColor:rule,...(heading?{color:charcoal}:{})});
        for(const [lineIndex,line]of(cells[index]||[]).entries())page.drawText(line,{x:x+5,y:y-8-size-lineIndex*pitch,font,size,color:heading?white:ink});
        x+=width;
      }
      y-=height;
    }
    const headHeight=Math.max(...head.map(lines=>lines.length))*pitch+12;
    ensure(headHeight+pitch+12,continuation);draw(head,true);
    for(const row of rows){
      let cells=row.map((value,index)=>wrap(value,widths[index]-10,size));
      while(cells.some(lines=>lines.length)){
        if(y-12-pitch<42){newPage(continuation);draw(head,true);}
        const count=Math.min(Math.max(...cells.map(lines=>lines.length)),Math.max(1,Math.floor((y-42-12)/pitch)));
        draw(cells.map(lines=>lines.slice(0,count)));
        cells=cells.map(lines=>lines.slice(count));
        if(cells.some(lines=>lines.length)){newPage(continuation);draw(head,true);}
      }
    }
    y-=12;
  }
  async function evidence(source,item,inspectionNumber){
    const evidenceTitle=`QA evidence · Sheet ${item.sheetNumber||'Not recorded'} · Panel ${item.reference||'Not recorded'} · Inspection ${inspectionNumber}`;
    newPage();band(evidenceTitle);
    text(`Panel record: ${item.id||'Not recorded'}`);
    const match=String(source).match(/^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/);
    if(!match)throw Error(`A QA evidence photo for panel ${item.reference||item.id||'Unknown'} is invalid. No PDF was generated.`);
    let saved=photos.get(source);
    if(!saved){
      try{
        const bytes=Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0));
        if(match[1]==='webp'){
          const signature=new TextDecoder().decode(bytes.subarray(0,12));
          if(bytes.length<20||signature.slice(0,4)!=='RIFF'||signature.slice(8,12)!=='WEBP')throw Error('Invalid WebP');
          const fileName=`QA_Evidence_${String(photos.size+1).padStart(3,'0')}.webp`;
          await doc.attach(bytes,fileName,{mimeType:'image/webp',description:'Original QA evidence photo'});saved={fileName};
        }else saved={image:match[1]==='png'?await doc.embedPng(bytes):await doc.embedJpg(bytes)};
        photos.set(source,saved);
      }catch{throw Error(`A QA evidence photo for panel ${item.reference||item.id||'Unknown'} could not be opened. No PDF was generated.`);}
    }
    if(saved.fileName){
      text('Original WebP evidence is included as a file attachment in this PDF.',11);
      text('Attachment: '+saved.fileName);
      text('Open this PDF in a viewer that supports file attachments to view the original photo. The image has been preserved in its original format.');
    }else{
      const image=saved.image,scale=Math.min(774/image.width,Math.max(100,y-65)/image.height);
      page.drawImage(image,{x:34,y:y-image.height*scale,width:image.width*scale,height:image.height*scale});y-=image.height*scale+14;
    }
  }

  newPage();
  table(['Project','Order number','Generated by','Generated at'],[[report.project,report.orderNumber,report.generatedBy,timestamp(report.generatedAt)]],[230,130,170,244],9,'Order details');
  text(`${items.length} panel${items.length===1?'':'s'} · Every scheduled panel in this order is included, including panels awaiting routing and Pre-QA panels.`);
  context='Order status summary';band(context);
  const counts=new Map();for(const item of items){const label=statusLabel(item);counts.set(label,(counts.get(label)||0)+1);}
  table(['Status','Panels'],[...counts].map(([label,count])=>[label,String(count)]),[644,130],9);
  for(const [index,item]of items.entries()){
    context=`Panel ${item.reference||'Not recorded'} · Sheet ${item.sheetNumber||'Not recorded'}`;
    ensure(180,'');band(`${index+1}. ${context} · ${statusLabel(item)}`);
    table(['Panel record','Quantity','Material / colour / thickness','Panel dimensions'],[[item.id,String(item.quantity||1),[item.material,item.colour,item.thickness?item.thickness+' mm':''].filter(Boolean).join('\n')||'Not recorded',item.width>0&&item.height>0?item.width+' × '+item.height+' mm':'Not recorded']],[210,64,300,200]);
    table(['Cut by','CNC completed'],[[item.cutBy||'Not recorded',timestamp(item.cutAt)]],[387,387]);
    if(item.isRemake||item.remakeOf)text('Remake'+(item.remakeOfReference||item.remakeOf?' of '+(item.remakeOfReference||item.remakeOf):'')+(item.remakeOf?' · Original record: '+item.remakeOf:'')+(item.remakeReason?'\nReason: '+item.remakeReason:''));
    if(item.replacementId)text('Replacement: '+(item.replacementReference||item.replacementId)+' · Record: '+item.replacementId+' · '+statusLabel(item.replacementStatus));
    if(item.resolvedSeparatelyAt)text(`Recut completed separately by ${item.resolvedSeparatelyBy||'Not recorded'} · ${timestamp(item.resolvedSeparatelyAt)}${item.resolvedSeparatelyReason?'\nReason: '+item.resolvedSeparatelyReason:''}`);
    const history=Array.isArray(item.history)&&item.history.length?item.history:item.latest?[item.latest]:[],attempts=history.slice().reverse();
    if(!attempts.length)text(item.status==='awaiting_routing'?'Awaiting routing — no QA inspection recorded.':item.status==='pre_qa'?'Pre-QA — completed before QA tracking began; no QA inspection recorded.':'No QA inspection has been recorded for this panel.');
    for(const [attemptIndex,attempt]of attempts.entries()){
      const inspectionNumber=attempts.length-attemptIndex;
      context=`Panel ${item.reference||'Not recorded'} · Sheet ${item.sheetNumber||'Not recorded'} · Inspection ${inspectionNumber}`;
      ensure(220,'');
      band(`Inspection ${inspectionNumber} · ${statusLabel(attempt)} · Panel ${item.reference||'Not recorded'} · Sheet ${item.sheetNumber||'Not recorded'}`);
      table(['Inspection record','Checked by','Checked at'],[[attempt.id||'Not recorded',attempt.checkedBy||'Not recorded',timestamp(attempt.checkedAt)]],[254,240,280]);
      const results=Object.entries(attempt.results||{});
      table(['Inspection check','Result'],results.length?results.map(([key,value])=>[labels[key]||key,value==='pass'?'Pass':value==='fail'?'Fail':value==='na'?'N/A':String(value??'Not recorded')]):[['No checklist results recorded.','—']],[644,130]);
      if(attempt.notes){band('Inspection notes · '+context);text(attempt.notes);}
      if(attempt.overrideReason){band('Administrator override · '+context);text(attempt.overrideReason);}
      if(attempt.photo)await evidence(attempt.photo,item,inspectionNumber);
    }
    y-=12;
  }
  const pages=doc.getPages();
  for(const [index,current]of pages.entries()){
    current.drawLine({start:{x:34,y:35},end:{x:808,y:35},thickness:.5,color:rule});
    current.drawText('Lennox Facades · Order QA report',{x:34,y:21,font,size:7,color:ink});
    current.drawText(`${index+1} / ${pages.length}`,{x:765,y:21,font,size:8,color:ink});
  }
  doc.setTitle(`Lennox Facades — Order QA Report — ${report.project} — Order ${report.orderNumber}`);
  doc.setAuthor('Lennox Facades');doc.setCreator('PanelStock QA');
  doc.setSubject('Order QA snapshot, panel inspection history and supporting evidence');
  if(Number.isFinite(new Date(report.generatedAt).getTime())){doc.setCreationDate(new Date(report.generatedAt));doc.setModificationDate(new Date(report.generatedAt));}
  return doc.save();
}
