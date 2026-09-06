import {buildZip} from './reports.js';

const decoder=new TextDecoder(),encoder=new TextEncoder();
const xml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const date=value=>{
  if(!value)return '';
  const parsed=new Date(String(value).length===10?value+'T00:00:00':value);
  return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat('en-AU',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Australia/Brisbane'}).format(parsed);
};
async function inflate(bytes){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));return new Uint8Array(await new Response(stream).arrayBuffer());}
async function unzip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=bytes.length-22;
  while(eocd>=0&&view.getUint32(eocd,true)!==0x06054b50)eocd--;
  if(eocd<0)throw Error('Order template is not a valid workbook');
  const count=view.getUint16(eocd+10,true),files=[];let offset=view.getUint32(eocd+16,true);
  for(let i=0;i<count;i++){
    if(view.getUint32(offset,true)!==0x02014b50)throw Error('Order template directory is invalid');
    const method=view.getUint16(offset+10,true),size=view.getUint32(offset+20,true),nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),localOffset=view.getUint32(offset+42,true);
    const name=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength));
    const localNameLength=view.getUint16(localOffset+26,true),localExtraLength=view.getUint16(localOffset+28,true),start=localOffset+30+localNameLength+localExtraLength;
    const packed=bytes.subarray(start,start+size),data=method===8?await inflate(packed):method===0?packed:null;
    if(!data)throw Error('Order template uses unsupported compression');
    files.push({name,data});offset+=46+nameLength+extraLength+commentLength;
  }
  return files;
}
function replaceSharedStrings(source,values){
  let out=source;
  Object.entries(values).forEach(([key,value])=>{out=out.replace(`{{${key}}}`,xml(value));});
  return out;
}
function setCell(source,ref,value,type='text'){
  const prefix=source.match(/<([A-Za-z_][\w.-]*:)worksheet\b/)?.[1]||'';
  const pattern=new RegExp(`<${prefix}c r="${ref}"([^>/]*)>(?:[\\s\\S]*?)<\\/${prefix}c>|<${prefix}c r="${ref}"([^>/]*)\\/>`);
  return source.replace(pattern,(_,openAttrs,emptyAttrs)=>{
    const attrs=(openAttrs??emptyAttrs??'').replace(/\s+t="[^"]*"/g,'');
    if(type==='number')return `<${prefix}c r="${ref}"${attrs}><${prefix}v>${Number(value)||0}</${prefix}v></${prefix}c>`;
    if(type==='boolean')return `<${prefix}c r="${ref}"${attrs} t="b"><${prefix}v>${value?1:0}</${prefix}v></${prefix}c>`;
    return `<${prefix}c r="${ref}"${attrs} t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${xml(value)}</${prefix}t></${prefix}is></${prefix}c>`;
  });
}
function singlePagePrintSettings(source){
  const prefix=source.match(/<([A-Za-z_][\w.-]*:)worksheet\b/)?.[1]||'';
  const attributes=(tag,values,remove=[])=>{
    const names=[...Object.keys(values),...remove].join('|');
    return tag.replace(new RegExp(`\\s+(?:${names})\\s*=\\s*(?:"[^"]*"|'[^']*')`,'g'),'')
      .replace(/\s*(\/?>)$/,(_,end)=>Object.entries(values).map(([name,value])=>` ${name}="${value}"`).join('')+end);
  };
  const fitTag=`<${prefix}pageSetUpPr fitToPage="1"/>`;
  const fitPattern=new RegExp(`<${prefix}pageSetUpPr\\b[^>]*>`);
  const propertiesPattern=new RegExp(`<${prefix}sheetPr\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${prefix}sheetPr>)`);
  if(propertiesPattern.test(source))source=source.replace(propertiesPattern,properties=>{
    if(fitPattern.test(properties))return properties.replace(fitPattern,tag=>attributes(tag,{fitToPage:1}));
    if(properties.endsWith('/>'))return properties.slice(0,-2)+`>${fitTag}</${prefix}sheetPr>`;
    return properties.replace(`</${prefix}sheetPr>`,fitTag+`</${prefix}sheetPr>`);
  });
  else source=source.replace(new RegExp(`<${prefix}worksheet\\b[^>]*>`),'$&'+`<${prefix}sheetPr>${fitTag}</${prefix}sheetPr>`);
  const setup={paperSize:9,orientation:'portrait',fitToWidth:1,fitToHeight:1,usePrinterDefaults:0};
  const setupPattern=new RegExp(`<${prefix}pageSetup\\b[^>]*>`);
  if(setupPattern.test(source))return source.replace(setupPattern,tag=>attributes(tag,setup,['scale','paperWidth','paperHeight']));
  // SpreadsheetML requires pageSetup after pageMargins and before drawings/footers.
  const following='headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst';
  const anchor=new RegExp(`<${prefix}(?:${following})\\b|<\\/${prefix}worksheet>`);
  return source.replace(anchor,match=>attributes(`<${prefix}pageSetup/>`,setup)+match);
}
// Each continuation is a copy of the prepared, single-page order template.
// Keep its styles, merged cells and drawing/print relationships intact.
function addPages(files,pages,itemCount){
  const read=name=>{const file=files.find(f=>f.name===name);if(!file)throw Error('Order template is missing '+name);return decoder.decode(file.data);};
  const write=(name,value)=>{const file=files.find(f=>f.name===name);if(file)file.data=encoder.encode(value);else files.push({name,data:encoder.encode(value)});};
  let workbook=read('xl/workbook.xml'),rels=read('xl/_rels/workbook.xml.rels'),types=read('[Content_Types].xml');
  const sheets=[...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/>/g)];
  if(sheets.length!==1)throw Error('Use the prepared single-sheet order template');
  const firstSheetId=Number(sheets[0][0].match(/\bsheetId="(\d+)"/)?.[1])||1;
  const prefix=workbook.match(/<(\w+:)?workbook\b/)?.[1]||'';
  const sheetRel=files.find(f=>f.name==='xl/worksheets/_rels/sheet1.xml.rels');
  let source=singlePagePrintSettings(read('xl/worksheets/sheet1.xml'));
  // The prepared template's margin fits two digits; continuation numbers can reach 300.
  if(itemCount>=100)source=source.replace(/<(?:\w+:)?col\b[^>]*\/>/g,column=>{
    const min=Number(column.match(/\bmin="(\d+)"/)?.[1]),max=Number(column.match(/\bmax="(\d+)"/)?.[1]),width=Number(column.match(/\bwidth="([\d.]+)"/)?.[1]);
    if(min!==1||!max||!width||width>=4.5)return column;
    const widened=column.replace(/\bmax="\d+"/,'max="1"').replace(/\bwidth="[\d.]+"/,'width="4.5"');
    return widened+(max>1?column.replace(/\bmin="\d+"/,'min="2"'):'');
  });
  write('xl/worksheets/sheet1.xml',source);
  if(pages>1&&/<(?:\w+:)?(?:tableParts|pivotTableParts)\b/.test(source))throw Error('Order template cannot contain tables or pivot tables');
  let definitions='';
  for(let page=1;page<=pages;page++){
    const name=page===1?sheets[0][0].match(/\bname="([^"]*)"/)[1]:`Order page ${page}`;
    definitions+=`<${prefix}definedName name="_xlnm.Print_Area" localSheetId="${page-1}">'${name.replace(/'/g,"''")}'!$A$1:$N$50</${prefix}definedName>`;
    if(page===1)continue;
    const id=`panelstockPage${page}`;
    const continuation=sheets[0][0].replace(/\bname="[^"]*"/,`name="${name}"`).replace(/\bsheetId="[^"]*"/,`sheetId="${firstSheetId+page-1}"`).replace(/\b([\w.-]+):id="[^"]*"/,`$1:id="${id}"`);
    workbook=workbook.replace(`</${prefix}sheets>`,continuation+`</${prefix}sheets>`);
    rels=rels.replace(/<\/(\w+:)?Relationships>/,`<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${page}.xml"/>$&`);
    types=types.replace(/<\/(\w+:)?Types>/,`<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/xl/worksheets/sheet${page}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>$&`);
    write(`xl/worksheets/sheet${page}.xml`,source.replace(/tabSelected="1"/g,'tabSelected="0"'));
    if(sheetRel)write(`xl/worksheets/_rels/sheet${page}.xml.rels`,decoder.decode(sheetRel.data));
  }
  workbook=workbook.replace(/<(?:\w+:)?definedName\b[^>]*name="_xlnm.Print_Area"[^>]*>[\s\S]*?<\/(?:\w+:)?definedName>/g,'');
  if(workbook.includes(`</${prefix}definedNames>`))workbook=workbook.replace(`</${prefix}definedNames>`,definitions+`</${prefix}definedNames>`);
  else workbook=workbook.replace(`</${prefix}sheets>`,`</${prefix}sheets><${prefix}definedNames>${definitions}</${prefix}definedNames>`);
  write('xl/workbook.xml',workbook);write('xl/_rels/workbook.xml.rels',rels);write('[Content_Types].xml',types);
}
export async function buildOrderXlsx(order,templateBytes){
  const files=await unzip(new Uint8Array(templateBytes));
  const pages=Math.max(1,Math.ceil((order.items?.length||0)/30));
  if(pages>10)throw Error('Site orders support at most 300 items');
  const shared=files.find(file=>file.name==='xl/sharedStrings.xml');
  if(!shared||!decoder.decode(shared.data).includes('{{ORDER_NUMBER}}'))throw Error('Use the prepared order template with field placeholders');
  addPages(files,pages,order.items?.length||0);
  shared.data=encoder.encode(replaceSharedStrings(decoder.decode(shared.data),{
    ORDER_NUMBER:order.orderNumber,PAGE_COUNT:pages,PROJECT:order.project,DATE_ORDERED:date(order.dateOrdered||order.createdAt),
    SITE_CONTACT:order.siteContact,PHONE:order.phone,ORDER_TYPE:order.orderType,REQUESTED_DATE:date(order.requestedDeliveryDate),
    REQUESTED_TIME:order.requestedDeliveryTime,SCHEDULED_DATE:date(order.scheduledDeliveryDate),SCHEDULED_TIME:order.scheduledDeliveryTime,
    LOCATION_NOTES:order.locationNotes,ITEM_NUMBER:1,QUANTITY:'',DESCRIPTION:'',ON_TRUCK:'',RECEIVED:'',BACK_ORDER:''
  }));
  for(let page=0;page<pages;page++){
  const sheet=files.find(file=>file.name===`xl/worksheets/sheet${page+1}.xml`);let source=decoder.decode(sheet.data);
  for(let index=0;index<30;index++){
    const row=index+18,item=order.items?.[page*30+index];
    source=setCell(source,`A${row}`,item?page*30+index+1:'',item?'number':'text');
    source=setCell(source,`B${row}`,item?.quantity??'',item?'number':'text');
    source=setCell(source,`C${row}`,item?.description??'','text');
    source=setCell(source,`K${row}`,'','text');
    source=setCell(source,`L${row}`,'','text');source=setCell(source,`M${row}`,'','text');
  }
  sheet.data=encoder.encode(source);
  }
  return buildZip(files);
}
