const enc = new TextEncoder();
const esc = value => String(value ?? '').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]+/g,' ');
const fmtDate = value => {
  if(!value)return '';
  const date=new Date(value.length===10?value+'T00:00:00':value);
  return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'2-digit',month:'short',year:'numeric',timeZone:'Australia/Brisbane'}).format(date);
};
const fit = (value,max) => {const s=String(value??'');return s.length>max?s.slice(0,Math.max(1,max-3))+'...':s;};
const text=(x,y,size,value,bold=false)=>`BT /F${bold?2:1} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET\n`;
const line=(x1,y1,x2,y2,width=0.75)=>`0 G ${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
const box=(x,y,w,h,width=0.75)=>`0 G ${width} w ${x} ${y} ${w} ${h} re S\n`;
const fill=(x,y,w,h,gray=0.9)=>`${gray} g ${x} ${y} ${w} ${h} re f 0 g\n`;

function pageStream(order,pageIndex,pageCount,items) {
  let s='';
  s+=text(128,803,18,'SITE ORDER COVER SHEET',true);
  s+=text(435,805,10,'ORDER #:',true)+box(500,798,81,25,1.5)+text(531,805,15,order.orderNumber,true);
  s+=text(15,780,9,'PROJECT:',true)+box(145,774,168,18)+text(151,779,9,fit(order.project,27));
  s+=text(319,780,9,'DATE:',true)+box(351,774,93,18)+text(356,779,7.5,fmtDate(order.dateOrdered));
  s+=text(449,780,8,'# PAGES:',true)+box(531,774,50,18)+text(551,779,9,pageCount,true);
  s+=line(14,767,581,767,1.5);
  s+=fill(351,748,230,14)+text(403,751,10,'REQUESTED DELIVERY',true);
  s+=text(15,736,8,'SITE CONTACT:',true)+box(133,730,180,18)+text(139,735,9,fit(order.siteContact,28));
  s+=text(317,736,8,'DATE:',true)+box(351,730,93,18)+text(356,735,7.5,fmtDate(order.requestedDeliveryDate));
  s+=text(450,736,8,'TIME:',true)+box(488,730,93,18)+text(514,735,9,order.requestedDeliveryTime||'',true);
  s+=text(15,713,8,'PHONE:',true)+box(133,708,180,18)+text(139,713,9,fit(order.phone,28));
  s+=fill(351,703,230,23)+text(401,710,10,'SCHEDULED DELIVERY',true);
  s+=text(15,691,8,'ORDER TYPE:',true)+box(133,685,180,18)+text(139,690,9,fit(order.orderType,28));
  s+=text(317,691,8,'DATE:',true)+box(351,685,93,18)+text(356,690,7.5,fmtDate(order.scheduledDeliveryDate));
  s+=text(450,691,8,'TIME:',true)+box(488,685,93,18)+text(514,690,9,order.scheduledDeliveryTime||'',true);
  s+=text(15,666,8,'Location/Notes:',true)+box(30,642,551,18)+text(36,647,9,fit(order.locationNotes,88),true);
  const rowHeights=[18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,15.75,18,18,18,18,12.75,18];
  const tableTop=624.5,tableBottom=92;
  s+=text(47,630,8,'QTY',true)+text(84,630,8,'DESCRIPTION',true)+text(404,630,7,'ON TRUCK',true)+text(449,630,7,'RECEIVED',true)+text(513,630,7,'BACK ORDER',true);
  s+=box(30,tableBottom,551,tableTop-tableBottom);
  for(const x of [80,399,444,488])s+=line(x,tableBottom,x,tableTop);
  let rowTop=tableTop;
  rowHeights.forEach((height,i)=>{const y=rowTop-height;s+=line(30,y,581,y)+text(18,y+height/2-2.5,6.5,i+1)+box(417,y+height/2-4,8,8);rowTop=y;});
  rowTop=tableTop;
  items.forEach((item,i)=>{const height=rowHeights[i],y=rowTop-height;s+=text(53,y+height/2-2.5,8,fit(item.quantity,6))+text(85,y+height/2-2.5,8,fit(item.description,51));rowTop=y;});
  s+=fill(14,67,567,15)+text(20,71,7.5,'LOADED BY:',true)+box(76,68.5,104,12);
  s+=text(196,71,7.5,'DELIVERED BY:',true)+box(262,68.5,112,12);
  s+=text(392,71,7.5,'RECEIVED BY:',true)+box(456,68.5,125,12);
  return s;
}

export function buildOrderPdf(order) {
  const chunks=[];for(let i=0;i<Math.max(order.items.length,1);i+=30)chunks.push(order.items.slice(i,i+30));
  const objects=[null];
  const add=value=>{objects.push(value);return objects.length-1;};
  const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pagesId=add('');
  const pageIds=[];
  chunks.forEach((items,index)=>{
    const stream=pageStream(order,index,chunks.length,items);
    const content=add(`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.276 841.89] /CropBox [0 0 595.276 841.89] /TrimBox [0 0 595.276 841.89] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objects[pagesId]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalog=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf='%PDF-1.4\n%PanelStock\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets[i]=enc.encode(pdf).length;pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=enc.encode(pdf).length;
  pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return enc.encode(pdf);
}
