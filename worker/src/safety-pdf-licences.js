// Arrange the signed snapshot for the form without changing its contents.
export function safetyPdfLicenceRows(details={}){
 const entry=l=>({description:l?.description||'',class:l?.class||'',number:l?.number||''});
 if(details.allLicences!==undefined){
  if(!Array.isArray(details.allLicences)||details.allLicences.length>50||details.allLicences.some(l=>!l||['description','class','number'].some(k=>typeof l[k]!=='string')))throw Error('Invalid captured licence details.');
  const rows=details.allLicences.map(entry);while(rows.length<3)rows.push(entry());return rows;
 }
 const additional=(details.licences||[]).slice(0,2).map(entry);
 const card={description:details.licenceDescription||'Construction Card',class:details.licenceClass||'',number:details.licenceNumber||''};
 if(!details.licenceDescription&&!card.class&&!card.number){
  const type=l=>l.description.trim().replace(/\s+/g,' ').toLowerCase();
  let index=additional.findIndex(l=>['construction card','construction induction card'].includes(type(l)));
  if(index<0)index=additional.findIndex(l=>type(l)==='white card');
  // Older acknowledgements saved White Card as an additional licence. Only
  // move those signed values; never look up today's profile or alter the ack.
  if(index>=0){const [saved]=additional.splice(index,1);card.description=saved.description;card.class=saved.class;card.number=saved.number;}
 }
 const extra=[entry(additional[0]),entry(additional[1])];
 if(!extra[0].description)extra[0].description=details.qualifications||'';
 return [card,...extra];
}

// Current profile additions only change the exported layout. Compact unused
// captured slots before appending them, then retain the form's three-row minimum.
// The saved acknowledgement and its original licence order remain untouched.
export function safetyPdfLicenceRowsWithAdditions(details={},additions){
 const saved=safetyPdfLicenceRows(details);
 if(!additions?.length)return saved;
 const hasValue=licence=>['description','class','number'].some(key=>String(licence[key]||'').trim());
 const cardType=licence=>['construction card','construction induction card','white card'].includes(String(licence?.description||'').trim().replace(/\s+/g,' ').toLowerCase());
 const implicitCard=details.allLicences===undefined&&!details.licenceDescription&&!details.licenceClass&&!details.licenceNumber&&!(details.licences||[]).slice(0,2).some(cardType);
 const rows=saved.filter((licence,index)=>hasValue(licence)&&!(index===0&&implicitCard));
 rows.push(...additions.map(licence=>({description:licence.description,class:licence.class,number:licence.number})));
 while(rows.length<3)rows.push({description:'',class:'',number:''});
 return rows;
}
