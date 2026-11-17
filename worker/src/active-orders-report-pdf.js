import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {toolboxPdfAssets} from './toolbox-pdf-assets.js';

const zone='Australia/Brisbane';
export function reportDate(value,{time=false}={}){
  if(!value)return 'Not set';
  const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00+10:00':value);
  if(!Number.isFinite(date.getTime()))return 'Not set';
  return new Intl.DateTimeFormat('en-AU',{timeZone:zone,day:'2-digit',month:'short',year:'numeric',...(time?{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}:{})}).format(date)+(time?' AEST':'');
}
export function activeOrdersReportFilename(report){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(report.generatedAt));
  const part=type=>parts.find(value=>value.type===type).value;
  return `Active_Site_Orders_${part('year')}-${part('month')}-${part('day')}.pdf`;
}

// Approved layout A: one compact register row per order, followed by a pale
// full-width contact/notes row. Oversized content continues without truncation.
export async function createActiveOrdersReportPdf(report){
  const doc=await PDFDocument.create(),assets=toolboxPdfAssets();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(assets.font,{subset:true}),logo=await doc.embedJpg(assets.logo),supported=new Set(font.getCharacterSet());
  const ink=rgb(.13,.20,.24),teal=rgb(.08,.37,.44),muted=rgb(.37,.44,.48),pale=rgb(.94,.97,.98),rule=rgb(.80,.85,.88),white=rgb(1,1,1);
  const width=842,height=595,left=34,right=808,bottom=44,bodyWidth=right-left;
  const widths=[112,90,64,78,78,86,266],starts=widths.map((_,i)=>left+widths.slice(0,i).reduce((sum,value)=>sum+value,0));
  let page,y,bodyTop=444,symbolFallback=false;
  const clean=value=>[...String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'')].map(character=>{
    if(character==='\n'||supported.has(character.codePointAt(0)))return character;
    symbolFallback=true;return '□';
  }).join('');
  function wrap(value,maxWidth,size){
    const lines=[];
    for(const paragraph of clean(value).split('\n')){
      let line='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(font.widthOfTextAtSize(word,size)>maxWidth){
          if(line){lines.push(line);line='';}
          for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>maxWidth){lines.push(line);line='';}line+=char;}
        }else if(line&&font.widthOfTextAtSize(line+' '+word,size)>maxWidth){lines.push(line);line=word;}
        else line+=(line?' ':'')+word;
      }
      lines.push(line||' ');
    }
    return lines;
  }
  function draw(value,x,top,size=8.3,color=ink){page.drawText(clean(value),{x,y:top-size,font,size,color});}
  function tableHeader(){
    page.drawRectangle({x:left,y:y-23,width:bodyWidth,height:23,color:teal});
    ['ORDER / PROJECT','TYPE / LOCATION','ORDERED','REQUESTED','SCHEDULED','STATUS','ITEMS / ORDERED QTY'].forEach((label,i)=>draw(label,starts[i]+6,y-7,7,white));y-=23;
  }
  function newPage(){
    page=doc.addPage([width,height]);
    page.drawRectangle({x:0,y:height-4,width,height:4,color:teal});
    page.drawImage(logo,{x:left,y:520,width:125,height:125*logo.height/logo.width});
    draw('ACTIVE SITE ORDERS',192,563,18,teal);
    draw(`COMPACT REGISTER · ${report.orders.length} active order${report.orders.length===1?'':'s'}`,192,538,10);
    draw('Generated '+reportDate(report.generatedAt,{time:true})+' · '+report.generatedBy,192,521,8,muted);
    page.drawLine({start:{x:left,y:504},end:{x:right,y:504},thickness:1,color:rule});y=492;
    draw('Includes Ready for dispatch. Excludes dispatched and cancelled orders. Quantities shown are the amounts ordered.',left+6,y,7.3,muted);y-=25;
    if(report.filterSummary?.length){for(const line of wrap('Filters: '+report.filterSummary.join(' · '),bodyWidth-12,7.3)){draw(line,left+6,y,7.3,muted);y-=10.5;}y-=7;}
    tableHeader();bodyTop=y;
  }
  const deliveryValue=(date,time)=>reportDate(date)+(date&&time?'\n'+time:'');
  function cells(order,continued=false){
    return [`#${order.orderNumber||'—'}\n${order.project||'No project'}${continued?'\n(continued)':''}`,
      (order.orderType||'Not set')+(order.location?'\n'+order.locationLabel+': '+order.location:''),
      reportDate(order.dateOrdered),deliveryValue(order.requestedDeliveryDate,order.requestedDeliveryTime),
      order.scheduledDeliveryDate?deliveryValue(order.scheduledDeliveryDate,order.scheduledDeliveryTime):'Not scheduled',order.statusLabel,
      order.items.length?order.items.map(item=>`${item.quantity??'Not recorded'} × ${item.description||'No description'}`).join('\n'):'No item details recorded.'
    ].map((value,i)=>wrap(value,widths[i]-12,8.3));
  }
  function detailLines(order){
    const lines=[`Ordered by: ${order.requestedByName||'Not recorded'} · Contact: ${order.siteContact||'Not recorded'} · Phone: ${order.phone||'Not recorded'}`];
    const site=[order.siteAddress?'Site: '+order.siteAddress:'',order.colour?'Colour: '+order.colour:'',order.areaM2?'Gate area: '+order.areaM2+' m²':''].filter(Boolean);
    if(site.length)lines.push(site.join(' · '));
    if(order.notes)lines.push('Notes: '+order.notes);
    for(const note of order.adminNotes||[])lines.push('Admin note — '+note.author+' · '+reportDate(note.createdAt,{time:true})+': '+note.text);
    return lines.flatMap(line=>wrap(line,bodyWidth-12,7.3));
  }
  function row(lines){
    const count=Math.max(...lines.map(column=>column.length)),rowHeight=count*11.5+12;
    for(let i=0;i<lines.length;i++)for(let j=0;j<lines[i].length;j++)draw(lines[i][j],starts[i]+6,y-6-j*11.5);
    y-=rowHeight;
  }
  function details(lines){
    const rowHeight=lines.length*10.5+12;
    page.drawRectangle({x:left,y:y-rowHeight,width:bodyWidth,height:rowHeight,color:pale});
    lines.forEach((line,i)=>draw(line,left+6,y-6-i*10.5,7.3,muted));y-=rowHeight;
    page.drawLine({start:{x:left,y},end:{x:right,y},thickness:.5,color:rule});
  }
  newPage();
  if(!report.orders.length)draw('No active Site Orders match these filters.',left+6,y-12,11);
  for(const order of report.orders){
    const columns=cells(order),notes=detailLines(order),mainHeight=Math.max(...columns.map(lines=>lines.length))*11.5+12,notesHeight=notes.length*10.5+12;
    // Keep normal-sized rows and their notes together. Only genuinely oversized
    // orders split, retaining identity and column headings on every page.
    if(mainHeight+notesHeight<=bodyTop-bottom){if(y-mainHeight-notesHeight<bottom)newPage();row(columns);details(notes);continue;}
    let index=0;
    const total=Math.max(...columns.map(lines=>lines.length));
    while(index<total){
      if(y-bottom<47)newPage();
      if(index>0){
        const identity=wrap(`#${order.orderNumber||'—'} · ${order.project||'No project'} (continued)`,bodyWidth-12,8.3);
        if(y-bottom<identity.length*11.5+35)newPage();
        identity.forEach(line=>{draw(line,left+6,y-6);y-=11.5;});y-=12;
      }
      const capacity=Math.floor((y-bottom-12)/11.5),take=Math.min(total-index,capacity);
      row(columns.map(lines=>lines.slice(index,index+take)));index+=take;
      if(index<total)newPage();
    }
    let offset=0;
    while(offset<notes.length){
      const continuation=offset>0||y-bottom<23;
      if(y-bottom<23)newPage();
      if(continuation){
        const identity=wrap(`#${order.orderNumber||'—'} · ${order.project||'No project'} — details continued`,bodyWidth-12,8.3);
        if(y-bottom<identity.length*11.5+35)newPage();
        identity.forEach(line=>{draw(line,left+6,y-6);y-=11.5;});y-=12;
      }
      const capacity=Math.max(1,Math.floor((y-bottom-12)/10.5)),chunk=notes.slice(offset,offset+capacity);
      details(chunk);offset+=chunk.length;if(offset<notes.length)newPage();
    }
  }
  const pages=doc.getPages();
  for(const [index,p]of pages.entries()){
    p.drawLine({start:{x:left,y:32},end:{x:right,y:32},thickness:.5,color:rule});
    p.drawText('Lennox Facades · PanelStock · Active Site Orders',{x:left,y:19,font,size:8,color:muted});
    const label=`Page ${index+1} of ${pages.length}`;
    p.drawText(label,{x:right-font.widthOfTextAtSize(label,8),y:19,font,size:8,color:muted});
  }
  if(symbolFallback)await doc.attach(new TextEncoder().encode(JSON.stringify(report,null,2)),'Active_Orders_Details.json',{mimeType:'application/json',description:'Original text for symbols unavailable in the report font; shown as a square in the PDF.'});
  doc.setTitle('Lennox Facades — Active Site Orders');doc.setSubject('Layout A — Compact register');doc.setAuthor('Lennox Facades');doc.setCreator('PanelStock');doc.setCreationDate(new Date(report.generatedAt));
  return doc.save();
}
