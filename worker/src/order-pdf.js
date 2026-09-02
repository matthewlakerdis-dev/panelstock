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
  s+=text(126,800,18,'SITE ORDER COVER SHEET',true);
  s+=text(430,802,10,'ORDER #:',true)+box(487,786,66,27,1.4)+text(511,794,15,order.orderNumber,true);
  s+=text(42,759,9,'PROJECT:',true)+box(98,746,260,24)+text(105,753,10,fit(order.project,42));
  s+=text(370,759,9,'DATE:',true)+box(408,746,93,24)+text(414,753,8,fmtDate(order.dateOrdered));
  s+=text(506,759,7,'# PAGES:',true)+box(548,746,18,24)+text(554,753,9,pageCount,true);
  s+=line(34,731,561,731,1.5);
  s+=text(42,704,9,'SITE CONTACT:',true)+box(118,691,220,24)+text(125,698,10,fit(order.siteContact,35));
  s+=text(42,673,9,'PHONE:',true)+box(118,660,220,24)+text(125,667,10,fit(order.phone,34));
  s+=text(42,642,9,'ORDER TYPE:',true)+box(118,629,220,24)+text(125,636,10,fit(order.orderType,34));
  s+=fill(355,691,198,23)+text(395,698,10,'REQUESTED DELIVERY',true);
  s+=text(355,673,8,'DATE:',true)+box(390,660,108,24)+text(396,667,8.5,fmtDate(order.requestedDeliveryDate));
  s+=text(503,673,8,'TIME:',true)+box(533,660,20,24)+text(535,667,7.5,order.requestedDeliveryTime||'');
  s+=fill(355,629,198,23)+text(397,636,10,'SCHEDULED DELIVERY',true);
  s+=text(355,611,8,'DATE:',true)+box(390,598,108,24)+text(396,605,8.5,fmtDate(order.scheduledDeliveryDate));
  s+=text(503,611,8,'TIME:',true)+box(533,598,20,24)+text(535,605,7.5,order.scheduledDeliveryTime||'');
  s+=text(42,576,9,'Location/Notes:',true)+box(42,543,511,25)+text(49,551,9,fit(order.locationNotes,82),true);
  const rowH=12;
  s+=text(72,532,8,'QTY',true)+text(122,532,8,'DESCRIPTION',true)+text(405,532,7,'ON TRUCK',true)+text(462,532,7,'RECEIVED',true)+text(514,532,7,'BACK ORDER',true);
  s+=box(60,166,493,360);
  for(const x of [110,390,450,505])s+=line(x,166,x,526);
  for(let i=1;i<=30;i++){const y=526-i*rowH;s+=line(60,y,553,y,0.35)+text(45,y+3,6.5,i)+box(416,y+2,8,8,0.4);}
  items.forEach((item,i)=>{const y=517-i*rowH;s+=text(78,y,7.5,fit(item.quantity,6))+text(116,y,7.5,fit(item.description,45));});
  s+=fill(42,112,511,34)+text(49,126,8,'LOADED BY:',true)+box(102,118,92,20);
  s+=text(211,126,8,'DELIVERED BY:',true)+box(279,118,103,20);
  s+=text(398,126,8,'RECEIVED BY:',true)+box(466,118,87,20);
  s+=text(512,91,7,`${pageIndex+1} / ${pageCount}`,true);
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
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
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
