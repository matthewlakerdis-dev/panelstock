import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {toolboxPdfAssets} from './toolbox-pdf-assets.js';
import {reportDate} from './active-orders-report-pdf.js';

const dayFormat = new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const monthFormat = new Intl.DateTimeFormat('en-AU',{month:'long',year:'numeric',timeZone:'UTC'});
const areaFormat = new Intl.NumberFormat('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});

function displayPeriod(value, period) {
  const [day, month, year] = value.split('/').map(Number);
  const date = new Date(Date.UTC(year,month-1,day));
  return (period === 'monthly' ? monthFormat : dayFormat).format(date);
}

function displayBound(value, period) {
  if (period === 'weekly') {
    const [year,week] = value.split('-W');
    return `Week ${Number(week)}, ${year}`;
  }
  const date = new Date(value + (period === 'monthly' ? '-01' : '') + 'T00:00:00Z');
  return (period === 'monthly' ? monthFormat : dayFormat).format(date);
}

export async function createProductionAreaPdf({columns, data, product, period, from, to}) {
  const doc = await PDFDocument.create();
  const assets = toolboxPdfAssets();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(assets.font,{subset:true});
  const logo = await doc.embedJpg(assets.logo);
  const teal = rgb(.08,.37,.44), ink = rgb(.13,.20,.24), muted = rgb(.37,.44,.48);
  const pale = rgb(.96,.98,.98), totalFill = rgb(.89,.95,.96), totalHeader = rgb(.06,.29,.34), rule = rgb(.80,.85,.88), white = rgb(1,1,1);
  const left = 34, right = 808, width = right-left, rowHeight = 27;
  const periodWidth = width*(columns.length === 2 ? .55 : .34);
  const areaWidth = (width-periodWidth)/(columns.length-1);
  const totalIndex = columns.indexOf('Total area (m²)');
  const columnLeft = index => index === 0 ? left : left+periodWidth+(index-1)*areaWidth;
  const grouping = {daily:'Daily', weekly:'Weekly', monthly:'Monthly'}[period];
  const products = {all:'Panels and gates', panels:'Panels only', gates:'Gates only'};
  const generatedAt = new Date();
  const first = from && displayBound(from,period);
  const last = to && displayBound(to,period);
  const range = first && last ? (first === last ? first : `${first} – ${last}`)
    : first ? 'From '+first : last ? 'Through '+last : 'All periods';
  let page, y;
  const draw = (text,x,baseline,size,color=ink) => page.drawText(text,{x,y:baseline,size,color,font});
  function drawCell(label,index,baseline,size,color) {
    const x = index === 0 ? left+12 : columnLeft(index)+areaWidth-12-font.widthOfTextAtSize(label,size);
    draw(label,x,baseline,size,color);
  }
  function newPage() {
    page = doc.addPage([842,595]);
    page.drawRectangle({x:0,y:591,width:842,height:4,color:teal});
    page.drawImage(logo,{x:left,y:520,width:125,height:125*logo.height/logo.width});
    draw('PRODUCTION m²',192,545,18,teal);
    draw('Generated '+reportDate(generatedAt.toISOString(),{time:true}),192,521,8,muted);
    page.drawLine({start:{x:left,y:504},end:{x:right,y:504},thickness:1,color:rule});
    draw(range,left,480,14,ink);
    draw(grouping+' · '+products[product],left,463,9,muted);
    page.drawRectangle({x:left,y:425,width,height:26,color:teal});
    if (totalIndex >= 0) page.drawRectangle({x:columnLeft(totalIndex),y:425,width:areaWidth,height:26,color:totalHeader});
    columns.forEach((column,i)=>drawCell(period === 'monthly' && i === 0 ? 'Month' : column,i,434,9,white));
    y=425;
  }
  newPage();
  if (!data.length) {
    page.drawRectangle({x:left,y:y-36,width,height:36,color:pale});
    draw('No production matches these filters.',left+12,y-23,10,muted);
  }
  data.forEach((row,index)=>{
    if (y-rowHeight<44) newPage();
    if (index%2===1) page.drawRectangle({x:left,y:y-rowHeight,width,height:rowHeight,color:pale});
    if (totalIndex >= 0) page.drawRectangle({x:columnLeft(totalIndex),y:y-rowHeight,width:areaWidth,height:rowHeight,color:totalFill});
    columns.forEach((column,i)=>{
      const label = i === 0 ? displayPeriod(row[column],period) : areaFormat.format(row[column]);
      drawCell(label,i,y-17,i === totalIndex ? 11 : 10,i === totalIndex ? totalHeader : ink);
    });
    y-=rowHeight;
    page.drawLine({start:{x:left,y},end:{x:right,y},thickness:.4,color:rule});
  });
  const pages = doc.getPages();
  pages.forEach((p,index)=>{
    page=p;
    page.drawLine({start:{x:left,y:32},end:{x:right,y:32},thickness:.5,color:rule});
    draw('Lennox Facades · PanelStock · Production m²',left,19,8,muted);
    const label = `Page ${index+1} of ${pages.length}`;
    draw(label,right-font.widthOfTextAtSize(label,8),19,8,muted);
  });
  doc.setTitle('Lennox Facades — Production m²');
  doc.setAuthor('Lennox Facades');
  doc.setCreator('PanelStock');
  doc.setCreationDate(generatedAt);
  return doc.save();
}
