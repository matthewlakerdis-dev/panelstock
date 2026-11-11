import {orderDetailRows} from './order-type-fields.js';
import {orderTypeLabel} from './order-types.js';
import {isGateOrder,gateProductionStages,GATE_STAGES} from './gate-order-progress.js';
import {panelLoadView,panelRequiresPowderCoating} from './panel-dispatch.js';

export const SITE_ORDER_ROW_COLUMNS=['Date ordered','PDF','Project','Order number','Order type','Who ordered it','Location','Order notes','Requested date','Scheduled date','Status','Drawn','Toolpathed','Routed / cut','Scheduled for production','QA','Sent to PC','Final QA','Ready for dispatch','Notes','Action','Schedule delivery'];
const STATUS_NOTES_SITE_ORDER_COLUMNS=SITE_ORDER_ROW_COLUMNS.filter(key=>key!=='Notes').map(key=>key==='Status'?'Status / notes':key);
const ACTION_FIRST_SITE_ORDER_COLUMNS=['PDF','Action',...STATUS_NOTES_SITE_ORDER_COLUMNS.filter(key=>!['Date ordered','PDF','Action'].includes(key))];
const SWAPPED_SITE_ORDER_COLUMNS=ACTION_FIRST_SITE_ORDER_COLUMNS.map(key=>key==='Status / notes'?'Schedule delivery':key==='Schedule delivery'?'Status / notes':key);
const DATE_AND_NOTES_SITE_ORDER_COLUMNS=SWAPPED_SITE_ORDER_COLUMNS.filter(key=>key!=='Status / notes').flatMap(key=>key==='Action'?[key,'Date ordered']:key==='Schedule delivery'?[key,'Status / notes']:[key]);
export const SITE_ORDER_COLUMNS=DATE_AND_NOTES_SITE_ORDER_COLUMNS.filter(key=>key!=='Status / notes').flatMap(key=>key==='Ready for dispatch'?[key,'Status / notes']:[key]);
const SPLIT_SITE_ORDER_COLUMNS=['Date ordered','PDF','Project','Order number','Order type','Who ordered it','Location','Notes','Requested date','Scheduled date','Status','Drawn','Toolpathed','Routed / cut','QA','Sent to PC','Final QA','Ready for dispatch','Action','Schedule delivery'];
const LEGACY_SITE_ORDER_COLUMNS=['Date ordered','PDF','Project','Order number','Order type','Who ordered it','Location / notes','Requested date','Scheduled date','Status','Drawn','Toolpathed','Routed / cut','QA','Sent to PC','Final QA','Ready for dispatch','Notes','Action','Schedule delivery'];
const stageColumns=new Set(['Scheduled for production','Drawn','Toolpathed','Routed / cut','QA','Sent to PC','Final QA','Ready for dispatch']);
const orderStatusLabel=value=>({submitted:'Submitted',approved:'Approved',ordered:'Ordered',in_stock:'In stock',completed:'Ready for dispatch',dispatched:'Dispatched',cancelled:'Cancelled'}[String(value||'').trim().toLowerCase()]||String(value||''));
// Segoe UI glyph advances, normalized to the width of a digit.
const textAdvances={" ":0.508,"!":0.527,"\"":0.727,"#":1.096,"$":1.0,"%":1.518,"&":1.485,"'":0.427,"(":0.56,")":0.56,"*":0.774,"+":1.269,",":0.402,"-":0.742,".":0.402,"/":0.723,"0":1.0,"1":1.0,"2":1.0,"3":1.0,"4":1.0,"5":1.0,"6":1.0,"7":1.0,"8":1.0,"9":1.0,":":0.402,";":0.402,"<":1.269,"=":1.269,">":1.269,"?":0.832,"@":1.772,"A":1.197,"B":1.063,"C":1.149,"D":1.301,"E":0.938,"F":0.906,"G":1.273,"H":1.317,"I":0.494,"J":0.662,"K":1.076,"L":0.873,"M":1.666,"N":1.388,"O":1.399,"P":1.039,"Q":1.399,"R":1.11,"S":0.986,"T":0.972,"U":1.274,"V":1.152,"W":1.733,"X":1.094,"Y":1.025,"Z":1.058,"[":0.56,"\\":0.703,"]":0.56,"^":1.269,"_":0.77,"`":0.497,"a":0.944,"b":1.091,"c":0.857,"d":1.092,"e":0.97,"f":0.581,"g":1.092,"h":1.05,"i":0.449,"j":0.449,"k":0.922,"l":0.449,"m":1.598,"n":1.05,"o":1.087,"p":1.091,"q":1.092,"r":0.645,"s":0.787,"t":0.629,"u":1.05,"v":0.889,"w":1.341,"x":0.851,"y":0.898,"z":0.839,"{":0.56,"|":0.444,"}":0.56,"~":1.269};
export function siteOrderTextWidth(value){return Math.max(0,...String(value??'').split(/\r?\n/).map(line=>Array.from(line).reduce((width,char)=>width+(textAdvances[char]??1.8),0)));}
const normalized=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
export function splitSiteOrderRows(rows){
 const active=[],completed=[];
 for(const row of rows)(normalized(row.Status)==='dispatched'?completed:active).push(row);
 return {active,completed};
}
const nonFabricatedOrderTypes=new Set(['consumables','fixings','other','framing','knotwood','plant/equipment']);
const skipsProductionScheduling=order=>nonFabricatedOrderTypes.has(normalized(order.orderType).replace(/\s*\/\s*/g,'/'));
export const matchesSiteOrder=(order,item)=>normalized(order.orderNumber)!==''&&normalized(order.orderNumber)===normalized(item.orderNumber)&&(order.projectId&&item.projectId?order.projectId===item.projectId:normalized(order.project)!==''&&normalized(order.project)===normalized(item.project||item.jobReference));
const matches=matchesSiteOrder;
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
export function buildSiteOrderRows(orders,panels=[],records=[],loads=[],stock=[],schedule=[]){
 const bookedOrders=new Set(schedule.filter(entry=>entry.orderId&&String(entry.assignedUsername||'').trim()&&['general','cnc'].includes(entry.scheduleType||'general')&&entry.status!=='cancelled').map(entry=>entry.orderId));
 return orders.slice().sort((a,b)=>String(b.dateOrdered||b.createdAt||'').localeCompare(String(a.dateOrdered||a.createdAt||''))||String(a.id||'').localeCompare(String(b.id||''))).map(order=>{
  const scheduled=panels.filter(panel=>matches(order,panel)),metalwork=records.filter(record=>record.kind==='metalwork'&&matches(order,record));
  const nonPanel=scheduled.length===0&&normalized(order.orderType)!==''&&normalized(order.orderType)!=='panels';
  const stage=value=>nonPanel?'n/a':value;
  const production=panelLoadView({panelIds:scheduled.map(p=>p.id),status:'waiting'},scheduled,records);
  const qa=(scheduled.length>0||metalwork.length>0)&&(!scheduled.length||production.routing&&production.qaComplete)&&metalwork.every(record=>record.status==='approved');
  const exemptCount=production.items.filter(item=>item.qaStatus==='not_required').length,allExempt=scheduled.length>0&&exemptCount===scheduled.length&&metalwork.length===0;
  const orderLoads=loads.filter(load=>matches(order,load)),coated=orderLoads.filter(load=>(load.legs||[]).some(leg=>leg.destinationType==='powder_coaters'));
  const sentIds=new Set(coated.flatMap(load=>load.panelIds||[]));
  // Coating stages apply to milled panels and any panels actually sent to PC.
  const coatingPanels=scheduled.filter(panel=>panelRequiresPowderCoating(panel,stock)||sentIds.has(panel.id));
  const sentToPc=every(coatingPanels,panel=>sentIds.has(panel.id));
  const finalIds=new Set(coated.filter(load=>load.coatingCompleted&&load.finalQa).flatMap(load=>load.panelIds||[]));
  const finalQa=every(coatingPanels,panel=>finalIds.has(panel.id));
  const coatingReady=(!coatingPanels.length||finalQa)&&coated.every(load=>!!load.coatingCompleted&&!!load.finalQa);
  const cancelled=normalized(order.status)==='cancelled';
  const dispatchNotes=[...new Set(orderLoads.map(load=>(load.legs||[]).slice().reverse().map(leg=>String(leg.notes||"").trim()).find(Boolean)).filter(Boolean))].join("; ");
  const partDispatched=order.status!=='dispatched'&&(!!order.dispatches?.length||!!order.gateComponents?.shipments?.length||orderLoads.some(load=>load.status==='dispatched_to_site')&&!every(orderLoads,load=>load.status==='dispatched_to_site'));
  const notes=dispatchNotes||String(order.dispatches?.at(-1)?.notes||'').trim()||[partDispatched?'Part dispatched — balance outstanding':'',cancelled?'Order cancelled':'',exemptCount?`QA not required for ${exemptCount} ${exemptCount===1?'panel':'panels'}`:'',coated.some(load=>load.status==='at_powder_coaters')?'At powder coaters':'',coated.some(load=>load.coatingCompleted&&!load.finalQa)?'Awaiting final QA after coating':'',(order.status==='dispatched'||every(orderLoads,load=>load.status==='dispatched_to_site'))?'Dispatched to site':''].filter(Boolean).join('; ');
  const gate=isGateOrder(order),manual=gate?gateProductionStages(order):null;
  const gateFlags=gate?Object.fromEntries(GATE_STAGES.map(([key,label])=>[label==='Fabricated / QA'?'QA':label,manual[key]==='complete'?'✓':manual[key]==='not_applicable'?'n/a':'-'])):{};
  if(gate)gateFlags['Ready for dispatch']=tick(!cancelled&&['completed','dispatched'].includes(normalized(order.status))&&manual.readyForDispatch==='complete');
  const explicitLocation=String((gate?order.villa:order.location)||order.location||order.villa||'');
  // The old combined field was a location on Panel orders. Other types now
  // present it as Notes in the order form, so keep those values in Order notes.
  const legacyLocation=!explicitLocation&&normalized(order.orderType)==='panels';
  const location=explicitLocation||(legacyLocation?String(order.locationNotes||''):'');
  const orderNotes=[...new Set([order.notes,legacyLocation?'':order.locationNotes].map(value=>String(value||'')).filter(Boolean))].join('\n\n');
  const detailNotes=[...new Set([...orderDetailRows({...order,notes:'',locationNotes:''}).filter(([,value])=>String(value)!==location).map(([label,value])=>label+': '+value),notes,gate&&order.manualProduction?.areaM2?`Gate area: ${order.manualProduction.areaM2} m²`:''].map(value=>String(value||'').trim()).filter(Boolean))].join('; ');
  const result={'Date ordered':siteOrderDate(order.dateOrdered||order.createdAt,true),PDF:/^[a-zA-Z0-9-]{16,100}$/.test(order.id||'')?'https://web.panelstockhq.com/?page=orders&orderPdf='+encodeURIComponent(order.id):'',Project:String(order.project||''),'Order number':String(order.orderNumber||''),'Order type':String(orderTypeLabel(order)||''),'Who ordered it':String(order.requestedBy||''),Location:location,'Order notes':orderNotes,'Requested date':siteOrderDate(order.requestedDeliveryDate),'Scheduled date':siteOrderDate(order.scheduledDeliveryDate),Status:orderStatusLabel(order.status),Drawn:stage(tick((typeof order.manualDrawing?.drawn==='boolean'?order.manualDrawing.drawn:order.drawingProgress?.drawn)===true)),Toolpathed:stage(tick(scheduled.length>0)),'Routed / cut':stage(tick(production.routing)),'Scheduled for production':skipsProductionScheduling(order)?'n/a':tick(!cancelled&&bookedOrders.has(order.id)),QA:stage(allExempt?'n/a':tick(qa)),'Sent to PC':stage(coatingPanels.length?tick(sentToPc):scheduled.length?'n/a':'-'),'Final QA':stage(coatingPanels.length?tick(finalQa):scheduled.length?'n/a':'-'),'Ready for dispatch':tick((nonPanel?['completed','dispatched'].includes(normalized(order.status)):qa&&coatingReady)&&!cancelled),Notes:detailNotes,...gateFlags};
  const validId=/^[a-zA-Z0-9-]{16,100}$/.test(order.id||'');
  const canMarkReady=!scheduled.length&&!gate&&normalized(order.orderType)!=='panels'&&['submitted','approved','ordered','in_stock'].includes(order.status);
  const canMarkDrawn=(gate||normalized(order.orderType)==='panels')&&result.Drawn!=='✓';
  const action=!validId||['cancelled','dispatched'].includes(order.status)?'':canMarkDrawn?'drawn':result['Ready for dispatch']==='✓'?'dispatch':canMarkReady?'ready':'';
  result.Action=action?`https://web.panelstockhq.com/?page=${action==='dispatch'?'dispatch':'orders'}&orderAction=${action}&orderId=${encodeURIComponent(order.id)}`:'';
  result['Schedule delivery']=validId&&!['cancelled','dispatched'].includes(order.status)?`https://web.panelstockhq.com/?page=orders&orderAction=schedule&orderId=${encodeURIComponent(order.id)}`:'';
  return result;
 });
}
const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const dateColumn=key=>['Date ordered','Requested date','Scheduled date'].includes(key);
const dateText=value=>{const d=new Date(epoch+value*86400000);return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;};
function actionLink(value){
 try{
  const url=new URL(value),id=url.searchParams.get('orderId'),action=url.searchParams.get('orderAction');
  if(url.origin!=='https://web.panelstockhq.com'||url.pathname!=='/'||!/^[a-zA-Z0-9-]{16,100}$/.test(id||'')||!['ready','dispatch','schedule','drawn'].includes(action))return null;
  return {url:`https://web.panelstockhq.com/?page=${action==='dispatch'?'dispatch':'orders'}&orderAction=${action}&orderId=${encodeURIComponent(id)}`,label:action==='drawn'?'Mark drawn':action==='schedule'?'Schedule delivery':action==='dispatch'?'Dispatch':'Mark ready'};
 }catch{return null;}
}
const previousNotes=row=>[...new Set([row['Order notes'],row.Notes].map(value=>String(value||'').trim()).filter(Boolean))].join('; ');
function combinedStatusNotes(row){
 const status=String(row.Status||'').trim(),parts=String(row.Notes||'').split(';').map(value=>value.trim()).filter(Boolean);
 const primary=normalized(status)==='dispatched'?(parts.find(value=>normalized(value)==='dispatched to site')||status):status;
 const values=primary?[primary]:[],seen=new Set([normalized(primary),normalized(status)]);
 for(const value of parts){
  const key=normalized(value);
  if(seen.has(key)||normalized(status)==='cancelled'&&key==='order cancelled')continue;
  seen.add(key);values.push(value);
 }
 return values.join('; ');
}
const workbookValue=(row,key)=>key==='Status / notes'?combinedStatusNotes(row):row[key]??'';
const linkColumn=key=>key==='Action'||key==='Schedule delivery';
export function buildSiteOrderFeed(rows,includeOrderType=true,includeActions=includeOrderType,includeScheduling=includeActions,splitDetails=includeScheduling,separateOrderNotes=splitDetails,includeProduction=separateOrderNotes,combineStatusNotes=includeProduction,reorderColumns=combineStatusNotes,swapStatusSchedule=reorderColumns,restoreDateAndNotes=swapStatusSchedule,statusAfterReady=restoreDateAndNotes){
 // Keep previous workbook column layouts aligned during refresh.
 const columns=(statusAfterReady?SITE_ORDER_COLUMNS:restoreDateAndNotes?DATE_AND_NOTES_SITE_ORDER_COLUMNS:swapStatusSchedule?SWAPPED_SITE_ORDER_COLUMNS:reorderColumns?ACTION_FIRST_SITE_ORDER_COLUMNS:combineStatusNotes?STATUS_NOTES_SITE_ORDER_COLUMNS:separateOrderNotes?SITE_ORDER_ROW_COLUMNS:splitDetails?SPLIT_SITE_ORDER_COLUMNS:LEGACY_SITE_ORDER_COLUMNS).filter(key=>(includeProduction||key!=='Scheduled for production')&&(includeOrderType||key!=='Order type')&&(includeActions||key!=='Action')&&(includeScheduling||key!=='Schedule delivery'));
 const body=(rows.length?rows:[{}]).map(row=>'<tr height="24" style="height:18pt;mso-height-source:userset">'+columns.map((key,index)=>{
  const value=key==='Notes'&&!separateOrderNotes?previousNotes(row):key==='Status / notes'?combinedStatusNotes(row):row[key]??(key==='Location / notes'?row.Location:'')??'',isDate=dateColumn(key)&&Number.isFinite(value),style=`font-family:Segoe UI;font-size:10pt;text-align:center;vertical-align:middle;white-space:nowrap;`;
  const link=key==='PDF'&&value?{url:value,label:'Open PDF'}:linkColumn(key)?actionLink(value):null;
  return `<td ${isDate?`x:num="${value}"`:'x:str'} style='${style}mso-number-format:"${isDate?'dd/mm/yyyy':'\\@'}"'>${link?`<a href="${xml(link.url)}" style="color:#176078;font-weight:bold">${link.label}</a>`:xml(isDate?dateText(value):linkColumn(key)?'':value)}</td>`;
 }).join('')+'</tr>').join('');
 return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>Site Orders</title></head><body><table id="site-orders-data"><tbody>${body}</tbody></table></body></html>`;
}
export function siteOrdersSheet(rows,zebraFormatting,formatLastRow=Math.min(1048576,Math.max(5000,rows.length+1001))){
 const cell=(key,index,value,row)=>{const ref=String.fromCharCode(65+index)+row,isDate=row>1&&dateColumn(key)&&Number.isFinite(value),style=row===1?(stageColumns.has(key)?10:9):dateColumn(key)?6:0,link=row>1?(key==='PDF'&&value?{url:value,label:'Open PDF'}:linkColumn(key)?actionLink(value):null):null;if(link)return `<c r="${ref}" s="${style}" t="str"><f>HYPERLINK(&quot;${xml(link.url)}&quot;,&quot;${link.label}&quot;)</f><v>${link.label}</v></c>`;return `<c r="${ref}" s="${style}" t="${isDate?'n':'inlineStr'}">${isDate?`<v>${value}</v>`:`<is><t xml:space="preserve">${xml(row>1&&linkColumn(key)?'':value)}</t></is>`}</c>`;};
 const widths=SITE_ORDER_COLUMNS.map((key,index)=>{const width=linkColumn(key)?20:key==='PDF'?12:stageColumns.has(key)?4.5:dateColumn(key)?15:Math.min(['Project','Location','Order notes','Notes','Status / notes'].includes(key)?255:32,['Project','Location','Order notes','Notes','Status / notes'].includes(key)?Math.ceil(Math.max(siteOrderTextWidth(key)*1.1,...rows.map(row=>siteOrderTextWidth(workbookValue(row,key))))+2):Math.max(12,key.length+2,...rows.map(row=>String(row[key]??'').length+2)));return `<col min="${index+1}" max="${index+1}" width="${width}" customWidth="1" bestFit="1" style="${dateColumn(key)?6:0}"/>`;}).join('');
 const body=rows.map((row,index)=>`<row r="${index+2}" ht="18" customHeight="1">${SITE_ORDER_COLUMNS.map((key,col)=>cell(key,col,workbookValue(row,key),index+2)).join('')}</row>`).join('');
 const stageIndices=SITE_ORDER_COLUMNS.flatMap((key,index)=>stageColumns.has(key)?[index]:[]);
 const flags=[[String.fromCharCode(65+Math.min(...stageIndices)),String.fromCharCode(65+Math.max(...stageIndices))]].map(([first,last],index)=>`<conditionalFormatting sqref="${first}2:${last}${formatLastRow}"><cfRule type="expression" dxfId="3" priority="${index*2+1}"><formula>OR(${first}2="✓",${first}2="n/a")</formula></cfRule><cfRule type="expression" dxfId="4" priority="${index*2+2}"><formula>${first}2="-"</formula></cfRule></conditionalFormatting>`).join('');
 const lastColumn=String.fromCharCode(64+SITE_ORDER_COLUMNS.length);
 return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${Math.max(1,rows.length+1)}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr baseColWidth="8" defaultRowHeight="18" customHeight="1"/><cols>${widths}</cols><sheetData><row r="1" ht="142" customHeight="1">${SITE_ORDER_COLUMNS.map((key,index)=>cell(key,index,key==='QA'?'Fabricated/QA':key,1)).join('')}</row>${body}</sheetData>${flags}${zebraFormatting(lastColumn,5)}<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/><ignoredErrors><ignoredError sqref="E2:E${formatLastRow}" numberStoredAsText="1"/></ignoredErrors><drawing r:id="rIdBrand"/></worksheet>`;
}




