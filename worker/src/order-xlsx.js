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
  const pattern=new RegExp(`<c r="${ref}"([^>/]*)>(?:[\\s\\S]*?)<\\/c>|<c r="${ref}"([^>/]*)\\/>`);
  return source.replace(pattern,(_,openAttrs,emptyAttrs)=>{
    const attrs=(openAttrs??emptyAttrs??'').replace(/\s+t="[^"]*"/g,'');
    if(type==='number')return `<c r="${ref}"${attrs}><v>${Number(value)||0}</v></c>`;
    if(type==='boolean')return `<c r="${ref}"${attrs} t="b"><v>${value?1:0}</v></c>`;
    return `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  });
}
export async function buildOrderXlsx(order,templateBytes){
  const files=await unzip(new Uint8Array(templateBytes));
  const pages=Math.max(1,Math.ceil((order.items?.length||0)/30));
  const shared=files.find(file=>file.name==='xl/sharedStrings.xml');
  shared.data=encoder.encode(replaceSharedStrings(decoder.decode(shared.data),{
    ORDER_NUMBER:order.orderNumber,PAGE_COUNT:pages,PROJECT:order.project,DATE_ORDERED:date(order.dateOrdered||order.createdAt),
    SITE_CONTACT:order.siteContact,PHONE:order.phone,ORDER_TYPE:order.orderType,REQUESTED_DATE:date(order.requestedDeliveryDate),
    REQUESTED_TIME:order.requestedDeliveryTime,SCHEDULED_DATE:date(order.scheduledDeliveryDate),SCHEDULED_TIME:order.scheduledDeliveryTime,
    LOCATION_NOTES:order.locationNotes,ITEM_NUMBER:1,QUANTITY:'',DESCRIPTION:'',ON_TRUCK:'',RECEIVED:'',BACK_ORDER:''
  }));
  const sheet=files.find(file=>file.name==='xl/worksheets/sheet1.xml');let source=decoder.decode(sheet.data);
  for(let index=0;index<30;index++){
    const row=index+18,item=order.items?.[index];
    source=setCell(source,`A${row}`,index+1,'number');
    source=setCell(source,`B${row}`,item?.quantity??'',item?'number':'text');
    source=setCell(source,`C${row}`,item?.description??'','text');
    source=setCell(source,`K${row}`,false,'boolean');
    source=setCell(source,`L${row}`,'','text');source=setCell(source,`M${row}`,'','text');
  }
  sheet.data=encoder.encode(source);
  return buildZip(files);
}
