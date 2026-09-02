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
  s+=text(42,800,19,'SITE ORDER COVER SHEET',true);
  s+=text(405,802,9,'ORDER #',true)+box(458,786,95,27,1.4)+text(490,794,15,order.orderNumber,true);
  s+=text(42,759,9,'PROJECT:',true)+box(98,746,290,24)+text(105,753,10,fit(order.project,47));
  s+=text(404,759,9,'DATE:',true)+box(442,746,111,24)+text(450,753,9,fmtDate(order.dateOrdered));
  s+=line(34,731,561,731,1.4);
  s+=text(42,704,9,'SITE CONTACT:',true)+box(118,691,230,24)+text(125,698,10,fit(order.siteContact,36));
  s+=text(42,673,9,'PHONE:',true)+box(118,660,230,24)+text(125,667,10,fit(order.phone,34));
  s+=text(42,642,9,'ORDER TYPE:',true)+box(118,629,230,24)+text(125,636,10,fit(order.orderType,34));
  s+=fill(365,691,188,23)+text(399,698,10,'REQUESTED DELIVERY',true);
  s+=text(365,673,8,'DATE:',true)+box(400,660,153,24)+text(406,667,8.5,fmtDate(order.requestedDeliveryDate));
  s+=text(365,642,8,'TIME:',true)+box(400,629,153,24)+text(406,636,9,order.requestedDeliveryTime||'');
  s+=fill(365,598,188,23)+text(401,605,10,'SCHEDULED DELIVERY',true);
  s+=text(365,580,8,'DATE:',true)+box(400,567,153,24)+text(406,574,8.5,fmtDate(order.scheduledDeliveryDate));
  s+=text(365,549,8,'TIME:',true)+box(400,536,153,24)+text(406,543,9,order.scheduledDeliveryTime||'');
  s+=text(42,515,9,'LOCATION / NOTES:',true)+box(42,482,511,25)+text(49,490,9,fit(order.locationNotes,82),true);
  const top=456,rowH=11;
  s+=text(50,462,8,'QTY',true)+text(91,462,8,'DESCRIPTION',true)+text(401,462,7,'ON TRUCK',true)+text(462,462,7,'RECEIVED',true)+text(516,462,7,'BACK ORDER',true);
  s+=box(42,126,511,330);
  for(const x of [82,390,450,505])s+=line(x,126,x,456);
  for(let i=1;i<=30;i++)s+=line(42,456-i*rowH,553,456-i*rowH,0.35);
  items.forEach((item,i)=>{const y=448-i*rowH;s+=text(56,y,7.5,fit(item.quantity,6))+text(89,y,7.5,fit(item.description,52));});
  s+=fill(42,86,511,25)+text(49,94,8,'REQUESTED BY:',true)+text(120,94,8,fit(order.requestedBy,28));
  s+=text(287,94,8,'STATUS:',true)+text(330,94,8,String(order.status||'submitted').toUpperCase());
  s+=text(462,94,8,`PAGE ${pageIndex+1} OF ${pageCount}`,true);
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
