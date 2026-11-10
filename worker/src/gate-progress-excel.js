import {buildZip} from './reports.js';
import {siteOrderTextWidth} from './site-orders-excel.js';
import {brandLogo} from './brand-logo.js';
import {gateProgressBrandDrawing} from './gate-progress-brand.js';
import {gateProgressStageDefinitions,gateProgressStages,isGateProgressComplete} from './gate-progress-stages.js';
const xml=v=>String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const GATE_PROGRESS_HEADERS=['Order','Villa','Colour','Gate type','Order / set / component',...gateProgressStageDefinitions.map(([,label])=>label),'Checked by','QA date','Dispatch date','Delivery date','Order area (m²)'];
const progressRow=(kind,level,identity,components,options={},area='',component=null)=>{
 const stages=gateProgressStages(components,options);
 return {kind,level,stages,values:[...identity,...stages.map(stage=>stage.symbol),component?.checkedBy||'',component?.checkedAt||'',component?.shipment?.at||'',component?.delivery?.at||'',area]};
};
export function gateProgressRows(orders,{legacyColumns=false}={}){
 const villas=new Map(),rows=[];
 for(const order of orders.filter(order=>!isGateProgressComplete(order))){const key=JSON.stringify([order.project,order.villa]);if(!villas.has(key))villas.set(key,[]);villas.get(key).push(order);}
 for(const group of [...villas.values()].sort((a,b)=>String(a[0].project).localeCompare(String(b[0].project))||String(a[0].villa).localeCompare(String(b[0].villa),undefined,{numeric:true}))){
  const first=group[0],heading=Array(GATE_PROGRESS_HEADERS.length).fill('');
  if(legacyColumns)heading[0]=first.project;heading[1]=first.villa;heading[4]=`Villa ${first.villa||'not recorded'}`;
  rows.push({kind:'villa',level:0,stages:[],values:heading});
  for(const order of group){
   const identity=[...(legacyColumns?[order.project,order.villa,String(order.orderNumber||'')]:[String(order.orderNumber||''),order.villa,String(order.colour||'')]),order.orderType],options={scheduled:order.scheduledForProduction?1:0,legacyStages:order.legacyStages};
   rows.push(progressRow('order',1,[...identity,`Order ${order.orderNumber} — ${order.orderType} — Villa ${order.villa||'not recorded'}`],order.components,{...options,missing:!order.components.length},order.areaM2??''));
   for(const set of [...new Set(order.components.map(c=>c.set))]){
    const components=order.components.filter(c=>c.set===set);
    rows.push(progressRow('set',2,[...identity,`Set ${set}`],components,options));
    for(const component of components)rows.push(progressRow('component',3,[...identity,component.label],[component],options,'',component));
   }
  }
 }
 return rows;
}
const serial=value=>{const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return null;return (date.getTime()+10*3600000-Date.UTC(1899,11,30))/86400000;};
export function gateProgressWorkbookParts(orders,{sample=false,staging=false}={}){
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships',rows=gateProgressRows(orders),stageEnd=5+gateProgressStageDefinitions.length,lastColumn=String.fromCharCode(64+GATE_PROGRESS_HEADERS.length),dateColumns=['QA date','Dispatch date','Delivery date'].map(label=>GATE_PROGRESS_HEADERS.indexOf(label)),areaColumn=GATE_PROGRESS_HEADERS.indexOf('Order area (m²)'),widths=[11,13,20,20,42,...Array(gateProgressStageDefinitions.length).fill(4.5),17,22,22,22,20];
 // Match Site Orders: one branded header, with enough height for the rotated stages.
 const headerHeight=142;
 for(const column of [0,1,2,3,4,11])widths[column]=Math.min(255,Math.max(widths[column],Math.ceil(Math.max(siteOrderTextWidth(GATE_PROGRESS_HEADERS[column]),...rows.map(row=>siteOrderTextWidth(row.values[column])))*1.1)+2));
 const cell=(value,col,row,style=0)=>{const ref=String.fromCharCode(65+col)+row,date=dateColumns.includes(col)?serial(value):null,num=typeof value==='number'?value:null;return `<c r="${ref}" s="${date!==null?6:col===areaColumn&&num!==null?5:style}" t="${date!==null||num!==null?'n':'inlineStr'}">${date!==null||num!==null?`<v>${date??num}</v>`:`<is><t xml:space="preserve">${xml(value)}</t></is>`}</c>`;};
 const rowStyle=(row,col)=>{
  if(row.kind==='villa')return 2;
  if(col>=5&&col<stageEnd){const state=row.stages[col-5].state;return state==='complete'?7:state==='rework'?8:12;}
  return col===4&&row.kind!=='villa'?row.kind==='order'?9:row.kind==='set'?10:11:row.kind==='villa'?2:row.kind==='order'?3:row.kind==='set'?4:0;
 };
 const body=rows.map((row,index)=>`<row r="${index+2}" ht="18" customHeight="1">${row.values.map((value,col)=>cell(value,col,index+2,rowStyle(row,col))).join('')}</row>`).join('');
 const sheet=`<worksheet xmlns="${ns}" xmlns:r="${rel}"><dimension ref="A1:${lastColumn}${Math.max(1,rows.length+1)}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr baseColWidth="8" defaultRowHeight="18" customHeight="1"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData><row r="1" ht="${headerHeight}" customHeight="1">${GATE_PROGRESS_HEADERS.map((h,i)=>cell(h,i,1,i>=5&&i<stageEnd?13:1)).join('')}</row>${body}</sheetData><pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/><drawing r:id="rIdBrand"/></worksheet>`;
 const guide=[sample?'Gate Progress — sample':'Gate Progress',sample?'This workbook contains synthetic sample data only.':'This workbook is a snapshot of gate progress at download time.','Each villa has a heading without progress indicators. All orders, sets and components are shown in a flat view.','Each highlight, gate and post has its own QA and dispatch/delivery history.','Green ✓ means complete and yellow - means pending. Summary ticks require every component to be complete.','Scheduled for production reflects an assigned, non-cancelled general/CNC schedule entry for the order; delivery schedules do not count.','Each set lists the gates, highlights and posts actually required, including zero for absent parts. Buggy orders contain one or two gates only, with no highlights or posts.','Drawn reflects the saved Drawing status in Gate Progress. Undrawn keeps the components but removes current QA and dispatch readiness. Earlier QA reports are retained.', 'm² is entered once when confirming Drawn. It is shown only on the order row and is never split across components.','Daily/Weekly/Monthly production credits the total order area once all components pass QA. Partial deliveries do not recount it.','Delivered means receipt was recorded for those components, or the full dispatched order was received. See the original receipt for acknowledgement and evidence.','Existing approvals are never copied to newly configured components. Components with inspection or shipment history cannot be removed.','This workbook does not refresh automatically. Download a new snapshot to see changes.'];
 const guideSheet=`<worksheet xmlns="${ns}"><cols><col min="1" max="1" width="140" customWidth="1"/></cols><sheetData>${guide.map((v,i)=>`<row r="${i+1}" ht="32" customHeight="1">${cell(v,0,i+1,i===0?1:0)}</row>`).join('')}</sheetData></worksheet>`;
 const fonts='<fonts count="3"><font><sz val="10"/><name val="Segoe UI"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font><font><b/><sz val="10"/><color rgb="FF334155"/><name val="Segoe UI"/></font></fonts>',colors=['FF155E75','FFDDEBF7','FFE8F2F5','FFF2F5F7','FF8CE28C','FFFFC7CE','FFFFFF99','FFE2E8F0'];
 const fills='<fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+colors.map(c=>`<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`).join('')+'</fills>';
 const xf=(fill=0,font=0,number=0,alignment='horizontal="center" vertical="center" wrapText="0"')=>`<xf numFmtId="${number}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment ${alignment}/></xf>`;
 const center='horizontal="center" vertical="center" wrapText="0"';
 const styles=`<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>${fonts}${fills}<borders count="1"><border/></borders><cellStyleXfs count="1">${xf()}</cellStyleXfs><cellXfs count="14">${xf()}${xf(2,1,0,'horizontal="center" vertical="bottom" wrapText="0"')}${xf(9,2)}${xf(3,2)}${xf(5)}${xf(3,2,2)}${xf(0,0,164)}${xf(6,0,0,center)}${xf(7,0,0,center)}${xf(3,2,0,'horizontal="center" vertical="center" wrapText="0"')}${xf(5,0,0,'horizontal="center" vertical="center" wrapText="0"')}${xf(0,0,0,'horizontal="center" vertical="center" wrapText="0"')}${xf(8,0,0,center)}${xf(2,1,0,'horizontal="center" vertical="bottom" textRotation="90" wrapText="0"')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 const parts={'[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/gateProgressBrand.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${[1,2].map(i=>`<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,'_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="${rel}"><fileSharing readOnlyRecommended="1"/><bookViews><workbookView/></bookViews><sheets><sheet name="Gate Progress" sheetId="1" r:id="rId1"/><sheet name="Read Me" sheetId="2" r:id="rId2"/></sheets></workbook>`,'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,'xl/styles.xml':styles,'xl/worksheets/sheet1.xml':sheet,'xl/worksheets/sheet2.xml':guideSheet,
  'xl/worksheets/_rels/sheet1.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdBrand" Type="${rel}/drawing" Target="../drawings/gateProgressBrand.xml"/></Relationships>`,
  'xl/drawings/gateProgressBrand.xml':gateProgressBrandDrawing({sample,staging}),
  'xl/drawings/_rels/gateProgressBrand.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/image" Target="../media/lennox-logo.png"/></Relationships>`,
  'xl/media/lennox-logo.png':Uint8Array.from(atob(brandLogo.split(',')[1]),char=>char.charCodeAt(0))};
 return parts;
}

export async function buildGateProgressDraft(orders,options){
 const parts=gateProgressWorkbookParts(orders,options);
 return buildZip(Object.entries(parts).map(([name,data])=>({name,data:typeof data==='string'?new TextEncoder().encode(data):data})));
}
