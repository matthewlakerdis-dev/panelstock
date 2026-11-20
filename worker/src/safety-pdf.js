import {fillDetectedSignoff} from './safety-pdf-detected.js';
import {fillSupervisorSignoff} from './safety-pdf-supervisor.js';
import {safetyPdfLicenceRows} from './safety-pdf-licences.js';
import {safetyLabelBackgrounds} from './safety-pdf-labels.js';
import {fillExpandedSafetySignoff,legacySafetySignoffTables,needsExpandedSafetySignoff,appendCurrentSafetyLicencePage} from './safety-pdf-expanded.js';
import {currentSafetyLicenceUpdates} from './safety-pdf-current-licences.js';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
export async function createSignedSafetyPdf(bytes,version,acknowledgements,fontBytes,licenceUpdates){
 if(!version.signoff||!['lf-swms-v1','lf-swms-detected-v1'].includes(version.signoff.layout))throw Error('Configure the SWMS sign-off pages first.');
 const updates=currentSafetyLicenceUpdates(version,acknowledgements,licenceUpdates);
 const pdf=await PDFDocument.load(bytes),sourcePageCount=pdf.getPageCount();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes,{subset:true});
 if(version.signoff.layout==='lf-swms-detected-v1'){
  if(!Array.isArray(version.signoff.pages)||(!version.signoff.pages.length&&!version.signoff.supervisors?.length))throw Error('No detected sign-off fields.');
  if(version.signoff.pages.length)await fillDetectedSignoff(pdf,font,version.signoff.pages,acknowledgements,updates);
  else await appendCurrentSafetyLicencePage(pdf,font,version,acknowledgements,updates);
  await fillSupervisorSignoff(pdf,version,acknowledgements,sourcePageCount);
  pdf.setTitle(version.title+' — signed SWMS');pdf.setSubject('Signed copy of '+version.label+'; original file SHA-256 '+version.fileHash);return pdf.save();
 }
 const {firstPage,continuationPage}=version.signoff;if(firstPage<1||continuationPage<1||firstPage>pdf.getPageCount()||continuationPage>pdf.getPageCount()||firstPage===continuationPage)throw Error('Invalid sign-off pages.');
 if(updates.entries.size||needsExpandedSafetySignoff(acknowledgements)){
  await fillExpandedSafetySignoff(pdf,font,legacySafetySignoffTables(pdf,firstPage,continuationPage),acknowledgements,updates);
  pdf.setTitle(version.title+' — signed SWMS');pdf.setSubject('Signed copy of '+version.label+'; original file SHA-256 '+version.fileHash);return pdf.save();
 }
 const supported=new Set(font.getCharacterSet());const clean=value=>{const s=String(value??'').replace(/[\r\n\t]+/g,' ');for(const c of s)if(!supported.has(c.codePointAt(0)))throw Error('The PDF font cannot display '+c);return s};
 function write(page,text,x,top,width,size=8,minSize=5.5){const sx=page.getWidth()/792,sy=page.getHeight()/612;let value=clean(text);while(size>minSize&&font.widthOfTextAtSize(value,size)>width)size-=.25;if(font.widthOfTextAtSize(value,size)>width)throw Error('An entry is too long for the SWMS sign-off table. Shorten the entry before signing.');page.drawText(value,{x:x*sx,y:page.getHeight()-(top+size)*sy,font,size:size*Math.min(sx,sy),color:rgb(.05,.1,.14)})}
 const slots=[{page:pdf.getPage(firstPage-1),top:277.5,count:8},{page:pdf.getPage(continuationPage-1),top:161.7,count:9}];
 for(let remaining=acknowledgements.length-17;remaining>0;remaining-=9){const [copy]=await pdf.copyPages(pdf,[continuationPage-1]);pdf.addPage(copy);copy.drawRectangle({x:655/792*copy.getWidth(),y:58/612*copy.getHeight(),width:105/792*copy.getWidth(),height:12/612*copy.getHeight(),color:rgb(1,1,1)});write(copy,'Sign-off continuation '+(slots.length-1),655,542,100,7);slots.push({page:copy,top:161.7,count:9})}
 const labels=[];let labelIndex=0;for(const slot of slots)for(let row=0;row<slot.count&&labelIndex<acknowledgements.length;row++,labelIndex++){if(safetyPdfLicenceRows(acknowledgements[labelIndex].details)[0].description==='Construction Card')continue;const sx=slot.page.getWidth()/792,sy=slot.page.getHeight()/612;labels.push({page:slot.page,x:291.72*sx,width:89.88*sx,top:(slot.top+row*30.6+1.26)*sy,height:9.72*sy,index:labelIndex});}
 const backgrounds=await safetyLabelBackgrounds(pdf,labels),replaceLabels=new Map(labels.map((l,i)=>[l.index,backgrounds[i]]));
 let index=0;for(const slot of slots){const p=slot.page,sx=p.getWidth()/792,sy=p.getHeight()/612;for(let row=0;row<slot.count&&index<acknowledgements.length;row++,index++){const a=acknowledgements[index],top=slot.top+row*30.6,d=a.details||{},licences=safetyPdfLicenceRows(d);const replaceLabel=replaceLabels.get(index);if(replaceLabel){replaceLabel();write(p,licences[0].description,296,top+1.5,81,6.5,4.5);}write(p,a.name,57,top+9,90);write(p,d.role,155,top+9,131);write(p,licences[0].class,384,top+1.5,80,7);write(p,licences[0].number,474,top+1.5,80,7);for(const i of [0,1]){const licence=licences[i+1],y=top+11.7+i*10.2;write(p,licence.description,296,y,81,6.5);write(p,licence.class,384,y,80,6.5);write(p,licence.number,474,y,80,6.5);}const date=new Date(a.signature.at).toLocaleDateString('en-GB',{timeZone:'Australia/Brisbane',day:'2-digit',month:'2-digit',year:'numeric'}).replaceAll('/','-');write(p,date,564,top+9,71,8);const image=await pdf.embedPng(a.signature.image);const scale=Math.min(103*sx/image.width,23*sy/image.height);p.drawImage(image,{x:645*sx+(103*sx-image.width*scale)/2,y:p.getHeight()-(top+4)*sy-image.height*scale,width:image.width*scale,height:image.height*scale});}}
 pdf.setTitle(version.title+' — signed SWMS');pdf.setSubject('Signed copy of '+version.label+'; original file SHA-256 '+version.fileHash);return pdf.save();
}
