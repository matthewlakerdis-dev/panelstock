import {safetyProfile} from './safety-profiles.js';

const clean=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
const cardTypes=new Set(['white card','construction card','construction induction card']);
function key(licence){
 const type=clean(licence.description);
 return JSON.stringify([cardTypes.has(type)?'white card':type,clean(licence.class),clean(licence.number)]);
}
const entry=licence=>({description:licence?.description||'',class:licence?.class||'',number:licence?.number||''});

function capturedLicences(details={}){
 if(Array.isArray(details.allLicences))return details.allLicences.map(entry);
 const captured=[];
 // An unfilled printed Construction Card label is not a captured licence.
 if(details.licenceDescription||details.licenceClass||details.licenceNumber)captured.push({description:details.licenceDescription||'Construction Card',class:details.licenceClass||'',number:details.licenceNumber||''});
 const extra=(details.licences||[]).slice(0,2).map(entry);
 if(!extra[0]?.description&&details.qualifications){if(!extra[0])extra.push(entry());extra[0].description=details.qualifications;}
 return [...captured,...extra].filter(licence=>licence.description||licence.class||licence.number);
}

// This is export-only context. Never write it into the signed acknowledgement
// or claim these profile entries were included in its original declaration.
export function safetyLicenceUpdates(store,acknowledgements,asOf=new Date().toISOString()){
 const users=store.read('users',{}),entries=[];
 for(const acknowledgement of acknowledgements){
  const {username,id:acknowledgementId}=acknowledgement;
  if(!Object.hasOwn(users,username)||!users[username])continue;
  const captured=new Map();
  for(const licence of capturedLicences(acknowledgement.details)){const k=key(licence);captured.set(k,(captured.get(k)||0)+1);}
  const licences=[];
  for(const licence of safetyProfile(store,username).licenses){
   const current={description:licence.type,class:licence.class,number:licence.number};
   if(!current.description.trim())continue;
   const k=key(current),count=captured.get(k)||0;
   if(count){captured.set(k,count-1);continue;}
   licences.push(current);
  }
  if(licences.length)entries.push({acknowledgementId,username,licences});
 }
 return {asOf,entries};
}
