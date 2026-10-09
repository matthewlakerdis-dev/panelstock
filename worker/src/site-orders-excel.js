import {panelLoadView,panelRequiresPowderCoating} from './panel-dispatch.js';

export const SITE_ORDER_COLUMNS=['Date ordered','PDF','Project','Order number','Who ordered it','Location / notes','Requested date','Status','Drawn','Toolpathed','Routed / cut','QA','Sent to PC','Final QA','Ready for dispatch','Notes'];
const stageColumns=new Set(['Drawn','Toolpathed','Routed / cut','QA','Sent to PC','Final QA','Ready for dispatch']);
const orderStatusLabel=value=>({submitted:'Submitted',approved:'Approved',ordered:'Ordered',in_stock:'In stock',completed:'Ready for dispatch',cancelled:'Cancelled'}[String(value||'').trim().toLowerCase()]||String(value||''));
// Segoe UI glyph advances, normalized to the width of a digit.
const textAdvances={" ":0.508,"!":0.527,"\"":0.727,"#":1.096,"$":1.0,"%":1.518,"&":1.485,"'":0.427,"(":0.56,")":0.56,"*":0.774,"+":1.269,",":0.402,"-":0.742,".":0.402,"/":0.723,"0":1.0,"1":1.0,"2":1.0,"3":1.0,"4":1.0,"5":1.0,"6":1.0,"7":1.0,"8":1.0,"9":1.0,":":0.402,";":0.402,"<":1.269,"=":1.269,">":1.269,"?":0.832,"@":1.772,"A":1.197,"B":1.063,"C":1.149,"D":1.301,"E":0.938,"F":0.906,"G":1.273,"H":1.317,"I":0.494,"J":0.662,"K":1.076,"L":0.873,"M":1.666,"N":1.388,"O":1.399,"P":1.039,"Q":1.399,"R":1.11,"S":0.986,"T":0.972,"U":1.274,"V":1.152,"W":1.733,"X":1.094,"Y":1.025,"Z":1.058,"[":0.56,"\\":0.703,"]":0.56,"^":1.269,"_":0.77,"`":0.497,"a":0.944,"b":1.091,"c":0.857,"d":1.092,"e":0.97,"f":0.581,"g":1.092,"h":1.05,"i":0.449,"j":0.449,"k":0.922,"l":0.449,"m":1.598,"n":1.05,"o":1.087,"p":1.091,"q":1.092,"r":0.645,"s":0.787,"t":0.629,"u":1.05,"v":0.889,"w":1.341,"x":0.851,"y":0.898,"z":0.839,"{":0.56,"|":0.444,"}":0.56,"~":1.269};
export function siteOrderTextWidth(value){return Math.max(0,...String(value??'').split(/\r?\n/).map(line=>Array.from(line).reduce((width,char)=>width+(textAdvances[char]??1.8),0)));}
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
export function buildSiteOrderRows(orders,panels=[],records=[],loads=[],stock=[]){
 return orders.slice().sort((a,b)=>String(b.dateOrdered||b.createdAt||'').localeCompare(String(a.dateOrdered||a.createdAt||''))||String(a.id||'').localeCompare(String(b.id||''))).map(order=>{
  const scheduled=panels.filter(panel=>matches(order,panel)),metalwork=records.filter(record=>record.kind==='metalwork'&&matches(order,record));
  const nonPanel=scheduled.length===0&&normalized(order.orderType)!==''&&normalized(order.orderType)!=='panels';
  const stage=value=>nonPanel?'N/A':value;
  const production=panelLoadView({panelIds:scheduled.map(p=>p.id),status:'waiting'},scheduled,records);
  const qa=(scheduled.length>0||metalwork.length>0)&&(!scheduled.length||production.routing&&production.qaComplete)&&metalwork.every(record=>record.status==='approved');
  const orderLoads=loads.filter(load=>matches(order,load)),coated=orderLoads.filter(load=>(load.legs||[]).some(leg=>leg.destinationType==='powder_coaters'));
  const sentIds=new Set(coated.flatMap(load=>load.panelIds||[]));
  const milled=scheduled.filter(panel=>panelRequiresPowderCoating(panel,stock));
  const sentToPc=every(milled.length?milled:scheduled,panel=>sentIds.has(panel.id));
  const finalIds=new Set(coated.filter(load=>load.coatingCompleted&&load.finalQa).flatMap(load=>load.panelIds||[]));
  const finalQa=every(milled,panel=>finalIds.has(panel.id));
  const coatingReady=(!milled.length||finalQa)&&coated.every(load=>!!load.coatingCompleted&&!!load.finalQa);
  const cancelled=normalized(order.status)==='cancelled';
  const notes=[cancelled?'Order cancelled':'',coated.some(load=>load.status==='at_powder_coaters')?'At powder coaters':'',coated.some(load=>load.coatingCompleted&&!load.finalQa)?'Awaiting final QA after coating':'',every(orderLoads,load=>load.status==='dispatched_to_site')?'Dispatched to site':''].filter(Boolean).join('; ');
  return {'Date ordered':siteOrderDate(order.dateOrdered||order.createdAt,true),PDF:/^[a-zA-Z0-9-]{16,100}$/.test(order.id||'')?'https://web.panelstockhq.com/?page=orders&orderPdf='+encodeURIComponent(order.id):'',Project:String(order.project||''),'Order number':String(order.orderNumber||''),'Who ordered it':String(order.requestedBy||''),'Location / notes':String(order.locationNotes||''),'Requested date':siteOrderDate(order.requestedDeliveryDate),Status:orderStatusLabel(order.status),Drawn:stage(tick(order.drawingProgress?.drawn===true)),Toolpathed:stage(tick(scheduled.length>0)),'Routed / cut':stage(tick(production.routing)),QA:stage(tick(qa)),'Sent to PC':stage(tick(sentToPc)),'Final QA':stage(milled.length?tick(finalQa):scheduled.length?'N/A':'-'),'Ready for dispatch':tick((nonPanel?normalized(order.status)==='completed':qa&&coatingReady)&&!cancelled),Notes:notes};
 });
}
const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const dateColumn=index=>index===0||index===6;
const dateText=value=>{const d=new Date(epoch+value*86400000);return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;};
export function buildSiteOrderFeed(rows){
 const body=(rows.length?rows:[{}]).map(row=>'<tr height="24" style="height:18pt;mso-height-source:userset">'+SITE_ORDER_COLUMNS.map((key,index)=>{
  const value=row[key]??'',isDate=dateColumn(index)&&Number.isFinite(value),style=`font-family:Segoe UI;font-size:10pt;text-align:center;vertical-align:middle;white-space:nowrap;`;
  return `<td ${isDate?`x:num="${value}"`:'x:str'} style='${style}mso-number-format:"${isDate?'dd/mm/yyyy':'\\@'}"'>${key==='PDF'&&value?`<a href="${xml(value)}" style="color:#176078;font-weight:bold">Open PDF</a>`:xml(isDate?dateText(value):value)}</td>`;
 }).join('')+'</tr>').join('');
 return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>Site Orders</title></head><body><table id="site-orders-data"><tbody>${body}</tbody></table></body></html>`;
}
export function siteOrdersSheet(rows,zebraFormatting,formatLastRow=Math.min(1048576,Math.max(5000,rows.length+1001))){
 const cell=(key,index,value,row)=>{const ref=String.fromCharCode(65+index)+row,isDate=row>1&&dateColumn(index)&&Number.isFinite(value),style=row===1?(stageColumns.has(key)?10:9):dateColumn(index)?6:0;if(row>1&&key==='PDF'&&value)return `<c r="${ref}" s="${style}" t="str"><f>HYPERLINK(&quot;${xml(value)}&quot;,&quot;Open PDF&quot;)</f><v>Open PDF</v></c>`;return `<c r="${ref}" s="${style}" t="${isDate?'n':'inlineStr'}">${isDate?`<v>${value}</v>`:`<is><t xml:space="preserve">${xml(value)}</t></is>`}</c>`;};
 const widths=SITE_ORDER_COLUMNS.map((key,index)=>{const width=index===1?12:stageColumns.has(key)?4.5:dateColumn(index)?15:Math.min(['Project','Location / notes','Notes'].includes(key)?255:32,['Project','Location / notes','Notes'].includes(key)?Math.ceil(Math.max(siteOrderTextWidth(key)*1.1,...rows.map(row=>siteOrderTextWidth(row[key])))+2):Math.max(12,key.length+2,...rows.map(row=>String(row[key]??'').length+2)));return `<col min="${index+1}" max="${index+1}" width="${width}" customWidth="1" bestFit="1" style="${dateColumn(index)?6:0}"/>`;}).join('');
 const body=rows.map((row,index)=>`<row r="${index+2}" ht="18" customHeight="1">${SITE_ORDER_COLUMNS.map((key,col)=>cell(key,col,row[key]??'',index+2)).join('')}</row>`).join('');
 const flags=[['I','O']].map(([first,last],index)=>`<conditionalFormatting sqref="${first}2:${last}${formatLastRow}"><cfRule type="expression" dxfId="3" priority="${index*2+1}"><formula>OR(${first}2="✓",${first}2="N/A")</formula></cfRule><cfRule type="expression" dxfId="4" priority="${index*2+2}"><formula>${first}2="-"</formula></cfRule></conditionalFormatting>`).join('');
 const lastColumn=String.fromCharCode(64+SITE_ORDER_COLUMNS.length);
 return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${Math.max(1,rows.length+1)}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr baseColWidth="8" defaultRowHeight="18" customHeight="1"/><cols>${widths}</cols><sheetData><row r="1" ht="142" customHeight="1">${SITE_ORDER_COLUMNS.map((key,index)=>cell(key,index,key==='QA'?'Fabricated/QA':key,1)).join('')}</row>${body}</sheetData>${flags}${zebraFormatting(lastColumn,5)}<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/><ignoredErrors><ignoredError sqref="D2:D${formatLastRow}" numberStoredAsText="1"/></ignoredErrors><drawing r:id="rIdBrand"/></worksheet>`;
}



