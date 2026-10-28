import {requireCondition as check} from './security.js';

// Keep the first photo for older clients while retaining every selected Gate photo.
// The caller determines Gate membership from the saved QA record, never the request.
export function qaInspectionEvidence(body,isGate,validatePhoto){
  const legacyPhoto=validatePhoto(body.photo),hasPhotos=Object.hasOwn(body,'photos');
  if(!isGate){
    if(hasPhotos)check(Array.isArray(body.photos)&&body.photos.length===0,'Multiple QA photos are only available for Gate orders');
    return {photo:legacyPhoto};
  }
  if(!hasPhotos)return {photo:legacyPhoto,photos:legacyPhoto?[legacyPhoto]:[]};
  if(Object.hasOwn(body,'photo'))check(typeof body.photo==='string','The single QA photo must be image text');
  check(Array.isArray(body.photos),'Gate QA photos must be a list');
  check(body.photos.length<=10,'Add no more than 10 Gate QA photos');
  let size=0;
  const photos=Array.from(body.photos,value=>{
    check(typeof value==='string'&&value.length>0,'Each Gate QA photo must be a nonempty image');
    const photo=validatePhoto(value);size+=photo.length;
    check(size<=6000000,'Gate QA photos must total no more than 6 MB of encoded image data');
    return photo;
  });
  check(!legacyPhoto||legacyPhoto===photos[0],'The single QA photo must match the first Gate QA photo');
  return {photo:photos[0]||'',photos};
}
