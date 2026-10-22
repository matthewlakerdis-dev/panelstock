import {rgb} from 'pdf-lib';
import {safetyPdfLicenceRows} from './safety-pdf-licences.js';
import {safetyLabelBackgrounds} from './safety-pdf-labels.js';
export async function fillDetectedSignoff(pdf,font,pages,acknowledgements){
 if(!Array.isArray(pages)||!pages.length)throw Error('No detected sign-off tables.');
 const slots=pages.map(p=>{if(!Number.isInteger(p.page)||p.page<1||p.page>pdf.getPageCount()||!p.rows?.length)throw Error('Invalid detected sign-off page.');return {...p,pdfPage:pdf.getPage(p.page-1)}});
 const capacity=slots.reduce((n,p)=>n+p.rows.length,0),last=slots.at(-1);
 for(let left=acknowledgements.length-capacity;left>0;left-=last.rows.length){const [copy]=await pdf.copyPages(pdf,[last.page-1]);pdf.addPage(copy);slots.push({...last,pdfPage:copy})}
 const labels=[];let labelIndex=0;
 for(const slot of slots)for(const row of slot.rows){const ack=acknowledgements[labelIndex++];if(!ack)break;const name=safetyPdfLicenceRows(ack.details)[0].description;if(!row.needsConstructionCardLabel&&name!=='Construction Card'){const cell=row.licenceRows?.[0]||{top:row.top,height:row.height/3};labels.push({page:slot.pdfPage,x:slot.columns.type[0],width:slot.columns.type[1],top:cell.top,height:cell.height,index:labelIndex-1});}}
 const backgrounds=await safetyLabelBackgrounds(pdf,labels),replaceLabels=new Map(labels.map((l,i)=>[l.index,backgrounds[i]]));
 const supported=new Set(font.getCharacterSet());
 function text(page,value,x,top,width,height,size=8,minSize=5.5){size=Math.min(size,height-1);value=String(value||'').replace(/[\r\n\t]+/g,' ');for(const c of value)if(!supported.has(c.codePointAt(0)))throw Error('The PDF font cannot display '+c);while(size>minSize&&font.widthOfTextAtSize(value,size)>width-6)size-=.25;if(font.widthOfTextAtSize(value,size)>width-6)throw Error('An entry is too long for the detected sign-off field. Update the profile and collect a fresh signature.');page.drawText(value,{x:x+3,y:page.getHeight()-top-(height+size)/2,font,size,color:rgb(.05,.1,.14)})}
 let index=0;
 for(const slot of slots){const page=slot.pdfPage,c=slot.columns;if(Math.abs(page.getWidth()-slot.width)>1||Math.abs(page.getHeight()-slot.height)>1)throw Error('Detected page dimensions changed.');for(const row of slot.rows){if(index>=acknowledgements.length)break;const a=acknowledgements[index++],d=a.details||{};
  // Keep geometry in PDF points, independent of page number or table location.
  const draw=(field,value,top=row.top,height=row.height,size=8,minSize=5.5)=>text(page,value,c[field][0],top,c[field][1],height,size,minSize);
  draw('name',a.name);draw('role',d.role);const sub=row.height/3,licenceRows=row.licenceRows||[0,1,2].map(i=>({top:row.top+i*sub,height:sub})),entries=safetyPdfLicenceRows(d);
  const replaceLabel=replaceLabels.get(index-1);replaceLabel?.();
  for(const i of [0,1,2]){const l=entries[i],cell=licenceRows[i];if(i||row.needsConstructionCardLabel||replaceLabel)draw('type',l.description,cell.top,cell.height,6.5,i?5.5:4.5);draw('class',l.class,cell.top,cell.height,i?6.5:7);draw('number',l.number,cell.top,cell.height,i?6.5:7)}
  draw('date',new Date(a.signature.at).toLocaleDateString('en-GB',{timeZone:'Australia/Brisbane',day:'2-digit',month:'2-digit',year:'numeric'}).replaceAll('/','-'));
  const image=await pdf.embedPng(a.signature.image),[x,width]=c.signature,scale=Math.min((width-8)/image.width,(row.height-6)/image.height);page.drawImage(image,{x:x+(width-image.width*scale)/2,y:page.getHeight()-row.top-(row.height+image.height*scale)/2,width:image.width*scale,height:image.height*scale});
 }}
}
