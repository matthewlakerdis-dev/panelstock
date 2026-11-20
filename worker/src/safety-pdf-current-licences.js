// Export-only profile information is kept separate from the acknowledgement.
// It must identify one exact saved sign-off; it never changes its signed data.
export function currentSafetyLicenceUpdates(version,acknowledgements,updates){
 const entries=new Map();
 if(updates===undefined)return {asOf:null,entries};
 if(!updates||typeof updates!=='object'||Array.isArray(updates)||typeof updates.asOf!=='string'||!Number.isFinite(Date.parse(updates.asOf))||!Array.isArray(updates.entries)||updates.entries.length>500)throw Error('Invalid current profile licence updates.');
 for(const update of updates.entries){
  if(!update||typeof update!=='object'||Array.isArray(update)||typeof update.acknowledgementId!=='string'||!update.acknowledgementId||typeof update.username!=='string'||!update.username||entries.has(update.acknowledgementId)||!Array.isArray(update.licences)||!update.licences.length||update.licences.length>50)throw Error('Invalid current profile licence update.');
  const matches=acknowledgements.filter(a=>a.id===update.acknowledgementId&&a.username===update.username);
  if(matches.length!==1)throw Error('Current profile licence update does not match a saved acknowledgement.');
  const ack=matches[0];
  if(!version.id||!version.documentId||!version.fileHash||ack.versionId!==version.id||ack.documentId!==version.documentId||ack.fileHash!==version.fileHash||JSON.stringify(ack.signoff)!==JSON.stringify(version.signoff))throw Error('Current profile licence update does not match this SWMS version.');
  const licences=update.licences.map(licence=>{
   if(!licence||typeof licence!=='object'||Array.isArray(licence))throw Error('Invalid current profile licence.');
   const copy={};
   for(const [key,max] of Object.entries({description:120,class:18,number:100})){
    if(typeof licence[key]!=='string'||licence[key].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(licence[key]))throw Error('Invalid current profile licence details.');
    copy[key]=licence[key];
   }
   if(!copy.description.trim())throw Error('Invalid current profile licence description.');
   return copy;
  });
  entries.set(update.acknowledgementId,licences);
 }
 return {asOf:updates.asOf,entries};
}
