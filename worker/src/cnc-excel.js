const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export const CNC_COLUMNS=['order_number','job_reference','sheet_number','panel_id','status','uploaded_by','date_uploaded','time_uploaded','completed_by','date_completed','time_completed'];

// Excel web queries read this static table without running JavaScript.
export function buildCncExcelFeed(rows) {
  return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>CNC Tracker</title></head><body><table id="cnc-data"><tr>${CNC_COLUMNS.map(key=>`<th>${key}</th>`).join('')}</tr>${rows.map(row=>`<tr>${CNC_COLUMNS.map(key=>`<td x:str style='mso-number-format:"\\@"'>${xml(row[key])}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
}

// Standard OOXML web query: no macros or stock-write access. The URL contains the read-only sharing token.
export function connectCncWorkbook(files, headers, rowCount, url) {
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const encode=text=>new TextEncoder().encode(text);
  const update=(name,from,to)=>{const file=files.find(f=>f.name===name);file.data=encode(new TextDecoder().decode(file.data).replace(from,to));};
  // Anchor the status column, but keep the row relative; include future query rows.
  update('xl/worksheets/sheet1.xml','</sheetData>','</sheetData><conditionalFormatting sqref="A2:K1048576"><cfRule type="expression" dxfId="0" priority="1"><formula>LOWER(TRIM($E2))="completed"</formula></cfRule><cfRule type="expression" dxfId="1" priority="2"><formula>LOWER(TRIM($E2))="pending"</formula></cfRule></conditionalFormatting>');
  update('xl/styles.xml','</styleSheet>','<dxfs count="2"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FF8CE28C"/><bgColor rgb="FF8CE28C"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF99"/><bgColor rgb="FFFFFF99"/></patternFill></fill></dxf></dxfs></styleSheet>');
  update('xl/workbook.xml','</sheets>',`</sheets><definedNames><definedName name="CNC_Tracker" localSheetId="0">Sheet1!$A$1:$K$${Math.max(1,rowCount+1)}</definedName></definedNames>`);
  update('xl/_rels/workbook.xml.rels','</Relationships>',`<Relationship Id="rId4" Type="${rel}/connections" Target="connections.xml"/></Relationships>`);
  update('[Content_Types].xml','</Types>','<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/><Override PartName="/xl/queryTables/queryTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/></Types>');
  const extras={
    'xl/connections.xml':`<connections xmlns="${ns}"><connection id="1" name="PanelStock CNC live" description="Read-only CNC schedule. Refreshes every minute while Excel is open. Enable this connection only if you trust PanelStock." type="4" refreshedVersion="6" background="1" refreshOnLoad="1" interval="1" saveData="1"><webPr xl2000="1" url="${xml(url)}" htmlTables="1" htmlFormat="all"><tables count="1"><x v="1"/></tables></webPr></connection></connections>`,
    'xl/worksheets/_rels/sheet1.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/queryTable" Target="../queryTables/queryTable1.xml"/></Relationships>`,
    'xl/queryTables/queryTable1.xml':`<queryTable xmlns="${ns}" name="CNC_Tracker" connectionId="1" refreshOnLoad="1" backgroundRefresh="1" preserveFormatting="1" adjustColumnWidth="1" growShrinkType="insertDelete"></queryTable>`
  };
  for(const [name,data]of Object.entries(extras))files.push({name,data:encode(data)});
}
