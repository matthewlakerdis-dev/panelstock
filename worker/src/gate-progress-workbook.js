import {gateProgressWorkbookParts,gateProgressRows,GATE_PROGRESS_HEADERS} from './gate-progress-excel.js';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));

// Append to the existing workbook so every established worksheet/query keeps its IDs.
export function appendGateProgressWorksheet(files,orders,url){
 const encode=text=>new TextEncoder().encode(text),decode=data=>new TextDecoder().decode(data);
 const read=name=>decode(files.find(file=>file.name===name).data);
 const write=(name,text)=>{const file=files.find(file=>file.name===name);if(file)file.data=encode(text);else files.push({name,data:encode(text)});};
 const parts=gateProgressWorkbookParts(orders),source=parts['xl/styles.xml'];let styles=read('xl/styles.xml');
 const section=(text,name)=>text.match(new RegExp('<'+name+' count="(\\d+)">([\\s\\S]*?)</'+name+'>'));
 const fontOffset=Number(section(styles,'fonts')[1]),fillOffset=Number(section(styles,'fills')[1]),styleOffset=Number(section(styles,'cellXfs')[1]);
 const formatIds=[...styles.matchAll(/numFmtId="(\d+)"/g)].map(match=>Number(match[1])),dateFormat=Math.max(163,...formatIds)+1;
 const append=(name,contents,count)=>{const current=section(styles,name);styles=styles.replace(current[0],`<${name} count="${Number(current[1])+count}">${current[2]}${contents}</${name}>`);};
 for(const name of ['fonts','fills']){const extra=section(source,name);append(name,extra[2],Number(extra[1]));}
 const xfs=section(source,'cellXfs');
 append('cellXfs',xfs[2].replace(/fontId="(\d+)"/g,(_,id)=>`fontId="${Number(id)+fontOffset}"`).replace(/fillId="(\d+)"/g,(_,id)=>`fillId="${Number(id)+fillOffset}"`).replace(/numFmtId="164"/g,`numFmtId="${dateFormat}"`),Number(xfs[1]));
 append('numFmts',`<numFmt numFmtId="${dateFormat}" formatCode="dd/mm/yyyy hh:mm"/>`,1);
 write('xl/styles.xml',styles);
 write('xl/worksheets/sheet7.xml',parts['xl/worksheets/sheet1.xml'].replace(/ s="(\d+)"/g,(_,id)=>` s="${Number(id)+styleOffset}"`));
 const last=Math.max(2,gateProgressRows(orders).length+1),feed=new URL(url);feed.searchParams.set('report','gate-progress');feed.searchParams.set('gateProgressVersion','2');
 const definedName=`<definedName name="Gate_Progress" localSheetId="6">'Gate Progress'!$A$2:$P$${last}</definedName>`;
 write('xl/workbook.xml',read('xl/workbook.xml').replace('</sheets>','<sheet name="Gate Progress" sheetId="7" r:id="rId10"/></sheets>').replace('</definedNames>',definedName+'</definedNames>'));
 write('xl/_rels/workbook.xml.rels',read('xl/_rels/workbook.xml.rels').replace('</Relationships>',`<Relationship Id="rId10" Type="${rel}/worksheet" Target="worksheets/sheet7.xml"/></Relationships>`));
 write('xl/connections.xml',read('xl/connections.xml').replace('</connections>',`<connection id="7" name="PanelStock Gate Progress live" description="Read-only gate component progress from PanelStock." type="4" refreshedVersion="8" refreshOnLoad="1" interval="15" saveData="1"><webPr xl2000="1" url="${xml(feed.href)}" htmlTables="1" htmlFormat="all"/></connection></connections>`));
 write('xl/worksheets/_rels/sheet7.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/queryTable" Target="../queryTables/queryTable7.xml"/><Relationship Id="rIdBrand" Type="${rel}/drawing" Target="../drawings/gateProgressBrand.xml"/></Relationships>`);
 write('xl/drawings/gateProgressBrand.xml',parts['xl/drawings/gateProgressBrand.xml']);
 write('xl/drawings/_rels/gateProgressBrand.xml.rels',parts['xl/drawings/_rels/gateProgressBrand.xml.rels']);
 write('xl/queryTables/queryTable7.xml',`<queryTable xmlns="${ns}" name="Gate_Progress" headers="0" backgroundRefresh="1" refreshOnLoad="1" connectionId="7" preserveFormatting="1" adjustColumnWidth="0" growShrinkType="insertDelete" applyNumberFormats="1" applyBorderFormats="0" applyFontFormats="1" applyPatternFormats="1" applyAlignmentFormats="0" applyWidthHeightFormats="0"/>`);
 write('[Content_Types].xml',read('[Content_Types].xml').replace('</Types>','<Override PartName="/xl/worksheets/sheet7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/queryTables/queryTable7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/><Override PartName="/xl/drawings/gateProgressBrand.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
}

export function buildGateProgressFeed(orders,options){
 const rows=gateProgressRows(orders,options),dates=new Set([12,13,14]);
 const body=(rows.length?rows:[{kind:'empty',values:Array(GATE_PROGRESS_HEADERS.length).fill(''),stages:[]}]).map(row=>'<tr height="24" style="height:18pt;mso-height-source:userset">'+row.values.map((value,index)=>{
  const stage=index>=5&&index<11?row.stages[index-5]:null,date=dates.has(index)&&value?new Date(value):null,number=date&&Number.isFinite(date.getTime())?(date.getTime()+10*3600000-Date.UTC(1899,11,30))/86400000:typeof value==='number'?value:null;
  const fill=stage?stage.state==='complete'?'#8ce28c':stage.state==='rework'?'#ffc7ce':'#ffff99':row.kind==='villa'?'#e2e8f0':row.kind==='order'?'#ddebf7':row.kind==='set'?'#f2f5f7':'#ffffff';
  const format=date?'dd/mm/yyyy hh:mm':index===15&&number!==null?'0.00':number!==null?'0':'\\@',text=date&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'short',timeStyle:'short',hour12:false}).format(date):number===null?value:number.toFixed(index===15?2:0);
  return `<td ${number!==null?`x:num="${number}"`:'x:str'} bgcolor="${fill}" style='font-family:Segoe UI;font-size:10pt;text-align:${stage?'center':'left'};vertical-align:middle;white-space:nowrap;background-color:${fill};font-weight:${['villa','order'].includes(row.kind)?'bold':'normal'};mso-number-format:"${format}"'>${xml(text)}</td>`;
 }).join('')+'</tr>').join('');
 return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>Gate Progress</title></head><body><table id="gate-progress-data"><tbody>${body}</tbody></table></body></html>`;
}
