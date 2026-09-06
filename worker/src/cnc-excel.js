const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export const CNC_COLUMNS=['Project','Order No.','Sheet','Length (mm)','Width (mm)','Sheet area (m²)','Panel IDs','Panel area (m²)','Waste','Status','Uploaded by','Date uploaded','Time uploaded','Completed by','Date completed','Time completed','Off-cut','Details','Template / Remake','Notes'];
// Keep the connected workbook range aligned with every column in this ordered list.

import {sumCncPanelArea} from './cnc-input.js';

export function buildCncExcelRows(panels,splitDateTime) {
  const grouped=new Map();
  for(const panel of panels) {
    const length=Math.max(Number(panel.sheetWidth)||0,Number(panel.sheetHeight)||0);
    const width=Math.min(Number(panel.sheetWidth)||0,Number(panel.sheetHeight)||0);
    const key=JSON.stringify([panel.jobReference||'',panel.orderNumber||'',panel.sheetNumber||'',panel.stockItemType||'',panel.stockItemId||panel.stockSku||'',length,width]);
    const current=grouped.get(key)||{panels:[],project:panel.jobReference||'',orderNumber:panel.orderNumber||'',sheetNumber:panel.sheetNumber||'',length,width};
    current.panels.push(panel);grouped.set(key,current);
  }
  return [...grouped.values()].map((group,index)=>{
    const completed=group.panels.every(panel=>panel.status==='completed');
    let uploadedPanel=group.panels[0]||{},completedPanel=completed?(group.panels[0]||{}):{};
    for(const panel of group.panels) {
      if(String(panel.uploadedAt||'').localeCompare(String(uploadedPanel.uploadedAt||''))<0)uploadedPanel=panel;
      if(completed&&String(panel.completedAt||'').localeCompare(String(completedPanel.completedAt||''))>0)completedPanel=panel;
    }
    const uploaded=splitDateTime(uploadedPanel.uploadedAt),finished=splitDateTime(completedPanel.completedAt),row=index+2;
    const panelIds=[...new Set(group.panels.map(panel=>panel.panelNumber).filter(Boolean))].join(', ');
    const panelArea=sumCncPanelArea(group.panels);
    const savedOffcut=completed&&group.panels.find(panel=>panel.offcutOutcome==='confirmed'&&panel.offcutDetails)?.offcutDetails;
    const offcutDetails=savedOffcut?`${Math.max(Number(savedOffcut.length)||0,Number(savedOffcut.width)||0)} × ${Math.min(Number(savedOffcut.length)||0,Number(savedOffcut.width)||0)} mm · ${savedOffcut.color||''} · ${savedOffcut.material||''}${savedOffcut.thickness?` · ${savedOffcut.thickness}mm`:''}`:'';
    const classified=group.panels.some(panel=>panel.isTemplate||panel.isRemake);
    const classificationNotes=group.panels.flatMap(panel=>panel.isTemplate?[`Template: ${panel.panelNumber||'Panel'}`]:panel.isRemake?[`Remake: ${panel.panelNumber||'Panel'}${panel.remakeReason?`: ${panel.remakeReason}`:''}`]:[]).join('; ');
    return {'Project':group.project,'Order No.':group.orderNumber,'Sheet':group.sheetNumber,'Length (mm)':group.length||'','Width (mm)':group.width||'','Sheet area (m²)':{formula:`D${row}*E${row}/1000000`,value:group.length*group.width/1000000},'Panel IDs':panelIds,'Panel area (m²)':panelArea||'','Waste':{formula:`IF(F${row}>0,MAX(0,(F${row}-H${row})/F${row}),"")`,value:group.length&&group.width?Math.max(0,(group.length*group.width/1000000-panelArea)/(group.length*group.width/1000000)):''},'Status':completed?'Completed':'Pending','Off-cut':completed?(savedOffcut?'✓':'✕'):'-','Details':offcutDetails,'Template / Remake':classified?'✓':'✕','Notes':classificationNotes,'Uploaded by':uploadedPanel.uploadedBy||'','Date uploaded':uploaded.date,'Time uploaded':uploaded.time,'Completed by':completedPanel.completedBy||'','Date completed':finished.date,'Time completed':finished.time};
  });
}

