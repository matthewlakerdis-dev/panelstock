// Supervisor signatures come only from the API's immutable acknowledgement for
// this version. A matching display name is not a substitute for the mapped user.
export async function fillSupervisorSignoff(pdf,version,acknowledgements,sourcePageCount=pdf.getPageCount()){
 const fields=version.signoff?.supervisors;
 if(fields===undefined)return;
 if(!Array.isArray(fields)||fields.length>20)throw Error('Invalid supervisor sign-off fields.');
 const placements=[],used=[];
 for(const field of fields){
  if(!field||!Number.isInteger(field.page)||field.page<1||field.page>sourcePageCount||typeof field.username!=='string'||!field.username.trim())throw Error('Invalid supervisor sign-off field.');
  const page=pdf.getPage(field.page-1),rect=field.rect;
  if(page.getRotation().angle%360!==0||!Number.isFinite(field.width)||!Number.isFinite(field.height)||Math.abs(page.getWidth()-field.width)>1||Math.abs(page.getHeight()-field.height)>1)throw Error('Supervisor sign-off page dimensions changed.');
  if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isFinite))throw Error('Invalid supervisor signature area.');
  const [x,top,width,height]=rect;
  if(x<0||top<0||width<24||height<8||x+width>page.getWidth()||top+height>page.getHeight())throw Error('Supervisor signature area is outside the page.');
  if(used.some(p=>p.page===field.page&&x<p.x+p.width&&x+width>p.x&&top<p.top+p.height&&top+height>p.top))throw Error('Supervisor signature areas overlap.');
  used.push({page:field.page,x,top,width,height});
  const matches=acknowledgements.filter(a=>a.username===field.username);
  if(!matches.length)continue;
  if(matches.length!==1)throw Error('More than one acknowledgement matches this supervisor. Refresh the document before exporting.');
  const ack=matches[0];
  if(!version.id||!version.documentId||!version.fileHash||ack.versionId!==version.id||ack.documentId!==version.documentId||ack.fileHash!==version.fileHash||JSON.stringify(ack.signoff)!==JSON.stringify(version.signoff))throw Error('Supervisor acknowledgement does not match this SWMS version. Refresh the document before exporting.');
  if(!ack.signature||typeof ack.signature.image!=='string'||!ack.signature.image.startsWith('data:image/png;base64,')||!Number.isFinite(Date.parse(ack.signature.at))||!/^[a-f0-9]{64}$/.test(ack.signature.contentHash||''))throw Error('Supervisor acknowledgement has no valid captured signature.');
  placements.push({page,x,top,width,height,signature:ack.signature});
 }
 for(const {page,x,top,width,height,signature} of placements){
  const image=await pdf.embedPng(signature.image),scale=Math.min((width-4)/image.width,(height-4)/image.height),drawWidth=image.width*scale,drawHeight=image.height*scale;
  // Keep the source's alpha channel and its aspect ratio. Do not cover any of
  // the existing PDF text, rules or shading with an opaque background.
  page.drawImage(image,{x:x+(width-drawWidth)/2,y:page.getHeight()-top-(height+drawHeight)/2,width:drawWidth,height:drawHeight});
 }
}
