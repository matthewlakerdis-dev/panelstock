import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {toolboxPdfAssets} from './toolbox-pdf-assets.js';
import {reportDate} from './active-orders-report-pdf.js';

export async function createProductionAreaPdf({columns, data, product, period, from, to}) {
  const doc = await PDFDocument.create();
  const assets = toolboxPdfAssets();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(assets.font,{subset:true});
  const logo = await doc.embedJpg(assets.logo);
  const teal = rgb(.08,.37,.44), ink = rgb(.13,.20,.24), muted = rgb(.37,.44,.48);
  const pale = rgb(.94,.97,.98), rule = rgb(.80,.85,.88), white = rgb(1,1,1);
  const left = 34, right = 808, width = right-left, rowHeight = 22;
  const columnWidth = width/columns.length;
  const grouping = {daily:'Daily', weekly:'Weekly', monthly:'Monthly'}[period];
  const products = {all:'Panels and gates', panels:'Panels only', gates:'Gates only'};
  const generatedAt = new Date();
  let page, y;
  const draw = (text,x,baseline,size,color=ink) => page.drawText(text,{x,y:baseline,size,color,font});
  function newPage() {
    page = doc.addPage([842,595]);
    page.drawRectangle({x:0,y:591,width:842,height:4,color:teal});
    page.drawImage(logo,{x:left,y:520,width:125,height:125*logo.height/logo.width});
    draw('PRODUCTION m²',192,545,18,teal);
    draw('Generated '+reportDate(generatedAt.toISOString(),{time:true}),192,521,8,muted);
    page.drawLine({start:{x:left,y:504},end:{x:right,y:504},thickness:1,color:rule});
    draw([grouping,products[product],from ? 'From '+from : '',to ? 'To '+to : '',!from&&!to ? 'All periods' : ''].filter(Boolean).join(' · '),left+6,483,9,muted);
    page.drawRectangle({x:left,y:444,width,height:23,color:teal});
    columns.forEach((column,i)=>draw(column,left+i*columnWidth+8,452,9,white));
    y=444;
  }
  newPage();
  if (!data.length) draw('No production matches these filters.', left+8, y-18, 10);
  data.forEach((row,index)=>{
    if (y-rowHeight<44) newPage();
    if (index%2===1) page.drawRectangle({x:left,y:y-rowHeight,width,height:rowHeight,color:pale});
    columns.forEach((column,i)=>{
      const value = row[column];
      const label = typeof value === 'number' ? value.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}) : value;
      const x = left+i*columnWidth+8;
      draw(label,i===0 ? x : x+columnWidth-16-font.widthOfTextAtSize(label,9),y-15,9);
    });
    y-=rowHeight;
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