// Excel web queries read this static table without running JavaScript.
export function buildCncExcelFeed(rows) {
  const valueOf=value=>value&&typeof value==='object'&&Object.hasOwn(value,'value')?value.value:value;
  const numeric=new Set(['Length (mm)','Width (mm)','Sheet area (m²)','Panel area (m²)','Waste']);
  const baseStyle='font-family:Segoe UI;font-size:10pt;text-align:center;vertical-align:middle;';
  const cell=(key,raw)=>{
    const value=valueOf(raw);
    if(numeric.has(key)&&value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value))) {
      const number=Number(value),transportNumber=key==='Waste'?Math.round(number*10000)/10000:number,format=key==='Waste'?'0%':key.endsWith('(m²)')?'0.00':'0';
      return `<td x:num="${transportNumber}" style='${baseStyle}mso-number-format:"${format}"'>${key==='Waste'?Math.round(number*100)+'%':xml(number)}</td>`;
    }
    return `<td x:str style='${baseStyle}mso-number-format:"\\@"'>${xml(value)}</td>`;
  };
  return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>CNC Tracker</title></head><body><table id="cnc-data"><tbody>${rows.map(row=>`<tr>${CNC_COLUMNS.map(key=>cell(key,row[key])).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}

const reportDate=value=>{const match=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);if(!match)return null;const day=Number(match[1]),month=Number(match[2]),year=Number(match[3])+(match[3].length===2?2000:0),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date:null;};
const dateKey=date=>date.toISOString().slice(0,10);
const dateLabel=date=>`${String(date.getUTCDate()).padStart(2,'0')}/${String(date.getUTCMonth()+1).padStart(2,'0')}/${date.getUTCFullYear()}`;
const panelCount=value=>String(value||'').split(',').map(id=>id.trim()).filter(Boolean).length;
export const CNC_REPORT_PERIODS=['daily','weekly','monthly'];
const excelDate=value=>Math.floor((reportDate(value).getTime()-Date.UTC(1899,11,30))/86400000);
export function buildCncReportRows(rows) {
  const daily=new Map(),weekly=new Map(),monthly=new Map();
  for(const row of rows) {
    if(String(row.Status||'').trim().toLowerCase()!=='completed')continue;
    const completed=reportDate(row['Date completed']);if(!completed)continue;
    const dayKey=dateKey(completed),day=daily.get(dayKey)||{date:new Date(completed),sheets:0,panels:0,area:0};
    day.sheets+=1;day.panels+=panelCount(row['Panel IDs']);day.area+=Number(row['Panel area (m²)'])||0;daily.set(dayKey,day);
    const monday=new Date(completed),dayNumber=(monday.getUTCDay()+6)%7;monday.setUTCDate(monday.getUTCDate()-dayNumber);
    const weekKey=dateKey(monday),week=weekly.get(weekKey)||{date:monday,sheets:0,panels:0,area:0};
    week.sheets+=1;week.panels+=panelCount(row['Panel IDs']);week.area+=Number(row['Panel area (m²)'])||0;weekly.set(weekKey,week);
    const month=new Date(Date.UTC(completed.getUTCFullYear(),completed.getUTCMonth(),1)),monthKey=dateKey(month),monthReport=monthly.get(monthKey)||{date:month,sheets:0,panels:0,area:0};
    monthReport.sheets+=1;monthReport.panels+=panelCount(row['Panel IDs']);monthReport.area+=Number(row['Panel area (m²)'])||0;monthly.set(monthKey,monthReport);
  }
  const format=values=>[...values.values()].sort((a,b)=>a.date-b.date).map(value=>({date:dateLabel(value.date),sheets:value.sheets,panels:value.panels,area:Math.round(value.area*100)/100}));
  return {daily:format(daily),weekly:format(weekly),monthly:format(monthly)};
}

// Each report uses its own read-only web query, including newly completed periods.
export function buildCncReportFeed(rows,period) {
  if(!CNC_REPORT_PERIODS.includes(period))throw new RangeError('Unknown CNC report period');
  const reports=buildCncReportRows(rows)[period];
  const baseStyle='font-family:Segoe UI;font-size:10pt;text-align:center;vertical-align:middle;';
  const cell=(value,format,display=value)=>`<td x:num="${value}" style='${baseStyle}mso-number-format:"${format}"'>${xml(display)}</td>`;
  const body=reports.map(row=>{
    const dateFormat=period==='monthly'?'mmmm yyyy':'dd/mm/yyyy';
    const dateText=period==='monthly'?new Intl.DateTimeFormat('en-AU',{month:'long',year:'numeric',timeZone:'UTC'}).format(reportDate(row.date)):row.date;
    return `<tr>${cell(excelDate(row.date),dateFormat,dateText)}${cell(row.sheets,'0')}${cell(row.panels,'0')}${cell(row.area,'0.00',row.area.toFixed(2))}</tr>`;
  }).join('');
  // A blank four-cell result lets Excel clear old data while retaining the query anchor.
  const empty=`<tr>${Array.from({length:4},()=>`<td x:str style='${baseStyle}'></td>`).join('')}</tr>`;
  return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>CNC ${period} report</title></head><body><table id="cnc-report-data"><tbody>${body||empty}</tbody></table></body></html>`;
}

// Standard OOXML web query: no macros or stock-write access. The URL contains the read-only sharing token.
export function connectCncWorkbook(files, headers, rows, url) {
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const encode=text=>new TextEncoder().encode(text);
  const update=(name,from,to)=>{const file=files.find(f=>f.name===name);file.data=encode(new TextDecoder().decode(file.data).replace(from,to));};
  const tableRef=`A2:T${Math.max(2,rows.length+1)}`,reports=buildCncReportRows(rows);
  const reportQueries=CNC_REPORT_PERIODS.map((period,index)=>{
    const title=period[0].toUpperCase()+period.slice(1)+' Report',reportUrl=new URL(url);
    reportUrl.searchParams.set('report',period);
    return {id:index+2,title,name:title.replace(' ','_'),range:`A2:D${Math.max(2,reports[period].length+1)}`,url:reportUrl.href};
  });
  const queries=[{id:1,title:'CNC Tracker',name:'CNC_Tracker',range:tableRef,url},...reportQueries];
  const reportSheet=(reportRows,firstHeader,dateStyle=6)=>{
    const reportCell=(ref,value,style=0,type='n')=>type==='s'?`<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xml(value)}</t></is></c>`:`<c r="${ref}" t="n" s="${style}"><v>${value}</v></c>`;
    const body=reportRows.map((row,index)=>{
      const number=index+2;
      return `<row r="${number}">${reportCell(`A${number}`,excelDate(row.date),dateStyle)}${reportCell(`B${number}`,row.sheets)}${reportCell(`C${number}`,row.panels)}${reportCell(`D${number}`,row.area,4)}</row>`;
    }).join('');
    const lastRow=Math.max(1,reportRows.length+1);
    const zebra='<conditionalFormatting sqref="A2:D1048576"><cfRule type="expression" dxfId="5" priority="1"><formula>AND($A2&lt;&gt;"",MOD(ROW(),2)=0)</formula></cfRule></conditionalFormatting>';
    return `<worksheet xmlns="${ns}" xmlns:r="${rel}"><dimension ref="A1:D${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr baseColWidth="8" defaultRowHeight="18"/><cols><col min="1" max="1" width="16" customWidth="1" style="${dateStyle}"/><col min="2" max="3" width="18" customWidth="1"/><col min="4" max="4" width="24" customWidth="1" style="4"/></cols><sheetData><row r="1" ht="30" customHeight="1">${[firstHeader,'Sheets completed','Panels completed','Total panel area (m²)'].map((value,index)=>reportCell(`${String.fromCharCode(65+index)}1`,value,1,'s')).join('')}</row>${body}</sheetData>${zebra}<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/></worksheet>`;
  };
  // Waste: green through 10%, orange through 15%, red above 15% (displayed as 16%+ at whole-percent precision).
  const formatting=`<conditionalFormatting sqref="I2:I1048576"><cfRule type="expression" dxfId="0" priority="1"><formula>AND(ISNUMBER($I2),$I2&lt;=0.1)</formula></cfRule><cfRule type="expression" dxfId="1" priority="2"><formula>AND(ISNUMBER($I2),$I2&gt;0.1,$I2&lt;=0.15)</formula></cfRule><cfRule type="expression" dxfId="2" priority="3"><formula>AND(ISNUMBER($I2),$I2&gt;0.15)</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="J2:J1048576"><cfRule type="expression" dxfId="3" priority="4"><formula>LOWER(TRIM($J2))="completed"</formula></cfRule><cfRule type="expression" dxfId="4" priority="5"><formula>LOWER(TRIM($J2))="pending"</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="Q2:Q1048576"><cfRule type="expression" dxfId="3" priority="6"><formula>TRIM($Q2)="✓"</formula></cfRule><cfRule type="expression" dxfId="2" priority="7"><formula>TRIM($Q2)="✕"</formula></cfRule><cfRule type="expression" dxfId="4" priority="8"><formula>TRIM($Q2)="-"</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="S2:S1048576"><cfRule type="expression" dxfId="3" priority="9"><formula>TRIM($S2)="✓"</formula></cfRule><cfRule type="expression" dxfId="2" priority="10"><formula>TRIM($S2)="✕"</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="A2:T1048576"><cfRule type="expression" dxfId="5" priority="11"><formula>AND($A2&lt;&gt;"",MOD(ROW(),2)=0)</formula></cfRule></conditionalFormatting>`;
  // Keep formatting ahead of page margins, as required by the worksheet schema.
  update('xl/worksheets/sheet1.xml','<pageMargins',formatting+'<pageMargins');
  update('xl/styles.xml','<fonts count="2">','<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="mmmm yyyy"/></numFmts><fonts count="2">');
  update('xl/styles.xml','<cellXfs count="6">','<cellXfs count="8">');
  update('xl/styles.xml','</cellXfs>','<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>');
  update('xl/styles.xml','</styleSheet>','<dxfs count="6"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor rgb="FFC6EFCE"/></patternFill></fill><alignment horizontal="center" vertical="center"/></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFC000"/><bgColor rgb="FFFFC000"/></patternFill></fill><alignment horizontal="center" vertical="center"/></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor rgb="FFFFC7CE"/></patternFill></fill><alignment horizontal="center" vertical="center"/></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FF8CE28C"/><bgColor rgb="FF8CE28C"/></patternFill></fill><alignment horizontal="center" vertical="center"/></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF99"/><bgColor rgb="FFFFFF99"/></patternFill></fill><alignment horizontal="center" vertical="center"/></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFF2F5F7"/><bgColor rgb="FFF2F5F7"/></patternFill></fill><alignment horizontal="center" vertical="center"/></dxf></dxfs></styleSheet>');
  update('xl/workbook.xml','<sheet name="Sheet1" sheetId="1" r:id="rId1"/>','<sheet name="CNC Tracker" sheetId="1" r:id="rId1"/>');
  // Excel associates this defined name with the query table. Microsoft Office
  // requires its range to exactly match the connected table's range.
  const definedNames=queries.map(query=>{
    const absoluteRange=query.range.replace(/([A-Z]+)([0-9]+)/g,(_,column,row)=>`$${column}$${row}`);
    return `<definedName name="${query.name}" localSheetId="${query.id-1}">'${query.title}'!${absoluteRange}</definedName>`;
  }).join('');
  update('xl/workbook.xml','</sheets>',`<sheet name="Daily Report" sheetId="2" r:id="rId5"/><sheet name="Weekly Report" sheetId="3" r:id="rId6"/><sheet name="Monthly Report" sheetId="4" r:id="rId7"/></sheets><definedNames>${definedNames}</definedNames>`);
  update('xl/_rels/workbook.xml.rels','</Relationships>',`<Relationship Id="rId4" Type="${rel}/connections" Target="connections.xml"/><Relationship Id="rId5" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId6" Type="${rel}/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId7" Type="${rel}/worksheet" Target="worksheets/sheet4.xml"/></Relationships>`);
  const queryTypes=queries.map(query=>`<Override PartName="/xl/queryTables/queryTable${query.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>`).join('');
  const reportTypes=reportQueries.map(query=>`<Override PartName="/xl/worksheets/sheet${query.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  update('[Content_Types].xml','</Types>',`<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>${queryTypes}${reportTypes}</Types>`);
  update('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',`<worksheet xmlns="${ns}" xmlns:r="${rel}">`);
  // These columns intentionally remain text so identifiers keep leading zeroes and displayed dates/times remain unchanged.
  update('xl/worksheets/sheet1.xml','</worksheet>','<ignoredErrors><ignoredError sqref="B2:C1048576 G2:G1048576 L2:T1048576" numberStoredAsText="1"/></ignoredErrors></worksheet>');
  // Row 1 is the permanent frozen worksheet header. Excel's own web-query
  // writer attaches a headerless query directly to the worksheet range.
  const extras={
    'xl/worksheets/sheet2.xml':reportSheet(reports.daily,'Date'),
    'xl/worksheets/sheet3.xml':reportSheet(reports.weekly,'Week commencing'),
    'xl/worksheets/sheet4.xml':reportSheet(reports.monthly,'Month',7),
    'xl/connections.xml':`<connections xmlns="${ns}">${queries.map(query=>`<connection id="${query.id}" name="PanelStock ${query.id===1?'CNC live':query.title+' live'}" description="Read-only CNC ${query.id===1?'schedule':query.title.toLowerCase()}. Refreshes every minute while Excel is open. Enable this connection only if you trust PanelStock." type="4" refreshedVersion="8" refreshOnLoad="1" interval="1" saveData="1"><webPr xl2000="1" url="${xml(query.url)}" htmlTables="1" htmlFormat="all"/></connection>`).join('')}</connections>`,
  };
  for(const query of queries) {
    extras[`xl/worksheets/_rels/sheet${query.id}.xml.rels`]=`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/queryTable" Target="../queryTables/queryTable${query.id}.xml"/></Relationships>`;
    extras[`xl/queryTables/queryTable${query.id}.xml`]=`<queryTable xmlns="${ns}" name="${query.name}" headers="0" backgroundRefresh="0" refreshOnLoad="1" connectionId="${query.id}" preserveFormatting="1" adjustColumnWidth="0" growShrinkType="insertDelete" applyNumberFormats="${query.id===1?0:1}" applyBorderFormats="0" applyFontFormats="1" applyPatternFormats="1" applyAlignmentFormats="0" applyWidthHeightFormats="0"/>`;
  }
  for(const [name,data]of Object.entries(extras))files.push({name,data:encode(data)});
}
