import {PDFDocument,StandardFonts,pushGraphicsState,popGraphicsState,concatTransformationMatrix} from 'pdf-lib';
import {requireCondition as check,HttpError} from './security.js';
export const MAX_ORDER_FILE=5*1024*1024,MAX_ORDER_FILES_TOTAL=25*1024*1024,MAX_ORDER_PDF=28*1024*1024;
export const orderFileKey=(orderId,file)=>'order-attachments/'+orderId+'/'+file.id+'/'+file.sha256;
export const printableOrderFile=file=>/\.(pdf|png|jpe?g)$/i.test(file.name||'');
export async function readOrderFile(bucket,orderId,file){
 check(bucket,'Order file storage is unavailable',503);
 check(file.size>0&&file.size<=MAX_ORDER_FILE&&/^[a-f0-9]{64}$/.test(file.sha256),'Invalid stored attachment');
 const object=await bucket.get(orderFileKey(orderId,file));
 check(object&&object.size===file.size,'An order attachment is unavailable. Restore the file before retrying.',422);
 const bytes=new Uint8Array(await object.arrayBuffer());
 check(bytes.length===file.size,'Order attachment size changed',422);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 check(hash===file.sha256,'Order attachment contents changed',422);return bytes;
}
function jpegInfo(bytes){
 check(bytes[0]===255&&bytes[1]===216,'Invalid JPEG');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=0,height=0,orientation=1,orientationFound=false;
 for(let p=2;p+4<=bytes.length;){
  if(bytes[p++]!==255)break;while(bytes[p]===255)p++;
  const marker=bytes[p++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;
  if(p+2>bytes.length)break;const length=view.getUint16(p);if(length<2||p+length>bytes.length)break;
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=view.getUint16(p+3);width=view.getUint16(p+5);}
  if(!orientationFound&&marker===225&&length>=16&&String.fromCharCode(...bytes.subarray(p+2,p+8))==='Exif\0\0'){
   const t=p+8,end=p+length,little=view.getUint16(t)===0x4949;
   if((little||view.getUint16(t)===0x4d4d)&&view.getUint16(t+2,little)===42){
    const offset=view.getUint32(t+4,little),directory=t+offset;
    if(offset>=8&&directory+2<=end){const count=view.getUint16(directory,little);
     for(let n=0;n<count;n++){const entry=directory+2+n*12;if(entry+12>end)break;if(view.getUint16(entry,little)===274&&view.getUint16(entry+2,little)===3&&view.getUint32(entry+4,little)===1){const value=view.getUint16(entry+8,little);if(value>=1&&value<=8){orientation=value;orientationFound=true;}break;}}
    }
   }
  }
  p+=length;
 }
 check(width>0&&height>0&&width*height<=40000000,'Use a JPEG photo up to 40 megapixels');return {width,height,orientation};
}
function pngInfo(bytes){
 check(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),'Invalid PNG');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);
 check(width>0&&height>0&&width*height<=12000000,'Resize PNG photos to 12 megapixels or smaller');return {width,height,orientation:1};
}
const transform=(orientation,w,h)=>({1:[1,0,0,1,0,0],2:[-1,0,0,1,w,0],3:[-1,0,0,-1,w,h],4:[1,0,0,-1,0,h],5:[0,-1,-1,0,h,w],6:[0,-1,1,0,0,w],7:[0,1,1,0,0,0],8:[0,1,-1,0,h,0]})[orientation];

export async function appendOrderPdfFiles(cover,orderId,files=[],bucket){
 check(files.length<=10&&files.reduce((sum,file)=>sum+file.size,0)<=MAX_ORDER_FILES_TOTAL,'Order attachments exceed the file limits');
 const printable=files.filter(printableOrderFile);if(!printable.length)return {bytes:cover,appendedIds:[]};
 const pdf=await PDFDocument.load(cover,{updateMetadata:false});let font,pngPixels=0;
 for(const file of printable){
  const bytes=await readOrderFile(bucket,orderId,file);
  try{
   if(/\.pdf$/i.test(file.name)){
    const source=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
    check(!source.isEncrypted,'Export an unencrypted PDF');
    check(source.getPageCount()>0&&pdf.getPageCount()+source.getPageCount()<=200,'The combined order PDF can contain up to 200 pages');
    const pages=await pdf.copyPages(source,source.getPageIndices());for(const page of pages)pdf.addPage(page);
   }else{
    check(pdf.getPageCount()<200,'The combined order PDF can contain up to 200 pages');
    const png=/\.png$/i.test(file.name),info=png?pngInfo(bytes):jpegInfo(bytes);
    if(png){pngPixels+=info.width*info.height;check(pngPixels<=12000000,'Resize PNG photos to 12 megapixels or fewer in total per order PDF');}
    const image=png?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);
    const rotated=info.orientation>=5,displayWidth=rotated?info.height:info.width,displayHeight=rotated?info.width:info.height;
    const [width,height]=displayWidth>displayHeight?[841.89,595.276]:[595.276,841.89],page=pdf.addPage([width,height]);
    font=font||await pdf.embedFont(StandardFonts.Helvetica);
    let label=String(file.name).replace(/[^\x20-\x7e]/g,'?');while(font.widthOfTextAtSize(label,10)>width-48)label=label.slice(0,-4)+'...';
    page.drawText(label,{x:24,y:height-30,font,size:10});
    const scale=Math.min(1,(width-48)/displayWidth,(height-72)/displayHeight),w=info.width*scale,h=info.height*scale,x=(width-displayWidth*scale)/2,y=24+(height-72-displayHeight*scale)/2;
    const [a,b,c,d,e,f]=transform(info.orientation,w,h);
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(a,b,c,d,e+x,f+y));
    page.drawImage(image,{x:0,y:0,width:w,height:h});page.pushOperators(popGraphicsState());
   }
  }catch(error){throw new HttpError(422,`Could not append ${file.name}. ${error instanceof HttpError?error.message:'Export it again as a readable PDF, JPG or PNG.'}`);}
 }
 const bytes=await pdf.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});
 check(bytes.length<=MAX_ORDER_PDF,'The combined order PDF is too large. Use smaller attachment files.',413);
 return {bytes,appendedIds:printable.map(file=>file.id)};
}
