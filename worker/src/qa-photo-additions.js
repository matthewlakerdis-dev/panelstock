import {requireCondition as check} from './security.js';
import {qaInspectionPhotoGallery} from './qa-photos.js';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=100&&value===value.trim();

// Supplements are separate records: never rebuild or edit an inspection attempt.
export function prepareQaPhotoAddition(records,body,actor,validatePhoto,now=new Date().toISOString()){
  check(actor?.isAdmin||actor?.tasks?.['factory.qa'],'You do not have access to this task',403);
  check(body&&typeof body==='object'&&!Array.isArray(body),'Invalid QA photo request');
  check(identifier(body.id)&&['panel','metalwork'].includes(body.kind)&&identifier(body.attemptId),'Choose a saved QA inspection');
  check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'A photo upload request ID is required');
  const reused=records.flatMap(record=>(record.photoAdditions||[]).filter(addition=>addition.mutationId===body.mutationId).map(addition=>({record,addition})));
  if(reused.length){
    check(reused.length===1,'This photo upload request has conflicting saved records',409);
    const {record,addition}=reused[0];
    check(record.id===body.id&&record.kind===body.kind&&addition.attemptId===body.attemptId&&addition.addedBy===actor.username&&same(addition.photos,body.photos),'This photo upload request was already used with different details',409);
    return {records,record,addition,idempotent:true};
  }
  const matches=records.filter(record=>record.id===body.id&&record.kind===body.kind);
  check(matches.length,'Saved QA item not found',404);check(matches.length===1,'This QA item has conflicting saved records',409);
  const previous=matches[0],attempts=[...(previous.history||[]),previous.latest].filter(attempt=>attempt?.id===body.attemptId);
  check(attempts.length,'Saved QA inspection not found',404);
  check(attempts.every(attempt=>same(attempt,attempts[0])),'This inspection has conflicting saved snapshots. Refresh QA before adding photos.',409);
  const attempt=attempts[0];check(['approved','recut','rework'].includes(attempt.status),'Photos can only be added to a completed QA inspection',409);
  check(Array.isArray(body.photos)&&body.photos.length>0&&body.photos.length<=10,'Select between 1 and 10 QA photos');
  const photos=Array.from(body.photos,value=>{
    check(typeof value==='string'&&value.length>0,'Each QA photo must be a nonempty image');return validatePhoto(value);
  }),gallery=qaInspectionPhotoGallery(previous,attempt);
  check(gallery.length+photos.length<=10,'An inspection can have no more than 10 QA photos',409);
  let size=photos.reduce((total,photo)=>total+photo.length,0);
  for(const photo of gallery){check(typeof photo==='string'&&photo.length>0,'This inspection has invalid saved photo evidence',409);size+=photo.length;}
  check(size<=6000000,'QA photos for one inspection must total no more than 6 MB of encoded image data',409);
  const addition={id:crypto.randomUUID(),attemptId:body.attemptId,photos,addedBy:actor.username,addedAt:now,mutationId:body.mutationId},
    record={...previous,photoAdditions:[...(previous.photoAdditions||[]),addition]};
  return {records:records.map(value=>value===previous?record:value),record,addition,idempotent:false};
}
