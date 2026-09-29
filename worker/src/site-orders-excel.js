import {panelLoadView} from './panel-dispatch.js';

export const SITE_ORDER_COLUMNS=['Date ordered','Project','Order number','Who ordered it','Location / notes','Requested date','Drawn','Toolpathed','Routed / cut','QA','Sent to PC','Ready for dispatch','Notes'];
const normalized=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
const matches=(order,item)=>normalized(order.orderNumber)!==''&&normalized(order.orderNumber)===normalized(item.orderNumber)&&(order.projectId&&item.projectId?order.projectId===item.projectId:normalized(order.project)!==''&&normalized(order.project)===normalized(item.project||item.jobReference));
const every=(items,predicate)=>items.length>0&&items.every(predicate);
const tick=value=>value?'✓':'-';
const epoch=Date.UTC(1899,11,30);
export function siteOrderDate(value,timestamp=false){
 if(!value)return '';
 let iso=String(value);
 if(timestamp){const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const part=key=>parts.find(p=>p.type===key).value;iso=`${part('year')}-${part('month')}-${part('day')}`;}
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);if(!match)return '';
 const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
 return date.toISOString().slice(0,10)===iso?Math.floor((date.getTime()-epoch)/86400000):'';
}
// Whitelist only the shared worksheet fields: never export phone numbers,
// attachments, QA evidence, CAD contents or the private order object.
export function buildSiteOrderRows(orders,panels=[],records=[],loads=[]){
 return orders.slice().sort((a,b)=>String(b.dateOrdered||b.createdAt||'').localeCompare(String(a.dateOrdered||a.createdAt||''))||String(a.id||'').localeCompare(String(b.id||''))).map(order=>{
  const scheduled=panels.filter(panel=>matches(order,panel)),metalwork=records.filter(record=>record.kind==='metalwork'&&matches(order,record));
  const production=panelLoadView({panelIds:scheduled.map(p=>p.id),status:'waiting'},scheduled,records);
  const qa=(scheduled.length>0||metalwork.length>0)&&(!scheduled.length||production.routing&&production.qaComplete)&&metalwork.every(record=>record.status==='approved');
  const orderLoads=loads.filter(load=>matches(order,load)),coated=orderLoads.filter(load=>(load.legs||[]).some(leg=>leg.destinationType==='powder_coaters'));
  const sentIds=new Set(coated.flatMap(load=>load.panelIds||[]));
  const sentToPc=every(scheduled,panel=>sentIds.has(panel.id));
  const coatingReady=coated.every(load=>!!load.coatingCompleted&&!!load.finalQa);
  const cancelled=normalized(order.status)==='cancelled';
  const notes=[cancelled?'Order cancelled':'',coated.some(load=>load.status==='at_powder_coaters')?'At powder coaters':'',coated.some(load=>load.coatingCompleted&&!load.finalQa)?'Awaiting final QA after coating':'',every(orderLoads,load=>load.status==='dispatched_to_site')?'Dispatched to site':''].filter(Boolean).join('; ');
  return {'Date ordered':siteOrderDate(order.dateOrdered||order.createdAt,true),Project:String(order.project||''),'Order number':String(order.orderNumber||''),'Who ordered it':String(order.requestedBy||''),'Location / notes':String(order.locationNotes||''),'Requested date':siteOrderDate(order.requestedDeliveryDate),Drawn:tick(order.drawingProgress?.drawn===true),Toolpathed:tick(scheduled.length>0),'Routed / cut':tick(production.routing),QA:tick(qa),'Sent to PC':tick(sentToPc),'Ready for dispatch':tick(qa&&coatingReady&&!cancelled),Notes:notes};
 });
}
const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const dateColumn=index=>index===0||index===5;
const textColumn=index=>[1,3,4,12].includes(index);
const dateText=value=>{const d=new Date(epoch+value*86400000);return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;};
export function buildSiteOrderFeed(rows){
 const body=(rows.length?rows:[{}]).map(row=>'<tr height="24" style="height:18pt;mso-height-source:userset">'+SITE_ORDER_COLUMNS.map((key,index)=>{
  const value=row[key]??'',isDate=dateColumn(index)&&Number.isFinite(value),style=`font-family:Segoe UI;font-size:10pt;text-align:${textColumn(index)?'left':'center'};vertical-align:middle;white-space:nowrap;`;
  return `<td ${isDate?`x:num="${value}"`:'x:str'} style='${style}mso-number-format:"${isDate?'dd/mm/yyyy':'\\@'}"'>${xml(isDate?dateText(value):value)}</td>`;
 }).join('')+'</tr>').join('');
 return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>Site Orders</title></head><body><table id="site-orders-data"><tbody>${body}</tbody></table></body></html>`;
}
export function siteOrdersSheet(rows,zebraFormatting){
 const cell=(key,index,value,row)=>{const ref=String.fromCharCode(65+index)+row,isDate=row>1&&dateColumn(index)&&Number.isFinite(value),style=row===1?(index>=6&&index<=11?10:9):dateColumn(index)?6:textColumn(index)?8:0;return `<c r="${ref}" s="${style}" t="${isDate?'n':'inlineStr'}">${isDate?`<v>${value}</v>`:`<is><t xml:space="preserve">${xml(value)}</t></is>`}</c>`;};
 const widths=SITE_ORDER_COLUMNS.map((key,index)=>{const width=index>=6&&index<=11?4.5:dateColumn(index)?15:Math.min(index===4||index===12?56:32,Math.max(12,key.length+2,...rows.map(row=>String(row[key]??'').length+2)));return `<col min="${index+1}" max="${index+1}" width="${width}" customWidth="1" bestFit="1" style="${dateColumn(index)?6:textColumn(index)?8:0}"/>`;}).join('');
 const body=rows.map((row,index)=>`<row r="${index+2}" ht="18" customHeight="1">${SITE_ORDER_COLUMNS.map((key,col)=>cell(key,col,row[key]??'',index+2)).join('')}</row>`).join('');
 const flags='<conditionalFormatting sqref="G2:L1048576"><cfRule type="expression" dxfId="3" priority="1"><formula>G2="✓"</formula></cfRule><cfRule type="expression" dxfId="4" priority="2"><formula>G2="-"</formula></cfRule></conditionalFormatting>';
 return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:M${Math.max(1,rows.length+1)}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr baseColWidth="8" defaultRowHeight="18" customHeight="1"/><cols>${widths}</cols><sheetData><row r="1" ht="142" customHeight="1">${SITE_ORDER_COLUMNS.map((key,index)=>cell(key,index,key==='QA'?'Fabricated/QA':key,1)).join('')}</row>${body}</sheetData>${flags}${zebraFormatting('M',3)}<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/><ignoredErrors><ignoredError sqref="C2:C1048576" numberStoredAsText="1"/></ignoredErrors><drawing r:id="rIdBrand"/></worksheet>`;
}

