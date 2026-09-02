const enc = new TextEncoder();
const esc = value => String(value ?? '').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]+/g,' ');
const fmtDate = value => {
  if(!value)return '';
  const date=new Date(value.length===10?value+'T00:00:00':value);
  return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'2-digit',month:'short',year:'numeric',timeZone:'Australia/Brisbane'}).format(date);
};
const fit = (value,max) => {const s=String(value??'');return s.length>max?s.slice(0,Math.max(1,max-3))+'...':s;};
const text=(x,y,size,value,bold=false)=>`BT /F${bold?2:1} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET\n`;
const line=(x1,y1,x2,y2,width=0.7)=>`${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
const box=(x,y,w,h,width=0.7)=>`${width} w ${x} ${y} ${w} ${h} re S\n`;
const fill=(x,y,w,h,gray=0.9)=>`${gray} g ${x} ${y} ${w} ${h} re f 0 g\n`;

function pageStream(order,pageIndex,pageCount,items) {
  let s='';
  s+=text(220,555,21,'SITE ORDER COVER SHEET',true);
  s+=text(668,558,11,'ORDER #:',true)+box(734,542,72,28,1.4)+text(762,550,16,order.orderNumber,true);
  s+=text(166,520,9,'PROJECT:',true)+box(224,507,264,24)+text(231,514,11,fit(order.project,42));
  s+=text(500,520,9,'DATE:',true)+box(540,507,125,24)+text(552,514,10,fmtDate(order.dateOrdered));
  s+=text(680,520,9,'# PAGES:',true)+box(742,507,64,24)+text(769,514,11,pageCount,true);
  s+=line(35,496,807,496,1.5);
  s+=text(48,468,9,'SITE CONTACT:',true)+box(124,455,316,24)+text(131,462,10,fit(order.siteContact,52));
  s+=text(48,437,9,'PHONE:',true)+box(124,424,316,24)+text(131,431,10,fit(order.phone,40));
  s+=text(48,406,9,'ORDER TYPE:',true)+box(124,393,316,24)+text(131,400,10,fit(order.orderType,45));
  s+=fill(500,455,306,23)+text(586,462,11,'REQUESTED DELIVERY',true);
  s+=text(462,437,9,'DATE:',true)+box(500,424,125,24)+text(508,431,9,fmtDate(order.requestedDeliveryDate));
  s+=text(640,437,9,'TIME:',true)+box(678,424,128,24)+text(707,431,11,order.requestedDeliveryTime||'',true);
  s+=fill(500,393,306,23)+text(589,400,11,'SCHEDULED DELIVERY',true);
  s+=text(462,375,9,'DATE:',true)+box(500,362,125,24)+text(508,369,9,fmtDate(order.scheduledDeliveryDate));
  s+=text(640,375,9,'TIME:',true)+box(678,362,128,24)+text(707,369,10,order.scheduledDeliveryTime||'');
  s+=text(48,345,9,'Location/Notes:',true)+box(48,312,758,25)+text(55,320,10,fit(order.locationNotes,122),true);
  const rowH=8;
  s+=text(84,300,8,'QTY',true)+text(139,300,8,'DESCRIPTION',true)+text(602,300,8,'ON TRUCK',true)+text(680,300,8,'RECEIVED',true)+text(751,300,8,'BACK ORDER',true);
  s+=box(70,55,736,240);
  for(const x of [126,582,656,727])s+=line(x,55,x,295);
  for(let i=1;i<=30;i++){const y=295-i*rowH;s+=line(70,y,806,y,0.35)+text(55,y+2,6.5,i)+box(615,y+0.8,6.5,6.5,0.4);}
  items.forEach((item,i)=>{const y=289-i*rowH;s+=text(95,y,7.5,fit(item.quantity,8))+text(133,y,7.5,fit(item.description,75));});
  s+=fill(48,16,758,24)+text(55,24,8,'LOADED BY:',true)+box(111,20,142,17);
  s+=text(300,24,8,'DELIVERED BY:',true)+box(370,20,142,17);
  s+=text(555,24,8,'RECEIVED BY:',true)+box(625,20,181,17);
  s+=text(745,7,7,`${pageIndex+1} / ${pageCount}`,true);
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
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
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
