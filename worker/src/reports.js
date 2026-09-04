import {connectCncWorkbook} from './cnc-excel.js';
import {buildCncTrackerHtml} from './cnc-tracker.js';
// ============================================================================
// PanelStock Reports Worker
// Receives a synced snapshot of stock data + report settings from the
// PanelStock app, and sends scheduled email reports (daily/weekly at a
// configured local time) using Resend. Runs entirely server-side via a
// Cloudflare Cron Trigger, independent of any device having the app open.
// ============================================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}


// Dedicated, read-only token for the public CNC tracker export link — deliberately separate from
// SHARED_SECRET (which has full read/write access), so this link can be shared broadly with
// people who just need to view the spreadsheet, without exposing anything else.


// ---- Minimal from-scratch .xlsx writer (no external libraries — same implementation used
// client-side, ported here so the live public export link can generate a fresh file per request) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function strToBytes(str) { return new TextEncoder().encode(str); }
// Compresses bytes with real DEFLATE (the format essentially every real .xlsx-producing tool uses
// for every entry). An earlier version of this writer used "stored" (uncompressed) entries — valid
// per the ZIP spec and accepted by most general-purpose tools, but real Excel's own parser turned
// out to be far less tolerant of it than expected, so this now matches what genuine Excel-generated
// files actually contain.
async function deflateRaw(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  const writing = writer.write(bytes).then(() => writer.close());
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await writing;
  let totalLen = 0;
  chunks.forEach((c) => { totalLen += c.length; });
  const out = new Uint8Array(totalLen);
  let pos = 0;
  chunks.forEach((c) => { out.set(c, pos); pos += c.length; });
  return out;
}
async function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = strToBytes(name);
    const crc = crc32(data);
    const uncompressedSize = data.length;
    const compressedData = await deflateRaw(data);
    const compressedSize = compressedData.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true);
    lv.setUint16(8, 8, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, compressedSize, true); lv.setUint32(22, uncompressedSize, true);
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, compressedData);

    // Central directory entry layout differs from the local header — critically, the compression
    // method field sits at byte offset 10 here (offset 8 is general-purpose flags), not offset 8
    // as in the local header. Getting this swapped is exactly the kind of bug that silently
    // produces a technically-parseable ZIP that most tools tolerate but Excel's own reader does not.
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 8, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, compressedSize, true); cv.setUint32(24, uncompressedSize, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressedData.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  centralParts.forEach((p) => { centralSize += p.length; });
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, centralStart, true);
  const allParts = [...localParts, ...centralParts, eocd];
  let totalLen = 0;
  allParts.forEach((p) => { totalLen += p.length; });
  const out = new Uint8Array(totalLen);
  let pos = 0;
  allParts.forEach((p) => { out.set(p, pos); pos += p.length; });
  return out;
}
function xlsxXmlEscape(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function xlsxColLetter(n) {
  let s = ""; n = n + 1;
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
async function buildXlsxBytes(rows, columns, connectionUrl) {
  const headers = columns ?? Object.keys(rows[0] ?? {});
  const widths = headers.map((h) => {
    let maxLen = String(h).length;
    rows.forEach((r) => {
      const raw=r[h],value=raw&&typeof raw==='object'&&Object.hasOwn(raw,'value')?raw.value:raw;
      const val=value==null?'':h==='Waste'&&Number.isFinite(Number(value))?`${Math.round(Number(value)*100)}%`:String(value);
      if (val.length > maxLen) maxLen = val.length;
    });
    return Math.min(Math.max(maxLen + 2, 8), 60);
  });
  const colsXml = headers.map((_, i) => `<col width="${widths[i]}" customWidth="1" min="${i + 1}" max="${i + 1}"/>`).join("");
  function isNumeric(v) { return v !== "" && v != null && !isNaN(Number(v)) && String(v).trim() !== ""; }
  function cellXml(cellRef, raw, style = 0) {
    const styleAttr=style?` s="${style}"`:'';
    if(raw&&typeof raw==='object'&&typeof raw.formula==='string')return `<c r="${cellRef}"${styleAttr}><f>${xlsxXmlEscape(raw.formula)}</f>${raw.value===''?'':`<v>${Number(raw.value)}</v>`}</c>`;
    if ((typeof raw==='number'&&Number.isFinite(raw))||(!connectionUrl && isNumeric(raw))) return `<c r="${cellRef}" t="n"${styleAttr}><v>${Number(raw)}</v></c>`;
    const val = raw == null ? "" : String(raw);
    if (val === "") return `<c r="${cellRef}" t="inlineStr"${styleAttr}></c>`;
    return `<c r="${cellRef}" t="inlineStr"${styleAttr}><is><t>${xlsxXmlEscape(val)}</t></is></c>`;
  }
  const cnc=Boolean(connectionUrl),styleFor=(header,column)=>header?1:(column===5||column===7?4:column===8?5:0);
  const headerRow = `<row r="1" ht="30" customHeight="1">${headers.map((h, i) => cellXml(`${xlsxColLetter(i)}1`, h,cnc?styleFor(true,i):0)).join("")}</row>`;
  const dataRows = rows.map((r, rIdx) => {
    const rowNum = rIdx + 2;
    const cells = headers.map((h, cIdx) => cellXml(`${xlsxColLetter(cIdx)}${rowNum}`, r[h],cnc?styleFor(false,cIdx):0)).join("");
    return `<row r="${rowNum}">${cells}</row>`;
  }).join("");
  const lastCol = xlsxColLetter(Math.max(0, headers.length - 1));
  const lastRow = rows.length + 1;
  const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="1" summaryRight="1"/><pageSetUpPr/></sheetPr><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0">${cnc?'<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>':'<selection activeCell="A1" sqref="A1"/>'}</sheetView></sheetViews><sheetFormatPr baseColWidth="8" defaultRowHeight="15"/>${headers.length ? `<cols>${colsXml}</cols>` : ""}<sheetData>${headerRow}${dataRows}</sheetData><pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/></worksheet>`;

  const workbookXml = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>`;

  const workbookRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`;

  const rootRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

  const contentTypes = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

  const fontName=cnc?'Segoe UI':'Calibri',fontSize=cnc?'10':'11',bodyAlignment=cnc?' applyAlignment="1"':'',bodyAlignmentXml=cnc?'<alignment horizontal="center" vertical="center"/>':'';
  const stylesXml = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="${fontSize}"/><color theme="1"/><name val="${fontName}"/><family val="2"/></font><font><b/><sz val="${fontSize}"/><color rgb="FFFFFFFF"/><name val="${fontName}"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF155E75"/><bgColor rgb="FF155E75"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right style="thick"><color rgb="FF000000"/></right><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"${bodyAlignment}>${bodyAlignmentXml}</xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"${bodyAlignment}>${bodyAlignmentXml}</xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"${bodyAlignment}>${bodyAlignmentXml}</xf><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"${bodyAlignment}>${bodyAlignmentXml}</xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const coreXml = `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>PanelStock</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`;

  const appXml = `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PanelStock</Application></Properties>`;

  const themeXml = "<?xml version=\"1.0\"?><a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office Theme\"><a:themeElements><a:clrScheme name=\"Office\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"1F497D\"/></a:dk2><a:lt2><a:srgbClr val=\"EEECE1\"/></a:lt2><a:accent1><a:srgbClr val=\"4F81BD\"/></a:accent1><a:accent2><a:srgbClr val=\"C0504D\"/></a:accent2><a:accent3><a:srgbClr val=\"9BBB59\"/></a:accent3><a:accent4><a:srgbClr val=\"8064A2\"/></a:accent4><a:accent5><a:srgbClr val=\"4BACC6\"/></a:accent5><a:accent6><a:srgbClr val=\"F79646\"/></a:accent6><a:hlink><a:srgbClr val=\"0000FF\"/></a:hlink><a:folHlink><a:srgbClr val=\"800080\"/></a:folHlink></a:clrScheme><a:fontScheme name=\"Office\"><a:majorFont><a:latin typeface=\"Cambria\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"&#xFF2D;&#xFF33; &#xFF30;&#x30B4;&#x30B7;&#x30C3;&#x30AF;\"/><a:font script=\"Hang\" typeface=\"&#xB9D1;&#xC740; &#xACE0;&#xB515;\"/><a:font script=\"Hans\" typeface=\"&#x5B8B;&#x4F53;\"/><a:font script=\"Hant\" typeface=\"&#x65B0;&#x7D30;&#x660E;&#x9AD4;\"/><a:font script=\"Arab\" typeface=\"Times New Roman\"/><a:font script=\"Hebr\" typeface=\"Times New Roman\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"MoolBoran\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Times New Roman\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/></a:majorFont><a:minorFont><a:latin typeface=\"Calibri\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"&#xFF2D;&#xFF33; &#xFF30;&#x30B4;&#x30B7;&#x30C3;&#x30AF;\"/><a:font script=\"Hang\" typeface=\"&#xB9D1;&#xC740; &#xACE0;&#xB515;\"/><a:font script=\"Hans\" typeface=\"&#x5B8B;&#x4F53;\"/><a:font script=\"Hant\" typeface=\"&#x65B0;&#x7D30;&#x660E;&#x9AD4;\"/><a:font script=\"Arab\" typeface=\"Arial\"/><a:font script=\"Hebr\" typeface=\"Arial\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"DaunPenh\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Arial\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/></a:minorFont></a:fontScheme><a:fmtScheme name=\"Office\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"50000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"35000\"><a:schemeClr val=\"phClr\"><a:tint val=\"37000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:tint val=\"15000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"1\"/></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:shade val=\"51000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs><a:gs pos=\"80000\"><a:schemeClr val=\"phClr\"><a:shade val=\"93000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"94000\"/><a:satMod val=\"135000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"0\"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w=\"9525\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"><a:shade val=\"95000\"/><a:satMod val=\"105000\"/></a:schemeClr></a:solidFill><a:prstDash val=\"solid\"/></a:ln><a:ln w=\"25400\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln><a:ln w=\"38100\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"20000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"38000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"23000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"35000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"23000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"35000\"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d><a:camera prst=\"orthographicFront\"><a:rot lat=\"0\" lon=\"0\" rev=\"0\"/></a:camera><a:lightRig rig=\"threePt\" dir=\"t\"><a:rot lat=\"0\" lon=\"0\" rev=\"1200000\"/></a:lightRig></a:scene3d><a:sp3d><a:bevelT w=\"63500\" h=\"25400\"/></a:sp3d></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"40000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs><a:gs pos=\"40000\"><a:schemeClr val=\"phClr\"><a:tint val=\"45000\"/><a:shade val=\"99000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"20000\"/><a:satMod val=\"255000\"/></a:schemeClr></a:gs></a:gsLst><a:path path=\"circle\"><a:fillToRect l=\"50000\" t=\"-80000\" r=\"50000\" b=\"180000\"/></a:path></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"80000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"30000\"/><a:satMod val=\"200000\"/></a:schemeClr></a:gs></a:gsLst><a:path path=\"circle\"><a:fillToRect l=\"50000\" t=\"50000\" r=\"50000\" b=\"50000\"/></a:path></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>";

  const files = [
    { name: "[Content_Types].xml", data: strToBytes(contentTypes) },
    { name: "_rels/.rels", data: strToBytes(rootRels) },
    { name: "docProps/core.xml", data: strToBytes(coreXml) },
    { name: "docProps/app.xml", data: strToBytes(appXml) },
    { name: "xl/workbook.xml", data: strToBytes(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: strToBytes(workbookRels) },
    { name: "xl/styles.xml", data: strToBytes(stylesXml) },
    { name: "xl/theme/theme1.xml", data: strToBytes(themeXml) },
    { name: "xl/worksheets/sheet1.xml", data: strToBytes(sheetXml) },
  ];
  if (connectionUrl) connectCncWorkbook(files, headers, rows.length, connectionUrl);
  return await buildZip(files);
}


// Formats an ISO timestamp in PanelStock's business timezone, matching the client apps.
function splitDateTimeForExport(iso, timeZone = "Australia/Brisbane") {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d).forEach(({ type, value }) => { parts[type] = value; });
  return {
    date: `${parts.day}/${parts.month}/${parts.year}`,
    time: `${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`,
  };
}

// Live, browser-viewable CNC tracker dashboard. Ships as a static shell with an empty table body;
// all data comes from client-side JS polling /cnc-tracker/data, so the same open tab keeps showing
// fresh results without anyone needing to reload or re-share a link.


// ---------- Username + PIN login ----------

function normalizeUsername(u) {
  return String(u || "").toLowerCase().trim();
}


const fmtDim = (w, h) => `${w} \u00d7 ${h}`;
// Always reserves `gap` spaces of separation from the next column, even when truncating long
// content — matches the client app's pad() (see PanelStock web app for the full rationale).
function pad(str, len, gap = 2) {
  const usableLen = Math.max(1, len - gap);
  return String(str).slice(0, usableLen).padEnd(len, " ");
}

function groupByMaterialLargestFirst(items) {
  const groups = {};
  const displayNames = {};
  items.forEach((it) => {
    const raw = (it.material || "Unspecified").trim();
    const key = raw.toLowerCase();
    if (!groups[key]) { groups[key] = []; displayNames[key] = raw; }
    groups[key].push(it);
  });
  return Object.keys(groups)
    .sort((a, b) => displayNames[a].localeCompare(displayNames[b]))
    .map((key) => ({
      material: displayNames[key],
      items: groups[key].slice().sort((a, b) => b.width * b.height - a.width * a.height),
    }));
}

function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildCsv(variants, offcuts) {
  const rows = [
    ...variants.map((v) => ({
      SKU: v.sku, Type: "Panel", Colour: v.color, Material: v.material,
      "Thickness (mm)": v.thickness, "Width (mm)": v.width, "Height (mm)": v.height, "Qty (SOH)": v.qty,
    })),
    ...offcuts.map((o) => ({
      SKU: o.sku, Type: "Off-cut", Colour: o.color, Material: o.material,
      "Thickness (mm)": o.thickness, "Width (mm)": o.width, "Height (mm)": o.height, "Qty (SOH)": o.qty,
    })),
  ];
  if (!rows.length) return "SKU,Type,Colour,Material,Thickness (mm),Width (mm),Height (mm),Qty (SOH)\n";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

function buildEmailHtml(data, generatedAtStr) {
  const { variants = [], offcuts = [] } = data;
  const totalSOH = variants.reduce((s, v) => s + v.qty, 0) + offcuts.reduce((s, o) => s + o.qty, 0);
  const lowStock = variants.filter((v) => v.reorderPoint > 0 && v.qty <= v.reorderPoint);

  const style = {
    body: "font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f4;padding:24px;color:#1c1917;",
    card: "background:#fff;border-radius:12px;padding:24px;max-width:640px;margin:0 auto;",
    h1: "font-size:20px;margin:0 0 4px;color:#0f172a;",
    sub: "font-size:13px;color:#78716c;margin:0 0 20px;",
    lowBox: "background:#fffbeb;border:1px solid #f59e0b55;border-radius:8px;padding:12px 14px;margin-bottom:20px;font-size:13px;color:#92400e;",
    groupTitle: "font-size:14px;font-weight:700;color:#155e75;margin:18px 0 6px;",
    table: "width:100%;border-collapse:collapse;font-size:12px;",
    th: "text-align:left;padding:4px 8px;border-bottom:1px solid #e7e5e4;color:#78716c;font-weight:600;",
    td: "padding:4px 8px;border-bottom:1px solid #f5f5f4;",
  };

  let html = `<div style="${style.body}"><div style="${style.card}">`;
  html += `<h1 style="${style.h1}">PanelStock — SOH</h1>`;
  html += `<p style="${style.sub}">Generated ${escapeHtml(generatedAtStr)} &middot; Total units: ${totalSOH}</p>`;

  if (lowStock.length) {
    html += `<div style="${style.lowBox}">&#9888; ${lowStock.length} item${lowStock.length > 1 ? "s" : ""} at or below reorder point: `;
    html += lowStock.map((v) => `${escapeHtml(v.color)} ${escapeHtml(v.material)} ${v.thickness}mm (${v.qty} left)`).join(", ");
    html += `</div>`;
  }

  groupByMaterialLargestFirst(variants).forEach(({ material, items }) => {
    html += `<div style="${style.groupTitle}">${escapeHtml(material)}</div>`;
    html += `<table style="${style.table}"><tr><th style="${style.th}">SKU</th><th style="${style.th}">Colour</th><th style="${style.th}">Thickness</th><th style="${style.th}">Dimensions</th><th style="${style.th}">Qty</th></tr>`;
    items.forEach((v) => {
      html += `<tr><td style="${style.td}">${escapeHtml(v.sku)}</td><td style="${style.td}">${escapeHtml(v.color)}</td><td style="${style.td}">${v.thickness}mm</td><td style="${style.td}">${fmtDim(v.width, v.height)}mm</td><td style="${style.td}">${v.qty}</td></tr>`;
    });
    html += `</table>`;
  });

  if (offcuts.length) {
    html += `<div style="${style.groupTitle}">Off-cuts</div>`;
    groupByMaterialLargestFirst(offcuts).forEach(({ material, items }) => {
      html += `<table style="${style.table}"><tr><th style="${style.th}">SKU</th><th style="${style.th}">Colour</th><th style="${style.th}">Material</th><th style="${style.th}">Dimensions</th><th style="${style.th}">Qty</th></tr>`;
      items.forEach((o) => {
        html += `<tr><td style="${style.td}">${escapeHtml(o.sku)}</td><td style="${style.td}">${escapeHtml(o.color)}</td><td style="${style.td}">${escapeHtml(material)}</td><td style="${style.td}">${fmtDim(o.width, o.height)}mm</td><td style="${style.td}">${o.qty}</td></tr>`;
      });
      html += `</table>`;
    });
  }

  html += `<p style="font-size:11px;color:#a8a29e;margin-top:24px;">Full spreadsheet attached as CSV.</p>`;
  html += `</div></div>`;
  return html;
}

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---------- Minimal text-only PDF writer (same technique as the app's PDF export) ----------
function pdfSafe(str) {
  return String(str ?? "").replace(/\u00d7/g, "x").replace(/[\u2013\u2014]/g, "-").replace(/[^\x00-\xFF]/g, "?");
}
function escapePdfText(str) {
  return pdfSafe(str).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function latin1Encode(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}
function buildPdfBytes(lineGroups) {
  const pageWidth = 792, pageHeight = 612, margin = 40, leading = 13;
  const usableLines = Math.floor((pageHeight - margin * 2) / leading) - 1;

  const pages = [];
  let current = [];
  lineGroups.forEach((entry) => {
    current.push(entry);
    if (current.length >= usableLines) { pages.push(current); current = []; }
  });
  if (current.length || pages.length === 0) pages.push(current);

  const fontObjNum = 3;
  const pageObjNums = pages.map((_, i) => 4 + i * 2);
  const contentObjNums = pages.map((_, i) => 5 + i * 2);
  const maxObj = 3 + pages.length * 2;

  const objStrings = {};
  objStrings[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objStrings[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`;
  objStrings[3] = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`;

  pages.forEach((pageLines, i) => {
    const pageNum = pageObjNums[i];
    const contentNum = contentObjNums[i];
    let y = pageHeight - margin;
    let stream = "";
    pageLines.forEach(({ text, size, shaded }) => {
      const fs = size || 9;
      if (shaded) {
        const rectHeight = leading;
        const rectY = y - leading * 0.25;
        stream += `0.93 0.93 0.93 rg\n${margin - 4} ${rectY} ${pageWidth - 2 * margin + 8} ${rectHeight} re f\n0 0 0 rg\n`;
      }
      stream += `BT /F1 ${fs} Tf ${margin} ${y} Td (${escapePdfText(text)}) Tj ET\n`;
      y -= leading;
    });
    objStrings[contentNum] = `${contentNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`;
    objStrings[pageNum] = `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentNum} 0 R >>\nendobj\n`;
  });

  const header = "%PDF-1.4\n";
  let out = header;
  const offsets = new Array(maxObj + 1).fill(0);
  for (let n = 1; n <= maxObj; n++) { offsets[n] = out.length; out += objStrings[n]; }
  const xrefStart = out.length;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n++) xref += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
  out += xref;
  out += `trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return latin1Encode(out);
}
function buildSOHPdf(variants, offcuts, totalSOH) {
  const L = [];
  L.push({ text: "PanelStock - SOH", size: 18 });
  L.push({ text: `Generated ${new Date().toLocaleString()}  -  Total units: ${totalSOH}`, size: 10 });
  L.push({ text: "", size: 10 });
  L.push({ text: "FULL PANELS", size: 13 });
  let rowIdx = 0;
  groupByMaterialLargestFirst(variants).forEach(({ material, items }) => {
    L.push({ text: "", size: 8 });
    L.push({ text: material, size: 16 });
    L.push({ text: pad("SKU", 22) + pad("Colour", 34) + pad("Thk", 11) + pad("Dimensions", 24) + "Qty", size: 12 });
    items.forEach((v) => {
      L.push({ text: pad(v.sku, 22) + pad(v.color, 34) + pad(v.thickness + "mm", 11) + pad(fmtDim(v.width, v.height), 24) + v.qty, size: 12, shaded: rowIdx % 2 === 1 });
      rowIdx++;
    });
  });
  if (offcuts.length) {
    L.push({ text: "", size: 10 });
    L.push({ text: "OFF-CUTS", size: 13 });
    rowIdx = 0;
    groupByMaterialLargestFirst(offcuts).forEach(({ material, items }) => {
      L.push({ text: "", size: 8 });
      L.push({ text: material, size: 16 });
      L.push({ text: pad("SKU", 22) + pad("Colour", 34) + pad("Thk", 11) + pad("Dimensions", 24) + "Qty", size: 12 });
      items.forEach((o) => {
        L.push({ text: pad(o.sku, 22) + pad(o.color, 34) + pad(o.thickness + "mm", 11) + pad(fmtDim(o.width, o.height), 24) + o.qty, size: 12, shaded: rowIdx % 2 === 1 });
        rowIdx++;
      });
    });
  }
  return buildPdfBytes(L);
}

async function sendReport(env, config, data, idempotencyKey) {
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const variants = data.variants || [];
  const offcuts = data.offcuts || [];
  const totalSOH = variants.reduce((s, v) => s + v.qty, 0) + offcuts.reduce((s, o) => s + o.qty, 0);
  const html = buildEmailHtml(data, now.toLocaleString());
  const csv = buildCsv(variants, offcuts);
  const pdfBytes = buildSOHPdf(variants, offcuts, totalSOH);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      ...(idempotencyKey ? {"Idempotency-Key": idempotencyKey} : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL, // e.g. "PanelStock Reports <reports@yourdomain.com>"
      to: config.recipients,
      subject: `SOH Report — ${dateStr}`,
      html,
      attachments: [
        { filename: `SOH_${dateStr.replace(/\//g, "-")}.csv`, content: base64Encode(csv) },
        { filename: `SOH_${dateStr.replace(/\//g, "-")}.pdf`, content: bytesToBase64(pdfBytes) },
      ],
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// Determine current local date/time parts in a given IANA timezone.
function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const parts = {};
  fmt.formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    dayOfWeek: weekdayMap[parts.weekday],
  };
}


export {sendReport,localParts,buildZip,buildXlsxBytes,buildCncTrackerHtml,splitDateTimeForExport};
