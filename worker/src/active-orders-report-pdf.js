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

// A flowing report, rather than concatenated order dockets. All details wrap
// and continue onto further pages; item headers and order identity repeat.
export async function createActiveOrdersReportPdf(report){
  const doc=await PDFDocument.create(),assets=toolboxPdfAssets();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(assets.font,{subset:true}),logo=await doc.embedJpg(assets.logo),supported=new Set(font.getCharacterSet());
  const ink=rgb(.13,.20,.24),teal=rgb(.08,.37,.44),muted=rgb(.37,.44,.48),pale=rgb(.94,.97,.98),rule=rgb(.80,.85,.88),white=rgb(1,1,1);
  const width=842,height=595,left=34,right=808,bottom=44,bodyWidth=right-left;
  let page,y,current=null,inItems=false,symbolFallback=false;
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
  function draw(value,x,top,size=9,color=ink){page.drawText(clean(value),{x,y:top-size,font,size,color});}
  function tableHeader(){
    page.drawRectangle({x:left,y:y-19,width:bodyWidth,height:19,color:teal});
    draw('ITEM DESCRIPTION',left+8,y-4,8,white);draw('ORDERED QTY',right-96,y-4,8,white);y-=19;
  }
  function orderHeading(continued=false){
    const title=`#${current.orderNumber||'—'} — ${current.project||'No project'} — ${current.orderType||'Not set'}${continued?' (continued)':''}`;
    for(const line of wrap(title,bodyWidth-16,11)){
      page.drawRectangle({x:left,y:y-19,width:bodyWidth,height:19,color:pale});draw(line,left+8,y-3,11,teal);y-=19;
    }
    y-=7;
  }
  function newPage(){
    page=doc.addPage([width,height]);
    page.drawRectangle({x:0,y:height-4,width,height:4,color:teal});
    page.drawImage(logo,{x:left,y:520,width:125,height:125*logo.height/logo.width});
    draw('ACTIVE SITE ORDERS',192,563,18,teal);
    draw(`${report.orders.length} active order${report.orders.length===1?'':'s'} · Grouped by project`,192,538,10);
    draw('Generated '+reportDate(report.generatedAt,{time:true})+' · '+report.generatedBy,192,521,8,muted);
    page.drawLine({start:{x:left,y:504},end:{x:right,y:504},thickness:1,color:teal});y=492;
    if(current){orderHeading(true);if(inItems)tableHeader();}
  }
  function ensure(space){if(y-space<bottom)newPage();}
  function flow(value,size=9,color=ink){
    for(const line of wrap(value,bodyWidth-16,size)){ensure(size+4);draw(line,left+8,y,size,color);y-=size+4;}
  }
  function field(label,value){if(value){flow(label+': '+value);y-=3;}}
  const deliveryValue=(date,time)=>reportDate(date)+(time?' · '+time:'');
  const dateColumns=order=>[['DATE ORDERED',reportDate(order.dateOrdered)],['REQUESTED DELIVERY',deliveryValue(order.requestedDeliveryDate,order.requestedDeliveryTime)],['SCHEDULED DELIVERY',order.scheduledDeliveryDate?deliveryValue(order.scheduledDeliveryDate,order.scheduledDeliveryTime):'Not scheduled'],['STATUS',order.statusLabel]];
  function orderHeight(order){
    const lines=value=>wrap(value,bodyWidth-16,9).length*13;
    const fields=[[order.locationLabel,order.location],['Colour',order.colour],['Gate area',order.areaM2?order.areaM2+' m²':''],['Site address',order.siteAddress],['Ordered by',order.requestedByName||'Not recorded'],['Notes',order.notes],...(order.adminNotes||[]).map(note=>['Admin note — '+note.author+' · '+reportDate(note.createdAt,{time:true}),note.text])];
    const title=`#${order.orderNumber||'—'} — ${order.project||'No project'} — ${order.orderType||'Not set'}`;
    return wrap(title,bodyWidth-16,11).length*19+7+13+13*Math.max(...dateColumns(order).map(([,value])=>wrap(value,bodyWidth/4-16,9).length))+5
      +fields.reduce((sum,[label,value])=>sum+(value?lines(label+': '+value)+3:0),0)
      +lines(`Site contact: ${order.siteContact||'Not recorded'} · Phone: ${order.phone||'Not recorded'}`)+3+19
      +(order.items.length?order.items.reduce((sum,item)=>sum+15*Math.max(wrap(item.description||'No description',bodyWidth-130,9).length,wrap(String(item.quantity??'Not recorded'),88,9).length)+5,0):13)+16;
  }
  newPage();
  flow('Includes ready for dispatch. Dispatched and cancelled orders are excluded.',9,muted);
  flow('Item quantities are the amounts ordered. This report is a snapshot, not a dispatch instruction.',8,muted);y-=10;
  if(!report.orders.length)flow('No active Site Orders at the time of export.',12);
  for(const order of report.orders){
    current=null;inItems=false;const fullHeight=orderHeight(order);ensure(fullHeight<=492-bottom?fullHeight:160);current=order;orderHeading();
    const columns=dateColumns(order);
    const columnWidth=bodyWidth/4;
    columns.forEach(([label],i)=>draw(label,left+8+i*columnWidth,y,7.3,muted));y-=13;
    const values=columns.map(([,value])=>wrap(value,columnWidth-16,9));
    for(let i=0;i<Math.max(...values.map(lines=>lines.length));i++){values.forEach((lines,j)=>{if(lines[i])draw(lines[i],left+8+j*columnWidth,y);});y-=13;}y-=5;
    field(order.locationLabel,order.location);field('Colour',order.colour);if(order.areaM2)field('Gate area',order.areaM2+' m²');
    field('Site address',order.siteAddress);
    field('Ordered by',order.requestedByName||'Not recorded');
    flow(`Site contact: ${order.siteContact||'Not recorded'} · Phone: ${order.phone||'Not recorded'}`);y-=3;
    field('Notes',order.notes);
    for(const note of order.adminNotes||[])field('Admin note — '+note.author+' · '+reportDate(note.createdAt,{time:true}),note.text);
    ensure(45);tableHeader();inItems=true;
    if(!order.items.length){flow('No item details recorded.',9,muted);}
    for(const item of order.items){
      const lines=wrap(item.description||'No description',bodyWidth-130,9),quantities=wrap(String(item.quantity??'Not recorded'),88,9);
      const count=Math.max(lines.length,quantities.length);
      for(let index=0;index<count;index++){
        ensure(15);if(lines[index])draw(lines[index],left+8,y-3);if(quantities[index])draw(quantities[index],right-96,y-3);y-=15;
      }
      page.drawLine({start:{x:left,y:y-2},end:{x:right,y:y-2},thickness:.5,color:rule});y-=5;
    }
    inItems=false;y-=16;
  }
  const pages=doc.getPages();
  for(const [index,p]of pages.entries()){
    p.drawLine({start:{x:left,y:32},end:{x:right,y:32},thickness:.5,color:rule});
    p.drawText('Lennox Facades · PanelStock · Active Site Orders',{x:left,y:19,font,size:8,color:muted});
    const label=`Page ${index+1} of ${pages.length}`;
    p.drawText(label,{x:right-font.widthOfTextAtSize(label,8),y:19,font,size:8,color:muted});
  }
  if(symbolFallback)await doc.attach(new TextEncoder().encode(JSON.stringify(report,null,2)),'Active_Orders_Details.json',{mimeType:'application/json',description:'Original text for symbols unavailable in the report font; shown as a square in the PDF.'});
  doc.setTitle('Lennox Facades — Active Site Orders');doc.setAuthor('Lennox Facades');doc.setCreator('PanelStock');doc.setCreationDate(new Date(report.generatedAt));
  return doc.save();
}
