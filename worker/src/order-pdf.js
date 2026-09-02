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
  s+=text(48,555,21,'SITE ORDER COVER SHEET',true);
  s+=text(610,558,11,'ORDER #',true)+box(678,542,110,28,1.4)+text(718,550,16,order.orderNumber,true);
  s+=text(48,520,9,'PROJECT:',true)+box(105,507,335,24)+text(112,514,11,fit(order.project,55));
  s+=text(462,520,9,'DATE:',true)+box(500,507,125,24)+text(512,514,10,fmtDate(order.dateOrdered));
  s+=text(640,520,9,'# PAGES:',true)+box(700,507,88,24)+text(739,514,11,pageCount,true);
  s+=line(35,496,795,496,1.5);
  s+=text(48,468,9,'SITE CONTACT:',true)+box(124,455,316,24)+text(131,462,10,fit(order.siteContact,52));
  s+=text(48,437,9,'PHONE:',true)+box(124,424,316,24)+text(131,431,10,fit(order.phone,40));
  s+=text(48,406,9,'ORDER TYPE:',true)+box(124,393,316,24)+text(131,400,10,fit(order.orderType,45));
  s+=fill(500,455,288,23)+text(577,462,11,'REQUESTED DELIVERY',true);
  s+=text(462,437,9,'DATE:',true)+box(500,424,125,24)+text(508,431,9,fmtDate(order.requestedDeliveryDate));
  s+=text(640,437,9,'TIME:',true)+box(678,424,110,24)+text(705,431,11,order.requestedDeliveryTime||'',true);
  s+=fill(500,393,288,23)+text(580,400,11,'SCHEDULED DELIVERY',true);
  s+=text(462,375,9,'DATE:',true)+box(500,362,125,24)+text(508,369,9,fmtDate(order.scheduledDeliveryDate));
  s+=text(640,375,9,'TIME:',true)+box(678,362,110,24)+text(705,369,10,order.scheduledDeliveryTime||'');
  s+=text(48,345,9,'LOCATION / NOTES:',true)+box(48,312,740,25)+text(55,320,10,fit(order.locationNotes,120),true);
  const top=295,rowH=8;
  s+=text(58,300,8,'QTY',true)+text(112,300,8,'DESCRIPTION',true)+text(590,300,8,'ON TRUCK',true)+text(665,300,8,'RECEIVED',true)+text(738,300,8,'BACK ORDER',true);
  s+=box(48,55,740,240);
  for(const x of [100,570,645,715])s+=line(x,55,x,295);
  for(let i=1;i<=30;i++)s+=line(48,295-i*rowH,788,295-i*rowH,0.35);
  items.forEach((item,i)=>{const y=289-i*rowH;s+=text(67,y,7.5,fit(item.quantity,8))+text(106,y,7.5,fit(item.description,82));});
  s+=fill(48,16,740,24)+text(55,24,8,'REQUESTED BY:',true)+text(126,24,8,fit(order.requestedBy,35));
  s+=text(310,24,8,'STATUS:',true)+text(355,24,8,String(order.status||'submitted').toUpperCase());
  s+=text(590,24,8,`PAGE ${pageIndex+1} OF ${pageCount}`,true);
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

