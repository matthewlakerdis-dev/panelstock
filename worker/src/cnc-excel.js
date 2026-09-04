const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export const CNC_COLUMNS=['Project','Order number','Sheet number','Length (mm)','Width (mm)','Sheet area (m²)','Panel IDs','Panel area (m²)','Waste','Status','Uploaded by','Date uploaded','Time uploaded','Completed by','Date completed','Time completed'];

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
    const uploadedPanel=[...group.panels].sort((a,b)=>String(a.uploadedAt||'').localeCompare(String(b.uploadedAt||'')))[0]||{};
    const completed=group.panels.every(panel=>panel.status==='completed');
    const completedPanel=completed?[...group.panels].sort((a,b)=>String(b.completedAt||'').localeCompare(String(a.completedAt||'')))[0]||{}:{};
    const uploaded=splitDateTime(uploadedPanel.uploadedAt),finished=splitDateTime(completedPanel.completedAt),row=index+2;
    const panelIds=[...new Set(group.panels.map(panel=>panel.panelNumber).filter(Boolean))].join(', ');
    const panelArea=group.panels.reduce((sum,panel)=>sum+(Number(panel.totalPanelArea)||0),0);
    return {'Project':group.project,'Order number':group.orderNumber,'Sheet number':group.sheetNumber,'Length (mm)':group.length||'','Width (mm)':group.width||'','Sheet area (m²)':{formula:`D${row}*E${row}/1000000`,value:group.length*group.width/1000000},'Panel IDs':panelIds,'Panel area (m²)':panelArea||'','Waste':{formula:`IF(F${row}>0,MAX(0,(F${row}-H${row})/F${row}),"")`,value:group.length&&group.width?Math.max(0,(group.length*group.width/1000000-panelArea)/(group.length*group.width/1000000)):''},'Status':completed?'Completed':'Pending','Uploaded by':uploadedPanel.uploadedBy||'','Date uploaded':uploaded.date,'Time uploaded':uploaded.time,'Completed by':completedPanel.completedBy||'','Date completed':finished.date,'Time completed':finished.time};
  });
}

// Excel web queries read this static table without running JavaScript.
export function buildCncExcelFeed(rows) {
  const valueOf=value=>value&&typeof value==='object'&&Object.hasOwn(value,'value')?value.value:value;
  const numeric=new Set(['Length (mm)','Width (mm)','Sheet area (m²)','Panel area (m²)','Waste']);
  const cell=(key,raw)=>{
    const value=valueOf(raw);
    if(numeric.has(key)&&value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value))) {
      const number=Number(value),format=key==='Waste'?'0.0%':key.endsWith('(m²)')?'0.00':'0';
      return `<td x:num="${number}" style='mso-number-format:"${format}"'>${key==='Waste'?(number*100).toFixed(1)+'%':xml(number)}</td>`;
    }
    return `<td x:str style='mso-number-format:"\\@"'>${xml(value)}</td>`;
  };
  return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>CNC Tracker</title></head><body><table id="cnc-data"><tr>${CNC_COLUMNS.map(key=>`<th>${xml(key)}</th>`).join('')}</tr>${rows.map(row=>`<tr>${CNC_COLUMNS.map(key=>cell(key,row[key])).join('')}</tr>`).join('')}</table></body></html>`;
}

// Standard OOXML web query: no macros or stock-write access. The URL contains the read-only sharing token.
export function connectCncWorkbook(files, headers, rowCount, url) {
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const encode=text=>new TextEncoder().encode(text);
  const update=(name,from,to)=>{const file=files.find(f=>f.name===name);file.data=encode(new TextDecoder().decode(file.data).replace(from,to));};
  // Waste: green through 10%, orange through 15%, red above 15% (displayed as 16%+ at whole-percent precision).
  const formatting=`<conditionalFormatting sqref="I2:I1048576"><cfRule type="expression" dxfId="0" priority="1"><formula>AND(ISNUMBER($I2),$I2&lt;=0.1)</formula></cfRule><cfRule type="expression" dxfId="1" priority="2"><formula>AND(ISNUMBER($I2),$I2&gt;0.1,$I2&lt;=0.15)</formula></cfRule><cfRule type="expression" dxfId="2" priority="3"><formula>AND(ISNUMBER($I2),$I2&gt;0.15)</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="J2:J1048576"><cfRule type="expression" dxfId="3" priority="4"><formula>LOWER(TRIM($J2))="completed"</formula></cfRule><cfRule type="expression" dxfId="4" priority="5"><formula>LOWER(TRIM($J2))="pending"</formula></cfRule></conditionalFormatting>`;
  // OOXML requires autoFilter, then conditionalFormatting, then pageMargins.
  update('xl/worksheets/sheet1.xml','<pageMargins',formatting+'<pageMargins');
  update('xl/styles.xml','</styleSheet>','<dxfs count="5"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFC000"/><bgColor rgb="FFFFC000"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FF8CE28C"/><bgColor rgb="FF8CE28C"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF99"/><bgColor rgb="FFFFFF99"/></patternFill></fill></dxf></dxfs></styleSheet>');
  update('xl/workbook.xml','</sheets>',`</sheets><definedNames><definedName name="CNC_Tracker" localSheetId="0">Sheet1!$A$1:$P$${Math.max(1,rowCount+1)}</definedName></definedNames>`);
  update('xl/_rels/workbook.xml.rels','</Relationships>',`<Relationship Id="rId4" Type="${rel}/connections" Target="connections.xml"/></Relationships>`);
  update('[Content_Types].xml','</Types>','<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/><Override PartName="/xl/queryTables/queryTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/></Types>');
  const extras={
    'xl/connections.xml':`<connections xmlns="${ns}"><connection id="1" name="PanelStock CNC live" description="Read-only CNC schedule. Refreshes every minute while Excel is open. Enable this connection only if you trust PanelStock." type="4" refreshedVersion="6" background="1" refreshOnLoad="1" interval="1" saveData="1"><webPr xl2000="1" url="${xml(url)}" htmlTables="1" htmlFormat="all"><tables count="1"><x v="1"/></tables></webPr></connection></connections>`,
    'xl/worksheets/_rels/sheet1.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/queryTable" Target="../queryTables/queryTable1.xml"/></Relationships>`,
    'xl/queryTables/queryTable1.xml':`<queryTable xmlns="${ns}" name="CNC_Tracker" connectionId="1" refreshOnLoad="1" backgroundRefresh="1" headers="1" rowNumbers="0" preserveFormatting="1" adjustColumnWidth="0" growShrinkType="overwriteClear" applyNumberFormats="0" applyAlignmentFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyWidthHeightFormats="0"><queryTableRefresh nextId="17" headersInLastRefresh="1" preserveSortFilterLayout="1"><queryTableFields count="16">${headers.map((header,index)=>`<queryTableField id="${index+1}" name="${xml(header)}"/>`).join('')}</queryTableFields></queryTableRefresh></queryTable>`
  };
  for(const [name,data]of Object.entries(extras))files.push({name,data:encode(data)});
}
