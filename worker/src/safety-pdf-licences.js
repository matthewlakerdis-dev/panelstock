// Arrange the signed snapshot for the form without changing its contents.
export function safetyPdfLicenceRows(details={}){
 const entry=l=>({description:l?.description||'',class:l?.class||'',number:l?.number||''});
 const additional=(details.licences||[]).slice(0,2).map(entry);
 const card={description:'Construction Card',class:details.licenceClass||'',number:details.licenceNumber||''};
 if(!card.class&&!card.number){
  const type=l=>l.description.trim().replace(/\s+/g,' ').toLowerCase();
  let index=additional.findIndex(l=>['construction card','construction induction card'].includes(type(l)));
  if(index<0)index=additional.findIndex(l=>type(l)==='white card');
  // Older acknowledgements saved White Card as an additional licence. Only
  // move those signed values; never look up today's profile or alter the ack.
  if(index>=0){const [saved]=additional.splice(index,1);card.class=saved.class;card.number=saved.number;}
 }
 const extra=[entry(additional[0]),entry(additional[1])];
 if(!extra[0].description)extra[0].description=details.qualifications||'';
 return [card,...extra];
}
